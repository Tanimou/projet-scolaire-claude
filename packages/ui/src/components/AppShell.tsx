import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import type { PortalKey } from './Sidebar';

export interface AppShellProps {
  portal: PortalKey;
  /** Sidebar element (caller provides Sidebar with items prefilled & active state set) */
  sidebar: ReactNode;
  /** Topbar element (caller provides Topbar with title + actions) */
  topbar: ReactNode;
  /** Page content */
  children: ReactNode;
  /** Optional className applied to <main> for padding tweaks */
  contentClassName?: string;
  /** Optional fluid mode disables max-width on content */
  fluid?: boolean;
}

/**
 * AppShell — unified portal layout: sidebar + topbar + main scrollable region.
 *
 * Server-rendered: the sidebar and topbar accept any ReactNode so the caller
 * can plug in client components (interactivity) at will.
 */
export function AppShell({
  portal,
  sidebar,
  topbar,
  children,
  contentClassName,
  fluid,
}: AppShellProps) {
  return (
    <div
      data-portal={portal}
      className="flex h-screen w-full bg-[color:var(--surface-page)] text-slate-900"
    >
      {/* Sidebar (hidden on mobile, persistent ≥lg) */}
      <div className="hidden h-full shrink-0 lg:block">{sidebar}</div>

      <div className="flex h-full min-w-0 flex-1 flex-col">
        {topbar}
        <main
          className={cn(
            'flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8',
            // Removed max-width cap — the dashboard breathes better on wide screens
            // and matches the target-screenshot layout proportions.
            'w-full',
            contentClassName,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
