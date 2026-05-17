import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface TopbarProps {
  /** Big page title */
  title: string;
  /** Optional subtitle below the title */
  subtitle?: string;
  /** Left-side burger button (collapse sidebar) — pre-rendered, click handled by caller */
  burger?: ReactNode;
  /** Right side actions: YearSelector, NotificationBell, UserMenu, etc. */
  actions?: ReactNode;
  /** Adds bottom shadow on scroll (consumer toggles via sticky parent) */
  className?: string;
}

/**
 * Topbar — sticky top header inside AppShell.
 * Composes title + actions. Caller is responsible for actual click handlers
 * (burger toggle, year change, etc.).
 */
export function Topbar({ title, subtitle, burger, actions, className }: TopbarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/70 bg-white/95 px-6 backdrop-blur',
        className,
      )}
    >
      {burger && <div className="lg:hidden">{burger}</div>}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 truncate text-[13px] text-slate-500">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </header>
  );
}
