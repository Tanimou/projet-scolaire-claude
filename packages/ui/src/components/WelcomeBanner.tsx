import type { ComponentType, ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface WelcomeBannerProps {
  /** Lucide icon in the leading glass pill. */
  icon?: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  /** Right-aligned content (e.g. today's date, a quick stat chip). */
  aside?: ReactNode;
  className?: string;
}

/**
 * WelcomeBanner — the dashboard hero strip. Portal-accent gradient with a slow
 * animated shimmer (`.animated-gradient`). Server-renderable; the gradient reads
 * from --accent-* so it paints in each portal's hue.
 */
export function WelcomeBanner({ icon: Icon, title, subtitle, aside, className }: WelcomeBannerProps) {
  return (
    <div
      className={cn(
        'animated-gradient relative overflow-hidden rounded-2xl p-5 text-white shadow-sm sm:p-6',
        className,
      )}
      style={{
        backgroundImage:
          'linear-gradient(120deg, var(--accent-700), var(--accent-500) 55%, color-mix(in oklch, var(--accent-500) 65%, white))',
      }}
    >
      {/* Decorative soft orb */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-white/10 blur-2xl"
      />
      <div className="relative flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20 backdrop-blur">
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold leading-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-sm text-white/85">{subtitle}</p>}
          </div>
        </div>
        {aside && <div className="hidden shrink-0 text-right sm:block">{aside}</div>}
      </div>
    </div>
  );
}
