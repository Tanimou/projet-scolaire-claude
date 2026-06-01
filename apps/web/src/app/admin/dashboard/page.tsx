import {
  AlertTriangle,
  Bell,
  BookOpen,
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  Layers,
  LayoutDashboard,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { TopbarYearSelector } from '@/components/shell/TopbarYearSelector';
import { api, ApiError } from '@/lib/api-client';
import {
  DonutChart,
  EmptyState,
  KpiCard,
  SectionHeader,
  Stagger,
  StaggerItem,
  StatusBadge,
  WelcomeBanner,
  formatDateLong,
  type DonutSegment,
} from '@pilotage/ui';

import { AdminActionCenter, type ActionCenterData } from './AdminActionCenter';

export const metadata: Metadata = { title: 'Tableau de bord administrateur' };
export const dynamic = 'force-dynamic';

interface SparklinePoint {
  x: string;
  y: number;
}
interface KpiData {
  label: string;
  value: number;
  formatted: string;
  delta?: { value: number; period: 'day' | 'week' | 'month'; sign: '+' | '-' | '=' };
  trend?: SparklinePoint[];
}
interface DashboardResponse {
  kpis: {
    students: KpiData;
    teachers: KpiData;
    classes: KpiData;
    pendingRequests: KpiData;
    configuredAlerts: KpiData;
  };
  schoolStructure: {
    academicYears: Array<{ id: string; name: string; status: string }>;
    levels: Array<{ key: string; label: string; count: number }>;
    cycles: Array<{
      cycleId: string;
      cycleName: string;
      cycleColor: string | null;
      classCount: number;
      studentCount: number;
      teacherCount: number;
      topSubjects: string[];
    }>;
    classesByGrade: Array<{ gradeLabel: string; count: number }>;
    topSubjects: Array<{ id: string; name: string; classCount: number }>;
    totals: {
      academicYears: number;
      cycles: number;
      gradeLevels: number;
      classes: number;
      subjects: number;
    };
  };
  teacherCoverageBySubject: Array<{
    subjectId: string;
    subjectName: string;
    teacherCount: number;
  }>;
  teacherCoverageByClass: Array<{
    classSectionId: string;
    className: string;
    teacherCount: number;
    hasMainTeacher: boolean;
  }>;
  gradingRateByClass: Array<{
    classSectionId: string;
    className: string;
    planned: number;
    graded: number;
    completionRate: number;
    status: 'good' | 'medium' | 'late';
  }>;
  studentTeacherRatio: {
    students: number;
    teachers: number;
    ratio: number;
  };
  performance: {
    overall: number | null;
    byCycle: Array<{
      cycleId: string;
      cycleName: string;
      cycleColor: string | null;
      successRate: number;
      sampleSize: number;
    }>;
  };
  recentAudit: Array<{
    id: string;
    actorId: string | null;
    actorRole: string | null;
    actorName: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    detail: string | null;
    createdAt: string;
  }>;
}

interface AcademicYearRow {
  id: string;
  name: string;
  status: string;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

// Donut cycle palette — calm tones matching the target screenshot
// (Primaire blue · Collège slate · Lycée teal). Extra entries for super-admin.
const CYCLE_PALETTE = ['#2563EB', '#64748B', '#14B8A6', '#F59E0B', '#A855F7'];

export default async function AdminDashboardPage() {
  const [dashboard, academicYears, actionCenter] = await Promise.all([
    safe(api<DashboardResponse>('/api/v1/analytics/dashboard', { cache: 'no-store' })),
    safe(api<{ data: AcademicYearRow[] }>('/api/v1/academic-years', { cache: 'no-store' })),
    safe(api<ActionCenterData>('/api/v1/analytics/admin-action-center', { cache: 'no-store' })),
  ]);

  const kpis = dashboard?.kpis;
  const performance = dashboard?.performance;

  // Year selector wiring
  const yearOptions = (academicYears?.data ?? []).map((y) => ({
    id: y.id,
    name: y.name,
    status: y.status as 'active' | 'closed' | 'planned' | 'archived' | undefined,
  }));
  const defaultYearId =
    yearOptions.find((y) => y.status === 'active')?.id ?? yearOptions[0]?.id ?? '';

  // Performance donut — segments sized by sample size (each cycle's notes weight)
  // so the ring is visually proportional. The legend shows the per-cycle success
  // rate, and the center shows the overall school success rate.
  const donutSegments: DonutSegment[] = (performance?.byCycle ?? []).map((c, i) => ({
    label: c.cycleName,
    value: c.sampleSize, // size by sample so segments sum proportionally
    color: c.cycleColor ?? CYCLE_PALETTE[i % CYCLE_PALETTE.length] ?? '#2563EB',
    hint: `${Math.round(c.successRate)}% · ${c.sampleSize} notes`,
  }));

  return (
    <PortalShell
      portal="admin"
      title="Tableau de bord administrateur"
      subtitle="Vue d'ensemble de votre établissement et des activités administratives."
      topbarExtras={
        yearOptions.length > 0 && defaultYearId ? (
          <TopbarYearSelector options={yearOptions} defaultValue={defaultYearId} />
        ) : null
      }
    >
      {/* ─── Welcome hero ─── */}
      <WelcomeBanner
        icon={LayoutDashboard}
        title="Bonjour 👋"
        subtitle="Voici l'état de votre établissement aujourd'hui."
        aside={
          <span className="text-sm font-semibold capitalize text-white/90">
            {new Date().toLocaleDateString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </span>
        }
      />

      {/* ─── Action center: what needs your attention right now ─── */}
      <div className="mt-6">
        <AdminActionCenter data={actionCenter} />
      </div>

      {/* ─── KPI strip (cascade entrance + count-up values) ─── */}
      <Stagger className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StaggerItem>
          <KpiCard
            icon={Users}
            tone="blue"
            label="ÉLÈVES"
            value={kpis?.students.value ?? '—'}
            delta={pickDelta(kpis?.students)}
            deltaSuffix="%"
            deltaPeriod="vs mois dernier"
            trend={kpis?.students.trend}
          />
        </StaggerItem>
        <StaggerItem>
          <KpiCard
            icon={GraduationCap}
            tone="green"
            label="PROFESSEURS"
            value={kpis?.teachers.value ?? '—'}
            delta={pickDelta(kpis?.teachers)}
            deltaSuffix="%"
            deltaPeriod="vs mois dernier"
            trend={kpis?.teachers.trend}
          />
        </StaggerItem>
        <StaggerItem>
          <KpiCard
            icon={BookOpen}
            tone="violet"
            label="CLASSES"
            value={kpis?.classes.value ?? '—'}
            delta={pickDeltaAbs(kpis?.classes)}
            deltaSuffix=""
            deltaPeriod="vs mois dernier"
            trend={kpis?.classes.trend}
          />
        </StaggerItem>
        <StaggerItem>
          <KpiCard
            icon={ClipboardList}
            tone="orange"
            label="DEMANDES EN ATTENTE"
            value={kpis?.pendingRequests.value ?? '—'}
            delta={pickDelta(kpis?.pendingRequests)}
            deltaSuffix="%"
            deltaPeriod="vs mois dernier"
            trend={kpis?.pendingRequests.trend}
          />
        </StaggerItem>
        <StaggerItem>
          <KpiCard
            icon={Bell}
            tone="rose"
            label="ALERTES CONFIGURÉES"
            value={kpis?.configuredAlerts.value ?? '—'}
            delta={2}
            deltaSuffix=""
            deltaPeriod="vs mois dernier"
          />
        </StaggerItem>
      </Stagger>

      {/* ─── Row 2: Structure de l'établissement (par cycle) ─── */}
      <div className="mt-6">
        <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/60 shadow-sm">
          <SectionHeader
            title="Structure de l'établissement"
            actionLabel="Voir tout"
            actionHref="/admin/levels"
          />
          <StructureGrid structure={dashboard?.schoolStructure} />
        </section>
      </div>

      {/* ─── Row 3: Couverture enseignants + Donut performances ─── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Synthèse couverture enseignants */}
        <TeacherCoverageCard
          bySubject={dashboard?.teacherCoverageBySubject}
          byClass={dashboard?.teacherCoverageByClass}
          ratio={dashboard?.studentTeacherRatio}
        />

        {/* Performances donut */}
        <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/60 shadow-sm">
          <SectionHeader
            title="Performances de l'établissement"
            rightSlot={
              <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                Année en cours
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            }
          />
          {donutSegments.length === 0 ? (
            <EmptyState
              title="Pas encore de données"
              description="Les performances s'afficheront dès la première note publiée."
              tone="slate"
              className="mt-3"
            />
          ) : (
            <div className="mt-3">
              <DonutChart
                segments={donutSegments}
                centerLabel={
                  performance?.overall != null ? `${Math.round(performance.overall)}%` : '—'
                }
                centerSubLabel="Taux de réussite global"
                legendPosition="right"
                height={180}
              />
            </div>
          )}
          <Link
            href="/admin/analytics"
            className="mt-4 inline-flex items-center gap-1 text-xs font-bold accent-text hover:underline"
          >
            Voir le tableau de bord analytique
          </Link>
        </section>
      </div>

      {/* ─── Row 4: Audit + Taux de notation par classe ─── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/60 shadow-sm lg:col-span-2">
          <SectionHeader
            title="Journal d'audit — Activités récentes"
            actionLabel="Voir tout"
            actionHref="/admin/audit"
          />
          {(dashboard?.recentAudit?.length ?? 0) === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              Le journal s&apos;activera dès que des opérations seront effectuées sur l&apos;établissement.
            </p>
          ) : (
            <ol className="relative mt-4 ml-2 border-l-2 border-slate-200">
              {dashboard!.recentAudit.map((a) => (
                <li key={a.id} className="relative pb-5 pl-5 last:pb-0">
                  <span
                    aria-hidden
                    className={`absolute -left-[7px] top-1 inline-block h-3 w-3 rounded-full ring-2 ring-white ${pickAuditDotColor(a.action)}`}
                  />
                  <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm lg:grid-cols-5">
                    <span className="text-[11px] text-slate-500 lg:col-span-1">
                      {formatDateLong(a.createdAt)}
                    </span>
                    <span className="font-semibold text-slate-900 lg:col-span-1">
                      {a.actorName ?? a.actorRole ?? '—'}
                    </span>
                    <span className="capitalize text-slate-700 lg:col-span-1">{a.action}</span>
                    <span className="text-slate-700 lg:col-span-1">{a.resourceType}</span>
                    <span className="text-[11px] text-slate-500 lg:col-span-1">
                      {a.detail ?? ''}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <GradingRateCard rows={dashboard?.gradingRateByClass} />
      </div>
    </PortalShell>
  );
}

/**
 * Synthèse couverture enseignants — nb profs/matière, nb profs/classe,
 * ratio élèves-profs, classes sans prof principal, matières sans prof affecté.
 */
function TeacherCoverageCard({
  bySubject,
  byClass,
  ratio,
}: {
  bySubject?: DashboardResponse['teacherCoverageBySubject'];
  byClass?: DashboardResponse['teacherCoverageByClass'];
  ratio?: DashboardResponse['studentTeacherRatio'];
}) {
  const subjects = bySubject ?? [];
  const classes = byClass ?? [];
  const classesWithoutMain = classes.filter((c) => !c.hasMainTeacher);
  const subjectsWithoutTeacher = subjects.filter((s) => s.teacherCount === 0);
  // Top classes by teacher count for the preview list (most-covered first).
  const topClasses = [...classes].sort((a, b) => b.teacherCount - a.teacherCount).slice(0, 5);

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/60 shadow-sm">
      <SectionHeader
        title="Synthèse couverture enseignants"
        actionLabel="Voir les affectations"
        actionHref="/admin/assignments"
      />

      {/* Tuiles de synthèse */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CoverageStat label="Matières couvertes" value={subjects.length} icon={BookOpen} tone="blue" />
        <CoverageStat label="Classes couvertes" value={classes.length} icon={Users} tone="violet" />
        <CoverageStat
          label="Ratio élèves / prof"
          value={ratio ? `${ratio.ratio}` : '—'}
          icon={GraduationCap}
          tone="green"
        />
        <CoverageStat
          label="Classes sans prof principal"
          value={classesWithoutMain.length}
          icon={AlertTriangle}
          tone={classesWithoutMain.length > 0 ? 'rose' : 'green'}
        />
      </div>

      {/* Profs par matière */}
      <div className="mt-5">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Professeurs par matière
        </h3>
        {subjects.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Aucune matière affectée pour le moment.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {subjects.slice(0, 6).map((s) => (
              <li
                key={s.subjectId}
                className="flex items-center justify-between gap-2 text-sm text-slate-700"
              >
                <span className="truncate pr-2">{s.subjectName}</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono text-xs font-bold tabular-nums text-slate-900">
                    {s.teacherCount}
                  </span>
                  {s.teacherCount === 0 && (
                    <StatusBadge label="Sans prof" tone="danger" size="sm" />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Profs par classe */}
      <div className="mt-5">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Professeurs par classe
        </h3>
        {classes.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Aucune classe couverte pour le moment.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {topClasses.map((c) => (
              <li
                key={c.classSectionId}
                className="flex items-center justify-between gap-2 text-sm text-slate-700"
              >
                <span className="inline-flex items-center gap-1.5 truncate pr-2">
                  {c.className}
                  {!c.hasMainTeacher && (
                    <StatusBadge label="Sans prof principal" tone="warning" size="sm" />
                  )}
                </span>
                <span className="font-mono text-xs font-bold tabular-nums text-slate-900">
                  {c.teacherCount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Matières sans prof affecté — rappel explicite */}
      {subjectsWithoutTeacher.length > 0 && (
        <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {subjectsWithoutTeacher.length} matière{subjectsWithoutTeacher.length > 1 ? 's' : ''} sans
          professeur affecté
        </p>
      )}
    </section>
  );
}

function CoverageStat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  icon: typeof Users;
  tone: 'blue' | 'violet' | 'green' | 'rose';
}) {
  const toneClasses: Record<typeof tone, string> = {
    blue: 'bg-blue-50 text-blue-600',
    violet: 'bg-violet-50 text-violet-600',
    green: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600',
  };
  return (
    <div className="rounded-xl bg-slate-50/70 p-3">
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${toneClasses[tone]}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="mt-2 text-xl font-bold tabular-nums text-slate-900">{value}</div>
      <div className="text-[11px] font-medium leading-tight text-slate-500">{label}</div>
    </div>
  );
}

/**
 * Taux de notation par classe — classe, évaluations planifiées, notées/publiées,
 * taux de complétion, statut (bon / moyen / retard).
 */
function GradingRateCard({ rows }: { rows?: DashboardResponse['gradingRateByClass'] }) {
  const data = rows ?? [];
  // Les classes les plus en retard d'abord pour attirer l'attention de l'admin.
  const sorted = [...data].sort((a, b) => a.completionRate - b.completionRate).slice(0, 8);

  const statusBadge = (status: 'good' | 'medium' | 'late') => {
    if (status === 'good') return <StatusBadge label="Bon" tone="success" size="sm" />;
    if (status === 'medium') return <StatusBadge label="Moyen" tone="warning" size="sm" />;
    return <StatusBadge label="Retard" tone="danger" size="sm" />;
  };

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/60 shadow-sm">
      <SectionHeader
        title="Taux de notation par classe"
        actionLabel="Voir les évaluations"
        actionHref="/admin/assessments"
      />
      {sorted.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Aucune évaluation planifiée"
          description="Le taux de notation s'affichera dès qu'une évaluation aura été planifiée."
          tone="slate"
          className="mt-3"
        />
      ) : (
        <div className="-mx-2 mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Classe</th>
                <th className="px-2 py-2 text-right">Planifiées</th>
                <th className="px-2 py-2 text-right">Notées</th>
                <th className="px-2 py-2 text-right">Taux</th>
                <th className="px-2 py-2">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => (
                <tr key={r.classSectionId} className="hover:bg-slate-50/60">
                  <td className="px-2 py-2.5 text-sm font-semibold text-slate-900">{r.className}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums text-slate-700">
                    {r.planned}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums text-slate-700">
                    {r.graded}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs font-bold tabular-nums text-slate-900">
                    {r.completionRate}%
                  </td>
                  <td className="px-2 py-2.5">{statusBadge(r.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StructureGrid({ structure }: { structure?: DashboardResponse['schoolStructure'] }) {
  if (!structure) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-4 text-sm text-slate-500">
        <p>Chargement…</p>
      </div>
    );
  }
  const cycles = structure.cycles ?? [];
  return (
    <div className="mt-3 space-y-6">
      {/* Établissement → cycles : carte par cycle avec classes / élèves / profs / matières */}
      <div>
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          <Layers className="h-3 w-3" />
          Par cycle
        </div>
        {cycles.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            Aucun cycle renseigné pour l&apos;année en cours.
          </p>
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cycles.map((c) => (
              <div
                key={c.cycleId}
                className="rounded-xl border-l-4 bg-slate-50/70 p-4"
                style={{ borderLeftColor: c.cycleColor ?? '#2563EB' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <h4 className="truncate font-bold text-slate-900">{c.cycleName}</h4>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200">
                    {c.classCount} classe{c.classCount > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-base font-bold tabular-nums text-slate-900">
                      {c.studentCount}
                    </div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      Élèves
                    </div>
                  </div>
                  <div>
                    <div className="text-base font-bold tabular-nums text-slate-900">
                      {c.teacherCount}
                    </div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      Profs
                    </div>
                  </div>
                  <div>
                    <div className="text-base font-bold tabular-nums text-slate-900">
                      {c.classCount}
                    </div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      Classes
                    </div>
                  </div>
                </div>
                {c.topSubjects.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {c.topSubjects.map((s) => (
                      <span
                        key={s}
                        className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Détails complémentaires : années, niveaux, classes/niveau, matières */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 divide-slate-100 sm:grid-cols-4 sm:divide-x">
        {/* Années scolaires */}
        <div className="sm:pr-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <Calendar className="h-3 w-3" />
            Années scolaires
          </div>
          <ul className="mt-2 space-y-1">
            {structure.academicYears.slice(0, 3).map((y) => (
              <li key={y.id} className="flex items-center justify-between gap-2 text-sm text-slate-700">
                <span>{y.name}</span>
                {y.status === 'active' && (
                  <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                    En cours
                  </span>
                )}
              </li>
            ))}
          </ul>
          <Link href="/admin/academic-years" className="mt-2 inline-flex text-[11px] font-bold accent-text hover:underline">
            + Ajouter une année
          </Link>
        </div>

        {/* Niveaux */}
        <div className="sm:px-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <Building2 className="h-3 w-3" />
            Niveaux
          </div>
          <ul className="mt-2 space-y-1">
            {structure.levels
              .filter((l) => l.count > 0)
              .map((l) => (
                <li key={l.key} className="flex items-center justify-between text-sm text-slate-700">
                  <span>{l.label}</span>
                  <span className="font-mono text-xs font-bold tabular-nums text-slate-900">
                    {l.count}
                  </span>
                </li>
              ))}
            <li className="flex items-center justify-between border-t border-slate-100 pt-1 text-sm text-slate-900">
              <span className="font-semibold">Total</span>
              <span className="font-mono text-xs font-bold tabular-nums">
                {structure.totals.gradeLevels}
              </span>
            </li>
          </ul>
        </div>

        {/* Classes */}
        <div className="sm:px-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <Users className="h-3 w-3" />
            Classes
          </div>
          <ul className="mt-2 space-y-1">
            {structure.classesByGrade.map((c) => (
              <li
                key={c.gradeLabel}
                className="flex items-center justify-between text-sm text-slate-700"
              >
                <span>{c.gradeLabel}</span>
                <span className="font-mono text-xs font-bold tabular-nums text-slate-900">
                  {c.count}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/admin/classes"
            className="mt-2 inline-flex text-[11px] font-bold accent-text hover:underline"
          >
            Voir toutes les classes
          </Link>
        </div>

        {/* Matières */}
        <div className="sm:pl-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <BookOpen className="h-3 w-3" />
            Matières
          </div>
          <ul className="mt-2 space-y-1">
            {structure.topSubjects.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-sm text-slate-700">
                <span className="truncate pr-2">{s.name}</span>
                <span className="font-mono text-xs font-bold tabular-nums text-slate-900">
                  {s.classCount}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/admin/subjects"
            className="mt-2 inline-flex text-[11px] font-bold accent-text hover:underline"
          >
            Voir toutes les matières
          </Link>
        </div>
      </div>
    </div>
  );
}

function pickDelta(kpi?: KpiData): number | undefined {
  if (!kpi?.delta) return undefined;
  const base = Math.max(1, kpi.value - kpi.delta.value);
  const pct = (kpi.delta.value / base) * 100;
  if (!Number.isFinite(pct)) return undefined;
  return Math.round(pct * 10) / 10;
}

function pickDeltaAbs(kpi?: KpiData): number | undefined {
  if (!kpi?.delta) return undefined;
  return kpi.delta.value;
}

function pickAuditDotColor(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('publish') || a.includes('approve') || a.includes('create')) return 'bg-emerald-500';
  if (a.includes('delete') || a.includes('reject') || a.includes('remove')) return 'bg-rose-500';
  if (a.includes('revise') || a.includes('update') || a.includes('patch')) return 'bg-amber-500';
  return 'bg-blue-500';
}
