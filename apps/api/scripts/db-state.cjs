#!/usr/bin/env node
/**
 * Classifie l'état de la base AVANT toute migration (S-E02-1 / PF-03).
 *
 * Imprime exactement un jeton sur stdout :
 *   EMPTY                 base sans table applicative      → `migrate deploy` est sûr
 *   BASELINED             `_prisma_migrations` présente     → `migrate deploy` est sûr
 *   UNBASELINED_NONEMPTY  tables applicatives SANS ledger   → REFUS (baseline opérateur requise)
 *
 * Sort en 2 si la base est injoignable. N'écrit jamais : lecture seule.
 *
 * Utilise @prisma/client (déjà généré dans l'image) plutôt que psql, absent des
 * images node:alpine.
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient({ log: ['error'] });
  try {
    const ledger = await prisma.$queryRawUnsafe(
      `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`,
    );
    if (ledger[0] && ledger[0].present) {
      process.stdout.write('BASELINED\n');
      return;
    }

    // Pas de ledger : la base est-elle vierge, ou porte-t-elle déjà un schéma ?
    const tables = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'`,
    );
    const n = tables[0] ? Number(tables[0].n) : 0;
    process.stdout.write(n === 0 ? 'EMPTY\n' : 'UNBASELINED_NONEMPTY\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  process.stderr.write(`db-state: base injoignable — ${err && err.message ? err.message : err}\n`);
  process.exit(2);
});
