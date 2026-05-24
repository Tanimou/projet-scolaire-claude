import type { ComponentType, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { deltaTone } from '../lib/format';
import { AnimatedNumber } from './Motion';
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

/** Gradient strip across the top of the card — the signature Orange-rdv accent. */
const TONE_BAR: Record<KpiTone, string> = {
  blue: 'from-blue-500 to-blue-600',
  green: 'from-emerald-500 to-green-600',
  amber: 'from-amber-500 to-orange-500',
  rose: 'from-rose-500 to-red-600',
  violet: 'from-violet-500 to-purple-600',
  teal: 'from-teal-500 to-cyan-600',
  slate: 'from-slate-500 to-slate-600',
  sky: 'from-sky-500 to-blue-500',
  orange: 'from-orange-500 to-amber-600',
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
 * KpiCard — image-prescriptive layout, now with the Orange-rdv polish:
 *   • gradient top accent bar (per tone)
 *   • count-up animated value (framer-motion, numeric values only)
 *   • icon in a tinted "glow" pill that scales on hover
 *   • hover lift (translate + accent shadow) via the global [data-hover] CSS
 *
 *   ┌───────────────────────────────┐
 *   │▔▔▔▔▔▔▔▔▔ gradient ▔▔▔▔▔▔▔▔▔▔▔▔│
 *   │ [icon] LABEL          number  │   ← row 1
 *   │ ───────sparkline curve──────  │   ← row 2
 *   │ +4,8 %  vs mois dernier       │   ← row 3
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
  const dt = deltaTone(delta);
  return (
    <article
      data-slot="card"
      data-hover="lift"
      className={cn(
        // `density-card` reacts to <html data-density="…"> set by
        // DisplayPrefsProvider — keeps the `p-5` look on default (cozy).
        'group density-card relative flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/60 shadow-sm',
        className,
      )}
    >
      {/* Gradient top accent bar */}
      <span
        aria-hidden
        className={cn('pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r', TONE_BAR[tone])}
      />

      {/* Row 1: icon + label  /  big number */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span
              className={cn(
                'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-black/5 shadow-sm transition-transform duration-300 group-hover:scale-110',
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
          {typeof value === 'number' ? (
            <AnimatedNumber value={value} decimals={0} />
          ) : (
            value
          )}
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
          // Uses the user's accent (default = brand colour) so the chosen
          // accent shows up on every KPI card link across the app.
          className="accent-text mt-2 inline-flex items-center gap-1 rounded text-xs font-bold hover:underline focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:accent-outline"
        >
          {hrefLabel ?? 'Voir →'}
        </a>
      )}
    </article>
  );
}
