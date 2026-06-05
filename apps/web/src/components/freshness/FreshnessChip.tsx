'use client';

import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge, cn, formatRelativeTime } from '@pilotage/ui';

/**
 * FreshnessChip — E6-S4 (the visionary trust signal).
 *
 * A calm, app-level status pill that renders the additive `freshness` envelope
 * already on the wire (S2 on the parent dashboard, S3 on teacher-reports +
 * the admin drill-down). Three states, derived PURELY from the field — no fetch,
 * never a loading gate:
 *
 *  - **Recomputing** (`recomputing === true`): neutral Badge + spinning RefreshCw +
 *    "Recalcul en cours…". Checked FIRST (a snapshot may exist while a newer grade
 *    is folded in).
 *  - **Fresh** (`source === 'snapshot' && !recomputing`): success Badge + CheckCircle2 +
 *    "À jour il y a {rel}" (+ optional " · {n} notes").
 *  - **Neutral / live** (`source === 'live' && !recomputing`): quiet neutral Badge +
 *    CheckCircle2 + "À jour".
 *  - **(omit)**: `!freshness` → renders `null` (degrades to no chip on older payloads /
 *    un-rewired surfaces).
 *
 * The ONLY client interactivity is a ~30 s `setInterval` that bumps `now` so the
 * relative-time label rolls forward ("il y a 12 s" → "il y a 1 min") without a
 * refetch — this is why the chip is `'use client'`; the dashboards stay server
 * components. The relative-time suffix is `aria-hidden` so the polite live region
 * announces ONLY the recomputing↔fresh state transition, never the 30 s tick.
 *
 * App-level (not `packages/ui`): a thin composition over the existing `Badge` +
 * `formatRelativeTime`. Reuse-first; no DS Guardian promotion this slice.
 */

const TICK_MS = 30_000;

export interface FreshnessChipProps {
  freshness?: {
    source: 'snapshot' | 'live';
    computedAt: string;
    recomputing: boolean;
    gradeCount?: number;
  } | null;
  className?: string;
}

/**
 * Sub-minute relative label — the ≤5-line seconds shim. `formatRelativeTime`
 * returns "à l'instant" below 60 s; here we keep the intent's "il y a {sec} s"
 * for the sub-minute window and defer to the shared formatter from 60 s up
 * (one formatter, one shim — `packages/ui` is NOT modified). A non-positive
 * diff (clock skew / a future `computedAt`) clamps to "à l'instant".
 */
function relativeLabel(computedAt: string, now: Date): string {
  const then = new Date(computedAt);
  if (Number.isNaN(then.getTime())) return '';
  const sec = Math.round((now.getTime() - then.getTime()) / 1000);
  if (sec < 0) return "à l'instant";
  if (sec < 60) return `il y a ${sec} s`;
  return formatRelativeTime(then, now);
}

export function FreshnessChip({ freshness, className }: FreshnessChipProps) {
  // Lazy init so the first paint already carries the relative label — the suffix
  // is rendered from the very first render (server + client) so the pill never
  // widens on hydration (AC-S4-4 "no layout shift"). The server vs first-client
  // `now` can differ by a tick, but the suffix is purely decorative + aria-hidden,
  // so `suppressHydrationWarning` on its span absorbs that benign text mismatch.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Degrade to no chip — covers older payloads / un-rewired surfaces.
  if (!freshness || !freshness.computedAt) return null;

  const recomputing = freshness.recomputing === true;
  const isSnapshotFresh = freshness.source === 'snapshot' && !recomputing;

  // The state word lives in the accessible name (announced on transition); the
  // relative-time suffix is aria-hidden so the 30 s tick never re-announces.
  let stateLabel: string;
  let relSuffix: string | null = null;
  let icon: typeof CheckCircle2;
  let variant: 'success' | 'neutral';
  let iconClassName = '';

  if (recomputing) {
    stateLabel = 'Recalcul en cours…';
    icon = RefreshCw;
    variant = 'neutral';
    iconClassName = 'animate-spin motion-reduce:animate-none';
  } else if (isSnapshotFresh) {
    stateLabel = 'À jour';
    icon = CheckCircle2;
    variant = 'success';
    // Rendered from first paint (not gated on mount) so the suffix reserves its
    // space immediately — the ~30 s tick only rolls the label forward in place.
    const rel = relativeLabel(freshness.computedAt, now);
    const count =
      freshness.gradeCount && freshness.gradeCount > 0
        ? ` · ${freshness.gradeCount} note${freshness.gradeCount > 1 ? 's' : ''}`
        : '';
    relSuffix = rel ? ` ${rel}${count}` : count || null;
  } else {
    // source === 'live' && !recomputing → quiet, reassuring neutral chip.
    stateLabel = 'À jour';
    icon = CheckCircle2;
    variant = 'neutral';
  }

  const Icon = icon;

  return (
    <Badge
      role="status"
      aria-live="polite"
      aria-label={stateLabel}
      variant={variant}
      className={cn('max-w-full whitespace-nowrap', className)}
    >
      <Icon aria-hidden className={cn('h-3.5 w-3.5 shrink-0', iconClassName)} />
      <span className="truncate">
        {stateLabel}
        {relSuffix ? (
          <span aria-hidden suppressHydrationWarning>
            {relSuffix}
          </span>
        ) : null}
      </span>
    </Badge>
  );
}
