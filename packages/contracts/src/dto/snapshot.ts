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

/**
 * PF-24 — separator that turns a canonical coalescing key into a **terminal** key.
 *
 * The `@@unique([tenantId, coalesceKey, status])` on `snapshot_recompute_trigger`
 * is what makes the *pending* slot coalescing (one live row per scope). Applied to
 * a TERMINAL status it means the opposite: at most one `done` row and at most one
 * `failed` row may ever exist per `(tenant, scope)` — so the SECOND recompute of
 * any scope cannot be marked `done` (P2002), the row stays `processing` forever and
 * `recomputing` pins true. The key is a pure function of `(tenant, reason, scope)`,
 * so this is unconditional, not a race.
 *
 * Fix: terminal rows stop competing for the coalescing slot. `done`/`failed` carry
 * a key suffixed with the row's own id — unique by construction (the id is the
 * primary key), so a terminal write can never raise P2002. `pending`/`processing`
 * keep the canonical key, so enqueue-side coalescing is byte-for-byte unchanged.
 *
 * The separator cannot occur inside a canonical key: that key is `tenantId`, a
 * snake_case `reason` and five uuid-or-`-` fields joined with `|`.
 */
const TERMINAL_COALESCE_SEPARATOR = '#terminal:';

/**
 * PF-24 — the key a trigger row carries once it reaches a TERMINAL status
 * (`done` / `failed`). Unique per row id, so terminal rows never collide with each
 * other, and never occupy the canonical coalescing slot. Idempotent: re-deriving
 * from an already-terminal key yields the same result.
 */
export function terminalCoalesceKey(coalesceKey: string, triggerId: string): string {
  return `${canonicalCoalesceKey(coalesceKey)}${TERMINAL_COALESCE_SEPARATOR}${triggerId}`;
}

/**
 * PF-24 — the canonical (coalescing) key behind any stored key. Strips a terminal
 * suffix if present; a key that was never mangled is returned unchanged (so rows
 * written before this fix keep working). This is the key a row MUST carry whenever
 * it goes back to `pending`/`processing`, otherwise the API enqueue would no longer
 * fold onto it and the queue would grow one uncoalesced row per dirty.
 */
export function canonicalCoalesceKey(coalesceKey: string): string {
  const at = coalesceKey.indexOf(TERMINAL_COALESCE_SEPARATOR);
  return at === -1 ? coalesceKey : coalesceKey.slice(0, at);
}

/* ------------------------------------------------------------------------- *
 * E6-S5 — optional admin operability surface (additive).
 *
 * Two read-only/explicit-action admin endpoints reusing the existing
 * `schools.read` capability (NO new permission). The status read is pure
 * observability; the rebuild enqueues an idempotently-coalesced
 * `manual_rebuild` trigger and writes ONE append-only `analytics.snapshot_rebuild`
 * audit row (the explicit-action concern stays API-side — the worker drain is
 * unaudited bookkeeping, ADR-019 §Non-goals). These DTOs match the openapi the
 * E6 spec-kit already wrote; they are additive contract types (convention reuse),
 * never a new architectural decision.
 * ------------------------------------------------------------------------- */

/**
 * Request body for `POST /analytics/snapshots/rebuild`. Every field is optional:
 * a fully-unscoped request rebuilds the whole (server-derived) tenant; a
 * `classSectionId` scopes to one class; a class-less `(subjectId, academicYearId)`
 * fans out coefficient-style. Supplied scope ids are validated **in the caller's
 * tenant** before enqueue (404 on a foreign id) so a rebuild can never carry
 * another tenant's id.
 */
export const RebuildSnapshotsRequestSchema = z.object({
  classSectionId: UuidSchema.nullable().optional(),
  subjectId: UuidSchema.nullable().optional(),
  studentId: UuidSchema.nullable().optional(),
  termId: UuidSchema.nullable().optional(),
  academicYearId: UuidSchema.nullable().optional(),
});
export type RebuildSnapshotsRequest = z.infer<typeof RebuildSnapshotsRequestSchema>;

/**
 * `202` response for a rebuild enqueue. `coalesced` is **truthful**: true when
 * the `manual_rebuild` trigger folded onto an already-pending row for the same
 * scope (no extra work), false when a fresh row was created.
 */
export const RebuildSnapshotsResponseSchema = z.object({
  triggerId: UuidSchema,
  status: z.enum(['pending', 'processing', 'done', 'failed']),
  coalesced: z.boolean(),
});
export type RebuildSnapshotsResponse = z.infer<typeof RebuildSnapshotsResponseSchema>;

/** One recent recompute-trigger row in the status feed (read-only, tenant-scoped). */
export const SnapshotRecomputeRecentItemSchema = z.object({
  id: UuidSchema,
  reason: z.string(),
  status: z.enum(['pending', 'processing', 'done', 'failed']),
  classSectionId: UuidSchema.nullable(),
  subjectId: UuidSchema.nullable(),
  academicYearId: UuidSchema.nullable(),
  attempts: z.number().int().nonnegative(),
  enqueuedAt: z.string(),
  processedAt: z.string().nullable(),
});
export type SnapshotRecomputeRecentItem = z.infer<typeof SnapshotRecomputeRecentItemSchema>;

/**
 * `GET /analytics/snapshots/recompute-status` — tenant-scoped backlog health for
 * the admin ops view. Pure observability (no audit, no mutation).
 */
export const SnapshotRecomputeStatusResponseSchema = z.object({
  pending: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  oldestPendingAt: z.string().nullable(),
  recent: z.array(SnapshotRecomputeRecentItemSchema),
});
export type SnapshotRecomputeStatusResponse = z.infer<
  typeof SnapshotRecomputeStatusResponseSchema
>;
