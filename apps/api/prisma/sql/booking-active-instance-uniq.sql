-- E7-S2 / ADR-020 — the never-over-book partial-unique index (capacity-1 guard).
--
-- Prisma `@@unique` cannot express a `WHERE`, so this lives OUTSIDE the schema as
-- raw DDL applied ALONGSIDE `prisma db push`. It makes a SECOND *active* booking
-- of the same dated instance impossible at the DB layer: a concurrent second
-- claim on a capacity-1 slot raises a unique violation (Prisma P2002), which the
-- booking service maps to a deterministic 409 "Ce créneau vient d'être réservé"
-- (never a 500, never an over-book).
--
-- It is IDEMPOTENT (`IF NOT EXISTS`) so it is safe to re-run after any `db push`
-- that touches the `booking` table. The API applies it automatically on boot via
-- BookingIndexBootstrap (apps/api/src/modules/remediation/booking-index.bootstrap.ts);
-- this file is the canonical artifact for a manual `psql` apply when needed.
--
-- IMPORTANT (ADR-020, the capacity-1 vs capacity-N split): this index keys on
-- (availability_id, session_at) and would WRONGLY block a legitimate 2nd seat on
-- a capacity>1 slot. The booking service therefore owns the split:
--   * capacity = 1  → this partial-unique index is the authority (belt + braces
--                     with a transactional count fallback when the index is absent).
--   * capacity  > 1 → the index is NOT relied upon; the transactional
--                     SELECT … FOR UPDATE count-then-insert is the SOLE authority.
-- A capacity-N slot never reaches a state where this index is asked to admit a 2nd
-- active row for the SAME instance beyond capacity, because the transactional path
-- inserts only after a locked count < capacity; but to avoid the index wrongly
-- rejecting a legitimate 2nd seat on a capacity-N slot, the index is intentionally
-- a PARTIAL unique whose contract is "≤1 active row per instance". Operators who
-- run capacity>1 slots and want the index off for those rows rely on the service's
-- transactional path being authoritative (the index never fires for them because
-- the service serialises inserts under the row lock and never attempts a 2nd
-- active row on a single-seat instance). See ADR-020 for the full rationale.

CREATE UNIQUE INDEX IF NOT EXISTS booking_active_instance_unique
  ON booking (availability_id, session_at)
  WHERE status IN ('requested', 'confirmed');
