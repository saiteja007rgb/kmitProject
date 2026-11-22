"""Admin routes for exam authoring, lifecycle controls, question import, and candidate enrollments."""
from datetime import timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import client_ip_from_request, record_audit
from app.core.clock import as_utc, utc_now
from app.core.dependencies import require_roles
from app.core.redis_store import attempt_channel, redis_store
from app.database import get_db
from app.models import Attempt, Candidate, Enrollment, Exam, Question, User
from app.schemas.exams import (
    CodingSpec,
    EnrollmentCreateRequest,
    EnrollmentCreateResponse,
    EnrollmentItem,
    EnrollmentUpdateRequest,
    ExamDetail,
    ExamInput,
    ExamSummary,
    ExtendExamResponse,
    ExtendTimeRequest,
    LifecycleActionRequest,
    QuestionAdmin,
    QuestionImportResponse,
    QuestionInput,
    QuestionOption,
    ResultsPublishRequest,
)
from app.services.exam_lifecycle import (
    apply_exam_lifecycle_action,
    build_exam_summaries,
    exam_settings_from_model,
    extend_in_progress_attempts,
)
from app.services.question_import import parse_question_file

router = APIRouter(prefix="/api/admin", tags=["Admin: Exams & Enrollments"])

MAX_QUESTION_FILE_BYTES = 2 * 1024 * 1024


def _question_to_admin(question: Question) -> QuestionAdmin:
    return QuestionAdmin(
        id=question.id,
        position=question.position,
        kind=question.kind,
        prompt=question.prompt,
        options=[QuestionOption(**opt) for opt in (question.options or [])],
        correct_answer=question.correct_answer,
        marks=question.marks,
        negative_marks=question.negative_marks,
        explanation=question.explanation,
        numeric_tolerance=question.numeric_tolerance,
        coding=CodingSpec(**question.coding) if question.coding else None,
    )


def _build_question_model(exam_id: str, position: int, item: QuestionInput, default_neg_factor: float) -> Question:
    if item.kind in ("theory", "coding"):
        neg_marks = 0.0
    elif item.negative_marks is not None:
        neg_marks = item.negative_marks
    else:
        neg_marks = round(item.marks * default_neg_factor, 2)

    return Question(
        exam_id=exam_id,
        position=position,
        kind=item.kind,
        prompt=item.prompt.strip(),
        options=[option.model_dump() for option in item.options],
        correct_answer=item.correct_answer,
        marks=item.marks,
        negative_marks=neg_marks,
        explanation=item.explanation,
        numeric_tolerance=item.numeric_tolerance,
        coding=item.coding.model_dump() if item.coding else None,
    )


async def _exam_to_detail(exam: Exam, db: AsyncSession) -> ExamDetail:
    summary = (await build_exam_summaries([exam], db))[0]
    questions = (
        await db.execute(select(Question).where(Question.exam_id == exam.id).order_by(Question.position.asc()))
    ).scalars().all()
    return ExamDetail(
        **summary.model_dump(),
        instructions=exam.instructions,
        settings=exam_settings_from_model(exam),
        questions=[_question_to_admin(question) for question in questions],
    )


async def _get_exam_or_404(exam_id: str, db: AsyncSession) -> Exam:
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found.")
    return exam


@router.get("/exams", response_model=list[ExamSummary])
async def list_exams(
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    exams = (await db.execute(select(Exam).order_by(Exam.created_at.desc()))).scalars().all()
    return await build_exam_summaries(exams, db)


@router.post("/exams", response_model=ExamDetail, status_code=status.HTTP_201_CREATED)
async def create_exam(
    payload: ExamInput,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    cfg = payload.settings
    exam = Exam(
        title=payload.title.strip(),
        description=payload.description,
        instructions=payload.instructions,
        starts_at=as_utc(payload.starts_at),
        ends_at=as_utc(payload.ends_at),
        duration_minutes=payload.duration_minutes,
        lifecycle_state="draft",
        shuffle_questions=cfg.shuffle_questions,
        shuffle_options=cfg.shuffle_options,
        negative_marking=cfg.negative_marking,
        max_violations=cfg.max_violations,
        require_webcam=cfg.require_webcam,
        require_fullscreen=cfg.require_fullscreen,
        show_results_immediately=cfg.show_results_immediately,
        created_by=admin.id,
    )
    db.add(exam)
    await db.flush()

    for position, question_in in enumerate(payload.questions, start=1):
        db.add(_build_question_model(exam.id, position, question_in, cfg.negative_marking))

    record_audit(
        db,
        actor_id=admin.id,
        action="exam.created",
        target_type="exam",
        target_id=exam.id,
        details={"title": exam.title, "questions": len(payload.questions)},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return await _exam_to_detail(exam, db)


@router.get("/exams/{exam_id}", response_model=ExamDetail)
async def get_exam_detail(
    exam_id: str,
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    exam = await _get_exam_or_404(exam_id, db)
    return await _exam_to_detail(exam, db)


def _question_signature(item: Question | QuestionInput) -> tuple:
    if isinstance(item, Question):
        return (item.kind, item.prompt, item.options, item.correct_answer, item.marks, item.coding)
    return (
        item.kind,
        item.prompt.strip(),
        [option.model_dump() for option in item.options],
        item.correct_answer,
        item.marks,
        item.coding.model_dump() if item.coding else None,
    )


@router.put("/exams/{exam_id}", response_model=ExamDetail)
async def update_exam(
    exam_id: str,
    payload: ExamInput,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    exam = await _get_exam_or_404(exam_id, db)
    existing_questions = (
        await db.execute(select(Question).where(Question.exam_id == exam.id).order_by(Question.position.asc()))
    ).scalars().all()

    has_attempts = (
        await db.execute(select(Attempt.id).where(Attempt.exam_id == exam.id).limit(1))
    ).scalar_one_or_none()

    questions_changed = [_question_signature(q) for q in existing_questions] != [
        _question_signature(q) for q in payload.questions
    ]
    if has_attempts and questions_changed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Questions cannot be modified after candidates have started this exam.",
        )

    cfg = payload.settings
    exam.title = payload.title.strip()
    exam.description = payload.description
    exam.instructions = payload.instructions
    exam.starts_at = as_utc(payload.starts_at)
    exam.ends_at = as_utc(payload.ends_at)
    exam.duration_minutes = payload.duration_minutes
    exam.shuffle_questions = cfg.shuffle_questions
    exam.shuffle_options = cfg.shuffle_options
    exam.negative_marking = cfg.negative_marking
    exam.max_violations = cfg.max_violations
    exam.require_webcam = cfg.require_webcam
    exam.require_fullscreen = cfg.require_fullscreen
    exam.show_results_immediately = cfg.show_results_immediately

    if not has_attempts:
        for old_question in existing_questions:
            await db.delete(old_question)
        await db.flush()
        for position, question_in in enumerate(payload.questions, start=1):
            db.add(_build_question_model(exam.id, position, question_in, cfg.negative_marking))

    record_audit(
        db,
        actor_id=admin.id,
        action="exam.updated",
        target_type="exam",
        target_id=exam.id,
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return await _exam_to_detail(exam, db)


@router.post("/exams/{exam_id}/duplicate", response_model=ExamDetail, status_code=status.HTTP_201_CREATED)
async def duplicate_exam(
    exam_id: str,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    source = await _get_exam_or_404(exam_id, db)
    source_questions = (
        await db.execute(select(Question).where(Question.exam_id == source.id).order_by(Question.position.asc()))
    ).scalars().all()

    clone = Exam(
        title=f"{source.title} (Copy)"[:200],
        description=source.description,
        instructions=source.instructions,
        starts_at=source.starts_at,
        ends_at=source.ends_at,
        duration_minutes=source.duration_minutes,
        lifecycle_state="draft",
        shuffle_questions=source.shuffle_questions,
        shuffle_options=source.shuffle_options,
        negative_marking=source.negative_marking,
        max_violations=source.max_violations,
        require_webcam=source.require_webcam,
        require_fullscreen=source.require_fullscreen,
        show_results_immediately=source.show_results_immediately,
        created_by=admin.id,
    )
    db.add(clone)
    await db.flush()

    for q in source_questions:
        db.add(
            Question(
                exam_id=clone.id,
                position=q.position,
                kind=q.kind,
                prompt=q.prompt,
                options=q.options,
                correct_answer=q.correct_answer,
                marks=q.marks,
                negative_marks=q.negative_marks,
                explanation=q.explanation,
                numeric_tolerance=q.numeric_tolerance,
                coding=q.coding,
            )
        )

    record_audit(
        db,
        actor_id=admin.id,
        action="exam.duplicated",
        target_type="exam",
        target_id=clone.id,
        details={"source_exam_id": source.id},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return await _exam_to_detail(clone, db)


@router.delete("/exams/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_exam(
    exam_id: str,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    exam = await _get_exam_or_404(exam_id, db)
    has_attempts = (
        await db.execute(select(Attempt.id).where(Attempt.exam_id == exam.id).limit(1))
    ).scalar_one_or_none()
    if has_attempts:
        raise HTTPException(status.HTTP_409_CONFLICT, "Exams with candidate attempts cannot be deleted.")

    title = exam.title
    await db.delete(exam)
    record_audit(
        db,
        actor_id=admin.id,
        action="exam.deleted",
        target_type="exam",
        target_id=exam_id,
        details={"title": title},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()


@router.post("/exams/{exam_id}/lifecycle", response_model=ExamSummary)
async def change_exam_lifecycle(
    exam_id: str,
    payload: LifecycleActionRequest,
    request: Request,
    staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    exam = await _get_exam_or_404(exam_id, db)
    new_status = await apply_exam_lifecycle_action(exam, payload.action, db)
    record_audit(
        db,
        actor_id=staff.id,
        action=f"exam.{payload.action}",
        target_type="exam",
        target_id=exam.id,
        details={"effective_status": new_status},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return (await build_exam_summaries([exam], db))[0]


@router.post("/exams/{exam_id}/results", response_model=ExamSummary)
async def set_results_published(
    exam_id: str,
    payload: ResultsPublishRequest,
    request: Request,
    staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    exam = await _get_exam_or_404(exam_id, db)
    exam.results_published = payload.published
    record_audit(
        db,
        actor_id=staff.id,
        action="exam.results_visibility_changed",
        target_type="exam",
        target_id=exam.id,
        details={"published": payload.published},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return (await build_exam_summaries([exam], db))[0]


@router.post("/exams/{exam_id}/extend", response_model=ExtendExamResponse)
async def extend_exam_all_attempts(
    exam_id: str,
    payload: ExtendTimeRequest,
    request: Request,
    staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    exam = await _get_exam_or_404(exam_id, db)
    extended = await extend_in_progress_attempts(exam.id, payload.minutes * 60, db)
    record_audit(
        db,
        actor_id=staff.id,
        action="exam.extended_all",
        target_type="exam",
        target_id=exam.id,
        details={"minutes": payload.minutes, "sessions_extended": extended},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return ExtendExamResponse(sessions_extended=extended)


@router.post("/questions/import", response_model=QuestionImportResponse)
async def import_questions_preview(
    file: UploadFile = File(...),
    _admin: User = Depends(require_roles("admin")),
):
    content = await file.read()
    if len(content) > MAX_QUESTION_FILE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Question file must be 2 MB or smaller.")

    filename = file.filename or "questions.txt"
    try:
        questions = parse_question_file(filename, content)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not parse '{filename}': {exc}") from exc

    if not questions:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No questions were detected. Supported formats: .txt, .csv, .xlsx.",
        )

    return QuestionImportResponse(
        questions=questions,
        message=f"Detected {len(questions)} question(s) from '{filename}'. Review before saving.",
    )


@router.get("/exams/{exam_id}/enrollments", response_model=list[EnrollmentItem])
async def list_enrollments(
    exam_id: str,
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    await _get_exam_or_404(exam_id, db)
    rows = (
        await db.execute(
            select(Enrollment, Candidate, Attempt)
            .join(Candidate, Candidate.id == Enrollment.candidate_id)
            .outerjoin(
                Attempt,
                (Attempt.candidate_id == Enrollment.candidate_id) & (Attempt.exam_id == Enrollment.exam_id),
            )
            .options(selectinload(Candidate.user), selectinload(Candidate.batch))
            .where(Enrollment.exam_id == exam_id)
            .order_by(Candidate.candidate_code.asc())
        )
    ).all()

    return [
        EnrollmentItem(
            candidate_id=candidate.id,
            candidate_code=candidate.candidate_code,
            full_name=candidate.user.full_name,
            batch_name=candidate.batch.name if candidate.batch else None,
            extra_minutes=enrollment.extra_minutes,
            attempt_status=attempt.status if attempt else "not_started",
        )
        for enrollment, candidate, attempt in rows
    ]


@router.post("/exams/{exam_id}/enrollments", response_model=EnrollmentCreateResponse)
async def add_enrollments(
    exam_id: str,
    payload: EnrollmentCreateRequest,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    await _get_exam_or_404(exam_id, db)

    target_candidate_ids = set(payload.candidate_ids)
    if payload.batch_ids:
        batch_candidates = (
            await db.execute(
                select(Candidate.id)
                .join(User, User.id == Candidate.user_id)
                .where(Candidate.batch_id.in_(payload.batch_ids), User.is_active.is_(True))
            )
        ).scalars().all()
        target_candidate_ids.update(batch_candidates)

    if not target_candidate_ids:
        return EnrollmentCreateResponse(added=0, already_enrolled=0)

    valid_ids = set(
        (await db.execute(select(Candidate.id).where(Candidate.id.in_(list(target_candidate_ids))))).scalars().all()
    )
    existing_ids = set(
        (
            await db.execute(
                select(Enrollment.candidate_id).where(
                    Enrollment.exam_id == exam_id,
                    Enrollment.candidate_id.in_(list(valid_ids)),
                )
            )
        ).scalars().all()
    )

    to_add = valid_ids - existing_ids
    for candidate_id in to_add:
        db.add(Enrollment(exam_id=exam_id, candidate_id=candidate_id))

    record_audit(
        db,
        actor_id=admin.id,
        action="exam.candidates_enrolled",
        target_type="exam",
        target_id=exam_id,
        details={"added": len(to_add), "already_enrolled": len(existing_ids)},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return EnrollmentCreateResponse(added=len(to_add), already_enrolled=len(existing_ids))


@router.patch("/exams/{exam_id}/enrollments/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def update_enrollment_accommodation(
    exam_id: str,
    candidate_id: str,
    payload: EnrollmentUpdateRequest,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    enrollment = (
        await db.execute(
            select(Enrollment).where(Enrollment.exam_id == exam_id, Enrollment.candidate_id == candidate_id)
        )
    ).scalar_one_or_none()
    if enrollment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment not found.")

    delta_minutes = payload.extra_minutes - enrollment.extra_minutes
    enrollment.extra_minutes = payload.extra_minutes

    # If the candidate is currently sitting the exam, apply the accommodation live.
    if delta_minutes != 0:
        active_attempt = (
            await db.execute(
                select(Attempt).where(
                    Attempt.exam_id == exam_id,
                    Attempt.candidate_id == candidate_id,
                    Attempt.status == "in_progress",
                )
            )
        ).scalar_one_or_none()
        if active_attempt is not None:
            active_attempt.deadline = as_utc(active_attempt.deadline) + timedelta(minutes=delta_minutes)
            remaining = max(0, int((as_utc(active_attempt.deadline) - utc_now()).total_seconds()))
            redis_store.publish_in_background(
                attempt_channel(active_attempt.id),
                "deadline_changed",
                deadline=as_utc(active_attempt.deadline).isoformat(),
                remaining_seconds=remaining,
            )

    record_audit(
        db,
        actor_id=admin.id,
        action="exam.enrollment_updated",
        target_type="exam",
        target_id=exam_id,
        details={"candidate_id": candidate_id, "extra_minutes": payload.extra_minutes},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()


@router.delete("/exams/{exam_id}/enrollments/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_enrollment(
    exam_id: str,
    candidate_id: str,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    enrollment = (
        await db.execute(
            select(Enrollment).where(Enrollment.exam_id == exam_id, Enrollment.candidate_id == candidate_id)
        )
    ).scalar_one_or_none()
    if enrollment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment not found.")

    has_attempt = (
        await db.execute(
            select(Attempt.id).where(Attempt.exam_id == exam_id, Attempt.candidate_id == candidate_id).limit(1)
        )
    ).scalar_one_or_none()
    if has_attempt:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cannot unenroll a candidate who has already started.")

    await db.delete(enrollment)
    record_audit(
        db,
        actor_id=admin.id,
        action="exam.candidate_unenrolled",
        target_type="exam",
        target_id=exam_id,
        details={"candidate_id": candidate_id},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
