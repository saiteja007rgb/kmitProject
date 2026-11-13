#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "================================================================="
echo "   EXAMPULSE — PRE-COMMIT VERIFICATION SUITE                     "
echo "================================================================="

echo "[1/3] Running Backend Pytest Suite..."
source backend/venv/bin/activate
pytest backend/tests -v

echo ""
echo "[2/3] Checking Frontend Production Build..."
cd frontend
npm run build
cd ..

echo ""
echo "[3/3] Checking Git Status for Accidental File Staging..."
BAD_FILES=$(git status --porcelain | grep -E "node_modules|exampulse\.db|__pycache__|\.env$" || true)
if [ -n "$BAD_FILES" ]; then
    echo "⚠️  WARNING: Disallowed files detected in git status:"
    echo "$BAD_FILES"
    echo "Please remove or unstage these files before committing."
    exit 1
fi

echo ""
echo "================================================================="
echo "   ✅ ALL CHECKS PASSED! CODE IS READY TO COMMIT & PUSH.        "
echo "================================================================="

