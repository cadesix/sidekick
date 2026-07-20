#!/bin/bash
set -euo pipefail

# Railway runs this from the repo root or the package dir depending on config.
if [[ "$(pwd)" != */packages/server ]]; then
  cd packages/server
fi

# Migrations run before the server accepts traffic, so a deploy never serves a
# build against an older schema. Drizzle's migrator is idempotent, so a replica
# that loses the race is a no-op.
pnpm --filter @sidekick/db run migrate

exec node --enable-source-maps dist/server.js
