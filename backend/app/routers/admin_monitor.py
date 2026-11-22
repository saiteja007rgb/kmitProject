"""Admin/invigilator live monitoring, attempt inspection, snapshots, announcements, grading, analytics, and CSV export."""
import csv
import io
import statistics
from collections import Counter, defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import client_ip_from_request, record_audit
from app.core.clock import as_utc, utc_now
from app.core.dependencies import require_roles
from app.core.redis_store import attempt_channel, exam_channel, redis_store
from app.database import get_db
from app.models import (
    Announcement,
    Answer,
    Attempt,
    Candidate,
    CollusionFlag,
    Enrollment,
    Exam,
    ProctoringEvent,
    Question,
    Snapshot,
    User,
)
from app.schemas.exams import ExtendTimeRequest
from app.schemas.monitoring import (
    AnalyticsStats,
    AnnouncementCreateRequest,
    AnnouncementOut,
    AttemptAnswerDetail,
    AttemptDetail,
    AttemptDetailCandidate,
    AttemptEventItem,
    AttemptSnapshotItem,
    CollusionFlagOut,
    CollusionScanResponse,
    ExamAnalytics,
    ExtendAttemptResponse,
    ForceSubmitResponse,
    GradeAnswerRequest,
    GradeAnswerResponse,
    GradingQueueItem,
    LeaderboardEntry,
    LiveBoard,
    LiveBoardCounts,
    LiveCandidateRow,
    QuestionAnalytics,
    ScoreBucket,
)
from app.services.collusion import run_collusion_scan
from app.services.exam_lifecycle import build_exam_summaries
from app.services.scoring import finalize_attempt, is_response_answered, recalculate_attempt_score
from app.services.snapshot_storage import delete_snapshots, read_jpeg_snapshot

router = APIRouter(prefix="/api/admin", tags=["Admin: Live Monitoring & Analytics"])

ONLINE_HEARTBEAT_SECONDS = 45
PASS_THRESHOLD_PERCENT = 40.0


def _csv_safe(value: object) -> str:
    """Prevents spreadsheet formula injection when exported CSVs are opened in Excel."""
    text = "" if value is None else str(value)
    return f"'{text}" if text and text[0] in ("=", "+", "-", "@") else text


async def _get_exam_or_404(exam_id: str, db: AsyncSession) -> Exam:
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found.")
    return exam


@router.get("/exams/{exam_id}/live", response_model=LiveBoard)
async def get_live_board(
    exam_id: str,
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    exam = await _get_exam_or_404(exam_id, db)
    summary = (await build_exam_summaries([exam], db))[0]

    enrolled_rows = (
        await db.execute(
            select(Enrollment, Candidate, Attempt)
            .join(Candidate, Candidate.id == Enrollment.candidate_id)
            .outerjoin(
                Attempt,
                (Attempt.candidate_id == Enrollment.candidate_id) & (Attempt.exam_id == Enrollment.exam_id),
            )
            .options(selectinload(Candidate.user), selectinload(Candidate.batch))
            .where(Enrollment.exam_id == exam_id)
            .order_by(Candidate.candidate_code.asc())
        )
    ).all()

    attempt_ids = [attempt.id for _, _, attempt in enrolled_rows if attempt is not None]
    question_kinds = dict(
        (await db.execute(select(Question.id, Question.kind).where(Question.exam_id == exam_id))).all()
    )

    answered_counts: dict[str, int] = Counter()
    latest_snapshot_by_attempt: dict[str, str] = {}
    if attempt_ids:
        answer_rows = (
            await db.execute(
                select(Answer.attempt_id, Answer.question_id, Answer.response).where(Answer.attempt_id.in_(attempt_ids))
            )
        ).all()
        for attempt_id, question_id, response in answer_rows:
            kind = question_kinds.get(question_id, "mcq_single")
            if is_response_answered(kind, response):
                answered_counts[attempt_id] += 1

        snapshot_rows = (
            await db.execute(
                select(Snapshot.attempt_id, Snapshot.id)
                .where(Snapshot.attempt_id.in_(attempt_ids))
                .order_by(Snapshot.captured_at.desc())
            )
        ).all()
        for attempt_id, snapshot_id in snapshot_rows:
            latest_snapshot_by_attempt.setdefault(attempt_id, snapshot_id)

    collusion_pairs = (
        await db.execute(
            select(CollusionFlag.candidate_a_id, CollusionFlag.candidate_b_id).where(CollusionFlag.exam_id == exam_id)
        )
    ).all()
    collusion_candidates = {cid for pair in collusion_pairs for cid in pair}

    now = utc_now()
    online_cutoff = now - timedelta(seconds=ONLINE_HEARTBEAT_SECONDS)

    rows: list[LiveCandidateRow] = []
    not_started = in_progress = submitted = flagged = 0
    progress_fractions: list[float] = []

    for _, candidate, attempt in enrolled_rows:
        is_collusion = candidate.id in collusion_candidates
        if attempt is None:
            not_started += 1
            rows.append(
                LiveCandidateRow(
                    candidate_id=candidate.id,
                    attempt_id=None,
                    candidate_code=candidate.candidate_code,
                    full_name=candidate.user.full_name,
                    batch_name=candidate.batch.name if candidate.batch else None,
                    status="not_started",
                    answered_count=0,
                    total_questions=summary.question_count,
                    violation_count=0,
                    last_seen_at=None,
                    is_online=False,
                    deadline=None,
                    score=None,
                    max_score=summary.total_marks,
                    submit_reason=None,
                    latest_snapshot_id=None,
                    collusion_flagged=is_collusion,
                )
            )
            continue

        if attempt.status == "in_progress":
            in_progress += 1
        else:
            submitted += 1

        if attempt.violation_count > 0 or is_collusion:
            flagged += 1

        total_q = len(attempt.question_order) if attempt.question_order else summary.question_count
        answered = answered_counts.get(attempt.id, 0)
        if total_q > 0:
            progress_fractions.append(min(1.0, answered / total_q))

        last_seen = as_utc(attempt.last_seen_at)
        is_online = attempt.status == "in_progress" and last_seen is not None and last_seen >= online_cutoff

        rows.append(
            LiveCandidateRow(
                candidate_id=candidate.id,
                attempt_id=attempt.id,
                candidate_code=candidate.candidate_code,
                full_name=candidate.user.full_name,
                batch_name=candidate.batch.name if candidate.batch else None,
                status=attempt.status,
                answered_count=answered,
                total_questions=total_q,
                violation_count=attempt.violation_count,
                last_seen_at=last_seen,
                is_online=is_online,
                deadline=as_utc(attempt.deadline),
                score=attempt.score,
                max_score=attempt.max_score or summary.total_marks,
                submit_reason=attempt.submit_reason,
                latest_snapshot_id=latest_snapshot_by_attempt.get(attempt.id),
                collusion_flagged=is_collusion,
            )
        )

    avg_progress = round(sum(progress_fractions) / len(progress_fractions), 3) if progress_fractions else 0.0
    return LiveBoard(
        exam=summary,
        counts=LiveBoardCounts(
            enrolled=len(enrolled_rows),
            not_started=not_started,
            in_progress=in_progress,
            submitted=submitted,
            flagged=flagged,
        ),
        average_progress=avg_progress,
        candidates=rows,
    )


@router.get("/attempts/{attempt_id}", response_model=AttemptDetail)
async def get_attempt_detail(
    attempt_id: str,
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    attempt = (
        await db.execute(
            select(Attempt)
            .options(selectinload(Attempt.candidate).selectinload(Candidate.user), selectinload(Attempt.candidate).selectinload(Candidate.batch))
            .where(Attempt.id == attempt_id)
        )
    ).scalar_one_or_none()
    if attempt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found.")

    events = (
        await db.execute(
            select(ProctoringEvent).where(ProctoringEvent.attempt_id == attempt.id).order_by(ProctoringEvent.occurred_at.desc())
        )
    ).scalars().all()
    snapshots = (
        await db.execute(
            select(Snapshot).where(Snapshot.attempt_id == attempt.id).order_by(Snapshot.captured_at.desc())
        )
    ).scalars().all()
    questions = (
        await db.execute(select(Question).where(Question.exam_id == attempt.exam_id).order_by(Question.position.asc()))
    ).scalars().all()
    answers = (
        await db.execute(select(Answer).where(Answer.attempt_id == attempt.id))
    ).scalars().all()
    answers_by_question = {answer.question_id: answer for answer in answers}

    candidate = attempt.candidate
    return AttemptDetail(
        attempt_id=attempt.id,
        status=attempt.status,
        started_at=as_utc(attempt.started_at),
        deadline=as_utc(attempt.deadline),
        submitted_at=as_utc(attempt.submitted_at),
        submit_reason=attempt.submit_reason,
        score=attempt.score,
        max_score=attempt.max_score,
        violation_count=attempt.violation_count,
        client_ip=attempt.client_ip,
        user_agent=attempt.user_agent,
        candidate=AttemptDetailCandidate(
            candidate_id=candidate.id,
            candidate_code=candidate.candidate_code,
            full_name=candidate.user.full_name,
            batch_name=candidate.batch.name if candidate.batch else None,
        ),
        events=[
            AttemptEventItem(
                id=ev.id,
                kind=ev.kind,
                detail=ev.detail,
                counted_as_violation=ev.counted_as_violation,
                occurred_at=as_utc(ev.occurred_at),
            )
            for ev in events
        ],
        snapshots=[
            AttemptSnapshotItem(
                id=snap.id,
                captured_at=as_utc(snap.captured_at),
                reason=snap.reason,
                face_count=snap.face_count,
            )
            for snap in snapshots
        ],
        answers=[
            AttemptAnswerDetail(
                question_id=question.id,
                position=question.position,
                kind=question.kind,
                prompt=question.prompt,
                response=answers_by_question[question.id].response if question.id in answers_by_question else None,
                awarded_marks=answers_by_question[question.id].awarded_marks if question.id in answers_by_question else None,
                max_marks=question.marks,
                is_correct=answers_by_question[question.id].is_correct if question.id in answers_by_question else None,
            )
            for question in questions
        ],
    )


@router.get("/snapshots/{snapshot_id}")
async def get_snapshot_image(
    snapshot_id: str,
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    exists = (await db.execute(select(Snapshot.id).where(Snapshot.id == snapshot_id))).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Snapshot not found.")
    image_bytes = read_jpeg_snapshot(snapshot_id)
    return Response(content=image_bytes, media_type="image/jpeg")


@router.post("/attempts/{attempt_id}/extend", response_model=ExtendAttemptResponse)
async def extend_single_attempt(
    attempt_id: str,
    payload: ExtendTimeRequest,
    request: Request,
    staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    attempt = (await db.execute(select(Attempt).where(Attempt.id == attempt_id))).scalar_one_or_none()
    if attempt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found.")
    if attempt.status != "in_progress":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only an in-progress attempt can be extended.")

    attempt.deadline = as_utc(attempt.deadline) + timedelta(minutes=payload.minutes)
    record_audit(
        db,
        actor_id=staff.id,
        action="attempt.extended",
        target_type="attempt",
        target_id=attempt.id,
        details={"minutes": payload.minutes},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()

    remaining = max(0, int((as_utc(attempt.deadline) - utc_now()).total_seconds()))
    redis_store.publish_in_background(
        attempt_channel(attempt.id),
        "deadline_changed",
        deadline=as_utc(attempt.deadline).isoformat(),
        remaining_seconds=remaining,
    )
    return ExtendAttemptResponse(deadline=as_utc(attempt.deadline))


@router.post("/attempts/{attempt_id}/force-submit", response_model=ForceSubmitResponse)
async def force_submit_attempt(
    attempt_id: str,
    request: Request,
    staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    attempt = (await db.execute(select(Attempt).where(Attempt.id == attempt_id))).scalar_one_or_none()
    if attempt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found.")

    await finalize_attempt(attempt, submit_reason="forced", db=db)
    record_audit(
        db,
        actor_id=staff.id,
        action="attempt.force_submitted",
        target_type="attempt",
        target_id=attempt.id,
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return ForceSubmitResponse(status="submitted")


@router.post("/attempts/{attempt_id}/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_attempt(
    attempt_id: str,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    attempt = (await db.execute(select(Attempt).where(Attempt.id == attempt_id))).scalar_one_or_none()
    if attempt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found.")

    snapshot_ids = (
        await db.execute(select(Snapshot.id).where(Snapshot.attempt_id == attempt.id))
    ).scalars().all()

    exam_id = attempt.exam_id
    candidate_id = attempt.candidate_id
    await db.delete(attempt)
    record_audit(
        db,
        actor_id=admin.id,
        action="attempt.reset",
        target_type="attempt",
        target_id=attempt_id,
        details={"exam_id": exam_id, "candidate_id": candidate_id},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    delete_snapshots(list(snapshot_ids))


@router.get("/exams/{exam_id}/announcements", response_model=list[AnnouncementOut])
async def list_announcements(
    exam_id: str,
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    await _get_exam_or_404(exam_id, db)
    items = (
        await db.execute(
            select(Announcement)
            .options(selectinload(Announcement.author))
            .where(Announcement.exam_id == exam_id)
            .order_by(Announcement.created_at.desc())
        )
    ).scalars().all()
    return [
        AnnouncementOut(
            id=item.id,
            message=item.message,
            author=item.author.full_name if item.author else "Invigilator",
            created_at=as_utc(item.created_at),
        )
        for item in items
    ]


@router.post("/exams/{exam_id}/announcements", response_model=AnnouncementOut, status_code=status.HTTP_201_CREATED)
async def create_announcement(
    exam_id: str,
    payload: AnnouncementCreateRequest,
    request: Request,
    staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    await _get_exam_or_404(exam_id, db)
    announcement = Announcement(exam_id=exam_id, message=payload.message.strip(), author_id=staff.id)
    db.add(announcement)
    await db.flush()
    record_audit(
        db,
        actor_id=staff.id,
        action="exam.announcement_sent",
        target_type="exam",
        target_id=exam_id,
        details={"message": announcement.message},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()

    created_at = as_utc(announcement.created_at)
    redis_store.publish_in_background(
        exam_channel(exam_id),
        "announcement",
        id=announcement.id,
        message=announcement.message,
        created_at=created_at.isoformat(),
    )
    return AnnouncementOut(
        id=announcement.id,
        message=announcement.message,
        author=staff.full_name,
        created_at=created_at,
    )


@router.get("/exams/{exam_id}/leaderboard", response_model=list[LeaderboardEntry])
async def get_leaderboard(
    exam_id: str,
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    await _get_exam_or_404(exam_id, db)
    rows = (
        await db.execute(
            select(Attempt, Candidate)
            .join(Candidate, Candidate.id == Attempt.candidate_id)
            .options(selectinload(Candidate.user))
            .where(Attempt.exam_id == exam_id, Attempt.status == "submitted")
            .order_by(desc(Attempt.score), Attempt.submitted_at.asc())
        )
    ).all()

    entries: list[LeaderboardEntry] = []
    for rank, (attempt, candidate) in enumerate(rows, start=1):
        max_score = attempt.max_score or 0.0
        score = attempt.score or 0.0
        pct = round((score / max_score) * 100, 1) if max_score > 0 else 0.0
        duration = 0
        if attempt.submitted_at and attempt.started_at:
            duration = max(0, int((as_utc(attempt.submitted_at) - as_utc(attempt.started_at)).total_seconds()))
        entries.append(
            LeaderboardEntry(
                rank=rank,
                candidate_code=candidate.candidate_code,
                full_name=candidate.user.full_name,
                score=score,
                max_score=max_score,
                percentage=pct,
                submitted_at=as_utc(attempt.submitted_at),
                duration_seconds=duration,
            )
        )
    return entries


@router.post("/exams/{exam_id}/collusion-scan", response_model=CollusionScanResponse)
async def trigger_collusion_scan(
    exam_id: str,
    request: Request,
    staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    await _get_exam_or_404(exam_id, db)
    flags = await run_collusion_scan(exam_id, db)
    record_audit(
        db,
        actor_id=staff.id,
        action="exam.collusion_scanned",
        target_type="exam",
        target_id=exam_id,
        details={"flags_detected": len(flags)},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return CollusionScanResponse(flags_detected=len(flags))


@router.get("/exams/{exam_id}/collusion-flags", response_model=list[CollusionFlagOut])
async def list_collusion_flags(
    exam_id: str,
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    await _get_exam_or_404(exam_id, db)
    flags = (
        await db.execute(
            select(CollusionFlag)
            .options(
                selectinload(CollusionFlag.candidate_a).selectinload(Candidate.user),
                selectinload(CollusionFlag.candidate_b).selectinload(Candidate.user),
            )
            .where(CollusionFlag.exam_id == exam_id)
            .order_by(desc(CollusionFlag.similarity_score))
        )
    ).scalars().all()
    return [
        CollusionFlagOut(
            id=flag.id,
            candidate_a_code=flag.candidate_a.candidate_code,
            candidate_a_name=flag.candidate_a.user.full_name,
            candidate_b_code=flag.candidate_b.candidate_code,
            candidate_b_name=flag.candidate_b.user.full_name,
            similarity_score=flag.similarity_score,
            risk_level=flag.risk_level,
            reason=flag.reason,
            evidence=flag.evidence,
            created_at=as_utc(flag.created_at),
        )
        for flag in flags
    ]


@router.get("/exams/{exam_id}/analytics", response_model=ExamAnalytics)
async def get_exam_analytics(
    exam_id: str,
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    await _get_exam_or_404(exam_id, db)
    attempts = (await db.execute(select(Attempt).where(Attempt.exam_id == exam_id))).scalars().all()
    submitted = [attempt for attempt in attempts if attempt.status == "submitted"]

    scores = [float(attempt.score or 0.0) for attempt in submitted]
    percentages = [
        (float(attempt.score or 0.0) / attempt.max_score) * 100.0 if attempt.max_score else 0.0
        for attempt in submitted
    ]

    if scores:
        mean_val = round(statistics.fmean(scores), 2)
        median_val = round(statistics.median(scores), 2)
        highest_val = round(max(scores), 2)
        lowest_val = round(min(scores), 2)
        std_dev_val = round(statistics.pstdev(scores), 2) if len(scores) > 1 else 0.0
        pass_rate = round(sum(1 for pct in percentages if pct >= PASS_THRESHOLD_PERCENT) / len(percentages) * 100, 1)
    else:
        mean_val = median_val = highest_val = lowest_val = std_dev_val = pass_rate = 0.0

    buckets = [0] * 10
    for pct in percentages:
        bucket_idx = min(9, max(0, int(pct // 10)))
        buckets[bucket_idx] += 1
    histogram = [ScoreBucket(label=f"{i * 10}-{(i + 1) * 10}%", count=buckets[i]) for i in range(10)]

    questions = (
        await db.execute(select(Question).where(Question.exam_id == exam_id).order_by(Question.position.asc()))
    ).scalars().all()
    submitted_ids = [attempt.id for attempt in submitted]

    attempted_counts: dict[str, int] = defaultdict(int)
    correct_counts: dict[str, int] = defaultdict(int)
    if submitted_ids:
        ans_rows = (
            await db.execute(
                select(Answer.question_id, Answer.response, Answer.is_correct).where(Answer.attempt_id.in_(submitted_ids))
            )
        ).all()
        kind_map = {q.id: q.kind for q in questions}
        for q_id, response, is_correct in ans_rows:
            if is_response_answered(kind_map.get(q_id, "mcq_single"), response):
                attempted_counts[q_id] += 1
            if is_correct:
                correct_counts[q_id] += 1

    question_analytics = []
    for q in questions:
        attempted = attempted_counts[q.id]
        correct = correct_counts[q.id]
        accuracy = round((correct / attempted) * 100, 1) if attempted else 0.0
        question_analytics.append(
            QuestionAnalytics(
                question_id=q.id,
                position=q.position,
                prompt=q.prompt[:180],
                kind=q.kind,
                attempted=attempted,
                correct=correct,
                accuracy=accuracy,
            )
        )
    question_analytics.sort(key=lambda item: (item.accuracy, item.position))

    all_attempt_ids = [attempt.id for attempt in attempts]
    violations_by_kind: dict[str, int] = {}
    if all_attempt_ids:
        event_rows = (
            await db.execute(
                select(ProctoringEvent.kind, func.count(ProctoringEvent.id))
                .where(ProctoringEvent.attempt_id.in_(all_attempt_ids))
                .group_by(ProctoringEvent.kind)
            )
        ).all()
        violations_by_kind = {kind: int(count) for kind, count in event_rows}

    return ExamAnalytics(
        stats=AnalyticsStats(
            attempts=len(attempts),
            submitted=len(submitted),
            mean=mean_val,
            median=median_val,
            highest=highest_val,
            lowest=lowest_val,
            std_dev=std_dev_val,
            pass_rate=pass_rate,
        ),
        score_histogram=histogram,
        questions=question_analytics,
        violations_by_kind=violations_by_kind,
    )


@router.get("/exams/{exam_id}/results.csv")
async def export_results_csv(
    exam_id: str,
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    await _get_exam_or_404(exam_id, db)
    rows = (
        await db.execute(
            select(Enrollment, Candidate, Attempt)
            .join(Candidate, Candidate.id == Enrollment.candidate_id)
            .outerjoin(
                Attempt,
                (Attempt.candidate_id == Enrollment.candidate_id) & (Attempt.exam_id == Enrollment.exam_id),
            )
            .options(selectinload(Candidate.user), selectinload(Candidate.batch))
            .where(Enrollment.exam_id == exam_id)
            .order_by(Candidate.candidate_code.asc())
        )
    ).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["candidate_code", "full_name", "username", "batch", "status", "score", "max_score", "violations", "submit_reason", "submitted_at"]
    )
    for _, candidate, attempt in rows:
        writer.writerow(
            [
                _csv_safe(candidate.candidate_code),
                _csv_safe(candidate.user.full_name),
                _csv_safe(candidate.user.username),
                _csv_safe(candidate.batch.name if candidate.batch else ""),
                attempt.status if attempt else "not_started",
                attempt.score if attempt and attempt.score is not None else "",
                attempt.max_score if attempt else "",
                attempt.violation_count if attempt else 0,
                attempt.submit_reason if attempt and attempt.submit_reason else "",
                as_utc(attempt.submitted_at).isoformat() if attempt and attempt.submitted_at else "",
            ]
        )

    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="exam-{exam_id[:8]}-results.csv"'},
    )


@router.get("/exams/{exam_id}/grading-queue", response_model=list[GradingQueueItem])
async def get_grading_queue(
    exam_id: str,
    pending_only: bool = Query(default=True),
    _staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    await _get_exam_or_404(exam_id, db)
    query = (
        select(Answer, Attempt, Candidate, Question)
        .join(Attempt, Attempt.id == Answer.attempt_id)
        .join(Candidate, Candidate.id == Attempt.candidate_id)
        .join(Question, Question.id == Answer.question_id)
        .options(selectinload(Candidate.user))
        .where(
            Attempt.exam_id == exam_id,
            Attempt.status == "submitted",
            Question.kind == "theory",
        )
        .order_by(Question.position.asc(), Candidate.candidate_code.asc())
    )
    if pending_only:
        query = query.where(Answer.awarded_marks.is_(None))

    rows = (await db.execute(query)).all()
    return [
        GradingQueueItem(
            answer_id=answer.id,
            attempt_id=attempt.id,
            candidate_code=candidate.candidate_code,
            full_name=candidate.user.full_name,
            question_id=question.id,
            position=question.position,
            prompt=question.prompt,
            max_marks=question.marks,
            response=answer.response,
            model_answer=question.explanation,
            awarded_marks=answer.awarded_marks,
            feedback=answer.feedback,
        )
        for answer, attempt, candidate, question in rows
    ]


@router.post("/answers/{answer_id}/grade", response_model=GradeAnswerResponse)
async def grade_theory_answer(
    answer_id: str,
    payload: GradeAnswerRequest,
    request: Request,
    staff: User = Depends(require_roles("admin", "invigilator")),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            select(Answer, Attempt, Question)
            .join(Attempt, Attempt.id == Answer.attempt_id)
            .join(Question, Question.id == Answer.question_id)
            .where(Answer.id == answer_id)
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Answer not found.")

    answer, attempt, question = row
    if payload.awarded_marks > question.marks:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Awarded marks cannot exceed max marks ({question.marks}).",
        )

    answer.awarded_marks = round(payload.awarded_marks, 2)
    answer.feedback = payload.feedback.strip() if payload.feedback else None
    answer.is_correct = answer.awarded_marks >= (question.marks * 0.5)

    new_score = await recalculate_attempt_score(attempt, db)
    record_audit(
        db,
        actor_id=staff.id,
        action="answer.graded",
        target_type="answer",
        target_id=answer.id,
        details={"attempt_id": attempt.id, "awarded_marks": answer.awarded_marks},
        ip_address=client_ip_from_request(request),
    )
    await db.commit()
    return GradeAnswerResponse(attempt_score=new_score)
