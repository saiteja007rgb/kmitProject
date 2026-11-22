"""Authentication routes: login, rotating refresh tokens with reuse detection, logout, password change."""
from datetime import timedelta

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.audit import client_ip_from_request, record_audit
from app.core.clock import as_utc, utc_now
from app.core.dependencies import AuthenticatedContext, get_auth_context, get_current_user
from app.core.rate_limit import (
    clear_failed_logins,
    enforce_rate_limit,
    ensure_login_not_locked,
    record_failed_login,
)
from app.core.redis_store import redis_store
from app.core.security import (
    create_access_token,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    password_policy_error,
    verify_password,
)
from app.database import get_db
from app.models import Candidate, LoginSession, User
from app.schemas.auth import (
    CandidateProfileOut,
    ChangePasswordRequest,
    LoginRequest,
    TokenOut,
    UserOut,
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

REFRESH_COOKIE_NAME = "ep_refresh"
REFRESH_COOKIE_PATH = "/api/auth"


def build_user_out(user: User) -> UserOut:
    candidate_profile = None
    if user.candidate is not None:
        candidate_profile = CandidateProfileOut(
            id=user.candidate.id,
            candidate_code=user.candidate.candidate_code,
            batch_id=user.candidate.batch_id,
            batch_name=user.candidate.batch.name if user.candidate.batch else None,
        )
    return UserOut(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        email=user.email,
        role=user.role,
        must_change_password=user.must_change_password,
        candidate=candidate_profile,
    )


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="strict",
        path=REFRESH_COOKIE_PATH,
        max_age=settings.refresh_token_days * 86400,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)


@router.post("/login", response_model=TokenOut)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    client_ip = client_ip_from_request(request) or "unknown"
    await enforce_rate_limit(f"login:{client_ip}", limit=25, window_seconds=60)

    username = payload.username.strip()
    await ensure_login_not_locked(username)

    result = await db.execute(
        select(User)
        .options(selectinload(User.candidate).selectinload(Candidate.batch))
        .where(User.username == username)
    )
    user = result.scalar_one_or_none()

    if user is None or not await verify_password(payload.password, user.password_hash):
        await record_failed_login(username)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password.")

    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated.")

    await clear_failed_logins(username)
    now = utc_now()

    # Enforce single active device for candidates: older tabs get 401 on their next call.
    if user.role == "candidate":
        await db.execute(
            update(LoginSession)
            .where(LoginSession.user_id == user.id, LoginSession.revoked_at.is_(None))
            .values(revoked_at=now, revoked_reason="new_device_login")
        )

    refresh_token, refresh_hash = new_refresh_token()
    login_session = LoginSession(
        user_id=user.id,
        refresh_token_hash=refresh_hash,
        expires_at=now + timedelta(days=settings.refresh_token_days),
        ip_address=client_ip,
        user_agent=(request.headers.get("user-agent") or "")[:255] or None,
    )
    db.add(login_session)
    user.last_login_at = now
    await db.flush()

    record_audit(db, actor_id=user.id, action="auth.login", target_type="user", target_id=user.id, ip_address=client_ip)
    await db.commit()

    access_token = create_access_token(user.id, user.role, login_session.id)
    _set_refresh_cookie(response, refresh_token)
    return TokenOut(
        access_token=access_token,
        expires_in=settings.access_token_minutes * 60,
        user=build_user_out(user),
    )


@router.post("/refresh", response_model=TokenOut)
async def refresh_session(
    request: Request,
    response: Response,
    ep_refresh: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
):
    if not ep_refresh:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh cookie missing.")

    token_hash = hash_refresh_token(ep_refresh)
    now = utc_now()

    # Theft detection: reusing an already-rotated refresh token revokes the entire session.
    reused_session_id = await redis_store.client.get(f"used_refresh:{token_hash}") if redis_store.client else None
    if reused_session_id:
        await db.execute(
            update(LoginSession)
            .where(LoginSession.id == reused_session_id, LoginSession.revoked_at.is_(None))
            .values(revoked_at=now, revoked_reason="token_reuse_detected")
        )
        record_audit(
            db,
            actor_id=None,
            action="auth.refresh_reuse_detected",
            target_type="login_session",
            target_id=reused_session_id,
            ip_address=client_ip_from_request(request),
        )
        await db.commit()
        _clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session revoked due to suspicious token reuse.")

    session_res = await db.execute(select(LoginSession).where(LoginSession.refresh_token_hash == token_hash))
    login_session = session_res.scalar_one_or_none()
    if login_session is None or login_session.revoked_at is not None or as_utc(login_session.expires_at) <= now:
        _clear_refresh_cookie(response)
        if login_session and login_session.revoked_reason == "new_device_login":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session ended: you signed in on another device.")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Please sign in again.")

    user_res = await db.execute(
        select(User)
        .options(selectinload(User.candidate).selectinload(Candidate.batch))
        .where(User.id == login_session.user_id)
    )
    user = user_res.scalar_one_or_none()
    if user is None or not user.is_active:
        _clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is inactive.")

    next_refresh, next_hash = new_refresh_token()
    login_session.refresh_token_hash = next_hash
    await db.commit()

    if redis_store.client:
        await redis_store.client.set(
            f"used_refresh:{token_hash}",
            login_session.id,
            ex=settings.refresh_token_days * 86400,
        )

    access_token = create_access_token(user.id, user.role, login_session.id)
    _set_refresh_cookie(response, next_refresh)
    return TokenOut(
        access_token=access_token,
        expires_in=settings.access_token_minutes * 60,
        user=build_user_out(user),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    ep_refresh: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
):
    if ep_refresh:
        token_hash = hash_refresh_token(ep_refresh)
        await db.execute(
            update(LoginSession)
            .where(LoginSession.refresh_token_hash == token_hash, LoginSession.revoked_at.is_(None))
            .values(revoked_at=utc_now(), revoked_reason="logout")
        )
        await db.commit()
    _clear_refresh_cookie(response)


@router.get("/me", response_model=UserOut)
async def get_me(user: User = Depends(get_current_user)):
    return build_user_out(user)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    auth: AuthenticatedContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    user = auth.user
    if not await verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect.")

    policy_error = password_policy_error(payload.new_password, user.username)
    if policy_error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, policy_error)

    user.password_hash = await hash_password(payload.new_password)
    user.must_change_password = False

    # Revoke any other active devices when password changes.
    await db.execute(
        update(LoginSession)
        .where(
            LoginSession.user_id == user.id,
            LoginSession.id != auth.login_session_id,
            LoginSession.revoked_at.is_(None),
        )
        .values(revoked_at=utc_now(), revoked_reason="password_changed")
    )
    record_audit(
        db,
        actor_id=user.id,
        action="auth.password_changed",
        target_type="user",
        target_id=user.id,
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
