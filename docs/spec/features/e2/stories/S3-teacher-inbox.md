# E2-S3 — Teacher inbox (separated from announcements) + reply · story spec

> **Self-contained slice spec** (John, BMAD PM). A developer implements this from this
> file alone. Predecessors: **E2-S1** shipped the Conversation models + dual-wall ABAC
> + create/send spine; **E2-S2** shipped the parent `/parent/messages` inbox + thread +
> alert-seeded threads + the 4 aggregate read/state endpoints. This slice is the
> **teacher mirror** of S2 — almost entirely **UI** (the backend is already role-aware).
>
> **Risk tier: P1 · tags `[auth]` · ~M · `touchesBackend` = true (verification + nav badge endpoint reuse only, NO new endpoint, NO schema), `touchesUi` = true, `touchesWorker` = false.**

---

## 1. Intent (one sentence)

Give teachers a `/teacher/conversations` inbox of parent-initiated threads (role-scoped to
`teacherId = me`, kept **distinct** from the existing `/teacher/messages` announcements
surface), with a thread view, append-only reply via the existing
`POST /api/v1/conversations/:id/messages` (ABAC re-checked; a `read_only` thread disables the
composer and 403s on send), mark-read, two-sided read receipts, parent-notified-on-reply (already
wired in S1), and the alert-context header surfaced to the teacher when the thread is alert-seeded.

## 2. Why this slice (ties to spec §5 AC5)

S2 gave the parent a real inbox; the teacher still has **no way to see or answer** parent
messages — the parent-side `notifyCounterpart` already drops an in-app `message` notification
linking to `/teacher/messages`, but that route is the **announcements** surface, not a
conversation inbox. This slice closes the loop: the teacher opens their parent-conversation inbox,
reads the (optionally alert-seeded) thread, and **replies** — `alert → action → conversation` is
now bidirectional. It is the natural mirror of S2 and reuses 100% of the S1/S2 API.

## 3. The backend is ALREADY DONE — verify, do not rebuild

The S1/S2 messaging module is **role-aware and complete** for the teacher direction. Read
`apps/api/src/modules/messaging/messaging.service.ts` + `.controller.ts`:

- **`GET /api/v1/conversations`** (`listConversations`) is already role-aware: a caller with the
  `teacher` realm role is scoped to `teacherId = me.id` (controller derives `role` from
  `jwt.realm_access.roles`; service applies `{ teacherId: args.me.id }`). A teacher sees **only
  their own** threads, never other teachers' — this is the spec's "teacher inbox scoping" AC. Returns
  the same `ConversationInboxResponse` (`{ data: ConversationDto[]; total }`) with server-computed
  `unreadCount` per thread (sender ≠ me) — **no client N+1**.
- **`GET /api/v1/conversations/:id`** (`getConversation`) — participant-only header DTO. A teacher
  who is a participant gets the `ConversationDto` (incl. `alertContext` strict subset, re-checked at
  read time, `null` on student mismatch); a non-participant / cross-tenant id → **404**.
- **`GET /api/v1/conversations/:id/messages`** (`listMessages`) — participant-only paged messages
  (oldest→newest, `before` cursor, `limit` 1..200), plus `counterpartLastReadAt` (the **parent's**
  read anchor, for the teacher's "Vu/Envoyé" receipt). Already direction-agnostic.
- **`PATCH /api/v1/conversations/:id/read`** (`markRead`) — bumps the **caller's own** participant
  `lastReadAt`. Idempotent, participant-only, 404 otherwise. Works for the teacher unchanged.
- **`POST /api/v1/conversations/:id/messages`** (`sendMessage`) — append-only reply. ABAC is
  re-checked on EVERY send for **both directions**: the teaching wall (`isTeacherOfStudent`) is a
  property of the thread and is re-checked symmetrically, so a teacher who has stopped teaching the
  child gets a **403** and the thread flips to `read_only` (history preserved). `senderRole` is read
  from the caller's participant row (= `'teacher'`), and the **parent** is notified via
  `notifyCounterpart` with `portalLink: '/parent/messages'` (already wired in S1).
- **Permissions:** `messaging.read` / `messaging.write` are already seeded to the teacher role
  (S1). No new permission.

**Backend work for THIS slice is limited to verification + one tiny non-schema touch:**
1. **Fix the teacher notification deep-link** so the in-app `message` notification points at the new
   teacher conversation inbox route, not the announcements surface. In
   `apps/api/src/modules/messaging/messaging.service.ts`, the two call sites that pass
   `portalLink: '/teacher/messages'` (in `createConversation`'s `notifyCounterpart` call, and in
   `sendMessage`'s `notifyCounterpart` for the parent→teacher direction) must be updated to the new
   teacher route chosen in §4 (`/teacher/conversations`). This is a **string change only** — no
   schema, no new endpoint, no signature change. Grep `'/teacher/messages'` in that file.
2. **Confirm** (do not add) the teacher-scoping test exists or add a targeted one (see §7).

**Do NOT:** add a schema field, add a queue, add a websocket/SSE (ADR-019 tripwire), add a new
endpoint, change `listConversations` scoping, or touch the announcements (`/teacher/messages`)
surface.

## 4. Route decision — separation from announcements (the load-bearing UX call)

`/teacher/messages` is **already taken** by the teacher **Announcements** surface (label
"Messagerie" in `apps/web/src/components/shell/sidebar-items.ts` → `teacherSidebarItems`, the
`{ key: 'messages', … href: '/teacher/messages' }` item; the page reads
`/api/v1/announcements?mine=true`). The spec mandates the parent-conversation inbox be **kept
distinct from announcements**.

**Decision: the teacher conversation inbox lives at `/teacher/conversations`** (NOT under
`/teacher/messages`). New sidebar item, distinct label **"Conversations parents"**, distinct icon
(`MessagesSquare` from lucide — the announcements item keeps `MessageSquare` / "Messagerie").
Routes:
- `apps/web/src/app/teacher/conversations/page.tsx` — inbox (thread list).
- `apps/web/src/app/teacher/conversations/[id]/page.tsx` — thread view + reply.
- Two client/server helpers colocated (see §5). **No `/new` compose** — teachers cannot cold-start a
  thread (spec §6 non-goal); the inbox + thread only.

This keeps the existing announcements feature fully intact and gives the teacher two clearly
labelled surfaces: **Messagerie** (broadcast announcements, unchanged) and **Conversations parents**
(1:1 threads, new).

## 5. UI to build (mirror S2's parent surface)

All under `apps/web/src/app/teacher/conversations/`. **Reuse `@pilotage/ui` + the S2 components'
shape** — the cleanest path is to port the parent `ThreadList` / thread page / `ThreadReply` /
server actions with the teacher's identity flipped (the counterpart is the **parent**, "self" is
`senderRole === 'teacher'`). Mobile-first, WCAG 2.2 AA, premium/colorful/animated.

### 5.1 `page.tsx` (server component — inbox)
- `export const dynamic = 'force-dynamic'` (polling/revalidation only — no websocket).
- Server-fetch the aggregate: `api<ConversationInboxResponse>('/api/v1/conversations', { cache: 'no-store' })`.
  ONE call (no N+1). On `ApiError` → a kind rose `role="alert"` reload banner (mirror S2).
- `PortalShell portal="teacher"` + `PageHeader` breadcrumb `[{ Tableau de bord → /teacher/dashboard }, { Conversations }]`,
  title **"Conversations parents"**, subtitle e.g. *"Les familles de vos classes peuvent vous écrire ici — distinct de vos annonces."*
- An intro card (mirror S2's `MessagesSquare` lead card) explaining the surface is for **parent-initiated**
  1:1 threads, kind/non-stigmatising tone, and that teachers reach families at large via **Annonces**.
- Empty state (`@pilotage/ui` `EmptyState`, `MessagesSquare`, tone violet): *"Aucune conversation
  pour le moment — les parents des élèves que vous suivez peuvent démarrer un échange ici."*
  **No action button** (teachers can't start threads).
- A `TeacherThreadList` (port of parent `ThreadList`): each row is a `Link` to
  `/teacher/conversations/[id]`. **Flip the identity**: leading avatar/initials + bold line 1 = the
  **parent name** (`c.parentName`); line 2 = *"Au sujet de {c.studentName}"* + the same chips (amber
  "Alerte" when `c.alertContext`, slate "Lecture seule" when `c.status === 'read_only'`); unread cue =
  the same 3 non-colour cues (left accent bar + bold name + count pill, WCAG 1.4.1);
  `aria-label` = *"Conversation avec {parentName} au sujet de {studentName}[, N non lus]"*. Keep the
  violet messaging accent.

### 5.2 `[id]/page.tsx` (server component — thread view)
- Port the parent `[id]/page.tsx`. Fetch header (`GET /conversations/:id`) — on `ApiError` →
  `notFound()` — then `GET /conversations/:id/messages?limit=50` (+ optional `before` cursor for
  "Charger les messages précédents"). `dynamic = 'force-dynamic'`.
- **Flip "self"**: in the teacher portal, **self = `m.senderRole === 'teacher'`** (the parent's
  bubbles render on the left with `m.senderName`; the teacher's own on the right). The read receipt
  ("Vu/Envoyé") rides the teacher's **last own** message and compares `counterpartLastReadAt` (= the
  **parent's** `lastReadAt`, already returned by `listMessages`).
- **Identity block / breadcrumb**: title = `header.parentName`, subtitle = *"Au sujet de {header.studentName}"*,
  leading avatar = parent initials. Breadcrumb leaf under "Conversations parents" → `/teacher/conversations`.
- **Alert-context header** (spec §5 AC5 + the visionary hook): when `header.alertContext != null`,
  render the SAME amber `role="note"` card S2 uses, surfacing the strict read-only subset
  (`{ title, code, subjectName }` + child name) so the teacher **immediately sees WHY** the parent
  reached out. The "Voir l'alerte" deep-link is **parent-only** in S2 (it links to
  `/parent/recommendations`); for the teacher **omit the deep-link** (the teacher has no parent
  recommendations surface) — show the context text only. Never expose more than the strict subset.
- Message stream `role="log"`, day separators, `whitespace-pre-wrap break-words` (inert text — NO
  `dangerouslySetInnerHTML`; a hostile body must never render as HTML). Reuse the S2 helpers
  (`initials`, `daySeparator`, `dayKey`, `timeLabel`) — copy them into the teacher page.
- Render `<TeacherThreadReply conversationId={header.id} status={header.status} />` at the bottom.

### 5.3 `TeacherThreadReply.tsx` (`'use client'`) + `conversation-actions.ts` (`'use server'`)
- Port the parent `ThreadReply` + `messages-actions.ts` verbatim, changing only the
  **revalidate paths** to the teacher routes (`/teacher/conversations/${id}` + `/teacher/conversations`)
  and the API calls stay identical (`POST /api/v1/conversations/:id/messages`,
  `PATCH /api/v1/conversations/:id/read`).
- **Mark-read on mount** (`useEffect` once, fire-and-forget `PATCH …/read`) so the inbox row + nav
  badge clear.
- **Reply** via `useTransition` → `replyToThreadAction`. On a 403 (lapsed teaching wall) flip the
  composer to the calm `read_only` banner (mirror S2's `lapsed` self-heal + the regex match).
- When `status !== 'active'` (e.g. `read_only`), **replace** the composer with the calm
  non-stigmatising lock banner (no dead disabled control) — reuse S2's exact French copy. This is the
  **reply-disabled** requirement for read-only threads (the server still 403s as the authoritative gate).

### 5.4 Sidebar nav entry + unread badge
- Add to `teacherSidebarItems` (`apps/web/src/components/shell/sidebar-items.ts`) a new item AFTER
  the existing `messages` (announcements) item:
  ```ts
  {
    key: 'conversations',
    icon: MessagesSquare,            // import MessagesSquare into the icon list
    label: 'Conversations parents',
    href: '/teacher/conversations',
    matches: /^\/teacher\/conversations(\/|$)/,   // stay active on the thread subroute
  }
  ```
  Keep the existing `{ key: 'messages', … '/teacher/messages' }` (Annonces) untouched, so the two
  surfaces are visually + structurally separate (the spec's core requirement). Import
  `MessagesSquare` from lucide-react in `sidebar-items.ts` (and re-export it if the file re-exports
  icons for per-page overrides).
- **Unread badge (optional, mirror parent):** if the parent sidebar already shows a messages unread
  badge, mirror that exact mechanism for the teacher `conversations` item (same source — the
  aggregate inbox's summed `unreadCount`). If the parent does NOT yet have a live badge, **do not
  invent one** for the teacher — a static nav item is acceptable for this slice (badge is a nice-to-have,
  not an AC). Do not add a new endpoint just for the badge.

## 6. Contracts / shared types

**None new.** Reuse the existing `@pilotage/contracts` exports already consumed by S2:
`ConversationDto`, `ConversationInboxResponse`, `ConversationMessageDto`, `ConversationMessagePage`.
No `packages/contracts` change → **no contracts rebuild step** for this slice.

## 7. Tests (Murat — targeted, P1)

In `apps/api/src/modules/messaging/messaging.service.spec.ts` (or `.controller.spec.ts`), confirm /
add:
1. **Teacher inbox scoping** — `listConversations({ role: 'teacher', me })` returns ONLY threads
   where `teacherId === me.id`; a second teacher's threads are absent. (The single most valuable
   test — proves no cross-teacher leak.)
2. **Teacher reply ABAC** — `sendMessage` as the teacher participant on an `active` thread succeeds
   and notifies the **parent**; on a thread whose teaching wall has lapsed it 403s and flips the
   thread to `read_only` (already covered for the parent direction — assert it holds for the teacher
   sender too, since the wall is symmetric).
3. **Read-only thread → reply 403** — `sendMessage` on a `status !== 'active'` thread throws
   `ForbiddenException` ("read-only"), even if both walls otherwise pass.
Reuse the existing spec's Prisma mock harness; do not stand up a DB.

## 8. Acceptance criteria (this slice)

1. **Teacher inbox at `/teacher/conversations`**, kept **distinct** from the `/teacher/messages`
   announcements surface (separate route, separate sidebar item "Conversations parents" vs
   "Messagerie"); the announcements feature is unchanged.
2. **Role-scoped:** a teacher sees **only** parent threads where `teacherId = me` (never other
   teachers'); served by the existing role-aware `GET /api/v1/conversations` (ONE aggregate call, no
   client N+1).
3. **Thread view** shows the parent identity, paged history (oldest→newest, "load previous"), and —
   when the thread is alert-seeded — the **alert-context header** (strict read-only subset) so the
   teacher sees WHY the parent wrote.
4. **Reply** via `POST /api/v1/conversations/:id/messages` (append-only, ABAC re-checked); the
   **parent is notified** on reply (existing S1 fan-out).
5. **Read-only thread → reply disabled** (calm non-stigmatising banner, no dead control) and the
   server **403s** on a send attempt; a lapsed teaching wall self-heals the composer to read-only.
6. **Mark-read** fires on thread open (`PATCH …/read`, caller's own anchor); **two-sided read
   receipts** show on both portals ("Vu/Envoyé").
7. The teacher in-app `message` notification deep-links to `/teacher/conversations` (the
   `notifyCounterpart` `portalLink` strings updated in `messaging.service.ts`), not the announcements
   surface.
8. **Invariants:** every query `tenant_id`-scoped (already in the service); messages immutable;
   no schema change; no new queue/endpoint; no websocket (ADR-019 un-triggered); `whitespace-pre-wrap`
   inert message bodies (XSS-safe); `@pilotage/ui` primitives reused; mobile-first WCAG 2.2 AA.
9. `pnpm typecheck` passes (Murat gate); no `git diff --check` errors.

## 9. Non-goals (this slice — see spec §6)

Teacher-initiated cold-start (no `/new` compose for teachers) · attachments · real-time/typing ·
message edit/delete · admin moderation/report (S4) · email channel (S4) · touching the
`/teacher/messages` announcements surface.

## 10. Pre-merge operator steps

**None special.** No schema (`db push` not needed), no contracts rebuild (no new exports), no
permission re-seed (`messaging.*` already seeded in S1). Standard `pnpm typecheck` (Murat) + the
orchestrator build.
