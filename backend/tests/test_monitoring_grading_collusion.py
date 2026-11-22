"""Tests for live monitoring, snapshot retrieval, theory grading, analytics, CSV export, and collusion detection."""
from datetime import timedelta

import pytest

from app.core.clock import utc_now
from tests.conftest import auth_headers, login_as


@pytest.mark.asyncio
async def test_monitoring_grading_analytics_csv_and_collusion(client):
    admin_token, _ = await login_as(client, "admin", "admin123")
    headers = auth_headers(admin_token)

    exams = (await client.get("/api/admin/exams", headers=headers)).json()
    sample_exam = next(e for e in exams if "CS201" in e["title"])
    exam_id = sample_exam["id"]

    # Live board includes student1's submitted attempt and snapshot thumbnail
    live = await client.get(f"/api/admin/exams/{exam_id}/live", headers=headers)
    assert live.status_code == 200
    board = live.json()
    student1_row = next(row for row in board["candidates"] if row["candidate_code"] == "KMIT-001")
    assert student1_row["status"] == "submitted"
    assert student1_row["latest_snapshot_id"] is not None

    # Fetch JPEG snapshot via authenticated admin route
    snap = await client.get(f"/api/admin/snapshots/{student1_row['latest_snapshot_id']}", headers=headers)
    assert snap.status_code == 200
    assert snap.headers["content-type"] == "image/jpeg"

    # Manual theory grading updates attempt score
    queue = (await client.get(f"/api/admin/exams/{exam_id}/grading-queue?pending_only=true", headers=headers)).json()
    assert len(queue) >= 1
    graded = await client.post(
        f"/api/admin/answers/{queue[0]['answer_id']}/grade",
        json={"awarded_marks": 4.5, "feedback": "Clear explanation."},
        headers=headers,
    )
    assert graded.status_code == 200
    assert graded.json()["attempt_score"] == 16.5

    # Announcements, analytics, leaderboard, CSV export
    ann = await client.post(f"/api/admin/exams/{exam_id}/announcements", json={"message": "15 mins left."}, headers=headers)
    assert ann.status_code == 201
    analytics = await client.get(f"/api/admin/exams/{exam_id}/analytics", headers=headers)
    assert analytics.status_code == 200
    assert analytics.json()["stats"]["submitted"] >= 1
    csv_resp = await client.get(f"/api/admin/exams/{exam_id}/results.csv", headers=headers)
    assert csv_resp.status_code == 200 and "KMIT-001" in csv_resp.text

    # Collusion detection: create 5-question MCQ exam; 2 students copy same wrong choices -> flagged CRITICAL
    now = utc_now()
    mcq_questions = [
        {
            "kind": "mcq_single",
            "prompt": f"Collusion test question {i}",
            "options": [{"id": "A", "text": "Correct"}, {"id": "B", "text": "W1"}, {"id": "C", "text": "W2"}, {"id": "D", "text": "W3"}],
            "correct_answer": "A",
            "marks": 1.0,
        }
        for i in range(1, 6)
    ]
    c_exam = (
        await client.post(
            "/api/admin/exams",
            json={
                "title": "Collusion Detection Exam",
                "starts_at": (now - timedelta(minutes=5)).isoformat(),
                "ends_at": (now + timedelta(hours=2)).isoformat(),
                "duration_minutes": 30,
                "settings": {"require_webcam": False, "require_fullscreen": False},
                "questions": mcq_questions,
            },
            headers=headers,
        )
    ).json()
    c_exam_id = c_exam["id"]
    await client.post(f"/api/admin/exams/{c_exam_id}/lifecycle", json={"action": "publish"}, headers=headers)

    cands = (await client.get("/api/admin/candidates?page_size=50", headers=headers)).json()["items"]
    c1 = next(c for c in cands if c["username"] == "student1")
    c2 = next(c for c in cands if c["username"] == "student2")
    await client.post(f"/api/admin/exams/{c_exam_id}/enrollments", json={"candidate_ids": [c1["id"], c2["id"]]}, headers=headers)

    for uname in ("student1", "student2"):
        tok, _ = await login_as(client, uname, "password123")
        st = (await client.post(f"/api/candidate/exams/{c_exam_id}/start", json={}, headers=auth_headers(tok))).json()
        for q in st["questions"]:
            await client.put(
                f"/api/candidate/attempts/{st['attempt_id']}/answers/{q['id']}",
                json={"response": "D", "is_flagged": False, "version": 1},
                headers=auth_headers(tok),
            )
        await client.post(f"/api/candidate/attempts/{st['attempt_id']}/submit", headers=auth_headers(tok))

    scan = await client.post(f"/api/admin/exams/{c_exam_id}/collusion-scan", headers=headers)
    assert scan.status_code == 200 and scan.json()["flags_detected"] == 1
    flags = (await client.get(f"/api/admin/exams/{c_exam_id}/collusion-flags", headers=headers)).json()
    assert flags[0]["risk_level"] == "critical"
    assert flags[0]["evidence"]["matching_incorrect_count"] == 5

