#!/bin/sh
set -eu

SCRIPT_DIR="$(dirname "$0")"

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Running database migrations..."
  sh "$SCRIPT_DIR/migrate.sh" run
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] Seeding database..."
  sh "$SCRIPT_DIR/seed.sh"
fi

echo "[entrypoint] Starting: $*"
exec "$@"
