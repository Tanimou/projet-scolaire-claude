import { Inbox, MailOpen, MessagesSquare } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import type { ConversationDto, ConversationInboxResponse } from '@pilotage/contracts';
import { EmptyState, KpiCard, PageHeader } from '@pilotage/ui';

import { TeacherThreadList } from './TeacherThreadList';

export const metadata: Metadata = { title: 'Conversations parents' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/**
 * Teacher Conversations — the E2-S3 inbox of parent-initiated threads. Server-
 * fetches the role-aware aggregate `GET /api/v1/conversations` (the teacher
 * caller is auto-scoped to teacherId = me server-side — ONE call, unread counts
 * + previews computed server-side, no client N+1) and renders the thread rows.
 *
 * Kept DISTINCT from the `/teacher/messages` Announcements surface (separate
 * route, separate "Conversations parents" sidebar item). This surface is
 * reply-only: teachers cannot cold-start a thread (the controller rejects a
 * teacher `POST /conversations`), so there is NO "Nouveau message" affordance —
 * a thread appears here only once a parent has written.
 *
 * Two terminal states beyond the list (kind, non-stigmatising per the cahier
 * tone): a load-fail rose `role="alert"` banner, and a `MessagesSquare`
 * EmptyState (no action — reply-only) whose copy redirects the broadcast mental
 * model to Annonces. The dual-wall ABAC + tenant scoping are enforced entirely
 * by the backend; this surface only ever shows the caller's own teaching threads.
 */
export default async function TeacherConversationsPage() {
  const inbox = await safe(
    api<ConversationInboxResponse>('/api/v1/conversations', { cache: 'no-store' }),
  );
  const conversations: ConversationDto[] = inbox?.data ?? [];
  const loadFailed = inbox === null;

  const activeCount = conversations.filter((c) => c.status === 'active').length;
  const unreadTotal = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Conversations' },
        ]}
        title="Conversations parents"
        subtitle="Les familles qui vous écrivent au sujet de leurs enfants. Distinct des annonces — ici, vous répondez."
      />

      <div className="mt-6 max-w-2xl space-y-6">
        <section className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 sm:p-5">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <MessagesSquare className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm leading-relaxed text-slate-600">
            Répondez directement aux familles de vos élèves. Vous ne pouvez écrire que dans une
            conversation qu’un parent a ouverte — la messagerie reste privée et bienveillante. Pour
            diffuser une information à une classe, utilisez plutôt les Annonces.
          </p>
        </section>

        {!loadFailed && conversations.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KpiCard
              icon={MessagesSquare}
              tone="violet"
              label="Conversations actives"
              value={activeCount}
            />
            <KpiCard
              icon={unreadTotal > 0 ? MailOpen : Inbox}
              tone="blue"
              label="Messages non lus"
              value={unreadTotal}
            />
          </div>
        )}

        {loadFailed ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-100/80 px-3 py-2 text-sm font-medium text-rose-800"
          >
            Vos conversations n’ont pas pu être chargées. Veuillez réessayer dans un instant.
          </p>
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            tone="violet"
            title="Aucune conversation pour le moment"
            description="Lorsqu’un parent d’un de vos élèves vous écrira, sa conversation apparaîtra ici. Pour diffuser une information à une classe, utilisez plutôt les Annonces."
          />
        ) : (
          <TeacherThreadList conversations={conversations} />
        )}
      </div>
    </PortalShell>
  );
}
