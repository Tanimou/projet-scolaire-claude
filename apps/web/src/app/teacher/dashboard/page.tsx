import {
  ActivityTimeline,
  EmptyState,
  ErrorState,
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


import { CalendarPanel, type UpcomingItem } from './_components/CalendarPanel';
import { DistributionPanel } from './_components/DistributionPanel';
import {
  InlineGradebook,
  type AssignmentOption,
  type GradebookData,
} from './_components/InlineGradebook';
import { SchoolEventsPanel } from './_components/SchoolEventsPanel';
import { TeacherActionCenter, type TeacherActionData } from './_components/TeacherActionCenter';

import { PortalShell } from '@/components/PortalShell';
import type { PortalCalendarEvent } from '@/components/calendar/PortalCalendarView';
import { api, isNextNavigationSignal } from '@/lib/api-client';
import { fetchMe } from '@/lib/me';
import { resolveSchoolCalendarAnchor } from '@/lib/school-calendar-anchor';

export const metadata: Metadata = { title: 'Tableau de bord professeur' };
export const dynamic = 'force-dynamic';

interface TeacherDashboardResponse {
  subjectStats: Array<{
    subjectId: string;
    subjectCode: string;
    subjectName: string;
    subjectColor: string | null;
    classCount: number;
    /**
     * Élèves DISTINCTS sur l'ensemble des sections où l'enseignant intervient
     * pour cette matière (S-E03-7 / ADR-079).
     *
     * Le nom porte la question. L'ancien `studentCount` était une **somme
     * cumulative** d'effectifs (`analytics.service.ts` : `+= _count.enrollments`)
     * rendue sous le mot « élèves » : un élève inscrit dans deux des classes de
     * l'enseignant y valait deux. C'est l'écart 46-vs-43 de PF-36, et c'est
     * pourquoi le champ est RENOMMÉ plutôt que corrigé en silence — un `number`
     * nu ne dit pas laquelle des deux questions il répond, le nom si.
     *
     * Ne JAMAIS reconstruire cette valeur en sommant des effectifs de section :
     * la somme ne serait juste que sous l'invariant « au plus une inscription
     * active par élève et par année », qui n'existe pas en base (PF-361/PF-409).
     */
    distinctStudentCount: number;
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
    // Preserve Next.js redirect()/notFound() control-flow (e.g. the api-client
    // 401 → login redirect) — these must propagate uncaught.
    if (isNextNavigationSignal(err)) throw err;
    // Expected API errors (4xx/5xx) AND transient network failures (the API
    // restarting → ECONNRESET / "fetch failed") both degrade to "no data" so
    // the page renders an empty state instead of a server-side exception.
    console.error('[teacher-dashboard] data fetch failed → empty state:', err);
    return null;
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
  const [me, dashboard, mine, actionCenter, calendar] = await Promise.all([
    fetchMe(),
    safe(api<TeacherDashboardResponse>('/api/v1/analytics/teacher-dashboard', { cache: 'no-store' })),
    safe(api<MyAssignmentsResp>('/api/v1/teachers/me/assignments', { cache: 'no-store' })),
    safe(api<TeacherActionData>('/api/v1/analytics/teacher-action-center', { cache: 'no-store' })),
    // School calendar — ABAC-scoped server-side to events the teacher may see
    // (visibility "all" + "staff_only"). Feeds the SchoolEventsPanel.
    safe(api<{ data: PortalCalendarEvent[] }>('/api/v1/calendar/events', { cache: 'no-store' })),
  ]);

  // `safe()` rend `null` quand la lecture échoue — ce qui est une phrase
  // différente de « la lecture a réussi et il n'y a rien ». Les deux menaient
  // jusqu'ici au MÊME écran (« Pas encore d'affectation »), donc une panne se
  // lisait comme un fait sur l'enseignant.
  const dashboardUnavailable = dashboard === null;
  const subjectStats = dashboard?.subjectStats ?? [];
  const upcoming = dashboard?.upcomingAssessments ?? [];
  const assignments = mine?.data ?? [];
  const schoolEvents = calendar?.data ?? [];
  // Instant de référence unique de la requête (S-E03-8 / PF-40 / ADR-078),
  // résolu UNE fois, côté serveur, dans le fuseau DÉCLARÉ de l'école.
  //
  // Qui le reçoit, exactement — et la précision EST le sujet. Le panneau « Vie
  // de l'école » (:318) le reçoit. Le mini-calendrier des ÉVALUATIONS
  // (`CalendarPanel`, :313) NE LE REÇOIT PAS : il est `'use client'` et lit
  // encore `new Date()` au rendu. C'est la dette `PF-403`, déclarée par le
  // cliquet du MÊME diff ; sa population est celle des évaluations, donc un
  // autre invariant et une autre tranche.
  //
  // Une version antérieure de ce commentaire affirmait que les deux panneaux se
  // partageaient l'ancre. C'était faux — et un commentaire qui affirme plus que
  // le code ne fait est exactement la classe que cette tranche corrige ailleurs,
  // avec ceci de pire qu'il survit aux relectures et devient la référence.
  const calendarAnchor = resolveSchoolCalendarAnchor();

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

  // Group classes by class section for the "Classes enseignées" list.
  //
  // `rosterSize` — et non `studentCount` — parce que c'est l'EFFECTIF d'UNE
  // section, pas un nombre d'élèves distincts sur un ENSEMBLE de sections
  // (S-E03-7 / ADR-079). Les deux questions se ressemblent au point d'avoir
  // porté le même nom sur cette page même : la carte matière au-dessus répond à
  // la seconde. Le regroupement est clé-par-section, donc les valeurs de cette
  // liste ne se somment JAMAIS pour obtenir « mes élèves » — un élève présent
  // dans deux de ces classes apparaîtrait deux fois.
  const classesByGroupKey = new Map<
    string,
    {
      id: string;
      assignmentId: string;
      name: string;
      gradeLevel: string;
      rosterSize: number;
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
      rosterSize: a.classSection._count.enrollments,
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
        {dashboardUnavailable ? (
          // « Nous n'avons pas pu lire » ≠ « nous avons lu, il n'y a rien ».
          // Rendre l'échec de lecture comme « pas encore d'affectation » serait
          // une AFFIRMATION sur la carrière de l'enseignant produite par une
          // panne réseau — la classe de défaut que S-E03-3d a fermée côté
          // parent. Les deux phrases sont désormais distinctes.
          <div className="sm:col-span-2 lg:col-span-4">
            <ErrorState
              title="Vos matières sont momentanément indisponibles"
              description="La lecture de vos affectations a échoué. Ce n'est pas une absence d'affectation : aucun chiffre n'est affiché tant que la mesure n'a pas été lue. Rechargez la page dans un instant."
            />
          </div>
        ) : subjectStats.length === 0 ? (
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
                  studentCount={s.distinctStudentCount}
                  // La PORTÉE du nombre, rendue sous lui — jamais un tooltip
                  // (invisible au doigt, peu fiable pour les technologies
                  // d'assistance). Ce chiffre CHANGE de dérivation dans cette
                  // tranche (somme cumulative d'effectifs → élèves distincts) :
                  // le laisser bouger en silence aurait été pire que la
                  // divergence qu'il corrige.
                  scope={`Élèves distincts sur vos ${s.classCount} classe${
                    s.classCount > 1 ? 's' : ''
                  } de ${s.subjectName} — un élève présent dans deux d'entre elles n'est compté qu'une fois.`}
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

      {/* ──────── Row 2.5 : school calendar events (only when upcoming exist) ──────── */}
      <SchoolEventsPanel events={schoolEvents} anchor={calendarAnchor} />

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
                    {c.rosterSize} élève{c.rosterSize > 1 ? 's' : ''}
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
