import { AlertTriangle, ArrowRight, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { cn } from '../lib/cn';

export type AlertPolarity = 'warning' | 'success' | 'info' | 'danger';

const POLARITY_CLASSES: Record<AlertPolarity, { bg: string; iconBg: string; iconColor: string; cta: string }> = {
  warning: {
    bg: 'bg-amber-50 ring-amber-100',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-700',
    cta: 'text-amber-700 hover:text-amber-900',
  },
  success: {
    bg: 'bg-emerald-50 ring-emerald-100',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-700',
    cta: 'text-emerald-700 hover:text-emerald-900',
  },
  info: {
    bg: 'bg-sky-50 ring-sky-100',
    iconBg: 'bg-sky-100',
    iconColor: 'text-sky-700',
    cta: 'text-sky-700 hover:text-sky-900',
  },
  danger: {
    bg: 'bg-rose-50 ring-rose-100',
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-700',
    cta: 'text-rose-700 hover:text-rose-900',
  },
};

const POLARITY_DEFAULT_ICON: Record<AlertPolarity, ComponentType<{ className?: string }>> = {
  warning: TrendingDown,
  success: Sparkles,
  info: TrendingUp,
  danger: AlertTriangle,
};

export interface AlertCardProps {
  polarity?: AlertPolarity;
  icon?: ComponentType<{ className?: string }>;
  title: string;
  body?: ReactNode;
  actionLabel?: string;
  actionHref?: string;
  className?: string;
}

/**
 * AlertCard — image 7 "Alertes et recommandations".
 * Explainable alerts with polarity-tinted background and CTA link.
 */
export function AlertCard({
  polarity = 'warning',
  icon,
  title,
  body,
  actionLabel = 'Voir détails',
  actionHref,
  className,
}: AlertCardProps) {
  const cls = POLARITY_CLASSES[polarity];
  const Icon = icon ?? POLARITY_DEFAULT_ICON[polarity];
  return (
    <article className={cn('density-card-tight flex gap-3 rounded-xl ring-1', cls.bg, className)}>
      <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', cls.iconBg)}>
        <Icon className={cn('h-4 w-4', cls.iconColor)} />
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-bold text-slate-900">{title}</h4>
        {body && <p className="mt-1 text-[13px] leading-5 text-slate-700">{body}</p>}
        {actionHref && (
          <a
            href={actionHref}
            className={cn(
              'mt-2 inline-flex items-center gap-1 text-xs font-bold transition-colors',
              cls.cta,
            )}
          >
            {actionLabel}
            <ArrowRight className="h-3 w-3" aria-hidden />
          </a>
        )}
      </div>
    </article>
  );
}
