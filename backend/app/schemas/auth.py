"""Authentication request and response models."""
from typing import Literal

from pydantic import BaseModel, Field

UserRole = Literal["admin", "invigilator", "candidate"]


class CandidateProfileOut(BaseModel):
    id: str
    candidate_code: str
    batch_id: str | None
    batch_name: str | None


class UserOut(BaseModel):
    id: str
    username: str
    full_name: str
    email: str | None
    role: UserRole
    must_change_password: bool
    totp_enabled: bool = False
    email_verified: bool = True
    candidate: CandidateProfileOut | None = None


class TokenOut(BaseModel):
    access_token: str
    expires_in: int
    user: UserOut


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=1, max_length=128)
    totp_code: str | None = Field(default=None, max_length=16)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)

