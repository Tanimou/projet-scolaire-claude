import { Headphones } from 'lucide-react';
import type { ComponentType } from 'react';

import { cn } from '../lib/cn';

export interface HelpSidebarCardProps {
  icon?: ComponentType<{ className?: string }>;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
  className?: string;
}

/**
 * HelpSidebarCard — image 7 sidebar footer.
 * "Besoin d'aide ?" card with help icon + body + CTA.
 */
export function HelpSidebarCard({
  icon: Icon = Headphones,
  heading = "Besoin d'aide ?",
  body = "Consultez notre centre d'aide ou contactez le support.",
  ctaLabel = "Centre d'aide",
  ctaHref = '/help',
  className,
}: HelpSidebarCardProps) {
  return (
    <div
      style={{
        background: 'var(--surface-sidebar-hover, oklch(0.22 0.07 260))',
        color: 'var(--ink-on-sidebar, oklch(0.96 0.01 250))',
      }}
      className={cn('rounded-xl p-4', className)}
    >
      <div className="flex items-center gap-2 text-sm font-bold text-white">{heading}</div>
      <p
        style={{ color: 'var(--ink-on-sidebar-muted, oklch(0.70 0.02 250))' }}
        className="mt-1.5 text-[12px] leading-5"
      >
        {body}
      </p>
      <a
        href={ctaHref}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20"
      >
        <Icon className="h-4 w-4" />
        {ctaLabel}
      </a>
    </div>
  );
}
