# E7 — Data model & migration plan (Architect: Winston)

> Companion to [`spec.md`](./spec.md) / [`plan.md`](./plan.md) / [`contracts/openapi.yaml`](./contracts/openapi.yaml) / [`tasks.md`](./tasks.md).
> E7 "Remediation & Tutoring loop" closes the cahier's action loop: an alert's recommendation
> promotes into a **RemediationPlan**, the parent books a **tutoring resource** from an
> admin-curated catalogue, and a calm progress strip measures the improvement — tying back to E3's
> positive `IMPROVEMENT` signal. Four new models: `Tutor`, `TutorAvailability`, `Booking`,
> `RemediationPlan`.
>
> **Migration convention (repo-wide, verified):** `prisma db push`, **no SQL `migrations/` folder**
> (`apps/api/prisma/migrations/` does not exist — same as E1-S3, E2-S1, E2-S4, E3-S1, E3-S2, E5-S2,
> E6-S1). Every E7 table is **net-new and additive**; the only edits to existing models are the
> minimal **back-relation fields** required by the new `@relation`s (see §1.5) — no existing column
> is changed or dropped ⇒ safe on existing rows, zero-downtime (expand-only), **no backfill**.
>
> **FR cross-reference note.** This file's `FR-n` mentions are thematic anchors (e.g. "the concurrency
> guard", "no money") drafted before the spec's FR list was finalised; the **canonical, numbered FR list
> lives in [`spec.md`](./spec.md)** (there: FR-9 = booking concurrency, the finance non-goal is in
> Non-goals). The *content* matches; only the local FR numbers differ — defer to `spec.md` for the
> authoritative numbering.
>
> **Tenant-isolation posture (honest record, per ADR-019).** The repo enforces tenant isolation
> **at the application layer** via explicit `where: { tenantId }` on every query (`PrismaService.
> withTenant` / RLS DDL exists only as intent — see ADR-019 "Tenant isolation posture"). E7 follows
> that prevailing pattern exactly: `tenant_id` is the first column + a tenant-first composite index
> on every table, and every read/mutation carries `where: { tenantId }` (server-derived from the
> JWT via `SchoolContextService.forUser`, never client-supplied). No fabricated RLS DDL.

---

## 0. What already exists (the seams E7 reuses)

E7 is the **capstone of the action loop** — it builds on patterns already proven, not from scratch:

| Asset | Location | Role for E7 |
|---|---|---|
| `AlertInstance` (+ `recommendation`, `subjectId`, `studentId`) | `schema.prisma` `@@map("alert_instance")` | the **diagnosis** a plan is promoted from. E7's `RemediationPlan.alertId` references it (`onDelete: SetNull` — a deleted alert doesn't delete the plan the parent is acting on). |
| `MeetingRequest` (E1-S3) | `schema.prisma` `@@map("meeting_request")` | the **template** for E7's alert→record promotion: an idempotent `@@unique([tenantId, alertId, requestedBy])`, a server-resolved assignee, a small status enum, append-only `AuditLog` alongside the queryable row. `RemediationPlan` mirrors this exactly (FR-2). |
| `Conversation` / `ConversationParticipant` (E2) | `schema.prisma` | the **dual-wall ABAC + lapsed-access-flips-to-read-only** discipline (FR-5). `Booking` transitions re-check the ownership/guardianship wall on every write, like a conversation send. |
| `Subject` / `Student` / `ClassSection` / `TeacherProfile` / `UserProfile` | `schema.prisma` | the existing rows E7's four models reference by id. `Tutor` links a `TeacherProfile`/`UserProfile` (a teacher tutor) or stands alone (external/peer). |
| `NotificationKind` enum + `NotificationsService.createMany` / `dispatchEmails` | `schema.prisma` · `apps/api/.../notifications` | the **notify seam** (FR-4/FR-5): a booking created/confirmed enqueues an in-app + opt-in-email notification via `createMany` — **no new queue, no new template engine**. E7 adds one additive `remediation` enum value. |
| `subjectEvolution` trend figure (E6 snapshot-or-live) | `apps/api/.../analytics/analytics.service.ts` | the **measured-improvement** number the progress strip reads (FR-6) — E7 invents **no new metric**; it reads the existing per-subject term-delta and frames it against `RemediationPlan.createdAt`. |
| E3-S2 emerald `IMPROVEMENT` lane | `apps/web/.../parent/recommendations` + `@pilotage/ui` `Badge` | the **celebration lane** the progress strip lights when the trend crosses the `IMPROVEMENT` threshold (FR-6) — reused, not reinvented. |
| `AlertsCronService` / `SnapshotDrainCronService` worker pattern | `apps/worker/.../{alerts-cron,analytics-snapshots}` | the **structural template** for the S6 booking auto-`completed` sweep (a confirmed session whose datetime passed → `completed`) — a plain cron poll, **no new BullMQ queue**. |

> **Ruling — E7 is a NEW domain surface, but every cross-cutting mechanism it needs already exists.**
> The four models are net-new aggregates, but the *promotion pattern* (E1-S3), the *inbox idiom*
> (E1/E2), the *lapsed-access discipline* (E2), the *notify seam* (`createMany`), the *trend figure*
> (E6), the *emerald lane* (E3), the *cron sweep* (alerts-cron), the *aggregate-endpoint contract*,
> and the *additive `db push`* convention are all reused. The **one genuinely new architectural
> decision** is the booking/availability **concurrency strategy** (FR-7 → ADR-020, §6).

---

## 1. New models (4) + enums

All tables follow the repo conventions verified across the schema: `uuid @db.Uuid` PK,
`tenantId @map("tenant_id") @db.Uuid` first column, `schoolId @map("school_id") @db.Uuid` (nullable
where the parent allows it, matching `AlertInstance`/`MeetingRequest`), `@@map("snake_case")`,
`Timestamptz(6)` timestamps, **tenant-first composite indexes** (ADR-002 intent / ADR-019
application-layer reality), `onDelete` matching the parent's lifecycle.

### 1.0 Enums

```prisma
/// E7 — what the tutoring resource is. A `teacher` tutor links a TeacherProfile/UserProfile
/// (an in-house teacher offering support); `external` is a named partner with no platform
/// account; `peer` is a peer-tutoring programme. Display + filtering only.
enum TutorType {
  teacher
  external
  peer
}

/// E7 — the COST LABEL of a tutor (display-only — NEVER a price; ADR-018 finance isolation).
/// `paid_offline` = a paid tutor settled OUTSIDE the platform; E7 stores no money (FR-9).
enum TutorCostKind {
  free
  volunteer
  paid_offline
}

/// E7 — recurrence shape of an availability slot. `recurring_weekly` = a weekday+time that
/// repeats (the parent books a dated instance of it); `one_off` = a single dated datetime.
enum AvailabilityKind {
  recurring_weekly
  one_off
}

/// E7 — lifecycle of a RemediationPlan. `open` = the parent is actively pursuing support;
/// `met` = the objective was reached (kind, reversible); `closed` = parent/admin closed it
/// (e.g. the alert resolved). NEVER deleted — append-only audit carries the history.
enum RemediationPlanStatus {
  open
  met
  closed
}

/// E7 — booking state machine (mirrors MeetingRequestStatus discipline). A parent books
/// (`requested`); the tutor/teacher confirms (`confirmed`) → the session happens
/// (`completed`); or the parent cancels (`cancelled`), or the tutor declines (`declined`)
/// or proposes another slot (`proposed_alternative`). A small, auditable, append-only machine.
enum BookingStatus {
  requested
  confirmed
  completed
  cancelled
  declined
  proposed_alternative
}
```

### 1.1 `model Tutor` — a tutoring resource published by the school

One row per tutoring resource the admin curates. A `teacher` tutor links an existing
`TeacherProfile` (and its `UserProfile`, so bookings can notify them + the ownership wall resolves);
`external`/`peer` tutors stand alone (a display name + blurb, no account).

```prisma
/// E7 — a tutoring resource curated by the school admin. Parents discover only `published`
/// tutors of their tenant, filtered to the subject. A teacher tutor links a TeacherProfile
/// (notify + ownership wall); external/peer tutors are display-only. `costKind` is a LABEL,
/// never a price (FR-9 / ADR-018). Subjects offered are denormalised as an id array (display
/// + filter) — the catalogue read filters on it; a relation table is overkill for a small set.
model Tutor {
  id              String        @id @default(uuid()) @db.Uuid
  tenantId        String        @map("tenant_id") @db.Uuid
  schoolId        String        @map("school_id") @db.Uuid
  type            TutorType
  costKind        TutorCostKind @default(free) @map("cost_kind")
  /// Display name (the teacher's name, the partner's name, "Tutorat entre pairs — 3e").
  displayName     String        @map("display_name")
  /// Short public blurb shown in the catalogue card (kind, non-stigmatising).
  blurb           String?
  /// Subjects this tutor offers support in (Subject ids). The catalogue read filters on this.
  subjectIds      String[]      @map("subject_ids") @db.Uuid
  /// For a `teacher` tutor: the linked teacher (notify target + ownership wall). Null otherwise.
  teacherProfileId String?      @map("teacher_profile_id") @db.Uuid
  userProfileId    String?      @map("user_profile_id") @db.Uuid
  /// Only published tutors are discoverable by parents. Admin toggles this.
  published       Boolean       @default(false)
  createdBy       String        @map("created_by") @db.Uuid
  createdAt       DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)

  school          School             @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  teacherProfile  TeacherProfile?    @relation(fields: [teacherProfileId], references: [id], onDelete: SetNull)
  user            UserProfile?       @relation("TutorUser", fields: [userProfileId], references: [id], onDelete: SetNull)
  availabilities  TutorAvailability[]
  bookings        Booking[]

  @@index([tenantId, schoolId, published])      // parent catalogue read (published gate)
  @@index([tenantId, teacherProfileId])          // teacher "am I a tutor" + ownership wall
  @@map("tutor")
}
```

**Decisions / rationale**

- **`subjectIds String[]` denormalised, not a join table.** A tutor offers a small handful of
  subjects; an array column (Postgres native, queryable with `has`/`hasSome`) keeps the catalogue
  filter (`where: { subjectIds: { has: subjectId } }`) a single indexed-ish scan without a join
  table to maintain. Precedent: the codebase already uses `Json`/array columns for small sets
  (`ClassSection.options`, `Student.customFields`). If a reviewer prefers a `TutorSubject` join for
  referential integrity, that is an additive fallback — recorded for the S2 story.
- **`costKind` is a label, never a price** (FR-9). No `Decimal`, no `amount`, no `currency` — ADR-018
  finance isolation upheld. A future finance epic adds a payment row referencing `Booking.id`,
  not a column here.
- **`teacherProfileId` + `userProfileId` both nullable.** A teacher tutor carries both (the
  `TeacherProfile` for the roster link, the `UserProfile` for notify + the ownership wall); external/
  peer tutors carry neither. `onDelete: SetNull` so removing a teacher doesn't delete the historical
  tutor row (bookings are preserved).

### 1.2 `model TutorAvailability` — a bookable slot

One row per offered slot. `recurring_weekly` carries `weekday` + `startTime`/`endTime`;
`one_off` carries a concrete `startsAt`/`endsAt`. **`capacity` (default 1)** is the seat count that
drives the FR-7 concurrency guard.

```prisma
/// E7 — a bookable availability slot for a Tutor. `recurring_weekly` repeats on `weekday`
/// at `startTime`; `one_off` is a single `startsAt`/`endsAt`. `capacity` (default 1) is the
/// number of seats — the FR-7 concurrency guard rejects a booking that would exceed it.
/// Published/active slots only are discoverable; a closed slot keeps its bookings (history).
model TutorAvailability {
  id          String           @id @default(uuid()) @db.Uuid
  tenantId    String           @map("tenant_id") @db.Uuid
  schoolId    String           @map("school_id") @db.Uuid
  tutorId     String           @map("tutor_id") @db.Uuid
  kind        AvailabilityKind
  /// recurring_weekly: 0=Mon … 6=Sun (null for one_off).
  weekday     Int?
  /// recurring_weekly: "HH:mm" local school time (null for one_off).
  startTime   String?          @map("start_time")
  endTime     String?          @map("end_time")
  /// one_off: the concrete datetimes (null for recurring_weekly).
  startsAt    DateTime?        @map("starts_at") @db.Timestamptz(6)
  endsAt      DateTime?        @map("ends_at") @db.Timestamptz(6)
  /// Number of seats. The FR-7 capacity guard rejects an over-capacity booking (default 1).
  capacity    Int              @default(1)
  /// Soft-close a slot without deleting it (its bookings + history survive).
  active      Boolean          @default(true)
  createdBy   String           @map("created_by") @db.Uuid
  createdAt   DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime         @updatedAt @map("updated_at") @db.Timestamptz(6)

  tutor       Tutor            @relation(fields: [tutorId], references: [id], onDelete: Cascade)
  bookings    Booking[]

  @@index([tenantId, tutorId, active])           // catalogue: a tutor's open slots
  @@index([tenantId, schoolId, startsAt])         // one-off slot ordering / the S6 completed-sweep
  @@map("tutor_availability")
}
```

**Decisions** — a `recurring_weekly` slot is a *template*; the parent books a **dated instance** of
it (`Booking.sessionAt`), so the capacity guard counts active bookings **per dated instance**, not
per template (see §1.4 + §6 ADR). A `one_off` slot has exactly one instance (its own `startsAt`).
This is the crux the ADR-020 concurrency decision pins.

### 1.3 `model RemediationPlan` — the alert-promoted support plan

One **open** row per `(tenant, student, subject)` (the idempotency invariant, mirroring
`MeetingRequest`). Promoted from an `AlertInstance` (the diagnosis); carries a kind objective and
the plan-start `createdAt` the progress strip frames the trend against.

```prisma
/// E7 — a support plan promoted from an alert's recommendation (FR-2). One OPEN plan per
/// (tenant, student, subject) — the @@unique makes "promote this alert into a plan"
/// idempotent (a second promote reuses the open plan), exactly the MeetingRequest discipline.
/// Status-neutral on the alert (the plan is additive; the alert lifecycle is untouched).
/// `createdAt` is the baseline the progress strip frames the subjectEvolution trend against.
model RemediationPlan {
  id          String                @id @default(uuid()) @db.Uuid
  tenantId    String                @map("tenant_id") @db.Uuid
  schoolId    String?               @map("school_id") @db.Uuid
  studentId   String                @map("student_id") @db.Uuid
  subjectId   String                @map("subject_id") @db.Uuid
  /// The alert this plan was promoted from (the diagnosis). SetNull — a deleted/resolved alert
  /// doesn't delete the plan the parent is acting on.
  alertId     String?               @map("alert_id") @db.Uuid
  status      RemediationPlanStatus @default(open)
  /// Kind, non-stigmatising objective ("Rattraper les bases en mathématiques ce trimestre").
  objective   String?
  /// The parent UserProfile that created the plan (audit actorId parity).
  createdBy   String                @map("created_by") @db.Uuid
  /// Set when status flips to met/closed (kind, reversible).
  closedAt    DateTime?             @map("closed_at") @db.Timestamptz(6)
  closedBy    String?               @map("closed_by") @db.Uuid
  createdAt   DateTime              @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime              @updatedAt @map("updated_at") @db.Timestamptz(6)

  student     Student        @relation(fields: [studentId], references: [id], onDelete: Cascade)
  subject     Subject        @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  alert       AlertInstance? @relation(fields: [alertId], references: [id], onDelete: SetNull)
  creator     UserProfile    @relation("RemediationPlanCreator", fields: [createdBy], references: [id], onDelete: Cascade)
  bookings    Booking[]

  /// One OPEN plan per (tenant, student, subject) — idempotent promote. Note: Postgres treats
  /// every row as distinct on `status` so multiple non-`open` (closed/met) historical rows for
  /// the same (student, subject) coexist; the open-plan singleton is enforced by the partial
  /// unique below at the DB layer (see §1.6) — the @@unique here is the coarse app-level guard.
  @@unique([tenantId, studentId, subjectId, status])
  @@index([tenantId, studentId, status])          // parent "my child's plans"
  @@index([tenantId, schoolId, status, createdAt]) // admin uptake overview (S6)
  @@map("remediation_plan")
}
```

> **Idempotency caveat (called out, like E6's null-term caveat).** `@@unique([tenantId, studentId,
> subjectId, status])` lets multiple **closed/met** historical rows coexist (good — history) while
> still allowing only **one `open`** row per `(student, subject)` *as long as the promote upserts on
> the open-status tuple*. A cleaner DB-level guarantee is a **partial unique index**
> `WHERE status = 'open'` (§1.6) — recorded as the S1 implementer's choice (app-layer
> findFirst-then-create-with-P2002-catch vs. the partial index, exactly the E6 null-term
> delete-then-insert vs. sentinel decision).

### 1.4 `model Booking` — a parent's booking of a slot, against a plan

The heart of the loop. References `(plan, tutor, availability, student)`; carries the **dated
session instance** `sessionAt` (the concrete datetime the recurring/one-off slot resolves to) the
capacity guard counts on; runs the `BookingStatus` machine.

```prisma
/// E7 — a parent's booking of a tutor availability slot, tracked against a RemediationPlan.
/// `sessionAt` is the CONCRETE dated instance (a recurring slot resolves to a date; a one-off
/// is its own startsAt) — the FR-7 capacity guard counts ACTIVE bookings per (availability,
/// sessionAt). Idempotent: one active booking per (availability, sessionAt, plan). The status
/// machine + append-only AuditLog carry the lifecycle (FR-5). NO money stored (FR-9).
model Booking {
  id              String        @id @default(uuid()) @db.Uuid
  tenantId        String        @map("tenant_id") @db.Uuid
  schoolId        String?       @map("school_id") @db.Uuid
  planId          String        @map("plan_id") @db.Uuid
  tutorId         String        @map("tutor_id") @db.Uuid
  availabilityId  String        @map("availability_id") @db.Uuid
  studentId       String        @map("student_id") @db.Uuid
  /// The concrete dated session instance (the FR-7 capacity-guard key). For a one_off this is
  /// the slot's startsAt; for a recurring_weekly it is the booked date's resolved datetime.
  sessionAt       DateTime      @map("session_at") @db.Timestamptz(6)
  status          BookingStatus @default(requested)
  /// Optional kind note (parent ask / tutor proposed-alternative note). Free text, reversible.
  note            String?
  /// The parent UserProfile that booked (audit actorId parity + the guardianship wall).
  bookedBy        String        @map("booked_by") @db.Uuid
  /// Set on confirm/decline/cancel/complete (who + when), append-only audit alongside.
  decidedBy       String?       @map("decided_by") @db.Uuid
  decidedAt       DateTime?     @map("decided_at") @db.Timestamptz(6)
  createdAt       DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)

  plan         RemediationPlan   @relation(fields: [planId], references: [id], onDelete: Cascade)
  tutor        Tutor             @relation(fields: [tutorId], references: [id], onDelete: Cascade)
  availability TutorAvailability @relation(fields: [availabilityId], references: [id], onDelete: Cascade)
  student      Student           @relation(fields: [studentId], references: [id], onDelete: Cascade)
  booker       UserProfile       @relation("BookingBooker", fields: [bookedBy], references: [id], onDelete: Cascade)

  /// Idempotent booking — one row per (availability, sessionAt, plan). A double-tap / double-book
  /// of the SAME slot instance for the SAME plan collapses (P2002-safe). NOTE: this does NOT by
  /// itself enforce capacity across DIFFERENT plans — that is the FR-7 concurrency guard (the
  /// partial unique on active status + the transactional count check), the subject of ADR-020.
  @@unique([availabilityId, sessionAt, planId])
  @@index([tenantId, tutorId, status, sessionAt])   // teacher remediation inbox (S4)
  @@index([tenantId, planId, status])                // the plan view + progress strip (S3)
  @@index([availabilityId, sessionAt, status])        // the capacity-guard count query (FR-7)
  @@map("booking")
}
```

**Decisions / rationale**

- **`sessionAt` is the capacity-guard key, not `availabilityId` alone.** A `recurring_weekly` slot is
  a template booked many times (different dates); the seat count is **per dated instance**. Counting
  active bookings `where { availabilityId, sessionAt, status in (requested, confirmed) }` and
  comparing to `availability.capacity` is the FR-7 check — pinned by ADR-020 (§6).
- **`@@unique([availabilityId, sessionAt, planId])` = idempotent booking** (one active booking of a
  slot instance per plan), the `MeetingRequest`/`Conversation` idempotency discipline. It does **not**
  enforce cross-plan capacity (two *different* plans booking the same capacity-1 instance) — that is
  the **concurrency guard**, deliberately separated (the ADR's subject).
- **No money columns** (FR-9). The booking is the *seam* a future finance epic attaches to.
- **`onDelete: Cascade` from `plan`/`tutor`/`availability`/`student`** — a deleted plan/tutor/student
  reaps its bookings (a disposable downstream record), consistent with `MeetingRequest`/`Conversation`
  cascade choices.

### 1.5 Back-relations on existing models — minimal, additive

Unlike E6 (which used plain `@db.Uuid` cache-row ids with **no** `@relation`), E7's four models are
**domain aggregates** with real referential integrity needs (a booking must point at a live tutor +
plan + student), so they **do** declare `@relation`s. Per Prisma, each forward `@relation` needs a
back-relation field on the referenced model. The additive edits to existing models (the **only**
existing-model changes E7 makes) are:

| Existing model | Added back-relation field (additive) |
|---|---|
| `School` | `tutors Tutor[]`, `tutorAvailabilities TutorAvailability[]` *(or omit — only needed if a reverse query is wanted; declare lazily)* |
| `TeacherProfile` | `tutorRoles Tutor[]` |
| `UserProfile` | `tutorAccounts Tutor[] @relation("TutorUser")`, `remediationPlans RemediationPlan[] @relation("RemediationPlanCreator")`, `bookings Booking[] @relation("BookingBooker")` |
| `Student` | `remediationPlans RemediationPlan[]`, `bookings Booking[]` |
| `Subject` | `remediationPlans RemediationPlan[]` |
| `AlertInstance` | `remediationPlans RemediationPlan[]` |

> These are **purely additive list fields** (no column, no shape change on the existing tables — a
> back-relation is virtual in Prisma, materialised only as the FK column already on the *new* table).
> Each is named to avoid colliding with the existing relation blocks (the `@relation("…")`
> disambiguators mirror the `MeetingRequestRequester`/`ConversationParent` precedent). The S1
> implementer adds exactly these lines; no existing relation is renamed or removed.

### 1.6 The concurrency guard (DB layer) — the ADR-020 crux

FR-7 / AC-6 require: two concurrent bookings of a **capacity-1** slot instance ⇒ exactly one
success, one deterministic 409. The **recommended** DB-level mechanism (the ADR's to ratify):

- A **partial unique index** that, for `capacity = 1` slots, makes a second *active* booking of the
  same instance impossible at the DB layer:
  `@@unique` cannot express a `WHERE`, so this is a **raw partial index** added alongside `db push`
  (a `CREATE UNIQUE INDEX … WHERE status IN ('requested','confirmed')` on
  `(availability_id, session_at)`), guaranteeing **one active booking per instance** when capacity is
  1. For `capacity > N`, the partial unique is dropped and a **transactional count-then-insert**
  inside `prisma.$transaction` with `SELECT … FOR UPDATE` on the availability row (or a
  `Serializable` isolation retry) enforces the seat cap.
- The application catches the unique-violation (P2002) / serialization failure and returns a
  deterministic **409 Conflict** ("Ce créneau vient d'être réservé").

> This is **the one new architectural decision** → **`docs/adr/ADR-020-booking-availability-concurrency.md`**,
> authored on **S2** (the first slice that creates a booking). The ADR records: (a) DB partial-unique
> for the capacity-1 common case vs. transactional `FOR UPDATE`/`Serializable` for capacity-N; (b)
> **why not** a distributed lock / Redis SETNX / a second queue (over-engineering for a school-scale,
> low-contention booking) and why not a denormalised `bookedCount` counter (drift risk); (c) the
> deterministic 409 contract; (d) the idempotent-`@@unique` vs. capacity-guard separation (§1.4). See
> §6 + plan.md §4.

---

## 2. Lifecycle, ABAC walls & audit (parity with E1/E2)

- **Plan create (FR-2):** parent only; `StudentAccessService.canAccessStudent(studentId)` **before**
  the write; idempotent upsert on the open-plan key; append-only `remediation.plan_created`
  `AuditLog` row (`actorId = parent`, `resourceType = remediation_plan`, `resourceId = plan.id`);
  **alert untouched**.
- **Catalogue read (FR-3/FR-4):** parent reads **published + tenant + subject-filtered** tutors only;
  admin reads/writes the full roster (`remediation.manage`). No ABAC on the catalogue itself (it is
  school-public to the school's parents), but the **plan** the catalogue is browsed from is
  guardianship-walled.
- **Booking create (FR-4):** parent only (`remediation.book`); guardianship ABAC on the **plan's
  student**; the FR-7 concurrency guard; `createMany` notify to the tutor's `UserProfile`;
  append-only `remediation.booking_created` audit row.
- **Booking transition (FR-5):** confirm/decline/propose → **tutor-ownership wall** (the booking's
  `tutor.userProfileId === me.id`, re-checked on every write — the E2 lapsed-wall discipline);
  cancel → guardianship wall (the parent who booked, or a guardian of the student). Each transition
  is a guarded state-machine step (illegal transition → 409/422) + an append-only
  `remediation.booking_<status>` audit row. **History never deleted** — status gates writes only.
- **Plan close (S6):** parent/admin closes (kind, reversible) → `remediation.plan_closed` audit row;
  an auto-close when the seeding alert resolves is **reversible** (the parent can reopen).

---

## 3. Read paths — aggregate endpoints (no client N+1)

All E7 reads are **aggregate endpoints** under `/api/v1/remediation/*` (project-context §2,
ADR-drift-safe), each assembling its full payload server-side:

- `GET /remediation/plans` (parent) — the caller's children's plans + per-plan session counts + next
  confirmed session (one query + a grouped booking count, no N+1).
- `GET /remediation/catalogue?subjectId=` (parent) — published + tenant + subject-filtered tutors,
  each with their active availabilities (one query with a bounded `include`).
- `GET /remediation/bookings` (teacher) — the teacher's tutor bookings for the inbox (S4),
  status+date scoped.
- `GET /admin/remediation/overview` (admin, S6) — open-plan / booking-status / demand-by-subject
  counts (grouped aggregates, no per-row fan-out).
- The **parent-dashboard payload** (S5) gains an additive optional `remediation` block (open plans +
  counts + next session + the existing `subjectEvolution` trend delta) — assembled in
  `AnalyticsService` reusing the trend it already computes (E6 snapshot-or-live). **No new metric.**

---

## 4. Index / tenancy / RGPD checklist

- Every new table carries `tenantId @db.Uuid` as its **first** column + a **tenant-first** composite
  read index. Every read/mutation carries explicit `where: { tenantId }` (server-derived; ADR-019
  application-layer isolation). No cross-tenant / cross-school read is possible (the catalogue read
  filters `tenantId + schoolId + published`).
- **ABAC unchanged & reused:** parent guardianship wall (`StudentAccessService`) before any
  plan/booking touching a child; teacher ownership wall before any booking transition. The new
  permissions gate the roles (§5). No endpoint loosens an existing permission.
- **Append-only audit** on every lifecycle transition (no in-place status-history table — the
  `AuditLog` row **is** the history, exactly E1-S1's ruling). Booking/notification side effects are
  best-effort and never block the primary write.
- **RGPD:** no new sensitive personal data — a plan/booking holds ids + a kind label + an optional
  note (the minimal `MeetingRequest` shape). A plan is a **support** record (kind copy), reversible,
  and inherits `Student`/`Subject` deletion via cascade. **No money/price/payment** (FR-9 / ADR-018).

---

## 5. Permissions (seed delta) — three new, role-scoped

Add to `apps/api/prisma/seed.ts` + `seed-demo.ts` + `permissions.constants.ts` (keep aligned), and
to the role grants:

| Permission | resourceType / action | Granted to |
|---|---|---|
| `remediation.read` | `remediation` / `read` | `parent`, `teacher`, `school_admin` |
| `remediation.manage` | `remediation` / `manage` | `school_admin` only (curate the catalogue) |
| `remediation.book` | `remediation` / `book` | `parent` only (create/cancel a booking) |

> Convention match: the E4 `exports.execute.parent` / `exports.execute.teacher` precedent shows
> **role-narrowed** permissions are the house style (a parent-only / teacher-only capability is its
> own permission, never a shared admin scope reused). Booking transitions (teacher confirm/decline)
> ride `remediation.read` **plus** the ownership wall — they are not a separate permission, mirroring
> how the E2 teacher reply rides `messaging.write` + the participant wall.

---

## 6. Migration steps (per slice) + the ADR

> **Slice order is owned by [`spec.md`](./spec.md) / [`tasks.md`](./tasks.md)** (PM). The schema-bearing
> steps map as follows (the full 4-model schema lands once in S1; S2 adds only the partial-unique index):

- **S1 (schema + alert→plan promotion + read-only catalogue):** edit `schema.prisma` — add the 6 enums +
  the 4 models + the §1.5 back-relations → `prisma generate` → `prisma db push`. **All additive** (the
  only existing-model edits are the additive back-relation list fields; no column changed). Add the 3
  permissions to the seed + constants + role grants. Add the additive `remediation` `NotificationKind`
  value. Add the E7 DTOs/enums to `packages/contracts`. Wire `POST/GET /remediation/plans` (parent,
  ABAC, idempotent, audited) + the read-only `GET /remediation/catalogue?subjectId=`. **No booking write
  yet → no ADR yet.** *(If a reviewer prefers the `TutorSubject` join over `subjectIds[]` (§1.1), that
  is the one additive table to add here.)*
- **S2 (availability + parent booking + lifecycle → ADR-020):** publish/read `TutorAvailability` slots +
  the booking create with the **FR-7 concurrency guard** (the raw **partial unique index** added
  alongside `db push`, §1.6, the only schema step in S2) + the booking status machine + parent cancel.
  **Lands with `docs/adr/ADR-020-booking-availability-concurrency.md`** (Winston gate).
- **S3 (progress strip):** the additive `remediation` block on the parent-dashboard payload + the
  `RemediationProgressStrip` UI (trend delta vs the plan `createdAt` baseline, from the E6 snapshot).
  **No schema step.**
- **S4 (teacher capacity):** availability CRUD + the booking transition endpoints (ownership-walled,
  audited). **No schema step.**
- **S5 (admin curation + oversight):** admin `Tutor` publish/approve/retire + the school-scoped
  aggregate overview (`remediation.manage`). **No schema step.**
- **S6 (notifications + cancellation + completion + uptake sweep):** booking/cancellation notifications
  (reuse `createMany`), reversible plan close, the auto-`completed` cron sweep (alerts-cron pattern, no
  queue). **No schema step.**

### ADR recommendation (Winston gate)

E7 introduces **one new cross-cutting decision**: the **booking/availability concurrency strategy**
(how a finite slot is protected from a double-book under concurrent requests). That is a *new
architectural decision* (a concurrency-control choice + a capacity-enforcement seam + a deterministic
409 contract) → per project-context §3 it **lands with a new ADR**: **`docs/adr/ADR-020-booking-
availability-concurrency.md`** — recording (a) the DB partial-unique for the capacity-1 common case vs. a
transactional `FOR UPDATE`/`Serializable` count-check for capacity-N; (b) **why not** a distributed
lock / Redis / a second queue (school-scale, low-contention — a DB guard is correct + simplest), and
**why not** a denormalised `bookedCount` counter (drift risk vs. deriving the truth from the rows); (c)
the idempotent-`@@unique` vs. capacity-guard separation (§1.4); (d) the deterministic 409 contract.
The ADR is authored on the **S2 implementation run** (it documents a decision being made), the first
slice that creates a booking. **ADR number: 020** — the highest ADR on disk is `ADR-019-analytics-
snapshots`, so **020 is the next free filesystem number** (verify against the index at authoring time,
per the E6 reconciliation precedent).

Everything else in E7 is **within existing conventions**: the alert→record promotion +
idempotent-`@@unique` (E1-S3 `MeetingRequest`), the role-scoped inbox idiom (E1/E2), the lapsed-access
discipline (E2), the emerald `IMPROVEMENT` lane (E3-S2), the existing `subjectEvolution` trend (E6),
`NotificationsService.createMany` (no new queue), the aggregate-endpoint contract, the role-narrowed
permission style (E4), additive `db push`, and `@pilotage/ui`. **No other ADR is tripped:** no new
HTTP style, no new state lib, no second BullMQ queue, no payment integration (ADR-018 upheld), no new
domain event name (a future booking event can reuse the outbox seam).
