import { snapshotCoalesceKey } from '@pilotage/contracts';
import type { SnapshotRecomputeScope } from '@pilotage/contracts';

/**
 * E6-S1 — snapshot key helpers (worker side).
 *
 * The deterministic coalescing key is the SAME helper the API enqueue uses
 * (`@pilotage/contracts`), re-exported here so there is exactly ONE formula on both
 * sides of the dirty-queue — the worker recomputes the same `(tenant, reason,
 * scope)` the publish seam enqueued. No second key implementation that could drift.
 */
export { snapshotCoalesceKey };
export type { SnapshotRecomputeScope };
