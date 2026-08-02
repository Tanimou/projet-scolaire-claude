#!/bin/sh
# ------------------------------------------------------------------------------
# Migrator — point d'entrée SÛR (S-E02-1 / PF-03)
#
# Remplace `prisma db push --accept-data-loss`, qui synchronisait le schéma de
# production sans historique ni possibilité de rollback.
#
# Règles, dans l'ordre :
#   1. base avec des tables MAIS sans `_prisma_migrations` → REFUS explicite.
#      On ne devine pas quelle transition a produit ce schéma : la baseline est
#      une action opérateur, documentée dans docs/runbooks/baseline-hosted-database.md.
#   2. sinon → `prisma migrate deploy` (n'applique que des migrations revues).
#
# Jamais de `db push`. Jamais de `--accept-data-loss`. Aucune variable
# d'environnement ne réactive l'ancien comportement — ce serait DNC-10, et
# rapporter un succès non obtenu serait DNC-08.
# ------------------------------------------------------------------------------
set -eu

FILTER="--filter @pilotage/api"

echo "[migrator] inspection de l'état de la base…"
STATE="$(pnpm $FILTER exec node scripts/db-state.cjs)"
echo "[migrator] état = ${STATE}"

case "$STATE" in
  UNBASELINED_NONEMPTY)
    cat >&2 <<'EOF'

  ┌──────────────────────────────────────────────────────────────────────────┐
  │  REFUS — la base porte un schéma applicatif SANS historique de migration │
  └──────────────────────────────────────────────────────────────────────────┘

  La table `_prisma_migrations` est absente : cette base a été créée par
  `prisma db push`, et rien n'indique quelle transition l'a produite.

  Appliquer des migrations maintenant, ou marquer la baseline comme appliquée
  sans vérification, corromprait le ledger. Le migrator s'arrête donc ici.

  Action opérateur — dans cet ordre, voir
  docs/runbooks/baseline-hosted-database.md :

    1. VÉRIFIER LA DÉRIVE (ne rien écrire) :
         prisma migrate diff \
           --from-url "$DATABASE_URL" \
           --to-schema-datamodel prisma/schema.prisma \
           --script --exit-code

       • sortie 0 / diff vide  → la base correspond à schema.prisma, continuer
       • sortie 2 / diff non vide → STOP. C'est la dérive source↔hébergé
         (story S-E02-5). Ne PAS baseliner : la baseline mentirait.

    2. MARQUER LA BASELINE COMME APPLIQUÉE (aucune écriture de schéma) :
         prisma migrate resolve --applied 0_baseline

    3. VÉRIFIER :
         prisma migrate status     # doit être « up to date »

  Puis relancer le déploiement.

EOF
    exit 1
    ;;
  EMPTY|BASELINED)
    echo "[migrator] application des migrations (prisma migrate deploy)…"
    pnpm $FILTER exec prisma migrate deploy
    echo "[migrator] migrations appliquées."
    ;;
  *)
    echo "[migrator] état inattendu « ${STATE} » — arrêt sans rien appliquer." >&2
    exit 1
    ;;
esac
