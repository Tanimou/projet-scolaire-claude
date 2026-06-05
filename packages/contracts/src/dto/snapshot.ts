import { z } from 'zod';

import { SNAPSHOT_SOURCE } from '../enums';

import { UuidSchema } from './common';

/**
 * Analytics Snapshots — E6 (declared in S1, returned by the read switch in S2/S3).
 *
 * E6 materialises three tenant-scoped read models over published/revised `Grade`
 * rows plus a durable `SnapshotRecomputeTrigger` dirty-queue, so the dashboards
 * read pre-computed averages/ranks/distributions instead of recomputing them live
 * (the cahier's <2 s parent-dashboard NFR at scale). The read path is
 * **snapshot-first with fall-through-to-live**: a miss is never an error.
 *
 * The visionary spine is **freshness as a trust signal** — every snapshot row
 * carries `computedAt` + `sourceEventId` + `revision`, and the aggregate payloads
 * expose this additive, optional {@link SnapshotFreshness} block the dashboards
 * render as a kind chip ("à jour il y a Xs" / "recalcul en cours…"). **In S1 this
 * type is declared but NOT yet returned by any endpoint** — snapshots are written
 * but never read (provably zero behaviour change). S2/S3 wire the reads.
 */

/**
 * Additive, optional freshness metadata on the analytics aggregate envelopes.
 * `source` = where the served numbers came from; `recomputing` = a newer grade
 * exists than the snapshot's `computedAt` (an open recompute trigger), so the
 * read fell through to live while the worker catches up. Never alarming — it says
 * "you're seeing the latest", never "data may be wrong".
 */
export const SnapshotFreshnessSchema = z.object({
  /** 'snapshot' = served from the materialised cache; 'live' = fall-through to live. */
  source: z.enum(SNAPSHOT_SOURCE),
  /** When the served snapshot was last rebuilt (ISO 8601). For a live result, "now". */
  computedAt: z.string(),
  /** True while an open recompute trigger exists for the scope (or served live). */
  recomputing: z.boolean(),
  /** Sample size that fed the served figures (optional context for the chip). */
  gradeCount: z.number().int().nonnegative().optional(),
  /** The recompute trigger that produced the served snapshot row (explainability). */
  sourceEventId: UuidSchema.nullable().optional(),
  /** Optimistic generation counter of the served snapshot row. */
  revision: z.number().int().positive().optional(),
});
export type SnapshotFreshness = z.infer<typeof SnapshotFreshnessSchema>;

/**
 * The scope a recompute trigger targets — the slice of snapshots to rebuild. Any
 * field may be null = "wider": a `grade_published` dirty carries the full
 * `(student?, classSection, subject, term?, academicYear)`; a `coefficient_changed`
 * dirty carries only `(subject, academicYear)` and fans out in the worker. Mirrors
 * the nullable scope columns on the Prisma `SnapshotRecomputeTrigger` model.
 */
export const SnapshotRecomputeScopeSchema = z.object({
  studentId: UuidSchema.nullable().optional(),
  classSectionId: UuidSchema.nullable().optional(),
  subjectId: UuidSchema.nullable().optional(),
  termId: UuidSchema.nullable().optional(),
  academicYearId: UuidSchema.nullable().optional(),
});
export type SnapshotRecomputeScope = z.infer<typeof SnapshotRecomputeScopeSchema>;

/**
 * Deterministic coalescing key for a `SnapshotRecomputeTrigger` (E6-S1). Shared
 * by the API enqueue (publish seam) and the worker drain so the upsert key matches
 * end-to-end. Two dirties with the same `(tenant, reason, scope)` produce the SAME
 * key → the `@@unique([tenantId, coalesceKey, status])` collapses a burst into one
 * pending row (idempotent enqueue). Every scope field uses an explicit `-`
 * sentinel for null/undefined (PM-4) so a null `termId` yields a stable,
 * non-colliding key (never `undefined`/`'null'`/`''` drift). The `tenantId` is
 * folded into the key too (belt-and-braces alongside the tenant-first unique).
 */
export function snapshotCoalesceKey(
  tenantId: string,
  reason: string,
  scope: SnapshotRecomputeScope,
): string {
  const s = (v: string | null | undefined): string => v ?? '-';
  return [
    tenantId,
    reason,
    s(scope.academicYearId),
    s(scope.classSectionId),
    s(scope.subjectId),
    s(scope.termId),
    s(scope.studentId),
  ].join('|');
}
