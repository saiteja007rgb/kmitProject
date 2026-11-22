#!/usr/bin/env bash
# ==============================================================================
#   EXAMPULSE v2 — ONE-CLICK RUNNER (2 BACKENDS + VITE FRONTEND + BROWSER)
# ==============================================================================
HOST=${HOST:-0.0.0.0}
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "================================================================="
echo "   EXAMPULSE v2 — DISTRIBUTED ASSESSMENT PLATFORM                "
echo "================================================================="

# 1. Clean up stale listeners on ports 8001, 8002, 5173
for port in 8001 8002 5173; do
    pids=$(lsof -t -i:"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        kill -9 $pids 2>/dev/null || true
    fi
done

# 2. Ensure backend/.env exists with a shared JWT_SECRET so both backend instances accept each other's tokens
if [ ! -f "backend/.env" ]; then
    echo "Generating backend/.env with a shared cryptographic JWT_SECRET..."
    GENERATED_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')
    cat > backend/.env <<EOF
ENVIRONMENT=development
REDIS_URL=redis://127.0.0.1:6379/0
ALLOW_FAKE_REDIS=true
JWT_SECRET=${GENERATED_SECRET}
SEED_DEMO_DATA=true
INITIAL_ADMIN_PASSWORD=admin123
EOF
    chmod 600 backend/.env
fi

# 3. Setup Python venv
if [ ! -d "backend/venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv backend/venv
    source backend/venv/bin/activate
    pip install -r backend/requirements.txt
else
    source backend/venv/bin/activate
fi

# 4. Setup Frontend dependencies
if [ ! -d "frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    (cd frontend && npm install)
fi

ulimit -n 65535 2>/dev/null || true

# Initialize schema & seed once before spawning both backend instances
(cd backend && python -m app.seed)

# 5. Start Backend Instance 1 & Instance 2
echo "[1/3] Starting Backend Instance 1 on port 8001..."
INSTANCE_ID=backend-1 uvicorn app.main:app --app-dir backend --host "${HOST}" --port 8001 --limit-concurrency 25000 --backlog 65535 --timeout-keep-alive 30 --loop uvloop --log-level warning &
BACKEND1_PID=$!

echo "[2/3] Starting Backend Instance 2 on port 8002..."
INSTANCE_ID=backend-2 uvicorn app.main:app --app-dir backend --host "${HOST}" --port 8002 --limit-concurrency 25000 --backlog 65535 --timeout-keep-alive 30 --loop uvloop --log-level warning &
BACKEND2_PID=$!

# 6. Start Frontend Vite Server
echo "[3/3] Starting Frontend Vite Server on port 5173..."
(cd frontend && npm run dev -- --host "${HOST}" --port 5173) &
FRONTEND_PID=$!

open_browser() {
    local url="$1"
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then
        open "$url" >/dev/null 2>&1 &
    elif command -v wslview >/dev/null 2>&1; then
        wslview "$url" >/dev/null 2>&1 &
    elif command -v firefox >/dev/null 2>&1; then
        firefox "$url" >/dev/null 2>&1 &
    fi
}

cleanup() {
    echo ""
    echo "Shutting down ExamPulse processes..."
    kill $BACKEND1_PID $BACKEND2_PID $FRONTEND_PID 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM

echo "Polling service readiness..."
for _ in {1..100}; do
    HEALTH=$(curl -s -f http://127.0.0.1:8001/health 2>/dev/null || true)
    if [ -n "$HEALTH" ] && curl -s -I http://127.0.0.1:5173 >/dev/null 2>&1; then
        echo ""
        echo "================================================================="
        echo "   EXAMPULSE v2 IS LIVE"
        echo "================================================================="
        echo " * Portal:          http://127.0.0.1:5173"
        echo " * Backend 1 Docs:  http://127.0.0.1:8001/docs"
        echo " * Backend 2 Docs:  http://127.0.0.1:8002/docs"
        echo " * Health:          ${HEALTH}"
        echo ""
        echo "Accounts:"
        echo " - Admin:        admin / admin123"
        echo " - Invigilator:  invigilator / invigilator123"
        echo " - Demo students: student1, student2, student3 / password123"
        echo "   (Admins can add/import real students under Candidates)"
        echo ""
        echo "Tip: Run 'sudo ./setup_infra.sh' once to switch to real Valkey/Redis + PostgreSQL."
        echo "================================================================="
        open_browser "http://127.0.0.1:5173"
        break
    fi
    sleep 0.15
done

echo "Press Ctrl+C to stop all servers."
wait
