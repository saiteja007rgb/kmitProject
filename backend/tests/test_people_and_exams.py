"""Admin people management (candidates, CSV import, batches, staff) and exam authoring/lifecycle tests."""
from datetime import timedelta

import pytest

from app.core.clock import utc_now
from tests.conftest import auth_headers, login_as


@pytest.mark.asyncio
async def test_candidate_and_batch_management_and_csv_import(client):
    admin_token, _ = await login_as(client, "admin", "admin123")
    headers = auth_headers(admin_token)

    # Create batch
    batch_resp = await client.post("/api/admin/batches", json={"name": "ECE-2026", "description": "Electronics"}, headers=headers)
    assert batch_resp.status_code == 201
    batch_id = batch_resp.json()["id"]

    # Create candidate with auto-generated temporary password -> must_change_password=True
    create_resp = await client.post(
        "/api/admin/candidates",
        json={"username": "ananya.rao", "full_name": "Ananya Rao", "email": "ananya@kmit.edu", "batch_id": batch_id},
        headers=headers,
    )
    assert create_resp.status_code == 201
    created = create_resp.json()
    temp_pw = created["temporary_password"]
    assert temp_pw and len(temp_pw) >= 8
    candidate_id = created["candidate"]["id"]

    # Candidate signs in and changes password
    cand_token, cand_user = await login_as(client, "ananya.rao", temp_pw)
    assert cand_user["must_change_password"] is True
    weak = await client.post(
        "/api/auth/change-password",
        json={"current_password": temp_pw, "new_password": "onlyletters"},
        headers=auth_headers(cand_token),
    )
    assert weak.status_code == 422
    strong = await client.post(
        "/api/auth/change-password",
        json={"current_password": temp_pw, "new_password": "NewPass2026"},
        headers=auth_headers(cand_token),
    )
    assert strong.status_code == 204

    # CSV import with 2 valid rows (auto-creating a batch) + 1 duplicate username skipped
    csv_body = (
        "username,full_name,email,candidate_code,batch\n"
        "csv_stu_1,Kavya Reddy,kavya@kmit.edu,KMIT-501,IT-2026\n"
        "csv_stu_2,Vikram Joshi,vikram@kmit.edu,,IT-2026\n"
        "ananya.rao,Duplicate User,dup@kmit.edu,KMIT-503,IT-2026\n"
    )
    imp = await client.post(
        "/api/admin/candidates/import",
        files={"file": ("students.csv", csv_body.encode(), "text/csv")},
        headers=headers,
    )
    assert imp.status_code == 200
    assert len(imp.json()["created"]) == 2
    assert len(imp.json()["skipped"]) == 1

    # Update & delete unused candidate
    patch = await client.patch(f"/api/admin/candidates/{candidate_id}", json={"batch_id": None}, headers=headers)
    assert patch.status_code == 200
    assert patch.json()["batch_id"] is None

    delete_resp = await client.delete(f"/api/admin/candidates/{candidate_id}", headers=headers)
    assert delete_resp.status_code == 204

    # Audit log recorded actions
    logs = await client.get("/api/admin/audit-logs", headers=headers)
    assert logs.status_code == 200
    assert logs.json()["total"] >= 3


@pytest.mark.asyncio
async def test_exam_lifecycle_pause_resume_end_and_question_import(client):
    admin_token, _ = await login_as(client, "admin", "admin123")
    headers = auth_headers(admin_token)

    # Import questions from .txt preview
    sample_txt = (
        "Q1. What is 2 + 2?\nA) 3\nB) 4\nC) 5\nAnswer: B\nMarks: 2\n\n"
        "Q2. Explain idempotency.\nType: theory\nMarks: 5\nExplanation: Repeating a call yields the same state.\n"
    )
    q_imp = await client.post(
        "/api/admin/questions/import",
        files={"file": ("paper.txt", sample_txt.encode(), "text/plain")},
        headers=headers,
    )
    assert q_imp.status_code == 200
    assert len(q_imp.json()["questions"]) == 2

    now = utc_now()
    exam_payload = {
        "title": "Lifecycle Verification Exam",
        "description": "Tests draft -> live -> pause -> resume -> end.",
        "starts_at": (now - timedelta(minutes=5)).isoformat(),
        "ends_at": (now + timedelta(hours=2)).isoformat(),
        "duration_minutes": 30,
        "settings": {"require_webcam": False, "require_fullscreen": False, "show_results_immediately": True},
        "questions": q_imp.json()["questions"],
    }
    created = await client.post("/api/admin/exams", json=exam_payload, headers=headers)
    assert created.status_code == 201
    exam = created.json()
    exam_id = exam["id"]
    assert exam["status"] == "draft"

    # Enroll student3
    cands = (await client.get("/api/admin/candidates?search=student3", headers=headers)).json()["items"]
    student3_id = cands[0]["id"]
    enr = await client.post(f"/api/admin/exams/{exam_id}/enrollments", json={"candidate_ids": [student3_id]}, headers=headers)
    assert enr.json()["added"] == 1

    # Publish -> becomes live immediately because starts_at is in the past
    pub = await client.post(f"/api/admin/exams/{exam_id}/lifecycle", json={"action": "publish"}, headers=headers)
    assert pub.status_code == 200 and pub.json()["status"] == "live"

    # Candidate starts
    s3_token, _ = await login_as(client, "student3", "password123")
    start = await client.post(f"/api/candidate/exams/{exam_id}/start", json={}, headers=auth_headers(s3_token))
    assert start.status_code == 200
    attempt_id = start.json()["attempt_id"]
    q_id = start.json()["questions"][0]["id"]

    # Pause -> saves blocked with HTTP 423
    pause = await client.post(f"/api/admin/exams/{exam_id}/lifecycle", json={"action": "pause"}, headers=headers)
    assert pause.status_code == 200 and pause.json()["status"] == "paused"
    blocked = await client.put(
        f"/api/candidate/attempts/{attempt_id}/answers/{q_id}",
        json={"response": "B", "is_flagged": False, "version": 1},
        headers=auth_headers(s3_token),
    )
    assert blocked.status_code == 423

    # Resume -> saves work again
    resume = await client.post(f"/api/admin/exams/{exam_id}/lifecycle", json={"action": "resume"}, headers=headers)
    assert resume.status_code == 200 and resume.json()["status"] == "live"
    saved = await client.put(
        f"/api/candidate/attempts/{attempt_id}/answers/{q_id}",
        json={"response": "B", "is_flagged": False, "version": 1},
        headers=auth_headers(s3_token),
    )
    assert saved.status_code == 200 and saved.json()["accepted"] is True

    # End exam -> automatically submits in-progress attempt
    ended = await client.post(f"/api/admin/exams/{exam_id}/lifecycle", json={"action": "end"}, headers=headers)
    assert ended.status_code == 200 and ended.json()["status"] == "ended"
    detail = await client.get(f"/api/admin/attempts/{attempt_id}", headers=headers)
    assert detail.json()["status"] == "submitted"
    assert detail.json()["submit_reason"] == "exam_ended"

