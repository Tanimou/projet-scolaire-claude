# E7 — Architecture & plan (Architect: Winston)

> Companion to [`spec.md`](./spec.md) / [`data-model.md`](./data-model.md) / [`ux.md`](./ux.md) /
> [`contracts/openapi.yaml`](./contracts/openapi.yaml) / [`tasks.md`](./tasks.md).
> E7 "Remediation & Tutoring loop" closes the cahier's value spine: **alert → diagnosis → bookable
> resource → measured improvement**. It is the most ambitious epic (~L), so it is sliced thin and built
> on **maximum reuse** of the loop E1–E6 already shipped. It is **additive, reversible, and
> non-destructive**: every table is net-new (`db push`), the alert/dashboard UI gains additive elements
> that degrade to today's behaviour, and the existing E1 "request a meeting" / E2 "message the teacher"
> actions are **never removed** — E7 *adds* a rung, it does not replace one.

---

## 1. Where this fits (reuse map)

| Concern | Reuse (do NOT reinvent) | E7 addition |
|---|---|---|
| Alert "what should I do?" surface | `apps/web/src/app/parent/recommendations/{AlertNextSteps.tsx,alert-next-steps.ts,intent-actions.ts}` (E1-S2 `deriveAlertActions` deep-link derivation) | a third action **"Trouver un soutien en {subject}"** that promotes a plan + opens the filtered catalogue — added to the existing derivation, not a new surface |
| Promote-an-intent-to-a-record idempotency | E1-S3 `MeetingRequest` `@@unique([tenantId, alertId, requestedBy])` + catch-`P2002` create | `RemediationPlan` `@@unique([tenantId, studentId, subjectId, status])` (re-tap reuses the open plan) — same pattern |
| Ownership / lapsed-wall ABAC | E2 dual-wall + lapsed-access-flips-to-read-only discipline (re-checked at every send) | a teacher booking-transition (confirm/decline) re-checks the **tutor-ownership wall** (`tutor.userProfileId === me.id`) on every write |
| Parent guardianship ABAC | `StudentAccessService.canAccessStudent` (used on every parent read since E1) | every plan/booking read+write runs **behind** it (the catalogue never widens access) |
| Positive-signal celebration | E3-S2 `IMPROVEMENT` emerald lane on `/parent/recommendations` (code-aware override) | the progress strip reuses the **same emerald celebration idiom** when the trend delta crosses the threshold |
| Fast analytics for the trend delta | E6 `student_subject_snapshot.trendDelta` (snapshot-first + live fall-through; the `subjectEvolution` figure already on the dashboard) | the strip reads the **existing subject trend** from the snapshot the dashboard already loads — no new metric, no new class scan; live fall-through keeps it correct |
| Notification fan-out (S6) | the existing `NotificationsService.createMany` / `dispatchEmails` + `NotificationPreference` per-kind gating (E2-S4 / E5) | a best-effort booking/cancellation notification reuses it — **no new queue, no new processor** (one additive `remediation` `NotificationKind` value at most) |
| Aggregate-endpoint convention | dashboards read pre-aggregated `/api/v1/*`, no client N+1 (project-context §2) | the catalogue + the dashboard plan-strip data are served as **aggregate reads**, not client N+1 |
| Permission model | RBAC + ABAC + custom roles (ADR-015); E4 role-narrowed `exports.execute.parent|teacher` house style | additive role-narrowed `remediation.read` / `remediation.manage` (admin) / `remediation.book` (parent); teacher transitions ride `remediation.read` + the ownership wall (E2 reply precedent) |
| Migration convention | `prisma db push`, **no SQL `migrations/` folder** (verified: `apps/api/prisma/migrations/` does not exist — same as E1-S3…E6-S1) | the 4 new tables land via `db push`, additive |
| Audit | append-only `AuditLog` on every state change (children's data) | promote-plan / book / cancel / approve-tutor / honoured-no-show each write one append-only row (mirrors `meeting_request` / `export.*.request` precedent) |

> **Ruling — E7 is a reuse-dense extension of the existing loop, with exactly ONE genuinely new
> architectural problem: concurrency-safe booking against limited capacity** (§4 / ADR-020). Everything
> else is composition of patterns the codebase already proves.

---

## 2. The spine — RemediationPlan promotion + read-only catalogue (S1), no booking/concurrency yet

The plan is the object that ties the loop together. Its lifecycle:

```
alert (diagnosis: subject, rule, trend)
   └─ parent taps "Trouver un soutien en {matière}"  (E1 AlertNextSteps surface)
        └─ POST /remediation/plans                    (guardianship ABAC, idempotent on (tenant,student,subject,status=open))
             → RemediationPlan { alertId, studentId, subjectId, objective, createdBy, status:open, createdAt(=baseline) }
             → append-only AuditLog (remediation.plan_created)
        └─ GET /remediation/catalogue?subjectId=      (published, subject-filtered tutors — read-only, S1)
        └─ navigate to /parent/remediation/[planId]   (booking is S2)
```

**S1 ships the spine + a read-only catalogue WITHOUT any booking write** — so there is **no over-booking
surface to get wrong yet** (the concurrency problem is deferred to S2, where its ADR lands with the code
that needs it). The whole 4-model schema lands once in S1 (additive `db push`), but S1 only *exercises*
`RemediationPlan` (write) + `Tutor`/`TutorAvailability` (read-only catalogue). Idempotent promotion
reuses the E1-S3 `MeetingRequest` pattern (DB unique on the open-plan tuple + catch-`P2002`), so a
double-tap is safe with **no** new concurrency machinery. The plan's **baseline** anchor is its
`createdAt`: S3 later frames the existing `subjectEvolution` trend against it ("+X pts depuis le début du
soutien").

```
apps/api/src/modules/remediation/
  remediation.module.ts
  remediation.controller.ts          # parent plan-promote + catalogue read (S1); bookings (S2)
  remediation-plan.service.ts        # plan lifecycle (promote/close) — idempotent open-plan upsert
  remediation-catalogue.service.ts   # S1 — tenant + subject + published-filtered tutor listing
  booking.service.ts                 # S2 — the capacity guard (ADR-020); transitions (S4)
  dto/…                              # shared with packages/contracts
```

---

## 3. Read paths — aggregate, snapshot-aware, ABAC-first

- **Catalogue read (parent, S1 read-only):** `GET /remediation/catalogue?subjectId=` → tenant-scoped,
  `published` tutors of the parent's school, filtered to the subject (`subjectIds has subjectId`), each
  with their active availabilities. An **aggregate** response (tutor + subject + slots) — no client N+1.
  The slots become **bookable** in S2.
- **Plan + progress read (parent dashboard, S3):** the dashboard's existing parent aggregate is extended
  (additive) with the active plans for the child + their **trend delta**. The delta reads the existing
  `subjectEvolution` figure (E6 `student_subject_snapshot.trendDelta`, snapshot-first, live
  fall-through), framed against the plan's `createdAt` baseline. **No new metric, no new class-wide
  scan** — the strip rides the snapshot the dashboard already loads, holding the <2 s NFR.
- **Teacher capacity (S4):** `GET /remediation/bookings` (the caller's own tutor's bookings) +
  availability CRUD — ownership wall (the caller's own `Tutor` only), scoped to their pupils.
- **Admin curation (S5):** tutor/availability CRUD (`remediation.manage`). **Admin oversight (S6):**
  `GET /admin/remediation/overview` — `remediation.manage`, school-scoped aggregate counts (plans by
  status, bookings by status, demand by subject), **no child-by-name list**.

All reads keep the **aggregate-endpoint convention** (no client N+1) and the **server-derived tenant /
school context** (`SchoolContextService.forUser`, never client-supplied).

---

## 4. The ONE new architectural decision — booking concurrency (S2 → ADR-020)

**The problem.** A `Booking` consumes one seat of a `TutorAvailability` slot's **dated instance**
(`sessionAt`). Two parents may tap "book this slot" at the same instant; the invariant **"active bookings
for a `(slot, sessionAt)` ≤ capacity"** must hold under concurrent writes. **Nothing in the codebase has
solved a capacity-under-concurrency problem before** — every prior idempotency (`MeetingRequest`,
`Conversation`, `SnapshotRecomputeTrigger`) was a single-row `@@unique` upsert, which prevents
*duplicates* but does **not** enforce a *count ≤ N* invariant. This is therefore a genuine new decision →
**`docs/adr/ADR-020-booking-availability-concurrency.md`** (Winston gate), authored on **S2** (the first
slice that writes a `Booking`; S1 = plans + read-only catalogue, S2 = availability + booking — see
`tasks.md`).

**Recommended decision (the ADR's accepted option) — DB-level guard, no new infra. Two SEPARATE guards:**

1. **Idempotency guard** — `Booking @@unique([availabilityId, sessionAt, planId])`: a re-tap reuses the
   existing booking (catch `P2002` → return the existing row). Prevents the *same plan* double-booking
   the *same instance*. This is **not** the capacity guard (it does not stop two *different* plans
   booking a capacity-1 instance).
2. **Capacity guard** — splits on the common case:
   - **`capacity = 1` (the overwhelming majority)** — a **raw partial unique index** added alongside
     `db push` (`@@unique` cannot express a `WHERE`): `CREATE UNIQUE INDEX … ON booking (availability_id,
     session_at) WHERE status IN ('requested','confirmed')`. This makes a second *active* booking of the
     instance **impossible at the DB layer**, regardless of plan — two concurrent inserts race the index,
     exactly one commits, the other gets `P2002`.
   - **`capacity > 1`** — a **transactional count-then-insert** inside `prisma.$transaction`:
     `SELECT … FOR UPDATE` on the availability row (or a `Serializable` isolation retry), count active
     bookings for `(availabilityId, sessionAt)`, insert iff `count < capacity`.
   Either way a violation maps to a **deterministic `409 Conflict`** ("Ce créneau vient d'être réservé"),
   **never a 500, never an over-book** (FR-2). **No advisory lock, no Redis SETNX, no BullMQ
   serialisation queue, no new datastore.**
3. **Cancel** flips the booking to `cancelled` (its row preserved for audit/history) — which, being
   outside the partial-unique's `status IN ('requested','confirmed')` predicate, **frees the instance**
   for a fresh active booking. A re-book of the same `(availability, sessionAt, plan)` reuses the row
   (flip `cancelled → requested`) so the idempotency `@@unique` still holds.

**Alternatives the ADR weighs and rejects (recorded, not chosen):**
- **A distributed lock / Redis SETNX** per slot — a new external coordination primitive nothing else
  uses, over-engineered for a school-scale, low-contention booking path.
- **A BullMQ serialisation queue** per slot — a **second queue** (an explicit non-goal), heavyweight,
  and adds latency to a synchronous user action.
- **A `bookedCount` counter column with an optimistic guarded decrement** — viable, but a denormalised
  counter can drift from the booking rows (a cancel that forgets the decrement over-counts); the
  partial-unique / `FOR UPDATE` count derives the truth from the rows themselves, so it can never drift.
  (The ADR records this as the runner-up, rejected for the drift risk.)

> **Why this is the right altitude for the ADR.** It is a *cross-cutting persistence/concurrency
> decision* (a new write pattern: a guarded conditional counter), it sets precedent for any future
> capacity-limited booking (E8/E12), and it is the kind of thing project-context §3 explicitly says must
> land with an ADR. It is the **only** E7 tripwire.

---

## 5. ADR posture & tripwires (Winston gate)

**E7 introduces exactly ONE new architectural decision → ADR-020 (booking/availability concurrency),
authored on the S2 implementation run** (it documents a decision being made, not the spec). ADR number
reconciled against the index: the highest ADR file on disk is **ADR-019** (analytics-snapshots, E6-S1),
so **020 is the next free filesystem number** — confirmed.

Everything else stays inside documented conventions and trips **no other** ADR:
- **Permission model (ADR-015)** — additive role-narrowed `remediation.read` / `remediation.manage`
  (admin) / `remediation.book` (parent), the E4 `exports.execute.parent|teacher` house style; teacher
  transitions ride `remediation.read` + the ownership wall. Adding scoped permissions to the existing
  RBAC model is **using** ADR-015, not a new decision. ✅
- **Aggregate-endpoint convention** — catalogue + dashboard strip are aggregate reads, no client N+1. ✅
- **Tenancy (ADR-002 intent)** — every row + query is tenant-scoped via explicit `where: { tenantId }`
  (the prevailing application-layer isolation pattern — same honest posture ADR-019 recorded; no
  fabricated RLS DDL the codebase never sets). ✅
- **`db push` migration convention** — 4 additive tables, no existing column changed. ✅
- **Notification reuse (S6)** — booking notifications reuse `NotificationsService` + `NotificationPreference`,
  **no new queue, no new processor, no new `NotificationKind`** beyond at most one additive kind if a
  reviewer insists (prefer reusing `message`/`system`); flagged as a sub-decision in the S6 story, not an ADR. ✅
- **Audit convention** — append-only `AuditLog` on every state change (children's data). ✅

**Tripwires that would require a SECOND, separate decision (and are therefore non-goals):**
1. **Any payment / PSP / price storage** — the parked finance epic (E12, ADR-018); E7 books free support.
2. **A second BullMQ queue** (e.g. per-slot serialisation, or a booking-reminder queue) — the concurrency
   guard is in-Postgres (ADR-020); reminders reuse the existing dispatcher.
3. **A new Keycloak role / login** for tutors or students — tutors-who-are-teachers reuse their login;
   external tutors are name-only records; students don't book (that's E8).
4. **An external calendar/scheduling integration** (ICS, Google Calendar) — out of scope; availability is
   plain in-Postgres slots.
5. **An open cross-tenant tutor marketplace** — the catalogue is strictly within-tenant + admin-curated.

---

## 6. Risk & sequencing

- **Concurrency risk (highest, and isolated to S2).** Over-booking a slot instance is the one path that
  can be *wrong* under load. Mitigation: the DB-level capacity guard (partial-unique for `capacity = 1`,
  transactional `FOR UPDATE` count-check for `capacity > 1`; ADR-020) + a **targeted concurrency test**
  (two simultaneous books of a 1-capacity instance → exactly one wins, never a 500, never an over-book)
  is the gate on S2 landing. S1 ships plans + a **read-only** catalogue (no booking write), so the spine
  + catalogue are safe before the concurrency problem is even introduced.
- **ABAC-surface risk.** Booking is a new write that touches a child + a teacher — the guardianship
  check must run **before** any write, the catalogue must be **published+tenant-filtered**, and teacher
  transitions must re-check the **ownership wall**. Mitigation: reuse the `StudentAccessService` check +
  the E2 ownership/lapsed-wall discipline verbatim; Sentinel reviews S1+S2; every write is audited.
- **Parity / measurement honesty risk (S3).** The progress strip must show a *truthful* delta.
  Mitigation: it reads the **E6 snapshot** `subjectEvolution` trend (snapshot-first, live fall-through —
  never a wrong number) framed against the plan's `createdAt` baseline; the strip is encouraging but
  never overstates (it shows the real delta, and only flips to the emerald "en progrès" lane when the E3
  `IMPROVEMENT` threshold is actually crossed).
- **Scope risk (it's ~L).** Mitigation: six thin slices, each independently demoable + revertible; S1
  (the alert → plan spine + a browsable catalogue) already delivers visible value (an alert now leads to
  a tracked plan + a real resource list) before the concurrency slice (S2).
- **Reversibility.** Every table is additive (`db push`); the alert action + dashboard strip are additive
  UI degrading to today's behaviour; the existing E1/E2 actions are untouched. Dropping every E7 table
  returns the platform to its pre-E7 behaviour with no data loss to existing surfaces.
