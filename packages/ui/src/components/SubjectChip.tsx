import { cn } from '../lib/cn';
import { subjectColor } from '../lib/subject-color';

export interface SubjectChipProps {
  /** Canonical subject code or free-form name (e.g. 'MATH', 'Mathématiques') */
  subjectCode: string;
  /** Optional display label (defaults to the subject code/name passed) */
  label?: string;
  /** Style variant — `tonal` (light bg, dark text, the default) or `solid` (filled). */
  variant?: 'tonal' | 'solid' | 'outline';
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

const SIZE: Record<NonNullable<SubjectChipProps['size']>, string> = {
  xs: 'px-1.5 py-0.5 text-[10px]',
  sm: 'px-2 py-0.5 text-[11px]',
  md: 'px-2.5 py-1 text-xs',
};

/**
 * SubjectChip — pill colorée par matière, utilisée dans la table Enseignants
 * (`Mathématiques`, `Histoire`, `Anglais`, etc.). Couleur stable depuis subject-color.ts.
 */
export function SubjectChip({
  subjectCode,
  label,
  variant = 'tonal',
  size = 'sm',
  className,
}: SubjectChipProps) {
  const color = subjectColor(subjectCode);
  const text = label ?? subjectCode;

  const baseClass = cn(
    'inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap',
    SIZE[size],
    className,
  );

  if (variant === 'solid') {
    return (
      <span className={baseClass} style={{ background: color.primary, color: '#fff' }}>
        {text}
      </span>
    );
  }
  if (variant === 'outline') {
    return (
      <span
        className={baseClass}
        style={{ borderWidth: 1, borderColor: color.primary, color: color.primary, background: 'transparent' }}
      >
        {text}
      </span>
    );
  }
  // tonal (default)
  return (
    <span
      className={baseClass}
      style={{ background: color.tonal, color: color.primary }}
    >
      {text}
    </span>
  );
}
