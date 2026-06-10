# E10 — Critical journeys contract (J1/J2/J3) + endpoint traceability

> Given/When/Then specs for the three authenticated end-to-end journeys, with the **existing**
> `/api/v1` endpoints each one drives. **Every endpoint here already exists** (E1–E9) — E10 adds **no**
> endpoint and **no** schema; this file is the traceability map between a UI journey and the product
> API it exercises through the real auth stack.

## J1 — Grade publish → parent explainable alert (S1, the first critical journey)

The cahier's core promise as a regression test: a teacher publishes a grade that crosses a threshold →
the parent sees an **explainable** alert (rule + subject + threshold + trend) that **leads to an
action**.

```
GIVEN a voltaire-demo teacher authenticated (teacherPage)
  AND that teacher owns a class+subject with an enrolled student whose guardian has a parent login
WHEN  the teacher enters and PUBLISHES a low grade for that student via the gradebook UI
  AND the alert engine evaluates (API publish path raises it inline / cron reconciles)
THEN  the parent (parentPage), on /parent/dashboard or /parent/recommendations,
        sees an alert naming the rule (e.g. LOW_SUBJECT_AVG), the subject, and a next-step CTA
  AND  the alert is explainable (threshold/trend visible) and non-stigmatising
  AND  the parent sees ONLY their own child's alert (ABAC assertion)
```

Endpoints exercised (existing; `x-reused: true`):
- `POST /api/v1/grades` (or the gradebook publish verb) — teacher publishes the grade.
- the alert-engine evaluation (inline on `GradePublished` + the worker cron) — **no test endpoint**;
  asserted via the parent read.
- `GET /api/v1/analytics/parent-dashboard` (aggregate) and/or the parent recommendations read — the
  parent surface the alert renders on.

Determinism: the published grade is chosen to deterministically cross a threshold for a `LOW_SUBJECT_AVG`
(or similar) rule in the demo data; the parent assertion may **poll** the dashboard (cron latency) with
a bounded retry. Re-runnable (publishing the same assessment grade is effectively idempotent).

## J2 — Parent ↔ teacher messaging (later slice)

```
GIVEN a parent + teacher + student triad satisfying the E2 dual-wall (guardianship ∩ teaching-assignment)
WHEN  the parent opens a thread with that teacher and sends a nonce-tagged message (parentPage)
  AND the teacher opens their conversations inbox and replies (teacherPage)
THEN  each side sees the other's message;
  AND a parent CANNOT open a thread with a teacher NOT teaching their child (negative wall assertion)
```

Endpoints (existing E2; `x-reused: true`):
`POST /api/v1/conversations` (parent create), `GET /api/v1/conversations` (inbox),
`GET /api/v1/conversations/{id}`, `GET /api/v1/conversations/{id}/messages` (paged),
`POST /api/v1/conversations/{id}/messages` (send/reply), `PATCH /api/v1/conversations/{id}/read`.
Append-only — messages accumulate harmlessly; assert the just-sent nonce text.

## J3 — Parent child-claim → admin approval (later slice)

```
GIVEN an unclaimed voltaire-demo student whose name+DOB the parent can submit
WHEN  the parent submits a child-claim (parentPage) with that evidence
THEN  the parent gets the UNIFORM, non-leaking "Demande envoyée" response (security regression: no oracle)
WHEN  the admin opens the approval queue and approves the claim (adminPage)
THEN  the claim transitions submitted→approved, the guardianship pending→active
  AND the parent now sees the child on /parent/children (access granted by the approve transition)
```

Endpoints (existing E9; `x-reused: true`):
`POST /api/v1/parent/child-claims` (parent claim, uniform response),
`GET /api/v1/parent/child-claims` (parent status read),
`GET /api/v1/admin/child-claims` (admin queue),
`POST /api/v1/admin/child-claims/{id}/approve`,
`POST /api/v1/admin/child-claims/{id}/reject`.
Re-runnability: use a throwaway/nonce claimant or withdraw at teardown (pinned in the J3 story spec).

## Cross-cutting assertions (every journey)

- **Semantic locators only** (`getByRole`/`getByLabel`/`getByText`) — stable + a11y-exercising.
- **Tenant/ABAC isolation** asserted, never bypassed.
- **Skip-when-down** — guarded by the reachability probe (auth-fixture §6).
- **No raw SQL, no schema, no new endpoint.**

## Endpoint inventory (all `x-reused: true`, `x-e10-new: false`)

See [`openapi.yaml`](./openapi.yaml) for the machine-readable list. The list is **documentary** — it
maps journeys to the already-shipped surface so drift tooling can confirm E10 introduced nothing new.
