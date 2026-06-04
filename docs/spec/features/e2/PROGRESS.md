# E2 — Parent ↔ Teacher Messaging (Conversations) · PROGRESS

> **Epic status: `in-progress` — S1 shipped (this run, needs human review).** The epic-spec kit is
> in place (`spec.md`, `plan.md`, `data-model.md`, `contracts/openapi.yaml`, `tasks.md`, `quickstart.md`)
> and the **Conversations spine** (S1) is now implemented: 3 new Prisma models + 2 enums, dual-wall
> ABAC (guardianship ∩ teaching-assignment, re-checked at create AND every send), parent-only create,
> append-only audit, idempotent thread reuse, `messaging.read|write` perms, additive `message`
> `NotificationKind`, and the parent compose surface.
> **S2 shipped (this run, needs human review).** The parent now has a real `/parent/messages`
> inbox (thread list with unread badges + alert chips), a thread view (paged history, reply,
> mark-read, alert-context header), the relocated `/parent/messages/new` compose, four new
> aggregate read/state endpoints (`GET /conversations`, `GET /conversations/:id`,
> `GET /conversations/:id/messages`, `PATCH /conversations/:id/read`), the `alertContext` seed
> exposed end-to-end (re-checked, strict subset, null on mismatch), and the E1 `AlertNextSteps`
> CTA rewired to open the alert-seeded thread (the E1 `MeetingRequest` intent path preserved).
> No schema change.
> **S3 shipped (this run, needs human review).** Teachers now have a `/teacher/conversations` inbox
> (parent-initiated threads, separated from the `/teacher/messages` Announcements surface, with a
> distinct "Conversations parents" sidebar item) and a thread view (paged history, reply composer,
> mark-read, alert-context header) — all thin clients over the already-walled S1/S2 endpoints. The only
> backend deltas are two in-app notification deep-links retargeted `/teacher/messages` →
> `/teacher/conversations`; no schema, no new endpoint, no controller/permission change. Three new
> service specs lock the notification deep-link payloads. The teacher reply path goes live for the
> first time (the `sendMessage` teacher branch was code-complete + ABAC-walled since S1).
> **Next run → implement S4** (moderation / safety: report, admin oversight, rate-limit,
> non-stigmatising guardrails + optional email channel).
> Predecessor **E1 — Parent Alert Action Loop** is `shipped` (S1–S4).

| Slice | Title | Status | PR |
|---|---|---|---|
| — | Epic-spec kit | **written** | — |
| S1 | Conversation models + ABAC core + create/send | **shipped** (needs human review) | — |
| S2 | Parent messages surface + alert-seeded threads | **shipped** (needs human review) | — |
| S3 | Teacher inbox (separated from announcements) + reply | **shipped** (needs human review) | — |
| S4 | Moderation / safety + optional email channel | `proposed` | — |

> A self-contained `story` spec is authored under `stories/S<n>-*.md` on each slice run
> (mirrors E1's `stories/` backfill convention).

## Key decisions baked into the spec (carry forward)

- **Dual-wall ABAC is the spine.** Eligibility = `guardianship(parent, child, active)` **∩**
  teacher **currently** teaches the child (active-year `TeachingAssignment` on the child's active
  `Enrollment` class section). Reuse `StudentAccessService.canAccessStudent` for the guardianship
  half; new `isTeacherOfStudent` for the teaching half. **Re-checked at create AND every send** —
  a lapsed teaching wall flips the thread to `read_only` (history preserved, send → 403), never
  deletes. This is an *intersection of two existing walls*, so **no new authorization style → no
  new ADR**.
- **Alert-seeded threads (the visionary hook).** `Conversation.alertId` is an **optional** seed
  storing the originating E1 alert for context (rule + subject + child + trend in the thread
  header) so the teacher sees WHY. It **never widens access**: the create path independently
  re-checks guardianship on the alert + that the alert concerns the thread's `studentId`; the
  exposed `alertContext` is a strict subset of what the parent already sees on the alert card.
  This turns E1→E2 into one continuous alert→action→conversation loop (the E1-S2 CTA was stubbed
  to open exactly this).
- **Idempotent threads.** `Conversation @@unique([tenantId, parentId, teacherId, studentId])` →
  create-or-reuse (double-clicking the CTA reuses the thread), mirroring `MeetingRequest`'s
  `@@unique` idempotency from E1-S3.
- **Messages are append-only / immutable.** No edit, no soft-delete (consistent with the platform's
  append-only audit ethos). Safety is `report` + thread `status=blocked` (S4), not deletion.
- **Reuse over new infra.** In-app notify via the existing `NotificationsService.createMany` fan-out
  (no new BullMQ queue); optional email reuses the existing notification-email pipeline + the
  additive `message` `NotificationKind` value (same pattern as E1-S4's `weekly_digest`); shared
  DTOs in `packages/contracts`; aggregate inbox endpoint (no client N+1, cahier <2 s budget).
- **No new RLS posture.** The new tables join the application-scoped `tenant_id` family
  (`alert_instance`/`meeting_request`/`notification`) — no per-table RLS policy is added, so this
  is not a new architectural decision (ADR-002 unchanged).

## Flagged for Winston / future ADR (do NOT lose)

- **ADR-019 candidate — real-time messaging transport, DEFERRED.** The MVP uses **polling /
  Next.js revalidation**. If a future slice adds **websockets / SSE**, that IS a new architectural
  decision (new transport + long-lived connections crossing the modular-monolith boundary) and
  MUST land with a new `docs/adr/ADR-019` — it is a Winston **blocking finding** otherwise. The
  spec deliberately avoids triggering this now (see `plan.md` §5).

## Pre-merge operator steps (every schema-touching slice — S1, S4)
- `prisma generate` + `prisma db push` (the diff carries the schema edit; the regenerated client
  is NOT in the diff → `pnpm typecheck` is red until regen — identical to E1-S3/S4).
- Re-run the permission seed so `messaging.read|write` (S1) / `messaging.moderate` (S4) land in
  the DB (identical to E1-S3's `meeting_requests.*`).

## Pre-merge operator step (S2 — contracts-only, NO schema)
- **Rebuild `packages/contracts`** (`pnpm --filter @pilotage/contracts build`, or the orchestrator's
  single `pnpm build`). S2 adds new exported schemas (`ConversationInboxQuerySchema`,
  `ConversationMessagesQuerySchema`, `ConversationMessagePageSchema`, `ConversationInboxResponseSchema`)
  consumed by the NestJS controller at runtime via the CJS `dist/`. Until the rebuild, the contracts
  `dist/` is stale → the 5 `messaging.controller.spec` cases that parse these query schemas fail with a
  `TypeError` (the symbol is `undefined` in the old build). Source transpiles cleanly (verified); this is
  the contracts analogue of S1's `prisma generate` regen step. No `db push` (schema-free slice).

## Non-goals (epic-level — see spec §6)
Group threads · teacher cold-start · attachments · real-time/typing · message edit/delete ·
messaging non-teaching staff · replacing `MeetingRequest` · OneRoster/LTI message sync.
