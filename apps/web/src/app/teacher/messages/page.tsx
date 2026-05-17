import {
  FileEdit,
  Inbox,
  Megaphone,
  MessageSquare,
  Pin,
  Plus,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  StatusBadge,
  formatDateShort,
} from '@pilotage/ui';

import { MessageRowActions } from './MessageRowActions';

export const metadata: Metadata = { title: 'Messagerie' };
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
  cycle?: { name: string } | null;
  gradeLevel?: { name: string } | null;
  classSection?: { name: string } | null;
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
  high: 'Importante',
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

const PAGE_SIZE = 12;

function scopeSummary(a: AnnouncementItem): string {
  const main = SCOPE_LABEL[a.scope] ?? a.scope;
  const target = a.classSection?.name ?? a.gradeLevel?.name ?? a.cycle?.name;
  return target ? `${main} · ${target}` : main;
}

export default async function TeacherMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const resp = await safe(
    api<{ data: AnnouncementItem[] }>('/api/v1/announcements?mine=true', {
      cache: 'no-store',
    }),
  );
  const all = resp?.data ?? [];

  const published = all.filter((a) => a.publishedAt);
  const drafts = all.filter((a) => !a.publishedAt);
  const totalRecipients = published.reduce((s, a) => s + (a._count?.recipients ?? 0), 0);
  const pinnedCount = all.filter((a) => a.pinned).length;

  const total = all.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const pageRows = all.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Messagerie' },
        ]}
        title="Messagerie"
        subtitle="Communiquez avec les familles de vos classes — annonces par classe, niveau ou cycle"
        actions={
          <Link
            href="/teacher/messages/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            <Plus className="h-4 w-4" /> Nouveau message
          </Link>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Megaphone} tone="blue" label="MESSAGES PUBLIÉS" value={published.length}>
          Diffusés cette année
        </KpiCard>
        <KpiCard icon={FileEdit} tone="orange" label="BROUILLONS" value={drafts.length}>
          {drafts.length > 0 ? 'En attente de publication' : 'Aucun brouillon actif'}
        </KpiCard>
        <KpiCard icon={Users} tone="violet" label="DESTINATAIRES TOUCHÉS" value={totalRecipients}>
          Cumul tous messages
        </KpiCard>
        <KpiCard icon={Pin} tone="green" label="ÉPINGLÉS" value={pinnedCount}>
          Visibles en tête de liste
        </KpiCard>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {total === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="Vous n'avez pas encore envoyé de message"
            description="Diffusez une annonce à une classe, un niveau ou un cycle dont vous êtes enseignant. Les parents la recevront dans leur portail famille et en notification."
            tone="slate"
            action={{ label: 'Nouveau message', href: '/teacher/messages/new' }}
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
                    <tr key={a.id} className="transition hover:bg-slate-50/60">
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-start gap-2">
                          {a.pinned && (
                            <Pin
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500"
                              aria-label="Épinglé"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-slate-900">
                              {a.title}
                            </div>
                            <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                              {a.body}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-sm text-slate-700">
                        {scopeSummary(a)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StatusBadge
                          label={PRIORITY_LABEL[a.priority] ?? a.priority}
                          tone={PRIORITY_TONE[a.priority] ?? 'neutral'}
                          size="sm"
                        />
                      </td>
                      <td className="px-4 py-3 text-right align-top font-mono text-sm font-bold tabular-nums text-slate-700">
                        {a._count?.recipients ?? 0}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-500">
                        {a.publishedAt ? formatDateShort(a.publishedAt) : '—'}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {a.publishedAt ? (
                          <StatusBadge label="Publié" tone="success" size="sm" withDot />
                        ) : (
                          <StatusBadge label="Brouillon" tone="warning" size="sm" withDot />
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <MessageRowActions id={a.id} published={!!a.publishedAt} />
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
              itemLabel={{ singular: 'message', plural: 'messages' }}
            />
          </>
        )}
      </section>

      {drafts.length > 0 && (
        <aside className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
              <Inbox className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="font-bold">
                {drafts.length} brouillon{drafts.length > 1 ? 's' : ''} en attente
              </p>
              <p className="mt-0.5 text-amber-800">
                Tant qu&apos;un message reste en brouillon, les familles ne le voient pas. Publiez-le
                depuis le tableau ci-dessus quand il est prêt.
              </p>
            </div>
          </div>
        </aside>
      )}
    </PortalShell>
  );
}
