# E7 — Quickstart (manual demo per slice)

> How to **see** each E7 slice working end-to-end, locally. The app runs hybrid (infra in Docker, web
> local on `:3100`, api `:4000`, worker alongside). Demo login (full `voltaire-demo` data): admin
> `mme.dupont@voltaire.fr` / `Demo!2024Pilotage`; simple per-portal `parent@pilotage.local` /
> `Changeme123!`. E7 closes the loop **alert → diagnosis → resource → measured improvement**, so the
> proofs walk that arc: promote an alert into a plan, browse the catalogue, book a slot (without ever
> over-booking), and watch the dashboard progress strip measure the result.
>
> **Slice order:** S1 schema + plan promotion + read-only catalogue · S2 availability + booking + the
> ADR-020 concurrency guard · S3 progress strip · S4 teacher capacity · S5 admin curation · S6 hardening.
> Authoritative model/enum names are in [`data-model.md`](./data-model.md).

---

## Prereqs (once)

- API + worker + web running; Postgres reachable. No build is run by the routine — assume the stack is up
  (project-context §4). To inspect rows, use a read-only SQL console against dev Postgres. The new tables
  are `tutor`, `tutor_availability`, `remediation_plan`, `booking` (authoritative names in
  `data-model.md`).
- After S1's `db push`, the tables exist but are **empty**; an admin curates the catalogue (the parent
  surface in S5; rows can be seeded directly for the S1/S2 demo). A plan can be promoted from an alert in
  S1 even before any tutor exists — the plan page shows the kind empty-state / E1-E2 fallback (never a
  dead-end).
- You need a child with a **subject-scoped alert** (e.g. `LOW_SUBJECT_AVG` on Maths). The `voltaire-demo`
  data + the E3 engine produce these; if needed, publish a low grade as a teacher to fire one.

---

## S1 — Schema + alert → RemediationPlan promotion + read-only catalogue

**Prove an alert's recommendation promotes into a tracked, idempotent plan (ABAC) and shows the catalogue.**

1. Confirm the schema landed: `tutor`, `tutor_availability`, `remediation_plan`, `booking` exist
   (tenant-scoped, with the lifecycle/`@@unique` columns). The 3 permissions
   (`remediation.read|manage|book`) are seeded + role-granted.
2. Log in as a **parent** of a child with a Maths `LOW_SUBJECT_AVG` alert. Open `/parent/recommendations`,
   expand the alert's *"Que puis-je faire ?"* panel: alongside *"Renforcer Maths"* + *"Écrire à
   l'enseignant·e"*, a new **"Trouver un soutien en Maths"** action appears (only for subject-scoped
   alerts; absent when the alert has no subject).
3. Tap it → a `remediation_plan` row is created scoped to the open-plan `@@unique` with `alertId`/
   `targetRuleCode` + a captured baseline; you land on `/parent/remediation/[planId]` showing the plan
   target + the **read-only catalogue** filtered to Maths (or the kind empty-state / E1-E2 fallback if no
   tutor is seeded). An append-only `remediation.plan_created` `AuditLog` row is written.
4. **Idempotency:** tap *"Trouver un soutien en Maths"* again → **no duplicate** plan (the open-plan
   `@@unique` reuses it); you land on the same plan page.
5. **ABAC:** attempt the promote/read for a child you do **not** guard → 403/404 (guardianship
   `canAccessStudent` before the operation). The E1 "request a meeting" / E2 "message the teacher" actions
   still work unchanged.
6. **Catalogue read:** seed an active+approved Maths `tutor` with an open `tutor_availability` slot →
   reload the plan page → it lists that tutor + slot (active+approved only, subject-matched, tenant-scoped,
   one aggregate read, no N+1). A tutor in another tenant never appears.

> S1 ships **no booking write** — there is no over-booking risk and **no ADR** this slice.

---

## S2 — Availability + Booking (→ ADR-020)

**Prove a parent books a slot, and that a slot is NEVER over-booked under concurrency.**

1. As the **parent** on the plan page, tap **"Réserver"** on a slot → a focus-trapped `ConfirmDialog`;
   confirm → a `booking` row (status `confirmed`), the slot's capacity claimed atomically, an `aria-live`
   success (*"Séance réservée — l'intervenant a été prévenu."*), a "Réservé" badge, an append-only
   `remediation.booking_created` audit, and an in-app notification to the tutor + parent (`createMany`, no
   new queue).
2. **Idempotency:** tap "Réserver" on the same slot again as the same parent → reuses the existing active
   booking (no duplicate, no double-claim — the booking `@@unique`).
3. **The concurrency guard (the headline proof):** set a slot's `capacity = 1`. Fire **two concurrent**
   booking requests for it (two parents, or a scripted parallel POST). **Exactly one succeeds**; the other
   gets a **deterministic 409** *"ce créneau vient d'être réservé — voici d'autres horaires"* — never a
   500, never a slot booked beyond capacity. (The FR-7 / AC-8 invariant; the targeted test pins it.)
4. **Cancel frees the seat:** cancel the booking → status `cancelled` (append-only, row not deleted), the
   capacity unit is released atomically, the slot is bookable again.
5. **No money anywhere:** confirm there is no price/payment field on any request/response (FR-9 /
   ADR-018).

> **`docs/adr/ADR-020-booking-availability-concurrency.md` lands on this run** (the guard mechanism + the
> rejected alternatives + the deterministic-409 contract + the cancel-then-rebook unique rule).

---

## S3 — Parent remediation progress strip (measured improvement)

1. As the **parent** on `/parent/dashboard`, see a calm strip near the global-performance hero:
   *"Soutien en cours · Maths — objectif … · 1 séance · prochaine mardi 17 h"*, the trend reading
   *"en attente des prochaines notes"* (no new grade yet — neutral, patient).
2. As the **teacher**, publish new (higher) Maths grades → the E6 snapshot recomputes the subject trend.
   Reload the parent dashboard → the strip's delta fills in: *"+1,8 pts depuis le début du soutien"* (from
   `student_subject_snapshot.trendDelta` vs the plan baseline, snapshot-first, live fall-through — no new
   class scan).
3. When the delta crosses the `IMPROVEMENT` threshold, the strip flips to the **E3 emerald celebration
   lane**: *"Le soutien porte ses fruits — Maths progresse 🎉"*.
4. **A11y:** icon + text (not colour-alone), `role="status"`/`aria-live="polite"` announcing only the
   improvement transition (not every relative-time tick), ≥4.5:1, no animation under
   `prefers-reduced-motion`; **no strip** when there is no active plan; the dashboard stays <2 s.

---

## S4 — Teacher capacity management + booking transitions

1. Log in as the **teacher** linked to the tutor, open **"Mes créneaux de soutien"**: see who booked the
   slot, and mark it `confirmed` / `declined` / `honoured` / `no_show` — each writes an append-only
   `remediation.booking_<status>` audit row.
2. **Ownership wall:** the teacher sees **only** their own tutor's bookings (and only their pupils); a
   booking on another tutor never appears.
3. The teacher can publish/edit their own availability from the same surface (ownership-scoped).

---

## S5 — Admin catalogue curation & oversight

1. Log in as **admin**, open `/admin/remediation`: create/approve/retire a `Tutor` (teacher-linked or
   external-by-name) + publish slots; each curation writes an append-only audit row.
2. Confirm only `published` tutors of this tenant reach the parent catalogue (S1 read); a retired/
   unpublished tutor disappears from the parent view but keeps its booking history.

> The school-scoped **uptake overview** (`GET /admin/remediation/overview`) lands in **S6**.

---

## S6 — Loop hardening: notifications + cancellation + completion + uptake sweep

1. Booking/cancellation **notifications** reuse the existing dispatcher (no new queue), honouring
   `NotificationPreference`.
2. As the **parent** (or admin), mark the plan **completed** (kind, celebratory, reversible) →
   `remediation.plan_closed` audit; the strip moves to a *"Objectif atteint — bravo 🎉"* state.
3. **Auto-suggest-complete sweep:** with the `IMPROVEMENT` threshold holding on the plan's subject, the
   worker cron (alerts-cron pattern, **no new queue**) suggests completion; confirm it is tenant-scoped,
   re-entrant, best-effort, and never over-counts.
4. As **admin**, open the **uptake overview** (`GET /admin/remediation/overview`): active plans + bookings
   **per subject** (which subjects need more support capacity) — aggregate counts, **no child-by-name**.

---

## Cross-slice sanity (every slice)

- Every E7 row + read + mutation is tenant-scoped; a parent can only ever promote/read/book for their own
  child (guardianship ABAC **before** the operation); booking a teacher re-checks the E2 teaching wall;
  teacher capacity is ownership-walled; admin curation needs `remediation.manage`. No endpoint loosens a
  permission.
- **A slot is never over-booked** (S2 / ADR-020) — the capacity guard is load-bearing.
- **No money / no payment** anywhere (ADR-018 upheld).
- No build is run by agents; `pnpm typecheck` is the single gate (Murat). Every state change is
  append-only audited; the loop never removes the E1/E2 actions it builds on; copy is kind,
  non-stigmatising FR throughout.
