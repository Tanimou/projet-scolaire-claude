import { ImportStatus } from '@prisma/client';

/**
 * E11 hardening (ADR-024 §4 "Stale-lease reclaim", FR6) — the claim-admission
 * decision for the async import worker, extracted as a PURE function so it is
 * unit-testable without a Prisma/BullMQ stack.
 *
 * **Why this exists.** The S1 `ImportsProcessor` originally re-admitted ANY
 * `applying` batch unconditionally (`WHERE status IN ('queued','applying')`).
 * That is unsafe under BullMQ at-least-once delivery: a re-delivered / duplicate
 * job could re-claim a batch a **still-alive** worker is actively mid-apply on,
 * letting two workers run the same `$transaction` concurrently (the second
 * racing the first's per-row RESUME). The ADR/FR6 contract is a **lease**: an
 * `applying` batch is reclaimable **only** once its claim instant is older than
 * `IMPORTS_APPLY_STALE_MIN` (a genuinely dead worker self-heals after the lease
 * expires; a live worker's batch is left alone). This mirrors the
 * analytics-snapshots / E7-S5 `processedAt`-keyed reclaim.
 *
 * The claim instant is the `claimedAt` ISO string the processor stamps into the
 * batch `summary` Json at claim time (no schema column — the live progress
 * counter already rides `summary`). A missing/unparseable `claimedAt` on an
 * `applying` batch is a pre-hardening / legacy claim → treated as stale
 * (defensive reclaim, the snapshot `processedAt: null` precedent), so a batch
 * stamped before this change can never wedge forever.
 */

/** A `applying` batch whose claim is older than this (minutes) is reclaimable. */
export const IMPORTS_APPLY_STALE_MIN = Number(process.env.IMPORTS_APPLY_STALE_MIN ?? 15);

/** The decision outcome — which status the from-status-guarded claim should target. */
export type ClaimDecision =
  | { claimable: true; fromStatus: ImportStatus }
  | { claimable: false; reason: 'terminal' | 'lease-held' };

/**
 * Read the stamped claim instant out of the batch `summary` Json. Returns `null`
 * when absent or unparseable (legacy / pre-hardening claim → reclaim defensively).
 */
export function readClaimedAt(summary: unknown): Date | null {
  if (!summary || typeof summary !== 'object') return null;
  const raw = (summary as Record<string, unknown>).claimedAt;
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Decide whether a batch in the given status (with the given `summary`) may be
 * claimed `→ applying`, and from which status the from-status-guarded
 * `updateMany` should fire.
 *
 *  - `queued` → always claimable (the normal first delivery).
 *  - `applying` → claimable **only** when the stamped `claimedAt` is older than
 *    the lease (or absent — a legacy/pre-hardening claim). A fresh claim by a
 *    live worker is `lease-held` and the re-delivered job exits without
 *    re-admitting it.
 *  - anything else (validated / applied / failed / rolled_back …) → `terminal`.
 *
 * `now`/`staleMin` are injectable for deterministic tests.
 */
export function decideClaim(
  status: ImportStatus,
  summary: unknown,
  now: Date = new Date(),
  staleMin: number = IMPORTS_APPLY_STALE_MIN,
): ClaimDecision {
  if (status === ImportStatus.queued) {
    return { claimable: true, fromStatus: ImportStatus.queued };
  }
  if (status === ImportStatus.applying) {
    const claimedAt = readClaimedAt(summary);
    const cutoff = new Date(now.getTime() - staleMin * 60 * 1000);
    // null claimedAt → legacy/pre-hardening claim → reclaim defensively.
    if (claimedAt === null || claimedAt < cutoff) {
      return { claimable: true, fromStatus: ImportStatus.applying };
    }
    return { claimable: false, reason: 'lease-held' };
  }
  return { claimable: false, reason: 'terminal' };
}
