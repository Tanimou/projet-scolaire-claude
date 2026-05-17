import { Building2, Calendar, CalendarRange, GraduationCap, Users } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { KpiCard, PageHeader } from '@pilotage/ui';

import { AcademicYearsManager } from './AcademicYearsManager';

export const metadata: Metadata = { title: 'Années académiques' };
export const dynamic = 'force-dynamic';

export interface AcademicYearItem {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'closed' | 'archived';
  terms: TermItem[];
  _count: { terms: number; classSections: number };
}
export interface TermItem {
  id: string;
  name: string;
  orderIndex: number;
  startDate: string;
  endDate: string;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function AcademicYearsPage() {
  const resp = await safe(
    api<{ data: AcademicYearItem[] }>('/api/v1/academic-years', { cache: 'no-store' }),
  );
  const years = resp?.data ?? [];

  const activeYear = years.find((y) => y.status === 'active');
  const totalTerms = years.reduce((acc, y) => acc + (y._count?.terms ?? 0), 0);
  const totalClasses = years.reduce((acc, y) => acc + (y._count?.classSections ?? 0), 0);

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Années académiques' },
        ]}
        title="Années académiques"
        subtitle="Gérez les années scolaires, les trimestres et leurs périodes"
      />

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Calendar}
          tone="blue"
          label="ANNÉE ACTIVE"
          value={activeYear?.name ?? '—'}
        >
          {activeYear
            ? `Du ${new Date(activeYear.startDate).toLocaleDateString('fr-FR')} au ${new Date(activeYear.endDate).toLocaleDateString('fr-FR')}`
            : 'Activez une année pour démarrer'}
        </KpiCard>
        <KpiCard
          icon={CalendarRange}
          tone="green"
          label="PÉRIODES CONFIGURÉES"
          value={totalTerms}
        >
          Trimestres et semestres
        </KpiCard>
        <KpiCard
          icon={GraduationCap}
          tone="violet"
          label="CLASSES RATTACHÉES"
          value={totalClasses}
        >
          Toutes années confondues
        </KpiCard>
        <KpiCard
          icon={Building2}
          tone="orange"
          label="ANNÉES TOTAL"
          value={years.length}
        >
          Historique complet
        </KpiCard>
      </div>

      <p className="mt-6 text-sm text-slate-600">
        Une seule année peut être <strong>active</strong> à la fois. Activer une nouvelle année
        clôture automatiquement la précédente. Chaque année contient ses trimestres ou semestres.
      </p>

      <div className="mt-6">
        <AcademicYearsManager initial={years} />
      </div>
    </PortalShell>
  );
}
