from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from datetime import datetime, timezone
from app.database import get_db
from app.models import Examination, ExaminationSession, Candidate, User
from app.schemas import (
    ExamListItem, ExamStartResponse, SessionStatusResponse, CandidateQuestion
)
from app.routers.deps import get_current_user, get_current_candidate
from app.services.exam_service import ExamService

router = APIRouter(prefix="/api", tags=["Examinations"])

def utc_now():
    return datetime.now(timezone.utc)

@router.get("/exams", response_model=List[ExamListItem])
async def list_exams(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Examination).order_by(Examination.created_at.desc()))
    exams = result.scalars().all()
    return [
        ExamListItem(
            id=e.id,
            title=e.title,
            description=e.description,
            duration_seconds=e.duration_seconds,
            start_time=e.start_time,
            end_time=e.end_time,
            total_marks=e.total_marks,
            status=e.status
        )
        for e in exams
    ]

@router.get("/exams/{exam_id}", response_model=ExamListItem)
async def get_exam(exam_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Examination).where(Examination.id == exam_id))
    e = result.scalar_one_or_none()
    if not e:
        raise HTTPException(status_code=404, detail="Exam not found")
    return ExamListItem(
        id=e.id,
        title=e.title,
        description=e.description,
        duration_seconds=e.duration_seconds,
        start_time=e.start_time,
        end_time=e.end_time,
        total_marks=e.total_marks,
        status=e.status
    )

@router.post("/exams/{exam_id}/start", response_model=ExamStartResponse)
async def start_exam(
    exam_id: str,
    candidate: Candidate = Depends(get_current_candidate),
    db: AsyncSession = Depends(get_db)
):
    session = await ExamService.get_or_create_session(candidate, exam_id, db)
    exam_res = await db.execute(select(Examination).where(Examination.id == exam_id))
    exam = exam_res.scalar_one()

    return ExamStartResponse(
        session_id=session.id,
        examination_id=exam.id,
        title=exam.title,
        duration_seconds=exam.duration_seconds,
        started_at=session.started_at,
        deadline=session.deadline,
        status=session.status,
        total_questions=len(session.question_order)
    )

@router.get("/sessions/{session_id}", response_model=SessionStatusResponse)
async def get_session_status(
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
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    now = utc_now()
    deadline = session.deadline if session.deadline.tzinfo else session.deadline.replace(tzinfo=timezone.utc)
    remaining = int((deadline - now).total_seconds())
    if remaining < 0 and session.status == "in_progress":
        session.status = "expired"
        await db.commit()
        remaining = 0

    return SessionStatusResponse(
        session_id=session.id,
        examination_id=session.examination_id,
        candidate_id=session.candidate_id,
        status=session.status,
        started_at=session.started_at,
        deadline=session.deadline,
        server_time=now,
        remaining_seconds=max(0, remaining),
        submitted_at=session.submitted_at
    )

@router.get("/sessions/{session_id}/questions", response_model=List[CandidateQuestion])
async def get_session_questions(
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
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    questions = await ExamService.get_candidate_questions(session, db)
    return questions
