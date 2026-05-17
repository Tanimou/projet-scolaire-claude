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
 * /admin/levels — image-prescribed route alias for `/admin/cycles`.
 * Enriched with KPI cards + PageHeader, then delegates to the existing
 * `CyclesManager` for the interactive list (single source of truth).
 */
export default async function LevelsPage() {
  const resp = await safe(api<{ data: CycleItem[] }>('/api/v1/cycles', { cache: 'no-store' }));
  const cycles = resp?.data ?? [];

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
        subtitle="Organisez votre établissement en cycles puis créez les niveaux qui contiendront les classes"
      />

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Layers} tone="blue" label="CYCLES" value={totalCycles}>
          Maternelle, Primaire, Collège, Lycée…
        </KpiCard>
        <KpiCard icon={GraduationCap} tone="green" label="NIVEAUX" value={totalLevels}>
          Niveaux scolaires configurés
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

      <p className="mt-6 text-sm text-slate-600">
        Un <strong>cycle</strong> regroupe plusieurs <strong>niveaux</strong>. Chaque niveau
        accueille ensuite des <strong>classes</strong> rattachées à une année scolaire.
      </p>

      <div className="mt-6">
        <CyclesManager initial={cycles} />
      </div>
    </PortalShell>
  );
}
