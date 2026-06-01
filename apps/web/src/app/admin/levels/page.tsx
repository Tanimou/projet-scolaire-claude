import { GraduationCap, Layers, ListChecks, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';

import { CyclesManager } from '@/app/admin/cycles/CyclesManager';
import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { KpiCard, PageHeader } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Cycles & niveaux' };
export const dynamic = 'force-dynamic';

interface CycleItem {
  id: string;
  code: string;
  name: string;
  orderIndex: number;
  color: string | null;
  icon: string | null;
  gradeLevels: GradeLevelItem[];
  _count: { gradeLevels: number };
}
interface GradeLevelItem {
  id: string;
  code: string;
  name: string;
  orderIndex: number;
  cycleId: string;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/**
 * /admin/levels — alias de route de la spec (EN-aligned).
 * Affiche en priorité les **cycles** (blocs pédagogiques de haut niveau),
 * puis les niveaux sont visibles à l'intérieur de chaque cycle.
 * Le composant `CyclesManager` reste la source unique de vérité pour
 * les interactions (création, suppression de cycles et niveaux).
 */
export default async function LevelsPage() {
  const resp = await safe(api<{ data: CycleItem[] }>('/api/v1/cycles', { cache: 'no-store' }));
  // Les cycles sont triés par orderIndex pour respecter la hiérarchie définie par l'admin.
  const cycles = (resp?.data ?? []).sort((a, b) => a.orderIndex - b.orderIndex);

  const totalCycles = cycles.length;
  const totalLevels = cycles.reduce((acc, c) => acc + (c._count?.gradeLevels ?? 0), 0);
  const largestCycle =
    cycles.length === 0
      ? null
      : cycles.reduce(
          (max, c) =>
            (c._count?.gradeLevels ?? 0) > (max._count?.gradeLevels ?? 0) ? c : max,
          cycles[0]!,
        );

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Cycles & niveaux' },
        ]}
        title="Cycles & niveaux"
        subtitle="Les cycles sont l'unité de base de votre organisation pédagogique — chaque cycle contient des niveaux, chaque niveau des classes"
      />

      {/* Bande KPI — les cycles sont affichés en priorité (premier et deuxième blocs) */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* 1er — Cycles (priorité d'affichage) */}
        <KpiCard icon={Layers} tone="blue" label="CYCLES" value={totalCycles}>
          Unités pédagogiques de haut niveau
        </KpiCard>
        {/* 2ème — Niveaux (subordonnés aux cycles) */}
        <KpiCard icon={GraduationCap} tone="green" label="NIVEAUX" value={totalLevels}>
          Niveaux configurés dans les cycles
        </KpiCard>
        <KpiCard
          icon={ListChecks}
          tone="violet"
          label="PLUS GRAND CYCLE"
          value={largestCycle?.name ?? '—'}
        >
          {largestCycle?._count?.gradeLevels ?? 0} niveaux
        </KpiCard>
        <KpiCard
          icon={Sparkles}
          tone="orange"
          label="ORGANISATION"
          value={totalCycles > 0 ? 'Active' : '—'}
        >
          {totalLevels > 0 ? 'Prêt pour créer des classes' : 'Ajoutez un cycle pour démarrer'}
        </KpiCard>
      </div>

      {/*
        Explication de la hiérarchie : cycles AVANT niveaux.
        Les niveaux ne sont accessibles que dans le contexte d'un cycle.
      */}
      <p className="mt-6 text-sm text-slate-600">
        Un <strong>cycle</strong> (ex. Collège, Lycée) regroupe plusieurs{' '}
        <strong>niveaux</strong> (ex. 6ème, 5ème). Chaque niveau accueille ensuite des{' '}
        <strong>classes</strong> rattachées à une année scolaire.
        {totalCycles === 0 && (
          <span className="ml-1 font-semibold text-amber-700">
            Commencez par créer au moins un cycle.
          </span>
        )}
      </p>

      {/* CyclesManager : affiche les cycles en premier, les niveaux à l'intérieur */}
      <div className="mt-6">
        <CyclesManager initial={cycles} />
      </div>
    </PortalShell>
  );
}
