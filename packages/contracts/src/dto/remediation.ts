import { z } from 'zod';

import {
  AVAILABILITY_KIND,
  BOOKING_STATUS,
  REMEDIATION_PLAN_STATUS,
  TUTOR_COST_KIND,
  TUTOR_TYPE,
} from '../enums';

import { UuidSchema } from './common';

/**
 * Remediation & Tutoring loop — E7.
 *
 * Closes the cahier's action loop: an alert's recommendation promotes into a
 * tracked `RemediationPlan`, the parent books a school-curated tutoring resource
 * from a read-only catalogue, and a calm progress strip (S3) measures the
 * improvement against the captured baseline. These DTOs are the contract for the
 * parent-facing surfaces shipped in S1 (promotion + read-only catalogue); the
 * booking write contract lands in S2.
 *
 * `TutorCostKind` is a DISPLAY LABEL only — never a price (ADR-018 finance
 * isolation). `BookingStatus` is declared here so the S2 booking surface and the
 * S4 teacher inbox share one source of truth, even though S1 ships no booking write.
 */

// ---------------------------------------------------------------------------
// Promote an alert → RemediationPlan (parent, idempotent, guardianship-ABAC)
// ---------------------------------------------------------------------------

/**
 * Request body for `POST /remediation/plans`. The parent passes ONLY the alert
 * id — `studentId`/`subjectId`/`targetRuleCode` and the baseline are derived
 * server-side from the alert (never client-supplied), exactly the E1-S3
 * meeting-request promotion discipline. `objective` is an optional, kind,
 * non-stigmatising label the parent may set.
 */
export const PromoteRemediationPlanDtoSchema = z.object({
  alertId: UuidSchema,
  objective: z.string().trim().max(280).optional(),
});
export type PromoteRemediationPlanDto = z.infer<typeof PromoteRemediationPlanDtoSchema>;

/**
 * A remediation plan as surfaced to the parent. Carries the diagnosis (subject +
 * the originating alert), the captured baseline figure the S3 strip frames the
 * trend against, and lightweight session counts (always 0 in S1 — no booking
 * write yet, kept in the shape so S2/S3 need no contract change).
 */
export const RemediationPlanDtoSchema = z.object({
  id: UuidSchema,
  status: z.enum(REMEDIATION_PLAN_STATUS),

  studentId: UuidSchema,
  studentName: z.string(),

  subjectId: UuidSchema,
  subjectCode: z.string().nullable(),
  subjectName: z.string().nullable(),

  /** The originating alert (the diagnosis), or null if it was since deleted. */
  alertId: UuidSchema.nullable(),

  /** Optional kind objective the parent set. */
  objective: z.string().nullable(),

  /** Subject average captured at promotion time (the strip baseline), or null. */
  baselineAvg: z.number().nullable(),
  /** Subject trend delta captured at promotion time (signed, /20), or null. */
  baselineTrendDelta: z.number().nullable(),

  /** Booking session counts (0 in S1 — booking writes arrive in S2). */
  sessionsPlanned: z.number().int().nonnegative(),
  sessionsDone: z.number().int().nonnegative(),

  createdAt: z.string(),
  closedAt: z.string().nullable(),
});
export type RemediationPlanDto = z.infer<typeof RemediationPlanDtoSchema>;

// ---------------------------------------------------------------------------
// Read-only catalogue (parent) — published, subject-filtered tutors + open slots
// ---------------------------------------------------------------------------

/**
 * A bookable availability slot as surfaced in the read-only catalogue. S1 lists
 * a tutor's active slots (browse only) — no booking verb yet. `kind` discriminates
 * a repeating weekday slot from a single dated one-off; the UI renders whichever
 * fields the kind populates.
 */
export const CatalogueSlotDtoSchema = z.object({
  id: UuidSchema,
  kind: z.enum(AVAILABILITY_KIND),
  weekday: z.number().int().min(0).max(6).nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  capacity: z.number().int().positive(),
});
export type CatalogueSlotDto = z.infer<typeof CatalogueSlotDtoSchema>;

/**
 * A tutoring resource as surfaced in the read-only catalogue: published, within
 * the parent's tenant, and matching the diagnosed subject. `costKind` is a label
 * only (never a price). Carries its active open slots (bounded include, no N+1).
 */
export const CatalogueTutorDtoSchema = z.object({
  id: UuidSchema,
  type: z.enum(TUTOR_TYPE),
  costKind: z.enum(TUTOR_COST_KIND),
  displayName: z.string(),
  blurb: z.string().nullable(),
  subjectIds: z.array(UuidSchema),
  slots: z.array(CatalogueSlotDtoSchema),
});
export type CatalogueTutorDto = z.infer<typeof CatalogueTutorDtoSchema>;

/** Aggregate response for `GET /remediation/catalogue?subjectId=`. */
export const RemediationCatalogueDtoSchema = z.object({
  subjectId: UuidSchema,
  subjectName: z.string().nullable(),
  tutors: z.array(CatalogueTutorDtoSchema),
});
export type RemediationCatalogueDto = z.infer<typeof RemediationCatalogueDtoSchema>;

// Re-export the booking-status enum tuple at the DTO layer so downstream slices
// (S2 booking, S4 teacher inbox) import it alongside the plan/catalogue DTOs.
export const BOOKING_STATUS_VALUES = BOOKING_STATUS;
