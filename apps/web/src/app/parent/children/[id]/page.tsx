import {
  AlertCard,
  ChildProfileHero,
  DonutChart,
  EmptyState,
  EnrollmentStatusBadge,
  KpiCard,
  LineChart,
  PageHeader,
  SectionHeader,
  SubjectPerfCard,
  formatGrade,
  formatPercent,
  gradeVerdict,
  trendOfDelta,
  type LineSeries,
  type SubjectMetric,
} from '@pilotage/ui';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Calendar,
  CalendarDays,
  ClipboardList,
  GraduationCap,
  Mail,
  MessageSquare,
  Printer,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserX,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  RecentGradesTable,
  type GradeRow,
} from '../../dashboard/_components/RecentGradesTable';
import { UpcomingPanel, type UpcomingItem } from '../../dashboard/_components/UpcomingPanel';

import {
  SchoolPathSection,
  type EnrollmentHistoryRow,
} from './_components/SchoolPathSection';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  resolveEnrollmentActivity,
  type CarriesEnrollmentActivity,
} from '@/lib/enrollment-activity';


export const metadata: Metadata = { title: 'Profil de mon enfant' };
export const dynamic = 'force-dynamic';

/**
 * S-E03-3 / `PF-12` — `enrollments` **reste** ici, et c'est délibéré.
 *
 * `GET /students/:id` continue de renvoyer l'historique **complet et non
 * filtré** (`AC-2`) : c'est un consommateur légitime, rendu par la section
 * « Parcours scolaire » plus bas. Ce qui disparaît, c'est sa **double
 * fonction** — il ne répond plus à « cet enfant est-il inscrit ? ». Cette
 * réponse-là vient du champ canonique `enrollmentActivity` (`ADR-072`).
 *
 * La dérivation supprimée était `.find(e => e.status === 'active') ?? enrollments[0]`,
 * au-dessus d'une charge utile **sans filtre de statut** : le `??` rendait une
 * inscription `graduated` derrière un badge vert « Inscription active ». Le
 * repli sur une ligne arbitraire n'était pas une précaution, c'était le bug.
 */
interface StudentSummary extends CarriesEnrollmentActivity {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  externalRef: string | null;
  enrollments: EnrollmentHistoryRow[];
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
  recentGrades: GradeRow[];
  upcomingAssessments: UpcomingItem[];
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

export default async function ChildDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const student = await safe(
    api<StudentSummary>(`/api/v1/students/${id}`, { cache: 'no-store' }),
  );
  if (!student) notFound();

  const [dashboard, alertsResp, attendance] = await Promise.all([
    safe(
      api<ParentDashboardResponse>(
        `/api/v1/analytics/parent-dashboard/${id}`,
        { cache: 'no-store' },
      ),
    ),
    safe(
      api<{ data: ParentAlertItem[] }>(`/api/v1/alerts/parent/${id}`, {
        cache: 'no-store',
      }),
    ),
    safe(
      api<AttendanceSummaryResp>(`/api/v1/attendance/students/${id}`, {
        cache: 'no-store',
      }),
    ),
  ]);

  const enrolment = resolveEnrollmentActivity(student);

  const perf = dashboard?.globalPerformance;
  const subjectPerf = dashboard?.subjectPerf ?? [];
  const termEvolution = dashboard?.termEvolution ?? [];
  const recentGrades = dashboard?.recentGrades ?? [];
  const upcoming = dashboard?.upcomingAssessments ?? [];
  const alerts: ParentAlertItem[] = alertsResp?.data ?? [];
  const openAlerts = alerts.filter((a) => a.status === 'open' || a.status === 'acknowledged');
  const highAlerts = openAlerts.filter((a) => a.severity === 'high').length;

  const attSummary = attendance?.summary;
  const attendanceRate = attSummary && attSummary.total > 0
    ? (attSummary.present / attSummary.total) * 100
    : perf?.attendanceRate ?? null;

  // KPI deltas — keep things honest with neutral tone when classAverage missing
  const gapVsClass =
    perf?.studentAverage != null && perf.classAverage != null
      ? perf.studentAverage - perf.classAverage
      : null;

  const age = computeAge(dashboard?.student.birthDate ?? student.birthDate);

  const heroMeta = [
    { label: 'Âge', value: age != null ? `${age} ans` : '—' },
    {
      label: 'Né(e) le',
      value: (dashboard?.student.birthDate ?? student.birthDate)
        ? new Date(
            (dashboard?.student.birthDate ?? student.birthDate) as string,
          ).toLocaleDateString('fr-FR')
        : '—',
    },
    { label: 'Identifiant', value: dashboard?.student.externalRef ?? student.externalRef ?? '—' },
    {
      label: 'Rang de la classe',
      value:
        dashboard?.student.rank != null && dashboard.student.classSize > 0
          ? `${dashboard.student.rank} / ${dashboard.student.classSize}`
          : '—',
    },
  ];

  const pct = perf?.percentageOnTwenty ?? 0;
  const donutCenterLabel = perf?.studentAverage != null ? `${Math.round(pct)}%` : '—';

  const fullName = `${student.firstName} ${student.lastName}`.trim();

  const lineSeries: LineSeries[] = [
    { key: 'student', label: `Moyenne de ${student.firstName}`, color: '#2563EB' },
    { key: 'class', label: 'Moyenne de la classe', color: '#CBD5E1', dashed: true },
  ];

  // Quick-action shortcuts
  const quickActions: Array<{
    label: string;
    href: string;
    icon: typeof BookOpen;
    tone: string;
  }> = [
    {
      label: 'Notes complètes',
      href: `/parent/grades?studentId=${id}`,
      icon: GraduationCap,
      tone: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    },
    {
      label: 'Cahier de texte',
      href: `/parent/lessons?studentId=${id}`,
      icon: BookOpen,
      tone: 'bg-blue-50 text-blue-700 ring-blue-100',
    },
    {
      label: 'Assiduité',
      href: `/parent/attendance?studentId=${id}`,
      icon: Calendar,
      tone: 'bg-rose-50 text-rose-700 ring-rose-100',
    },
    {
      label: 'Évaluations à venir',
      href: `/parent/upcoming?studentId=${id}`,
      icon: CalendarDays,
      tone: 'bg-amber-50 text-amber-700 ring-amber-100',
    },
    {
      label: 'Commentaires',
      href: `/parent/comments?studentId=${id}`,
      icon: MessageSquare,
      tone: 'bg-violet-50 text-violet-700 ring-violet-100',
    },
    {
      label: 'Recommandations',
      href: `/parent/recommendations?studentId=${id}`,
      icon: ClipboardList,
      tone: 'bg-orange-50 text-orange-700 ring-orange-100',
    },
  ];

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Mes enfants', href: '/parent/children' },
          { label: fullName },
        ]}
        title={fullName}
        // La portée canonique remplace les quatre concaténations locales — et
        // remplace surtout la phrase de repli, qui était le troisième libellé
        // français pour un même état.
        subtitle={enrolment.scopeLabel}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/parent/children"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Mes enfants
            </Link>
            <Link
              href={`/parent/children/${id}/report`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Printer className="h-3.5 w-3.5 text-blue-600" />
              Bilan imprimable
            </Link>
            <Link
              href={`/parent/dashboard?studentId=${id}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700"
            >
              Tableau de bord
            </Link>
          </div>
        }
      />

      {/* Hero card */}
      <div className="mt-6 grid gap-4 lg:grid-cols-12">
        <ChildProfileHero
          firstName={dashboard?.student.firstName ?? student.firstName}
          lastName={dashboard?.student.lastName ?? student.lastName}
          // `undefined` hors `active` : « Classe de 3ème B » sur un enfant sorti
          // de l'année en cours est exactement le mensonge que la tranche
          // supprime. `enrolment.classLabel` est `null` sauf sur `active`.
          classLabel={
            enrolment.classLabel ? `Classe de ${enrolment.classLabel}` : undefined
          }
          schoolLabel={dashboard?.student.schoolName ?? undefined}
          rightSlot={
            <EnrollmentStatusBadge
              state={enrolment.state}
              classLabel={enrolment.classLabel}
              academicYearLabel={enrolment.academicYearLabel}
              lastStatus={enrolment.lastStatus}
              size="md"
              // La portée mène quelque part : « Voir le parcours » descend vers
              // la section d'historique, qui est ce qui EXPLIQUE l'état. Une
              // information sans pas suivant manque la promesse du produit.
              action={
                enrolment.state === 'active' ? undefined : (
                  <a
                    href="#parcours"
                    className="inline-flex min-h-11 items-center text-[11px] font-bold text-blue-700 underline underline-offset-2 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    Voir le parcours
                  </a>
                )
              }
              className="max-w-[16rem]"
            />
          }
          meta={heroMeta}
          className="lg:col-span-8"
        />

        {/* Performance globale donut */}
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 lg:col-span-4">
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
                  centerSubLabel={gradeVerdict(perf.studentAverage)}
                  legendPosition="none"
                  height={120}
                />
              </div>
              <dl className="flex-1 space-y-1.5 text-[11px]">
                <Row label="Moy. générale" value={`${formatGrade(perf.studentAverage)} / 20`} />
                <Row label="Moy. classe" value={`${formatGrade(perf.classAverage)} / 20`} />
                <Row
                  label="Écart"
                  value={
                    gapVsClass != null
                      ? `${gapVsClass > 0 ? '+' : ''}${formatGrade(gapVsClass, 1)} pts`
                      : '—'
                  }
                  valueClassName={
                    gapVsClass == null
                      ? 'text-slate-700'
                      : gapVsClass > 0
                        ? 'text-emerald-700'
                        : gapVsClass < 0
                          ? 'text-rose-700'
                          : 'text-slate-700'
                  }
                />
                <Row
                  label="Progression"
                  value={
                    perf.progression != null
                      ? `${perf.progression > 0 ? '+' : ''}${formatGrade(perf.progression, 1)} pts`
                      : '—'
                  }
                  valueClassName={
                    perf.progression == null
                      ? 'text-slate-700'
                      : perf.progression > 0
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                  }
                />
              </dl>
            </div>
          )}
        </section>
      </div>

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={GraduationCap}
          tone="blue"
          label="MOYENNE GÉNÉRALE"
          value={perf?.studentAverage != null ? formatGrade(perf.studentAverage) : '—'}
        >
          {perf?.studentAverage != null ? 'Pondérée par coefficient' : 'En attente de notes'}
        </KpiCard>
        <KpiCard
          icon={gapVsClass != null && gapVsClass >= 0 ? TrendingUp : TrendingDown}
          tone={gapVsClass != null && gapVsClass >= 0 ? 'green' : gapVsClass != null && gapVsClass < -1 ? 'rose' : 'amber'}
          label="VS CLASSE"
          value={
            gapVsClass != null
              ? `${gapVsClass > 0 ? '+' : ''}${formatGrade(gapVsClass, 1)}`
              : '—'
          }
        >
          {perf?.classAverage != null
            ? `Moy. classe ${formatGrade(perf.classAverage)} / 20`
            : 'Pas de référence classe'}
        </KpiCard>
        <KpiCard
          icon={Calendar}
          tone={attendanceRate != null && attendanceRate < 90 ? 'amber' : 'violet'}
          label="ASSIDUITÉ"
          value={formatPercent(attendanceRate)}
        >
          {attSummary && attSummary.total > 0
            ? `${attSummary.present} présences · ${attSummary.absent + attSummary.absentExcused} absences`
            : 'Pas de relevé'}
        </KpiCard>
        <KpiCard
          icon={AlertTriangle}
          tone={highAlerts > 0 ? 'rose' : openAlerts.length > 0 ? 'amber' : 'green'}
          label="ALERTES ACTIVES"
          value={openAlerts.length}
        >
          {highAlerts > 0
            ? `${highAlerts} critique${highAlerts > 1 ? 's' : ''}`
            : openAlerts.length > 0
              ? 'À surveiller'
              : 'Tout est au vert'}
        </KpiCard>
      </div>

      {/* Quick actions strip — deep-link to all dedicated pages with studentId */}
      <nav
        aria-label="Raccourcis"
        className="mt-6 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/60"
      >
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {quickActions.map((a) => (
            <li key={a.label}>
              <Link
                href={a.href}
                className={`flex h-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[11px] font-bold ring-1 transition hover:-translate-y-0.5 hover:shadow ${a.tone}`}
              >
                <a.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{a.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/*
        « Parcours scolaire » — la CONTREPARTIE du badge canonique.

        En retirant `?? enrollments[0]`, la page cesse d'affirmer une classe
        qu'elle ne peut pas justifier ; sans cette section, elle cesserait aussi
        de *montrer* l'inscription passée, et « Hors année en cours » serait une
        impasse. L'historique complet (non filtré, `AC-2`) est donc rendu ici,
        sans interaction requise, cible de l'ancre « Voir le parcours » du badge.
      */}
      <SchoolPathSection
        rows={student.enrollments}
        childFirstName={student.firstName}
        // La ligne canonique est désignée par la CLÉ que le serveur publie
        // (année canonique + nom de classe), jamais par un test de statut ni
        // par un index — la section met en avant le choix du serveur, elle ne
        // le refait pas.
        canonicalKey={
          enrolment.state === 'active'
            ? {
                academicYearId: student.enrollmentActivity?.academicYearId ?? null,
                classSectionName: enrolment.classLabel,
              }
            : null
        }
      />

      {/* Row : Subject perf + Upcoming + Alerts */}
      <div className="mt-6 grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <SectionHeader
            title="Performance par matière"
            subtitle="Détail de chaque matière sur la période"
            actionLabel="Toutes les matières"
            actionHref={`/parent/subjects?studentId=${id}`}
          />
          {subjectPerf.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title="Pas encore de notes par matière"
              description="Les performances par matière apparaîtront dès la première note publiée."
              tone="slate"
              className="mt-3"
            />
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-2">
              {subjectPerf.slice(0, 4).map((s) => {
                const metrics: SubjectMetric[] = [
                  {
                    label: 'Classement',
                    value:
                      s.studentRank != null && s.classSize > 0
                        ? `${s.studentRank} / ${s.classSize}`
                        : '—',
                  },
                  {
                    label: 'Moy. classe',
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
                    href={`/parent/grades?studentId=${id}&subject=${s.subjectCode}`}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4 lg:col-span-4">
          <UpcomingPanel upcoming={upcoming} />

          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
            <SectionHeader
              title="Alertes et recommandations"
              actionLabel={alerts.length > 0 ? 'Tout voir' : undefined}
              actionHref={
                alerts.length > 0
                  ? `/parent/recommendations?studentId=${id}`
                  : undefined
              }
              compact
            />
            <div className="mt-2 space-y-2">
              {openAlerts.length === 0 ? (
                <AlertCard
                  polarity="success"
                  icon={Sparkles}
                  title="Aucune alerte active"
                  body="Le suivi est au vert."
                />
              ) : (
                openAlerts.slice(0, 3).map((a) => (
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
                    actionHref={`/parent/recommendations?studentId=${id}`}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Row : Term evolution chart */}
      {termEvolution.length > 0 && (
        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <SectionHeader
            title="Évolution des moyennes générales"
            subtitle="Progression par trimestre — comparée à la classe"
            compact
          />
          <div className="mt-3">
            <LineChart
              data={termEvolution}
              xKey="label"
              series={lineSeries}
              annotateValues={false}
              height={220}
            />
          </div>
        </section>
      )}

      {/* Row : Recent grades */}
      <div className="mt-6">
        <RecentGradesTable
          rows={recentGrades}
          seeAllHref={`/parent/grades?studentId=${id}`}
        />
      </div>

      {/* Bottom CTA */}
      <section className="mt-6 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-50 via-white to-violet-50 p-5 ring-1 ring-slate-200/60">
        <div className="flex flex-wrap items-center gap-4">
          <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600/15 text-blue-700 sm:flex">
            <Mail className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-slate-900">
              Échangez avec les enseignants de {student.firstName}
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Posez une question, demandez un rendez-vous ou répondez à un message — la
              messagerie est partagée avec la direction et l&apos;équipe pédagogique.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/parent/comments?studentId=${id}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <MessageSquare className="h-3.5 w-3.5 text-violet-600" />
              Voir les commentaires
            </Link>
            <Link
              href="/parent/communication"
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700"
            >
              <Mail className="h-3.5 w-3.5" />
              Communication
            </Link>
          </div>
        </div>
      </section>

      <p className="mt-6 text-center text-[11px] text-slate-500">
        Pour la vue complète avec graphiques par matière, consultez le{' '}
        <Link
          href={`/parent/dashboard?studentId=${id}`}
          className="font-bold accent-text hover:underline"
        >
          tableau de bord détaillé
        </Link>
        .
      </p>
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
