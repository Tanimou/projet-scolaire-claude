'use client';

import {
  CheckCircle2,
  Loader2,
  SearchX,
  ShieldCheck,
  UserRound,
  XCircle,
} from 'lucide-react';
import { useId, useState, useTransition } from 'react';

import {
  Button,
  EmptyState,
  FormDrawer,
  formatDateLong,
  formatDateShort,
} from '@pilotage/ui';

import { approveChildClaimAction, rejectChildClaimAction } from './actions';
import { RELATIONSHIP_LABEL, type AdminChildClaimRow } from './types';

const MATCH_METHOD_LABEL: Record<string, string> = {
  externalRef: 'Référence exacte',
  'name+dob': 'Nom + date de naissance',
};

/** Reject reason client gate — mirrors the server `@IsNotEmpty @MaxLength(500)`. */
const REASON_MAX = 500;

export interface ChildClaimsQueueProps {
  rows: AdminChildClaimRow[];
}

/**
 * "Demandes de rattachement" admin queue island (E9-S2).
 *
 * Renders the pending child-claim queue as evidence cards (parent-typed claim vs
 * matched roster student, side-by-side) with two per-row actions:
 *  - « Approuver » → the from-status-guarded `pending → active` grant. On success
 *    the row leaves the queue (optimistic removal); the idempotent re-approve 200
 *    and the deterministic-409 concurrent-loser both resolve calmly (no red toast).
 *  - « Rejeter » → a reason-required FormDrawer over the hardened `@pilotage/ui`
 *    Drawer (E3-S3 WCAG focus-trap + restore-to-trigger). The reason is required
 *    client-side (the server 400s a blank reason as a second wall).
 *
 * Every outcome announces via a polite `role=status` live region. Copy is kind,
 * factual and non-stigmatising: a rejection is "à corriger", never destructive.
 */
export function ChildClaimsQueue({ rows }: ChildClaimsQueueProps) {
  // Optimistic overlay — actioned claimIds are removed from the visible queue.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [announce, setAnnounce] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminChildClaimRow | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = rows.filter((r) => !removed.has(r.claimId));

  function approve(row: AdminChildClaimRow) {
    if (pending) return;
    setPendingId(row.claimId);
    startTransition(async () => {
      const res = await approveChildClaimAction(row.claimId);
      setPendingId(null);
      if (res.ok) {
        setRemoved((prev) => new Set(prev).add(row.claimId));
        setAnnounce('Rattachement validé — le parent a été notifié.');
      } else {
        // A concurrent-loser 409 / already-handled row → calm, remove it.
        setRemoved((prev) => new Set(prev).add(row.claimId));
        setAnnounce(
          res.error?.includes('attente')
            ? 'Cette demande vient d’être traitée.'
            : res.error || 'Cette demande vient d’être traitée.',
        );
      }
    });
  }

  if (visible.length === 0) {
    return (
      <>
        <EmptyState
          icon={ShieldCheck}
          tone="green"
          title="Aucune demande en attente"
          description="Tout est à jour. Les demandes de rattachement envoyées par les familles apparaîtront ici pour vérification."
        />
        <p role="status" aria-live="polite" className="sr-only">
          {announce}
        </p>
      </>
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {visible.map((row) => {
          const isPending = pending && pendingId === row.claimId;
          const matchLabel = row.evidence.matchMethod
            ? MATCH_METHOD_LABEL[row.evidence.matchMethod] ?? row.evidence.matchMethod
            : null;

          return (
            <li
              key={row.claimId}
              className="rounded-2xl border-l-[3px] border-amber-400 bg-white p-4 shadow-sm ring-1 ring-slate-200/60"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                {/* Evidence: parent claim vs matched student, side-by-side */}
                <div className="min-w-0 flex-1">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        Demande du parent
                      </p>
                      <p className="mt-0.5 truncate text-sm font-bold text-slate-900">
                        {row.evidence.firstName} {row.evidence.lastName}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {row.evidence.birthDate
                          ? `né·e le ${formatDateShort(row.evidence.birthDate)}`
                          : 'date de naissance non renseignée'}
                        {row.evidence.externalRef ? ` · réf. ${row.evidence.externalRef}` : ''}
                      </p>
                      {matchLabel && (
                        <span className="mt-1.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {matchLabel}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        Élève trouvé
                      </p>
                      {row.matchedStudent ? (
                        <>
                          <p className="mt-0.5 truncate text-sm font-bold text-slate-900">
                            {row.matchedStudent.firstName} {row.matchedStudent.lastName}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {row.matchedStudent.birthDate
                              ? `né·e le ${formatDateShort(row.matchedStudent.birthDate)}`
                              : 'date de naissance non renseignée'}
                            {row.matchedStudent.externalRef
                              ? ` · réf. ${row.matchedStudent.externalRef}`
                              : ''}
                          </p>
                        </>
                      ) : (
                        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                          <SearchX className="h-3.5 w-3.5" aria-hidden />
                          Aucune correspondance — à traiter manuellement
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Requesting parent + relationship + received-at */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      <span className="font-semibold text-slate-700">
                        {row.requestingParent.firstName} {row.requestingParent.lastName}
                      </span>
                      {row.requestingParent.email && (
                        <span className="text-slate-500">· {row.requestingParent.email}</span>
                      )}
                    </span>
                    <span>
                      {RELATIONSHIP_LABEL[row.relationship] ?? row.relationship}
                    </span>
                    <span className="text-slate-500">
                      Reçu le {formatDateLong(row.submittedAt)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end lg:flex-col lg:items-stretch">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    aria-busy={isPending}
                    onClick={() => approve(row)}
                    className="min-h-11"
                  >
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    )}
                    Approuver
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => setRejectTarget(row)}
                    className="min-h-11 text-amber-700 hover:bg-amber-50"
                  >
                    <XCircle className="h-3.5 w-3.5" aria-hidden />
                    Rejeter
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p role="status" aria-live="polite" className="sr-only">
        {pending ? 'Traitement de la demande en cours…' : announce}
      </p>

      <RejectClaimDrawer
        target={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onDone={(claimId) => {
          setRemoved((prev) => new Set(prev).add(claimId));
          setAnnounce(
            'Demande renvoyée pour correction — le parent a été informé et peut renvoyer une demande corrigée.',
          );
          setRejectTarget(null);
        }}
      />
    </>
  );
}

/**
 * Reject reason FormDrawer over the hardened `@pilotage/ui` Drawer focus-trap.
 * The reason is required (client gate mirrors the server 400); a live char
 * counter + an `aria-describedby` hint guide a factual, kind motive.
 */
function RejectClaimDrawer({
  target,
  onClose,
  onDone,
}: {
  target: AdminChildClaimRow | null;
  onClose: () => void;
  onDone: (claimId: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const hintId = useId();
  const errId = useId();

  const open = target !== null;
  const trimmed = reason.trim();
  const disabledSubmit = trimmed.length === 0;

  function close() {
    if (busy) return;
    setReason('');
    setError(null);
    onClose();
  }

  function submit() {
    if (!target || busy) return;
    if (trimmed.length === 0) {
      setError('Merci d’indiquer un motif.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await rejectChildClaimAction(target.claimId, trimmed);
      if (res.ok) {
        setReason('');
        onDone(target.claimId);
      } else {
        setError(res.error || 'Merci d’indiquer un motif.');
      }
    });
  }

  return (
    <FormDrawer
      open={open}
      onClose={close}
      title="Demander une correction"
      description="Indiquez ce qui doit être vérifié. Le parent recevra ce message et pourra renvoyer une demande corrigée."
      submitLabel="Envoyer la demande de correction"
      cancelLabel="Annuler"
      onSubmit={submit}
      busy={busy}
      disabledSubmit={disabledSubmit}
    >
      <div className="space-y-2">
        <label htmlFor="reject-reason" className="block text-sm font-semibold text-slate-800">
          Motif <span className="font-normal text-slate-500">(visible par le parent)</span>
        </label>
        <textarea
          id="reject-reason"
          rows={4}
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-required="true"
          aria-describedby={`${hintId}${error ? ` ${errId}` : ''}`}
          aria-invalid={error ? true : undefined}
          className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
          placeholder="Ex. La date de naissance ne correspond pas, merci de la vérifier."
        />
        <div className="flex items-start justify-between gap-3">
          <p id={hintId} className="text-xs text-slate-500">
            Soyez factuel·le et bienveillant·e (ex. « La date de naissance ne correspond pas,
            merci de la vérifier »).
          </p>
          <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
            {reason.length}/{REASON_MAX}
          </span>
        </div>
        {error && (
          <p id={errId} role="alert" className="text-xs font-medium text-rose-600">
            {error}
          </p>
        )}
      </div>
    </FormDrawer>
  );
}
