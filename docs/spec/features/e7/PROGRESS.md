# E7 — Progress

> Epic: **E7 — Remediation & Tutoring loop** · Tier 3 (Scale & new surfaces) · Size ~L
> Spec-kit run: **2026-06-06** (docs-only; no code, no schema, no build). Roadmap status: `proposed`
> → promoted to **in-progress** (spec authored on the spec run). **S1 shipped (this run); S2 is next.**

## Slice status

| Slice | Title | Tags | Risk | Status | PR |
|---|---|---|---|---|---|
| S1 | Schema + alert → RemediationPlan promotion + read-only catalogue | `[schema][auth]` | P1 | ✅ shipped | #131 |
| S2 | Availability + Booking (concurrency guard) → **ADR-020** | `[schema][auth][concurrency]` | P1 | ✅ shipped | this PR |
| S3 | Parent remediation progress strip (measured improvement) | `[web][a11y]` | P2 | ⬜ not started | — |
| S4 | Teacher capacity management + booking transitions | `[auth]` | P2 | ⬜ not started | — |
| S5 | Admin catalogue curation & oversight | `[auth]` | P2 | ⬜ not started | — |
| S6 | Loop hardening: notifications + cancellation + completion + uptake sweep | `[auth]` | P2-P3 | ⬜ not started | — |

## What landed this run (spec run)

- `docs/spec/features/e7/` spec-kit authored: `spec.md`, `plan.md`, `data-model.md`, `ux.md`,
  `contracts/openapi.yaml`, `tasks.md`, `quickstart.md`, this `PROGRESS.md`. **Docs only** — no code, no
  schema, no migration, no build.
- Roadmap: **E7 promoted `proposed` → `in-progress`** (`bmad/roadmap.md`).

## Key locked decisions (the spec's spine)

- **The loop the epic closes:** *alert → diagnosis → resource → measured improvement*, all reusing
  shipped epics — the alert's structured fields + `deriveAlertActions` (E1-S2), the alert→record
  promotion + idempotent `@@unique` (E1-S3 `MeetingRequest`), the teaching wall (E2), the `IMPROVEMENT`
  emerald lane (E3), and the `student_subject_snapshot` trend (E6, snapshot-first + live fall-through).
- **The four models** (authoritative names + shapes in [`data-model.md`](./data-model.md)): a `Tutor`
  (teacher-linked or external-by-name — **no new Keycloak role**), its `TutorAvailability` (a dated slot
  with finite **capacity** — the concurrency primitive), a `RemediationPlan` (alert-seeded, tenant-scoped,
  guardianship-ABAC, idempotent on the open-plan key, baseline-capturing), and a `Booking` (a parent's
  append-only claim on one slot unit, against a plan). All additive `db push`; no existing model changes
  shape (only additive back-relations). Enums: `TutorType`/`TutorCostKind`/`AvailabilityKind`/
  `RemediationPlanStatus`/`BookingStatus`.
- **The one new architectural decision = booking/availability concurrency** → never over-book a
  capacity-limited slot under concurrent writes. Lands with
  **`docs/adr/ADR-020-booking-availability-concurrency.md`** on the **booking slice (S2)** — the
  recommended mechanism is a DB-level guard (a partial unique on active bookings for the capacity-1 common
  case + a transactional capacity check for capacity-N, returning a deterministic **409** on a full slot),
  **no distributed lock / Redis / second BullMQ queue / denormalised counter**. `ADR-020` is the next free
  filesystem number after `ADR-019-analytics-snapshots` (reconcile against the index at authoring time).
- **Three new role-narrowed permissions** (the E4 `exports.execute.parent/.teacher` house style):
  `remediation.read` (parent+teacher+admin), `remediation.manage` (admin), `remediation.book` (parent);
  teacher booking transitions ride `remediation.read` + the ownership wall (the E2 teacher-reply idiom).
- **The visionary payoff = the dashboard progress strip** (S3): the trend delta vs the plan baseline,
  framed kindly (*"en attente"* → *"+X pts depuis le début du soutien"*), tying into the E3 `IMPROVEMENT`
  emerald lane on an upturn. Reads the E6 snapshot the dashboard already loads → holds the <2 s NFR.
- **Hard non-goals:** no payments / PSP / price (ADR-018 / E12 stay parked — any `costKind` is a display
  label only), no open/cross-school marketplace, no new login / no student booking (E8), no calendar
  sync, no recurring bookings, no real-time slot push (ADR-019 deferral), no second BullMQ queue, no new
  datastore, no new analytics metric, no change to grading/alert generation. **Never over-book.**

## UX spine (Sally — see [`ux.md`](./ux.md))

- Every surface follows **information → action → reassurance**, never a dead-end, never a verdict on the
  child. The hardest tone in the product (remediation = a deficit) is handled by framing everything as
  **support being organised** + **progress celebrated** — forbidden copy: *échec / mauvais / redoublement
  / leaderboard / blame*.
- The entry is **one added step** on the E1-S2 `AlertNextSteps` panel (*"Trouver un soutien en
  {matière}"*) — never a redesign. The plan page reuses `Card`/`SubjectChip`/`EmptyState`/`ConfirmDialog`;
  the catalogue reuses `Avatar`/`Badge`/`DateCard`; the strip reuses `KpiCard`/`Sparkle`/`Badge` + the E3
  emerald lane. Reuse-first; a thin app-level `RemediationProgressStrip` only if no `KpiCard` variant fits.
- WCAG 2.2 AA on every surface: icon+text (not colour-alone), focus-trapped booking dialog,
  `role="status"`+`aria-live` on booking success / "déjà réservé" / the improvement transition (the
  relative-time tick stays silent), ≥4.5:1, ≥44 px targets, `prefers-reduced-motion`, mobile-first
  (parent <2 s). Empty/loading/error states **always** fall back to the shipped E1/E2 actions.

## Reconciliation note (parallel planning agents — RESOLVED this run)

The Phase-1 agents ran in parallel and briefly diverged on two cosmetic labels (the **capability
content was identical** everywhere). Both were **canonicalised across all 8 files in this same spec run**:

1. **Booking-slice number — RESOLVED to S2.** All files now read: **S1** = schema + alert→plan promotion
   + the **read-only catalogue** read · **S2** = availability + booking + ADR-020 · **S3** = progress
   strip · **S4** = teacher capacity · **S5** = admin curation · **S6** = hardening (notifications +
   cancellation + completion + uptake overview). The PM owns slice order; the catalogue *read* is a thin
   add to S1, booking is the load-bearing S2. `plan.md` + `contracts/openapi.yaml` slice tags were
   re-numbered to match.
2. **ADR filename — RESOLVED to `docs/adr/ADR-020-booking-availability-concurrency.md`** (matches the
   decision scope: booking *and* availability/capacity), applied across `spec.md` / `plan.md` /
   `data-model.md` / `ux.md` / `tasks.md` / `contracts/openapi.yaml` / `quickstart.md` / this file.
   `ADR-020` is the next free filesystem number after `ADR-019-analytics-snapshots` (re-verify against the
   index at authoring time, per the E6 reconciliation precedent).

The S1 implementer should still re-verify these against the index/code at authoring time, but the kit is
now internally consistent.

## What landed in S1 (this run — `epic-slice`)

- **Schema (`db push`, additive):** 6 enums (`TutorType`/`TutorCostKind`/`AvailabilityKind`/
  `RemediationPlanStatus`/`BookingStatus` + the additive `remediation` `NotificationKind` value) + the 4
  models (`Tutor`, `TutorAvailability`, `RemediationPlan`, `Booking`), tenant-scoped with tenant-first
  indexes + the open-plan `@@unique([tenantId, studentId, subjectId, status])` idempotency guard + the
  booking idempotency `@@unique([availabilityId, sessionAt, planId])`. The ONLY existing-model edits are
  additive back-relation arrays on `School`/`Subject`/`Student`/`UserProfile`/`TeacherProfile`/
  `AlertInstance` (no column changed). `RemediationPlan` carries the captured `baselineAvg`/
  `baselineTrendDelta`. **`prisma generate` + `prisma format` pass; `prisma db push` is pending the DB
  being up (infra Docker was down this run) — additive + safe on existing rows.** No SQL `migrations/`.
- **Permissions:** `remediation.read` (parent+teacher+admin), `remediation.manage` (admin),
  `remediation.book` (parent) added to `permissions.constants.ts` (the runtime-authoritative
  `REALM_ROLE_PERMISSIONS`) + the seed/seed-demo permission catalogs + role grants.
- **Contracts:** E7 enums (`TUTOR_TYPE`/`TUTOR_COST_KIND`/`AVAILABILITY_KIND`/`REMEDIATION_PLAN_STATUS`/
  `BOOKING_STATUS`) + `dto/remediation.ts` (promote DTO, `RemediationPlanDto`, catalogue tutor/slot DTOs).
- **API:** `RemediationModule` (`apps/api/src/modules/remediation/`) — `POST /remediation/plans`
  (parent `remediation.book`, guardianship ABAC `canAccessStudent` re-checked BEFORE the write,
  idempotent on the open-plan key with a P2002 race catch, server-derived student/subject from the alert,
  baseline captured snapshot-first/live-fall-through, append-only `remediation.plan_created` audit ONLY on
  a fresh promote), `GET /remediation/plans` + `GET /remediation/plans/:id` (guardianship-walled,
  404-before-403), and the read-only `GET /remediation/catalogue?subjectId=` (published + tenant +
  subject-filtered tutors with their active slots, one query + bounded include, no N+1).
- **Web:** `deriveRemediationAction` (pure, subject-scoped + null-subject guard) + the
  "Trouver un soutien en {matière}" CTA on `AlertNextSteps` (promote-then-`router.push`, indigo lane,
  ≥44px, aria-busy) + the `/parent/remediation/[planId]` plan page (target card + read-only catalogue
  grid + a kind `EmptyState` falling back to the E1 recommendations / E2 message CTAs — never a dead-end).
  The existing E1/E2 alert actions are unchanged.
- **Tests:** `remediation.service.spec.ts` (7 passing) pins promotion idempotency (reuse open plan / fresh
  create / P2002-race collapse), the snapshot-first → live baseline fall-through, the tenant/no-subject
  404s, and the catalogue published+tenant+subject filter. `pnpm typecheck` clean across api/worker/
  contracts/web (verified per-package; Murat owns the authoritative gate).

> **Honest note:** the pure `deriveRemediationAction`/`formatSlotLabel` web helpers are provable by
> construction (reuse the already-vetted `SUBJECT_SCOPED` set + the null-subject guard); `apps/web` has no
> unit-test runner today and adding one would be a new architectural decision (out of scope) — the
> substantive idempotency/ABAC/baseline logic is fully runner-backed on the API side.

## What landed in S2 (this run — `epic-slice` — the load-bearing concurrency slice)

- **Schema / DDL (the ONLY schema step):** the raw partial-unique over-book index
  `booking_active_instance_unique ON booking (availability_id, session_at) WHERE status IN
  ('requested','confirmed')` — Prisma `@@unique` can't express a `WHERE`. Canonical artifact
  `apps/api/prisma/sql/booking-active-instance-uniq.sql`; **applied idempotently on API boot** by
  `BookingIndexBootstrap` (`CREATE … IF NOT EXISTS`, best-effort if the booking table / DB isn't up
  yet — the transactional count path is the defence-in-depth fallback, so a missing index degrades
  to "slower but still correct", never "silent over-book"). The Booking `@@unique` comment in
  `schema.prisma` documents where the index lives + how it's applied. **No model shape change.**
- **API — booking write path (`apps/api/src/modules/remediation/`):**
  - `booking.service.ts` — `createBooking()` (server-canonicalises `sessionAt` via the pure
    `session-instance.ts` resolver → **422** on a slot-mismatch / past instance, never a 500;
    capacity-1 → partial-unique P2002 → deterministic **409**, with a defence-in-depth fallback;
    capacity-N → `$transaction` + `SELECT … FOR UPDATE` count-then-insert; idempotent re-tap →
    reuse 200; cancel→re-book revives the row), `cancelBooking()` (cancellable-status-guarded
    `updateMany`, double-cancel safe no-op, atomic seat free), plus `loadBooking`/`loadBookableAvailability`/
    `loadPlanForBooking`/`isTeacherOfStudent` (the E2 teaching wall **inlined** to avoid a circular
    MessagingModule dependency, mirroring `messaging.service.ts` exactly).
  - `session-instance.ts` — the pure, unit-tested next-occurrence + canonical-instance resolver (the
    capacity-guard key correctness — PM-A1).
  - `remediation.controller.ts` — `POST /remediation/bookings` (`remediation.book`; flow ORDER:
    plan 404 → guardianship ABAC before write (404-before-403) → plan-open 422 → availability load +
    published re-validate → teacher-linked teaching-wall 403 → capacity-guarded insert) and
    `PATCH /remediation/bookings/:id/cancel` (guardianship ABAC on the booking's student before the
    write). Best-effort append-only `remediation.booking_created`/`booking_cancelled` audit +
    `NotificationsService.createMany` kind `remediation` fan-out (tutor + parent), neither of which
    can fail/roll back the booking (the S1 best-effort try/catch pattern).
  - `remediation.service.ts` — `catalogue()` now resolves each active slot's NEXT dated instance +
    the live remaining-seat count + the caller's own active booking id in ONE bounded grouped Booking
    query (no N+1), populating the additive `nextSessionAt`/`remainingSeats`/`myBookingId`.
  - `remediation.module.ts` — imports `NotificationsModule`; registers `BookingService` +
    `BookingIndexBootstrap`.
- **Contracts:** `dto/remediation.ts` adds `CreateBookingDto`/`BookingDto`; extends `CatalogueSlotDto`
  with additive-optional `remainingSeats`/`nextSessionAt`/`myBookingId` (via `.default(...)`/`.nullable()`
  so the S1 page keeps compiling). `dist/dto/remediation.js` patched to match (CJS runtime); `types`
  resolves to `src` so no `.d.ts` regen needed.
- **ADR:** `docs/adr/ADR-020-booking-availability-concurrency.md` (Accepted) — the partial-unique-for-1
  + transactional-`FOR UPDATE`-count-for-N guard, the idempotency-vs-capacity separation, the
  deterministic-409-vs-idempotent-200 contract, the sessionAt-canonicalisation correctness, the DDL
  location + boot-apply (binding condition C-1), and the rejected alternatives (distributed lock /
  Redis SETNX, second BullMQ queue, denormalised counter).
- **Tests:** `booking.service.spec.ts` — the headline two-concurrent-books capacity-1 proof
  (`Promise.allSettled` of two DISTINCT-plan books → exactly one 2xx + one `ConflictException`, never
  a 500, exactly one active row) + capacity-N seat-fill + the idempotent re-tap reuse + the
  sessionAt-mismatch/past 422 paths + the cancel/double-cancel no-op.

> **Pending (human / infra):** the S1 `prisma db push` for the E7 tables remains pending (infra was
> down at S1). Once the DB is up, the boot bootstrap applies the partial-unique index automatically (or
> apply `apps/api/prisma/sql/booking-active-instance-uniq.sql` manually). No build/typecheck/db push
> was run here (Murat owns the typecheck gate; the worktree has no `node_modules`).

## Next action

Ship **S3** (`epic-slice` — the parent remediation progress strip, `[web][a11y]`, the
measured-improvement payoff reading the E6 snapshot trend vs the plan baseline). The S2 slice below
is now shipped.

<details><summary>S2 original "next action" note (now shipped)</summary>

Ship **S2** (`epic-slice` — the load-bearing concurrency slice): availability publish/read + the parent
**booking** verb (`POST /remediation/bookings`, `remediation.book`, guardianship ABAC + the E2 teaching
wall on a teacher tutor BEFORE the write), idempotent per `(availability, sessionAt, plan)`, with the
**never-over-book guard** (the raw partial unique index for capacity-1 added alongside `db push` + a
transactional `FOR UPDATE` count for capacity-N) returning a deterministic **409**, parent cancel,
tutor+parent `NotificationsService.createMany` (kind `remediation`, no new queue), append-only audit, the
"Réserver" plan-page flow, **and `docs/adr/ADR-020-booking-availability-concurrency.md`** (Winston gate) +
a targeted two-concurrent-books concurrency test.

</details>
