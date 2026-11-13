#!/usr/bin/env bash
# =================================================================
#   EXAMPULSE — ONE-CLICK HIGH-SPEED PLATFORM RUNNER & BROWSER LAUNCHER
# =================================================================
HOST=${HOST:-0.0.0.0}
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "================================================================="
echo "   EXAMPULSE — DISTRIBUTED ASSESSMENT PLATFORM (ONE-CLICK)       "
echo "================================================================="

# 1. Kill any existing stale processes on ports 8001, 8002, 5173 for instantaneous clean start
echo "Cleaning up any stale processes on ports 8001, 8002, 5173..."
for port in 8001 8002 5173; do
    pids=$(lsof -t -i:$port 2>/dev/null || true)
    if [ -n "$pids" ]; then
        kill -9 $pids 2>/dev/null || true
    fi
done

# 2. Check / Setup Python Virtual Environment
if [ ! -d "backend/venv" ]; then
    echo "Setting up Python virtual environment..."
    python3 -m venv backend/venv
    source backend/venv/bin/activate
    pip install -r backend/requirements.txt
else
    source backend/venv/bin/activate
fi

# 3. Check / Setup Frontend Dependencies
if [ ! -d "frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    cd frontend && npm install && cd ..
fi

# 4. Optimize system file descriptors for high concurrency (20,000+ simultaneous connections)
ulimit -n 65535 2>/dev/null || true

# 5. Start Backend Instance 1 on Port 8001 (high concurrency enabled)
echo "[1/3] Starting Backend Instance 1 on port 8001..."
INSTANCE_ID=backend-1 uvicorn app.main:app --app-dir backend --host ${HOST} --port 8001 --limit-concurrency 25000 --backlog 65535 --timeout-keep-alive 30 --loop uvloop --log-level warning &
BACKEND1_PID=$!

# 6. Start Backend Instance 2 on Port 8002 (high concurrency enabled)
echo "[2/3] Starting Backend Instance 2 on port 8002..."
INSTANCE_ID=backend-2 uvicorn app.main:app --app-dir backend --host ${HOST} --port 8002 --limit-concurrency 25000 --backlog 65535 --timeout-keep-alive 30 --loop uvloop --log-level warning &
BACKEND2_PID=$!

# 7. Start Frontend Dev Server on Port 5173
echo "[3/3] Starting Frontend Vite Server on port 5173..."
cd frontend
npm run dev -- --host ${HOST} --port 5173 &
FRONTEND_PID=$!
cd ..

# Browser launcher function (multi-platform: Linux desktop, macOS, Windows WSL, Git Bash)
open_browser() {
    local url="$1"
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then
        open "$url" >/dev/null 2>&1 &
    elif command -v wslview >/dev/null 2>&1; then
        wslview "$url" >/dev/null 2>&1 &
    elif command -v cmd.exe >/dev/null 2>&1; then
        cmd.exe /c start "$url" >/dev/null 2>&1 &
    elif command -v firefox >/dev/null 2>&1; then
        firefox "$url" >/dev/null 2>&1 &
    fi
}

cleanup() {
    echo ""
    echo "Shutting down ExamPulse processes..."
    kill $BACKEND1_PID 2>/dev/null || true
    kill $BACKEND2_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    echo "ExamPulse stopped cleanly."
    exit 0
}

trap cleanup INT TERM

# 8. Sub-second Fast Health Polling Loop & Immediate Browser Redirect
echo "⚡ Polling service readiness..."
for i in {1..60}; do
    if curl -s -f http://127.0.0.1:8001/health >/dev/null 2>&1 && curl -s -I http://127.0.0.1:5173 >/dev/null 2>&1; then
        echo ""
        echo "================================================================="
        echo "   ✅ EXAMPULSE IS LIVE AND OPERATIONAL! REDIRECTING TO BROWSER... "
        echo "================================================================="
        echo " * Candidate / Invigilator Portal: http://127.0.0.1:5173"
        echo " * Backend 1 Swagger API:          http://127.0.0.1:8001/docs"
        echo " * Backend 2 Swagger API:          http://127.0.0.1:8002/docs"
        echo ""
        echo "Demo Logins:"
        echo " - Admin:       admin / admin123"
        echo " - Candidate:   candidate_001 / password123 (up to candidate_100)"
        echo "================================================================="
        echo "Opening browser to http://127.0.0.1:5173..."
        open_browser "http://127.0.0.1:5173"
        break
    fi
    sleep 0.1
done

echo "Press Ctrl+C to stop all servers."
wait
