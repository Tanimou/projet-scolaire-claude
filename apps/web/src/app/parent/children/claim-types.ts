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

/** Status-read row — mirrors the contract `ChildClaimStatusRow`. */
export interface ChildClaimStatusRow {
  id: string;
  status: ChildClaimStatus;
  relationship: ChildClaimRelationship;
  claimedFirstName: string;
  claimedLastName: string;
  claimedBirthDate: string | null;
  decisionReason: string | null;
  createdAt: string;
  updatedAt: string;
  // Non-null ONLY when the driven link is active (post-approval) — never on
  // submitted/match_failed/rejected/withdrawn (no oracle on the status read).
  child: { studentId: string; firstName: string; lastName: string } | null;
}

export interface ChildClaimListResponse {
  claims: ChildClaimStatusRow[];
}

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
