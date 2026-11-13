#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PROJECT_ROOT="$(dirname "$DIR")"
cd "$PROJECT_ROOT"

HOST_URL="${1:-http://127.0.0.1:8001}"
USERS="${2:-100}"
SPAWN_RATE="${3:-20}"
RUN_TIME="${4:-15s}"

echo "================================================================="
echo "   EXAMPULSE — LOCUST LOAD TEST RUNNER                           "
echo "================================================================="
echo "Target Host:  $HOST_URL"
echo "Users:        $USERS virtual candidates"
echo "Spawn Rate:   $SPAWN_RATE users/sec"
echo "Duration:     $RUN_TIME"
echo "================================================================="

# Activate virtual environment
source backend/venv/bin/activate

mkdir -p load_testing/reports

locust -f load_testing/locustfile.py \
    --headless \
    --host="$HOST_URL" \
    --users="$USERS" \
    --spawn-rate="$SPAWN_RATE" \
    --run-time="$RUN_TIME" \
    --csv=load_testing/reports/load_report \
    --only-summary

echo ""
echo "Load test complete! Reports saved in load_testing/reports/."

