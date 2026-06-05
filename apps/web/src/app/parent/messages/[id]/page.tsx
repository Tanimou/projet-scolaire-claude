import { AlertTriangle, ArrowLeft, Check, CheckCheck, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PortalShell } from '@/components/PortalShell';
import { ReportThreadDialog } from '@/components/messaging/ReportThreadDialog';
import { api, ApiError } from '@/lib/api-client';
import type {
  ConversationDto,
  ConversationMessageDto,
  ConversationMessagePage,
} from '@pilotage/contracts';
import { formatDateLong, PageHeader } from '@pilotage/ui';

import { reportThreadAction } from '../messages-actions';
import { ThreadReply } from '../ThreadReply';

export const metadata: Metadata = { title: 'Conversation' };
export const dynamic = 'force-dynamic';

/** Teacher initials for the header avatar chip (max 2 glyphs). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  const last = parts[parts.length - 1] ?? first;
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

/** "Aujourd'hui" / "Hier" / a long date, for the day separators. */
function daySeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  return formatDateLong(iso);
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Parent thread view — the E2-S2 conversation surface. Server-fetches the
 * participant-scoped header (`GET /conversations/:id`) + the first page of
 * messages (`GET /conversations/:id/messages`), both walled to a participant
 * (a non-participant / cross-tenant id → 404, never an existence leak). The
 * `force-dynamic` + revalidation strategy keeps it polling-only (no websocket —
 * the ADR-019 tripwire stays un-triggered).
 *
 * Renders (Sally §3): a back affordance, the teacher identity block, an
 * alert-context header card when the thread is alert-seeded (strict read-only
 * subset, `role="note"`), a `role="log"` message stream with self/teacher
 * bubbles + day separators + a "Vu/Envoyé" receipt on the parent's last sent
 * message, and the `ThreadReply` composer (which also fires mark-read on open
 * and degrades to a calm read-only banner when `status !== 'active'`).
 *
 * "Self" is `senderRole === 'parent'` (this is the parent portal) — no
 * userProfileId match needed, and message bodies render as inert text
 * (`whitespace-pre-wrap`, no `dangerouslySetInnerHTML`) so a hostile body is
 * never interpreted as HTML.
 */
export default async function ParentThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { id } = await params;
  const { before } = await searchParams;

  let header: ConversationDto;
  try {
    header = await api<ConversationDto>(`/api/v1/conversations/${id}`, { cache: 'no-store' });
  } catch (err) {
    if (err instanceof ApiError) notFound();
    throw err;
  }

  const beforeQs = before ? `&before=${encodeURIComponent(before)}` : '';
  let page: ConversationMessagePage = { data: [], hasMore: false, counterpartLastReadAt: null };
  try {
    page = await api<ConversationMessagePage>(
      `/api/v1/conversations/${id}/messages?limit=50${beforeQs}`,
      { cache: 'no-store' },
    );
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    // Header loaded but messages failed — render the header + an empty stream.
  }

  const messages: ConversationMessageDto[] = page.data;
  const counterpartReadAt = page.counterpartLastReadAt
    ? new Date(page.counterpartLastReadAt).getTime()
    : null;

  // Index of the parent's last sent message (for the single read receipt).
  let lastSelfIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.senderRole === 'parent') {
      lastSelfIdx = i;
      break;
    }
  }

  const alert = header.alertContext;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Messages', href: '/parent/messages' },
          { label: header.teacherName },
        ]}
        title={header.teacherName}
        subtitle={`Au sujet de ${header.studentName}`}
        leading={
          <span
            aria-hidden
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-sm font-bold text-violet-700"
          >
            {initials(header.teacherName)}
          </span>
        }
      />

      <div className="mt-6 max-w-2xl space-y-4">
        <Link
          href="/parent/messages"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Retour aux messages
        </Link>

        {/* Alert-context header — strict read-only subset, only when seeded. */}
        {alert && (
          <section
            role="note"
            aria-label="Contexte de l'alerte à l'origine de cette conversation"
            className="rounded-xl bg-amber-50/60 p-3 ring-1 ring-amber-200/70 sm:p-4"
          >
            <div className="flex items-start gap-3">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <AlertTriangle className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                  À propos d’une alerte
                </p>
                <p className="mt-0.5 text-sm font-semibold text-slate-800">{alert.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                  <span>{header.studentName}</span>
                  {alert.subjectName && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span>{alert.subjectName}</span>
                    </>
                  )}
                </p>
                <Link
                  href={`/parent/recommendations?studentId=${header.studentId}`}
                  className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-amber-700 transition hover:text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  Voir l’alerte
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* Message stream. */}
        <section
          role="log"
          aria-label={`Conversation avec ${header.teacherName}`}
          className="space-y-3 rounded-2xl bg-slate-50/60 p-3 ring-1 ring-slate-200/60 sm:p-4"
        >
          {page.hasMore && messages.length > 0 && (
            <div className="flex justify-center">
              <Link
                href={`/parent/messages/${id}?before=${encodeURIComponent(messages[0]?.createdAt ?? '')}`}
                className="inline-flex min-h-11 items-center rounded-lg bg-white px-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                Charger les messages précédents
              </Link>
            </div>
          )}

          {messages.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Aucun message pour le moment. Écrivez le premier ci-dessous.
            </p>
          ) : (
            messages.map((m, i) => {
              const self = m.senderRole === 'parent';
              const prev = messages[i - 1];
              const showDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
              const isLastSelf = i === lastSelfIdx;
              const seen =
                counterpartReadAt !== null &&
                counterpartReadAt >= new Date(m.createdAt).getTime();
              return (
                <div key={m.id}>
                  {showDay && (
                    <div className="my-2 flex justify-center">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                        {daySeparator(m.createdAt)}
                      </span>
                    </div>
                  )}
                  <div className={self ? 'flex justify-end' : 'flex justify-start'}>
                    <div className="max-w-[85%]">
                      {!self && (
                        <p className="mb-0.5 ml-1 text-[11px] font-medium text-slate-500">
                          {m.senderName}
                        </p>
                      )}
                      <div
                        className={
                          self
                            ? 'rounded-2xl rounded-br-md bg-violet-600 px-3.5 py-2.5 text-white'
                            : 'rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-slate-800 ring-1 ring-slate-200/70'
                        }
                      >
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {m.body}
                        </p>
                        <p
                          className={`mt-1 text-[11px] ${self ? 'text-violet-200' : 'text-slate-400'}`}
                        >
                          {timeLabel(m.createdAt)}
                        </p>
                      </div>
                      {isLastSelf && (
                        <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-slate-400">
                          {seen ? (
                            <>
                              <CheckCheck className="h-3 w-3" aria-hidden />
                              Vu
                            </>
                          ) : (
                            <>
                              <Check className="h-3 w-3" aria-hidden />
                              Envoyé
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>

        <ThreadReply conversationId={header.id} status={header.status} />

        {/* Safety control (E2-S4) — discreet, non-stigmatising. Hidden once the
            thread is admin-blocked (the report lever is moot at that point). */}
        {header.status !== 'blocked' && (
          <div className="flex justify-end pt-1">
            <ReportThreadDialog conversationId={header.id} onReport={reportThreadAction} />
          </div>
        )}
      </div>
    </PortalShell>
  );
}
