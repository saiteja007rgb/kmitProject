"""Schemas for candidates, batches, staff accounts, and audit logs."""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class CandidateOut(BaseModel):
    id: str
    user_id: str
    username: str
    full_name: str
    email: str | None
    candidate_code: str
    batch_id: str | None
    batch_name: str | None
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime


class CandidatePageResponse(BaseModel):
    items: list[CandidateOut]
    total: int


class CandidateCreateRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9._-]+$")
    full_name: str = Field(..., min_length=2, max_length=120)
    email: str | None = Field(default=None, max_length=254)
    candidate_code: str | None = Field(default=None, max_length=30)
    batch_id: str | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


class CandidateCreateResponse(BaseModel):
    candidate: CandidateOut
    temporary_password: str | None


class CandidateUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: str | None = Field(default=None, max_length=254)
    batch_id: str | None = None
    is_active: bool | None = None


class CandidateImportCreated(BaseModel):
    username: str
    full_name: str
    candidate_code: str
    temporary_password: str


class CandidateImportSkipped(BaseModel):
    row: int
    username: str
    reason: str


class CandidateImportResponse(BaseModel):
    created: list[CandidateImportCreated]
    skipped: list[CandidateImportSkipped]


class PasswordResetResponse(BaseModel):
    temporary_password: str


class StaffOut(BaseModel):
    id: str
    username: str
    full_name: str
    role: Literal["admin", "invigilator"]
    is_active: bool
    last_login_at: datetime | None


class StaffCreateRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9._-]+$")
    full_name: str = Field(..., min_length=2, max_length=120)
    role: Literal["admin", "invigilator"]
    password: str | None = Field(default=None, min_length=8, max_length=128)


class StaffCreateResponse(BaseModel):
    staff: StaffOut
    temporary_password: str | None


class StaffUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    is_active: bool | None = None


class BatchOut(BaseModel):
    id: str
    name: str
    description: str | None
    candidate_count: int


class BatchCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=255)


class BatchUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=255)


class AuditLogOut(BaseModel):
    id: str
    actor_username: str | None
    action: str
    target_type: str | None
    target_id: str | None
    details: dict[str, Any] | None
    ip_address: str | None
    created_at: datetime


class AuditLogPageResponse(BaseModel):
    items: list[AuditLogOut]
    total: int

