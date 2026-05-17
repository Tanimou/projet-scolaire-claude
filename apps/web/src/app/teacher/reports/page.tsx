import { BarChart3, FileSpreadsheet, FileText, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { EmptyState, KpiCard, PageHeader } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Rapports' };
export const dynamic = 'force-dynamic';

export default async function TeacherReportsPage() {
  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Rapports' },
        ]}
        title="Rapports"
        subtitle="Synthèses de performance, bulletins et statistiques d'évaluation par classe"
        actions={
          <Link
            href="/teacher/dashboard"
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <BarChart3 className="h-4 w-4" /> Voir le tableau de bord
          </Link>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={BarChart3} tone="blue" label="MOYENNE GLOBALE" value="—">
          Toutes classes
        </KpiCard>
        <KpiCard icon={TrendingUp} tone="green" label="TENDANCE" value="—">
          Vs trimestre précédent
        </KpiCard>
        <KpiCard icon={FileText} tone="rose" label="BULLETINS" value="—">
          Générés
        </KpiCard>
        <KpiCard icon={FileSpreadsheet} tone="violet" label="GRILLES" value="—">
          Exports Excel
        </KpiCard>
      </div>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <EmptyState
          icon={BarChart3}
          title="Rapports détaillés en construction"
          description="Les synthèses par matière et par classe (performance individuelle, classement, comparaisons trimestrielles) seront ajoutées dans un prochain sprint. En attendant, les exports Excel et bulletins PDF sont disponibles côté administration."
          tone="slate"
          action={{ label: 'Voir les exports admin', href: '/admin/exports' }}
        />
      </section>
    </PortalShell>
  );
}
