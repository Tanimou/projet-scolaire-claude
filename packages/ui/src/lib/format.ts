/**
 * Formatting helpers (FR locale).
 * Used across cards/charts/tables to keep number/date rendering consistent.
 */

const FR = 'fr-FR';

/**
 * Format a grade with French locale and configurable decimals.
 *  - returns '—' for null/undefined/NaN
 *  - default 2 decimals, trailing zero kept (16,80)
 */
export function formatGrade(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString(FR, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Format a /20 grade as "16,80 / 20" — handles null gracefully. */
export function formatGradeOnTwenty(value: number | null | undefined): string {
  return `${formatGrade(value)} / 20`;
}

/** Format a integer (uses FR grouping, e.g. "2 458"). */
export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString(FR);
}

/** Format a percent (input 0-100 OR 0-1, auto-detected, defaults to 1 decimal). */
export function formatPercent(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const v = Math.abs(value) <= 1 ? value * 100 : value;
  return `${v.toLocaleString(FR, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} %`;
}

/** Format a delta value with sign and arrow (e.g. "+2,1 pts ↑"). */
export function formatDelta(value: number | null | undefined, suffix = 'pts'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '' : '';
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '';
  return `${sign}${formatGrade(value, 1)} ${suffix} ${arrow}`.trim();
}

/** Returns 'positive' | 'negative' | 'neutral' tone matching a numeric delta. */
export function deltaTone(value: number | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (value == null || Number.isNaN(value) || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

/** Short date FR (28/05/2025). */
export function formatDateShort(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(FR, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Long date FR (28 mai 2025). */
export function formatDateLong(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(FR, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Date card composition: { dayShort: 'VEN', dayNum: '24', monthShort: 'MAI' }. */
export function formatDateCard(input: string | Date | null | undefined): {
  dayShort: string;
  dayNum: string;
  monthShort: string;
  year: string;
} {
  if (!input) return { dayShort: '—', dayNum: '—', monthShort: '—', year: '' };
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return { dayShort: '—', dayNum: '—', monthShort: '—', year: '' };
  const dayShort = d
    .toLocaleDateString(FR, { weekday: 'short' })
    .toUpperCase()
    .replace('.', '');
  const monthShort = d
    .toLocaleDateString(FR, { month: 'short' })
    .toUpperCase()
    .replace('.', '');
  return {
    dayShort,
    dayNum: String(d.getDate()).padStart(2, '0'),
    monthShort,
    year: String(d.getFullYear()),
  };
}

/** Relative time ("il y a 3 heures"). */
export function formatRelativeTime(input: string | Date | null | undefined, now: Date = new Date()): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = now.getTime() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  if (sec < 60) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (hr < 24) return `il y a ${hr} heure${hr > 1 ? 's' : ''}`;
  if (day < 7) return `il y a ${day} jour${day > 1 ? 's' : ''}`;
  return formatDateShort(d);
}

/** "Dans X jours" — for future date cards. */
export function formatInDays(input: string | Date | null | undefined, now: Date = new Date()): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  const days = Math.round((d.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 0) return `Il y a ${-days} jour${-days > 1 ? 's' : ''}`;
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Demain';
  return `Dans ${days} jours`;
}
