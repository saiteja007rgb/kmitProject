"""Authoritative server-side scoring, idempotent submission, and expired-attempt auto-submission."""
import hashlib
import logging
import re
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import as_utc, utc_now
from app.core.redis_store import attempt_channel, exam_channel, redis_store
from app.database import SessionFactory
from app.models import Answer, Attempt, Exam, Question
from app.schemas.exams import CodingTestCase
from app.services.code_sandbox import execute_code
from app.services.exam_lifecycle import effective_exam_status

logger = logging.getLogger("exampulse.scoring")
EXPIRY_GRACE_SECONDS = 10


def is_response_answered(kind: str, response: object) -> bool:
    if response is None:
        return False
    if kind == "mcq_multi":
        return isinstance(response, list) and len(response) > 0
    if kind == "coding":
        return isinstance(response, dict) and bool(str(response.get("code", "")).strip())
    return str(response).strip() != ""


def _normalize_short_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def evaluate_objective_answer(question: Question, response: object) -> tuple[bool, float]:
    """Scores objective questions synchronously. Returns (is_correct, awarded_marks)."""
    if not is_response_answered(question.kind, response):
        return False, 0.0

    correct = False
    if question.kind in ("mcq_single", "true_false"):
        correct = str(response).strip().upper() == str(question.correct_answer or "").strip().upper()
    elif question.kind == "mcq_multi":
        expected = {str(item).strip().upper() for item in (question.correct_answer or [])}
        chosen = {str(item).strip().upper() for item in (response if isinstance(response, list) else [])}
        correct = bool(expected) and chosen == expected
    elif question.kind == "numeric":
        try:
            chosen_num = float(str(response).strip())
            expected_num = float(str(question.correct_answer).strip())
            correct = abs(chosen_num - expected_num) <= (question.numeric_tolerance or 0.0) + 1e-9
        except (TypeError, ValueError):
            correct = False
    elif question.kind == "short_text":
        correct = _normalize_short_text(str(response)) == _normalize_short_text(str(question.correct_answer or ""))

    if correct:
        return True, float(question.marks)
    return False, -abs(float(question.negative_marks or 0.0))


async def evaluate_coding_answer(question: Question, response: object) -> tuple[bool, float, dict]:
    """Runs candidate code against all sample + hidden test cases and awards proportional marks."""
    spec = question.coding or {}
    if not isinstance(response, dict) or not str(response.get("code", "")).strip():
        return False, 0.0, {"passed": 0, "total": 0}

    language = response.get("language")
    allowed = spec.get("languages", [])
    if language not in allowed:
        return False, 0.0, {"error": f"Language '{language}' is not allowed for this question."}

    raw_cases = (spec.get("sample_tests") or []) + (spec.get("hidden_tests") or [])
    cases = [CodingTestCase(**case) for case in raw_cases]
    if not cases:
        return False, 0.0, {"passed": 0, "total": 0}

    run_result = await execute_code(
        language=language,
        code=str(response["code"]),
        test_cases=cases,
        time_limit_ms=int(spec.get("time_limit_ms", 2000)),
        memory_limit_mb=int(spec.get("memory_limit_mb", 256)),
    )
    if run_result.status == "compile_error":
        return False, 0.0, {"compile_error": run_result.compile_output, "passed": 0, "total": len(cases)}

    passed = sum(1 for item in run_result.results if item.verdict == "passed")
    total = len(cases)
    earned = round(float(question.marks) * (passed / total), 2) if total else 0.0
    summary = {
        "passed": passed,
        "total": total,
        "verdicts": [item.verdict for item in run_result.results],
    }
    return passed == total, earned, summary


def make_receipt_id(attempt_id: str) -> str:
    digest = hashlib.sha256(attempt_id.encode("utf-8")).hexdigest()[:8].upper()
    return f"EP-{digest}"


async def finalize_attempt(attempt: Attempt, submit_reason: str, db: AsyncSession) -> Attempt:
    """Idempotently grades and finalizes an attempt. Safe to call repeatedly."""
    if attempt.status == "submitted":
        return attempt

    questions = (
        await db.execute(select(Question).where(Question.exam_id == attempt.exam_id))
    ).scalars().all()
    answers = (
        await db.execute(select(Answer).where(Answer.attempt_id == attempt.id))
    ).scalars().all()
    answers_by_question = {answer.question_id: answer for answer in answers}

    total_score = 0.0
    max_score = sum(float(question.marks) for question in questions)
    grading_pending = False

    for question in questions:
        answer = answers_by_question.get(question.id)
        if answer is None:
            continue

        if question.kind == "theory":
            if is_response_answered("theory", answer.response):
                # Theory answers require manual review; preserve any marks already awarded.
                if answer.awarded_marks is None:
                    grading_pending = True
                else:
                    total_score += float(answer.awarded_marks)
            else:
                answer.awarded_marks = 0.0
                answer.is_correct = False
        elif question.kind == "coding":
            is_correct, earned, evaluation = await evaluate_coding_answer(question, answer.response)
            answer.is_correct = is_correct
            answer.awarded_marks = earned
            answer.evaluation = evaluation
            total_score += earned
        else:
            is_correct, earned = evaluate_objective_answer(question, answer.response)
            answer.is_correct = is_correct
            answer.awarded_marks = earned
            total_score += earned

    now = utc_now()
    attempt.status = "submitted"
    attempt.submitted_at = now
    attempt.submit_reason = submit_reason
    attempt.receipt_id = attempt.receipt_id or make_receipt_id(attempt.id)
    attempt.score = max(0.0, round(total_score, 2))
    attempt.max_score = round(max_score, 2)
    attempt.grading_pending = grading_pending

    await db.flush()

    payload = {
        "candidate_id": attempt.candidate_id,
        "attempt_id": attempt.id,
        "submit_reason": submit_reason,
        "score": attempt.score,
    }
    redis_store.publish_in_background(exam_channel(attempt.exam_id), "attempt_submitted", **payload)
    redis_store.publish_in_background(attempt_channel(attempt.id), "attempt_submitted", **payload)
    return attempt


async def recalculate_attempt_score(attempt: Attempt, db: AsyncSession) -> float:
    """Recomputes total score and `grading_pending` after an invigilator grades a theory answer."""
    rows = (
        await db.execute(
            select(Answer, Question)
            .join(Question, Question.id == Answer.question_id)
            .where(Answer.attempt_id == attempt.id)
        )
    ).all()

    total_score = 0.0
    grading_pending = False
    for answer, question in rows:
        if answer.awarded_marks is not None:
            total_score += float(answer.awarded_marks)
        elif question.kind == "theory" and is_response_answered("theory", answer.response):
            grading_pending = True

    attempt.score = max(0.0, round(total_score, 2))
    attempt.grading_pending = grading_pending
    await db.flush()
    return attempt.score


async def sweep_expired_attempts_once() -> int:
    """Auto-submits attempts whose deadline (+ grace) has passed while their exam is not paused."""
    now = utc_now()
    cutoff = now - timedelta(seconds=EXPIRY_GRACE_SECONDS)
    async with SessionFactory() as db:
        rows = (
            await db.execute(
                select(Attempt, Exam)
                .join(Exam, Exam.id == Attempt.exam_id)
                .where(Attempt.status == "in_progress", Attempt.deadline < cutoff)
            )
        ).all()

        finalized = 0
        for attempt, exam in rows:
            if effective_exam_status(exam, now) == "paused":
                continue
            await finalize_attempt(attempt, submit_reason="timeout", db=db)
            finalized += 1

        if finalized:
            await db.commit()
            logger.info("Auto-submitted %d expired attempt(s).", finalized)
        return finalized

