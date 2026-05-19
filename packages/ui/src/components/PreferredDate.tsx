'use client';

import { useDisplayDateFormat } from './DisplayPrefsProvider';
import { formatPreferredDate, type DisplayDateFormat } from '../lib/display-prefs';

export interface PreferredDateProps {
  value: string | Date | number | null | undefined;
  /** Override the format from context (rarely needed — prefer to follow user prefs). */
  formatOverride?: DisplayDateFormat;
  /** Optional className for inline styling. */
  className?: string;
  /** Optional fallback if value is null (default: '—'). */
  fallback?: string;
}

/**
 * Renders a date using the current user's preferred date format
 * (short / long / relative). Consumes `DisplayPrefsProvider`.
 *
 * Note: this is intentionally **purely visual** — caller still owns the
 * underlying ISO value for sorting, tooltips, etc.
 */
export function PreferredDate({ value, formatOverride, className, fallback }: PreferredDateProps) {
  const format = useDisplayDateFormat();
  const out = formatPreferredDate(value, formatOverride ?? format);
  return <span className={className}>{out === '—' && fallback ? fallback : out}</span>;
}
