import { Calendar, CalendarClock, Clock, MapPin } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { EmptyState, KpiCard, PageHeader } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Emploi du temps' };
export const dynamic = 'force-dynamic';

export default async function ParentCalendarPage() {
  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Emploi du temps' },
        ]}
        title="Emploi du temps"
        subtitle="Cours, examens et événements de votre enfant — vue hebdomadaire"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Clock} tone="blue" label="HEURES / SEMAINE" value="—">
          Volume de cours
        </KpiCard>
        <KpiCard icon={CalendarClock} tone="violet" label="COURS / SEMAINE" value="—">
          Total créneaux
        </KpiCard>
        <KpiCard icon={MapPin} tone="amber" label="PROCHAIN COURS" value="—">
          Aujourd&apos;hui
        </KpiCard>
        <KpiCard icon={Calendar} tone="green" label="ÉVÉNEMENTS" value="—">
          Cette semaine
        </KpiCard>
      </div>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <EmptyState
          icon={Calendar}
          title="Emploi du temps en construction"
          description="La grille hebdomadaire avec les cours, examens et événements scolaires sera mise en service dans un prochain sprint. En attendant, consultez les prochaines évaluations pour préparer la semaine."
          tone="slate"
          action={{ label: 'Voir les évaluations à venir', href: '/parent/upcoming' }}
        />
      </section>
    </PortalShell>
  );
}
