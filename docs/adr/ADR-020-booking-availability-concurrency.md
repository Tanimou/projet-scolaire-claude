# ADR-020 — Booking / Availability concurrency (never over-book)

- **Status:** Accepted
- **Date:** 2026-06-06
- **Epic / Slice:** E7 — Remediation & Tutoring loop · S2 (Availability + Booking)
- **Deciders:** Winston (Architect), Critic (Pre-mortem), Murat (Test-Architect)
- **Supersedes / relates:** ADR-002 (multi-tenancy, `tenant_id` + RLS), ADR-018 (finance
  isolation — bookings carry NO money), ADR-019 (analytics snapshots — the "no second BullMQ
  queue / honest application-layer tenant scoping" precedents cited verbatim here).

## Context

E7-S2 introduces the first **booking write path**: a parent claims one seat of a
capacity-limited `TutorAvailability` slot against a `RemediationPlan`. The load-bearing
requirement (spec FR-S2-3 / AC-2): **under concurrent writes the system must NEVER over-book a
slot**, and a lost race must return a **deterministic kind 409** — never a 500, never two active
rows beyond capacity.

Two correctness keys had to be nailed before any guard could hold:

1. **`sessionAt` canonicalisation.** A `recurring_weekly` slot resolves to a *concrete dated
   instance*. The capacity guard keys on `(availability_id, session_at)`. If two parents booking
   "the same Tuesday 17h" compute different `session_at` values (timezone / seconds / millisecond
   variance, or a client-supplied datetime), the unique guard never collides and both succeed —
   a silent over-book. **Resolution:** `sessionAt` is **server-derived and canonicalised**
   (`session-instance.ts`): one_off → the slot's `startsAt` truncated to the second; recurring →
   the requested calendar date at the slot's "HH:mm" (UTC), discarding any client-supplied
   time-of-day. A request that does not match the slot shape (wrong weekday/time, ≠ one_off
   `startsAt`, or in the past) is a deterministic **422**, never a 500.

2. **Idempotency vs. capacity are SEPARATE mechanisms.** The schema's
   `@@unique([availabilityId, sessionAt, planId])` is **idempotency only** (a re-tap of the same
   instance for the *same plan* collapses to the existing row). It does **not** bound capacity
   across *different* plans — that is a distinct guard.

## Decision

A **two-tier capacity guard**, plus a strict separation of idempotency from capacity.

### Tier 1 — capacity = 1 (the common case): a raw partial-unique index

Prisma `@@unique` cannot express a `WHERE`, so the capacity-1 invariant lives as raw DDL applied
**alongside `db push`** (this repo has no `migrations/` folder):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS booking_active_instance_unique
  ON booking (availability_id, session_at)
  WHERE status IN ('requested', 'confirmed');
```

A second **active** booking of the same dated instance is impossible at the DB layer → Prisma
`P2002` on that index → mapped to a deterministic **409 "Ce créneau vient d'être réservé"**.

**Where the DDL lives + how it is applied (binding condition C-1 — not prose, runnable):**
- Canonical artifact: `apps/api/prisma/sql/booking-active-instance-uniq.sql`.
- Applied automatically on API boot by `BookingIndexBootstrap`
  (`apps/api/src/modules/remediation/booking-index.bootstrap.ts`), idempotent
  (`CREATE … IF NOT EXISTS`), best-effort (a missing booking table / unreachable DB logs a warning
  and continues — the transactional count path below is the defence-in-depth fallback). A `db push`
  that re-creates the `booking` table self-heals the index on the next API start.
- This avoids the `student_enrollment` precedent (schema documents a partial unique index "in
  migration SQL" that, absent a `migrations/` folder, was never actually created — security
  theatre). Here the index is *applied*, pinned by the concurrency test.

### Tier 2 — capacity > 1: transactional `FOR UPDATE` count-then-insert

For `capacity > 1` the partial-unique index would WRONGLY block a legitimate 2nd seat, so it is
**not** the authority. Instead, inside `prisma.$transaction`:

```
SELECT id FROM tutor_availability WHERE id = $availabilityId FOR UPDATE;   -- serialise counters
count active bookings WHERE (availability_id, session_at) AND status IN ('requested','confirmed');
if count >= capacity → throw 409;  else insert inside the same tx.
```

The row lock serialises concurrent (N+1)th claimants so two cannot both read `count < capacity`.

### The split, made implementable

The index keys on `(availability_id, session_at)` with the contract "≤ 1 active row per instance".
For capacity-1 it is the authority (a direct insert + the atomic DB unique constraint; the index is
re-ensured idempotently on every API boot so the path always has its DB-level belt). For capacity-N
the **transactional `FOR UPDATE` count is the SOLE authority**; the service branches on `capacity`
(`booking.service.ts`) to pick the path.

> **Honest limitation — capacity > 1 is NOT yet enabled, and this index is the reason (S4 prerequisite).**
> The partial-unique index is a **global table constraint**: it admits at most ONE active row per
> `(availability_id, session_at)` regardless of the slot's `capacity`. So a genuine 2nd active seat on
> a capacity-N slot — which the Tier-2 transactional path *does* attempt — would hit `P2002` on this
> index and be wrongly rejected. This is harmless in S2 because **every slot is capacity-1**:
> `TutorAvailability.capacity` defaults to `1` and S2 ships **no** endpoint/UI that raises it (capacity
> management is **S4**). The Tier-2 path is therefore **dormant defensive code** in S2 (the unit test
> mocks Prisma, so it exercises the count logic without the real index). **Binding prerequisite for S4
> (teacher capacity):** before any slot can be `capacity > 1`, this guard must be reworked — either
> drop the global partial-unique index and make the transactional `FOR UPDATE` count the sole authority
> for *all* capacities, or make the index capacity-aware (e.g. only applied to capacity-1 slots). Until
> then, capacity-N MUST NOT be enabled. Recorded here so S4 cannot enable it by accident.

### Deterministic-409 contract (PM-A4 — by KIND, not by accident)

The `P2002` catch branches on `err.meta.target`:
- target includes `booking_active_instance_unique` → a *different plan* lost the capacity race →
  **409**.
- target includes `plan_id` (the idempotency `@@unique`) → a *same-plan* re-tap → **reuse the
  existing active row (200)**, never a scary "already booked" error. A cancelled idempotency row is
  **revived** (cancel → re-book), still guarded by the active-instance index so a revive can never
  over-book.
- any other `P2002` → **rethrow** (a genuine bug, never silently a 409).

### Cancel frees the seat atomically (append-only)

Parent cancel is a single `updateMany` guarded by `status IN ('requested','confirmed')` (a concurrent
double-cancel matches 0 rows → safe no-op). The seat frees automatically because the active-status
filter / partial index exclude `cancelled` — no extra mutation. History is never deleted.

### Tenant isolation posture (honest, per ADR-019)

Every booking/availability/plan read+write carries an explicit application-layer `where: { tenantId }`
(server-derived from `SchoolContextService.forUser`, never client-supplied). We do **not** fabricate
`current_setting`-style RLS DDL for the booking path. The partial-unique index is tenant-agnostic by
design (UUIDs are globally unique); tenant isolation is the application-layer `where`, exactly the
ADR-019 precedent.

## Rejected alternatives

- **Distributed lock / Redis SETNX** — over-engineering for school-scale, low-contention booking;
  adds new infrastructure and a new failure mode. The DB already serialises via the unique index /
  row lock.
- **A second BullMQ queue to serialise bookings** — serialisation overkill and an explicit ADR
  tripwire / non-goal across E5–E7. A synchronous DB guard is simpler and stronger.
- **A denormalised `bookedCount` counter on the slot** — drift risk (the counter and the booking
  rows disagree under partial failures). We **derive truth from the rows** (count active bookings),
  never cache it.
- **Idempotency `@@unique` doubling as the capacity guard** — it keys on `plan_id`, so it bounds
  only same-plan re-taps, not cross-plan capacity. Conflating the two would either block legitimate
  different-plan seats or fail to stop an over-book. They stay two mechanisms.

## Consequences

- **+** Never over-books; deterministic 409; idempotent re-tap; atomic cancel; no new infra, no new
  queue, no new datastore, no money.
- **−** The capacity-1 guard is raw DDL outside the Prisma schema, so it must be re-applied after any
  `db push` that touches `booking` (mitigated by the idempotent boot bootstrap + the transactional
  fallback). Recorded here as the accepted price of the partial-unique approach.
- **Drift risk acknowledged:** a `db push --accept-data-loss` that drops/recreates the index is
  self-healed on the next API boot; until then capacity-1 degrades to the (still-correct) app-level
  path, never to over-book.

## Evidence

`apps/api/src/modules/remediation/booking.service.spec.ts` — the targeted two-concurrent-books
capacity-1 test (`Promise.allSettled` of two distinct-plan books → exactly one 2xx + one
`ConflictException`, never a 500, exactly one active row), plus the capacity-N seat-fill, the
idempotent re-tap reuse, and the sessionAt-mismatch / past-instance 422 paths.
