'use client';

import {
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  LayoutGrid,
  ListChecks,
  Loader2,
  MessagesSquare,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { Button, formatDateLong } from '@pilotage/ui';

import {
  deriveAlertActions,
  type AlertNextStep,
} from './alert-next-steps';
import { requestMeetingIntentAction } from './intent-actions';
import type { AlertCode } from './types';

interface AlertNextStepsProps {
  alertId: string;
  code: AlertCode;
  studentId: string;
  subjectId: string | null;
  subjectCode: string | null;
  subjectName: string | null;
  title: string;
  /** Pre-existing intent timestamp (ISO) if the parent already requested one. */
  meetingRequestedAt?: string | null;
}

const STEP_ICON: Record<AlertNextStep['icon'], typeof BookOpenCheck> = {
  BookOpenCheck,
  CalendarClock,
  LayoutGrid,
  UserRound,
};

/** Calm, semantic tints (NOT severity) for each step's leading icon chip. */
const STEP_ICON_CLS: Record<AlertNextStep['kind'], string> = {
  'reinforce-subject': 'bg-blue-50 text-blue-700',
  attendance: 'bg-rose-50 text-rose-700',
  subjects: 'bg-blue-50 text-blue-700',
  'child-profile': 'bg-slate-100 text-slate-600',
};

/**
 * AlertNextSteps — the E1-S2 "Que puis-je faire ?" panel rendered inside each
 * parent alert card, between the recommendation box and the S1 lifecycle
 * `AlertActions`. It expands the static recommendation into 2–3 concrete,
 * explainable next steps:
 *  - 1–2 deterministic deep-link rows derived by `deriveAlertActions` (pure,
 *    unit-tested) — always studentId-scoped, never a broken `subject=null`.
 *  - an always-present "En parler à l'enseignant" CTA that records a
 *    lightweight, append-only, idempotent meeting-request intent (no model,
 *    ABAC-scoped) via `requestMeetingIntentAction`.
 *
 * The intent CTA mirrors `AlertActions`' `useTransition` + aria-live pattern;
 * on success it collapses into an inline, non-blocking confirmation and the
 * alert's status is unchanged (no revalidate, no scroll reset). The panel is a
 * labelled `role="group"`, distinct from the lifecycle group, with rationale
 * text at text-slate-600 (4.5:1 on the tinted card) and 44px CTA targets.
 */
export function AlertNextSteps({
  alertId,
  code,
  studentId,
  subjectId,
  subjectCode,
  subjectName,
  title,
  meetingRequestedAt = null,
}: AlertNextStepsProps) {
  const steps = deriveAlertActions({ code, studentId, subjectId, subjectCode, subjectName });

  // Deep-link to the alert-seeded compose (E2): the body pre-fills + alertId is
  // forwarded so the created thread carries the alert context. The server
  // re-checks guardianship + alert.studentId === studentId — never widens access.
  const messagesHref =
    `/parent/messages/new?alertId=${encodeURIComponent(alertId)}` +
    `&studentId=${encodeURIComponent(studentId)}` +
    (subjectId ? `&subjectId=${encodeURIComponent(subjectId)}` : '') +
    `&alertTitle=${encodeURIComponent(title)}`;

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [requestedAt, setRequestedAt] = useState<string | null>(meetingRequestedAt);
  // Announced politely only on the success transition (empty on initial load,
  // so a pre-requested alert is not re-announced) — WCAG 2.2 SC 4.1.3.
  const [announce, setAnnounce] = useState('');

  const requested = requestedAt !== null;

  const requestMeeting = () => {
    setError(null);
    startTransition(async () => {
      const res = await requestMeetingIntentAction(alertId);
      if (res.ok) {
        setRequestedAt(res.data.requestedAt);
        setAnnounce('Demande envoyée — l’équipe vous recontactera.');
      } else {
        setError(res.error);
      }
    });
  };

  const groupLabel = `Étapes recommandées pour l'alerte ${title}`;

  return (
    <section
      role="group"
      aria-label={groupLabel}
      className="mt-3 rounded-xl bg-white/85 p-3 ring-1 ring-white/80 sm:p-4"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
          <ListChecks className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
          Que puis-je faire&nbsp;?
        </span>
      </div>

      <ul className="mt-3 space-y-2" role="list">
        {steps.map((step) => {
          const StepIcon = STEP_ICON[step.icon];
          return (
            <li key={step.kind}>
              <Link
                href={step.href}
                className="group flex min-h-11 items-center gap-3 rounded-lg bg-white/70 px-3 py-2 ring-1 ring-slate-200/70 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-safe:hover:-translate-y-px motion-safe:hover:shadow-sm hover:bg-white"
              >
                <span
                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${STEP_ICON_CLS[step.kind]}`}
                >
                  <StepIcon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800">
                    {step.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-slate-600">
                    {step.helper}
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-slate-600"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}

        {/* Always-present "talk to the teacher" intent CTA. */}
        <li>
          {requested ? (
            <div className="flex min-h-11 items-start gap-3 rounded-lg bg-emerald-50 px-3 py-2 ring-1 ring-emerald-200">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-emerald-800">
                  Demande envoyée — l’équipe vous recontactera
                </span>
                {requestedAt && (
                  <span className="mt-0.5 block text-xs text-emerald-700">
                    Le {formatDateLong(requestedAt)}
                  </span>
                )}
              </span>
            </div>
          ) : (
            <div className="rounded-lg bg-violet-50/70 px-3 py-2.5 ring-1 ring-violet-200/70">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                  <MessagesSquare className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800">
                    En parler à l’enseignant·e
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-slate-600">
                    Ouvrez une conversation reliée à cette alerte, ou demandez un
                    rendez-vous avec l’équipe.
                  </span>
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-11">
                {/* Primary (E2): open the alert-seeded thread — the compose pre-fills
                    the body + forwards alertId/subjectId so the created thread carries
                    the alert context. The server re-checks the alert↔student wall. */}
                <Link
                  href={messagesHref}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1"
                >
                  <MessagesSquare className="h-3.5 w-3.5" aria-hidden />
                  Écrire à l’enseignant·e
                </Link>
                {/* Secondary (E1, preserved): the idempotent meeting-request intent. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-busy={pending}
                  onClick={requestMeeting}
                  className="min-h-11 shrink-0 text-violet-700"
                >
                  {pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {pending ? 'Envoi en cours…' : 'Demander un rendez-vous'}
                </Button>
              </div>
            </div>
          )}
        </li>
      </ul>

      <p aria-live="polite" className="sr-only">
        {pending ? 'Envoi de la demande en cours…' : announce}
      </p>

      {error && (
        <p
          aria-live="polite"
          className="mt-2 rounded-lg bg-rose-100/80 px-3 py-1.5 text-xs font-medium text-rose-800"
        >
          {error}
        </p>
      )}
    </section>
  );
}
