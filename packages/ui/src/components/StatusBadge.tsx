import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

export type StatusTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'sky'
  | 'teal';

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-rose-100 text-rose-700',
  info: 'bg-blue-100 text-blue-700',
  neutral: 'bg-slate-100 text-slate-700',
  violet: 'bg-violet-100 text-violet-700',
  amber: 'bg-amber-100 text-amber-700',
  rose: 'bg-rose-100 text-rose-700',
  sky: 'bg-sky-100 text-sky-700',
  teal: 'bg-teal-100 text-teal-700',
};

/**
 * Maps a domain status string to a default visual tone.
 * Consumers can still override via `tone` prop.
 */
export function defaultToneForStatus(status: string | undefined | null): StatusTone {
  const s = (status ?? '').toLowerCase();
  if (['active', 'published', 'approved', 'enrolled', 'resolved', 'present', 'graduated'].includes(s))
    return 'success';
  if (['pending', 'awaiting', 'draft', 'late'].includes(s)) return 'warning';
  // "to_verify" deserves its own tone — sky (blue) — to distinguish it visually
  // from regular pending requests on the admin dashboard.
  if (['to_verify', 'reviewing'].includes(s)) return 'sky';
  if (['suspended', 'rejected', 'overcapacity', 'absent', 'withdrawn', 'failed'].includes(s)) return 'danger';
  if (['archived', 'inactive', 'transferred', 'dismissed'].includes(s)) return 'neutral';
  if (['revised'].includes(s)) return 'info';
  return 'neutral';
}

/**
 * Maps technical status to a human-readable French label.
 * Caller can override by passing `label` prop instead.
 */
export function defaultLabelForStatus(status: string | undefined | null): string {
  const map: Record<string, string> = {
    active: 'Actif',
    inactive: 'Inactif',
    pending: 'En attente',
    to_verify: 'À vérifier',
    approved: 'Approuvé',
    rejected: 'Rejeté',
    draft: 'Brouillon',
    published: 'Publié',
    revised: 'Révisé',
    resolved: 'Résolu',
    archived: 'Archivé',
    graduated: 'Diplômé',
    transferred: 'Transféré',
    withdrawn: 'Retiré',
    suspended: 'Suspendu',
    present: 'Présent',
    absent: 'Absent',
    late: 'Retard',
    excused: 'Excusé',
    overcapacity: 'En surcharge',
    open: 'Ouvert',
    acknowledged: 'Pris en compte',
    dismissed: 'Ignoré',
  };
  return map[(status ?? '').toLowerCase()] ?? status ?? '—';
}

export interface StatusBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Domain status string (e.g. 'active', 'pending') OR free-form label */
  status?: string | null;
  /** Override the auto-resolved label */
  label?: string;
  /** Override the auto-resolved tone */
  tone?: StatusTone;
  /** Optional leading icon */
  icon?: ReactNode;
  /** Adds a colored dot before the label */
  withDot?: boolean;
  /** Reduce padding for inline use in tables */
  size?: 'sm' | 'md';
}

export function StatusBadge({
  status,
  label,
  tone,
  icon,
  withDot,
  size = 'md',
  className,
  ...rest
}: StatusBadgeProps) {
  const finalTone = tone ?? defaultToneForStatus(status);
  const finalLabel = label ?? defaultLabelForStatus(status);
  return (
    <span
      {...rest}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        TONE_CLASSES[finalTone],
        className,
      )}
    >
      {withDot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {icon}
      {finalLabel}
    </span>
  );
}
