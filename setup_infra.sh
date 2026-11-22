#!/usr/bin/env bash
# ==============================================================================
# ExamPulse v2 — Free Local Infrastructure Installer (Real Redis/Valkey + PostgreSQL)
# Supports Arch Linux (pacman) and Debian/Ubuntu (apt). Run once with:
#   sudo ./setup_infra.sh
# ==============================================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "Please run this script with sudo: sudo ./setup_infra.sh"
    exit 1
fi

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
DB_NAME="exampulse"
DB_USER="exampulse_user"
DB_PASS="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"

if command -v pacman >/dev/null 2>&1; then
    echo "[1/4] Installing Valkey (open-source Redis drop-in) and PostgreSQL via pacman..."
    pacman -S --needed --noconfirm valkey postgresql

    if [ ! -d /var/lib/postgres/data/base ]; then
        echo "[2/4] Initializing PostgreSQL data cluster..."
        su - postgres -c "initdb --locale=C.UTF-8 --encoding=UTF8 -D /var/lib/postgres/data"
    fi

    echo "[3/4] Enabling and starting valkey + postgresql services..."
    systemctl enable --now valkey postgresql
elif command -v apt-get >/dev/null 2>&1; then
    echo "[1/4] Installing redis-server and postgresql via apt..."
    apt-get update -qq
    apt-get install -y redis-server postgresql
    echo "[3/4] Enabling and starting redis-server + postgresql services..."
    systemctl enable --now redis-server postgresql
else
    echo "Unsupported package manager. Install Redis/Valkey and PostgreSQL manually, then edit backend/.env."
    exit 1
fi

echo "[4/4] Creating PostgreSQL role & database '${DB_NAME}'..."
su - postgres -c "psql -v ON_ERROR_STOP=1" <<SQL
DO \$\$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
      CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
   ELSE
      ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASS}';
   END IF;
END
\$\$;
SQL

su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'\" | grep -q 1 || createdb -O ${DB_USER} ${DB_NAME}"

ENV_FILE="${DIR}/backend/.env"
cat > "${ENV_FILE}" <<EOF
ENVIRONMENT=development
DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}
REDIS_URL=redis://127.0.0.1:6379/0
ALLOW_FAKE_REDIS=false
JWT_SECRET=${JWT_SECRET}
ACCESS_TOKEN_MINUTES=15
REFRESH_TOKEN_DAYS=7
BCRYPT_ROUNDS=12
SECURE_COOKIES=false
SEED_DEMO_DATA=true
INITIAL_ADMIN_PASSWORD=admin123
EOF

if [ -n "${SUDO_USER:-}" ]; then
    chown "${SUDO_USER}:${SUDO_USER}" "${ENV_FILE}"
fi
chmod 600 "${ENV_FILE}"

echo ""
echo "================================================================="
echo " Real Redis/Valkey + PostgreSQL configured in backend/.env!"
echo " Start the platform with: ./run.sh"
echo "================================================================="
