"""Local JPEG snapshot storage with magic-byte verification and strict size limits."""
import re
from pathlib import Path

from fastapi import HTTPException, status

from app.config import settings

MAX_SNAPSHOT_BYTES = 200 * 1024  # 200 KB
JPEG_MAGIC = b"\xff\xd8\xff"
UUID_PATTERN = re.compile(r"^[0-9a-f-]{36}$")


def _snapshot_path(snapshot_id: str) -> Path:
    if not UUID_PATTERN.match(snapshot_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid snapshot id.")
    directory = settings.storage_dir / "snapshots"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{snapshot_id}.jpg"


def save_jpeg_snapshot(snapshot_id: str, payload: bytes) -> None:
    if not payload or len(payload) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Snapshot must be under 200 KB.")
    if not payload.startswith(JPEG_MAGIC):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Snapshot must be a valid JPEG image.")
    _snapshot_path(snapshot_id).write_bytes(payload)


def read_jpeg_snapshot(snapshot_id: str) -> bytes:
    path = _snapshot_path(snapshot_id)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Snapshot file not found.")
    return path.read_bytes()


def delete_snapshots(snapshot_ids: list[str]) -> None:
    for snapshot_id in snapshot_ids:
        if UUID_PATTERN.match(snapshot_id):
            path = settings.storage_dir / "snapshots" / f"{snapshot_id}.jpg"
            path.unlink(missing_ok=True)

