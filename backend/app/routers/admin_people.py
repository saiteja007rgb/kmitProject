"""Admin routes for dashboard summary, candidate management, CSV import, batches, staff, and audit logs."""
import csv
import io
import re
import secrets

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import client_ip_from_request, record_audit
from app.core.clock import as_utc, utc_now
from app.core.dependencies import require_roles
from app.core.security import generate_temporary_password, hash_password, password_policy_error
from app.database import get_db
from app.models import Attempt, AuditLog, Batch, Candidate, Exam, LoginSession, User
from app.schemas.monitoring import AdminDashboardResponse, DashboardCounts
from app.schemas.people import (
    AuditLogOut,
    AuditLogPageResponse,
    BatchCreateRequest,
    BatchOut,
    BatchUpdateRequest,
    CandidateCreateRequest,
    CandidateCreateResponse,
    CandidateImportCreated,
    CandidateImportResponse,
    CandidateImportSkipped,
    CandidateOut,
    CandidatePageResponse,
    CandidateUpdateRequest,
    PasswordResetResponse,
    StaffCreateRequest,
    StaffCreateResponse,
    StaffOut,
    StaffUpdateRequest,
)
from app.services.exam_lifecycle import build_exam_summaries, effective_exam_status

router = APIRouter(prefix="/api/admin", tags=["Admin: People & System"])

USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9._-]{3,50}$")
MAX_CSV_BYTES = 1024 * 1024


def _candidate_to_out(candidate: Candidate) -> CandidateOut:
    user = candidate.user
    return CandidateOut(
        id=candidate.id,
        user_id=user.id,
        username=user.username,
        full_name=user.full_name,
        email=user.email,
        candidate_code=candidate.candidate_code,
        batch_id=candidate.batch_id,
        batch_name=candidate.batch.name if candidate.batch else None,
        is_active=user.is_active,
        last_login_at=as_utc(user.last_login_at),
        created_at=as_utc(user.created_at),
    )


def _staff_to_out(user: User) -> StaffOut:
    return StaffOut(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        last_login_at=as_utc(user.last_login_at),
    )


def _audit_to_out(log: AuditLog) -> AuditLogOut:
    return AuditLogOut(
        id=log.id,
        actor_username=log.actor.username if log.actor else None,
        action=log.action,
        target_type=log.target_type,
        target_id=log.target_id,
        details=log.details,
        ip_address=log.ip_address,
        created_at=as_utc(log.created_at),
    )


def _generate_candidate_code() -> str:
    return f"CAND-{secrets.token_hex(3).upper()}"


@router.get("/dashboard", response_model=AdminDashboardResponse)
async def get_admin_dashboard(
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    total_candidates = (await db.execute(select(func.count(Candidate.id)))).scalar() or 0
    active_candidates = (
        await db.execute(
            select(func.count(Candidate.id)).join(User, User.id == Candidate.user_id).where(User.is_active.is_(True))
        )
    ).scalar() or 0
    in_progress_sessions = (
        await db.execute(select(func.count(Attempt.id)).where(Attempt.status == "in_progress"))
    ).scalar() or 0

    exams = (await db.execute(select(Exam).order_by(Exam.created_at.desc()))).scalars().all()
    now = utc_now()
    live_exam_models = [exam for exam in exams if effective_exam_status(exam, now) in ("live", "paused")]
    live_summaries = await build_exam_summaries(live_exam_models, db)

    recent_logs = (
        await db.execute(
            select(AuditLog).options(selectinload(AuditLog.actor)).order_by(AuditLog.created_at.desc()).limit(15)
        )
    ).scalars().all()

    return AdminDashboardResponse(
        counts=DashboardCounts(
            candidates=total_candidates,
            active_candidates=active_candidates,
            exams=len(exams),
            live_exams=len(live_exam_models),
            in_progress_sessions=in_progress_sessions,
        ),
        live_exams=live_summaries,
        recent_activity=[_audit_to_out(log) for log in recent_logs],
    )


@router.get("/candidates", response_model=CandidatePageResponse)
async def list_candidates(
    search: str = Query(default="", max_length=100),
    batch_id: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    filters = []
    if search.strip():
        pattern = f"%{search.strip()}%"
        filters.append(
            or_(
                User.username.ilike(pattern),
                User.full_name.ilike(pattern),
                User.email.ilike(pattern),
                Candidate.candidate_code.ilike(pattern),
            )
        )
    if batch_id:
        filters.append(Candidate.batch_id == batch_id)
    if is_active is not None:
        filters.append(User.is_active.is_(is_active))

    count_query = select(func.count(Candidate.id)).join(User, User.id == Candidate.user_id).where(*filters)
    total = (await db.execute(count_query)).scalar() or 0

    rows = (
        await db.execute(
            select(Candidate)
            .join(User, User.id == Candidate.user_id)
            .options(selectinload(Candidate.user), selectinload(Candidate.batch))
            .where(*filters)
            .order_by(User.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return CandidatePageResponse(items=[_candidate_to_out(item) for item in rows], total=total)


@router.post("/candidates", response_model=CandidateCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_candidate(
    payload: CandidateCreateRequest,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    username = payload.username.strip()
    existing = (await db.execute(select(User.id).where(User.username == username))).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Username '{username}' already exists.")

    candidate_code = (payload.candidate_code or "").strip() or _generate_candidate_code()
    existing_code = (
        await db.execute(select(Candidate.id).where(Candidate.candidate_code == candidate_code))
    ).scalar_one_or_none()
    if existing_code:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Candidate code '{candidate_code}' already exists.")

    batch = None
    if payload.batch_id:
        batch = (await db.execute(select(Batch).where(Batch.id == payload.batch_id))).scalar_one_or_none()
        if batch is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Selected batch does not exist.")

    temporary_password: str | None = None
    if payload.password:
        error = password_policy_error(payload.password, username)
        if error:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error)
        raw_password = payload.password
        must_change = False
    else:
        raw_password = generate_temporary_password()
        temporary_password = raw_password
        must_change = True

    user = User(
        username=username,
        password_hash=await hash_password(raw_password),
        role="candidate",
        full_name=payload.full_name.strip(),
        email=payload.email.strip() if payload.email else None,
        must_change_password=must_change,
    )
    db.add(user)
    await db.flush()

    candidate = Candidate(user_id=user.id, candidate_code=candidate_code, batch_id=batch.id if batch else None)
    db.add(candidate)
    await db.flush()

    record_audit(
        db,
        actor_id=admin.id,
        action="candidate.created",
        target_type="candidate",
        target_id=candidate.id,
        details={"username": username, "candidate_code": candidate_code},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()

    candidate.user = user
    candidate.batch = batch
    return CandidateCreateResponse(candidate=_candidate_to_out(candidate), temporary_password=temporary_password)


@router.post("/candidates/import", response_model=CandidateImportResponse)
async def import_candidates_csv(
    request: Request,
    file: UploadFile = File(...),
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    if len(content) > MAX_CSV_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "CSV file must be 1 MB or smaller.")

    reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig", errors="replace")))
    if not reader.fieldnames:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSV file is empty or missing a header row.")

    existing_usernames = set((await db.execute(select(User.username))).scalars().all())
    existing_codes = set((await db.execute(select(Candidate.candidate_code))).scalars().all())
    batches_by_name = {batch.name.lower(): batch for batch in (await db.execute(select(Batch))).scalars().all()}

    created: list[CandidateImportCreated] = []
    skipped: list[CandidateImportSkipped] = []

    for row_number, raw_row in enumerate(reader, start=2):
        row = {str(k).strip().lower(): (v or "").strip() for k, v in raw_row.items() if k is not None}
        username = row.get("username", "")
        full_name = row.get("full_name") or row.get("name") or ""
        email = row.get("email") or None
        candidate_code = row.get("candidate_code") or row.get("code") or ""
        batch_name = row.get("batch", "")

        if not USERNAME_PATTERN.match(username):
            skipped.append(CandidateImportSkipped(row=row_number, username=username, reason="Invalid username format"))
            continue
        if len(full_name) < 2:
            skipped.append(CandidateImportSkipped(row=row_number, username=username, reason="Full name is required"))
            continue
        if username in existing_usernames:
            skipped.append(CandidateImportSkipped(row=row_number, username=username, reason="Username already exists"))
            continue

        if not candidate_code:
            candidate_code = _generate_candidate_code()
            while candidate_code in existing_codes:
                candidate_code = _generate_candidate_code()
        elif candidate_code in existing_codes:
            skipped.append(CandidateImportSkipped(row=row_number, username=username, reason="Duplicate candidate code"))
            continue

        batch_id = None
        if batch_name:
            batch = batches_by_name.get(batch_name.lower())
            if batch is None:
                batch = Batch(name=batch_name[:80])
                db.add(batch)
                await db.flush()
                batches_by_name[batch_name.lower()] = batch
            batch_id = batch.id

        temp_password = generate_temporary_password()
        user = User(
            username=username,
            password_hash=await hash_password(temp_password),
            role="candidate",
            full_name=full_name[:120],
            email=email[:254] if email else None,
            must_change_password=True,
        )
        db.add(user)
        await db.flush()

        db.add(Candidate(user_id=user.id, candidate_code=candidate_code[:30], batch_id=batch_id))
        existing_usernames.add(username)
        existing_codes.add(candidate_code)
        created.append(
            CandidateImportCreated(
                username=username,
                full_name=full_name,
                candidate_code=candidate_code,
                temporary_password=temp_password,
            )
        )

    record_audit(
        db,
        actor_id=admin.id,
        action="candidate.bulk_imported",
        target_type="candidate",
        details={"created": len(created), "skipped": len(skipped)},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return CandidateImportResponse(created=created, skipped=skipped)


@router.patch("/candidates/{candidate_id}", response_model=CandidateOut)
async def update_candidate(
    candidate_id: str,
    payload: CandidateUpdateRequest,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    candidate = (
        await db.execute(
            select(Candidate)
            .options(selectinload(Candidate.user), selectinload(Candidate.batch))
            .where(Candidate.id == candidate_id)
        )
    ).scalar_one_or_none()
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Candidate not found.")

    if "full_name" in payload.model_fields_set and payload.full_name is not None:
        candidate.user.full_name = payload.full_name.strip()
    if "email" in payload.model_fields_set:
        candidate.user.email = payload.email.strip() if payload.email else None
    if "batch_id" in payload.model_fields_set:
        if payload.batch_id is None:
            candidate.batch_id = None
            candidate.batch = None
        else:
            batch = (await db.execute(select(Batch).where(Batch.id == payload.batch_id))).scalar_one_or_none()
            if batch is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Batch not found.")
            candidate.batch_id = batch.id
            candidate.batch = batch
    if "is_active" in payload.model_fields_set and payload.is_active is not None:
        candidate.user.is_active = payload.is_active
        if not payload.is_active:
            await db.execute(
                update(LoginSession)
                .where(LoginSession.user_id == candidate.user_id, LoginSession.revoked_at.is_(None))
                .values(revoked_at=utc_now(), revoked_reason="account_deactivated")
            )

    record_audit(
        db,
        actor_id=admin.id,
        action="candidate.updated",
        target_type="candidate",
        target_id=candidate.id,
        details=payload.model_dump(exclude_unset=True),
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return _candidate_to_out(candidate)


@router.post("/candidates/{candidate_id}/reset-password", response_model=PasswordResetResponse)
async def reset_candidate_password(
    candidate_id: str,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    candidate = (
        await db.execute(select(Candidate).options(selectinload(Candidate.user)).where(Candidate.id == candidate_id))
    ).scalar_one_or_none()
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Candidate not found.")

    temp_password = generate_temporary_password()
    candidate.user.password_hash = await hash_password(temp_password)
    candidate.user.must_change_password = True
    await db.execute(
        update(LoginSession)
        .where(LoginSession.user_id == candidate.user_id, LoginSession.revoked_at.is_(None))
        .values(revoked_at=utc_now(), revoked_reason="password_reset")
    )
    record_audit(
        db,
        actor_id=admin.id,
        action="candidate.password_reset",
        target_type="candidate",
        target_id=candidate.id,
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return PasswordResetResponse(temporary_password=temp_password)


@router.delete("/candidates/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_candidate(
    candidate_id: str,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    candidate = (
        await db.execute(select(Candidate).options(selectinload(Candidate.user)).where(Candidate.id == candidate_id))
    ).scalar_one_or_none()
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Candidate not found.")

    has_attempts = (
        await db.execute(select(Attempt.id).where(Attempt.candidate_id == candidate.id).limit(1))
    ).scalar_one_or_none()
    if has_attempts:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Candidate has exam attempts and cannot be deleted. Deactivate the account instead.",
        )

    username = candidate.user.username
    await db.delete(candidate.user)
    record_audit(
        db,
        actor_id=admin.id,
        action="candidate.deleted",
        target_type="candidate",
        target_id=candidate_id,
        details={"username": username},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()


@router.get("/staff", response_model=list[StaffOut])
async def list_staff(
    _admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    users = (
        await db.execute(select(User).where(User.role.in_(("admin", "invigilator"))).order_by(User.created_at.asc()))
    ).scalars().all()
    return [_staff_to_out(user) for user in users]


@router.post("/staff", response_model=StaffCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_staff(
    payload: StaffCreateRequest,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    username = payload.username.strip()
    if (await db.execute(select(User.id).where(User.username == username))).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, f"Username '{username}' already exists.")

    temporary_password: str | None = None
    if payload.password:
        error = password_policy_error(payload.password, username)
        if error:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error)
        raw_password = payload.password
        must_change = False
    else:
        raw_password = generate_temporary_password()
        temporary_password = raw_password
        must_change = True

    staff_user = User(
        username=username,
        password_hash=await hash_password(raw_password),
        role=payload.role,
        full_name=payload.full_name.strip(),
        must_change_password=must_change,
    )
    db.add(staff_user)
    await db.flush()
    record_audit(
        db,
        actor_id=admin.id,
        action="staff.created",
        target_type="user",
        target_id=staff_user.id,
        details={"username": username, "role": payload.role},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return StaffCreateResponse(staff=_staff_to_out(staff_user), temporary_password=temporary_password)


@router.patch("/staff/{user_id}", response_model=StaffOut)
async def update_staff(
    user_id: str,
    payload: StaffUpdateRequest,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    staff_user = (
        await db.execute(select(User).where(User.id == user_id, User.role.in_(("admin", "invigilator"))))
    ).scalar_one_or_none()
    if staff_user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Staff account not found.")

    if payload.is_active is False and staff_user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate your own account.")

    if payload.full_name is not None:
        staff_user.full_name = payload.full_name.strip()
    if payload.is_active is not None:
        staff_user.is_active = payload.is_active
        if not payload.is_active:
            await db.execute(
                update(LoginSession)
                .where(LoginSession.user_id == staff_user.id, LoginSession.revoked_at.is_(None))
                .values(revoked_at=utc_now(), revoked_reason="account_deactivated")
            )

    record_audit(
        db,
        actor_id=admin.id,
        action="staff.updated",
        target_type="user",
        target_id=staff_user.id,
        details=payload.model_dump(exclude_unset=True),
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return _staff_to_out(staff_user)


@router.get("/batches", response_model=list[BatchOut])
async def list_batches(
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Batch, func.count(Candidate.id))
            .outerjoin(Candidate, Candidate.batch_id == Batch.id)
            .group_by(Batch.id)
            .order_by(Batch.name.asc())
        )
    ).all()
    return [
        BatchOut(id=batch.id, name=batch.name, description=batch.description, candidate_count=int(count))
        for batch, count in rows
    ]


@router.post("/batches", response_model=BatchOut, status_code=status.HTTP_201_CREATED)
async def create_batch(
    payload: BatchCreateRequest,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    name = payload.name.strip()
    if (await db.execute(select(Batch.id).where(func.lower(Batch.name) == name.lower()))).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, f"Batch '{name}' already exists.")

    batch = Batch(name=name, description=payload.description.strip() if payload.description else None)
    db.add(batch)
    await db.flush()
    record_audit(
        db,
        actor_id=admin.id,
        action="batch.created",
        target_type="batch",
        target_id=batch.id,
        details={"name": name},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return BatchOut(id=batch.id, name=batch.name, description=batch.description, candidate_count=0)


@router.patch("/batches/{batch_id}", response_model=BatchOut)
async def update_batch(
    batch_id: str,
    payload: BatchUpdateRequest,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    batch = (await db.execute(select(Batch).where(Batch.id == batch_id))).scalar_one_or_none()
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Batch not found.")

    if payload.name is not None:
        name = payload.name.strip()
        dup = (
            await db.execute(select(Batch.id).where(func.lower(Batch.name) == name.lower(), Batch.id != batch.id))
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Batch '{name}' already exists.")
        batch.name = name
    if "description" in payload.model_fields_set:
        batch.description = payload.description.strip() if payload.description else None

    record_audit(
        db,
        actor_id=admin.id,
        action="batch.updated",
        target_type="batch",
        target_id=batch.id,
        ip_address=client_ip_from_request(request),
    )
    await db.commit()

    count = (await db.execute(select(func.count(Candidate.id)).where(Candidate.batch_id == batch.id))).scalar() or 0
    return BatchOut(id=batch.id, name=batch.name, description=batch.description, candidate_count=int(count))


@router.delete("/batches/{batch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_batch(
    batch_id: str,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    batch = (await db.execute(select(Batch).where(Batch.id == batch_id))).scalar_one_or_none()
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Batch not found.")

    # Explicitly clear candidate batch_id for SQLite/Postgres parity before deletion.
    await db.execute(update(Candidate).where(Candidate.batch_id == batch.id).values(batch_id=None))
    await db.delete(batch)
    record_audit(
        db,
        actor_id=admin.id,
        action="batch.deleted",
        target_type="batch",
        target_id=batch_id,
        details={"name": batch.name},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()


@router.get("/audit-logs", response_model=AuditLogPageResponse)
async def list_audit_logs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    _admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    total = (await db.execute(select(func.count(AuditLog.id)))).scalar() or 0
    logs = (
        await db.execute(
            select(AuditLog)
            .options(selectinload(AuditLog.actor))
            .order_by(AuditLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    return AuditLogPageResponse(items=[_audit_to_out(log) for log in logs], total=total)
