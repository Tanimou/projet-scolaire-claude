import { Inbox, Megaphone, MessageSquare, Users } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { EmptyState, KpiCard, PageHeader } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Messagerie' };
export const dynamic = 'force-dynamic';

export default async function TeacherMessagesPage() {
  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Messagerie' },
        ]}
        title="Messagerie"
        subtitle="Conversations avec les parents, l'administration et les collègues"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Inbox} tone="blue" label="NON LUS" value="—">
          Messages reçus
        </KpiCard>
        <KpiCard icon={MessageSquare} tone="violet" label="CONVERSATIONS" value="—">
          Échanges actifs
        </KpiCard>
        <KpiCard icon={Users} tone="green" label="CONTACTS" value="—">
          Parents joignables
        </KpiCard>
        <KpiCard icon={Megaphone} tone="amber" label="ANNONCES" value="—">
          Diffusées ce trimestre
        </KpiCard>
      </div>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <EmptyState
          icon={MessageSquare}
          title="Messagerie en cours de développement"
          description="Le canal de communication individuel et collectif avec les familles sera ouvert dans un prochain sprint. En attendant, utilisez le module Annonces (administration) pour les communications de masse."
          tone="slate"
        />
      </section>
    </PortalShell>
  );
}
