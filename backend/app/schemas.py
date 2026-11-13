from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict
from datetime import datetime

# --- Auth Schemas ---
class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=100)
    display_name: str = Field(..., min_length=2, max_length=100)
    candidate_code: Optional[str] = Field(None, max_length=30)
    role: str = "candidate"
    admin_secret: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: str
    candidate_id: Optional[str] = None
    display_name: str

class UserProfile(BaseModel):
    id: str
    username: str
    role: str
    candidate_id: Optional[str] = None
    display_name: Optional[str] = None

# --- Question & Exam Schemas ---
class QuestionOption(BaseModel):
    id: str
    text: str

class CandidateQuestion(BaseModel):
    id: str
    question_text: str
    question_type: str
    options: List[QuestionOption]
    marks: float
    order: int
    # Note: correct_answer is strictly omitted!

class ExamListItem(BaseModel):
    id: str
    title: str
    description: Optional[str]
    duration_seconds: int
    start_time: datetime
    end_time: datetime
    total_marks: float
    status: str

class ExamStartResponse(BaseModel):
    session_id: str
    examination_id: str
    title: str
    duration_seconds: int
    started_at: datetime
    deadline: datetime
    status: str
    total_questions: int

# --- Proctoring & Anti-Cheat Schemas ---
class ViolationLogRequest(BaseModel):
    violation_type: str = "tab_switch"
    details: Optional[str] = None

class ViolationLogResponse(BaseModel):
    status: str = "logged"
    violation_count: int
    max_violations: int = 3
    auto_submitted: bool = False
    message: str

# --- Solution & Review Schemas ---
class SolutionQuestionItem(BaseModel):
    id: str
    order: int
    question_text: str
    options: List[QuestionOption]
    selected_answer: Optional[str]
    correct_answer: str
    is_correct: bool
    marks_earned: float
    explanation: Optional[str] = None

class SolutionReviewResponse(BaseModel):
    session_id: str
    examination_id: str
    exam_title: str
    score: float
    total_marks: float
    correct_count: int
    incorrect_count: int
    unanswered_count: int
    questions: List[SolutionQuestionItem]

# --- Exam & Question Authoring Schemas ---
class QuestionCreateItem(BaseModel):
    question_text: str
    options: List[QuestionOption]
    correct_answer: str
    marks: float = 1.0
    negative_marks: float = 0.0
    explanation: Optional[str] = None

class ExamCreateRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    description: Optional[str] = None
    duration_minutes: int = Field(60, ge=1, le=360)
    negative_marking: float = Field(0.0, ge=0.0, le=5.0)
    questions: List[QuestionCreateItem] = Field(..., min_length=1)

class SessionStatusResponse(BaseModel):
    session_id: str
    examination_id: str
    candidate_id: str
    status: str
    started_at: datetime
    deadline: datetime
    server_time: datetime
    remaining_seconds: int
    submitted_at: Optional[datetime] = None

# --- Answer Autosave Schemas ---
class AnswerUpdateRequest(BaseModel):
    selected_answer: Optional[str] = None
    is_marked_for_review: Optional[bool] = False
    version: int = Field(default=1, description="Client version sequence for stale prevention")

class AnswerSavedResponse(BaseModel):
    status: str = "saved"
    question_id: str
    selected_answer: Optional[str]
    is_marked_for_review: bool
    version: int
    updated_at: datetime

class AnswerItem(BaseModel):
    question_id: str
    selected_answer: Optional[str]
    is_marked_for_review: bool
    version: int
    updated_at: datetime

# --- Submission Schemas ---
class SubmitResponse(BaseModel):
    session_id: str
    status: str = "submitted"
    submitted_at: datetime
    score: float
    total_marks: float
    correct_count: int
    incorrect_count: int
    unanswered_count: int
    message: str = "Examination submitted successfully"

# --- Admin & Invigilator Schemas ---
class InvigilatorOverview(BaseModel):
    examination_id: str
    title: str
    total_registered: int
    active_count: int
    submitted_count: int
    not_started_count: int
    suspicious_count: int
    duration_seconds: int
    server_time: datetime

class CandidateMonitorItem(BaseModel):
    candidate_id: str
    candidate_code: str
    display_name: str
    status: str
    answered_count: int
    unanswered_count: int
    marked_count: int
    score: Optional[float] = None
    is_suspicious: bool = False
    last_activity: Optional[datetime] = None

class LeaderboardItem(BaseModel):
    rank: int
    candidate_code: str
    display_name: str
    score: float
    correct_count: int
    incorrect_count: int
    unanswered_count: int
    submitted_at: Optional[datetime] = None

class SuspicionFlagItem(BaseModel):
    id: str
    examination_id: str
    candidate_a_code: str
    candidate_a_name: str
    candidate_b_code: str
    candidate_b_name: str
    similarity_score: float
    risk_level: str
    reason: str
    evidence: Dict[str, Any]
    created_at: datetime
