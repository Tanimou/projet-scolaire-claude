import { Activity, Minus, PieChart, TrendingDown, TrendingUp } from 'lucide-react';

import {
  DonutChart,
  LineChart,
  SectionHeader,
  formatGrade,
  gradeVerdict,
} from '@pilotage/ui';

import type { GradesAnalytics, RegularityTone } from './analytics';

const LINE_SERIES = [{ key: 'avg', label: 'Moyenne /20', color: '#2563EB' }];

/** Chip tones for the regularity reading, keyed by spread band. */
const REGULARITY_TONE: Record<RegularityTone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const DIST_META = [
  { key: 'excellent', label: 'Excellent (≥ 16)', color: '#10B981' },
  { key: 'satisfaisant', label: 'Satisfaisant (10–15)', color: '#F59E0B' },
  { key: 'insuffisant', label: 'Insuffisant (< 10)', color: '#F43F5E' },
  { key: 'absent', label: 'Absences', color: '#94A3B8' },
] as const;

function TrendChip({ delta }: { delta: number | null }) {
  if (delta == null) return null;
  // Compare on the same value we display (rounded to 1 decimal) so the icon and
  // tone never contradict the number — neutral exactly when it reads « 0.0 pts ».
  const rounded = Math.round(delta * 10) / 10;
  const up = rounded > 0;
  const down = rounded < 0;
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  const tone = up
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : down
      ? 'bg-rose-50 text-rose-700 ring-rose-200'
      : 'bg-slate-100 text-slate-600 ring-slate-200';
  const sign = up ? '+' : '';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${tone}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {sign}
      {formatGrade(rounded, 1)} pts
    </span>
  );
}

/**
 * "Vue d'ensemble" panel for the parent grades page: a monthly average trend
 * line plus a performance distribution donut. Derived from the child's full
 * grade set (independent of the active filters) so it stays a stable overview.
 */
export function GradesOverview({ analytics }: { analytics: GradesAnalytics }) {
  const { monthly, distribution, gradedCount, trendDelta, consistency } = analytics;
  const lastAvg = monthly.length > 0 ? monthly[monthly.length - 1]!.avg : null;

  const segments = DIST_META.map((d) => ({
    label: d.label,
    value: distribution[d.key as keyof typeof distribution],
    color: d.color,
  })).filter((s) => s.value > 0);

  return (
    <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Monthly trend */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <div className="flex items-start justify-between gap-3">
          <SectionHeader
            title="Évolution mensuelle"
            subtitle="Moyenne des notes publiées, mois par mois"
            compact
          />
          <TrendChip delta={trendDelta} />
        </div>
        {gradedCount === 0 ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <PieChart className="h-4 w-4 text-slate-400" aria-hidden />
            Aucune note chiffrée pour le moment.
          </div>
        ) : monthly.length < 2 ? (
          <p className="mt-4 text-sm text-slate-500">
            Pas encore assez de mois notés pour tracer une tendance. La courbe
            apparaîtra dès le deuxième mois avec des notes.
          </p>
        ) : (
          <div className="mt-2">
            <LineChart data={monthly} xKey="label" series={LINE_SERIES} height={220} />
            {lastAvg != null && (
              <p className="mt-1 text-center text-[11px] text-slate-500">
                Dernier mois : <span className="font-bold text-slate-700">{formatGrade(lastAvg, 1)} / 20</span>{' '}
                · {gradeVerdict(lastAvg)}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Distribution */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <SectionHeader
          title="Répartition des notes"
          subtitle="Niveau atteint sur l'ensemble des évaluations"
          compact
        />
        {gradedCount === 0 ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <PieChart className="h-4 w-4 text-slate-400" aria-hidden />
            Aucune note chiffrée pour le moment.
          </div>
        ) : (
          <div className="mt-2">
            <DonutChart
              segments={segments}
              centerLabel={String(gradedCount)}
              centerSubLabel={gradedCount > 1 ? 'notes' : 'note'}
              legendPosition="right"
              height={180}
            />
            {consistency && (
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                <span className="font-bold uppercase tracking-wider text-slate-400">
                  Régularité
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ring-1 ${REGULARITY_TONE[consistency.tone]}`}
                  title={`Écart-type ${formatGrade(consistency.stdDev, 1)} pts — ${consistency.hint}`}
                >
                  <Activity className="h-3 w-3" aria-hidden />
                  {consistency.label}
                </span>
                <span>
                  écart-type{' '}
                  <span className="font-bold text-slate-700">
                    {formatGrade(consistency.stdDev, 1)} pts
                  </span>
                </span>
                <span className="text-slate-400">· {consistency.hint}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
