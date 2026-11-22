# ExamPulse v2 — API Contract

Single source of truth shared by backend (`backend/app`) and frontend (`frontend/src`).
All REST routes are prefixed with `/api`. All timestamps are ISO-8601 UTC strings.
Errors use FastAPI's shape: `{"detail": "Human readable message"}` (422 validation errors: `{"detail": [ ... ]}`).

---

## 1. Authentication model

| Item | Behaviour |
|---|---|
| Access token | JWT, 15 min lifetime, returned in JSON, sent as `Authorization: Bearer <token>`. Keep it **in memory only** (never localStorage). |
| Refresh token | Opaque random string in an `httpOnly`, `SameSite=Strict` cookie named `ep_refresh`, path `/api/auth`. Rotated on every refresh. Reusing an old refresh token revokes the whole login session (theft detection). |
| Page reload | Frontend calls `POST /api/auth/refresh` (with `withCredentials: true`) to obtain a new access token. |
| Single device | A candidate logging in again revokes their previous login session. The old tab gets `401` with detail `"Session ended: you signed in on another device."`. |
| Lockout | 5 failed logins for a username → `423` for 15 minutes. Response header `Retry-After` (seconds). |
| Rate limit | Exceeding limits → `429` with `Retry-After`. |
| Forced change | `user.must_change_password == true` → frontend must route to the change-password screen before anything else. |

### Roles
`admin` (everything), `invigilator` (monitoring, grading, announcements; cannot manage users/staff or delete exams), `candidate`.

---

## 2. Shared object shapes

```jsonc
// UserOut
{ "id": "uuid", "username": "s.kumar", "full_name": "Sai Kumar", "email": "x@y.z" | null,
  "role": "admin" | "invigilator" | "candidate", "must_change_password": false,
  "candidate": { "id": "uuid", "candidate_code": "KMIT-001", "batch_id": "uuid" | null, "batch_name": "CSE-A" | null } | null }

// TokenOut
{ "access_token": "jwt", "expires_in": 900, "user": UserOut }

// CandidateOut
{ "id": "candidate uuid", "user_id": "uuid", "username": "...", "full_name": "...", "email": "..." | null,
  "candidate_code": "...", "batch_id": "uuid" | null, "batch_name": "..." | null,
  "is_active": true, "last_login_at": "..." | null, "created_at": "..." }

// StaffOut
{ "id": "user uuid", "username": "...", "full_name": "...", "role": "admin" | "invigilator", "is_active": true, "last_login_at": "..." | null }

// BatchOut
{ "id": "uuid", "name": "CSE-A 2026", "description": "..." | null, "candidate_count": 42 }

// ExamSettings
{ "shuffle_questions": true, "shuffle_options": true, "negative_marking": 0.25,
  "max_violations": 5, "require_webcam": true, "require_fullscreen": true,
  "show_results_immediately": false }

// ExamStatus (effective, computed by server from stored state + clock)
"draft" | "scheduled" | "live" | "paused" | "ended"

// ExamSummary
{ "id": "uuid", "title": "...", "description": "..." | null, "status": ExamStatus,
  "starts_at": "...", "ends_at": "...", "duration_minutes": 60,
  "question_count": 20, "total_marks": 40.0,
  "enrolled_count": 50, "in_progress_count": 12, "submitted_count": 30,
  "results_published": false, "created_at": "..." }

// QuestionKind
"mcq_single" | "mcq_multi" | "true_false" | "numeric" | "short_text" | "theory" | "coding"

// QuestionInput (admin create/update). correct_answer type depends on kind:
//   mcq_single / true_false -> "A" (option id; true_false options are {"id":"T","text":"True"},{"id":"F","text":"False"})
//   mcq_multi -> ["A","C"]      numeric -> "3.14" (string)     short_text -> "expected text" (case/space-insensitive)
//   theory / coding -> null (theory: model answer goes in `explanation`)
{ "kind": QuestionKind, "prompt": "markdown-ish plain text", "options": [{"id":"A","text":"..."}],
  "correct_answer": any, "marks": 2.0, "negative_marks": 0.5 | null /* null => marks * settings.negative_marking */,
  "explanation": "..." | null, "numeric_tolerance": 0.0,
  "coding": null | { "languages": ["python","c","cpp","java","javascript"],
                     "starter_code": { "python": "..." },
                     "time_limit_ms": 2000, "memory_limit_mb": 256,
                     "sample_tests": [{"input": "1 2\n", "expected_output": "3\n"}],
                     "hidden_tests": [{"input": "...", "expected_output": "..."}] } }

// QuestionAdmin = QuestionInput + { "id": "uuid", "position": 1 }

// CandidateQuestion (what candidates see — never contains answers or hidden tests)
{ "id": "uuid", "position": 1, "kind": QuestionKind, "prompt": "...",
  "options": [{"id":"C","text":"..."}] /* already shuffled per candidate if enabled */,
  "marks": 2.0,
  "coding": null | { "languages": [...], "starter_code": {...}, "time_limit_ms": 2000, "sample_tests": [{"input","expected_output"}] } }

// AnswerResponse (the `response` field) by kind:
//   mcq_single/true_false: "A"   mcq_multi: ["A","C"]   numeric/short_text/theory: "text"
//   coding: { "language": "python", "code": "..." }
```

---

## 3. Auth routes

| Method & path | Body | Returns |
|---|---|---|
| `POST /api/auth/login` | `{username, password}` | `TokenOut` + sets cookie. `401` bad credentials, `403` account disabled, `423` locked |
| `POST /api/auth/refresh` | — (cookie) | `TokenOut` + rotated cookie. `401` if missing/invalid |
| `POST /api/auth/logout` | — | `204`, clears cookie |
| `GET /api/auth/me` | — | `UserOut` |
| `POST /api/auth/change-password` | `{current_password, new_password}` | `204`. Policy: ≥ 8 chars, at least one letter and one digit, not equal to username |

There is **no public registration**. Accounts are created by admins.

---

## 4. Admin: people

| Method & path | Body / query | Returns |
|---|---|---|
| `GET /api/admin/dashboard` | — | `{counts:{candidates, active_candidates, exams, live_exams, in_progress_sessions}, live_exams:[ExamSummary], recent_activity:[AuditLogOut]}` |
| `GET /api/admin/candidates` | `?search=&batch_id=&is_active=true\|false&page=1&page_size=25` | `{items:[CandidateOut], total}` |
| `POST /api/admin/candidates` | `{username, full_name, email?, candidate_code?, batch_id?, password?}` | `{candidate: CandidateOut, temporary_password: "..." \| null}` (password generated when omitted; user must change it on first login) |
| `POST /api/admin/candidates/import` | multipart `file` (.csv, ≤ 1 MB). Header row: `username,full_name,email,candidate_code,batch` (batch = name, auto-created) | `{created:[{username, full_name, candidate_code, temporary_password}], skipped:[{row, username, reason}]}` |
| `PATCH /api/admin/candidates/{candidate_id}` | `{full_name?, email?, batch_id? (null clears), is_active?}` | `CandidateOut` |
| `POST /api/admin/candidates/{candidate_id}/reset-password` | — | `{temporary_password}` |
| `DELETE /api/admin/candidates/{candidate_id}` | — | `204`; `409` if the candidate has exam attempts (deactivate instead) |
| `GET /api/admin/staff` | — | `[StaffOut]` (admin only) |
| `POST /api/admin/staff` | `{username, full_name, role, password?}` | `{staff: StaffOut, temporary_password}` |
| `PATCH /api/admin/staff/{user_id}` | `{is_active?, full_name?}` | `StaffOut` (cannot deactivate yourself) |
| `GET /api/admin/batches` | — | `[BatchOut]` |
| `POST /api/admin/batches` | `{name, description?}` | `BatchOut` |
| `PATCH /api/admin/batches/{batch_id}` | `{name?, description?}` | `BatchOut` |
| `DELETE /api/admin/batches/{batch_id}` | — | `204` (candidates keep their accounts, batch cleared) |
| `GET /api/admin/audit-logs` | `?page=1&page_size=50` | `{items:[AuditLogOut], total}`; `AuditLogOut = {id, actor_username, action, target_type, target_id, details, ip_address, created_at}` |

---

## 5. Admin: exams

| Method & path | Body | Returns |
|---|---|---|
| `GET /api/admin/exams` | — | `[ExamSummary]` |
| `POST /api/admin/exams` | `ExamInput` | `ExamDetail` |
| `GET /api/admin/exams/{exam_id}` | — | `ExamDetail = ExamSummary + {instructions, settings: ExamSettings, questions:[QuestionAdmin]}` |
| `PUT /api/admin/exams/{exam_id}` | `ExamInput` | `ExamDetail`; `409` when questions are changed after any candidate started |
| `POST /api/admin/exams/{exam_id}/duplicate` | — | `ExamDetail` (copy is `draft`) |
| `DELETE /api/admin/exams/{exam_id}` | — | `204`; `409` if attempts exist |
| `POST /api/admin/exams/{exam_id}/lifecycle` | `{action: "publish" \| "pause" \| "resume" \| "end"}` | `ExamSummary`. publish: draft→scheduled/live by clock. pause: saves rejected, timers frozen. resume: all in-progress deadlines extended by the paused duration. end: force-ends and auto-submits all in-progress attempts |
| `POST /api/admin/exams/{exam_id}/results` | `{published: bool}` | `ExamSummary` |
| `POST /api/admin/exams/{exam_id}/extend` | `{minutes}` (1–180) | `{sessions_extended}` — extends every in-progress attempt |
| `POST /api/admin/questions/import` | multipart `file` (.txt/.csv/.xlsx ≤ 2 MB) | `{questions:[QuestionInput], message}` (preview only, not saved) |
| `GET /api/admin/exams/{exam_id}/enrollments` | — | `[{candidate_id, candidate_code, full_name, batch_name, extra_minutes, attempt_status: "not_started"\|"in_progress"\|"submitted"}]` |
| `POST /api/admin/exams/{exam_id}/enrollments` | `{candidate_ids?:[], batch_ids?:[]}` | `{added, already_enrolled}` |
| `PATCH /api/admin/exams/{exam_id}/enrollments/{candidate_id}` | `{extra_minutes}` (0–180, accessibility accommodation) | `204` |
| `DELETE /api/admin/exams/{exam_id}/enrollments/{candidate_id}` | — | `204`; `409` if attempt exists |

`ExamInput = {title, description?, instructions?, starts_at, ends_at, duration_minutes (1–600), settings: ExamSettings, questions:[QuestionInput] (≥1)}`

---

## 6. Admin: live monitoring, grading, analytics

| Method & path | Body | Returns |
|---|---|---|
| `GET /api/admin/exams/{exam_id}/live` | — | `LiveBoard` (below) |
| `GET /api/admin/attempts/{attempt_id}` | — | `AttemptDetail` (below) |
| `GET /api/admin/snapshots/{snapshot_id}` | — | `image/jpeg` bytes (fetch with axios `responseType: 'blob'`) |
| `POST /api/admin/attempts/{attempt_id}/extend` | `{minutes}` | `{deadline}` |
| `POST /api/admin/attempts/{attempt_id}/force-submit` | — | `{status: "submitted"}` |
| `POST /api/admin/attempts/{attempt_id}/reset` | — | `204` (deletes the attempt so the candidate can start again — destructive, confirm in UI) |
| `GET /api/admin/exams/{exam_id}/announcements` | — | `[AnnouncementOut]` = `{id, message, author, created_at}` |
| `POST /api/admin/exams/{exam_id}/announcements` | `{message}` (1–500 chars) | `AnnouncementOut` (pushed live to candidates) |
| `GET /api/admin/exams/{exam_id}/leaderboard` | — | `[{rank, candidate_code, full_name, score, max_score, percentage, submitted_at, duration_seconds}]` |
| `POST /api/admin/exams/{exam_id}/collusion-scan` | — | `{flags_detected}` |
| `GET /api/admin/exams/{exam_id}/collusion-flags` | — | `[{id, candidate_a_code, candidate_a_name, candidate_b_code, candidate_b_name, similarity_score, risk_level, reason, evidence, created_at}]` |
| `GET /api/admin/exams/{exam_id}/analytics` | — | `{stats:{attempts, submitted, mean, median, highest, lowest, std_dev, pass_rate}, score_histogram:[{label:"0-10%", count}], questions:[{question_id, position, prompt, kind, attempted, correct, accuracy}], violations_by_kind:{tab_hidden: 4, ...}}` |
| `GET /api/admin/exams/{exam_id}/results.csv` | — | `text/csv` download |
| `GET /api/admin/exams/{exam_id}/grading-queue` | `?pending_only=true` | `[{answer_id, attempt_id, candidate_code, full_name, question_id, position, prompt, max_marks, response, model_answer, awarded_marks, feedback}]` (theory questions) |
| `POST /api/admin/answers/{answer_id}/grade` | `{awarded_marks, feedback?}` | `{attempt_score}` |

```jsonc
// LiveBoard
{ "exam": ExamSummary,
  "counts": { "enrolled": 50, "not_started": 8, "in_progress": 12, "submitted": 30, "flagged": 2 },
  "average_progress": 0.64,
  "candidates": [ {
     "candidate_id": "uuid", "attempt_id": "uuid" | null, "candidate_code": "...", "full_name": "...",
     "batch_name": "..." | null, "status": "not_started" | "in_progress" | "submitted",
     "answered_count": 7, "total_questions": 20, "violation_count": 1,
     "last_seen_at": "..." | null, "is_online": true /* heartbeat < 45 s ago */,
     "deadline": "..." | null, "score": 12.5 | null, "max_score": 40.0,
     "submit_reason": "manual" | "timeout" | "violations" | "forced" | "exam_ended" | null,
     "latest_snapshot_id": "uuid" | null, "collusion_flagged": false } ] }

// AttemptDetail
{ "attempt_id": "uuid", "status": "...", "started_at": "...", "deadline": "...", "submitted_at": "..." | null,
  "submit_reason": "..." | null, "score": 12.5 | null, "max_score": 40.0, "violation_count": 2,
  "client_ip": "...", "user_agent": "...",
  "candidate": { "candidate_id", "candidate_code", "full_name", "batch_name" },
  "events": [ { "id", "kind", "detail", "counted_as_violation": true, "occurred_at" } ],
  "snapshots": [ { "id", "captured_at", "reason": "periodic" | "violation", "face_count": 1 } ],
  "answers": [ { "question_id", "position", "kind", "prompt", "response", "awarded_marks", "max_marks", "is_correct" } ] }
```

---

## 7. Candidate routes

| Method & path | Body | Returns |
|---|---|---|
| `GET /api/candidate/exams` | — | `[CandidateExamCard]` = `{id, title, description, status: ExamStatus, starts_at, ends_at, duration_minutes, question_count, total_marks, require_webcam, require_fullscreen, attempt: {id, status, score \| null, max_score, submitted_at} \| null, results_available}` — only exams the candidate is **enrolled** in |
| `POST /api/candidate/exams/{exam_id}/start` | `{}` | `AttemptState`. Idempotent (returns the running attempt). `403` not enrolled, `409` not live / already submitted |
| `GET /api/candidate/attempts/{attempt_id}` | — | `AttemptState` |
| `POST /api/candidate/attempts/{attempt_id}/heartbeat` | — | `Heartbeat = {status, exam_status, remaining_seconds, deadline, server_time, violation_count}` — call every 15 s; use to resync timer and detect pause |
| `PUT /api/candidate/attempts/{attempt_id}/answers/{question_id}` | `{response, is_flagged, version}` | `{question_id, version, saved_at, accepted}`. `accepted=false` means a newer version was already stored (stale packet). `403` time over, `423` exam paused, `409` attempt not in progress |
| `POST /api/candidate/attempts/{attempt_id}/submit` | — | `SubmitResult` (idempotent: repeated calls return the same receipt) |
| `POST /api/candidate/attempts/{attempt_id}/events` | `{kind, detail?}` kind ∈ `tab_hidden, window_blur, fullscreen_exit, copy_attempt, paste_attempt, context_menu, no_face, multiple_faces, looking_away, camera_off, devtools_open` | `{violation_count, max_violations, auto_submitted, message}` |
| `POST /api/candidate/attempts/{attempt_id}/snapshots` | multipart: `image` (jpeg ≤ 200 KB), `reason` (`periodic`/`violation`), `face_count` (int) | `204` |
| `POST /api/candidate/attempts/{attempt_id}/code/run` | `{question_id, language, code, custom_input?: string}` | `CodeRunResult` |
| `GET /api/candidate/attempts/{attempt_id}/result` | — | `ResultView`; `403` while results are hidden |

```jsonc
// AttemptState
{ "attempt_id": "uuid", "status": "in_progress" | "submitted",
  "exam": { "id", "title", "instructions", "status": ExamStatus, "require_webcam", "require_fullscreen", "max_violations" },
  "started_at": "...", "deadline": "...", "server_time": "...", "remaining_seconds": 3540,
  "violation_count": 0,
  "questions": [CandidateQuestion],
  "answers": [ { "question_id", "response", "is_flagged", "version" } ],
  "announcements": [ { "id", "message", "created_at" } ] }

// SubmitResult
{ "attempt_id": "uuid", "receipt_id": "EP-7F3A9C21", "status": "submitted", "submitted_at": "...",
  "submit_reason": "manual" | "timeout" | "violations" | "forced" | "exam_ended",
  "answered_count": 18, "total_questions": 20,
  "results_visible": false, "score": null | 31.5, "max_score": 40.0 }

// CodeRunResult
{ "status": "ok" | "compile_error", "compile_output": "..." | null,
  "results": [ { "input": "...", "expected_output": "..." | null, "actual_output": "...",
                 "verdict": "passed" | "wrong_answer" | "runtime_error" | "time_limit" | "memory_limit" | "custom",
                 "time_ms": 12 } ] }

// ResultView
{ "attempt_id", "exam_title", "score", "max_score", "percentage", "submitted_at", "grading_pending": false,
  "questions": [ { "question_id", "position", "kind", "prompt", "options", "response", "correct_answer",
                   "awarded_marks", "max_marks", "is_correct", "explanation", "feedback" } ] }
```

Limits: code runs ≤ 10 per minute per attempt, answer saves ≤ 120 per minute per attempt, snapshots ≤ 6 per minute.

---

## 8. WebSockets

Connect with the access token as a query parameter (browsers cannot set headers on WebSocket):

- Invigilator: `/ws/admin/exams/{exam_id}?token=<access_token>`
- Candidate: `/ws/candidate/attempts/{attempt_id}?token=<access_token>`

Close code `4401` = bad/expired token (refresh then reconnect), `4403` = forbidden. Client sends `"ping"` every 25 s; server answers `"pong"`.

Every message is JSON `{ "type": "...", ...payload }`.

| Type | Sent to | Payload |
|---|---|---|
| `attempt_started` | admin | `candidate_id, attempt_id, candidate_code, full_name` |
| `answer_saved` | admin | `candidate_id, attempt_id, answered_count` |
| `attempt_submitted` | admin, candidate | `candidate_id, attempt_id, submit_reason, score` |
| `proctoring_event` | admin | `candidate_id, attempt_id, candidate_code, kind, violation_count` |
| `snapshot_uploaded` | admin | `candidate_id, attempt_id, snapshot_id` |
| `exam_status_changed` | admin, candidate | `exam_id, status` |
| `announcement` | admin, candidate | `id, message, created_at` |
| `deadline_changed` | candidate | `deadline, remaining_seconds` |

---

## 9. Code execution sandbox

Languages: `python` (CPython 3), `c` (gcc, C17), `cpp` (g++, C++17), `java` (class must be `Main`), `javascript` (Node.js).
Each run executes inside **bubblewrap**: no network, read-only system, private `/tmp`, separate PID namespace, killed with the parent, CPU-time / memory / output limits, wall-clock timeout. Output is compared after trimming trailing whitespace on each line.

