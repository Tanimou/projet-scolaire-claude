import {
  AlertTriangle,
  CalendarCheck2,
  ClipboardCheck,
  Sparkles,
  UserMinus,
} from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { EmptyState, KpiCard, PageHeader } from '@pilotage/ui';

import { AttendanceManager } from './AttendanceManager';
import { HistoricSessionsPanel } from './HistoricSessionsPanel';
import { StudentsToWatchPanel } from './StudentsToWatchPanel';
import type { AttendanceWorkspaceData } from './types';

export const metadata: Metadata = { title: 'Présences' };
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

interface Assignment {
  id: string;
  classSection: {
    id: string;
    name: string;
    gradeLevel: { name: string; cycle?: { name: string; color?: string | null } | null } | null;
    _count?: { enrollments: number };
  };
  subject: {
    id: string;
    name: string;
    color?: string | null;
    code?: string | null;
  };
}

interface MyAssignmentsResp {
  data: Assignment[];
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

function presenceRate(s: AttendanceWorkspaceData['sessions'][number]): number | null {
  if (s.recordedTotal <= 0) return null;
  return ((s.counts.present + s.counts.late) / s.recordedTotal) * 100;
}

function rateKpiTone(rate: number | null): 'green' | 'sky' | 'amber' | 'rose' | 'slate' {
  if (rate == null) return 'slate';
  if (rate >= 95) return 'green';
  if (rate >= 85) return 'sky';
  if (rate >= 75) return 'amber';
  return 'rose';
}

export default async function AttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [mine, workspace] = await Promise.all([
    api<MyAssignmentsResp>('/api/v1/teachers/me/assignments', { cache: 'no-store' }),
    safe(
      api<AttendanceWorkspaceData>(
        `/api/v1/class-sessions?teachingAssignmentId=${id}&limit=200`,
        { cache: 'no-store' },
      ),
    ),
  ]);

  const assignment = mine.data.find((a) => a.id === id);
  const sessions = workspace?.sessions ?? [];
  const students = workspace?.students ?? [];
  const classSize = workspace?.classSize ?? assignment?.classSection._count?.enrollments ?? 0;

  // ---- 30-day window for KPIs ---------------------------------------------
  const now = Date.now();
  const cutoff30 = now - 30 * DAY_MS;
  const cutoff7 = now - 7 * DAY_MS;

  const recentSessions = sessions.filter((s) => new Date(s.date).getTime() >= cutoff30);
  const heldSessions = recentSessions.filter((s) => !s.cancelled);
  const heldCount = heldSessions.length;

  let totalPresent = 0;
  let totalRecorded = 0;
  for (const s of heldSessions) {
    totalRecorded += s.recordedTotal;
    totalPresent += s.counts.present + s.counts.late;
  }
  const avgRate = totalRecorded > 0 ? (totalPresent / totalRecorded) * 100 : null;

  const recentUnjustified = sessions
    .filter((s) => new Date(s.date).getTime() >= cutoff7 && !s.cancelled)
    .reduce((acc, s) => acc + s.unjustifiedAbsences, 0);

  // Students who, across the windowed sessions, accumulated ≥3 absences/lates.
  const studentsToWatch = students.filter(
    (s) =>
      s.stats.absent + s.stats.absentExcused >= 3 ||
      s.stats.absent + s.stats.late >= 4 ||
      s.stats.absent >= 2,
  ).length;

  const totalSessionsForWatchPanel = sessions.filter((s) => !s.cancelled).length;

  // ---- Visual identity ----------------------------------------------------
  const subjectColor = assignment?.subject.color ?? assignment?.classSection.gradeLevel?.cycle?.color ?? null;
  const subjectTile = subjectColor
    ? { backgroundColor: `${subjectColor}1A`, color: subjectColor }
    : { backgroundColor: '#E0F2FE', color: '#0369A1' };

  const subtitle = assignment
    ? `${assignment.classSection.gradeLevel?.name ?? ''} · ${assignment.subject.name}`.trim()
    : 'Faites l’appel et consultez l’historique des séances.';

  // ---- Action strip --------------------------------------------------------
  const showActionStrip = recentUnjustified > 0 || studentsToWatch > 0;

  if (!assignment) {
    return (
      <PortalShell portal="teacher">
        <PageHeader
          breadcrumb={[
            { label: 'Tableau de bord', href: '/teacher/dashboard' },
            { label: 'Mes classes', href: '/teacher/classes' },
            { label: 'Présences' },
          ]}
          title="Présences"
        />
        <div className="mt-6">
          <EmptyState
            icon={CalendarCheck2}
            title="Affectation introuvable"
            description="Cette classe n'apparaît pas dans vos affectations. Retournez à votre tableau de bord."
            tone="slate"
            action={{ label: 'Retour au tableau de bord', href: '/teacher/dashboard' }}
          />
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Mes classes', href: '/teacher/classes' },
          {
            label: `${assignment.classSection.name} · ${assignment.subject.name}`,
            href: `/teacher/classes/${id}`,
          },
          { label: 'Présences' },
        ]}
        title="Présences"
        subtitle={subtitle}
        leading={
          <span
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl"
            style={subjectTile}
          >
            <CalendarCheck2 className="h-5 w-5" />
          </span>
        }
      />

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={CalendarCheck2}
          tone="blue"
          label="SÉANCES TENUES"
          value={heldCount}
        >
          {heldCount > 0
            ? `Sur les 30 derniers jours · ${classSize} élève${classSize > 1 ? 's' : ''} inscrits`
            : 'Aucune séance sur 30 j'}
        </KpiCard>
        <KpiCard
          icon={Sparkles}
          tone={rateKpiTone(avgRate)}
          label="TAUX DE PRÉSENCE"
          value={avgRate != null ? `${Math.round(avgRate)} %` : '—'}
        >
          {avgRate != null
            ? `${totalPresent} présent${totalPresent > 1 ? 's' : ''} / ${totalRecorded} appels`
            : 'En attente d’appels'}
        </KpiCard>
        <KpiCard
          icon={AlertTriangle}
          tone={recentUnjustified > 0 ? 'rose' : 'slate'}
          label="ABS. NON JUSTIFIÉES"
          value={recentUnjustified}
        >
          {recentUnjustified > 0
            ? `À justifier · 7 derniers jours`
            : 'Aucune sur 7 derniers jours'}
        </KpiCard>
        <KpiCard
          icon={UserMinus}
          tone={studentsToWatch > 0 ? 'amber' : 'slate'}
          label="ÉLÈVES À SUIVRE"
          value={studentsToWatch}
        >
          {studentsToWatch > 0
            ? `≥ 3 absences ou retards cumulés`
            : 'Aucun cumul préoccupant'}
        </KpiCard>
      </div>

      {/* Action strip */}
      {showActionStrip && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50/70 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm text-orange-900">
            <p className="font-bold">
              {recentUnjustified > 0 && studentsToWatch > 0
                ? `${recentUnjustified} absence${recentUnjustified > 1 ? 's' : ''} à justifier · ${studentsToWatch} élève${studentsToWatch > 1 ? 's' : ''} à suivre`
                : recentUnjustified > 0
                  ? `${recentUnjustified} absence${recentUnjustified > 1 ? 's' : ''} non justifiée${recentUnjustified > 1 ? 's' : ''} sur 7 jours`
                  : `${studentsToWatch} élève${studentsToWatch > 1 ? 's' : ''} cumulant des absences ou retards`}
            </p>
            <p className="mt-0.5 text-xs text-orange-800/80">
              Saisissez les justifications côté administration, et étudiez les tendances dans l’historique pour anticiper le décrochage.
            </p>
          </div>
        </div>
      )}

      {/* Main 2-col layout */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className="space-y-4 lg:col-span-3">
          <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200/60">
            <header className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-teal-600">
                <ClipboardCheck className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-bold text-slate-800">Faire l’appel</h2>
                <p className="text-[11px] text-slate-500">
                  Ouvrez ou rechargez une séance, puis enregistrez les présences en un clic.
                </p>
              </div>
            </header>
            <div className="mt-4">
              <AttendanceManager teachingAssignmentId={id} />
            </div>
          </div>
        </section>

        <aside className="space-y-6 lg:col-span-2">
          <HistoricSessionsPanel sessions={sessions} />
        </aside>
      </div>

      {/* Students to watch */}
      <div className="mt-6">
        <StudentsToWatchPanel students={students} totalSessions={totalSessionsForWatchPanel} />
      </div>
    </PortalShell>
  );
}
