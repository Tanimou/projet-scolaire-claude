/**
 * Admin child-claim queue FE-local types (E9-S2).
 *
 * Byte-identical mirror of the contract schemas in
 * `@pilotage/contracts` (`dto/child-claim`):
 *   - `AdminChildClaimRowSchema` → `AdminChildClaimRow`
 *   - `AdminChildClaimQueueResponseSchema` → `AdminChildClaimQueueResponse`
 *   - `ApproveChildClaimResponseSchema` → `ApproveChildClaimResponse`
 *   - `RejectChildClaimRequestSchema` → `{ reason }`
 *
 * Kept FE-local (the S1 `parent/.../claim-types.ts` precedent) so the web slice
 * stays self-contained and disjoint from the api/contracts edits while the
 * `@pilotage/contracts` dist isn't yet consumed by `apps/web` for these types.
 * The coordination seam is owned by Amelia-BE; keep the shape in lock-step.
 */

import type {
  ChildClaimRelationship,
  ChildClaimStatus,
} from '@/app/parent/children/claim-types';

/** One queue row — mirrors the contract `AdminChildClaimRow`. */
export interface AdminChildClaimRow {
  claimId: string;
  status: ChildClaimStatus;
  guardianshipId: string | null;
  submittedAt: string;
  relationship: ChildClaimRelationship;
  /** The parent's OWN typed claim fields — never roster-resolved. */
  evidence: {
    firstName: string;
    lastName: string;
    birthDate: string | null;
    externalRef: string | null;
    /** 'externalRef' | 'name+dob' | null (no-match). */
    matchMethod: string | null;
  };
  /** The joined roster Student summary, or null for a `match_failed` row. */
  matchedStudent: {
    studentId: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    externalRef: string | null;
  } | null;
  requestingParent: {
    guardianId: string;
    firstName: string;
    lastName: string;
    userProfileId: string | null;
    email: string | null;
  };
}

/** Queue response envelope — mirrors `AdminChildClaimQueueResponse`. */
export interface AdminChildClaimQueueResponse {
  data: AdminChildClaimRow[];
}

/** Approve response — mirrors `ApproveChildClaimResponse`. */
export interface ApproveChildClaimResponse {
  claimId: string;
  status: ChildClaimStatus;
  guardianshipId: string;
  guardianshipStatus: 'active';
  studentId: string;
}

/** Relationship → FR label (shared with the parent status strip). */
export const RELATIONSHIP_LABEL: Record<string, string> = {
  mother: 'Mère',
  father: 'Père',
  legal_guardian: 'Représentant·e légal·e',
  grandparent: 'Grand-parent',
  sibling: 'Frère / sœur',
  other: 'Autre',
};
