import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { formatRelativeTime } from '../lib/format';

export interface ActivityEntry {
  id: string;
  title: ReactNode;
  /** Relative time will be computed from this date */
  date: string | Date;
  /** Bullet tone */
  tone?: 'blue' | 'green' | 'amber' | 'rose' | 'violet';
  /** Optional click target */
  href?: string;
}

export interface ActivityTimelineProps {
  entries: ActivityEntry[];
  className?: string;
}

const TONE_BULLET: Record<NonNullable<ActivityEntry['tone']>, string> = {
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  violet: 'bg-violet-500',
};

/**
 * ActivityTimeline — image 6 "Activité récente".
 * Compact version (no left vertical rule), each row is "bullet + title + relative date".
 */
export function ActivityTimeline({ entries, className }: ActivityTimelineProps) {
  if (entries.length === 0) {
    return (
      <p className={cn('text-sm text-slate-500', className)}>
        Aucune activité récente.
      </p>
    );
  }
  return (
    <ul className={cn('flex flex-col gap-3', className)}>
      {entries.map((e) => {
        const inner = (
          <>
            <span
              aria-hidden
              className={cn(
                'mt-1 inline-block h-2 w-2 shrink-0 rounded-full',
                TONE_BULLET[e.tone ?? 'blue'],
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-slate-700">{e.title}</div>
            </div>
            <time
              dateTime={typeof e.date === 'string' ? e.date : e.date.toISOString()}
              className="shrink-0 text-[11px] text-slate-500"
            >
              {formatRelativeTime(e.date)}
            </time>
          </>
        );
        return (
          <li key={e.id}>
            {e.href ? (
              <a
                href={e.href}
                className="-mx-2 flex items-start gap-2.5 rounded-md px-2 py-1 transition hover:bg-slate-50"
              >
                {inner}
              </a>
            ) : (
              <div className="flex items-start gap-2.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
