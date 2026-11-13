import asyncio
import json
import logging
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.redis_client import redis_manager

logger = logging.getLogger("exampulse.websockets")

router = APIRouter(prefix="/ws", tags=["WebSockets"])

class ConnectionManager:
    def __init__(self):
        # Maps exam_id -> set of active WebSockets for invigilators
        self.admin_connections: Dict[str, Set[WebSocket]] = {}
        # Maps session_id -> WebSocket for candidate
        self.candidate_connections: Dict[str, WebSocket] = {}
        self.listener_tasks: Dict[str, asyncio.Task] = {}

    async def connect_admin(self, exam_id: str, websocket: WebSocket):
        await websocket.accept()
        if exam_id not in self.admin_connections:
            self.admin_connections[exam_id] = set()
            # Start background Redis subscriber for this exam channel if not already listening
            self.start_redis_listener(exam_id)
        self.admin_connections[exam_id].add(websocket)
        logger.info("Admin connected to WebSocket for exam %s", exam_id)

    def disconnect_admin(self, exam_id: str, websocket: WebSocket):
        if exam_id in self.admin_connections:
            self.admin_connections[exam_id].discard(websocket)
            if not self.admin_connections[exam_id]:
                del self.admin_connections[exam_id]
                # If no admins left, stop redis subscriber task
                task = self.listener_tasks.pop(exam_id, None)
                if task:
                    task.cancel()
        logger.info("Admin disconnected from WebSocket for exam %s", exam_id)

    async def broadcast_to_admin(self, exam_id: str, message: dict):
        if exam_id in self.admin_connections:
            dead_sockets = set()
            for ws in self.admin_connections[exam_id]:
                try:
                    await ws.send_json(message)
                except Exception:
                    dead_sockets.add(ws)
            for dead in dead_sockets:
                self.admin_connections[exam_id].discard(dead)

    def start_redis_listener(self, exam_id: str):
        if exam_id in self.listener_tasks:
            return
        
        async def listen_loop():
            channel_name = f"exam:{exam_id}:events"
            try:
                if redis_manager.client:
                    pubsub = redis_manager.client.pubsub()
                    await pubsub.subscribe(channel_name)
                    async for msg in pubsub.listen():
                        if msg["type"] == "message":
                            try:
                                data = json.loads(msg["data"])
                                await self.broadcast_to_admin(exam_id, data)
                            except Exception as e:
                                logger.error("Error processing pubsub message: %s", str(e))
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.error("Redis pubsub listener exception for exam %s: %s", exam_id, str(e))

        self.listener_tasks[exam_id] = asyncio.create_task(listen_loop())

manager = ConnectionManager()

@router.websocket("/admin/exams/{exam_id}")
async def admin_websocket_endpoint(websocket: WebSocket, exam_id: str):
    await manager.connect_admin(exam_id, websocket)
    try:
        # Send initial confirmation message
        await websocket.send_json({"type": "connection_established", "exam_id": exam_id})
        while True:
            # Keep socket alive and handle client ping/messages
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect_admin(exam_id, websocket)
    except Exception as e:
        logger.warning("Admin WS error: %s", str(e))
        manager.disconnect_admin(exam_id, websocket)

@router.websocket("/candidate/{session_id}")
async def candidate_websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    try:
        await websocket.send_json({"type": "connected", "session_id": session_id})
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    except Exception:
        pass

