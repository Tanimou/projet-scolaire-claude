import { Star } from 'lucide-react';

import { cn } from '../lib/cn';

export interface StarRatingProps {
  /** Numeric rating 0..max */
  value: number;
  /** Maximum (default 5) */
  max?: number;
  /** Star size in pixels (icon font size) */
  size?: 'xs' | 'sm' | 'md';
  /** Optional textual label rendered under the stars */
  label?: string;
  /** Stack vertically (stars then label). Default: horizontal */
  stacked?: boolean;
  className?: string;
}

const SIZE_PX: Record<NonNullable<StarRatingProps['size']>, string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
};

/**
 * StarRating — readonly rating component used in tables (Performance académique).
 * Renders `max` stars; the first `Math.round(value)` are filled amber.
 */
export function StarRating({
  value,
  max = 5,
  size = 'sm',
  label,
  stacked,
  className,
}: StarRatingProps) {
  const v = Math.max(0, Math.min(max, Math.round(value)));
  return (
    <div
      className={cn(stacked ? 'flex flex-col items-start gap-0.5' : 'inline-flex items-center gap-2', className)}
      aria-label={`Note ${v} sur ${max}`}
      role="img"
    >
      <div className="inline-flex items-center gap-0.5">
        {Array.from({ length: max }).map((_, i) => {
          const filled = i < v;
          return (
            <Star
              key={i}
              className={cn(
                SIZE_PX[size],
                filled ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200',
              )}
              aria-hidden
            />
          );
        })}
      </div>
      {label && <span className="text-[11px] text-slate-500">{label}</span>}
    </div>
  );
}
