import { cn } from '../lib/cn';

export interface CapacityBarProps {
  /** Current value (e.g. number of enrolled students) */
  value: number;
  /** Max value (e.g. class capacity) */
  max: number;
  /** Width of the bar in pixels (default 120) */
  width?: number;
  /** Show numeric percentage label on the right */
  showPercent?: boolean;
  /** Show raw value/max instead of percentage */
  showAbsolute?: boolean;
  /** Explicitly mark this row as "full" (also auto-detected at 100%) */
  full?: boolean;
  className?: string;
}

/**
 * CapacityBar — image-prescriptive horizontal capacity meter used in the
 * Classes table. Tonal vert <90%, ambre 90-99%, rouge à 100%.
 *
 *   ████████░░░░░  93%
 */
export function CapacityBar({
  value,
  max,
  width = 120,
  showPercent = true,
  showAbsolute,
  full,
  className,
}: CapacityBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const isFull = full ?? pct >= 100;
  const isHigh = pct >= 90 && !isFull;
  const fillCls = isFull
    ? 'bg-rose-500'
    : isHigh
      ? 'bg-amber-500'
      : 'bg-emerald-500';
  const trackCls = isFull ? 'bg-rose-100' : isHigh ? 'bg-amber-100' : 'bg-emerald-100';
  const labelCls = isFull ? 'text-rose-600' : isHigh ? 'text-amber-600' : 'text-emerald-600';

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={`Capacité ${value} sur ${max}`}
        className={cn('h-1.5 overflow-hidden rounded-full', trackCls)}
        style={{ width }}
      >
        <div
          className={cn('h-full rounded-full transition-all', fillCls)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {(showPercent || showAbsolute) && (
        <span className={cn('font-mono text-xs font-bold tabular-nums', labelCls)}>
          {showAbsolute ? `${value} / ${max}` : `${Math.round(pct)}%`}
        </span>
      )}
    </div>
  );
}
