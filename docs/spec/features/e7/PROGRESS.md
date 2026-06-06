# E7 — Progress

> Epic: **E7 — Remediation & Tutoring loop** · Tier 3 (Scale & new surfaces) · Size ~L
> Spec-kit run: **2026-06-06** (docs-only; no code, no schema, no build). Roadmap status: `proposed`
> → promoted to **in-progress** (spec authored this run). **No slices shipped yet — S1 is next.**

## Slice status

| Slice | Title | Tags | Risk | Status | PR |
|---|---|---|---|---|---|
| S1 | Schema + alert → RemediationPlan promotion + read-only catalogue | `[schema][auth]` | P1 | ⬜ not started | — |
| S2 | Availability + Booking (concurrency guard) → **ADR-020** | `[schema][auth]` | P1 | ⬜ not started | — |
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

## Next action

Ship **S1** (`epic-slice`): the schema (4 models + enums + additive back-relations, `db push`) + the 3
permissions + the parent **alert → RemediationPlan promotion** (idempotent, guardianship-ABAC, audited,
baseline-capturing) + the **"Trouver un soutien en {matière}"** action on the E1-S2 `AlertNextSteps`
surface + the `/parent/remediation/[planId]` plan page (target + the **read-only catalogue** / kind
empty-state fallback). **No booking write path → no concurrency surface → no ADR this slice** (ADR-020
lands with the first `Booking` write in S2). Write the self-contained `stories/S1-*.md` on that run.
