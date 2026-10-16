#!/bin/sh
# Usage: migrate.sh <run|revert|show|generate <Name>|create <Name>>
# Uses compiled JS when NODE_ENV=production and dist/ exists (Docker runtime), ts-node otherwise.
set -eu

cd "$(dirname "$0")/.."

COMMAND="${1:-}"
[ $# -gt 0 ] && shift

MIGRATIONS_DIR="src/database/migrations"

if [ "${NODE_ENV:-development}" = "production" ] && [ -f dist/database/data-source.js ]; then
  TYPEORM="node node_modules/typeorm/cli.js"
  DATA_SOURCE="dist/database/data-source.js"
else
  export TS_NODE_TRANSPILE_ONLY=true
  TYPEORM="pnpm exec typeorm-ts-node-commonjs"
  DATA_SOURCE="src/database/data-source.ts"
fi

case "$COMMAND" in
  run)
    $TYPEORM migration:run -d "$DATA_SOURCE"
    ;;
  revert)
    $TYPEORM migration:revert -d "$DATA_SOURCE"
    ;;
  show)
    $TYPEORM migration:show -d "$DATA_SOURCE"
    ;;
  generate)
    NAME="${1:?Usage: pnpm migration:generate <Name>}"
    $TYPEORM migration:generate -d "$DATA_SOURCE" --pretty "$MIGRATIONS_DIR/$NAME"
    ;;
  create)
    NAME="${1:?Usage: pnpm migration:create <Name>}"
    pnpm exec typeorm migration:create "$MIGRATIONS_DIR/$NAME"
    ;;
  *)
    echo "Usage: $0 <run|revert|show|generate <Name>|create <Name>>" >&2
    exit 1
    ;;
esac
