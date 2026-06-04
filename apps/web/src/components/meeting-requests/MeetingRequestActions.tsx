'use client';

import { CalendarCheck, CheckCheck, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Button } from '@pilotage/ui';

import { resolveMeetingRequestAction } from './actions';
import type { MeetingRequestPortal, MeetingRequestStatus } from './types';

/**
 * MeetingRequestActions — per-row triage controls (E1-S3).
 *
 * Mirrors `AlertInstanceActions`' `useTransition` + inline aria-live error
 * pattern. Two actions on an `open` request:
 *  - « Planifier un échange » (primary) → resolve (status: resolved)
 *  - « Clôturer » (secondary)            → close without follow-up (cancelled)
 *
 * Terminal rows (resolved/cancelled) render an em-dash, like the admin alert
 * row. Both buttons are 44px targets, disabled + spinner while pending, and the
 * status transition is announced politely (SC 4.1.3). The success transition is
 * handled by `revalidatePath` in the action (the row moves to "Historique").
 */
export function MeetingRequestActions({
  id,
  status,
  studentName,
  portal,
}: {
  id: string;
  status: MeetingRequestStatus;
  studentName: string;
  portal: MeetingRequestPortal;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  if (status !== 'open') {
    return <span className="text-[11px] text-slate-400">—</span>;
  }

  const run = (next: 'resolved' | 'cancelled', message: string) => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await resolveMeetingRequestAction(id, portal, next);
      if (res.ok) {
        setAnnounce(message);
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div
      role="group"
      aria-label={`Actions pour la demande de ${studentName}`}
      className="flex flex-col items-stretch gap-1.5 sm:items-end"
    >
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          aria-busy={pending}
          onClick={() => run('resolved', 'Demande marquée comme traitée.')}
          title="Marquer comme traitée — vous contacterez la famille."
          className="min-h-11"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
          )}
          Planifier un échange
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-busy={pending}
          onClick={() => run('cancelled', 'Demande clôturée.')}
          title="Clôturer sans suite."
          className="min-h-11"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <CheckCheck className="h-3.5 w-3.5" aria-hidden />
          )}
          Clôturer
        </Button>
      </div>

      <p aria-live="polite" className="sr-only">
        {pending ? 'Traitement de la demande en cours…' : announce}
      </p>

      {error && (
        <p aria-live="polite" className="text-[11px] font-medium text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
