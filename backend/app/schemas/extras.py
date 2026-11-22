"""Schemas for 2FA/TOTP, active device sessions, self-registration, password recovery, feedback, question bank, regrades, and transcripts."""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.exams import CodingSpec, QuestionKind, QuestionOption

FeedbackDifficulty = Literal["too_easy", "just_right", "challenging", "too_hard"]
QuestionDifficulty = Literal["easy", "medium", "hard"]
RegradeStatus = Literal["open", "approved", "rejected"]


# --- Real Authentication Extensions ---

class RegisterCandidateRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9._-]+$")
    full_name: str = Field(..., min_length=2, max_length=120)
    email: str = Field(..., min_length=5, max_length=254)
    candidate_code: str | None = Field(default=None, max_length=30)
    password: str = Field(..., min_length=8, max_length=128)


class RegisterCandidateResponse(BaseModel):
    username: str
    email: str
    verification_required: bool = True
    message: str
    dev_verification_code: str | None = None


class VerifyEmailRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    code: str = Field(..., min_length=6, max_length=6)


class ForgotPasswordRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)


class ForgotPasswordResponse(BaseModel):
    message: str
    dev_reset_code: str | None = None


class ResetPasswordWithCodeRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8, max_length=128)


class TotpSetupResponse(BaseModel):
    secret: str
    otpauth_uri: str
    qr_svg_data_uri: str


class TotpCodeRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=12)


class TotpEnableResponse(BaseModel):
    enabled: bool = True
    backup_codes: list[str]


class LoginSessionOut(BaseModel):
    id: str
    ip_address: str | None
    user_agent: str | None
    created_at: datetime
    expires_at: datetime
    is_current: bool


class SecurityEventOut(BaseModel):
    id: str
    action: str
    ip_address: str | None
    created_at: datetime


class AccountSecurityOut(BaseModel):
    totp_enabled: bool
    backup_codes_remaining: int
    email_verified: bool
    active_sessions: list[LoginSessionOut]
    recent_events: list[SecurityEventOut]


# --- Post-Exam Feedback ---

class FeedbackSubmitRequest(BaseModel):
    overall_rating: int = Field(..., ge=1, le=5)
    difficulty: FeedbackDifficulty
    clarity_rating: int = Field(..., ge=1, le=5)
    platform_rating: int = Field(..., ge=1, le=5)
    comments: str | None = Field(default=None, max_length=2000)
    flagged_question_id: str | None = None


class FeedbackItemOut(BaseModel):
    id: str
    exam_id: str
    attempt_id: str
    candidate_code: str
    candidate_name: str
    overall_rating: int
    difficulty: FeedbackDifficulty
    clarity_rating: int
    platform_rating: int
    comments: str | None
    flagged_question_id: str | None
    created_at: datetime


class FeedbackSummaryResponse(BaseModel):
    total_responses: int
    avg_overall: float
    avg_clarity: float
    avg_platform: float
    difficulty_counts: dict[str, int]
    items: list[FeedbackItemOut]


# --- Reusable Question Bank ---

class QuestionBankCreateRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    subject: str = Field(..., min_length=2, max_length=80)
    difficulty: QuestionDifficulty = "medium"
    tags: list[str] = Field(default_factory=list)
    kind: QuestionKind
    prompt: str = Field(..., min_length=1, max_length=10000)
    options: list[QuestionOption] = Field(default_factory=list)
    correct_answer: Any = None
    marks: float = Field(default=1.0, gt=0.0, le=1000.0)
    negative_marks: float | None = Field(default=None, ge=0.0, le=1000.0)
    explanation: str | None = Field(default=None, max_length=10000)
    numeric_tolerance: float = Field(default=0.0, ge=0.0)
    coding: CodingSpec | None = None


class QuestionBankItemOut(QuestionBankCreateRequest):
    id: str
    created_at: datetime


# --- Regrade / Appeal Requests ---

class RegradeCreateRequest(BaseModel):
    question_id: str
    reason: str = Field(..., min_length=5, max_length=2000)


class RegradeResolveRequest(BaseModel):
    status: Literal["approved", "rejected"]
    new_marks: float | None = Field(default=None, ge=0.0)
    resolution_note: str | None = Field(default=None, max_length=2000)


class RegradeOut(BaseModel):
    id: str
    exam_id: str
    attempt_id: str
    answer_id: str
    question_id: str
    question_position: int
    question_prompt: str
    candidate_code: str
    candidate_name: str
    current_marks: float | None
    max_marks: float
    reason: str
    status: RegradeStatus
    resolution_note: str | None
    created_at: datetime
    resolved_at: datetime | None


# --- Candidate Transcript ---

class TranscriptExamEntry(BaseModel):
    attempt_id: str
    exam_id: str
    exam_title: str
    score: float
    max_score: float
    percentage: float
    grade: str
    passed: bool
    submitted_at: datetime
    feedback_submitted: bool


class CandidateTranscriptOut(BaseModel):
    candidate_code: str
    full_name: str
    batch_name: str | None
    exams_completed: int
    average_percentage: float
    highest_percentage: float
    pass_count: int
    entries: list[TranscriptExamEntry]
