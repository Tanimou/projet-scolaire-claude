import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * E9-S1 / ADR-022 — applies the open-claim partial-unique index on API boot.
 *
 * Prisma `@@unique` cannot express a `WHERE`, so the idempotency guard for an OPEN
 * (submitted) claim lives as raw DDL (the E7-S2 `BookingIndexBootstrap` idiom). The
 * index `guardianship_claim_open_unique (guardian_id, matched_student_id) WHERE
 * status='submitted'` makes at most ONE open claim per (guardian, matched child) —
 * so a concurrent double-submit on the SAME matched child collapses to one row
 * (P2002), never a duplicate. NULL `matched_student_id` rows (match_failed) do not
 * collide (Postgres unique indexes treat NULLs as distinct), which is the intended
 * behaviour — only matched claims are deduplicated by this index; the
 * `@@unique([guardianId, studentId])` on `Guardianship` is the second guard for the
 * driven pending link.
 *
 * BEST-EFFORT: if the `guardianship_claim` table does not exist yet (the additive
 * S1 `db push` is still pending) or the DB is unreachable, it logs a warning and
 * continues — the service's P2002-collapse + re-read path is the defence-in-depth
 * fallback, so a missing index degrades to "slower but still correct", never a 500.
 */
@Injectable()
export class GuardianshipClaimIndexBootstrap implements OnModuleInit {
  private readonly logger = new Logger(GuardianshipClaimIndexBootstrap.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS guardianship_claim_open_unique
           ON guardianship_claim (guardian_id, matched_student_id)
           WHERE status = 'submitted'`,
      );
      this.logger.log(
        'ADR-022 partial-unique index guardianship_claim_open_unique ensured (open-claim idempotency guard).',
      );
    } catch (err) {
      this.logger.warn(
        `Could not ensure guardianship_claim_open_unique (guardianship_claim table may not exist yet / db push pending). ` +
          `The P2002-collapse path remains authoritative. Cause: ${(err as Error).message}`,
      );
    }
  }
}
