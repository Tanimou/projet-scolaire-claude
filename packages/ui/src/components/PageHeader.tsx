import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';

export interface PageHeaderProps {
  /** Optional breadcrumb rendered above the title */
  breadcrumb?: BreadcrumbItem[];
  /** Big page title (h1) */
  title: ReactNode;
  /** Optional subtitle below the title (one line description) */
  subtitle?: ReactNode;
  /** Optional leading element (e.g. icon, status pill) */
  leading?: ReactNode;
  /** Right-side actions slot (buttons, dropdowns, year selector, etc.) */
  actions?: ReactNode;
  className?: string;
}

/**
 * PageHeader — image-prescriptive title block used at the top of every admin page.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ Tableau de bord › Classes                                │  breadcrumb
 *   │                                                          │
 *   │ ●  Gestion des classes              [+ Ajouter une classe]│  title + actions
 *   │    Gérez les classes, capacités, niveaux et affectations  │  subtitle
 *   └──────────────────────────────────────────────────────────┘
 */
export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  leading,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-start gap-3">
          {leading && <div className="shrink-0">{leading}</div>}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">
              {title}
            </h1>
            {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
