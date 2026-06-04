# E2-S2 — Parent messages surface + alert-seeded threads · story spec

> **Author: John (BMAD PM).** Self-contained story for the E2 slice **S2**. A developer must be
> able to implement this from THIS file alone (plus the linked S1 code it builds on). Mode:
> `epic-slice`. Predecessor: **E2-S1** (Conversation spine + dual-wall ABAC + create/send) is
> **shipped** — its models, DTOs, `MessagingService`, `MessagingController`, the parent
> `ComposeForm`, and `compose-actions.ts` already exist. **Do NOT re-create S1.**
>
> **touchesUi: true · touchesBackend: true · touchesWorker: false · touchesSchema: false**
> (S1 already added the `Conversation`/`ConversationParticipant`/`ConversationMessage` models +
> the `message` `NotificationKind`. S2 adds **NO new column/model/enum** — it is read endpoints +
> the alertId-seed wiring + the parent inbox UI + the alert-CTA rewire.)
>
> **Risk tier: P1 · tags `[auth]`** (new read endpoints behind the same dual-wall ABAC; alert-seed
> access-widening is the load-bearing security concern — but no schema migration, so a notch below S1).

---

## 1. Intent (one sentence)

Give the parent a real `/parent/messages` inbox (thread list with unread badges → thread view with
paged history + reply → mark-read) backed by **new aggregate read endpoints**, wire the optional
`Conversation.alertId` **seed end-to-end** so an E1 alert opens an alert-seeded thread whose header
shows *why* the parent reached out, and **rewire the E1-S2 "En parler à l'enseignant" CTA** to open
that alert-seeded thread — all behind the existing dual-wall ABAC, append-only, no client N+1, no
new queue, mobile-first WCAG 2.2 AA.

## 2. Why (ties to the cahier + the epic)

- S1 shipped the *spine* (create + send + the dual-wall ABAC) but the only UI is a thin compose
  form. A parent **cannot see a sent thread, read a reply, or see unread state** — the loop is open.
- S2 closes the **parent half** of the messaging loop: inbox → thread → reply, the cahier's
  "turn information into action → **conversation**". The teacher half is S3.
- The **visionary hook** (alert-seeded threads) was deliberately stubbed in S1 (`alertId` is stored
  but `alertContext` is always `null`). S2 turns it on end-to-end so the teacher opens the thread
  and immediately sees the originating rule + subject + child + trend instead of a context-free
  "bonjour" — making E1→E2 one continuous alert→action→conversation loop.

## 3. Scope — what this slice delivers

### 3a. Backend (`apps/api`) — 4 new read/state endpoints + alertId-seed wiring

All live in the **existing** `messaging` module (`apps/api/src/modules/messaging/`). Reuse the
existing `MessagingService` + `MessagingController`; add methods/handlers, do **not** spawn a new
module. Every query is `tenant_id`-scoped; a cross-tenant / non-participant id resolves to **404**
(no existence leak), exactly like S1's `sendMessage`.

1. **`GET /api/v1/conversations`** — the caller's inbox (aggregate, **no client N+1**).
   - Role-aware: parent → `where parentId = me.id`; teacher → `where teacherId = me.id`. In S2 the
     caller is the parent (the teacher inbox UI is S3) but **implement the role-aware branch now**
     (S3 reuses this exact endpoint). Resolve the caller's participant role from the realm roles on
     the JWT (`parent` vs `teacher`); if the caller is neither, return `{ data: [], total: 0 }`.
   - Query params (Zod-validate): `status?` (one of the `ConversationStatus` enum; **default =
     active + read_only**, i.e. exclude `archived`/`blocked`), `limit?` (1–200, default 50),
     `offset?` (≥0, default 0). Order by `lastMessageAt desc nulls last, createdAt desc`.
   - Returns `{ data: ConversationDto[], total }`. **Unread + last-preview must be computed without
     N+1** — see §5 (one grouped message-count query keyed on `(conversationId)` + the caller's
     `lastReadAt`, plus the denormalised `topic`/`lastMessageAt` already on the row; the
     last-message preview reads one message per thread via a single `findMany` over the page's
     conversation ids ordered by `createdAt desc` + dedupe in JS, NOT a per-row query).
   - RBAC `messaging.read`.

2. **`GET /api/v1/conversations/:id`** — thread header DTO (`ConversationDto`).
   - Participant-only (caller must have a `ConversationParticipant` row, OR be the denormalised
     `parentId`/`teacherId`) — else **404**. RBAC `messaging.read`.
   - **Wires `alertContext`** (see §3b): when the thread has an `alertId`, populate the
     `alertContext` subset; else `null`.

3. **`GET /api/v1/conversations/:id/messages`** — paged messages, time order.
   - Participant-only (404 otherwise). RBAC `messaging.read`. Query params: `limit?` (1–200,
     default 50), `before?` (ISO date-time cursor → `createdAt < before`, the older page).
   - Returns `{ data: ConversationMessageDto[] }` ordered **oldest→newest within the page** (fetch
     `orderBy createdAt desc` + `take limit` + `[before]` cursor, then reverse in JS so the page
     renders chronologically). Index-covered by `(tenantId, conversationId, createdAt)` (exists from S1).

4. **`PATCH /api/v1/conversations/:id/read`** — mark the thread read for the calling participant.
   - Bumps the caller's `ConversationParticipant.lastReadAt = now()`. Idempotent. Participant-only
     (404 otherwise). RBAC `messaging.write`. Returns `{ ok: true, lastReadAt }`.
   - **No audit row** (read-receipts are not a security event; mirrors how E1 mark-read/ack do not
     audit a plain read). Messages stay immutable.

**Note:** `POST /conversations/:id/messages` (send/reply) **already exists** from S1 with the
ABAC re-check + `read_only` lapse handling — **do not re-implement it**; the parent thread view
calls it as-is for the parent's replies.

### 3b. `alertId` seed — turn it on end-to-end (the visionary hook)

S1 already: accepts + validates `alertId` on create (in-tenant + `alert.studentId === studentId`,
else 404/400), and stores it. S2 **exposes** it as a read-only `alertContext` subset and rewires the
CTA. **No new access path** — the seed never widens access:

- **On create (already done in S1, keep it):** the parent must independently pass guardianship on
  the request's `studentId` (the dual-wall ABAC) AND the alert must be in-tenant with
  `alert.studentId === studentId`. There is no separate "alert access" beyond guardianship — the
  alert is already visible to the parent because they guard the child. **Do not loosen this.**
- **On read (`GET /conversations/:id` + inbox):** when `conversation.alertId` is set, populate
  `alertContext = { alertId, code, title, subjectName }` — a **strict subset** of what the parent
  already sees on the alert card. Resolve it via the existing `alert` relation on `Conversation`
  (`alert: { select: { id, ruleCode/code, title, subject: { name } } }` — confirm the
  `AlertInstance` field names against the schema; the alert "code" is the rule-code chip and
  `title` is the human alert title, matching `AlertContextDto`). **Never** add fields beyond the
  `AlertContextDtoSchema` already declared in `packages/contracts/src/dto/conversation.ts`. If the
  alert was deleted (`alertId` SetNull → now null) → `alertContext = null`.
- Update `MessagingService.toConversationDto` (currently hard-codes `alertContext: null` with a
  `// deferred to S2` comment) to populate it from the joined `alert` relation. Apply the same in
  the new inbox + `getConversation` DTO builders (factor a shared private mapper so all three
  endpoints emit identical DTOs — **one** mapping, no drift).

### 3c. Frontend (`apps/web`) — parent inbox + thread view + CTA rewire

Under `apps/web/src/app/parent/messages/` (the page + `ComposeForm` + `compose-actions.ts` already
exist from S1 — **extend, do not delete** them).

- **Inbox (`page.tsx`):** replace the S1 "thin compose-only" body with a real **two-zone layout**:
  (1) a thread list, (2) the compose entry kept reachable via a "Nouveau message" affordance (reuse
  the existing `ComposeForm`). Fetch the inbox **server-side** via the new `GET /conversations`
  aggregate (`cache: 'no-store'`, the established pattern in the current `page.tsx`). Each row shows:
  child name + teacher name, `topic`/last-message preview, relative `lastMessageAt`, an **unread
  badge** when `unreadCount > 0`, and an **alert chip** (rule code) when `alertContext` is set.
  Empty inbox → reuse `@pilotage/ui` `EmptyState` (kind, non-stigmatising copy). Rows link to the
  thread view (`/parent/messages/[id]`).
- **Thread view (`apps/web/src/app/parent/messages/[id]/page.tsx`, new):** server-fetch the header
  (`GET /conversations/:id`) + the first page of messages (`GET /conversations/:id/messages`). Render
  the **alert-context header** when `alertContext` is set (rule chip + subject + child + the alert
  title, reusing the existing alert-chip visual vocabulary from `parent/recommendations`), the
  message list (bubbles aligned by `senderRole`, sender name + relative time), and a **reply
  composer** (a client component that POSTs to the existing `POST /conversations/:id/messages` via a
  `'use server'` action, then `revalidatePath` / router refresh — polling/revalidate only, **no
  websocket**, ADR-019 tripwire). When `status !== 'active'` (e.g. `read_only` from a lapsed teaching
  wall) the composer is **disabled** with a kind explanation ("Cette conversation est en lecture
  seule — l'enseignant·e ne suit plus actuellement votre enfant."). On mount / after fetch, fire a
  `PATCH /conversations/:id/read` (a `'use server'` action) so the unread badge clears. Older history
  loads via a "Charger les messages précédents" control using the `before` cursor.
- **CTA rewire (`recommendations/AlertNextSteps.tsx`):** the existing "En parler à l'enseignant"
  block currently only fires `requestMeetingIntentAction` (the E1-S3 meeting intent). S2 **adds** a
  sibling deep-link — **"Discuter avec l'enseignant·e"** — that navigates to
  `/parent/messages?alertId={alertId}&studentId={studentId}` (and `subjectId`/`subjectName` if
  present). This opens the parent messages compose **pre-seeded** with the alert: the existing
  `ComposeForm` already accepts `initialStudentId` via `?studentId=`; extend it to also read
  `?alertId=` (+ optional `subjectId`/`subjectName`) from the URL, pre-fill the body
  (`Bonjour, je vous écris au sujet de l'alerte « {title} »…` — pass the alert title through the
  query string, URL-encoded, OR resolve it server-side), and forward `alertId`/`subjectId` to the
  already-existing `sendFirstMessageAction` (which already accepts `alertId`/`subjectId`). **The
  meeting-intent CTA stays** (it complements, never replaces — see spec §6 non-goal "Replacing
  `MeetingRequest`"); S2 adds the messaging path **alongside** it. Prefer a calm two-action layout:
  "Discuter avec l'enseignant·e" (opens the thread) + the existing "Demander un point" (meeting
  intent), both ≤3 within the panel's step cap.
- **Nav unread badge:** the parent sidebar already has a `messages` entry
  (`apps/web/src/components/shell/sidebar-items.ts`, `key: 'messages'`). Optionally surface an
  aggregate unread count on it (sum of `unreadCount` across the inbox) if the shell already supports
  a `badge`/count slot on `SidebarItemDef` — **check `@pilotage/ui` `SidebarItemDef` first; if there
  is no existing badge slot, DO NOT invent a new shared-UI API for it this slice** (that would be a
  DS-Guardian change + possible ADR drift). The page-level unread badges on inbox rows are the
  required deliverable; the nav-count is best-effort only if the primitive already exists.

### 3d. Contracts (`packages/contracts`)

The DTOs are **already declared** (`ConversationDto` with `alertContext`, `ConversationMessageDto`,
`AlertContextDto`, `EligibleTeacherDto`, request schemas). S2 may **add** small read-query schemas
if helpful (e.g. an inbox `status/limit/offset` query schema, a messages `limit/before` query
schema) — additive only, mirror the `meeting-request.ts` style. **Do not retype or remove** any
existing field. Re-export anything new from `packages/contracts/src/index.ts` (or the dto barrel).

## 4. Out of scope (explicit non-goals for THIS slice)

- ❌ Teacher inbox UI (`/teacher/messages`) — that is **S3** (though the role-aware `GET
  /conversations` branch is implemented now so S3 only adds UI).
- ❌ Report / moderation / admin oversight / rate-limit / email channel — **S4**.
- ❌ Any new Prisma model/column/enum or migration — S2 is **schema-free** (S1 already migrated).
- ❌ Websockets / SSE / typing indicators — polling/`revalidatePath` only (ADR-019 tripwire; adding
  a real-time transport is a **blocking** Winston finding without a new ADR).
- ❌ Message edit/delete, attachments, group threads, teacher cold-start — epic-level non-goals (spec §6).
- ❌ Removing or weakening the E1 meeting-intent CTA — S2 **adds** the messaging path alongside it.

## 5. Performance / aggregate rules (cahier <2 s budget — NON-NEGOTIABLE)

- **Inbox = no client N+1 and no server N+1.** For a page of N conversations:
  - one `findMany` over `Conversation` (denormalised `topic`/`lastMessageAt`/`status` — no message
    join for ordering),
  - one `groupBy`/`count` query for unread (`ConversationMessage` where `conversationId IN (...)` and
    `senderId != me` and `createdAt > lastReadAt`), resolving the caller's per-thread `lastReadAt`
    from one `ConversationParticipant.findMany` over the same ids,
  - one `findMany` for last-message previews over the same ids (ordered `createdAt desc`, deduped to
    one-per-conversation in JS) — **OR** reuse the denormalised `topic` as the preview to skip even
    this query (acceptable for S2; document the choice).
  → at most **3 bounded queries per inbox load**, independent of N. Never `await` inside a `.map`.
- **Thread view** pages messages by the `(tenantId, conversationId, createdAt)` index (exists). Cap
  `limit ≤ 200`. The `before` cursor keeps the query index-covered.
- All reads are **server components / server actions** (the established parent-portal pattern) — the
  client never holds a token or N+1s.

## 6. Security / ABAC invariants (the `[auth]` core — re-verified by Sentinel)

1. **Tenant scope on every query** (`where: { tenantId: me.tenantId }`); a cross-tenant id → **404**.
2. **Participant-only reads.** `GET /:id`, `GET /:id/messages`, `PATCH /:id/read` all require the
   caller to be a participant of the thread (parent or teacher side) → **404** otherwise (no
   existence leak). The inbox only ever returns the caller's own threads (`parentId`/`teacherId = me`).
3. **`alertId` never widens access.** `alertContext` is exposed **only** for threads the caller
   already participates in, and is a strict subset (`alertId, code, title, subjectName`) of the
   already-parent-visible alert card. The create-time guard (in-tenant + `alert.studentId ===
   studentId` + guardianship on the student) is unchanged from S1 — **do not loosen it**. No
   endpoint takes an `alertId` and returns alert data outside a thread the caller owns.
4. **Send ABAC unchanged.** Reply uses the S1 `POST /:id/messages` which already re-checks the
   dual wall and flips a lapsed thread to `read_only` (history preserved, send → 403). The thread
   view must render that `read_only` state correctly (disabled composer).
5. **Append-only / immutable.** Messages are never edited or deleted. `PATCH /:id/read` only bumps
   `lastReadAt` (no message mutation). No new destructive path.
6. **RBAC permissions:** reuse the S1 `messaging.read` / `messaging.write` seeds (parent + teacher).
   **No new permission** in S2 (`messaging.moderate` is S4). Verify the seed already grants
   `messaging.read|write` to `parent`; if not, that is an S1 gap to flag, not a new S2 grant.

## 7. Accessibility (Sally / A11y reviewer — WCAG 2.2 AA, mobile-first)

- Inbox rows are real links (`<Link>`), keyboard-focusable, ≥44px target, `focus-visible` ring;
  unread badge has an `sr-only` "non lus" label, the alert chip an accessible name.
- Thread view: message list in reading order; each bubble announces sender + time; the composer is a
  labelled `textarea` + submit (mirror the S1 `ComposeForm` grammar — `aria-live="polite"` status,
  rose fail-closed error, char counter). `read_only` disabled state is announced, not just visual.
- Reduced-motion-safe hovers; 4.5:1 text contrast on tinted cards (reuse the recommendations
  palette). Mobile: the inbox + thread are single-column, the parent answers in <2 s.

## 8. Acceptance criteria (testable)

1. **AC1 — Inbox aggregate.** `GET /api/v1/conversations` as a parent returns the parent's threads
   (newest first), with correct `unreadCount` and `lastMessagePreview`, in **≤3 bounded queries**
   (no N+1). `status` filter defaults to active+read_only (archived/blocked excluded).
2. **AC2 — Thread header + paged messages.** `GET /:id` returns the `ConversationDto` (participant
   sees it; non-participant → 404). `GET /:id/messages` pages chronologically with the `before`
   cursor; `limit` capped at 200.
3. **AC3 — alertId seed end-to-end (no widening).** A thread created with a valid `alertId` exposes
   `alertContext = { alertId, code, title, subjectName }` on `GET /:id` + inbox, and that subset is
   `≤` what the parent already sees on the alert card. A thread without `alertId` → `alertContext =
   null`. There is **no** endpoint that returns alert data for a thread the caller does not
   participate in. (Spec §5 AC3 fully satisfied.)
4. **AC4 — mark-read math.** `PATCH /:id/read` bumps the caller's `lastReadAt`; afterwards the
   thread's `unreadCount` is 0 for that caller and the inbox badge clears. Idempotent. A reply from
   the counterpart makes `unreadCount` > 0 again. (Spec §5 AC4.)
5. **AC5 — read_only thread.** When the teaching wall has lapsed (thread `status = read_only`), the
   parent thread view renders the disabled composer + explanation, and a `POST /:id/messages`
   attempt 403s (S1 behavior, surfaced kindly in the UI).
6. **AC6 — CTA rewire.** The recommendations "En parler à l'enseignant" panel now offers a
   "Discuter avec l'enseignant·e" action that deep-links to `/parent/messages?alertId=…&studentId=…`;
   landing there pre-seeds the compose with the alert (pre-filled body + forwarded `alertId`), and
   sending creates an **alert-seeded** thread whose header shows the alert context. The E1
   meeting-intent CTA still works (not removed).
7. **AC7 — tenant + immutability + 404-before-403.** Every new endpoint is tenant-scoped; a
   cross-tenant or non-participant id → 404; messages remain immutable; no new audit-bypassing path.
8. **AC8 — reuse + a11y.** UI uses `@pilotage/ui` primitives (`EmptyState`, `PageHeader`, `Button`,
   `Label`, the recommendations alert-chip vocabulary); the parent inbox + thread are mobile-first
   WCAG 2.2 AA; no new shared-UI API invented unless it genuinely improves consistency.
9. **AC9 — gate.** `pnpm typecheck` passes (Murat); `git diff --check` clean; no websocket/SSE
   added (no ADR-019 needed); `prisma generate`/`db push` **not** required (S2 is schema-free).

## 9. Targeted test (Murat — the single most valuable test)

A `messaging.service.spec.ts` (extend the existing S1 spec) case proving **AC3 + AC1 together**:
seed two threads for the parent — one with a valid `alertId`, one without — plus a thread for a
**different** parent (same tenant) and a thread in a **different tenant**. Assert: (a) the inbox
returns exactly the caller's two threads (not the other parent's, not the other tenant's); (b) the
alert-seeded thread's DTO carries `alertContext = { alertId, code, title, subjectName }` and the
non-seeded one carries `alertContext = null`; (c) `getConversation` on the other parent's / other
tenant's thread id throws `NotFoundException` (404-before-403, no existence leak); (d) after
`markRead`, the seeded thread's `unreadCount` is 0. Plus a controller-level assertion that the three
GET routes + the PATCH route require `messaging.read`/`messaging.write` respectively.

## 10. Files (anticipated touch list)

**Backend (`apps/api`)**
- `apps/api/src/modules/messaging/messaging.service.ts` — add `listConversations`, `getConversation`,
  `listMessages`, `markRead`; refactor `toConversationDto` to a shared mapper that **populates
  `alertContext`** from the joined `alert` relation (remove the S1 `// deferred to S2` stub).
- `apps/api/src/modules/messaging/messaging.controller.ts` — add `GET /conversations`,
  `GET /conversations/:id`, `GET /conversations/:id/messages`, `PATCH /conversations/:id/read`
  (RBAC decorators; Zod-validate query params).
- `apps/api/src/modules/messaging/messaging.service.spec.ts` — the §9 test.

**Contracts (`packages/contracts`)** — additive only
- `packages/contracts/src/dto/conversation.ts` — (optional) add inbox/messages query schemas;
  the response DTOs already exist. Re-export from the barrel/`index.ts` if new symbols are added.

**Frontend (`apps/web`)**
- `apps/web/src/app/parent/messages/page.tsx` — inbox list + "Nouveau message" entry (extend, keep
  `ComposeForm`).
- `apps/web/src/app/parent/messages/[id]/page.tsx` — **new** thread view (server fetch header +
  messages, alert-context header, message list, reply composer, read_only handling).
- `apps/web/src/app/parent/messages/ThreadReply.tsx` (or similar, **new**) — client reply composer
  (`'use client'`) calling a `'use server'` send action + `revalidatePath`.
- `apps/web/src/app/parent/messages/messages-actions.ts` (**new**) or extend
  `compose-actions.ts` — `'use server'` wrappers for send-reply + mark-read (+ load-thread if not
  server-fetched inline). Reuse the shared `api`/`apiResultFromError` helpers.
- `apps/web/src/app/parent/messages/ComposeForm.tsx` — accept `?alertId`/`subjectId`/(`alertTitle`)
  from the URL, pre-fill the body, forward `alertId`/`subjectId` to `sendFirstMessageAction`
  (already supported by the action).
- `apps/web/src/app/parent/recommendations/AlertNextSteps.tsx` — add the "Discuter avec
  l'enseignant·e" deep-link action **alongside** the existing meeting-intent CTA.
- `apps/web/src/components/shell/sidebar-items.ts` — (best-effort, only if the existing
  `SidebarItemDef` already supports a badge slot) surface an aggregate unread count on the parent
  `messages` item; otherwise leave the nav untouched.

## 11. Implementation notes / gotchas (carry-forward)

- **Reuse the S1 dual-wall ABAC verbatim for replies** — do NOT add a second ABAC code path; the
  reply composer calls the existing `POST /:id/messages`. S2 adds **reads + mark-read**, which are
  participant-gated, not wall-gated (a parent who still guards the child reads history even if the
  teacher lapsed — only *sending* is blocked on a `read_only` thread).
- **Confirm `AlertInstance` field names** before wiring `alertContext` (the DTO wants `code` =
  rule-code chip + `title`; check the schema for the exact field — it may be `ruleCode`/`code` and a
  `title`/`label`, and the subject via `subject: { name }` or a denormalised `subjectName`). The
  `AlertContextDtoSchema` shape is fixed; map onto it.
- **One DTO mapper, three callers** — inbox, `getConversation`, and the create/reuse response must
  emit byte-identical `ConversationDto`s (same `alertContext`, same `unreadCount` semantics). Factor
  it once to avoid drift (Drift reviewer will flag divergence).
- **No new BullMQ queue, no email** — reply notification reuses the S1 `notifyCounterpart`
  in-app fan-out (already wired in `POST /:id/messages`). Email is S4.
- **Pre-merge operator steps:** NONE schema-wise (S2 is additive-code-only). The `messaging.read|
  write` permission seed already landed in S1 — no re-seed needed unless S1's seed is found to omit
  `parent`.
