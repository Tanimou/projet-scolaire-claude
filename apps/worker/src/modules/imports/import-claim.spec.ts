import { ImportStatus } from '@prisma/client';

import { decideClaim, readClaimedAt } from './import-claim';

/**
 * E11 hardening (ADR-024 §4 / FR6) — the stale-lease reclaim decision for the
 * async import worker claim. The load-bearing invariant: a re-delivered job may
 * NOT double-admit an `applying` batch a still-alive worker is mid-apply on
 * (fresh `claimedAt`), but a genuinely dead worker's batch self-heals once the
 * lease (`IMPORTS_APPLY_STALE_MIN`) expires.
 */
describe('import claim lease (decideClaim)', () => {
  const STALE_MIN = 15;
  const NOW = new Date('2026-06-11T12:00:00.000Z');
  // 10 min ago — within the 15-min lease (a LIVE worker holds it).
  const FRESH = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
  // 20 min ago — past the lease (a DEAD worker's claim, reclaimable).
  const STALE = new Date(NOW.getTime() - 20 * 60 * 1000).toISOString();

  it('queued is always claimable, from queued', () => {
    const d = decideClaim(ImportStatus.queued, { claimedAt: FRESH }, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: true, fromStatus: ImportStatus.queued });
  });

  it('applying with a FRESH claim is lease-held — a re-delivery does NOT re-admit it', () => {
    const d = decideClaim(ImportStatus.applying, { claimedAt: FRESH }, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: false, reason: 'lease-held' });
  });

  it('applying with a STALE claim is reclaimable, from applying (dead-worker self-heal)', () => {
    const d = decideClaim(ImportStatus.applying, { claimedAt: STALE }, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: true, fromStatus: ImportStatus.applying });
  });

  it('applying at exactly the lease boundary is still held (strict <)', () => {
    const boundary = new Date(NOW.getTime() - STALE_MIN * 60 * 1000).toISOString();
    const d = decideClaim(ImportStatus.applying, { claimedAt: boundary }, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: false, reason: 'lease-held' });
  });

  it('applying with a MISSING claimedAt is reclaimed defensively (legacy/pre-hardening claim)', () => {
    const d = decideClaim(ImportStatus.applying, {}, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: true, fromStatus: ImportStatus.applying });
  });

  it('applying with a null summary is reclaimed defensively', () => {
    const d = decideClaim(ImportStatus.applying, null, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: true, fromStatus: ImportStatus.applying });
  });

  it('applying with an unparseable claimedAt is reclaimed defensively', () => {
    const d = decideClaim(ImportStatus.applying, { claimedAt: 'not-a-date' }, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: true, fromStatus: ImportStatus.applying });
  });

  it.each([
    ImportStatus.validated,
    ImportStatus.applied,
    ImportStatus.failed,
    ImportStatus.rolled_back,
  ])('terminal/non-claimable status %s is never claimable', (status) => {
    const d = decideClaim(status, { claimedAt: STALE }, NOW, STALE_MIN);
    expect(d).toEqual({ claimable: false, reason: 'terminal' });
  });
});

describe('readClaimedAt', () => {
  it('parses a valid ISO string', () => {
    const iso = '2026-06-11T12:00:00.000Z';
    expect(readClaimedAt({ claimedAt: iso })?.toISOString()).toBe(iso);
  });

  it('returns null for absent / non-string / unparseable / non-object', () => {
    expect(readClaimedAt({})).toBeNull();
    expect(readClaimedAt({ claimedAt: 123 })).toBeNull();
    expect(readClaimedAt({ claimedAt: 'nope' })).toBeNull();
    expect(readClaimedAt(null)).toBeNull();
    expect(readClaimedAt(undefined)).toBeNull();
    expect(readClaimedAt('string')).toBeNull();
  });
});
