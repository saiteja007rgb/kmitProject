import asyncio
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from app.database import AsyncSessionLocal, engine, Base
from app.models import User, Candidate, Examination, Question
from app.utils.security import hash_password

QUESTIONS_DATA = [
    {
        "text": "In the CAP Theorem, which two properties can a distributed data store guarantee during an active network partition?",
        "options": [
            {"id": "A", "text": "Consistency and Partition Tolerance (CP)"},
            {"id": "B", "text": "Availability and Consistency (AC)"},
            {"id": "C", "text": "Availability and Durability (AD)"},
            {"id": "D", "text": "Partition Tolerance and Linearity (PL)"}
        ],
        "correct": "A",
        "explanation": "During a network partition (P), a distributed system must choose between Consistency (C) and Availability (A)."
    },
    {
        "text": "What is the primary benefit of making API endpoints idempotent when handling autosave requests?",
        "options": [
            {"id": "A", "text": "It encrypts the payload in transit"},
            {"id": "B", "text": "Repeated processing of duplicate requests yields the identical system state without corruption"},
            {"id": "C", "text": "It completely bypasses disk persistence to save I/O cycles"},
            {"id": "D", "text": "It speeds up client-side JavaScript execution"}
        ],
        "correct": "B",
        "explanation": "Idempotent requests guarantee that network retries do not duplicate or corrupt data."
    },
    {
        "text": "How does an atomic UPSERT (ON CONFLICT DO UPDATE) protect candidate answers during concurrent updates?",
        "options": [
            {"id": "A", "text": "It locks the entire database server in single-user mode"},
            {"id": "B", "text": "It inserts a new record or updates existing in a single atomic database engine operation"},
            {"id": "C", "text": "It caches the request in browser LocalStorage only"},
            {"id": "D", "text": "It prevents the user from clicking the Next button"}
        ],
        "correct": "B",
        "explanation": "UPSERT atomically resolves duplicate primary/unique keys without throwing constraint violations."
    },
    {
        "text": "Why should session timers be server-authoritative rather than relying on browser system clocks?",
        "options": [
            {"id": "A", "text": "Client clocks can be easily tampered with, changed, or inaccurate"},
            {"id": "B", "text": "Browsers do not support JavaScript timing functions"},
            {"id": "C", "text": "Server clocks consume less network bandwidth"},
            {"id": "D", "text": "It is required by HTTP/1.1 specification"}
        ],
        "correct": "A",
        "explanation": "Server-authoritative timing prevents candidates from altering local system time to gain extra exam duration."
    },
    {
        "text": "What data structure in Redis is optimal for maintaining an instantaneous, real-time leaderboard ranked by candidate score?",
        "options": [
            {"id": "A", "text": "HyperLogLog"},
            {"id": "B", "text": "Sorted Set (ZSET)"},
            {"id": "C", "text": "Bloom Filter"},
            {"id": "D", "text": "Pub/Sub Channel"}
        ],
        "correct": "B",
        "explanation": "Redis Sorted Sets (ZSET) maintain elements ordered by score with O(log N) insertion and range retrieval."
    },
    {
        "text": "In a multi-instance stateless backend architecture, how do backend instances share real-time WebSocket events?",
        "options": [
            {"id": "A", "text": "Through local Python global variables on each server"},
            {"id": "B", "text": "Through a shared message broker like Redis Pub/Sub"},
            {"id": "C", "text": "By writing temporary files to /tmp"},
            {"id": "D", "text": "By having browsers connect to all backend servers simultaneously"}
        ],
        "correct": "B",
        "explanation": "Redis Pub/Sub acts as an inter-instance message bus to distribute events across disparate server processes."
    },
    {
        "text": "What does optimistic concurrency control using a version counter achieve in answer autosave?",
        "options": [
            {"id": "A", "text": "Compresses answers before transmission"},
            {"id": "B", "text": "Ensures older, delayed network requests do not overwrite newer candidate answers"},
            {"id": "C", "text": "Allows candidates to inspect correct answers"},
            {"id": "D", "text": "Forces the browser to reload the page"}
        ],
        "correct": "B",
        "explanation": "Checking version >= incoming_version rejects out-of-order network packets."
    },
    {
        "text": "Which HTTP status code is most appropriate when a candidate attempts to save an answer after the exam deadline has elapsed?",
        "options": [
            {"id": "A", "text": "200 OK"},
            {"id": "B", "text": "301 Moved Permanently"},
            {"id": "C", "text": "403 Forbidden"},
            {"id": "D", "text": "502 Bad Gateway"}
        ],
        "correct": "C",
        "explanation": "403 Forbidden indicates the server understands the request but refuses to authorize it due to expired deadline."
    },
    {
        "text": "What is the primary purpose of SQLite's Write-Ahead Logging (WAL) mode in high-concurrency local environments?",
        "options": [
            {"id": "A", "text": "Allows readers to read while writers write without blocking each other"},
            {"id": "B", "text": "Deletes the database file after every query"},
            {"id": "C", "text": "Disables ACID transactions completely"},
            {"id": "D", "text": "Limits the database to 10 rows"}
        ],
        "correct": "A",
        "explanation": "WAL mode decouples readers and writers, permitting concurrent reads without locking against active writes."
    },
    {
        "text": "In collusion detection, why is high similarity on INCORRECT answers a stronger cheating signal than similarity on correct answers?",
        "options": [
            {"id": "A", "text": "Correct answers are universally common; choosing the exact same unusual distractor has low independent probability"},
            {"id": "B", "text": "Incorrect answers are always flagged by the compiler"},
            {"id": "C", "text": "Candidates are not allowed to submit incorrect answers"},
            {"id": "D", "text": "It is mathematically impossible to guess a correct answer"}
        ],
        "correct": "A",
        "explanation": "Two candidates sharing the exact same non-intuitive incorrect choices is strong statistical evidence of collusion."
    },
    {
        "text": "What prevents duplicate final submissions when a candidate accidentally double-clicks the Submit button?",
        "options": [
            {"id": "A", "text": "Browser CSS styling"},
            {"id": "B", "text": "Database transaction locking and checking if session.status == 'submitted'"},
            {"id": "C", "text": "Turning off the server connection"},
            {"id": "D", "text": "Locust load testing"}
        ],
        "correct": "B",
        "explanation": "Database transactions with idempotency guards return existing submission records on duplicate requests."
    },
    {
        "text": "Why must correct answers never be returned in the candidate's question payload?",
        "options": [
            {"id": "A", "text": "To reduce network JSON payload by 2 bytes"},
            {"id": "B", "text": "A candidate could inspect browser developer tools or network responses to see the answer key"},
            {"id": "C", "text": "JSON does not support string fields"},
            {"id": "D", "text": "The database cannot store correct answers"}
        ],
        "correct": "B",
        "explanation": "Client-side payloads must strictly omit solution keys to prevent trivial source inspection cheating."
    },
    {
        "text": "How does deterministic question shuffling benefit assessment integrity?",
        "options": [
            {"id": "A", "text": "Candidates adjacent to each other see different question orders, while reconnects restore the same sequence"},
            {"id": "B", "text": "It changes questions on every second"},
            {"id": "C", "text": "It translates questions to Latin"},
            {"id": "D", "text": "It generates random mathematical numbers"}
        ],
        "correct": "A",
        "explanation": "Deterministic shuffling uses a candidate-specific seed to prevent screen-peeking while maintaining session consistency."
    },
    {
        "text": "What does ACID durability guarantee in database systems?",
        "options": [
            {"id": "A", "text": "Once a transaction is committed, its changes survive crashes and power loss on non-volatile storage"},
            {"id": "B", "text": "Queries execute in under 1 nanosecond"},
            {"id": "C", "text": "Passwords are automatically reset every week"},
            {"id": "D", "text": "Data is duplicated on 100 cloud regions"}
        ],
        "correct": "A",
        "explanation": "Durability ensures committed data is safely written to disk and recoverable upon restart."
    },
    {
        "text": "What is the primary function of a reverse proxy like Nginx in front of FastAPI application servers?",
        "options": [
            {"id": "A", "text": "Distribute traffic evenly (Load Balancing), manage SSL termination, and buffer slow clients"},
            {"id": "B", "text": "Run unit tests automatically"},
            {"id": "C", "text": "Execute Python scripts natively"},
            {"id": "D", "text": "Generate frontend React JSX code"}
        ],
        "correct": "A",
        "explanation": "Reverse proxies efficiently distribute load and protect internal application services."
    },
    {
        "text": "Which data metric is most critical when measuring high-load API performance during examination spikes?",
        "options": [
            {"id": "A", "text": "95th/99th percentile latency and error rate under concurrency"},
            {"id": "B", "text": "Average latency only"},
            {"id": "C", "text": "Lines of code in the backend"},
            {"id": "D", "text": "The color scheme of the terminal"}
        ],
        "correct": "A",
        "explanation": "p95/p99 tail latencies reveal system bottlenecks that averages mask."
    },
    {
        "text": "Why should password hashes use algorithms with work factors (like bcrypt or Argon2) instead of raw MD5 or SHA-256?",
        "options": [
            {"id": "A", "text": "They include salts and deliberate computational cost to resist brute-force and rainbow table attacks"},
            {"id": "B", "text": "They produce shorter hashes"},
            {"id": "C", "text": "They are reversible without a key"},
            {"id": "D", "text": "They run faster on GPUs"}
        ],
        "correct": "A",
        "explanation": "Bcrypt's adaptive work factor defends against hardware-accelerated password cracking."
    },
    {
        "text": "In database design, what does a UNIQUE(candidate_id, examination_id) constraint enforce?",
        "options": [
            {"id": "A", "text": "A candidate can register for an exam, but never submit it"},
            {"id": "B", "text": "Only a single active examination session can exist per candidate per exam, preventing concurrent multi-device sessions"},
            {"id": "C", "text": "The candidate's score must be unique across all students"},
            {"id": "D", "text": "The question order is reversed"}
        ],
        "correct": "B",
        "explanation": "Composite unique constraints enforce the single active session rule at the database schema level."
    },
    {
        "text": "What role does Jaccard similarity play in comparing candidate answer profiles?",
        "options": [
            {"id": "A", "text": "Measures the intersection over the union of matching answer attributes between two candidates"},
            {"id": "B", "text": "Calculates the candidate's typing speed"},
            {"id": "C", "text": "Determines the candidate's geographic IP address"},
            {"id": "D", "text": "Predicts future exam grades"}
        ],
        "correct": "A",
        "explanation": "Jaccard coefficient evaluates the proportion of overlapping choices between two sets of responses."
    },
    {
        "text": "What is the recommended behavior when a candidate's internet connection drops while selecting an answer?",
        "options": [
            {"id": "A", "text": "Immediately crash the browser and fail the exam"},
            {"id": "B", "text": "Preserve changes in a local pending queue, show 'Retrying...', and sync with server once connection returns"},
            {"id": "C", "text": "Show 'Saved' immediately even though server hasn't acknowledged"},
            {"id": "D", "text": "Reset all previous answers"}
        ],
        "correct": "B",
        "explanation": "A resilient UI retains pending answers, displays honest connection status, and reconciles upon reconnection."
    }
]

async def seed_database():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        # Check if already seeded
        res = await session.execute(select(User).where(User.username == "admin"))
        if res.scalar_one_or_none():
            print("Database already seeded. Skipping.")
            return

        print("Seeding database with Admin, Invigilator, 100 Candidates, and Examination...")

        # 1. Admin & Invigilator Users
        admin_user = User(
            username="admin",
            password_hash=hash_password("admin123"),
            role="admin"
        )
        invigilator_user = User(
            username="invigilator",
            password_hash=hash_password("invigilator123"),
            role="invigilator"
        )
        session.add_all([admin_user, invigilator_user])
        await session.flush()

        # 2. 100 Candidates
        candidates = []
        for i in range(1, 101):
            code_num = f"{i:03d}"
            cand_user = User(
                username=f"candidate_{code_num}",
                password_hash=hash_password("password123"),
                role="candidate"
            )
            session.add(cand_user)
            await session.flush()

            cand_profile = Candidate(
                user_id=cand_user.id,
                candidate_code=f"C-{1000 + i}",
                display_name=f"Candidate {code_num}"
            )
            session.add(cand_profile)
            candidates.append(cand_profile)

        # 3. Master Examination
        now = datetime.now(timezone.utc)
        exam = Examination(
            title="CS201: Distributed Systems & Scalable Architecture",
            description="Comprehensive assessment on distributed consensus, data consistency, caching strategies, and load resilience.",
            duration_seconds=3600,
            start_time=now - timedelta(hours=1),
            end_time=now + timedelta(hours=24),
            total_marks=float(len(QUESTIONS_DATA)),
            negative_mark_factor=0.25,
            status="active"
        )
        session.add(exam)
        await session.flush()

        # 4. 20 Master Questions
        for idx, q_data in enumerate(QUESTIONS_DATA):
            q = Question(
                examination_id=exam.id,
                question_text=q_data["text"],
                question_type="mcq",
                options=q_data["options"],
                correct_answer=q_data["correct"],
                marks=1.0,
                negative_marks=0.25,
                order_index=idx + 1,
                explanation=q_data.get("explanation")
            )
            session.add(q)

        await session.commit()
        print("Database seeding completed successfully!")
        print(f"Created: 1 Admin, 1 Invigilator, 100 Candidates, 1 Exam with {len(QUESTIONS_DATA)} questions.")

if __name__ == "__main__":
    asyncio.run(seed_database())
