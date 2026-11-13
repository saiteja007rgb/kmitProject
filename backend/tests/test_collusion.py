import pytest
from app.database import AsyncSessionLocal
from app.models import Examination, Question
from app.services.collusion_service import CollusionService
from sqlalchemy import select

@pytest.mark.asyncio
async def test_collusion_detection(client):
    # 1. Login Candidate 10 and Candidate 11
    c10 = (await client.post("/api/auth/login", json={"username": "candidate_010", "password": "password123"})).json()
    c11 = (await client.post("/api/auth/login", json={"username": "candidate_011", "password": "password123"})).json()
    admin = (await client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})).json()

    h10 = {"Authorization": f"Bearer {c10['access_token']}"}
    h11 = {"Authorization": f"Bearer {c11['access_token']}"}
    h_admin = {"Authorization": f"Bearer {admin['access_token']}"}

    exams = (await client.get("/api/exams", headers=h10)).json()
    exam_id = exams[0]["id"]

    s10 = (await client.post(f"/api/exams/{exam_id}/start", headers=h10)).json()["session_id"]
    s11 = (await client.post(f"/api/exams/{exam_id}/start", headers=h11)).json()["session_id"]

    # Fetch master questions to find question IDs
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Question).where(Question.examination_id == exam_id))
        questions = res.scalars().all()

    # Simulate Candidate 10 and Candidate 11 copying each other on 10 questions, including 4 identical WRONG options
    for idx, q in enumerate(questions[:10]):
        # Deliberately pick wrong answer "D" for questions 0..3
        chosen = "D" if idx < 4 else "A"
        await client.put(
            f"/api/sessions/{s10}/answers/{q.id}",
            headers=h10,
            json={"selected_answer": chosen, "version": 1}
        )
        await client.put(
            f"/api/sessions/{s11}/answers/{q.id}",
            headers=h11,
            json={"selected_answer": chosen, "version": 1}
        )

    # Run collusion detection
    scan_resp = await client.post(
        f"/api/admin/exams/{exam_id}/run-collusion-detection?threshold=0.7",
        headers=h_admin
    )
    assert scan_resp.status_code == 200
    assert scan_resp.json()["flags_detected"] >= 1

    # Fetch suspicious activity records
    flags = (await client.get(f"/api/admin/exams/{exam_id}/suspicious-activity", headers=h_admin)).json()
    assert len(flags) >= 1

    matched = [f for f in flags if "C-1010" in (f["candidate_a_code"], f["candidate_b_code"]) and "C-1011" in (f["candidate_a_code"], f["candidate_b_code"])]
    assert len(matched) == 1
    flag = matched[0]
    assert flag["risk_level"] in ("high", "critical")
    assert flag["evidence"]["matching_incorrect_count"] >= 3
    assert flag["evidence"]["coincidence_probability"] == "< 0.001"

