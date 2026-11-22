"""Password hashing, password policy, JWT access tokens and opaque refresh tokens."""
import asyncio
import hashlib
import secrets
import string
from datetime import timedelta

import bcrypt
import jwt

from app.config import settings
from app.core.clock import utc_now

ACCESS_TOKEN_TYPE = "access"
TEMPORARY_PASSWORD_ALPHABET = "".join(set(string.ascii_letters + string.digits) - set("Il1O0o"))


def hash_password_sync(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=settings.bcrypt_rounds)).decode()


async def hash_password(password: str) -> str:
    # bcrypt is deliberately slow (~250 ms); a worker thread keeps the event loop serving other requests.
    return await asyncio.to_thread(hash_password_sync, password)


async def verify_password(password: str, password_hash: str) -> bool:
    try:
        return await asyncio.to_thread(bcrypt.checkpw, password.encode(), password_hash.encode())
    except ValueError:
        return False


def password_policy_error(password: str, username: str) -> str | None:
    if len(password) < 8:
        return "Password must be at least 8 characters."
    if len(password) > 128:
        return "Password must be at most 128 characters."
    if not any(char.isalpha() for char in password) or not any(char.isdigit() for char in password):
        return "Password must contain at least one letter and one digit."
    if password.lower() == username.lower():
        return "Password must not be the same as the username."
    return None


def generate_temporary_password(length: int = 12) -> str:
    while True:
        password = "".join(secrets.choice(TEMPORARY_PASSWORD_ALPHABET) for _ in range(length))
        if password_policy_error(password, username="") is None:
            return password


def create_access_token(user_id: str, role: str, login_session_id: str) -> str:
    issued_at = utc_now()
    claims = {
        "sub": user_id,
        "role": role,
        "sid": login_session_id,
        "type": ACCESS_TOKEN_TYPE,
        "iat": issued_at,
        "exp": issued_at + timedelta(minutes=settings.access_token_minutes),
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict | None:
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], options={"require": ["exp", "sub", "sid"]})
    except jwt.PyJWTError:
        return None
    return claims if claims.get("type") == ACCESS_TOKEN_TYPE else None


def new_refresh_token() -> tuple[str, str]:
    """Returns (token for the cookie, hash for the database). Only the hash is ever stored."""
    token = secrets.token_urlsafe(48)
    return token, hash_refresh_token(token)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

