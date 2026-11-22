"""Routes for Marks Export Center (XLSX/CSV/JSON), Feedback Forms, Question Bank, Regrade Appeals, Candidate Transcript, and System Telemetry."""
import shutil
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.audit import client_ip_from_request, record_audit
from app.core.clock import as_utc, utc_now
from app.core.dependencies import get_current_candidate, require_roles
from app.core.redis_store import redis_store
from app.database import get_db
from app.models import (
    Answer,
    Attempt,
    Candidate,
    Exam,
    ExamFeedback,
    Question,
    QuestionBankItem,
    RegradeRequest,
    User,
)
from app.schemas.exams import CodingSpec, QuestionOption
from app.schemas.extras import (
    CandidateTranscriptOut,
    FeedbackItemOut,
    FeedbackSubmitRequest,
    FeedbackSummaryResponse,
    QuestionBankCreateRequest,
    QuestionBankItemOut,
    RegradeCreateRequest,
    RegradeOut,
    RegradeResolveRequest,
    TranscriptExamEntry,
)
from app.services.marks_export import (
    PASS_THRESHOLD_PERCENT,
    build_consolidated_marks_xlsx,
    build_exam_marks_dataset,
    compute_letter_grade,
    render_exam_csv,
    render_exam_xlsx,
)
from app.services.scoring import recalculate_attempt_score

router = APIRouter(prefix="/api", tags=["Reports, Feedback & Question Bank"])


async def _get_exam_or_404(exam_id: str, db: AsyncSession) -> Exam:
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found.")
    return exam


# --- Marks Export Center ---

@router.get("/admin/exams/{exam_id}/export/marks.xlsx")
async def export_exam_marks_xlsx(
    exam_id: str,
    batch_id: str | None = Query(default=None),
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    exam = await _get_exam_or_404(exam_id, db)
    dataset = await build_exam_marks_dataset(exam, db, batch_id=batch_id)
    xlsx_bytes = render_exam_xlsx(dataset)
    filename = f"marks-{exam.id[:8]}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/admin/exams/{exam_id}/export/marks.csv")
async def export_exam_marks_csv(
    exam_id: str,
    batch_id: str | None = Query(default=None),
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    exam = await _get_exam_or_404(exam_id, db)
    dataset = await build_exam_marks_dataset(exam, db, batch_id=batch_id)
    return Response(
        content=render_exam_csv(dataset),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="marks-{exam.id[:8]}.csv"'},
    )


@router.get("/admin/exams/{exam_id}/export/marks.json")
async def export_exam_marks_json(
    exam_id: str,
    batch_id: str | None = Query(default=None),
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    exam = await _get_exam_or_404(exam_id, db)
    dataset = await build_exam_marks_dataset(exam, db, batch_id=batch_id)
    return {
        "summary": dataset["summary"],
        "questions": [{"position": q.position, "kind": q.kind, "marks": q.marks} for q in dataset["questions"]],
        "records": dataset["records"],
    }


@router.get("/admin/reports/consolidated.xlsx")
async def export_consolidated_marks(
    batch_id: str | None = Query(default=None),
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    xlsx_bytes = await build_consolidated_marks_xlsx(db, batch_id=batch_id)
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="consolidated-marks.xlsx"'},
    )


# --- Post-Exam Candidate Feedback ---

@router.get("/candidate/attempts/{attempt_id}/feedback", response_model=FeedbackItemOut | None)
async def get_my_attempt_feedback(
    attempt_id: str,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    item = (
        await db.execute(
            select(ExamFeedback)
            .options(selectinload(ExamFeedback.candidate).selectinload(Candidate.user))
            .where(ExamFeedback.attempt_id == attempt_id, ExamFeedback.candidate_id == candidate.id)
        )
    ).scalar_one_or_none()
    if item is None:
        return None
    return _feedback_to_out(item)


@router.post("/candidate/attempts/{attempt_id}/feedback", response_model=FeedbackItemOut, status_code=status.HTTP_201_CREATED)
async def submit_attempt_feedback(
    attempt_id: str,
    payload: FeedbackSubmitRequest,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    attempt = (
        await db.execute(
            select(Attempt).where(Attempt.id == attempt_id, Attempt.candidate_id == candidate.id)
        )
    ).scalar_one_or_none()
    if attempt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found.")
    if attempt.status != "submitted":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Feedback can only be submitted after finishing the exam.")

    existing = (
        await db.execute(select(ExamFeedback).where(ExamFeedback.attempt_id == attempt.id))
    ).scalar_one_or_none()
    if existing is not None:
        existing.overall_rating = payload.overall_rating
        existing.difficulty = payload.difficulty
        existing.clarity_rating = payload.clarity_rating
        existing.platform_rating = payload.platform_rating
        existing.comments = payload.comments.strip() if payload.comments else None
        existing.flagged_question_id = payload.flagged_question_id or None
        feedback = existing
    else:
        feedback = ExamFeedback(
            exam_id=attempt.exam_id,
            attempt_id=attempt.id,
            candidate_id=candidate.id,
            overall_rating=payload.overall_rating,
            difficulty=payload.difficulty,
            clarity_rating=payload.clarity_rating,
            platform_rating=payload.platform_rating,
            comments=payload.comments.strip() if payload.comments else None,
            flagged_question_id=payload.flagged_question_id or None,
        )
        db.add(feedback)

    await db.commit()
    await db.refresh(feedback)
    feedback.candidate = candidate
    return _feedback_to_out(feedback)


def _feedback_to_out(item: ExamFeedback) -> FeedbackItemOut:
    return FeedbackItemOut(
        id=item.id,
        exam_id=item.exam_id,
        attempt_id=item.attempt_id,
        candidate_code=item.candidate.candidate_code,
        candidate_name=item.candidate.user.full_name,
        overall_rating=item.overall_rating,
        difficulty=item.difficulty,
        clarity_rating=item.clarity_rating,
        platform_rating=item.platform_rating,
        comments=item.comments,
        flagged_question_id=item.flagged_question_id,
        created_at=as_utc(item.created_at),
    )


def _summarize_feedback(items: list[ExamFeedback]) -> FeedbackSummaryResponse:
    total = len(items)
    diff_counts = Counter(item.difficulty for item in items)
    return FeedbackSummaryResponse(
        total_responses=total,
        avg_overall=round(sum(i.overall_rating for i in items) / total, 2) if total else 0.0,
        avg_clarity=round(sum(i.clarity_rating for i in items) / total, 2) if total else 0.0,
        avg_platform=round(sum(i.platform_rating for i in items) / total, 2) if total else 0.0,
        difficulty_counts={k: diff_counts.get(k, 0) for k in ("too_easy", "just_right", "challenging", "too_hard")},
        items=[_feedback_to_out(item) for item in items],
    )


@router.get("/admin/exams/{exam_id}/feedback", response_model=FeedbackSummaryResponse)
async def get_exam_feedback(
    exam_id: str,
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    await _get_exam_or_404(exam_id, db)
    items = (
        await db.execute(
            select(ExamFeedback)
            .options(selectinload(ExamFeedback.candidate).selectinload(Candidate.user))
            .where(ExamFeedback.exam_id == exam_id)
            .order_by(ExamFeedback.created_at.desc())
        )
    ).scalars().all()
    return _summarize_feedback(list(items))


@router.get("/admin/feedback/overview", response_model=FeedbackSummaryResponse)
async def get_all_feedback(
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    items = (
        await db.execute(
            select(ExamFeedback)
            .options(selectinload(ExamFeedback.candidate).selectinload(Candidate.user))
            .order_by(ExamFeedback.created_at.desc())
            .limit(200)
        )
    ).scalars().all()
    return _summarize_feedback(list(items))


# --- Reusable Question Bank ---

def _bank_to_out(item: QuestionBankItem) -> QuestionBankItemOut:
    return QuestionBankItemOut(
        id=item.id,
        title=item.title,
        subject=item.subject,
        difficulty=item.difficulty,
        tags=item.tags or [],
        kind=item.kind,
        prompt=item.prompt,
        options=[QuestionOption(**o) for o in (item.options or [])],
        correct_answer=item.correct_answer,
        marks=item.marks,
        negative_marks=item.negative_marks,
        explanation=item.explanation,
        numeric_tolerance=item.numeric_tolerance,
        coding=CodingSpec(**item.coding) if item.coding else None,
        created_at=as_utc(item.created_at),
    )


@router.get("/admin/question-bank", response_model=list[QuestionBankItemOut])
async def list_question_bank(
    search: str = Query(default="", max_length=100),
    subject: str | None = Query(default=None),
    difficulty: str | None = Query(default=None),
    kind: str | None = Query(default=None),
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    filters = []
    if search.strip():
        pat = f"%{search.strip()}%"
        filters.append(or_(QuestionBankItem.title.ilike(pat), QuestionBankItem.prompt.ilike(pat), QuestionBankItem.subject.ilike(pat)))
    if subject:
        filters.append(QuestionBankItem.subject == subject)
    if difficulty:
        filters.append(QuestionBankItem.difficulty == difficulty)
    if kind:
        filters.append(QuestionBankItem.kind == kind)

    items = (
        await db.execute(select(QuestionBankItem).where(*filters).order_by(QuestionBankItem.created_at.desc()).limit(200))
    ).scalars().all()
    return [_bank_to_out(item) for item in items]


@router.post("/admin/question-bank", response_model=QuestionBankItemOut, status_code=status.HTTP_201_CREATED)
async def create_question_bank_item(
    payload: QuestionBankCreateRequest,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    item = QuestionBankItem(
        title=payload.title.strip(),
        subject=payload.subject.strip(),
        difficulty=payload.difficulty,
        tags=[tag.strip() for tag in payload.tags if tag.strip()],
        kind=payload.kind,
        prompt=payload.prompt.strip(),
        options=[o.model_dump() for o in payload.options],
        correct_answer=payload.correct_answer,
        marks=payload.marks,
        negative_marks=payload.negative_marks,
        explanation=payload.explanation,
        numeric_tolerance=payload.numeric_tolerance,
        coding=payload.coding.model_dump() if payload.coding else None,
        created_by=admin.id,
    )
    db.add(item)
    await db.flush()
    record_audit(
        db,
        actor_id=admin.id,
        action="question_bank.created",
        target_type="question_bank",
        target_id=item.id,
        details={"title": item.title, "subject": item.subject},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return _bank_to_out(item)


@router.delete("/admin/question-bank/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question_bank_item(
    item_id: str,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    item = (await db.execute(select(QuestionBankItem).where(QuestionBankItem.id == item_id))).scalar_one_or_none()
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question bank item not found.")
    await db.delete(item)
    await db.commit()


# --- Regrade / Appeal Tickets ---

def _regrade_to_out(req: RegradeRequest, current_marks: float | None) -> RegradeOut:
    return RegradeOut(
        id=req.id,
        exam_id=req.exam_id,
        attempt_id=req.attempt_id,
        answer_id=req.answer_id,
        question_id=req.question_id,
        question_position=req.question.position,
        question_prompt=req.question.prompt[:180],
        candidate_code=req.candidate.candidate_code,
        candidate_name=req.candidate.user.full_name,
        current_marks=current_marks,
        max_marks=req.question.marks,
        reason=req.reason,
        status=req.status,
        resolution_note=req.resolution_note,
        created_at=as_utc(req.created_at),
        resolved_at=as_utc(req.resolved_at),
    )


@router.post("/candidate/attempts/{attempt_id}/regrades", response_model=RegradeOut, status_code=status.HTTP_201_CREATED)
async def create_regrade_request(
    attempt_id: str,
    payload: RegradeCreateRequest,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    attempt = (
        await db.execute(select(Attempt).where(Attempt.id == attempt_id, Attempt.candidate_id == candidate.id))
    ).scalar_one_or_none()
    if attempt is None or attempt.status != "submitted":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Regrade requests require a submitted attempt.")

    answer = (
        await db.execute(
            select(Answer).where(Answer.attempt_id == attempt.id, Answer.question_id == payload.question_id)
        )
    ).scalar_one_or_none()
    question = (
        await db.execute(select(Question).where(Question.id == payload.question_id, Question.exam_id == attempt.exam_id))
    ).scalar_one_or_none()
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found.")
    if answer is None:
        answer = Answer(attempt_id=attempt.id, question_id=question.id, response=None, version=1)
        db.add(answer)
        await db.flush()

    existing_open = (
        await db.execute(
            select(RegradeRequest.id).where(
                RegradeRequest.attempt_id == attempt.id,
                RegradeRequest.question_id == question.id,
                RegradeRequest.status == "open",
            )
        )
    ).scalar_one_or_none()
    if existing_open:
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have an open regrade request for this question.")

    regrade = RegradeRequest(
        exam_id=attempt.exam_id,
        attempt_id=attempt.id,
        answer_id=answer.id,
        candidate_id=candidate.id,
        question_id=question.id,
        reason=payload.reason.strip(),
        status="open",
    )
    db.add(regrade)
    await db.commit()
    await db.refresh(regrade)
    regrade.candidate = candidate
    regrade.question = question
    return _regrade_to_out(regrade, answer.awarded_marks)


@router.get("/candidate/attempts/{attempt_id}/regrades", response_model=list[RegradeOut])
async def list_my_regrades(
    attempt_id: str,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(RegradeRequest, Answer.awarded_marks)
            .join(Answer, Answer.id == RegradeRequest.answer_id)
            .options(
                selectinload(RegradeRequest.candidate).selectinload(Candidate.user),
                selectinload(RegradeRequest.question),
            )
            .where(RegradeRequest.attempt_id == attempt_id, RegradeRequest.candidate_id == candidate.id)
            .order_by(RegradeRequest.created_at.desc())
        )
    ).all()
    return [_regrade_to_out(req, marks) for req, marks in rows]


@router.get("/admin/exams/{exam_id}/regrades", response_model=list[RegradeOut])
async def list_exam_regrades(
    exam_id: str,
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    await _get_exam_or_404(exam_id, db)
    rows = (
        await db.execute(
            select(RegradeRequest, Answer.awarded_marks)
            .join(Answer, Answer.id == RegradeRequest.answer_id)
            .options(
                selectinload(RegradeRequest.candidate).selectinload(Candidate.user),
                selectinload(RegradeRequest.question),
            )
            .where(RegradeRequest.exam_id == exam_id)
            .order_by(RegradeRequest.status.desc(), RegradeRequest.created_at.desc())
        )
    ).all()
    return [_regrade_to_out(req, marks) for req, marks in rows]


@router.post("/admin/regrades/{regrade_id}/resolve", response_model=RegradeOut)
async def resolve_regrade_request(
    regrade_id: str,
    payload: RegradeResolveRequest,
    request: Request,
    staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    regrade = (
        await db.execute(
            select(RegradeRequest)
            .options(
                selectinload(RegradeRequest.candidate).selectinload(Candidate.user),
                selectinload(RegradeRequest.question),
            )
            .where(RegradeRequest.id == regrade_id)
        )
    ).scalar_one_or_none()
    if regrade is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Regrade request not found.")

    answer = (await db.execute(select(Answer).where(Answer.id == regrade.answer_id))).scalar_one()
    attempt = (await db.execute(select(Attempt).where(Attempt.id == regrade.attempt_id))).scalar_one()

    if payload.status == "approved" and payload.new_marks is not None:
        if payload.new_marks > regrade.question.marks:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"Marks cannot exceed max marks ({regrade.question.marks}).",
            )
        answer.awarded_marks = round(payload.new_marks, 2)
        answer.is_correct = answer.awarded_marks >= (regrade.question.marks * 0.5)
        if payload.resolution_note:
            answer.feedback = payload.resolution_note.strip()
        await recalculate_attempt_score(attempt, db)

    regrade.status = payload.status
    regrade.resolution_note = payload.resolution_note.strip() if payload.resolution_note else None
    regrade.resolved_by = staff.id
    regrade.resolved_at = utc_now()

    record_audit(
        db,
        actor_id=staff.id,
        action="regrade.resolved",
        target_type="regrade_request",
        target_id=regrade.id,
        details={"status": payload.status, "new_marks": payload.new_marks},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return _regrade_to_out(regrade, answer.awarded_marks)


# --- Candidate Performance Transcript ---

@router.get("/candidate/transcript", response_model=CandidateTranscriptOut)
async def get_candidate_transcript(
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Attempt, Exam)
            .join(Exam, Exam.id == Attempt.exam_id)
            .where(Attempt.candidate_id == candidate.id, Attempt.status == "submitted")
            .order_by(Attempt.submitted_at.desc())
        )
    ).all()

    feedback_attempt_ids = set(
        (
            await db.execute(select(ExamFeedback.attempt_id).where(ExamFeedback.candidate_id == candidate.id))
        ).scalars().all()
    )

    entries: list[TranscriptExamEntry] = []
    percentages: list[float] = []
    pass_count = 0

    for attempt, exam in rows:
        if not (exam.results_published or exam.show_results_immediately):
            continue
        score = float(attempt.score or 0.0)
        max_score = float(attempt.max_score or 0.0)
        pct = round((score / max_score) * 100, 1) if max_score > 0 else 0.0
        passed = pct >= PASS_THRESHOLD_PERCENT
        if passed:
            pass_count += 1
        percentages.append(pct)
        entries.append(
            TranscriptExamEntry(
                attempt_id=attempt.id,
                exam_id=exam.id,
                exam_title=exam.title,
                score=score,
                max_score=max_score,
                percentage=pct,
                grade=compute_letter_grade(pct),
                passed=passed,
                submitted_at=as_utc(attempt.submitted_at),
                feedback_submitted=(attempt.id in feedback_attempt_ids),
            )
        )

    return CandidateTranscriptOut(
        candidate_code=candidate.candidate_code,
        full_name=candidate.user.full_name,
        batch_name=candidate.batch.name if candidate.batch else None,
        exams_completed=len(entries),
        average_percentage=round(sum(percentages) / len(percentages), 1) if percentages else 0.0,
        highest_percentage=max(percentages) if percentages else 0.0,
        pass_count=pass_count,
        entries=entries,
    )


# --- Admin System Telemetry ---

@router.get("/admin/system-status")
async def get_system_status(
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    open_regrades = (
        await db.execute(select(func.count(RegradeRequest.id)).where(RegradeRequest.status == "open"))
    ).scalar() or 0
    bank_count = (await db.execute(select(func.count(QuestionBankItem.id)))).scalar() or 0
    feedback_count = (await db.execute(select(func.count(ExamFeedback.id)))).scalar() or 0

    return {
        "instance_id": settings.instance_id,
        "database_engine": "SQLite WAL" if settings.is_sqlite else "PostgreSQL",
        "redis_mode": "In-memory fallback" if redis_store.is_fake else "Live Redis / Valkey",
        "sandbox_available": bool(shutil.which("bwrap")),
        "compilers": {
            "python": bool(shutil.which("python3")),
            "c": bool(shutil.which("gcc")),
            "cpp": bool(shutil.which("g++")),
            "java": bool(shutil.which("javac") and shutil.which("java")),
            "javascript": bool(shutil.which("node")),
        },
        "counts": {
            "open_regrades": int(open_regrades),
            "question_bank": int(bank_count),
            "feedback_responses": int(feedback_count),
        },
    }
