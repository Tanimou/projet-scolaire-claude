'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { BatchStatus } from './types';

/**
 * ImportStatusPoller — E11-S1 (the enqueue→poll substrate).
 *
 * The batch-detail page is `force-dynamic` + `cache: 'no-store'`, but a server
 * component does NOT re-fetch without a navigation. Since async apply now returns
 * immediately with the batch in `queued`, the page would otherwise freeze on
 * `queued`/`applying` until a manual reload.
 *
 * This invisible client component calls `router.refresh()` on a fixed interval
 * ONLY while the batch is non-terminal (`queued` | `applying`), and clears the
 * interval the moment a terminal status (`applied | failed | rolled_back`) is
 * reached — so there is never an infinite poll. It renders nothing.
 *
 * Mirrors the E6-S4 `FreshnessChip` `setInterval`/cleanup discipline.
 */

const POLL_MS = 2500;
const NON_TERMINAL: ReadonlySet<BatchStatus> = new Set<BatchStatus>(['queued', 'applying']);

export function ImportStatusPoller({ status }: { status: BatchStatus }) {
  const router = useRouter();
  // Surfaced for a11y so a screen reader can perceive the page is auto-updating;
  // the visible live strip carries the human-facing copy. Kept minimal here.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!NON_TERMINAL.has(status)) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [status, router]);

  return null;
}
