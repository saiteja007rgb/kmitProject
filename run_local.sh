HOST=${HOST:-127.0.0.1}
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "================================================================="
echo "   EXAMPULSE — DISTRIBUTED ASSESSMENT PLATFORM RUNNER            "
echo "================================================================="
echo "Launching 2 Stateless Backend Instances + React Frontend..."

# Activate backend venv
source backend/venv/bin/activate

# 1. Start Backend Instance 1 on Port 8001
echo "[1/3] Starting Backend Instance 1 on port 8001..."
INSTANCE_ID=backend-1 uvicorn app.main:app --app-dir backend --host ${HOST:-127.0.0.1} --port 8001 --log-level info &
BACKEND1_PID=$!

# 2. Start Backend Instance 2 on Port 8002
echo "[2/3] Starting Backend Instance 2 on port 8002..."
INSTANCE_ID=backend-2 uvicorn app.main:app --app-dir backend --host ${HOST:-127.0.0.1} --port 8002 --log-level info &
BACKEND2_PID=$!

# 3. Start Frontend Dev Server on Port 5173
echo "[3/3] Starting Frontend Vite Server on port 5173..."
cd frontend
npm run dev -- --host ${HOST:-127.0.0.1} --port 5173 &
FRONTEND_PID=$!
cd ..

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

echo ""
echo "================================================================="
echo "   EXAMPULSE IS LIVE AND READY FOR TESTING & DEMONSTRATION!      "
echo "================================================================="
echo " * Frontend UI:            http://127.0.0.1:5173"
echo " * Backend 1 (Instance 1): http://127.0.0.1:8001/docs"
echo " * Backend 2 (Instance 2): http://127.0.0.1:8002/docs"
echo ""
echo "Demo Accounts:"
echo " - Admin:       admin / admin123"
echo " - Candidate:   candidate_001 / password123 (up to candidate_100)"
echo "================================================================="
echo "Press Ctrl+C to stop all servers."
wait

