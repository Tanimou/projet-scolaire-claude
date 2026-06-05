# E2 — Data model (Prisma) + non-destructive migration plan

> **Author: Winston (Architect).** New/changed Prisma models, relations, constraints,
> `tenant_id` scoping + indexes, and a **non-destructive** migration plan. Respects the
> existing conventions seen across `apps/api/prisma/schema.prisma`: `@db.Uuid` ids,
> snake_case `@map`, `@db.Timestamptz(6)` timestamps, `tenant_id`-first composite indexes,
> `@@map("snake_case")`, both ends of every relation declared, **and no SQL `migrations/`
> folder — the schema file is the source of truth applied via `prisma db push`** (the
> established repo convention; see E1-S3 PROGRESS, `AlertInstance`/`MeetingRequest`).

## 0. Footprint summary

- **3 new models:** `Conversation`, `ConversationParticipant`, `ConversationMessage`.
- **2 new enums:** `ConversationParticipantRole`, `ConversationStatus`.
- **S4 adds:** a `ConversationReport` model + `ConversationReportStatus` enum (sliced separately).
- **Back-relations added on existing models:** `Student`, `UserProfile`, `AlertInstance`
  (optional seed), `Subject` (optional context). **No column is removed or retyped on any
  existing model** → strictly additive, non-destructive.
- **New `NotificationKind` value:** `message` (additive enum value, no new table — mirrors how
  E1-S4 added `weekly_digest`).

## 1. Enums

```prisma
/// Role of a participant within a conversation thread. MVP: exactly one parent +
/// one teacher per thread (admins read via moderation, never as participants).
enum ConversationParticipantRole {
  parent
  teacher
}

/// Lifecycle of a thread. `active` = open for messages; `read_only` = a wall check
/// failed (teacher no longer teaches the child) so history is preserved but no new
/// message is allowed; `archived` = either party archived it; `blocked` = admin
/// moderation froze it (S4). Messages are NEVER deleted — status gates writes only.
enum ConversationStatus {
  active
  read_only
  archived
  blocked
}
```

## 2. `Conversation` (the thread)

A thread is **scoped to exactly one (parent, teacher, child)** triple. The `@@unique`
on `(tenantId, parentId, teacherId, studentId)` makes "open or reuse the thread" idempotent —
clicking the alert CTA twice reuses the same thread rather than spawning duplicates (mirrors the
`MeetingRequest @@unique` idempotency decision from E1-S3).

```prisma
model Conversation {
  id          String             @id @default(uuid()) @db.Uuid
  tenantId    String             @map("tenant_id") @db.Uuid
  schoolId    String?            @map("school_id") @db.Uuid
  /// The child the thread is about. The guardianship ∩ teaching ABAC is anchored here.
  studentId   String             @map("student_id") @db.Uuid
  /// Denormalised participant ids (also rows in ConversationParticipant) so the
  /// uniqueness/idempotency key and the cheap "my threads" query need no join.
  parentId    String             @map("parent_id") @db.Uuid
  teacherId   String             @map("teacher_id") @db.Uuid
  /// Optional subject context (e.g. the alert's subject) — display only.
  subjectId   String?            @map("subject_id") @db.Uuid
  /// THE VISIONARY SEED (optional). When a thread is opened from an E1 alert, the
  /// alert id is stored for context so the teacher sees WHY. Optional, SetNull on
  /// alert delete. NEVER widens access — the create path re-checks guardianship on
  /// the alert's student and that the alert concerns `studentId`.
  alertId     String?            @map("alert_id") @db.Uuid
  status      ConversationStatus @default(active)
  /// Short server-rendered subject line (e.g. the alert title or the first message
  /// excerpt) for the inbox list — avoids a message join on the list query.
  topic       String?
  /// Denormalised for cheap inbox ordering + unread math (set on each new message).
  lastMessageAt   DateTime?      @map("last_message_at") @db.Timestamptz(6)
  lastMessageById String?        @map("last_message_by_id") @db.Uuid
  createdBy   String             @map("created_by") @db.Uuid
  createdAt   DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime           @updatedAt @map("updated_at") @db.Timestamptz(6)

  student      Student                   @relation(fields: [studentId], references: [id], onDelete: Cascade)
  parent       UserProfile               @relation("ConversationParent", fields: [parentId], references: [id], onDelete: Cascade)
  teacher      UserProfile               @relation("ConversationTeacher", fields: [teacherId], references: [id], onDelete: Cascade)
  subject      Subject?                  @relation(fields: [subjectId], references: [id], onDelete: SetNull)
  alert        AlertInstance?            @relation(fields: [alertId], references: [id], onDelete: SetNull)
  participants ConversationParticipant[]
  messages     ConversationMessage[]
  reports      ConversationReport[]      // S4

  /// Idempotency: one thread per (tenant, parent, teacher, child). Reuse on re-open.
  @@unique([tenantId, parentId, teacherId, studentId])
  /// Inbox queries: "my threads, newest first", tenant- + school-scoped.
  @@index([tenantId, schoolId, status, lastMessageAt])
  @@index([parentId, status, lastMessageAt])
  @@index([teacherId, status, lastMessageAt])
  @@index([studentId])
  @@map("conversation")
}
```

> **Why both denormalised `parentId`/`teacherId` AND a `ConversationParticipant` table?**
> The two ids give a cheap idempotency key + per-side index without a join (the inbox is the
> hot path — the cahier's <2 s budget). The participant table carries **per-side mutable state**
> (`lastReadAt`, `archivedAt`, `muted`) and keeps the model **forward-compatible** with future
> multi-participant threads without a destructive reshape. This is a deliberate, conventional
> denormalisation (same spirit as `MeetingRequest` denormalising `alertCode`/`subjectId`).

## 3. `ConversationParticipant` (per-side read state)

```prisma
model ConversationParticipant {
  id             String                       @id @default(uuid()) @db.Uuid
  tenantId       String                       @map("tenant_id") @db.Uuid
  conversationId String                       @map("conversation_id") @db.Uuid
  userProfileId  String                       @map("user_profile_id") @db.Uuid
  role           ConversationParticipantRole
  /// Read-receipt anchor: every message with createdAt <= lastReadAt is "read"
  /// by this participant. Bumped on mark-read. Unread count = messages newer than this.
  lastReadAt     DateTime?                    @map("last_read_at") @db.Timestamptz(6)
  archivedAt     DateTime?                    @map("archived_at") @db.Timestamptz(6)
  muted          Boolean                      @default(false)
  createdAt      DateTime                     @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime                     @updatedAt @map("updated_at") @db.Timestamptz(6)

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  userProfile  UserProfile  @relation(fields: [userProfileId], references: [id], onDelete: Cascade)

  /// One participant row per (thread, user).
  @@unique([conversationId, userProfileId])
  @@index([tenantId])
  @@index([userProfileId, archivedAt])
  @@map("conversation_participant")
}
```

## 4. `ConversationMessage` (immutable message)

Messages are **append-only / immutable** (no `updatedAt`-driven edits, no soft-delete in the
MVP) — consistent with the platform's append-only audit ethos. Safety is handled by `report`
(S4) + thread `status=blocked`, not by deletion.

```prisma
model ConversationMessage {
  id             String       @id @default(uuid()) @db.Uuid
  tenantId       String       @map("tenant_id") @db.Uuid
  conversationId String       @map("conversation_id") @db.Uuid
  /// Author UserProfile (must be one of the thread's participants — enforced in service).
  senderId       String       @map("sender_id") @db.Uuid
  senderRole     ConversationParticipantRole @map("sender_role")
  body           String       @db.Text
  createdAt      DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender       UserProfile  @relation("ConversationMessageSender", fields: [senderId], references: [id], onDelete: Cascade)

  /// Thread view = messages of a conversation in time order (paged). tenant-first.
  @@index([tenantId, conversationId, createdAt])
  @@index([senderId, createdAt])
  @@map("conversation_message")
}
```

## 5. `ConversationReport` (S4 — moderation/safety)

Sliced separately (S4 — **shipped**). Listed here so the full data model is visible up front.
The model + enum + the `UserProfile`/`Conversation` back-relations landed in S4 via `db push`.

```prisma
enum ConversationReportStatus {
  open
  reviewed
  dismissed
}

/// A safety report raised by a participant against a thread. Triaged by an admin
/// in the moderation oversight surface (S4). Append-only resolution (stamp, never delete).
model ConversationReport {
  id             String                   @id @default(uuid()) @db.Uuid
  tenantId       String                   @map("tenant_id") @db.Uuid
  schoolId       String?                  @map("school_id") @db.Uuid
  conversationId String                   @map("conversation_id") @db.Uuid
  reportedBy     String                   @map("reported_by") @db.Uuid
  reason         String                   @db.Text
  status         ConversationReportStatus @default(open)
  reviewedBy     String?                  @map("reviewed_by") @db.Uuid
  reviewedAt     DateTime?                @map("reviewed_at") @db.Timestamptz(6)
  createdAt      DateTime                 @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime                 @updatedAt @map("updated_at") @db.Timestamptz(6)

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  reporter     UserProfile  @relation("ConversationReportReporter", fields: [reportedBy], references: [id], onDelete: Cascade)

  /// One open report per (thread, reporter) — re-report is idempotent while open.
  @@unique([conversationId, reportedBy, status])
  @@index([tenantId, schoolId, status, createdAt])
  @@map("conversation_report")
}
```

## 6. Back-relations to add on EXISTING models

Prisma validation FAILS without both ends of every relation — add these or the typecheck gate
is red. **All additive (no field removed/retyped).**

| Existing model | Field to add |
|---|---|
| `UserProfile` | `conversationsAsParent  Conversation[]  @relation("ConversationParent")` |
| `UserProfile` | `conversationsAsTeacher Conversation[]  @relation("ConversationTeacher")` |
| `UserProfile` | `conversationParticipants ConversationParticipant[]` |
| `UserProfile` | `conversationMessages   ConversationMessage[] @relation("ConversationMessageSender")` |
| `UserProfile` | `conversationReports    ConversationReport[]  @relation("ConversationReportReporter")` *(S4)* |
| `Student` | `conversations Conversation[]` |
| `Subject` | `conversations Conversation[]` |
| `AlertInstance` | `conversations Conversation[]` *(optional seed back-relation)* |

## 7. Multi-tenancy, RLS & access (ADR-002 / ADR-015)

- **Every model carries `tenantId @db.Uuid` and a `tenant_id`-first index** — identical to
  `AlertInstance`, `MeetingRequest`, `Notification`. Every service query MUST include
  `where: { tenantId }` (application-level scoping is the load-bearing isolation, consistent
  with `AlertsService`/`MeetingRequestsService` — the cross-tenant isolation specs are required).
- **RLS posture:** the repo applies RLS + `REVOKE` to a subset of tables via migration SQL (see
  the `AuditLog` "RLS + REVOKE configurés en migration SQL" note). E2's new tables follow the
  **same posture as the sibling feature tables** (`alert_instance`, `meeting_request`,
  `notification`) which rely on **application-level `tenant_id` scoping** rather than a per-table
  RLS policy. **No new RLS policy is introduced** → no behavioural change to the DB security
  model → this is *not* a new architectural decision. (If a future hardening pass adds RLS to the
  notification/alert family, the conversation tables join that batch — out of scope here.)
- **The ABAC wall is the new part** and lives in the service layer, not the schema:
  - **Guardianship half** — reuse `StudentAccessService.canAccessStudent(parentProfileId, studentId)`
    (E1's gate) so the parent provably guards the child.
  - **Teaching half** — a new check `isTeacherOfStudent(teacherUserProfileId, studentId)`:
    resolve the teacher's `TeacherProfile`, the student's **active** `Enrollment.classSectionId`
    (current academic year), and assert a `TeachingAssignment(teacherProfileId, classSectionId, *)`
    exists in the **active** academic year. Both halves must hold **at create AND at every send**
    (re-checked — a teacher who stops teaching the child flips the thread to `read_only`).
  - **`alertId` seed never widens access** — see spec §4 Scenario B / AC3.

## 8. Migration plan (non-destructive)

1. **Edit `apps/api/prisma/schema.prisma` only** — add the 2 enums + 2 models for **S1**
   (`Conversation`, `ConversationParticipant`, `ConversationMessage`; the `ConversationReport`
   model + enum land in **S4**), add the `message` `NotificationKind` value, and add the §6
   back-relations on existing models. **Do NOT scaffold a SQL `migrations/` folder** — that would
   be an off-convention new pattern (the repo has none; `db push` is the convention).
2. **Apply with `prisma db push`** + **`prisma generate`** (orchestrator/operator pre-merge step,
   exactly as E1-S3/S4 documented — the diff carries the schema edit; the regenerated client is a
   required pre-merge step, NOT in the diff, so the typecheck gate compiles against the new client
   only after regen).
3. **Strictly additive** — no column is dropped or retyped on any existing table; all new tables
   are created fresh; existing rows are untouched. Rollback = drop the 3 (S4: 4) new tables +
   revert the additive enum value. **Zero data loss risk.**
4. **Index review (write/read trade-off):** the four `Conversation` indexes cover the two hot
   inbox paths (per-parent, per-teacher) + the idempotency unique + the student lookup; the
   `ConversationMessage` `(tenant, conversation, createdAt)` index serves the paged thread view.
   No over-indexing (each maps to a query in [`contracts/openapi.yaml`](./contracts/openapi.yaml)).

## 9. Sizing / scale notes (cahier <2 s budget)

- Inbox list reads `Conversation` rows directly (denormalised `topic`/`lastMessageAt`) — **no
  message join**, no N+1. Unread count = `count(messages where createdAt > participant.lastReadAt)`
  computed in a single grouped query per inbox load (or carried as a cheap per-thread subquery).
- Thread view pages `ConversationMessage` by `(conversationId, createdAt)` — index-covered.
- These are **aggregate-endpoint reads** per the project convention; the parent/teacher pages
  never N+1 from the client.
