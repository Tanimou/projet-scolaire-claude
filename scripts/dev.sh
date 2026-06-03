#!/usr/bin/env bash
# =============================================================================
# Pilotage Scolaire — DEV launcher (hybrid: Docker infra + local app)
# -----------------------------------------------------------------------------
# Optimal dev setup: infra (Postgres/Redis/Keycloak/MinIO/Maildev) runs in
# Docker, while web/api/worker run locally with hot-reload. Fastest iteration,
# lightest footprint (no app image rebuilds on every change).
#
# Usage:
#   bash scripts/dev.sh            # infra up + schema sync + seed (if empty) + pnpm dev
#   bash scripts/dev.sh --no-seed  # skip the demo seed
#   bash scripts/dev.sh --reset    # wipe DB volumes first (fresh data)
#   bash scripts/dev.sh --infra    # only bring up infra, don't start the app
#
# Stop infra later with:  pnpm docker:down   (keeps data)  |  pnpm docker:reset (wipes)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

NO_SEED=0; RESET=0; INFRA_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --no-seed) NO_SEED=1 ;;
    --reset)   RESET=1 ;;
    --infra)   INFRA_ONLY=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# --- 0. Pre-flight ----------------------------------------------------------
command -v pnpm >/dev/null 2>&1 || die "pnpm introuvable sur le PATH."
# Le projet est pinné sur Node 22 (.nvmrc). Les packages workspace sont
# consommés en SOURCE TS (main: src/index.ts) ; Node ≥ 23 (TS natif/ESM strict)
# rejette leurs barrels de dossier au runtime → l'app locale ne démarre pas.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -gt 22 ] 2>/dev/null && [ "$INFRA_ONLY" = "0" ]; then
  printf '\n\033[1;33m⚠ Node %s détecté — le projet est pinné sur Node 22 (.nvmrc) ; le run LOCAL (pnpm dev) ne fonctionne pas sur Node ≥ 23\033[0m\n' "$(node -v)"
  printf '   (les packages workspace sont consommés en source TS → barrels de dossier rejetés par le loader ESM natif).\n'
  printf '   \033[1m→ Bascule sur le stack Docker complet (api/worker/web en conteneurs, Node 22 interne).\033[0m\n'
  printf '     Pour le dev hybride hot-reload : installe Node 22 (nvm use 22) puis relance ce script.\n\n'
  docker info >/dev/null 2>&1 || die "Docker ne répond pas. Démarre Docker Desktop puis relance."
  exec bash "$ROOT/infra/pilotage.sh" up
fi
docker info >/dev/null 2>&1 || die "Docker ne répond pas. Démarre Docker Desktop puis relance.
(Si Docker reste bloqué à l'init 'Inference manager', un reboot le règle — voir C:\\Users\\HP\\Downloads\\FINIR-DOCKER-reboot.md)"

# --- 1. Infra (Docker) ------------------------------------------------------
if [ "$RESET" = "1" ]; then
  say "Reset infra (wipe volumes)…"
  pnpm docker:reset
else
  say "Démarrage de l'infra (Postgres/Redis/Keycloak/MinIO/Maildev)…"
  pnpm docker:up
fi

# --- 2. Attendre Postgres ---------------------------------------------------
say "Attente de Postgres (healthcheck)…"
for i in $(seq 1 60); do
  if docker exec pilotage_postgres pg_isready -U pilotage -d pilotage >/dev/null 2>&1; then
    echo "  Postgres prêt."; break
  fi
  [ "$i" = "60" ] && die "Postgres n'est pas prêt après 60s."
  sleep 1
done

# --- 3. Sync schema (prisma db push) ---------------------------------------
say "Synchronisation du schéma (prisma db push)…"
pnpm --filter @pilotage/api exec prisma db push --skip-generate

# --- 4. Seed démo (idempotent) ---------------------------------------------
if [ "$NO_SEED" = "0" ]; then
  say "Seed des données démo (idempotent)…"
  pnpm --filter @pilotage/api prisma:seed:demo || echo "  (seed non bloquant — ignoré si déjà présent)"
fi

# --- 5. Lancer l'app --------------------------------------------------------
if [ "$INFRA_ONLY" = "1" ]; then
  say "Infra prête. (--infra : app non lancée.)"
  echo "  Lance l'app avec:  pnpm dev"
  exit 0
fi

say "Démarrage de l'app en watch (web :3000 · api :4000 · worker)…"
echo "  Web     → http://localhost:3000"
echo "  API     → http://localhost:4000   (Swagger: /docs)"
echo "  Maildev → http://localhost:1080"
echo "  Login démo: mme.dupont@voltaire.fr / Demo!2024"
exec pnpm dev
