import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { PrismaClient } from '@prisma/client';

/**
 * État du ledger de migrations (S-E02-1 / PF-03).
 *
 * Le runtime image ne contient PAS le CLI prisma (`pnpm deploy --prod` élague les
 * devDependencies — voir infra/docker/Dockerfile.api §47), donc `prisma migrate status`
 * n'est pas invocable depuis l'API. On lit donc directement `_prisma_migrations`.
 */
export type MigrationStatus =
  /** `_prisma_migrations` absente alors que la base porte déjà des tables applicatives. */
  | 'unbaselined'
  /** Une ou plusieurs migrations livrées ne sont pas appliquées. */
  | 'pending'
  /** Une migration a échoué ou a été rollback. */
  | 'failed'
  /** Aucune migration livrée dans l'image — ne doit jamais arriver en production. */
  | 'no-migrations-shipped'
  /** Toutes les migrations livrées sont appliquées. */
  | 'clean';

export interface MigrationState {
  status: MigrationStatus;
  /** Migrations présentes dans l'image (noms de dossiers, triés). */
  shipped: string[];
  /** Migrations appliquées et terminées, dans l'ordre d'application. */
  applied: string[];
  /** Livrées mais non appliquées. */
  pending: string[];
  /** Appliquées en échec ou rollback. */
  failed: string[];
  /** Dernière migration appliquée — la « version de schéma » exposée (VAL-10). */
  schemaVersion: string | null;
  /** Message humain expliquant un statut non-`clean`. */
  detail: string | null;
}

interface PrismaMigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

/**
 * Localise `prisma/migrations`. `PRISMA_MIGRATIONS_DIR` n'est qu'une relocalisation :
 * il ne peut pas désactiver le contrôle. Un dossier vide reste un échec (voir
 * `no-migrations-shipped`), sinon il constituerait un contournement — DNC-10.
 */
export function resolveMigrationsDir(): string | null {
  const candidates = [
    process.env.PRISMA_MIGRATIONS_DIR,
    join(process.cwd(), 'prisma', 'migrations'),
    resolve(__dirname, '..', '..', '..', 'prisma', 'migrations'),
  ].filter((c): c is string => Boolean(c));

  for (const dir of candidates) {
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
  }
  return null;
}

function listShippedMigrations(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'migration.sql')))
    .map((e) => e.name)
    .sort();
}

/**
 * Lit l'état réel du ledger. Ne lève jamais : toute erreur devient un statut
 * exploitable par l'appelant (le preflight décide seul de bloquer ou non).
 */
export async function readMigrationState(prisma: PrismaClient): Promise<MigrationState> {
  const empty = (status: MigrationStatus, detail: string | null, shipped: string[] = []): MigrationState => ({
    status,
    shipped,
    applied: [],
    pending: shipped,
    failed: [],
    schemaVersion: null,
    detail,
  });

  const dir = resolveMigrationsDir();
  if (!dir) {
    return empty('no-migrations-shipped', 'Aucun dossier prisma/migrations trouvé dans l’image.');
  }

  const shipped = listShippedMigrations(dir);
  if (shipped.length === 0) {
    return empty('no-migrations-shipped', `Dossier de migrations vide : ${dir}`);
  }

  const ledger = await prisma.$queryRawUnsafe<{ present: boolean }[]>(
    `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`,
  );

  if (!ledger[0]?.present) {
    return empty(
      'unbaselined',
      "La table _prisma_migrations est absente : la base n'a jamais été baselinée. " +
        'Voir docs/runbooks/baseline-hosted-database.md.',
      shipped,
    );
  }

  const rows = await prisma.$queryRawUnsafe<PrismaMigrationRow[]>(
    `SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY started_at ASC`,
  );

  const applied = rows
    .filter((r) => r.finished_at !== null && r.rolled_back_at === null)
    .map((r) => r.migration_name);
  const failed = rows
    .filter((r) => r.rolled_back_at !== null || r.finished_at === null)
    .map((r) => r.migration_name);
  const pending = shipped.filter((m) => !applied.includes(m));

  const schemaVersion = applied[applied.length - 1] ?? null;

  if (failed.length > 0) {
    return {
      status: 'failed',
      shipped,
      applied,
      pending,
      failed,
      schemaVersion,
      detail: `Migration(s) en échec ou rollback : ${failed.join(', ')}.`,
    };
  }

  if (pending.length > 0) {
    return {
      status: 'pending',
      shipped,
      applied,
      pending,
      failed,
      schemaVersion,
      detail: `Migration(s) livrée(s) mais non appliquée(s) : ${pending.join(', ')}.`,
    };
  }

  return { status: 'clean', shipped, applied, pending, failed, schemaVersion, detail: null };
}

/*
 * Le SHA du build a déménagé dans `shared/release/release-manifest.ts` (S-E02-6) :
 * il n'a de sens qu'associé au SHA attendu, et une seule source de vérité évite que
 * les deux lectures divergent.
 */
