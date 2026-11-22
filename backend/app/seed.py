"""Initial bootstrap seeding.

Always creates the initial admin account (and default invigilator in non-production).
Does NOT spam 100 random students: when `SEED_DEMO_DATA=true`, creates one small sample batch
with 3 demo students enrolled in one multi-format sample exam (MCQ, multi-select, numeric,
short-text, theory, and coding) so a fresh install is immediately testable while admins manage
real students through the UI or CSV import.
"""
import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError

from app.config import settings
from app.core.clock import utc_now
from app.core.security import hash_password
from app.database import Base, SessionFactory, engine
from app.models import Batch, Candidate, Enrollment, Exam, Question, User

logger = logging.getLogger("exampulse.seed")

SAMPLE_QUESTIONS = [
    {
        "kind": "mcq_single",
        "prompt": "In the CAP theorem, which two guarantees can a distributed datastore uphold during an active network partition?",
        "options": [
            {"id": "A", "text": "Consistency and Partition Tolerance (CP) or Availability and Partition Tolerance (AP)"},
            {"id": "B", "text": "Consistency and Availability without Partition Tolerance"},
            {"id": "C", "text": "Durability and Isolation only"},
            {"id": "D", "text": "All three simultaneously without trade-offs"},
        ],
        "correct_answer": "A",
        "marks": 2.0,
        "negative_marks": 0.5,
        "explanation": "During a partition, nodes must choose between refusing writes/reads (CP) or serving potentially stale data (AP).",
    },
    {
        "kind": "mcq_multi",
        "prompt": "Select all mechanisms that help protect an online assessment API against replay or duplicate writes.",
        "options": [
            {"id": "A", "text": "Idempotent submission endpoints backed by a unique database constraint"},
            {"id": "B", "text": "Monotonic per-question version numbers rejecting stale packets"},
            {"id": "C", "text": "Storing JWTs in URL query strings for every REST call"},
            {"id": "D", "text": "Rotating refresh tokens with reuse detection"},
        ],
        "correct_answer": ["A", "B", "D"],
        "marks": 3.0,
        "negative_marks": 0.5,
        "explanation": "Idempotency, version checks, and refresh token rotation prevent duplicates and replay attacks; JWTs in REST URLs leak into logs.",
    },
    {
        "kind": "true_false",
        "prompt": "Trusting the candidate browser's system clock (`Date.now()`) is sufficient to enforce an examination deadline.",
        "options": [
            {"id": "T", "text": "True"},
            {"id": "F", "text": "False"},
        ],
        "correct_answer": "F",
        "marks": 1.0,
        "negative_marks": 0.25,
        "explanation": "Users can freely set their OS clock backwards; deadlines must always be verified against server UTC time.",
    },
    {
        "kind": "numeric",
        "prompt": "If a question has 4 choices (1 correct, 3 wrong), what is the probability (as a decimal to 3 decimal places) that two students guessing independently pick the exact same wrong choice on 3 consecutive questions? Use (1/3)^3.",
        "options": [],
        "correct_answer": "0.037",
        "marks": 2.0,
        "negative_marks": 0.0,
        "numeric_tolerance": 0.002,
        "explanation": "(1/3)^3 = 1/27 ≈ 0.0370.",
    },
    {
        "kind": "short_text",
        "prompt": "Which PostgreSQL / SQLite journaling mode allows concurrent readers to proceed without being blocked by an active writer?",
        "options": [],
        "correct_answer": "WAL",
        "marks": 2.0,
        "negative_marks": 0.0,
        "explanation": "Write-Ahead Logging (WAL) separates writes from reads so readers do not block writers.",
    },
    {
        "kind": "theory",
        "prompt": "Explain why bcrypt password hashing should be offloaded off an async Python web server's event loop, and what happens under high login concurrency if it is not.",
        "options": [],
        "correct_answer": None,
        "marks": 5.0,
        "negative_marks": 0.0,
        "explanation": "bcrypt is intentionally CPU-bound (~150–300 ms at cost 12). Running it directly inside an async coroutine blocks the entire event loop, stalling all other HTTP and WebSocket connections on that worker. Running it via asyncio.to_thread keeps the loop responsive.",
    },
    {
        "kind": "coding",
        "prompt": "Given two space-separated integers A and B on standard input, print their sum (A + B) on standard output.\n\nConstraints: -10^9 <= A, B <= 10^9.",
        "options": [],
        "correct_answer": None,
        "marks": 10.0,
        "negative_marks": 0.0,
        "explanation": "Read two 64-bit integers from stdin and print their sum.",
        "coding": {
            "languages": ["python", "c", "cpp", "java", "javascript"],
            "starter_code": {
                "python": "a, b = map(int, input().split())\nprint(a + b)\n",
                "c": "#include <stdio.h>\nint main(void) {\n    long long a, b;\n    if (scanf(\"%lld %lld\", &a, &b) == 2) printf(\"%lld\\n\", a + b);\n    return 0;\n}\n",
                "cpp": "#include <iostream>\nusing namespace std;\nint main() {\n    long long a, b;\n    if (cin >> a >> b) cout << (a + b) << '\\n';\n    return 0;\n}\n",
                "java": "import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        System.out.println(sc.nextLong() + sc.nextLong());\n    }\n}\n",
                "javascript": "const fs = require('fs');\nconst [a, b] = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(BigInt);\nconsole.log((a + b).toString());\n",
            },
            "time_limit_ms": 2000,
            "memory_limit_mb": 256,
            "sample_tests": [
                {"input": "3 5\n", "expected_output": "8\n"},
                {"input": "-10 4\n", "expected_output": "-6\n"},
            ],
            "hidden_tests": [
                {"input": "0 0\n", "expected_output": "0\n"},
                {"input": "1000000000 1000000000\n", "expected_output": "2000000000\n"},
                {"input": "-999999999 999999999\n", "expected_output": "0\n"},
            ],
        },
    },
]


async def seed_database() -> None:
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
    except (OperationalError, ProgrammingError) as exc:
        if "already exists" not in str(exc).lower():
            raise

    async with SessionFactory() as db:
        existing_admin = (await db.execute(select(User).where(User.username == "admin"))).scalar_one_or_none()
        if existing_admin is not None:
            return

        logger.info("Bootstrapping initial ExamPulse accounts...")
        try:
            await _insert_initial_data(db)
        except IntegrityError:
            # Another backend replica seeded concurrently.
            await db.rollback()
            logger.info("Seed already completed by another instance.")


async def _insert_initial_data(db) -> None:
    admin = User(
        username="admin",
        password_hash=await hash_password(settings.initial_admin_password),
        role="admin",
        full_name="System Administrator",
        email="admin@exampulse.local",
        must_change_password=False,
    )
    invigilator = User(
        username="invigilator",
        password_hash=await hash_password("invigilator123"),
        role="invigilator",
        full_name="Lead Invigilator",
        email="invigilator@exampulse.local",
        must_change_password=False,
    )
    db.add_all([admin, invigilator])
    await db.flush()

    if not settings.seed_demo_data:
        await db.commit()
        return

    batch = Batch(name="CSE-2026", description="Sample cohort for evaluation")
    db.add(batch)
    await db.flush()

    demo_students = [
        ("student1", "Arjun Mehta", "arjun.mehta@example.edu", "KMIT-001"),
        ("student2", "Priya Nair", "priya.nair@example.edu", "KMIT-002"),
        ("student3", "Rohan Das", "rohan.das@example.edu", "KMIT-003"),
    ]
    demo_password_hash = await hash_password("password123")
    created_candidates: list[Candidate] = []
    for username, full_name, email, code in demo_students:
        user = User(
            username=username,
            password_hash=demo_password_hash,
            role="candidate",
            full_name=full_name,
            email=email,
            must_change_password=False,
        )
        db.add(user)
        await db.flush()
        candidate = Candidate(user_id=user.id, candidate_code=code, batch_id=batch.id)
        db.add(candidate)
        await db.flush()
        created_candidates.append(candidate)

    now = utc_now()
    exam = Exam(
        title="CS201: Systems & Programming Assessment",
        description="Sample live exam covering MCQ, multi-select, numeric, short answer, theory, and sandboxed coding.",
        instructions=(
            "1. Keep your camera on and stay in fullscreen mode for the entire exam.\n"
            "2. Answers are automatically saved to the server.\n"
            "3. Coding solutions are evaluated against sample and hidden test cases."
        ),
        starts_at=now - timedelta(hours=1),
        ends_at=now + timedelta(days=7),
        duration_minutes=60,
        lifecycle_state="published",
        shuffle_questions=True,
        shuffle_options=True,
        negative_marking=0.25,
        max_violations=5,
        require_webcam=True,
        require_fullscreen=True,
        show_results_immediately=True,
        created_by=admin.id,
    )
    db.add(exam)
    await db.flush()

    for position, spec in enumerate(SAMPLE_QUESTIONS, start=1):
        db.add(
            Question(
                exam_id=exam.id,
                position=position,
                kind=spec["kind"],
                prompt=spec["prompt"],
                options=spec.get("options", []),
                correct_answer=spec.get("correct_answer"),
                marks=spec["marks"],
                negative_marks=spec.get("negative_marks", 0.0),
                explanation=spec.get("explanation"),
                numeric_tolerance=spec.get("numeric_tolerance", 0.0),
                coding=spec.get("coding"),
            )
        )

    for candidate in created_candidates:
        db.add(Enrollment(exam_id=exam.id, candidate_id=candidate.id))

    await db.commit()
    logger.info("Seeded admin, invigilator, 3 demo students, and 1 sample live exam.")


if __name__ == "__main__":
    asyncio.run(seed_database())
