/**
 * Design tokens — Pilotage scolaire
 * Reflects docs/design-system.md and docs/design/PHILOSOPHY.md.
 * Override at runtime via branding (school_id → CSS vars on <html>).
 */

export const colors = {
  brand: {
    50: 'oklch(0.97 0.02 250)',
    100: 'oklch(0.93 0.05 250)',
    500: 'oklch(0.62 0.18 250)',
    600: 'oklch(0.55 0.20 250)',
    700: 'oklch(0.48 0.20 250)',
    900: 'oklch(0.30 0.15 250)',
  },
  ink: {
    50: 'oklch(0.98 0.005 250)',
    100: 'oklch(0.96 0.01 250)',
    200: 'oklch(0.92 0.01 250)',
    300: 'oklch(0.85 0.01 250)',
    400: 'oklch(0.70 0.02 250)',
    500: 'oklch(0.55 0.02 250)',
    700: 'oklch(0.32 0.02 250)',
    900: 'oklch(0.15 0.02 250)',
  },
  success: { 100: 'oklch(0.95 0.05 160)', 500: 'oklch(0.70 0.17 160)', 700: 'oklch(0.55 0.17 160)' },
  warning: { 100: 'oklch(0.96 0.05 75)', 500: 'oklch(0.78 0.16 75)', 700: 'oklch(0.62 0.16 75)' },
  danger: { 100: 'oklch(0.96 0.05 25)', 500: 'oklch(0.60 0.22 25)', 700: 'oklch(0.50 0.22 25)' },
  info: { 500: 'oklch(0.72 0.13 220)' },
  portal: {
    admin: 'oklch(0.62 0.18 250)',
    teacher: 'oklch(0.62 0.12 180)',
    parent: 'oklch(0.65 0.13 230)',
  },
} as const;

export const fontFamilies = {
  sans: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "Courier New", monospace',
  dyslexic: '"Atkinson Hyperlegible", Inter, system-ui, sans-serif',
} as const;

export const fontSizes = {
  caption: '0.75rem',
  bodySm: '0.875rem',
  body: '1rem',
  bodyLg: '1.125rem',
  h3: '1.25rem',
  h2: '1.5rem',
  h1: '1.875rem',
  display: '2.25rem',
} as const;

export const spacing = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  6: '1.5rem',
  8: '2rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
} as const;

export const radii = {
  none: '0',
  sm: '0.25rem',
  base: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  '2xl': '1.5rem',
  full: '9999px',
} as const;

export const shadows = {
  none: 'none',
  sm: '0 1px 2px rgba(15,23,42,0.04)',
  base: '0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.04)',
  md: '0 4px 8px -2px rgba(15,23,42,0.06), 0 10px 24px -5px rgba(15,23,42,0.08)',
  lg: '0 12px 24px -10px rgba(15,23,42,0.15)',
} as const;

export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

export type Portal = keyof typeof colors.portal;

export const tokens = { colors, fontFamilies, fontSizes, spacing, radii, shadows, breakpoints };
export default tokens;
