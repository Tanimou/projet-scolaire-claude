import { AlertCircle, AlertOctagon, CheckCircle2, Clock, History, XCircle } from 'lucide-react';
import type { ComponentType } from 'react';

import { StatusBadge, type StatusTone } from './StatusBadge';

/**
 * The parent child-link vocabulary as this design system renders it — FIVE contract
 * states plus ONE front-end-only member.
 *
 * ## Why this union is declared here and not imported from `@pilotage/contracts`
 *
 * `packages/ui` has **no dependency on `@pilotage/contracts`** (`packages/ui/package.json`
 * declares six runtime deps; none is the contracts package) and adding one is a
 * dependency-graph change that would need its own ADR. So this mirrors the precedent
 * exactly: `EnrollmentStatusBadge` likewise declares `EnrollmentActivityState` locally.
 *
 * The duplication is safe for the precedent's own reason — the consuming surface passes
 * `ParentChildLinkRow['state']` (the contract's five-member `ParentChildLinkState`) into
 * the `state` prop, so any drift between the contract and this list fails at that call
 * site rather than rendering something wrong. This file is a **presentation** vocabulary,
 * never the wire vocabulary, and it must never grow a member the contract cannot produce
 * other than the reserved `unavailable` documented below.
 *
 * - `linked`             — the FACT: a live `Guardianship` between this guardian and this
 *                          child. Named after the fact, never after a claim's `approved`
 *                          status, so "approved claim over a revoked link renders green"
 *                          is not expressible from here.
 * - `requested`          — a request is in flight. Deliberately covers BOTH a matched
 *                          request and an unmatched one: ONE label, ONE tone, ONE icon.
 *                          Splitting it would turn this badge into the school's matching
 *                          oracle, which is the whole reason the wire carries a resolved
 *                          verdict instead of a raw claim status.
 * - `request_rejected`   — decided against; the parent has something to correct. The only
 *                          state with an administrative next step, hence the only amber.
 * - `request_withdrawn`  — the parent cancelled their own request.
 * - `ended`              — there WAS a link and it is over. A finished link is not a parent
 *                          problem, so it is neutral, and it gets its own SHAPE (`History`)
 *                          rather than sharing `XCircle` with `request_withdrawn`.
 * - `unavailable`        — **reserved, front end only.** The contract never emits it. On the
 *                          parent page a failed read renders `ReadErrorState`, not a row, so
 *                          there is no row-level path to it today. It exists so that a future
 *                          surface which must draw "we could not load this" has a pixel that
 *                          can never be mistaken for a real state — the same reason
 *                          `EnrollmentActivityState.unavailable` exists.
 */
export type ChildLinkBadgeState =
  | 'linked'
  | 'requested'
  | 'request_rejected'
  | 'request_withdrawn'
  | 'ended'
  | 'unavailable';

interface StatePresentation {
  icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
  label: string;
}

/**
 * ONE mapping, stated once. No surface re-decides tone, icon or wording.
 *
 * The icons are deliberately six DISTINCT shapes, not six dots in six colours: three of
 * these states share the `neutral` tone, so in a greyscale screenshot — and for a parent
 * who cannot separate the tones — the shape plus the label is the whole difference
 * (WCAG 1.4.1, meaning never carried by colour alone).
 *
 * `defaultToneForStatus` is NOT used here, and must not be introduced. It maps
 * `approved → success` and `withdrawn → danger`; routing this vocabulary through it would
 * reintroduce both defects this badge exists to make inexpressible — a claim's verdict
 * rendered green over a dead link, and a parent's own cancellation rendered as an error.
 */
const STATE_PRESENTATION: Record<ChildLinkBadgeState, StatePresentation> = {
  linked: { icon: CheckCircle2, tone: 'success', label: 'Rattaché' },
  requested: { icon: Clock, tone: 'neutral', label: 'En cours de validation' },
  request_rejected: { icon: AlertCircle, tone: 'warning', label: 'À corriger' },
  request_withdrawn: { icon: XCircle, tone: 'neutral', label: 'Annulée' },
  ended: { icon: History, tone: 'neutral', label: 'Rattachement terminé' },
  unavailable: { icon: AlertOctagon, tone: 'neutral', label: 'Indisponible' },
};

/** The badge label for a state, for surfaces that need the text without the chrome. */
export function childLinkStateLabel(state: ChildLinkBadgeState): string {
  return STATE_PRESENTATION[state].label;
}

/**
 * The date VERB that belongs with a state — « Rattaché le … », not a single hard-coded
 * « demandé le … ».
 *
 * Exported for the same reason `enrollmentScopeLabel` is: the meta line under the badge
 * needs this sentence, and hand-writing it there is how one fact acquires two wordings.
 *
 * It is load-bearing, not cosmetic. The overwhelming majority of live links were created
 * administratively and were never requested by the parent at all, so printing
 * « demandé le » beside them states something about the parent that did not happen.
 *
 * Returns `null` for `unavailable`: there is no date to caption when the row's state is
 * itself the admission that nothing could be read. A missing verb renders as nothing; it
 * is never padded out with an invented one.
 */
export function childLinkDateLabel(state: ChildLinkBadgeState): string | null {
  switch (state) {
    case 'linked':
      return 'Rattaché le';
    case 'ended':
      return 'Rattachement terminé le';
    case 'requested':
    case 'request_rejected':
    case 'request_withdrawn':
      return 'Demandé le';
    case 'unavailable':
      return null;
  }
}

export interface ChildLinkStatusBadgeProps {
  /**
   * The ALREADY-DECIDED state, resolved server-side.
   *
   * Load-bearing: this component takes a verdict, never a `Guardianship`, never a claim,
   * and never a raw status pair to choose between. See the docblock below.
   */
  state: ChildLinkBadgeState;
  /** `sm` for in-list rows, `md` standalone. Mirrors `StatusBadge`. */
  size?: 'sm' | 'md';
  /**
   * Passed through to `StatusBadge` (merged with `tailwind-merge`). This is where a
   * consumer adds a transition for an optimistic state flip — the component ships none of
   * its own, so `prefers-reduced-motion` handling stays global in `globals.css`.
   */
  className?: string;
}

/**
 * ChildLinkStatusBadge — the single rendering of "what is the state of this parent's link
 * to this child".
 *
 * ## Why this component takes NO link and NO claim
 *
 * The prop type deliberately makes a `{ link, claim }` pair **unrepresentable**. A
 * presentational component handed both would have to decide which one wins, and that
 * precedence decision IS the derivation the contract now owns — except it would live in
 * `packages/ui`, outside the walk roots of the gate that forbids re-derivation, and would
 * therefore be strictly worse than the bug it replaced. The prop shape is the enforcement.
 *
 * The same shape is what keeps the badge from becoming a matching oracle: a matched
 * request and an unmatched one arrive here as the identical string `requested`, so no
 * label, tone, icon or ordering decision taken in this file can leak which one it was.
 * There is nothing to get right here because there is nothing to know.
 *
 * ## Accessibility (verified against the shipped tokens, do not re-derive)
 * - Contrast: `emerald-700`/`emerald-100` ≈ 4.9:1 · `amber-700`/`amber-100` ≈ 5.2:1 ·
 *   `slate-700`/`slate-100` ≈ 8.9:1. Badge text is 11 px bold, so the large-text exemption
 *   does NOT apply and 4.5:1 is the floor.
 * - WCAG 1.4.1: every state carries icon + text + dot, and the six icons are six distinct
 *   shapes. Three states share `neutral`; greyscale still separates all of them.
 * - The icon duplicates the label, so it is decorative and `aria-hidden`.
 * - Server-rendered: no `aria-live` here. Where a consumer flips the state in place (the
 *   optimistic withdraw), the surrounding cell owns `aria-live="polite"` — polite, because
 *   it confirms an action the parent just took; it is not an alarm.
 * - WCAG 2.5.8: non-interactive (no role, no tabindex), so no target floor applies to it.
 * - No `outline-none`, no local transitions — focus rings and `prefers-reduced-motion` stay
 *   global (`globals.css`).
 */
export function ChildLinkStatusBadge({ state, size = 'md', className }: ChildLinkStatusBadgeProps) {
  const { icon: Icon, tone, label } = STATE_PRESENTATION[state];

  return (
    <StatusBadge
      label={label}
      tone={tone}
      size={size}
      withDot
      icon={<Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />}
      className={className}
    />
  );
}
