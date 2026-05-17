import {
  Activity,
  Award,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  GraduationCap,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

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
  classes: Array<{
    assignmentId: string;
    classSectionId: string;
    classSectionName: string;
    gradeLevelName: string | null;
    subjectId: string;
    subjectCode: string;
    subjectName: string;
    subjectColor: string | null;
    studentCount: number;
    average: number | null;
    publishedAssessments: number;
    perTerm: Array<{ termId: string; termName: string; average: number | null }>;
    sparkline: Array<{ x: string; y: number }>;
    passRate: number | null;
    distribution: { low: number; mid: number; high: number };
  }>;
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

export default async function TeacherReportsPage() {
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

  const { academicYear, terms, kpis, classes, recentAssessments } = reports;

  const trendIcon = kpis.trendDelta === null ? Minus : kpis.trendDelta >= 0 ? TrendingUp : TrendingDown;
  const trendTone: 'green' | 'rose' | 'slate' =
    kpis.trendDelta === null ? 'slate' : kpis.trendDelta >= 0 ? 'green' : 'rose';
  const trendValue =
    kpis.trendDelta === null
      ? '—'
      : `${kpis.trendDelta > 0 ? '+' : ''}${(Math.round(kpis.trendDelta * 10) / 10).toFixed(1)} pt`;

  const noData =
    classes.length === 0 ||
    (kpis.publishedGrades === 0 && kpis.publishedAssessments === 0);

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
            <ExportReportButton
              classes={classes}
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
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <th className="py-2.5 pr-3">Classe / Matière</th>
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
                  <th className="px-3 text-center">Tendance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {classes.map((c) => (
                  <ClassReportRow key={c.assignmentId} row={c} termsCount={terms.length} />
                ))}
              </tbody>
            </table>
          </div>
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
              Besoin de bulletins officiels ou d'exports Excel détaillés ?
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
