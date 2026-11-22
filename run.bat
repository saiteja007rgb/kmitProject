@echo off
title ExamPulse - Distributed Assessment Platform
echo =================================================================
echo    EXAMPULSE — DISTRIBUTED ASSESSMENT PLATFORM RUNNER (WINDOWS)
echo =================================================================

REM Check virtualenv
if not exist "backend\venv" (
    echo Setting up Python virtual environment...
    python -m venv backend\venv
    call backend\venv\Scripts\activate.bat
    pip install -r backend\requirements.txt
) else (
    call backend\venv\Scripts\activate.bat
)

REM Check frontend dependencies
if not exist "frontend\node_modules" (
    echo Installing frontend dependencies...
    cd frontend && npm install && cd ..
)

echo Starting Backend Instance 1 on Port 8001...
start "Backend-1" cmd /c "set INSTANCE_ID=backend-1&& call backend\venv\Scripts\activate.bat&& uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8001"

echo Starting Backend Instance 2 on Port 8002...
start "Backend-2" cmd /c "set INSTANCE_ID=backend-2&& call backend\venv\Scripts\activate.bat&& uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8002"

echo Starting Frontend on Port 5173...
start "Frontend" cmd /c "cd frontend&& npm run dev -- --port 5173"

echo Waiting 2 seconds for services to initialize...
timeout /t 2 /nobreak >nul

echo Redirecting to browser...
start http://127.0.0.1:5173

echo =================================================================
echo ExamPulse is running in background windows.
echo Close individual command windows to stop services.
echo =================================================================

