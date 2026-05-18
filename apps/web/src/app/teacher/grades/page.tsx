import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  FileEdit,
  PenTool,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  AvatarNameCell,
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  ProgressBar,
  StatusBadge,
  SubjectChip,
  formatDateShort,
  formatGrade,
} from '@pilotage/ui';

import { TeacherGradesFilters } from './TeacherGradesFilters';
import type {
  ClassOption,
  GradeRow,
  GradeStatusFilter,
  SubjectOption,
  TermOption,
} from './types';

export const metadata: Metadata = { title: 'Notes' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 30;
const VALID_STATUS: GradeStatusFilter[] = ['draft', 'published', 'revised', 'absent'];

const STATUS_LABEL: Record<Exclude<GradeStatusFilter, ''>, string> = {
  draft: 'Brouillons',
  published: 'Publiées',
  revised: 'Révisées',
  absent: 'Absents',
};

/** Convert a value `/max` to a `/20` scale, or null if not gradable. */
function toOnTwenty(value: string | null, maxScore: string): number | null {
  if (value == null) return null;
  const v = Number(value);
  const max = Number(maxScore);
  if (!Number.isFinite(v) || !Number.isFinite(max) || max <= 0) return null;
  return (v / max) * 20;
}

/** Tone for the global average KPI based on /20 score. */
function avgTone(value: number | null): 'green' | 'sky' | 'amber' | 'rose' | 'slate' {
  if (value == null) return 'slate';
  if (value >= 14) return 'green';
  if (value >= 12) return 'sky';
  if (value >= 10) return 'amber';
  return 'rose';
}

/** Progress tone for a subject average bar (out of /20). */
function progressToneForAvg(value: number): 'success' | 'info' | 'warning' | 'danger' {
  if (value >= 14) return 'success';
  if (value >= 12) return 'info';
  if (value >= 10) return 'warning';
  return 'danger';
}

export default async function TeacherGradesPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    status?: string;
    classId?: string;
    subjectId?: string;
    termId?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const statusFilter: GradeStatusFilter =
    sp.status && VALID_STATUS.includes(sp.status as GradeStatusFilter)
      ? (sp.status as GradeStatusFilter)
      : '';
  const search = (sp.q ?? '').trim().toLowerCase();

  const resp = await safe(
    api<{ data: GradeRow[] }>('/api/v1/teachers/me/recent-grades?limit=100', {
      cache: 'no-store',
    }),
  );
  const all = resp?.data ?? [];

  // KPIs computed on the full dataset (intentional — stable picture).
  const totalAll = all.length;
  const publishedAll = all.filter((g) => g.status === 'published').length;
  const draftsAll = all.filter((g) => g.status === 'draft').length;
  const revisedAll = all.filter((g) => g.status === 'revised').length;
  const absentAll = all.filter((g) => g.isAbsent).length;

  const valuesOn20All = all
    .map((g) => (g.isAbsent ? null : toOnTwenty(g.value, g.assessment.maxScore)))
    .filter((v): v is number => v != null);
  const overallAvg =
    valuesOn20All.length > 0
      ? valuesOn20All.reduce((a, b) => a + b, 0) / valuesOn20All.length
      : null;

  // Derive filter options from what the teacher can actually see.
  const classMap = new Map<string, ClassOption>();
  const subjectMap = new Map<string, SubjectOption>();
  const termMap = new Map<string, TermOption>();
  for (const g of all) {
    const cs = g.assessment.teachingAssignment.classSection;
    if (!classMap.has(cs.id)) classMap.set(cs.id, { id: cs.id, name: cs.name });
    const s = g.assessment.teachingAssignment.subject;
    if (!subjectMap.has(s.id))
      subjectMap.set(s.id, { id: s.id, code: s.code, name: s.name, color: s.color });
    if (g.assessment.term && !termMap.has(g.assessment.term.id))
      termMap.set(g.assessment.term.id, { id: g.assessment.term.id, name: g.assessment.term.name });
  }
  const classes = Array.from(classMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'fr'),
  );
  const subjects = Array.from(subjectMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'fr'),
  );
  const terms = Array.from(termMap.values());

  const activeClassId = sp.classId && classMap.has(sp.classId) ? sp.classId : '';
  const activeSubjectId = sp.subjectId && subjectMap.has(sp.subjectId) ? sp.subjectId : '';
  const activeTermId = sp.termId && termMap.has(sp.termId) ? sp.termId : '';

  // Apply filters: class → subject → term → status → search.
  const filtered = all
    .filter((g) =>
      activeClassId ? g.assessment.teachingAssignment.classSection.id === activeClassId : true,
    )
    .filter((g) =>
      activeSubjectId ? g.assessment.teachingAssignment.subject.id === activeSubjectId : true,
    )
    .filter((g) => (activeTermId ? g.assessment.term?.id === activeTermId : true))
    .filter((g) => {
      if (!statusFilter) return true;
      if (statusFilter === 'absent') return g.isAbsent;
      return g.status === statusFilter;
    })
    .filter((g) => {
      if (!search) return true;
      const fullName = `${g.student.firstName} ${g.student.lastName}`.toLowerCase();
      const hay = [
        fullName,
        g.assessment.title,
        g.assessment.teachingAssignment.subject.name,
        g.assessment.teachingAssignment.classSection.name,
        g.comment ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(search);
    });

  const total = filtered.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;

  // Group by term (or "Sans période" fallback). API is updatedAt-desc already,
  // so groups naturally follow recency order.
  type Group = { key: string; label: string; rows: GradeRow[]; published: number; drafts: number };
  const groups: Group[] = [];
  for (const g of filtered) {
    const termKey = g.assessment.term?.id ?? '__no_term__';
    const termLabel = g.assessment.term?.name ?? 'Sans période';
    let group = groups.find((gr) => gr.key === termKey);
    if (!group) {
      group = { key: termKey, label: termLabel, rows: [], published: 0, drafts: 0 };
      groups.push(group);
    }
    group.rows.push(g);
    if (g.status === 'published') group.published += 1;
    if (g.status === 'draft') group.drafts += 1;
  }

  // Slice across groups to preserve section headers while paginating.
  let seen = 0;
  const pageGroups: Array<Group & { pageRows: GradeRow[]; avg: number | null }> = [];
  for (const g of groups) {
    if (seen >= endIdx) break;
    const pageRows: GradeRow[] = [];
    for (const r of g.rows) {
      if (seen >= startIdx && seen < endIdx) pageRows.push(r);
      seen++;
    }
    if (pageRows.length > 0) {
      const groupVals = g.rows
        .map((r) => (r.isAbsent ? null : toOnTwenty(r.value, r.assessment.maxScore)))
        .filter((v): v is number => v != null);
      const avg =
        groupVals.length > 0 ? groupVals.reduce((a, b) => a + b, 0) / groupVals.length : null;
      pageGroups.push({ ...g, pageRows, avg });
    }
  }

  // Subject snapshot — full dataset, top by count, sorted by count desc.
  interface SubjectSnapshot {
    subjectId: string;
    code: string;
    name: string;
    color: string | null;
    count: number;
    drafts: number;
    avg: number | null;
  }
  const snapshotMap = new Map<string, SubjectSnapshot>();
  for (const g of all) {
    const s = g.assessment.teachingAssignment.subject;
    const cur = snapshotMap.get(s.id) ?? {
      subjectId: s.id,
      code: s.code,
      name: s.name,
      color: s.color,
      count: 0,
      drafts: 0,
      avg: null,
    };
    cur.count += 1;
    if (g.status === 'draft') cur.drafts += 1;
    snapshotMap.set(s.id, cur);
  }
  // Compute per-subject averages.
  for (const s of snapshotMap.values()) {
    const vals = all
      .filter((g) => g.assessment.teachingAssignment.subject.id === s.subjectId)
      .map((g) => (g.isAbsent ? null : toOnTwenty(g.value, g.assessment.maxScore)))
      .filter((v): v is number => v != null);
    s.avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  const subjectSnapshot = Array.from(snapshotMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Active filter chips for the recap line.
  const activeFilterChips: string[] = [];
  if (activeClassId) {
    activeFilterChips.push(`Classe : ${classMap.get(activeClassId)!.name}`);
  }
  if (activeSubjectId) {
    activeFilterChips.push(`Matière : ${subjectMap.get(activeSubjectId)!.name}`);
  }
  if (activeTermId) {
    activeFilterChips.push(`Période : ${termMap.get(activeTermId)!.name}`);
  }
  if (statusFilter) {
    activeFilterChips.push(STATUS_LABEL[statusFilter]);
  }
  if (search) activeFilterChips.push(`Recherche : « ${search} »`);

  const headerSubtitle =
    totalAll > 0
      ? `Vue globale des ${totalAll} dernières notes saisies sur vos évaluations`
      : "Vos saisies récentes apparaîtront ici dès que vous noterez une évaluation";

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Notes' },
        ]}
        title="Notes"
        subtitle={headerSubtitle}
      />

      {/* KPI strip — stable across filters. */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={PenTool} tone="blue" label="NOTES RÉCENTES" value={totalAll}>
          {revisedAll > 0
            ? `${revisedAll} révisée${revisedAll > 1 ? 's' : ''}`
            : 'Sur vos évaluations'}
        </KpiCard>
        <KpiCard icon={CheckCircle2} tone="green" label="PUBLIÉES" value={publishedAll}>
          {totalAll > 0
            ? `${Math.round((publishedAll / totalAll) * 100)} % visibles parents`
            : 'Visibles parents'}
        </KpiCard>
        <KpiCard icon={FileEdit} tone="orange" label="BROUILLONS" value={draftsAll}>
          {draftsAll > 0 ? 'À publier' : 'Aucun brouillon'}
        </KpiCard>
        <KpiCard
          icon={TrendingUp}
          tone={avgTone(overallAvg)}
          label="MOYENNE GLOBALE"
          value={overallAvg != null ? `${formatGrade(overallAvg, 1)} / 20` : '—'}
        >
          {absentAll > 0
            ? `${absentAll} absent${absentAll > 1 ? 's' : ''} exclu${absentAll > 1 ? 's' : ''}`
            : 'Sur les 100 dernières'}
        </KpiCard>
      </div>

      {/* Drafts alert strip. */}
      {draftsAll > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50/70 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm text-orange-900">
            <p className="font-bold">
              {draftsAll} note{draftsAll > 1 ? 's' : ''} en brouillon — non visible
              {draftsAll > 1 ? 's' : ''} des familles
            </p>
            <p className="mt-0.5 text-xs text-orange-800/80">
              Publiez vos brouillons depuis la gradebook de chaque évaluation pour les rendre
              accessibles aux parents et aux élèves.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Filters + grouped table (2/3) */}
        <div className="lg:col-span-2">
          <TeacherGradesFilters
            classes={classes}
            subjects={subjects}
            terms={terms}
            status={statusFilter}
            classId={activeClassId}
            subjectId={activeSubjectId}
            termId={activeTermId}
            q={search}
          />

          <section className="mt-4 space-y-6">
            {pageGroups.length === 0 ? (
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
                <EmptyState
                  icon={PenTool}
                  title={
                    totalAll === 0
                      ? 'Aucune note saisie'
                      : 'Aucune note avec ces filtres'
                  }
                  description={
                    totalAll === 0
                      ? "Saisissez vos premières notes depuis la gradebook d'une de vos classes."
                      : 'Élargissez la sélection, retirez un filtre, ou videz la recherche pour voir plus de résultats.'
                  }
                  tone="slate"
                />
              </div>
            ) : (
              pageGroups.map((g) => (
                <article
                  key={g.key}
                  className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60"
                >
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                    <h3 className="text-sm font-bold text-slate-700">{g.label}</h3>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>
                        {g.rows.length} note{g.rows.length > 1 ? 's' : ''}
                      </span>
                      {g.published > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" />
                          {g.published} publ.
                        </span>
                      )}
                      {g.drafts > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 font-semibold text-orange-700">
                          <FileEdit className="h-3 w-3" />
                          {g.drafts} brouillon{g.drafts > 1 ? 's' : ''}
                        </span>
                      )}
                      {g.avg != null && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-mono font-semibold tabular-nums text-violet-700">
                          {formatGrade(g.avg, 1)} / 20
                        </span>
                      )}
                    </div>
                  </header>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50/60">
                        <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          <th className="px-4 py-3">Élève</th>
                          <th className="px-4 py-3">Évaluation</th>
                          <th className="px-4 py-3">Matière</th>
                          <th className="px-4 py-3">Classe</th>
                          <th className="px-4 py-3 text-right">Note</th>
                          <th className="px-4 py-3">Saisie</th>
                          <th className="px-4 py-3">Statut</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {g.pageRows.map((row) => {
                          const max = Number(row.assessment.maxScore);
                          const value = row.value != null ? Number(row.value) : null;
                          const on20 = toOnTwenty(row.value, row.assessment.maxScore);
                          const isDraft = row.status === 'draft';
                          return (
                            <tr
                              key={row.id}
                              className={
                                isDraft
                                  ? 'bg-orange-50/20 hover:bg-orange-50/40'
                                  : 'hover:bg-slate-50/60'
                              }
                            >
                              <td className="px-4 py-3">
                                <AvatarNameCell
                                  firstName={row.student.firstName}
                                  lastName={row.student.lastName}
                                  size="sm"
                                />
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <span className="font-bold text-slate-900">
                                  {row.assessment.title}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <SubjectChip
                                  subjectCode={row.assessment.teachingAssignment.subject.code}
                                  label={row.assessment.teachingAssignment.subject.name}
                                  size="sm"
                                />
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-700">
                                {row.assessment.teachingAssignment.classSection.name}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {row.isAbsent ? (
                                  <span className="font-mono text-xs font-bold tabular-nums text-slate-400">
                                    ABS
                                  </span>
                                ) : value != null ? (
                                  <div className="flex flex-col items-end leading-tight">
                                    <span className="font-mono text-sm font-bold tabular-nums text-slate-900">
                                      {value.toFixed(2)} / {max.toFixed(0)}
                                    </span>
                                    {on20 != null && max !== 20 && (
                                      <span className="font-mono text-[10px] tabular-nums text-slate-500">
                                        ≈ {on20.toFixed(1)} / 20
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-500">
                                {formatDateShort(row.enteredAt)}
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge
                                  label={
                                    row.status === 'published'
                                      ? 'Publié'
                                      : row.status === 'revised'
                                        ? 'Révisé'
                                        : 'Brouillon'
                                  }
                                  tone={
                                    row.status === 'published'
                                      ? 'success'
                                      : row.status === 'revised'
                                        ? 'sky'
                                        : 'warning'
                                  }
                                  size="sm"
                                  withDot
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))
            )}

            {total > PAGE_SIZE && (
              <Pagination
                page={page}
                total={total}
                pageSize={PAGE_SIZE}
                itemLabel={{ singular: 'note', plural: 'notes' }}
              />
            )}
          </section>

          {activeFilterChips.length > 0 && (
            <p className="mt-4 text-[11px] text-slate-500">
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
        </div>

        {/* Subject snapshot (1/3) */}
        <aside className="lg:col-span-1">
          <div className="sticky top-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
            <header className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Aperçu par matière</h3>
                <p className="text-[11px] text-slate-500">
                  Moyenne et volume sur les 100 dernières notes
                </p>
              </div>
            </header>
            <div className="px-4 py-3">
              {subjectSnapshot.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  Aucune saisie pour l’instant — vos matières apparaîtront ici.
                </p>
              ) : (
                <ul className="space-y-3">
                  {subjectSnapshot.map((s) => (
                    <li key={s.subjectId} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <SubjectChip subjectCode={s.code} label={s.name} size="sm" />
                          <span className="text-[11px] text-slate-500">
                            {s.count} note{s.count > 1 ? 's' : ''}
                          </span>
                        </div>
                        <span className="font-mono text-xs font-bold tabular-nums text-slate-700">
                          {s.avg != null ? `${formatGrade(s.avg, 1)} /20` : '—'}
                        </span>
                      </div>
                      <ProgressBar
                        value={s.avg ?? 0}
                        max={20}
                        tone={progressToneForAvg(s.avg ?? 0)}
                        height={6}
                      />
                      {s.drafts > 0 && (
                        <div className="flex items-center gap-1 text-[11px] text-orange-700">
                          <FileEdit className="h-3 w-3" />
                          {s.drafts} brouillon{s.drafts > 1 ? 's' : ''} à publier
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <footer className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[10px] uppercase tracking-wider text-slate-400">
              <BookOpen className="h-3 w-3" />
              {subjectSnapshot.length === 0
                ? 'En attente de saisies'
                : `${snapshotMap.size} matière${snapshotMap.size > 1 ? 's' : ''} suivie${snapshotMap.size > 1 ? 's' : ''}`}
            </footer>
          </div>
        </aside>
      </div>
    </PortalShell>
  );
}
