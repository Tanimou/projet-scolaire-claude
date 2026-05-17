import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { Sparkline, SubjectChip, subjectColor } from '@pilotage/ui';

export interface ClassReportRowProps {
  row: {
    assignmentId: string;
    classSectionName: string;
    gradeLevelName: string | null;
    subjectCode: string;
    subjectName: string;
    subjectColor: string | null;
    studentCount: number;
    average: number | null;
    publishedAssessments: number;
    perTerm: Array<{ termId: string; termName: string; average: number | null }>;
    sparkline: Array<{ x: string; y: number }>;
    passRate: number | null;
    distribution: { low: number; mid: number; high: number };
  };
  termsCount: number;
}

function gradeTone(v: number | null): string {
  if (v === null) return 'text-slate-400';
  if (v >= 14) return 'text-emerald-700';
  if (v >= 10) return 'text-amber-700';
  return 'text-rose-700';
}

function gradeBgTone(v: number | null): string {
  if (v === null) return 'bg-slate-50 text-slate-400';
  if (v >= 14) return 'bg-emerald-100 text-emerald-700';
  if (v >= 10) return 'bg-amber-100 text-amber-700';
  return 'bg-rose-100 text-rose-700';
}

function passRateTone(v: number | null): string {
  if (v === null) return 'text-slate-400';
  if (v >= 80) return 'text-emerald-700';
  if (v >= 50) return 'text-amber-700';
  return 'text-rose-700';
}

function fmt1(n: number | null | undefined, suffix = '') {
  if (n === null || n === undefined) return '—';
  return `${(Math.round(n * 10) / 10).toFixed(1)}${suffix}`;
}

/** Compute trend = last sparkline point - first sparkline point */
function computeTrend(sparkline: Array<{ y: number }>): number | null {
  if (!sparkline || sparkline.length < 2) return null;
  const first = sparkline[0]!.y;
  const last = sparkline[sparkline.length - 1]!.y;
  return Math.round((last - first) * 10) / 10;
}

export function ClassReportRow({ row, termsCount }: ClassReportRowProps) {
  const sc = subjectColor(row.subjectCode);
  const trend = computeTrend(row.sparkline);
  const TrendIcon = trend === null ? Minus : trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;
  const trendColor =
    trend === null
      ? 'text-slate-400'
      : trend > 0
        ? 'text-emerald-600'
        : trend < 0
          ? 'text-rose-600'
          : 'text-slate-400';

  // Distribution mini-bar: low/mid/high
  const total = row.distribution.low + row.distribution.mid + row.distribution.high;
  const lowPct = total === 0 ? 0 : Math.round((row.distribution.low / total) * 100);
  const midPct = total === 0 ? 0 : Math.round((row.distribution.mid / total) * 100);
  const highPct = total === 0 ? 0 : Math.max(0, 100 - lowPct - midPct);

  // Pad perTerm to match termsCount
  const perTerm: Array<{ termId?: string; termName?: string; average: number | null }> = [
    ...row.perTerm,
  ];
  while (perTerm.length < termsCount) perTerm.push({ average: null });

  return (
    <tr className="transition hover:bg-slate-50/50">
      <td className="py-3 pr-3">
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
            style={{ backgroundColor: sc.tonal, color: sc.primary }}
            aria-hidden
          >
            {row.classSectionName.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-slate-900">{row.classSectionName}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <SubjectChip subjectCode={row.subjectCode} label={row.subjectName} size="xs" />
              {row.gradeLevelName ? (
                <span className="text-[10px] text-slate-500">{row.gradeLevelName}</span>
              ) : null}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 text-center font-mono text-sm font-semibold tabular-nums text-slate-700">
        {row.studentCount}
      </td>
      <td className="px-3 text-center font-mono text-sm font-semibold tabular-nums text-slate-700">
        {row.publishedAssessments}
      </td>
      {perTerm.map((t, idx) => (
        <td key={t.termId ?? `t-${idx}`} className="px-3 text-center">
          <span
            className={`font-mono text-sm font-bold tabular-nums ${gradeTone(t.average)}`}
            title={t.termName ?? ''}
          >
            {fmt1(t.average)}
          </span>
        </td>
      ))}
      <td className="px-3 text-center">
        <span
          className={`inline-flex items-center justify-center rounded-lg px-2 py-1 font-mono text-sm font-bold tabular-nums ${gradeBgTone(row.average)}`}
        >
          {row.average === null ? '—' : row.average.toFixed(1)}
        </span>
      </td>
      <td className={`px-3 text-center font-mono text-sm font-bold tabular-nums ${passRateTone(row.passRate)}`}>
        {row.passRate === null ? '—' : `${row.passRate.toFixed(0)}%`}
      </td>
      <td className="px-3 text-center">
        {total === 0 ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <div
            className="mx-auto flex h-2 w-24 overflow-hidden rounded-full ring-1 ring-slate-200"
            title={`Faible: ${row.distribution.low} · Moyen: ${row.distribution.mid} · Bon: ${row.distribution.high}`}
            aria-label={`Distribution faible ${lowPct}%, moyen ${midPct}%, bon ${highPct}%`}
          >
            {lowPct > 0 && <span className="block bg-rose-400" style={{ width: `${lowPct}%` }} />}
            {midPct > 0 && <span className="block bg-amber-400" style={{ width: `${midPct}%` }} />}
            {highPct > 0 && (
              <span className="block bg-emerald-500" style={{ width: `${highPct}%` }} />
            )}
          </div>
        )}
      </td>
      <td className="px-3 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <Sparkline
            data={row.sparkline.map((p, i) => ({ x: i, y: p.y }))}
            width={56}
            height={20}
            color={row.subjectColor ?? sc.primary}
            ariaLabel="Tendance des évaluations"
          />
          <TrendIcon className={`h-3.5 w-3.5 shrink-0 ${trendColor}`} />
        </div>
      </td>
    </tr>
  );
}
