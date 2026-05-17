import { cn } from '../lib/cn';
import { formatDateCard } from '../lib/format';

export type DateCardTone =
  | 'violet'
  | 'indigo'
  | 'blue'
  | 'sky'
  | 'teal'
  | 'emerald'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'slate';

const TONE_CLASSES: Record<DateCardTone, string> = {
  violet: 'bg-violet-100 text-violet-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  blue: 'bg-blue-100 text-blue-700',
  sky: 'bg-sky-100 text-sky-700',
  teal: 'bg-teal-100 text-teal-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  orange: 'bg-orange-100 text-orange-700',
  rose: 'bg-rose-100 text-rose-700',
  slate: 'bg-slate-100 text-slate-700',
};

export interface DateCardProps {
  date: string | Date;
  tone?: DateCardTone;
  /** Optional override colors using inline style (e.g. subject hex) */
  style?: { background?: string; color?: string };
  className?: string;
  /** Compact variant: smaller, single line */
  compact?: boolean;
}

/**
 * DateCard — small calendar-card visual.
 * Shows: weekday short / day number / month short (e.g. VEN / 24 / MAI).
 */
export function DateCard({ date, tone = 'violet', style, className, compact }: DateCardProps) {
  const { dayShort, dayNum, monthShort } = formatDateCard(date);
  return (
    <div
      aria-label={typeof date === 'string' ? date : date.toISOString()}
      className={cn(
        'inline-flex shrink-0 flex-col items-center justify-center rounded-xl text-center',
        TONE_CLASSES[tone],
        compact ? 'h-12 w-12 px-1.5 py-1.5' : 'h-16 w-16 p-2',
        className,
      )}
      style={style}
    >
      <span className={cn('text-[10px] font-bold uppercase tracking-wider opacity-80', compact && 'hidden')}>
        {dayShort}
      </span>
      <span className={cn('font-mono font-bold leading-none', compact ? 'text-base' : 'text-xl')}>
        {dayNum}
      </span>
      <span
        className={cn(
          'mt-0.5 font-bold uppercase tracking-wider opacity-80',
          compact ? 'text-[9px]' : 'text-[10px]',
        )}
      >
        {monthShort}
      </span>
    </div>
  );
}
