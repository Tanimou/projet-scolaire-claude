import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface SectionHeaderProps {
  title: ReactNode;
  /** Optional subtitle (right of title or below depending on layout) */
  subtitle?: ReactNode;
  /** Optional leading icon */
  icon?: ReactNode;
  /** Right-side action: link with arrow */
  actionLabel?: string;
  actionHref?: string;
  /** Or right-side custom element */
  rightSlot?: ReactNode;
  /** Apply smaller spacing */
  compact?: boolean;
  className?: string;
}

/**
 * SectionHeader — title + optional CTA used between cards on a page.
 * Encapsulates the "Voir tous →" pattern used across all dashboards.
 */
export function SectionHeader({
  title,
  subtitle,
  icon,
  actionLabel,
  actionHref,
  rightSlot,
  compact,
  className,
}: SectionHeaderProps) {
  return (
    <header
      className={cn(
        'flex items-end justify-between gap-3',
        compact ? 'mb-2' : 'mb-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2
          className={cn(
            'flex items-center gap-2 truncate font-bold text-slate-900',
            compact ? 'text-sm' : 'text-base',
          )}
        >
          {icon}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
      </div>
      {rightSlot ?? (
        actionHref &&
          actionLabel && (
            <a
              href={actionHref}
              className="accent-text inline-flex items-center gap-1 whitespace-nowrap text-xs font-bold hover:underline"
            >
              {actionLabel}
              <ArrowRight className="h-3 w-3" aria-hidden />
            </a>
          )
      )}
    </header>
  );
}
