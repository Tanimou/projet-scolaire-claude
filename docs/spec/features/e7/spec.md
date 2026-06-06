# E7 — Remediation & Tutoring loop

> **Status:** in-progress (spec run) · **Size:** ~L · **Tier:** 3 (Scale & new surfaces)
> **Why now:** E1–E6 are all `shipped`. E1 made the alert **actionable** (ack / "what should I do?" /
> request a meeting), E2 gave the parent a **channel** to the teacher, E3 completed the **7-rule
> engine** (including the positive `IMPROVEMENT` signal), and E6 made the analytics **fast at scale**.
> The value spine the routine has built — *alert → explanation → contact → measured signal* — has one
> missing rung: **a recommendation that turns into a real, bookable RESOURCE, and a way to watch the
> child actually improve.** E7 is that rung. It is the cahier's defining promise — *"turn information
> into action"* — taken to its conclusion: **alert → diagnosis → resource → measured improvement.**
> **Audit:** remediation/tutoring ~0% — there is **no** `Tutor` / `Availability` / `Booking` /
> `RemediationPlan` model anywhere; today an alert's recommendation is a **read-only sentence** with a
> deep-link to a subject or a "request a meeting" intent (E1-S2), and nothing tracks what happened next.

## Vision

Today a parent who opens an alert reads, kindly: *"Mathématiques est en difficulté (moyenne 8,5/20,
en baisse). Suggestion : renforcer cette matière, contacter l'enseignant."* That sentence is the end
of the road. The parent now has to leave the platform, find a tutor or a support resource on their
own, and — crucially — **the platform never learns whether anything got better.** The loop the cahier
promises (information → action) stops at *information about a recommendation*; the **action** and the
**measured outcome** are missing.

E7 closes that loop. It introduces a small, school-curated **remediation catalogue** — tutors and
support resources (a teacher offering after-class help, a peer-tutoring slot, a documented revision
resource) — each with **bookable availability**. An alert's *"what should I do?"* recommendation gains
a concrete next step: **"Réserver un soutien en Mathématiques."** One tap promotes the recommendation
into a **RemediationPlan**: a tracked, non-stigmatising commitment that says *"we're working on
Mathématiques — here's the plan."* The parent picks a tutoring resource and **books a session** against
its availability. From then on, the parent dashboard shows a calm, encouraging **progress strip** for
that plan: the target subject, the sessions planned/done, the next session, and — the payoff — the
**observed trend delta** on that subject since the plan started, tying directly back to E3's positive
`IMPROVEMENT` signal. When the subject turns the corner, the strip celebrates it: *"Mathématiques : +2,1
pts depuis le début du soutien — en progrès."*

**The parent value, in one sentence.** A parent no longer just *learns* their child is struggling — they
get a **one-tap path to a real resource**, a **plan they can see**, and **proof, on their own dashboard,
that it is working.** The alert stops being a worry and becomes the start of a visible recovery.

**The visionary spine — the remediation tracker that closes the loop.** E7's organising idea is the
**RemediationPlan as the spine that ties alert → diagnosis → resource → measured improvement into one
visible object.** It is *seeded* by an alert (carrying the diagnosis: subject, rule, threshold, trend),
*acted on* by booking a resource, and *measured* by re-reading the same E6-fast analytics it came from —
folding the result back onto the dashboard as a kind progress strip that reuses E3's `IMPROVEMENT`
emerald celebration lane. Nothing about it is stigmatising: it never compares the child to a named peer,
it frames remediation as **support the platform is organising for you**, and it celebrates progress
rather than dwelling on the deficit. It is the cahier's "turn information into action" promise made
**end-to-end and measurable**.

## Users & why

- **Parent — the core user.** Gets the headline value: an alert's recommendation becomes a **bookable
  action** and then a **tracked, encouraging plan** on the dashboard the cahier centres on. They can
  see, at a glance, *which subject we're remediating, what's booked next, and whether it's working* —
  the missing two of the cahier's five questions ("what action should I take?" answered with a real
  resource; "is it improving?" answered with a measured delta). No stigma, no leaving the platform.
- **Teacher / tutor.** Can **offer remediation capacity** — publish availability for after-class help or
  a support slot — and **see who has booked**, turning the vague "talk to the teacher" outcome into
  scheduled, lightweight support. The teacher's existing teaching relationship (E2's wall) gates who can
  book them, so capacity stays within their own pupils. A teacher is the most common kind of `Tutor`.
- **Admin / school.** **Curates the catalogue** — approves tutors, publishes school-run support
  resources, and oversees bookings — so the resource list is trustworthy and within-school (never an
  open marketplace). The admin owns the catalogue the parent books from; E7 stays a school-internal,
  RGPD-clean tool, not a third-party platform.
- **The platform itself.** E7 is the **first surface that writes an outcome back into the loop** — it
  consumes E6's fast analytics to *measure* a plan, reuses E3's `IMPROVEMENT` signal to *celebrate* it,
  and reuses E2's wall to *scope* booking. It makes the platform's core promise demonstrably true and
  lays the booking/scheduling substrate that later surfaces (student portal, payments) can build on.

## Concrete scenarios

1. **An alert becomes a plan, then a booking (the headline).** A parent opens the
   `LOW_SUBJECT_AVG` alert on Mathématiques on `/parent/recommendations`. The existing "what should I
   do?" panel (E1-S2) now shows a third, concrete action beside "renforcer la matière" and "contacter
   l'enseignant": **"Trouver un soutien en Mathématiques."** Tapping it opens the **remediation
   catalogue filtered to Mathématiques** — the school's maths tutors and support resources with their
   next available slots. The parent picks "M. Diallo — soutien maths, mardi 17 h", which **creates a
   RemediationPlan** (seeded by this alert: subject = Maths, baseline trend captured) **and a Booking**
   for that slot. The alert's recommendation is no longer a dead sentence — it produced a tracked plan
   and a real session.

2. **The progress strip on the dashboard (the payoff).** From the moment the plan exists, the parent
   dashboard shows a calm **remediation strip**: *"Soutien en cours — Mathématiques · 1 séance faite,
   prochaine mardi 17 h · tendance : +0,4 pt."* It is non-alarming, encouraging, and **reads its trend
   delta from the same E6 snapshot** the dashboard already uses (no new live scan). It never names
   another child, never shows a raw deficit — it frames the situation as *"we're on it, here's the
   plan, here's the movement."*

3. **Measured improvement closes the loop (ties to E3).** Three weeks and four sessions later, the
   maths average has risen from 8,5 to 11,2. The progress strip flips to an **emerald celebration**
   reusing E3's `IMPROVEMENT` lane: *"Mathématiques : +2,7 pts depuis le début du soutien — en
   progrès 🎉."* The plan can be marked **completed**. The parent has watched, on their own dashboard,
   an alert turn into a resource turn into a measured recovery — the cahier's whole promise, made real.

4. **A teacher publishes remediation capacity.** A teacher opens a new **"Mes créneaux de soutien"**
   surface and publishes a weekly availability ("mardi 17 h–18 h, soutien maths, 1 place"). They appear
   in the catalogue **only** to parents of pupils they currently teach (E2's teaching wall, reused).
   When a parent books, the teacher sees the booking in their list and can mark it **honoured** or
   **no-show**. Their availability decrements; a double-book of the same slot is impossible.

5. **The double-booking guard (the concurrency-sensitive path).** Two parents tap "book mardi 17 h"
   for the **same** single-capacity slot within the same second. Exactly **one** booking succeeds; the
   other gets a kind *"ce créneau vient d'être réservé — voici les prochains disponibles"* — never a
   double-book, never a 500. This is the path that needs a deliberate concurrency decision
   (**ADR-020**, flagged on the first implementation slice that writes a Booking).

6. **Admin curates and oversees.** An admin opens `/admin/remediation`: approves a new tutor, publishes
   a school-run support resource ("Étude dirigée, lundi & jeudi"), and sees the booking/plan overview
   for the school (counts, no child-by-name comparisons). The catalogue the parent books from is
   **school-curated and within-tenant** — never an open marketplace, never cross-school.

7. **A plan with no resource yet (graceful, never a dead end).** A parent promotes an alert into a
   RemediationPlan but the catalogue has no matching resource yet (small school, subject not covered).
   The plan still exists and still tracks the trend ("Soutien souhaité — Mathématiques · aucune
   ressource disponible pour l'instant"), and the existing E1 "request a meeting" / E2 "message the
   teacher" actions remain available. E7 **adds** a path; it never removes the ones E1/E2 gave.

## Functional requirements

**FR-1 — A school-curated remediation catalogue (Tutor).** E7 adds a tenant-scoped catalogue of
**tutors** — bookable support resources a parent can act on. A `Tutor` is a `teacher` (linked to an
existing `TeacherProfile`/`UserProfile` — an in-house teacher offering support), an `external` named
partner (no platform account), or a `peer` programme, each carrying the subjects it covers
(`subjectIds[]`), a kind, an `active` flag, and an admin-`published` flag so the catalogue stays
trustworthy. A cost is a **label only** (`free`/`volunteer`/`paid_offline` — NEVER a price; ADR-018
finance isolation upheld, FR-9). **The catalogue is admin-curated / teacher-offered — never an open
marketplace, never cross-tenant.** (See `data-model.md` §1.)

**FR-2 — Bookable availability (TutorAvailability) without double-booking.** Each `Tutor` can publish
**availability** — `recurring_weekly` (weekday + time) or `one_off` (a concrete datetime) slots with a
`capacity` (default 1). A `Booking` consumes one seat of a slot's **dated instance** (`sessionAt`) for a
`(student, slot-instance, plan)` and is **idempotent per that key** (re-tapping reuses the existing
booking). **No slot instance is ever over-booked**: the count of active bookings for a `(slot,
sessionAt)` may never exceed its capacity — the rule the **ADR-020 concurrency decision** governs
(FR-9). Booking states: `requested` → `confirmed` → `completed` / `cancelled` / `declined` /
`proposed_alternative`. Cancelling frees the seat.

**FR-3 — Alert → RemediationPlan promotion (the spine).** An alert's "what should I do?" surface
(E1-S2, `/parent/recommendations`) gains a concrete **"Trouver un soutien en {subject}"** action that
**promotes the recommendation into a `RemediationPlan`** — a tenant-scoped, guardianship-ABAC record
seeded by the alert (`alertId`, `studentId`, `subjectId`, `targetRuleCode`, a captured **baseline**:
the subject average/trend at promotion time). Promotion is **idempotent** per
`(tenant, alert, student)` (mirrors the E1-S3 `MeetingRequest` `@@unique` idempotency) — re-tapping
reuses the open plan. A plan has a lifecycle `active` → `completed` / `abandoned`. The alert deep-link
that today reaches a subject view or a meeting intent now **also** reaches a remediation plan + the
filtered catalogue, **without** removing the existing E1/E2 actions.

**FR-4 — Book a tutor slot against a plan.** From a RemediationPlan, a parent **books a `Tutor`
availability slot** for the child, creating a `Booking` linked to the plan. The booking flow is
**guardianship-ABAC** (the parent must guard the child); the catalogue a parent sees is filtered to
**published, within-tenant, subject-relevant** tutors. Booking transitions a teacher acts on
(confirm/decline) re-check the **tutor-ownership wall** (the booking's `tutor.userProfileId === me.id`,
re-checked on every write — the E2 lapsed-wall discipline).

**FR-5 — The remediation progress strip (the measured-improvement payoff).** The parent dashboard
renders a calm, non-stigmatising **progress strip per active RemediationPlan**: target subject,
sessions planned / done, next session, and the **observed trend delta** on the target subject **since
the plan's `createdAt` baseline** — read from the existing `subjectEvolution` trend (E6
`student_subject_snapshot.trendDelta`, snapshot-first, live fall-through; **no new metric, no new class
scan**). When the delta crosses the improvement threshold it **reuses E3's `IMPROVEMENT` emerald
celebration lane** ("le soutien porte ses fruits"). The strip is additive UI — it never blocks the
dashboard, degrades to nothing when there is no active plan, and respects the <2 s NFR by reading the
snapshot the dashboard already loads.

**FR-6 — Teacher capacity & booking management.** A teacher gets a **"Mes créneaux de soutien"** surface
to publish/edit their availability (as a `Tutor` auto-derived from their `UserProfile`) and a list of
**who has booked** their slots, with the ability to mark a booking `honoured` / `no_show`. A teacher
sees only **their own** tutor's availability/bookings (ownership ABAC), scoped to their pupils.

**FR-7 — Admin catalogue curation & oversight.** An admin gets `/admin/remediation` to **publish /
approve tutors** (teacher, external, peer), retire resources, and see a **school-scoped overview** of
plans + bookings (aggregate counts, never a child-by-name leaderboard). Three additive, role-narrowed
permissions gate the roles (ADR-015, mirroring the E4 `exports.execute.parent|teacher` house style):
`remediation.read` (parent/teacher/admin), `remediation.manage` (admin-only — curate the catalogue),
`remediation.book` (parent-only — create/cancel a booking). Parent booking is gated by
`remediation.book` **plus** guardianship ABAC; teacher booking-transitions ride `remediation.read`
**plus** the ownership wall (the E2 reply precedent).

**FR-8 — Tenant / RLS / RBAC / ABAC / audit guardrails (children's data).** Every E7 model is
**tenant-scoped** (`tenant_id`, the prevailing explicit-`where` isolation pattern, ADR-002 intent).
Parent paths re-check **guardianship ABAC** (`StudentAccessService.canAccessStudent`) before any
plan/booking read or write; teacher-tutor paths re-check the **teaching wall** (E2) and **ownership**;
admin curation uses the new `remediation.*` permissions. Every state-changing action (promote a plan,
create/cancel a booking, approve a tutor, mark honoured/no-show) writes an **append-only `AuditLog`
row** (children's-data governance — the booking *is* a record about a child). RGPD: E7 stores only the
minimal coordination data (who booked what slot, plan target + baseline figure) — **no new sensitive
category**, and bookings inherit `Student` deletion via the scope.

**FR-9 — Booking/availability concurrency is a deliberate, documented decision (ADR-020 tripwire).**
The "never over-book a slot instance" invariant (FR-2) is a **concurrency-sensitive write** with no
precedent in the codebase (every prior epic's idempotency was a single-row `@@unique` upsert; a capacity
count under concurrent bookings is genuinely new). The **first slice that writes a `Booking`** (S2) MUST
land with a new **`docs/adr/ADR-020-booking-availability-concurrency.md`** (Winston gate) choosing and
recording the mechanism. The **recommended** option (see `data-model.md` §1.6): an **idempotency
`@@unique([availabilityId, sessionAt, planId])`** (re-tap reuses the booking, catch `P2002`) **separated
from** the **capacity guard** — for the common `capacity = 1` slot, a **raw partial unique index**
(`CREATE UNIQUE INDEX … WHERE status IN ('requested','confirmed')` on `(availability_id, session_at)`,
added alongside `db push`) makes a second *active* booking of the instance impossible at the DB layer;
for `capacity > 1`, a **transactional count-then-insert** (`prisma.$transaction` + `SELECT … FOR UPDATE`
on the availability row, or a `Serializable` retry) enforces the seat cap. A violation returns a
deterministic **409 Conflict** ("Ce créneau vient d'être réservé"), never a 500, never an over-book.
Alternatives the ADR weighs and rejects: a distributed lock / Redis SETNX, a BullMQ serialisation queue
(over-engineering for school-scale, low-contention booking). This is the **one** genuinely new
architectural decision in E7.

**FR-10 — Additive, reversible, sliced thin.** Every E7 table is **net-new and additive**
(`prisma db push`, no SQL `migrations/` folder, no existing column changed). The alert surface and the
parent dashboard gain **additive** UI that degrades to today's behaviour when no plan/catalogue exists.
Each slice (see Slices) ships and reverts independently behind the existing E1/E2 actions, which E7
never removes.

## Acceptance criteria (epic-level)

- **AC-1 (catalogue schema, additive & curated).** `Tutor`, `TutorAvailability`, `Booking`, and
  `RemediationPlan` (+ their status enums) land via `prisma db push` (no SQL `migrations/` folder), each
  **tenant-scoped** with tenant-first indexes and a natural-key `@@unique` where idempotency applies. A
  `Tutor` may reference an existing `TeacherProfile`/`UserProfile` (teacher) or be external/peer-by-name;
  a tutor carries `subjectIds[]`, `type`, `costKind` (a label, never a price), `published`. The only
  edits to existing models are additive back-relation list fields (no column changed). Safe on existing
  rows.
- **AC-2 (alert → plan promotion, idempotent, ABAC).** A parent on `/parent/recommendations` can promote
  an alert into a `RemediationPlan` seeded with `alertId` / `studentId` / `subjectId` / `targetRuleCode`
  / baseline. Promotion is **guardianship-ABAC** and **idempotent** per `(tenant, alert, student)`
  (re-tap reuses the open plan); it writes an append-only `remediation.plan.create` audit row; the
  existing E1 "request a meeting" / E2 "message the teacher" actions still work.
- **AC-3 (booking, never over-booked, ABAC).** A parent can book an available tutor slot for their
  child (guardianship ABAC), creating a `Booking` idempotent per `(availability, sessionAt, plan)`.
  **Concurrent bookings of a single-capacity slot instance never both succeed** — exactly one wins, the
  other gets a kind 409 "déjà réservé" response, never a 500, never an over-book (a targeted concurrency
  test proves it). Cancel frees the seat. Teacher confirm/decline re-checks the ownership wall. Every
  booking write is audited.
- **AC-4 (progress strip — measured improvement).** The parent dashboard renders a non-stigmatising
  progress strip per active plan: target subject, sessions planned/done, next session, and the **trend
  delta vs the plan baseline read from the E6 `student_subject_snapshot`** (snapshot-first, live
  fall-through — no new class-wide scan). When the delta crosses the `IMPROVEMENT` threshold it reuses
  E3's emerald celebration lane. The strip degrades to nothing when there is no active plan; the <2 s
  NFR holds.
- **AC-5 (teacher capacity + admin curation).** A teacher can publish availability and mark bookings
  `honoured` / `no_show` for **their own** tutor only (ownership ABAC). An admin can approve tutors,
  publish/retire school resources, and view a school-scoped aggregate overview (no child-by-name
  comparison), gated by the new `remediation.*` permissions.
- **AC-6 (tenant / RLS / ABAC / RGPD / audit).** Every read/write is tenant-scoped (explicit
  `where: { tenantId }`); guardianship ABAC precedes every parent plan/booking access; the teaching wall
  gates booking a teacher; ownership gates teacher capacity; admin curation uses `remediation.*`. Every
  state change writes an append-only `AuditLog` row. No new sensitive personal-data category; bookings
  inherit student deletion via scope. Kind, non-stigmatising FR copy throughout.
- **AC-7 (reuse-first, no off-convention drift).** E7 reuses: the E1-S2 `deriveAlertActions` /
  `AlertNextSteps` surface for the new action, the E1-S3 `MeetingRequest` `@@unique` idempotency
  pattern, the E2 ownership/lapsed-wall ABAC discipline for booking transitions, the E3 `IMPROVEMENT`
  emerald lane for the celebration, the E6 `student_subject_snapshot.trendDelta` (snapshot-first, live
  fall-through) for the trend, `NotificationsService.createMany` for booking notifications (no new
  queue), the role-narrowed permission style (E4 `exports.execute.parent|teacher`), the
  aggregate-endpoint convention, `@pilotage/ui`, and `packages/contracts`. No client N+1, no new HTTP
  style, no new state lib, no second BullMQ queue, no payment/PSP (ADR-018 upheld), no new datastore.
- **AC-8 (the one new architectural decision is filed — ADR-020).** The **booking/availability
  concurrency** decision (FR-9) — never over-book a capacity-limited slot instance under concurrent
  writes — lands with **`docs/adr/ADR-020-booking-availability-concurrency.md`** (Winston gate; authored
  on **S2**, the first slice that writes a `Booking`, since it documents a decision being made). It records the
  chosen mechanism (recommended: a per-`(availability, sessionAt, plan)` idempotency `@@unique`
  **separated from** the capacity guard — a raw partial-unique index for `capacity = 1`, a transactional
  `FOR UPDATE` count-check for `capacity > 1` — yielding a deterministic 409, no new lock/queue), the
  alternatives weighed (distributed lock/Redis, BullMQ serialisation, a denormalised `bookedCount`
  counter and its drift risk), and why. **No second BullMQ queue, no new permission beyond
  `remediation.*`, no new HTTP style, no payment/PSP (ADR-018), no new datastore** — those remain
  non-goals.

## Non-goals

- **No payments / paid tutoring / PSP.** E7 books **free, school-curated** support (teacher help, peer
  tutoring, school resources). Charging for tutoring is the parked finance epic (E12, ADR-018) — E7
  stores no price, no card data, no transaction. A bookable *paid* marketplace is explicitly out.
- **No open / cross-school tutor marketplace.** The catalogue is **within-tenant and admin-curated** —
  never a public directory, never cross-school discovery, never an external-provider integration.
- **No new login / no student-facing booking.** E7 adds **no** Keycloak role. Tutors who are teachers
  reuse their login; external/peer tutors are records (name only), not accounts. Students do not book
  (the Student Portal is the separate E8). Booking is a **parent** action; capacity is a **teacher**
  action; curation is an **admin** action.
- **No calendar/scheduling engine, no ICS/Google-Calendar sync, no reminders SLA.** Availability is
  simple slots with a capacity; E7 does not build a full scheduling system, recurrence-rule editor, or
  external-calendar export. A best-effort in-app/email booking notification reuses the existing
  notification pipeline (no new queue); calendar sync is a future refinement.
- **No second BullMQ queue, no new datastore.** Any background work (e.g. a booking reminder) reuses the
  existing notification dispatcher / cron pattern. The concurrency guard is in-Postgres (ADR-020), not a
  new lock service or queue.
- **No new analytics metric for the trend delta.** The progress strip **reads the E6 snapshot's
  existing subject average/trend** vs the captured plan baseline — it invents no new KPI, no new chart.
- **No change to grading / alert generation.** E7 **consumes** an alert and the analytics; it does not
  change how grades are entered, how alerts fire, or the E3 rule engine. It only adds a downstream
  action and a downstream measurement.
- **No real-time booking availability push (WebSocket).** The catalogue reflects availability on the
  normal fetch cadence; a freshly-booked slot is reflected on the next read (and the concurrency guard
  makes a stale-availability tap fail kindly, never over-book). Live availability sockets are a future
  refinement (the same ADR-019 real-time deferral posture).

## Slices (ship in order; each ≤ a day, one PR, demoable end-to-end)

> Six thin vertical slices. **S1** stands up the schema + the **alert → RemediationPlan promotion** + a
> **read-only catalogue** (browse only, no booking surface). **S2** adds **availability + the booking**
> verb + the **ADR-020** concurrency guard (the load-bearing slice). **S3** surfaces the dashboard
> **progress strip** (the measured-improvement payoff, reusing E6 + E3). **S4** gives the teacher
> capacity management + booking transitions. **S5** gives the admin catalogue curation + oversight.
> **S6** hardens the loop (notifications + cancellation + completion + uptake sweep). The full 4-model
> schema lands once in S1 (additive `db push`); S2 adds only the booking partial-unique index. See
> [`tasks.md`](./tasks.md) for the authoritative backlog + per-slice AC.

- **S1 — Schema + RemediationPlan promotion + alert deep-link + read-only catalogue.** *(schema + api +
  web; `[schema][auth]` P1)* Add all four models (`Tutor`, `TutorAvailability`, `Booking`,
  `RemediationPlan`) + the status enums via `db push` (the whole schema lands once, additively — but S1
  ships **no booking write**); the three `remediation.*` permissions (seed + role grants) + the additive
  `remediation` `NotificationKind`; a parent-permitted (`remediation.book`), guardianship-ABAC,
  **idempotent** `POST /remediation/plans` that promotes an alert into a plan (server-derived
  `studentId`/`subjectId` from the alert, plan-start `createdAt` baseline, append-only
  `remediation.plan_created` audit); a read-only `GET /remediation/catalogue?subjectId=` aggregate
  (published + tenant + subject-filtered tutors with their open slots, no N+1); and the new **"Trouver un
  soutien en {matière}"** action on the E1-S2 `AlertNextSteps` surface that promotes-then-navigates to a
  `/parent/remediation/[planId]` plan page showing the read-only catalogue (kind empty-state fallback to
  the E1/E2 CTAs). **No Booking write yet** — provably no over-booking surface exists. Reuses the
  `MeetingRequest` idempotency pattern + the E1 alert-action derivation. *(No ADR yet — ADR-020 lands with
  the first Booking write in S2.)*

- **S2 — Availability + Booking (the concurrency slice → ADR-020).** *(schema-index + api + web;
  `[schema][auth]` P1)* A parent **booking** flow `POST /remediation/bookings` (`remediation.book`,
  guardianship ABAC on the plan's student **before** the write), **idempotent per `(availability,
  sessionAt, plan)`**, with the **never-over-book guard** (the raw **partial unique index** for the
  common `capacity = 1`, added alongside `db push` — the only schema step in S2; a transactional
  `FOR UPDATE` count-check for `capacity > 1`) returning a deterministic **409 "ce créneau vient d'être
  réservé"** on a full instance (never a 500, never an over-book); parent **cancel** frees the instance
  atomically; tutor+parent notified via `NotificationsService.createMany` (no new queue); append-only
  audit. **Lands with `docs/adr/ADR-020-booking-availability-concurrency.md`** (Winston gate) + a
  targeted concurrency test (two simultaneous books of a 1-capacity instance → exactly one wins). *(This
  is the FR-9 / AC-8 tripwire slice.)*

- **S3 — Parent remediation progress strip (the measured-improvement payoff).** *(web + small api;
  `[web][a11y]` P2)* The parent dashboard gains an **additive optional `remediation` block** (open plans
  + session counts + next session + the **trend delta vs the plan `createdAt` baseline** read from the
  existing `subjectEvolution` — E6 `student_subject_snapshot.trendDelta`, snapshot-first, live
  fall-through; **no new metric, no new class scan**) rendered as a calm `RemediationProgressStrip`,
  reusing E3's `IMPROVEMENT` emerald celebration lane when the delta crosses the threshold. Additive,
  degrades to nothing with no plan, holds <2 s. **No schema change.**

- **S4 — Teacher capacity management + booking transitions.** *(web + api; `[auth]` P2)* A teacher
  **"Mes créneaux de soutien"** surface to publish/edit their own `Tutor` availability and a list of who
  booked, with `confirm` / `decline` / `completed` / `no_show` / `proposed_alternative` transitions —
  **ownership-walled** (the teacher's own tutor + pupils only), each audited. Thin client over the S2
  booking endpoints (rides `remediation.read` + the wall, the E2 teacher-reply idiom). **No schema
  change.**

- **S5 — Admin catalogue curation & oversight.** *(web + api; `[auth]` P2)* `/admin/remediation`
  (`remediation.manage`): create/approve/retire tutors (teacher-linked or external/peer) + publish slots
  via `DataTable` + `FormDrawer` + `StatusBadge`. **No schema change beyond S1/S2.**

- **S6 — Loop hardening: notifications + cancellation + completion + uptake sweep.** *(api + worker +
  web; `[auth]` P2-P3)* Best-effort booking/cancellation **notifications** reusing the existing
  `NotificationsService.createMany` dispatcher (no new queue, `NotificationPreference`-gated);
  parent/teacher **cancellation** (frees the seat, audited); kind **plan completion** (mark-`met`/`closed`,
  reversible) + an optional auto-suggest-complete cron sweep (alerts-cron poll pattern, **no new queue**)
  when the `IMPROVEMENT` threshold holds; an admin **uptake overview** (`/admin/remediation/overview`,
  school-scoped aggregate, no child-by-name comparison). Closes the lifecycle. **No schema change beyond
  S1/S2.**

See [`tasks.md`](./tasks.md) for the slice backlog, [`plan.md`](./plan.md) for the architecture +
ADR-020 posture, [`data-model.md`](./data-model.md) for the four models + the concurrency invariant,
[`contracts/openapi.yaml`](./contracts/openapi.yaml) for the API delta, [`ux.md`](./ux.md) for the
catalogue/booking/progress-strip UX contract, and [`quickstart.md`](./quickstart.md) for the manual
demo per slice. Per-slice self-contained `story` specs land in `stories/` on each slice's run.
