import { FileText, FolderOpen, Image, Paperclip } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { EmptyState, KpiCard, PageHeader } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Ressources' };
export const dynamic = 'force-dynamic';

export default async function TeacherDocumentsPage() {
  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Ressources' },
        ]}
        title="Ressources pédagogiques"
        subtitle="Documents, supports de cours et fichiers partagés avec vos classes"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={FolderOpen} tone="blue" label="DOSSIERS" value="—">
          Espaces organisés
        </KpiCard>
        <KpiCard icon={FileText} tone="green" label="DOCUMENTS" value="—">
          Fichiers stockés
        </KpiCard>
        <KpiCard icon={Image} tone="violet" label="MÉDIAS" value="—">
          Images + vidéos
        </KpiCard>
        <KpiCard icon={Paperclip} tone="amber" label="ESPACE UTILISÉ" value="—">
          Sur quota
        </KpiCard>
      </div>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <EmptyState
          icon={FolderOpen}
          title="Library de ressources en cours de développement"
          description="La library de documents (upload, organisation par classe/matière, partage avec parents et élèves) arrive dans un prochain sprint. En attendant, partagez vos supports via le cahier de texte de chaque classe."
          tone="slate"
        />
      </section>
    </PortalShell>
  );
}
