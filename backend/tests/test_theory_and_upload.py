import io
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_theory_exam_creation_and_scoring(client: AsyncClient):
    # 1. Login as admin
    login_resp = await client.post("/api/auth/login", json={
        "username": "admin",
        "password": "admin123"
    })
    assert login_resp.status_code == 200
    admin_token = login_resp.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 2. Create an exam with a Theory question and an MCQ question
    exam_payload = {
        "title": "Distributed Systems & Theory Midterm",
        "description": "Comprehensive evaluation covering CAP theorem and basics",
        "duration_minutes": 45,
        "negative_marking": 0.0,
        "status": "active",
        "questions": [
            {
                "question_text": "Explain the CAP theorem and explain why network partitions force a trade-off.",
                "question_type": "theory",
                "options": [],
                "correct_answer": "In the presence of network partition, a system must choose between consistency and availability.",
                "marks": 5.0,
                "negative_marks": 0.0,
                "explanation": "Brewer's conjecture states you cannot guarantee both C and A during P."
            },
            {
                "question_text": "Which protocol provides ordered, reliable byte stream delivery?",
                "question_type": "mcq",
                "options": [
                    {"id": "A", "text": "UDP"},
                    {"id": "B", "text": "TCP"},
                    {"id": "C", "text": "IP"},
                    {"id": "D", "text": "ICMP"}
                ],
                "correct_answer": "B",
                "marks": 2.0,
                "negative_marks": 0.0,
                "explanation": "TCP provides flow control, congestion control and reliable byte-streams."
            }
        ]
    }
    create_resp = await client.post("/api/exams", json=exam_payload, headers=admin_headers)
    assert create_resp.status_code == 200
    exam_data = create_resp.json()
    exam_id = exam_data["id"]
    assert exam_data["total_marks"] == 7.0
    assert exam_data["status"] == "active"

    # 3. Test changing status via PATCH /exams/{id}/status
    patch_resp = await client.patch(
        f"/api/exams/{exam_id}/status",
        json={"status": "completed"},
        headers=admin_headers
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["status"] == "completed"

    # Reset back to active
    patch_resp2 = await client.patch(
        f"/api/exams/{exam_id}/status",
        json={"status": "active"},
        headers=admin_headers
    )
    assert patch_resp2.status_code == 200
    assert patch_resp2.json()["status"] == "active"

    # 4. Candidate starts the exam session
    cand_login = await client.post("/api/auth/login", json={
        "username": "candidate_005",
        "password": "password123"
    })
    assert cand_login.status_code == 200
    cand_token = cand_login.json()["access_token"]
    cand_headers = {"Authorization": f"Bearer {cand_token}"}

    start_resp = await client.post(f"/api/exams/{exam_id}/start", headers=cand_headers)
    assert start_resp.status_code == 200
    session_data = start_resp.json()
    session_id = session_data["session_id"]

    # 5. Get questions for candidate — verify theory question has question_type 'theory' and empty options
    q_resp = await client.get(f"/api/sessions/{session_id}/questions", headers=cand_headers)
    assert q_resp.status_code == 200
    questions = q_resp.json()
    assert len(questions) == 2
    theory_q = next(q for q in questions if q["question_type"] == "theory")
    mcq_q = next(q for q in questions if q["question_type"] == "mcq")
    assert len(theory_q["options"]) == 0
    assert len(mcq_q["options"]) == 4

    # 6. Candidate saves answers (descriptive text for theory, 'B' for MCQ)
    save_theory = await client.put(
        f"/api/sessions/{session_id}/answers/{theory_q['id']}",
        json={
            "selected_answer": "Under network partition, if nodes cannot communicate, continuing to accept writes violates consistency.",
            "is_marked_for_review": False,
            "version": 1
        },
        headers=cand_headers
    )
    assert save_theory.status_code == 200

    save_mcq = await client.put(
        f"/api/sessions/{session_id}/answers/{mcq_q['id']}",
        json={
            "selected_answer": "B",
            "is_marked_for_review": False,
            "version": 1
        },
        headers=cand_headers
    )
    assert save_mcq.status_code == 200

    # 7. Submit exam and verify scoring
    sub_resp = await client.post(f"/api/sessions/{session_id}/submit", headers=cand_headers)
    assert sub_resp.status_code == 200
    sub_data = sub_resp.json()
    assert sub_data["score"] == 7.0  # 5 + 2

    # 8. Solution Review
    review_resp = await client.get(f"/api/sessions/{session_id}/review", headers=cand_headers)
    assert review_resp.status_code == 200
    review_data = review_resp.json()
    assert len(review_data["questions"]) == 2
    r_theory = next(q for q in review_data["questions"] if q["question_type"] == "theory")
    assert r_theory["marks_earned"] == 5.0
    assert "consistency" in r_theory["selected_answer"]


@pytest.mark.asyncio
async def test_question_paper_upload(client: AsyncClient):
    login_resp = await client.post("/api/auth/login", json={
        "username": "admin",
        "password": "admin123"
    })
    admin_token = login_resp.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    sample_txt = """
Q1. What is an IP address?
A) Logical network address
B) Physical MAC address
C) Cable specification
D) Operating System
Answer: A
Marks: 2
Explanation: IP identifies host on a network.

Q2. Discuss the difference between symmetric and asymmetric cryptography.
Type: Theory
Marks: 5
Explanation: Symmetric uses one shared key; asymmetric uses public and private key pairs.
"""
    files = {
        "file": ("test_paper.txt", sample_txt.encode("utf-8"), "text/plain")
    }
    upload_resp = await client.post("/api/exams/upload-questions", files=files, headers=admin_headers)
    assert upload_resp.status_code == 200
    parsed = upload_resp.json()
    assert parsed["total_detected"] == 2
    qs = parsed["questions"]
    assert qs[0]["question_type"] == "mcq"
    assert qs[0]["correct_answer"] == "A"
    assert qs[1]["question_type"] == "theory"
    assert qs[1]["marks"] == 5.0
