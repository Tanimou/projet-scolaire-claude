import { z } from 'zod';

import { ALERT_RULE_CODE, ALERT_SEVERITY } from '../enums';

import { UuidSchema } from './common';

/**
 * MeetingRequest — E1-S3.
 *
 * Promotes S2's append-only `alert.meeting_intent` audit row into a queryable,
 * tenant-scoped model: a parent asking for a point/callback on a specific
 * alert, routed (server-side, never client-supplied) to the child's current
 * subject teacher → main teacher → school admin. Surfaced in a role-scoped
 * teacher/admin action center with a single "resolve" transition.
 *
 * The lifecycle is intentionally minimal (no `acknowledged` — the request is
 * either awaiting a human or handled): `open` → `resolved` | `cancelled`.
 * `resolved` = the assignee will/did contact the family ("Planifier un
 * échange"); `cancelled` = closed without follow-up ("Clôturer").
 *
 * This is a two-portal shared surface (teacher + admin read the same rows), so
 * the DTO lives in `@pilotage/contracts`. `AlertRuleCode`/`AlertSeverity` are
 * reused verbatim from the alert engine — a meeting request inherits its
 * originating alert's explainability (rule + subject + severity).
 */
export const MEETING_REQUEST_STATUS = ['open', 'resolved', 'cancelled'] as const;
export type MeetingRequestStatus = (typeof MEETING_REQUEST_STATUS)[number];

export const MeetingRequestDtoSchema = z.object({
  id: UuidSchema,
  status: z.enum(MEETING_REQUEST_STATUS),

  /** The originating alert, for one-click explainability. */
  alertId: UuidSchema,
  alertCode: z.enum(ALERT_RULE_CODE),
  alertSeverity: z.enum(ALERT_SEVERITY),
  alertTitle: z.string(),

  /** The child the request is about (the request was filed by one of its guardians). */
  studentId: UuidSchema,
  studentName: z.string(),
  classSectionName: z.string().nullable(),

  /** Subject context inherited from the alert (null for non-subject alerts). */
  subjectId: UuidSchema.nullable(),
  subjectCode: z.string().nullable(),
  subjectName: z.string().nullable(),

  /** The guardian who filed the request. */
  requestedByName: z.string().nullable(),

  /** Server-resolved assignee (teacher/admin), or null when unrouted (admin-only triage). */
  assignedToId: UuidSchema.nullable(),
  assignedToName: z.string().nullable(),

  requestedAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type MeetingRequestDto = z.infer<typeof MeetingRequestDtoSchema>;
