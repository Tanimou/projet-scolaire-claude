import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface TimelineEntry {
  id: string;
  title: ReactNode;
  /** Sub-line (e.g. actor + entity) */
  sub?: ReactNode;
  /** Right-side timestamp text */
  timestamp: ReactNode;
  /** Bullet tone */
  tone?: 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'slate';
  /** Optional badge above the title */
  badge?: ReactNode;
}

export interface TimelineProps {
  entries: TimelineEntry[];
  className?: string;
}

const TONE_BULLET: Record<NonNullable<TimelineEntry['tone']>, string> = {
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  violet: 'bg-violet-500',
  slate: 'bg-slate-400',
};

/**
 * Timeline — vertical line + bullets. Used by /admin/audit (long form).
 * For dashboard activity feed prefer <ActivityTimeline>.
 */
export function Timeline({ entries, className }: TimelineProps) {
  return (
    <ol className={cn('relative ml-2 border-l-2 border-slate-200', className)}>
      {entries.map((e) => (
        <li key={e.id} className="relative pb-5 pl-5 last:pb-0">
          <span
            aria-hidden
            className={cn(
              'absolute -left-[7px] top-1 inline-block h-3 w-3 rounded-full ring-2 ring-white',
              TONE_BULLET[e.tone ?? 'blue'],
            )}
          />
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0 flex-1">
              {e.badge && <div className="mb-1">{e.badge}</div>}
              <div className="text-sm font-semibold text-slate-900">{e.title}</div>
              {e.sub && <div className="mt-0.5 text-xs text-slate-500">{e.sub}</div>}
            </div>
            <div className="shrink-0 text-[11px] text-slate-500">{e.timestamp}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
