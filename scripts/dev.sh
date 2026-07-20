#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FORCE=false
if [ "$1" = "-f" ] || [ "$1" = "--force" ]; then
  FORCE=true
fi

BACKEND_PORT="${PORT:-8787}"
METRO_PORT=8081

LOG_DIR="$REPO_ROOT/.logs"
mkdir -p "$LOG_DIR"

if [ "$FORCE" = false ]; then
  BE=$(lsof -i :$BACKEND_PORT -sTCP:LISTEN >/dev/null 2>&1 && echo UP || echo DOWN)
  METRO=$(lsof -i :$METRO_PORT -sTCP:LISTEN >/dev/null 2>&1 && echo UP || echo DOWN)

  if [ "$BE" = "UP" ] && [ "$METRO" = "UP" ]; then
    echo "✓ Servers already running"
    echo "  Backend: http://localhost:$BACKEND_PORT"
    echo "  Expo:    http://localhost:$METRO_PORT (web + sim)"
    echo "  Logs: $LOG_DIR/{backend,expo}.log"
    exit 0
  fi
fi

echo "Starting postgres..."
docker compose --project-directory "$REPO_ROOT" up -d >/dev/null

until docker compose --project-directory "$REPO_ROOT" exec -T postgres pg_isready -U sidekick -d sidekick >/dev/null 2>&1; do
  sleep 1
done

echo "Running migrations..."
pnpm --dir "$REPO_ROOT" --filter @sidekick/db migrate || echo "  ⚠ Migrations failed, continuing anyway..."

echo "Starting servers..."

lsof -ti :$BACKEND_PORT | xargs kill -9 2>/dev/null || true
lsof -ti :$METRO_PORT | xargs kill -9 2>/dev/null || true

cd "$REPO_ROOT/packages/server"
nohup pnpm dev > "$LOG_DIR/backend.log" 2>&1 &
echo "  Backend starting (pid $!)"

cd "$REPO_ROOT/packages/expo"
nohup npx expo start --dev-client --web --ios > "$LOG_DIR/expo.log" 2>&1 &
echo "  Expo starting (pid $!) — opening web browser + iOS simulator"

sleep 4

BE=$(lsof -i :$BACKEND_PORT -sTCP:LISTEN >/dev/null 2>&1 && echo UP || echo DOWN)
METRO=$(lsof -i :$METRO_PORT -sTCP:LISTEN >/dev/null 2>&1 && echo UP || echo DOWN)

echo ""
echo "Status:"
echo "  Backend: $BE (http://localhost:$BACKEND_PORT)"
echo "  Expo:    $METRO (http://localhost:$METRO_PORT — web + sim)"
echo "  Logs: $LOG_DIR/{backend,expo}.log"
