import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * E7-S2 / ADR-020 — applies the never-over-book partial-unique index on API boot.
 *
 * Prisma `@@unique` cannot express a `WHERE`, so the capacity-1 guard lives as raw
 * DDL (`apps/api/prisma/sql/booking-active-instance-uniq.sql`). Winston's binding
 * condition C-1: the index must be APPLIED as runnable DDL, not merely described —
 * the `student_enrollment` precedent shows a partial index documented only in prose
 * gets silently dropped (this repo has no `migrations/` folder, `db push` only).
 *
 * This bootstrap runs the idempotent `CREATE UNIQUE INDEX IF NOT EXISTS …` once on
 * module init, so a fresh DB / a `db push` that re-creates the `booking` table
 * self-heals the index on the next API start. It is BEST-EFFORT: if the booking
 * table does not exist yet (S1 `db push` still pending) or the DB is unreachable,
 * it logs a warning and continues — the booking service's transactional count path
 * is the defence-in-depth fallback so a missing index degrades to "slower but still
 * correct", never to "silent over-book".
 */
@Injectable()
export class BookingIndexBootstrap implements OnModuleInit {
  private readonly logger = new Logger(BookingIndexBootstrap.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS booking_active_instance_unique
           ON booking (availability_id, session_at)
           WHERE status IN ('requested', 'confirmed')`,
      );
      this.logger.log(
        'ADR-020 partial-unique index booking_active_instance_unique ensured (capacity-1 over-book guard).',
      );
    } catch (err) {
      this.logger.warn(
        `Could not ensure booking_active_instance_unique (booking table may not exist yet / db push pending). ` +
          `The transactional count path remains authoritative. Cause: ${(err as Error).message}`,
      );
    }
  }
}
