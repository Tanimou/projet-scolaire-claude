import type { LoggerService } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { readMigrationState, type MigrationState } from './migration-state';

export class MigrationPreflightError extends Error {
  constructor(readonly state: MigrationState) {
    super(
      `Preflight migrations ÉCHEC (${state.status}) : ${state.detail ?? 'état de schéma inconnu'}\n` +
        `  livrées   : ${state.shipped.join(', ') || '(aucune)'}\n` +
        `  appliquées: ${state.applied.join(', ') || '(aucune)'}\n` +
        `  en attente: ${state.pending.join(', ') || '(aucune)'}\n` +
        `L'API refuse de démarrer contre un schéma inconnu. ` +
        `Appliquez les migrations (prisma migrate deploy) ou baselinez la base : ` +
        `docs/runbooks/baseline-hosted-database.md`,
    );
    this.name = 'MigrationPreflightError';
  }
}

/**
 * Refuse de servir du trafic contre un schéma non vérifié (S-E02-1 / PF-03, AC3).
 *
 * Le contournement `MIGRATION_PREFLIGHT=off` est **ignoré en production** : c'est
 * la condition explicite « non-production » exigée par la story, et l'ignorer en
 * production est ce qui empêche DNC-10 (bypass codé en dur).
 */
export async function assertMigrationsClean(
  prisma: PrismaClient,
  logger: LoggerService,
): Promise<MigrationState | null> {
  const isProduction = process.env.NODE_ENV === 'production';
  const optOut = process.env.MIGRATION_PREFLIGHT === 'off';

  if (optOut && isProduction) {
    logger.warn?.(
      'MIGRATION_PREFLIGHT=off est IGNORÉ en production — le preflight de migrations reste actif.',
      'MigrationPreflight',
    );
  }

  if (optOut && !isProduction) {
    logger.warn?.(
      'Preflight de migrations désactivé (MIGRATION_PREFLIGHT=off, NODE_ENV≠production). ' +
        'Le schéma servi n’est pas vérifié.',
      'MigrationPreflight',
    );
    return null;
  }

  const state = await readMigrationState(prisma);

  if (state.status !== 'clean') {
    throw new MigrationPreflightError(state);
  }

  logger.log?.(
    `Preflight migrations OK — schéma ${state.schemaVersion} (${state.applied.length} appliquée(s)).`,
    'MigrationPreflight',
  );
  return state;
}
