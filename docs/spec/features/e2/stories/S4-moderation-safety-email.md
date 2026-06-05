# E2-S4 — Moderation / safety + optional email channel

> **Self-contained story spec.** A developer must be able to implement this slice
> from this file alone — no other context required. Author: John (BMAD PM).
> Epic: **E2 — Parent ↔ Teacher Messaging (Conversations)**. Slice: **S4** (final
> slice of E2). Mode: epic-slice.
> Predecessors all shipped (needs human review): **S1** (the `Conversation` /
> `ConversationParticipant` / `ConversationMessage` spine + dual-wall ABAC +
> create/send + the additive `message` `NotificationKind`), **S2** (the parent
> `/parent/messages` inbox/thread/compose + `alertContext` seed + 4 aggregate
> read/state endpoints), **S3** (the teacher `/teacher/conversations` inbox +
> thread reply + the two retargeted notification deep-links).
>
> **This is a `[schema][auth]` slice.** It closes E2 on the *safety* side: a
> participant can **report** a thread, an admin gets a **read-only moderation
> oversight** list, sends are **rate-limited** per sender, the copy stays
> **kind / non-stigmatising**, and an **opt-in email** notifies on new messages —
> all reusing the existing notification-email pipeline (no new queue), under tenant
> scoping + append-only audit, with the dual-wall ABAC of S1 **unchanged**.

---

## 1. Intent (one sentence)

Ship parent↔teacher messaging **moderation/safety + an opt-in email channel**: a
`ConversationReport` model (+ `ConversationReportStatus` enum, `db push`), a
participant-scoped idempotent `POST /api/v1/conversations/:id/report`, an admin-only
`GET /api/v1/conversations/reports` (`messaging.moderate`, append-only audit on the
moderation read), a per-sender send rate-limit window, a report control on the thread
in **both** the parent and teacher portals, an admin moderation oversight list, an
email opt-in row mirroring `weekly_digest` in the shared `PreferencesPanel`, and an
optional new-message email reusing the existing worker `notifications-email` processor
+ `NotificationPreference(message, emailEnabled)` (opt-in **OFF by default**, RGPD) —
**no new BullMQ queue**, dual-wall ABAC unchanged, all tenant-scoped.

## 2. Why (ties to the cahier de charges)

The cahier mandates **RGPD-level governance, minimal access, kind/non-stigmatising
tone, and append-only audit** because the platform handles children's data. A
two-way channel (S1–S3) without a safety lever is incomplete: a parent or teacher
must be able to **flag** an inappropriate thread, a school admin must have
**oversight** (read-only, never impersonating), and the system must resist **spam**
(rate-limit) and **unsolicited mail** (email strictly opt-in). This slice delivers
exactly the spec §5 AC6 + AC7 invariants. The email channel is the *push* completion:
a parent who opts in is told by email when the teacher replies, bringing the
conversation to their inbox — the same "turn information into action" loop E1-S4's
digest established, reusing the very same pipeline.

## 3. Scope flags

- `touchesUi` = **true** — a **report control** on the thread (parent + teacher
  portals), an **admin moderation oversight** page, and the **email opt-in row** for
  the `message` kind in the shared `PreferencesPanel` (the row already renders from
  the backend; the work is the report control + the admin page + confirming the
  message-email row reads sensibly and stays OFF by default).
- `touchesBackend` = **true** — one new model (`ConversationReport`) + one new enum
  (`ConversationReportStatus`) + the S4 back-relations; two new endpoints
  (`POST /conversations/:id/report`, `GET /conversations/reports`); a per-sender send
  **rate-limit** in `sendMessage`; the new `messaging.moderate` permission (admin
  only); append-only audit rows on report-create and on the admin moderation read.
- `touchesWorker` = **partial / verify-only** — the optional new-message **email**
  channel is **already wired** end-to-end (S1 added the `message` `NotificationKind`;
  `NotificationsService.createMany` → `dispatchEmails` enqueues to the existing
  `notifications-email` queue whenever the recipient has
  `NotificationPreference(message, emailEnabled=true)`; the worker's
  `NotificationsEmailProcessor` + `renderNotificationEmail` already render+send any
  kind). So **no worker code change is required** — the deliverable is (a) confirming
  the message path honors the opt-in + default-OFF and (b) the FE opt-in surface. **Do
  NOT add a new queue, a new processor, or a digest-style composite email.**

## 4. Users & primary scenarios

| Actor | Auth | Can do in S4 |
|---|---|---|
| **Parent** | `messaging.read`/`messaging.write`, participant of the thread | Report the thread (idempotent); opt into `message` email. |
| **Teacher** | `messaging.read`/`messaging.write`, participant of the thread | Report the thread (idempotent); opt into `message` email. |
| **School-admin / super-admin** | `messaging.moderate` (admin only) | Read the moderation oversight list of reported threads (read-only; **never** impersonate, **never** read message bodies in this slice — see §6c). |

**Scenario A — a participant reports a thread.**
1. On the thread view (parent `/parent/messages/[id]` or teacher
   `/teacher/conversations/[id]`), the user opens a **« Signaler »** control (a small,
   non-alarming secondary action — not a primary button) → picks/writes a short reason
   → confirms.
2. `POST /api/v1/conversations/:id/report` verifies the caller is a **participant**
   (non-participant / cross-tenant → 404), creates a `ConversationReport(status=open)`
   if none open exists for this `(thread, reporter)` (**idempotent** — a second report
   while one is still `open` returns the existing one, **200**, not a duplicate),
   writes an append-only `conversation.report` audit row, and returns the report.
3. The UI confirms kindly: « Merci, votre signalement a été transmis. » No status
   change to the thread itself (reporting does not block/freeze the thread — only an
   admin can, and thread-blocking UI is **out of scope** this slice; the model supports
   `status=blocked` from S1 but no endpoint sets it here).

**Scenario B — an admin reviews reports (oversight).**
1. An admin opens `/admin/conversations/moderation` (new page).
2. `GET /api/v1/conversations/reports?status=open` (admin only, `messaging.moderate`)
   returns the tenant-+school-scoped list of reports with **safe metadata only**
   (reporter name, the two participants' names, the child's name, subject, the report
   reason, status, timestamps) — **never the message bodies** (minimal access; reading
   bodies would be a separate, more invasive capability, deferred).
3. Each oversight read writes an append-only `conversation.moderation_read` audit row
   (who looked, when, which tenant/school) — the governance trail the cahier requires.

**Scenario C — rate-limited send (anti-spam).**
1. A sender posts messages rapidly to a thread.
2. `sendMessage` enforces a **per-sender window** (default: at most **N messages per
   rolling window**, e.g. 10 messages / 60 s, env-tunable). Exceeding it returns
   **429** with a kind French message; the message is **not** persisted and **no**
   notification/email fires. The limit is keyed on `(tenantId, senderId)` across all
   that sender's threads (a global send budget), counted from the immutable
   `ConversationMessage.createdAt` rows (no new table — see §6d).

**Scenario D — opt-in email on a new message.**
1. A parent (or teacher) flips the **Email** switch ON for the **« Messagerie (parent
   ↔ enseignant) »** row in Réglages › Notifications (`PATCH
   /api/v1/notifications/preferences/message { emailEnabled: true }` — the existing,
   unchanged endpoint).
2. Thereafter, when the **counterpart** sends a message, the existing
   `NotificationsService.createMany` fan-out (already called by `sendMessage`) enqueues
   a `notifications-email` job for that recipient (because their `message` email
   preference is now ON); the worker renders + sends it. A recipient who never opted in
   (default OFF) gets **no** email — the RGPD guarantee.

## 5. The schema change (`[schema]` — one model + one enum, NO migration folder)

Edit **only** `apps/api/prisma/schema.prisma`. The model + enum are **already
specified** in [`../data-model.md` §5](../data-model.md) — implement them verbatim:

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

  /// One report row per (thread, reporter, status) — re-report while one is open is idempotent.
  @@unique([conversationId, reportedBy, status])
  @@index([tenantId, schoolId, status, createdAt])
  @@map("conversation_report")
}
```

**Back-relations to add (Prisma fails validation without both ends):**
- On `Conversation` — the `reports ConversationReport[]` back-relation **already
  exists** (added in S1's data-model; confirm it is present in the live schema and add
  it if not).
- On `UserProfile` — add
  `conversationReports ConversationReport[] @relation("ConversationReportReporter")`.

**Migration rules (carry from S1 / E1-S3/S4):**
- **No SQL `prisma/migrations/` folder** — the schema file is the source of truth,
  applied via `prisma db push`. Do **not** scaffold a migrations folder.
- **Strictly additive** — one new table + one new enum + one back-relation field. No
  existing column dropped/retyped. Rollback = drop `conversation_report` + the enum.
- **Operator pre-merge step:** after the edit, run `prisma generate` + `prisma db
  push`. The regenerated client is **not** in the diff, so `pnpm typecheck` is red
  until regen — identical to S1/E1-S3/S4. Call this out in the PR.

## 6. Backend — endpoints, ABAC, rate-limit, audit

All new work lands in the existing **`messaging` module**
(`apps/api/src/modules/messaging/`). No new module.

### 6a. `POST /api/v1/conversations/:id/report` (participant, idempotent open)

Controller (`messaging.controller.ts`), gated `@RequiresPermission('messaging.write')`:
- Body schema (new, in `packages/contracts/src/dto/conversation.ts`):
  `ReportConversationRequestSchema = z.object({ reason: z.string().min(1).max(2000) })`.
- Resolve `me = users.ensureUser(jwt)` + `{ schoolId } = ctx.forUser(me)`.
- Service `reportConversation({ me, jwt, schoolId, conversationId, reason, actorRole,
  portal })`:
  1. **Participant gate (404-before-anything):** re-read the thread under
     `{ id, tenantId: me.tenantId }` with `participants: { where: { userProfileId: me.id } }`;
     if the thread is missing OR the caller is not a participant → `NotFoundException`
     (no existence leak — mirrors `sendMessage`/`getConversation`). **A non-participant
     guardian of the same child still gets 404.**
  2. **Idempotent open:** `findFirst` a `ConversationReport` where
     `{ tenantId, conversationId, reportedBy: me.id, status: 'open' }`. If found → return
     it (200, `created: false`); do **not** create a duplicate.
  3. Else `create` a `ConversationReport` (`tenantId`, `schoolId` from the thread,
     `conversationId`, `reportedBy: me.id`, `reason`, `status: 'open'`). On a `P2002`
     race (the `@@unique([conversationId, reportedBy, status])` lost), fall back to
     re-reading + returning the winner (200), mirroring `createConversation`'s
     concurrency handling.
  4. **Append-only audit (best-effort, never rolls back the report):**
     `auditLog.create({ action: 'conversation.report', resourceType: 'conversation',
     resourceId: conversationId, after: { reportId, reason } })`.
  5. Return a `ConversationReportDto` (see §6e). The controller sets **201** on a
     genuine create, **200** on idempotent reuse (mirror `createConversation`'s
     `res.status(created ? 201 : 200)`).
- **Reporting does NOT mutate the thread status** (no block/freeze here).

### 6b. `GET /api/v1/conversations/reports` (admin oversight, `messaging.moderate`)

Controller, gated `@RequiresPermission('messaging.moderate')` (admin-only — see §6f):
- Query schema: `ReportInboxQuerySchema = z.object({ status:
  z.enum(CONVERSATION_REPORT_STATUS).optional(), limit: 1..200 default 50, offset })`.
- Service `listReports({ me, schoolId, status, limit, offset, actorRole, portal })`:
  1. **Tenant + school scope** — `where: { tenantId: me.tenantId, schoolId }` (a
     school-admin sees only their school's reports; `schoolId` comes from
     `ctx.forUser`). Default `status` filter = `open` (or all when omitted — pick `open`
     default for a focused queue, mirror `MeetingRequestsController`).
  2. One `findMany` joining **safe metadata only**: `reporter {firstName,lastName}`,
     `conversation { parent{...}, teacher{...}, student{...}, subject{name} }` — **NEVER
     `messages` / `body`** (minimal access; see §6c) — ordered `createdAt desc`, paged.
  3. **Append-only moderation-read audit (best-effort):** write ONE
     `auditLog.create({ action: 'conversation.moderation_read', resourceType:
     'conversation_report', resourceId: <something stable, e.g. the status filter or a
     synthetic 'list'>, after: { count, status, schoolId } })` per list call — the
     governance trail "an admin looked at the moderation queue". (Per-list, not
     per-row, to avoid audit spam.)
  4. Return `{ data: ConversationReportDto[], total }`.
- **No `reviewedBy`/resolve endpoint in this slice** — triage actions (mark
  reviewed/dismissed) are a follow-up. The list is **read-only oversight** (spec §3:
  admin "read threads for safety/moderation"). The model carries `reviewedBy`/`status`
  so a later slice can add `PATCH /conversations/reports/:id` without a reshape.

### 6c. Minimal access — what the admin sees

The oversight list exposes **metadata, not content**: who reported, the two
participants, the child, the subject, the reason text the reporter wrote, the status,
timestamps. It does **NOT** expose `ConversationMessage` bodies. Reading a child's
conversation content is a more invasive capability than triaging a report; keeping it
out honors the cahier's *minimal access*. (If a future slice needs body access for
moderation, it must be its own `messaging.moderate.read_thread`-gated endpoint with its
own audit — flag for Winston, do not build here.)

### 6d. Send rate-limit (per-sender window, NO new table)

In `MessagingService.sendMessage`, **before** persisting the message (after the ABAC
re-check, before the `$transaction`):
- Count the caller's recent messages: `conversationMessage.count({ where: { tenantId:
  me.tenantId, senderId: me.id, createdAt: { gte: new Date(Date.now() -
  WINDOW_MS) } } })`. (Reuses the immutable `ConversationMessage` rows — **no new
  table**, index-covered by the existing `([senderId, createdAt])` index.)
- If the count **≥ `MAX_MESSAGES_PER_WINDOW`** → throw
  `new HttpException('Vous envoyez des messages trop rapidement. Réessayez dans un
  instant.', 429)` (or NestJS `ThrottlerException` equivalent — a plain 429 via
  `HttpException` with `HttpStatus.TOO_MANY_REQUESTS` is sufficient and keeps the
  dependency surface flat). The message is **not** created and **no** notification/email
  fires.
- **Tunable via env** with safe defaults: `MESSAGING_RATE_LIMIT_MAX` (default `10`),
  `MESSAGING_RATE_LIMIT_WINDOW_MS` (default `60_000`). Read once at construction or per
  call from `process.env` (mirror the digest cron's env-knob pattern).
- The limit is a **per-sender global budget** (across all their threads), counted from
  `senderId` — it bounds a spamming account, not a single thread. The *first* message of
  a thread (in `createConversation`) is low-volume (idempotent create) and is **not**
  rate-limited in this slice (keep the change surgical — only `sendMessage`); a parent
  cannot spam-create threads anyway (idempotent `@@unique`).

### 6e. New contracts (`packages/contracts/src/dto/conversation.ts`)

Add (additive — no existing schema retyped):
```ts
export const CONVERSATION_REPORT_STATUS = ['open', 'reviewed', 'dismissed'] as const;
export type ConversationReportStatus = (typeof CONVERSATION_REPORT_STATUS)[number];

export const ReportConversationRequestSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type ReportConversationRequest = z.infer<typeof ReportConversationRequestSchema>;

export const ConversationReportDtoSchema = z.object({
  id: UuidSchema,
  conversationId: UuidSchema,
  reporterName: z.string(),
  parentName: z.string(),
  teacherName: z.string(),
  studentName: z.string(),
  subjectName: z.string().nullable(),
  reason: z.string(),
  status: z.enum(CONVERSATION_REPORT_STATUS),
  createdAt: z.string(),
});
export type ConversationReportDto = z.infer<typeof ConversationReportDtoSchema>;

export const ReportInboxQuerySchema = z.object({
  status: z.enum(CONVERSATION_REPORT_STATUS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ReportInboxQuery = z.infer<typeof ReportInboxQuerySchema>;

export const ConversationReportInboxResponseSchema = z.object({
  data: z.array(ConversationReportDtoSchema),
  total: z.number(),
});
export type ConversationReportInboxResponse = z.infer<typeof ConversationReportInboxResponseSchema>;
```
**Operator pre-merge step (carried from S2):** rebuild `packages/contracts`
(`pnpm --filter @pilotage/contracts build`, or the orchestrator's single `pnpm build`)
so the NestJS controller can load the new schemas from the CJS `dist/` at runtime —
otherwise the new `messaging.controller.spec` cases that parse these schemas fail with a
`TypeError` (stale `dist/`). This is in addition to the `db push` step.

### 6f. Permission: `messaging.moderate` (admin only)

In `apps/api/src/shared/auth/permissions.constants.ts`:
- Add to `PERMISSIONS`:
  `['messaging.moderate', 'Modérer la messagerie', 'conversation', 'moderate']`.
- Grant it to **`school_admin`** in `REALM_ROLE_PERMISSIONS` (`super_admin` inherits
  via the all-permissions map). **Do NOT grant it to `teacher` or `parent`** — they hold
  `messaging.read`/`messaging.write` only, so they pass `report` but are **403** on the
  oversight list. Mirror exactly how `meeting_requests.read` is admin/teacher-scoped.
- **Operator pre-merge step:** re-run the permission seed so `messaging.moderate` lands
  in the DB (identical to E1-S3's `meeting_requests.*` / S1's `messaging.read|write`).

### 6g. The email channel (verify-only — no new code)

The new-message email is **already functional** end-to-end via S1's wiring:
- `MessagingService.sendMessage`/`createConversation` → `notifyCounterpart` →
  `NotificationsService.createMany([{ kind: 'message', ... }])`.
- `createMany` → `dispatchEmails`: calls `preferences.emailEnabledKeys` for the
  `(recipientId, 'message')` pair; email default is **OFF**, so it enqueues to
  `QUEUE_NOTIFICATIONS_EMAIL` **only** for a recipient who explicitly set
  `NotificationPreference(message, emailEnabled=true)`.
- Worker `NotificationsEmailProcessor` → `renderNotificationEmail` renders + sends.

**So the worker requires NO change.** The S4 deliverable here is to **verify** (and pin
with a test) that: (a) a recipient with `message` email OFF (default) gets **zero**
email enqueued; (b) a recipient who opted in gets exactly one. If a gap is found (e.g.
`notifyCounterpart` were not routing through `createMany`), fix it minimally in the
existing path — but per the S1 code it already does. **Do NOT add a new queue, a new
processor, or a bespoke message-email template** (the generic `notification-email`
template already handles `kind: 'message'` — confirm the title/body read sensibly for a
message: S1 sets `title: 'Nouveau message'`, `body: '<name> vous a envoyé un message'`,
`link: '/parent/messages' | '/teacher/conversations'`).

## 7. Frontend (`apps/web`)

### 7a. Report control on the thread (parent + teacher)

A small, **non-stigmatising** secondary control on both thread views:
- Parent: `apps/web/src/app/parent/messages/[id]/page.tsx` — add a discreet
  **« Signaler cette conversation »** affordance (e.g. a text-button / `Flag` icon in a
  muted slate tone, **not** a primary/red button) near the header or below the stream.
- Teacher: `apps/web/src/app/teacher/conversations/[id]/page.tsx` — the same control.
- Implement as a tiny `'use client'` component (e.g.
  `parent/messages/ReportThread.tsx` + `teacher/conversations/ReportThread.tsx`, or one
  shared component under each portal — keep the FE agent's files disjoint from BE) with:
  a trigger → a small inline form / dialog with a `reason` textarea (`maxLength={2000}`,
  required) → a confirm button. On submit, call a new `'use server'` action
  `reportThreadAction(conversationId, reason)` (in the existing `messages-actions.ts` /
  `conversation-actions.ts`) that POSTs to `/api/v1/conversations/:id/report` and
  normalizes failures to the shared `ApiResult` shape (mirror `replyToThreadAction`).
- On success, show a calm confirmation (« Merci, votre signalement a été transmis. »)
  and disable the control (it is idempotent server-side anyway). **Tone:** factual, no
  blame, no "abuse"/"offensive" alarm language — « Signaler » + « Un problème avec cette
  conversation ? ».
- **A11y (WCAG 2.2 AA):** the trigger is a real `<button>` with an accessible label
  ("Signaler cette conversation"); the dialog/inline form traps nothing it shouldn't,
  has a labelled textarea, ≥44px targets, ≥4.5:1 contrast, and an `aria-live` region for
  the success/error message. Reuse `@pilotage/ui` (`Button`, existing modal/inline
  patterns) — **no new shared primitive**.

### 7b. Admin moderation oversight page (new)

`apps/web/src/app/admin/conversations/moderation/page.tsx` (new, server component,
`force-dynamic`), mirroring `apps/web/src/app/admin/meeting-requests/page.tsx`:
- Server-fetch `GET /api/v1/conversations/reports?status=open` via the `api()` client.
- Render a `PortalShell portal="admin"` + `PageHeader` + a list/table of reports:
  reporter, the two participants + child + subject, the **reason**, status chip,
  timestamp. **No message bodies** (the endpoint does not return them — §6c).
- An `EmptyState` (« Aucun signalement » / non-stigmatising) when the list is empty.
- A status filter (open / all) is optional polish — `open` default is fine.
- **No write actions** in the UI this slice (read-only oversight). Reuse the
  `MeetingRequestList`-style presentation + `@pilotage/ui`; no new primitive.
- **Admin nav entry:** add a sidebar/nav item (e.g. under a "Modération" or near
  "Demandes de rendez-vous") pointing at `/admin/conversations/moderation`, reusing the
  existing nav convention. Gate visibility behind the admin role (the page itself is
  also protected by `messaging.moderate` server-side → a non-admin reaching the URL gets
  the API 403 and an empty/forbidden state).

### 7c. Email opt-in row (verify + light polish)

The **« Messagerie (parent ↔ enseignant) »** (`message`) row **already renders** in the
shared `PreferencesPanel` (S1 added the `message` kind to `NOTIFICATION_KINDS` + label +
description). The Email switch already persists via the unchanged
`updatePreferenceAction`. So the FE work is small:
- **Confirm** the `message` row shows with a sensible label/description and the Email
  toggle works and **defaults OFF** (the panel reads `emailEnabled ?? false`).
- **Optional polish:** ensure the description mentions email delivery clearly (S1's
  description already does: « Quand un enseignant (ou un parent) vous envoie un nouveau
  message… »). No structural panel change. **Do NOT** give `message` the email-only
  `weekly_digest` treatment — the message kind legitimately has in-app + email channels.
- **A11y:** the existing switch pattern (`role="switch"` + `aria-checked` +
  `aria-label`) already covers it; verify the `aria-label` reads "Email pour Messagerie
  (parent ↔ enseignant)".

## 8. Acceptance criteria (testable)

1. **Schema:** `apps/api/prisma/schema.prisma` gains `ConversationReport` +
   `ConversationReportStatus` + the `UserProfile.conversationReports` back-relation
   (and the `Conversation.reports` back-relation is present); **no** `prisma/migrations/`
   folder; Prisma validates; applied via `db push`.
2. **Report — idempotent open (participant only):** `POST /conversations/:id/report`
   by a **participant** with a `reason` creates a `ConversationReport(status=open)` and
   returns 201; a **second** report by the same user while one is still `open` returns
   the **existing** report (200), **no** duplicate (`@@unique([conversationId,
   reportedBy, status])`). A **non-participant** (incl. a co-guardian of the same child)
   → **404**; a **cross-tenant** id → **404**. An append-only `conversation.report`
   audit row is written. *(Pinned by `messaging.controller.spec` / `messaging.service.spec`.)*
3. **Admin oversight (admin only, metadata-only, audited):**
   `GET /conversations/reports` returns the **tenant-+school-scoped** list with reporter
   / participants / child / subject / reason / status / timestamps and **NO message
   bodies**. A `parent` or `teacher` caller → **403** (`messaging.moderate` not held). A
   cross-tenant/other-school report is **never** listed. Each list call writes an
   append-only `conversation.moderation_read` audit row. *(Pinned by a spec.)*
4. **Rate-limit (per-sender window):** `sendMessage` rejects with **429** + a kind
   French message once the caller has sent ≥ `MESSAGING_RATE_LIMIT_MAX` (default 10)
   messages within `MESSAGING_RATE_LIMIT_WINDOW_MS` (default 60_000); the over-limit
   message is **not** persisted and fires **no** notification/email. Under the limit,
   sends succeed unchanged. The env knobs override the defaults. *(Pinned by a spec:
   send under-limit OK, over-limit 429, no row created.)*
5. **Email opt-in (RGPD, default OFF):** a recipient with **no** `message` email
   preference (default) receives **zero** `notifications-email` enqueue on a new message;
   a recipient with `NotificationPreference(message, emailEnabled=true)` receives exactly
   **one**. The opt-in is set via the unchanged
   `PATCH /notifications/preferences/message`. **No new queue / processor / template.**
   *(Pinned by a notifications service/dispatch test or asserted via the existing
   `emailEnabledKeys` path.)*
6. **Report control UI (both portals, kind tone):** the parent and teacher thread views
   each show a discreet « Signaler » control that opens a reason form and, on submit,
   confirms « Merci, votre signalement a été transmis. ». Copy is factual /
   non-stigmatising (no "abuse/offensive" alarm language). Accessible (real button,
   labelled textarea, ≥44px, ≥4.5:1, `aria-live` feedback). `@pilotage/ui` reused; no new
   primitive.
7. **Admin moderation page:** `/admin/conversations/moderation` lists open reports
   (reporter, participants, child, subject, reason, status) via the aggregate endpoint
   (no client N+1), with an `EmptyState` when none, a nav entry, and no message bodies.
   A non-admin reaching the URL is blocked by the server-side `messaging.moderate` 403.
8. **Permission:** `messaging.moderate` exists in `PERMISSIONS`, granted to
   `school_admin` (+ `super_admin` via the all-map) and **not** to `teacher`/`parent`;
   the seed re-run lands it. The `report` endpoint uses `messaging.write` (held by
   parent + teacher); the oversight endpoint uses `messaging.moderate`.
9. **Tenant + audit invariants (spec §5 AC7):** every new query is `tenantId`-scoped;
   a cross-tenant id → 404; report-create and moderation-read write append-only
   `AuditLog` rows; messages remain immutable; the dual-wall ABAC of S1/S2/S3 is
   **unchanged** (no widening). `ConversationReport.schoolId` is set from the thread.
10. **No new architectural decision without an ADR.** A new domain model + endpoints in
    the existing `messaging` module (ADR-001), application-level `tenant_id` scoping (no
    new RLS, ADR-002), the `messaging.moderate` RBAC permission (ADR-015), reusing the
    existing notification-email pipeline (no new queue), and a count-based rate-limit
    (no new dependency, no new table) are all consistent with existing patterns →
    **no new ADR**; confirm with Winston. **The real-time/websocket tripwire (ADR-019)
    stays un-triggered** — everything remains polling/revalidation.
11. **Operator pre-merge steps (carried):** `prisma generate` + `prisma db push` (the
    schema edit is committed, the regenerated client is not in the diff → typecheck is
    red until regen); **rebuild `packages/contracts`** (the new DTO schemas are consumed
    at runtime by the NestJS controller via CJS `dist/`); **re-run the permission seed**
    (so `messaging.moderate` lands). Documented in the PR.
12. `pnpm typecheck` passes (the Murat gate) after the operator steps; no
    `git diff --check` whitespace errors; no client N+1 (the oversight list is an
    aggregate endpoint).

## 9. Non-goals (explicitly out of THIS slice)

- ❌ **Admin reading message bodies** in moderation (metadata-only oversight; body
  access is a separate, more invasive capability — deferred, flag for Winston if needed).
- ❌ **Admin triage actions** (mark a report reviewed/dismissed, block/freeze a thread).
  The model carries `status`/`reviewedBy`/`reviewedAt` for a follow-up; this slice is
  **read-only oversight** + reporting only. (No endpoint sets `Conversation.status =
  blocked` here.)
- ❌ A **new BullMQ queue / processor / bespoke message-email template** — the optional
  email reuses the existing `notifications-email` pipeline + generic template.
- ❌ A **new table for rate-limiting** (count the immutable `ConversationMessage` rows)
  or a **new throttle dependency** (a plain count + 429 suffices).
- ❌ **Rate-limiting thread *creation*** (idempotent `@@unique` already bounds it) — only
  `sendMessage` is throttled this slice.
- ❌ **Real-time / websockets / SSE** (ADR-019 tripwire stays off; polling/revalidate).
- ❌ Changing the **S1–S3 dual-wall ABAC**, the `alertContext` seed, the inbox/thread
  endpoints, or the `MeetingRequest` action center.
- ❌ **Email content localisation** (French only, consistent with the existing
  notification email).
- ❌ **Notifying the admin** on a new report (in-app/email) — the oversight list is
  pull-based this slice; a moderation notification is a follow-up.

## 10. Files (expected touch set — keep disjoint per the agent split)

**Backend (`apps/api`) — Amelia (BE):**
- `prisma/schema.prisma` — **edit** `[schema]`: add `ConversationReport` +
  `ConversationReportStatus` + `UserProfile.conversationReports` back-relation (confirm
  `Conversation.reports` present).
- `src/modules/messaging/messaging.controller.ts` — **edit**: `POST
  /conversations/:id/report` (201/200, `messaging.write`) + `GET /conversations/reports`
  (`messaging.moderate`).
- `src/modules/messaging/messaging.service.ts` — **edit**: `reportConversation`
  (participant gate, idempotent open, audit), `listReports` (tenant+school scope,
  metadata-only, moderation-read audit), and the per-sender **rate-limit** branch in
  `sendMessage`.
- `src/modules/messaging/messaging.service.spec.ts` / `messaging.controller.spec.ts`
  — **edit/new tests**: report idempotency + participant gate + cross-tenant 404; admin
  oversight scoping + non-admin 403 + no-bodies; rate-limit boundary (under OK / over
  429, no row); audit rows written.
- `src/shared/auth/permissions.constants.ts` — **edit**: add `messaging.moderate`,
  grant to `school_admin`.

**Contracts (`packages/contracts`) — Amelia (BE) authors source; orchestrator builds:**
- `src/dto/conversation.ts` — **edit**: `CONVERSATION_REPORT_STATUS`,
  `ReportConversationRequestSchema`, `ConversationReportDtoSchema`,
  `ReportInboxQuerySchema`, `ConversationReportInboxResponseSchema` (export from the
  barrel if the file is re-exported).

**Frontend (`apps/web`) — Amelia (FE):**
- `src/app/parent/messages/[id]/page.tsx` — **edit**: mount the report control.
- `src/app/parent/messages/ReportThread.tsx` — **new**: the `'use client'` report
  control (trigger + reason form + confirmation).
- `src/app/parent/messages/messages-actions.ts` — **edit**: `reportThreadAction`.
- `src/app/teacher/conversations/[id]/page.tsx` — **edit**: mount the report control.
- `src/app/teacher/conversations/ReportThread.tsx` — **new** (or reuse a shared one).
- `src/app/teacher/conversations/conversation-actions.ts` — **edit**: `reportThreadAction`.
- `src/app/admin/conversations/moderation/page.tsx` — **new**: the oversight list
  (server component, aggregate fetch, `EmptyState`, no bodies).
- The admin nav config — **edit**: add the « Modération messagerie » entry pointing at
  `/admin/conversations/moderation` (reuse the existing nav convention; find it next to
  the admin `meeting-requests` entry).
- `src/app/*/settings/PreferencesPanel.tsx` — **verify only** (the `message` email row
  already renders; no structural change).

**Worker (`apps/worker`):** **none** (the message email reuses the existing
`notifications-email` processor + generic template; verify-only, see §6g).

## 11. Risk tier & escalation

- **Risk tier: P1** — carries a `[schema]` change (`ConversationReport` + enum, `db
  push`) **and** `[auth]` surface (the new `messaging.moderate` permission + an admin
  oversight read over children's-conversation metadata + a rate-limit on a write path),
  so it is **never silently auto-merged**: it triggers the escalation panel (architect +
  security + test-architect) and is flagged *needs human review*. **Sentinel must
  confirm:**
  (a) the `report` endpoint is **participant-scoped** (non-participant / cross-tenant →
  404, no existence leak) and **idempotent** (no duplicate-open);
  (b) the oversight endpoint is **`messaging.moderate` admin-only**, **tenant-+school-
  scoped**, and returns **metadata only — never message bodies** (minimal access);
  (c) report-create **and** moderation-read both write **append-only** `AuditLog` rows
  (the governance trail), and no existing audit row is mutated;
  (d) the email channel stays **strictly opt-in / default OFF** (no email without an
  explicit `message` `emailEnabled=true`) and reuses the existing pipeline (no new
  queue);
  (e) the rate-limit cannot be bypassed to spam and does not leak cross-tenant counts
  (`senderId` + `tenantId` scoped);
  (f) the S1–S3 dual-wall ABAC is **unchanged** (no widening via the new surfaces).
  **Winston must confirm** the new model + endpoints + permission + reused email
  pipeline + count-based rate-limit introduce **no new architectural decision**
  (consistent with ADR-001 modular monolith, ADR-002 tenant scoping with no new RLS,
  ADR-015 RBAC/ABAC, the E1-S3 `MeetingRequest`/E1-S4 digest precedents) → **no new
  ADR**, and the **ADR-019 real-time tripwire stays un-triggered**.
- **Operator pre-merge steps:** `prisma generate` + `prisma db push`; rebuild
  `packages/contracts`; re-run the permission seed (§8 AC11). Call these out in the PR.

## 12. Pre-mortem (failure modes → folded into §8)

- *"A non-participant (or co-guardian) reported / read a thread they shouldn't."* →
  §6a participant gate (404) + §8 AC2 + Sentinel (a).
- *"Double-tapping « Signaler » created duplicate reports / a P2002 crash."* → §6a
  idempotent open + `@@unique` + P2002 fallback + §8 AC2.
- *"The admin oversight leaked a child's message bodies (over-collection)."* → §6b/§6c
  metadata-only join (no `messages`) + §8 AC3 + Sentinel (b).
- *"A teacher/parent reached the moderation list."* → §6f `messaging.moderate` admin-only
  + §8 AC3/AC8 (403) + Sentinel.
- *"We emailed someone who never opted in (RGPD breach)."* → §6g default-OFF +
  `emailEnabledKeys` gate + §8 AC5 + Sentinel (d).
- *"Someone spammed hundreds of messages / notifications."* → §6d per-sender 429
  rate-limit + §8 AC4 + Sentinel (e).
- *"Moderation reads weren't audited (no governance trail)."* → §6b per-list
  append-only `conversation.moderation_read` row + §8 AC3/AC9 + Sentinel (c).
- *"Scope crept into thread-blocking / body-reading / a new queue / a new throttle dep
  / real-time."* → §9 non-goals + §8 AC10 + Winston.
- *"The schema/contract regen broke the typecheck gate."* → §8 AC11/AC12 (`db push` +
  contracts rebuild + seed are documented operator pre-merge steps).
- *"A cross-tenant report count inflated the rate-limit / oversight list."* → §6b/§6d
  `tenantId` scoping on every query + §8 AC9.
```
