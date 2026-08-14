# ADR-046 — The authorization reference surface is GRANTED to `app_user`, read-only, and `role` stops being classified as global

- **Status**: `accepted` — the reference surface, the `role` / `role_permission` / `tenant` policies and the
  `role_school_id_fkey` structure are decided and proven by execution. The **write** path over the same surface is
  deferred **by name** as `PF-193`; the `tenant` write is a cutover blocker owned by `PF-185`.
- **Date**: 2026-08-14
- **Story**: `S-E01-1b` (epic `V3-E01`), advancing `PF-02` half (a) and recording `PF-191`, `PF-192`, `PF-193`.
- **Relates to**: `ADR-002` (multi-tenancy), `ADR-015` (permission model, custom roles), `ADR-032` (tenant
  enforcement — §D5–§D8), `ADR-042` (FK-path isolation — **amended here, §D1**), `ADR-043` (the identity seam
  resolves, never provisions), `ADR-044` (denormalised outbox tenant).
- **Number**: `046` and not `045`. `045` is claimed by an **open PR** and is therefore invisible from `main`. That is
  the exact shape of `TOOL-29` / `TOOL-30`; this allocation was made against `main` **plus** the open PRs.

---

## Context — measured on 2026-08-14, not relayed

The running application connects as `pilotage`, the table **owner**, so it is exempt from its own policies. Fifty
tables carry a `tenant_isolation` policy and are proven to deny for the non-owner role `app_user`. What remains is the
**connection cutover**, and `20260813120000_tenant_rls_policies` §LES GRANTS states the blocker in its own words:

> « Le jeu de GRANTs est DÉLIBÉRÉMENT INCOMPLET pour la bascule : `role`, `permission`, `role_permission`,
> `user_role` et `tenant` restent illisibles pour `app_user`, donc la première jointure d'autorisation échouerait. »

Measured against a scratch database with the full ledger applied, as `app_user`:

```
BEFORE   psql: ERROR:  permission denied for table role
```

Three of that sentence's premises were re-measured rather than trusted, and **three of them were wrong or stale**:

| Premise | Verdict |
|---|---|
| `user_role` is still ungranted | **STALE.** `S-E01-2c` made it one of the five derived tables; it holds `SELECT, INSERT, UPDATE`. |
| `role` is "RÉELLEMENT GLOBALE — aucun discriminant de tenant" (§LE PÉRIMÈTRE, class A) | **FALSE. This is `PF-191`.** `role.school_id` → `school.tenant_id NOT NULL`. A row with a non-null `school_id` belongs to exactly one tenant. |
| `role`'s foreign key is nullable, which is why the derivation missed it | **FALSE.** There is **no foreign key at all**. `pg_constraint` returns no `contype='f'` row for `role`, and `schema.prisma` declared no `@relation`. |

And a fourth, from the story's own AC-3:

| Premise | Verdict |
|---|---|
| the identity seam must read `tenant` **by slug** before any tenant is resolved | **STALE after `S-E01-1a`.** There is no by-slug `tenant` read anywhere in `apps/api/src`. The only reads are `analytics.service.ts` and the worker's `audit-csv.generator.ts`, both `where: { id: tenantId }`. Every by-slug read is in `prisma/seed*.ts`, which connects as the **owner**. The one remaining by-slug **write** is `register.controller.ts` (`tenant.upsert`), which is itself the open finding `PF-185`. |

---

## Decision

### D1 — the reference surface is **granted**, rather than the application keeping the owner connection

The alternative was real and had to be argued down rather than ignored: keep connecting as `pilotage` forever and rely
on application-level scoping. It is rejected because it makes every policy in the schema decorative. An owner is exempt
from its own policies without `FORCE ROW LEVEL SECURITY`, so the fifty policies proven to deny protect **nothing that
is running**. The cutover is the only thing that converts them from a description into an enforcement, and the cutover
is impossible while the first authorization join raises `permission denied`.

So `app_user` receives the reads the join needs — `role`, `role_permission`, `permission`, `tenant`,
`_prisma_migrations` — and nothing else. Measured after:

```
AFTER    AUTHZ_JOIN|1                 (user_profile -> user_role -> role -> role_permission -> permission)
         AUTHZ_JOIN_FOREIGN|0         (the same join for a user of the other tenant)
```

**Amendment to `ADR-042 §D3`.** Granting `role` a bare `SELECT` would have been a cross-tenant read, so `role` needs a
policy; the moment it has one it also needs a **foreign key** (§D2) to be derivable at all; and the moment it is
derived, `role_permission` becomes the two-level residue that `ADR-042 §D3` explicitly predicted and left open. That
prediction was tested, not assumed — with a bare grant and no policy, under `GUC = tenant A`:

```
A_SEES_B_ROLEPERM|1          ← tenant A reading tenant B's custom-role privilege composition
```

The derivation is therefore **transitively closed**: a recursive CTE over `pg_constraint` in
`scripts/rls-isolation-check.js`, and a fixpoint iteration in `rls-isolation-gate.spec.ts`. Neither asks whether a
policy exists — `ADR-042 §D3`'s central argument is untouched; only its depth was wrong. `ADR-042` is annotated in
place with this amendment.

**And the derivation is now a SINGLE definition, exported.** `ADR-045`'s sibling suite
(`scripts/tenant-adversarial-check.js`) imports eight constants from `rls-isolation-check.js` *precisely so the two
cannot disagree* — and then carried its **own** one-level census SQL for the same set. That second query agreed with
the imported constant only while no derived table had a derived child; `role_permission` is that child, so closing
the derivation here made the constant say 7 and the query say 6, and four set-equality assertions in the sibling went
red. `ADR-042 §D3` forbids two literals for one set; this was the same defect one layer down — **two queries about
one catalog fact** — and the repair is the same shape: `DERIVED_SET_SQL` and `AUTO_DISCRIMINANT_SQL` are exported
from `rls-isolation-check.js` and imported by the sibling, so there is one derivation and no second place to drift.
Patching the four literals was available and rejected for the reason in `D2` below: it turns an agreement back into a
constant.

`role_permission`'s predicate is written out **in full** (two hops: `role`, then `school`) rather than relying on
`role`'s own policy. Executed as `app_user` the sub-query would already be filtered by `role`'s policy and the second
hop would be dead code; executed as the **owner** — migrations, seeds, and the whole application today — no policy
applies and the full predicate is the only thing working. This is `ADR-042 §D1` clause 3 applied one level deeper.

### D2 — `role_school_id_fkey` is **materialised**, `ON DELETE CASCADE`, and `ON DELETE SET NULL` is banned by name

`role.school_id` has carried tenant data since the baseline with no foreign key to prove it. That is what hid `PF-191`
for three slices, and `scripts/rls-isolation-check.js` had already written the remedy down: *"the day ADR-015 custom
roles add `role_school_id_fkey`, `role` correctly ENTERS the derived set."*

The alternative — editing `DERIVED_EXPECTED`'s effective value by hand, or adding `role` to a frozen list — is
rejected outright. It would turn an agreement into a constant and re-open the exact blindness `ADR-042 §D3` exists to
close.

- **The Prisma relation is not optional.** Measured: adding the FK in SQL without `Role.school` / `School.roles` turns
  the drift gate **red** — `prisma migrate diff --exit-code` reports *"Removed foreign key on columns (school_id)"*,
  exit 2. With the relation declared and `onDelete: Cascade` against SQL `ON DELETE CASCADE ON UPDATE CASCADE`:
  *"No difference detected"*, exit 0. `pnpm --filter @pilotage/api exec prisma generate` runs in the same diff.
- **`CASCADE`, not `RESTRICT`, and never `SET NULL`.** `SET NULL` **promotes** a school-scoped role to a **global** one
  at the moment its school is deleted — the most severe escalation shape this repository knows how to report
  (`legacy-escalation-sweep.ts`). It is forbidden by name and asserted by a scan of the executable SQL. `CASCADE` is
  the convention of all 13 other `school_id` foreign keys, and it is the only action that keeps the drift gate green.
  `RESTRICT` was considered and rejected: it would make deleting a school fail on a row the operator cannot see.
- **What `CASCADE` changes, stated rather than left to be discovered:** deleting a school now deletes its custom roles,
  where they were previously left behind as orphans. That is the better outcome, because an orphaned role is invisible
  to **every** tenant under the new policy — its permissions would vanish from the authorization join with no error
  raised anywhere, which is fail-closed presenting as a *wrong answer* rather than a denial. The FK now makes that
  state unreachable, and both halves are executed by the harness (`OWNER_ORPHAN_ROLE_ACCEPTED` absent, FK violation
  observed; `OWNER_ROLES_AFTER_CASCADE|0` with `OWNER_ROLES_BEFORE_CASCADE|1` as its control).
- **Live risk: none.** `role` holds **zero** rows on the live database, so there is no backfill and no validation
  window. The migration still runs an orphan pre-check that `RAISE EXCEPTION`s **with the count**, rather than adding
  the constraint `NOT VALID` (a promise dressed as a constraint) or skipping.
- **One index is created, and it is a consequence rather than a precaution.** With `role` derived, the edge
  `user_role.role_id -> role` joins the structural derivation, and R-11 requires a leading index on every derived FK
  column. `user_role`'s existing unique index leads on `user_profile_id`, not `role_id`, so `user_role_role_id_idx`
  (Prisma's name for `@@index([roleId])`) is created. Without it the harness goes red and the tempting repair is
  weakening the ratchet. It is due anyway: the `role -> user_role` cascade is a sequential scan without it.
  `role.school_id` and `role_permission.role_id` need **no** new index — `role_school_id_slug_key` and
  `role_permission_pkey` already lead on them, measured.
- **`ADR-042 §D2` is amended, not reversed.** "`user_role -> role` is a dead end" is still the right policy routing,
  for a **different reason**: `role` is no longer tenant-less, but a *system* role (`school_id IS NULL`) is visible to
  everyone, so routing `user_role` through `role_id` would make every assignment to a system role visible to every
  tenant. The tenant path stays `user_profile_id`.

### D3 — the `IS NULL OR` in `role`'s predicate is a **data** fact, not a **context** fact

```sql
role.school_id IS NULL
OR EXISTS (SELECT 1 FROM public.school s
            WHERE s.id = role.school_id
              AND s.tenant_id = nullif(current_setting('app.current_tenant_id', true), '')::uuid)
```

The shape banned by `DNC-10` is the one where a **null context opens the table**: `current_setting(…) IS NULL OR …`.
Here what is null is a **column value**: `school_id IS NULL` means *this role belongs to no school* — a **system**
role, global reference data by design (`ADR-015`). The context relaxes nothing: with no GUC the cast yields `NULL`,
the `EXISTS` is false, and **no school-scoped role is visible at all**. Verified by execution:

```
CTX_A_SYSTEM_ROLE|1   CTX_B_SYSTEM_ROLE|1   NOCTX_SYSTEM_ROLE|1     ← global reference data
NOCTX_SCOPED_ROLE|0                                                  ← …and the half that makes it mean something
```

The three existing `DNC-10` regexes in `prisma.service.spec.ts` were checked against this predicate and match none of
it — `current_setting` appears to the **right** of the `OR`, never to its left. The unqualified
`/IS NULL OR/i` ratchet that guards the *derived* migration is **deliberately not extended** to this file: it is
correct there, where no nullable FK exists, and extending it would make the only correct predicate red, whose tempting
repair is deleting the ratchet everywhere. What is ratcheted instead is the **form**: every `IS NULL OR` in the new
migration's executable SQL carries `school_id` immediately to its left, so the shape cannot spread by copy-paste to a
table where it *would* be fail-open.

**`PF-192` — and it is spent here rather than left open.** The three anchored regexes are **evadable through this
repository's own idiom**: `nullif(current_setting('…', true), '')::uuid IS NULL OR …` — the canonical fail-open, written
the way every predicate in this codebase is written — matches none of them, because `\([^)]*\)` cannot cross a
parenthesis and `\s*` cannot cross the 43 intervening characters. That hole was survivable only while no legitimate
`IS NULL OR` existed in the corpus. This slice ships the first one, so a **windowed** form is added and both directions
are asserted: it matches the evasion, it does **not** match this predicate, and the old anchored form is shown to miss
the evasion — which is what proves the new line adds something.

**The honest exposure, written rather than omitted.** With no tenant context at all, `app_user` reads **every system
role** and **every `permission` row**. That is intended — it is global reference data — but it must be recorded,
because it is the sentence a future reader would otherwise mistake for a leak, or worse, for coverage.

**The residue, named and NOT fixed here.** `roles.controller.ts` never sets `schoolId` on creation, so every role the
product can currently create is a *system* role and falls in the `IS NULL` branch. The policy above therefore isolates
a shape that only an import or a future story produces. That is `PF-08` / `ADR-015 D8.6` territory; changing it is a
product-behaviour change disguised as a migration, and it is deliberately out of scope. The forbidden "fix" is making
`school_id IS NULL` **deny** — that would hide every seeded system role and lock all four portals out.

### D4 — `tenant` gets the plain `id = <GUC>` policy, and **no `SECURITY DEFINER` function is written**

The story's preferred design was a narrow `SECURITY DEFINER` `resolve_tenant_by_slug(text)` to break a
chicken-and-egg: the identity seam must read `tenant` by slug before a tenant is resolved. **That chicken-and-egg no
longer exists** (see Context). A named `SECURITY DEFINER` function would therefore ship with **zero callers** — a
standing privilege-escalation surface added to solve a problem that was already solved by `S-E01-1a`. That is the same
reflex as `GRANT pg_signal_backend`, and it is refused for the same reason.

`tenant` gets `USING (tenant.id = <GUC>)` with an identical `WITH CHECK`. The enumeration oracle the epic §10 forbids
is closed by execution rather than by argument:

```
NOCTX_TENANTS|0        CTX_A_TENANTS|1        CTX_A_FOREIGN_TENANT|0        CTX_B_OWN_TENANT|1
```

`tenant` is neither tenant-scoped (its primary key **is** the discriminant) nor tenant-derived (it has no outgoing
foreign key), so it needed a **third catalog-derived term** in the census agreement rather than a policy count: the
**parents of every foreign key whose leading child column is named `tenant_id`**. Measured: exactly `{tenant}`. Written
as a query and never as `+ 1`, so a second auto-discriminant table shipped without a policy fails the gate.

The one caller this breaks at cutover is `register.controller.ts`'s `tenant.upsert` by slug. It is named as a
**cutover blocker owned by `PF-185`**, and it is **not** unblocked here. Granting `INSERT`/`UPDATE` on `tenant` "so
registration keeps working" would make the application role able to **mint tenants** — `PF-185` made permanent.

### D5 — `SELECT` only, on the whole reference surface, and the honest scope statement that goes with it

`app_user` receives `SELECT` on `role`, `role_permission`, `permission`, `tenant` and `_prisma_migrations`, and
nothing else. Privilege data the application role can **write** is a privilege-escalation path: a role that can
rewrite `role_permission` can grant itself every permission in the schema. `ADR-032 §D7` already fixed the principle,
and `GUARDRAILS §1` requires minimal access over children's data.

The closed privilege set of `scripts/rls-isolation-check.js` gains the string `'SELECT'`. A third entry in a closed set
reads like a widening and is the opposite — it is the **narrowest** string in the set. `DERIVED_DELETE` stays `0`.

The census invariant is **restated, never relaxed**. `GRANTED == policiedExpected` is what makes
`GRANT … ON ALL TABLES IN SCHEMA public` impossible to ship, and turning it into `>=` would be the locally cheapest
repair and the most expensive mistake. It becomes a **named set equality** in both directions,
`GRANTED == POLICIED ∪ REFERENCE_SURFACE`, plus a second assertion that each reference-surface table holds **exactly**
`SELECT`, read per table from `information_schema.role_table_grants` so a balancing count can never stand in for it.

**And the scope statement, stated honestly rather than as a claim about the application.** "SELECT only" is a
statement about **this slice**, not an assertion that the application never writes these tables. It does:
`roles.controller.ts` calls `role.create`, `role.update`, `role.delete`, `rolePermission.deleteMany` and
`rolePermission.create` — the admin portal's custom-role editor. Those work today because the app is the owner; they
would fail after the cutover. The write path is deferred **by name** as **`PF-193`**, because it needs its own
decision (a separate administration role? a narrow `SECURITY DEFINER` writer?) and not a reflex widening of this
grant. All four refusals are proven by execution, in their own `psql` process because `permission denied` is the
expected result there and the main proof treats that string as a loud failure.

`_prisma_migrations` is in the surface for a measured reason with two live consumers: `apps/api/src/main.ts` runs
`assertMigrationsClean` at **boot**, and `health.controller.ts` calls `readMigrationState` on **every health probe**.
A missing `SELECT` would break the cutover twice. Its grant carries a second guard on `to_regclass` in addition to the
`pg_roles` one, and prints which branch it took: the table is created by Prisma's CLI, never by a `migration.sql`, so
a bare grant would raise *relation does not exist* on any database where the CLI has not run — which would kill the
proof harness before its first assertion. The harness now creates the table itself, with Prisma 5.22's shape, so that
both the grant and the readability are proven rather than skipped.

`permission` is the only table in the surface with **no** policy, and that classification was measured rather than
inherited: its columns are `id`, `code`, `label`, `resource_type`, `action`, `description` — no discriminant, and no
foreign key to a table that has one. It is genuinely global, unlike `role`.

### D6 — EXPAND only, with an executable rollback that also removes the structure

No column is dropped, no data is rewritten, and there is **no behaviour change to the running application**: it still
connects as the owner, `FORCE ROW LEVEL SECURITY` is still absent, and `DATABASE_URL` is untouched. The cutover is
**not** in this slice.

This is the first of the four RLS migrations that is **not an expand *pur***: a constraint and an index are created, so
`DROP POLICY` + `DISABLE ROW LEVEL SECURITY` + `REVOKE` is no longer a sufficient reversal. The rollback is written in
the migration header, is guarded on `pg_roles` and on `to_regclass`, drops the policies **before** disabling RLS
(leaving RLS on with no policy would deny everything to `app_user`), revokes the reference surface — which the generic
`relrowsecurity` loop cannot reach, because those tables hold a grant and no policy — and drops
`role_school_id_fkey` and `user_role_role_id_idx`. It also names the half that is not SQL: reverting `Role.school`,
`School.roles` and `@@index([roleId])` in `schema.prisma` and re-running `prisma generate`.

It is **executed** by `scripts/rls-isolation-check.js`, not merely written: `AFTER_POLICIES|0`, `AFTER_RLS|0`,
`AFTER_GRANTS|0`, `AFTER_ROLE_FK|0`, `AFTER_ROLE_INDEX|0`. A rollback that is never played is an assertion about a
comment.

---

## Consequences

**What this does not say — and the whole point of writing it down.** The running application is **still not isolated by
RLS**. It connects as the table owner, who is not subject to these policies. What this slice adds is that the
authorization join now *works* for a non-owner role, and that `role`, `role_permission` and `tenant` deny across
tenants for that role, proven by execution. The remaining step is the **connection cutover**, and it now has two named
blockers rather than an unnamed one: `PF-193` (the role write path) and `PF-185` (the tenant upsert in registration).

**Positive.** `PF-02` half (a) advances: the reference surface is no longer the reason the cutover cannot be attempted.
`PF-191` is closed by correcting a false classification in place, and by making the structure that made it detectable.
The census agreement gains a third catalog-derived term and a transitively closed derivation, so two whole classes of
invisible table stop being invisible. `PF-192` closes a ratchet hole *before* the first legitimate `IS NULL OR` makes
it dangerous.

**Negative / accepted.** Deleting a school now deletes its custom roles (§D2). One index is added. The application's
role-editing endpoints will fail at cutover until `PF-193` is decided, and registration will fail until `PF-185` is —
both stated rather than silently unblocked. And with no tenant context, `app_user` reads all system roles and all
permissions (§D3): intended, recorded, not hidden.

**Open, by name.**

| Finding | What it is |
|---|---|
| `PF-191` | `role` was classified "really global" while carrying tenant data through `school_id`. **Closed by this ADR** — comment corrected in place, structure and policy shipped. |
| `PF-192` | The `DNC-10` textual ratchet was evadable through this repository's own `nullif(current_setting(…))` idiom. **Closed by this ADR** — windowed regex, both directions asserted. |
| `PF-193` | `role` / `role_permission` **writes** (`roles.controller.ts`) have no path after the cutover. Needs its own decision; not a widening of this grant. |
| `PF-185` | `register.controller.ts` upserts `tenant` by slug. A cutover blocker; `INSERT` on `tenant` is refused here on purpose. |
| `PF-08` / `ADR-015 D8.6` | `roles.controller.ts` never sets `schoolId`, so every product-creatable role is a *system* role and the `role` policy does not isolate it. Named in §D3, not fixed here. |
