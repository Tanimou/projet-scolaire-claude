'use client';

import { Lock, Send, Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, useTransition } from 'react';

import { Button } from '@pilotage/ui';

import { markThreadReadAction, replyToThreadAction } from './conversation-actions';

const MAX_BODY = 2000;

interface TeacherThreadReplyProps {
  conversationId: string;
  /** Thread status — drives the read-only / blocked composer treatment. */
  status: 'active' | 'read_only' | 'archived' | 'blocked';
}

/**
 * TeacherThreadReply — the E2-S3 reply composer (client) for the teacher thread
 * view. The teacher-portal mirror of the parent `ThreadReply`, same interaction
 * grammar (`useTransition`, auto-growing textarea, char counter, single
 * `aria-live` sr-only region, rose fail-closed error card), with teacher-framed
 * copy and the teacher revalidation wired through `conversation-actions.ts`.
 *
 * Two responsibilities, both polling/revalidation only (ADR-019 un-triggered):
 *  1. Fire `PATCH /conversations/:id/read` ONCE on mount so the parent's "Vu"
 *     receipt updates and the teacher's inbox unread cue clears (best-effort).
 *  2. Post a reply via `replyToThreadAction` → `POST /conversations/:id/messages`
 *     (append-only, ABAC re-checked; the parent is notified by the S1 fan-out).
 *
 * When `status !== 'active'` the composer is REPLACED by a calm, non-stigmatising
 * banner (no dead disabled control). A 403-on-send (teaching wall lapsed
 * mid-session) flips the composer to that read-only banner without a reload — the
 * kind self-heal the spec asks for (the thread becomes `read_only`; history stays
 * readable).
 */
export function TeacherThreadReply({ conversationId, status }: TeacherThreadReplyProps) {
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  // Local override so a 403-on-send flips this composer to read-only without a
  // full reload (the server revalidation will agree on the next navigation).
  const [lapsed, setLapsed] = useState(false);
  const bodyId = useId();
  const counterId = useId();
  const markedRef = useRef(false);

  // Mark-read once on open (idempotent server-side; fire-and-forget).
  useEffect(() => {
    if (markedRef.current) return;
    markedRef.current = true;
    void markThreadReadAction(conversationId);
  }, [conversationId]);

  const isReadOnly = status !== 'active' || lapsed;

  if (isReadOnly) {
    const reason =
      status === 'blocked'
        ? 'Cette conversation a été suspendue. L’historique reste consultable.'
        : status === 'archived'
          ? 'Cette conversation est archivée. L’historique reste consultable.'
          : 'Cette conversation est en lecture seule : vous ne suivez plus actuellement cet élève. L’historique reste consultable.';
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600 ring-1 ring-slate-200 sm:p-4"
      >
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <p className="leading-relaxed">{reason}</p>
      </div>
    );
  }

  const trimmedLen = body.trim().length;
  const remaining = MAX_BODY - body.length;
  const nearLimit = remaining <= MAX_BODY * 0.1;
  const canSubmit = trimmedLen > 0 && !pending;

  const submit = () => {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const res = await replyToThreadAction(conversationId, body);
      if (res.ok) {
        setBody('');
        setAnnounce('Message envoyé.');
      } else {
        setError(res.error);
        // A lapsed teaching wall surfaces as a 403; flip to read-only kindly.
        if (/403|lecture seule|n’enseigne|enseigne plus/i.test(res.error)) {
          setLapsed(true);
        }
      }
    });
  };

  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/60 sm:p-4">
      <label htmlFor={bodyId} className="sr-only">
        Votre réponse
      </label>
      <textarea
        id={bodyId}
        rows={3}
        value={body}
        maxLength={MAX_BODY}
        onChange={(e) => setBody(e.target.value)}
        aria-describedby={counterId}
        placeholder="Écrire une réponse à la famille…"
        className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus-visible:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/30"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p
          id={counterId}
          className={`text-xs ${nearLimit ? 'font-semibold text-amber-700' : 'text-slate-400'}`}
        >
          {body.length}/{MAX_BODY}
        </p>
        <Button
          type="button"
          disabled={!canSubmit}
          aria-busy={pending}
          onClick={submit}
          className="min-h-11"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
          {pending ? 'Envoi…' : 'Envoyer'}
        </Button>
      </div>

      <p aria-live="polite" className="sr-only">
        {pending ? 'Envoi du message en cours…' : announce}
      </p>

      {error && (
        <p
          aria-live="polite"
          className="mt-2 rounded-lg bg-rose-100/80 px-3 py-2 text-sm font-medium text-rose-800"
        >
          {error}
        </p>
      )}
    </div>
  );
}
