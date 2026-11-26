#!/usr/bin/env bash
#
# Dev launcher: starts the backend stack (Docker Compose) and the mobile app.
#
#   ./dev.sh
#
# Ctrl+C stops the mobile app, stops the log stream, and brings the
# containers down. Any failing step aborts the script immediately.

set -e

# Always operate from the project root (the directory containing this script),
# regardless of where the script is invoked from.
cd "$(dirname "${BASH_SOURCE[0]}")"

COMPOSE="docker compose -f docker-compose.dev.yml"

LOG_PID=""

cleanup() {
  # Called on Ctrl+C, SIGTERM, or normal exit. Never let cleanup abort itself.
  trap - INT TERM
  if [ -n "$LOG_PID" ] && kill -0 "$LOG_PID" 2>/dev/null; then
    kill "$LOG_PID" 2>/dev/null || true
    wait "$LOG_PID" 2>/dev/null || true
  fi
  echo ""
  echo "==> Stopping containers..."
  $COMPOSE down || true
}

trap cleanup INT TERM

echo "==> Stopping any existing dev containers..."
$COMPOSE down

echo "==> Starting dev containers in the background..."
$COMPOSE up -d

# `up -d` returns once containers are created, so stream their logs in the
# background to keep the backend visible while the mobile app runs in front.
echo "==> Streaming backend logs (background)..."
$COMPOSE logs -f &
LOG_PID=$!

echo "==> Starting the mobile app..."
cd mobile
npm run start

# Reaching here means the mobile app exited normally; cleanup still runs.
cleanup
