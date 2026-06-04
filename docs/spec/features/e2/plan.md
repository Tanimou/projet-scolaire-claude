# E2 — Technical plan

> **Author: Winston (Architect) + John (PM).** Technical approach, modules touched,
> dependencies, risks, and the ADR ruling. Read [`spec.md`](./spec.md) +
> [`data-model.md`](./data-model.md) + [`contracts/openapi.yaml`](./contracts/openapi.yaml) first.

## 1. Approach

A new **`messaging` module** in the modular monolith (ADR-001), structurally mirroring the
`alerts` module (controller + service + types + specs, all under `apps/api/src/modules/messaging`).
The hot reads are **aggregate endpoints** (`GET /conversations` returns the denormalised inbox in
one query; `GET /conversations/:id/messages` pages the thread) so the parent/teacher pages never
N+1 from the client. Notifications reuse the **existing** in-app `NotificationsService.createMany`
fan-out (the same one E1 used) — **no new BullMQ queue**. The optional email channel (S4) reuses
the **existing notification-email pipeline** in `apps/worker` (no new processor pattern).

The **ABAC wall** is the heart of the feature and lives in the service layer:
- `StudentAccessService.canAccessStudent` (existing, E1) = the **guardianship** half.
- a new `isTeacherOfStudent(teacherUserProfileId, studentId)` helper = the **teaching** half
  (TeacherProfile → student's active Enrollment.classSection → active-year TeachingAssignment).
- Both are re-checked **at create AND every send** (a teacher who leaves the class → thread flips
  to `read_only`; history preserved, no new messages). The `alertId` seed is context-only and
  **never** widens access (the create path independently re-checks guardianship on the alert's
  student + that the alert concerns the thread's `studentId`).

## 2. Modules / files touched (by slice — see tasks.md for the ordered backlog)

**Backend (`apps/api`):**
- `prisma/schema.prisma` — **edit** (S1, [schema]): 2 enums + 3 models + back-relations + the
  `message` `NotificationKind` value. (S4 adds `ConversationReport` + its enum.)
- `src/modules/messaging/` — **new**: `messaging.module.ts`, `conversations.controller.ts`,
  `conversations.service.ts`, `messaging.types.ts`, `messaging-abac.ts` (the
  `isTeacherOfStudent` + combined eligibility helper), `*.spec.ts`.
- `src/modules/messaging/eligible-teachers.controller.ts` (or a method on the conversations
  controller) — the server-filtered "teachers I may message about my child" list for compose.
- Wire the new module into `app.module.ts`; register `StudentAccessService`,
  `SchoolContextService`, `NotificationsService`, `UserSyncService` providers (mirror
  `alerts.module.ts`).
- **New permissions** `messaging.read` / `messaging.write` (seed entries; granted to parent +
  teacher; admin gets a `messaging.moderate` for S4). Re-run the permission seed (a documented
  pre-merge step, same as E1-S3's `meeting_requests.*`).

**Frontend (`apps/web`):**
- `src/app/parent/messages/` — **new** (S2): inbox list page + thread view + compose
  (`'use client'` only where interactive), server-fetched via the `api()` client + `fetchMe`.
- `src/app/teacher/messages/` — **new** (S3): teacher inbox separated from announcements +
  thread reply + mark-read.
- `src/app/admin/...` moderation oversight — **new** (S4).
- `actions.ts` server actions (send, mark-read, report) returning the shared `ApiResult` shape.
- Parent recommendations / `AlertNextSteps` — **edit** (S2): point the E1-S2 "En parler à
  l'enseignant" CTA at the alert-seeded conversation create (Scenario B).
- Portal nav entries (parent + teacher + admin) with unread badges (reuse the existing nav-count
  convention; do NOT invent a new badge primitive).

**Worker (`apps/worker`):**
- Optional email channel for new messages (S4) — **reuse** the existing notification-email
  template/processor; honor `NotificationPreference(message, emailEnabled)`. No new queue.

**Contracts (`packages/contracts`):**
- `ConversationDto`, `ConversationMessageDto`, `EligibleTeacherDto`, the enums, and the request
  payloads — authored under `packages/contracts/src` (two-portal shared surface; the orchestrator
  builds contracts, agents only author the `.ts` source).

## 3. Dependencies & ordering

- **S1 (schema + ABAC + create/send core) is the spine** — everything depends on it. Ships the
  models, the eligibility helper, and the create-thread + send-message endpoints with full ABAC,
  + a thin slice of UI proof (or backend-only if time-boxed, per the vertical-slice rule the
  preferred S1 ships a minimal parent compose so it is demoable).
- **S2** (parent surface) and **S3** (teacher inbox) both consume S1's endpoints; S2 first
  (parent dashboard is the core), then S3.
- **S4** (moderation/safety + optional email) last; adds the `ConversationReport` model.
- The **E1 alert CTA rewire** (Scenario B) lands with S2 (parent side).

## 4. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Access widening via messaging** (a parent reaching a teacher who doesn't teach their child, or via the `alertId` seed). | Dual-wall ABAC (guardianship ∩ teaching) re-checked at create AND every send; `alertId` re-checks guardianship + student match; load-bearing negative specs (403/404). |
| **Stale teaching wall** (teacher changes class mid-year). | Re-check on every send; flip thread to `read_only` instead of leaking; history preserved. |
| **Duplicate threads** from double-clicking the alert CTA. | `Conversation @@unique([tenantId, parentId, teacherId, studentId])` → create-or-reuse (idempotent), mirrors `MeetingRequest`. |
| **Cross-tenant leak.** | `tenant_id` on every model + `where: { tenantId }` on every query; cross-tenant id → 404; isolation specs required. |
| **Notification storm / spam.** | Rate-limit sends (S4); reuse the dedup'd in-app fan-out; email opt-in defaults OFF (RGPD). |
| **N+1 on the inbox** (cahier <2 s). | Denormalised `topic`/`lastMessageAt` on `Conversation`; aggregate endpoint; index-covered thread paging. |
| **Stale Prisma client breaks the typecheck gate.** | `prisma generate` + `db push` is a documented pre-merge operator step (same as E1-S3/S4). |
| **Scope creep into real-time / attachments.** | Explicit non-goals (spec §6); polling/revalidate only; text-only. |

## 5. ADR ruling (Winston)

- **`Conversation`/`ConversationMessage`/`ConversationParticipant` are routine domain models**
  consistent with **ADR-001** (modular monolith — a new module, not a new service), **ADR-002**
  (shared DB + `tenant_id`, no new RLS posture — they join the application-scoped notification/
  alert family), **ADR-003** (features stay inside `/parent`,`/teacher`,`/admin` route prefixes),
  and **ADR-015** (RBAC `messaging.*` permissions + the guardianship ∩ teaching ABAC, an
  *intersection* of two **existing** walls, not a new authorization style). **→ No new ADR
  required for the MVP as specced.** This matches the E1-S3 ruling for `MeetingRequest`.

- **ONE flagged candidate ADR — DEFERRED with the feature out of scope.** If a future slice
  introduces **real-time delivery (websockets / SSE gateway)**, that **is** a new architectural
  decision (a new transport + a new long-lived-connection concern crossing the modular-monolith
  boundary) and **MUST land with a new `docs/adr/` ADR** ("ADR-019 — real-time messaging
  transport"). The MVP deliberately uses **polling / Next.js revalidation** to **avoid** triggering
  this ADR now. Winston gate: any PR that adds a websocket/SSE gateway without ADR-019 is a
  **blocking finding**.

- **Second watch-item (no ADR, but flag in review):** the `message` `NotificationKind` value +
  optional email channel reuse the **existing** notification/email pipeline (additive enum value,
  same as `weekly_digest`) — **not** a new decision, but Drift/Sentinel should confirm the email
  path honors `NotificationPreference` and stays opt-in (RGPD).
