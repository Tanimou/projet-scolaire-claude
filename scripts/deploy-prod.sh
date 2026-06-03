#!/usr/bin/env bash
# =============================================================================
# Pilotage Scolaire — PROD deploy (full Docker stack + nginx)
# -----------------------------------------------------------------------------
# Everything containerised: Postgres/Redis/Keycloak/MinIO + api/worker/web
# behind an nginx reverse proxy. Portable, reproducible (Phase 8 target).
#
# Usage:
#   bash scripts/deploy-prod.sh           # build images + start full stack + sync + seed
#   bash scripts/deploy-prod.sh --rebuild # force a clean --no-cache image rebuild
#   bash scripts/deploy-prod.sh --no-seed # skip demo seed (real deployments)
#   bash scripts/deploy-prod.sh --down    # stop the stack (keeps data volumes)
#
# Notes:
#   - Reads infra/docker-compose.yml with the `app` (api/worker/web/migrator)
#     and `prod` (nginx) profiles. The base infra profile is always included.
#   - For routine container ops (update one service, logs, health) the mature
#     manager is:  bash infra/pilotage.sh <up|update|rebuild|logs|ps|health>
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose --env-file .env -f infra/docker-compose.yml --profile app --profile prod)
REBUILD=0; NO_SEED=0; DOWN=0
for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=1 ;;
    --no-seed) NO_SEED=1 ;;
    --down)    DOWN=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

docker info >/dev/null 2>&1 || die "Docker ne répond pas. Démarre Docker Desktop puis relance."

if [ "$DOWN" = "1" ]; then
  say "Arrêt de la stack prod (volumes conservés)…"
  "${COMPOSE[@]}" down
  exit 0
fi

# --- 1. Build images --------------------------------------------------------
if [ "$REBUILD" = "1" ]; then
  say "Build images (clean, --no-cache)…"
  "${COMPOSE[@]}" build --no-cache api worker web
else
  say "Build images (cache)…"
  "${COMPOSE[@]}" build api worker web
fi

# --- 2. Start full stack ----------------------------------------------------
say "Démarrage de la stack complète (infra + app + nginx)…"
"${COMPOSE[@]}" up -d

# --- 3. Attendre Postgres + sync schema ------------------------------------
say "Attente de Postgres…"
for i in $(seq 1 60); do
  if docker exec pilotage_postgres pg_isready -U pilotage -d pilotage >/dev/null 2>&1; then
    echo "  Postgres prêt."; break
  fi
  [ "$i" = "60" ] && die "Postgres n'est pas prêt après 60s."
  sleep 1
done

say "Synchronisation du schéma (prisma db push, via conteneur api)…"
"${COMPOSE[@]}" exec -T api node -e "process.exit(0)" >/dev/null 2>&1 \
  && "${COMPOSE[@]}" exec -T api npx prisma db push --skip-generate \
  || echo "  (db push: le conteneur migrator l'exécute déjà au démarrage — ignoré si fait)"

# --- 4. Seed (optionnel) ----------------------------------------------------
if [ "$NO_SEED" = "0" ]; then
  say "Seed des données démo…"
  "${COMPOSE[@]}" --profile seed up seed || echo "  (seed non bloquant)"
fi

# --- 5. Récap ---------------------------------------------------------------
say "Stack prod démarrée."
"${COMPOSE[@]}" ps
echo ""
echo "  App (via nginx) → http://localhost"
echo "  Santé:  bash infra/pilotage.sh health"
echo "  Logs:   bash infra/pilotage.sh logs <service>"
