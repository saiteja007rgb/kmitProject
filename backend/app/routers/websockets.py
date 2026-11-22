"""Authenticated WebSockets backed by Redis Pub/Sub for real-time cross-instance updates."""
import asyncio
import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.core.dependencies import authenticate_websocket_token
from app.core.redis_store import attempt_channel, exam_channel, redis_store
from app.database import SessionFactory
from app.models import Attempt

logger = logging.getLogger("exampulse.websockets")
router = APIRouter(prefix="/ws", tags=["WebSockets"])

CANDIDATE_VISIBLE_EXAM_EVENTS = {"exam_status_changed", "announcement"}


async def _relay_channels(
    websocket: WebSocket,
    channels: list[str],
    *,
    filter_exam_channel: str | None = None,
) -> None:
    """Forwards Redis Pub/Sub events to `websocket` until cancelled."""
    if redis_store.client is None:
        return
    pubsub = redis_store.client.pubsub()
    await pubsub.subscribe(*channels)
    try:
        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            try:
                payload = json.loads(message["data"])
            except (TypeError, json.JSONDecodeError):
                continue
            # Never leak other candidates' activity from the shared exam channel to a candidate socket.
            if filter_exam_channel and message.get("channel") == filter_exam_channel:
                if payload.get("type") not in CANDIDATE_VISIBLE_EXAM_EVENTS:
                    continue
            await websocket.send_json(payload)
    except asyncio.CancelledError:
        pass
    except Exception:  # noqa: BLE001
        logger.debug("WebSocket relay closed for %s", channels)
    finally:
        try:
            await pubsub.unsubscribe(*channels)
            await pubsub.aclose()
        except Exception:  # noqa: BLE001
            pass


async def _run_socket_loop(websocket: WebSocket, channels: list[str], *, filter_exam_channel: str | None = None) -> None:
    await websocket.accept()
    relay_task = asyncio.create_task(_relay_channels(websocket, channels, filter_exam_channel=filter_exam_channel))
    try:
        while True:
            text = await websocket.receive_text()
            if text == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        relay_task.cancel()
        try:
            await relay_task
        except asyncio.CancelledError:
            pass


@router.websocket("/admin/exams/{exam_id}")
async def admin_exam_socket(
    websocket: WebSocket,
    exam_id: str,
    token: str | None = Query(default=None),
):
    async with SessionFactory() as db:
        user = await authenticate_websocket_token(token, db)
    if user is None:
        await websocket.close(code=4401)
        return
    if user.role not in ("admin", "invigilator"):
        await websocket.close(code=4403)
        return

    await _run_socket_loop(websocket, [exam_channel(exam_id)])


@router.websocket("/candidate/attempts/{attempt_id}")
async def candidate_attempt_socket(
    websocket: WebSocket,
    attempt_id: str,
    token: str | None = Query(default=None),
):
    async with SessionFactory() as db:
        user = await authenticate_websocket_token(token, db)
        if user is None:
            await websocket.close(code=4401)
            return
        if user.role != "candidate" or user.candidate is None:
            await websocket.close(code=4403)
            return
        attempt = (
            await db.execute(
                select(Attempt).where(Attempt.id == attempt_id, Attempt.candidate_id == user.candidate.id)
            )
        ).scalar_one_or_none()
        if attempt is None:
            await websocket.close(code=4403)
            return
        exam_id = attempt.exam_id

    shared_exam_ch = exam_channel(exam_id)
    await _run_socket_loop(
        websocket,
        [shared_exam_ch, attempt_channel(attempt_id)],
        filter_exam_channel=shared_exam_ch,
    )
