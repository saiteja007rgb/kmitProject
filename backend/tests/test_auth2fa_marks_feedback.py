"""Tests for real authentication (2FA TOTP, backup codes, registration + OTP, password recovery, active sessions),
multi-sheet Excel marks export, post-exam feedback, question bank, regrade appeals, and candidate transcript."""
import io

import openpyxl
import pytest

from app.core.totp import _totp_at_counter
import time
from tests.conftest import auth_headers, login_as


@pytest.mark.asyncio
async def test_self_registration_otp_verification_and_password_recovery(client):
    reg = await client.post(
        "/api/auth/register",
        json={
            "username": "new_student_99",
            "full_name": "Meera Kulkarni",
            "email": "meera@kmit.edu",
            "candidate_code": "KMIT-909",
            "password": "Password2026",
        },
    )
    assert reg.status_code == 201
    code = reg.json()["dev_verification_code"]
    assert code and len(code) == 6

    # Cannot sign in before verifying email
    blocked = await client.post("/api/auth/login", json={"username": "new_student_99", "password": "Password2026"})
    assert blocked.status_code == 403
    assert blocked.headers.get("x-require-verification") == "true"

    # Verify email with OTP
    ver = await client.post("/api/auth/verify-email", json={"username": "new_student_99", "code": code})
    assert ver.status_code == 204

    # Sign in succeeds
    tok, user = await login_as(client, "new_student_99", "Password2026")
    assert user["email_verified"] is True

    # Forgot password -> reset with 6-digit recovery OTP
    forgot = await client.post("/api/auth/forgot-password", json={"username": "new_student_99"})
    assert forgot.status_code == 200
    reset_code = forgot.json()["dev_reset_code"]
    assert reset_code

    reset = await client.post(
        "/api/auth/reset-password",
        json={"username": "new_student_99", "code": reset_code, "new_password": "Recovered2026"},
    )
    assert reset.status_code == 204

    # Old password fails, new password works
    old_try = await client.post("/api/auth/login", json={"username": "new_student_99", "password": "Password2026"})
    assert old_try.status_code == 401
    new_tok, _ = await login_as(client, "new_student_99", "Recovered2026")
    assert new_tok


@pytest.mark.asyncio
async def test_totp_2fa_setup_login_backup_code_and_active_sessions(client):
    token, _ = await login_as(client, "invigilator", "invigilator123")
    headers = auth_headers(token)

    setup = await client.post("/api/auth/2fa/setup", headers=headers)
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    assert setup.json()["qr_svg_data_uri"].startswith("data:image/svg+xml;base64,")

    live_code = _totp_at_counter(secret, int(time.time() // 30))
    enabled = await client.post("/api/auth/2fa/enable", json={"code": live_code}, headers=headers)
    assert enabled.status_code == 200
    backup_codes = enabled.json()["backup_codes"]
    assert len(backup_codes) == 8

    # Login without TOTP code prompts 403 + X-Require-TOTP
    no_totp = await client.post("/api/auth/login", json={"username": "invigilator", "password": "invigilator123"})
    assert no_totp.status_code == 403
    assert no_totp.headers.get("x-require-totp") == "true"

    # Login with valid single-use backup code succeeds
    with_backup = await client.post(
        "/api/auth/login",
        json={"username": "invigilator", "password": "invigilator123", "totp_code": backup_codes[0]},
    )
    assert with_backup.status_code == 200
    sec = await client.get("/api/auth/security", headers=auth_headers(with_backup.json()["access_token"]))
    assert sec.status_code == 200
    assert sec.json()["totp_enabled"] is True
    assert sec.json()["backup_codes_remaining"] == 7
    assert len(sec.json()["active_sessions"]) >= 1

    # Disable 2FA so other tests using invigilator stay clean
    disable = await client.post(
        "/api/auth/2fa/disable",
        json={"code": backup_codes[1]},
        headers=auth_headers(with_backup.json()["access_token"]),
    )
    assert disable.status_code == 204


@pytest.mark.asyncio
async def test_marks_xlsx_export_feedback_question_bank_regrades_and_transcript(client):
    admin_tok, _ = await login_as(client, "admin", "admin123")
    a_headers = auth_headers(admin_tok)
    s2_tok, _ = await login_as(client, "student2", "password123")
    s_headers = auth_headers(s2_tok)

    # Question bank seeded & searchable
    bank = (await client.get("/api/admin/question-bank", headers=a_headers)).json()
    assert len(bank) >= 4

    # Use student2 on CS201 so student1 stays fresh for the main candidate flow test
    exams = (await client.get("/api/candidate/exams", headers=s_headers)).json()
    cs201 = next(e for e in exams if "CS201" in e["title"])
    if not cs201["attempt"]:
        st = (await client.post(f"/api/candidate/exams/{cs201['id']}/start", json={}, headers=s_headers)).json()
        attempt_id = st["attempt_id"]
        await client.post(f"/api/candidate/attempts/{attempt_id}/submit", headers=s_headers)
    else:
        attempt_id = cs201["attempt"]["id"]

    # Submit post-exam feedback
    fb = await client.post(
        f"/api/candidate/attempts/{attempt_id}/feedback",
        json={
            "overall_rating": 5,
            "difficulty": "challenging",
            "clarity_rating": 4,
            "platform_rating": 5,
            "comments": "Coding sandbox worked smoothly.",
        },
        headers=s_headers,
    )
    assert fb.status_code == 201
    fb_summary = (await client.get(f"/api/admin/exams/{cs201['id']}/feedback", headers=a_headers)).json()
    assert fb_summary["total_responses"] >= 1
    assert fb_summary["avg_overall"] == 5.0

    # Candidate transcript reflects submitted exam + feedback status
    transcript = (await client.get("/api/candidate/transcript", headers=s_headers)).json()
    assert transcript["exams_completed"] >= 1
    assert any(entry["feedback_submitted"] for entry in transcript["entries"])

    # Submit regrade appeal & admin approves with adjusted marks
    result_view = (await client.get(f"/api/candidate/attempts/{attempt_id}/result", headers=s_headers)).json()
    theory_q = next(q for q in result_view["questions"] if q["kind"] == "theory")
    appeal = await client.post(
        f"/api/candidate/attempts/{attempt_id}/regrades",
        json={"question_id": theory_q["question_id"], "reason": "My answer covered event loop starvation clearly."},
        headers=s_headers,
    )
    assert appeal.status_code == 201
    regrade_id = appeal.json()["id"]

    resolved = await client.post(
        f"/api/admin/regrades/{regrade_id}/resolve",
        json={"status": "approved", "new_marks": 5.0, "resolution_note": "Full credit awarded after review."},
        headers=a_headers,
    )
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "approved"

    # Multi-sheet Excel marks export (.xlsx)
    xlsx_resp = await client.get(f"/api/admin/exams/{cs201['id']}/export/marks.xlsx", headers=a_headers)
    assert xlsx_resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_resp.content))
    assert wb.sheetnames == ["Marks Sheet", "Question Breakdown", "Summary & Grades"]
    assert wb["Marks Sheet"].max_row >= 2

    # Consolidated cross-exam Excel export
    cons = await client.get("/api/admin/reports/consolidated.xlsx", headers=a_headers)
    assert cons.status_code == 200
    wb_cons = openpyxl.load_workbook(io.BytesIO(cons.content))
    assert wb_cons.sheetnames == ["Consolidated Marks"]

    # System telemetry
    sys_stat = await client.get("/api/admin/system-status", headers=a_headers)
    assert sys_stat.status_code == 200
    assert sys_stat.json()["compilers"]["python"] is True
