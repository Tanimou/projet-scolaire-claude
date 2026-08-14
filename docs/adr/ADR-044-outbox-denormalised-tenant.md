# ADR-044 — `outbox_event` is isolated by a DENORMALISED `tenant_id`, not by an invented FK path

- **Status**: `accepted` — closes `PF-185`, the exception `ADR-042` refused to hide.
- **Date**: 2026-08-14
- **Story**: `S-E01-2d` (epic `V3-E01`).
- **Relates to**: `ADR-002` (multi-tenancy), `ADR-032 §D5–§D8` (tenant enforcement), `ADR-042` (FK-path isolation —
  this ADR **lifts its §D7 deferral**), `ADR-001` (the outbox belongs to the modular monolith's event seam).
- **Supersedes nothing.** It **discharges** `ADR-042 §D7`, which deferred exactly one table **by name** and said what
  would have to happen for the deferral to end. This is that.

---

## Context — the one table left outside, and why the previous slice was right to stop

`ADR-032 §D7` put a `tenant_isolation` policy on the **44** tables carrying a `tenant_id` column. `ADR-042` added
**five** more that belong to a tenant by **foreign key**, with an `EXISTS`-over-the-parent predicate. That left exactly
one base table in `public` that was neither tenant-scoped nor tenant-derived: **`outbox_event`**.

`ADR-042 §D7` measured, on `pg_constraint` against the live catalog, that `outbox_event` holds **zero foreign keys**.
Its `aggregate_type` (text) + `aggregate_id` (uuid) pair is **polymorphic and unconstrained** — there is no parent to
point an `EXISTS` at, and inventing one would have been fiction with a policy wrapped around it. It therefore stayed
**fail-closed**: no grant, no policy, both absences asserted *by name* so that a later run could not "fix" the
resulting `permission denied` by widening the grant — the one branch `PF-183` explicitly ruled out.

**That deferral was correct and is not being reversed here. It is being discharged**, on the terms §D7 itself set out:
*"Isolating it requires a denormalised `tenant_id` column plus a backfill of existing rows — a `schema.prisma` change
with a data migration, and not this slice."*

**Re-measured for this slice, not relayed:**

| fact | measurement |
|---|---|
| foreign keys on `outbox_event` | **0** — `pg_constraint` with `contype='f'` returns no row for it |
| callers of `outboxEvent.` in `apps/**` + `packages/**` | **0** — the table is scaffolding with no writer |
| indexes on `outbox_event` before this slice | one: `(status, created_at)`. **No index could lead by `tenant_id`, because the column did not exist** |
| tables in `schema.prisma` declaring `tenant Tenant @relation(...)` | **2** — `School` and `UserProfile`, both `onDelete: Cascade`. The other 42 `tenant_id` columns carry **no** FK constraint |

The last row matters: materialising the FK is the **minority** convention in this schema, so it is a decision, not a
default, and it is taken in §D1 with its reason.

**Why now rather than at the cutover.** The `S-E01-1` connection cutover meets this table. Left as it was, the fork was
the same one `PF-183` named: grant it without a policy and the application role gets an **unfiltered, cross-tenant
event log** — every aggregate of every tenant; leave it ungranted and the first writer to land reads its
`permission denied` as a bug in its own feature. **The fix is the discriminant, never the grant.**

---

## Decision

### D1 — the column is DENORMALISED, the FK to `tenant` is MATERIALISED, and `ON DELETE CASCADE` is chosen

```prisma
tenantId String @map("tenant_id") @db.Uuid
tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
@@index([tenantId, status, createdAt])
```

**Denormalised, not derived.** `outbox_event` does not become a derived table and never will: `aggregate_id` stays
unconstrained, because constraining it is impossible for a polymorphic reference. The table leaves `ADR-042`'s residue
by **gaining a discriminant**, not by gaining a path. `DERIVED_EXPECTED` is computed from catalog structure (tables with
**no** `tenant_id` holding an FK to one), so the table drops out of that set automatically and joins `TENANT_COLS`.
The census agreement `RLS_ON == TENANT_COLS + DERIVED_EXPECTED` goes from `44 + 5` to `45 + 5` **without a single
number being edited** — which is the property `ADR-042 §D3` was built for, now exercised for the first time.

**Why the FK is materialised even though 42 of the 44 do without one.** Two reasons, and neither is symmetry:

1. **A tenant that is deleted must not leave undelivered events behind.** An outbox row is an *instruction to publish*.
   An orphaned instruction for a tenant that no longer exists is either a leak (if it is ever relayed) or permanent
   garbage (if it is not). `ON DELETE CASCADE` is the same answer `school_tenant_id_fkey` and
   `user_profile_tenant_id_fkey` already give, so this is an existing convention, not a new one.
2. **The column has no application writer to keep it honest.** The other 42 denormalised `tenant_id` columns are
   written by service code that is under test. This one will be written, when a writer lands, by whatever produces the
   event — and a referential constraint is the only thing that will refuse a malformed tenant id at that moment.

**The honest limit, stated because `ADR-042 §D6` had to learn it the hard way:** PostgreSQL runs referential-integrity
actions as the **owner of the referencing table**, with row security off. So this cascade also fires for a role that
holds no `DELETE` on `outbox_event`. It **cannot cross a tenant** — to delete the `tenant` row you must first see it —
so the cascade is tenant-safe. It is not, and is not claimed to be, an append-only guarantee.

### D2 — the backfill REFUSES to guess and REFUSES to delete; and it is ONE migration, measured

An existing row is **not attributable**: by construction there is no discriminant to read. The migration therefore
handles exactly one unambiguous case and fails loudly otherwise:

- **single-tenant database** → the assignment is *forced* by the catalog, not guessed, and is applied;
- **anything else with a NULL remaining** → `RAISE EXCEPTION` with the orphan count and the tenant count. A human
  decides; the migration does not.

**The two rejected branches, written down so they are not re-proposed as cleanups.** Deleting the rows is a silent data
loss dressed as tidying — an undelivered event erased by a migration. Assigning them to the first tenant found is
fiction with a policy wrapped around it, i.e. the exact failure `ADR-042` refused for the FK path.

**One migration, not two — and this is a departure from what `PF-185` sketched, so here is the measurement.**
`PF-185` wrote "make it `NOT NULL` in a second migration". That expand/contract split exists to protect against
**live writers**: old code inserting rows without the column between two deploys. Measured, that population is
**zero** — `outboxEvent.` has no caller. With no writer there is no window to protect, and splitting would instead
leave a **security discriminant nullable in production for a whole deploy cycle**. Splitting is strictly worse *here*.

> **The rule for when this stops being true:** the day `outbox_event` has a writer, a column added to it must go back to
> the two-migration expand/contract shape. This exemption is measured, not a precedent.

### D3 — the grant is `SELECT, INSERT, UPDATE`; `DELETE` is withheld

`ADR-032 §D7` and `ADR-042 §D5` measure privileges **from the call sites**. Here the measurement returns **zero call
sites**, so it does not settle the question — and that is stated rather than papered over. What settles it is the
**shape of the outbox pattern**, which is the table's entire reason to exist:

| privilege | ruling |
|---|---|
| `INSERT` | the producer writes the event **in the same transaction as the aggregate**. That *is* the pattern; without `INSERT` the table is unusable by the application role. |
| `UPDATE` | the relay marks `status`, `sent_at`, `attempts`, `last_error`. A delivered event is a **mutated** row, never a new one. |
| `SELECT` | the relay must read what it has to publish. |
| **`DELETE`** | **withheld.** Retention/purge is an operations job run by the **owner**. Granting `DELETE` would let the application role erase **undelivered** events — precisely the loss the outbox pattern exists to prevent. |

`ADR-032 §D7`'s principle — *"an unnecessary grant is a widened blast radius"* — is why `DELETE` is not added
"just in case", and `GUARDRAILS §1` (minimal access on children's data) is why the bar is set there. The absence is
**asserted** (`OUTBOX_DELETE = 0`), so it cannot widen in silence.

**What this grant is not.** It is not the answer to a permission error. `PF-183` ruled that branch out and it stays
ruled out: what makes this grant admissible is that the **policy exists and is proven to deny first**.

### D4 — this is NOT a pure expand, and the rollback says so

`S-E01-2b` and `S-E01-2c` were pure expands (policies and grants only), so `DROP POLICY` + `DISABLE` + `REVOKE` was a
*sufficient* reversal for both. **This one creates a column, a constraint and an index**, so the same sentence copied
across would be false. The rollback in the migration header removes what was created, in reverse order, and carries the
warning that matters: **it is loss-free only while the table is empty.** Once rows exist, dropping the column destroys
an attribution that is not re-derivable.

The policy/grant half of that rollback is **executed** by `scripts/rls-isolation-check.js` — its generic block iterates
every table carrying `relrowsecurity`, so it picks this one up with the other 49, and `ROLLBACK_TOUCHED` is compared
against `TENANT_COLS + DERIVED_EXPECTED`, so the inclusion is **verified, not assumed**.

### D5 — the proof moves INTO the main proof, and that is the point

`ADR-042 §D7` had the checker run `outbox_event` in its **own** `psql` invocation, because `permission denied` was its
**expected** result while the main proof treats that string anywhere in its stderr as a loud failure. That separate
invocation is now **deleted, not repurposed**: the table's evidence lives in `PROOF_SQL` with the other 49, which is
what re-arms the stderr guard over it. Keeping a private probe would have left one table in the schema whose permission
errors are silently tolerated.

Every `outbox_event` assertion in the checker is the **inverse** of the one `S-E01-2c` shipped, never a deletion:
policy count `0 → 1`, `relrowsecurity` `false → true`, grants `none → SELECT, INSERT, UPDATE`, `SELECT` refused →
`SELECT` **accepted and returning only own-tenant rows**. Plus the four that had no `S-E01-2c` counterpart because
there was nothing to observe: the `NOT NULL` column, the `ON DELETE CASCADE` FK, the leading index, and `DELETE = 0`.

**The positive control is load-bearing here more than anywhere else in this epic.** Before this slice `app_user` held
**zero** privileges on this table. An assertion that only said *"tenant B's event is not visible"* would have been green
on a table nobody could read at all — the exact false green `S-E01-2b`'s header warns about, one slice later.

---

## What this ADR does **not** claim

- **The running application is still not isolated by RLS.** It still connects as the table owner `pilotage`, who is not
  subject to these policies without `FORCE ROW LEVEL SECURITY`. Unchanged by this slice; see `ADR-032 §D5`. The
  remaining step is the **connection cutover** (`S-E01-1`).
- **`FORCE ROW LEVEL SECURITY` is still deliberately absent**, and its absence is still asserted (`FORCED = 0`).
- **`outbox_event` did not become derivable.** `aggregate_id` is still polymorphic and still unconstrained. It became
  *scoped*.
- **The events themselves are not append-only.** `UPDATE` is granted by design (§D3). Only `DELETE` is withheld, and a
  `tenant` cascade still reaches the rows (§D1).
- **Nothing here says the outbox works.** It still has **zero** writers and **zero** readers. This slice makes the table
  safe to grant at the cutover; it does not deliver the relay.

## Consequences

- The residue of `ADR-042 §D4` drops from six names to five, and **every** base table in `public` is now either
  tenant-scoped, tenant-derived, or named reference data. There is no longer any table outside all three.
- `TENANT_COLS` becomes 45 and the agreement becomes `45 + 5 = 50` **with no literal edited anywhere** — the first real
  exercise of `ADR-042 §D3`'s catalog-computed form.
- `schema.prisma` is touched, so the `prisma generate` RED trap (`P-05`) is **armed** for this slice and closed inside
  it. `S-E01-2b`/`S-E01-2c` avoided the trap by not touching the schema; that avoidance was only ever available while
  the work was policies and grants.
- The schema-drift gate can, for the first time in this epic, see part of the change: the column, the constraint and the
  index are `migrate diff`-visible. The names emitted by the migration are therefore exactly the ones Prisma generates.

## Evidence

- `apps/api/prisma/migrations/20260814120000_outbox_event_tenant_scope/migration.sql` — hand-reviewed; never
  `db push`, never `migrate dev`.
- `apps/api/prisma/schema.prisma` — `OutboxEvent.tenantId`, the `Tenant` relation, the leading index.
- `scripts/rls-isolation-check.js` — scratch database → full ledger → connect as `app_user` → **positive control
  first** (tenant A's event visible) → foreign-tenant denial → cross-tenant `INSERT` refused by `WITH CHECK` → the
  silent foreign `UPDATE` proven to have changed nothing, **measured by the owner** → rollback executed.
- `apps/api/src/shared/quality/rls-isolation-gate.spec.ts` — the textual ratchet on the new migration and on the
  inverted checker assertions.
- Catalog and grep measurements in §Context, run for this slice.
