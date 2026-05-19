import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export type StatsTone = 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'slate' | 'teal' | 'sky';

const TONE_TEXT: Record<StatsTone, string> = {
  blue: 'text-blue-600',
  green: 'text-emerald-600',
  amber: 'text-amber-600',
  rose: 'text-rose-600',
  violet: 'text-violet-600',
  slate: 'text-slate-700',
  teal: 'text-teal-600',
  sky: 'text-sky-600',
};

export interface StatsCell {
  label: string;
  value: ReactNode;
  /** Optional sub-line under the value */
  sub?: ReactNode;
  tone?: StatsTone;
}

export interface Stats2x2GridProps {
  cells: StatsCell[];
  /** Number of columns (default 2) */
  cols?: 2 | 3 | 4;
  className?: string;
}

/**
 * Stats2x2Grid — image 6 "Statistiques de la classe".
 * 4 small KPI tiles in a grid with colored numerics.
 */
export function Stats2x2Grid({ cells, cols = 2, className }: Stats2x2GridProps) {
  return (
    <div
      className={cn(
        'grid gap-3',
        cols === 2 && 'grid-cols-2',
        cols === 3 && 'grid-cols-3',
        cols === 4 && 'grid-cols-2 sm:grid-cols-4',
        className,
      )}
    >
      {cells.map((c, i) => (
        <div key={i} className="density-card-mini rounded-xl bg-slate-50">
          <div className={cn('font-mono text-2xl font-bold tabular-nums', TONE_TEXT[c.tone ?? 'slate'])}>
            {c.value}
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {c.label}
          </div>
          {c.sub && <div className="mt-0.5 text-[11px] text-slate-500">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
