import {
  Award,
  GaugeCircle,
  History,
  LineChart as LineChartIcon,
  Lightbulb,
  TrendingDown,
  TrendingUp,
  UserRound,
  Users,
} from 'lucide-react';

import {
  EmptyState,
  LineChart,
  PreferredDate,
  ProgressBar,
  SectionHeader,
  StatusBadge,
  SubjectPerfCard,
  formatGrade,
  formatPercent,
  formatSignedDelta,
  trendOfDelta,
  type LineSeries,
  type SubjectMetric,
} from '@pilotage/ui';

export interface StudentAcademicSnapshot {
  globalPerformance: {
    studentAverage: number | null;
    classAverage: number | null;
    progression: number | null;
    attendanceRate: number | null;
    percentageOnTwenty: number | null;
  };
  subjectPerf: Array<{
    subjectId: string;
    subjectCode: string;
    subjectName: string;
    subjectColor: string | null;
    coefficient: number;
    studentAverage: number | null;
    classAverage: number | null;
    studentRank: number | null;
    classSize: number;
    trend: number | null;
    badge: string | null;
  }>;
  termEvolution: Array<{ label: string; student: number | null; class: number | null }>;
  /** Professeur en charge de chaque matière suivie. */
  subjectTeachers: Array<{
    subjectId: string;
    subjectCode: string;
    subjectName: string;
    subjectColor: string | null;
    teacherId: string | null;
    teacherName: string | null;
  }>;
  /** Comparaison de la moyenne générale avec l'année précédente. */
  previousYearComparison: {
    previousYearId: string;
    previousYearName: string;
    previousAverage: number | null;
    currentAverage: number | null;
    delta: number | null;
    trend: 'up' | 'down' | 'stable';
  } | null;
  /** Synthèse de progression annuelle (meilleure/pire matière + reco). */
  annualProgression: {
    mostImproved: AnnualSubjectDelta | null;
    mostDeclined: AnnualSubjectDelta | null;
    recommendations: string[];
  };
  recentGrades: Array<{
    id: string;
    date: string;
    subjectName: string;
    subjectColor: string | null;
    title: string;
    kind: string;
    value: number | null;
    max: number;
    classAverage: number | null;
    coefficient: number;
    comment: string | null;
  }>;
  rank: number | null;
  classSize: number;
}

export interface AnnualSubjectDelta {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  from: number;
  to: number;
  delta: number;
}

const KIND_LABEL: Record<string, string> = {
  written_test: 'Devoir',
  oral: 'Oral',
  homework: 'Maison',
  project: 'Projet',
  participation: 'Participation',
  practical: 'TP',
  other: 'Autre',
};

export function StudentAcademicTab({
  academic,
  firstName,
}: {
  academic: StudentAcademicSnapshot | null;
  firstName: string;
}) {
  const hasData =
    academic != null &&
    (academic.subjectPerf.length > 0 || academic.recentGrades.length > 0);

  if (!hasData) {
    return (
      <EmptyState
        icon={GaugeCircle}
        title="Aucune donnée académique pour l'instant"
        description="Cet élève n'a pas encore de notes publiées sur l'année scolaire active. Les moyennes, le classement et la présence apparaîtront ici dès la première évaluation publiée."
        tone="slate"
      />
    );
  }

  const perf = academic.globalPerformance;
  const progression = perf.progression;
  const lineSeries: LineSeries[] = [
    { key: 'student', label: `Moyenne de ${firstName}`, color: '#2563EB' },
    { key: 'class', label: 'Moyenne de la classe', color: '#CBD5E1', dashed: true },
  ];
  const hasEvolution = academic.termEvolution.filter((t) => t.student != null).length >= 2;

  return (
    <div className="space-y-8">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile
          icon={<GaugeCircle className="h-4 w-4" />}
          label="Moyenne générale"
          value={perf.studentAverage != null ? `${formatGrade(perf.studentAverage, 1)}` : '—'}
          unit={perf.studentAverage != null ? '/ 20' : undefined}
          accent="blue"
        />
        <KpiTile
          icon={<Users className="h-4 w-4" />}
          label="Moyenne classe"
          value={perf.classAverage != null ? `${formatGrade(perf.classAverage, 1)}` : '—'}
          unit={perf.classAverage != null ? '/ 20' : undefined}
          accent="slate"
        />
        <KpiTile
          icon={
            progression != null && progression < 0 ? (
              <TrendingDown className="h-4 w-4" />
            ) : (
              <TrendingUp className="h-4 w-4" />
            )
          }
          label="Progression"
          value={
            progression != null
              ? `${progression > 0 ? '+' : ''}${formatGrade(progression, 1)}`
              : '—'
          }
          unit={progression != null ? 'pts' : undefined}
          accent={progression == null ? 'slate' : progression < 0 ? 'rose' : 'emerald'}
        />
        <KpiTile
          icon={<Award className="h-4 w-4" />}
          label="Rang"
          value={
            academic.rank != null && academic.classSize > 0
              ? `${academic.rank}`
              : '—'
          }
          unit={academic.rank != null && academic.classSize > 0 ? `/ ${academic.classSize}` : undefined}
          accent="amber"
        />
        <KpiTile
          icon={<GaugeCircle className="h-4 w-4" />}
          label="Taux de présence"
          value={perf.attendanceRate != null ? formatPercent(perf.attendanceRate, 0) : '—'}
          accent={
            perf.attendanceRate == null
              ? 'slate'
              : perf.attendanceRate >= 95
                ? 'emerald'
                : perf.attendanceRate >= 85
                  ? 'amber'
                  : 'rose'
          }
        />
      </div>

      {/* Subject performance */}
      {academic.subjectPerf.length > 0 && (
        <section>
          <SectionHeader title="Performance par matière" subtitle="Moyenne de l'élève comparée à la classe" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {academic.subjectPerf.map((s) => {
              const teacher = teacherBySubject.get(s.subjectId);
              const metrics: SubjectMetric[] = [
                { label: 'Moyenne classe', value: formatGrade(s.classAverage, 1) },
                {
                  label: 'Rang',
                  value:
                    s.studentRank != null && s.classSize > 0 ? `${s.studentRank} / ${s.classSize}` : '—',
                },
                {
                  label: 'Tendance',
                  value:
                    s.trend != null ? `${s.trend > 0 ? '+' : ''}${formatGrade(s.trend, 1)} pts` : '—',
                  trend: trendOfDelta(s.trend),
                },
                { label: 'Coefficient', value: `×${formatGrade(s.coefficient, s.coefficient % 1 === 0 ? 0 : 1)}` },
              ];
              return (
                <SubjectPerfCard
                  key={s.subjectId}
                  subjectCode={s.subjectCode}
                  subjectName={s.subjectName}
                  grade={s.studentAverage}
                  badge={s.badge ?? undefined}
                  metrics={metrics}
                >
                  {teacher?.teacherName && (
                    <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
                      <UserRound className="h-3.5 w-3.5 text-slate-400" />
                      <span className="truncate">{teacher.teacherName}</span>
                    </div>
                  )}
                </SubjectPerfCard>
              );
            })}
          </div>
        </section>
      )}

      {/* Term evolution line chart */}
      {hasEvolution && (
        <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200/60">
          <SectionHeader
            title="Évolution par trimestre"
            subtitle="Moyenne générale de l'élève vs. moyenne de classe"
            icon={<LineChartIcon className="h-5 w-5 text-blue-600" />}
          />
          <div className="mt-2">
            <LineChart data={academic.termEvolution} xKey="label" series={lineSeries} annotateValues />
          </div>
        </section>
      )}

      {/* Recent grades */}
      {academic.recentGrades.length > 0 && (
        <section>
          <SectionHeader title="Notes récentes" subtitle={`${academic.recentGrades.length} dernière(s) évaluation(s) publiée(s)`} />
          <div className="mt-4 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 font-bold">Date</th>
                  <th className="px-4 py-2.5 font-bold">Matière</th>
                  <th className="px-4 py-2.5 font-bold">Évaluation</th>
                  <th className="px-4 py-2.5 text-right font-bold">Note</th>
                  <th className="px-4 py-2.5 text-right font-bold">Moy. classe</th>
                </tr>
              </thead>
              <tbody>
                {academic.recentGrades.map((g) => {
                  const onTwenty = g.value != null ? (g.value / g.max) * 20 : null;
                  const aboveClass =
                    onTwenty != null && g.classAverage != null ? onTwenty >= g.classAverage : null;
                  return (
                    <tr key={g.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">
                        <PreferredDate value={g.date} />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: g.subjectColor ?? '#94A3B8' }}
                          />
                          {g.subjectName}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-800">{g.title}</div>
                        <div className="text-[11px] text-slate-400">
                          {KIND_LABEL[g.kind] ?? g.kind}
                          {g.coefficient !== 1 && ` · ×${formatGrade(g.coefficient, g.coefficient % 1 === 0 ? 0 : 1)}`}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <span
                          className={`font-bold tabular-nums ${
                            aboveClass == null
                              ? 'text-slate-700'
                              : aboveClass
                                ? 'text-emerald-600'
                                : 'text-rose-600'
                          }`}
                        >
                          {g.value != null ? `${formatGrade(g.value, g.value % 1 === 0 ? 0 : 2)}` : '—'}
                        </span>
                        <span className="text-[11px] text-slate-400"> / {g.max}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-500">
                        {g.classAverage != null ? `${formatGrade(g.classAverage, 1)} / 20` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Attendance bar (when present) */}
      {perf.attendanceRate != null && (
        <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200/60">
          <SectionHeader title="Assiduité" subtitle="Taux de présence sur l'année scolaire active" />
          <div className="mt-3">
            <ProgressBar
              value={perf.attendanceRate}
              max={100}
              tone={perf.attendanceRate >= 95 ? 'success' : perf.attendanceRate >= 85 ? 'warning' : 'danger'}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              {formatPercent(perf.attendanceRate, 1)} de présence enregistrée.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

const SLATE_ACCENT = { wrap: 'ring-slate-200 bg-white', icon: 'bg-slate-100 text-slate-600' };
const ACCENT_CLS: Record<string, { wrap: string; icon: string }> = {
  blue: { wrap: 'ring-blue-100 bg-blue-50/40', icon: 'bg-blue-100 text-blue-700' },
  slate: SLATE_ACCENT,
  emerald: { wrap: 'ring-emerald-100 bg-emerald-50/40', icon: 'bg-emerald-100 text-emerald-700' },
  rose: { wrap: 'ring-rose-100 bg-rose-50/40', icon: 'bg-rose-100 text-rose-700' },
  amber: { wrap: 'ring-amber-100 bg-amber-50/40', icon: 'bg-amber-100 text-amber-700' },
};

function KpiTile({
  icon,
  label,
  value,
  unit,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  accent: keyof typeof ACCENT_CLS;
}) {
  const cls = ACCENT_CLS[accent] ?? SLATE_ACCENT;
  return (
    <div className={`rounded-2xl px-4 py-3 ring-1 ${cls.wrap}`}>
      <div className="flex items-center gap-2">
        <span className={`grid h-7 w-7 place-items-center rounded-lg ${cls.icon}`}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-bold tracking-tight text-slate-900">{value}</span>
        {unit && <span className="text-xs font-medium text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}
