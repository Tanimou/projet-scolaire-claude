import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  ClipboardEdit,
  FileText,
  Filter,
  Sparkles,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';
import { EmptyState, KpiCard } from '@pilotage/ui';

import { LessonsFilters } from './LessonsFilters';
import { LessonsManager } from './LessonsManager';
import type {
  HomeworkFilter,
  Lesson,
  PeriodFilter,
  SortKey,
  StatusFilter,
} from './types';

export const metadata: Metadata = { title: 'Cahier de texte' };
export const dynamic = 'force-dynamic';

interface MyAssignmentsResp {
  data: Array<{
    id: string;
    classSection: { name: string; gradeLevel: { name: string; cycle: { name: string } } };
    subject: { name: string };
  }>;
}

const VALID_STATUSES: ReadonlyArray<StatusFilter> = ['', 'published', 'draft'];
const VALID_PERIODS: ReadonlyArray<PeriodFilter> = ['', '7d', '30d', '90d', 'term'];
const VALID_HOMEWORK: ReadonlyArray<HomeworkFilter> = [
  '',
  'with',
  'without',
  'due-soon',
  'overdue',
];
const VALID_SORTS: ReadonlyArray<SortKey> = ['date-desc', 'date-asc', 'title-asc'];

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Naïve french school term boundary — Sept→Dec, Jan→Mar, Apr→Jun. */
function termStart(now: Date): Date {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  if (m >= 8) return new Date(y, 8, 1); // Sept 1
  if (m >= 3) return new Date(y, 3, 1); // Apr 1
  return new Date(y, 0, 1); // Jan 1
}

function periodFloor(period: PeriodFilter, now: Date): Date | null {
  if (period === '7d') return new Date(now.getTime() - 7 * DAY_MS);
  if (period === '30d') return new Date(now.getTime() - 30 * DAY_MS);
  if (period === '90d') return new Date(now.getTime() - 90 * DAY_MS);
  if (period === 'term') return termStart(now);
  return null;
}

function matchesHomework(l: Lesson, filter: HomeworkFilter, now: Date): boolean {
  if (!filter) return true;
  const hasHw = !!(l.homework && l.homework.trim());
  if (filter === 'with') return hasHw;
  if (filter === 'without') return !hasHw;
  if (filter === 'due-soon') {
    if (!hasHw || !l.homeworkDueAt) return false;
    const due = new Date(l.homeworkDueAt);
    const today = startOfDay(now);
    return due >= today && due <= new Date(today.getTime() + 7 * DAY_MS);
  }
  if (filter === 'overdue') {
    if (!hasHw || !l.homeworkDueAt) return false;
    const due = new Date(l.homeworkDueAt);
    return due < startOfDay(now);
  }
  return true;
}

function sortLessons(rows: Lesson[], sort: SortKey): Lesson[] {
  const arr = rows.slice();
  switch (sort) {
    case 'date-asc':
      return arr.sort((a, b) => a.date.localeCompare(b.date));
    case 'title-asc':
      return arr.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    case 'date-desc':
    default:
      return arr.sort((a, b) => b.date.localeCompare(a.date));
  }
}

function monthKey(iso: string): string {
  // YYYY-MM (used for grouping, sorts naturally).
  return iso.slice(0, 7);
}

function formatMonthLabel(iso: string): string {
  try {
    const d = new Date(`${iso}-01T00:00:00`);
    const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return iso;
  }
}

export default async function LessonsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    q?: string;
    status?: string;
    period?: string;
    homework?: string;
    sort?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [lessons, mine] = await Promise.all([
    api<{ data: Lesson[] }>(`/api/v1/lessons?teachingAssignmentId=${id}&limit=200`, {
      cache: 'no-store',
    }),
    api<MyAssignmentsResp>('/api/v1/teachers/me/assignments', { cache: 'no-store' }),
  ]);
  const a = mine.data.find((x) => x.id === id);
  const allLessons = lessons.data;

  // --- Filters from URL --------------------------------------------------
  const search = (sp.q ?? '').trim().toLowerCase();
  const status: StatusFilter = VALID_STATUSES.includes(sp.status as StatusFilter)
    ? (sp.status as StatusFilter)
    : '';
  const period: PeriodFilter = VALID_PERIODS.includes(sp.period as PeriodFilter)
    ? (sp.period as PeriodFilter)
    : '';
  const homework: HomeworkFilter = VALID_HOMEWORK.includes(sp.homework as HomeworkFilter)
    ? (sp.homework as HomeworkFilter)
    : '';
  const sort: SortKey = VALID_SORTS.includes(sp.sort as SortKey)
    ? (sp.sort as SortKey)
    : 'date-desc';

  const now = new Date();
  const today = startOfDay(now);
  const sevenDaysAgo = new Date(today.getTime() - 7 * DAY_MS);

  // --- Stable KPIs (on unfiltered slice) ---------------------------------
  const publishedCount = allLessons.filter((l) => l.status === 'published').length;
  const draftCount = allLessons.filter((l) => l.status === 'draft').length;
  const withHomeworkCount = allLessons.filter((l) => !!(l.homework && l.homework.trim())).length;
  const dueSoonCount = allLessons.filter((l) => matchesHomework(l, 'due-soon', now)).length;
  const overdueCount = allLessons.filter((l) => matchesHomework(l, 'overdue', now)).length;
  const thisWeekCount = allLessons.filter((l) => {
    const d = new Date(l.date);
    return d >= sevenDaysAgo && d <= now;
  }).length;
  const lastEntry = allLessons[0]; // API returns DESC by date
  const lastEntryDate = lastEntry ? new Date(lastEntry.date) : null;
  const daysSinceLast = lastEntryDate
    ? Math.floor((today.getTime() - startOfDay(lastEntryDate).getTime()) / DAY_MS)
    : null;

  // --- Filter pipeline ----------------------------------------------------
  const floor = periodFloor(period, now);
  const filtered = allLessons
    .filter((l) => (status ? l.status === status : true))
    .filter((l) => (floor ? new Date(l.date) >= floor : true))
    .filter((l) => matchesHomework(l, homework, now))
    .filter((l) => {
      if (!search) return true;
      const hay = [l.title, l.content, l.homework ?? ''].join(' ').toLowerCase();
      return hay.includes(search);
    });

  const sorted = sortLessons(filtered, sort);

  // --- Monthly grouping ---------------------------------------------------
  const groupMap = new Map<string, Lesson[]>();
  for (const l of sorted) {
    const k = monthKey(l.date);
    const bucket = groupMap.get(k);
    if (bucket) bucket.push(l);
    else groupMap.set(k, [l]);
  }
  const groupKeys = Array.from(groupMap.keys()).sort((a, b) =>
    sort === 'date-asc' ? a.localeCompare(b) : b.localeCompare(a),
  );
  const groups = groupKeys.map((k) => ({
    key: k,
    label: formatMonthLabel(k),
    rows: groupMap.get(k)!,
  }));

  // --- Active filter chips ------------------------------------------------
  const chips: string[] = [];
  if (status)
    chips.push(`Statut : ${status === 'draft' ? 'Brouillons' : 'Publiées'}`);
  if (period) {
    const periodLabels: Record<Exclude<PeriodFilter, ''>, string> = {
      '7d': '7 derniers jours',
      '30d': '30 derniers jours',
      '90d': '90 derniers jours',
      term: 'Ce trimestre',
    };
    chips.push(`Période : ${periodLabels[period]}`);
  }
  if (homework) {
    const homeworkLabels: Record<Exclude<HomeworkFilter, ''>, string> = {
      with: 'Avec devoirs',
      without: 'Sans devoirs',
      'due-soon': 'À rendre sous 7 j',
      overdue: 'Échéance passée',
    };
    chips.push(`Devoirs : ${homeworkLabels[homework]}`);
  }
  if (sort !== 'date-desc') {
    const sortLabels: Record<SortKey, string> = {
      'date-desc': 'Date ↓',
      'date-asc': 'Date ↑',
      'title-asc': 'Titre A → Z',
    };
    chips.push(`Tri : ${sortLabels[sort]}`);
  }
  if (search) chips.push(`Recherche : « ${search} »`);

  const resetHref = `/teacher/classes/${id}/lessons`;
  const hasAnyEntry = allLessons.length > 0;
  const filteredEmpty = sorted.length === 0;

  return (
    <PortalShell portal="teacher">
      <Link
        href={`/teacher/classes/${id}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour à la classe
      </Link>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs text-slate-500">
            {a?.classSection.gradeLevel?.cycle?.name && (
              <>{a.classSection.gradeLevel.cycle.name} · </>
            )}
            {a?.classSection.name} · {a?.subject.name}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Cahier de texte
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Trace ce qui a été fait en classe + devoirs maison. Visible automatiquement par les
            parents dès la publication.
          </p>
        </div>
        {lastEntryDate && (
          <div className="rounded-xl bg-white px-3 py-2 text-right text-[11px] font-medium text-slate-500 ring-1 ring-slate-200/60 shadow-sm">
            <div className="text-slate-400">Dernière entrée</div>
            <div className="font-bold text-slate-800">
              {lastEntryDate.toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
              {daysSinceLast !== null && daysSinceLast > 0 ? (
                <span className="ml-1 font-normal text-slate-500">
                  · il y a {daysSinceLast} j
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* KPI strip — stable across filters */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={CheckCircle2}
          tone="teal"
          label="PUBLIÉES"
          value={publishedCount}
        >
          {thisWeekCount > 0
            ? `${thisWeekCount} sur 7 derniers jours`
            : 'Visible des parents'}
        </KpiCard>
        <KpiCard
          icon={ClipboardEdit}
          tone={draftCount > 0 ? 'amber' : 'slate'}
          label="BROUILLONS"
          value={draftCount}
        >
          {draftCount > 0 ? 'À publier pour les familles' : 'Aucun en attente'}
        </KpiCard>
        <KpiCard
          icon={BookOpen}
          tone="violet"
          label="DEVOIRS"
          value={withHomeworkCount}
        >
          {publishedCount === 0
            ? 'Aucune entrée publiée'
            : `${Math.round((withHomeworkCount / Math.max(1, publishedCount)) * 100)}% des entrées publiées`}
        </KpiCard>
        <KpiCard
          icon={CalendarClock}
          tone={dueSoonCount > 0 ? 'rose' : 'slate'}
          label="À RENDRE SOUS 7 J"
          value={dueSoonCount}
        >
          {overdueCount > 0
            ? `+ ${overdueCount} échéance${overdueCount > 1 ? 's' : ''} passée${overdueCount > 1 ? 's' : ''}`
            : 'Aucun retard'}
        </KpiCard>
      </div>

      {/* Action strips */}
      {hasAnyEntry && (draftCount > 0 || overdueCount > 0) ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-50 via-rose-50 to-white p-4 ring-1 ring-amber-200/70">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"
          >
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-bold text-slate-900">
              {draftCount > 0 ? (
                <>
                  {draftCount} brouillon{draftCount > 1 ? 's' : ''} non publié
                  {draftCount > 1 ? 's' : ''}
                </>
              ) : null}
              {draftCount > 0 && overdueCount > 0 ? ' · ' : ''}
              {overdueCount > 0 ? (
                <>
                  {overdueCount} devoir{overdueCount > 1 ? 's' : ''} avec échéance passée
                </>
              ) : null}
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              Publiez les brouillons pour les familles ou consultez les devoirs dont la date est
              dépassée pour faire le point en classe.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {draftCount > 0 ? (
              <Link
                href={`${resetHref}?status=draft`}
                className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-amber-600 hover:shadow-md"
              >
                <ClipboardEdit className="h-3.5 w-3.5" /> Voir les brouillons
              </Link>
            ) : null}
            {overdueCount > 0 ? (
              <Link
                href={`${resetHref}?homework=overdue`}
                className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-rose-700 hover:shadow-md"
              >
                <CalendarClock className="h-3.5 w-3.5" /> Devoirs en retard
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="mt-6 space-y-4">
        {hasAnyEntry ? (
          <>
            <LessonsFilters
              q={search}
              status={status}
              period={period}
              homework={homework}
              sort={sort}
            />
            {chips.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                <Filter className="h-3 w-3 shrink-0" />
                <span className="font-medium text-slate-600">Filtres actifs :</span>
                {chips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700"
                  >
                    {chip}
                  </span>
                ))}
                <Link
                  href={resetHref}
                  className="ml-1 rounded-full px-2 py-0.5 font-bold text-blue-700 hover:bg-blue-50"
                >
                  Réinitialiser
                </Link>
              </div>
            ) : null}
          </>
        ) : null}

        <LessonsManager
          groups={groups}
          totalEntries={allLessons.length}
          filteredCount={sorted.length}
          teachingAssignmentId={id}
          hasActiveFilters={chips.length > 0}
          resetHref={resetHref}
        />

        {hasAnyEntry && filteredEmpty ? (
          <EmptyState
            icon={Sparkles}
            title="Aucune entrée ne correspond"
            description="Aucune entrée du cahier de texte ne correspond aux filtres actuels. Réinitialisez pour retrouver l’intégralité de votre journal."
            tone="slate"
            action={{ label: 'Réinitialiser les filtres', href: resetHref }}
          />
        ) : null}

        {!hasAnyEntry ? (
          <EmptyState
            icon={FileText}
            title="Aucune entrée pour cette classe / matière"
            description="Le cahier de texte est encore vide. Créez une première entrée pour tracer ce qui a été fait en cours et noter les devoirs."
            tone="slate"
          />
        ) : null}
      </section>

      {/* Footer hint when entries exist */}
      {hasAnyEntry ? (
        <section className="mt-6 rounded-2xl bg-gradient-to-br from-teal-50 via-white to-emerald-50 p-5 shadow-sm ring-1 ring-teal-200/60">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-bold text-slate-900">
                Les entrées publiées sont visibles dans le cahier des parents.
              </div>
              <div className="mt-0.5 text-xs text-slate-600">
                Les brouillons restent privés tant que vous ne les publiez pas. Pensez à ajouter
                une échéance aux devoirs pour qu’ils apparaissent dans le tableau « à rendre ».
              </div>
            </div>
            <Link
              href={`/teacher/classes/${id}/attendance`}
              className="inline-flex items-center gap-1.5 self-start rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow"
            >
              <CalendarCheck2 className="h-3.5 w-3.5" /> Faire l’appel
            </Link>
          </div>
        </section>
      ) : null}
    </PortalShell>
  );
}
