"""Authentication routes: login + 2FA TOTP, self-registration with OTP verification, password recovery, rotating refresh cookies, active device sessions."""
import secrets
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
from app.core.totp import (
    build_otpauth_uri,
    build_qr_svg_data_uri,
    consume_backup_code,
    generate_backup_codes,
    generate_totp_secret,
    issue_six_digit_otp,
    verify_and_consume_otp,
    verify_totp_code,
)
from app.database import get_db
from app.models import AuditLog, Candidate, LoginSession, User
from app.schemas.auth import (
    CandidateProfileOut,
    ChangePasswordRequest,
    LoginRequest,
    TokenOut,
    UserOut,
)
from app.schemas.extras import (
    AccountSecurityOut,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginSessionOut,
    RegisterCandidateRequest,
    RegisterCandidateResponse,
    ResetPasswordWithCodeRequest,
    SecurityEventOut,
    TotpCodeRequest,
    TotpEnableResponse,
    TotpSetupResponse,
    VerifyEmailRequest,
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
        totp_enabled=bool(user.totp_enabled),
        email_verified=bool(user.email_verified),
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


@router.post("/register", response_model=RegisterCandidateResponse, status_code=status.HTTP_201_CREATED)
async def register_candidate(
    payload: RegisterCandidateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    client_ip = client_ip_from_request(request) or "unknown"
    await enforce_rate_limit(f"register:{client_ip}", limit=10, window_seconds=300)

    username = payload.username.strip()
    policy_error = password_policy_error(payload.password, username)
    if policy_error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, policy_error)

    if (await db.execute(select(User.id).where(User.username == username))).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, f"Username '{username}' is already taken.")

    candidate_code = (payload.candidate_code or "").strip() or f"CAND-{secrets.token_hex(3).upper()}"
    if (await db.execute(select(Candidate.id).where(Candidate.candidate_code == candidate_code))).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, f"Candidate code '{candidate_code}' is already registered.")

    user = User(
        username=username,
        password_hash=await hash_password(payload.password),
        role="candidate",
        full_name=payload.full_name.strip(),
        email=payload.email.strip().lower(),
        email_verified=False,
        must_change_password=False,
    )
    db.add(user)
    await db.flush()
    db.add(Candidate(user_id=user.id, candidate_code=candidate_code))

    record_audit(
        db,
        actor_id=user.id,
        action="auth.registered",
        target_type="user",
        target_id=user.id,
        details={"email": user.email},
        ip_address=client_ip,
    )
    await db.commit()

    code = await issue_six_digit_otp("verify_email", username)
    return RegisterCandidateResponse(
        username=username,
        email=user.email,
        verification_required=True,
        message="Account created. Enter the 6-digit verification code to activate your account.",
        dev_verification_code=code if settings.environment != "production" else None,
    )


@router.post("/verify-email", status_code=status.HTTP_204_NO_CONTENT)
async def verify_email(
    payload: VerifyEmailRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    username = payload.username.strip()
    valid = await verify_and_consume_otp("verify_email", username, payload.code)
    if not valid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired verification code.")

    user = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found.")

    user.email_verified = True
    record_audit(
        db,
        actor_id=user.id,
        action="auth.email_verified",
        target_type="user",
        target_id=user.id,
        ip_address=client_ip_from_request(request),
    )
    await db.commit()


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    client_ip = client_ip_from_request(request) or "unknown"
    await enforce_rate_limit(f"forgot:{client_ip}", limit=8, window_seconds=300)

    username = payload.username.strip()
    user = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    dev_code = None
    if user is not None and user.is_active:
        code = await issue_six_digit_otp("password_reset", username)
        if settings.environment != "production":
            dev_code = code
        record_audit(
            db,
            actor_id=user.id,
            action="auth.password_reset_requested",
            target_type="user",
            target_id=user.id,
            ip_address=client_ip,
        )
        await db.commit()

    return ForgotPasswordResponse(
        message="If that account exists, a 6-digit password recovery code has been issued (valid 10 minutes).",
        dev_reset_code=dev_code,
    )


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password_with_code(
    payload: ResetPasswordWithCodeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    username = payload.username.strip()
    valid = await verify_and_consume_otp("password_reset", username, payload.code)
    if not valid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired recovery code.")

    user = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found.")

    policy_error = password_policy_error(payload.new_password, user.username)
    if policy_error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, policy_error)

    user.password_hash = await hash_password(payload.new_password)
    user.must_change_password = False
    await db.execute(
        update(LoginSession)
        .where(LoginSession.user_id == user.id, LoginSession.revoked_at.is_(None))
        .values(revoked_at=utc_now(), revoked_reason="password_reset")
    )
    await clear_failed_logins(username)
    record_audit(
        db,
        actor_id=user.id,
        action="auth.password_recovered",
        target_type="user",
        target_id=user.id,
        ip_address=client_ip_from_request(request),
    )
    await db.commit()


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

    if not user.email_verified:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Please verify your email address before signing in.",
            headers={"X-Require-Verification": "true"},
        )

    # Two-Factor Authentication verification when enabled on this account.
    if user.totp_enabled and user.totp_secret:
        if not payload.totp_code:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Two-factor authentication code required.",
                headers={"X-Require-TOTP": "true"},
            )
        code_ok = verify_totp_code(user.totp_secret, payload.totp_code)
        if not code_ok:
            matched_backup, remaining_codes = consume_backup_code(payload.totp_code, user.backup_codes)
            if matched_backup:
                user.backup_codes = remaining_codes
                code_ok = True
        if not code_ok:
            await record_failed_login(username)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid authenticator or backup recovery code.")

    await clear_failed_logins(username)
    now = utc_now()

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


# --- Account Security: 2FA/TOTP + Active Devices ---

@router.get("/security", response_model=AccountSecurityOut)
async def get_account_security(
    auth: AuthenticatedContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    user = auth.user
    now = utc_now()
    sessions = (
        await db.execute(
            select(LoginSession)
            .where(
                LoginSession.user_id == user.id,
                LoginSession.revoked_at.is_(None),
                LoginSession.expires_at > now,
            )
            .order_by(LoginSession.created_at.desc())
        )
    ).scalars().all()

    events = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.actor_id == user.id, AuditLog.action.like("auth.%"))
            .order_by(AuditLog.created_at.desc())
            .limit(15)
        )
    ).scalars().all()

    return AccountSecurityOut(
        totp_enabled=bool(user.totp_enabled),
        backup_codes_remaining=len(user.backup_codes or []),
        email_verified=bool(user.email_verified),
        active_sessions=[
            LoginSessionOut(
                id=sess.id,
                ip_address=sess.ip_address,
                user_agent=sess.user_agent,
                created_at=as_utc(sess.created_at),
                expires_at=as_utc(sess.expires_at),
                is_current=(sess.id == auth.login_session_id),
            )
            for sess in sessions
        ],
        recent_events=[
            SecurityEventOut(
                id=ev.id,
                action=ev.action,
                ip_address=ev.ip_address,
                created_at=as_utc(ev.created_at),
            )
            for ev in events
        ],
    )


@router.post("/2fa/setup", response_model=TotpSetupResponse)
async def setup_totp(auth: AuthenticatedContext = Depends(get_auth_context)):
    secret = generate_totp_secret()
    if redis_store.client is not None:
        await redis_store.client.set(f"pending_totp:{auth.user.id}", secret, ex=600)
    uri = build_otpauth_uri(secret, auth.user.username)
    return TotpSetupResponse(secret=secret, otpauth_uri=uri, qr_svg_data_uri=build_qr_svg_data_uri(uri))


@router.post("/2fa/enable", response_model=TotpEnableResponse)
async def enable_totp(
    payload: TotpCodeRequest,
    request: Request,
    auth: AuthenticatedContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    pending_secret = await redis_store.client.get(f"pending_totp:{auth.user.id}") if redis_store.client else None
    if not pending_secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No pending 2FA setup found. Start setup again.")
    if not verify_totp_code(pending_secret, payload.code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Authenticator code did not match. Check device time and retry.")

    plain_codes, hashed_codes = generate_backup_codes(8)
    auth.user.totp_secret = pending_secret
    auth.user.totp_enabled = True
    auth.user.backup_codes = hashed_codes
    if redis_store.client:
        await redis_store.client.delete(f"pending_totp:{auth.user.id}")

    record_audit(
        db,
        actor_id=auth.user.id,
        action="auth.2fa_enabled",
        target_type="user",
        target_id=auth.user.id,
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return TotpEnableResponse(enabled=True, backup_codes=plain_codes)


@router.post("/2fa/disable", status_code=status.HTTP_204_NO_CONTENT)
async def disable_totp(
    payload: TotpCodeRequest,
    request: Request,
    auth: AuthenticatedContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    user = auth.user
    if not user.totp_enabled or not user.totp_secret:
        return
    valid = verify_totp_code(user.totp_secret, payload.code)
    if not valid:
        valid, _ = consume_backup_code(payload.code, user.backup_codes)
    if not valid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid authenticator or backup code.")

    user.totp_enabled = False
    user.totp_secret = None
    user.backup_codes = None
    record_audit(
        db,
        actor_id=user.id,
        action="auth.2fa_disabled",
        target_type="user",
        target_id=user.id,
        ip_address=client_ip_from_request(request),
    )
    await db.commit()


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_login_session(
    session_id: str,
    auth: AuthenticatedContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(LoginSession)
        .where(
            LoginSession.id == session_id,
            LoginSession.user_id == auth.user.id,
            LoginSession.revoked_at.is_(None),
        )
        .values(revoked_at=utc_now(), revoked_reason="user_revoked")
    )
    await db.commit()


@router.post("/sessions/revoke-others", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_other_sessions(
    auth: AuthenticatedContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(LoginSession)
        .where(
            LoginSession.user_id == auth.user.id,
            LoginSession.id != auth.login_session_id,
            LoginSession.revoked_at.is_(None),
        )
        .values(revoked_at=utc_now(), revoked_reason="user_revoked_others")
    )
    await db.commit()
