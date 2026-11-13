import pytest
import pytest_asyncio
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, update, delete
from app.database import AsyncSessionLocal
from app.models import ExaminationSession, Answer, Submission, Question

@pytest.mark.asyncio
async def test_auth_login(client):
    # 1. Successful candidate login
    resp = await client.post("/api/auth/login", json={
        "username": "candidate_001",
        "password": "password123"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["role"] == "candidate"
    assert data["candidate_id"] is not None

    # 2. Invalid password
    bad_resp = await client.post("/api/auth/login", json={
        "username": "candidate_001",
        "password": "wrongpassword"
    })
    assert bad_resp.status_code == 401

    # 3. Successful admin login
    admin_resp = await client.post("/api/auth/login", json={
        "username": "admin",
        "password": "admin123"
    })
    assert admin_resp.status_code == 200
    assert admin_resp.json()["role"] == "admin"

@pytest.mark.asyncio
async def test_deterministic_question_shuffling(client):
    # Login candidate 1
    c1_login = await client.post("/api/auth/login", json={"username": "candidate_001", "password": "password123"})
    c1_token = c1_login.json()["access_token"]
    c1_headers = {"Authorization": f"Bearer {c1_token}"}

    # Login candidate 2
    c2_login = await client.post("/api/auth/login", json={"username": "candidate_002", "password": "password123"})
    c2_token = c2_login.json()["access_token"]
    c2_headers = {"Authorization": f"Bearer {c2_token}"}

    # Fetch exams list
    exams_resp = await client.get("/api/exams", headers=c1_headers)
    assert exams_resp.status_code == 200
    exam_id = exams_resp.json()[0]["id"]

    # Candidate 1 starts exam
    c1_start = await client.post(f"/api/exams/{exam_id}/start", headers=c1_headers)
    assert c1_start.status_code == 200
    c1_session_id = c1_start.json()["session_id"]

    # Candidate 2 starts exam
    c2_start = await client.post(f"/api/exams/{exam_id}/start", headers=c2_headers)
    assert c2_start.status_code == 200
    c2_session_id = c2_start.json()["session_id"]

    # Fetch questions for both candidates
    c1_q_resp = await client.get(f"/api/sessions/{c1_session_id}/questions", headers=c1_headers)
    assert c1_q_resp.status_code == 200
    c1_questions = c1_q_resp.json()
    c1_ids = [q["id"] for q in c1_questions]

    c2_q_resp = await client.get(f"/api/sessions/{c2_session_id}/questions", headers=c2_headers)
    assert c2_q_resp.status_code == 200
    c2_questions = c2_q_resp.json()
    c2_ids = [q["id"] for q in c2_questions]

    # Verify personalization: Question orders must be different
    assert c1_ids != c2_ids, "Candidate 1 and Candidate 2 must receive different question orders"

    # Verify security: correct_answer must NEVER be sent to candidates
    for q in c1_questions:
        assert "correct_answer" not in q
        assert "explanation" not in q

    # Verify consistency: Re-fetching questions (simulating page refresh) returns the exact same order!
    c1_refresh = await client.get(f"/api/sessions/{c1_session_id}/questions", headers=c1_headers)
    c1_refreshed_ids = [q["id"] for q in c1_refresh.json()]
    assert c1_ids == c1_refreshed_ids, "Question order must be preserved exactly on page refresh"

@pytest.mark.asyncio
async def test_single_active_session_enforcement(client):
    c1_login = await client.post("/api/auth/login", json={"username": "candidate_003", "password": "password123"})
    c1_token = c1_login.json()["access_token"]
    headers = {"Authorization": f"Bearer {c1_token}"}

    exams = (await client.get("/api/exams", headers=headers)).json()
    exam_id = exams[0]["id"]

    # Start session
    start1 = await client.post(f"/api/exams/{exam_id}/start", headers=headers)
    session_id_1 = start1.json()["session_id"]

    # Try starting again from another browser / window
    start2 = await client.post(f"/api/exams/{exam_id}/start", headers=headers)
    session_id_2 = start2.json()["session_id"]

    # Must return the existing active session rather than creating duplicate sessions
    assert session_id_1 == session_id_2

@pytest.mark.asyncio
async def test_durable_autosave_and_versioning(client):
    # Use candidate_020 to guarantee clean test state
    c_login = await client.post("/api/auth/login", json={"username": "candidate_020", "password": "password123"})
    token = c_login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    exams = (await client.get("/api/exams", headers=headers)).json()
    exam_id = exams[0]["id"]
    session_id = (await client.post(f"/api/exams/{exam_id}/start", headers=headers)).json()["session_id"]

    # Ensure clean state for this test session
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Answer).where(Answer.session_id == session_id))
        await db.commit()

    questions = (await client.get(f"/api/sessions/{session_id}/questions", headers=headers)).json()
    target_q_id = questions[0]["id"]

    # 1. Save answer with version 1
    save_v1 = await client.put(
        f"/api/sessions/{session_id}/answers/{target_q_id}",
        headers=headers,
        json={"selected_answer": "A", "is_marked_for_review": False, "version": 1}
    )
    assert save_v1.status_code == 200
    assert save_v1.json()["status"] == "saved"
    assert save_v1.json()["selected_answer"] == "A"
    assert save_v1.json()["version"] == 1

    # 2. Update answer with version 2
    save_v2 = await client.put(
        f"/api/sessions/{session_id}/answers/{target_q_id}",
        headers=headers,
        json={"selected_answer": "B", "is_marked_for_review": True, "version": 2}
    )
    assert save_v2.status_code == 200
    assert save_v2.json()["selected_answer"] == "B"
    assert save_v2.json()["is_marked_for_review"] is True
    assert save_v2.json()["version"] == 2

    # 3. Simulate delayed out-of-order network request arriving with older version 1
    delayed_v1 = await client.put(
        f"/api/sessions/{session_id}/answers/{target_q_id}",
        headers=headers,
        json={"selected_answer": "A", "is_marked_for_review": False, "version": 1}
    )
    assert delayed_v1.status_code == 200
    # Must NOT overwrite version 2!
    assert delayed_v1.json()["selected_answer"] == "B"
    assert delayed_v1.json()["version"] == 2

    # 4. Verify durable persistence directly in database
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(Answer).where(Answer.session_id == session_id, Answer.question_id == target_q_id)
        )
        persisted = res.scalar_one()
        assert persisted.selected_answer == "B"
        assert persisted.version == 2

@pytest.mark.asyncio
async def test_server_authoritative_timer(client):
    # Use candidate_025
    c_login = await client.post("/api/auth/login", json={"username": "candidate_025", "password": "password123"})
    token = c_login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    exams = (await client.get("/api/exams", headers=headers)).json()
    exam_id = exams[0]["id"]
    session_id = (await client.post(f"/api/exams/{exam_id}/start", headers=headers)).json()["session_id"]

    # Ensure clean state for this test session
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Submission).where(Submission.session_id == session_id))
        await db.execute(delete(Answer).where(Answer.session_id == session_id))
        await db.execute(
            update(ExaminationSession)
            .where(ExaminationSession.id == session_id)
            .values(status="in_progress", submitted_at=None)
        )
        await db.commit()

    questions = (await client.get(f"/api/sessions/{session_id}/questions", headers=headers)).json()
    q_id = questions[0]["id"]

    # Artificially expire the deadline in database to test server enforcement
    async with AsyncSessionLocal() as db:
        past_time = datetime.now(timezone.utc) - timedelta(minutes=10)
        await db.execute(
            update(ExaminationSession)
            .where(ExaminationSession.id == session_id)
            .values(deadline=past_time)
        )
        await db.commit()

    # Attempt to save answer after expiration
    expired_save = await client.put(
        f"/api/sessions/{session_id}/answers/{q_id}",
        headers=headers,
        json={"selected_answer": "C", "version": 5}
    )
    # Must reject with 403 Forbidden!
    assert expired_save.status_code == 403
    assert "expired" in expired_save.json()["detail"].lower()

@pytest.mark.asyncio
async def test_idempotent_final_submission_and_scoring(client):
    # Use candidate_030
    c_login = await client.post("/api/auth/login", json={"username": "candidate_030", "password": "password123"})
    token = c_login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    exams = (await client.get("/api/exams", headers=headers)).json()
    exam_id = exams[0]["id"]
    session_id = (await client.post(f"/api/exams/{exam_id}/start", headers=headers)).json()["session_id"]

    # Ensure clean state for this test session
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Submission).where(Submission.session_id == session_id))
        await db.execute(delete(Answer).where(Answer.session_id == session_id))
        await db.execute(
            update(ExaminationSession)
            .where(ExaminationSession.id == session_id)
            .values(status="in_progress", submitted_at=None)
        )
        await db.commit()

    questions = (await client.get(f"/api/sessions/{session_id}/questions", headers=headers)).json()

    # Fetch the actual correct answer for questions[0] and questions[1] from DB
    async with AsyncSessionLocal() as db:
        q0 = (await db.execute(select(Question).where(Question.id == questions[0]["id"]))).scalar_one()
        q1 = (await db.execute(select(Question).where(Question.id == questions[1]["id"]))).scalar_one()

    # Answer questions[0] correctly
    await client.put(
        f"/api/sessions/{session_id}/answers/{questions[0]['id']}",
        headers=headers,
        json={"selected_answer": q0.correct_answer, "version": 1}
    )
    # Answer questions[1] incorrectly
    wrong_ans = "D" if q1.correct_answer != "D" else "C"
    await client.put(
        f"/api/sessions/{session_id}/answers/{questions[1]['id']}",
        headers=headers,
        json={"selected_answer": wrong_ans, "version": 1}
    )

    # 1. First submission
    sub1 = await client.post(f"/api/sessions/{session_id}/submit", headers=headers)
    assert sub1.status_code == 200
    res1 = sub1.json()
    assert res1["status"] == "submitted"
    assert res1["correct_count"] >= 1
    assert res1["incorrect_count"] >= 1

    # 2. Second submission (simulating double-click or network retry)
    sub2 = await client.post(f"/api/sessions/{session_id}/submit", headers=headers)
    assert sub2.status_code == 200
    res2 = sub2.json()
    # Must return identical score and counts
    assert res1["score"] == res2["score"]
    assert res1["correct_count"] == res2["correct_count"]
    assert res1["incorrect_count"] == res2["incorrect_count"]

    # 3. Check database to guarantee only ONE submission record exists
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Submission).where(Submission.session_id == session_id))
        submissions = res.scalars().all()
        assert len(submissions) == 1, "There must be exactly one submission record in the database"

    # 4. Attempting to modify answers after submission must be rejected
    post_sub_save = await client.put(
        f"/api/sessions/{session_id}/answers/{questions[0]['id']}",
        headers=headers,
        json={"selected_answer": "C", "version": 99}
    )
    assert post_sub_save.status_code == 403
