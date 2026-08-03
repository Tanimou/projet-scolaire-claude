#!/usr/bin/env bash
# =============================================================================
# Pilotage Scolaire — RELEASE GATE (S-E02-6 / VAL-10, risque R-05)
# -----------------------------------------------------------------------------
# Vérifie que l'artefact RÉELLEMENT en cours d'exécution est bien le commit
# attendu, en lisant le manifeste `GET /version` exposé par l'API.
#
# Pourquoi cette gate existe : R-05 s'est déjà matérialisé. L'image qui tournait
# portait du code qu'AUCUNE ref du dépôt ne contenait — elle avait été construite
# depuis un arbre de travail non commité. Résultat : sept semaines de 404 en
# production (PF-62) que ni les tests, ni le build, ni un test manuel en local
# ne pouvaient voir, puisque tous regardaient la source et pas l'artefact.
#
# Usage :
#   bash scripts/release-gate.sh                          # localhost:4000, attendu = HEAD
#   bash scripts/release-gate.sh https://exemple.tld      # base URL explicite
#   bash scripts/release-gate.sh https://exemple.tld <sha>
#   EXPECTED_GIT_SHA=<sha> bash scripts/release-gate.sh <url>
#
# Sortie : 0 si l'artefact est conforme, non-zéro sinon. Aucun drapeau ne permet
# de forcer un succès (DNC-08/DNC-10) — la gate rapporte ce qu'elle observe.
# =============================================================================
set -euo pipefail

BASE_URL="${1:-${RELEASE_GATE_URL:-http://localhost:4000}}"
BASE_URL="${BASE_URL%/}"
EXPECTED="${2:-${EXPECTED_GIT_SHA:-}}"

ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$1"; }
die()  { printf '\n\033[1;31m✗ RELEASE GATE ÉCHEC — %s\033[0m\n' "$1" >&2; exit 1; }

# Attendu par défaut : le commit du checkout qui lance la gate.
if [ -z "$EXPECTED" ] && git rev-parse --git-dir >/dev/null 2>&1; then
  EXPECTED="$(git rev-parse HEAD)"
fi
[ -n "$EXPECTED" ] || die "Aucun SHA attendu : passez-le en argument ou via EXPECTED_GIT_SHA."

MANIFEST_URL="$BASE_URL/version"
printf '\n\033[1;35m▶ Release gate: %s (attendu %s)\033[0m\n' "$MANIFEST_URL" "${EXPECTED:0:12}"

BODY="$(curl -fsS --max-time 20 "$MANIFEST_URL" 2>/dev/null)" \
  || die "Manifeste injoignable sur $MANIFEST_URL.
  Causes possibles : l'API ne tourne pas ; le reverse-proxy ne route pas /version
  (voir infra/nginx/conf.d/pilotage.conf) ; ou l'artefact déployé est ANTÉRIEUR à
  l'introduction de /version — ce qui est déjà une dérive (R-05)."

# jq n'est pas garanti sur l'hôte : extraction par sed, sur des champs plats.
field() { printf '%s' "$BODY" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1; }

VERDICT="$(field verdict)"
RUNNING="$(field buildSha)"
SCHEMA="$(field schemaVersion)"

printf '  build en cours : %s\n' "${RUNNING:-?}"
printf '  attendu        : %s\n' "${EXPECTED:0:12}"
printf '  schéma         : %s\n' "${SCHEMA:-?}"
printf '  verdict API    : %s\n' "${VERDICT:-(absent)}"

if [ -z "$VERDICT" ]; then
  die "Le manifeste ne porte pas de champ release.verdict : l'artefact déployé
  précède S-E02-6. Reconstruire et redéployer (bash scripts/deploy-prod.sh)."
fi

case "$VERDICT" in
  match)
    # Contrôle indépendant : la gate ne délègue pas sa décision à l'artefact
    # qu'elle est censée juger. L'API compare son GIT_SHA gravé à l'EXPECTED_GIT_SHA
    # qu'on lui a injecté ; ici on recompare au SHA de CE checkout, qui peut être
    # un troisième candidat si le conteneur a été lancé avec une autre attente.
    RUNNING_BARE="${RUNNING%-dirty}"
    if [ "$RUNNING_BARE" != "${EXPECTED:0:${#RUNNING_BARE}}" ]; then
      die "L'API se déclare conforme, mais à un AUTRE commit que ce checkout :
  elle exécute '${RUNNING}', ici on attend '${EXPECTED:0:12}'.
  EXPECTED_GIT_SHA injecté dans le conteneur ne correspond pas à ce dépôt."
    fi
    ok "Artefact conforme : ${RUNNING} · schéma ${SCHEMA}"; exit 0 ;;
  unverified) die "L'API n'a comparé son build à RIEN (EXPECTED_GIT_SHA non injecté
  dans le conteneur). Le SHA concorde avec ce checkout, mais le déploiement ne
  peut pas se prouver lui-même. Renseignez EXPECTED_GIT_SHA dans .env.prod ou
  déployez via scripts/deploy-prod.sh." ;;
  dirty)      die "L'artefact a été construit depuis un arbre de travail NON COMMITÉ.
  Son contenu n'est reproductible depuis aucune ref — c'est la cause exacte de R-05." ;;
  drift)      die "Dérive d'artefact déclarée par l'API (${RUNNING} ≠ ${EXPECTED:0:12})." ;;
  unstamped)  die "L'image ne porte aucun GIT_SHA : elle a été construite sans le
  build arg (image antérieure, ou build hors scripts/deploy-prod.sh)." ;;
  *)          die "Verdict inconnu '${VERDICT}'." ;;
esac
