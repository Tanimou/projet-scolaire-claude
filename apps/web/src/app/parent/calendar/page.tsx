import { CalendarRange, GraduationCap, PartyPopper, School, Sun, Users } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import {
  PortalCalendarView,
  type PortalCalendarEvent,
} from '@/components/calendar/PortalCalendarView';
import { api, ApiError } from '@/lib/api-client';
import { EmptyState, PageHeader } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Calendrier scolaire' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/** Enfant rattaché au parent (sous-ensemble renvoyé par `GET /students`). */
interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
}

/**
 * Évaluation à venir telle que renvoyée par `GET /analytics/parent-upcoming/:id`.
 * On ne déclare que les champs réellement consommés ici (le endpoint en renvoie
 * davantage) pour rester découplé du workspace `/parent/upcoming`.
 */
interface ParentUpcomingItem {
  id: string;
  title: string;
  subjectName: string;
  kind: string;
  scheduledAt: string;
  coefficient: number;
  maxScore: number;
  termName: string | null;
  description: string | null;
  classSectionName: string | null;
}

interface ParentUpcomingResp {
  data: ParentUpcomingItem[];
  classSectionName: string | null;
  gradeLevelName: string | null;
}

const KIND_LABEL: Record<string, string> = {
  written_test: 'Contrôle écrit',
  oral: 'Oral',
  homework: 'Devoir maison',
  project: 'Projet',
  participation: 'Participation',
  practical: 'TP',
  other: 'Autre',
};

/** Durée par défaut (1 h) d'un créneau d'évaluation mappé sur le calendrier. */
const EVAL_DURATION_MS = 60 * 60 * 1000;

/**
 * Mappe une évaluation à venir sur un `PortalCalendarEvent` synthétique de type
 * `evaluation`. Ainsi les évaluations spécifiques à l'enfant apparaissent dans
 * la même grille mensuelle, la liste « À venir » et l'export ICS que le planning
 * officiel de l'école — tout en restant visuellement distinctes.
 */
function evaluationToCalendarEvent(
  u: ParentUpcomingItem,
  childName: string | null,
): PortalCalendarEvent {
  const start = new Date(u.scheduledAt);
  const end = new Date(start.getTime() + EVAL_DURATION_MS);
  const kindLabel = KIND_LABEL[u.kind] ?? u.kind;
  const descriptionLines = [
    `Matière : ${u.subjectName}`,
    `Format : ${kindLabel}`,
    `Coefficient : ×${u.coefficient} · Barème : /${u.maxScore}`,
    u.termName ? `Période : ${u.termName}` : null,
    childName ? `Élève : ${childName}` : null,
    u.description ? `\n${u.description}` : null,
  ].filter((line): line is string => Boolean(line));

  return {
    id: `eval-${u.id}`,
    title: `${u.subjectName} — ${u.title}`,
    description: descriptionLines.join('\n'),
    type: 'evaluation',
    // Une évaluation cible la classe de l'enfant : portée « classe ».
    scope: 'class_section_scope',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    allDay: false,
    color: null,
    classSection: u.classSectionName ? { name: u.classSectionName } : null,
  };
}

export default async function ParentCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  const sp = await searchParams;

  // 1) Enfants du parent — sert à choisir l'enfant actif pour les évaluations.
  const studentsResp = await safe(
    api<{ data: StudentSummary[] }>('/api/v1/students', { cache: 'no-store' }),
  );
  const children = studentsResp?.data ?? [];
  const activeChild =
    (sp.studentId && children.find((c) => c.id === sp.studentId)) || children[0] || null;
  const activeChildName = activeChild
    ? `${activeChild.firstName} ${activeChild.lastName}`.trim()
    : null;

  // 2) Planning officiel de l'école — déjà filtré côté API par l'ABAC de
  //    visibilité (parent → `all` + portées : école entière OU classes des
  //    enfants). Les events staff_only / admin_only ne remontent jamais.
  const calendarResp = await safe(
    api<{ data: PortalCalendarEvent[] }>('/api/v1/calendar/events', { cache: 'no-store' }),
  );
  const officialEvents = calendarResp?.data ?? [];

  // 3) Évaluations à venir de l'enfant actif — fusionnées dans la vue calendrier.
  const upcomingResp = activeChild
    ? await safe(
        api<ParentUpcomingResp>(`/api/v1/analytics/parent-upcoming/${activeChild.id}`, {
          cache: 'no-store',
        }),
      )
    : null;
  const evaluationEvents = (upcomingResp?.data ?? []).map((u) =>
    evaluationToCalendarEvent(u, activeChildName),
  );

  const allEvents = [...officialEvents, ...evaluationEvents];

  // Comptes par grande catégorie pour la bande de synthèse (sections claires).
  const count = (predicate: (e: PortalCalendarEvent) => boolean) => allEvents.filter(predicate).length;
  const sections = [
    {
      key: 'school',
      label: "Planning de l'école",
      hint: "Toute l'établissement",
      icon: School,
      tone: 'bg-sky-50 text-sky-700 ring-sky-200',
      value: count((e) => e.scope === 'school_wide'),
    },
    {
      key: 'class',
      label: "Classe de l'enfant",
      hint: activeChildName ?? 'Événements de classe',
      icon: Users,
      tone: 'bg-blue-50 text-blue-700 ring-blue-200',
      value: count((e) => e.type !== 'evaluation' && e.scope === 'class_section_scope'),
    },
    {
      key: 'evaluations',
      label: 'Évaluations à venir',
      hint: activeChildName ? `Pour ${activeChildName}` : 'Contrôles & devoirs',
      icon: GraduationCap,
      tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
      value: count((e) => e.type === 'evaluation'),
    },
    {
      key: 'vacation',
      label: 'Vacances & jours fériés',
      hint: 'Périodes sans cours',
      icon: Sun,
      tone: 'bg-amber-50 text-amber-700 ring-amber-200',
      value: count((e) => e.type === 'vacation_break' || e.type === 'public_holiday'),
    },
    {
      key: 'meetings',
      label: 'Réunions parents / profs',
      hint: 'Rencontres & cérémonies',
      icon: PartyPopper,
      tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
      value: count((e) => e.type === 'meeting' || e.type === 'ceremony'),
    },
  ];

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Calendrier scolaire' },
        ]}
        title="Calendrier scolaire"
        subtitle="Planning de l'école, événements de la classe de votre enfant, évaluations à venir, vacances et réunions parents / professeurs"
      />

      {/* Bande de synthèse — repère d'un coup d'œil les grandes catégories. */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.key}
              className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200/60"
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ${s.tone}`}>
                <Icon className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-bold tabular-nums text-slate-900">{s.value}</span>
                  <span className="truncate text-xs font-semibold text-slate-700">{s.label}</span>
                </div>
                <p className="truncate text-[11px] text-slate-500">{s.hint}</p>
              </div>
            </div>
          );
        })}
      </div>

      {children.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="Aucun enfant rattaché"
          description="Le calendrier de l'établissement reste consultable ci-dessous ; les évaluations spécifiques apparaîtront dès qu'un enfant sera lié à votre compte."
          tone="amber"
          className="mt-6"
        />
      ) : null}

      <PortalCalendarView portal="parent" events={allEvents} />
    </PortalShell>
  );
}
