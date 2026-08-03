#!/usr/bin/env bash
# =============================================================================
# Pilotage Scolaire — RELEASE GATE (S-E02-6 puis S-E02-10 / VAL-10, risque R-05)
# -----------------------------------------------------------------------------
# Vérifie que ce qui TOURNE est bien ce qu'on croit avoir déployé — pour les
# TROIS artefacts, et pour le schéma de base de données.
#
# Pourquoi cette gate existe : R-05 s'est déjà matérialisé. L'image qui tournait
# portait du code qu'AUCUNE ref du dépôt ne contenait — elle avait été construite
# depuis un arbre de travail non commité. Résultat : sept semaines de 404 en
# production (PF-62) que ni les tests, ni le build, ni un test manuel en local
# ne pouvaient voir, puisque tous regardaient la source et pas l'artefact.
#
# CE QUE S-E02-10 A CHANGÉ, ET POURQUOI
# -------------------------------------
# La première version n'interrogeait que l'API. Le déploiement compte pourtant
# `api`, `worker` et `web`, construits et déployés séparément : deux tiers de la
# surface n'étaient comparés à rien, et le worker écrit des données réelles.
# Elle LISAIT par ailleurs `schemaVersion`… pour l'AFFICHER, sans jamais le
# comparer, et ne lisait pas du tout `migrations.status` — donc une base non
# baselinée ou en retard de migration passait la gate en vert.
#
# Les deux comparaisons opposent des sources INDÉPENDANTES, ce qui est tout
# l'intérêt :
#   artefact  : `GIT_SHA` gravé dans l'image au build   vs  le HEAD de CE checkout
#   schéma    : dernière migration APPLIQUÉE en base    vs  la dernière migration
#                                                           LIVRÉE dans ce checkout
#
# Usage :
#   bash scripts/release-gate.sh                          # base commune, attendu = HEAD
#   bash scripts/release-gate.sh https://exemple.tld      # base URL explicite
#   bash scripts/release-gate.sh https://exemple.tld <sha>
#   EXPECTED_GIT_SHA=<sha> bash scripts/release-gate.sh <url>
#
# Quand les trois artefacts ne partagent pas une même base (par ex. en local, où
# chaque conteneur publie son propre port), surcharger individuellement :
#   RELEASE_GATE_API_URL / RELEASE_GATE_WORKER_URL / RELEASE_GATE_WEB_URL
# Ce sont des ADRESSES, pas des interrupteurs : aucune valeur ne retire un
# artefact du contrôle. Un artefact injoignable est un ÉCHEC, jamais un saut
# (DNC-08/DNC-10) — c'est la règle qui empêche la gate de redevenir déclarative.
#
# Sortie : 0 si tout est conforme, non-zéro sinon. Aucun drapeau ne permet de
# forcer un succès — la gate rapporte ce qu'elle observe.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BASE_URL="${1:-${RELEASE_GATE_URL:-http://localhost:4000}}"
BASE_URL="${BASE_URL%/}"
EXPECTED="${2:-${EXPECTED_GIT_SHA:-}}"

API_URL="${RELEASE_GATE_API_URL:-$BASE_URL}";       API_URL="${API_URL%/}"
WORKER_URL="${RELEASE_GATE_WORKER_URL:-$BASE_URL}"; WORKER_URL="${WORKER_URL%/}"
WEB_URL="${RELEASE_GATE_WEB_URL:-$BASE_URL}";       WEB_URL="${WEB_URL%/}"

ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; FAILURES=$((FAILURES + 1)); }
die()  { printf '\n\033[1;31m✗ RELEASE GATE ÉCHEC — %s\033[0m\n' "$1" >&2; exit 1; }

FAILURES=0

# Attendu par défaut : le commit du checkout qui lance la gate.
if [ -z "$EXPECTED" ] && git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  EXPECTED="$(git -C "$ROOT" rev-parse HEAD)"
fi
[ -n "$EXPECTED" ] || die "Aucun SHA attendu : passez-le en argument ou via EXPECTED_GIT_SHA."
EXPECTED_SHORT="${EXPECTED:0:12}"

# --- Attendu côté schéma : la dernière migration LIVRÉE par ce checkout -------
# Lue sur le disque, pas demandée à l'artefact jugé — c'est ce qui rend la
# comparaison indépendante. Le tri est le même que celui de Prisma (lexical sur
# le nom de dossier, qui est horodaté).
MIGRATIONS_DIR="$ROOT/apps/api/prisma/migrations"
EXPECTED_SCHEMA=""
if [ -d "$MIGRATIONS_DIR" ]; then
  EXPECTED_SCHEMA="$(
    for d in "$MIGRATIONS_DIR"/*/; do
      [ -f "${d}migration.sql" ] || continue
      basename "$d"
    done | LC_ALL=C sort | tail -1
  )"
fi
[ -n "$EXPECTED_SCHEMA" ] || die "Aucune migration livrée sous apps/api/prisma/migrations :
  ce checkout ne peut pas dire quel schéma il attend (PF-03 / S-E02-1)."

printf '\n\033[1;35m▶ Release gate\033[0m\n'
printf '  commit attendu   : %s\n' "$EXPECTED_SHORT"
printf '  schéma attendu   : %s\n\n' "$EXPECTED_SCHEMA"

# --- Extraction de champs plats (jq n'est pas garanti sur l'hôte) ------------
BODY=""
field() { printf '%s' "$BODY" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1; }

# =============================================================================
# Un artefact : joignable, honnête sur son identité, et au bon commit.
# =============================================================================
check_artifact() { # nom, url complète du manifeste
  local app="$1" url="$2" verdict running reported_app bare

  if ! BODY="$(curl -fsS --max-time 20 "$url" 2>/dev/null)"; then
    fail "$app : manifeste injoignable sur $url
    Causes : l'artefact ne tourne pas ; le reverse-proxy ne route pas ce chemin
    (voir infra/nginx/conf.d/pilotage.conf) ; ou l'artefact déployé est ANTÉRIEUR
    au manifeste — ce qui EST déjà une dérive (R-05)."
    return
  fi

  verdict="$(field verdict)"
  running="$(field buildSha)"
  reported_app="$(field app)"

  if [ -z "$verdict" ]; then
    fail "$app : le manifeste ne porte pas de champ release.verdict — l'artefact
    déployé précède ce contrôle. Reconstruire (bash scripts/deploy-prod.sh)."
    return
  fi

  # L'artefact déclare qui il est. Sans ce contrôle, un proxy mal routé qui
  # renverrait le manifeste de l'API sur /version/worker serait indiscernable
  # d'un worker conforme — la gate serait verte sur un worker jamais interrogé.
  if [ -n "$reported_app" ] && [ "$reported_app" != "$app" ]; then
    fail "$app : $url a répondu le manifeste de '$reported_app'.
    Le routage envoie la gate vers le mauvais artefact ; le contrôle de '$app'
    n'a pas eu lieu."
    return
  fi

  case "$verdict" in
    match) ;;
    unverified) fail "$app : l'artefact n'a comparé son build à RIEN (EXPECTED_GIT_SHA
    non injecté dans le conteneur). Le déploiement ne peut pas se prouver lui-même.
    Renseignez EXPECTED_GIT_SHA dans .env.prod ou déployez via scripts/deploy-prod.sh."; return ;;
    dirty) fail "$app : artefact construit depuis un arbre de travail NON COMMITÉ.
    Son contenu n'est reproductible depuis aucune ref — c'est la cause exacte de R-05."; return ;;
    drift) fail "$app : dérive déclarée par l'artefact (${running} ≠ ${EXPECTED_SHORT})."; return ;;
    unstamped) fail "$app : l'image ne porte aucun GIT_SHA — construite sans le build
    arg (image antérieure, ou build hors scripts/deploy-prod.sh)."; return ;;
    *) fail "$app : verdict inconnu '${verdict}'."; return ;;
  esac

  # Contrôle indépendant : la gate ne délègue pas sa décision à l'artefact
  # qu'elle est censée juger. Il compare son GIT_SHA gravé à l'EXPECTED_GIT_SHA
  # qu'on lui a injecté ; ici on recompare au SHA de CE checkout, qui peut être
  # un troisième candidat si le conteneur a été lancé avec une autre attente.
  bare="${running%-dirty}"
  if [ -z "$bare" ] || [ "$bare" != "${EXPECTED:0:${#bare}}" ]; then
    fail "$app : se déclare conforme, mais à un AUTRE commit que ce checkout —
    il exécute '${running}', ici on attend '${EXPECTED_SHORT}'.
    EXPECTED_GIT_SHA injecté dans le conteneur ne correspond pas à ce dépôt."
    return
  fi

  ok "$app : ${running}"
}

# =============================================================================
# Le schéma : la base est-elle au niveau que CE checkout livre ?
# =============================================================================
check_schema() { # url du manifeste de l'API
  local url="$1" status applied_schema

  if ! BODY="$(curl -fsS --max-time 20 "$url" 2>/dev/null)"; then
    fail "schéma : manifeste de l'API injoignable, impossible de lire l'état des migrations."
    return
  fi

  status="$(field status)"
  applied_schema="$(field schemaVersion)"

  case "$status" in
    clean) ;;
    "") fail "schéma : le manifeste ne publie pas migrations.status — artefact antérieur."; return ;;
    unbaselined) fail "schéma : la base n'a JAMAIS été baselinée (_prisma_migrations absente).
    Le déploiement tourne sur un schéma dont l'origine est inconnue — c'est PF-03.
    Voir docs/runbooks/baseline-hosted-database.md."; return ;;
    pending) fail "schéma : des migrations livrées ne sont PAS appliquées. Le code qui
    tourne attend un schéma que la base n'a pas."; return ;;
    failed) fail "schéma : une migration est en échec ou a été rollback."; return ;;
    no-migrations-shipped) fail "schéma : l'image ne contient aucune migration."; return ;;
    *) fail "schéma : statut de migration inconnu '${status}'."; return ;;
  esac

  # `status: clean` ne dit QUE « toutes les migrations de CETTE image sont
  # appliquées ». Une image plus ancienne est donc « clean » sur son propre
  # retard. La comparaison utile est contre ce que CE checkout livre.
  if [ "$applied_schema" != "$EXPECTED_SCHEMA" ]; then
    fail "schéma : la base est à '${applied_schema:-(aucune)}' alors que ce checkout livre
    '${EXPECTED_SCHEMA}'. L'artefact se déclare cohérent avec LUI-MÊME, mais il
    n'embarque pas les migrations de ce dépôt (R-05 au niveau du schéma)."
    return
  fi

  ok "schéma : ${applied_schema}"
}

check_artifact api    "$API_URL/version"
check_artifact worker "$WORKER_URL/version/worker"
check_artifact web    "$WEB_URL/version/web"
check_schema          "$API_URL/version"

printf '\n'
if [ "$FAILURES" -ne 0 ]; then
  die "$FAILURES contrôle(s) en échec sur 4. Voir docs/runbooks/release-gate.md."
fi
ok "Déploiement conforme : api + worker + web sur ${EXPECTED_SHORT}, schéma ${EXPECTED_SCHEMA}"
