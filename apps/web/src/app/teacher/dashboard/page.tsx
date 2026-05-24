import {
  Atom,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  FilePlus,
  FileSpreadsheet,
  GraduationCap,
  Globe,
  Languages,
  Send,
  Upload,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { fetchMe } from '@/lib/me';
import {
  ActivityTimeline,
  EmptyState,
  QuickActionsList,
  SectionHeader,
  Stagger,
  StaggerItem,
  SubjectKpiCard,
  WelcomeBanner,
  subjectColor,
  type ActivityEntry,
  type QuickAction,
} from '@pilotage/ui';

import { CalendarPanel, type UpcomingItem } from './_components/CalendarPanel';
import { DistributionPanel } from './_components/DistributionPanel';
import {
  InlineGradebook,
  type AssignmentOption,
  type GradebookData,
} from './_components/InlineGradebook';
import { TeacherActionCenter, type TeacherActionData } from './_components/TeacherActionCenter';

export const metadata: Metadata = { title: 'Tableau de bord professeur' };
export const dynamic = 'force-dynamic';

interface TeacherDashboardResponse {
  subjectStats: Array<{
    subjectId: string;
    subjectCode: string;
    subjectName: string;
    subjectColor: string | null;
    classCount: number;
    studentCount: number;
  }>;
  upcomingAssessments: UpcomingItem[];
  recentActivity: Array<{
    id: string;
    action: string;
    resourceType: string;
    createdAt: string;
  }>;
}

interface MyAssignmentsResp {
  data: Array<{
    id: string;
    isMainTeacher: boolean;
    weeklyHours: string | null;
    classSection: {
      id: string;
      name: string;
      gradeLevel: { name: string; cycle: { name: string; color: string | null } };
      _count: { enrollments: number };
    };
    subject: { id: string; code: string; name: string; color: string | null; defaultCoefficient: string };
    academicYear: { id: string; name: string; status: string };
  }>;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const SUBJECT_FALLBACK_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  MATH: BarChart3,
  HIST_GEO: Globe,
  HIST: Globe,
  GEO: Globe,
  PHYS_CHIM: Atom,
  FR: BookOpen,
  ENG: Languages,
};

export default async function TeacherDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string }>;
}) {
  const sp = await searchParams;
  const [me, dashboard, mine, actionCenter] = await Promise.all([
    fetchMe(),
    safe(api<TeacherDashboardResponse>('/api/v1/analytics/teacher-dashboard', { cache: 'no-store' })),
    safe(api<MyAssignmentsResp>('/api/v1/teachers/me/assignments', { cache: 'no-store' })),
    safe(api<TeacherActionData>('/api/v1/analytics/teacher-action-center', { cache: 'no-store' })),
  ]);

  const subjectStats = dashboard?.subjectStats ?? [];
  const upcoming = dashboard?.upcomingAssessments ?? [];
  const assignments = mine?.data ?? [];

  // Pick the active assignment for the inline gradebook
  const assignmentOptions: AssignmentOption[] = assignments.map((a) => ({
    id: a.id,
    className: a.classSection.name,
    subjectName: a.subject.name,
    subjectCode: a.subject.code,
  }));

  const requestedAssignmentId = sp.a;
  const activeAssignmentId =
    (requestedAssignmentId && assignmentOptions.find((o) => o.id === requestedAssignmentId)?.id) ||
    assignmentOptions[0]?.id ||
    null;

  // Fetch gradebook for the active assignment (if any)
  const gradebook = activeAssignmentId
    ? await safe(
        api<GradebookData>(`/api/v1/grades/gradebook/${activeAssignmentId}`, { cache: 'no-store' }),
      )
    : null;

  const activityEntries: ActivityEntry[] = (dashboard?.recentActivity ?? []).map((a) => ({
    id: a.id,
    title: (
      <>
        <span className="font-semibold text-slate-900">{a.action}</span>
        <span className="ml-1 text-slate-500">· {a.resourceType}</span>
      </>
    ),
    date: a.createdAt,
    tone: pickActivityTone(a.action),
  }));

  const quickActions: QuickAction[] = [
    {
      id: 'create-assessment',
      icon: FilePlus,
      label: 'Créer une évaluation',
      href: activeAssignmentId
        ? `/teacher/classes/${activeAssignmentId}/grades`
        : '/teacher/assessments',
      tone: 'blue',
    },
    {
      id: 'import-grades',
      icon: Upload,
      label: 'Importer des notes',
      href: '/admin/imports',
      tone: 'green',
    },
    {
      id: 'generate-report',
      icon: FileSpreadsheet,
      label: 'Générer un rapport',
      href: '/teacher/reports',
      tone: 'amber',
    },
    {
      id: 'send-message',
      icon: Send,
      label: 'Envoyer un message',
      href: '/teacher/messages',
      tone: 'violet',
    },
  ];

  // Group classes by class section for the "Classes enseignées" list
  const classesByGroupKey = new Map<
    string,
    {
      id: string;
      assignmentId: string;
      name: string;
      gradeLevel: string;
      studentCount: number;
      subjects: string[];
    }
  >();
  for (const a of assignments) {
    const key = a.classSection.id;
    const entry = classesByGroupKey.get(key) ?? {
      id: a.classSection.id,
      assignmentId: a.id,
      name: a.classSection.name,
      gradeLevel: a.classSection.gradeLevel?.name ?? '',
      studentCount: a.classSection._count.enrollments,
      subjects: [],
    };
    if (!entry.subjects.includes(a.subject.name)) entry.subjects.push(a.subject.name);
    classesByGroupKey.set(key, entry);
  }
  const classesList = Array.from(classesByGroupKey.values());

  return (
    <PortalShell
      portal="teacher"
      title="Tableau de bord"
      subtitle={`Bienvenue, ${me?.firstName ?? 'Professeur'} 👋`}
    >
      {/* ──────── Welcome hero ──────── */}
      <WelcomeBanner
        icon={GraduationCap}
        title={`Bonjour, ${me?.firstName ?? 'Professeur'} 👋`}
        subtitle="Voici votre espace pédagogique du jour."
        aside={
          <span className="text-sm font-semibold capitalize text-white/90">
            {new Date().toLocaleDateString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </span>
        }
        className="mb-6"
      />

      {/* ──────── Row 0 : action center (only when something needs attention) ──────── */}
      {actionCenter && actionCenter.items.length > 0 && (
        <div className="mb-6">
          <TeacherActionCenter data={actionCenter} />
        </div>
      )}

      {/* ──────── Row 1 : 4 subject KPI cards (cascade entrance) ──────── */}
      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {subjectStats.length === 0 ? (
          <div className="sm:col-span-2 lg:col-span-4">
            <EmptyState
              icon={ClipboardCheck}
              title="Pas encore d'affectation"
              description="Demandez à l'administration de vous rattacher à une classe et une matière depuis /admin/teachers."
              tone="amber"
            />
          </div>
        ) : (
          subjectStats.map((s) => {
            const icon =
              SUBJECT_FALLBACK_ICONS[subjectColor(s.subjectCode).code] ?? BookOpen;
            return (
              <StaggerItem key={s.subjectId}>
                <SubjectKpiCard
                  subjectCode={s.subjectCode}
                  label={s.subjectName}
                  icon={icon}
                  classCount={s.classCount}
                  studentCount={s.studentCount}
                  href={`/teacher/classes?subject=${s.subjectCode}`}
                />
              </StaggerItem>
            );
          })
        )}
      </Stagger>

      {/* ──────── Row 2 : Gradebook + Distribution + Calendar (12-col grid) ──────── */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Inline gradebook — 6 cols */}
        <div className="lg:col-span-6">
          <InlineGradebook
            initial={gradebook}
            assignmentOptions={assignmentOptions}
            selectedAssignmentId={activeAssignmentId}
          />
        </div>

        {/* Distribution + class stats — 3 cols */}
        <div className="lg:col-span-3">
          <DistributionPanel
            averages={(gradebook?.rows ?? []).map((r) => ({
              studentId: r.studentId,
              average: r.average,
            }))}
            classAverage={gradebook?.classAverage ?? null}
          />
        </div>

        {/* Calendar + upcoming — 3 cols */}
        <div className="lg:col-span-3">
          <CalendarPanel upcoming={upcoming} />
        </div>
      </div>

      {/* ──────── Row 3 : bottom panels — classes / activity / tools ──────── */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Classes enseignées */}
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <SectionHeader
            title="Classes enseignées"
            subtitle="Vos affectations cette année"
            actionLabel="Voir toutes mes classes"
            actionHref="/teacher/classes"
          />
          {classesList.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Aucune classe pour le moment.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {classesList.slice(0, 5).map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2.5">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <Users className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-900">{c.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {c.subjects.join(', ')}
                    </div>
                  </div>
                  <span className="font-mono text-xs font-bold tabular-nums text-slate-700">
                    {c.studentCount} élève{c.studentCount > 1 ? 's' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Activité récente */}
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <SectionHeader
            title="Activité récente"
            subtitle="Vos dernières opérations"
          />
          {activityEntries.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              Aucune activité récente. Saisis tes premières notes ou planifie une évaluation.
            </p>
          ) : (
            <div className="mt-3">
              <ActivityTimeline entries={activityEntries.slice(0, 4)} />
            </div>
          )}
        </section>

        {/* Outils rapides */}
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <SectionHeader title="Outils rapides" subtitle="Accès direct aux actions courantes" />
          <div className="mt-3">
            <QuickActionsList actions={quickActions} />
          </div>
          <Link
            href="/teacher/notifications"
            className="mt-3 inline-flex items-center gap-1 text-xs font-bold accent-text hover:underline"
          >
            <GraduationCap className="h-3 w-3" />
            Voir mes notifications →
          </Link>
        </section>
      </div>
    </PortalShell>
  );
}

function pickActivityTone(action: string): ActivityEntry['tone'] {
  const a = action.toLowerCase();
  if (a.includes('publish') || a.includes('create')) return 'green';
  if (a.includes('delete') || a.includes('remove')) return 'rose';
  if (a.includes('revise') || a.includes('update')) return 'amber';
  return 'blue';
}
