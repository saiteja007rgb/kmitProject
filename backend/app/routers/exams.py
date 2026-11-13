from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from datetime import datetime, timezone, timedelta
from app.database import get_db
from app.models import (
    Examination, ExaminationSession, Candidate, User, Question,
    ProctoringViolation, Answer, Submission
)
from app.schemas import (
    ExamListItem, ExamStartResponse, SessionStatusResponse, CandidateQuestion,
    QuestionOption, ExamCreateRequest, ViolationLogRequest, ViolationLogResponse,
    SolutionQuestionItem, SolutionReviewResponse
)
from app.routers.deps import get_current_user, get_current_candidate, require_roles
from app.services.exam_service import ExamService
from app.redis_client import redis_manager

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

@router.post("/exams", response_model=ExamListItem)
async def create_exam(
    req: ExamCreateRequest,
    user: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db)
):
    now = utc_now()
    duration_secs = req.duration_minutes * 60
    end_time = now + timedelta(days=30)
    total_marks = sum(q.marks for q in req.questions)

    exam = Examination(
        title=req.title,
        description=req.description,
        duration_seconds=duration_secs,
        start_time=now,
        end_time=end_time,
        total_marks=total_marks,
        negative_mark_factor=req.negative_marking,
        status="active"
    )
    db.add(exam)
    await db.flush()

    for idx, q_req in enumerate(req.questions):
        q = Question(
            examination_id=exam.id,
            question_text=q_req.question_text,
            options=[opt.model_dump() for opt in q_req.options],
            correct_answer=q_req.correct_answer.strip().upper(),
            marks=q_req.marks,
            negative_marks=q_req.negative_marks or (q_req.marks * req.negative_marking),
            order_index=idx,
            explanation=q_req.explanation
        )
        db.add(q)

    await db.commit()
    await db.refresh(exam)

    return ExamListItem(
        id=exam.id,
        title=exam.title,
        description=exam.description,
        duration_seconds=exam.duration_seconds,
        start_time=exam.start_time,
        end_time=exam.end_time,
        total_marks=exam.total_marks,
        status=exam.status
    )

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

@router.post("/sessions/{session_id}/violations", response_model=ViolationLogResponse)
async def log_violation(
    session_id: str,
    req: ViolationLogRequest,
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

    if session.status != "in_progress":
        return ViolationLogResponse(
            status="ignored",
            violation_count=session.violation_count or 0,
            max_violations=3,
            auto_submitted=(session.status == "submitted"),
            message="Session is no longer in progress."
        )

    session.violation_count = (session.violation_count or 0) + 1
    violation = ProctoringViolation(
        session_id=session.id,
        violation_type=req.violation_type,
        details=req.details
    )
    db.add(violation)

    auto_sub = False
    now = utc_now()

    # Publish live event to Redis pub/sub bus
    await redis_manager.publish_event(f"exam:{session.examination_id}:events", {
        "type": "proctoring_violation",
        "session_id": session.id,
        "candidate_id": candidate.id,
        "candidate_code": candidate.candidate_code,
        "display_name": candidate.display_name,
        "violation_type": req.violation_type,
        "violation_count": session.violation_count,
        "max_violations": 3,
        "timestamp": now.isoformat()
    })

    msg = f"Security violation recorded ({session.violation_count}/3)."
    if session.violation_count >= 3:
        auto_sub = True
        await ExamService.submit_exam_idempotent(session.id, candidate, db)
        msg = "Maximum security violations (3/3) exceeded. Examination automatically submitted."

    await db.commit()

    return ViolationLogResponse(
        status="logged",
        violation_count=session.violation_count,
        max_violations=3,
        auto_submitted=auto_sub,
        message=msg
    )

@router.get("/sessions/{session_id}/review", response_model=SolutionReviewResponse)
async def get_solution_review(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(ExaminationSession).where(ExaminationSession.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if user.role == "candidate":
        cand_res = await db.execute(select(Candidate).where(Candidate.user_id == user.id))
        cand = cand_res.scalar_one_or_none()
        if not cand or session.candidate_id != cand.id:
            raise HTTPException(status_code=403, detail="Forbidden")

    if session.status not in ["submitted", "expired"]:
        raise HTTPException(status_code=400, detail="Solutions are only available after examination submission.")

    exam = (await db.execute(select(Examination).where(Examination.id == session.examination_id))).scalar_one()
    q_result = await db.execute(select(Question).where(Question.examination_id == session.examination_id))
    questions_by_id = {q.id: q for q in q_result.scalars().all()}

    ans_result = await db.execute(select(Answer).where(Answer.session_id == session.id))
    answers_by_qid = {a.question_id: a.selected_answer for a in ans_result.scalars().all()}

    sub_result = await db.execute(select(Submission).where(Submission.session_id == session.id))
    submission = sub_result.scalar_one_or_none()

    review_questions = []
    correct_count = 0
    incorrect_count = 0
    unanswered_count = 0
    total_score = 0.0

    for idx, q_id in enumerate(session.question_order):
        if q_id not in questions_by_id:
            continue
        q = questions_by_id[q_id]
        sel = answers_by_qid.get(q_id)
        is_corr = False
        earned = 0.0

        if sel is None or str(sel).strip() == "":
            unanswered_count += 1
            earned = 0.0
        elif str(sel).strip().upper() == q.correct_answer.strip().upper():
            is_corr = True
            correct_count += 1
            earned = q.marks
            total_score += earned
        else:
            incorrect_count += 1
            earned = -abs(q.negative_marks or 0.0)
            total_score += earned

        review_questions.append(SolutionQuestionItem(
            id=q.id,
            order=idx + 1,
            question_text=q.question_text,
            options=[QuestionOption(id=opt["id"], text=opt["text"]) for opt in q.options],
            selected_answer=sel,
            correct_answer=q.correct_answer,
            is_correct=is_corr,
            marks_earned=earned,
            explanation=q.explanation
        ))

    final_score = submission.score if submission else max(0.0, total_score)

    return SolutionReviewResponse(
        session_id=session.id,
        examination_id=exam.id,
        exam_title=exam.title,
        score=final_score,
        total_marks=exam.total_marks,
        correct_count=submission.correct_count if submission else correct_count,
        incorrect_count=submission.incorrect_count if submission else incorrect_count,
        unanswered_count=submission.unanswered_count if submission else unanswered_count,
        questions=review_questions
    )
