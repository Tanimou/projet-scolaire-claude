# E7 — Slice backlog (tasks)

> The shippable vertical slices for **E7 — Remediation & Tutoring loop**. Each slice = one PR + one
> build, demoable end-to-end. Ship **in order** (S1 → S6). Per-slice self-contained `story` specs land
> in [`stories/`](./stories/) on each slice's run. See [`spec.md`](./spec.md) for vision/AC,
> [`plan.md`](./plan.md) for architecture, [`data-model.md`](./data-model.md) for the models + the
> booking-concurrency invariant, [`ux.md`](./ux.md) for the key screens/states + the progress-strip UX
> contract, [`contracts/openapi.yaml`](./contracts/openapi.yaml) for the API surface,
> [`quickstart.md`](./quickstart.md) for the manual demo.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` shipped.

> **Slice arc:** **S1** stands up the spine — the full schema (all 4 models) + the **alert →
> RemediationPlan promotion** + the **read-only catalogue** read (browse only, no booking surface). **S2**
> adds **availability + the booking** verb + the **ADR-020** concurrency guard (the load-bearing slice).
> **S3** surfaces the dashboard **progress strip** (the measured-improvement payoff). **S4** gives the
> teacher capacity management + booking transitions. **S5** gives the admin catalogue curation +
> oversight. **S6** hardens the loop (notifications + cancellation + completion + uptake sweep).
>
> **Authoritative names:** the data-layer **model/enum names live in [`data-model.md`](./data-model.md)**
> (`Tutor`, `TutorAvailability`, `RemediationPlan`, `Booking`; enums `TutorType`/`TutorCostKind`/
> `AvailabilityKind`/`RemediationPlanStatus`/`BookingStatus`). The ADR is
> **`docs/adr/ADR-020-booking-availability-concurrency.md`**, authored on the booking slice (S2).

---

## [ ] S1 — Schema + alert → RemediationPlan promotion + read-only catalogue · `[schema][auth]` · P1 · ~M

**Goal:** the foundation — the full E7 schema exists, an alert's *"Que puis-je faire ?"* recommendation
**promotes into a tracked `RemediationPlan`** (idempotent, guardianship-ABAC, audited), and the plan page
shows a **read-only catalogue** filtered to the diagnosed subject. **No booking write yet** — provably no
over-booking surface (the `Booking`/`TutorAvailability` tables land but no write path ships) — demoable by
promoting an alert and browsing the (admin-seeded) catalogue.

**Scope (schema + api + web):**
- **Schema (`db push`):** add the enums + the 4 models from [`data-model.md`](./data-model.md) §1
  (`Tutor`, `TutorAvailability`, `RemediationPlan`, `Booking`) + the additive back-relations (§1.5).
  Tenant-scoped, lifecycle columns, natural-key `@@unique` (`RemediationPlan` open-plan guard), tenant-
  first indexes. **No existing table changes shape** (only additive back-relation arrays). Add the RLS
  policies; `prisma generate`. *(If a reviewer prefers a `TutorSubject` join over `subjectIds[]` (§1.1),
  that is the one additive table to add here.)*
- **Permissions (seed delta):** add `remediation.read` (parent+teacher+admin), `remediation.manage`
  (admin), `remediation.book` (parent) to `seed.ts`/`seed-demo.ts`/`permissions.constants.ts` + role
  grants ([`data-model.md`](./data-model.md) §5). Add the additive `remediation` `NotificationKind` value.
- **Contracts:** add the E7 DTOs + enums to `packages/contracts`.
- **API:** `POST/GET /remediation/plans` (parent **promote** — idempotent on the open-plan `@@unique`,
  guardianship ABAC `canAccessStudent` **before** the write, baseline captured from the E6 trend,
  append-only `remediation.plan_created` audit) + the read-only `GET /remediation/catalogue?subjectId=`
  (aggregate, behind the plan's guardianship wall, active+approved tutors covering the subject with their
  open slots, no N+1).
- **Web:** the new **"Trouver un soutien en {matière}"** action on the E1-S2 `AlertNextSteps` surface
  (derived via `deriveAlertActions` from the alert's **structured** `code`/`subjectId`/`subjectName`,
  never free-text), for subject-scoped codes only, omitted on a null subject; promotes-then-navigates to a
  `/parent/remediation/[planId]` page showing the plan target + the **read-only catalogue** (or the kind
  empty-state fallback to the E1/E2 CTAs). The existing alert actions are **unchanged**.

**Acceptance (folds spec AC-1/2/3/6):**
- Schema lands additive via `db push`; the 4 tables + enums are tenant-scoped with RLS + indexes; the only
  existing-model edits are additive back-relation arrays; no column changed.
- Promotion is **idempotent** per the open-plan `@@unique` (re-tap reuses), behind guardianship ABAC,
  writes the append-only `remediation.plan_created` audit; the E1/E2 alert actions still work; the action
  derives from structured fields + degrades on a null subject (no broken link).
- The catalogue read lists only active+approved, subject-matching tutors with open slots, tenant-scoped,
  no cross-tenant leak, no N+1; the kind empty state falls back to the E1/E2 CTAs (never a dead-end).
- Unit test pins `deriveAlertActions` (the new step) + the promotion idempotency.
- **No booking write path exists yet → no concurrency surface, no ADR this slice.**

**Out of scope:** availability/booking write (S2), the strip (S3), teacher capacity (S4), admin curation
(S5), hardening (S6).

---

## [x] S2 — Availability + Booking (the concurrency slice) → ADR-020 · `[schema][auth]` · P1 · ~M · ✅ shipped

**Goal:** the transactional verb — a tutor's slots become bookable and a parent **books** one, **never
over-booking** under concurrency. **This is the ADR-020 slice** (the one schema step is the partial
unique index).

**Scope (api + web; the partial unique index added alongside `db push`, [`data-model.md`](./data-model.md)
§1.6 — the only schema step in S2):**
- Publish/read `TutorAvailability` slots into the catalogue (per-resource open slots with capacity).
- **Booking create** (`POST /remediation/bookings`, `remediation.book`, parent-only): guardianship ABAC on
  the plan's student **before** the write; **booking-a-teacher** additionally re-checks the E2 teaching
  wall; **idempotent** per the booking `@@unique`; the **never-over-book capacity guard** ([`data-model.md`](./data-model.md)
  §1.6 / §6) returning a **deterministic 409** *"ce créneau vient d'être réservé"* on a full slot (kind,
  never a 500, never an over-book); tutor + parent notified via `NotificationsService.createMany` (no new
  queue); append-only `remediation.booking_created` audit. **Parent cancel** frees the unit atomically
  (append-only, never deleted).
- **Web:** the **"Réserver"** flow on the plan page — a focus-trapped `ConfirmDialog`, an `aria-live`
  success + a "Réservé" badge, and the kind "déjà réservé" concurrency path.

**Acceptance (folds spec AC-3/4 + AC-8):**
- A parent books an available slot (guardianship + teaching-wall ABAC), idempotent per `(student, slot)`;
  **two concurrent claims on a capacity-1 slot → exactly one succeeds**, the other a deterministic kind
  409 (a targeted concurrency test proves it); cancel frees the unit atomically; every booking write is
  audited; tutor+parent notified (no new queue). **No money / no payment path.**
- **Lands with `docs/adr/ADR-020-booking-availability-concurrency.md`** (Winston gate) recording the chosen
  guard (partial-unique for capacity-1 + the transactional capacity check for capacity-N), the rejected
  alternatives (distributed lock / Redis / `FOR UPDATE` / BullMQ queue / a denormalised counter), and the
  deterministic-409 contract.
- The partial unique index lands alongside `db push`; no other schema change.

**Out of scope:** the strip (S3), teacher transitions (S4), admin curation (S5), hardening (S6).

---

## [ ] S3 — Parent remediation progress strip (the measured-improvement payoff) · `[web][a11y]` · P2 · ~S

**Goal:** turn the plan into a **visible** payoff — a calm, non-stigmatising strip on the parent dashboard
reading the **trend delta vs the plan baseline** from the E6 snapshot.

**Scope (web + small api; no schema):**
- An **additive** `remediation` block on the parent-dashboard aggregate (target subject, sessions
  planned/done, next session, the **trend delta vs baseline** read from the E6 `student_subject_snapshot`
  — snapshot-first, live fall-through; no new class scan).
- A calm `@pilotage/ui` **`RemediationProgressStrip`** near the hero — *"en attente des prochaines
  notes"* → *"+X pts depuis le début du soutien"*, reusing the E3 `IMPROVEMENT` emerald celebration lane
  when the delta crosses the threshold. Additive (no active plan → no strip), never a loading gate, holds
  <2 s.

**Acceptance (folds spec AC-4 + ux S3):**
- The strip renders per active plan from the additive field; the trend delta comes from the E6 snapshot
  (live fall-through); the *"en attente"* → *"+X pts"* → emerald-`IMPROVEMENT` progression holds; degrades
  to no strip with no plan; the <2 s NFR holds (reads the snapshot the dashboard already loads).
- WCAG 2.2 AA: icon+text (not colour-alone), `role="status"`+`aria-live="polite"` on the improvement
  transition only (relative-time tick silent), ≥4.5:1, `prefers-reduced-motion`; mobile-first; kind FR
  copy (no "échec/obsolète/leaderboard"); never names/compares another child. **No schema, no new
  permission.**

**Out of scope:** teacher capacity (S4), admin curation (S5), hardening (S6).

---

## [ ] S4 — Teacher capacity management + booking transitions · `[auth]` · P2 · ~S-M

**Goal:** the teacher side — a teacher publishes/edits their own availability and marks booking outcomes.

**Scope (web + api; no schema):**
- A teacher **"Mes créneaux de soutien"** surface: publish/edit their own `Tutor` `TutorAvailability` +
  a `DataTable` of who booked, with `confirm` / `decline` / `honoured` / `no_show` transitions
  (`RowActions`), **ownership-walled** (their own tutor only, their pupils only), each writing an
  append-only `remediation.booking_<status>` audit row. History never deleted (status gates writes). Thin
  client over the S2 booking endpoints + the ownership wall (rides `remediation.read` + the wall, no new
  permission — the E2 teacher-reply idiom).

**Acceptance (folds spec AC-5):**
- A teacher publishes availability + marks bookings, scoped to their own tutor + pupils (ownership ABAC);
  transitions are audited; a teacher never sees another tutor's bookings; **no schema change.**

**Out of scope:** admin curation (S5), hardening (S6).

---

## [ ] S5 — Admin catalogue curation & oversight · `[auth]` · P2 · ~S-M

**Goal:** the admin side — curate a trustworthy, within-school catalogue + a school-scoped overview.

**Scope (web + api; no schema):**
- `/admin/remediation` (`remediation.manage`): create/approve/retire `Tutor` resources (teacher-linked or
  external-by-name) + publish school resources via `DataTable` + `FormDrawer` + `StatusBadge` +
  `FilterBar` (by subject); a **school-scoped aggregate overview** of active plans + bookings per subject
  (which subjects need support capacity), **no child-by-name comparison**, RGPD-clean. Append-only audit on
  each curation change.

**Acceptance (folds spec AC-5/6):**
- An admin curates the catalogue (gated on `remediation.manage`) + sees a school-scoped aggregate overview
  with no child-by-name comparison; tenant-scoped, audited; **no schema change.**

**Out of scope:** hardening (S6).

---

## [ ] S6 — Loop hardening: notifications + cancellation + completion + uptake sweep · `[auth]` · P2-P3 · ~S

**Goal:** close the lifecycle — best-effort notifications, cancellation, kind completion, and a
self-healing completion sweep.

**Scope (api + worker + web; no schema):**
- Best-effort booking/cancellation **notifications** reusing the existing dispatcher (no new queue,
  honouring `NotificationPreference`).
- Parent/teacher **cancellation** (frees the slot unit atomically, append-only, "Annulé" badge).
- **Plan completion** — a parent/admin **kindly** marks a plan `completed` (celebratory, reversible) + an
  optional **auto-suggest-complete** cron sweep (the alerts-cron poll pattern, **no new queue**) when the
  `IMPROVEMENT` threshold holds on the plan's subject; append-only `remediation.plan_closed` audit.

**Acceptance (folds spec AC-5/6):**
- Cancellation frees the unit atomically + is audited; plan completion is kind + reversible + audited; the
  auto-suggest sweep is tenant-scoped, re-entrant, best-effort (alerts-cron parity), **no new queue**;
  **no schema change beyond S1–S2.**

**Out of scope:** payments (E12/ADR-018), calendar sync, recurring bookings, real-time slot push (all
non-goals).

---

## Cross-slice invariants (every slice)

- Tenant + RLS on every E7 row, read, and mutation; the parent plan/booking paths run guardianship ABAC
  (`StudentAccessService.canAccessStudent`) **before** any read/write; booking a teacher re-checks the E2
  teaching wall; teacher capacity is ownership-walled; admin curation is gated on `remediation.manage`. No
  endpoint loosens an existing permission.
- **Never over-book a slot** — the capacity invariant (S2 / ADR-020) is load-bearing, not best-effort; a
  full-slot tap fails with a kind deterministic 409, never a 500, never a double-book.
- **No money / no payment / no PSP** anywhere — bookings are arrangements; the finance domain stays
  isolated (ADR-018, E12). A `costKind` (if present) is a display label only.
- Append-only `AuditLog` on every state change (plan create/close, booking create/transition/cancel,
  catalogue curation). History is never deleted; status gates writes.
- Reuse-first: the E1-S3 `MeetingRequest` idempotency + alert-promotion pattern, the E1-S2
  `deriveAlertActions`/`AlertNextSteps` surface, the E2 teaching-wall ABAC, the E3 `IMPROVEMENT` emerald
  lane, the E6 `student_subject_snapshot` trend (snapshot-first, live fall-through), the
  `NotificationsService` fan-out (no second BullMQ queue), the aggregate-endpoint convention,
  `@pilotage/ui`, `packages/contracts`. **No new datastore, no new HTTP style, no new Keycloak role**
  (Student Portal is E8), **no real-time socket** (ADR-019 deferral).
- Kind, factual, **non-stigmatising** FR copy on every remediation surface (no "échec/mauvais/
  redoublement/leaderboard"); aggregates only, RGPD-minimal child data (no new sensitive category;
  bookings/plans inherit `Student` deletion via cascade).
- `pnpm typecheck` (Murat, once/slice); no `git diff --check` errors; **the one new architectural
  decision (booking/availability concurrency) lands with
  `docs/adr/ADR-020-booking-availability-concurrency.md` on the booking slice (S2)** (Winston gate); any
  *other* new decision → its own ADR (none anticipated; `plan.md` §ADR).
