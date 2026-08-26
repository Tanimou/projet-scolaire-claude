'use client';

import {
  ChildLinkStatusBadge,
  ConfirmDialog,
  EmptyState,
  SectionHeader,
  childLinkDateLabel,
  formatDateShort,
} from '@pilotage/ui';
import { AlertCircle, ArrowRight, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';

import { ChildClaimDrawer } from './ChildClaimDrawer';

import { ReadErrorState } from '@/app/parent/_components/ReadErrorState';
import { withdrawChildClaimAction } from '@/app/parent/children/claim-actions';
import type {
  ChildLinksView,
  ParentChildLinkRow,
  ParentChildLinkState,
} from '@/app/parent/children/claim-types';

/**
 * The relationship wording. Left where it is on purpose: it is the only copy
 * of this map that the parent portal owns, and the row's other two French
 * vocabularies — the state label and the date verb — both come from
 * `packages/ui` (`ChildLinkStatusBadge` / `childLinkDateLabel`) precisely so
 * that no surface hand-writes a second wording for the same fact.
 */
const RELATIONSHIP_LABEL: Record<string, string> = {
  mother: 'Mère',
  father: 'Père',
  legal_guardian: 'Représentant·e légal·e',
  grandparent: 'Grand-parent',
  sibling: 'Frère / sœur',
  other: 'Autre',
};

/**
 * The count line under the header — a summary of ALREADY-DECIDED verdicts, not
 * a re-derivation.
 *
 * It exists for a UX problem that only appears once the panel is correct: with
 * 2460 live active links and 0 requests, a correct panel repeats the children
 * list above it, and a parent then sees each child twice on one screen. This
 * line says out loud what the panel is for — the list above is the children,
 * this is the paperwork.
 *
 * A zero clause is omitted entirely: « 0 demande en cours » is noise, and on
 * this page it is also the shape of the sentence the whole slice exists to
 * delete.
 */
function summariseStates(states: ParentChildLinkState[]): string | null {
  const count = (s: ParentChildLinkState) => states.filter((x) => x === s).length;
  const linked = count('linked');
  const inFlight = count('requested');
  const toFix = count('request_rejected');
  const parts: string[] = [];
  if (linked > 0) {
    parts.push(`${linked} enfant${linked > 1 ? 's' : ''} rattaché${linked > 1 ? 's' : ''}`);
  }
  if (inFlight > 0) parts.push(`${inFlight} demande${inFlight > 1 ? 's' : ''} en cours`);
  if (toFix > 0) parts.push(`${toFix} demande${toFix > 1 ? 's' : ''} à corriger`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The section shell, rendered IDENTICALLY by every branch.
 *
 * `id="mes-demandes"` is load-bearing: `ChildClaimDrawer` deep-links to
 * `/parent/children#mes-demandes` after a successful submit. A deep link that
 * lands on nothing is a broken feature, so the anchor cannot be a property of
 * the happy path only — it belongs to the shell, which every branch goes
 * through. That is why the id is written once here and never per branch.
 */
function PanelShell({ subtitle, children }: { subtitle?: string; children: ReactNode }) {
  return (
    <section id="mes-demandes" className="mt-8">
      <SectionHeader title="Rattachements et demandes" subtitle={subtitle} compact />
      {children}
    </section>
  );
}

export interface ChildLinksPanelProps {
  /**
   * The read's outcome, discriminated. Deliberately NOT `rows + available`:
   * only the `ok` member carries a collection, so no failure branch has an
   * empty array to render as *"you have not attached any child"*.
   */
  view: ChildLinksView;
}

/**
 * « Rattachements et demandes » — the parent's own child-link surface.
 *
 * ## What changed, and why the old name had to go
 *
 * This was `ChildClaimsStatusStrip`, and it listed `GuardianshipClaim` rows —
 * the *request*. The list above it on the same page is built from
 * `Guardianship` — the *fact*. On the live stack that is 2460 active links
 * against 0 requests, so for every parent in the data the page listed their
 * children and then, three centimetres lower, stated that they had attached
 * none. The panel now projects the FACT, and its name says so.
 *
 * ## What this component is NOT allowed to decide
 *
 * `state`, `displayName`, `child`, `canWithdraw` and `resubmit` all arrive
 * decided. The raw `GuardianshipClaimStatus` is not on the wire at all — not
 * as `status`, not nested — so a success-toned "approved" badge sitting over
 * a revoked link is not fixed here, it is inexpressible. The only derivation
 * left in this file is the optimistic withdraw overlay, and it is keyed by the
 * SAME id the server call uses.
 */
export function ChildLinksPanel({ view }: ChildLinksPanelProps) {
  // Optimistic overlay — maps the withdrawn CLAIM id to its new state.
  //
  // Keyed by `claimId`, which is the same key `withdrawChildClaimAction`
  // posts. Keying the overlay by `row.id` (the guardianship id whenever a link
  // exists) while calling with `row.claimId` is two keys for one action, which
  // is how a row flips in the UI while the server rejects the request.
  const [overrides, setOverrides] = useState<Record<string, ParentChildLinkState>>({});
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
        setOverrides((prev) => ({ ...prev, [id]: 'request_withdrawn' }));
        setConfirmId(null);
      } else {
        setError(res.error);
        setConfirmId(null);
      }
    });
  }

  // ── Branch: the route family isn't migrated/booted yet (501/503) ─────────
  // Deliberately carries NO collection, and neither do the two failure
  // branches below: a state with no array cannot be rendered as an empty one.
  if (view.kind === 'unavailable') {
    return (
      <PanelShell>
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
      </PanelShell>
    );
  }

  // ── Branch: the read was REFUSED (403 / 404 / 422) ──────────────────────
  // No `secondaryAction`. Unlike `parent/grades/page.tsx`, this is a PARTIAL
  // failure: the children list above rendered fine and the page is usable, so
  // « Retour au tableau de bord » would push the parent off a working page.
  //
  // The copy asserts nothing about the school, in EITHER polarity
  // (`ADR-071 §D5`; `PF-346` proved that reassuring wrongly is as wrong as
  // alarming wrongly). It says where the answer came from, not what it means
  // about this family. It also never renders the failure's own `error` text:
  // that sentence names our infrastructure (`read-result.ts:38-44`).
  if (view.kind === 'denied') {
    return (
      <PanelShell>
        <ReadErrorState
          className="mt-3"
          variant="denied"
          title="Vos rattachements ne sont pas accessibles depuis ce compte."
          description="Cela vient d’un droit d’accès, pas d’un compte sans enfant. L’établissement peut rétablir l’accès."
          retryable={false}
        />
      </PanelShell>
    );
  }

  // ── Branch: the read BROKE (5xx, network, malformed payload) ────────────
  if (view.kind === 'failure') {
    return (
      <PanelShell>
        <ReadErrorState
          className="mt-3"
          variant="failure"
          title="Nous n’avons pas pu charger vos rattachements."
          description="Ceci ne veut pas dire qu’aucun enfant n’est rattaché à votre compte : c’est l’affichage qui a échoué."
          retryable
        />
      </PanelShell>
    );
  }

  const rows = view.rows;

  // ── Branch: the read SUCCEEDED and there is genuinely nothing ───────────
  //
  // This is the ONLY place the emptiness statement can be made, and it is now TRUE
  // when it renders: the union means "links exist but no request was ever
  // made" is `n` rows in state `linked`, not an empty list. `UserPlus` rather
  // than `Inbox` because the sentence is no longer about requests, and
  // `tone="slate"` rather than amber because a parent on first login having no
  // child linked yet is a normal starting state, not a problem to flag.
  if (rows.length === 0) {
    return (
      <PanelShell>
        <div className="mt-3">
          <EmptyState
            icon={UserPlus}
            title="Vous n’avez pas encore rattaché d’enfant"
            description="Utilisez « Rattacher mon enfant » pour lier le dossier de votre enfant à votre compte."
            tone="slate"
          >
            <div className="mt-2">
              <ChildClaimDrawer available />
            </div>
          </EmptyState>
        </div>
      </PanelShell>
    );
  }

  // The state a row is ACTUALLY in right now, overlay included.
  //
  // Stated ONCE, as a function rather than as a parallel array: the summary
  // line and the badge below must be answers to the same question, and two
  // lookups into two structures is how a count and a badge start disagreeing
  // on the very page whose defect is exactly that.
  const effectiveState = (row: ParentChildLinkRow): ParentChildLinkState =>
    (row.claimId != null ? overrides[row.claimId] : undefined) ?? row.state;

  const summary = summariseStates(rows.map(effectiveState));

  return (
    <PanelShell subtitle="Les enfants liés à votre compte et l’état de vos demandes.">
      {summary && <p className="mt-1 text-xs text-slate-500">{summary}</p>}

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {/* Server order is the ONLY order. Re-sorting client-side would move the
          row the parent just acted on out from under their finger. */}
      <ul className="mt-3 space-y-3" aria-label="Rattachements et demandes">
        {rows.map((row) => {
          const state = effectiveState(row);
          const dateLabel = childLinkDateLabel(state);
          // « Voir le dossier » is gated on `linked` AND on `child != null`.
          // The server only ever projects `child` for an ACTIVE link now
          // (`ADR-073 §D5`), so the second half looks redundant — it is not:
          // the optimistic withdraw overlay can flip `state` underneath a row
          // that still carries its `child`, and the link must follow the state
          // the parent is being shown RIGHT NOW. Routing there on any other
          // state lands them in a 403 — a fresh dead end shipped as a fix.
          const canOpenFile = state === 'linked' && row.child != null;
          const isRejected = state === 'request_rejected';
          // Server-decided; never re-derived from the link state (that is how
          // every in-flight request loses its cancel button). The `claimId`
          // guard is the other half of the same rule: with no request record
          // behind the row there is nothing to withdraw, and `row.id` is not a valid
          // withdraw key.
          const canWithdraw = row.canWithdraw && row.claimId != null;

          return (
            <li
              key={row.id}
              className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Full name in the DOM, never carried by a `title`
                      attribute alone — WCAG 4.1.2. */}
                  <h3 className="break-words text-sm font-bold text-slate-900 sm:truncate">
                    {row.displayName}
                  </h3>
                  {/* Polite, not assertive: the withdraw flip is a
                      confirmation, not an alarm. The transition rides on the
                      badge's own `className` (which it merges) rather than on
                      a wrapper, so no layout box is animated. */}
                  <span aria-live="polite">
                    <ChildLinkStatusBadge
                      state={state}
                      size="sm"
                      className="transition-colors duration-150"
                    />
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {RELATIONSHIP_LABEL[row.relationship] ?? row.relationship}
                  {row.claimedBirthDate
                    ? ` · né·e le ${formatDateShort(row.claimedBirthDate)}`
                    : ''}
                  {/* The date VERB comes from the state, never hard-coded:
                      almost every live link was created administratively and
                      was never requested by the parent, so « demandé le »
                      beside it states something that did not happen. One
                      wording, stated once, in `packages/ui`. */}
                  {dateLabel ? ` · ${dateLabel} ${formatDateShort(row.createdAt)}` : ''}
                </p>
                {/* Admin-authored text, surfaced on this state only. Rendered
                    as text, never as a heading, never with another prefix. */}
                {isRejected && row.decisionReason && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    À corriger — {row.decisionReason}
                  </p>
                )}
              </div>

              <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
                {canOpenFile && row.child && (
                  <Link
                    href={`/parent/children/${row.child.studentId}`}
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline"
                  >
                    Voir le dossier
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                )}
                {isRejected && row.resubmit && (
                  <ChildClaimDrawer
                    available
                    triggerLabel="Renvoyer une demande"
                    initial={{
                      firstName: row.resubmit.firstName,
                      lastName: row.resubmit.lastName,
                      birthDate: row.resubmit.birthDate ?? '',
                      relationship: row.resubmit.relationship,
                    }}
                  />
                )}
                {canWithdraw && (
                  <button
                    type="button"
                    onClick={() => requestWithdraw(row.claimId!)}
                    disabled={pending}
                    className="inline-flex min-h-[44px] items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[36px]"
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
    </PanelShell>
  );
}
