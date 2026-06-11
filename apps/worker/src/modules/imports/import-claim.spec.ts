import { ImportStatus } from '@prisma/client';

import { decideClaim } from './import-claim';

/**
 * E11 hardening (ADR-024 §4 / FR6) — the stale-lease reclaim decision for the
 * async import worker claim. The load-bearing invariant: a re-delivered job may
 * NOT double-admit an `applying` batch a still-alive worker is mid-apply on
 * (fresh `claimedAt`), but a genuinely dead worker's batch self-heals once the
 * lease (`IMPORTS_APPLY_STALE_MIN`) expires. `decideClaim` now reads the typed
 * `ImportBatch.claimedAt` scalar (a `Date | null`) and returns the `kind` that
 * tells the processor which single-winner `updateMany` to fire.
 */
describe('import claim lease (decideClaim)', () => {
  const STALE_MIN = 15;
  const NOW = new Date('2026-06-11T12:00:00.000Z');
  // 10 min ago — within the 15-min lease (a LIVE worker holds it).
  const FRESH = new Date(NOW.getTime() - 10 * 60 * 1000);
  // 20 min ago — past the lease (a DEAD worker's claim, reclaimable).
  const STALE = new Date(NOW.getTime() - 20 * 60 * 1000);

  it('queued is always claimable as a fresh claim', () => {
    const d = decideClaim(ImportStatus.queued, FRESH, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: true, kind: 'fresh' });
  });

  it('queued is fresh even with a null claimedAt', () => {
    const d = decideClaim(ImportStatus.queued, null, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: true, kind: 'fresh' });
  });

  it('applying with a FRESH claim is lease-held — a re-delivery does NOT re-admit it', () => {
    const d = decideClaim(ImportStatus.applying, FRESH, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: false, reason: 'lease-held' });
  });

  it('applying with a STALE claim is reclaimable, carrying the observed instant for the CAS', () => {
    const d = decideClaim(ImportStatus.applying, STALE, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: true, kind: 'reclaim', observedClaimedAt: STALE });
  });

  it('applying at exactly the lease boundary is still held (strict <)', () => {
    const boundary = new Date(NOW.getTime() - STALE_MIN * 60 * 1000);
    const d = decideClaim(ImportStatus.applying, boundary, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: false, reason: 'lease-held' });
  });

  it('applying one millisecond past the boundary is reclaimable', () => {
    const justPast = new Date(NOW.getTime() - STALE_MIN * 60 * 1000 - 1);
    const d = decideClaim(ImportStatus.applying, justPast, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: true, kind: 'reclaim', observedClaimedAt: justPast });
  });

  it('applying with a NULL claimedAt is reclaimed defensively (legacy/pre-S5 claim), observed null for the CAS', () => {
    const d = decideClaim(ImportStatus.applying, null, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: true, kind: 'reclaim', observedClaimedAt: null });
  });

  it.each([
    ImportStatus.validated,
    ImportStatus.applied,
    ImportStatus.failed,
    ImportStatus.rolled_back,
  ])('terminal/non-claimable status %s is never claimable', (status) => {
    const d = decideClaim(status, STALE, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: false, reason: 'terminal' });
  });
});
