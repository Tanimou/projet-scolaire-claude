import {
  Bell,
  BookOpen,
  Building2,
  Calendar,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  GraduationCap,
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
  enrollmentRequests: Array<{
    id: string;
    requesterName: string;
    studentName: string;
    requestedClassName: string | null;
    requestType: 'rattachement' | 'inscription';
    status: 'pending' | 'to_verify' | 'approved' | 'rejected';
    createdAt: string;
  }>;
  teachingAssignmentsSummary: Array<{
    id: string;
    teacherName: string;
    subjectName: string;
    classes: string[];
    weeklyHours: number | null;
    status: 'active' | 'overcapacity';
  }>;
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
  alertRules: Array<{
    code: string;
    label: string;
    condition: string;
    severity: 'high' | 'medium' | 'low';
    status: 'active' | 'inactive';
  }>;
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
  recentExports: Array<{
    id: string;
    kind: 'xlsx' | 'pdf' | 'csv';
    fileName: string;
    requesterName: string | null;
    createdAt: string;
    downloadUrl: string | null;
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

      {/* ─── Row 2: Structure (2/5) + Demandes (3/5) ─── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/60 shadow-sm lg:col-span-2">
          <SectionHeader
            title="Structure de l'établissement"
            actionLabel="Voir tout"
            actionHref="/admin/school/structure"
          />
          <StructureGrid structure={dashboard?.schoolStructure} />
        </section>

        <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/60 shadow-sm lg:col-span-3">
          <SectionHeader
            title="Demandes de rattachement / inscriptions"
            actionLabel="Voir toutes"
            actionHref="/admin/enrollment-requests"
          />
          {(dashboard?.enrollmentRequests?.length ?? 0) === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Aucune demande en attente actuellement.</p>
          ) : (
            <div className="-mx-2 mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-2 py-2">Demandeur</th>
                    <th className="px-2 py-2">Élève</th>
                    <th className="px-2 py-2">Classe souhaitée</th>
                    <th className="px-2 py-2">Type de demande</th>
                    <th className="px-2 py-2">Statut</th>
                    <th className="px-2 py-2">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dashboard!.enrollmentRequests.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="px-2 py-2.5 text-sm font-semibold text-slate-900">
                        {r.requesterName || '—'}
                      </td>
                      <td className="px-2 py-2.5 text-sm text-slate-700">{r.studentName || '—'}</td>
                      <td className="px-2 py-2.5 text-sm text-slate-700">
                        {r.requestedClassName ?? '—'}
                      </td>
                      <td className="px-2 py-2.5 text-sm capitalize text-slate-700">
                        {r.requestType === 'rattachement' ? 'Rattachement' : 'Inscription'}
                      </td>
                      <td className="px-2 py-2.5">
                        <StatusBadge status={r.status} size="sm" />
                      </td>
                      <td className="px-2 py-2.5 text-xs text-slate-500">
                        {formatDateShortFr(r.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link
            href="/admin/enrollment-requests"
            className="mt-4 inline-flex items-center gap-1 text-xs font-bold accent-text hover:underline"
          >
            Voir toutes les demandes
          </Link>
        </section>
      </div>

      {/* ─── Row 3: Affectations + Donut + Règles ─── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Affectations professeurs */}
        <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/60 shadow-sm">
          <SectionHeader
            title="Affectations professeurs"
            actionLabel="Voir toutes"
            actionHref="/admin/teaching-assignments"
          />
          {(dashboard?.teachingAssignmentsSummary?.length ?? 0) === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Aucune affectation pour le moment.</p>
          ) : (
            <div className="-mx-2 mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-2 py-2">Professeur</th>
                    <th className="px-2 py-2">Matière</th>
                    <th className="px-2 py-2">Classe(s)</th>
                    <th className="px-2 py-2">Charge</th>
                    <th className="px-2 py-2">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dashboard!.teachingAssignmentsSummary.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/60">
                      <td className="px-2 py-2.5 text-sm font-semibold text-slate-900">
                        {a.teacherName}
                      </td>
                      <td className="px-2 py-2.5 text-sm text-slate-700">{a.subjectName}</td>
                      <td className="px-2 py-2.5 text-sm text-slate-700">
                        {a.classes.join(', ')}
                      </td>
                      <td className="px-2 py-2.5 text-sm text-slate-700">
                        {a.weeklyHours != null ? `${a.weeklyHours}h` : '—'}
                      </td>
                      <td className="px-2 py-2.5">
                        <StatusBadge
                          label={a.status === 'active' ? 'Actif' : 'En surcharge'}
                          tone={a.status === 'active' ? 'success' : 'danger'}
                          size="sm"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link
            href="/admin/teaching-assignments"
            className="mt-4 inline-flex items-center gap-1 text-xs font-bold accent-text hover:underline"
          >
            Voir toutes les affectations
          </Link>
        </section>

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

        {/* Règles d'alerte */}
        <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/60 shadow-sm">
          <SectionHeader
            title="Règles d'alerte"
            actionLabel="Voir toutes"
            actionHref="/admin/alerts"
          />
          <div className="-mx-2 mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-2 py-2">Code</th>
                  <th className="px-2 py-2">Nom de la règle</th>
                  <th className="px-2 py-2">Condition</th>
                  <th className="px-2 py-2">Sévérité</th>
                  <th className="px-2 py-2">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(dashboard?.alertRules ?? []).map((r) => (
                  <tr key={r.code} className="hover:bg-slate-50/60">
                    <td className="px-2 py-2.5 font-mono text-[11px] font-bold uppercase tracking-tight text-slate-700">
                      {r.code}
                    </td>
                    <td className="px-2 py-2.5 text-sm font-semibold text-slate-900">{r.label}</td>
                    <td className="px-2 py-2.5 text-[12px] text-slate-600">{r.condition}</td>
                    <td className="px-2 py-2.5">
                      <StatusBadge
                        label={
                          r.severity === 'high'
                            ? 'Élevée'
                            : r.severity === 'medium'
                              ? 'Moyenne'
                              : 'Faible'
                        }
                        tone={r.severity === 'high' ? 'danger' : r.severity === 'medium' ? 'warning' : 'sky'}
                        size="sm"
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      <StatusBadge
                        label={r.status === 'active' ? 'Active' : 'Inactive'}
                        tone={r.status === 'active' ? 'success' : 'neutral'}
                        size="sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link
            href="/admin/alerts"
            className="mt-4 inline-flex items-center gap-1 text-xs font-bold accent-text hover:underline"
          >
            Gérer les règles d&apos;alerte
          </Link>
        </section>
      </div>

      {/* ─── Row 4: Audit + Exports ─── */}
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

        <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/60 shadow-sm">
          <SectionHeader
            title="Exports récents"
            actionLabel="Voir tous"
            actionHref="/admin/exports"
          />
          {(dashboard?.recentExports?.length ?? 0) === 0 ? (
            <EmptyState
              icon={Download}
              title="Aucun export récent"
              description="Les exports XLSX/PDF apparaîtront ici dès qu'ils auront été générés."
              tone="slate"
              className="mt-3"
            />
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-slate-100">
              {dashboard!.recentExports.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-3">
                  <span
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      e.kind === 'pdf'
                        ? 'bg-rose-50 text-rose-600'
                        : e.kind === 'xlsx'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {e.kind === 'pdf' ? (
                      <FileText className="h-4 w-4" />
                    ) : (
                      <FileSpreadsheet className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900">{e.fileName}</div>
                    <div className="text-[11px] text-slate-500">
                      {formatDateShortFr(e.createdAt)} · {e.requesterName ?? '—'}
                    </div>
                  </div>
                  {e.downloadUrl && (
                    <a
                      href={e.downloadUrl}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                      aria-label="Télécharger"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

    </PortalShell>
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
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-5 divide-slate-100 sm:grid-cols-4 sm:divide-x">
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

function formatDateShortFr(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}
