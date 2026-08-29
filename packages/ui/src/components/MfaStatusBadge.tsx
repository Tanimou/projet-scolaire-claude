import { cva, type VariantProps } from 'class-variance-authority';
import { ShieldAlert, ShieldCheck, ShieldEllipsis, ShieldOff, ShieldQuestion } from 'lucide-react';
import type { ComponentType } from 'react';

import { cn } from '../lib/cn';

import { StatusBadge, type StatusTone } from './StatusBadge';

/**
 * The MFA assurance vocabulary as this design system renders it — FIVE states, produced
 * by crossing a POLICY (`mfaRequired`) with a measured FACT (`mfaEnabled`).
 *
 * ## Why five states and not a boolean (S-E05-8 / PF-25 half b)
 *
 * Until S-E05-8, `/me` returned the literal `mfaEnabled: false` and two portals rendered
 * it with a bare truthiness read (`{me.mfaEnabled && <span>MFA actif</span>}`). Both
 * halves of that were wrong at once:
 *
 * - the value was never measured — nothing in the platform asks Keycloak whether the
 *   holder owns an OTP credential — so `false` asserted a fact nobody had;
 * - a teacher for whom MFA is **enforced at invite** (`CONFIGURE_TOTP` is pushed for
 *   `school_admin` and `teacher`, ADR-004) was told it was merely « Recommandée ».
 *
 * `mfaEnabled` is therefore now `boolean | null`, where `null` means UNMEASURED — and a
 * tri-state read through `&&` renders **nothing** for every user, silently, which is the
 * same defect one field over. This union exists so that the truthiness read is not
 * expressible: the component takes a resolved state, and the only way to obtain one is
 * {@link mfaAssuranceState}, which forces both inputs to be named and compared
 * explicitly.
 *
 * - `enrolled`              — measured: the holder DOES have MFA. Covers required and
 *                             optional alike; once the fact is known the policy adds
 *                             nothing a user needs to act on.
 * - `required_not_enrolled` — measured: enforced by invite policy, and NOT configured.
 *                             The only state with a blocking next step, hence the only
 *                             `danger`.
 * - `required_unverified`   — enforced by policy, fact UNMEASURED. Amber, because the
 *                             obligation is real even though the status is not known.
 * - `optional_not_enrolled` — measured: not enforced, not configured. Neutral: for a
 *                             parent this is a suggestion, never a problem.
 * - `optional_unverified`   — not enforced, fact UNMEASURED. Neutral, and the only state
 *                             a hero renders as *nothing at all* — see
 *                             {@link mfaAssuranceBadgeLabel}.
 *
 * ## Reachability — say it, do not imply it
 *
 * With the projection S-E05-8 ships, `mfaEnabled` is structurally `null` for **every**
 * user, so exactly two of these five states are reachable today: `required_unverified`
 * (`school_admin`, `teacher`) and `optional_unverified` (`parent`, `student`). The three
 * `*_enrolled` / `*_not_enrolled` members are implemented and mapped, but they are
 * **unreachable until `mfaEnabled` is actually measured** — a Keycloak admin round trip
 * on the `/me` hot path, recorded by S-E05-8 as a named residual in
 * `docs/daily-improvement-v3/traceability/OPEN.md`. They are written here rather than
 * deferred because the mapping is a total pure function and a partial one would have to
 * lie in some direction the day the measurement lands.
 *
 * ## Why the union is declared here and not imported from `@pilotage/contracts`
 *
 * `packages/ui` has **no dependency on `@pilotage/contracts`** and adding one is a
 * dependency-graph change that would need its own ADR. This mirrors the precedent
 * exactly: `EnrollmentStatusBadge` and `ChildLinkStatusBadge` likewise declare their
 * state unions locally. The duplication is safe for the precedent's own reason — the
 * consuming surface passes `MeResponse['mfaRequired']` and `MeResponse['mfaEnabled']`
 * into {@link mfaAssuranceState}, so any drift between the contract and this file fails
 * at that call site rather than rendering something wrong. This is a **presentation**
 * vocabulary, never the wire vocabulary.
 */
export type MfaAssuranceState =
  | 'enrolled'
  | 'required_not_enrolled'
  | 'required_unverified'
  | 'optional_not_enrolled'
  | 'optional_unverified';

/**
 * The inputs, named. Deliberately an object and not two positional booleans: the whole
 * finding is that these two values mean different KINDS of thing, and a positional call
 * would let them be swapped without a type error.
 */
export interface MfaAssuranceInput {
  /**
   * The invite POLICY for this holder's realm roles — always known, derived with zero
   * I/O. **Not an account fact.** `true` does not mean the holder has MFA; it means the
   * platform requires it of them.
   */
  mfaRequired: boolean;
  /**
   * The measured FACT: does this holder actually own an OTP credential?
   *
   * `null` = **never measured**, which is NOT a synonym for `false`. This is the whole
   * point of the field's nullability; a consumer that collapses `null` to `false`
   * re-creates PF-25 half (b).
   */
  mfaEnabled: boolean | null;
}

/**
 * The ONE derivation of "what does this account's MFA situation actually say".
 *
 * Exported as a function, not as a table, so that no surface can index the presentation
 * map with a state it invented. Note the comparisons are all explicit (`=== true`,
 * `=== null`): this file models the discipline it exists to enforce, and a truthiness
 * read inside the resolver would be the defect hiding one layer deeper.
 */
export function mfaAssuranceState({ mfaRequired, mfaEnabled }: MfaAssuranceInput): MfaAssuranceState {
  if (mfaEnabled === true) return 'enrolled';
  if (mfaEnabled === false) return mfaRequired ? 'required_not_enrolled' : 'optional_not_enrolled';
  return mfaRequired ? 'required_unverified' : 'optional_unverified';
}

/**
 * The tones this vocabulary is allowed to emit — a strict subset of `StatusTone`.
 *
 * Narrowed on purpose: it makes the glass map below exhaustive over what the table can
 * actually produce, so adding a sixth state with an unmapped tone fails to COMPILE
 * instead of falling through to grey at runtime.
 */
type MfaTone = Extract<StatusTone, 'success' | 'warning' | 'danger' | 'neutral'>;

interface StatePresentation {
  icon: ComponentType<{ className?: string }>;
  tone: MfaTone;
  /** Hero-badge wording. `null` = this state warrants no badge at all. */
  badgeLabel: string | null;
  /** Detail-row wording, for a `<dl>` field that must render in every state. */
  fieldLabel: string;
}

/**
 * ONE mapping, stated once. No surface re-decides tone, icon or wording.
 *
 * The icons are five DISTINCT shapes, not five dots in five colours: two states share the
 * `neutral` tone, and in a greyscale screenshot the shape plus the label is the whole
 * difference (WCAG 1.4.1 — meaning never carried by colour alone).
 *
 * `defaultToneForStatus` is NOT used here and must not be introduced: it has no member
 * for "unmeasured", and routing an unknown through a map whose fallback is `neutral`
 * would render "we never asked" identically to "we asked and the answer was no" — the
 * exact conflation this component exists to make inexpressible.
 *
 * Every `*_unverified` label ends « statut non vérifié ». That wording is load-bearing and
 * must not be shortened to « Inconnu »: the account is fine, the *platform* simply has not
 * asked. It also must never be reused for a failed read of `/me` itself — that is a
 * different unknown and the consuming page renders it as « Non disponible ».
 */
const STATE_PRESENTATION: Record<MfaAssuranceState, StatePresentation> = {
  enrolled: {
    icon: ShieldCheck,
    tone: 'success',
    badgeLabel: 'MFA actif',
    fieldLabel: 'Activée',
  },
  required_not_enrolled: {
    icon: ShieldAlert,
    tone: 'danger',
    badgeLabel: 'MFA à configurer',
    fieldLabel: 'Obligatoire · non configurée',
  },
  required_unverified: {
    icon: ShieldEllipsis,
    tone: 'warning',
    badgeLabel: 'MFA requis',
    fieldLabel: 'Obligatoire · statut non vérifié',
  },
  optional_not_enrolled: {
    icon: ShieldOff,
    tone: 'neutral',
    badgeLabel: null,
    fieldLabel: 'Non activée · recommandée',
  },
  optional_unverified: {
    icon: ShieldQuestion,
    tone: 'neutral',
    badgeLabel: null,
    fieldLabel: 'Recommandée · statut non vérifié',
  },
};

/**
 * The hero-badge wording for a state, or `null` when the state warrants **no badge**.
 *
 * The `null` is a DECISION, not an accident, and the difference matters: a bare
 * `{me.mfaEnabled && …}` also rendered nothing, but it did so for every user including
 * the enforced teacher who most needed the signal. Here the absence is table-driven,
 * nameable and testable — "MFA is optional for you and we never measured it" is not news,
 * and a badge announcing it would be noise on the parent hero, whose whole promise is a
 * low-noise answer in under 2 s.
 *
 * Exported so a consuming surface (or a gate) can assert the absence by table lookup
 * instead of inferring it from a component that rendered nothing.
 */
export function mfaAssuranceBadgeLabel(state: MfaAssuranceState): string | null {
  return STATE_PRESENTATION[state].badgeLabel;
}

/**
 * The detail-row wording for a state — « Obligatoire · statut non vérifié », never a
 * hand-written `mfaEnabled ? 'Activée' : 'Recommandée'` ternary.
 *
 * Unlike {@link mfaAssuranceBadgeLabel} this is total: a `<dl>` row is a question the
 * page has already asked out loud, so every state must have an answer to print.
 */
export function mfaAssuranceLabel(state: MfaAssuranceState): string {
  return STATE_PRESENTATION[state].fieldLabel;
}

/**
 * The one sentence that keeps « statut non vérifié » from reading as an app defect, or
 * `null` where the fact IS measured and no explanation is owed.
 *
 * Rendered as visible text beside the value — never as a `title` alone. Help that exists
 * only on hover is the interface promising what the page does not show.
 */
export function mfaAssuranceHint(state: MfaAssuranceState): string | null {
  switch (state) {
    case 'required_unverified':
    case 'optional_unverified':
      return 'Le statut MFA se vérifie depuis votre portail compte sécurisé.';
    case 'enrolled':
    case 'required_not_enrolled':
    case 'optional_not_enrolled':
      return null;
  }
}

/**
 * Glass chrome for the coloured portal heroes.
 *
 * `light` is the ordinary card surface and delegates to `StatusBadge`, so the badge
 * inherits the house tone table. `on_gradient` exists because both hero call sites sit on
 * a saturated gradient where `StatusBadge`'s `*-100` fills are illegible; the tone classes
 * below are the chrome those heroes already shipped by hand, lifted here so the two
 * portals stop keeping their own copies of it.
 *
 * Contrast posture, stated honestly: the ink is white or a near-white tint (`*-50`), the
 * same ink the hero already uses for its own body text, over a translucent fill that only
 * DARKENS what is behind it. So this badge never lowers the contrast its hero already
 * guarantees. That is a structural argument, not a measurement — the ratio depends on the
 * gradient behind it, which is the hero's property, not this component's, and no ratio
 * against a specific gradient is claimed here.
 */
const glassVariants = cva(
  'inline-flex items-center gap-1 rounded-full font-bold whitespace-nowrap ring-1 backdrop-blur-sm',
  {
    variants: {
      tone: {
        success: 'bg-emerald-400/20 text-emerald-50 ring-emerald-300/30',
        warning: 'bg-amber-300/25 text-amber-50 ring-amber-200/40',
        danger: 'bg-rose-400/25 text-rose-50 ring-rose-200/40',
        neutral: 'bg-white/15 text-white ring-white/20',
      },
      size: {
        sm: 'px-2 py-0.5 text-[11px]',
        md: 'px-2.5 py-1 text-[11px]',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

type GlassTone = NonNullable<VariantProps<typeof glassVariants>['tone']>;

/**
 * The glass counterpart of each tone the table can emit. Keyed by {@link MfaTone}, not by
 * `StatusTone`: `info`, `violet`, `amber`, `rose`, `sky` and `teal` are unreachable from
 * `STATE_PRESENTATION`, and pretending otherwise would mean writing chrome nothing renders.
 */
const GLASS_TONE: Record<MfaTone, GlassTone> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'neutral',
};

export interface MfaStatusBadgeProps {
  /**
   * The ALREADY-DECIDED state, from {@link mfaAssuranceState}.
   *
   * Load-bearing: this component takes a verdict, never `{ mfaRequired, mfaEnabled }`
   * directly. A presentational component handed the raw pair would own the derivation,
   * and it would own it in `packages/ui` — outside the walk roots of the gate that
   * forbids re-derivation, and therefore strictly worse than the bug it replaced. The
   * prop shape is the enforcement.
   */
  state: MfaAssuranceState;
  /**
   * `light` for card surfaces (delegates to `StatusBadge`), `on_gradient` for the glass
   * chip on a coloured portal hero.
   */
  surface?: 'light' | 'on_gradient';
  /** `sm` inline, `md` standalone. Mirrors `StatusBadge`. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * MfaStatusBadge — the single rendering of "what is this account's MFA situation".
 *
 * ## Renders `null` for the two optional-and-unmeasured states, on purpose
 *
 * See {@link mfaAssuranceBadgeLabel}. A consumer that needs a pixel in every state should
 * render {@link mfaAssuranceLabel} in a detail row instead; a hero badge is a signal, and
 * a signal that fires for everybody is not one.
 *
 * ## Accessibility (verified against the shipped tokens, do not re-derive)
 * - `light` surface contrast: `emerald-700`/`emerald-100` ≈ 4.9:1 · `amber-700`/`amber-100`
 *   ≈ 5.2:1 · `rose-700`/`rose-100` ≈ 5.5:1 · `slate-700`/`slate-100` ≈ 8.9:1. Badge text
 *   is 11–12 px bold, so the large-text exemption does NOT apply and 4.5:1 is the floor.
 * - `on_gradient`: see the `glassVariants` docblock — near-white ink over a darkening
 *   translucent fill, no ratio claimed against a gradient this file does not own.
 * - WCAG 1.4.1: every state carries icon + text, and the five icons are five distinct
 *   shapes. Two states share `neutral`; greyscale still separates all five.
 * - The icon duplicates the label, so it is decorative and `aria-hidden`.
 * - Server-renderable: no `aria-live` here. `/me` is read at page load, not polled, so
 *   there is no in-place flip to announce. A surface that later refreshes it in place owns
 *   its own `aria-live="polite"` — polite, because an MFA status is never an alarm.
 * - WCAG 2.5.8: non-interactive (no role, no tabindex), so no target floor applies. The
 *   action lives in the « Ouvrir mon portail compte sécurisé » control beside it, which
 *   keeps the house 44 px target.
 * - No `outline-none`, no local transitions — focus rings and `prefers-reduced-motion`
 *   stay global (`globals.css`).
 */
export function MfaStatusBadge({
  state,
  surface = 'light',
  size = 'md',
  className,
}: MfaStatusBadgeProps) {
  const { icon: Icon, tone, badgeLabel } = STATE_PRESENTATION[state];

  if (badgeLabel === null) return null;

  const iconClass = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';

  if (surface === 'on_gradient') {
    return (
      <span className={cn(glassVariants({ tone: GLASS_TONE[tone], size }), className)}>
        <Icon className={iconClass} aria-hidden />
        {badgeLabel}
      </span>
    );
  }

  return (
    <StatusBadge
      label={badgeLabel}
      tone={tone}
      size={size}
      icon={<Icon className={iconClass} aria-hidden />}
      className={className}
    />
  );
}
