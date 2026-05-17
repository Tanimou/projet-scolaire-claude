import { Sparkles } from 'lucide-react';
import type { ComponentType } from 'react';

import { cn } from '../lib/cn';

export interface TipOfTheDayCardProps {
  /** Custom icon (default: Sparkles star) */
  icon?: ComponentType<{ className?: string }>;
  /** Title shown above the body (e.g. "Conseil du jour") */
  heading?: string;
  /** Long-form tip body */
  body: string;
  /** Progress count seen */
  seen?: number;
  /** Total tips available */
  total?: number;
  /** Optional CTA */
  ctaLabel?: string;
  ctaHref?: string;
  className?: string;
}

/**
 * TipOfTheDayCard — image 6 sidebar footer.
 * Sits in the dark sidebar, so it uses translucent/white tones.
 */
export function TipOfTheDayCard({
  icon: Icon = Sparkles,
  heading = 'Conseil du jour',
  body,
  seen,
  total,
  ctaLabel,
  ctaHref,
  className,
}: TipOfTheDayCardProps) {
  const pct = total && total > 0 && seen != null ? Math.min(100, (seen / total) * 100) : null;
  return (
    <div
      style={{
        background: 'var(--surface-sidebar-hover, oklch(0.22 0.07 260))',
        color: 'var(--ink-on-sidebar, oklch(0.96 0.01 250))',
      }}
      className={cn('rounded-xl p-4', className)}
    >
      <div className="flex items-start gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
        <Icon className="h-4 w-4" aria-hidden />
        {heading}
      </div>
      <p
        style={{ color: 'var(--ink-on-sidebar-muted, oklch(0.70 0.02 250))' }}
        className="mt-2 text-[13px] leading-5"
      >
        {body}
      </p>
      {pct !== null && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-amber-300 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div
            style={{ color: 'var(--ink-on-sidebar-faint, oklch(0.55 0.03 250))' }}
            className="mt-1.5 text-[10px] font-bold uppercase tracking-wider"
          >
            {seen}/{total}
          </div>
        </div>
      )}
      {ctaLabel && ctaHref && (
        <a
          href={ctaHref}
          className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20"
        >
          {ctaLabel}
        </a>
      )}
    </div>
  );
}
