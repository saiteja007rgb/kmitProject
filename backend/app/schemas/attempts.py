"""Schemas for candidate exam taking, heartbeats, proctoring events, code execution, and results."""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.exams import CandidateQuestion, CodingLanguage, ExamStatus, QuestionKind, QuestionOption

ProctoringEventKind = Literal[
    "tab_hidden",
    "window_blur",
    "fullscreen_exit",
    "copy_attempt",
    "paste_attempt",
    "context_menu",
    "no_face",
    "multiple_faces",
    "looking_away",
    "camera_off",
    "devtools_open",
]

CodeVerdict = Literal["passed", "wrong_answer", "runtime_error", "time_limit", "memory_limit", "custom"]


class CandidateAttemptSummary(BaseModel):
    id: str
    status: Literal["in_progress", "submitted"]
    score: float | None
    max_score: float
    submitted_at: datetime | None


class CandidateExamCard(BaseModel):
    id: str
    title: str
    description: str | None
    status: ExamStatus
    starts_at: datetime
    ends_at: datetime
    duration_minutes: int
    question_count: int
    total_marks: float
    require_webcam: bool
    require_fullscreen: bool
    attempt: CandidateAttemptSummary | None
    results_available: bool


class AttemptExamMeta(BaseModel):
    id: str
    title: str
    instructions: str | None
    status: ExamStatus
    require_webcam: bool
    require_fullscreen: bool
    max_violations: int


class AttemptAnswerOut(BaseModel):
    question_id: str
    response: Any
    is_flagged: bool
    version: int


class AttemptAnnouncementOut(BaseModel):
    id: str
    message: str
    created_at: datetime


class AttemptState(BaseModel):
    attempt_id: str
    status: Literal["in_progress", "submitted"]
    exam: AttemptExamMeta
    started_at: datetime
    deadline: datetime
    server_time: datetime
    remaining_seconds: int
    violation_count: int
    questions: list[CandidateQuestion]
    answers: list[AttemptAnswerOut]
    announcements: list[AttemptAnnouncementOut]


class HeartbeatResponse(BaseModel):
    status: Literal["in_progress", "submitted"]
    exam_status: ExamStatus
    remaining_seconds: int
    deadline: datetime
    server_time: datetime
    violation_count: int


class AnswerSaveRequest(BaseModel):
    response: Any = None
    is_flagged: bool = False
    version: int = Field(..., ge=1)


class AnswerSaveResponse(BaseModel):
    question_id: str
    version: int
    saved_at: datetime
    accepted: bool


class SubmitResult(BaseModel):
    attempt_id: str
    receipt_id: str
    status: Literal["submitted"]
    submitted_at: datetime
    submit_reason: str
    answered_count: int
    total_questions: int
    results_visible: bool
    score: float | None
    max_score: float


class ProctoringEventRequest(BaseModel):
    kind: ProctoringEventKind
    detail: str | None = Field(default=None, max_length=255)


class ProctoringEventResponse(BaseModel):
    violation_count: int
    max_violations: int
    auto_submitted: bool
    message: str


class CodeRunRequest(BaseModel):
    question_id: str
    language: CodingLanguage
    code: str = Field(..., max_length=65536)
    custom_input: str | None = Field(default=None, max_length=65536)


class CodeTestCaseResult(BaseModel):
    input: str
    expected_output: str | None
    actual_output: str
    verdict: CodeVerdict
    time_ms: int


class CodeRunResult(BaseModel):
    status: Literal["ok", "compile_error"]
    compile_output: str | None = None
    results: list[CodeTestCaseResult] = Field(default_factory=list)


class ResultQuestionView(BaseModel):
    question_id: str
    position: int
    kind: QuestionKind
    prompt: str
    options: list[QuestionOption]
    response: Any
    correct_answer: Any
    awarded_marks: float | None
    max_marks: float
    is_correct: bool | None
    explanation: str | None
    feedback: str | None


class ResultView(BaseModel):
    attempt_id: str
    exam_title: str
    score: float
    max_score: float
    percentage: float
    submitted_at: datetime | None
    grading_pending: bool
    questions: list[ResultQuestionView]
