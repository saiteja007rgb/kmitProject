"""Schemas for admin dashboard, live monitoring, attempt inspection, grading, analytics, and collusion."""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.exams import ExamSummary, QuestionKind
from app.schemas.people import AuditLogOut


class DashboardCounts(BaseModel):
    candidates: int
    active_candidates: int
    exams: int
    live_exams: int
    in_progress_sessions: int


class AdminDashboardResponse(BaseModel):
    counts: DashboardCounts
    live_exams: list[ExamSummary]
    recent_activity: list[AuditLogOut]


class LiveBoardCounts(BaseModel):
    enrolled: int
    not_started: int
    in_progress: int
    submitted: int
    flagged: int


class LiveCandidateRow(BaseModel):
    candidate_id: str
    attempt_id: str | None
    candidate_code: str
    full_name: str
    batch_name: str | None
    status: Literal["not_started", "in_progress", "submitted"]
    answered_count: int
    total_questions: int
    violation_count: int
    last_seen_at: datetime | None
    is_online: bool
    deadline: datetime | None
    score: float | None
    max_score: float
    submit_reason: str | None
    latest_snapshot_id: str | None
    collusion_flagged: bool


class LiveBoard(BaseModel):
    exam: ExamSummary
    counts: LiveBoardCounts
    average_progress: float
    candidates: list[LiveCandidateRow]


class AttemptDetailCandidate(BaseModel):
    candidate_id: str
    candidate_code: str
    full_name: str
    batch_name: str | None


class AttemptEventItem(BaseModel):
    id: str
    kind: str
    detail: str | None
    counted_as_violation: bool
    occurred_at: datetime


class AttemptSnapshotItem(BaseModel):
    id: str
    captured_at: datetime
    reason: str
    face_count: int


class AttemptAnswerDetail(BaseModel):
    question_id: str
    position: int
    kind: QuestionKind
    prompt: str
    response: Any
    awarded_marks: float | None
    max_marks: float
    is_correct: bool | None


class AttemptDetail(BaseModel):
    attempt_id: str
    status: Literal["in_progress", "submitted"]
    started_at: datetime
    deadline: datetime
    submitted_at: datetime | None
    submit_reason: str | None
    score: float | None
    max_score: float
    violation_count: int
    client_ip: str | None
    user_agent: str | None
    candidate: AttemptDetailCandidate
    events: list[AttemptEventItem]
    snapshots: list[AttemptSnapshotItem]
    answers: list[AttemptAnswerDetail]


class ExtendAttemptResponse(BaseModel):
    deadline: datetime


class ForceSubmitResponse(BaseModel):
    status: Literal["submitted"]


class AnnouncementCreateRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=500)


class AnnouncementOut(BaseModel):
    id: str
    message: str
    author: str
    created_at: datetime


class LeaderboardEntry(BaseModel):
    rank: int
    candidate_code: str
    full_name: str
    score: float
    max_score: float
    percentage: float
    submitted_at: datetime | None
    duration_seconds: int


class CollusionScanResponse(BaseModel):
    flags_detected: int


class CollusionFlagOut(BaseModel):
    id: str
    candidate_a_code: str
    candidate_a_name: str
    candidate_b_code: str
    candidate_b_name: str
    similarity_score: float
    risk_level: str
    reason: str
    evidence: dict[str, Any]
    created_at: datetime


class AnalyticsStats(BaseModel):
    attempts: int
    submitted: int
    mean: float
    median: float
    highest: float
    lowest: float
    std_dev: float
    pass_rate: float


class ScoreBucket(BaseModel):
    label: str
    count: int


class QuestionAnalytics(BaseModel):
    question_id: str
    position: int
    prompt: str
    kind: QuestionKind
    attempted: int
    correct: int
    accuracy: float


class ExamAnalytics(BaseModel):
    stats: AnalyticsStats
    score_histogram: list[ScoreBucket]
    questions: list[QuestionAnalytics]
    violations_by_kind: dict[str, int]


class GradingQueueItem(BaseModel):
    answer_id: str
    attempt_id: str
    candidate_code: str
    full_name: str
    question_id: str
    position: int
    prompt: str
    max_marks: float
    response: Any
    model_answer: str | None
    awarded_marks: float | None
    feedback: str | None


class GradeAnswerRequest(BaseModel):
    awarded_marks: float = Field(..., ge=0.0)
    feedback: str | None = Field(default=None, max_length=2000)


class GradeAnswerResponse(BaseModel):
    attempt_score: float
