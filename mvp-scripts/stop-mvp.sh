#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$SCRIPT_DIR/.run"
PID_DIR="$RUN_DIR/pids"
INFRA_PROJECT_NAME="${PLR_COMPOSE_PROJECT_NAME:-${COMPOSE_PROJECT_NAME:-$(sed -n '1p' "$RUN_DIR/compose-project" 2>/dev/null || true)}}"
INFRA_PROJECT_NAME="${INFRA_PROJECT_NAME:-plr-local}"
unset COMPOSE_PROJECT_NAME

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { printf "  [ok] %s\n" "$*"; }
warn() { printf "  [warn] %s\n" "$*"; }

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

stop_pid_file() {
  local name="$1"
  local pid_file="$PID_DIR/${name}.pid"
  local pid=""
  [ -f "$pid_file" ] || return 0
  pid="$(sed -n '1p' "$pid_file" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    ok "stopped $name pid $pid"
  fi
  rm -f "$pid_file"
}

stop_screen_session() {
  local name="$1"
  local session_file="$PID_DIR/${name}.session"
  local session=""
  [ -f "$session_file" ] || return 0
  session="$(sed -n '1p' "$session_file" 2>/dev/null || true)"
  if [ -n "$session" ] && command -v screen >/dev/null 2>&1; then
    screen -S "$session" -X quit >/dev/null 2>&1 || true
    ok "stopped $name session $session"
  fi
  rm -f "$session_file"
}

say "Stopping launcher-owned development processes"
for process in metro web-dev; do
  stop_screen_session "$process"
  stop_pid_file "$process"
done

if docker_ready; then
  say "Stopping product containers without deleting data"
  (cd "$ROOT/infra" && docker compose -p "$INFRA_PROJECT_NAME" stop)
  (cd "$ROOT/infra/besu/besu-qbft-network" && docker compose stop)
  ok "services stopped; PostgreSQL, KMS and Besu data were preserved"
else
  warn "Docker is not available; container shutdown was skipped"
fi

say "Stopped"
printf "To start again: %s/start-mvp.sh\n" "$ROOT"
