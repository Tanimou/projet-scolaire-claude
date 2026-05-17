import { DonutChart, formatGrade } from '@pilotage/ui';

export interface StudentAverage {
  studentId: string;
  average: number | null;
}

export function DistributionPanel({
  averages,
  classAverage,
}: {
  averages: StudentAverage[];
  classAverage: number | null;
}) {
  const valid = averages.filter((a) => a.average != null) as Array<{ average: number }>;
  const total = valid.length;

  const excellent = valid.filter((a) => a.average >= 16).length;
  const satisfaisant = valid.filter((a) => a.average >= 10 && a.average < 16).length;
  const insuffisant = valid.filter((a) => a.average < 10).length;

  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const segments = [
    { label: 'Excellent (16-20)', value: excellent, color: '#10B981', hint: `${pct(excellent)}% (${excellent} élèves)` },
    { label: 'Satisfaisant (10-15)', value: satisfaisant, color: '#F59E0B', hint: `${pct(satisfaisant)}% (${satisfaisant} élèves)` },
    { label: 'Insuffisant (0-9)', value: insuffisant, color: '#F43F5E', hint: `${pct(insuffisant)}% (${insuffisant} élèves)` },
  ];

  const best = valid.length > 0 ? Math.max(...valid.map((a) => a.average)) : null;
  const worst = valid.length > 0 ? Math.min(...valid.map((a) => a.average)) : null;
  const successRate = total > 0 ? Math.round(((excellent + satisfaisant) / total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Répartition des moyennes */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <h3 className="text-sm font-bold text-slate-900">Répartition des moyennes</h3>
        {total === 0 ? (
          <p className="mt-3 text-xs text-slate-500">
            Pas encore de moyenne calculable pour cette affectation.
          </p>
        ) : (
          <div className="mt-3 flex items-start gap-4">
            <div className="shrink-0">
              <DonutChart segments={segments} height={140} legendPosition="none" />
            </div>
            <ul className="flex flex-col gap-2 text-[11px]">
              {segments.map((s) => (
                <li key={s.label} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: s.color }}
                  />
                  <div className="leading-tight">
                    <div className="font-semibold text-slate-700">{s.label}</div>
                    <div className="text-slate-500">{s.hint}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Statistiques de la classe */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <h3 className="text-sm font-bold text-slate-900">Statistiques de la classe</h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <StatCell
            label="Moyenne générale"
            value={classAverage != null ? formatGrade(classAverage, 2) : '—'}
            tone="blue"
          />
          <StatCell
            label="Meilleure moyenne"
            value={best != null ? formatGrade(best, 2) : '—'}
            tone="emerald"
          />
          <StatCell
            label="Plus faible moyenne"
            value={worst != null ? formatGrade(worst, 2) : '—'}
            tone="rose"
          />
          <StatCell
            label={'Taux de réussite (≥10/20)'}
            value={`${successRate}%`}
            tone="violet"
          />
        </div>
      </section>
    </div>
  );
}

function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'blue' | 'emerald' | 'rose' | 'violet';
}) {
  const text =
    tone === 'blue'
      ? 'text-blue-600'
      : tone === 'emerald'
        ? 'text-emerald-600'
        : tone === 'rose'
          ? 'text-rose-600'
          : 'text-violet-600';
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className={`font-mono text-2xl font-bold tabular-nums ${text}`}>{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </div>
    </div>
  );
}
