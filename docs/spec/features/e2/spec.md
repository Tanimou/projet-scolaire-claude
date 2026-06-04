# E2 — Parent ↔ Teacher Messaging (Conversations) · spec

> **Epic spec-kit.** Written on E2's **epic-spec run** (BMAD spec-driven). Author: John (PM)
> + Winston (Architect, data-model + contracts). Implemented **one vertical slice per run**
> from [`tasks.md`](./tasks.md). Predecessor: **E1 — Parent Alert Action Loop** is `shipped`
> (S1–S4). E2 is the natural continuation: E1-S2 deliberately stubbed the "En parler à
> l'enseignant" CTA to **open E2 messaging once available** (else fall back to a `MeetingRequest`).
>
> **Status: `proposed` → in-progress on S1.** This is the first epic to ship a *bidirectional*
> parent→teacher channel; today only **teacher→family `Announcement`s** exist (one-way broadcast).

---

## 1. Vision (one paragraph)

Turn the alert→action loop into a **continuous conversation**. Today a worried parent can
*see* an explainable alert (E1) and *flag* an intent to talk (the `MeetingRequest` action
center), but there is **no two-way channel** — the parent cannot actually message the teacher,
and the teacher cannot reply. E2 adds **Conversations**: a parent opens a thread with a teacher
**currently teaching their child**, both sides exchange messages, read-receipts show who has
seen what, and — the visionary hook — **a conversation can be seeded by an E1 alert** so the
teacher immediately sees *why* the parent reached out (rule + subject + child + trend), instead
of a context-free "bonjour". This closes the cahier's "turn information into action" promise:
alert → action → **conversation**, one unbroken loop. The channel is **kind, non-stigmatising,
and never widens a parent's data access** beyond the existing guardianship wall.

## 2. Why (ties to the cahier de charges)

- The cahier's defining promise — *every alert leads to a next step (contact the teacher…)* —
  is only half-built. E1 lets a parent *express* intent; E2 lets them **actually talk**.
- The cahier names a future **Messagerie** module. E2 is its MVP: scoped, audited, governed,
  built **inside the modular monolith** (ADR-001) — no premature microservice.
- **Asymmetry today:** `Announcement` is teacher→family broadcast only. There is no
  parent→teacher path. E2 fills the exact gap the roadmap audit calls out ("messaging ~25%;
  no `Conversation` model yet").
- **RGPD / minimal access** is non-negotiable (children's data): a parent may message **only**
  a teacher who **currently** teaches their child, and the thread never exposes more than the
  child's name + the seeding alert's already-visible facts.

## 3. Users & roles

| Actor | Auth | Can do |
|---|---|---|
| **Parent** | authenticated, holds an **active `Guardianship`** on the child | Start a thread with an eligible teacher of their child; send/read messages; see read-receipts; (optional) seed a thread from an E1 alert. |
| **Teacher** | realm role `teacher`, **current** `TeachingAssignment` on the child's class | See parent-initiated threads in an inbox (separate from announcements); reply; mark-read. **Cannot cold-start** a thread in the MVP (teachers already have `Announcement` for outreach — keeps scope tight + avoids unsolicited parent contact). |
| **School-admin / super-admin** | realm role `school_admin`/`super_admin` | Oversight: read threads for safety/moderation (S4), action reports, never impersonate. |

**Eligibility rule (the ABAC core).** A parent `P` may converse with a teacher `T` about
child `C` **iff** `guardianship(P, C, status=active)` **∩** `T currently teaches C` —
i.e. there exists a **current-academic-year** `TeachingAssignment(T.teacherProfile, C.currentClassSection, anySubject)`.
This is the intersection of the **guardianship wall** (E1's `StudentAccessService`) and the
**teaching wall**. Both must hold at **send time**, not just at thread-open time (a teacher who
stops teaching the child can no longer be messaged — re-checked on every send; see §6/S1).

## 4. Primary scenarios

**Scenario A — Parent starts a conversation (generic).**
1. Parent opens `/parent/messages` → "Nouveau message" → picks one of *their child's current
   teachers* (the list is server-filtered to eligible teachers only) → optional subject context
   → types a first message → send.
2. Backend verifies guardianship ∩ teaching at send time, creates a `Conversation`
   (participants = parent + teacher, scoped to the child) + the first `ConversationMessage`,
   and notifies the teacher (in-app `Notification`, reusing the E1 fan-out).

**Scenario B — Alert-seeded conversation (the visionary hook).**
1. On an E1 alert card, the parent clicks **« En parler à l'enseignant »** (the CTA E1-S2
   stubbed). Instead of (or in addition to) a `MeetingRequest`, it now **opens a Conversation
   pre-seeded with `alertId`**.
2. The thread header shows the originating alert context — rule chip + subject + child + the
   one-line trend — so the teacher opens the thread and **immediately sees WHY**. The first
   message can be prefilled ("Bonjour, je vous écris au sujet de l'alerte « {title} »…").
3. `alertId` is an **optional seed** on `Conversation`. It **never widens access**: the alert
   must already be visible to the parent (guardianship) and concern the child the thread is
   scoped to; it is stored for context only, behind the same wall.

**Scenario C — Teacher replies.**
1. Teacher opens `/teacher/messages` → an inbox of **parent conversations** kept **separate
   from `Announcement`s** → opens a thread → sees the (optional) alert context + history →
   replies → parent is notified; read-receipts update.

**Scenario D — Moderation / safety (S4).**
1. Either party can **report** a thread; an admin oversight surface lists reported/active
   threads; **rate-limiting** prevents spam; copy stays **non-stigmatising**.

## 5. Acceptance criteria (epic-level — sliced in tasks.md)

1. **Models exist & validate.** `Conversation`, `ConversationParticipant`, `ConversationMessage`
   (+ enums) in `schema.prisma`, all relations two-ended (Prisma validates), every table
   `tenant_id`-scoped with `tenant_id`-first indexes, applied via `prisma db push` (no SQL
   `migrations/` folder — repo convention). See [`data-model.md`](./data-model.md).
2. **ABAC eligibility enforced at send time.** A parent can only create/post in a thread with a
   teacher who **currently** teaches their child (guardianship ∩ teaching). A parent acting on a
   non-guarded child → **403**; cross-tenant id → **404**; a teacher who no longer teaches the
   child → **403** on send (thread becomes read-only, not deleted).
3. **No access widening via `alertId`.** Seeding a thread from an alert requires the parent to
   already pass guardianship on that alert's student; the alert context exposed is a strict
   subset of what the parent already sees on the alert card.
4. **Parent thread list + view + compose** at `/parent/messages` (aggregate endpoint, no client
   N+1), with unread badges; teacher notified on a new message.
5. **Teacher inbox** at `/teacher/messages`, parent conversations **separated from announcements**,
   reply + mark-read; read-receipts visible both sides.
6. **Moderation/safety:** report a thread, admin oversight read view, send rate-limit,
   non-stigmatising guardrails; optional email channel honoring `NotificationPreference`.
7. **Tenant + audit invariants** on every backend change: every query `tenant_id`-scoped;
   thread create, report, and admin-read write append-only `AuditLog` rows; messages are
   **immutable** (no edit/delete in the MVP — append-only, mirrors the audit ethos).
8. **Reuse-first:** `@pilotage/ui` primitives, the existing `NotificationsService` fan-out,
   `StudentAccessService` for the guardianship half, `packages/contracts` for shared DTOs.
9. `pnpm typecheck` passes (Murat gate); no `git diff --check` errors; no new architectural
   decision without an ADR (see [`plan.md`](./plan.md) §ADR — one candidate ADR flagged).

## 6. Non-goals (explicitly out of E2)

- ❌ **Group / many-to-many threads** (the MVP is strictly **1 parent ↔ 1 teacher, scoped to 1
  child**). Multi-participant staff threads or parent-to-parent are out.
- ❌ **Teacher-initiated cold-start** to a parent (teachers use `Announcement`; avoids unsolicited
  contact). Revisit post-MVP.
- ❌ **Attachments / file upload** in the first pass (text only; attachments reuse the export/MinIO
  pipeline later if needed).
- ❌ **Real-time websockets / typing indicators.** Polling / revalidate is sufficient at MVP scale;
  a websocket gateway would be a **new architectural decision (ADR)** — deferred (see plan §ADR).
- ❌ **Editing or deleting a sent message** (messages are append-only; "report" is the safety lever).
- ❌ **Messaging admins / non-teaching staff** directly (admins appear only via moderation oversight).
- ❌ **Replacing `MeetingRequest`** — E2 *complements* it (a thread can coexist with a meeting
  request; the alert CTA may create both). Do not remove the E1 action center.
- ❌ **OneRoster/LTI external sync of messages** (E11 territory).
