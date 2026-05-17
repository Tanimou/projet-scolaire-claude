import { FileText, FolderOpen, Image, Paperclip } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { EmptyState, KpiCard, PageHeader } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Documents' };
export const dynamic = 'force-dynamic';

export default async function ParentDocumentsPage() {
  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Documents' },
        ]}
        title="Documents"
        subtitle="Bulletins, certificats de scolarité, attestations et règlement intérieur"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={FileText} tone="blue" label="BULLETINS" value="—">
          Trimestres archivés
        </KpiCard>
        <KpiCard icon={Paperclip} tone="violet" label="CERTIFICATS" value="—">
          Scolarité + attestations
        </KpiCard>
        <KpiCard icon={FolderOpen} tone="green" label="RESSOURCES" value="—">
          Documents école
        </KpiCard>
        <KpiCard icon={Image} tone="amber" label="MÉDIAS" value="—">
          Photos d&apos;événements
        </KpiCard>
      </div>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <EmptyState
          icon={FolderOpen}
          title="Espace documents en construction"
          description="Le téléchargement des bulletins PDF, certificats de scolarité et autres documents administratifs sera disponible une fois le worker d'exports asynchrones (R7) connecté aux flux parent."
          tone="slate"
        />
      </section>
    </PortalShell>
  );
}
