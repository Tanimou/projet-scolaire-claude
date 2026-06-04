'use client';

import { CheckCheck, CircleCheckBig, Loader2, X } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Button } from '@pilotage/ui';

import {
  acknowledgeAlertAction,
  dismissAlertAction,
  resolveAlertAction,
} from './actions';
import type { AlertLifecycleAction, AlertStatus } from './types';

interface AlertActionsProps {
  alertId: string;
  /** Drives which buttons are offered (ack hidden once acknowledged). */
  status: AlertStatus;
  /** Alert title, used to label the action group for assistive tech. */
  title: string;
}

const PENDING_LABEL: Record<AlertLifecycleAction, string> = {
  ack: 'Marquage en cours…',
  resolve: 'Traitement en cours…',
  dismiss: 'Suppression en cours…',
};

/**
 * AlertActions — per-alert lifecycle controls for the parent recommendations
 * surface (E1-S1). Renders three buttons wired to the parent-scoped server
 * actions with `useTransition` pending state:
 *  - « Marquer comme lue » (acknowledge, only when status === 'open')
 *  - « Marquer comme traitée » (resolve, happy path — no confirm)
 *  - « Ignorer » (dismiss, guarded by a lightweight two-step inline confirm)
 *
 * Resolve/dismiss are destructive-to-the-view: on success the page is
 * revalidated and the alert leaves the list (read query returns only
 * open/acknowledged). On error the message is shown inline via an aria-live
 * region and the alert stays in place.
 */
export function AlertActions({ alertId, status, title }: AlertActionsProps) {
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<AlertLifecycleAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState(false);

  const run = (which: AlertLifecycleAction) => {
    setError(null);
    setAction(which);
    startTransition(async () => {
      const fn =
        which === 'ack'
          ? acknowledgeAlertAction
          : which === 'resolve'
            ? resolveAlertAction
            : dismissAlertAction;
      const res = await fn(alertId);
      if (!res.ok) {
        setError(res.error);
        setAction(null);
        setConfirmDismiss(false);
      }
      // On success the server action revalidates and the alert re-renders
      // (or vanishes); no local state reset needed.
    });
  };

  const busy = (which: AlertLifecycleAction) => pending && action === which;
  const showAck = status === 'open';

  return (
    <div className="mt-4 border-t border-white/70 pt-3">
      <div
        role="group"
        aria-label={`Actions pour l'alerte ${title}`}
        className="flex flex-wrap items-center gap-2"
      >
        {showAck && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            aria-busy={busy('ack')}
            onClick={() => run('ack')}
            className="min-h-9"
          >
            {busy('ack') ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <CheckCheck className="h-3.5 w-3.5" aria-hidden />
            )}
            Marquer comme lue
          </Button>
        )}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          aria-busy={busy('resolve')}
          onClick={() => run('resolve')}
          className="min-h-9"
        >
          {busy('resolve') ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <CircleCheckBig className="h-3.5 w-3.5" aria-hidden />
          )}
          Marquer comme traitée
        </Button>

        {confirmDismiss ? (
          <>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
              aria-busy={busy('dismiss')}
              onClick={() => run('dismiss')}
              className="min-h-9"
            >
              {busy('dismiss') ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <X className="h-3.5 w-3.5" aria-hidden />
              )}
              Confirmer l&apos;abandon
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmDismiss(false)}
              className="min-h-9"
            >
              Annuler
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setConfirmDismiss(true)}
            className="min-h-9 text-slate-500 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Ignorer
          </Button>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {pending && action ? PENDING_LABEL[action] : ''}
      </p>

      {error && (
        <p
          aria-live="polite"
          className="mt-2 rounded-lg bg-rose-100/80 px-3 py-1.5 text-xs font-medium text-rose-800"
        >
          {error}
        </p>
      )}
    </div>
  );
}
