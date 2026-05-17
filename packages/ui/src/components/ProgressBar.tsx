import { cn } from '../lib/cn';

export type ProgressTone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_BG: Record<ProgressTone, string> = {
  brand: 'bg-blue-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  info: 'bg-sky-500',
  neutral: 'bg-slate-500',
};

const TONE_TRACK: Record<ProgressTone, string> = {
  brand: 'bg-blue-100',
  success: 'bg-emerald-100',
  warning: 'bg-amber-100',
  danger: 'bg-rose-100',
  info: 'bg-sky-100',
  neutral: 'bg-slate-100',
};

export interface ProgressBarProps {
  /** Value 0-100 (or any range if max provided) */
  value: number;
  max?: number;
  tone?: ProgressTone;
  /** Override the fill color with any CSS color (hex/oklch/var) */
  color?: string;
  height?: number;
  rounded?: boolean;
  ariaLabel?: string;
  className?: string;
}

/**
 * ProgressBar — minimalist horizontal bar.
 * Used for capacity, marks, completion, etc.
 */
export function ProgressBar({
  value,
  max = 100,
  tone = 'brand',
  color,
  height = 8,
  rounded = true,
  ariaLabel,
  className,
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={ariaLabel}
      className={cn(
        'w-full overflow-hidden',
        rounded && 'rounded-full',
        !color && TONE_TRACK[tone],
        color && 'bg-slate-100',
        className,
      )}
      style={{ height }}
    >
      <div
        className={cn('h-full transition-all', rounded && 'rounded-full', !color && TONE_BG[tone])}
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}
