# E1-S3 — Request a meeting / callback → teacher/admin action center

> **Self-contained story spec.** A developer must be able to implement this slice
> from this file alone — no other context required. Author: John (BMAD PM).
> Epic: **E1 — Parent Alert Action Loop**. Slice: **S3**. Mode: epic-slice.
> Predecessors: **S1 shipped** (PR #103 — parent ack/resolve/dismiss via guardianship ABAC),
> **S2 shipped** (the "Que puis-je faire ?" panel + the append-only, idempotent
> `alert.meeting_intent` audit row).
>
> **This is the first migration of the epic** → `[schema]` tag. It promotes S2's
> append-only `AuditLog` intent row into a queryable, tenant-scoped `MeetingRequest`
> Prisma model, surfaces it in a teacher/admin **action center**, lets staff
> **resolve** it, notifies the assigned teacher/admin, and **closes the two carried
> S3 debts** (the `@@unique` idempotency constraint + the `meetingRequestedAt`
> read-path back into the parent alert DTO).

---

## 1. Intent (one sentence)

Promote S2's fire-and-forget `alert.meeting_intent` audit row into a first-class,
tenant-scoped **`MeetingRequest`** record created through the existing guardianship-ABAC
path (parent → their child's current teacher/admin), surfaced in a teacher/admin
**action center** with a **resolve** action, with a worker notification to the assigned
staff member — closing the loop so a parent's "I'd like to talk about this" actually
**reaches** someone and the parent sees it stick across reloads.

## 2. Why (ties to the cahier de charges)

The cahier's defining promise is **"turn information into action"** — *every alert leads
to a next step (contact the teacher …)*. After S2 the parent can *express* the intent, but
it lands in an append-only audit row **nobody reads**: no teacher sees it, no parent sees it
persist (the PROGRESS debt notes the confirmation reverts to the CTA after a reload). S3
makes the intent **actionable on both sides**: it becomes a queryable record a teacher/admin
triages, and the parent's "Demande envoyée" survives a refresh. This is the half of the loop
that makes the request *real* rather than a write-only gesture.

## 3. Scope flags

- `touchesUi` = **true** — teacher/admin action-center surface (list + resolve) **and** the
  parent read-path confirmation persistence.
- `touchesBackend` = **true** — new `MeetingRequest` Prisma model + migration; ABAC create
  path that supersedes the raw audit-row write; teacher/admin list + resolve endpoints; the
  `meetingRequestedAt` read-path wired into the parent alert DTO.
- `touchesWorker` = **true** — a notification to the assigned teacher/admin on create (reuse
  the existing in-app `NotificationsService.createMany` fan-out; **no** new email/push channel).

## 4. Users & primary scenarios

**Actor A — Parent** (authenticated, holds an **active Guardianship** on the child; the same
ABAC gate as S1/S2). Acts from `/parent/recommendations?studentId=<child>`.

**Actor B — Teacher / School-admin** (holds `alerts.read` + `alerts.write`, the existing admin
alert permissions). Acts from a new **action-center** surface.

**Scenario A (parent, happy path):**
1. Parent opens Recommandations. Each alert card shows the S2 "Que puis-je faire ?" panel.
2. Parent clicks **« En parler à l'enseignant »** → the server action POSTs the intent (same
   endpoint as S2: `POST /api/v1/alerts/:id/meeting-intent`). The backend now creates a
   `MeetingRequest` row (status `open`) instead of a bare audit row, **and** still writes the
   append-only `alert.meeting_intent` audit row (the audit trail is preserved).
3. On success the control is replaced by the S2 confirmation (« Demande enregistrée — l'équipe
   en sera informée. »); the alert's **status is unchanged** (still listed). **New in S3:** after
   a full page reload the confirmation **persists** (the alert DTO now carries
   `meetingRequestedAt`), instead of reverting to the CTA.

**Scenario B (teacher/admin, happy path):**
1. Teacher/admin opens the **action center** (`/teacher/meeting-requests` and/or
   `/admin/meeting-requests` — see §8). They see a list of **open** meeting requests for their
   tenant/school: child name, alert title + rule chip + subject, requesting parent, requested-at,
   relative age.
2. They click **« Marquer traité »** on a row → `PATCH /api/v1/meeting-requests/:id/resolve`
   transitions the request to `resolved`, stamps `resolvedAt`/`resolvedBy`, writes an
   append-only audit row, and removes it from the open list.

**Scenario C (notification):** on a *new* `MeetingRequest` (first time, not an idempotent
re-request), the worker/notification fan-out creates ONE in-app `Notification` (kind `alert`)
addressed to the **assigned** teacher/admin (see §6 assignment rule), deep-linking to the
action center. A re-request (idempotent) creates **no** new notification.

## 5. The `MeetingRequest` model (the migration — `[schema]`)

Add to `apps/api/prisma/schema.prisma` next to `AlertInstance`. **No `prisma migrate` migrations
directory exists in this repo — the schema file is the source of truth applied via
`prisma db push`** (confirm: `apps/api/prisma/` has only `schema.prisma` + seeds, no
`migrations/`). So the deliverable is the **schema edit only** (do NOT scaffold a SQL migrations
folder — that would be an off-convention new pattern). Add a new `MeetingRequestStatus` enum and
the model:

```prisma
enum MeetingRequestStatus {
  open
  resolved
  cancelled
}

/// A parent's "I'd like to talk to the teacher about this alert" request,
/// promoted from the E1-S2 append-only `alert.meeting_intent` audit row into a
/// queryable, tenant-scoped record. Created via the guardianship-ABAC path
/// (parent → their child's current teacher/admin); triaged + resolved in the
/// teacher/admin action center. The append-only `AuditLog` row is still written
/// alongside (durable provenance); THIS table is the queryable surface.
model MeetingRequest {
  id            String               @id @default(uuid()) @db.Uuid
  tenantId      String               @map("tenant_id") @db.Uuid
  schoolId      String?              @map("school_id") @db.Uuid
  alertId       String               @map("alert_id") @db.Uuid
  studentId     String               @map("student_id") @db.Uuid
  subjectId     String?              @map("subject_id") @db.Uuid
  alertCode     AlertRuleCode        @map("alert_code")
  /// The parent UserProfile that made the request (audit actorId parity).
  requestedBy   String               @map("requested_by") @db.Uuid
  /// The teacher/admin this request is routed to (see §6 assignment rule).
  /// Nullable: when no main teacher / subject teacher can be resolved it stays
  /// unassigned and is visible to every admin of the school.
  assignedToId  String?              @map("assigned_to_id") @db.Uuid
  status        MeetingRequestStatus @default(open)
  /// Optional short free-text note the parent could add later (UNUSED in S3 —
  /// reserved so a follow-up can add a message without a second migration).
  note          String?
  resolvedAt    DateTime?            @map("resolved_at") @db.Timestamptz(6)
  resolvedBy    String?              @map("resolved_by") @db.Uuid
  createdAt     DateTime             @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime             @updatedAt @map("updated_at") @db.Timestamptz(6)

  alert       AlertInstance @relation(fields: [alertId], references: [id], onDelete: Cascade)
  student     Student       @relation(fields: [studentId], references: [id], onDelete: Cascade)
  subject     Subject?      @relation(fields: [subjectId], references: [id], onDelete: SetNull)
  requester   UserProfile   @relation("MeetingRequestRequester", fields: [requestedBy], references: [id], onDelete: Cascade)
  assignedTo  UserProfile?  @relation("MeetingRequestAssignee", fields: [assignedToId], references: [id], onDelete: SetNull)

  /// CLOSES CARRIED DEBT #3: idempotency is now a DB invariant, not an
  /// application-level findFirst-then-create. One OPEN/lifetime request per
  /// (tenant, alert, requesting parent) — matches the S2 audit-row idempotency
  /// key (tenantId, resourceId=alertId, actorId).
  @@unique([tenantId, alertId, requestedBy])
  @@index([tenantId, schoolId, status, createdAt])
  @@index([assignedToId, status, createdAt])
  @@map("meeting_request")
}
```

- **Back-relations:** add the matching relation arrays/fields on the related models — on
  `AlertInstance` add `meetingRequests MeetingRequest[]`; on `Student` add
  `meetingRequests MeetingRequest[]`; on `Subject` add `meetingRequests MeetingRequest[]`; on
  `UserProfile` add the two named back-relations
  (`meetingRequestsMade MeetingRequest[] @relation("MeetingRequestRequester")` and
  `meetingRequestsAssigned MeetingRequest[] @relation("MeetingRequestAssignee")`). Prisma
  validation FAILS without both ends of every relation — add them or the typecheck gate is red.
- **`@@unique([tenantId, alertId, requestedBy])`** is the explicit ask "add the `@@unique`
  idempotency constraint". Use the full unique key (not a partial index) so the create can use
  `upsert`/`create`-catch-P2002 for true concurrency safety.
- Worker schema: the `apps/worker` Prisma schema is the **same file** (worker reads
  `apps/api/prisma/schema.prisma` via its own `PrismaService` against the same DB) — no second
  schema to edit. Confirm the worker's generated client picks up the model (it shares the DB).

## 6. Backend — create path, assignment, list, resolve

### 6a. Supersede the audit-row write in `recordMeetingIntent`
`apps/api/src/modules/alerts/alerts.service.ts` — extend the **existing** `recordMeetingIntent`
(do NOT add a parallel endpoint; the controller route + ABAC gate from S2 stay verbatim):

- Keep the controller path exactly as S2: `POST /api/v1/alerts/:id/meeting-intent`,
  `@RequiresPermission('profile.read.self')`, authorized via the **unchanged**
  `authorizeParentAlertAction(jwt, id)` helper (resolves in-tenant `studentId` → 404 if
  cross-tenant/unknown; guardianship ABAC → 403 if not the guardian; returns
  `{ tenantId, userProfileId, actorRole, portal }`). **Reuse verbatim — do not write a second
  authorization path.**
- In the service: re-read the alert under `{ id, tenantId }` for `studentId`, `code`,
  `subjectId`, `schoolId` (never trust the client). **Resolve the assignee** (§6b).
- **Idempotency via the new `@@unique`:** wrap the create in a try/catch on Prisma **P2002**
  (unique violation) → on conflict, read the existing row and return `alreadyRequested: true`
  with its `createdAt`. Prefer this over the S2 `findFirst`-then-`create` (which the PROGRESS
  debt flags as racy). A `findFirst` pre-check is still fine as a fast path, but the P2002 catch
  is the real guard — keep both, the catch is authoritative.
- **Still write the append-only `AuditLog` row** (`action='alert.meeting_intent'`, same payload
  as S2) so the durable audit trail is unbroken — only on a *new* create, not on an idempotent
  re-request. The `MeetingRequest` is the queryable surface; the audit row is the immutable
  provenance. (This keeps S1/S2's "audit row IS the record" promise intact while adding the
  queryable model.)
- **Fire the notification only on a new create** (Scenario C) — never on the idempotent path
  (CLOSES CARRIED DEBT #3's downstream concern: "a duplicate becomes a double-notification").
- Return shape is **unchanged** from S2: `{ ok: true, alreadyRequested: boolean, requestedAt: string }`
  (the parent UI + `intent-actions.ts` already consume exactly this — do not break the contract).

### 6b. Assignment rule (`assignedToId`) — deterministic, pure-ish
Resolve the staff member the request routes to, in this order (first match wins):
1. If the alert has a `subjectId` and a current `TeachingAssignment` for that
   `(studentId's current classSection, subjectId)` in the **active** academic year exists →
   assign to that `TeacherProfile.userProfileId` (the subject teacher).
2. Else the **main teacher** (`isMainTeacher = true` / `role = principal`) of the student's
   current class section → `TeacherProfile.userProfileId`.
3. Else **null** (unassigned) — the request is still created and is visible to every
   `school_admin` of the school (the action center shows unassigned rows to admins).
- Resolving "the student's current class section" reuses the **active** `Enrollment` for the
  student (status active, current academic year). If you cannot resolve a class section, fall to
  step 3 (null) — never throw; a meeting request must always be created.
- Keep this resolution in a small private helper `resolveMeetingAssignee(args)` in
  `alerts.service.ts` (or a thin `meeting-requests` service — see §6c). It is **best-effort**:
  any lookup failure → `assignedToId = null`, never blocks the create.

### 6c. Action-center list + resolve endpoints
Create a **new controller** `apps/api/src/modules/alerts/meeting-requests.controller.ts`
(`@Controller('meeting-requests')`) + service `meeting-requests.service.ts` (keep it in the
alerts module — `alerts.module.ts` already wires `AlertsService`, `StudentAccessService`,
`SchoolContextService`, `UserSyncService`; register the new providers there). Endpoints:

- **`GET /api/v1/meeting-requests`** — `@RequiresPermission('alerts.read')`.
  - `me = ensureUser(jwt)`; `{ schoolId } = ctx.forUser(me)`.
  - Query params: `status` (default `open`), `limit`/`offset` (clamp like `listInstances`:
    1..200 / ≥0).
  - **Scoping (ABAC):** resolve the caller's role from `jwt.realm_access.roles`.
    - `super_admin`/`school_admin` → all requests in `{ tenantId, schoolId }`.
    - `teacher` → only requests where `assignedToId = me.id` **OR** `assignedToId IS NULL`
      within their school (so a teacher sees their own queue; unassigned go to admins — a teacher
      need not see other teachers' requests). Pin this in the test.
    - Anyone else → empty list (defensive; the permission gate already blocks parents).
  - Return `{ data: MeetingRequestDto[], total }`, newest first. The DTO joins child name,
    alert title + `code` + subject name, requesting parent display name, `assignedToId` +
    assignee name (or null), `status`, `createdAt`, `resolvedAt`. **No client N+1** — use Prisma
    `include` to fetch the joins in one query (mirror `listInstances`).
- **`PATCH /api/v1/meeting-requests/:id/resolve`** — `@RequiresPermission('alerts.write')`.
  - Resolve the row under `{ id, tenantId }` (404 if missing/cross-tenant — never leak).
  - Idempotent terminal transition (mirror `AlertsService.resolve`): only `open` → `resolved`
    transitions; a second resolve is a no-op (no re-stamp, no duplicate audit row). Stamp
    `resolvedAt = now`, `resolvedBy = me.id`, `status = resolved`.
  - Write ONE append-only `AuditLog` row (`action='meeting_request.resolve'`,
    `resourceType='meeting_request'`, `resourceId=id`, `before/after` status) via the same inline
    `prisma.auditLog.create` convention (best-effort, post-update, never rolls back).
  - **AuthZ note:** a teacher resolving a request must own it or it must be unassigned within
    their school — apply the **same scoping filter as the list** in the `where` of the update
    lookup so a teacher cannot resolve another teacher's request (404 if out of scope). Admins
    unrestricted within school.

### 6d. CLOSE CARRIED DEBT #2 — wire `meetingRequestedAt` into the parent alert DTO
`AlertsService.listForStudent` → `toDto` currently never reads the intent, so the parent
`AlertItem.meetingRequestedAt` is always `undefined` (the confirmation reverts after reload).
Fix it **without an N+1**:
- In `listForStudent`, after loading the alert rows, **batch** query `MeetingRequest` for
  `{ tenantId, alertId in [...ids], requestedBy = <the requesting parent's userProfileId> }`
  — but `listForStudent` does not currently receive the caller's `userProfileId`. **Thread the
  caller's `userProfileId` from the controller** (`listForParent` already has `me.id`) into
  `listForStudent`, and key the batch lookup on `(alertId, requestedBy = me.id)` so a parent only
  ever sees **their own** request reflected (not a co-guardian's).
- Build a `Map<alertId, createdAt-ISO>` and set `meetingRequestedAt` on each DTO. **Add
  `meetingRequestedAt: string | null` to `AlertInstanceDto`** in `alerts.types.ts` (the web
  `AlertItem` already declares the optional field — this completes the contract).
- This is a read-path only change to the parent list; the admin `listInstances` DTO does not need
  the field (leave it `null` there or omit — keep the change minimal and parent-scoped).

### 6e. Contract type (optional but preferred)
Add `MeetingRequestDto` + `MeetingRequestStatus` to `packages/contracts` if you want it typed
end-to-end (the teacher/admin web surface will consume it). A local web type is acceptable per
S2's precedent, but since this is a *new shared surface across two portals*, prefer the contract
package. If you add it, rebuild contracts is NOT your job (the orchestrator builds) — just author
the `.ts` source under `packages/contracts/src` and export it.

## 7. The notification fan-out (worker-adjacent — `touchesWorker`)

The alert create-time guardian fan-out lives in `AlertsService.notifyGuardiansOfAlert` (API
side, via `NotificationsService.createMany`). **Reuse the same in-app `NotificationsService`** to
notify the **assignee** on a new `MeetingRequest`:
- On a new create with a non-null `assignedToId`: `notifications.createMany([{ tenantId,
  userProfileId: assignedToId, kind: 'alert', severity: 'warning', title: 'Demande de rendez-vous
  d'un parent', body: '<child name> — <alert title>', link: '/teacher/meeting-requests',
  sourceType: 'meeting_request', sourceId: <meetingRequest.id> }])`. Dedup by
  `sourceId = meetingRequest.id` (the `@@unique` already prevents duplicate requests, so this is
  naturally one-per-request).
- On a new create with a **null** `assignedToId` (unassigned): notify every `school_admin`
  `UserProfile` of the school (resolve admins by their `UserRole`/role — reuse whatever the
  codebase already uses to find school admins; if no clean helper exists, **skip the unassigned
  notification** and rely on the admin action-center list — note the substitution in the PR rather
  than inventing a fragile admin-lookup query).
- **No email / push channel in S3.** In-app only (the email dispatcher is E5). This keeps the
  worker touch minimal: the notification is created by the API request path; the only true
  "worker" involvement is that the in-app `Notification` row is consumed by the existing bell.
  If the team prefers, enqueueing is unnecessary — `createMany` writes the in-app row directly,
  matching `notifyGuardiansOfAlert`. (So `touchesWorker` is satisfied by reusing the shared
  notification fan-out, not by a new BullMQ processor — do NOT add a new queue.)
- The notification is **best-effort** (wrap in try/catch + logger.error like the existing
  `markReadBySource` calls): a notification failure must NEVER roll back the `MeetingRequest`
  create or surface to the parent.

## 8. Frontend — the teacher/admin action center + parent persistence

### 8a. Teacher/admin action-center surface (the bulk of the UI)
- **New route** `apps/web/src/app/teacher/meeting-requests/page.tsx` (server component): fetch
  `GET /api/v1/meeting-requests?status=open` via the shared `api()` client + `fetchMe`, render a
  list. Mirror the existing teacher page conventions (`PortalShell`, `SectionHeader`,
  `@pilotage/ui` primitives, `EmptyState` when none). Each row shows: child name, alert title,
  rule chip (reuse the existing alert code → label mapping), subject chip, requesting parent,
  relative time ("il y a 2 h"), and a **« Marquer traité »** button.
- **Admin parity:** add `apps/web/src/app/admin/meeting-requests/page.tsx` reusing the same list
  component (extract a shared `MeetingRequestList`/`MeetingRequestRow` under a co-located folder,
  e.g. `apps/web/src/app/(shared)/meeting-requests/` or duplicated thin pages that both import one
  client component — prefer ONE shared client component to avoid drift). The admin page is gated by
  the same `alerts.read` permission the admin already holds; admins see all + unassigned rows.
  **If time-boxing forces a cut, ship the teacher page first** (teachers are the primary assignee)
  and note the admin page as a fast-follow — but the backend list endpoint already serves both, so
  both pages are thin.
- **Resolve action:** a `'use client'` button + server action
  `resolveMeetingRequestAction(id)` (new `actions.ts` in the meeting-requests folder) hitting
  `PATCH /api/v1/meeting-requests/:id/resolve`, returning the shared `ApiResult` shape
  (`apiResultFromError` on failure). On success `revalidatePath` the action-center route (the row
  leaves the open list — unlike the parent intent, a status change here *should* refresh the list).
  Use `useTransition` + an `aria-live` confirmation, mirroring `AlertActions`.
- **Reuse `@pilotage/ui` first** — `Button`, `Badge`/chip, `EmptyState`, `SectionHeader`. No new
  shared primitive unless it lands in `packages/ui` (DS Guardian territory). Premium, colorful,
  responsive, accessible, WCAG 2.2 AA (contrast on any tinted rows ≥ 4.5:1; 44px targets for the
  resolve CTA; labelled `role="group"`/list semantics; keyboard-reachable; visible focus).
- **Navigation:** add a sidebar/nav entry to the teacher (and admin) portal nav pointing at the
  new route, with an unread/open count if the nav pattern already supports a badge (reuse the
  existing nav-count convention if present; otherwise a plain link is fine — do NOT invent a new
  badge primitive).

### 8b. Parent confirmation persistence (CLOSE CARRIED DEBT #2, FE half)
- `apps/web/src/app/parent/recommendations/page.tsx` already threads
  `AlertItem.meetingRequestedAt` into `<AlertNextSteps>` as seed state (per S2). Once §6d makes
  the API DTO populate `meetingRequestedAt`, **no FE change is needed** beyond confirming the
  page passes the field through (it already does per the S2 wiring note). Verify the
  `AlertNextSteps` initial state reads `alert.meetingRequestedAt` and renders the "Demande
  envoyée"/confirmation instead of the CTA when present. If the field is not actually threaded
  end-to-end (read the current `page.tsx` + `AlertNextSteps.tsx`), complete that wiring here — it
  is explicitly part of this slice.
- **Do NOT** change the S2 intent server action contract or add `revalidatePath` to the parent
  intent (preserves scroll — that S2 decision stands).

## 9. Acceptance criteria (testable)

1. **Model + migration (schema-only):** `MeetingRequest` + `MeetingRequestStatus` exist in
   `schema.prisma` with the `@@unique([tenantId, alertId, requestedBy])` constraint, both ends of
   every relation declared (Prisma validates), and **no** new SQL `migrations/` folder is created
   (repo uses `db push`; schema file is the source of truth).
2. **Create supersedes the audit row:** `POST /api/v1/alerts/:id/meeting-intent` (unchanged route
   + unchanged `authorizeParentAlertAction` ABAC gate) now creates ONE `MeetingRequest` (status
   `open`) **and** writes the append-only `alert.meeting_intent` audit row, returning the
   unchanged `{ ok, alreadyRequested, requestedAt }` shape.
3. **DB-level idempotency:** a second intent by the same parent on the same alert creates **no**
   second `MeetingRequest` row (P2002 on `@@unique` caught → `alreadyRequested: true`, original
   `createdAt` echoed) and fires **no** second notification. Two concurrent POSTs yield exactly one
   row (the constraint, not the app-level findFirst, is the guarantee).
4. **ABAC on create is unchanged:** a parent acting on **another tenant's** alert id → **404**; a
   parent acting on a **child they do not guard** → **403** (reuses `authorizeParentAlertAction`).
5. **Assignment:** `assignedToId` resolves to the subject teacher (if subject + active teaching
   assignment), else the main teacher of the student's current class, else `null` — never throws;
   an unresolvable assignee still creates the request.
6. **Action-center list:** `GET /api/v1/meeting-requests?status=open` (`alerts.read`) returns the
   tenant/school's open requests with joined child/alert/parent/assignee fields in **one query**
   (no N+1); a **teacher** sees only requests assigned to them or unassigned within their school;
   an **admin** sees all; a parent token is blocked by the permission gate.
7. **Resolve:** `PATCH /api/v1/meeting-requests/:id/resolve` (`alerts.write`) transitions
   `open → resolved` (idempotent — a second resolve is a no-op, no duplicate audit row), stamps
   `resolvedAt`/`resolvedBy`, writes a `meeting_request.resolve` audit row, and a cross-tenant /
   out-of-scope id returns **404** (a teacher cannot resolve another teacher's request).
8. **Notification:** a *new* request notifies the assignee (or school admins if unassigned, if a
   clean admin lookup exists) with ONE in-app `Notification` (kind `alert`, `sourceId =
   meetingRequest.id`, link to the action center); a re-request notifies **no one**; notification
   failure never rolls back the create.
9. **Parent persistence (carried debt #2 closed):** the parent alert DTO now carries
   `meetingRequestedAt` (from the requesting parent's own `MeetingRequest`), so after a full page
   reload the "Demande envoyée" confirmation **persists** instead of reverting to the CTA. The
   lookup is keyed on `(alertId, requestedBy = caller)` so a co-guardian's request is not shown as
   the caller's.
10. **Teacher/admin UI:** `/teacher/meeting-requests` (and `/admin/meeting-requests`) render the
    open list with `@pilotage/ui` primitives, an `EmptyState` when none, a working **« Marquer
    traité »** resolve that `revalidatePath`s the row away, WCAG 2.2 AA (contrast, 44px target,
    keyboard + visible focus, list/group semantics), responsive + premium. A nav entry points at
    the route.
11. **Tenant + audit invariants:** every new query is `tenantId`-scoped; both the create and the
    resolve write append-only audit rows; no audit row is ever updated/deleted.
12. `pnpm typecheck` passes (the Murat gate). No `git diff --check` whitespace errors. No client
    N+1. No new architectural decision without an ADR (the `MeetingRequest` model is a routine
    domain model consistent with ADR-001/002/015 — no new ADR needed; confirm with Winston).

## 10. Non-goals (explicitly out of THIS slice)

- ❌ Real messaging / E2 conversations (the request still routes to an action center, not a chat).
- ❌ Email / push notification of the meeting request (in-app only; email is E5).
- ❌ A parent-side "my requests" history page (the parent only sees the per-alert confirmation).
- ❌ A scheduling/calendar slot picker, callback time, or actual meeting booking (E7 territory).
- ❌ A new BullMQ queue / worker processor (reuse the existing in-app notification fan-out).
- ❌ Changing the S1 alert lifecycle (ack/resolve/dismiss) or the S2 deep-link derivation.
- ❌ The 7th alert rule / evaluator changes (E3).
- ❌ A `cancelled` transition UI (the enum value exists for future use; no UI in S3).

## 11. Files (expected touch set — keep disjoint per the agent split)

**Backend (`apps/api`):**
- `prisma/schema.prisma` — **edit**: add `MeetingRequestStatus` enum + `MeetingRequest` model +
  back-relations on `AlertInstance`, `Student`, `Subject`, `UserProfile`. `[schema]` tag.
- `src/modules/alerts/alerts.service.ts` — **edit**: rework `recordMeetingIntent` to create the
  `MeetingRequest` (P2002-idempotent) + keep the audit row + fire the assignee notification; add
  `resolveMeetingAssignee` helper; thread `userProfileId` into `listForStudent` + populate
  `meetingRequestedAt` in `toDto` (carried debt #2).
- `src/modules/alerts/alerts.controller.ts` — **edit**: thread `me.id` into the
  `listForParent → listForStudent` call (for the `meetingRequestedAt` read-path). The
  `meeting-intent` route + `authorizeParentAlertAction` stay verbatim.
- `src/modules/alerts/meeting-requests.controller.ts` — **new**: `GET /meeting-requests` +
  `PATCH /meeting-requests/:id/resolve` (`alerts.read`/`alerts.write`, role-scoped).
- `src/modules/alerts/meeting-requests.service.ts` — **new**: list (role-scoped, joined, no N+1)
  + resolve (idempotent, audited).
- `src/modules/alerts/alerts.module.ts` — **edit**: register the new controller + service.
- `src/modules/alerts/alerts.types.ts` — **edit**: add `meetingRequestedAt` to
  `AlertInstanceDto`; add `MeetingRequestDto` + `MeetingRequestStatus` (or in contracts).
- `src/modules/alerts/meeting-requests.service.spec.ts` — **new**: the targeted BE tests
  (idempotency via P2002, role-scoped list, resolve idempotency + 404 out-of-scope, assignment
  fallback chain).
- `src/modules/alerts/alerts.service.spec.ts` — **edit**: cover `meetingRequestedAt` read-path +
  that create still writes the audit row and notifies once.

**Frontend (`apps/web`):**
- `src/app/teacher/meeting-requests/page.tsx` — **new**: action-center list (server component).
- `src/app/admin/meeting-requests/page.tsx` — **new**: admin parity (reuse the shared list
  component).
- A shared `MeetingRequestList` / `MeetingRequestRow` client component + `actions.ts`
  (`resolveMeetingRequestAction`) — **new** (co-located; ONE shared component, not duplicated).
- Teacher (+ admin) portal nav — **edit**: add the action-center entry.
- `src/app/parent/recommendations/page.tsx` / `AlertNextSteps.tsx` — **verify/complete** the
  `meetingRequestedAt` → confirmation seed-state wiring (no contract change; the field already
  exists on `AlertItem`).

**Contracts (preferred):** `packages/contracts/src` — `MeetingRequestDto` + `MeetingRequestStatus`
exported (two-portal shared surface).

## 12. Risk tier & escalation

- **Risk tier: P1** — `[schema]` (first migration of the epic, new model + `@@unique`) **and**
  `[auth]`/ABAC (the create path rides the guardianship gate; the action center is role-scoped).
  Per the agent rules this is **never silently auto-merged**: it triggers the escalation panel
  (architect + security + test-architect) and is flagged *needs human review*. Sentinel must
  confirm: (a) the create still reuses `authorizeParentAlertAction` (tenant + guardianship);
  (b) the action-center list/resolve are `tenantId`-scoped AND role-scoped (a teacher cannot see
  or resolve another teacher's request; a parent token is blocked); (c) the `meetingRequestedAt`
  read-path is keyed on the caller's own `requestedBy` (no co-guardian leak); (d) both create and
  resolve write append-only audit rows. Winston must confirm `MeetingRequest` introduces no new
  architectural decision (it's a routine ADR-001/002/015-consistent model → no new ADR).
- **`scopeForUser` role-precedence (carried Sentinel must-check):** `super_admin`/`school_admin`/
  `teacher` short-circuit before the `parent` branch — a parent holding a stale/forged `teacher`
  role must still 403 on the parent create path (it's gated by `profile.read.self` + guardianship
  ABAC, not by role, so this holds) and must NOT gain action-center visibility (the action center
  is gated by `alerts.read`, which parents do not hold). Keep the negative test in mind.

## 13. Pre-mortem (failure modes → folded into §9)

- *"Two concurrent intents created two requests + double-pinged the teacher."* → §5 `@@unique` +
  §6a P2002 catch + §9 AC3 (DB constraint is the guarantee, not findFirst).
- *"The action center leaked another teacher's / tenant's requests."* → §6c role+tenant scoping +
  §9 AC6/AC7 + §12 Sentinel checks.
- *"The migration broke Prisma validate (missing back-relation)."* → §5 back-relations checklist +
  §9 AC1 (typecheck/validate is the gate).
- *"The parent confirmation still reverted after reload."* → §6d read-path wiring + §9 AC9
  (carried debt #2 explicitly closed).
- *"A notification failure rolled back the meeting request."* → §7 best-effort try/catch + §9 AC8.
- *"Assignment threw when the student had no class/teacher and no request was created."* → §6b
  best-effort fallback to `null` + §9 AC5 (request always created).
- *"Someone added a new BullMQ queue / email channel and blew the scope + worker budget."* → §10
  non-goals + §7 reuse the in-app fan-out (no new queue).
- *"The create-time audit trail was dropped when the model arrived."* → §6a keep the append-only
  `alert.meeting_intent` row + §9 AC2/AC11.
