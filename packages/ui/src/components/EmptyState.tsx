import type { ComponentType, ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface EmptyStateProps {
  /** Lucide icon component (rendered in a tonal circle) */
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  /** CTA: primary action */
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  /** Tone for the icon background */
  tone?: 'slate' | 'blue' | 'green' | 'amber' | 'rose' | 'violet';
  /** Optional secondary content (kept below CTA) */
  children?: ReactNode;
  className?: string;
}

const TONE_BG: Record<NonNullable<EmptyStateProps['tone']>, string> = {
  slate: 'bg-slate-100 text-slate-600',
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  violet: 'bg-violet-50 text-violet-600',
};

/**
 * EmptyState — zero-data display with optional CTA.
 * Used on all list pages when no results.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'slate',
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center gap-3 rounded-2xl bg-white p-10 text-center ring-1 ring-slate-200/60',
        className,
      )}
    >
      {Icon && (
        <span
          className={cn(
            'inline-flex h-12 w-12 items-center justify-center rounded-2xl',
            TONE_BG[tone],
          )}
        >
          <Icon className="h-6 w-6" />
        </span>
      )}
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      {description && <p className="max-w-md text-sm text-slate-500">{description}</p>}
      {action &&
        (action.href ? (
          <a
            href={action.href}
            className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
          >
            {action.label}
          </a>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
          >
            {action.label}
          </button>
        ))}
      {children}
    </div>
  );
}
