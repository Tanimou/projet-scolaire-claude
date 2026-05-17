import { Calendar, CalendarClock, Clock, Users } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { EmptyState, KpiCard, PageHeader } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Emploi du temps' };
export const dynamic = 'force-dynamic';

export default async function TeacherCalendarPage() {
  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Emploi du temps' },
        ]}
        title="Emploi du temps"
        subtitle="Vue hebdomadaire de vos cours, examens et événements"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Clock} tone="blue" label="HEURES / SEMAINE" value="—">
          Total enseigné
        </KpiCard>
        <KpiCard icon={Users} tone="violet" label="SÉANCES / SEMAINE" value="—">
          Total créneaux
        </KpiCard>
        <KpiCard icon={CalendarClock} tone="amber" label="PROCHAIN COURS" value="—">
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
          description="La vue calendrier complète (grille hebdomadaire + drag-and-drop) sera mise en service dans un prochain sprint. En attendant, vos prochains cours sont visibles depuis le tableau de bord."
          tone="slate"
          action={{ label: 'Retour au tableau de bord', href: '/teacher/dashboard' }}
        />
      </section>
    </PortalShell>
  );
}
