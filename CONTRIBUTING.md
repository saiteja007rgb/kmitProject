# Contributing to ExamPulse

Welcome to ExamPulse! To ensure that multiple contributors can add features, refactor code, and fix bugs without breaking existing architecture or tests, please adhere to these guidelines.

---

## 1. Branching Strategy

- **`main`**: Production-ready, stable branch. Direct commits to `main` should be restricted.
- **`feature/<feature-name>`**: For all new features (e.g. `feature/proctoring-tab-switch`, `feature/question-creator`).
- **`bugfix/<issue-name>`**: For bug fixes (e.g. `bugfix/timer-sync-fix`).

### Creating a Feature Branch
```bash
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

---

## 2. Local Development & Testing Workflow

Before pushing code or opening a Pull Request:

### 1. Run Automated Local Verification
Run the one-step verification script:
```bash
./verify.sh
```
This script checks:
1. All backend `pytest` tests pass.
2. Frontend Vite build succeeds without compilation errors.
3. No ignored files (`node_modules`, `venv`, `*.db`) are staged.

### 2. Manual Testing with the Local Runner
```bash
./run_local.sh
```
Verify your feature in the browser:
- Candidate: `http://localhost:5173` (`candidate_001` / `password123`)
- Admin: `http://localhost:5173` (`admin` / `admin123`)

---

## 3. Engineering Conventions

1. **Stateless Backend**:
   - Never store candidate state in Python global variables or in-memory dicts.
   - Use PostgreSQL / SQLite for persistent state and Redis for pub/sub & ephemeral caching.
2. **Deterministic & Versioned Autosave**:
   - Every answer update must include an incremental `version` counter to prevent out-of-order packet corruption.
3. **Idempotent Endpoints**:
   - All state-changing actions (start exam, submit exam) must remain safe to retry multiple times without duplicating database rows.
4. **Git Hygiene**:
   - Never commit `.env`, `exampulse.db`, `node_modules/`, or `__pycache__/`.

---

## 4. Opening a Pull Request

1. Push your branch:
   ```bash
   git push -u origin feature/your-feature-name
   ```
2. Open a Pull Request against `main` on GitHub.
3. GitHub Actions CI will automatically test your PR.
4. Ensure all CI status checks turn green before merging.
