from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import Candidate, ExaminationSession, Submission, Examination
from app.schemas import SubmitResponse
from app.routers.deps import get_current_candidate
from app.services.exam_service import ExamService

router = APIRouter(prefix="/api/sessions/{session_id}", tags=["Submissions"])

@router.post("/submit", response_model=SubmitResponse)
async def submit_exam(
    session_id: str,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db)
):
    result = await ExamService.submit_exam_idempotent(session_id, candidate, db)
    return SubmitResponse(**result)

@router.get("/submission", response_model=SubmitResponse)
async def get_submission(
    session_id: str,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(ExaminationSession).where(
        ExaminationSession.id == session_id,
        ExaminationSession.candidate_id == candidate.id
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    if not session or session.status != "submitted":
        raise HTTPException(status_code=404, detail="No submission found for this session")

    sub_result = await db.execute(select(Submission).where(Submission.session_id == session_id))
    sub = sub_result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission record missing")

    exam_result = await db.execute(select(Examination).where(Examination.id == session.examination_id))
    exam = exam_result.scalar_one()

    return SubmitResponse(
        session_id=session_id,
        status="submitted",
        submitted_at=sub.submitted_at,
        score=sub.score,
        total_marks=exam.total_marks,
        correct_count=sub.correct_count,
        incorrect_count=sub.incorrect_count,
        unanswered_count=sub.unanswered_count,
        message="Examination submitted"
    )
