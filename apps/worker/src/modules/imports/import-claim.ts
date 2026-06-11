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
 * **The claim instant is the typed `ImportBatch.claimedAt` scalar column** (E11-S5
 * promoted it out of the `summary` Json). That promotion is load-bearing: it lets
 * the processor express the stale-reclaim as a **single-winner compare-and-swap**
 * — `updateMany WHERE status='applying' AND claimedAt=<observed> SET claimedAt=now`
 * — in Prisma's typed API (a Json key cannot be predicated by `updateMany`). A
 * `null` `claimedAt` on an `applying` batch is a pre-S5 / never-stamped claim →
 * treated as stale (defensive reclaim, the snapshot `processedAt: null` precedent),
 * so a batch claimed before this change can never wedge forever.
 */

/** A `applying` batch whose claim is older than this (minutes) is reclaimable. */
export const IMPORTS_APPLY_STALE_MIN = Number(process.env.IMPORTS_APPLY_STALE_MIN ?? 15);

/**
 * The decision outcome. The `kind` tells the processor which single-winner
 * `updateMany` to fire:
 *  - `fresh`   → `WHERE status='queued'                       SET status='applying', claimedAt=now`
 *               (the status flip elects one winner; the loser matches 0 rows).
 *  - `reclaim` → `WHERE status='applying' AND claimedAt=<observedClaimedAt> SET claimedAt=now`
 *               (compare-and-swap on the observed lease instant elects one winner
 *               even though the status does not change; the loser's stale
 *               `claimedAt` no longer matches once the winner re-leases).
 */
export type ClaimDecision =
  | { claimable: true; kind: 'fresh' }
  | { claimable: true; kind: 'reclaim'; observedClaimedAt: Date | null }
  | { claimable: false; reason: 'terminal' | 'lease-held' };

/**
 * Decide whether a batch in the given status (with the given lease instant) may
 * be claimed `→ applying`.
 *
 *  - `queued` → always claimable (the normal first delivery) ⇒ `fresh`.
 *  - `applying` → claimable **only** when `claimedAt` is older than the lease
 *    (or `null` — a legacy/pre-S5 / never-stamped claim) ⇒ `reclaim` carrying the
 *    observed instant for the CAS guard. A fresh claim by a live worker is
 *    `lease-held` and the re-delivered job exits without re-admitting it.
 *  - anything else (validated / applied / failed / rolled_back …) → `terminal`.
 *
 * `now`/`staleMin` are injectable for deterministic tests.
 */
export function decideClaim(
  status: ImportStatus,
  claimedAt: Date | null,
  now: Date = new Date(),
  staleMin: number = IMPORTS_APPLY_STALE_MIN,
): ClaimDecision {
  if (status === ImportStatus.queued) {
    return { claimable: true, kind: 'fresh' };
  }
  if (status === ImportStatus.applying) {
    const cutoff = new Date(now.getTime() - staleMin * 60 * 1000);
    // null claimedAt → legacy/pre-S5 claim → reclaim defensively.
    if (claimedAt === null || claimedAt < cutoff) {
      return { claimable: true, kind: 'reclaim', observedClaimedAt: claimedAt };
    }
    return { claimable: false, reason: 'lease-held' };
  }
  return { claimable: false, reason: 'terminal' };
}
