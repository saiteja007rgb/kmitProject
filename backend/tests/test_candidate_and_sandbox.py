"""Candidate exam flow, versioned autosave, snapshot proctoring, and 5-language bubblewrap code sandbox tests."""
import pytest

from app.schemas.exams import CodingTestCase
from app.services.code_sandbox import execute_code
from tests.conftest import auth_headers, login_as

TINY_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"


@pytest.mark.asyncio
async def test_sandbox_executes_all_five_languages_and_blocks_network():
    sample = [CodingTestCase(input="7 8\n", expected_output="15\n")]

    py_ok = await execute_code(language="python", code="a, b = map(int, input().split())\nprint(a + b)\n", test_cases=sample)
    assert py_ok.status == "ok" and py_ok.results[0].verdict == "passed"

    c_ok = await execute_code(
        language="c",
        code='#include <stdio.h>\nint main(){int a,b;scanf("%d%d",&a,&b);printf("%d\\n",a+b);return 0;}',
        test_cases=sample,
    )
    assert c_ok.status == "ok" and c_ok.results[0].verdict == "passed"

    cpp_ok = await execute_code(
        language="cpp",
        code="#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<(a+b)<<'\\n';}",
        test_cases=sample,
    )
    assert cpp_ok.status == "ok" and cpp_ok.results[0].verdict == "passed"

    js_ok = await execute_code(
        language="javascript",
        code="const [a,b]=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(a+b);",
        test_cases=sample,
    )
    assert js_ok.status == "ok" and js_ok.results[0].verdict == "passed"

    java_ok = await execute_code(
        language="java",
        code="import java.util.*;public class Main{public static void main(String[] a){Scanner s=new Scanner(System.in);System.out.println(s.nextInt()+s.nextInt());}}",
        test_cases=sample,
    )
    assert java_ok.status == "ok" and java_ok.results[0].verdict == "passed"

    # Compile error reported cleanly
    bad_c = await execute_code(language="c", code="int main(){ syntax error }", test_cases=sample)
    assert bad_c.status == "compile_error" and bad_c.compile_output

    # Network access inside bubblewrap fails
    net_try = await execute_code(
        language="python",
        code="import socket\nsocket.create_connection(('1.1.1.1', 80), timeout=1)\nprint('BREACH')\n",
        custom_input="",
    )
    assert net_try.results[0].verdict == "runtime_error"
    assert "unreachable" in net_try.results[0].actual_output.lower()
    assert "BREACH" not in net_try.results[0].actual_output

    # Infinite loop hits time limit
    tle = await execute_code(language="python", code="while True: pass", custom_input="", time_limit_ms=300)
    assert tle.results[0].verdict == "time_limit"


@pytest.mark.asyncio
async def test_candidate_full_flow_autosave_code_run_snapshots_and_idempotent_submit(client):
    token, _ = await login_as(client, "student1", "password123")
    headers = auth_headers(token)

    exams = (await client.get("/api/candidate/exams", headers=headers)).json()
    assert len(exams) >= 1
    sample_exam = next(e for e in exams if "CS201" in e["title"])

    # Start exam; verify answers & hidden_tests are stripped
    start = await client.post(f"/api/candidate/exams/{sample_exam['id']}/start", json={}, headers=headers)
    assert start.status_code == 200
    state = start.json()
    attempt_id = state["attempt_id"]
    for question in state["questions"]:
        assert "correct_answer" not in question
        if question["coding"]:
            assert "hidden_tests" not in question["coding"]

    # Optimistic version concurrency: v2 accepted, late v1 rejected with accepted=False
    mcq_q = next(q for q in state["questions"] if q["kind"] == "mcq_single")
    save_v2 = await client.put(
        f"/api/candidate/attempts/{attempt_id}/answers/{mcq_q['id']}",
        json={"response": "A", "is_flagged": False, "version": 2},
        headers=headers,
    )
    assert save_v2.status_code == 200 and save_v2.json()["accepted"] is True

    stale_v1 = await client.put(
        f"/api/candidate/attempts/{attempt_id}/answers/{mcq_q['id']}",
        json={"response": "D", "is_flagged": False, "version": 1},
        headers=headers,
    )
    assert stale_v1.status_code == 200 and stale_v1.json()["accepted"] is False

    # Run coding question against sample tests + save code answer
    code_q = next(q for q in state["questions"] if q["kind"] == "coding")
    solution_code = "a, b = map(int, input().split())\nprint(a + b)\n"
    run_resp = await client.post(
        f"/api/candidate/attempts/{attempt_id}/code/run",
        json={"question_id": code_q["id"], "language": "python", "code": solution_code},
        headers=headers,
    )
    assert run_resp.status_code == 200
    assert all(item["verdict"] == "passed" for item in run_resp.json()["results"])

    await client.put(
        f"/api/candidate/attempts/{attempt_id}/answers/{code_q['id']}",
        json={"response": {"language": "python", "code": solution_code}, "is_flagged": False, "version": 1},
        headers=headers,
    )

    # Save theory answer so grading queue has an item
    theory_q = next(q for q in state["questions"] if q["kind"] == "theory")
    await client.put(
        f"/api/candidate/attempts/{attempt_id}/answers/{theory_q['id']}",
        json={"response": "Offloading bcrypt to worker threads avoids blocking the async event loop.", "is_flagged": False, "version": 1},
        headers=headers,
    )

    # Snapshot upload rejects non-JPEG and accepts valid JPEG
    bad_snap = await client.post(
        f"/api/candidate/attempts/{attempt_id}/snapshots",
        files={"image": ("bad.jpg", b"not-a-jpeg", "image/jpeg")},
        data={"reason": "periodic", "face_count": "1"},
        headers=headers,
    )
    assert bad_snap.status_code == 400

    good_snap = await client.post(
        f"/api/candidate/attempts/{attempt_id}/snapshots",
        files={"image": ("frame.jpg", TINY_JPEG, "image/jpeg")},
        data={"reason": "periodic", "face_count": "1"},
        headers=headers,
    )
    assert good_snap.status_code == 204

    # Proctoring event logged
    ev = await client.post(
        f"/api/candidate/attempts/{attempt_id}/events",
        json={"kind": "tab_hidden", "detail": "Switched tab"},
        headers=headers,
    )
    assert ev.status_code == 200 and ev.json()["violation_count"] == 1

    # Idempotent submission returns identical receipt & score
    sub_1 = await client.post(f"/api/candidate/attempts/{attempt_id}/submit", headers=headers)
    sub_2 = await client.post(f"/api/candidate/attempts/{attempt_id}/submit", headers=headers)
    assert sub_1.status_code == 200 and sub_2.status_code == 200
    assert sub_1.json()["receipt_id"] == sub_2.json()["receipt_id"]
    assert sub_1.json()["score"] == sub_2.json()["score"]
    # 2 marks (MCQ A) + 10 marks (coding all 5 sample+hidden tests pass) = 12.0
    assert sub_1.json()["score"] == 12.0

    # Result review available because show_results_immediately=True
    result = await client.get(f"/api/candidate/attempts/{attempt_id}/result", headers=headers)
    assert result.status_code == 200
    assert result.json()["grading_pending"] is True
