/**
 * Child-claim FE-local types & constants (E9-S1).
 *
 * Kept in a plain (non-`'use server'`) module so the relationship list, status
 * list, and DTO shapes can be imported by both the server actions and client
 * components (a `'use server'` file may export ONLY async functions).
 *
 * These mirror the contract that the api ships in `@pilotage/contracts`
 * (`dto/child-claim`) — `GUARDIANSHIP_CLAIM_STATUS` / `GuardianRelationship` /
 * `ChildClaim*`. Kept FE-local so the web slice stays self-contained and disjoint
 * from the api/contracts edits (the coordination seam is owned by Amelia-BE).
 */

/** Relationship list — mirrors the contract `GUARDIAN_RELATIONSHIP`. */
export const CHILD_CLAIM_RELATIONSHIP = [
  'mother',
  'father',
  'legal_guardian',
  'grandparent',
  'sibling',
  'other',
] as const;
export type ChildClaimRelationship = (typeof CHILD_CLAIM_RELATIONSHIP)[number];

/** Mirrors the Prisma `GuardianshipClaimStatus` enum. */
export const CHILD_CLAIM_STATUS = [
  'submitted',
  'approved',
  'rejected',
  'match_failed',
  'withdrawn',
] as const;
export type ChildClaimStatus = (typeof CHILD_CLAIM_STATUS)[number];

/** Request payload — mirrors the contract `ChildClaimRequest`. */
export interface ChildClaimRequestInput {
  firstName: string;
  lastName: string;
  birthDate?: string; // ISO yyyy-mm-dd
  externalRef?: string;
  relationship: ChildClaimRelationship;
}

/**
 * Uniform submit response — mirrors the contract `ChildClaimSubmitResponse`.
 *
 * `outcome` is the SINGLE literal `'received'` for matched / no-match / ambiguous
 * (the no-oracle wall — child/claimId/status are ALWAYS null on submit). The
 * separate `already_linked` branch is the ONLY non-uniform shape and confirms
 * ONLY the caller's own existing active link.
 */
export type ChildClaimSubmitResponse =
  | {
      outcome: 'received';
      claimId: null;
      status: null;
      child: null;
      message: string;
    }
  | { outcome: 'already_linked'; studentId: string };

// ───────────────────────────────────────────────────────────────────────────
// S-E03-3b / `PF-357` — the status-read row is GONE, and its absence is the
// fix.
//
// `ChildClaimStatusRow` / `ChildClaimListResponse` declared the *request*
// (`GuardianshipClaim`) as the thing this page lists. The list above the panel
// shows the *fact* (`Guardianship`, via `GET /students`), so with 2460 live
// active links and 0 claims the panel printed its empty state directly beneath
// a list of the caller's own children — `DNC-01` in its purest form. The row
// type also carried a raw `status: ChildClaimStatus`, which is what let the
// component render a success-toned "approved" badge from a claim sitting over
// a REVOKED link.
//
// Both shapes are replaced, not kept alongside: two shapes is two truths.
// `ParentChildLinkRow` carries a SERVER-DECIDED `state` and no raw claim
// status at all, so neither defect is expressible from here (`ADR-073 §D4`).
//
// `PF-371` (record-only): this file is a hand-kept FE mirror of
// `@pilotage/contracts` `guardianship/child-link`, with nothing keeping the two
// in step. Kept FE-local so the web slice stays disjoint from the
// api/contracts edits (`GUARDRAILS §4`); converging them is its own slice.
// ───────────────────────────────────────────────────────────────────────────

/**
 * The FIVE-member parent-facing vocabulary — mirrors the contract
 * `PARENT_CHILD_LINK_STATE`.
 *
 * `requested` deliberately covers BOTH a matched `submitted` claim (which
 * drives a `pending` Guardianship) and an unmatched `match_failed` one (which
 * drives nothing). Separating them would let a parent read the matcher's
 * verdict — *"the school holds a child by that name"* — straight off the
 * badge. The distinction is unrepresentable here, not merely unprinted.
 *
 * There is deliberately NO member derived from a claim's `approved` status:
 * `linked` is a statement about the FACT. That is what makes the
 * approved-claim-over-a-revoked-link badge inexpressible rather than fixed.
 */
export const PARENT_CHILD_LINK_STATE = [
  'linked',
  'requested',
  'request_rejected',
  'request_withdrawn',
  'ended',
] as const;
export type ParentChildLinkState = (typeof PARENT_CHILD_LINK_STATE)[number];

/**
 * One row of `GET /parent/child-claims` — mirrors the contract
 * `ParentChildLinkRow`.
 *
 * Row identity is the CHILD, not the record, so a revoked link and the
 * withdrawn claim that detached from it are ONE row, never two.
 *
 * Every downstream decision is already taken server-side: `displayName` is
 * resolved, `child` is gated, `canWithdraw` and `resubmit` are decided. The
 * component is handed verdicts and is given no predicate to re-derive.
 */
export interface ParentChildLinkRow {
  /** Guardianship id when a link exists, else the claim id. NOT the withdraw key. */
  id: string;
  state: ParentChildLinkState;
  /** Resolved SERVER-side — the FE never chooses between `child` and `claimed*`. */
  displayName: string;
  relationship: ChildClaimRelationship;
  /**
   * Non-null ONLY where the server permitted projecting the child's identity —
   * i.e. an ACTIVE `Guardianship` (`ADR-073 §D5`), the same wall
   * `StudentAccessService` applies. Never on `pending`, never on `revoked`.
   */
  child: { studentId: string; firstName: string; lastName: string } | null;
  /** The parent's own typed DOB — leaks nothing, the parent supplied it. */
  claimedBirthDate: string | null;
  /** Admin-authored text, non-null ONLY on `request_rejected`. */
  decisionReason: string | null;
  /**
   * The withdraw key, and the ONLY id `withdrawChildClaimAction` accepts.
   *
   * `id` is the guardianship id whenever a link exists, and posting THAT to
   * `/parent/child-claims/:id/withdraw` 404s behind the `ParseUUIDPipe` lookup.
   * Null whenever the row has no claim behind it.
   */
  claimId: string | null;
  /**
   * Server-decided. `PF-367` (record-only): this affordance still
   * discriminates a matched `submitted` claim from an unmatched
   * `match_failed` one even though the label refuses to. Closing it means
   * widening a mutation's from-status guard — `G-AUDIT`, therefore its own
   * slice. Do not re-derive it here and do not "improve" it.
   */
  canWithdraw: boolean;
  /** Pre-fill for « Renvoyer une demande » — non-null on `request_rejected`. */
  resubmit: {
    firstName: string;
    lastName: string;
    birthDate: string | null;
    relationship: ChildClaimRelationship;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParentChildLinksResponse {
  links: ParentChildLinkRow[];
}

/**
 * What the page hands the panel — a discriminated union, never a list plus a
 * flag (`ADR-071 §D5`, `ADR-073 §R`).
 *
 * The load-bearing property is that **only `ok` carries a collection**. The
 * previous shape was `{ claims: ChildClaimStatusRow[]; available: boolean }`,
 * so every failure had to invent an empty list to fill it — and an empty list
 * is exactly what the panel renders as the school fact *"you have not attached
 * any child"*. Here a failed read has no array to be mistaken for one: the
 * emptiness claim is reachable from `kind: 'ok'` and from nowhere else, which
 * is what makes ratchet `R2` pass by construction instead of by vigilance.
 */
export type ChildLinksView =
  | { kind: 'ok'; rows: ParentChildLinkRow[] }
  /** 501/503 — the backend route family isn't migrated/booted yet. */
  | { kind: 'unavailable' }
  /** 403/404/422 — a right-of-access answer, never a statement about children. */
  | { kind: 'denied' }
  /** 5xx, network, unknown, malformed payload — retryable. */
  | { kind: 'failure' };

/**
 * Distinguishes the "backend not migrated yet" edge (the additive `db push` is
 * an operator pre-req, like E7/E8) from a real error so the UI can degrade to a
 * calm "indisponible" state instead of crashing.
 */
export interface ClaimUnavailable {
  ok: false;
  unavailable: true;
  error: string;
}
