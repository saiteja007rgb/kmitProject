# ExamPulse — Evaluator & Presentation Guide
## For CSE Hackathon Defense & Viva

Welcome! This guide is written specifically for you to understand every technical design decision in **ExamPulse**, how each function works, and **how to explain it with 100% confidence to hackathon judges and evaluators**.

---

## 1. Quick Summary of What Has Been Implemented (Batch 1)

In **Batch 1 (Backend Foundation & Core Engine)**, we built the complete server-side core of the platform:

* **Authentication System**: Secure bcrypt password hashing and JWT token issuance with role-based access control (`candidate`, `invigilator`, `admin`).
* **Relational Database Layer**: Asynchronous SQLAlchemy with SQLite WAL mode (for local testing) and PostgreSQL compatibility (for Docker deployment), with 9 interconnected tables and composite constraints.
* **Seed Generator**: Automatically bootstraps the database with **1 Admin**, **1 Invigilator**, **100 Candidates** (`candidate_001` to `candidate_100`), and a **20-Question Master Assessment** on Distributed Systems.
* **Deterministic Question Shuffling**: Generates a pseudo-randomized personalized question sequence for every candidate using a hash seed. Questions are shuffled uniquely for each student, yet remain 100% stable across browser refreshes.
* **Durable Answer Autosave with Optimistic Concurrency**: Zero acknowledged-answer loss guarantee. Each answer is committed to disk before returning HTTP 200. Stale out-of-order network packets are rejected using an incremental version counter.
* **Server-Authoritative Examination Timer**: The client clock is purely a visual countdown. The server computes deadlines and rejects any answer submitted after expiration with HTTP 403 `Forbidden`.
* **Idempotent Final Submission & Scoring**: Server-side grading (with positive marks and negative mark deductions). Double-clicking Submit returns the existing submission without duplicating records or recalculating scores.

---

## 2. Component & Function Breakdown (How Each Part Works)

### 2.1 Configuration (`backend/app/config.py`)
* **What it does**: Centralizes all environment variables using Pydantic Settings.
* **Why it matters**: It allows the backend to switch dynamically between Docker Compose (PostgreSQL + Redis) and Local Development (SQLite WAL + in-memory Redis fallback) without changing a single line of application code.

### 2.2 Database Engine & Models (`backend/app/database.py` & `backend/app/models.py`)
* **WAL Mode (`PRAGMA journal_mode=WAL`)**:
  * *Evaluator question*: "Why did you enable WAL mode on SQLite?"
  * *Your answer*: "In default rollback journal mode, SQLite locks the entire database during writes, blocking readers. In WAL (Write-Ahead Logging) mode, readers do not block writers, and writers do not block readers. This provides high concurrency for multiple candidate autosaves."
* **Single Active Session Constraint**:
  ```python
  UniqueConstraint("candidate_id", "examination_id", name="uq_candidate_examination")
  ```
  * Enforces at the database schema level that a candidate can never open two competing active sessions for the same exam.
* **Answer Constraint & Versioning**:
  ```python
  UniqueConstraint("session_id", "question_id", name="uq_session_question")
  ```
  * Ensures exactly one answer record per question per candidate session, enabling atomic UPSERTs.

### 2.3 Deterministic Question Shuffling (`generate_personalized_order`)
* **Located in**: `backend/app/services/exam_service.py`
* **How it works**:
  ```python
  seed_str = f"{candidate_id}:{exam_id}"
  seed_int = int(hashlib.sha256(seed_str.encode()).hexdigest()[:16], 16)
  rng = random.Random(seed_int)
  rng.shuffle(shuffled)
  ```
* **Why evaluators will love this**:
  1. **Anti-Cheating**: Candidate 1 sitting next to Candidate 2 sees a completely different Question 1.
  2. **Zero Inconsistency**: Because the seed is derived deterministically from `candidate_id + exam_id`, if a candidate's computer crashes or refreshes, the server restores the *exact same* personalized question sequence without reshuffling!
  3. **Security**: When questions are returned to the candidate (`GET /api/sessions/{id}/questions`), the fields `correct_answer` and `explanation` are strictly stripped from the JSON payload. Even if a candidate opens Chrome Developer Tools, they cannot find the answers.

### 2.4 Durable Autosave with Versioning (`save_answer_durable`)
* **Located in**: `backend/app/services/exam_service.py`
* **How it works**:
  1. **Deadline Check**: Validates `now <= session.deadline + 10s grace`. If expired, marks session as `expired` and returns HTTP 403.
  2. **Optimistic Versioning**:
     ```python
     if existing_answer.version >= incoming_version:
         return existing_answer  # Reject stale/delayed network packet!
     ```
     If a candidate selects "A" ($v=1$) and then immediately switches to "B" ($v=2$), but due to cellular network jitter packet $v=1$ arrives *after* packet $v=2$, the server detects that $v=1 < v=2$ and refuses to overwrite the newer answer.
  3. **Atomic Commit**: Calls `await db.commit()`. The answer is written to non-volatile disk storage before sending HTTP 200. Only when the frontend receives this HTTP 200 does it turn the badge from "Saving..." to "Saved".

### 2.5 Idempotent Submission & Server-Side Scoring (`submit_exam_idempotent`)
* **Located in**: `backend/app/services/exam_service.py`
* **How it works**:
  1. **Idempotency Guard**:
     ```python
     if session.status == "submitted":
         return existing_submission
     ```
     If the candidate clicks Submit multiple times or the browser auto-retries, it never recalculates or duplicates the submission.
  2. **Authoritative Evaluation**: The backend compares each candidate answer against the master answer key in the database:
     * Correct $\rightarrow$ `total_score += question.marks`
     * Incorrect $\rightarrow$ `total_score -= question.negative_marks` (e.g. 0.25 penalty)
     * Total score is capped at `max(0.0, score)` to prevent negative aggregate totals.

---

## 3. How to Answer Tough Evaluator Questions

### Q1: "How do you guarantee that an acknowledged answer is never lost if the server crashes?"
> **Your Answer**:
> "We implement a strict **durable write guarantee**. When a candidate selects an answer, the frontend displays 'Saving...'. The backend receives the answer, executes an atomic database UPSERT inside a transaction, and flushes the commit to disk. Only after the database confirms the disk write does the backend return HTTP 200 OK. Only upon receiving that HTTP 200 does the candidate's UI display 'Saved'. Even if the backend process or Redis crashes 1 millisecond later, the answer is already permanently on disk in PostgreSQL/SQLite."

### Q2: "What happens if a candidate changes their local computer time backwards to get extra time?"
> **Your Answer**:
> "The client clock is treated strictly as an untrusted visual display. The backend is the sole authority on time. When the exam starts, the server records the authoritative start time and deadline using UTC server time. Every single autosave request and final submission validates the current server time against that deadline. If the server time has passed the deadline, the request is immediately rejected with HTTP 403 Forbidden, regardless of what the candidate's browser clock says."

### Q3: "What prevents out-of-order network requests from corrupting answers?"
> **Your Answer**:
> "We use **optimistic concurrency control with version sequences**. Every autosave payload from the client includes an incrementing `version` number. The backend compares the incoming version with the stored version. If an older request arrives late due to network latency after a newer answer was already saved, the backend detects `stored_version >= incoming_version` and drops the stale update."

### Q4: "Why don't all candidates get questions in the same order?"
> **Your Answer**:
> "We generate a deterministic personalized question order for each candidate. We hash `candidate_id + exam_id` using SHA-256 to create a unique integer seed, and shuffle the question IDs using that seed. This prevents adjacent candidates from looking at each other's screens. Because the algorithm is deterministic, reconnecting or refreshing the page restores the exact same question order without re-randomization."

### Q5: "How do you prevent duplicate submissions if a student double-clicks Submit?"
> **Your Answer**:
> "Our submission endpoint is strictly **idempotent**. When the submit request arrives, the backend checks if `session.status == 'submitted'`. If it is already submitted, the backend immediately returns the existing submission record without recalculating marks or writing duplicate database rows. Furthermore, a database unique constraint on `submissions(session_id)` physically prevents more than one submission record from ever existing."

---

## 4. Test Verification Evidence

All 6 core engine tests were verified via Pytest:
```
tests/test_core_engine.py::test_auth_login PASSED                        [ 16%]
tests/test_core_engine.py::test_deterministic_question_shuffling PASSED  [ 33%]
tests/test_core_engine.py::test_single_active_session_enforcement PASSED [ 50%]
tests/test_core_engine.py::test_durable_autosave_and_versioning PASSED   [ 66%]
tests/test_core_engine.py::test_server_authoritative_timer PASSED        [ 83%]
tests/test_core_engine.py::test_idempotent_final_submission_and_scoring PASSED [100%]

============================== 6 passed in 2.33s ===============================
```

---

## 5. Default Demonstration Credentials

| Role | Username | Password | Notes |
|---|---|---|---|
| **Administrator** | `admin` | `admin123` | Full access to invigilator dashboard & overview |
| **Invigilator** | `invigilator` | `invigilator123` | Real-time monitoring & leaderboard inspection |
| **Candidates (100 total)** | `candidate_001` through `candidate_100` | `password123` | Codes: `C-1001` to `C-1100`. Each receives a personalized question sequence! |

---
*Ready for Batch 2: React Frontend & Real-Time Distributed WebSocket Wiring!*


---

## 6. Batch 2: Distributed Multi-Instance Architecture & Frontend

In **Batch 2**, we implemented and verified the complete **Distributed React Frontend and Cross-Backend WebSocket Event Bus**:

### 6.1 How Cross-Instance Synchronization Works
* Suppose an invigilator connects to **Backend 1** (Port 8001).
* A candidate is taking the exam on **Backend 2** (Port 8002).
* When the candidate selects an answer or submits, Backend 2 writes to the database and publishes an event to Redis channel `exam:{exam_id}:events`.
* Backend 1 has a background task listening to this Redis Pub/Sub channel. The moment the message arrives, Backend 1 forwards it down the WebSocket connection to the Invigilator's browser.
* **The Invigilator sees candidate progress live without ever refreshing their screen!**

### 6.2 How to Demonstrate Cross-Instance Statelessness to Evaluators
1. Open Candidate in one browser tab connected to `http://127.0.0.1:8001/api/sessions/...` (Backend 1).
2. Save answer "A" on Question 1.
3. Open another browser tab or send a request to `http://127.0.0.1:8002/api/sessions/...` (Backend 2).
4. **Backend 2 immediately recognizes the candidate's active session, returns answer "A", and continues the same exam with the exact same deadline!**
5. Evaluator takeaway: Neither backend holds private in-memory session state; both backends are 100% stateless and interchangeable.

### 6.3 How to Run the Distributed Platform
Simply execute:
```bash
./run_local.sh
```
This single command spins up:
1. **Backend Instance 1** on `http://127.0.0.1:8001`
2. **Backend Instance 2** on `http://127.0.0.1:8002`
3. **React Vite Frontend** on `http://127.0.0.1:5173`
