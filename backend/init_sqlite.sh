#!/usr/bin/env bash

set -euo pipefail

# Determine backend directory (directory containing this script)
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Require backend/.env only
ENV_FILE="${BACKEND_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "backend/.env not found at ${ENV_FILE}. Create one with DATABASE_URL (e.g. DATABASE_URL=\"file:./dev.db\")." >&2
  exit 1
fi

# Load env (supports simple KEY=VALUE lines)
set -o allexport
source "${ENV_FILE}"
set +o allexport

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set in ${ENV_FILE}" >&2
  exit 1
fi

if [[ "${DATABASE_URL}" != file:* ]]; then
  echo "DATABASE_URL must be a SQLite file URL, e.g. file:./dev.db (got: ${DATABASE_URL})" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required. Install it first (macOS: brew install sqlite)." >&2
  exit 1
fi

# Resolve DB path from DATABASE_URL
DB_PATH="${DATABASE_URL#file:}"
case "${DB_PATH}" in
  /*) : ;; # absolute, leave as is
  *) DB_PATH="${BACKEND_DIR}/${DB_PATH#./}" ;;
esac

mkdir -p "$(dirname "${DB_PATH}")"

# Create the SQLite database (no-op if exists)
sqlite3 "${DB_PATH}" ".databases" >/dev/null

# Always use an absolute DATABASE_URL for Prisma to avoid relative-resolution differences
ABS_DATABASE_URL="file:${DB_PATH}"

# Ensure backend/.env exists and persist absolute DATABASE_URL for runtime
BACKEND_ENV_FILE="${BACKEND_DIR}/.env"
if [[ ! -f "${BACKEND_ENV_FILE}" ]]; then
  touch "${BACKEND_ENV_FILE}"
fi
if grep -q '^DATABASE_URL=' "${BACKEND_ENV_FILE}"; then
  # replace existing line
  tmp_file="${BACKEND_ENV_FILE}.tmp.$$"
  awk -v val="${ABS_DATABASE_URL}" 'BEGIN{FS=OFS="="} { if ($1=="DATABASE_URL") {$0=$1"="val} print }' "${BACKEND_ENV_FILE}" > "${tmp_file}" && mv "${tmp_file}" "${BACKEND_ENV_FILE}"
else
  echo "DATABASE_URL=${ABS_DATABASE_URL}" >> "${BACKEND_ENV_FILE}"
fi

# Optionally seed admin credentials if provided
if [[ -n "${ADMIN_USERNAME:-}" && -n "${ADMIN_PASSWORD:-}" ]]; then
  # Hash password with SHA-256 for basic protection (adjust as needed)
  if command -v shasum >/dev/null 2>&1; then
    PASSWORD_HASH="$(printf "%s" "${ADMIN_PASSWORD}" | shasum -a 256 | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    PASSWORD_HASH="$(printf "%s" "${ADMIN_PASSWORD}" | sha256sum | awk '{print $1}')"
  else
    echo "Warning: No sha256 tool found; storing password in plain text." >&2
    PASSWORD_HASH="${ADMIN_PASSWORD}"
  fi

  sqlite3 "${DB_PATH}" <<'SQL'
BEGIN;
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
COMMIT;
SQL

  sqlite3 "${DB_PATH}" <<SQL
INSERT OR IGNORE INTO credentials (id, username, password_hash)
VALUES ('00000000-0000-0000-0000-000000000001', '${ADMIN_USERNAME}', '${PASSWORD_HASH}');
SQL
fi

# Run Prisma generate and push to ensure schema tables exist
if command -v npm >/dev/null 2>&1 && [[ -f "${BACKEND_DIR}/package.json" ]]; then
  ( cd "${BACKEND_DIR}" && DATABASE_URL="${ABS_DATABASE_URL}" npm run --silent prisma:generate )
  # pass flags after -- to npm script
  ( cd "${BACKEND_DIR}" && DATABASE_URL="${ABS_DATABASE_URL}" npm run --silent prisma:db:push -- --accept-data-loss )
elif command -v npx >/dev/null 2>&1; then
  # Fallback to a pinned Prisma version to avoid resolving unrelated packages named "generate"
  ( cd "${BACKEND_DIR}" && DATABASE_URL="${ABS_DATABASE_URL}" npx --yes prisma@5.20.0 generate --schema prisma/schema.prisma )
  ( cd "${BACKEND_DIR}" && DATABASE_URL="${ABS_DATABASE_URL}" npx --yes prisma@5.20.0 db push --schema prisma/schema.prisma --accept-data-loss )
else
  echo "npm/npx not found; skipping Prisma generate/db push." >&2
fi

echo "SQLite database ready at: ${DB_PATH}"
if [[ -n "${ADMIN_USERNAME:-}" ]]; then
  echo "Admin credential ensured for user: ${ADMIN_USERNAME}"
fi


