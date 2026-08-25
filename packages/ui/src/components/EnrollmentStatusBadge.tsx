import { cva, type VariantProps } from 'class-variance-authority';
import { AlertOctagon, GraduationCap, History, UserPlus } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { cn } from '../lib/cn';

import { StatusBadge, defaultLabelForStatus, type StatusTone } from './StatusBadge';

/**
 * The canonical enrolment-activity vocabulary — FOUR states, not two.
 *
 * A binary `active | not active` vocabulary cannot express the answer the canonical
 * predicate produces, and a surface forced to render a three-valued fact through a
 * two-valued badge has to lie in one direction or the other. It used to lie green
 * (a graduated enrolment rendered as "Inscription active"); a naive fix makes it lie
 * amber (a child who finished 3ème last June rendered as a warning). Both are the same
 * category error. `out_of_scope` exists so neither lie is representable.
 *
 * - `active`        — an enrolment qualifies in the canonical academic year.
 * - `out_of_scope`  — enrolment rows exist, none qualifies. Covers BOTH an `active` row
 *                     in a non-canonical year (pre-enrolment, stale year) and a terminal
 *                     status (`graduated`, `transferred_out`, `dropped`). A finished
 *                     school year is not a parent problem, so this state is NEUTRAL.
 * - `none`          — zero enrolment rows for this child. The only state that warrants
 *                     amber, because it is the only one with an administrative next step.
 * - `unavailable`   — the read FAILED. A failed read is never a domain fact; it gets its
 *                     own pixel so it can never be mistaken for `none`.
 */
export type EnrollmentActivityState = 'active' | 'out_of_scope' | 'none' | 'unavailable';

interface StatePresentation {
  icon: ComponentType<{ className?: string }>;
  tone: StatusTone;
  label: string;
}

/**
 * ONE mapping, stated once. Every surface renders the same fact the same way; no
 * surface re-decides tone, icon or wording. The icons are deliberately distinct shapes
 * (not four dots in four colours) so a greyscale screenshot still separates the states
 * — WCAG 1.4.1, meaning never carried by colour alone.
 */
const STATE_PRESENTATION: Record<EnrollmentActivityState, StatePresentation> = {
  active: { icon: GraduationCap, tone: 'success', label: 'Inscription active' },
  out_of_scope: { icon: History, tone: 'neutral', label: 'Hors année en cours' },
  none: { icon: UserPlus, tone: 'warning', label: 'Aucune inscription' },
  unavailable: { icon: AlertOctagon, tone: 'neutral', label: 'Statut indisponible' },
};

/** Slate-400. The accent used when the enrolment answer carries no cycle of its own. */
export const ENROLLMENT_UNKNOWN_ACCENT = '#94A3B8';

/**
 * Resolves the accent colour (cycle band, avatar placeholder, icon tint) that belongs
 * with an enrolment state.
 *
 * This exists so the fallback is DERIVED in one place instead of hand-written per
 * surface. The previous per-surface fallback was `#3B82F6` — brand blue reads as
 * "normal, active", i.e. the colour layer contradicted the badge beside it. Blue is
 * unreachable from here by construction.
 *
 * `out_of_scope` keeps the last known cycle colour when the caller has one: that colour
 * is legitimate *because the scope line names the year it belongs to*. Where nothing is
 * known, neutral slate.
 */
export function enrollmentAccentColor(
  state: EnrollmentActivityState,
  cycleColor?: string | null,
): string {
  if (state === 'none' || state === 'unavailable') return ENROLLMENT_UNKNOWN_ACCENT;
  return cycleColor || ENROLLMENT_UNKNOWN_ACCENT;
}

/** The badge label for a state, for surfaces that need the text without the chrome. */
export function enrollmentStateLabel(state: EnrollmentActivityState): string {
  return STATE_PRESENTATION[state].label;
}

export interface EnrollmentScopeInput {
  /** Class / section wording, e.g. `2nde A`. Already formatted by the caller. */
  classLabel?: string | null;
  /** Academic-year wording, e.g. `2025-2026`. */
  academicYearLabel?: string | null;
  /**
   * Raw domain status of the most recent enrolment row (`graduated`, `transferred_out`…),
   * rendered through `defaultLabelForStatus`. Only read for `out_of_scope`.
   */
  lastStatus?: string | null;
}

/**
 * The ADR-041 §D3 scope label: the sentence that says WHICH enrolment, in WHICH year,
 * the state above is a claim about.
 *
 * Exported because the same sentence is needed outside the badge (card subtitles, KPI
 * sub-captions). Hand-writing it a second time is how one fact acquired four wordings
 * in the first place — derive it, never re-type it.
 *
 * Returns `null` when the caller supplied nothing to scope with. A missing scope renders
 * as nothing; it is never padded out with an invented year.
 */
export function enrollmentScopeLabel(
  state: EnrollmentActivityState,
  input: EnrollmentScopeInput = {},
): string | null {
  const { classLabel, academicYearLabel, lastStatus } = input;
  const parts = [classLabel, academicYearLabel].filter((p): p is string => Boolean(p && p.trim()));

  switch (state) {
    case 'active':
      return parts.length > 0 ? parts.join(' · ') : null;
    case 'out_of_scope': {
      const withStatus = lastStatus ? [...parts, defaultLabelForStatus(lastStatus)] : parts;
      return withStatus.length > 0 ? `Dernière inscription : ${withStatus.join(' · ')}` : null;
    }
    case 'none':
      return 'Aucun dossier de scolarité rattaché';
    case 'unavailable':
      return "Nous n'avons pas pu charger cette information";
  }
}

const badgeStackVariants = cva('inline-flex min-w-0 flex-col items-start', {
  variants: {
    size: {
      sm: 'gap-1',
      md: 'gap-1.5',
    },
  },
  defaultVariants: { size: 'md' },
});

const scopeVariants = cva('max-w-full text-slate-500', {
  variants: {
    size: {
      sm: 'text-[11px] leading-snug',
      md: 'text-xs leading-snug',
    },
  },
  defaultVariants: { size: 'md' },
});

export interface EnrollmentStatusBadgeProps
  extends EnrollmentScopeInput,
    VariantProps<typeof badgeStackVariants> {
  /**
   * The ALREADY-DECIDED canonical state.
   *
   * Load-bearing: this component takes a verdict, never rows. See the docblock below.
   */
  state: EnrollmentActivityState;
  /**
   * Suppress the scope line — ONLY where the surrounding layout already prints the same
   * class/year adjacently (the child-detail hero prints `Classe de …` under the name).
   * Never a way to hide the scope altogether: a state with no scope is a claim with no
   * evidence.
   */
  showScope?: boolean;
  /**
   * Optional onward move rendered under the scope line — the north star's "turn
   * information into action". E.g. an anchor to the enrolment history on `out_of_scope`,
   * or a "Contacter le secrétariat" link on `none`. Callers own routing; the house 44 px
   * target applies to whatever is passed.
   */
  action?: ReactNode;
  className?: string;
}

/**
 * EnrollmentStatusBadge — the single rendering of "is this child actively enrolled".
 *
 * ## Why this component takes NO enrolment rows
 *
 * The prop type deliberately makes an `enrollments` array **unrepresentable**. A
 * presentational component handed rows would have to choose among them, and that choice
 * IS the derivation this whole slice exists to delete — except it would live in
 * `packages/ui`, outside the walk roots of the gate that forbids it, and therefore be
 * strictly worse than the bug. The prop shape is the enforcement: the verdict is decided
 * once, server-side, by the canonical predicate; this component only draws it.
 *
 * ## Why `defaultToneForStatus` is not used here
 *
 * `defaultToneForStatus` maps **`graduated` → `success`** (`StatusBadge.tsx`). Routing
 * enrolment activity through it would reproduce the exact defect — green on a graduated
 * child — inside its own fix. The tone comes from the four-state table above and from
 * nowhere else. Do not "simplify" this by delegating to that helper.
 *
 * `defaultLabelForStatus` IS used, for the terminal-status wording in the scope line
 * (`graduated → Diplômé`), so no surface hand-writes a fifth French status map.
 *
 * ## Accessibility (verified against the shipped tokens, do not re-derive)
 * - Contrast: `emerald-700`/`emerald-100` ≈ 4.9:1 · `amber-700`/`amber-100` ≈ 5.2:1 ·
 *   `slate-700`/`slate-100` ≈ 8.9:1 · scope line `text-slate-500` on white = 4.76:1.
 *   Badge text is 11 px bold, so the large-text exemption does NOT apply and 4.5:1 is
 *   the floor. Never drop the scope line to `slate-400` (3.1:1) — it fails.
 * - WCAG 1.4.1: every state carries icon + text + dot. Greyscale still separates them.
 * - WCAG 4.1.2: the scope line is a sibling `<p>` in the DOM, never a `title` or an
 *   `aria-label`. Scope that only exists for screen readers is the interface promising
 *   what the page does not show.
 * - The icon duplicates the label, so it is decorative and `aria-hidden`.
 * - Server-rendered: no `aria-live`. The state changes on navigation, not in place.
 * - WCAG 2.5.8: the badge is non-interactive (no role, no tabindex), so no target floor
 *   applies to it; anything passed via `action` takes the 44 px house target.
 * - No `outline-none`, no local transitions — focus rings and `prefers-reduced-motion`
 *   stay global (`globals.css`).
 */
export function EnrollmentStatusBadge({
  state,
  classLabel,
  academicYearLabel,
  lastStatus,
  size = 'md',
  showScope = true,
  action,
  className,
}: EnrollmentStatusBadgeProps) {
  const resolvedSize = size ?? 'md';
  const { icon: Icon, tone, label } = STATE_PRESENTATION[state];
  const scope = showScope
    ? enrollmentScopeLabel(state, { classLabel, academicYearLabel, lastStatus })
    : null;

  return (
    <div className={cn(badgeStackVariants({ size: resolvedSize }), className)}>
      <StatusBadge
        label={label}
        tone={tone}
        size={resolvedSize}
        withDot
        icon={<Icon className={resolvedSize === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />}
      />
      {scope && <p className={scopeVariants({ size: resolvedSize })}>{scope}</p>}
      {action}
    </div>
  );
}
