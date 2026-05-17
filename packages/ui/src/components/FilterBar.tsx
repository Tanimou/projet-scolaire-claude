import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface FilterBarProps {
  /** Left-side primary slot (typically the search input — flex-1 grow) */
  search?: ReactNode;
  /** Secondary inline filter slots (selects, chips, etc.) */
  filters?: ReactNode;
  /** Right-side primary action (typically the "+ Ajouter…" button) */
  primaryAction?: ReactNode;
  /** Apply white card styling (default true) */
  card?: boolean;
  className?: string;
}

/**
 * FilterBar — image-prescriptive filter strip used above data tables.
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ 🔍 [Rechercher…]    [Niveau ▾]  [Classe ▾]  [Statut ▾]  [+ Ajouter] │
 *   └────────────────────────────────────────────────────────────────┘
 */
export function FilterBar({ search, filters, primaryAction, card = true, className }: FilterBarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3',
        card && 'rounded-2xl bg-white p-3 ring-1 ring-slate-200/60 shadow-sm',
        className,
      )}
    >
      {search && <div className="min-w-[240px] flex-1">{search}</div>}
      {filters && (
        <div className="flex flex-wrap items-center gap-2">
          {filters}
        </div>
      )}
      {primaryAction && <div className="ml-auto flex shrink-0 items-center gap-2">{primaryAction}</div>}
    </div>
  );
}
