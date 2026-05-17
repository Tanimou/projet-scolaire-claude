import type { ComponentType, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { deltaTone, formatInt } from '../lib/format';
import { Sparkline, type SparklinePoint } from './Sparkline';

export type KpiTone = 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'teal' | 'slate' | 'sky' | 'orange';

const TONE_ICON_BG: Record<KpiTone, string> = {
  blue: 'bg-blue-100 text-blue-600',
  green: 'bg-emerald-100 text-emerald-600',
  amber: 'bg-amber-100 text-amber-600',
  rose: 'bg-rose-100 text-rose-600',
  violet: 'bg-violet-100 text-violet-600',
  teal: 'bg-teal-100 text-teal-600',
  slate: 'bg-slate-100 text-slate-600',
  sky: 'bg-sky-100 text-sky-600',
  orange: 'bg-orange-100 text-orange-600',
};

const SPARK_COLOR: Record<KpiTone, string> = {
  blue: '#2563EB',
  green: '#16A34A',
  amber: '#D97706',
  rose: '#E11D48',
  violet: '#7C3AED',
  teal: '#0D9488',
  slate: '#475569',
  sky: '#0284C7',
  orange: '#EA580C',
};

export interface KpiCardProps {
  icon?: ComponentType<{ className?: string }>;
  tone?: KpiTone;
  label: string;
  value: number | string;
  /** Delta as a number — `+4.8`. Sign/arrow auto-rendered. */
  delta?: number;
  deltaSuffix?: string;
  /** Adds free-text after the delta, e.g. "vs mois dernier" */
  deltaPeriod?: string;
  /** Sparkline points */
  trend?: SparklinePoint[];
  /** Optional click target text (rendered as link, caller wraps in <a> or <Link>) */
  href?: string;
  hrefLabel?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * KpiCard — image-prescriptive layout:
 *   ┌───────────────────────────────┐
 *   │ [icon] LABEL          number  │   ← row 1: icon+label (left) + big value (right)
 *   │ ───────sparkline curve──────  │   ← row 2: full-width sparkline
 *   │ +4,8 %  vs mois dernier       │   ← row 3: delta chip + period text
 *   └───────────────────────────────┘
 */
export function KpiCard({
  icon: Icon,
  tone = 'blue',
  label,
  value,
  delta,
  deltaSuffix = '%',
  deltaPeriod = 'vs mois dernier',
  trend,
  href,
  hrefLabel,
  children,
  className,
}: KpiCardProps) {
  const formatted = typeof value === 'number' ? formatInt(value) : value;
  const dt = deltaTone(delta);
  return (
    <article
      className={cn(
        'flex flex-col rounded-2xl bg-white p-5 ring-1 ring-slate-200/60 shadow-sm',
        className,
      )}
    >
      {/* Row 1: icon + label  /  big number */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span
              className={cn(
                'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                TONE_ICON_BG[tone],
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {label}
          </div>
        </div>
        <div className="font-mono text-3xl font-bold leading-none tabular-nums text-slate-900">
          {formatted}
        </div>
      </div>

      {/* Row 2: sparkline full-width */}
      <div className="mt-4 -mx-1">
        {trend && trend.length > 1 ? (
          <Sparkline
            data={trend}
            color={SPARK_COLOR[tone]}
            fill
            strokeWidth={2}
            width={260}
            height={40}
            className="w-full"
          />
        ) : (
          <div className="h-10" aria-hidden />
        )}
      </div>

      {/* Row 3: delta + period (or empty) */}
      <div className="mt-2 flex items-center gap-1.5 text-xs">
        {delta !== undefined ? (
          <>
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-semibold',
                dt === 'positive' && 'text-emerald-600',
                dt === 'negative' && 'text-rose-600',
                dt === 'neutral' && 'text-slate-500',
              )}
            >
              {dt === 'positive' && '↑'}
              {dt === 'negative' && '↓'}
              {delta > 0 ? '+' : ''}
              {delta}
              {deltaSuffix}
            </span>
            <span className="text-slate-500">{deltaPeriod}</span>
          </>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </div>

      {children && <div className="mt-2 text-xs text-slate-500">{children}</div>}
      {href && (
        <a
          href={href}
          className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline"
        >
          {hrefLabel ?? 'Voir →'}
        </a>
      )}
    </article>
  );
}
