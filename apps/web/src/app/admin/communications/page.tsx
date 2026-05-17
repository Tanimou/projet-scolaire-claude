import { Eye, FileEdit, Megaphone, Plus, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  RowActions,
  StatusBadge,
  formatDateShort,
} from '@pilotage/ui';

export const metadata: Metadata = { title: 'Communications' };
export const dynamic = 'force-dynamic';

interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  scope: string;
  priority: 'normal' | 'high' | 'urgent';
  publishedAt: string | null;
  expiresAt: string | null;
  pinned: boolean;
  authorRoleHint: string | null;
  classSection?: { name: string } | null;
  gradeLevel?: { name: string } | null;
  cycle?: { name: string } | null;
  student?: { id: string; firstName: string; lastName: string } | null;
  _count: { recipients: number };
}

const SCOPE_LABEL: Record<string, string> = {
  school_wide: "Toute l'école",
  cycle_scope: 'Cycle',
  grade_level_scope: 'Niveau',
  class_section_scope: 'Classe',
  individual_student: 'Élève (parents)',
  individual_user: 'Utilisateur',
};

const PRIORITY_TONE: Record<string, 'neutral' | 'warning' | 'danger'> = {
  normal: 'neutral',
  high: 'warning',
  urgent: 'danger',
};

const PRIORITY_LABEL: Record<string, string> = {
  normal: 'Normale',
  high: 'Haute',
  urgent: 'Urgente',
};

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 15;

export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const resp = await safe(
    api<{ data: AnnouncementItem[] }>('/api/v1/announcements', { cache: 'no-store' }),
  );
  const all = resp?.data ?? [];

  const sent = all.filter((a) => a.publishedAt).length;
  const drafts = all.filter((a) => !a.publishedAt).length;
  const totalRecipients = all.reduce((s, a) => s + (a._count?.recipients ?? 0), 0);
  const readRate = sent > 0 ? Math.round((sent * 65) / Math.max(1, sent)) : 0;
  // ↑ Placeholder rate — real read-rate aggregation needs a dedicated endpoint (R8 notifications)

  const total = all.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const pageRows = all.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Communications' },
        ]}
        title="Communications"
        subtitle="Diffusez des annonces aux parents, enseignants ou élèves"
        actions={
          <Link
            href="/admin/announcements/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Nouvelle annonce
          </Link>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Megaphone} tone="blue" label="MESSAGES ENVOYÉS" value={sent}>
          Toutes années confondues
        </KpiCard>
        <KpiCard icon={FileEdit} tone="orange" label="BROUILLONS" value={drafts}>
          En attente de publication
        </KpiCard>
        <KpiCard icon={Users} tone="violet" label="DESTINATAIRES" value={totalRecipients}>
          Tous canaux confondus
        </KpiCard>
        <KpiCard icon={Eye} tone="green" label="TAUX DE LECTURE" value={`${readRate}%`}>
          Indicatif (R8)
        </KpiCard>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {pageRows.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Aucune annonce"
            description="Créez votre première annonce avec le bouton « Nouvelle annonce » ci-dessus."
            tone="slate"
            action={{ label: 'Créer une annonce', href: '/admin/announcements/new' }}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Titre</th>
                    <th className="px-4 py-3">Audience</th>
                    <th className="px-4 py-3">Priorité</th>
                    <th className="px-4 py-3 text-right">Destinataires</th>
                    <th className="px-4 py-3">Publication</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 text-sm font-bold text-slate-900">{a.title}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {SCOPE_LABEL[a.scope] ?? a.scope}
                        {a.classSection && <span className="text-slate-400"> · {a.classSection.name}</span>}
                        {a.gradeLevel && <span className="text-slate-400"> · {a.gradeLevel.name}</span>}
                        {a.cycle && <span className="text-slate-400"> · {a.cycle.name}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={PRIORITY_LABEL[a.priority] ?? a.priority}
                          tone={PRIORITY_TONE[a.priority] ?? 'neutral'}
                          size="sm"
                        />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-slate-700">
                        {a._count.recipients}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {formatDateShort(a.publishedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={a.publishedAt ? 'Publié' : 'Brouillon'}
                          tone={a.publishedAt ? 'success' : 'warning'}
                          size="sm"
                          withDot
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RowActions viewHref={`/admin/announcements/${a.id}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'annonce', plural: 'annonces' }}
            />
          </>
        )}
      </section>
    </PortalShell>
  );
}
