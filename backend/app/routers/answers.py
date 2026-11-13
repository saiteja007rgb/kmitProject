from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List
from app.database import get_db
from app.models import Answer, Candidate, ExaminationSession
from app.schemas import AnswerUpdateRequest, AnswerSavedResponse, AnswerItem
from app.routers.deps import get_current_candidate
from app.services.exam_service import ExamService

router = APIRouter(prefix="/api/sessions/{session_id}/answers", tags=["Answers"])

@router.get("", response_model=List[AnswerItem])
async def get_answers(
    session_id: str,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db)
):
    # Verify session belongs to candidate
    sess_result = await db.execute(
        select(ExaminationSession).where(
            ExaminationSession.id == session_id,
            ExaminationSession.candidate_id == candidate.id
        )
    )
    if not sess_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Session not found")

    ans_result = await db.execute(
        select(Answer).where(Answer.session_id == session_id)
    )
    answers = ans_result.scalars().all()

    return [
        AnswerItem(
            question_id=a.question_id,
            selected_answer=a.selected_answer,
            is_marked_for_review=a.is_marked_for_review,
            version=a.version,
            updated_at=a.updated_at
        )
        for a in answers
    ]

@router.put("/{question_id}", response_model=AnswerSavedResponse)
async def save_answer(
    session_id: str,
    question_id: str,
    req: AnswerUpdateRequest,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db)
):
    answer = await ExamService.save_answer_durable(
        session_id=session_id,
        question_id=question_id,
        selected_answer=req.selected_answer,
        is_marked_for_review=bool(req.is_marked_for_review),
        version=req.version,
        candidate=candidate,
        db=db
    )

    return AnswerSavedResponse(
        status="saved",
        question_id=answer.question_id,
        selected_answer=answer.selected_answer,
        is_marked_for_review=answer.is_marked_for_review,
        version=answer.version,
        updated_at=answer.updated_at
    )

@router.delete("/{question_id}", response_model=AnswerSavedResponse)
async def clear_answer(
    session_id: str,
    question_id: str,
    version: int = 1,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db)
):
    # Clearing answer sets selected_answer to None
    answer = await ExamService.save_answer_durable(
        session_id=session_id,
        question_id=question_id,
        selected_answer=None,
        is_marked_for_review=False,
        version=version,
        candidate=candidate,
        db=db
    )
    return AnswerSavedResponse(
        status="saved",
        question_id=answer.question_id,
        selected_answer=None,
        is_marked_for_review=False,
        version=answer.version,
        updated_at=answer.updated_at
    )
