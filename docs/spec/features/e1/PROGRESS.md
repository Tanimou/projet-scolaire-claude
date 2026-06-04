# E1 — Parent Alert Action Loop · PROGRESS

> Spec-kit was **not** written on E1's first run (the codebase was already past the
> "epic-spec first" assumption — admin lifecycle endpoints + parent read shipped), so the
> first E1 run was an **epic-slice**, not a spec run. This folder is being backfilled
> incrementally, one story spec per slice under `stories/`.

| Slice | Title | Status | PR |
|---|---|---|---|
| S1 | Parent ack / mark-handled / dismiss (guardianship ABAC) | **shipped** | [#103](https://github.com/Tanimou/projet-scolaire-claude/pull/103) |
| S2 | "What should I do?" panel on the alert | **shipped** (needs human review) | — |
| S3 | Request a meeting / callback intent → teacher/admin action center | **next** → implement | — |
| S4 | Weekly parent digest (opt-in) | not started | — |

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

## Current slice
**→ S3** — Request a meeting / callback intent surfaced in the teacher/admin action center +
notification, promoting the S2 `alert.meeting_intent` audit row into a queryable `MeetingRequest`
model. *(api + web + worker notif; `[schema]` tag — first migration of the epic.)*
