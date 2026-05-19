'use client';

import { CalendarDays } from 'lucide-react';

import { useDisplayDateFormat } from './DisplayPrefsProvider';
import { formatPreferredDate } from '../lib/display-prefs';

/**
 * Small "today" chip rendered in the topbar.
 *
 * Threads the user's preferred date format through to a high-visibility
 * persistent surface — when a user toggles between Short / Long / Relative
 * in their settings, the change is felt immediately on every screen.
 *
 * Refreshes the displayed date on mount (sufficient for "today" — the
 * Topbar re-renders on each navigation).
 */
export function TopbarTodayChip({ className }: { className?: string }) {
  const fmt = useDisplayDateFormat();
  // Relative would always read "Aujourd'hui" → unhelpful in the topbar chip,
  // so fall back to short when the user picked relative.
  const effective = fmt === 'relative' ? 'short' : fmt;
  const label = formatPreferredDate(new Date(), effective);
  return (
    <span
      className={`hidden items-center gap-1.5 rounded-full bg-[var(--display-accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--display-accent-text)] ring-1 ring-[var(--display-accent-ring)]/30 sm:inline-flex ${className ?? ''}`}
      title="Aujourd'hui"
    >
      <CalendarDays className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
