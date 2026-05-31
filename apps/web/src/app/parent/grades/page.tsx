import { Award, GraduationCap, Sparkles, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  formatGrade,
  gradeBucket,
} from '@pilotage/ui';

import { ChildSelector } from '../_components/ChildSelector';
import { buildGradesAnalytics, gradeValueOn20 } from './analytics';
import { GradeRow } from './GradeRow';
import { GradesExport, type GradeExportRow } from './GradesExport';
import { GradesFilters } from './GradesFilters';
import { GradesOverview } from './GradesOverview';
import { kindLabel } from './types';
import type {
  GradeRow as GradeRowType,
  GradesPeriod,
  GradesPerformance,
  SubjectOption,
  TermOption,
} from './types';

export const metadata: Metadata = { title: 'Notes' };
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
const VALID_PERIODS: GradesPeriod[] = ['all', 'month', 'term'];
const VALID_PERF: GradesPerformance[] = ['excellent', 'satisfaisant', 'insuffisant', 'absent'];

function startOfMonth(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Resolve a "current term" id from the grades themselves: pick the term that
 * has the most recently dated assessment. Stable enough to power a "trimestre
 * en cours" preset without an extra endpoint round-trip.
 */
function pickCurrentTermId(grades: GradeRowType[]): string | null {
  let bestId: string | null = null;
  let bestDate = 0;
  for (const g of grades) {
    if (!g.assessment.term) continue;
    const d = g.assessment.scheduledAt
      ? new Date(g.assessment.scheduledAt).getTime()
      : g.publishedAt
        ? new Date(g.publishedAt).getTime()
        : 0;
    if (d > bestDate) {
      bestDate = d;
      bestId = g.assessment.term.id;
    }
  }
  return bestId;
}

export default async function ParentGradesPage({
  searchParams,
}: {
  searchParams: Promise<{
    studentId?: string;
    page?: string;
    period?: string;
    subjectId?: string;
    termId?: string;
    performance?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const period: GradesPeriod = VALID_PERIODS.includes(sp.period as GradesPeriod)
    ? (sp.period as GradesPeriod)
    : 'all';
  const performance: GradesPerformance | '' =
    sp.performance && VALID_PERF.includes(sp.performance as GradesPerformance)
      ? (sp.performance as GradesPerformance)
      : '';
  const search = (sp.q ?? '').trim().toLowerCase();

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
            { label: 'Notes' },
          ]}
          title="Notes"
        />
        <EmptyState
          icon={GraduationCap}
          title="Aucun enfant rattaché"
          description="Les notes apparaîtront ici dès qu'un enfant sera lié à votre compte."
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

  const gradesResp = await safe(
    api<{ data: GradeRowType[] }>(`/api/v1/grades/students/${activeStudentId}/grades`, {
      cache: 'no-store',
    }),
  );
  const allGrades = gradesResp?.data ?? [];

  // Derive subjects + terms from the loaded set so the filters always match
  // what the parent can actually see.
  const subjectMap = new Map<string, SubjectOption>();
  const termMap = new Map<string, TermOption>();
  for (const g of allGrades) {
    const s = g.assessment.teachingAssignment.subject;
    if (!subjectMap.has(s.id)) subjectMap.set(s.id, { id: s.id, name: s.name, color: s.color });
    if (g.assessment.term && !termMap.has(g.assessment.term.id)) {
      termMap.set(g.assessment.term.id, {
        id: g.assessment.term.id,
        name: g.assessment.term.name,
      });
    }
  }
  const subjects = Array.from(subjectMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'fr'),
  );
  const terms = Array.from(termMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const activeSubjectId =
    sp.subjectId && subjectMap.has(sp.subjectId) ? sp.subjectId : '';

  // Resolve termId: explicit query → keep; period=term → pick current term;
  // otherwise empty.
  const explicitTermId = sp.termId && termMap.has(sp.termId) ? sp.termId : '';
  const currentTermId = pickCurrentTermId(allGrades);
  const effectiveTermId =
    explicitTermId || (period === 'term' && currentTermId ? currentTermId : '');

  // KPIs are stable: computed from the full set, not influenced by filters.
  const now = new Date();
  const monthStart = startOfMonth(now);

  const valueOn20 = gradeValueOn20;
  const analytics = buildGradesAnalytics(allGrades);

  const valuesAll = allGrades.map(valueOn20).filter((v): v is number => v != null);
  const overallAvg =
    valuesAll.length > 0 ? valuesAll.reduce((a, b) => a + b, 0) / valuesAll.length : null;

  const valuesMonth = allGrades
    .filter((g) => {
      const ref = g.assessment.scheduledAt ?? g.publishedAt;
      return ref ? new Date(ref) >= monthStart : false;
    })
    .map(valueOn20)
    .filter((v): v is number => v != null);
  const monthAvg =
    valuesMonth.length > 0 ? valuesMonth.reduce((a, b) => a + b, 0) / valuesMonth.length : null;

  const excellentCount = allGrades.filter((g) => {
    const v = valueOn20(g);
    return v != null && v >= 16;
  }).length;
  const insuffisantCount = allGrades.filter((g) => {
    const v = valueOn20(g);
    return v != null && v < 10;
  }).length;

  // Apply filters in pipeline order: period → term → subject → performance → search.
  const filtered = allGrades
    .filter((g) => {
      if (period === 'all') return true;
      if (period === 'month') {
        const ref = g.assessment.scheduledAt ?? g.publishedAt;
        return ref ? new Date(ref) >= monthStart : false;
      }
      // period === 'term' is enforced through effectiveTermId below
      return true;
    })
    .filter((g) => (effectiveTermId ? g.assessment.term?.id === effectiveTermId : true))
    .filter((g) => (activeSubjectId ? g.assessment.teachingAssignment.subject.id === activeSubjectId : true))
    .filter((g) => {
      if (!performance) return true;
      if (performance === 'absent') return g.isAbsent;
      const v = valueOn20(g);
      if (v == null) return false;
      return gradeBucket(v, 20).bucket === performance;
    })
    .filter((g) => {
      if (!search) return true;
      const hay = [
        g.assessment.title,
        g.assessment.teachingAssignment.subject.name,
        g.assessment.term?.name ?? '',
        g.comment ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(search);
    });

  const total = filtered.length;
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const activeFilterChips: string[] = [];
  if (period === 'month') activeFilterChips.push('Ce mois-ci');
  if (period === 'term' && currentTermId && termMap.has(currentTermId))
    activeFilterChips.push(`Trimestre en cours (${termMap.get(currentTermId)!.name})`);
  if (activeSubjectId && subjectMap.has(activeSubjectId))
    activeFilterChips.push(`Matière : ${subjectMap.get(activeSubjectId)!.name}`);
  if (explicitTermId && termMap.has(explicitTermId))
    activeFilterChips.push(`Trimestre : ${termMap.get(explicitTermId)!.name}`);
  if (performance) {
    const labels: Record<GradesPerformance, string> = {
      excellent: 'Excellent (≥ 16)',
      satisfaisant: 'Satisfaisant (10–15)',
      insuffisant: 'Insuffisant (< 10)',
      absent: 'Absences uniquement',
    };
    activeFilterChips.push(labels[performance]);
  }
  if (search) activeFilterChips.push(`Recherche : « ${search} »`);

  // CSV export rows — the full *filtered* set (not just the current page) so the
  // download mirrors exactly what the parent is currently looking at.
  const activeChild = children.find((c) => c.id === activeStudentId);
  const activeChildName = activeChild
    ? `${activeChild.firstName} ${activeChild.lastName}`.trim()
    : 'enfant';
  const exportRows: GradeExportRow[] = filtered.map((g) => {
    const max = Number(g.assessment.maxScore);
    const rawValue = g.value != null ? Number(g.value) : null;
    const on20 = valueOn20(g);
    const coefficient = g.assessment.coefficientOverride
      ? Number(g.assessment.coefficientOverride)
      : 1;
    return {
      date: g.assessment.scheduledAt ?? g.publishedAt ?? '',
      subject: g.assessment.teachingAssignment.subject.name,
      assessment: g.assessment.title,
      kind: kindLabel(g.assessment.kind),
      term: g.assessment.term?.name ?? '',
      score: g.isAbsent
        ? 'Absent'
        : rawValue != null && Number.isFinite(max) && max > 0
          ? `${formatGrade(rawValue, rawValue % 1 === 0 ? 0 : 1)} / ${max.toFixed(0)}`
          : '',
      scoreOn20: on20 != null ? on20.toFixed(1).replace('.', ',') : '',
      coefficient: coefficient.toLocaleString('fr-FR', { maximumFractionDigits: 2 }),
      status:
        g.status === 'revised'
          ? 'Révisée'
          : g.status === 'draft'
            ? 'Brouillon'
            : 'Publiée',
      comment: g.comment ?? '',
    };
  });

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Notes' },
        ]}
        title="Notes"
        subtitle="Toutes les notes publiées par les enseignants, par matière et période"
        actions={
          <GradesExport
            rows={exportRows}
            childName={activeChildName}
            filtered={activeFilterChips.length > 0}
          />
        }
      />

      <div className="mt-4">
        <ChildSelector items={children} activeStudentId={activeStudentId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={GraduationCap}
          tone="blue"
          label="MOYENNE GLOBALE"
          value={overallAvg != null ? `${formatGrade(overallAvg, 1)} / 20` : '—'}
        >
          Sur {valuesAll.length} note{valuesAll.length > 1 ? 's' : ''} publiée
          {valuesAll.length > 1 ? 's' : ''}
        </KpiCard>
        <KpiCard
          icon={TrendingUp}
          tone="violet"
          label="MOYENNE DU MOIS"
          value={monthAvg != null ? `${formatGrade(monthAvg, 1)} / 20` : '—'}
        >
          {valuesMonth.length} note{valuesMonth.length > 1 ? 's' : ''} ce mois-ci
        </KpiCard>
        <KpiCard icon={Award} tone="green" label="EXCELLENTES" value={excellentCount}>
          Notes ≥ 16 / 20
        </KpiCard>
        <KpiCard icon={Sparkles} tone="rose" label="À RENFORCER" value={insuffisantCount}>
          Notes &lt; 10 / 20
        </KpiCard>
      </div>

      {allGrades.length > 0 && <GradesOverview analytics={analytics} />}

      <div className="mt-6">
        <GradesFilters
          subjects={subjects}
          terms={terms}
          period={period}
          subjectId={activeSubjectId}
          termId={explicitTermId}
          performance={performance}
          q={search}
        />
      </div>

      <section className="mt-6">
        {pageRows.length === 0 ? (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
            <EmptyState
              icon={GraduationCap}
              title={
                allGrades.length === 0
                  ? 'Aucune note publiée'
                  : 'Aucune note avec ces filtres'
              }
              description={
                allGrades.length === 0
                  ? 'Les enseignants publieront ici les notes des évaluations dès qu’elles seront validées.'
                  : 'Élargissez la période, retirez un filtre, ou videz la recherche pour voir plus de notes.'
              }
              tone="slate"
            />
          </div>
        ) : (
          <div className="space-y-3">
            {pageRows.map((g) => (
              <GradeRow key={g.id} grade={g} />
            ))}
            <Pagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'note', plural: 'notes' }}
            />
          </div>
        )}
      </section>

      {activeFilterChips.length > 0 && (
        <p className="mt-4 text-[11px] text-slate-500">
          Filtres actifs :{' '}
          {activeFilterChips.map((chip, idx) => (
            <span key={chip}>
              <span className="font-bold text-slate-700">{chip}</span>
              {idx < activeFilterChips.length - 1 && <span className="text-slate-400"> · </span>}
            </span>
          ))}
        </p>
      )}
    </PortalShell>
  );
}
