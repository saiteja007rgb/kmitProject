"""FastAPI authentication and role-based access control dependencies."""
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.clock import as_utc, utc_now
from app.core.security import decode_access_token
from app.database import get_db
from app.models import Candidate, LoginSession, User

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthenticatedContext:
    user: User
    login_session_id: str


async def _load_authenticated_context(token: str, db: AsyncSession) -> AuthenticatedContext:
    claims = decode_access_token(token)
    if claims is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired access token.")

    user_id = claims["sub"]
    login_session_id = claims["sid"]

    session_result = await db.execute(select(LoginSession).where(LoginSession.id == login_session_id))
    login_session = session_result.scalar_one_or_none()
    if login_session is None or login_session.user_id != user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session is not valid.")
    if login_session.revoked_at is not None:
        if login_session.revoked_reason == "new_device_login":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session ended: you signed in on another device.")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session has been signed out.")
    if as_utc(login_session.expires_at) <= utc_now():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session has expired.")

    user_result = await db.execute(
        select(User)
        .options(selectinload(User.candidate).selectinload(Candidate.batch))
        .where(User.id == user_id)
    )
    user = user_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account no longer exists.")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account has been deactivated.")

    return AuthenticatedContext(user=user, login_session_id=login_session_id)


async def get_auth_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> AuthenticatedContext:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required.")
    return await _load_authenticated_context(credentials.credentials, db)


async def get_current_user(context: AuthenticatedContext = Depends(get_auth_context)) -> User:
    return context.user


async def get_current_candidate(user: User = Depends(get_current_user)) -> Candidate:
    if user.role != "candidate" or user.candidate is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Candidate access required.")
    return user.candidate


def require_roles(*allowed_roles: str):
    async def check_role(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have permission for this action.")
        return user

    return check_role


async def authenticate_websocket_token(token: str | None, db: AsyncSession) -> User | None:
    """Validates a JWT passed on WebSocket connect; returns None instead of raising HTTPException."""
    if not token:
        return None
    try:
        context = await _load_authenticated_context(token, db)
    except HTTPException:
        return None
    return context.user

