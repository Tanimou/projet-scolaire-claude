import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Avatar, type AvatarProps } from './Avatar';
import { PreferredDate } from './PreferredDate';

export interface CommentItem {
  id: string;
  author: Pick<AvatarProps, 'src' | 'firstName' | 'lastName'>;
  /** Role/subject sub-line (e.g. 'Professeur de Mathématiques') */
  role?: string;
  body: string;
  date: string | Date;
  /** Optional CTA per comment */
  href?: string;
}

export interface CommentsFeedProps {
  items: CommentItem[];
  /** Empty state */
  emptyState?: ReactNode;
  /** Maximum body lines before clamping */
  clampLines?: 2 | 3 | 4;
  className?: string;
}

/**
 * CommentsFeed — image 7 "Commentaires des enseignants".
 * Vertical feed of teacher comments with avatar + role + clamped body + date.
 */
export function CommentsFeed({ items, emptyState, clampLines = 3, className }: CommentsFeedProps) {
  if (items.length === 0) {
    return <div className={cn('rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500', className)}>{emptyState ?? 'Aucun commentaire pour le moment.'}</div>;
  }
  return (
    <ul className={cn('flex flex-col gap-4', className)}>
      {items.map((c) => (
        <li key={c.id} className="density-row flex gap-3">
          <Avatar
            src={c.author.src}
            firstName={c.author.firstName}
            lastName={c.author.lastName}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-900">
                  {[c.author.firstName, c.author.lastName].filter(Boolean).join(' ')}
                </div>
                {c.role && <div className="truncate text-[11px] text-slate-500">{c.role}</div>}
              </div>
              <time
                dateTime={typeof c.date === 'string' ? c.date : c.date.toISOString()}
                className="shrink-0 text-[11px] text-slate-500"
              >
                <PreferredDate value={c.date} />
              </time>
            </div>
            <p
              className={cn(
                'mt-1.5 text-[13px] leading-5 text-slate-700',
                clampLines === 2 && 'line-clamp-2',
                clampLines === 3 && 'line-clamp-3',
                clampLines === 4 && 'line-clamp-4',
              )}
            >
              {c.body}
            </p>
            {c.href && (
              <a
                href={c.href}
                className="accent-text mt-1 inline-flex items-center gap-1 rounded text-xs font-bold hover:underline focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:accent-outline"
              >
                Lire la suite →
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
