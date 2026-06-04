import { MessageSquarePlus, MessagesSquare, UserRoundX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import type { ConversationDto, ConversationInboxResponse } from '@pilotage/contracts';
import { buttonVariants, EmptyState, PageHeader } from '@pilotage/ui';

import { ThreadList } from './ThreadList';

export const metadata: Metadata = { title: 'Messages' };
export const dynamic = 'force-dynamic';

interface ChildEnrollment {
  academicYear: { status: string };
}

interface Child {
  id: string;
  enrollments: ChildEnrollment[];
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/**
 * Parent Messages — the E2-S2 inbox (thread list). Replaces the S1 compose-only
 * shell with the real inbox: server-fetches the role-aware aggregate
 * `GET /api/v1/conversations` (ONE call — unread counts + previews computed
 * server-side, no client N+1) and renders the thread rows. The "Nouveau
 * message" entry routes to `/parent/messages/new` (the relocated S1 compose).
 *
 * Three terminal states (all kind, non-stigmatising per the cahier tone):
 *  - no child rattaché → the S1 `UserRoundX` EmptyState (unchanged);
 *  - no thread yet → a `MessagesSquare` EmptyState whose action is "Nouveau
 *    message";
 *  - threads → the `ThreadList` with unread badges + alert chips.
 *
 * The dual-wall ABAC + tenant scoping are enforced entirely by the backend; this
 * surface only ever shows the caller's own participant threads.
 */
export default async function ParentMessagesPage() {
  // Does the parent guard any child? (drives the "no child" EmptyState — same
  // scoped `/students` aggregate the children page reads, no client N+1).
  const studentsResp = await safe(
    api<{ data: Child[] }>('/api/v1/students', { cache: 'no-store' }),
  );
  const hasChild = (studentsResp?.data ?? []).length > 0;

  const inbox = await safe(
    api<ConversationInboxResponse>('/api/v1/conversations', { cache: 'no-store' }),
  );
  const conversations: ConversationDto[] = inbox?.data ?? [];
  const loadFailed = inbox === null && hasChild;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Messages' },
        ]}
        title="Messages"
        subtitle="Vos échanges avec les enseignant·e·s de votre enfant"
        actions={
          hasChild ? (
            <Link href="/parent/messages/new" className={`${buttonVariants()} min-h-11`}>
              <MessageSquarePlus className="h-4 w-4" aria-hidden />
              Nouveau message
            </Link>
          ) : undefined
        }
      />

      <div className="mt-6 max-w-2xl space-y-6">
        <section className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 sm:p-5">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <MessagesSquare className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm leading-relaxed text-slate-600">
            Contactez directement un·e enseignant·e qui suit votre enfant pour poser une
            question ou demander un point. La conversation reste privée et bienveillante.
          </p>
        </section>

        {!hasChild ? (
          <EmptyState
            icon={UserRoundX}
            tone="slate"
            title="Aucun enfant rattaché"
            description="La messagerie s'ouvre une fois un enfant rattaché à votre compte. Contactez l'administration de l'établissement pour rattacher le dossier de votre enfant."
          />
        ) : loadFailed ? (
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
            description="Démarrez un échange avec un·e enseignant·e qui suit votre enfant pour poser une question ou demander un point."
            action={{ label: 'Nouveau message', href: '/parent/messages/new' }}
          />
        ) : (
          <ThreadList conversations={conversations} />
        )}
      </div>
    </PortalShell>
  );
}
