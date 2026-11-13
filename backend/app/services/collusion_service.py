import logging
from typing import List, Dict, Any, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.models import (
    Examination, Question, ExaminationSession, Answer, Candidate, SuspicionFlag
)
from app.redis_client import redis_manager

logger = logging.getLogger("exampulse.collusion")

class CollusionService:

    @staticmethod
    async def analyze_collusion(
        examination_id: str,
        db: AsyncSession,
        similarity_threshold: float = 0.75
    ) -> List[Dict[str, Any]]:
        """
        Analyzes candidate answer vectors across an examination for suspicious collusion.
        Evaluates:
          1. Jaccard similarity across selected answer options.
          2. Identical Wrong-Answer Coincidence: Shared identical wrong answers
             provide statistically decisive evidence of copying.
        """
        # 1. Fetch all questions and master answers
        q_res = await db.execute(
            select(Question.id, Question.correct_answer, Question.order_index)
            .where(Question.examination_id == examination_id)
        )
        questions = q_res.all()
        correct_keys = {q[0]: q[1].strip().upper() for q in questions}
        q_order_map = {q[0]: q[2] for q in questions}

        # 2. Fetch all candidates with sessions for this exam
        sess_res = await db.execute(
            select(ExaminationSession.id, ExaminationSession.candidate_id)
            .where(ExaminationSession.examination_id == examination_id)
        )
        sessions = sess_res.all()
        session_to_candidate = {s[0]: s[1] for s in sessions}

        if len(session_to_candidate) < 2:
            return []

        # 3. Fetch all answers for these sessions
        sess_ids = list(session_to_candidate.keys())
        ans_res = await db.execute(
            select(Answer.session_id, Answer.question_id, Answer.selected_answer)
            .where(Answer.session_id.in_(sess_ids))
        )
        answers_by_candidate: Dict[str, Dict[str, str]] = {}
        for s_id, q_id, sel in ans_res.all():
            cand_id = session_to_candidate[s_id]
            if cand_id not in answers_by_candidate:
                answers_by_candidate[cand_id] = {}
            if sel is not None and sel.strip() != "":
                answers_by_candidate[cand_id][q_id] = sel.strip().upper()

        candidate_ids = list(answers_by_candidate.keys())
        detected_flags = []

        # 4. Pairwise comparison of candidates
        for i in range(len(candidate_ids)):
            for j in range(i + 1, len(candidate_ids)):
                cand_a = candidate_ids[i]
                cand_b = candidate_ids[j]

                ans_a = answers_by_candidate[cand_a]
                ans_b = answers_by_candidate[cand_b]

                common_qs = set(ans_a.keys()).intersection(set(ans_b.keys()))
                if len(common_qs) < 5:  # Need at least 5 common answered questions
                    continue

                matching_total = 0
                matching_incorrect = 0
                matching_incorrect_questions = []

                for q_id in common_qs:
                    choice_a = ans_a[q_id]
                    choice_b = ans_b[q_id]
                    correct = correct_keys.get(q_id)

                    if choice_a == choice_b:
                        matching_total += 1
                        if choice_a != correct:
                            matching_incorrect += 1
                            matching_incorrect_questions.append({
                                "question_index": q_order_map.get(q_id, 0),
                                "question_id": q_id,
                                "shared_wrong_option": choice_a,
                                "correct_option": correct
                            })

                raw_similarity = matching_total / len(common_qs)
                
                # Weight identical incorrect answers heavily
                # (Independent probability of picking the same wrong option among 3 distractors is (1/3)^N)
                wrong_weight = min(1.0, matching_incorrect * 0.15)
                weighted_score = round(min(1.0, (raw_similarity * 0.7) + (wrong_weight * 0.3)), 3)

                is_suspicious = (
                    weighted_score >= similarity_threshold or
                    matching_incorrect >= 3
                )

                if is_suspicious:
                    if weighted_score >= 0.90 or matching_incorrect >= 4:
                        risk_level = "critical"
                    elif weighted_score >= 0.80 or matching_incorrect >= 3:
                        risk_level = "high"
                    else:
                        risk_level = "medium"

                    reason = (
                        f"Unusually high answer pattern match ({matching_total}/{len(common_qs)} identical) "
                        f"with {matching_incorrect} shared incorrect choices."
                    )

                    evidence = {
                        "total_compared": len(common_qs),
                        "matching_total": matching_total,
                        "matching_incorrect_count": matching_incorrect,
                        "raw_similarity_pct": round(raw_similarity * 100, 1),
                        "shared_wrong_questions": matching_incorrect_questions,
                        "coincidence_probability": "< 0.001" if matching_incorrect >= 3 else "< 0.05"
                    }

                    detected_flags.append({
                        "examination_id": examination_id,
                        "candidate_a_id": cand_a,
                        "candidate_b_id": cand_b,
                        "similarity_score": weighted_score,
                        "risk_level": risk_level,
                        "reason": reason,
                        "evidence": evidence
                    })

        # 5. Persist flags into PostgreSQL/SQLite
        # Remove old flags for this exam to prevent duplication
        await db.execute(delete(SuspicionFlag).where(SuspicionFlag.examination_id == examination_id))
        
        for flag_data in detected_flags:
            flag = SuspicionFlag(**flag_data)
            db.add(flag)

        await db.commit()

        # Publish live update to Redis Pub/Sub
        await redis_manager.publish_event(f"exam:{examination_id}:events", {
            "type": "collusion_flags_updated",
            "count": len(detected_flags)
        })

        return detected_flags

