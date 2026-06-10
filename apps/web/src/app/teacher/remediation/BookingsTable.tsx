'use client';

import {
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquarePlus,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Badge, FormDrawer, StatusBadge } from '@pilotage/ui';
import type { TeacherBookingDto } from '@pilotage/contracts';

import { transitionBookingAction } from './remediation-actions';
import { bookingStatusMeta, formatSessionAt } from './slot-format';

type ToStatus = 'confirmed' | 'declined' | 'completed' | 'no_show' | 'proposed_alternative';

/**
 * E7-S6 — status → icon so the booking badge is icon+text, never colour-alone
 * (WCAG 1.4.1). A cancelled/declined booking is visibly NON-active (an "Annulé"/
 * "Refusé" StatusBadge with an `XCircle`), never a dead row, never "échec" copy.
 */
const BOOKING_STATUS_ICON: Record<string, LucideIcon> = {
  requested: Clock,
  confirmed: Check,
  completed: CheckCircle2,
  cancelled: XCircle,
  declined: XCircle,
  proposed_alternative: CalendarPlus,
};

/**
 * E7-S4 — the teacher booking inbox (client island).
 *
 * Renders the bookings on the caller's own tutor and exposes the lifecycle
 * transitions a teacher may act on, ownership-walled server-side:
 *  - a `requested` booking → Confirmer / Décliner / Proposer un autre créneau;
 *  - a `confirmed` booking → Séance honorée / Absent·e / Décliner.
 * Each transition is a `useTransition` server-action call with an `aria-live`
 * status region (success / kind error), never a blocking reload. Proposing an
 * alternative opens a focus-trapped `FormDrawer` for the required note. Kind,
 * non-stigmatising copy throughout (a no-show is "Absent·e", never a verdict).
 */
export function BookingsTable({ bookings }: { bookings: TeacherBookingDto[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [proposeFor, setProposeFor] = useState<TeacherBookingDto | null>(null);
  const [note, setNote] = useState('');

  function run(bookingId: string, toStatus: ToStatus, successMsg: string, noteArg?: string) {
    setBusyId(bookingId);
    setStatus(null);
    startTransition(async () => {
      const res = await transitionBookingAction(bookingId, toStatus, noteArg);
      setBusyId(null);
      if (res.ok) {
        setStatus({ kind: 'ok', msg: successMsg });
        setProposeFor(null);
        setNote('');
      } else {
        setStatus({ kind: 'err', msg: res.error });
      }
    });
  }

  if (bookings.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200/60">
        Aucune réservation pour l’instant. Dès qu’une famille réservera l’un de vos créneaux,
        elle apparaîtra ici.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Polite live region for transition results (no focus theft). */}
      <p
        role="status"
        aria-live="polite"
        className={
          status
            ? `rounded-lg px-3 py-2 text-sm font-medium ${
                status.kind === 'ok'
                  ? 'bg-emerald-100/80 text-emerald-800'
                  : 'bg-rose-100/80 text-rose-800'
              }`
            : 'sr-only'
        }
      >
        {status?.msg ?? ''}
      </p>

      <ul className="space-y-2.5" role="list">
        {bookings.map((b) => {
          const meta = bookingStatusMeta(b.status);
          const StatusIcon = BOOKING_STATUS_ICON[b.status] ?? null;
          const rowBusy = pending && busyId === b.id;
          const isRequested = b.status === 'requested';
          const isConfirmed = b.status === 'confirmed';
          const actionable = isRequested || isConfirmed;
          return (
            <li
              key={b.id}
              className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">{b.studentName}</span>
                  {b.subjectName && (
                    <Badge variant="brand" className="text-[11px]">
                      {b.subjectName}
                    </Badge>
                  )}
                  <StatusBadge
                    label={meta.label}
                    tone={meta.tone}
                    size="sm"
                    icon={StatusIcon ? <StatusIcon className="h-3.5 w-3.5" aria-hidden /> : undefined}
                  />
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                  <CalendarClock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  {formatSessionAt(b.sessionAt)}
                </p>
                {b.note && <p className="mt-1 text-xs italic text-slate-500">« {b.note} »</p>}
              </div>

              {actionable && (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {rowBusy ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                      Mise à jour…
                    </span>
                  ) : (
                    <>
                      {isRequested && (
                        <button
                          type="button"
                          onClick={() => run(b.id, 'confirmed', `Réservation de ${b.studentName} confirmée.`)}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1"
                        >
                          <Check className="h-4 w-4" aria-hidden />
                          Confirmer
                        </button>
                      )}
                      {isConfirmed && (
                        <button
                          type="button"
                          onClick={() => run(b.id, 'completed', `Séance avec ${b.studentName} marquée honorée.`)}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
                        >
                          <Check className="h-4 w-4" aria-hidden />
                          Séance honorée
                        </button>
                      )}
                      {isConfirmed && (
                        <button
                          type="button"
                          onClick={() => run(b.id, 'no_show', `Absence de ${b.studentName} enregistrée.`)}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                        >
                          <UserX className="h-4 w-4" aria-hidden />
                          Absent·e
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setProposeFor(b);
                          setNote('');
                          setStatus(null);
                        }}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                      >
                        <MessageSquarePlus className="h-4 w-4" aria-hidden />
                        Autre créneau
                      </button>
                      {isRequested && (
                        <button
                          type="button"
                          onClick={() => run(b.id, 'declined', `Demande de ${b.studentName} déclinée.`)}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                        >
                          <X className="h-4 w-4" aria-hidden />
                          Décliner
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Propose-an-alternative note drawer (the only transition needing input). */}
      <FormDrawer
        open={proposeFor != null}
        onClose={() => {
          setProposeFor(null);
          setNote('');
        }}
        title="Proposer un autre créneau"
        description={
          proposeFor
            ? `Indiquez à la famille de ${proposeFor.studentName} un créneau qui vous conviendrait mieux.`
            : undefined
        }
        submitLabel="Envoyer la proposition"
        busy={pending}
        disabledSubmit={!note.trim()}
        onSubmit={() => {
          if (proposeFor && note.trim()) {
            run(
              proposeFor.id,
              'proposed_alternative',
              `Proposition envoyée à la famille de ${proposeFor.studentName}.`,
              note.trim(),
            );
          }
        }}
      >
        <label htmlFor="propose-note" className="block text-sm font-semibold text-slate-700">
          Votre proposition
        </label>
        <textarea
          id="propose-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={280}
          placeholder="Ex. : seriez-vous disponible jeudi à 17 h plutôt ?"
          className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:border-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
        />
        <p className="mt-1 text-xs text-slate-500">{note.length}/280 caractères</p>
      </FormDrawer>
    </div>
  );
}
