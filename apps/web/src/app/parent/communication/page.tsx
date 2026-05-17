import { Inbox, MessageSquare, Send, Users } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { EmptyState, KpiCard, PageHeader } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Communication' };
export const dynamic = 'force-dynamic';

export default async function ParentCommunicationPage() {
  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Communication' },
        ]}
        title="Communication"
        subtitle="Échangez avec les enseignants et l'administration de l'établissement"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Inbox} tone="blue" label="MESSAGES REÇUS" value="—">
          Non lus
        </KpiCard>
        <KpiCard icon={Send} tone="violet" label="MESSAGES ENVOYÉS" value="—">
          Ce trimestre
        </KpiCard>
        <KpiCard icon={MessageSquare} tone="amber" label="CONVERSATIONS" value="—">
          Échanges actifs
        </KpiCard>
        <KpiCard icon={Users} tone="green" label="CONTACTS" value="—">
          Enseignants joignables
        </KpiCard>
      </div>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <EmptyState
          icon={MessageSquare}
          title="Messagerie en cours de développement"
          description="Le canal de communication individuel avec les enseignants et l'administration sera ouvert dans un prochain sprint. En attendant, consultez les annonces de l'école pour les informations générales."
          tone="slate"
          action={{ label: 'Voir les annonces', href: '/parent/announcements' }}
        />
      </section>
    </PortalShell>
  );
}
