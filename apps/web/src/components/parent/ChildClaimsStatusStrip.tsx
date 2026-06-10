'use client';

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Inbox,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { withdrawChildClaimAction } from '@/app/parent/children/claim-actions';
import type {
  ChildClaimStatus,
  ChildClaimStatusRow,
} from '@/app/parent/children/claim-types';
import {
  ConfirmDialog,
  EmptyState,
  SectionHeader,
  StatusBadge,
  formatDateShort,
  type StatusTone,
} from '@pilotage/ui';

import { ChildClaimDrawer } from './ChildClaimDrawer';

/**
 * Maps a claim status to its parent-facing chip (text + icon, never colour
 * alone — WCAG 1.4.1). `match_failed` is an INTERNAL state: it surfaces to the
 * parent INDISTINGUISHABLY from `submitted` ("En cours de validation"), never
 * "non trouvé" — the no-leak wall holds on the status read too.
 */
const STATUS_CHIP: Record<
  ChildClaimStatus,
  { label: string; tone: StatusTone; Icon: typeof Clock }
> = {
  submitted: { label: 'En cours de validation', tone: 'neutral', Icon: Clock },
  match_failed: { label: 'En cours de validation', tone: 'neutral', Icon: Clock },
  approved: { label: 'Validé', tone: 'success', Icon: CheckCircle2 },
  rejected: { label: 'À corriger', tone: 'warning', Icon: AlertCircle },
  withdrawn: { label: 'Annulée', tone: 'neutral', Icon: XCircle },
};

const RELATIONSHIP_LABEL: Record<string, string> = {
  mother: 'Mère',
  father: 'Père',
  legal_guardian: 'Représentant·e légal·e',
  grandparent: 'Grand-parent',
  sibling: 'Frère / sœur',
  other: 'Autre',
};

export interface ChildClaimsStatusStripProps {
  claims: ChildClaimStatusRow[];
  /** False when the backend isn't migrated yet → calm "indisponible" banner. */
  available?: boolean;
}

/**
 * "Mes demandes" — the parent's self-scoped child-claim status surface (E9-S1).
 *
 * Reads `GET /parent/child-claims` (server-fetched by the page). The matched
 * child's name is shown ONLY on an `approved` row (where `child` is non-null) —
 * never on submitted/rejected/withdrawn (no oracle on the status read). A
 * still-`submitted` row exposes a "Annuler la demande" withdraw behind a
 * ConfirmDialog, with an optimistic row flip on confirm.
 */
export function ChildClaimsStatusStrip({
  claims,
  available = true,
}: ChildClaimsStatusStripProps) {
  // Local optimistic overlay — maps claimId → forced status (withdrawn).
  const [overrides, setOverrides] = useState<Record<string, ChildClaimStatus>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function requestWithdraw(id: string) {
    setError(null);
    setConfirmId(id);
  }

  function confirmWithdraw() {
    const id = confirmId;
    if (!id) return;
    startTransition(async () => {
      const res = await withdrawChildClaimAction(id);
      if (res.ok) {
        setOverrides((prev) => ({ ...prev, [id]: 'withdrawn' }));
        setConfirmId(null);
      } else {
        setError(res.error);
        setConfirmId(null);
      }
    });
  }

  if (!available) {
    return (
      <section id="mes-demandes" className="mt-8">
        <SectionHeader title="Mes demandes de rattachement" compact />
        <div
          role="status"
          className="mt-3 flex items-start gap-2 rounded-2xl bg-white px-4 py-4 text-sm text-slate-600 ring-1 ring-slate-200/60"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <p>
            Le rattachement en ligne n’est pas encore disponible — contactez
            l’établissement.
          </p>
        </div>
      </section>
    );
  }

  if (claims.length === 0) {
    return (
      <section id="mes-demandes" className="mt-8">
        <SectionHeader title="Mes demandes de rattachement" compact />
        <div className="mt-3">
          <EmptyState
            icon={Inbox}
            title="Vous n’avez pas encore rattaché d’enfant"
            description="Utilisez « Rattacher mon enfant » pour lier le dossier de votre enfant à votre compte."
            tone="slate"
          >
            <div className="mt-2">
              <ChildClaimDrawer available={available} />
            </div>
          </EmptyState>
        </div>
      </section>
    );
  }

  return (
    <section id="mes-demandes" className="mt-8">
      <SectionHeader
        title="Mes demandes de rattachement"
        subtitle="Suivi des enfants que vous avez demandé à rattacher"
        compact
      />

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <ul className="mt-3 space-y-3">
        {claims.map((c) => {
          const status = overrides[c.id] ?? c.status;
          const chip = STATUS_CHIP[status];
          const isApproved = status === 'approved' && c.child != null;
          const canWithdraw = status === 'submitted';
          const isRejected = status === 'rejected';
          // Show the matched child's name ONLY on an approved row.
          const displayName = isApproved
            ? `${c.child!.firstName} ${c.child!.lastName}`
            : `${c.claimedFirstName} ${c.claimedLastName}`;

          return (
            <li
              key={c.id}
              className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-bold text-slate-900">{displayName}</h3>
                  <StatusBadge
                    label={chip.label}
                    tone={chip.tone}
                    size="sm"
                    icon={<chip.Icon className="h-3 w-3" aria-hidden />}
                  />
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {RELATIONSHIP_LABEL[c.relationship] ?? c.relationship}
                  {c.claimedBirthDate ? ` · né·e le ${formatDateShort(c.claimedBirthDate)}` : ''}
                  {` · demandé le ${formatDateShort(c.createdAt)}`}
                </p>
                {/* Reason surfaces ONLY on a rejected row (S2-fed). */}
                {isRejected && c.decisionReason && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    À corriger — {c.decisionReason}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {isApproved && c.child && (
                  <Link
                    href={`/parent/children/${c.child.studentId}`}
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline"
                  >
                    Voir le dossier
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                )}
                {isRejected && (
                  <ChildClaimDrawer
                    available={available}
                    triggerLabel="Renvoyer une demande"
                    initial={{
                      firstName: c.claimedFirstName,
                      lastName: c.claimedLastName,
                      birthDate: c.claimedBirthDate ?? '',
                      relationship: c.relationship,
                    }}
                  />
                )}
                {canWithdraw && (
                  <button
                    type="button"
                    onClick={() => requestWithdraw(c.id)}
                    disabled={pending}
                    className="inline-flex min-h-[36px] items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Annuler la demande
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={confirmWithdraw}
        title="Annuler cette demande de rattachement ?"
        description="La demande ne sera plus traitée par l’établissement. Vous pourrez en envoyer une nouvelle à tout moment."
        confirmLabel="Annuler la demande"
        cancelLabel="Garder la demande"
        busy={pending}
      />
    </section>
  );
}
