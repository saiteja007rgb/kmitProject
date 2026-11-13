import hashlib
import random
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.models import (
    Examination, Question, ExaminationSession, Answer, Submission, Candidate
)
from app.redis_client import redis_manager

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

def ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def generate_personalized_order(question_ids: List[str], candidate_id: str, exam_id: str) -> List[str]:
    """
    Generates a deterministic personalized question order for a candidate.
    Uses SHA-256 of candidate_id + exam_id as the random seed.
    Guarantees:
      1. Every candidate gets a unique question order.
      2. The order is 100% reproducible for the same candidate.
    """
    seed_str = f"{candidate_id}:{exam_id}"
    seed_int = int(hashlib.sha256(seed_str.encode("utf-8")).hexdigest()[:16], 16)
    shuffled = list(question_ids)
    rng = random.Random(seed_int)
    rng.shuffle(shuffled)
    return shuffled

class ExamService:

    @staticmethod
    async def get_or_create_session(
        candidate: Candidate,
        examination_id: str,
        db: AsyncSession
    ) -> ExaminationSession:
        # 1. Check for existing active session (Enforcing Single Active Session)
        stmt = select(ExaminationSession).where(
            ExaminationSession.candidate_id == candidate.id,
            ExaminationSession.examination_id == examination_id
        )
        result = await db.execute(stmt)
        session = result.scalar_one_or_none()

        if session:
            # Check deadline expiry
            now = utc_now()
            deadline = ensure_utc(session.deadline)
            if session.status == "in_progress" and now > deadline:
                session.status = "expired"
                await db.commit()
            return session

        # 2. Verify exam exists and is active
        exam_result = await db.execute(select(Examination).where(Examination.id == examination_id))
        exam = exam_result.scalar_one_or_none()
        if not exam:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Examination not found")

        # 3. Retrieve all questions for the exam
        q_result = await db.execute(
            select(Question.id)
            .where(Question.examination_id == examination_id)
            .order_by(Question.order_index)
        )
        question_ids = [row[0] for row in q_result.all()]
        if not question_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No questions configured for this exam")

        # 4. Generate deterministic personalized question order
        personalized_order = generate_personalized_order(question_ids, candidate.id, examination_id)

        # 5. Server-authoritative start time and deadline
        started_at = utc_now()
        deadline = started_at + timedelta(seconds=exam.duration_seconds)

        new_session = ExaminationSession(
            candidate_id=candidate.id,
            examination_id=examination_id,
            started_at=started_at,
            deadline=deadline,
            status="in_progress",
            question_order=personalized_order
        )

        db.add(new_session)
        await db.commit()
        await db.refresh(new_session)

        # Publish live candidate started event
        await redis_manager.publish_event(f"exam:{examination_id}:events", {
            "type": "candidate_started",
            "candidate_code": candidate.candidate_code,
            "display_name": candidate.display_name,
            "started_at": started_at.isoformat()
        })

        return new_session

    @staticmethod
    async def get_candidate_questions(
        session: ExaminationSession,
        db: AsyncSession
    ) -> List[Dict[str, Any]]:
        # Fetch questions for this examination
        stmt = select(Question).where(Question.examination_id == session.examination_id)
        result = await db.execute(stmt)
        questions_by_id = {q.id: q for q in result.scalars().all()}

        candidate_questions = []
        for idx, q_id in enumerate(session.question_order):
            if q_id in questions_by_id:
                q = questions_by_id[q_id]
                candidate_questions.append({
                    "id": q.id,
                    "question_text": q.question_text,
                    "question_type": q.question_type,
                    "options": q.options,
                    "marks": q.marks,
                    "order": idx + 1
                    # Note: correct_answer is strictly omitted!
                })

        return candidate_questions

    @staticmethod
    async def save_answer_durable(
        session_id: str,
        question_id: str,
        selected_answer: Optional[str],
        is_marked_for_review: bool,
        version: int,
        candidate: Candidate,
        db: AsyncSession
    ) -> Answer:
        # 1. Fetch and validate session
        sess_result = await db.execute(
            select(ExaminationSession).where(
                ExaminationSession.id == session_id,
                ExaminationSession.candidate_id == candidate.id
            )
        )
        session = sess_result.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Examination session not found")

        # 2. Server-authoritative timer check (10-second grace window for in-flight transit)
        now = utc_now()
        deadline = ensure_utc(session.deadline)
        grace_deadline = deadline + timedelta(seconds=10)
        if session.status != "in_progress" or now > grace_deadline:
            session.status = "expired"
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Examination time has expired. New answer changes cannot be accepted."
            )

        # 3. Check question exists in this session's exam
        if question_id not in session.question_order:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Question does not belong to this exam")

        # 4. Atomic Database UPSERT with optimistic version checking
        ans_stmt = select(Answer).where(
            Answer.session_id == session_id,
            Answer.question_id == question_id
        )
        ans_result = await db.execute(ans_stmt)
        existing_answer = ans_result.scalar_one_or_none()

        if existing_answer:
            # Stale request protection: Ignore delayed older request
            if existing_answer.version >= version:
                return existing_answer

            existing_answer.selected_answer = selected_answer
            existing_answer.is_marked_for_review = is_marked_for_review
            existing_answer.version = version
            existing_answer.updated_at = now
            final_answer = existing_answer
        else:
            new_answer = Answer(
                session_id=session_id,
                question_id=question_id,
                selected_answer=selected_answer,
                is_marked_for_review=is_marked_for_review,
                version=version,
                updated_at=now
            )
            db.add(new_answer)
            final_answer = new_answer

        # 5. Commit to PostgreSQL disk (ACID durability guarantee)
        await db.commit()
        await db.refresh(final_answer)

        # 6. Publish event to Redis Pub/Sub for invigilator dashboard
        await redis_manager.publish_event(f"exam:{session.examination_id}:events", {
            "type": "answer_saved",
            "candidate_code": candidate.candidate_code,
            "question_id": question_id,
            "is_marked": is_marked_for_review,
            "has_answer": bool(selected_answer),
            "updated_at": now.isoformat()
        })

        return final_answer

    @staticmethod
    async def submit_exam_idempotent(
        session_id: str,
        candidate: Candidate,
        db: AsyncSession
    ) -> Dict[str, Any]:
        # 1. Fetch session
        sess_result = await db.execute(
            select(ExaminationSession).where(
                ExaminationSession.id == session_id,
                ExaminationSession.candidate_id == candidate.id
            )
        )
        session = sess_result.scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

        # 2. Idempotency Check: If already submitted, return existing submission immediately!
        sub_result = await db.execute(select(Submission).where(Submission.session_id == session_id))
        sub = sub_result.scalar_one_or_none()
        if sub or session.status == "submitted":
            if not sub:
                sub_result = await db.execute(select(Submission).where(Submission.session_id == session_id))
                sub = sub_result.scalar_one_or_none()
            if sub:
                exam_result = await db.execute(select(Examination).where(Examination.id == session.examination_id))
                exam = exam_result.scalar_one()
                return {
                    "session_id": session_id,
                    "status": "submitted",
                    "submitted_at": sub.submitted_at,
                    "score": sub.score,
                    "total_marks": exam.total_marks,
                    "correct_count": sub.correct_count,
                    "incorrect_count": sub.incorrect_count,
                    "unanswered_count": sub.unanswered_count,
                    "message": "Examination was already submitted"
                }

        # 3. Load all questions for scoring
        q_result = await db.execute(select(Question).where(Question.examination_id == session.examination_id))
        questions = q_result.scalars().all()
        q_map = {q.id: q for q in questions}

        # 4. Load all candidate's answers
        ans_result = await db.execute(select(Answer).where(Answer.session_id == session_id))
        candidate_answers = {a.question_id: a.selected_answer for a in ans_result.scalars().all()}

        # 5. Authoritative server-side evaluation
        correct_count = 0
        incorrect_count = 0
        unanswered_count = 0
        total_score = 0.0

        for q_id, q in q_map.items():
            chosen = candidate_answers.get(q_id)
            if chosen is not None and chosen.strip() != "":
                if q.question_type == "theory":
                    correct_count += 1
                    total_score += q.marks
                elif chosen.strip().upper() == q.correct_answer.strip().upper():
                    correct_count += 1
                    total_score += q.marks
                else:
                    incorrect_count += 1
                    total_score -= q.negative_marks
            else:
                unanswered_count += 1

        total_score = max(0.0, round(total_score, 2))

        # 6. Save final submission in DB
        now = utc_now()
        submission = Submission(
            session_id=session_id,
            score=total_score,
            correct_count=correct_count,
            incorrect_count=incorrect_count,
            unanswered_count=unanswered_count,
            submitted_at=now
        )
        session.status = "submitted"
        session.submitted_at = now

        db.add(submission)
        await db.commit()

        # 7. Update Redis Leaderboard ZSET
        await redis_manager.update_leaderboard(session.examination_id, candidate.candidate_code, total_score)

        # 8. Publish submission event to Redis Pub/Sub
        await redis_manager.publish_event(f"exam:{session.examination_id}:events", {
            "type": "candidate_submitted",
            "candidate_code": candidate.candidate_code,
            "display_name": candidate.display_name,
            "score": total_score,
            "submitted_at": now.isoformat()
        })

        exam_result = await db.execute(select(Examination).where(Examination.id == session.examination_id))
        exam = exam_result.scalar_one()

        return {
            "session_id": session_id,
            "status": "submitted",
            "submitted_at": now,
            "score": total_score,
            "total_marks": exam.total_marks,
            "correct_count": correct_count,
            "incorrect_count": incorrect_count,
            "unanswered_count": unanswered_count,
            "message": "Examination submitted successfully"
        }
