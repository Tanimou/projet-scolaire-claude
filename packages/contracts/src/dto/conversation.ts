import { z } from 'zod';

import { UuidSchema } from './common';

/**
 * Conversation — E2-S1 (parent ↔ teacher messaging).
 *
 * Dual-wall ABAC: a thread exists only for a (parent, teacher, child) where the
 * parent provably guards the child (StudentAccessService) AND the teacher
 * currently teaches that child (TeachingAssignment on the child's active-year
 * class section). Both walls are re-checked at create AND every send — a teacher
 * who stops teaching the child flips the thread to `read_only` (history is never
 * deleted). Threads are idempotent on `(tenant, parent, teacher, child)`: opening
 * an existing thread reuses it. Messages are immutable (append-only).
 *
 * This is a two-portal shared surface (parent compose + future teacher inbox), so
 * the DTOs live in `@pilotage/contracts`. Mirrors the structure/comment style of
 * `dto/meeting-request.ts`.
 *
 * S2 adds the read/state surface (inbox aggregate, paged messages, mark-read)
 * and wires the `alertContext` exposure + the alert-seeded CTA end-to-end.
 */

export const CONVERSATION_STATUS = ['active', 'read_only', 'archived', 'blocked'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUS)[number];

export const CONVERSATION_PARTICIPANT_ROLE = ['parent', 'teacher'] as const;
export type ConversationParticipantRole = (typeof CONVERSATION_PARTICIPANT_ROLE)[number];

/**
 * A teacher the caller's child may be messaged about — server-filtered to the
 * intersection of guardianship ∩ current teaching, so the compose picker can
 * never select an ineligible teacher. `userProfileId` is the value POSTed back as
 * `teacherId` (NOT the TeacherProfile id). `existingConversationId` lets the UI
 * deep-link instead of re-creating.
 */
export const EligibleTeacherDtoSchema = z.object({
  userProfileId: UuidSchema,
  displayName: z.string(),
  subjects: z.array(z.object({ subjectId: UuidSchema, name: z.string() })),
  isMainTeacher: z.boolean(),
  existingConversationId: UuidSchema.nullable(),
});
export type EligibleTeacherDto = z.infer<typeof EligibleTeacherDtoSchema>;

/**
 * The originating alert's context for an alert-seeded thread. Nullable.
 * Exposed end-to-end in S2: a strict read-only subset (`alertId`, `code`,
 * `title`, `subjectName`) of the alert card the parent already sees. It never
 * widens access — the read mapper re-asserts `alert.studentId === conv.studentId`
 * and degrades to `null` on any mismatch / deleted alert.
 */
export const AlertContextDtoSchema = z.object({
  alertId: UuidSchema,
  code: z.string(),
  title: z.string(),
  subjectName: z.string().nullable(),
});
export type AlertContextDto = z.infer<typeof AlertContextDtoSchema>;

export const ConversationDtoSchema = z.object({
  id: UuidSchema,
  studentId: UuidSchema,
  studentName: z.string(),
  parentId: UuidSchema,
  parentName: z.string(),
  teacherId: UuidSchema,
  teacherName: z.string(),
  subjectId: UuidSchema.nullable(),
  subjectName: z.string().nullable(),
  /** Nullable. Populated for alert-seeded threads (read-only subset); null otherwise. */
  alertContext: AlertContextDtoSchema.nullable(),
  status: z.enum(CONVERSATION_STATUS),
  topic: z.string().nullable(),
  lastMessageAt: z.string().nullable(),
  lastMessagePreview: z.string().nullable(),
  unreadCount: z.number(),
  createdAt: z.string(),
});
export type ConversationDto = z.infer<typeof ConversationDtoSchema>;

export const ConversationMessageDtoSchema = z.object({
  id: UuidSchema,
  conversationId: UuidSchema,
  senderId: UuidSchema,
  senderRole: z.enum(CONVERSATION_PARTICIPANT_ROLE),
  senderName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type ConversationMessageDto = z.infer<typeof ConversationMessageDtoSchema>;

// ---------------------------------------------------------------------------
// S2 — read/state surface (additive). Inbox + paged messages + mark-read.
// These schemas describe the NEW aggregate read endpoints; the existing DTOs
// above are reused unchanged (no field retyped/removed).
// ---------------------------------------------------------------------------

/**
 * Inbox query — role-aware (parent: parentId=me; teacher: teacherId=me; resolved
 * server-side from the JWT, NOT passed here). `status` defaults to the visible
 * set (active + read_only); `archived`/`blocked` are excluded unless requested.
 * `limit` is capped 1..200 (default 50); `offset` for paging.
 */
export const ConversationInboxQuerySchema = z.object({
  status: z.enum(CONVERSATION_STATUS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ConversationInboxQuery = z.infer<typeof ConversationInboxQuerySchema>;

/** Inbox aggregate response: the caller's threads + a total for paging. */
export const ConversationInboxResponseSchema = z.object({
  data: z.array(ConversationDtoSchema),
  total: z.number(),
});
export type ConversationInboxResponse = z.infer<typeof ConversationInboxResponseSchema>;

/**
 * Paged thread messages. `before` is an ISO cursor (exclusive upper bound on
 * `createdAt`) for "load older"; a page is returned oldest→newest. `limit`
 * capped 1..200 (default 50).
 */
export const ConversationMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
});
export type ConversationMessagesQuery = z.infer<typeof ConversationMessagesQuerySchema>;

/** A page of messages + a `hasMore` flag so the UI can offer "load previous". */
export const ConversationMessagePageSchema = z.object({
  data: z.array(ConversationMessageDtoSchema),
  hasMore: z.boolean(),
  /**
   * The counterpart's read anchor (ISO) — lets the UI render "Vu/Envoyé" receipts
   * without an extra call. Null when the counterpart has never read the thread.
   */
  counterpartLastReadAt: z.string().nullable(),
});
export type ConversationMessagePage = z.infer<typeof ConversationMessagePageSchema>;

/**
 * Open-or-reuse a thread. `body` is the first message (ignored on idempotent
 * reuse). `subjectId`/`alertId` are optional context — `alertId` NEVER widens
 * access (re-checked: alert in-tenant + `alert.studentId === studentId`).
 */
export const CreateConversationRequestSchema = z.object({
  studentId: UuidSchema,
  teacherId: UuidSchema,
  body: z.string().min(1).max(5000),
  subjectId: UuidSchema.nullable().optional(),
  alertId: UuidSchema.nullable().optional(),
});
export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>;

export const SendMessageRequestSchema = z.object({
  body: z.string().min(1).max(5000),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

// ---------------------------------------------------------------------------
// S4 — moderation / safety (additive). Report a thread + admin oversight list.
// A participant raises a report; an admin triages it in a read-only oversight
// surface. Reports are idempotent-while-open and append-only (never deleted).
// ---------------------------------------------------------------------------

export const CONVERSATION_REPORT_STATUS = ['open', 'reviewed', 'dismissed'] as const;
export type ConversationReportStatus = (typeof CONVERSATION_REPORT_STATUS)[number];

/**
 * Raise a safety report against a thread. Participant-only (404 otherwise);
 * idempotent while an `open` report by the same reporter exists (re-clicking
 * "Signaler" reuses it). `reason` is optional free text — kept short and never
 * stigmatising in the UI copy.
 */
export const ReportConversationRequestSchema = z.object({
  reason: z.string().max(2000).optional(),
});
export type ReportConversationRequest = z.infer<typeof ReportConversationRequestSchema>;

/** The report row returned to the reporter on create (+ admin oversight rows). */
export const ConversationReportDtoSchema = z.object({
  id: UuidSchema,
  conversationId: UuidSchema,
  reportedBy: UuidSchema,
  reporterName: z.string(),
  reason: z.string().nullable(),
  status: z.enum(CONVERSATION_REPORT_STATUS),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  /** Thread context for the admin oversight list (null on the create response). */
  studentName: z.string().nullable(),
  parentName: z.string().nullable(),
  teacherName: z.string().nullable(),
  conversationStatus: z.enum(CONVERSATION_STATUS).nullable(),
});
export type ConversationReportDto = z.infer<typeof ConversationReportDtoSchema>;

/**
 * Admin moderation oversight query. `status` defaults to `open` (the triage
 * queue); admins can request `reviewed`/`dismissed`. Tenant/school scoped
 * server-side. `limit` capped 1..200 (default 50); `offset` for paging.
 */
export const ConversationReportsQuerySchema = z.object({
  status: z.enum(CONVERSATION_REPORT_STATUS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ConversationReportsQuery = z.infer<typeof ConversationReportsQuerySchema>;

/** Admin oversight response: reported threads + a total for paging. */
export const ConversationReportsResponseSchema = z.object({
  data: z.array(ConversationReportDtoSchema),
  total: z.number(),
});
export type ConversationReportsResponse = z.infer<typeof ConversationReportsResponseSchema>;
