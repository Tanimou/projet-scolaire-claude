'use client';

import { Flag, Loader2, ShieldCheck, X } from 'lucide-react';
import { useId, useState, useTransition } from 'react';

import type { ApiResult } from '@/lib/api-client';
import type { ConversationReportDto } from '@pilotage/contracts';
import { Button } from '@pilotage/ui';

const MAX_REASON = 1000;

export interface ReportThreadDialogProps {
  /** The thread being reported. */
  conversationId: string;
  /**
   * Whether the caller has already filed an open report on this thread — drives
   * the calm "déjà signalé" confirmation state instead of the report control.
   */
  alreadyReported?: boolean;
  /**
   * Portal server action that POSTs the report. Passed in by the parent/teacher
   * thread page so this stays a single shared component (no portal branching).
   */
  onReport: (
    conversationId: string,
    reason: string,
  ) => Promise<ApiResult<ConversationReportDto>>;
}

/**
 * ReportThreadDialog — E2-S4 safety control, shared by the parent + teacher
 * thread views. A discreet "Signaler" trigger opens an inline, non-modal panel
 * with an optional reason field; submitting POSTs to the participant-scoped
 * report endpoint (idempotent while open → re-reporting is a calm no-op).
 *
 * Copy is deliberately NON-STIGMATISING (Sally / spec §4 Scenario D): it frames
 * reporting as "asking the school to take a look", never accuses the
 * interlocutor. On success it flips to a reassuring confirmation; the thread
 * itself is never blocked client-side — an admin decides what happens next.
 *
 * Polling/revalidation only (no websocket — the ADR-019 tripwire stays
 * un-triggered). Accessible: the panel is a labelled region with focus-visible
 * controls, an `aria-live` status, and ≥44px touch targets.
 */
export function ReportThreadDialog({
  conversationId,
  alreadyReported = false,
  onReport,
}: ReportThreadDialogProps) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(alreadyReported);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const panelId = useId();
  const reasonId = useId();

  if (done) {
    return (
      <p
        role="status"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"
      >
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        Signalement transmis à l’établissement. Merci, nous y veillons.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
        className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
      >
        <Flag className="h-3.5 w-3.5" aria-hidden />
        Signaler cette conversation
      </button>
    );
  }

  const remaining = MAX_REASON - reason.length;
  const submit = () => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await onReport(conversationId, reason.trim());
      if (res.ok) {
        setDone(true);
        setOpen(false);
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <section
      aria-label="Signaler cette conversation"
      className="rounded-xl bg-rose-50/50 p-3 ring-1 ring-rose-200/70 sm:p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600"
          >
            <Flag className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">
              Demander une vérification
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              Si un message vous semble inapproprié, l’établissement peut y jeter un œil.
              L’historique reste consultable et personne n’est notifié à votre place.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Annuler le signalement"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mt-3">
        <label htmlFor={reasonId} className="text-xs font-medium text-slate-600">
          Quelque chose à préciser ? (facultatif)
        </label>
        <textarea
          id={reasonId}
          rows={2}
          value={reason}
          maxLength={MAX_REASON}
          aria-describedby={panelId}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Décrivez brièvement ce qui vous préoccupe…"
          className="mt-1 w-full resize-y rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus-visible:border-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/30"
        />
        <p id={panelId} className="mt-1 text-[11px] text-slate-400">
          {remaining} caractères restants
        </p>
      </div>

      {error && (
        <p
          aria-live="polite"
          className="mt-2 rounded-lg bg-rose-100/80 px-3 py-2 text-sm font-medium text-rose-800"
        >
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold text-slate-600 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
        >
          Annuler
        </button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          aria-busy={pending}
          onClick={submit}
          className="min-h-11"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Flag className="h-4 w-4" aria-hidden />
          )}
          {pending ? 'Envoi…' : 'Signaler'}
        </Button>
      </div>

      <p aria-live="polite" className="sr-only">
        {pending ? 'Envoi du signalement en cours…' : ''}
      </p>
    </section>
  );
}
