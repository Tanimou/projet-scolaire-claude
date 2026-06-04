'use client';

import { Lock, Send, Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, useTransition } from 'react';

import type { ConversationMessageDto } from '@pilotage/contracts';
import { Button } from '@pilotage/ui';

import { markThreadReadAction, replyToThreadAction } from './messages-actions';

const MAX_BODY = 2000;

interface ThreadReplyProps {
  conversationId: string;
  /** Thread status — drives the read-only / blocked composer treatment. */
  status: 'active' | 'read_only' | 'archived' | 'blocked';
}

/**
 * ThreadReply — the E2-S2 reply composer (client) for the parent thread view.
 *
 * Two responsibilities, both polling/revalidation-only (the ADR-019 websocket
 * tripwire stays un-triggered):
 *  1. Fire `PATCH /conversations/:id/read` ONCE on mount so the inbox row + nav
 *     badge decrement (best-effort; a failure never blocks reading the thread).
 *  2. Post a reply to the existing S1 `POST /conversations/:id/messages` via the
 *     `replyToThreadAction` server action, which `revalidatePath`s the thread so
 *     the server-rendered stream refreshes with the new bubble.
 *
 * Interaction grammar mirrors `ComposeForm`: `useTransition`, a single
 * `aria-live="polite"` sr-only region, an auto-growing textarea with a char
 * counter, a rose fail-closed error card. On a 403 (lapsed teaching wall) the
 * composer flips to the read-only banner — the kind self-heal the spec asks for
 * (the thread becomes `read_only`; history stays readable).
 *
 * When `status !== 'active'` the composer is REPLACED by a calm, non-stigmatising
 * banner (no dead disabled control), per PM-12 / Sally §3.
 */
export function ThreadReply({ conversationId, status }: ThreadReplyProps) {
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
          : 'Cette conversation est en lecture seule : l’enseignant·e ne suit plus actuellement votre enfant. L’historique reste consultable.';
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
        placeholder="Écrire une réponse…"
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
