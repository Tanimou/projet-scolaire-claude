import {
  CalendarCheck2,
  CheckCircle2,
  Clock,
  GraduationCap,
  School,
  UserX,
} from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { api, ApiError } from '@/lib/api-client';
import {
  formatGrade,
  formatPercent,
  gradeVerdict,
} from '@pilotage/ui';

import { ReportToolbar } from './ReportToolbar';

export const metadata: Metadata = { title: 'Bilan de suivi' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  externalRef: string | null;
  enrollments: Array<{
    id: string;
    status: string;
    classSection: {
      id: string;
      name: string;
      gradeLevel?: { name: string; cycle?: { name: string; color: string | null } };
    };
    academicYear: { id: string; name: string; status: string };
  }>;
}

interface ParentDashboardResponse {
  student: {
    id: string;
    firstName: string;
    lastName: string;
    photoUrl: string | null;
    classSectionName: string | null;
    gradeLevelName: string | null;
    schoolName: string | null;
    externalRef: string | null;
    birthDate: string | null;
    rank: number | null;
    classSize: number;
  };
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
}

interface AttendanceSummaryResp {
  summary: {
    total: number;
    present: number;
    absent: number;
    absentExcused: number;
    late: number;
    leftEarly: number;
  };
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

function computeAge(birthIso: string | null | undefined): number | null {
  if (!birthIso) return null;
  const birth = new Date(birthIso);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function frDateLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Tendance arrow + label for a subject trend in points. */
function trendGlyph(trend: number | null): { glyph: string; cls: string } {
  if (trend == null || Math.abs(trend) < 0.05) return { glyph: '→', cls: 'text-slate-400' };
  if (trend > 0) return { glyph: '↑', cls: 'text-emerald-600' };
  return { glyph: '↓', cls: 'text-rose-600' };
}

export default async function ChildReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const student = await safe(
    api<StudentSummary>(`/api/v1/students/${id}`, { cache: 'no-store' }),
  );
  if (!student) notFound();

  const [dashboard, attendance] = await Promise.all([
    safe(
      api<ParentDashboardResponse>(`/api/v1/analytics/parent-dashboard/${id}`, {
        cache: 'no-store',
      }),
    ),
    safe(
      api<AttendanceSummaryResp>(`/api/v1/attendance/students/${id}`, {
        cache: 'no-store',
      }),
    ),
  ]);

  const active =
    student.enrollments.find((e) => e.status === 'active') ?? student.enrollments[0];

  const perf = dashboard?.globalPerformance;
  const subjectPerf = (dashboard?.subjectPerf ?? [])
    .slice()
    .sort((a, b) => b.coefficient - a.coefficient);
  const termEvolution = dashboard?.termEvolution ?? [];

  const att = attendance?.summary;
  const attendanceRate =
    att && att.total > 0
      ? (att.present / att.total) * 100
      : perf?.attendanceRate ?? null;
  const absencesTotal = att ? att.absent + att.absentExcused : 0;
  const latesTotal = att ? att.late + att.leftEarly : 0;

  const gapVsClass =
    perf?.studentAverage != null && perf.classAverage != null
      ? perf.studentAverage - perf.classAverage
      : null;

  const fullName = `${student.firstName} ${student.lastName}`.trim();
  const age = computeAge(dashboard?.student.birthDate ?? student.birthDate);
  const schoolName = dashboard?.student.schoolName ?? 'Établissement scolaire';
  const classLabel =
    dashboard?.student.classSectionName ?? active?.classSection.name ?? '—';
  const levelLabel =
    dashboard?.student.gradeLevelName ?? active?.classSection.gradeLevel?.name ?? '';
  const yearLabel = active?.academicYear.name ?? '';
  const cycleLabel = active?.classSection.gradeLevel?.cycle?.name ?? '';
  const rank = dashboard?.student.rank ?? null;
  const classSize = dashboard?.student.classSize ?? 0;

  const generatedOn = new Date().toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      <ReportToolbar backHref={`/parent/children/${id}`} childName={fullName} />

      {/* A4-friendly printable document */}
      <main className="mx-auto my-6 max-w-[820px] bg-white p-8 shadow-lg ring-1 ring-slate-200/70 print:my-0 print:max-w-none print:p-0 print:shadow-none print:ring-0 sm:p-10">
        {/* Document header */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-blue-600 pb-5">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
              <School className="h-6 w-6" />
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
                {schoolName}
              </p>
              <h1 className="text-2xl font-bold text-slate-900">Bilan de suivi scolaire</h1>
              <p className="text-xs text-slate-500">
                {[cycleLabel, levelLabel, yearLabel].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <div className="text-right text-[11px] text-slate-500">
            <p className="font-semibold text-slate-700">Édité le {generatedOn}</p>
            <p>Document de synthèse familial</p>
          </div>
        </header>

        {/* Student identity */}
        <section className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200/70 sm:grid-cols-4 print:bg-slate-50">
          <Identity label="Élève" value={fullName} wide />
          <Identity label="Classe" value={`${classLabel}${levelLabel ? ` · ${levelLabel}` : ''}`} />
          <Identity
            label="Rang de classe"
            value={rank != null && classSize > 0 ? `${rank} / ${classSize}` : '—'}
          />
          <Identity label="Identifiant" value={dashboard?.student.externalRef ?? student.externalRef ?? '—'} />
          <Identity label="Date de naissance" value={frDateLong(dashboard?.student.birthDate ?? student.birthDate)} />
          <Identity label="Âge" value={age != null ? `${age} ans` : '—'} />
          <Identity label="Année scolaire" value={yearLabel || '—'} />
        </section>

        {/* Global performance */}
        <section className="mt-7">
          <SectionTitle icon={GraduationCap}>Performance globale</SectionTitle>
          {perf?.studentAverage == null ? (
            <p className="mt-2 text-sm text-slate-500">
              Aucune note publiée pour le moment — la moyenne générale apparaîtra dès la première
              évaluation.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Moyenne générale"
                value={`${formatGrade(perf.studentAverage)}/20`}
                hint={gradeVerdict(perf.studentAverage)}
                tone="blue"
              />
              <Stat
                label="Moyenne de la classe"
                value={perf.classAverage != null ? `${formatGrade(perf.classAverage)}/20` : '—'}
                hint="Référence de classe"
                tone="slate"
              />
              <Stat
                label="Écart vs classe"
                value={
                  gapVsClass != null
                    ? `${gapVsClass > 0 ? '+' : ''}${formatGrade(gapVsClass, 1)} pts`
                    : '—'
                }
                hint={gapVsClass != null ? (gapVsClass >= 0 ? 'Au-dessus' : 'En dessous') : '—'}
                tone={gapVsClass == null ? 'slate' : gapVsClass >= 0 ? 'green' : 'rose'}
              />
              <Stat
                label="Progression"
                value={
                  perf.progression != null
                    ? `${perf.progression > 0 ? '+' : ''}${formatGrade(perf.progression, 1)} pts`
                    : '—'
                }
                hint="Sur la période"
                tone={perf.progression == null ? 'slate' : perf.progression >= 0 ? 'green' : 'rose'}
              />
            </div>
          )}
        </section>

        {/* Subject performance table */}
        <section className="mt-7">
          <SectionTitle icon={GraduationCap}>Résultats par matière</SectionTitle>
          {subjectPerf.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              Les résultats par matière apparaîtront ici dès la publication des premières notes.
            </p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-xl ring-1 ring-slate-200">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-slate-100 text-[11px] uppercase tracking-wider text-slate-600">
                    <th className="px-3 py-2 font-bold">Matière</th>
                    <th className="px-3 py-2 text-center font-bold">Coef.</th>
                    <th className="px-3 py-2 text-center font-bold">Moy. élève</th>
                    <th className="px-3 py-2 text-center font-bold">Moy. classe</th>
                    <th className="px-3 py-2 text-center font-bold">Rang</th>
                    <th className="px-3 py-2 text-center font-bold">Tendance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subjectPerf.map((s) => {
                    const t = trendGlyph(s.trend);
                    const studentVal = s.studentAverage;
                    const valTone =
                      studentVal == null
                        ? 'text-slate-400'
                        : studentVal >= 14
                          ? 'text-emerald-700'
                          : studentVal >= 10
                            ? 'text-slate-900'
                            : 'text-rose-700';
                    return (
                      <tr key={s.subjectId} className="break-inside-avoid">
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2">
                            <span
                              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: s.subjectColor ?? '#94a3b8' }}
                            />
                            <span className="font-semibold text-slate-800">{s.subjectName}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-xs tabular-nums text-slate-600">
                          {s.coefficient}
                        </td>
                        <td className={`px-3 py-2.5 text-center font-mono font-bold tabular-nums ${valTone}`}>
                          {studentVal != null ? formatGrade(studentVal) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-xs tabular-nums text-slate-500">
                          {s.classAverage != null ? formatGrade(s.classAverage) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-xs tabular-nums text-slate-600">
                          {s.studentRank != null && s.classSize > 0
                            ? `${s.studentRank}/${s.classSize}`
                            : '—'}
                        </td>
                        <td className={`px-3 py-2.5 text-center text-base font-bold ${t.cls}`}>
                          {t.glyph}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Attendance summary */}
        <section className="mt-7">
          <SectionTitle icon={CalendarCheck2}>Assiduité</SectionTitle>
          {!att || att.total === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              Aucun relevé de présence enregistré sur la période.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Taux de présence"
                value={attendanceRate != null ? formatPercent(attendanceRate, 1) : '—'}
                hint={`${att.present} séance${att.present > 1 ? 's' : ''} sur ${att.total}`}
                tone={attendanceRate != null && attendanceRate >= 95 ? 'green' : attendanceRate != null && attendanceRate >= 90 ? 'amber' : 'rose'}
                icon={CheckCircle2}
              />
              <Stat
                label="Absences"
                value={absencesTotal}
                hint={`${att.absentExcused} justifiée${att.absentExcused > 1 ? 's' : ''}`}
                tone={absencesTotal > 0 ? 'rose' : 'slate'}
                icon={UserX}
              />
              <Stat
                label="Retards & départs"
                value={latesTotal}
                hint={`${att.leftEarly} départ${att.leftEarly > 1 ? 's' : ''} anticipé${att.leftEarly > 1 ? 's' : ''}`}
                tone={latesTotal > 0 ? 'amber' : 'slate'}
                icon={Clock}
              />
              <Stat
                label="Séances suivies"
                value={att.total}
                hint="Total enregistré"
                tone="slate"
              />
            </div>
          )}
        </section>

        {/* Term evolution */}
        {termEvolution.length > 0 && (
          <section className="mt-7 break-inside-avoid">
            <SectionTitle icon={GraduationCap}>Évolution par période</SectionTitle>
            <div className="mt-3 overflow-hidden rounded-xl ring-1 ring-slate-200">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-slate-100 text-[11px] uppercase tracking-wider text-slate-600">
                    <th className="px-3 py-2 font-bold">Période</th>
                    <th className="px-3 py-2 text-center font-bold">Moy. élève</th>
                    <th className="px-3 py-2 text-center font-bold">Moy. classe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {termEvolution.map((t) => (
                    <tr key={t.label}>
                      <td className="px-3 py-2.5 font-semibold text-slate-700">{t.label}</td>
                      <td className="px-3 py-2.5 text-center font-mono font-bold tabular-nums text-slate-900">
                        {t.student != null ? formatGrade(t.student) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono text-xs tabular-nums text-slate-500">
                        {t.class != null ? formatGrade(t.class) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="mt-8 border-t border-slate-200 pt-4 text-[10px] leading-relaxed text-slate-400">
          <p>
            Document généré automatiquement par le portail famille de {schoolName} le {generatedOn}.
            Il reflète les données disponibles à cette date et n&apos;a pas de valeur officielle —
            les bulletins officiels sont délivrés par l&apos;établissement. Pour toute question,
            contactez le secrétariat ou l&apos;équipe pédagogique via votre espace de communication.
          </p>
        </footer>
      </main>
    </div>
  );
}

// =============================================================================
// Small presentational helpers (print-friendly: no shadows, solid borders)
// =============================================================================

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
      <Icon className="h-4 w-4 text-blue-600" />
      {children}
    </h2>
  );
}

function Identity({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

const STAT_TONES: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-700 ring-blue-100',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  rose: 'bg-rose-50 text-rose-700 ring-rose-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  slate: 'bg-slate-50 text-slate-700 ring-slate-200',
};

function Stat({
  label,
  value,
  hint,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone: 'blue' | 'green' | 'rose' | 'amber' | 'slate';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className={`rounded-xl p-3 ring-1 ${STAT_TONES[tone]} print:ring-1`}>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</p>
      </div>
      <p className="mt-1 font-mono text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] font-medium opacity-70">{hint}</p>}
    </div>
  );
}
