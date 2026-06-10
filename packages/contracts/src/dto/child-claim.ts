import { z } from 'zod';

import { UuidSchema } from './common';

/**
 * Enrollment self-service — the parent child-claim (E9-S1).
 *
 * A signed-in parent self-claims their child via a deny-by-default, non-enumerating,
 * per-guardian rate-limited match. A confident match drives a `pending` Guardianship
 * (NEVER active — human approval in S2 is the only access grant); a no/weak/ambiguous
 * match records a `match_failed` claim with no link. The submit response is
 * BYTE-IDENTICAL for matched / no-match / ambiguous (the no-enumeration wall): the
 * resolved claimId/status are observable only later via GET /parent/child-claims.
 *
 * See docs/adr/ADR-022-enrollment-self-service-child-claim.md.
 */

// ---------------------------------------------------------------------------
// Enums (mirror the Prisma enums exactly)
// ---------------------------------------------------------------------------

/** Mirrors the Prisma `GuardianshipClaimStatus` enum verbatim. */
export const GUARDIANSHIP_CLAIM_STATUS = [
  'submitted',
  'approved',
  'rejected',
  'match_failed',
  'withdrawn',
] as const;
export type GuardianshipClaimStatus = (typeof GUARDIANSHIP_CLAIM_STATUS)[number];

/**
 * Mirrors the Prisma `GuardianRelationship` enum verbatim (6 values). The existing
 * `GUARDIANSHIP_RELATIONSHIP` contract const only carries 4 — this one is the full
 * set the schema accepts, so the matcher/DTO never rejects a legitimate relationship.
 */
export const GUARDIAN_RELATIONSHIP = [
  'mother',
  'father',
  'legal_guardian',
  'grandparent',
  'sibling',
  'other',
] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIP)[number];

// ---------------------------------------------------------------------------
// Request — POST /parent/child-claims
// ---------------------------------------------------------------------------

/**
 * Request body for `POST /parent/child-claims`. `firstName`/`lastName`/`relationship`
 * are required; the matcher additionally REQUIRES a corroborating factor (`externalRef`
 * exact OR `birthDate` for the name path) — a name-only claim ALWAYS resolves to
 * no-match regardless of the roster. `tenantId`/`schoolId`/`guardianId` are NEVER
 * client-supplied — the api server-derives them from the caller's own resolved Guardian.
 */
export const ChildClaimRequestSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  /** ISO yyyy-mm-dd. Optional at the type level; REQUIRED by the matcher for a name match. */
  birthDate: z.string().trim().min(1).optional(),
  externalRef: z.string().trim().min(1).max(120).optional(),
  relationship: z.enum(GUARDIAN_RELATIONSHIP),
});
export type ChildClaimRequest = z.infer<typeof ChildClaimRequestSchema>;

// ---------------------------------------------------------------------------
// Response — POST /parent/child-claims (the no-leak wall)
// ---------------------------------------------------------------------------

/**
 * The uniform submit response, IDENTICAL for matched / no-match / ambiguous outcomes
 * (the no-oracle wall, FR-3/AC-2). `outcome` is the SINGLE literal 'received' and
 * `child`/`claimId`/`status` are ALWAYS null — the resolved claimId/status are
 * observable only later via GET /parent/child-claims. Never echoes any roster-resolved
 * field, never a match boolean, never a near-match count.
 */
export const ChildClaimSubmitResponseSchema = z.object({
  outcome: z.literal('received'),
  claimId: z.null(),
  status: z.null(),
  child: z.null(),
  message: z.string(),
});
export type ChildClaimSubmitResponse = z.infer<typeof ChildClaimSubmitResponseSchema>;

/**
 * A SEPARATE already-linked response (returned ONLY for the caller's OWN existing
 * active link — never confirms any other child). The chosen Sentinel reading keeps
 * this gentle branch; on any doubt the api falls back to the fully-uniform 'received'.
 */
export const ChildClaimAlreadyLinkedResponseSchema = z.object({
  outcome: z.literal('already_linked'),
  studentId: UuidSchema,
});
export type ChildClaimAlreadyLinkedResponse = z.infer<
  typeof ChildClaimAlreadyLinkedResponseSchema
>;

// ---------------------------------------------------------------------------
// Status read — GET /parent/child-claims
// ---------------------------------------------------------------------------

/**
 * One row of the parent's own claim-status surface. Carries the parent's OWN typed
 * fields + status + relationship + `decisionReason` (only when rejected) + the matched
 * child { studentId, firstName, lastName } ONLY when the driven link is active
 * (post-approval) — never on submitted/match_failed/rejected/withdrawn (no oracle on
 * the status read either).
 */
export const ChildClaimStatusRowSchema = z.object({
  id: UuidSchema,
  status: z.enum(GUARDIANSHIP_CLAIM_STATUS),
  relationship: z.enum(GUARDIAN_RELATIONSHIP),
  claimedFirstName: z.string(),
  claimedLastName: z.string(),
  claimedBirthDate: z.string().nullable(),
  decisionReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  child: z
    .object({
      studentId: UuidSchema,
      firstName: z.string(),
      lastName: z.string(),
    })
    .nullable(),
});
export type ChildClaimStatusRow = z.infer<typeof ChildClaimStatusRowSchema>;

export const ChildClaimListResponseSchema = z.object({
  claims: z.array(ChildClaimStatusRowSchema),
});
export type ChildClaimListResponse = z.infer<typeof ChildClaimListResponseSchema>;

// ---------------------------------------------------------------------------
// Admin approval queue — GET /admin/child-claims?status=submitted  (E9-S2)
// ---------------------------------------------------------------------------

/**
 * One row of the admin "Demandes de rattachement" queue (E9-S2). Surfaced ONLY
 * behind `guardianships.approve` (the admin wall — NOT bare `guardianships.read`,
 * which parent+teacher also hold). Carries:
 *  - `evidence` — the parent's OWN typed claim fields (never roster-resolved):
 *    firstName/lastName + optional birthDate/externalRef + a derived `matchMethod`
 *    ('externalRef' | 'name+dob' | null).
 *  - `matchedStudent` — the joined roster Student summary, or `null` for a
 *    `match_failed` row (no link → "à traiter manuellement"). The resolved child
 *    name appears here ONLY in this admin-gated surface, NEVER echoed to the parent.
 *  - `requestingParent` — the claiming Guardian's identity (name + login email).
 *
 * The whole queue is tenant-scoped server-side; a cross-tenant claim id is
 * indistinguishable from a missing one (the decision routes 404, no leak).
 */
export const AdminChildClaimRowSchema = z.object({
  claimId: UuidSchema,
  status: z.enum(GUARDIANSHIP_CLAIM_STATUS),
  guardianshipId: UuidSchema.nullable(),
  submittedAt: z.string(),
  relationship: z.enum(GUARDIAN_RELATIONSHIP),
  evidence: z.object({
    firstName: z.string(),
    lastName: z.string(),
    birthDate: z.string().nullable(),
    externalRef: z.string().nullable(),
    matchMethod: z.string().nullable(),
  }),
  matchedStudent: z
    .object({
      studentId: UuidSchema,
      firstName: z.string(),
      lastName: z.string(),
      birthDate: z.string().nullable(),
      externalRef: z.string().nullable(),
    })
    .nullable(),
  requestingParent: z.object({
    guardianId: UuidSchema,
    firstName: z.string(),
    lastName: z.string(),
    userProfileId: UuidSchema.nullable(),
    email: z.string().nullable(),
  }),
});
export type AdminChildClaimRow = z.infer<typeof AdminChildClaimRowSchema>;

export const AdminChildClaimQueueResponseSchema = z.object({
  data: z.array(AdminChildClaimRowSchema),
});
export type AdminChildClaimQueueResponse = z.infer<
  typeof AdminChildClaimQueueResponseSchema
>;

/**
 * Reason-required reject body — `POST /admin/child-claims/:id/reject`. A blank /
 * whitespace-only reason → 400 (the api DTO mirrors this with class-validator
 * `@IsNotEmpty @MaxLength(500)`). The reason is stored on `decisionReason` and is
 * surfaced to the parent (non-stigmatising, factual).
 */
export const RejectChildClaimRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RejectChildClaimRequest = z.infer<typeof RejectChildClaimRequestSchema>;

/**
 * Approve response — `POST /admin/child-claims/:id/approve`. The single
 * from-status-guarded `pending → active` Guardianship flip IS the access grant.
 */
export const ApproveChildClaimResponseSchema = z.object({
  claimId: UuidSchema,
  status: z.enum(GUARDIANSHIP_CLAIM_STATUS),
  guardianshipId: UuidSchema,
  guardianshipStatus: z.literal('active'),
  studentId: UuidSchema,
});
export type ApproveChildClaimResponse = z.infer<
  typeof ApproveChildClaimResponseSchema
>;
