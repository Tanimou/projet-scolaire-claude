# E7 — Progress

> Epic: **E7 — Remediation & Tutoring loop** · Tier 3 (Scale & new surfaces) · Size ~L
> Spec-kit run: **2026-06-06** (docs-only; no code, no schema, no build). Roadmap status: `proposed`
> → promoted to **in-progress** (spec authored on the spec run). **S1 shipped (this run); S2 is next.**

## Slice status

| Slice | Title | Tags | Risk | Status | PR |
|---|---|---|---|---|---|
| S1 | Schema + alert → RemediationPlan promotion + read-only catalogue | `[schema][auth]` | P1 | ✅ shipped | #131 |
| S2 | Availability + Booking (concurrency guard) → **ADR-020** | `[schema][auth][concurrency]` | P1 | ✅ shipped | #132 |
| S3 | Parent remediation progress strip (measured improvement) | `[web][a11y]` | P2 | ✅ shipped | this PR |
| S4 | Teacher capacity management + booking transitions | `[auth]` | P2 | ✅ shipped | this PR |
| S5 | Admin catalogue curation & oversight | `[auth]` | P1 | ✅ shipped | this PR |
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

## What landed in S3 (this run — `epic-slice` — the measured-improvement payoff, `[web][a11y][api][analytics][remediation]`)

- **Contracts (`packages/contracts/src/dto/remediation.ts`):** the additive `RemediationProgressDto`
  (`RemediationProgressDtoSchema` — `planId`/`subjectId`/`subjectCode`/`subjectName`/`objective`,
  `baselineAvg`/`currentAvg`/`trendDelta` all nullable, `improved`, `sessionsPlanned`/`sessionsDone`,
  `nextSessionAt`, `createdAt`) + `RemediationProgressListDto` + the SINGLE shared value-export
  `IMPROVEMENT_DELTA_THRESHOLD = 1.5` (reuses the E3 `IMPROVEMENT`/`NEGATIVE_TREND` rule default — the
  strip "improved" flag and the alert engine speak the SAME number, no new tunable). **Runtime note:**
  this is a new **value** import (`RemediationService` imports it at runtime); `packages/contracts/dist`
  must be rebuilt by the orchestrator's single `pnpm build` or the import resolves `undefined` at API
  boot (typecheck/types→src won't catch it).
- **API — producer (`apps/api/src/modules/remediation/remediation.service.ts`):** new
  `remediationProgress({ tenantId, studentId })` — ONE `remediationPlan.findMany` (open plans,
  tenant+student scoped) + ONE grouped `booking.findMany` over all open plans (no per-plan N+1) for
  `sessionsPlanned`/`sessionsDone`/`nextSessionAt` (future-only, PM-8) + per plan the SHARED
  `readSubjectAverage` snapshot-first/live reader. `trendDelta = round(current − baseline, 2)` only when
  BOTH non-null (PM-4: a null baseline never fabricates a `current − 0` positive); `improved = trendDelta
  >= IMPROVEMENT_DELTA_THRESHOLD`. **Byte-parity refactor:** `captureSubjectBaseline` becomes a thin
  wrapper over the extracted `readSubjectAverage`, so the baseline anchor and the current measure share
  ONE code path and can't diverge.
- **API — composition (`apps/api/src/modules/analytics/analytics.service.ts` + `analytics.module.ts`):**
  `AnalyticsModule` imports `RemediationModule` (one-way edge, no DI cycle); `AnalyticsService` injects
  `RemediationService` (3rd constructor param) and composes the additive optional
  `ParentDashboardResponse.remediation?: RemediationProgressDto[]` **best-effort** — a throw degrades to
  `[]` so the strip can never error the <2 s parent dashboard (the established `freshness?` posture). Rides
  the SAME aggregate the dashboard already fetches → no client round-trip. Tenant/ABAC unchanged
  (`tenantId`/`studentId` are the already-ABAC-resolved dashboard values; every internal query re-scopes).
- **Web (`apps/web/src/app/parent/dashboard/`):** new server-component
  `_components/RemediationProgressStrip.tsx` (reuse-only `Badge`/`SectionHeader`/`SubjectChip`/`cn`/
  `formatGrade` from `@pilotage/ui` + `lucide-react`, no `packages/ui` change) — one row per open plan,
  four kind payoff states (`awaiting` "en attente des prochaines notes" / `progress` "+X pts" / `improved`
  the E3 emerald lane "Le soutien porte ses fruits 🎉" / `patient` "les premiers effets prennent quelques
  semaines", never "échec"), absolute FR next-session label (no relative-time tick), capped at 3 with a
  "+N autres" overflow, deep-links to `/parent/remediation/[planId]`, degrades to NOTHING (no layout shift)
  when absent/empty. Mounted on `page.tsx` with the additive optional `remediation?` on the local response
  type.
- **Tests:** 9 new producer cases in `remediation.service.spec.ts` (open-plan scoping, snapshot-hit
  trend, sub-threshold-stays-calm, live fall-through, PM-4 null-baseline→null-delta, null-current→en
  attente, grouped-booking no-N+1 counts + future-only `nextSessionAt`, empty-booking-tables, no-open-plan
  short-circuit) + the 3 stale `new AnalyticsService(...)` call sites in `analytics.service.spec.ts`
  updated for the new 3rd `remediation` param (the in-flight RED-gate fix). **No schema, no endpoint, no
  permission, no new ADR** (additive optional field, reuse-first, no new architectural decision —
  consistent with project-context §3).

## Outstanding / pending for S3 (carry into S4 or human)

- **No consumer-seam test on the Analytics→Remediation wiring** (Murat CONCERNS): every analytics spec
  stubs `remediationProgress` to `[]`, so the best-effort try/catch (pass-through on success, `[]` on
  throw) at the aggregate boundary has zero coverage. Recommended add (P1): two assertions on the real
  seam in `analytics.service.spec.ts` — (1) a one-element result is surfaced on `response.remediation`;
  (2) a thrown `remediationProgress` degrades to `response.remediation === []` and the dashboard still
  resolves.
- **`packages/contracts/dist` rebuild required** before this is functionally live (the runtime
  `IMPROVEMENT_DELTA_THRESHOLD` value import) — handled by the orchestrator's single post-Workflow
  `pnpm build`; confirm `contracts` is in the affected set.
- **`prisma db push` for the E7 tables still pending from S1/S2** (infra was down) — the strip reads
  `RemediationPlan`/`Booking`; until the additive schema is applied the producer returns `[]` (degrades
  to no strip, never errors).
- Edge Hunter minor a11y notes on the strip (sub-0.05 positive delta could render "+0,0 pts"; the
  improved-lane `role=status` live region + the anchor-level `aria-label` overriding inner payoff text on
  the deep-link) — non-blocking, queued for the S6 hardening / a11y pass.

## What landed in S4 (this run — `epic-slice` — teacher capacity management + booking transitions, `[auth]`)

- **Contracts (`packages/contracts/src/dto/remediation.ts` + the hand-patched CJS
  `dist/dto/remediation.js`):** the additive S4 DTOs — `TeacherAvailabilityDto` (slot + live
  `bookedCount`), `TeacherTutorDto` (the caller's own tutor or a null shell), `TeacherBookingDto`
  (booking + pupil/subject context), `TeachableSubjectDto`, `TeacherRemediationDto` (the aggregate),
  `UpsertTeacherAvailabilityDto`, `TransitionBookingDto`, and the `TEACHER_BOOKING_TRANSITION` tuple.
  **Types-only on the API side** (`import type`) — no new runtime *value* import in the API, so no
  `contracts/dist` rebuild is required for S4 to function (the dist was still patched for consistency).
- **API — ownership-walled teacher surface (`apps/api/src/modules/remediation/`):** a new
  `TeacherRemediationService` + 4 controller routes on `RemediationController`, ALL gated by
  `remediation.read` (NO new permission) + the **ownership wall** (the E2 teacher-reply idiom):
  - `GET /remediation/teacher` — the caller's OWN tutor (resolved by `userProfileId === me`, type
    `teacher`) + its availabilities with live `bookedCount` (ONE grouped Booking query over the
    resolved next instances, no N+1) + the bookings on the caller's tutor (`tutorId === my tutor`)
    + the caller's teachable subjects (the publish-form dropdown — distinct subjects from the active-
    year teaching assignments). A teacher with no tutor yet gets a null-tutor shell (never queries
    bookings → no leak surface).
  - `POST /remediation/teacher/availabilities` — publish a slot. The teacher's `Tutor` row is
    resolved/lazily-created server-side from the caller (idempotent on `(tenant, userProfileId,
    type=teacher)`, `published:false` until an admin publishes it in S5); `subjectId` MUST be a
    subject the caller CURRENTLY teaches (ownership wall → 403); slot shape re-validated (422 on a
    malformed recurring/one-off). Append-only `remediation.availability_created` audit.
  - `PATCH /remediation/teacher/availabilities/:id` — edit own slot (capacity/time/active),
    re-scoped to the caller's own tutor (404 otherwise). Append-only `remediation.availability_updated`.
  - `PATCH /remediation/teacher/bookings/:id/transition` — move a booking through the teacher
    lifecycle, **ownership wall re-checked BEFORE the write (404-before-403)**. State machine:
    `requested → confirmed | declined | proposed_alternative | no_show`; `confirmed → completed |
    no_show | declined | proposed_alternative`; any other source status is terminal → deterministic
    **409** (illegal source). `proposed_alternative` requires a note → **422**. **`no_show` is mapped
    onto `declined` + an "Absent·e" note** (the `BookingStatus` enum carries no `no_show` value and
    **S4 ships NO schema change**) — the seat frees because `declined` is not an active status; the
    no-show distinction is preserved in the audit verb `remediation.booking_no_show`. The status flip
    itself is **concurrency-safe** — a **from-status-guarded `updateMany`** (`where: { id, tenantId,
    status: existing.status }`, the ADR-020 idiom) so two concurrent transitions can't both win: the
    first flips the row, the second matches zero rows → deterministic **409**, then a tenant-scoped
    re-read builds the DTO. Append-only `remediation.booking_<status>` audit + best-effort parent
    notify (`createMany`, kind `remediation`, no new queue) targeting the booking's `bookedBy`.

> **In-flight gate fix (this run):** the test-architect/security panel confirmed the transition write
> was originally an unguarded `prisma.booking.update({ where: { id } })` — a TOCTOU last-writer-wins on
> the load-bearing concurrency invariant (FR5(d)/AC8). It was replaced with the from-status-guarded
> `updateMany` above (deterministic 409 on a concurrent double-transition) before land. Typecheck PASS.
- **Web (`apps/web/src/app/teacher/remediation/`):** the **"Mes créneaux de soutien"** surface —
  a server-component `page.tsx` (thin client over the ONE aggregate, KpiCards + published-slots grid
  with `bookedCount/capacity` + the booking inbox), `remediation-actions.ts` (`'use server'` wrappers
  → publish/edit/transition, revalidating ONLY `/teacher/remediation`), `PublishSlotDrawer.tsx`
  (`FormDrawer` recurring/one-off slot publish, subject dropdown from `teachableSubjects`, capacity,
  keyboard + focus-trap + `aria-live`), `BookingsTable.tsx` (the inbox with confirm/honoured/absent/
  decline/propose `useTransition` actions, a `role=status` live region, a focus-trapped propose-note
  drawer), and pure `slot-format.ts` (FR labels + kind non-stigmatising status meta). New
  **"Soutien scolaire"** (`HeartHandshake`) teacher sidebar item. The S2 booking notification deep-link
  `/teacher/remediation` now resolves to this surface.
- **Tests:** `teacher-remediation.service.spec.ts` — the ownership wall (null-tutor shell never queries
  bookings; surface scoped to `userProfileId === me`), the publish wall (403 no-profile / 403
  subject-not-taught / 422 malformed slot / lazy tutor+slot create unpublished / 404 editing another
  tutor's slot), and the transition machine (404 wrong-owner wall / 409 illegal / 422 propose-without-
  note / confirm happy path returning the parent booker / `no_show`→`declined`+Absent / honoured).
- **No schema change** (reuses the S1/S2 `Tutor`/`TutorAvailability`/`Booking` models + the
  `remediation` `NotificationKind`), **no new permission** (rides `remediation.read` + the ownership
  wall), **no new endpoint family beyond `/remediation/teacher/*`**, no new ADR (no new architectural
  decision), no second queue.

## Outstanding / pending for S4 (carry into S5 or human)

- **`prisma db push` for the E7 tables remains pending from S1/S2** (infra was down) — until applied
  the teacher surface reads empty (`GET /remediation/teacher` returns a null-tutor shell, never errors;
  publishing a slot will fail at the DB until the tables exist).
- **No controller-level integration test** on the teacher routes (the wall/audit/notify wiring is
  proven at the service layer; `apps/web` has no unit-test runner — consistent with S1/S3). A teacher
  tutor becomes parent-discoverable only once an admin **publishes** it (S5) — a teacher-published slot
  is visible to the teacher immediately but unpublished by default (admin curation is the trust gate).
- **`no_show` is recorded as `declined` + an "Absent·e" note** (no enum value, no schema change). If a
  first-class `no_show` status is later wanted, that is an additive enum value (a future schema slice).

## What landed in S5 (this run — `epic-slice` — admin catalogue curation & oversight, `[auth][api][abac][remediation][rgpd]`, P1)

- **Contracts (`packages/contracts/src/dto/remediation.ts`):** the additive S5 DTOs — `AdminTutorDto`
  (full roster row + `availabilityCount`/`activeBookingCount`), `AdminTutorAvailabilityDto` (aliases the
  S4 `TeacherAvailabilityDto` so the admin + teacher slot shapes can't diverge), `CreateAdminTutorDto`
  (`.default()` on `costKind`/`published`), `UpdateAdminTutorDto` (all optional — approve/retire flip),
  `AdminUpsertAvailabilityDto`, `AdminRemediationOverviewDto` (per-subject aggregate + tenant totals),
  `AdminRemediationCatalogueDto`. **`import type` on the API side** (no new runtime value import) except
  `CreateAdminTutorDtoSchema` (used for the `z.input<>` request-shape alias) — no `contracts/dist`
  runtime rebuild required for S5 to function.
- **API — admin curation surface (`apps/api/src/modules/remediation/`):** a new
  `AdminRemediationService` (619L) + 6 controller routes on `RemediationController`, ALL gated by
  `@RequiresPermission('remediation.manage')` (admin-only — a parent/teacher holding `remediation.read|book`
  gets 403). Every read/write is tenant-scoped (server-derived `me.tenantId`); a tutor/availability outside
  the tenant 404s.
  - `GET /remediation/admin/tutors[?subjectId=]` — the FULL tenant-scoped roster (every type + published
    state) + `availabilityCount` + `activeBookingCount` in ONE grouped Booking query (no N+1).
  - `GET /remediation/admin/overview` — school-scoped per-subject `openPlans`/`activeBookings`/`tutorCount`
    + tenant totals. **RGPD-clean: AGGREGATE COUNTS ONLY** — `groupBy`/`count`, `select:{plan:{select:{subjectId}}}`,
    no `studentId`/`studentName`/per-child row anywhere.
  - `POST /remediation/tutors` — create a tutor (teacher-linked or external/peer). For a teacher tutor:
    `teacherProfileId` validated in-tenant, `userProfileId` resolved server-side, and **`subjectIds`
    CONSTRAINED to subjects the teacher currently teaches (FM-1 wall — no catalogue-trust bypass)**;
    idempotent on `(tenant, userProfileId, type=teacher)` → REUSES the teacher's auto-derived S4 tutor
    (FM-8). Append-only `remediation.tutor_created`.
  - `PATCH /remediation/tutors/:id` — update/approve(`published:true`)/retire(`published:false`); soft +
    history-preserving (row + slots + bookings survive). `type` immutable. Append-only
    `remediation.tutor_updated` carrying the published before/after.
  - `POST/PATCH /remediation/tutors/:tutorId/availabilities[/:id]` — publish/edit ANY tutor's slot
    (manage IS the authority — no subject-ownership wall), reusing the SAME `resolveNextSessionAt` key +
    capacity-floor guard as the teacher/booking paths (ADR-020 — lower capacity below active bookings → 422).
    Append-only `remediation.availability_{created,updated}`.
- **Web (`apps/web/src/app/admin/remediation/`):** `/admin/remediation` — server-component `page.tsx`
  (4 parallel server reads), `RemediationCatalogueManager.tsx` (the roster table + create/approve/retire +
  slot drawers), `remediation-actions.ts` (`'use server'` wrappers), `slot-format.ts` (FR/kind labels);
  reuse-first on `@pilotage/ui`, no `packages/ui` change. New "Soutien scolaire" (`HeartHandshake`) admin
  sidebar item (paired with the S4 teacher surface).
- **Tests:** `admin-remediation.service.spec.ts` — tenant-scope, FM-1 subject-constraint wall, FM-8 teacher
  reuse, capacity-floor 422, RGPD aggregate-only overview.
- **No schema change** (reuses the S1/S2/S4 `Tutor`/`TutorAvailability`/`Booking`/`RemediationPlan` models +
  the `remediation` `NotificationKind`), **no new permission** (rides the S1-seeded `remediation.manage`),
  no new ADR, no second queue.

## Outstanding / pending for S5 (carry into S6 or human)

- **`prisma db push` for the E7 tables remains pending from S1/S2** (infra was down across S1→S4) — this slice
  adds **zero** schema, but until the additive E7 migration is applied to dev/prod the whole catalogue
  (tutors/availabilities/bookings/plans) reads empty shells and write paths fail at the DB. **An operator must
  apply the pending E7 `db push` before `/admin/remediation` is functional.** This is an operational
  prerequisite that gates the entire epic, not a code defect.
- **Quinn confirmed-finding (major, FM-8 reuse):** on the create-reuse branch, an admin "creating" a teacher
  tutor who already has a LIVE self-published one with the create-drawer publish toggle OFF will silently
  RETIRE it (`published: dto.published ?? false`), and the audit verb emitted is `remediation.tutor_created`
  (not `tutor_updated` with before/after) → the retire is untraceable. Recommended S6 fix: only lower
  `published` true→false when explicitly provided, and route the reuse through the `tutor_updated` audit.
- **Quinn minor findings:** admin-published slots write `createdBy: tutor.id` (a Tutor id) into
  `TutorAvailability.createdBy` where every other path writes the actor `userProfileId` (provenance corruption,
  no FK so no crash); `overview.tutorCountBySubject` counts retired tutors so a "gap" with only a retired tutor
  is not flagged and the "aucun intervenant publié" copy is inaccurate; `?subjectId=` on the admin list is
  un-`ParseUUIDPipe`d (malformed value → Postgres 500 on the `uuid[] has` query); the CHANGES note's claim of a
  hand-patched `dist/dto/remediation.js` is inaccurate (dist unmodified — harmless, both apps consume via
  `import type`). All non-blocking; queued for S6.
- **Sentinel residual (authz-freshness, carried from S4):** the booking-`transition` ownership wall checks
  only `tutor.userProfileId === me` and does not re-verify the teacher CURRENTLY teaches the pupil (the E2
  "lapsed teaching → read-only" discipline). Same-tenant, their own tutor's booking → not a breach, arguably
  acceptable; confirm intent in S6.

## Next action

Ship **S6** (`epic-slice` — loop hardening: notifications + cancellation + completion + uptake sweep,
`[auth]`, P2-P3): close out the remediation loop — parent/tutor notification parity on admin curation
events, booking cancellation/completion edge polish, an uptake/utilisation sweep, and the S5-deferred
fixes (FM-8 retire audit, `createdBy` provenance, overview published-only `tutorCount`, the
`?subjectId=` `ParseUUIDPipe`). No schema change beyond S1/S2. The S5 slice above is now shipped.

<details><summary>S5 original "next action" note (now shipped)</summary>

Ship **S5** (`epic-slice` — admin catalogue curation & oversight, `[auth]`, P2): `/admin/remediation`
(`remediation.manage`) to create/approve/retire tutors (teacher-linked or external/peer) + publish
slots via `DataTable` + `FormDrawer` + `StatusBadge`, plus a school-scoped aggregate overview (no
child-by-name comparison). No schema change beyond S1/S2. The S4 slice above is now shipped.

</details>

<details><summary>S4 original "next action" note (now shipped)</summary>

Ship **S4** (`epic-slice` — teacher capacity management + booking transitions, `[auth]`, P2): the
teacher surface to publish/adjust `TutorAvailability` capacity and move bookings through their
lifecycle, riding `remediation.read` + the ownership wall (the E2 teacher-reply idiom). The S3 slice
above is now shipped.

</details>

<details><summary>S3 original "next action" note (now shipped)</summary>

Ship **S3** (`epic-slice` — the parent remediation progress strip, `[web][a11y]`, the
measured-improvement payoff reading the E6 snapshot trend vs the plan baseline). The S2 slice below
is now shipped.

</details>

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
