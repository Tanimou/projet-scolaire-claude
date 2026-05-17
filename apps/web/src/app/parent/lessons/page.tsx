import { AlarmClock, BookOpen, ClipboardList, NotebookPen, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { EmptyState, KpiCard, PageHeader, Pagination, formatDateLong } from '@pilotage/ui';

import { ChildSelector } from '../_components/ChildSelector';
import { LessonCard } from './LessonCard';
import { LessonsFilters } from './LessonsFilters';
import type { LessonRow, LessonsPeriod, SubjectOption } from './types';

export const metadata: Metadata = { title: 'Cahier de texte' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 12;
const VALID_PERIODS: LessonsPeriod[] = ['week', 'month', 'all', 'homework'];

/**
 * Start of the current ISO week (Monday).
 */
function startOfWeek(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday-based
  d.setDate(d.getDate() + diff);
  return d;
}

function startOfMonth(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function ParentLessonsPage({
  searchParams,
}: {
  searchParams: Promise<{
    studentId?: string;
    period?: string;
    subjectId?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const period: LessonsPeriod = VALID_PERIODS.includes(sp.period as LessonsPeriod)
    ? (sp.period as LessonsPeriod)
    : 'month';

  // Step 1: load children to power the ChildSelector
  const studentsResp = await safe(
    api<{ data: StudentSummary[] }>('/api/v1/students', { cache: 'no-store' }),
  );
  const children = studentsResp?.data ?? [];

  if (children.length === 0) {
    return (
      <PortalShell portal="parent">
        <PageHeader
          breadcrumb={[
            { label: 'Tableau de bord', href: '/parent/dashboard' },
            { label: 'Cahier de texte' },
          ]}
          title="Cahier de texte"
        />
        <EmptyState
          icon={NotebookPen}
          title="Aucun enfant rattaché"
          description="Le cahier de texte apparaîtra ici dès qu'un enfant sera lié à votre compte."
          tone="amber"
          className="mt-6"
        />
      </PortalShell>
    );
  }

  const activeStudentId =
    sp.studentId && children.find((c) => c.id === sp.studentId)
      ? sp.studentId
      : children[0]!.id;

  // Step 2: load all recent lessons for this student (server applies ABAC)
  const lessonsResp = await safe(
    api<{ data: LessonRow[] }>(
      `/api/v1/lessons?studentId=${activeStudentId}&limit=200`,
      { cache: 'no-store' },
    ),
  );
  const allLessons = lessonsResp?.data ?? [];

  // Step 3: derive subjects from the loaded set for the SubjectFilter
  const subjectMap = new Map<string, SubjectOption>();
  for (const l of allLessons) {
    const s = l.teachingAssignment.subject;
    if (!subjectMap.has(s.id)) {
      subjectMap.set(s.id, { id: s.id, name: s.name, color: s.color });
    }
  }
  const subjects = Array.from(subjectMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'fr'),
  );

  const activeSubjectId =
    sp.subjectId && subjectMap.has(sp.subjectId) ? sp.subjectId : '';

  // Step 4: compute KPIs from the full set (not affected by filters so the
  // overview stays stable while the user narrows the list)
  const now = new Date();
  const weekStart = startOfWeek(now);
  const todayMs = new Date(now);
  todayMs.setHours(0, 0, 0, 0);

  const lessonsThisWeek = allLessons.filter((l) => new Date(l.date) >= weekStart).length;

  const homeworkUpcoming = allLessons.filter((l) => {
    if (!l.homework) return false;
    if (!l.homeworkDueAt) return true; // open homework counts as "to do"
    const due = new Date(l.homeworkDueAt);
    due.setHours(0, 0, 0, 0);
    return due.getTime() >= todayMs.getTime();
  }).length;

  const homeworkOverdue = allLessons.filter((l) => {
    if (!l.homework || !l.homeworkDueAt) return false;
    const due = new Date(l.homeworkDueAt);
    due.setHours(0, 0, 0, 0);
    return due.getTime() < todayMs.getTime();
  }).length;

  // Step 5: apply filters (period + subject)
  const filtered = allLessons
    .filter((l) => {
      if (period === 'homework') return !!l.homework;
      if (period === 'week') return new Date(l.date) >= weekStart;
      if (period === 'month') return new Date(l.date) >= startOfMonth(now);
      return true; // 'all'
    })
    .filter((l) => (activeSubjectId ? l.teachingAssignment.subject.id === activeSubjectId : true));

  const total = filtered.length;
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  // Step 6: group displayed rows by date (already desc-sorted by backend)
  const grouped = pageRows.reduce<Array<{ key: string; date: string; rows: LessonRow[] }>>(
    (acc, row) => {
      const key = row.date.slice(0, 10);
      const last = acc[acc.length - 1];
      if (last && last.key === key) {
        last.rows.push(row);
      } else {
        acc.push({ key, date: row.date, rows: [row] });
      }
      return acc;
    },
    [],
  );

  const periodHint =
    period === 'week'
      ? 'Cette semaine'
      : period === 'month'
        ? 'Ce mois-ci'
        : period === 'homework'
          ? 'Devoirs uniquement'
          : 'Toute la période';

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Cahier de texte' },
        ]}
        title="Cahier de texte"
        subtitle="Ce qui a été fait en classe et les devoirs à faire — mis à jour par les enseignants"
      />

      <div className="mt-4">
        <ChildSelector items={children} activeStudentId={activeStudentId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={BookOpen} tone="blue" label="TOTAL" value={allLessons.length}>
          Entrées chargées
        </KpiCard>
        <KpiCard icon={Sparkles} tone="violet" label="CETTE SEMAINE" value={lessonsThisWeek}>
          Nouvelles entrées
        </KpiCard>
        <KpiCard icon={ClipboardList} tone="amber" label="DEVOIRS À FAIRE" value={homeworkUpcoming}>
          Avec deadline à venir
        </KpiCard>
        <KpiCard icon={AlarmClock} tone="rose" label="EN RETARD" value={homeworkOverdue}>
          Devoirs dépassés
        </KpiCard>
      </div>

      <div className="mt-6">
        <LessonsFilters
          subjects={subjects}
          period={period}
          subjectId={activeSubjectId}
        />
      </div>

      <section className="mt-6">
        {pageRows.length === 0 ? (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
            <EmptyState
              icon={NotebookPen}
              title={
                allLessons.length === 0
                  ? 'Aucune entrée pour le moment'
                  : 'Aucune entrée avec ces filtres'
              }
              description={
                allLessons.length === 0
                  ? 'Les enseignants mettront à jour le cahier de texte ici dès que les premiers cours auront eu lieu.'
                  : 'Essayez d’élargir la période ou de retirer le filtre matière pour afficher plus d’entrées.'
              }
              tone="slate"
            />
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <div key={group.key}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span className="h-px flex-1 bg-slate-200" aria-hidden />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {formatDateLong(group.date)}
                  </span>
                  <span className="h-px flex-1 bg-slate-200" aria-hidden />
                </div>
                <div className="space-y-3">
                  {group.rows.map((l) => (
                    <LessonCard key={l.id} lesson={l} now={now} />
                  ))}
                </div>
              </div>
            ))}
            <Pagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'entrée', plural: 'entrées' }}
            />
          </div>
        )}
      </section>

      <p className="mt-4 text-[11px] text-slate-500">
        Filtre actif : <span className="font-bold text-slate-700">{periodHint}</span>
        {activeSubjectId && subjectMap.get(activeSubjectId) && (
          <>
            {' '}· Matière :{' '}
            <span className="font-bold text-slate-700">
              {subjectMap.get(activeSubjectId)!.name}
            </span>
          </>
        )}
      </p>
    </PortalShell>
  );
}
