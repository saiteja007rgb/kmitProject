"""Database tables. Effective exam status and scores are derived in `app.services`."""
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.clock import utc_now
from app.database import Base


def new_id() -> str:
    return str(uuid.uuid4())


def id_column() -> Mapped[str]:
    return mapped_column(String(36), primary_key=True, default=new_id)


def timestamp(nullable: bool = False, **kwargs) -> Mapped:
    return mapped_column(DateTime(timezone=True), nullable=nullable, **kwargs)


def foreign_key(target: str, on_delete: str = "CASCADE", nullable: bool = False, index: bool = True) -> Mapped:
    return mapped_column(String(36), ForeignKey(target, ondelete=on_delete), nullable=nullable, index=index)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = id_column()
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), index=True)  # admin | invigilator | candidate
    full_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(254))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login_at: Mapped[datetime | None] = timestamp(nullable=True)
    created_at: Mapped[datetime] = timestamp(default=utc_now)

    candidate: Mapped["Candidate | None"] = relationship(back_populates="user", cascade="all, delete-orphan")


class LoginSession(Base):
    """One signed-in device. Holds the hash of its current (rotating) refresh token."""

    __tablename__ = "login_sessions"

    id: Mapped[str] = id_column()
    user_id: Mapped[str] = foreign_key("users.id")
    refresh_token_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = timestamp()
    revoked_at: Mapped[datetime | None] = timestamp(nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(40))
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = timestamp(default=utc_now)


class Batch(Base):
    __tablename__ = "batches"

    id: Mapped[str] = id_column()
    name: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = timestamp(default=utc_now)


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[str] = id_column()
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    candidate_code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    batch_id: Mapped[str | None] = foreign_key("batches.id", on_delete="SET NULL", nullable=True)

    user: Mapped[User] = relationship(back_populates="candidate")
    batch: Mapped[Batch | None] = relationship()


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[str] = id_column()
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    instructions: Mapped[str | None] = mapped_column(Text)
    starts_at: Mapped[datetime] = timestamp()
    ends_at: Mapped[datetime] = timestamp()
    duration_minutes: Mapped[int] = mapped_column(Integer)
    # Stored admin decision: draft | published | paused | ended. Clock-derived status lives in services.exam_status.
    lifecycle_state: Mapped[str] = mapped_column(String(20), default="draft")
    paused_at: Mapped[datetime | None] = timestamp(nullable=True)
    results_published: Mapped[bool] = mapped_column(Boolean, default=False)

    shuffle_questions: Mapped[bool] = mapped_column(Boolean, default=True)
    shuffle_options: Mapped[bool] = mapped_column(Boolean, default=True)
    negative_marking: Mapped[float] = mapped_column(Float, default=0.0)
    max_violations: Mapped[int] = mapped_column(Integer, default=5)
    require_webcam: Mapped[bool] = mapped_column(Boolean, default=True)
    require_fullscreen: Mapped[bool] = mapped_column(Boolean, default=True)
    show_results_immediately: Mapped[bool] = mapped_column(Boolean, default=False)

    created_by: Mapped[str | None] = foreign_key("users.id", on_delete="SET NULL", nullable=True, index=False)
    created_at: Mapped[datetime] = timestamp(default=utc_now)

    questions: Mapped[list["Question"]] = relationship(
        back_populates="exam", cascade="all, delete-orphan", order_by="Question.position"
    )


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[str] = id_column()
    exam_id: Mapped[str] = foreign_key("exams.id")
    position: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20))  # see schemas.exams.QuestionKind
    prompt: Mapped[str] = mapped_column(Text)
    options: Mapped[list] = mapped_column(JSON, default=list)
    correct_answer: Mapped[object | None] = mapped_column(JSON(none_as_null=True))
    marks: Mapped[float] = mapped_column(Float, default=1.0)
    negative_marks: Mapped[float] = mapped_column(Float, default=0.0)
    explanation: Mapped[str | None] = mapped_column(Text)
    numeric_tolerance: Mapped[float] = mapped_column(Float, default=0.0)
    coding: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))

    exam: Mapped[Exam] = relationship(back_populates="questions")


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (UniqueConstraint("exam_id", "candidate_id", name="uq_enrollment"),)

    id: Mapped[str] = id_column()
    exam_id: Mapped[str] = foreign_key("exams.id", index=False)
    candidate_id: Mapped[str] = foreign_key("candidates.id")
    extra_minutes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = timestamp(default=utc_now)


class Attempt(Base):
    """A candidate's single sitting of an exam."""

    __tablename__ = "attempts"
    __table_args__ = (
        UniqueConstraint("candidate_id", "exam_id", name="uq_attempt_per_candidate"),
        Index("ix_attempts_exam_status", "exam_id", "status"),
        Index("ix_attempts_status_deadline", "status", "deadline"),
    )

    id: Mapped[str] = id_column()
    exam_id: Mapped[str] = foreign_key("exams.id", index=False)
    candidate_id: Mapped[str] = foreign_key("candidates.id", index=False)
    status: Mapped[str] = mapped_column(String(20), default="in_progress")  # in_progress | submitted
    started_at: Mapped[datetime] = timestamp(default=utc_now)
    deadline: Mapped[datetime] = timestamp()
    submitted_at: Mapped[datetime | None] = timestamp(nullable=True)
    submit_reason: Mapped[str | None] = mapped_column(String(20))
    receipt_id: Mapped[str | None] = mapped_column(String(20))
    question_order: Mapped[list] = mapped_column(JSON)
    option_order: Mapped[dict] = mapped_column(JSON, default=dict)
    violation_count: Mapped[int] = mapped_column(Integer, default=0)
    last_seen_at: Mapped[datetime | None] = timestamp(nullable=True)
    client_ip: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    score: Mapped[float | None] = mapped_column(Float)
    max_score: Mapped[float] = mapped_column(Float, default=0.0)
    grading_pending: Mapped[bool] = mapped_column(Boolean, default=False)

    exam: Mapped[Exam] = relationship()
    candidate: Mapped[Candidate] = relationship()


class Answer(Base):
    __tablename__ = "answers"
    __table_args__ = (UniqueConstraint("attempt_id", "question_id", name="uq_answer_per_question"),)

    id: Mapped[str] = id_column()
    attempt_id: Mapped[str] = foreign_key("attempts.id", index=False)
    question_id: Mapped[str] = foreign_key("questions.id")
    response: Mapped[object | None] = mapped_column(JSON(none_as_null=True))
    is_flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)  # client sequence number; stale writes are ignored
    saved_at: Mapped[datetime] = timestamp(default=utc_now)
    awarded_marks: Mapped[float | None] = mapped_column(Float)
    is_correct: Mapped[bool | None] = mapped_column(Boolean)
    feedback: Mapped[str | None] = mapped_column(Text)
    evaluation: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))  # cached coding test result


class ProctoringEvent(Base):
    __tablename__ = "proctoring_events"

    id: Mapped[str] = id_column()
    attempt_id: Mapped[str] = foreign_key("attempts.id")
    kind: Mapped[str] = mapped_column(String(30))
    detail: Mapped[str | None] = mapped_column(String(255))
    counted_as_violation: Mapped[bool] = mapped_column(Boolean)
    occurred_at: Mapped[datetime] = timestamp(default=utc_now)


class Snapshot(Base):
    __tablename__ = "snapshots"

    id: Mapped[str] = id_column()
    attempt_id: Mapped[str] = foreign_key("attempts.id")
    reason: Mapped[str] = mapped_column(String(20))
    face_count: Mapped[int] = mapped_column(Integer, default=0)
    captured_at: Mapped[datetime] = timestamp(default=utc_now)


class Announcement(Base):
    __tablename__ = "announcements"

    id: Mapped[str] = id_column()
    exam_id: Mapped[str] = foreign_key("exams.id")
    message: Mapped[str] = mapped_column(String(500))
    author_id: Mapped[str | None] = foreign_key("users.id", on_delete="SET NULL", nullable=True, index=False)
    created_at: Mapped[datetime] = timestamp(default=utc_now)

    author: Mapped[User | None] = relationship()


class CollusionFlag(Base):
    __tablename__ = "collusion_flags"

    id: Mapped[str] = id_column()
    exam_id: Mapped[str] = foreign_key("exams.id")
    candidate_a_id: Mapped[str] = foreign_key("candidates.id", index=False)
    candidate_b_id: Mapped[str] = foreign_key("candidates.id", index=False)
    similarity_score: Mapped[float] = mapped_column(Float)
    risk_level: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str] = mapped_column(Text)
    evidence: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = timestamp(default=utc_now)

    candidate_a: Mapped[Candidate] = relationship(foreign_keys=[candidate_a_id])
    candidate_b: Mapped[Candidate] = relationship(foreign_keys=[candidate_b_id])


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = id_column()
    actor_id: Mapped[str | None] = foreign_key("users.id", on_delete="SET NULL", nullable=True, index=False)
    action: Mapped[str] = mapped_column(String(60))
    target_type: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(36))
    details: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    ip_address: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = timestamp(default=utc_now, index=True)

    actor: Mapped[User | None] = relationship()
