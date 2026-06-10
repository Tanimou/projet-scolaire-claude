'use client';

import {
  CheckCircle2,
  Loader2,
  PartyPopper,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { useState, useTransition } from 'react';

import { ConfirmDialog, StatusBadge } from '@pilotage/ui';

import { closePlanAction, reopenPlanAction } from './remediation-actions';

type PlanStatus = 'open' | 'met' | 'closed';

/**
 * E7-S6 — the kind, reversible plan-completion verb (parent plan page island).
 *
 * The completion contract is celebratory + reversible (the most sensitive tone
 * register in the product — never "échec/abandonné/fermé"):
 *  - an OPEN plan offers "Marquer comme atteint 🎉" (met) + a quieter "Clôturer ce
 *    soutien" (closed) — each opens a focus-trapped ConfirmDialog whose copy carries
 *    the reversibility promise ("Vous pourrez le rouvrir à tout moment"), which lowers
 *    the stakes of the click;
 *  - a met/closed plan shows an emerald "Objectif atteint" / neutral "Clôturé"
 *    StatusBadge + a quiet "Rouvrir le soutien" (single tap, no scary confirm) — so
 *    completion is never a trap.
 *
 * A `role="status" aria-live="polite"` region announces the outcome once (no focus
 * theft). A deterministic 409 ("déjà mise à jour") and a kind error are surfaced
 * inline, never a 500. The cron auto-suggest (FR-5) is delivered via the bell, and
 * an OPEN plan that crossed the IMPROVEMENT threshold renders an additional calm,
 * dismissible emerald suggestion banner here — the parent always makes the final call.
 */
export function PlanCompletion({
  planId,
  status,
  subjectLabel,
  suggestImproved = false,
}: {
  planId: string;
  status: PlanStatus;
  subjectLabel: string;
  /** True when the plan's subject crossed the IMPROVEMENT threshold (the cron suggestion mirror). */
  suggestImproved?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<null | 'met' | 'closed'>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const isOpen = status === 'open';
  const isMet = status === 'met';

  function doClose(resolution: 'met' | 'closed') {
    setFeedback(null);
    startTransition(async () => {
      const res = await closePlanAction(planId, resolution);
      setConfirm(null);
      if (res.ok) {
        setFeedback({
          kind: 'ok',
          msg:
            resolution === 'met'
              ? 'Soutien clôturé — objectif atteint. Bravo 🎉'
              : 'Soutien clôturé. Vous pourrez le rouvrir à tout moment.',
        });
      } else {
        setFeedback({ kind: 'err', msg: res.error });
      }
    });
  }

  function doReopen() {
    setFeedback(null);
    startTransition(async () => {
      const res = await reopenPlanAction(planId);
      if (res.ok) {
        setFeedback({ kind: 'ok', msg: 'Soutien rouvert — il réapparaîtra dans votre suivi.' });
      } else {
        setFeedback({ kind: 'err', msg: res.error });
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Auto-suggest-complete banner (cron-mirror): calm, emerald, dismissible — the
          platform celebrates + offers, the parent decides. Open plans only. */}
      {isOpen && suggestImproved && !bannerDismissed && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5"
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-900">
              Les progrès en {subjectLabel} se confirment 🎉
            </p>
            <p className="mt-0.5 text-xs text-emerald-800">
              Vous pouvez clôturer ce soutien si l’objectif est atteint — ou le laisser
              ouvert encore un peu.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirm('met')}
                disabled={pending}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 disabled:opacity-60"
              >
                <PartyPopper className="h-4 w-4" aria-hidden />
                Marquer comme atteint
              </button>
              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                Pas encore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The completion / reopen control row. */}
      <div className="flex flex-wrap items-center gap-2">
        {isOpen ? (
          <>
            {pending && !confirm ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
                …en cours
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setConfirm('met')}
                  disabled={pending}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 disabled:opacity-60"
                  aria-label={`Marquer le soutien en ${subjectLabel} comme atteint`}
                >
                  <PartyPopper className="h-4 w-4" aria-hidden />
                  Marquer comme atteint
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm('closed')}
                  disabled={pending}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-white px-3.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"
                  aria-label={`Clôturer le soutien en ${subjectLabel}`}
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  Clôturer ce soutien
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <StatusBadge
              label={isMet ? 'Objectif atteint' : 'Clôturé'}
              tone={isMet ? 'success' : 'neutral'}
              size="sm"
              icon={
                isMet ? (
                  <PartyPopper className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                )
              }
            />
            <button
              type="button"
              onClick={doReopen}
              disabled={pending}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60"
              aria-label={`Rouvrir le soutien en ${subjectLabel}`}
            >
              {pending ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <RotateCcw className="h-4 w-4" aria-hidden />
              )}
              Rouvrir le soutien
            </button>
          </>
        )}
      </div>

      {/* Polite outcome region (no focus theft). Kind error, never a stack trace. */}
      <p
        role="status"
        aria-live="polite"
        className={
          feedback
            ? `rounded-lg px-3 py-2 text-sm font-medium ${
                feedback.kind === 'ok'
                  ? 'bg-emerald-100/80 text-emerald-800'
                  : 'bg-rose-100/80 text-rose-800'
              }`
            : 'sr-only'
        }
      >
        {feedback?.msg ?? ''}
      </p>

      {/* Completion confirm — the reversibility promise lives in the copy. */}
      <ConfirmDialog
        open={confirm != null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && doClose(confirm)}
        busy={pending}
        title={confirm === 'met' ? 'Clôturer ce soutien ?' : 'Clôturer ce soutien sans suite ?'}
        confirmLabel={confirm === 'met' ? 'Objectif atteint 🎉' : 'Clôturer'}
        cancelLabel="Pas encore"
        description={
          confirm === 'met'
            ? `Bravo — les progrès en ${subjectLabel} se confirment. Vous pourrez le rouvrir à tout moment.`
            : `Le soutien en ${subjectLabel} sera clôturé. Vous pourrez le rouvrir à tout moment si besoin.`
        }
      />
    </div>
  );
}
