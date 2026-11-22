"""Candidate routes: enrolled exams, attempt start/resume, heartbeat, durable autosave, proctoring, code runner, results."""
import asyncio
from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import client_ip_from_request
from app.core.clock import as_utc, utc_now
from app.core.dependencies import get_current_candidate
from app.core.rate_limit import enforce_rate_limit
from app.core.redis_store import exam_channel, redis_store
from app.database import get_db
from app.models import (
    Announcement,
    Answer,
    Attempt,
    Candidate,
    Enrollment,
    Exam,
    ProctoringEvent,
    Question,
    Snapshot,
)
from app.schemas.attempts import (
    AnswerSaveRequest,
    AnswerSaveResponse,
    AttemptAnnouncementOut,
    AttemptAnswerOut,
    AttemptExamMeta,
    AttemptState,
    CandidateAttemptSummary,
    CandidateExamCard,
    CodeRunRequest,
    CodeRunResult,
    ExamStartRequest,
    HeartbeatResponse,
    ProctoringEventRequest,
    ProctoringEventResponse,
    ResultQuestionView,
    ResultView,
    SubmitResult,
)
from app.schemas.exams import CandidateCodingSpec, CandidateQuestion, CodingTestCase, QuestionOption
from app.services.code_sandbox import execute_code
from app.services.exam_lifecycle import effective_exam_status, generate_attempt_order
from app.services.scoring import EXPIRY_GRACE_SECONDS, finalize_attempt, is_response_answered
from app.services.snapshot_storage import save_jpeg_snapshot

router = APIRouter(prefix="/api/candidate", tags=["Candidate Portal"])

# Logged in timeline for invigilator awareness without consuming automatic termination strikes.
WARNING_ONLY_EVENTS = {"copy_attempt", "context_menu"}


def _remaining_seconds(attempt: Attempt, exam: Exam, now) -> int:
    if attempt.status != "in_progress":
        return 0
    reference_time = as_utc(exam.paused_at) if (exam.lifecycle_state == "paused" and exam.paused_at) else now
    return max(0, int((as_utc(attempt.deadline) - reference_time).total_seconds()))


def _question_to_candidate(question: Question, position: int, option_order: list[str] | None) -> CandidateQuestion:
    raw_options = question.options or []
    if option_order and raw_options:
        by_id = {opt["id"]: opt for opt in raw_options}
        ordered = [by_id[oid] for oid in option_order if oid in by_id]
        # Append any options not in stored order defensively.
        seen = {opt["id"] for opt in ordered}
        ordered.extend(opt for opt in raw_options if opt["id"] not in seen)
        options = [QuestionOption(**opt) for opt in ordered]
    else:
        options = [QuestionOption(**opt) for opt in raw_options]

    coding_view = None
    if question.kind == "coding" and question.coding:
        spec = question.coding
        coding_view = CandidateCodingSpec(
            languages=spec.get("languages", ["python"]),
            starter_code=spec.get("starter_code", {}),
            time_limit_ms=int(spec.get("time_limit_ms", 2000)),
            sample_tests=[CodingTestCase(**tc) for tc in spec.get("sample_tests", [])],
        )

    return CandidateQuestion(
        id=question.id,
        position=position,
        kind=question.kind,
        prompt=question.prompt,
        options=options,
        marks=question.marks,
        coding=coding_view,
    )


async def _build_attempt_state(attempt: Attempt, exam: Exam, db: AsyncSession) -> AttemptState:
    questions = (
        await db.execute(select(Question).where(Question.exam_id == exam.id))
    ).scalars().all()
    question_map = {q.id: q for q in questions}
    option_orders = attempt.option_order or {}

    candidate_questions: list[CandidateQuestion] = []
    for position, question_id in enumerate(attempt.question_order or [], start=1):
        question = question_map.get(question_id)
        if question is not None:
            candidate_questions.append(_question_to_candidate(question, position, option_orders.get(question_id)))

    answers = (
        await db.execute(select(Answer).where(Answer.attempt_id == attempt.id))
    ).scalars().all()
    announcements = (
        await db.execute(
            select(Announcement).where(Announcement.exam_id == exam.id).order_by(Announcement.created_at.desc()).limit(20)
        )
    ).scalars().all()

    now = utc_now()
    exam_status = effective_exam_status(exam, now)
    return AttemptState(
        attempt_id=attempt.id,
        status=attempt.status,
        exam=AttemptExamMeta(
            id=exam.id,
            title=exam.title,
            instructions=exam.instructions,
            status=exam_status,
            require_webcam=exam.require_webcam,
            require_fullscreen=exam.require_fullscreen,
            max_violations=exam.max_violations,
        ),
        started_at=as_utc(attempt.started_at),
        deadline=as_utc(attempt.deadline),
        server_time=now,
        remaining_seconds=_remaining_seconds(attempt, exam, now),
        violation_count=attempt.violation_count,
        questions=candidate_questions,
        answers=[
            AttemptAnswerOut(
                question_id=ans.question_id,
                response=ans.response,
                is_flagged=ans.is_flagged,
                version=ans.version,
            )
            for ans in answers
        ],
        announcements=[
            AttemptAnnouncementOut(id=ann.id, message=ann.message, created_at=as_utc(ann.created_at))
            for ann in announcements
        ],
    )


async def _load_owned_attempt(attempt_id: str, candidate: Candidate, db: AsyncSession) -> tuple[Attempt, Exam]:
    row = (
        await db.execute(
            select(Attempt, Exam)
            .join(Exam, Exam.id == Attempt.exam_id)
            .where(Attempt.id == attempt_id, Attempt.candidate_id == candidate.id)
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found.")
    return row[0], row[1]


async def _auto_submit_if_expired(attempt: Attempt, exam: Exam, db: AsyncSession) -> bool:
    if attempt.status != "in_progress":
        return False
    now = utc_now()
    if effective_exam_status(exam, now) == "paused":
        return False
    if now > as_utc(attempt.deadline) + timedelta(seconds=EXPIRY_GRACE_SECONDS):
        await finalize_attempt(attempt, submit_reason="timeout", db=db)
        await db.commit()
        return True
    return False


@router.get("/exams", response_model=list[CandidateExamCard])
async def list_enrolled_exams(
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Exam, Enrollment, Attempt)
            .join(Enrollment, Enrollment.exam_id == Exam.id)
            .outerjoin(Attempt, (Attempt.exam_id == Exam.id) & (Attempt.candidate_id == candidate.id))
            .where(Enrollment.candidate_id == candidate.id, Exam.lifecycle_state != "draft")
            .order_by(Exam.starts_at.desc())
        )
    ).all()
    if not rows:
        return []

    exam_ids = [exam.id for exam, _, _ in rows]
    question_agg = (
        await db.execute(
            select(Question.exam_id, func.count(Question.id), func.coalesce(func.sum(Question.marks), 0.0))
            .where(Question.exam_id.in_(exam_ids))
            .group_by(Question.exam_id)
        )
    ).all()
    question_stats = {row[0]: (int(row[1]), float(row[2])) for row in question_agg}

    now = utc_now()
    cards: list[CandidateExamCard] = []
    for exam, _enrollment, attempt in rows:
        q_count, total_marks = question_stats.get(exam.id, (0, 0.0))
        results_visible = exam.results_published or exam.show_results_immediately
        results_available = bool(attempt and attempt.status == "submitted" and results_visible)

        attempt_summary = None
        if attempt is not None:
            attempt_summary = CandidateAttemptSummary(
                id=attempt.id,
                status=attempt.status,
                score=attempt.score if results_available else None,
                max_score=attempt.max_score or round(total_marks, 2),
                submitted_at=as_utc(attempt.submitted_at),
            )

        cards.append(
            CandidateExamCard(
                id=exam.id,
                title=exam.title,
                description=exam.description,
                status=effective_exam_status(exam, now),
                starts_at=as_utc(exam.starts_at),
                ends_at=as_utc(exam.ends_at),
                duration_minutes=exam.duration_minutes,
                question_count=q_count,
                total_marks=round(total_marks, 2),
                require_webcam=exam.require_webcam,
                require_fullscreen=exam.require_fullscreen,
                requires_access_code=bool(exam.access_code),
                attempt=attempt_summary,
                results_available=results_available,
            )
        )
    return cards


@router.post("/exams/{exam_id}/start", response_model=AttemptState)
async def start_or_resume_exam(
    exam_id: str,
    request: Request,
    payload: ExamStartRequest | None = None,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    enrollment = (
        await db.execute(
            select(Enrollment).where(Enrollment.exam_id == exam_id, Enrollment.candidate_id == candidate.id)
        )
    ).scalar_one_or_none()
    if enrollment is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not enrolled in this examination.")

    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Examination not found.")

    existing = (
        await db.execute(
            select(Attempt).where(Attempt.exam_id == exam_id, Attempt.candidate_id == candidate.id)
        )
    ).scalar_one_or_none()
    if existing is not None:
        await _auto_submit_if_expired(existing, exam, db)
        if existing.status == "submitted":
            raise HTTPException(status.HTTP_409_CONFLICT, "You have already submitted this examination.")
        existing.last_seen_at = utc_now()
        await db.commit()
        return await _build_attempt_state(existing, exam, db)

    exam_status = effective_exam_status(exam)
    if exam_status != "live":
        raise HTTPException(status.HTTP_409_CONFLICT, f"This examination is currently {exam_status} and cannot be started.")

    if exam.access_code:
        submitted_code = (payload.access_code or "").strip() if payload else ""
        if submitted_code != exam.access_code:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid examination access PIN.")

    questions = (
        await db.execute(select(Question).where(Question.exam_id == exam.id).order_by(Question.position.asc()))
    ).scalars().all()
    if not questions:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Examination has no questions configured.")

    question_order, option_order = generate_attempt_order(questions, candidate.id, exam)
    now = utc_now()
    total_minutes = exam.duration_minutes + enrollment.extra_minutes
    duration_deadline = now + timedelta(minutes=total_minutes)
    window_deadline = as_utc(exam.ends_at) + timedelta(minutes=enrollment.extra_minutes)
    deadline = min(duration_deadline, window_deadline)

    attempt = Attempt(
        exam_id=exam.id,
        candidate_id=candidate.id,
        status="in_progress",
        started_at=now,
        deadline=deadline,
        question_order=question_order,
        option_order=option_order,
        last_seen_at=now,
        client_ip=client_ip_from_request(request),
        user_agent=(request.headers.get("user-agent") or "")[:255] or None,
        max_score=round(sum(float(q.marks) for q in questions), 2),
    )
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)

    redis_store.publish_in_background(
        exam_channel(exam.id),
        "attempt_started",
        candidate_id=candidate.id,
        attempt_id=attempt.id,
        candidate_code=candidate.candidate_code,
        full_name=candidate.user.full_name,
    )
    return await _build_attempt_state(attempt, exam, db)


@router.get("/attempts/{attempt_id}", response_model=AttemptState)
async def get_attempt_state(
    attempt_id: str,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    attempt, exam = await _load_owned_attempt(attempt_id, candidate, db)
    await _auto_submit_if_expired(attempt, exam, db)
    return await _build_attempt_state(attempt, exam, db)


@router.post("/attempts/{attempt_id}/heartbeat", response_model=HeartbeatResponse)
async def attempt_heartbeat(
    attempt_id: str,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    attempt, exam = await _load_owned_attempt(attempt_id, candidate, db)
    await _auto_submit_if_expired(attempt, exam, db)
    now = utc_now()
    attempt.last_seen_at = now
    await db.commit()

    return HeartbeatResponse(
        status=attempt.status,
        exam_status=effective_exam_status(exam, now),
        remaining_seconds=_remaining_seconds(attempt, exam, now),
        deadline=as_utc(attempt.deadline),
        server_time=now,
        violation_count=attempt.violation_count,
    )


@router.put("/attempts/{attempt_id}/answers/{question_id}", response_model=AnswerSaveResponse)
async def save_answer(
    attempt_id: str,
    question_id: str,
    payload: AnswerSaveRequest,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    await enforce_rate_limit(f"save:{attempt_id}", limit=120, window_seconds=60)
    attempt, exam = await _load_owned_attempt(attempt_id, candidate, db)

    if attempt.status != "in_progress":
        raise HTTPException(status.HTTP_409_CONFLICT, "This attempt has already been submitted.")

    now = utc_now()
    if effective_exam_status(exam, now) == "paused":
        raise HTTPException(status.HTTP_423_LOCKED, "Exam is currently paused by the invigilator.")

    if now > as_utc(attempt.deadline) + timedelta(seconds=EXPIRY_GRACE_SECONDS):
        await finalize_attempt(attempt, submit_reason="timeout", db=db)
        await db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Examination time has expired.")

    if question_id not in (attempt.question_order or []):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Question does not belong to this attempt.")

    existing = (
        await db.execute(
            select(Answer).where(Answer.attempt_id == attempt.id, Answer.question_id == question_id)
        )
    ).scalar_one_or_none()

    if existing is not None:
        if existing.version >= payload.version:
            return AnswerSaveResponse(
                question_id=question_id,
                version=existing.version,
                saved_at=as_utc(existing.saved_at),
                accepted=False,
            )
        existing.response = payload.response
        existing.is_flagged = payload.is_flagged
        existing.version = payload.version
        existing.saved_at = now
        saved = existing
    else:
        saved = Answer(
            attempt_id=attempt.id,
            question_id=question_id,
            response=payload.response,
            is_flagged=payload.is_flagged,
            version=payload.version,
            saved_at=now,
        )
        db.add(saved)

    attempt.last_seen_at = now
    for attempt_num in range(5):
        try:
            await db.commit()
            break
        except Exception as exc:  # noqa: BLE001 - retry transient SQLite write locks
            if "locked" in str(exc).lower() and attempt_num < 4:
                await asyncio.sleep(0.02 * (2**attempt_num))
            else:
                raise

    # Count answered questions to push live progress to the invigilator board.
    question_kinds = dict(
        (await db.execute(select(Question.id, Question.kind).where(Question.exam_id == exam.id))).all()
    )
    all_answers = (
        await db.execute(select(Answer.question_id, Answer.response).where(Answer.attempt_id == attempt.id))
    ).all()
    answered_count = sum(1 for qid, resp in all_answers if is_response_answered(question_kinds.get(qid, "mcq_single"), resp))

    redis_store.publish_in_background(
        exam_channel(exam.id),
        "answer_saved",
        candidate_id=candidate.id,
        attempt_id=attempt.id,
        answered_count=answered_count,
    )

    return AnswerSaveResponse(
        question_id=question_id,
        version=saved.version,
        saved_at=as_utc(saved.saved_at),
        accepted=True,
    )


@router.post("/attempts/{attempt_id}/submit", response_model=SubmitResult)
async def submit_attempt(
    attempt_id: str,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    attempt, exam = await _load_owned_attempt(attempt_id, candidate, db)
    await finalize_attempt(attempt, submit_reason="manual", db=db)
    await db.commit()

    question_kinds = dict(
        (await db.execute(select(Question.id, Question.kind).where(Question.exam_id == exam.id))).all()
    )
    answers = (
        await db.execute(select(Answer.question_id, Answer.response).where(Answer.attempt_id == attempt.id))
    ).all()
    answered_count = sum(1 for qid, resp in answers if is_response_answered(question_kinds.get(qid, "mcq_single"), resp))

    results_visible = exam.results_published or exam.show_results_immediately
    return SubmitResult(
        attempt_id=attempt.id,
        receipt_id=attempt.receipt_id,
        status="submitted",
        submitted_at=as_utc(attempt.submitted_at),
        submit_reason=attempt.submit_reason or "manual",
        answered_count=answered_count,
        total_questions=len(attempt.question_order or []),
        results_visible=results_visible,
        score=attempt.score if results_visible else None,
        max_score=attempt.max_score,
    )


@router.post("/attempts/{attempt_id}/events", response_model=ProctoringEventResponse)
async def record_proctoring_event(
    attempt_id: str,
    payload: ProctoringEventRequest,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    await enforce_rate_limit(f"events:{attempt_id}", limit=60, window_seconds=60)
    attempt, exam = await _load_owned_attempt(attempt_id, candidate, db)

    if attempt.status != "in_progress":
        return ProctoringEventResponse(
            violation_count=attempt.violation_count,
            max_violations=exam.max_violations,
            auto_submitted=(attempt.status == "submitted"),
            message="Attempt is no longer in progress.",
        )

    counted = payload.kind not in WARNING_ONLY_EVENTS
    db.add(
        ProctoringEvent(
            attempt_id=attempt.id,
            kind=payload.kind,
            detail=payload.detail,
            counted_as_violation=counted,
        )
    )
    if counted:
        attempt.violation_count += 1

    auto_submitted = False
    if counted and attempt.violation_count >= exam.max_violations:
        auto_submitted = True
        await finalize_attempt(attempt, submit_reason="violations", db=db)
        message = f"Maximum violations ({exam.max_violations}/{exam.max_violations}) reached. Exam automatically submitted."
    elif counted:
        message = f"Integrity event recorded ({attempt.violation_count}/{exam.max_violations})."
    else:
        message = "Action blocked and logged for invigilator review."

    await db.commit()

    redis_store.publish_in_background(
        exam_channel(exam.id),
        "proctoring_event",
        candidate_id=candidate.id,
        attempt_id=attempt.id,
        candidate_code=candidate.candidate_code,
        kind=payload.kind,
        violation_count=attempt.violation_count,
    )
    return ProctoringEventResponse(
        violation_count=attempt.violation_count,
        max_violations=exam.max_violations,
        auto_submitted=auto_submitted,
        message=message,
    )


@router.post("/attempts/{attempt_id}/snapshots", status_code=status.HTTP_204_NO_CONTENT)
async def upload_snapshot(
    attempt_id: str,
    image: UploadFile = File(...),
    reason: str = Form(default="periodic"),
    face_count: int = Form(default=0),
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    await enforce_rate_limit(f"snap:{attempt_id}", limit=6, window_seconds=60)
    attempt, exam = await _load_owned_attempt(attempt_id, candidate, db)
    if attempt.status != "in_progress":
        raise HTTPException(status.HTTP_409_CONFLICT, "Attempt is no longer in progress.")

    raw_bytes = await image.read()
    clean_reason = "violation" if reason == "violation" else "periodic"

    snapshot = Snapshot(attempt_id=attempt.id, reason=clean_reason, face_count=max(0, min(face_count, 20)))
    db.add(snapshot)
    await db.flush()
    save_jpeg_snapshot(snapshot.id, raw_bytes)
    await db.commit()

    redis_store.publish_in_background(
        exam_channel(exam.id),
        "snapshot_uploaded",
        candidate_id=candidate.id,
        attempt_id=attempt.id,
        snapshot_id=snapshot.id,
    )


@router.post("/attempts/{attempt_id}/code/run", response_model=CodeRunResult)
async def run_candidate_code(
    attempt_id: str,
    payload: CodeRunRequest,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    await enforce_rate_limit(f"code:{attempt_id}", limit=10, window_seconds=60)
    attempt, exam = await _load_owned_attempt(attempt_id, candidate, db)

    if attempt.status != "in_progress":
        raise HTTPException(status.HTTP_409_CONFLICT, "Attempt is no longer in progress.")

    now = utc_now()
    if effective_exam_status(exam, now) == "paused":
        raise HTTPException(status.HTTP_423_LOCKED, "Exam is currently paused.")
    if now > as_utc(attempt.deadline) + timedelta(seconds=EXPIRY_GRACE_SECONDS):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Examination time has expired.")

    question = (
        await db.execute(
            select(Question).where(Question.id == payload.question_id, Question.exam_id == exam.id)
        )
    ).scalar_one_or_none()
    if question is None or question.kind != "coding" or not question.coding:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Question is not a coding question.")

    spec = question.coding
    if payload.language not in spec.get("languages", []):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Language '{payload.language}' is not allowed.")

    sample_cases = [CodingTestCase(**case) for case in spec.get("sample_tests", [])]
    return await execute_code(
        language=payload.language,
        code=payload.code,
        test_cases=None if payload.custom_input is not None else sample_cases,
        custom_input=payload.custom_input,
        time_limit_ms=int(spec.get("time_limit_ms", 2000)),
        memory_limit_mb=int(spec.get("memory_limit_mb", 256)),
    )


@router.get("/attempts/{attempt_id}/result", response_model=ResultView)
async def get_candidate_result(
    attempt_id: str,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    attempt, exam = await _load_owned_attempt(attempt_id, candidate, db)
    if attempt.status != "submitted":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Results are only available after submission.")

    if not (exam.results_published or exam.show_results_immediately):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Results have not been published yet.")

    questions = (await db.execute(select(Question).where(Question.exam_id == exam.id))).scalars().all()
    q_by_id = {q.id: q for q in questions}
    answers = (await db.execute(select(Answer).where(Answer.attempt_id == attempt.id))).scalars().all()
    ans_by_q = {a.question_id: a for a in answers}

    items: list[ResultQuestionView] = []
    for position, q_id in enumerate(attempt.question_order or [], start=1):
        question = q_by_id.get(q_id)
        if question is None:
            continue
        answer = ans_by_q.get(q_id)
        items.append(
            ResultQuestionView(
                question_id=question.id,
                position=position,
                kind=question.kind,
                prompt=question.prompt,
                options=[QuestionOption(**opt) for opt in (question.options or [])],
                response=answer.response if answer else None,
                correct_answer=question.correct_answer,
                awarded_marks=answer.awarded_marks if answer else 0.0,
                max_marks=question.marks,
                is_correct=answer.is_correct if answer else False,
                explanation=question.explanation,
                feedback=answer.feedback if answer else None,
            )
        )

    score = float(attempt.score or 0.0)
    max_score = float(attempt.max_score or 0.0)
    percentage = round((score / max_score) * 100, 1) if max_score > 0 else 0.0
    return ResultView(
        attempt_id=attempt.id,
        exam_title=exam.title,
        score=score,
        max_score=max_score,
        percentage=percentage,
        submitted_at=as_utc(attempt.submitted_at),
        grading_pending=attempt.grading_pending,
        questions=items,
    )

