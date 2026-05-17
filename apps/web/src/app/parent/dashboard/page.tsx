import { AlertTriangle, Sparkles, TrendingDown, UserX } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { fetchMe } from '@/lib/me';
import {
  AlertCard,
  ChildProfileHero,
  CommentsFeed,
  DonutChart,
  EmptyState,
  GroupedBarChart,
  LineChart,
  SectionHeader,
  SubjectPerfCard,
  formatGrade,
  formatPercent,
  gradeVerdict,
  trendOfDelta,
  type BarSeries,
  type CommentItem,
  type LineSeries,
  type SubjectMetric,
} from '@pilotage/ui';

import { RecentGradesTable, type GradeRow } from './_components/RecentGradesTable';
import { SupportStrip } from './_components/SupportStrip';
import { UpcomingPanel, type UpcomingItem } from './_components/UpcomingPanel';

export const metadata: Metadata = { title: 'Tableau de bord famille' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
  enrollments: Array<{
    classSection: {
      id: string;
      name: string;
      gradeLevel?: {
        id: string;
        name: string;
        code: string;
        cycle?: { id: string; name: string; color: string | null };
      };
    };
    academicYear: { name: string };
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
  subjectEvolution: Array<{
    subjectName: string;
    subjectCode: string;
    T1: number | null;
    T2: number | null;
    T3: number | null;
  }>;
  recentGrades: GradeRow[];
  upcomingAssessments: UpcomingItem[];
}

interface ParentAlertItem {
  id: string;
  code: string;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  title: string;
  body: string;
  recommendation: string | null;
  subjectId: string | null;
  subjectName: string | null;
  detectedAt: string;
}

interface ParentCommentItem {
  id: string;
  comment: string | null;
  publishedAt: string;
  gradeValue: number | null;
  gradeMax: number;
  gradeOn20: number | null;
  assessmentTitle: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  classSectionName: string;
  termName: string | null;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

function computeAge(birthDateIso?: string | null): number | null {
  if (!birthDateIso) return null;
  const birth = new Date(birthDateIso);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

export default async function ParentDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  const params = await searchParams;
  const [me, students] = await Promise.all([
    fetchMe(),
    safe(api<{ data: StudentSummary[] }>('/api/v1/students', { cache: 'no-store' })),
  ]);

  const allStudents = students?.data ?? [];
  const activeStudent =
    params.studentId && allStudents.find((s) => s.id === params.studentId)
      ? allStudents.find((s) => s.id === params.studentId)
      : allStudents[0];

  // No children attached → friendly empty state
  if (!activeStudent) {
    return (
      <PortalShell
        portal="parent"
        title="Tableau de bord"
        subtitle={`Bonjour ${me?.firstName ?? ''} 👋`}
      >
        <EmptyState
          icon={Sparkles}
          title="Aucun enfant rattaché à votre compte"
          description="Contactez l'administration de l'établissement pour faire le lien entre votre compte et le dossier de votre enfant."
          tone="amber"
        />
      </PortalShell>
    );
  }

  const [dashboard, alertsResp, commentsResp] = await Promise.all([
    safe(
      api<ParentDashboardResponse>(
        `/api/v1/analytics/parent-dashboard/${activeStudent.id}`,
        { cache: 'no-store' },
      ),
    ),
    safe(
      api<{ data: ParentAlertItem[] }>(`/api/v1/alerts/parent/${activeStudent.id}`, {
        cache: 'no-store',
      }),
    ),
    safe(
      api<{ data: ParentCommentItem[] }>(
        `/api/v1/analytics/parent-comments/${activeStudent.id}`,
        { cache: 'no-store' },
      ),
    ),
  ]);
  const alerts: ParentAlertItem[] = alertsResp?.data ?? [];
  const realComments: ParentCommentItem[] = commentsResp?.data ?? [];

  const perf = dashboard?.globalPerformance;
  const subjectPerf = dashboard?.subjectPerf ?? [];
  const termEvolution = dashboard?.termEvolution ?? [];
  const subjectEvolution = dashboard?.subjectEvolution ?? [];
  const recentGrades = dashboard?.recentGrades ?? [];
  const upcoming = dashboard?.upcomingAssessments ?? [];

  // Build line chart series
  const lineSeries: LineSeries[] = [
    { key: 'student', label: 'Moyenne de ' + activeStudent.firstName, color: '#2563EB' },
    { key: 'class', label: 'Moyenne de la classe', color: '#CBD5E1', dashed: true },
  ];

  // Build grouped bar chart series — light blue → dark blue per term
  const barSeries: BarSeries[] = [
    { key: 'T1', label: '1er trimestre', color: '#BFDBFE' },
    { key: 'T2', label: '2e trimestre', color: '#3B82F6' },
    { key: 'T3', label: '3e trimestre', color: '#1D4ED8' },
  ];

  // Build child profile hero meta — 4 fields, matches the image 1 layout
  const age = computeAge(dashboard?.student.birthDate ?? null);
  const heroMeta = [
    { label: 'Âge', value: age != null ? `${age} ans` : '—' },
    {
      label: 'Né(e) le',
      value: dashboard?.student.birthDate
        ? new Date(dashboard.student.birthDate).toLocaleDateString('fr-FR')
        : '—',
    },
    { label: 'Identifiant', value: dashboard?.student.externalRef ?? '—' },
    {
      label: 'Rang de la classe',
      value:
        dashboard?.student.rank != null && dashboard.student.classSize > 0
          ? `${dashboard.student.rank} / ${dashboard.student.classSize}`
          : '—',
    },
  ];

  // Donut data for global performance percent
  const pct = perf?.percentageOnTwenty ?? 0;
  const donutCenterLabel = perf?.studentAverage != null ? `${Math.round(pct)}%` : '—';

  // Map parent-comments → CommentsFeed items. If empty, fall back to deriving
  // entries from recentGrades where `comment` is non-empty so the panel never
  // looks deserted when there's clearly data the user might find useful.
  const commentItems: CommentItem[] = (
    realComments.length > 0
      ? realComments.map<CommentItem>((c) => ({
          id: c.id,
          author: { firstName: 'Enseignant·e', lastName: c.subjectName },
          role: `${c.subjectName} · ${c.classSectionName}${
            c.gradeOn20 != null ? ` · note ${formatGrade(c.gradeOn20, 1)}/20` : ''
          }`,
          body: c.comment ?? '',
          date: c.publishedAt,
        }))
      : recentGrades
          .filter((g) => g.comment && g.comment.trim().length > 0)
          .map<CommentItem>((g) => ({
            id: g.id,
            author: { firstName: 'Enseignant·e', lastName: g.subjectName },
            role: `${g.subjectName} · ${g.title} · ${formatGrade(g.value)}/${g.max}`,
            body: g.comment ?? '',
            date: g.date,
          }))
  ).slice(0, 6);

  return (
    <PortalShell
      portal="parent"
      title="Tableau de bord"
      subtitle="Vue d'ensemble des performances et activités"
    >
      {/* Switcher si plusieurs enfants */}
      {allStudents.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold text-slate-500">Enfant :</span>
          {allStudents.map((s) => (
            <a
              key={s.id}
              href={`/parent/dashboard?studentId=${s.id}`}
              className={
                s.id === activeStudent.id
                  ? 'rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white'
                  : 'rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }
            >
              {s.firstName} {s.lastName.toUpperCase()}
            </a>
          ))}
        </div>
      )}

      {/* ─────────── Row 1 : Hero (profile + global perf + alerts) ─────────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Child profile — span 6 cols (matches image 1 wide hero) */}
        <ChildProfileHero
          firstName={dashboard?.student.firstName ?? activeStudent.firstName}
          lastName={dashboard?.student.lastName ?? activeStudent.lastName}
          classLabel={
            dashboard?.student.classSectionName
              ? `Classe de ${dashboard.student.classSectionName}`
              : undefined
          }
          schoolLabel={dashboard?.student.schoolName ?? undefined}
          meta={heroMeta}
          className="lg:col-span-6"
        />

        {/* Global performance — span 3 cols */}
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 lg:col-span-3">
          <h3 className="text-sm font-bold text-slate-900">Performance globale</h3>
          {perf?.studentAverage == null ? (
            <p className="mt-3 text-xs text-slate-500">Pas encore de notes publiées.</p>
          ) : (
            <div className="mt-2 flex items-center gap-3">
              <div className="shrink-0">
                <DonutChart
                  segments={[
                    { label: 'Atteinte', value: Math.max(0, pct), color: '#2563EB' },
                    { label: 'Marge', value: Math.max(0, 100 - pct), color: '#DBEAFE' },
                  ]}
                  centerLabel={donutCenterLabel}
                  centerSubLabel={gradeVerdict(perf?.studentAverage)}
                  legendPosition="none"
                  height={120}
                />
              </div>
              <dl className="flex-1 space-y-1.5 text-[11px]">
                <Row
                  label="Moy. générale"
                  value={`${formatGrade(perf?.studentAverage ?? null)} / 20`}
                />
                <Row
                  label="Moy. classe"
                  value={`${formatGrade(perf?.classAverage ?? null)} / 20`}
                />
                <Row
                  label="Progression"
                  value={
                    perf?.progression != null
                      ? `${perf.progression > 0 ? '+' : ''}${formatGrade(perf.progression, 1)} pts`
                      : '—'
                  }
                  valueClassName={
                    perf?.progression == null
                      ? 'text-slate-700'
                      : perf.progression > 0
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                  }
                />
                <Row
                  label="Assiduité"
                  value={formatPercent(perf?.attendanceRate ?? null)}
                />
              </dl>
            </div>
          )}
        </section>

        {/* Alerts & recommandations — span 3 cols */}
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 lg:col-span-3">
          <SectionHeader
            title="Alertes et recommandations"
            actionLabel="Tout voir"
            actionHref="/parent/recommendations"
            compact
          />
          <div className="mt-2 space-y-2">
            {alerts.length === 0 ? (
              <>
                <AlertCard
                  polarity="success"
                  icon={Sparkles}
                  title="Aucune alerte active"
                  body="Le suivi est au vert."
                />
                {perf?.progression != null && perf.progression < 0 && (
                  <AlertCard
                    polarity="warning"
                    icon={TrendingDown}
                    title="Léger fléchissement"
                    body={`Baisse de ${formatGrade(Math.abs(perf.progression), 1)} pts au dernier trimestre.`}
                    actionLabel="Voir détails"
                    actionHref={`/parent/grades?studentId=${activeStudent.id}`}
                  />
                )}
              </>
            ) : (
              alerts.slice(0, 2).map((a) => (
                <AlertCard
                  key={a.id}
                  polarity={
                    a.severity === 'high'
                      ? 'danger'
                      : a.severity === 'medium'
                        ? 'warning'
                        : 'info'
                  }
                  icon={
                    a.code === 'HIGH_ABSENCE'
                      ? UserX
                      : a.code === 'LOW_SUBJECT_AVG' || a.code === 'NEGATIVE_TREND'
                        ? TrendingDown
                        : AlertTriangle
                  }
                  title={a.title}
                  body={a.recommendation ? `${a.body} ${a.recommendation}` : a.body}
                  actionLabel="Voir le détail"
                  actionHref={`/parent/recommendations?studentId=${activeStudent.id}`}
                />
              ))
            )}
          </div>
        </section>
      </div>

      {/* ─────────── Row 2 : Subject perf cards + Upcoming right rail ─────────── */}
      <div className="mt-6 grid gap-4 lg:grid-cols-12 lg:grid-rows-[auto_1fr]">
        {/* 4 subject cards — span 9 cols, in their own 4-col inner grid */}
        <div className="lg:col-span-9">
          <SectionHeader
            title="Performance par matière"
            subtitle="Détail de chaque matière du trimestre"
          />
          {subjectPerf.length === 0 ? (
            <EmptyState
              title="Pas encore de notes par matière"
              description="Les performances par matière apparaîtront dès la première note publiée par les enseignants."
              tone="slate"
              className="mt-3"
            />
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {subjectPerf.slice(0, 4).map((s) => {
                const metrics: SubjectMetric[] = [
                  {
                    label: 'Classement de la classe',
                    value:
                      s.studentRank != null && s.classSize > 0
                        ? `${s.studentRank} / ${s.classSize}`
                        : '—',
                  },
                  {
                    label: 'Moyenne de la classe',
                    value: `${formatGrade(s.classAverage)} / 20`,
                  },
                  {
                    label: 'Progression',
                    value:
                      s.trend != null
                        ? `${s.trend > 0 ? '+' : ''}${formatGrade(s.trend, 1)} pts`
                        : '—',
                    trend: trendOfDelta(s.trend),
                  },
                  { label: 'Coefficient', value: String(s.coefficient) },
                ];
                return (
                  <SubjectPerfCard
                    key={s.subjectId}
                    subjectCode={s.subjectCode}
                    subjectName={s.subjectName}
                    grade={s.studentAverage}
                    metrics={metrics}
                    href={`/parent/grades?studentId=${activeStudent.id}&subject=${s.subjectCode}`}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Upcoming panel — span 3 cols, takes the right rail height of subjects + charts */}
        <div className="lg:col-span-3 lg:row-span-2">
          <UpcomingPanel upcoming={upcoming} />
        </div>

        {/* Charts duo under the subjects row, still span 9 cols, two halves */}
        <div className="grid gap-4 lg:col-span-9 lg:grid-cols-2">
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
            <SectionHeader
              title="Évolution des moyennes générales"
              subtitle="Progression par trimestre"
              compact
            />
            {termEvolution.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                Pas encore assez de données pour tracer une courbe.
              </p>
            ) : (
              <LineChart
                data={termEvolution}
                xKey="label"
                series={lineSeries}
                annotateValues={false}
                height={220}
              />
            )}
          </section>
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
            <SectionHeader
              title="Évolution par matière"
              subtitle="Moyennes par trimestre"
              compact
            />
            {subjectEvolution.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                Pas encore de moyennes par matière à comparer.
              </p>
            ) : (
              <GroupedBarChart
                data={subjectEvolution}
                xKey="subjectName"
                series={barSeries}
                height={220}
                showLegend
              />
            )}
          </section>
        </div>
      </div>

      {/* ─────────── Row 3 : Recent grades table + Comments ─────────── */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentGradesTable
            rows={recentGrades}
            seeAllHref={`/parent/grades?studentId=${activeStudent.id}`}
          />
        </div>
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <SectionHeader
            title="Commentaires des enseignants"
            actionLabel="Voir tous les commentaires"
            actionHref={`/parent/comments?studentId=${activeStudent.id}`}
            compact
          />
          <div className="mt-3">
            <CommentsFeed
              items={commentItems}
              emptyState="Aucun commentaire publié pour le moment. Les commentaires apparaîtront ici dès que les enseignants en saisiront."
            />
          </div>
        </section>
      </div>

      {/* ─────────── Row 4 : Bottom support strip (Image 2 polish) ─────────── */}
      <div className="mt-6">
        <SupportStrip childFirstName={activeStudent.firstName} />
      </div>
    </PortalShell>
  );
}

function Row({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono font-bold tabular-nums text-slate-900 ${valueClassName ?? ''}`}>
        {value}
      </span>
    </div>
  );
}
