import { ArrowRight } from 'lucide-react';
import type { ComponentType } from 'react';

import { cn } from '../lib/cn';

export interface QuickAction {
  id: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  onClick?: () => void;
  /** Optional icon tone */
  tone?: 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'teal' | 'sky' | 'slate';
  /** Optional sub-line */
  sub?: string;
}

const TONE: Record<NonNullable<QuickAction['tone']>, string> = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  violet: 'bg-violet-50 text-violet-600',
  teal: 'bg-teal-50 text-teal-600',
  sky: 'bg-sky-50 text-sky-600',
  slate: 'bg-slate-100 text-slate-600',
};

export interface QuickActionsListProps {
  actions: QuickAction[];
  seeAllHref?: string;
  seeAllLabel?: string;
  className?: string;
}

/**
 * QuickActionsList — image 6 "Outils rapides".
 * Vertical list of icon + label rows.
 */
export function QuickActionsList({
  actions,
  seeAllHref,
  seeAllLabel = 'Voir tous les outils',
  className,
}: QuickActionsListProps) {
  return (
    <div className={cn('flex flex-col', className)}>
      <ul className="flex flex-col divide-y divide-slate-100">
        {actions.map((a) => {
          const Icon = a.icon;
          const inner = (
            <>
              <span className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TONE[a.tone ?? 'blue'])}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-700">{a.label}</div>
                {a.sub && <div className="truncate text-[11px] text-slate-500">{a.sub}</div>}
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
            </>
          );
          return (
            <li key={a.id}>
              {a.href ? (
                <a
                  href={a.href}
                  className="flex items-center gap-3 rounded-lg px-1 py-2.5 transition hover:text-slate-900 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:accent-outline"
                >
                  {inner}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={a.onClick}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left transition hover:text-slate-900 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:accent-outline"
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {seeAllHref && (
        <a
          href={seeAllHref}
          className="accent-text mt-3 inline-flex items-center gap-1 rounded text-xs font-bold hover:underline focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:accent-outline"
        >
          {seeAllLabel} →
        </a>
      )}
    </div>
  );
}
