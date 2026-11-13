# ExamPulse
### High-Load Online Assessment Platform with Real-Time Monitoring and Collusion Detection

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38B2AC?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Locust](https://img.shields.io/badge/Load_Testing-Locust-green?logo=locust&logoColor=white)](https://locust.io)

ExamPulse is a distributed, high-concurrency online examination platform architected to maintain responsive latency, zero answer loss, and data consistency during sudden traffic spikes when thousands of candidates start an assessment simultaneously.

---

## 1. System Architecture

```
                       [ 20,000 Candidates / Invigilators ]
                                       │
                                       ▼
                           [ React + Vite Frontend ]
                                       │
                         HTTP REST / WebSocket Requests
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │   Load Balancer (Nginx)       │
                       │   (Port 80 / Least-Conn)      │
                       └───────────────────────────────┘
                                       │
                   Round-Robin / Least-Connections Routing
                                       │
                  ┌────────────────────┴────────────────────┐
                  │                                         │
                  ▼                                         ▼
     ┌──────────────────────────┐              ┌──────────────────────────┐
     │  FastAPI Backend 1       │              │  FastAPI Backend 2       │
     │  (Port 8001 - Stateless) │              │  (Port 8002 - Stateless) │
     └──────────────────────────┘              └──────────────────────────┘
                  \                                         /
                   \───────┬───────────────────────┬───────/
                           │                       │
                           ▼                       ▼
               ┌───────────────────────┐   ┌───────────────────────┐
               │  Redis 7 (In-Memory)  │   │ PostgreSQL 16 (Disk)  │
               │  - Pub/Sub bus        │   │ - Source of Truth     │
               │  - Fast cache         │   │ - ACID Transactions   │
               │  - Live Leaderboard   │   │ - Durable Answers     │
               │  - Rate Limiting      │   │ - Audits & Results    │
               └───────────────────────┘   └───────────────────────┘
```

---

## 2. Solutions to the 5 Core Engineering Challenges

| Challenge | ExamPulse Architecture Solution |
|---|---|
| **1. Traffic Spikes (20,000 users)** | Scaled across stateless FastAPI workers via Nginx load balancing. Static question metadata and deterministic order caches reduce database read queries. |
| **2. Zero Acknowledged-Answer Loss** | Answers are committed to PostgreSQL using an atomic database **UPSERT** (`ON CONFLICT DO UPDATE`) before returning HTTP 200. Only acknowledged answers are marked "Saved". |
| **3. Concurrency & Statelessness** | Session tokens use signed stateless JWTs. Neither backend keeps in-memory candidate dicts. Database uniqueness constraints enforce the single-active-session rule. |
| **4. Real-Time Monitoring** | Cross-instance **Redis Pub/Sub** bus forwards candidate actions between backend processes to active Invigilator WebSocket connections with zero page refresh. |
| **5. AI-Based Collusion Detection** | Statistical Jaccard similarity and Wrong-Answer Coincidence scoring. Pairs sharing $\ge 3$ identical incorrect answers are flagged with explainable mathematical evidence. |

---

## 3. Quick Start & Execution

### Option A: Instant Local Development Runner (No Docker Needed)
Runs Backend Instance 1 (8001), Backend Instance 2 (8002), and the React Frontend (5173) simultaneously:
```bash
# 1. Run the local runner script
./run_local.sh
```
* **Frontend Application**: [http://127.0.0.1:5173](http://127.0.0.1:5173)
* **Backend 1 API Docs**: [http://127.0.0.1:8001/docs](http://127.0.0.1:8001/docs)
* **Backend 2 API Docs**: [http://127.0.0.1:8002/docs](http://127.0.0.1:8002/docs)

### Option B: Production Multi-Container Deployment (Docker Compose)
Spins up Nginx, 2 FastAPI backend instances, PostgreSQL 16, Redis 7, and React:
```bash
docker compose up --build
```
Access the application through the Nginx reverse proxy at [http://localhost](http://localhost).

---

## 4. Default Seed Accounts

The platform includes seed data ready for immediate evaluation:

| Role | Username | Password | Notes |
|---|---|---|---|
| **Administrator** | `admin` | `admin123` | Full access to real-time command center & collusion scanner |
| **Invigilator** | `invigilator` | `invigilator123` | Live candidate table & ranking leaderboard |
| **100 Candidates** | `candidate_001` to `candidate_100` | `password123` | Codes: `C-1001` through `C-1100`. Each receives a unique question sequence! |

---

## 5. Automated Testing & Verification

### Pytest Backend Suite
Run the 7 comprehensive unit and integration tests:
```bash
cd backend
source venv/bin/activate
pytest -v
```
**Test coverage highlights:**
1. `test_auth_login`: JWT token verification and role boundaries.
2. `test_deterministic_question_shuffling`: Candidate 1 and Candidate 2 receive different sequences; refreshing preserves order; answers keys strictly hidden.
3. `test_single_active_session_enforcement`: Re-entering an exam returns the existing active session rather than creating duplicate sessions.
4. `test_durable_autosave_and_versioning`: Atomic database UPSERT; stale out-of-order network packets are rejected via version counters.
5. `test_server_authoritative_timer`: Rejects answer saves with HTTP 403 Forbidden after deadline expires.
6. `test_idempotent_final_submission_and_scoring`: Server-side scoring with negative marks; double-click submit returns identical record with zero duplicate rows.
7. `test_collusion_detection`: Vector similarity detects copying and generates statistical evidence.

### Locust High-Load Simulation
Run automated virtual candidate tests:
```bash
# Run baseline 100-candidate test
./load_testing/run_load_test.sh http://127.0.0.1:8001 100 20 15s

# Run 1,000-candidate test
./load_testing/run_load_test.sh http://127.0.0.1:8001 1000 100 30s
```
Reports and latency distributions (p50, p95, p99) are automatically saved to `load_testing/reports/`.

---

## 6. Project Directory Layout

```
Kmit Project/
├── backend/
│   ├── app/
│   │   ├── config.py                # Dynamic configuration & fallback detection
│   │   ├── database.py              # Async SQLAlchemy engine with SQLite WAL & Postgres
│   │   ├── models.py                # 9 relational entities & constraints
│   │   ├── schemas.py               # Pydantic v2 validation contracts
│   │   ├── redis_client.py          # Redis Pub/Sub & Leaderboard ZSET manager
│   │   ├── seed.py                  # 100 candidates + 20 distributed systems MCQs
│   │   ├── main.py                  # FastAPI lifespan & router registration
│   │   ├── services/
│   │   │   ├── exam_service.py       # Shuffling, timer validation, autosave, scoring
│   │   │   └── collusion_service.py  # Matrix similarity & wrong-answer coincidence
│   │   ├── routers/
│   │   │   ├── auth.py              # Login & JWT issuing
│   │   │   ├── exams.py             # Exam starting & personalized question retrieval
│   │   │   ├── answers.py           # Durable autosave & clear selection
│   │   │   ├── submissions.py       # Idempotent final submission
│   │   │   ├── admin.py             # Live counters, candidate table, leaderboard
│   │   │   └── websockets.py        # Real-time WebSocket event broadcaster
│   ├── tests/
│   │   ├── test_core_engine.py
│   │   └── test_collusion.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/Navbar.jsx
│   │   ├── context/AuthContext.jsx
│   │   ├── services/api.js
│   │   └── pages/
│   │       ├── LoginPage.jsx
│   │       ├── candidate/
│   │       │   ├── ExamLobby.jsx
│   │       │   └── ExamPortal.jsx
│   │       └── invigilator/
│   │           └── AdminDashboard.jsx
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── Dockerfile
├── load_testing/
│   ├── locustfile.py                # Parametrized candidate user simulation
│   └── run_load_test.sh             # Automated load test execution script
├── nginx/
│   └── nginx.conf                   # Upstream least_conn proxy with WebSocket support
├── docker-compose.yml               # Multi-container production topology
├── run_local.sh                     # Local dual-instance runner
├── EXPLANATION_FOR_EVALUATORS.md    # Complete student viva defense manual
└── README.md
```

---

## 7. Evaluator Viva & Presentation Guide

For step-by-step explanations of how every function works and exact answers to the top 10 hardest evaluator questions (durability guarantees, client clock tampering, out-of-order networks, cross-instance failover), refer to [EXPLANATION_FOR_EVALUATORS.md](file:///home/teja/Kmit%20Project/EXPLANATION_FOR_EVALUATORS.md).

