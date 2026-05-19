import {
  AlertTriangle,
  BookOpen,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  SubjectPerfCard,
  formatGrade,
  gradeVerdict,
  trendOfDelta,
} from '@pilotage/ui';

import { ChildSelector } from '../_components/ChildSelector';

import { SubjectsFilters } from './SubjectsFilters';
import type {
  BandFilter,
  PerfBand,
  SortKey,
  StatusFilter,
  SubjectPerfItem,
} from './types';

export const metadata: Metadata = { title: 'Suivi des matières' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
}

interface DashboardResp {
  student: {
    id: string;
    firstName: string;
    lastName: string;
    classSectionName: string | null;
    gradeLevelName: string | null;
  };
  subjectPerf: SubjectPerfItem[];
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const VALID_BANDS: ReadonlyArray<PerfBand> = [
  'excellent',
  'bon',
  'correct',
  'risque',
  'unknown',
];

const VALID_STATUSES: ReadonlyArray<StatusFilter> = [
  'above-class',
  'below-class',
  'improving',
  'declining',
  'no-data',
];

const VALID_SORTS: ReadonlyArray<SortKey> = [
  'name-asc',
  'grade-desc',
  'grade-asc',
  'coef-desc',
  'delta-desc',
  'delta-asc',
];

const BAND_META: Record<
  PerfBand,
  { label: string; description: string; pill: string; ring: string }
> = {
  excellent: {
    label: 'Excellent',
    description: 'Moyenne ≥ 16',
    pill: 'bg-emerald-100 text-emerald-700',
    ring: 'ring-emerald-200',
  },
  bon: {
    label: 'Bon',
    description: 'Moyenne entre 14 et 16',
    pill: 'bg-blue-100 text-blue-700',
    ring: 'ring-blue-200',
  },
  correct: {
    label: 'Correct',
    description: 'Moyenne entre 10 et 14',
    pill: 'bg-amber-100 text-amber-800',
    ring: 'ring-amber-200',
  },
  risque: {
    label: 'À renforcer',
    description: 'Moyenne inférieure à 10',
    pill: 'bg-rose-100 text-rose-700',
    ring: 'ring-rose-200',
  },
  unknown: {
    label: 'Pas encore de moyenne',
    description: 'Aucune note publiée',
    pill: 'bg-slate-100 text-slate-600',
    ring: 'ring-slate-200',
  },
};

const STATUS_LABEL: Record<Exclude<StatusFilter, ''>, string> = {
  'above-class': '≥ moyenne de classe',
  'below-class': '< moyenne de classe',
  improving: 'En hausse vs. trimestre',
  declining: 'En baisse vs. trimestre',
  'no-data': 'Pas encore de note',
};

const SORT_LABEL: Record<SortKey, string> = {
  'name-asc': 'Nom A → Z',
  'grade-desc': 'Moyenne ↓',
  'grade-asc': 'Moyenne ↑',
  'coef-desc': 'Coefficient ↓',
  'delta-desc': 'Progression ↑',
  'delta-asc': 'Progression ↓',
};

function bandOf(avg: number | null): PerfBand {
  if (avg == null) return 'unknown';
  if (avg >= 16) return 'excellent';
  if (avg >= 14) return 'bon';
  if (avg >= 10) return 'correct';
  return 'risque';
}

function statusMatches(s: SubjectPerfItem, st: Exclude<StatusFilter, ''>): boolean {
  switch (st) {
    case 'above-class':
      return s.studentAverage != null && s.classAverage != null && s.studentAverage >= s.classAverage;
    case 'below-class':
      return s.studentAverage != null && s.classAverage != null && s.studentAverage < s.classAverage;
    case 'improving':
      return (s.trend ?? 0) > 0;
    case 'declining':
      return (s.trend ?? 0) < 0;
    case 'no-data':
      return s.studentAverage == null;
  }
}

function compareBy(sort: SortKey, a: SubjectPerfItem, b: SubjectPerfItem): number {
  switch (sort) {
    case 'grade-desc':
      return (b.studentAverage ?? -1) - (a.studentAverage ?? -1);
    case 'grade-asc': {
      // Put "no data" last regardless of direction.
      const av = a.studentAverage ?? Number.POSITIVE_INFINITY;
      const bv = b.studentAverage ?? Number.POSITIVE_INFINITY;
      return av - bv;
    }
    case 'coef-desc':
      return b.coefficient - a.coefficient;
    case 'delta-desc':
      return (b.trend ?? -Infinity) - (a.trend ?? -Infinity);
    case 'delta-asc':
      return (a.trend ?? Infinity) - (b.trend ?? Infinity);
    case 'name-asc':
    default:
      return a.subjectName.localeCompare(b.subjectName, 'fr');
  }
}

export default async function ParentSubjectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    studentId?: string;
    band?: string;
    status?: string;
    sort?: string;
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
            { label: 'Suivi des matières' },
          ]}
          title="Suivi des matières"
        />
        <EmptyState
          icon={BookOpen}
          title="Aucun enfant rattaché à votre compte"
          description="Le suivi par matière apparaîtra ici quand un enfant sera lié à votre compte."
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

  const dashboard = await safe(
    api<DashboardResp>(`/api/v1/analytics/parent-dashboard/${activeStudentId}`, {
      cache: 'no-store',
    }),
  );
  const subjects = dashboard?.subjectPerf ?? [];
  const classSectionName = dashboard?.student.classSectionName ?? null;
  const gradeLevelName = dashboard?.student.gradeLevelName ?? null;

  // KPIs computed on the FULL dataset (stable across filters).
  const totalAll = subjects.length;
  const studentAvgs = subjects
    .map((s) => s.studentAverage)
    .filter((v): v is number => v != null);
  const weightedSum = subjects.reduce(
    (acc, s) => acc + (s.studentAverage ?? 0) * s.coefficient,
    0,
  );
  const totalCoef = subjects.reduce(
    (acc, s) => acc + (s.studentAverage != null ? s.coefficient : 0),
    0,
  );
  const overall = totalCoef > 0 ? weightedSum / totalCoef : null;
  const overallSimple =
    studentAvgs.length > 0
      ? studentAvgs.reduce((a, b) => a + b, 0) / studentAvgs.length
      : null;
  const aboveClass = subjects.filter(
    (s) =>
      s.studentAverage != null &&
      s.classAverage != null &&
      s.studentAverage >= s.classAverage,
  ).length;
  const belowClass = subjects.filter(
    (s) =>
      s.studentAverage != null &&
      s.classAverage != null &&
      s.studentAverage < s.classAverage,
  ).length;
  const improvingAll = subjects.filter((s) => (s.trend ?? 0) > 0).length;
  const decliningAll = subjects.filter((s) => (s.trend ?? 0) < 0).length;
  const atRiskAll = subjects.filter(
    (s) =>
      (s.studentAverage != null && s.studentAverage < 10) ||
      (s.studentAverage != null &&
        s.classAverage != null &&
        s.studentAverage < s.classAverage &&
        (s.trend ?? 0) < 0),
  ).length;
  // Subjects that decline AND are below class — the highest-priority list.
  const decliningBelowClass = subjects.filter(
    (s) =>
      s.studentAverage != null &&
      s.classAverage != null &&
      s.studentAverage < s.classAverage &&
      (s.trend ?? 0) < 0,
  );

  // Validate filters.
  const bandFilter: BandFilter =
    sp.band && VALID_BANDS.includes(sp.band as PerfBand) ? (sp.band as PerfBand) : '';
  const statusFilter: StatusFilter =
    sp.status && VALID_STATUSES.includes(sp.status as StatusFilter)
      ? (sp.status as StatusFilter)
      : '';
  const sortKey: SortKey =
    sp.sort && VALID_SORTS.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : 'name-asc';
  const search = (sp.q ?? '').trim().toLowerCase();

  // Apply filters: band → status → search.
  const filtered = subjects
    .filter((s) => (bandFilter ? bandOf(s.studentAverage) === bandFilter : true))
    .filter((s) => (statusFilter ? statusMatches(s, statusFilter) : true))
    .filter((s) => {
      if (!search) return true;
      return (
        s.subjectName.toLowerCase().includes(search) ||
        s.subjectCode.toLowerCase().includes(search)
      );
    });

  // Group by band, sort within each band by the chosen sort.
  const buckets: Record<PerfBand, SubjectPerfItem[]> = {
    excellent: [],
    bon: [],
    correct: [],
    risque: [],
    unknown: [],
  };
  for (const s of filtered) {
    buckets[bandOf(s.studentAverage)].push(s);
  }
  for (const b of Object.keys(buckets) as PerfBand[]) {
    buckets[b].sort((a, c) => compareBy(sortKey, a, c));
  }
  const groupOrder: PerfBand[] = ['excellent', 'bon', 'correct', 'risque', 'unknown'];

  // Active filter chip recap.
  const activeFilterChips: string[] = [];
  if (bandFilter) {
    activeFilterChips.push(`Niveau : ${BAND_META[bandFilter].label}`);
  }
  if (statusFilter) {
    activeFilterChips.push(`Statut : ${STATUS_LABEL[statusFilter]}`);
  }
  if (sortKey !== 'name-asc') {
    activeFilterChips.push(`Tri : ${SORT_LABEL[sortKey]}`);
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
        ? `Performance par matière, classement et tendance trimestrielle — ${classLine}`
        : 'Performance par matière, classement et tendance trimestrielle'
      : 'Cette page s’enrichit dès que les enseignants publient les premières notes';

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Suivi des matières' },
        ]}
        title="Suivi des matières"
        subtitle={headerSubtitle}
      />

      <div className="mt-4">
        <ChildSelector items={children} activeStudentId={activeStudentId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={BookOpen}
          tone="blue"
          label="MATIÈRES SUIVIES"
          value={totalAll}
        >
          Cette année
        </KpiCard>
        <KpiCard
          icon={Sparkles}
          tone="violet"
          label="MOYENNE PONDÉRÉE"
          value={overall != null ? `${formatGrade(overall, 1)} / 20` : '—'}
        >
          {overallSimple != null && overall != null && Math.abs(overall - overallSimple) > 0.05
            ? `Moy. simple : ${formatGrade(overallSimple, 1)}`
            : 'Pondérée par coefficient'}
        </KpiCard>
        <KpiCard
          icon={TrendingUp}
          tone={improvingAll > 0 ? 'green' : 'slate'}
          label="EN HAUSSE"
          value={improvingAll}
        >
          {totalAll > 0
            ? `sur ${totalAll} matière${totalAll > 1 ? 's' : ''}`
            : 'Vs. trimestre précédent'}
        </KpiCard>
        <KpiCard
          icon={atRiskAll > 0 ? TrendingDown : Target}
          tone={atRiskAll > 0 ? 'rose' : 'slate'}
          label="À RENFORCER"
          value={atRiskAll}
        >
          {atRiskAll > 0 ? 'Avg. < 10 ou décrochage' : 'Aucune matière à risque'}
        </KpiCard>
      </div>

      {totalAll > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          <strong>{aboveClass}</strong> matière{aboveClass > 1 ? 's' : ''} ≥ moyenne de classe ·{' '}
          <strong>{belowClass}</strong> matière{belowClass > 1 ? 's' : ''} en dessous ·{' '}
          <strong>{decliningAll}</strong> en baisse vs. trimestre précédent
        </p>
      )}

      {/* Action strip — declining AND below class is the highest-priority signal. */}
      {decliningBelowClass.length > 0 && !statusFilter && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm text-rose-900">
            <p className="font-bold">
              {decliningBelowClass.length} matière{decliningBelowClass.length > 1 ? 's' : ''} en
              décrochage
            </p>
            <p className="mt-0.5 text-xs text-rose-800/80">
              Sous la moyenne de classe <strong>et</strong> en baisse vs. trimestre précédent :{' '}
              {decliningBelowClass
                .slice(0, 4)
                .map((s) => s.subjectName)
                .join(', ')}
              {decliningBelowClass.length > 4
                ? ` (+${decliningBelowClass.length - 4} autres)`
                : ''}
              . Un bon moment pour échanger avec l’enseignant ou planifier du soutien.
            </p>
          </div>
        </div>
      )}

      {totalAll > 0 && (
        <div className="mt-6">
          <SubjectsFilters
            band={bandFilter}
            status={statusFilter}
            sort={sortKey}
            q={search}
          />
        </div>
      )}

      <section className="mt-4 space-y-6">
        {totalAll === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Pas encore de notes par matière"
            description="Le suivi détaillé apparaîtra dès la première note publiée par les enseignants."
            tone="slate"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Aucune matière avec ces filtres"
            description="Élargissez la sélection, retirez un filtre, ou videz la recherche pour voir plus de résultats."
            tone="slate"
          />
        ) : (
          groupOrder.map((b) => {
            const items = buckets[b];
            if (items.length === 0) return null;
            const meta = BAND_META[b];
            return (
              <div key={b} className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                    {meta.label}
                  </h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${meta.pill}`}
                  >
                    {items.length} matière{items.length > 1 ? 's' : ''}
                  </span>
                  <span className="text-[11px] text-slate-400">{meta.description}</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {items.map((s) => {
                    const metrics = [
                      {
                        label: 'Moyenne classe',
                        value:
                          s.classAverage != null ? `${formatGrade(s.classAverage, 1)} /20` : '—',
                      },
                      {
                        label: 'Classement',
                        value:
                          s.studentRank != null && s.classSize > 0
                            ? `${s.studentRank} / ${s.classSize}`
                            : '—',
                      },
                      {
                        label: 'Coefficient',
                        value: `×${s.coefficient.toLocaleString('fr-FR', {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2,
                        })}`,
                      },
                      {
                        label: 'Progression',
                        value:
                          s.trend != null
                            ? `${s.trend > 0 ? '+' : ''}${formatGrade(s.trend, 1)} pts`
                            : '—',
                        trend: trendOfDelta(s.trend),
                      },
                    ];
                    return (
                      <SubjectPerfCard
                        key={s.subjectId}
                        subjectCode={s.subjectCode}
                        subjectName={s.subjectName}
                        grade={s.studentAverage}
                        badge={s.badge ?? gradeVerdict(s.studentAverage)}
                        metrics={metrics}
                        href={`/parent/grades?studentId=${activeStudentId}&subjectId=${s.subjectId}`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })
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
    </PortalShell>
  );
}
