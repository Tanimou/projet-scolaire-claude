import {
  AlertTriangle,
  BookOpenText,
  CalendarClock,
  ClipboardCheck,
  Clock,
  FileText,
  FlaskConical,
  GraduationCap,
  Hand,
  Layers,
  Mic,
  PencilLine,
  Target,
} from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import type { IcsEvent } from '@/lib/ics';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  StatusBadge,
  SubjectChip,
  formatDateShort,
  formatInDays,
} from '@pilotage/ui';

import { ChildSelector } from '../_components/ChildSelector';

import {
  AddEvaluationToCalendarButton,
  ExportEvaluationsButton,
} from './UpcomingCalendarExport';
import { UpcomingFilters } from './UpcomingFilters';
import type {
  HorizonFilter,
  KindFilter,
  KindOption,
  SubjectFilter,
  SubjectOption,
  TermFilter,
  TermOption,
  UpcomingHorizon,
  UpcomingItem,
} from './types';

export const metadata: Metadata = { title: 'Évaluations à venir' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
}

interface UpcomingResp {
  data: UpcomingItem[];
  classSectionName: string | null;
  gradeLevelName: string | null;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const VALID_HORIZONS: ReadonlyArray<UpcomingHorizon> = ['this-week', 'next-week', 'later'];

const NO_TERM_KEY = '__none__';
const NO_TERM_LABEL = 'Hors trimestre';

const KIND_LABEL: Record<string, string> = {
  written_test: 'Contrôle écrit',
  oral: 'Oral',
  homework: 'Devoir maison',
  project: 'Projet',
  participation: 'Participation',
  practical: 'TP',
  other: 'Autre',
};

const KIND_ICON: Record<string, typeof PencilLine> = {
  written_test: PencilLine,
  oral: Mic,
  homework: FileText,
  project: Layers,
  participation: Hand,
  practical: FlaskConical,
  other: BookOpenText,
};

const HORIZON_META: Record<UpcomingHorizon, { label: string; tone: string; ring: string; pill: string }> = {
  'this-week': {
    label: 'Cette semaine',
    tone: 'rose',
    ring: 'ring-rose-200',
    pill: 'bg-rose-100 text-rose-700',
  },
  'next-week': {
    label: 'Semaine prochaine',
    tone: 'amber',
    ring: 'ring-amber-200',
    pill: 'bg-amber-100 text-amber-800',
  },
  later: {
    label: 'Plus tard',
    tone: 'sky',
    ring: 'ring-sky-200',
    pill: 'bg-sky-100 text-sky-700',
  },
};

function horizonOf(date: Date, oneWeek: Date, twoWeeks: Date): UpcomingHorizon {
  if (date <= oneWeek) return 'this-week';
  if (date <= twoWeeks) return 'next-week';
  return 'later';
}

/** One hour, in milliseconds — default block duration for an exported evaluation. */
const EVAL_DURATION_MS = 60 * 60 * 1000;

/**
 * Map an upcoming evaluation to a calendar event. Timed (not all-day) so the
 * exact instant the teacher planned is preserved across calendar apps; the
 * description carries the pedagogical context (format, coefficient, barème).
 */
function evaluationToIcsEvent(u: UpcomingItem, childName: string | null): IcsEvent {
  const start = new Date(u.scheduledAt);
  const end = new Date(start.getTime() + EVAL_DURATION_MS);
  const kindLabel = KIND_LABEL[u.kind] ?? u.kind;
  const coef = u.coefficient.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const descriptionLines = [
    `Matière : ${u.subjectName}`,
    `Format : ${kindLabel}`,
    `Coefficient : ×${coef} · Barème : /${u.maxScore}`,
    u.termName ? `Période : ${u.termName}` : null,
    childName ? `Élève : ${childName}` : null,
    u.description ? `\n${u.description}` : null,
    '\nÉvaluation planifiée — Pilotage Scolaire.',
  ].filter((line): line is string => Boolean(line));

  return {
    id: `eval-${u.id}`,
    title: `${u.subjectName} — ${u.title}`,
    description: descriptionLines.join('\n'),
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    allDay: false,
    categories: ['Évaluation', kindLabel],
    location: u.classSectionName || null,
  };
}

export default async function ParentUpcomingPage({
  searchParams,
}: {
  searchParams: Promise<{
    studentId?: string;
    horizon?: string;
    subjectId?: string;
    kind?: string;
    term?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
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
            { label: 'Évaluations à venir' },
          ]}
          title="Évaluations à venir"
        />
        <EmptyState
          icon={CalendarClock}
          title="Aucun enfant rattaché"
          description="Les prochaines évaluations apparaîtront ici dès qu'un enfant sera lié à votre compte."
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
  const activeChild = children.find((c) => c.id === activeStudentId) ?? null;
  const activeChildName = activeChild
    ? `${activeChild.firstName} ${activeChild.lastName}`.trim()
    : null;

  const resp = await safe(
    api<UpcomingResp>(`/api/v1/analytics/parent-upcoming/${activeStudentId}`, {
      cache: 'no-store',
    }),
  );
  const all = resp?.data ?? [];
  const classSectionName = resp?.classSectionName ?? null;
  const gradeLevelName = resp?.gradeLevelName ?? null;

  const now = new Date();
  const oneWeek = new Date(now);
  oneWeek.setDate(now.getDate() + 7);
  const twoWeeks = new Date(now);
  twoWeeks.setDate(now.getDate() + 14);

  // KPIs computed on the FULL dataset (stable across filters).
  const totalAll = all.length;
  const thisWeekAll = all.filter((u) => new Date(u.scheduledAt) <= oneWeek).length;
  const nextWeekAll = all.filter((u) => {
    const d = new Date(u.scheduledAt);
    return d > oneWeek && d <= twoWeeks;
  }).length;
  const beyondAll = all.filter((u) => new Date(u.scheduledAt) > twoWeeks).length;
  const subjectsAll = new Set(all.map((u) => u.subjectCode)).size;
  const highCoefThisWeek = all.filter(
    (u) => new Date(u.scheduledAt) <= oneWeek && u.coefficient >= 2,
  ).length;

  // Derive subject options from data → dropdown always matches visible content.
  const subjectMap = new Map<string, SubjectOption>();
  for (const u of all) {
    if (!subjectMap.has(u.subjectId)) {
      subjectMap.set(u.subjectId, {
        id: u.subjectId,
        code: u.subjectCode,
        name: u.subjectName,
      });
    }
  }
  const subjects = Array.from(subjectMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'fr'),
  );

  // Kind options derived from data, labelled.
  const kindMap = new Map<string, KindOption>();
  for (const u of all) {
    if (!kindMap.has(u.kind)) {
      kindMap.set(u.kind, { value: u.kind, label: KIND_LABEL[u.kind] ?? u.kind });
    }
  }
  const kinds = Array.from(kindMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label, 'fr'),
  );

  // Term options — keep discovery order (which is soonest-first by query).
  const termMap = new Map<string, TermOption>();
  for (const u of all) {
    const key = u.termId ?? NO_TERM_KEY;
    if (!termMap.has(key)) {
      termMap.set(key, { key, label: u.termName ?? NO_TERM_LABEL });
    }
  }
  const terms = Array.from(termMap.values());

  // Validate filters against actual data.
  const horizonFilter: HorizonFilter =
    sp.horizon && VALID_HORIZONS.includes(sp.horizon as UpcomingHorizon)
      ? (sp.horizon as UpcomingHorizon)
      : '';
  const subjectFilter: SubjectFilter =
    sp.subjectId && subjectMap.has(sp.subjectId) ? sp.subjectId : '';
  const kindFilter: KindFilter = sp.kind && kindMap.has(sp.kind) ? sp.kind : '';
  const termFilter: TermFilter =
    sp.term && termMap.has(sp.term) ? sp.term : '';
  const search = (sp.q ?? '').trim().toLowerCase();

  // Apply filters: horizon → subject → kind → term → search.
  const filtered = all
    .filter((u) => {
      if (!horizonFilter) return true;
      return horizonOf(new Date(u.scheduledAt), oneWeek, twoWeeks) === horizonFilter;
    })
    .filter((u) => (subjectFilter ? u.subjectId === subjectFilter : true))
    .filter((u) => (kindFilter ? u.kind === kindFilter : true))
    .filter((u) => (termFilter ? (u.termId ?? NO_TERM_KEY) === termFilter : true))
    .filter((u) => {
      if (!search) return true;
      const hay = [
        u.title,
        u.description ?? '',
        u.subjectName,
        KIND_LABEL[u.kind] ?? u.kind,
        u.termName ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(search);
    });

  // Group filtered items by horizon, preserving chronological order within.
  const buckets: Record<UpcomingHorizon, UpcomingItem[]> = {
    'this-week': [],
    'next-week': [],
    later: [],
  };
  for (const u of filtered) {
    const h = horizonOf(new Date(u.scheduledAt), oneWeek, twoWeeks);
    buckets[h].push(u);
  }
  const groupOrder: UpcomingHorizon[] = ['this-week', 'next-week', 'later'];

  // Calendar export reflects exactly what the parent currently sees (filtered).
  const exportEvents = filtered.map((u) => evaluationToIcsEvent(u, activeChildName));

  // Active filter chip recap.
  const activeFilterChips: string[] = [];
  if (horizonFilter) {
    activeFilterChips.push(`Échéance : ${HORIZON_META[horizonFilter].label}`);
  }
  if (subjectFilter) {
    activeFilterChips.push(`Matière : ${subjectMap.get(subjectFilter)!.name}`);
  }
  if (kindFilter) {
    activeFilterChips.push(`Format : ${KIND_LABEL[kindFilter] ?? kindFilter}`);
  }
  if (termFilter) {
    activeFilterChips.push(`Période : ${termMap.get(termFilter)!.label}`);
  }
  if (search) activeFilterChips.push(`Recherche : « ${search} »`);

  const classLine =
    classSectionName != null
      ? gradeLevelName
        ? `${classSectionName} · ${gradeLevelName}`
        : classSectionName
      : null;
  const headerSubtitle =
    totalAll > 0
      ? classLine
        ? `Toutes les évaluations planifiées sur les 60 prochains jours pour ${classLine}`
        : 'Toutes les évaluations planifiées sur les 60 prochains jours'
      : 'Cette liste se met à jour automatiquement dès qu’un enseignant planifie une évaluation';

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Évaluations à venir' },
        ]}
        title="Évaluations à venir"
        subtitle={headerSubtitle}
        actions={
          totalAll > 0 ? (
            <ExportEvaluationsButton events={exportEvents} childName={activeChildName} />
          ) : undefined
        }
      />

      <div className="mt-4">
        <ChildSelector items={children} activeStudentId={activeStudentId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={ClipboardCheck} tone="blue" label="TOTAL" value={totalAll}>
          Planifiées sur 60 jours
        </KpiCard>
        <KpiCard
          icon={Clock}
          tone={thisWeekAll > 0 ? 'rose' : 'slate'}
          label="CETTE SEMAINE"
          value={thisWeekAll}
        >
          Sous 7 jours
        </KpiCard>
        <KpiCard
          icon={CalendarClock}
          tone={nextWeekAll > 0 ? 'amber' : 'slate'}
          label="SEMAINE PROCHAINE"
          value={nextWeekAll}
        >
          Entre 7 et 14 jours
        </KpiCard>
        <KpiCard
          icon={Target}
          tone={subjectsAll > 0 ? 'violet' : 'slate'}
          label="MATIÈRES"
          value={subjectsAll}
        >
          Matières concernées
        </KpiCard>
      </div>

      {/* Contextual action strip when ≥1 high-coefficient evaluation is imminent. */}
      {highCoefThisWeek > 0 && horizonFilter !== 'this-week' && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm text-rose-900">
            <p className="font-bold">
              {highCoefThisWeek} évaluation{highCoefThisWeek > 1 ? 's' : ''} à fort coefficient cette semaine
            </p>
            <p className="mt-0.5 text-xs text-rose-800/80">
              Coefficient ≥ 2 — un bon moment pour aider votre enfant à préparer ces échéances en priorité.
            </p>
          </div>
        </div>
      )}

      {totalAll > 0 && (
        <div className="mt-6">
          <UpcomingFilters
            subjects={subjects}
            kinds={kinds}
            terms={terms}
            subjectId={subjectFilter}
            kind={kindFilter}
            horizon={horizonFilter}
            term={termFilter}
            q={search}
          />
        </div>
      )}

      <section className="mt-4 space-y-6">
        {totalAll === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Aucune évaluation planifiée"
            description="Aucune évaluation n'est planifiée pour les 60 prochains jours. Cette liste se met à jour automatiquement quand un enseignant planifie une évaluation."
            tone="slate"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Aucune évaluation avec ces filtres"
            description="Élargissez la sélection, retirez un filtre, ou videz la recherche pour voir plus de résultats."
            tone="slate"
          />
        ) : (
          groupOrder.map((h) => {
            const items = buckets[h];
            if (items.length === 0) return null;
            const meta = HORIZON_META[h];
            const highCoefInGroup = items.filter((u) => u.coefficient >= 2).length;
            return (
              <div key={h} className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                    {meta.label}
                  </h2>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${meta.pill}`}>
                    {items.length} évaluation{items.length > 1 ? 's' : ''}
                  </span>
                  {highCoefInGroup > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">
                      <GraduationCap className="h-3 w-3" />
                      {highCoefInGroup} à fort coef.
                    </span>
                  )}
                </div>
                <ul className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
                  {items.map((u, idx) => {
                    const date = new Date(u.scheduledAt);
                    const isThisWeek = h === 'this-week';
                    const KindIcon = KIND_ICON[u.kind] ?? PencilLine;
                    const kindLabel = KIND_LABEL[u.kind] ?? u.kind;
                    return (
                      <li
                        key={u.id}
                        className={`flex items-start gap-4 px-5 py-4 transition hover:bg-slate-50/60 ${
                          idx > 0 ? 'border-t border-slate-100' : ''
                        }`}
                      >
                        {/* Date block — colored to match the horizon bucket. */}
                        <div className="shrink-0 text-center">
                          <div
                            className={`rounded-lg px-3 py-2 ring-1 ${
                              isThisWeek
                                ? 'bg-rose-50 ring-rose-200'
                                : h === 'next-week'
                                  ? 'bg-amber-50 ring-amber-200'
                                  : 'bg-slate-50 ring-slate-200'
                            }`}
                          >
                            <div
                              className={`text-[10px] font-bold uppercase tracking-wider ${
                                isThisWeek
                                  ? 'text-rose-700'
                                  : h === 'next-week'
                                    ? 'text-amber-800'
                                    : 'text-slate-500'
                              }`}
                            >
                              {date.toLocaleDateString('fr-FR', { month: 'short' })}
                            </div>
                            <div
                              className={`mt-0.5 text-2xl font-bold tabular-nums ${
                                isThisWeek
                                  ? 'text-rose-900'
                                  : h === 'next-week'
                                    ? 'text-amber-900'
                                    : 'text-slate-900'
                              }`}
                            >
                              {date.getDate()}
                            </div>
                            <div
                              className={`text-[10px] font-semibold uppercase tracking-wider ${
                                isThisWeek
                                  ? 'text-rose-700/80'
                                  : h === 'next-week'
                                    ? 'text-amber-800/80'
                                    : 'text-slate-500'
                              }`}
                            >
                              {date.toLocaleDateString('fr-FR', { weekday: 'short' })}
                            </div>
                          </div>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                                isThisWeek
                                  ? 'bg-rose-50 text-rose-700'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                              title={kindLabel}
                              aria-hidden
                            >
                              <KindIcon className="h-3.5 w-3.5" />
                            </span>
                            <h3 className="text-sm font-bold text-slate-900">{u.title}</h3>
                            <SubjectChip
                              subjectCode={u.subjectCode}
                              label={u.subjectName}
                              size="sm"
                            />
                            {u.termName && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                                {u.termName}
                              </span>
                            )}
                          </div>
                          {u.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                              {u.description}
                            </p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                            <span>{kindLabel}</span>
                            <span className="text-slate-300">·</span>
                            <span>{formatDateShort(u.scheduledAt)}</span>
                            <span className="text-slate-300">·</span>
                            <span>{formatInDays(u.scheduledAt)}</span>
                            <span className="text-slate-300">·</span>
                            <span className="font-mono tabular-nums">
                              <span className="text-slate-400">coef.</span>{' '}
                              <span className="font-bold text-slate-700">
                                ×{u.coefficient.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                              <span className="text-slate-400"> · /{u.maxScore}</span>
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <StatusBadge
                            label={isThisWeek ? 'Bientôt' : h === 'next-week' ? 'Semaine +1' : 'À venir'}
                            tone={isThisWeek ? 'danger' : h === 'next-week' ? 'warning' : 'sky'}
                            size="sm"
                            withDot
                          />
                          {u.coefficient >= 2 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 ring-1 ring-violet-200">
                              <GraduationCap className="h-3 w-3" />
                              Fort coef.
                            </span>
                          )}
                          <AddEvaluationToCalendarButton
                            event={evaluationToIcsEvent(u, activeChildName)}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </section>

      {beyondAll > 0 && !horizonFilter && filtered.length > 0 && (
        <p className="mt-4 text-[11px] text-slate-500">
          Horizon couvert : 60 jours · {beyondAll} évaluation{beyondAll > 1 ? 's' : ''} au-delà de 14 jours.
        </p>
      )}

      {activeFilterChips.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">
          Filtres actifs :{' '}
          {activeFilterChips.map((chip, idx) => (
            <span key={chip}>
              <span className="font-bold text-slate-700">{chip}</span>
              {idx < activeFilterChips.length - 1 && (
                <span className="text-slate-400"> · </span>
              )}
            </span>
          ))}
        </p>
      )}
    </PortalShell>
  );
}
