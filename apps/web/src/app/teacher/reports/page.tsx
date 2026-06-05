import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  Filter,
  GraduationCap,
  Minus,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { FreshnessChip } from '@/components/freshness/FreshnessChip';
import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  SectionHeader,
  SubjectChip,
  subjectColor,
} from '@pilotage/ui';

import { ClassReportRow } from './_components/ClassReportRow';
import { ExportReportButton } from './_components/ExportReportButton';
import { ReportsFilters } from './ReportsFilters';
import type {
  BandFilter,
  ClassReportRowData,
  GradeLevelOption,
  PerfBand,
  SignalFilter,
  SortKey,
  SubjectOption,
} from './types';

export const metadata: Metadata = { title: 'Rapports' };
export const dynamic = 'force-dynamic';

interface TeacherReportsResponse {
  academicYear: { id: string; name: string } | null;
  terms: Array<{ id: string; name: string; orderIndex: number }>;
  kpis: {
    overallAverage: number | null;
    trendDelta: number | null;
    publishedAssessments: number;
    publishedGrades: number;
    passRate: number | null;
  };
  classes: ClassReportRowData[];
  recentAssessments: Array<{
    id: string;
    title: string;
    kind: string;
    classSectionName: string;
    subjectCode: string;
    subjectName: string;
    subjectColor: string | null;
    publishedAt: string | null;
    average: number | null;
    gradedCount: number;
    absentCount: number;
    maxScore: number;
  }>;
  // E6-S4: additive/optional freshness envelope (S3 returns it, served live).
  freshness?: {
    source: 'snapshot' | 'live';
    computedAt: string;
    recomputing: boolean;
    gradeCount?: number;
  };
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

function fmt(n: number | null | undefined, suffix = '') {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n * 10) / 10}${suffix}`;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

const KIND_LABEL: Record<string, string> = {
  written_test: 'Devoir surveillé',
  homework: 'Devoir maison',
  oral: 'Oral',
  project: 'Projet',
  practical: 'TP',
  participation: 'Participation',
  other: 'Autre',
};

const VALID_BANDS: ReadonlyArray<PerfBand> = ['excellent', 'bon', 'correct', 'risque', 'unknown'];
const VALID_SIGNALS: ReadonlyArray<SignalFilter> = [
  'at-risk',
  'low-pass-rate',
  'declining',
  'improving',
  'no-data',
];
const VALID_SORTS: ReadonlyArray<SortKey> = [
  'name-asc',
  'avg-desc',
  'avg-asc',
  'pass-asc',
  'pass-desc',
  'students-desc',
  'trend-desc',
  'trend-asc',
];

interface BandMeta {
  label: string;
  description: string;
  /** Tailwind class for the section header left stripe. */
  stripe: string;
  /** Tailwind class for the count chip. */
  chip: string;
  /** Tailwind class for the icon tile background. */
  iconBg: string;
  iconColor: string;
}

const BAND_META: Record<PerfBand, BandMeta> = {
  excellent: {
    label: 'Excellent',
    description: 'Moyenne ≥ 16 / 20',
    stripe: 'bg-emerald-500',
    chip: 'bg-emerald-100 text-emerald-700',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  bon: {
    label: 'Bon',
    description: 'Moyenne entre 14 et 16',
    stripe: 'bg-blue-500',
    chip: 'bg-blue-100 text-blue-700',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
  },
  correct: {
    label: 'Correct',
    description: 'Moyenne entre 10 et 14',
    stripe: 'bg-amber-500',
    chip: 'bg-amber-100 text-amber-800',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-700',
  },
  risque: {
    label: 'À renforcer',
    description: 'Moyenne inférieure à 10',
    stripe: 'bg-rose-500',
    chip: 'bg-rose-100 text-rose-700',
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-700',
  },
  unknown: {
    label: 'Pas encore de moyenne',
    description: 'Aucune note publiée pour cette affectation',
    stripe: 'bg-slate-300',
    chip: 'bg-slate-100 text-slate-600',
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-500',
  },
};

const BAND_ORDER: ReadonlyArray<PerfBand> = ['risque', 'correct', 'bon', 'excellent', 'unknown'];

function bandOf(avg: number | null): PerfBand {
  if (avg == null) return 'unknown';
  if (avg >= 16) return 'excellent';
  if (avg >= 14) return 'bon';
  if (avg >= 10) return 'correct';
  return 'risque';
}

function trendOf(sparkline: Array<{ y: number }>): number | null {
  if (!sparkline || sparkline.length < 2) return null;
  const first = sparkline[0]!.y;
  const last = sparkline[sparkline.length - 1]!.y;
  return Math.round((last - first) * 10) / 10;
}

function matchesSignal(c: ClassReportRowData, signal: SignalFilter): boolean {
  if (!signal) return true;
  const trend = trendOf(c.sparkline);
  switch (signal) {
    case 'at-risk':
      return c.average !== null && c.average < 10;
    case 'low-pass-rate':
      return c.passRate !== null && c.passRate < 50;
    case 'declining':
      return trend !== null && trend < -0.5;
    case 'improving':
      return trend !== null && trend > 0.5;
    case 'no-data':
      return c.average === null;
    default:
      return true;
  }
}

function sortClasses(rows: ClassReportRowData[], sort: SortKey): ClassReportRowData[] {
  const arr = rows.slice();
  switch (sort) {
    case 'avg-desc':
      return arr.sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
    case 'avg-asc':
      return arr.sort((a, b) => (a.average ?? 21) - (b.average ?? 21));
    case 'pass-desc':
      return arr.sort((a, b) => (b.passRate ?? -1) - (a.passRate ?? -1));
    case 'pass-asc':
      return arr.sort((a, b) => (a.passRate ?? 101) - (b.passRate ?? 101));
    case 'students-desc':
      return arr.sort((a, b) => b.studentCount - a.studentCount);
    case 'trend-desc':
      return arr.sort((a, b) => (trendOf(b.sparkline) ?? -99) - (trendOf(a.sparkline) ?? -99));
    case 'trend-asc':
      return arr.sort((a, b) => (trendOf(a.sparkline) ?? 99) - (trendOf(b.sparkline) ?? 99));
    case 'name-asc':
    default:
      return arr.sort((a, b) =>
        `${a.classSectionName} ${a.subjectName}`.localeCompare(
          `${b.classSectionName} ${b.subjectName}`,
          'fr',
        ),
      );
  }
}

export default async function TeacherReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    subjectId?: string;
    gradeLevel?: string;
    band?: string;
    signal?: string;
    sort?: string;
  }>;
}) {
  const sp = await searchParams;
  const reports = await safe(
    api<TeacherReportsResponse>('/api/v1/analytics/teacher-reports', { cache: 'no-store' }),
  );

  if (!reports) {
    return (
      <PortalShell portal="teacher">
        <PageHeader
          breadcrumb={[
            { label: 'Tableau de bord', href: '/teacher/dashboard' },
            { label: 'Rapports' },
          ]}
          title="Rapports"
          subtitle="Synthèses de performance, bulletins et statistiques d'évaluation par classe"
        />
        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <EmptyState
            icon={BarChart3}
            title="Rapports indisponibles"
            description="Les données ne peuvent pas être chargées pour le moment. Vérifiez votre connexion ou contactez l'administration."
            tone="slate"
            action={{ label: 'Retour au tableau de bord', href: '/teacher/dashboard' }}
          />
        </section>
      </PortalShell>
    );
  }

  const { academicYear, terms, kpis, classes: allClasses, recentAssessments } = reports;

  // --- Filters from URL --------------------------------------------------
  const search = (sp.q ?? '').trim().toLowerCase();
  const band: BandFilter = VALID_BANDS.includes(sp.band as PerfBand)
    ? (sp.band as PerfBand)
    : '';
  const signal: SignalFilter = VALID_SIGNALS.includes(sp.signal as SignalFilter)
    ? (sp.signal as SignalFilter)
    : '';
  const sort: SortKey = VALID_SORTS.includes(sp.sort as SortKey)
    ? (sp.sort as SortKey)
    : 'name-asc';

  // Facet options derived from the unfiltered class list.
  const subjectMap = new Map<string, SubjectOption>();
  const gradeMap = new Map<string, GradeLevelOption>();
  for (const c of allClasses) {
    if (!subjectMap.has(c.subjectId)) {
      subjectMap.set(c.subjectId, {
        id: c.subjectId,
        code: c.subjectCode,
        name: c.subjectName,
      });
    }
    if (c.gradeLevelName) {
      const cur = gradeMap.get(c.gradeLevelName);
      if (cur) cur.count += 1;
      else gradeMap.set(c.gradeLevelName, { name: c.gradeLevelName, count: 1 });
    }
  }
  const subjectFacet = Array.from(subjectMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'fr'),
  );
  const gradeFacet = Array.from(gradeMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'fr'),
  );

  const activeSubjectId = sp.subjectId && subjectMap.has(sp.subjectId) ? sp.subjectId : '';
  const activeGradeLevel = sp.gradeLevel && gradeMap.has(sp.gradeLevel) ? sp.gradeLevel : '';

  // Filter pipeline: subject → gradeLevel → band → signal → search.
  const filtered = allClasses
    .filter((c) => (activeSubjectId ? c.subjectId === activeSubjectId : true))
    .filter((c) => (activeGradeLevel ? c.gradeLevelName === activeGradeLevel : true))
    .filter((c) => (band ? bandOf(c.average) === band : true))
    .filter((c) => matchesSignal(c, signal))
    .filter((c) => {
      if (!search) return true;
      const hay = [
        c.classSectionName,
        c.subjectName,
        c.subjectCode,
        c.gradeLevelName ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(search);
    });

  const sorted = sortClasses(filtered, sort);

  // --- Stable KPIs --------------------------------------------------------
  // Use the unfiltered slice so cards stay steady when filtering.
  const atRiskCount = allClasses.filter((c) => c.average !== null && c.average < 10).length;
  const decliningCount = allClasses.filter((c) => {
    const t = trendOf(c.sparkline);
    return t !== null && t < -0.5;
  }).length;

  const trendIcon =
    kpis.trendDelta === null ? Minus : kpis.trendDelta >= 0 ? TrendingUp : TrendingDown;
  const trendTone: 'green' | 'rose' | 'slate' =
    kpis.trendDelta === null ? 'slate' : kpis.trendDelta >= 0 ? 'green' : 'rose';
  const trendValue =
    kpis.trendDelta === null
      ? '—'
      : `${kpis.trendDelta > 0 ? '+' : ''}${(Math.round(kpis.trendDelta * 10) / 10).toFixed(1)} pt`;

  const noData =
    allClasses.length === 0 ||
    (kpis.publishedGrades === 0 && kpis.publishedAssessments === 0);

  // --- Grouping by perf band ---------------------------------------------
  const grouped: Array<{ band: PerfBand; rows: ClassReportRowData[] }> = [];
  for (const b of BAND_ORDER) {
    const rows = sorted.filter((c) => bandOf(c.average) === b);
    if (rows.length > 0) grouped.push({ band: b, rows });
  }

  // --- Active filter chips -----------------------------------------------
  const activeFilterChips: string[] = [];
  if (activeSubjectId)
    activeFilterChips.push(`Matière : ${subjectMap.get(activeSubjectId)!.name}`);
  if (activeGradeLevel) activeFilterChips.push(`Niveau : ${activeGradeLevel}`);
  if (band) activeFilterChips.push(`Bande : ${BAND_META[band].label}`);
  if (signal) {
    const signalLabels: Record<Exclude<SignalFilter, ''>, string> = {
      'at-risk': 'Classes à risque',
      'low-pass-rate': 'Taux de réussite faible',
      declining: 'Tendance en baisse',
      improving: 'Tendance en hausse',
      'no-data': 'Sans note publiée',
    };
    activeFilterChips.push(`Signal : ${signalLabels[signal]}`);
  }
  if (search) activeFilterChips.push(`Recherche : « ${search} »`);

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Rapports' },
        ]}
        title="Rapports"
        subtitle={
          academicYear
            ? `Synthèses de performance — année ${academicYear.name}`
            : "Synthèses de performance, bulletins et statistiques d'évaluation par classe"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <FreshnessChip freshness={reports.freshness} />
            <ExportReportButton
              classes={allClasses}
              recentAssessments={recentAssessments}
              terms={terms}
              academicYear={academicYear}
              kpis={kpis}
            />
            <Link
              href="/teacher/dashboard"
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-md"
            >
              <BarChart3 className="h-4 w-4" /> Tableau de bord
            </Link>
          </div>
        }
      />

      {/* KPI strip — stable across filters. */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Award}
          tone="blue"
          label="MOYENNE GLOBALE"
          value={fmt(kpis.overallAverage)}
        >
          Toutes classes confondues
        </KpiCard>
        <KpiCard icon={trendIcon} tone={trendTone} label="TENDANCE" value={trendValue}>
          Vs période précédente
        </KpiCard>
        <KpiCard
          icon={CheckCircle2}
          tone="violet"
          label="TAUX DE RÉUSSITE"
          value={kpis.passRate === null ? '—' : `${fmt(kpis.passRate)} %`}
        >
          Notes ≥ 10/20
        </KpiCard>
        <KpiCard
          icon={ClipboardList}
          tone="amber"
          label="ÉVALUATIONS"
          value={String(kpis.publishedAssessments)}
        >
          {kpis.publishedGrades} note{kpis.publishedGrades > 1 ? 's' : ''} publiée
          {kpis.publishedGrades > 1 ? 's' : ''}
        </KpiCard>
      </div>

      {/* Action strip — surfaces classes that need attention. */}
      {!noData && (atRiskCount > 0 || decliningCount > 0) ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-r from-rose-50 via-amber-50 to-white p-4 ring-1 ring-rose-200/70">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700"
          >
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-bold text-slate-900">
              {atRiskCount > 0 ? (
                <>
                  {atRiskCount} classe{atRiskCount > 1 ? 's' : ''} avec moyenne &lt; 10
                </>
              ) : null}
              {atRiskCount > 0 && decliningCount > 0 ? ' · ' : ''}
              {decliningCount > 0 ? (
                <>
                  {decliningCount} classe{decliningCount > 1 ? 's' : ''} en baisse récente
                </>
              ) : null}
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              Filtrez la vue ci-dessous pour cibler les classes prioritaires et adapter votre
              feuille de route pédagogique.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {atRiskCount > 0 ? (
              <Link
                href="/teacher/reports?signal=at-risk"
                className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-rose-700 hover:shadow-md"
              >
                <Target className="h-3.5 w-3.5" /> Voir les classes à risque
              </Link>
            ) : null}
            {decliningCount > 0 ? (
              <Link
                href="/teacher/reports?signal=declining"
                className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-amber-600 hover:shadow-md"
              >
                <TrendingDown className="h-3.5 w-3.5" /> Tendances en baisse
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <SectionHeader
          title="Performance par classe"
          subtitle={
            terms.length
              ? `Moyennes par trimestre et tendance — ${terms.length} période${terms.length > 1 ? 's' : ''}`
              : 'Moyennes consolidées par affectation'
          }
          actionLabel="Voir mes classes"
          actionHref="/teacher/classes"
        />

        {noData ? (
          <div className="mt-3">
            <EmptyState
              icon={GraduationCap}
              title="Aucune note publiée pour l'instant"
              description="Dès que vous publierez des notes depuis le carnet de notes, vos rapports s'enrichiront automatiquement avec des moyennes, des tendances et un classement."
              tone="slate"
              action={{ label: 'Aller au carnet de notes', href: '/teacher/grades' }}
            />
          </div>
        ) : (
          <>
            <div className="mt-4">
              <ReportsFilters
                subjects={subjectFacet}
                gradeLevels={gradeFacet}
                q={search}
                subjectId={activeSubjectId}
                gradeLevel={activeGradeLevel}
                band={band}
                signal={signal}
                sort={sort}
              />
            </div>

            {activeFilterChips.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                <Filter className="h-3 w-3 shrink-0" />
                <span className="font-medium text-slate-600">Filtres actifs :</span>
                {activeFilterChips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700"
                  >
                    {chip}
                  </span>
                ))}
                <Link
                  href="/teacher/reports"
                  className="ml-1 rounded-full px-2 py-0.5 font-bold text-blue-700 hover:bg-blue-50"
                >
                  Réinitialiser
                </Link>
              </div>
            ) : null}

            {sorted.length === 0 ? (
              <div className="mt-5">
                <EmptyState
                  icon={Sparkles}
                  title="Aucune classe ne correspond"
                  description="Aucune affectation ne correspond à vos filtres actuels. Réinitialisez pour retrouver l'intégralité de vos classes."
                  tone="slate"
                  action={{ label: 'Réinitialiser les filtres', href: '/teacher/reports' }}
                />
              </div>
            ) : (
              <div className="mt-4 space-y-6">
                {grouped.map((group) => {
                  const meta = BAND_META[group.band];
                  return (
                    <div key={group.band} className="overflow-hidden rounded-xl ring-1 ring-slate-200/60">
                      <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-2.5">
                        <span aria-hidden className={`h-7 w-1.5 rounded-full ${meta.stripe}`} />
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-bold text-slate-900">{meta.label}</h3>
                          <p className="text-[11px] text-slate-500">{meta.description}</p>
                        </div>
                        <span
                          className={`inline-flex shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.chip}`}
                        >
                          {group.rows.length} classe{group.rows.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 bg-white text-[11px] font-bold uppercase tracking-wide text-slate-500">
                              <th className="py-2.5 pl-4 pr-3">Classe / Matière</th>
                              <th className="px-3 text-center">Élèves</th>
                              <th className="px-3 text-center">Évaluations</th>
                              {terms.map((t) => (
                                <th key={t.id} className="px-3 text-center">
                                  {t.name}
                                </th>
                              ))}
                              <th className="px-3 text-center">Moyenne</th>
                              <th className="px-3 text-center">Réussite</th>
                              <th className="px-3 text-center">Distribution</th>
                              <th className="px-3 pr-4 text-center">Tendance</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {group.rows.map((c) => (
                              <ClassReportRow
                                key={c.assignmentId}
                                row={c}
                                termsCount={terms.length}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <SectionHeader
          title="Évaluations récentes"
          subtitle="Vos 10 dernières évaluations publiées avec leurs moyennes"
          actionLabel="Toutes mes évaluations"
          actionHref="/teacher/assessments"
        />
        {recentAssessments.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Aucune évaluation publiée pour le moment.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {recentAssessments.map((a) => {
              const sc = subjectColor(a.subjectCode);
              const avgTone =
                a.average === null
                  ? 'bg-slate-100 text-slate-500'
                  : a.average >= 14
                    ? 'bg-emerald-100 text-emerald-700'
                    : a.average >= 10
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-rose-100 text-rose-700';
              return (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <span
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                    style={{ backgroundColor: sc.tonal, color: sc.primary }}
                    aria-hidden
                  >
                    <Activity className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{a.title}</span>
                      <SubjectChip
                        subjectCode={a.subjectCode}
                        label={a.subjectName}
                        size="xs"
                      />
                      <span className="text-[11px] text-slate-500">
                        · {a.classSectionName}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {KIND_LABEL[a.kind] ?? a.kind} · publié le {formatDate(a.publishedAt)}{' '}
                      · {a.gradedCount} note{a.gradedCount > 1 ? 's' : ''}
                      {a.absentCount > 0
                        ? ` · ${a.absentCount} absent${a.absentCount > 1 ? 's' : ''}`
                        : ''}
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center justify-center rounded-lg px-2.5 py-1 font-mono text-sm font-bold tabular-nums ${avgTone}`}
                    title="Moyenne de l'évaluation (normalisée /20)"
                  >
                    {a.average === null ? '—' : `${a.average.toFixed(1)} / 20`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-2xl bg-gradient-to-br from-blue-50 via-white to-violet-50 p-5 shadow-sm ring-1 ring-blue-200/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-bold text-slate-900">
              Besoin de bulletins officiels ou d&apos;exports Excel détaillés ?
            </div>
            <div className="mt-0.5 text-xs text-slate-600">
              Les bulletins PDF et exports avancés sont disponibles dans le module administration.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/exports"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Exports administration
            </Link>
            <Link
              href="/teacher/grades"
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-md"
            >
              Carnet de notes →
            </Link>
          </div>
        </div>
      </section>
    </PortalShell>
  );
}
