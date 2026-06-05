import { BarChart3, Target, TrendingUp, Users } from 'lucide-react';
import type { Metadata } from 'next';

import { FreshnessChip } from '@/components/freshness/FreshnessChip';
import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { KpiCard, PageHeader } from '@pilotage/ui';

import { PerformanceDrilldown, type DrilldownResponse } from './PerformanceDrilldown';

export const metadata: Metadata = { title: 'Analytique — Performances' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/**
 * Search params pilotent la profondeur du drill-down (re-fetch côté serveur à
 * chaque navigation, comme le journal d'audit). Les `*Name` sont des libellés
 * passés par les liens pour afficher le fil d'Ariane sans requête supplémentaire.
 */
interface SearchParams {
  termId?: string;
  cycleId?: string;
  cycleName?: string;
  classSectionId?: string;
  className?: string;
  subjectId?: string;
  subjectName?: string;
}

function buildQuery(p: SearchParams): string {
  const qs = new URLSearchParams();
  if (p.termId) qs.set('termId', p.termId);
  if (p.cycleId) qs.set('cycleId', p.cycleId);
  if (p.classSectionId) qs.set('classSectionId', p.classSectionId);
  if (p.subjectId) qs.set('subjectId', p.subjectId);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  // Next 15 : searchParams est une Promise.
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const data = await safe(
    api<DrilldownResponse>(
      `/api/v1/analytics/school-performance-drilldown${buildQuery(sp)}`,
      { cache: 'no-store' },
    ),
  );

  // KPI strip : toujours la synthèse niveau cycle de l'année (indépendant du
  // niveau de drill-down courant) pour garder une tête de page stable.
  const overview =
    data?.level === 'cycle'
      ? data
      : await safe(
          api<DrilldownResponse>(
            `/api/v1/analytics/school-performance-drilldown${buildQuery({ termId: sp.termId })}`,
            { cache: 'no-store' },
          ),
        );

  const cycleGroups = overview?.groups ?? [];
  const totalStudents = cycleGroups.reduce((acc, g) => acc + g.studentsWithGrades, 0);
  const totalPassing = cycleGroups.reduce((acc, g) => acc + g.studentsPassing, 0);
  const overallRate =
    totalStudents > 0 ? Math.round((totalPassing / totalStudents) * 100) : null;
  const bestCycle = [...cycleGroups]
    .filter((g) => g.successRate !== null)
    .sort((a, b) => (b.successRate ?? 0) - (a.successRate ?? 0))[0];

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Analytique' },
        ]}
        title="Analytique des performances"
        subtitle="Explorez la réussite par cycle, classe, matière puis élève — filtrable par trimestre."
        actions={<FreshnessChip freshness={data?.freshness} />}
      />

      {/* KPI strip — synthèse de l'année active (niveau cycle) */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Target}
          tone="blue"
          label="TAUX DE RÉUSSITE GLOBAL"
          value={overallRate !== null ? `${overallRate}%` : '—'}
        >
          Élèves avec une moyenne ≥ 10/20
        </KpiCard>
        <KpiCard icon={Users} tone="green" label="ÉLÈVES ÉVALUÉS" value={totalStudents}>
          Au moins une note publiée
        </KpiCard>
        <KpiCard
          icon={TrendingUp}
          tone="violet"
          label="MEILLEUR CYCLE"
          value={bestCycle?.name ?? '—'}
        >
          {bestCycle?.successRate != null
            ? `${Math.round(bestCycle.successRate)}% de réussite`
            : 'Pas encore de données'}
        </KpiCard>
        <KpiCard icon={BarChart3} tone="orange" label="CYCLES ANALYSÉS" value={cycleGroups.length}>
          Ventilation par cycle pédagogique
        </KpiCard>
      </div>

      <div className="mt-6">
        <PerformanceDrilldown
          data={data}
          selection={{
            termId: sp.termId ?? '',
            cycleId: sp.cycleId,
            cycleName: sp.cycleName,
            classSectionId: sp.classSectionId,
            className: sp.className,
            subjectId: sp.subjectId,
            subjectName: sp.subjectName,
          }}
        />
      </div>
    </PortalShell>
  );
}
