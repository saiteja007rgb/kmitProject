import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime, ForeignKey, 
    Text, UniqueConstraint, Index, JSON
)
from sqlalchemy.orm import relationship
from app.database import Base

def generate_uuid():
    return str(uuid.uuid4())

def utc_now():
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="candidate")  # candidate, invigilator, admin
    active_token = Column(String(500), nullable=True)  # Single active session token enforcement
    created_at = Column(DateTime(timezone=True), default=utc_now)

    candidate = relationship("Candidate", back_populates="user", uselist=False, cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="user")

class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    candidate_code = Column(String(30), unique=True, nullable=False, index=True)
    display_name = Column(String(100), nullable=False)

    user = relationship("User", back_populates="candidate")
    sessions = relationship("ExaminationSession", back_populates="candidate", cascade="all, delete-orphan")

class Examination(Base):
    __tablename__ = "examinations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    duration_seconds = Column(Integer, nullable=False, default=3600)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True), nullable=False)
    total_marks = Column(Float, default=0.0)
    negative_mark_factor = Column(Float, default=0.0)  # e.g., 0.25
    status = Column(String(20), default="active")  # scheduled, active, completed
    created_at = Column(DateTime(timezone=True), default=utc_now)

    questions = relationship("Question", back_populates="examination", cascade="all, delete-orphan")
    sessions = relationship("ExaminationSession", back_populates="examination", cascade="all, delete-orphan")
    suspicion_flags = relationship("SuspicionFlag", back_populates="examination", cascade="all, delete-orphan")

class Question(Base):
    __tablename__ = "questions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    examination_id = Column(String(36), ForeignKey("examinations.id", ondelete="CASCADE"), nullable=False, index=True)
    question_text = Column(Text, nullable=False)
    question_type = Column(String(20), default="mcq")
    options = Column(JSON, nullable=True, default=list)  # [{"id": "A", "text": "Option A"}, ...]
    correct_answer = Column(Text, nullable=True, default="")  # Master key or model answer for theory - NEVER exposed to candidate
    marks = Column(Float, default=1.0)
    negative_marks = Column(Float, default=0.0)
    order_index = Column(Integer, default=0)
    explanation = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)

    examination = relationship("Examination", back_populates="questions")
    answers = relationship("Answer", back_populates="question")

class ExaminationSession(Base):
    __tablename__ = "examination_sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    candidate_id = Column(String(36), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False, index=True)
    examination_id = Column(String(36), ForeignKey("examinations.id", ondelete="CASCADE"), nullable=False, index=True)
    started_at = Column(DateTime(timezone=True), default=utc_now)
    deadline = Column(DateTime(timezone=True), nullable=False)  # Authoritative server deadline
    status = Column(String(20), default="in_progress")  # in_progress, submitted, expired
    question_order = Column(JSON, nullable=False)  # Array of question IDs in personalized order
    violation_count = Column(Integer, default=0, nullable=False)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)

    __table_args__ = (
        UniqueConstraint("candidate_id", "examination_id", name="uq_candidate_examination"),
    )

    candidate = relationship("Candidate", back_populates="sessions")
    examination = relationship("Examination", back_populates="sessions")
    answers = relationship("Answer", back_populates="session", cascade="all, delete-orphan")
    submission = relationship("Submission", back_populates="session", uselist=False, cascade="all, delete-orphan")
    violations = relationship("ProctoringViolation", back_populates="session", cascade="all, delete-orphan")

class ProctoringViolation(Base):
    __tablename__ = "proctoring_violations"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(String(36), ForeignKey("examination_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    violation_type = Column(String(50), nullable=False)  # tab_switch, window_blur
    details = Column(String(255), nullable=True)
    timestamp = Column(DateTime(timezone=True), default=utc_now)

    session = relationship("ExaminationSession", back_populates="violations")

class Answer(Base):
    __tablename__ = "answers"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(String(36), ForeignKey("examination_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    question_id = Column(String(36), ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True)
    selected_answer = Column(Text, nullable=True)
    is_marked_for_review = Column(Boolean, default=False)
    version = Column(Integer, default=1, nullable=False)  # Optimistic concurrency / stale protection
    updated_at = Column(DateTime(timezone=True), default=utc_now)

    __table_args__ = (
        UniqueConstraint("session_id", "question_id", name="uq_session_question"),
    )

    session = relationship("ExaminationSession", back_populates="answers")
    question = relationship("Question", back_populates="answers")

class Submission(Base):
    __tablename__ = "submissions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(String(36), ForeignKey("examination_sessions.id", ondelete="CASCADE"), unique=True, nullable=False)
    score = Column(Float, nullable=False)
    correct_count = Column(Integer, nullable=False)
    incorrect_count = Column(Integer, nullable=False)
    unanswered_count = Column(Integer, nullable=False)
    result_data = Column(JSON, nullable=True)  # breakdown of questions & choices
    submitted_at = Column(DateTime(timezone=True), default=utc_now)

    session = relationship("ExaminationSession", back_populates="submission")

class SuspicionFlag(Base):
    __tablename__ = "suspicion_flags"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    examination_id = Column(String(36), ForeignKey("examinations.id", ondelete="CASCADE"), nullable=False, index=True)
    candidate_a_id = Column(String(36), ForeignKey("candidates.id"), nullable=False)
    candidate_b_id = Column(String(36), ForeignKey("candidates.id"), nullable=False)
    similarity_score = Column(Float, nullable=False)
    risk_level = Column(String(20), nullable=False)  # low, medium, high, critical
    reason = Column(Text, nullable=False)
    evidence = Column(JSON, nullable=False)  # { "matching_incorrect": [...], "matching_total": 18, "total": 20 }
    created_at = Column(DateTime(timezone=True), default=utc_now)

    examination = relationship("Examination", back_populates="suspicion_flags")
    candidate_a = relationship("Candidate", foreign_keys=[candidate_a_id])
    candidate_b = relationship("Candidate", foreign_keys=[candidate_b_id])

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(100), nullable=False)
    target_type = Column(String(50), nullable=True)
    target_id = Column(String(50), nullable=True)
    details = Column(JSON, nullable=True)
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)

    user = relationship("User", back_populates="audit_logs")
