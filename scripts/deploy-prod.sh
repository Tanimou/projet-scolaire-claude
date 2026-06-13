#!/usr/bin/env bash
# =============================================================================
# Pilotage Scolaire — PRODUCTION deploy (Hostinger VPS, behind existing Traefik)
# -----------------------------------------------------------------------------
# One command, end to end:
#   build images → start full stack → sync schema (prisma db push) → align the
#   Keycloak redirect URLs → seed a coherent cross-portal demo → wait healthy.
#
# Layers infra/docker-compose.yml + infra/docker-compose.prod.yml and reads
# .env.prod (public origin + 127.0.0.1-bound infra ports + secrets). Our nginx
# joins the host's `root_web` Traefik network → TLS + Host routing for free.
#
# Usage (from repo root, on the server):
#   bash scripts/deploy-prod.sh              # full: build + up + migrate + seed
#   bash scripts/deploy-prod.sh --rebuild    # clean --no-cache image rebuild
#   bash scripts/deploy-prod.sh --no-seed    # skip the demo seed chain
#   bash scripts/deploy-prod.sh --seed-only  # just (re)run the seed chain
#   bash scripts/deploy-prod.sh --down       # stop the stack (keeps volumes)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-$ROOT/.env.prod}"
export DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1

say()  { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$1"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "Missing $ENV_FILE — copy .env.prod.example and fill PUBLIC_BASE_URL/PUBLIC_HOST/AUTH_SECRET."
docker info >/dev/null 2>&1 || die "Docker is not responding."

# Public values for messaging + the redirect fixer.
PUBLIC_BASE_URL="$(grep -E '^PUBLIC_BASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
PUBLIC_HOST="$(grep -E '^PUBLIC_HOST=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
[ -n "$PUBLIC_BASE_URL" ] || die "PUBLIC_BASE_URL not set in $ENV_FILE."

COMPOSE=(docker compose --env-file "$ENV_FILE" -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --profile app --profile prod)
# seed/migrate one-offs additionally need the `seed` profile active.
SEED=(docker compose --env-file "$ENV_FILE" -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --profile app --profile prod --profile seed)

REBUILD=0; NO_SEED=0; SEED_ONLY=0; DOWN=0
for a in "$@"; do case "$a" in
  --rebuild)   REBUILD=1 ;;
  --no-seed)   NO_SEED=1 ;;
  --seed-only) SEED_ONLY=1 ;;
  --down)      DOWN=1 ;;
  *) die "Unknown option: $a" ;;
esac; done

if [ "$DOWN" = 1 ]; then
  say "Stopping prod stack (volumes kept)…"; "${SEED[@]}" down; exit 0
fi

# --- wait until a compose service reports docker-healthy ---------------------
wait_healthy() {
  local svc="$1" timeout="${2:-180}" deadline cid status
  deadline=$(( $(date +%s) + timeout ))
  say "Waiting for '$svc' to be healthy (≤${timeout}s)…"
  while :; do
    cid="$("${COMPOSE[@]}" ps -q "$svc" 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
      [ "$status" = healthy ] && { ok "$svc healthy"; return 0; }
      [ "$status" = exited ] || [ "$status" = dead ] && die "$svc is $status — check: bash scripts/deploy-prod.sh logs $svc"
    fi
    (( $(date +%s) >= deadline )) && { "${COMPOSE[@]}" ps; die "$svc not healthy within ${timeout}s."; }
    sleep 4
  done
}

run_seed() { # label, command…
  local label="$1"; shift
  say "Seed: $label"
  "${SEED[@]}" run --rm seed "$@" || die "Seed step failed: $label"
  ok "Seed done: $label"
}

seed_chain() {
  # Order matters — FK + Keycloak-link dependencies (see docs/spec seed map):
  #  base structure → rich demo data → KC admins → demo teacher → demo parent →
  #  cross-portal surfaces (conversation/meeting/tutor — needs parent.demo).
  run_seed "base structure"        pnpm --filter @pilotage/api run prisma:seed
  run_seed "demo dataset"          pnpm --filter @pilotage/api run prisma:seed:demo
  run_seed "Keycloak admin users"  pnpm --filter @pilotage/api run prisma:seed:keycloak
  run_seed "demo teacher login"    pnpm --filter @pilotage/api run prisma:seed:demo:teacher
  run_seed "demo parent login"     pnpm --filter @pilotage/api run prisma:seed:demo:parent
  run_seed "cross-portal surfaces" pnpm --filter @pilotage/api run prisma:seed:surfaces
}

if [ "$SEED_ONLY" = 1 ]; then
  wait_healthy api 120
  seed_chain
  ok "Seed chain complete."
  exit 0
fi

# --- 1. Build (sequential — 2 vCPU host, avoid parallel-build OOM) -----------
BUILD_FLAG=""; [ "$REBUILD" = 1 ] && BUILD_FLAG="--no-cache"
for svc in web api worker migrator seed; do
  say "Build image: $svc ${BUILD_FLAG:+($BUILD_FLAG)}"
  # shellcheck disable=SC2086
  "${SEED[@]}" build $BUILD_FLAG "$svc"
done
ok "Images built."

# --- 2. Start the stack -----------------------------------------------------
say "Starting full stack (infra + app + nginx→Traefik)…"
"${COMPOSE[@]}" up -d

# --- 3. Wait for the data plane + schema sync (migrator gates api start) -----
say "Waiting for Postgres…"
for i in $(seq 1 60); do
  "${COMPOSE[@]}" exec -T postgres pg_isready -U pilotage -d pilotage >/dev/null 2>&1 && { ok "Postgres ready"; break; }
  [ "$i" = 60 ] && die "Postgres not ready after 60s."
  sleep 1
done
wait_healthy api 240        # implies migrator (prisma db push) completed_successfully
wait_healthy web 180

# Keycloak readiness: poll the realm discovery under /auth from inside the network
# (definitive — the management health port is separate and not what we depend on).
say "Waiting for Keycloak (/auth realm endpoint)…"
kc_deadline=$(( $(date +%s) + 240 ))
until "${COMPOSE[@]}" exec -T api curl -fsS http://keycloak:8080/auth/realms/master/.well-known/openid-configuration >/dev/null 2>&1; do
  (( $(date +%s) >= kc_deadline )) && die "Keycloak not ready within 240s — check: docker compose ... logs keycloak"
  sleep 4
done
ok "Keycloak ready"

# --- 4. Align Keycloak redirect URLs to the public origin -------------------
say "Aligning Keycloak portal redirect URLs → $PUBLIC_BASE_URL"
"${SEED[@]}" run --rm -e PUBLIC_BASE_URL="$PUBLIC_BASE_URL" seed node /app/infra/kc-prod-redirects.mjs \
  || warn "Redirect alignment failed (ROPC login still works; SSO/reset may not)."

# --- 5. Seed the coherent cross-portal demo ---------------------------------
if [ "$NO_SEED" = 0 ]; then seed_chain; else warn "Skipping seed (--no-seed)."; fi

# --- 6. Recap ---------------------------------------------------------------
say "Deployment complete."
"${COMPOSE[@]}" ps
cat <<EOF

  ┌────────────────────────────────────────────────────────────────┐
  │  Pilotage Scolaire is live                                      │
  └────────────────────────────────────────────────────────────────┘
  URL        ${PUBLIC_BASE_URL}
  Admin      ${PUBLIC_BASE_URL}/admin/login   mme.dupont@voltaire.fr / Demo!2024Pilotage
  Teacher    ${PUBLIC_BASE_URL}/teacher/login teacher.demo@voltaire.fr / Demo!2024Pilotage
  Parent     ${PUBLIC_BASE_URL}/parent/login  parent.demo@voltaire.fr / Demo!2024Pilotage

  Logs:    docker compose --env-file .env.prod -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --profile app --profile prod logs -f <svc>
  Reseed:  bash scripts/deploy-prod.sh --seed-only
EOF
