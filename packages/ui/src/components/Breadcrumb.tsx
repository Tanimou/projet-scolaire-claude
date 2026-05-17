import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface BreadcrumbItem {
  label: ReactNode;
  href?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  /** Separator character/icon (default chevron right) */
  separator?: ReactNode;
  className?: string;
}

/**
 * Breadcrumb — `Tableau de bord > Classes > Sixième A`
 * Last item is rendered as plain text (current page); others as links.
 */
export function Breadcrumb({ items, separator, className }: BreadcrumbProps) {
  if (items.length === 0) return null;
  const sep = separator ?? <ChevronRight className="h-3.5 w-3.5 text-slate-300" aria-hidden />;
  return (
    <nav aria-label="Fil d'Ariane" className={cn('flex items-center', className)}>
      <ol className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
        {items.map((it, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="inline-flex items-center gap-1.5">
              {isLast || !it.href ? (
                <span className={cn(isLast && 'font-semibold text-slate-900')}>{it.label}</span>
              ) : (
                <a href={it.href} className="transition-colors hover:text-slate-900 hover:underline">
                  {it.label}
                </a>
              )}
              {!isLast && <span aria-hidden>{sep}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
