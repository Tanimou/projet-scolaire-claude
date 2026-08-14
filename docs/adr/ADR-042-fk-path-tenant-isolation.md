# ADR-042 — Tenant-derived tables are isolated by an FK-path policy, and the derived set is computed from the catalog rather than listed

- **Status**: `accepted (partial)` — the five FK-derivable tables are decided; `outbox_event` is deferred **by name**, fail-closed, and recorded as `PF-185`.
- **Date**: 2026-08-13
- **Story**: `S-E01-2c` (epic `V3-E01`), closing `PF-183`.
- **Relates to**: `ADR-002` (multi-tenancy), `ADR-032` (tenant enforcement — §D5–§D8), `ADR-040` (role delegation ladder), `ADR-027` (a schema gate needs a database).
- **Supersedes nothing.** It **extends** `ADR-032` from *tables that carry a `tenant_id` column* to *tables that belong to a tenant by foreign key*.

---

## Context — measured against the live catalog on 2026-08-13, not relayed

`ADR-032 §D7` and the migration `20260813120000_tenant_rls_policies` put `ENABLE ROW LEVEL SECURITY` + a
`tenant_isolation` policy on the **44** base tables that carry a `tenant_id` column, and granted exactly those 44 to
the non-owner role `app_user`. `PF-183` recorded that this leaves tables outside every policy.

Re-measured here rather than taken on trust, with `pg_constraint` on the live `pilotage` database:

```sql
SELECT c.relname, a.attname, pc.relname AS parent, con.confdeltype,
       EXISTS (SELECT 1 FROM information_schema.columns cc
                WHERE cc.table_schema='public' AND cc.table_name=pc.relname
                  AND cc.column_name='tenant_id') AS parent_has_tenant
  FROM pg_constraint con
  JOIN pg_class c  ON c.oid  = con.conrelid
  JOIN pg_class pc ON pc.oid = con.confrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN unnest(con.conkey) k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
 WHERE con.contype = 'f' AND n.nspname = 'public'
   AND NOT EXISTS (SELECT 1 FROM information_schema.columns cc
                    WHERE cc.table_schema='public' AND cc.table_name=c.relname
                      AND cc.column_name='tenant_id');
```

Result — every foreign key held by a table that has **no** `tenant_id` column:

| child | fk column | parent | on delete | parent carries `tenant_id` |
|---|---|---|---|---|
| `announcement_receipt` | `announcement_id` | `announcement` | `CASCADE` | **yes** |
| `branding` | `school_id` *(also the PK)* | `school` | `CASCADE` | **yes** |
| `grade_revision` | `grade_id` | `grade` | `CASCADE` | **yes** |
| `import_row` | `batch_id` | `import_batch` | `CASCADE` | **yes** |
| `user_role` | `user_profile_id` | `user_profile` | `CASCADE` | **yes** |
| `user_role` | `role_id` | `role` | `CASCADE` | no |
| `role_permission` | `role_id` | `role` | `CASCADE` | no |
| `role_permission` | `permission_id` | `permission` | `CASCADE` | no |

**Three corrections to the record, stated plainly because the premise that sent this slice here was wrong about them.**

1. **`docs/daily-improvement-v3/NEXT.md` says all six derived tables "derive their tenant by FOREIGN KEY". FIVE do.**
   `outbox_event` holds **no foreign key at all** — it is polymorphic (`aggregate_type` + `aggregate_id`, no
   constraint), and the query above returns nothing for it. The migration header (line 156, *« AUCUNE FK, aucun
   discriminant de tenant »*) was already accurate; the `NEXT.md` prose overstated it. There is no FK path to invent
   for `outbox_event`, and inventing one would be fiction with a policy wrapped around it.
2. **`user_role.school_id` carries no FK constraint.** It is nullable and Prisma declares no relation on it, so it does
   not appear above. `user_role` therefore has exactly **one** tenant-bearing parent today — `user_profile` — and the
   path is unambiguous. This is a fact about today, not a property of the design; §D2 states the rule for when it stops
   being true.
3. **No index needs to be created.** `PF-183` and the brief both flagged R-11 (an FK-path policy without an index on
   the FK is a sequential scan per row read). Measured — every one of the five FK columns is already the **leading**
   column of an existing index, so R-11's precondition is *already discharged* and the work is to **assert** it, not to
   add it:

| child | FK column | index that covers it |
|---|---|---|
| `grade_revision` | `grade_id` | `grade_revision_grade_id_revised_at_idx` |
| `announcement_receipt` | `announcement_id` | `announcement_receipt_announcement_id_user_profile_id_key` (unique) |
| `branding` | `school_id` | `branding_pkey` — the column **is** the primary key |
| `import_row` | `batch_id` | `import_row_batch_id_row_index_key` (unique), `_batch_id_status_idx`, `_batch_id_reconciliation_idx` |
| `user_role` | `user_profile_id` | `user_role_user_profile_id_role_id_school_id_key` (unique) |

The parent side of every lookup is `p.id = …`, i.e. a primary-key probe on all five parents — index-backed by
construction.

**Why this must land before `S-E01-1`, not during it.** Today the five are **fail-closed**, not leaking: they carry no
grant, so `app_user` gets `permission denied`. The connection cutover forks two ways and both are bad — grant them
without a policy and `user_role`, the RBAC assignment table, becomes a cross-tenant read for the application role;
leave them ungranted and five features break with permission errors that read like feature bugs. **The fix is the
policy, never the grant.**

---

## Decision

### D1 — the predicate is an `EXISTS` over the parent, and the tenant clause is written explicitly even though it is redundant for `app_user`

```sql
EXISTS (
  SELECT 1
    FROM public.<parent> p
   WHERE p.id = public.<child>.<fk_col>
     AND p.tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid
)
```

The `nullif(current_setting(…, true), '')::uuid` half is **reused verbatim from `ADR-032 §D6`** and is not
re-litigated here: `missing_ok` covers only *never set*, while a committed `set_config(…, true)` leaves the GUC at
`''` — **not** `NULL` — so a bare cast raises `22P02` on the *second* query of every pooled connection. `nullif` is
not a disguised `IS NULL OR`: `''` maps to `NULL`, and `NULL` lets **no** row through. The direction stays
fail-closed, and an absent or empty context makes `EXISTS` false rather than raising.

**Why `AND p.tenant_id = …` is kept even though the parent is itself under RLS.** Executed as `app_user`, the
subquery is already filtered by the parent's own `tenant_isolation` policy, so the clause adds nothing. Executed as
the **owner** — who runs the migrations, the seeds, and today's entire application — the parent's policy does *not*
apply, and this clause is the only thing doing the work. Dropping it as "redundant" would make the child policy
correct exactly for the role it happens to be proven against, and silently open for every other. It stays, and the
reason is recorded here so nobody removes it as dead weight.

`FOR ALL TO PUBLIC`, with `USING` and `WITH CHECK` **both declared explicitly and identical** — same three
requirements as the 44 (`ADR-032 §D6`), for the same reasons: a policy naming a role exempts every *other* non-owner
role in silence, and a `NULL` `with_check` falls back to `USING`, which looks right today and breaks the day someone
adds a permissive one. The census assertions `WITH_CHECK_NULL = 0` and `ROLE_SCOPED = 0` cover both, and the policy
carries the **same name** `tenant_isolation` because the census counts by name.

### D2 — with more than one tenant-bearing parent, the path is **chosen and named**, never derived

The catalog derivation of §D3 yields the **set**; it cannot yield the **predicate**. `user_role` holds two FKs and
only one parent (`user_profile`) carries a tenant — so the choice is forced today, and it is written down rather than
inferred. `role` is reference data with no tenant and must never appear in the predicate.

**The rule for when this stops being forced:** if a future child has *two* FK parents that both carry `tenant_id`, the
policy must **`AND` both** `EXISTS` clauses, never pick one. A row whose two parents disagree is a cross-tenant row; it
must be invisible from **both** sides, not visible from whichever side the author happened to write.

### D3 — the derived set is **catalog-computed**, and the agreement is against the **expected** count, not the **policied** count

`scripts/rls-isolation-check.js` asserts three agreements keyed to `TENANT_COLS` (`RLS_ON`, `POLICIES`, `GRANTED`).
Adding five policied tables breaks all three. It must **not** be repaired by hard-coding 49 or by subtracting a frozen
list — that is precisely how a seventh derived table ships unprotected and invisible.

**And it must not be repaired with the obvious formula either.** `RLS_ON == TENANT_COLS + DERIVED_POLICIED`, where
`DERIVED_POLICIED` counts derived tables that *have* a policy, is **vacuous**: ship a sixth derived table with no
policy and `DERIVED_POLICIED` stays 5 while `RLS_ON` stays 49, so `49 == 44 + 5` **passes** — the gate is blind to the
exact case it was built for. The count on both sides of the `+` must be independent of whether the work was done.

The agreement is therefore against `DERIVED_EXPECTED` — computed from `pg_constraint`, on the scratch database, with
the full ledger applied:

> `DERIVED_EXPECTED` = base tables (`relkind='r'`) in `public` that have **no** `tenant_id` column and hold **at
> least one** foreign key whose referenced table **does** have a `tenant_id` column.

```
RLS_ON   == TENANT_COLS + DERIVED_EXPECTED
POLICIES == TENANT_COLS + DERIVED_EXPECTED
GRANTED  == TENANT_COLS + DERIVED_EXPECTED
```

Now a sixth derived table raises `DERIVED_EXPECTED` to 6 while `RLS_ON` stays 49, the counts disagree, and the gate
**fails**. It is read from `pg_constraint` rather than `information_schema.table_constraints` so that multi-column
foreign keys are seen. No number is hard-coded and no name is subtracted; the agreement survives schema growth and
cannot be satisfied by deleting a table.

### D4 — the tables outside the derivation stay outside **named, with reasons**, and their absence is asserted

They fall outside **naturally** — none of them holds an FK to a tenant-bearing table — so no glob and no subtraction
list is involved. They are named here for legibility, and asserted *not granted* and *not policied* **by name**, so a
future surprise (say, an FK added from `role` into a tenant-scoped table) reads as a named failure rather than a bare
count mismatch:

| table | why it is outside |
|---|---|
| `permission`, `role`, `role_permission` | reference data by design: no tenant discriminant, and no FK to one (`role_permission`'s two parents are both tenant-less). |
| `tenant` | **auto-discriminant** — its primary key *is* the discriminant. A policy here would break the identity seam, which must read `tenant` **by slug** *before* any tenant is resolved (`S-E01-1`). Excluded deliberately, not forgotten. |
| `_prisma_migrations` | the migration ledger. Not tenant data. |
| `outbox_event` | no FK, no discriminant — **not derivable**. See §D7. |

### D5 — privileges are **measured from the call sites**, not assumed uniform; **none of the five gets `DELETE`**

`ADR-032 §D7` established that the grant is not uniform (`audit_log` and `conversation_message` get `SELECT, INSERT`
only). The same discipline applies here, and the same evidence standard: a grep over `apps/**` and `packages/**`,
excluding specs and owner-connected seeds.

| table | grant | measured justification |
|---|---|---|
| `grade_revision` | **`SELECT, INSERT`** | **It IS the grade audit trail (G-AUDIT).** Same argument as `audit_log`: a correction of a correction is a **new row**, never an edit — that is what `previous_value` / `new_value` / `reason` / `revised_by` / `revised_at` are for. Zero `gradeRevision.update\|delete\|upsert` callers exist; the single `deleteMany` is `apps/api/prisma/seed-demo.ts:300`, a seed that connects as the **owner** `pilotage` and is unaffected by `app_user`'s grants. |
| `user_role` | **`SELECT, INSERT, UPDATE`** — no `DELETE` | Revocation is an **update**: `tx.userRole.updateMany({ … revokedAt … })` at `apps/api/src/modules/identity/users.service.ts:228`. No delete caller exists. A hard `DELETE` would erase the grant history the `ADR-040` delegation ladder audits against; `UPDATE` is the ladder's own verb, so `DELETE` is withheld deliberately. |
| `branding` | **`SELECT, INSERT, UPDATE`** | `upsert` + `update` (`branding.controller.ts:51`, both seeds). No delete caller. |
| `announcement_receipt` | **`SELECT, INSERT, UPDATE`** | read-marking is an `update` — three call sites (`announcements.controller.ts:340,566`, `student-portal.service.ts:408`). No delete caller. |
| `import_row` | **`SELECT, INSERT, UPDATE`** | `importRow.update` / `updateMany` in `packages/imports-core/src/engine.ts` and `imports.service.ts:413`. No delete caller. |

The count agreement of §D3 sees table **count**, never privilege **shape** — the numbers are identical whether a table
holds `SELECT` or `SELECT, INSERT, UPDATE, DELETE`. The shape is therefore asserted separately, in both directions
(the table is granted *at all*, **and** nothing outside its allowed set reaches it), exactly as `ADR-032 §D7` does for
the append-only pair.

> **Divergence from the story doc, resolved here because the two disagree and the implementer needs one answer.**
> `docs/spec/features/v3-e01/stories/S-E01-2c.md` grants `SELECT, INSERT, UPDATE, DELETE` to `announcement_receipt`,
> `branding` and `import_row`, justifying `import_row` with *"a rolled-back batch deletes its rows"*. **Re-measured:
> that is not what the code does.** There is no `importRow.delete` or `importRow.deleteMany` anywhere in `apps/**` or
> `packages/**`; `imports.service.ts:300` `rollback()` enqueues a job whose engine compensates by **reversing the
> created entities**, and the rows themselves are re-classified with `importRow.update`, never removed. No delete
> caller exists for the other two either — `announcement.delete` (`announcements.controller.ts:582`) removes the
> **parent**, and `schools.controller.ts:374` is deliberately `school.close`, not `school.delete`.
>
> **The ruling is: none of the five receives `DELETE`.** `ADR-032 §D7` already fixed the principle — *"an unnecessary
> grant is a widened blast radius"* — and `GUARDRAILS` §1 requires minimal access on children's data. A privilege with
> no caller is pure blast radius.
>
> The story doc's `AC-10` is nevertheless **right and should be widened to all five**: withholding `DELETE` raises the
> question of whether the `ON DELETE CASCADE` from the parent still fires, and that must be **executed, not believed**
> (§D6 says it does — RI actions run as the referencing table's owner with row security off — but §D6 is a claim until
> the check runs it). Its escape hatch is the correct shape and is adopted: **if the cascade genuinely fails for a
> table, add `DELETE` to that table and write the measured reason in the migration** — never add it pre-emptively to
> avoid finding out.

### D6 — the honest limit: `ON DELETE CASCADE` is subject to neither RLS nor the child's grant

Measured: **all five** foreign keys are `ON DELETE CASCADE` (`confdeltype = 'c'`). PostgreSQL executes
referential-integrity actions as the **owner of the referencing table** and does not apply row-level security to them.

**Therefore `app_user` — which holds `DELETE` on `grade`, `announcement`, `school`, `import_batch` and `user_profile`
— can remove `grade_revision` rows by deleting the parent grade, despite `grade_revision` being granted `SELECT,
INSERT` only.** Append-only on `grade_revision` is append-only against **direct DML**, not against a **parent
cascade**. Writing "the grade audit trail is unrewritable" without this sentence would be the `PF-02` over-claim
repeated one level down, which is the exact failure this epic exists to end.

What the cascade **cannot** do is cross a tenant: to delete the parent you must first *see* it, and the parent's own
`tenant_isolation` policy confines that to the current tenant. **The cascade is tenant-safe and audit-unsafe.** The
audit-unsafe half is recorded as a finding, not fixed here — the fix is `ON DELETE RESTRICT` on
`grade_revision.grade_id` plus a soft-delete for grades, which is a `schema.prisma` change *and* a behaviour change,
i.e. its own slice.

### D7 — `outbox_event` is deferred **by name**, stays **fail-closed**, and that is **asserted**

It has no foreign key and no tenant discriminant (`aggregate_type` + `aggregate_id`, polymorphic, unconstrained), so
there is no FK path over which to write a policy. Isolating it requires a **denormalised `tenant_id` column plus a
backfill of existing rows** — a `schema.prisma` change with a data migration, and not this slice.

Until then it receives **no grant and no policy**, and both absences are **asserted by name, with the reason**, so a
later run cannot "fix" the resulting permission error by widening the grant — the one branch `PF-183` explicitly rules
out.

**Measured, and this is what makes the deferral safe rather than merely convenient:** `outboxEvent.` has **zero**
callers anywhere in `apps/**` or `packages/**`. The table is scaffolding with no writer, so the cost of leaving it
fail-closed through the `S-E01-1` cutover is **zero features broken** — a correction to `PF-183`'s "six features
break", which is true of five, not six. Recorded as **`PF-185`**.

### D8 — pure expand; the rollback is **executed**, not merely written

No column is added, no data is moved, and **no index is created** (§Context: all five FK columns already lead an
index). Pure expand ⇒ there is no contract phase and no data state to rebuild, so
`DROP POLICY` + `DISABLE ROW LEVEL SECURITY` + `REVOKE` is a *sufficient* reversal — and it is **executed** by
`scripts/rls-isolation-check.js` on the scratch database, as the 44's was. A rollback that is only written in a header
is an assertion about a comment.

`CREATE POLICY` has no `IF NOT EXISTS` in PostgreSQL 15, so each `CREATE` is preceded by `DROP POLICY IF EXISTS`: a
partial application can be re-run. The grants are guarded on `pg_roles` (roles are **cluster** state, migrations apply
to a **database**), while the `ENABLE` / `CREATE POLICY` half stays **unconditional** — it is the security property
and depends on no role.

---

## What this ADR does **not** claim

Written out because the over-claim is the recurring defect this epic exists to stop:

- **The running application is still not isolated by RLS.** It still connects as the table owner `pilotage`, who is
  not subject to these policies without `FORCE ROW LEVEL SECURITY`. Unchanged by this slice; see `ADR-032 §D5`. The
  remaining step is the **connection cutover** (`S-E01-1`), not more policy work.
- **`FORCE ROW LEVEL SECURITY` is still deliberately absent**, and its absence is still asserted (`FORCED = 0`).
  Adding it today would return zero rows to every portal.
- **`outbox_event` is not isolated.** It is fail-closed and currently unused. See §D7 and `PF-185`.
- **`grade_revision` is not unrewritable.** See §D6 — a parent cascade reaches it.
- **This is not a `schema.prisma` change.** Policies and grants are not modellable in Prisma, and
  `prisma migrate diff` cannot see them either — which is why `scripts/rls-isolation-check.js` is structurally
  necessary and not merely convenient (`PF-184`).

## Consequences

- Five more tables become reachable by `app_user` **with** a policy, so the `S-E01-1` cutover meets one unprotected
  table (`outbox_event`, unused) instead of six.
- The census in `scripts/rls-isolation-check.js` stops being keyed to `tenant_id` columns alone and becomes an
  agreement over *tenant-scoped* + *tenant-derived*, both catalog-computed. A new table in **either** class shipped
  without a policy now fails the gate.
- FK-path reads pay one primary-key probe on the parent per row. Every FK column and every parent PK is index-backed
  (§Context), and the check asserts the FK-column index rather than assuming it.
- The `grade_revision` cascade hazard (§D6) is now written down and has an owner, instead of being an implicit
  over-claim.

## Evidence

- `apps/api/prisma/migrations/<new>/migration.sql` — hand-reviewed; never `db push`, never `migrate dev`.
- `scripts/rls-isolation-check.js` — scratch database → full `migrate deploy` → connect as `app_user` → **positive
  control first** (rows visible under tenant A) → foreign-tenant denial → cross-tenant `INSERT` rejected by
  `WITH CHECK` → rollback executed → scratch dropped. Fails, never skips (`DNC-08`, `ADR-027`).
- `apps/api/src/shared/quality/rls-isolation-gate.spec.ts` — the textual ratchet on the migration and the checker.
- Catalog measurements in §Context, run against the live `pilotage` database on 2026-08-13.
