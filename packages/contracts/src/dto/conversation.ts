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
 * NOTE (S1 scope): the create response stores `alertId` but does NOT expose the
 * full `alertContext` — that exposure + the alert-seeded CTA rewire are S2.
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
 * Reserved/DEFERRED to S2 — S1 stores `alertId` but never exposes this on the
 * create response (the contract is declared here so S2 needs no DTO churn).
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
  /** Nullable. DEFERRED to S2 — always null on the S1 create/reuse response. */
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
