/**
 * Grade bucket helper — maps a numeric grade to a visual tone bucket.
 * Used by GradePill, EditableGradeTable, DonutWithLegendSide, etc.
 */

export type GradeBucket = 'excellent' | 'satisfaisant' | 'insuffisant' | 'empty';

export interface GradeBucketInfo {
  bucket: GradeBucket;
  label: string;
  /** Tailwind utility classes for bg + text */
  className: string;
  /** Shortest possible aria label */
  ariaLabel: string;
}

/** Default scale assumes max=20. For other scales, pass max explicitly. */
export function gradeBucket(value: number | null | undefined, max = 20): GradeBucketInfo {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return {
      bucket: 'empty',
      label: '—',
      className: 'bg-slate-100 text-slate-400',
      ariaLabel: 'Note non saisie',
    };
  }
  // Normalize to /20 equivalent for bucket comparison
  const onTwenty = (value / max) * 20;
  if (onTwenty >= 16)
    return {
      bucket: 'excellent',
      label: 'Excellent',
      className: 'bg-emerald-100 text-emerald-700',
      ariaLabel: 'Note excellente',
    };
  if (onTwenty >= 10)
    return {
      bucket: 'satisfaisant',
      label: 'Satisfaisant',
      className: 'bg-amber-100 text-amber-700',
      ariaLabel: 'Note satisfaisante',
    };
  return {
    bucket: 'insuffisant',
    label: 'Insuffisant',
    className: 'bg-rose-100 text-rose-700',
    ariaLabel: 'Note insuffisante',
  };
}

/** Variant used on /20-only score badges where we want a more verbal label. */
export function gradeVerdict(avg: number | null | undefined): string {
  if (avg == null) return '—';
  if (avg >= 16) return 'Très bien';
  if (avg >= 14) return 'Bien';
  if (avg >= 12) return 'Assez bien';
  if (avg >= 10) return 'Passable';
  if (avg >= 8) return 'À améliorer';
  return 'Insuffisant';
}
