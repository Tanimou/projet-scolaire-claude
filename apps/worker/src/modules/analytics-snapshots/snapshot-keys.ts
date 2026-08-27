import {
  canonicalCoalesceKey,
  snapshotCoalesceKey,
  terminalCoalesceKey,
} from '@pilotage/contracts';
import type { SnapshotRecomputeScope } from '@pilotage/contracts';

/**
 * E6-S1 — snapshot key helpers (worker side).
 *
 * The deterministic coalescing key is the SAME helper the API enqueue uses
 * (`@pilotage/contracts`), re-exported here so there is exactly ONE formula on both
 * sides of the dirty-queue — the worker recomputes the same `(tenant, reason,
 * scope)` the publish seam enqueued. No second key implementation that could drift.
 *
 * PF-24 — the terminal/canonical key derivations live beside the canonical formula
 * in `@pilotage/contracts` (the drain must not re-implement either): a `done`/
 * `failed` row takes a per-row terminal key so it stops competing for the pending
 * coalescing slot, and anything going back to `pending` takes the canonical key
 * back so the API enqueue keeps folding onto it.
 */
export { canonicalCoalesceKey, snapshotCoalesceKey, terminalCoalesceKey };
export type { SnapshotRecomputeScope };
