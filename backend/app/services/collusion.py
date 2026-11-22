"""Statistical collusion detection based on identical wrong-answer coincidence across candidates."""
from collections import defaultdict

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Answer, Attempt, CollusionFlag, Question
from app.services.scoring import is_response_answered

OBJECTIVE_KINDS = ("mcq_single", "true_false", "mcq_multi")


def _canonical_choice(kind: str, value: object) -> str | None:
    if not is_response_answered(kind, value):
        return None
    if kind == "mcq_multi" and isinstance(value, list):
        return ",".join(sorted(str(item).strip().upper() for item in value))
    return str(value).strip().upper()


async def run_collusion_scan(
    exam_id: str,
    db: AsyncSession,
    similarity_threshold: float = 0.75,
) -> list[CollusionFlag]:
    """Finds pairs of candidates with statistically implausible matching wrong answers."""
    questions = (
        await db.execute(
            select(Question)
            .where(Question.exam_id == exam_id, Question.kind.in_(OBJECTIVE_KINDS))
        )
    ).scalars().all()
    if len(questions) < 3:
        await db.execute(delete(CollusionFlag).where(CollusionFlag.exam_id == exam_id))
        await db.commit()
        return []

    question_by_id = {question.id: question for question in questions}
    correct_by_id = {
        question.id: _canonical_choice(question.kind, question.correct_answer)
        for question in questions
    }

    attempts = (
        await db.execute(select(Attempt.id, Attempt.candidate_id).where(Attempt.exam_id == exam_id))
    ).all()
    if len(attempts) < 2:
        await db.execute(delete(CollusionFlag).where(CollusionFlag.exam_id == exam_id))
        await db.commit()
        return []

    candidate_by_attempt = {attempt_id: candidate_id for attempt_id, candidate_id in attempts}
    answer_rows = (
        await db.execute(
            select(Answer.attempt_id, Answer.question_id, Answer.response)
            .where(
                Answer.attempt_id.in_(list(candidate_by_attempt.keys())),
                Answer.question_id.in_(list(question_by_id.keys())),
            )
        )
    ).all()

    choices_by_candidate: dict[str, dict[str, str]] = defaultdict(dict)
    for attempt_id, question_id, response in answer_rows:
        canonical = _canonical_choice(question_by_id[question_id].kind, response)
        if canonical is not None:
            choices_by_candidate[candidate_by_attempt[attempt_id]][question_id] = canonical

    candidate_ids = list(choices_by_candidate.keys())
    min_common = min(5, len(questions))
    flags: list[CollusionFlag] = []

    for index_a in range(len(candidate_ids)):
        for index_b in range(index_a + 1, len(candidate_ids)):
            candidate_a = candidate_ids[index_a]
            candidate_b = candidate_ids[index_b]
            answers_a = choices_by_candidate[candidate_a]
            answers_b = choices_by_candidate[candidate_b]

            common_ids = answers_a.keys() & answers_b.keys()
            if len(common_ids) < min_common:
                continue

            matching_total = 0
            shared_wrong: list[dict] = []
            for question_id in common_ids:
                if answers_a[question_id] != answers_b[question_id]:
                    continue
                matching_total += 1
                expected = correct_by_id[question_id]
                if answers_a[question_id] != expected:
                    shared_wrong.append(
                        {
                            "question_position": question_by_id[question_id].position,
                            "question_id": question_id,
                            "shared_wrong_option": answers_a[question_id],
                            "correct_option": expected,
                        }
                    )

            matching_incorrect = len(shared_wrong)
            raw_similarity = matching_total / len(common_ids)
            # Identical correct answers are expected among prepared students; shared wrong answers carry the signal.
            wrong_weight = min(1.0, matching_incorrect * 0.18)
            weighted_score = round(min(1.0, raw_similarity * 0.65 + wrong_weight * 0.35), 3)

            if matching_incorrect < 2 and weighted_score < similarity_threshold:
                continue
            if matching_incorrect == 0:
                continue

            if weighted_score >= 0.90 or matching_incorrect >= 4:
                risk_level = "critical"
            elif weighted_score >= 0.80 or matching_incorrect >= 3:
                risk_level = "high"
            else:
                risk_level = "medium"

            # Under 3 distractors, probability two independent wrong guesses match on k questions is (1/3)^k.
            coincidence = (1 / 3) ** matching_incorrect
            flags.append(
                CollusionFlag(
                    exam_id=exam_id,
                    candidate_a_id=candidate_a,
                    candidate_b_id=candidate_b,
                    similarity_score=weighted_score,
                    risk_level=risk_level,
                    reason=(
                        f"{matching_total}/{len(common_ids)} identical answers with "
                        f"{matching_incorrect} shared wrong choice(s)."
                    ),
                    evidence={
                        "total_compared": len(common_ids),
                        "matching_total": matching_total,
                        "matching_incorrect_count": matching_incorrect,
                        "raw_similarity_pct": round(raw_similarity * 100, 1),
                        "coincidence_probability": "< 0.001" if coincidence < 0.001 else f"{coincidence:.3f}",
                        "shared_wrong_questions": sorted(shared_wrong, key=lambda item: item["question_position"]),
                    },
                )
            )

    await db.execute(delete(CollusionFlag).where(CollusionFlag.exam_id == exam_id))
    db.add_all(flags)
    await db.commit()
    return flags
