#!/usr/bin/env bash
# =============================================================================
# Pilotage Scolaire — platform container manager
# -----------------------------------------------------------------------------
# Single entry point to build / start / restart / update the dockerised stack.
# Docker data lives in the WSL2 distro on the E: drive (Docker Desktop setting),
# so nothing here writes to C:.
#
# Usage:
#   bash infra/pilotage.sh <command> [services...]
#
# Commands:
#   up                 Build (cached) + start the WHOLE stack, run schema sync,
#                      wait until api + web are healthy.
#   update [svc...]    Routine refresh after code changes: rebuild app image(s)
#                      with layer cache, sync schema, recreate containers, wait
#                      healthy. Default svc set: api worker web. This is what the
#                      daily-improvement routine calls instead of host install+build.
#   rebuild [svc...]   Like update but --no-cache (force a clean image rebuild).
#   restart [svc...]   Restart running container(s) — no image rebuild.
#   migrate            Run `prisma db push` (schema → database) only.
#   seed               Run the demo/data seed (one-shot).
#   down               Stop & remove containers (KEEPS volumes / data).
#   reset              down -v (WIPE volumes) then a fresh `up`.
#   logs [svc...]      Follow logs.
#   ps | status        Show container + health status.
#   health             Exit 0 only if api + web are healthy (used by CI/routine).
#
# Examples:
#   bash infra/pilotage.sh up
#   bash infra/pilotage.sh update web        # only the Next.js front changed
#   bash infra/pilotage.sh update            # api + worker + web
#   bash infra/pilotage.sh logs api
# =============================================================================
set -euo pipefail

# --- Resolve paths so the script works from any cwd -------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$ROOT_DIR/.env"

# Faster, reproducible builds.
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

APP_SERVICES_DEFAULT=(api worker web)
HEALTH_SERVICES=(api web)
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"   # seconds to wait for healthy

# .env is optional but recommended (host port mapping). Fall back gracefully.
compose() {
  if [[ -f "$ENV_FILE" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

log()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- Build app image(s) sequentially (RAM-constrained host → avoid OOM) ------
build_apps() {
  local cache_flag="$1"; shift
  local svcs=("$@")
  for svc in "${svcs[@]}"; do
    log "Building image: $svc ${cache_flag:+($cache_flag)}"
    # shellcheck disable=SC2086
    compose build $cache_flag "$svc"
  done
  ok "Image build complete: ${svcs[*]}"
}

# --- Wait until the named services report healthy ----------------------------
wait_healthy() {
  log "Waiting for health (timeout ${HEALTH_TIMEOUT}s): ${HEALTH_SERVICES[*]}"
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while :; do
    local all_ok=1
    for svc in "${HEALTH_SERVICES[@]}"; do
      local cid status
      cid="$(compose ps -q "$svc" 2>/dev/null || true)"
      if [[ -z "$cid" ]]; then all_ok=0; break; fi
      status="$(docker inspect -f '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}{{ .State.Status }}{{ end }}' "$cid" 2>/dev/null || echo unknown)"
      if [[ "$status" != "healthy" && "$status" != "running" ]]; then all_ok=0; fi
      if [[ "$status" == "exited" || "$status" == "dead" ]]; then
        die "Service '$svc' is $status. Inspect with: bash infra/pilotage.sh logs $svc"
      fi
    done
    if [[ "$all_ok" == "1" ]]; then ok "Healthy: ${HEALTH_SERVICES[*]}"; return 0; fi
    if (( $(date +%s) >= deadline )); then
      warn "Timed out waiting for health. Current status:"
      compose ps
      die "Services did not become healthy within ${HEALTH_TIMEOUT}s."
    fi
    sleep 4
  done
}

cmd_up() {
  build_apps "" "${APP_SERVICES_DEFAULT[@]}"
  log "Starting full stack (infra + app)…"
  compose --profile app up -d
  wait_healthy
  cmd_status
}

cmd_update() {
  local svcs=("$@"); [[ ${#svcs[@]} -eq 0 ]] && svcs=("${APP_SERVICES_DEFAULT[@]}")
  build_apps "" "${svcs[@]}"
  log "Recreating containers + syncing schema…"
  # --profile app pulls in migrator (one-shot db push) ahead of api via depends_on.
  compose --profile app up -d
  wait_healthy
  ok "Update complete."
}

cmd_rebuild() {
  local svcs=("$@"); [[ ${#svcs[@]} -eq 0 ]] && svcs=("${APP_SERVICES_DEFAULT[@]}")
  build_apps "--no-cache" "${svcs[@]}"
  compose --profile app up -d
  wait_healthy
  ok "Clean rebuild complete."
}

cmd_restart() {
  local svcs=("$@")
  if [[ ${#svcs[@]} -eq 0 ]]; then
    log "Restarting all containers…"; compose --profile app restart
  else
    log "Restarting: ${svcs[*]}"; compose --profile app restart "${svcs[@]}"
  fi
  ok "Restart issued."
}

cmd_migrate() {
  log "Syncing schema (prisma db push)…"
  compose --profile app run --rm migrator
  ok "Schema in sync."
}

cmd_seed() {
  log "Seeding data…"
  compose --profile seed run --rm seed
  ok "Seed complete."
}

cmd_down()   { log "Stopping stack (volumes kept)…"; compose --profile app --profile seed down; ok "Stopped."; }
cmd_reset()  { warn "Wiping volumes + restarting from scratch…"; compose --profile app --profile seed down -v; cmd_up; }
cmd_logs()   { compose --profile app logs -f "$@"; }
cmd_status() { compose --profile app ps; }

cmd_health() {
  for svc in "${HEALTH_SERVICES[@]}"; do
    local cid status
    cid="$(compose ps -q "$svc" 2>/dev/null || true)"
    [[ -z "$cid" ]] && die "Service '$svc' is not running."
    status="$(docker inspect -f '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}{{ .State.Status }}{{ end }}' "$cid")"
    printf '  %-8s %s\n' "$svc" "$status"
    [[ "$status" == "healthy" || "$status" == "running" ]] || die "Service '$svc' is $status."
  done
  ok "All checked services healthy."
}

main() {
  command -v docker >/dev/null 2>&1 || die "docker not found on PATH."
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    up)            cmd_up "$@" ;;
    update)        cmd_update "$@" ;;
    rebuild)       cmd_rebuild "$@" ;;
    restart)       cmd_restart "$@" ;;
    migrate)       cmd_migrate "$@" ;;
    seed)          cmd_seed "$@" ;;
    down)          cmd_down "$@" ;;
    reset)         cmd_reset "$@" ;;
    logs)          cmd_logs "$@" ;;
    ps|status)     cmd_status "$@" ;;
    health)        cmd_health "$@" ;;
    ""|-h|--help|help)
      sed -n '2,48p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      ;;
    *) die "Unknown command: '$cmd'. Run 'bash infra/pilotage.sh help'." ;;
  esac
}

main "$@"
