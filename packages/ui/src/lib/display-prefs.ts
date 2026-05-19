/**
 * Display preferences — pure data + format helpers.
 *
 * These are consumed by:
 *   - `<DisplayPrefsProvider>` (client, applies CSS vars + data-density to <html>)
 *   - `<PreferredDate>` / `<PreferredGrade>` (client, format using context)
 *   - The settings panel (renders the live preview)
 *
 * Kept dependency-free so server components can import the types and helpers too.
 */

export type DisplayDensity = 'compact' | 'cozy' | 'spacious';
export type DisplayAccent = 'default' | 'blue' | 'violet' | 'emerald' | 'rose' | 'amber';
export type DisplayDateFormat = 'short' | 'long' | 'relative';
export type DisplayGradeFormat = 'twenty' | 'percent' | 'letter';

export interface DisplayPreferences {
  density: DisplayDensity;
  accent: DisplayAccent;
  dateFormat: DisplayDateFormat;
  gradeFormat: DisplayGradeFormat;
}

export const DISPLAY_PREFS_DEFAULTS: DisplayPreferences = {
  density: 'cozy',
  accent: 'default',
  dateFormat: 'short',
  gradeFormat: 'twenty',
};

// -----------------------------------------------------------------------------
// Accent tokens — hex values applied as CSS variables so any component can
// reference them via `bg-[var(--display-accent-soft)]` / `text-[var(--display-accent-text)]`.
// -----------------------------------------------------------------------------

export interface AccentTokens {
  /** Solid (chip background, focused outlines). */
  solid: string;
  /** Soft tinted background (badges, panels). */
  soft: string;
  /** Text on soft background. */
  text: string;
  /** Ring colour for focus rings / borders. */
  ring: string;
}

export const ACCENT_TOKEN_MAP: Record<DisplayAccent, AccentTokens> = {
  // The default accent inherits the branding token (set per-school via
  // `--brand-primary`) so when a school customises its brand colour, the
  // "Marque" accent follows automatically.
  default: { solid: 'var(--brand-primary, #2563EB)', soft: '#EFF6FF', text: 'var(--brand-primary, #2563EB)', ring: 'var(--brand-primary, #2563EB)' },
  blue: { solid: '#2563EB', soft: '#EFF6FF', text: '#1D4ED8', ring: '#BFDBFE' },
  violet: { solid: '#7C3AED', soft: '#F5F3FF', text: '#6D28D9', ring: '#DDD6FE' },
  emerald: { solid: '#059669', soft: '#ECFDF5', text: '#047857', ring: '#A7F3D0' },
  rose: { solid: '#E11D48', soft: '#FFF1F2', text: '#BE123C', ring: '#FECDD3' },
  amber: { solid: '#D97706', soft: '#FFFBEB', text: '#B45309', ring: '#FDE68A' },
};

// -----------------------------------------------------------------------------
// Date format
// -----------------------------------------------------------------------------

const FR = 'fr-FR';

function toDate(input: string | Date | number | null | undefined): Date | null {
  if (input === null || input === undefined) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString(FR, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtLong(d: Date): string {
  return d.toLocaleDateString(FR, { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtRelative(d: Date, now: Date): string {
  const diffMs = now.getTime() - d.getTime();
  const futureMs = -diffMs;
  if (futureMs > 24 * 60 * 60 * 1000) {
    const days = Math.round(futureMs / (24 * 60 * 60 * 1000));
    if (days === 1) return 'Demain';
    if (days < 7) return `Dans ${days} jours`;
    return fmtShort(d);
  }
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days < 7) return `il y a ${days} jours`;
  if (days < 30) return `il y a ${Math.round(days / 7)} sem.`;
  return fmtShort(d);
}

/**
 * Format a date according to the user's display preference.
 * Falls back to '—' for null / invalid input so callers don't need to guard.
 */
export function formatPreferredDate(
  input: string | Date | number | null | undefined,
  format: DisplayDateFormat,
  now: Date = new Date(),
): string {
  const d = toDate(input);
  if (!d) return '—';
  switch (format) {
    case 'long':
      return fmtLong(d);
    case 'relative':
      return fmtRelative(d, now);
    case 'short':
    default:
      return fmtShort(d);
  }
}

// -----------------------------------------------------------------------------
// Grade format
// -----------------------------------------------------------------------------

function letterFromGrade(g: number): 'A' | 'B' | 'C' | 'D' | 'E' {
  if (g >= 16) return 'A';
  if (g >= 14) return 'B';
  if (g >= 12) return 'C';
  if (g >= 10) return 'D';
  return 'E';
}

export interface FormatPreferredGradeOptions {
  /** Maximum scale (default 20). */
  max?: number;
  /** Decimals for /20 format (default: auto — 0 if integer, otherwise 1). */
  fractionDigits?: number;
  /** Whether to append "/ 20" for the twenty format (default true). */
  withScale?: boolean;
}

/**
 * Format a 0-20 grade according to the user's display preference.
 * Returns '—' for null / NaN.
 */
export function formatPreferredGrade(
  value: number | null | undefined,
  format: DisplayGradeFormat,
  opts: FormatPreferredGradeOptions = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const { max = 20, withScale = true } = opts;
  switch (format) {
    case 'percent': {
      const pct = (value / max) * 100;
      return `${pct.toLocaleString(FR, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
    }
    case 'letter':
      return letterFromGrade(value);
    case 'twenty':
    default: {
      const fd =
        opts.fractionDigits ?? (Number.isInteger(value) ? 0 : 1);
      const formatted = value.toLocaleString(FR, {
        minimumFractionDigits: fd,
        maximumFractionDigits: fd,
      });
      return withScale ? `${formatted} / ${max}` : formatted;
    }
  }
}
