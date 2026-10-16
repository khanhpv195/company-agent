#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if [ "${NODE_ENV:-development}" = "production" ] && [ -f dist/database/seeds/seed.js ]; then
  node dist/database/seeds/seed.js
else
  TS_NODE_TRANSPILE_ONLY=true pnpm exec ts-node src/database/seeds/seed.ts
fi
