"""Audit log recording and safe client IP extraction."""
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AuditLog


def client_ip_from_request(request: Request) -> str | None:
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()[:45]
    return request.client.host[:45] if request.client and request.client.host else None


def record_audit(
    db: AsyncSession,
    *,
    actor_id: str | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict | None = None,
    ip_address: str | None = None,
) -> None:
    """Stages an audit record in the current transaction (committed alongside the caller's change)."""
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details,
            ip_address=ip_address,
        )
    )
