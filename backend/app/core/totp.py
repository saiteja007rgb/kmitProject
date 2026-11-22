"""RFC 6238 TOTP (Two-Factor Authentication), QR SVG generation, recovery codes, and 6-digit OTPs."""
import base64
import hashlib
import hmac
import io
import secrets
import struct
import time
from urllib.parse import quote

import segno

from app.core.redis_store import redis_store

TOTP_PERIOD_SECONDS = 30
TOTP_DIGITS = 6
OTP_TTL_SECONDS = 600


def generate_totp_secret() -> str:
    """Generates a 160-bit Base32 secret compatible with Google Authenticator / Authy / 1Password."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _totp_at_counter(secret: str, counter: int) -> str:
    padded = secret.upper() + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code_int = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % (10**TOTP_DIGITS)
    return str(code_int).zfill(TOTP_DIGITS)


def verify_totp_code(secret: str, submitted_code: str, drift_steps: int = 1) -> bool:
    clean = submitted_code.strip().replace(" ", "")
    if not clean.isdigit() or len(clean) != TOTP_DIGITS:
        return False
    current_counter = int(time.time() // TOTP_PERIOD_SECONDS)
    for delta in range(-drift_steps, drift_steps + 1):
        expected = _totp_at_counter(secret, current_counter + delta)
        if hmac.compare_digest(clean, expected):
            return True
    return False


def build_otpauth_uri(secret: str, username: str, issuer: str = "ExamPulse") -> str:
    label = quote(f"{issuer}:{username}")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}&digits={TOTP_DIGITS}&period={TOTP_PERIOD_SECONDS}"


def build_qr_svg_data_uri(otpauth_uri: str) -> str:
    qr = segno.make(otpauth_uri, error="m")
    buffer = io.BytesIO()
    qr.save(buffer, kind="svg", scale=5, border=2, xmldecl=False)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def generate_backup_codes(count: int = 8) -> tuple[list[str], list[str]]:
    """Returns (plaintext codes shown once, SHA-256 hashes stored in DB)."""
    plain: list[str] = []
    hashed: list[str] = []
    for _ in range(count):
        raw = secrets.token_hex(4).upper()
        formatted = f"{raw[:4]}-{raw[4:]}"
        plain.append(formatted)
        hashed.append(hash_otp_value(formatted))
    return plain, hashed


def hash_otp_value(value: str) -> str:
    normalized = value.strip().upper().replace("-", "").replace(" ", "")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def consume_backup_code(submitted: str, stored_hashes: list[str] | None) -> tuple[bool, list[str]]:
    if not stored_hashes:
        return False, []
    digest = hash_otp_value(submitted)
    remaining: list[str] = []
    matched = False
    for existing in stored_hashes:
        if not matched and hmac.compare_digest(existing, digest):
            matched = True
            continue
        remaining.append(existing)
    return matched, remaining


async def issue_six_digit_otp(purpose: str, identifier: str) -> str:
    """Stores a hashed 6-digit single-use verification/reset OTP in Redis for 10 minutes."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    if redis_store.client is not None:
        key = f"otp:{purpose}:{identifier.lower()}"
        await redis_store.client.set(key, hash_otp_value(code), ex=OTP_TTL_SECONDS)
    return code


async def verify_and_consume_otp(purpose: str, identifier: str, submitted: str) -> bool:
    if redis_store.client is None:
        return False
    key = f"otp:{purpose}:{identifier.lower()}"
    stored = await redis_store.client.get(key)
    if not stored:
        return False
    if hmac.compare_digest(stored, hash_otp_value(submitted)):
        await redis_store.client.delete(key)
        return True
    return False
