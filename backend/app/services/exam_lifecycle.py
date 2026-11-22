"""Exam effective status computation, lifecycle transitions, summary queries, and deterministic shuffling."""
import hashlib
import random
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import as_utc, utc_now
from app.core.redis_store import attempt_channel, exam_channel, redis_store
from app.models import Attempt, Enrollment, Exam, Question
from app.schemas.exams import ExamSettings, ExamStatus, ExamSummary, LifecycleAction


def effective_exam_status(exam: Exam, now: datetime | None = None) -> ExamStatus:
    """Computes real-time exam status from stored admin decision plus wall-clock window."""
    current = now or utc_now()
    if exam.lifecycle_state == "draft":
        return "draft"
    if exam.lifecycle_state == "ended":
        return "ended"
    if exam.lifecycle_state == "paused":
        return "paused"

    starts_at = as_utc(exam.starts_at)
    ends_at = as_utc(exam.ends_at)
    if current < starts_at:
        return "scheduled"
    if current >= ends_at:
        return "ended"
    return "live"


def exam_settings_from_model(exam: Exam) -> ExamSettings:
    return ExamSettings(
        shuffle_questions=exam.shuffle_questions,
        shuffle_options=exam.shuffle_options,
        negative_marking=exam.negative_marking,
        max_violations=exam.max_violations,
        require_webcam=exam.require_webcam,
        require_fullscreen=exam.require_fullscreen,
        show_results_immediately=exam.show_results_immediately,
    )


async def build_exam_summaries(exams: list[Exam], db: AsyncSession) -> list[ExamSummary]:
    """Builds summaries for any number of exams in 3 aggregate queries (never N+1)."""
    if not exams:
        return []
    exam_ids = [exam.id for exam in exams]

    question_agg = (
        await db.execute(
            select(Question.exam_id, func.count(Question.id), func.coalesce(func.sum(Question.marks), 0.0))
            .where(Question.exam_id.in_(exam_ids))
            .group_by(Question.exam_id)
        )
    ).all()
    question_stats = {row[0]: (int(row[1]), float(row[2])) for row in question_agg}

    enrollment_agg = (
        await db.execute(
            select(Enrollment.exam_id, func.count(Enrollment.id))
            .where(Enrollment.exam_id.in_(exam_ids))
            .group_by(Enrollment.exam_id)
        )
    ).all()
    enrollment_counts = {row[0]: int(row[1]) for row in enrollment_agg}

    attempt_agg = (
        await db.execute(
            select(Attempt.exam_id, Attempt.status, func.count(Attempt.id))
            .where(Attempt.exam_id.in_(exam_ids))
            .group_by(Attempt.exam_id, Attempt.status)
        )
    ).all()
    attempt_counts: dict[tuple[str, str], int] = {(row[0], row[1]): int(row[2]) for row in attempt_agg}

    now = utc_now()
    summaries: list[ExamSummary] = []
    for exam in exams:
        question_count, total_marks = question_stats.get(exam.id, (0, 0.0))
        summaries.append(
            ExamSummary(
                id=exam.id,
                title=exam.title,
                description=exam.description,
                status=effective_exam_status(exam, now),
                starts_at=as_utc(exam.starts_at),
                ends_at=as_utc(exam.ends_at),
                duration_minutes=exam.duration_minutes,
                question_count=question_count,
                total_marks=round(total_marks, 2),
                enrolled_count=enrollment_counts.get(exam.id, 0),
                in_progress_count=attempt_counts.get((exam.id, "in_progress"), 0),
                submitted_count=attempt_counts.get((exam.id, "submitted"), 0),
                results_published=exam.results_published,
                created_at=as_utc(exam.created_at),
            )
        )
    return summaries


def generate_attempt_order(
    questions: list[Question],
    candidate_id: str,
    exam: Exam,
) -> tuple[list[str], dict[str, list[str]]]:
    """Deterministic per-candidate shuffle seeded by SHA-256(candidate_id:exam_id)."""
    seed_hex = hashlib.sha256(f"{candidate_id}:{exam.id}".encode("utf-8")).hexdigest()
    rng = random.Random(int(seed_hex[:16], 16))

    question_ids = [question.id for question in questions]
    if exam.shuffle_questions:
        rng.shuffle(question_ids)

    option_order: dict[str, list[str]] = {}
    for question in questions:
        if question.kind in ("mcq_single", "mcq_multi") and question.options:
            option_ids = [option["id"] for option in question.options]
            if exam.shuffle_options:
                option_rng = random.Random(int(hashlib.sha256(f"{seed_hex}:{question.id}".encode()).hexdigest()[:16], 16))
                option_rng.shuffle(option_ids)
            option_order[question.id] = option_ids

    return question_ids, option_order


async def extend_in_progress_attempts(exam_id: str, extra_seconds: int, db: AsyncSession) -> int:
    """Shifts every running attempt's deadline forward and notifies those candidates live."""
    attempts = (
        await db.execute(
            select(Attempt).where(Attempt.exam_id == exam_id, Attempt.status == "in_progress")
        )
    ).scalars().all()
    if not attempts:
        return 0

    now = utc_now()
    delta = timedelta(seconds=extra_seconds)
    for attempt in attempts:
        attempt.deadline = as_utc(attempt.deadline) + delta

    await db.flush()
    for attempt in attempts:
        remaining = max(0, int((as_utc(attempt.deadline) - now).total_seconds()))
        redis_store.publish_in_background(
            attempt_channel(attempt.id),
            "deadline_changed",
            deadline=as_utc(attempt.deadline).isoformat(),
            remaining_seconds=remaining,
        )
    return len(attempts)


async def apply_exam_lifecycle_action(exam: Exam, action: LifecycleAction, db: AsyncSession) -> ExamStatus:
    """Transitions an exam between draft, published (scheduled/live), paused, and ended."""
    from app.services.scoring import finalize_attempt  # local import avoids circular dependency

    now = utc_now()
    current = effective_exam_status(exam, now)

    if action == "publish":
        if exam.lifecycle_state != "draft":
            raise HTTPException(status.HTTP_409_CONFLICT, f"Cannot publish an exam in '{current}' state.")
        exam.lifecycle_state = "published"
    elif action == "pause":
        if current != "live":
            raise HTTPException(status.HTTP_409_CONFLICT, "Only a live exam can be paused.")
        exam.lifecycle_state = "paused"
        exam.paused_at = now
    elif action == "resume":
        if exam.lifecycle_state != "paused":
            raise HTTPException(status.HTTP_409_CONFLICT, "Only a paused exam can be resumed.")
        paused_seconds = max(0, int((now - as_utc(exam.paused_at)).total_seconds())) if exam.paused_at else 0
        exam.lifecycle_state = "published"
        exam.paused_at = None
        if paused_seconds > 0:
            exam.ends_at = as_utc(exam.ends_at) + timedelta(seconds=paused_seconds)
            await extend_in_progress_attempts(exam.id, paused_seconds, db)
    elif action == "end":
        if current == "ended":
            return "ended"
        exam.lifecycle_state = "ended"
        exam.paused_at = None
        in_progress = (
            await db.execute(
                select(Attempt).where(Attempt.exam_id == exam.id, Attempt.status == "in_progress")
            )
        ).scalars().all()
        for attempt in in_progress:
            await finalize_attempt(attempt, submit_reason="exam_ended", db=db)

    await db.commit()
    new_status = effective_exam_status(exam, now)
    redis_store.publish_in_background(exam_channel(exam.id), "exam_status_changed", exam_id=exam.id, status=new_status)
    return new_status
