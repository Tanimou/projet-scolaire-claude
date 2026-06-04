# E1 — Parent Alert Action Loop · PROGRESS

> **Epic status: `shipped`** (all slices S1–S4 landed; S2/S3/S4 flagged *needs human review*).
> **Next epic → E2 — Parent ↔ Teacher Messaging**, which needs an **epic-spec** run first
> (no `docs/spec/features/e2/spec.md` yet).

> Spec-kit was **not** written on E1's first run (the codebase was already past the
> "epic-spec first" assumption — admin lifecycle endpoints + parent read shipped), so the
> first E1 run was an **epic-slice**, not a spec run. This folder is being backfilled
> incrementally, one story spec per slice under `stories/`.

| Slice | Title | Status | PR |
|---|---|---|---|
| S1 | Parent ack / mark-handled / dismiss (guardianship ABAC) | **shipped** | [#103](https://github.com/Tanimou/projet-scolaire-claude/pull/103) |
| S2 | "What should I do?" panel on the alert | **shipped** (needs human review) | — |
| S3 | Request a meeting / callback intent → teacher/admin action center | **shipped** (needs human review) | — |
| S4 | Weekly parent digest (opt-in) | **shipped** (needs human review) | — |

> **S4 is the last slice → epic E1 is `shipped`.** Next run targets the **E2** epic-spec.

## Decisions carried across slices
- **No new tables for the action loop so far.** S1's status history *is* the append-only
  `AuditLog` row. S2 follows suit: the "talk to teacher" intent is an `AuditLog` row
  (`action='alert.meeting_intent'`), **not** a `MeetingRequest` model — that model arrives in **S3**.
- **Parent lifecycle authZ = guardianship ABAC**, gated by `profile.read.self` and
  `StudentAccessService.canAccessStudent` (NOT the admin `alerts.write`). S2 reuses the existing
  private `authorizeParentAlertAction(jwt, id)` helper verbatim (so `meetingIntentByParent` runs
  the exact same 404-before-403, in-tenant studentId resolution, guardianship check).
- Audit writes are **best-effort, post-mutation, idempotent** (one row per real transition/intent).
- **Status-neutrality (new in S2).** `recordMeetingIntent` deliberately does **not** touch
  `AlertInstance.status` — a meeting request is orthogonal to ack/resolve/dismiss, so the alert
  stays listed; the server action correctly omits `revalidatePath` (preserves scroll).

## Post-verify hardening applied in the S2 PR (lock-holder, after the sprint)
- **Fixed the flagship deep-link (was inert).** `deriveAlertActions` emitted
  `/parent/grades?studentId=…&subject=<code>`, but `/parent/grades` filters on `subjectId` (the
  subject **UUID**), so the "Renforcer {matière}" link landed unfiltered (AC2 violation, flagged 3×
  by the verify panel). Now threads `subjectId` (already on `AlertItem.subjectId`) through
  `page.tsx → AlertNextSteps → deriveAlertActions` and emits `&subjectId=<uuid>`, matching the
  working `subjects → grades` convention; falls back to `/parent/subjects` when `subjectId` is null.
  Spec story §6/§10 deep-link text corrected to match.
- **Fixed the a11y status announcement (WCAG 2.2 SC 4.1.3).** The meeting-intent success
  confirmation was not announced (the success `<div>` had no live region). The persistent polite
  `aria-live` region now carries the « Demande envoyée » message on the success *transition* only
  (empty on initial load, so a pre-requested alert is not re-announced).
- **Added the required controller ABAC test (Murat P1 gate).** `alerts.controller.spec.ts` now pins
  `meetingIntentByParent`: guardian → ABAC runs before the write with parent provenance; non-guardian
  → 403, no write; cross-tenant id → 404, no ABAC bypass, no write.

## Carried gaps / debt for S3 (flagged by the escalation panel — do NOT lose)
- **AC6 (`deriveAlertActions` unit test) deferred — no web unit runner.** `apps/web` has only a
  Playwright E2E setup (no vitest/jest), so a pure-function unit test cannot run in this slice
  without standing up a runner (scope-widening). The deep-link fix is instead pinned indirectly by
  the API-side specs + manual checks; add the unit test when a web unit runner lands (E10 quality bar).
- **Read-path wiring of `meetingRequestedAt` is unfinished.** The web `AlertItem.meetingRequestedAt`
  type, the `page.tsx` prop, and the `AlertNextSteps` seed state are all plumbed, but
  `AlertsService.listForStudent` → `toDto` does **not** read the `alert.meeting_intent` audit row,
  so the DTO field is always `undefined`. Effect: after a page reload the "Demande envoyée"
  confirmation reverts to the CTA (the backend idempotency guard still prevents a duplicate row on
  re-click). Close in S3 (or a follow-up) by batch-left-joining the latest `alert.meeting_intent`
  `AuditLog` row per alert, keyed on `resourceId` + the requesting parent's `actorId`, into `toDto`.
- **Idempotency is application-level `findFirst`-then-`create`, no unique constraint.** Two
  concurrent POSTs can both pass the guard → two intent rows. Harmless today (append-only, status
  untouched), but S3 promotes intents into teacher pings → a duplicate becomes a double-notification.
  S3 author: add the `MeetingRequest` `@@unique` (or a partial unique index) and dedupe on read.
- **`scopeForUser` role-precedence must-check (Sentinel).** `super_admin`/`school_admin`/`teacher`
  short-circuit to unrestricted-within-tenant **before** the `parent` branch — the child-data wall
  rests on the integrity of the Keycloak `realm_access.roles` claim. Keep the negative test in mind:
  a parent holding a stale/forged `teacher` role must still 403 on a non-guarded child.

## S3 — shipped (needs human review)
**Request a meeting / callback** intent, promoting the S2 `alert.meeting_intent` audit row into a
queryable `MeetingRequest` Prisma model (first migration of the epic). *(api + web; `[schema][auth]` tag.)*

Self-contained story spec: [`stories/S3-meeting-request.md`](./stories/S3-meeting-request.md). What landed:
- **New `MeetingRequest` model + `MeetingRequestStatus` enum** (`apps/api/prisma/schema.prisma`): snake_case
  `@map`, `tenant_id`-first indexes, `onDelete` Cascade (alert/student/requester) / SetNull (subject/assignee),
  back-relations on Subject/Student/UserProfile/AlertInstance. Closes all three carried S3 debts:
  (1) `@@unique([tenantId, alertId, requestedBy])` makes idempotency a **DB invariant** (supersedes S2's racy
  `findFirst`; P2002 caught → one row, one notification under concurrent POSTs); (2) `meetingRequestedAt`
  wired back into the parent alert DTO via `loadMeetingRequestedAt` (parent confirmation now persists across
  reloads); (3) `scopeFromRoles` role-precedence kept under test.
- **Create path unchanged route/gate**: same `POST /alerts/:id/meeting-intent` + `authorizeParentAlertAction`
  guardianship ABAC from S2 — now creates a `MeetingRequest` (server-resolved assignee: subject teacher →
  main teacher → null) AND keeps the append-only audit row, both best-effort.
- **New role-scoped action center**: `GET /meeting-requests` + `PATCH /meeting-requests/:id/resolve`, gated on
  **dedicated `meeting_requests.read|write`** permissions (granted to teacher + admin, NOT the broad `alerts.*`
  — avoids teacher privilege escalation into rule config/evaluator). Teacher scope = `assignedTo = me ∪ null`;
  out-of-scope id → 404. Teacher/admin list+resolve UI + sidebar entries + dashboard chip.
- **In-app assignee notification** via `NotificationsService.createMany` (no new BullMQ queue, no email/push).

## Decisions carried across slices (S3 additions)
- **First schema migration of the epic.** S3 breaks the "no new tables" streak deliberately — promoting the
  intent into a notifiable, triageable queue requires a first-class row. Ships via `prisma db push` (this repo
  has no migration files — established convention). No new ADR: reuses existing audit + notification patterns.
- **Dedicated `meeting_requests.*` permissions, not `alerts.*`.** Least-privilege; the teacher realm-role grant
  is effective on restart (PermissionsGuard reads `REALM_ROLE_PERMISSIONS` directly), but the **permission seed
  must be re-run** so the two new catalog entries land in the DB.
- **Application-level tenant scoping (no RLS backstop on `meeting_request`).** Consistent with `AlertsService`/
  `NotificationsService` (not a regression) — isolation rests on the explicit `where: { tenantId }` on every
  query, which is why the cross-teacher/cross-tenant isolation spec is load-bearing.

## Carried gaps / debt for S4 (or a follow-up — flagged by the verify panel, do NOT lose)
- **Prisma client regen / `db push` is a required pre-merge operator step.** The schema edit is committed but no
  regenerated client / migration is in the diff; typecheck only passes after `prisma generate` + `prisma db push`.
- **« Clôturer » is a mislabel.** The FE sends `{ status: 'cancelled' }` but the BE `resolve` controller takes no
  `@Body` and hardcodes `status: 'resolved'` — clicking « Clôturer » resolves (not cancels); the `cancelled` enum
  value + the "Clôturées sans suite" KPI are unreachable. Fix: accept `{ status?: 'resolved' | 'cancelled' }`,
  validate the open→terminal transition, stamp the audit `after` from the chosen status.
- **CRON-raised alerts (schoolId=null) are invisible in the action center.** The list always pins
  `schoolId = <concrete>`, but cron stamps `MeetingRequest.schoolId = null`. Backfill the schoolId from the
  student's enrollment, or let the admin scope tolerate `schoolId: null` within the tenant.
- **Count/list scope mismatch.** `analytics.teacherActionCenter` omits `schoolId` from the pending-count `where`
  while the list page adds it — the dashboard chip can over-count in a multi-school tenant.
- **a11y: two `text-slate-400` text nodes fail WCAG AA contrast** (`MeetingRequestList.tsx:316` relative time,
  `MeetingRequestActions.tsx:40` em-dash) — bump to `text-slate-500`+. The error `aria-live` region is gated
  behind `error &&` (mount-at-announce is unreliable) — keep it always mounted, toggle text only.

## S4 — shipped (needs human review)
**Weekly parent digest (opt-in)**: a `apps/worker` cron emails each opted-in guardian a 1-screen Monday-morning
summary (global trend, new alerts, upcoming assessments, one recommended action per child), honoring
`NotificationPreference`. *(worker + api + prefs UI; `[schema][auth]` tag.)*

Self-contained story spec: [`stories/S4-weekly-digest.md`](./stories/S4-weekly-digest.md). What landed:
- **Additive `weekly_digest` `NotificationKind`** (`apps/api/prisma/schema.prisma`) — **no new table**. Idempotency
  rides a deterministic v5-shaped marker UUID stuffed into the existing `Notification.sourceId @db.Uuid` with
  `readAt` pre-set (so the marker never increments the unread bell count). Consistent with E1's "reuse status/audit,
  minimize schema" line. **Requires a pre-merge `prisma:generate` + `db push`** (no migration file in the diff —
  established repo convention; the routine gate compiled against a stale client until regenerated).
- **Email-only opt-in wired end-to-end**: `NOTIFICATION_KINDS`/labels/descriptions (api `preferences.service.ts`),
  the email KIND_META (worker `notification-email.template.ts`), and the shared `PreferencesPanel` — which now
  excludes the digest from In-app/Push bulk toggles + column totals and renders the In-app/Push cells as a muted
  `—` placeholder (email switch only). Parent settings copy + a violet "summary" accent row. Opt-in defaults OFF
  (RGPD-aligned).
- **New worker module `apps/worker/src/modules/parent-digest/*`**: cron (`setInterval` + `running` re-entrancy
  guard + `OnApplicationBootstrap/OnModuleDestroy` — byte-for-byte parity with `AlertsCronService`, no
  `@nestjs/schedule`/BullMQ → no ADR), tenant-scoped aggregate service, ISO-week helpers, a branded email template,
  types, and 2 spec files. Recipients resolve through `NotificationPreference(weekly_digest, emailEnabled) →
  active Guardianship → Student`, all hard-scoped by `tenantId`; a non-guardian who opts in resolves zero children
  and is skipped (no leak). Per-tenant/per-guardian loops are best-effort isolated; a send failure writes **no**
  marker so the next tick retries.

## Decisions carried across slices (S4 additions)
- **No new table for the digest.** S4 returns to the "minimize schema" line (S3 was the deliberate exception):
  the weekly sent-marker is a deterministic-UUID `Notification` row, not a new model — idempotency is an
  application-level check-then-act keyed on `digestMarkerId(tenant, profile, isoWeek)`.
- **Cron parity over new infra.** The digest reuses the exact `AlertsCronService` shape rather than introducing
  `@nestjs/schedule` or a BullMQ schedule — no new architectural decision, so **no ADR**.
- **Worker assumed single-instance.** The idempotency marker is process-local (`running` guard + check-then-act,
  **no DB unique constraint** on `Notification(tenantId, userProfileId, sourceId)`), so multi-replica workers can
  double-send. Safe as a single instance; see carried debt below before scaling out.

## Carried gaps / debt for E2 (or a follow-up — flagged by the escalation panel, do NOT lose)
- **RED GATE — two blockers were resolved in post-verify hardening, must be re-confirmed by the operator.**
  (A) the stale `@prisma/client` (regenerated via `pnpm --filter @pilotage/api prisma:generate`; **not wired into
  the typecheck/build gate** — re-run before merge/deploy), and (B) a genuine `noUncheckedIndexedAccess` null-safety
  bug at `digest-email.template.ts:172` (`input.children[0]` unguarded → fixed by destructuring + a
  `childCount === 1 && firstChild` guard). Re-run `pnpm typecheck` after regen to confirm green.
- **Multi-replica double-send (the #1 human-attention item).** No DB unique guard on the weekly marker; two worker
  replicas (or a restart mid-window) can both pass `findFirst` → both `send` → both `create`. Fix before scaling
  out: a partial unique index on `Notification(tenant_id, user_profile_id, source_id) where source_type='weekly_digest'`
  (turns idempotency into a DB invariant), or move the marker `create` to a fail-closed pre-send write.
- **Digest average diverges from the parent dashboard it links to (Quinn, major ×2).**
  `digest-aggregate.service.ts:71-108` filters grades `status: 'published'` only and applies **no active-academic-year
  scoping**, whereas the canonical dashboard average uses `status: { in: ['published','revised'] }` scoped to the
  active `academicYearId`. A corrected/`revised` grade is dropped from the digest but counted on the dashboard, and
  prior-year grades leak in — so the email's "where is my child overall" number can contradict the dashboard CTA
  target (single-source-of-truth violation). Fix: mirror the dashboard query (status set + active-year scope) in
  both the global-average and the window-trend source set.
- **Weekly marker surfaces as a phantom "read" item in the notification list (Quinn, major).** The bell *count* is
  unaffected (filters `readAt:null`), but `NotificationCenter` fetches the full list (no `unreadOnly`), so the marker
  shows as a label-less pill (`weekly_digest` is not in the web-local hand-maintained `KIND_LABEL`/`KIND_ICON`/filter
  union) every week, forever. Fix: give the marker an out-of-band `sourceType` the list query excludes (preferred), or
  add `weekly_digest` to the web union + maps.
- **Cron drift / restart can silently skip a whole week (Edge Hunter, minor).** The send gate is an exact 1-hour band
  (`getUTCHours()===SEND_HOUR`) with a 1h interval; `setInterval` forward-drift or a restart past the window misses the
  week with no catch-up. Fix: send on `SEND_DOW && getUTCHours() >= SEND_HOUR && no marker this week` (the marker already
  prevents double-send).
- **Bad `DIGEST_SEND_DOW`/`DIGEST_SEND_HOUR` env silently disables the feature (Edge Hunter, minor).** `Number(...)`→`NaN`
  makes every gate false with no warning. Fix: validate at bootstrap (range-check, fall back + `logger.warn`).
- **a11y: the In-app/Push `—` placeholder fails WCAG 2.2 AA contrast (A11y, minor).** `text-slate-400` (#94a3b8) on the
  near-white digest row is ~2.7:1 (< 4.5:1 required, and the story's own AC). Fix: bump to `text-slate-500`/`-600`; keep
  the existing `aria-label`/`title`.
- **`WEB_PUBLIC_URL` default is dev-port-wrong** (`http://localhost:3000`; app runs on 3100) — pre-existing parity with
  `notifications-email.processor.ts`, cosmetic, not introduced here.
