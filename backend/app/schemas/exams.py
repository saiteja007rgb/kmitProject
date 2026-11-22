"""Schemas for exams, all 7 question kinds, enrollments, and lifecycle transitions."""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

ExamStatus = Literal["draft", "scheduled", "live", "paused", "ended"]
QuestionKind = Literal["mcq_single", "mcq_multi", "true_false", "numeric", "short_text", "theory", "coding"]
CodingLanguage = Literal["python", "c", "cpp", "java", "javascript"]
LifecycleAction = Literal["publish", "pause", "resume", "end"]


class ExamSettings(BaseModel):
    shuffle_questions: bool = True
    shuffle_options: bool = True
    negative_marking: float = Field(default=0.0, ge=0.0, le=1.0)
    max_violations: int = Field(default=5, ge=1, le=50)
    require_webcam: bool = True
    require_fullscreen: bool = True
    show_results_immediately: bool = False


class QuestionOption(BaseModel):
    id: str = Field(..., min_length=1, max_length=10)
    text: str = Field(..., min_length=1, max_length=1000)


class CodingTestCase(BaseModel):
    input: str = ""
    expected_output: str = ""


class CodingSpec(BaseModel):
    languages: list[CodingLanguage] = Field(default_factory=lambda: ["python"])
    starter_code: dict[str, str] = Field(default_factory=dict)
    time_limit_ms: int = Field(default=2000, ge=200, le=10000)
    memory_limit_mb: int = Field(default=256, ge=32, le=512)
    sample_tests: list[CodingTestCase] = Field(default_factory=list)
    hidden_tests: list[CodingTestCase] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_languages_and_tests(self) -> "CodingSpec":
        if not self.languages:
            raise ValueError("Coding questions must allow at least one language.")
        if not self.sample_tests and not self.hidden_tests:
            raise ValueError("Coding questions must include at least one sample or hidden test case.")
        return self


class CandidateCodingSpec(BaseModel):
    """Sanitized view of CodingSpec sent to candidates (hidden_tests stripped)."""

    languages: list[CodingLanguage]
    starter_code: dict[str, str]
    time_limit_ms: int
    sample_tests: list[CodingTestCase]


class QuestionInput(BaseModel):
    kind: QuestionKind
    prompt: str = Field(..., min_length=1, max_length=10000)
    options: list[QuestionOption] = Field(default_factory=list)
    correct_answer: Any = None
    marks: float = Field(default=1.0, gt=0.0, le=1000.0)
    negative_marks: float | None = Field(default=None, ge=0.0, le=1000.0)
    explanation: str | None = Field(default=None, max_length=10000)
    numeric_tolerance: float = Field(default=0.0, ge=0.0)
    coding: CodingSpec | None = None

    @model_validator(mode="after")
    def validate_by_kind(self) -> "QuestionInput":
        if self.kind in ("mcq_single", "mcq_multi"):
            if len(self.options) < 2:
                raise ValueError(f"{self.kind} requires at least 2 options.")
            option_ids = {option.id for option in self.options}
            if self.kind == "mcq_single":
                if not isinstance(self.correct_answer, str) or self.correct_answer not in option_ids:
                    raise ValueError("mcq_single requires a valid correct_answer option id.")
            else:
                if (
                    not isinstance(self.correct_answer, list)
                    or not self.correct_answer
                    or not set(self.correct_answer).issubset(option_ids)
                ):
                    raise ValueError("mcq_multi requires a non-empty list of valid option ids.")
        elif self.kind == "true_false":
            if not self.options:
                self.options = [QuestionOption(id="T", text="True"), QuestionOption(id="F", text="False")]
            if self.correct_answer not in ("T", "F"):
                raise ValueError("true_false requires correct_answer 'T' or 'F'.")
        elif self.kind == "numeric":
            try:
                float(str(self.correct_answer))
            except (TypeError, ValueError) as exc:
                raise ValueError("numeric question requires a numeric correct_answer.") from exc
        elif self.kind == "short_text":
            if not isinstance(self.correct_answer, str) or not self.correct_answer.strip():
                raise ValueError("short_text question requires a non-empty correct_answer.")
        elif self.kind == "coding":
            if self.coding is None:
                raise ValueError("coding question requires a coding specification.")
        return self


class QuestionAdmin(QuestionInput):
    id: str
    position: int


class CandidateQuestion(BaseModel):
    """Question payload delivered to a candidate; never exposes answers or hidden test cases."""

    id: str
    position: int
    kind: QuestionKind
    prompt: str
    options: list[QuestionOption]
    marks: float
    coding: CandidateCodingSpec | None = None


class ExamInput(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    instructions: str | None = Field(default=None, max_length=10000)
    starts_at: datetime
    ends_at: datetime
    duration_minutes: int = Field(..., ge=1, le=600)
    settings: ExamSettings = Field(default_factory=ExamSettings)
    questions: list[QuestionInput] = Field(..., min_length=1)

    @model_validator(mode="after")
    def validate_schedule(self) -> "ExamInput":
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be later than starts_at.")
        return self


class ExamSummary(BaseModel):
    id: str
    title: str
    description: str | None
    status: ExamStatus
    starts_at: datetime
    ends_at: datetime
    duration_minutes: int
    question_count: int
    total_marks: float
    enrolled_count: int
    in_progress_count: int
    submitted_count: int
    results_published: bool
    created_at: datetime


class ExamDetail(ExamSummary):
    instructions: str | None
    settings: ExamSettings
    questions: list[QuestionAdmin]


class LifecycleActionRequest(BaseModel):
    action: LifecycleAction


class ResultsPublishRequest(BaseModel):
    published: bool


class ExtendTimeRequest(BaseModel):
    minutes: int = Field(..., ge=1, le=180)


class ExtendExamResponse(BaseModel):
    sessions_extended: int


class QuestionImportResponse(BaseModel):
    questions: list[QuestionInput]
    message: str


class EnrollmentItem(BaseModel):
    candidate_id: str
    candidate_code: str
    full_name: str
    batch_name: str | None
    extra_minutes: int
    attempt_status: Literal["not_started", "in_progress", "submitted"]


class EnrollmentCreateRequest(BaseModel):
    candidate_ids: list[str] = Field(default_factory=list)
    batch_ids: list[str] = Field(default_factory=list)


class EnrollmentCreateResponse(BaseModel):
    added: int
    already_enrolled: int


class EnrollmentUpdateRequest(BaseModel):
    extra_minutes: int = Field(..., ge=0, le=180)
