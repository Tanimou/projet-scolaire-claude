# ADR-047 — The authorization WRITE surface: `app_user` may edit CUSTOM roles, and a SYSTEM role is made unwritable BY THE DATABASE

- **Status**: `accepted` — the grant, the guard shape (`AS RESTRICTIVE`, per command) and the census amendment are
  decided. What this ADR does **not** decide is the cutover itself (`S-E01-1`), and it does **not** close the
  cross-tenant custom-role write recorded below as `PF-194`.
- **Date**: 2026-08-14
- **Story**: `S-E01-1c` (epic `V3-E01`), closing `PF-193`, unblocking `S-E01-1` / `PF-02` half (a), recording
  `PF-194` and `TOOL-32`.
- **Relates to**: `ADR-002` (multi-tenancy) · `ADR-013` + `PF-153` (customization layer — custom roles are global)
  · `ADR-015` (permission model, `D8.6`) · `ADR-032 §D5–§D8` (tenant enforcement, minimal privilege) ·
  `ADR-042 §D3`/`§D5` (**§D5 amended here, §D4 of this ADR**) · `ADR-045` (adversarial suite) ·
  `ADR-046 §D5` (**superseded in one clause: `SELECT` only was a scope statement for `S-E01-1b`; this ADR is the
  decision it deferred**).
- **Number**: `047`. Allocated against `main` **plus every open pull request** (`TOOL-30` anti-recurrence). The six
  open PRs are all Dependabot bumps and claim no ADR and no finding id; `046` is the highest on `main`.

---

## Context — measured on 2026-08-14 against this checkout, not relayed

`20260814180000_role_reference_surface_rls` granted `app_user` **`SELECT` and only `SELECT`** on `role`,
`role_permission`, `permission`, `tenant`, `_prisma_migrations`. `ADR-046 §D5` was explicit that this was a **scope
statement**, not a claim about the application, and it named the debt: `PF-193`.

The five writes, re-measured rather than trusted, in `apps/api/src/modules/identity/roles.controller.ts`:

| Line | Call | Privilege needed |
|---|---|---|
| `:154` | `tx.role.create` (nested `rolePermissions.create`) | `INSERT` on `role` **and** on `role_permission` |
| `:242` | `tx.role.update` | `UPDATE` on `role` |
| `:250` | `tx.rolePermission.deleteMany` | `DELETE` on `role_permission` |
| `:252` | `tx.rolePermission.create` | `INSERT` on `role_permission` |
| `:294` | `tx.role.delete` | `DELETE` on `role` |

A full sweep of `apps/api/src` and `apps/worker/src` (specs excluded) for `\b(prisma|tx)\.<model>\.<verb>` returns
**no other writer** of either table, and — measured, and it matters for `§D3` — **no `rolePermission.update*` call
site at all**. `role` needs four verbs; `role_permission` needs **three**, not four.

Three application-side facts, each of which the decision below leans on:

- `create()` writes `isSystem: false` as a **literal**, never from the request body.
- `update()` (`:190`) and `remove()` (`:278`) each `throw new ForbiddenException` when `role.isSystem`.
- `role.isSystem` is `Boolean @default(false)` — **NOT NULL**, so `is_system = false` is never `NULL` and never
  degrades to three-valued logic. This was checked because a nullable column would have made the guard below
  fail-**open** on `NULL`.

So the policy this ADR installs is a strict **superset** of what the shipped product needs. **No application code
change is required, and none is made** — measured, not assumed.

---

## Decision

### D1 — the write is **granted**, and this is a NARROWING

`app_user` receives `INSERT, UPDATE, DELETE` on `role` and `INSERT, DELETE` on `role_permission`, under policies that
make a SYSTEM role unwritable.

The objection this must answer is *"you are giving the application role write access to privilege data — `ADR-046 §D5`
said that is an escalation path."* The answer is that the comparison is not against zero. **Today the application
connects as `pilotage`, the table OWNER.** An owner is exempt from its own policies while `FORCE ROW LEVEL SECURITY`
is absent, and it is deliberately absent (`ADR-032 §D5`). So today all five writes already execute, **on every
tenant's rows, under no predicate at all, with no `is_system` check enforceable anywhere below the handler**.

After this slice the same five writes are bounded by a policy. Refusing the grant does not keep the system safe — it
keeps it **owner-privileged**, which is strictly worse, and it keeps `PF-02` open indefinitely, because the cutover
cannot proceed while the admin portal's role editor has no write path. `ADR-046 §D5` is therefore not contradicted:
its `SELECT`-only sentence was scoped to `S-E01-1b` in its own words, and this is the decision it deferred by name.

### D2 — the escalation that actually matters is `role_permission` **on a SYSTEM role**, and the invariant moves INTO the database

System roles are the roles **real users hold**. A write to `role_permission` whose parent role is a system role
re-writes the permission set of every current holder, and it takes effect at their next `effectivePermissions` read
with no second request. That — not the renaming of a custom role — is the escalation.

Today that invariant lives **only in application code**, at `roles.controller.ts:190` and `:278`. A future handler,
a future bulk-import path, or a future admin script that forgets the check bypasses it completely. `is_system = false`
inside a policy moves the invariant to the layer that cannot be forgotten.

### D3 — the guard is `AS RESTRICTIVE`, **per command**, and NOT a per-command split of `tenant_isolation`

This is the load-bearing decision, and it was reached by reading PostgreSQL's composition rules against the census
before writing any SQL.

**Why the obvious shape is fail-open.** Permissive policies for a command are **OR**-ed. `role` already carries the
permissive `tenant_isolation … FOR ALL`. Adding a *second permissive* policy `FOR DELETE` with a narrower predicate
would be **OR**-ed with the broad one and would narrow **nothing**. Anyone who "adds a stricter policy" here and does
not write `AS RESTRICTIVE` ships a guard that does nothing at all, silently.

**Why divergent `USING`/`WITH CHECK` on the single `FOR ALL` policy is not sufficient either.** It was considered
because it is the cheapest change: leave `USING` as today's predicate and put `AND is_system = false` only in
`WITH CHECK`. It correctly refuses `INSERT` of a system role, correctly refuses flipping a custom role to
`is_system = true`, and — because the new row of an edit to a system role is *still* a system role — it even refuses
`UPDATE` of a system role. **It cannot refuse `DELETE`**: `DELETE` consults `USING` only, never `WITH CHECK`. Deleting
a system role, and deleting a system role's `role_permission` rows (AC-8 (e)), would both be **accepted**. That is the
whole finding, so the shape is rejected.

**Why not split `tenant_isolation` into four per-command permissive policies.** It works semantically, and the story
anticipated it. It is rejected on three measured grounds:

1. It would put **four** policies where the census counts **one**. `scripts/rls-isolation-check.js` asserts
   `POLICIES == policiedExpected` counting `pg_policy` rows named `tenant_isolation` (`:1660`), and
   `WITH_CHECK_NULL == 0` (`:1687`) and `QUAL_MISMATCH == 0` (`:1775`) over the same name. A `FOR SELECT` policy has
   `polwithcheck IS NULL` **by construction**, and so does `FOR DELETE`. Three census invariants would go red, and
   each has a locally cheap repair that deletes a real protection. **`AC-4`'s warning is exactly right, and the right
   answer to it is to not create the problem.**
2. Per-command **permissive** policies are re-openable by a single future line: any additional permissive policy
   **OR**-s back in. A restrictive guard cannot be OR-ed away — it can only be dropped, which is a visible line in a
   reviewed migration.
3. The story requires the `SELECT` predicate to be **today's predicate, verbatim and unchanged**. Under the
   restrictive design that is not a textual claim to be re-read: **the `tenant_isolation` policy object is not
   touched at all.** The migration instead *asserts* that the installed `pg_get_expr(polqual)` on `role` and
   `role_permission` is byte-identical to what `20260814180000` installed, and `RAISE EXCEPTION`s if it is not. A
   precondition beats a promise.

**The shape.** Six policies, one family name, three commands, two tables, all `TO PUBLIC`:

```sql
CREATE POLICY system_role_write_guard_insert ON public.role
  AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK (role.is_system = false);
CREATE POLICY system_role_write_guard_update ON public.role
  AS RESTRICTIVE FOR UPDATE TO PUBLIC USING (role.is_system = false) WITH CHECK (role.is_system = false);
CREATE POLICY system_role_write_guard_delete ON public.role
  AS RESTRICTIVE FOR DELETE TO PUBLIC USING (role.is_system = false);
```

and on `role_permission` the same three commands with the parent hop written out in full:

```sql
EXISTS (SELECT 1 FROM public.role r
         WHERE r.id = role_permission.role_id AND r.is_system = false)
```

The effective predicate for a write is therefore **`tenant_isolation`'s predicate AND the guard** — which is exactly
what `AC-2` and `AC-3` ask for, composed by the engine instead of by string concatenation. `SELECT` gets no
restrictive policy, so reads are bit-for-bit what they were yesterday.

**`FOR UPDATE` is shipped on `role_permission` even though no `UPDATE` is granted** (§Context: no
`rolePermission.update*` call site exists). A guard that is complete **by command** means that widening the grant
later cannot open a hole in one line. The reverse — a grant with no matching guard — is how this class of defect gets
in.

**Three DNC-10 notes, because this is the live constraint.** The guard contains **no `current_setting`** at all, so
there is no null-context branch to get wrong; the tenant half stays entirely inside `tenant_isolation`, where
`nullif(current_setting('app.current_tenant_id', true), '')::uuid` is reused **verbatim from `ADR-032 §D6`** and is
not re-derived. `is_system = false` is never written as an `IS NULL OR` disjunction, and `is_system` is `NOT NULL`
anyway. The policies are `TO PUBLIC`, never `TO app_user`: naming a role would silently exempt every *other*
non-owner role.

### D4 — `ADR-042 §D5` is **amended**, not relaxed: `DERIVED_DELETE` becomes a NAMED set

`scripts/rls-isolation-check.js:2005` asserts `DERIVED_DELETE == 0` — *"no tenant-derived table grants `DELETE`
(a privilege with no caller is pure blast radius)"*. Since `S-E01-1b`, `role` and `role_permission` **are** tenant-
derived, and this slice grants `DELETE` on both. That assertion must move.

It must **not** move to `>= 0`, and it must not move to a count. It becomes a **set equality in both directions**
against a named constant, `DERIVED_DELETE_ALLOWED = ['role', 'role_permission']`, each name carrying its call site in
the source. `ADR-042 §D5`'s reasoning is preserved exactly: a `DELETE` with **no caller** is pure blast radius, and
these two now have callers (`roles.controller.ts:250`, `:294`). A third derived table acquiring `DELETE` fails the
gate with its name printed — which is what the original assertion was for.

Consequently `DERIVED_TABLES`' entries change from `'SELECT'` to `'SELECT, INSERT, UPDATE, DELETE'` (`role`) and
`'SELECT, INSERT, DELETE'` (`role_permission`), and `DERIVED_PRIVILEGE_SETS` — the closed set — gains **exactly those
two strings and no others**. `scripts/tenant-adversarial-check.js` imports `DERIVED_TABLES` from the sibling, so its
privilege matrix follows from the same single definition; that is `ADR-042 §D3`'s "one set, one definition" and it is
why no literal is edited twice.

### D5 — the census gains six NEW named assertions rather than changing one

No table stops being counted, and no name changes: `POLICIES`, `POLICIED_NAMES`, `WITH_CHECK_NULL`, `ROLE_SCOPED` and
`QUAL_MISMATCH` all filter on `polname = 'tenant_isolation'` and are **untouched and still equal to 51**. But that
filter means the six new policies are invisible to every existing assertion, so the guard family gets its own, all
read from `pg_policy`:

| Assertion | Why it exists |
|---|---|
| `WRITE_GUARD_PERMISSIVE == 0` | **The single most important line in this slice.** If a future repair drops `AS RESTRICTIVE`, the guard becomes permissive, **OR**-s with `tenant_isolation`, and every write is allowed again with no error anywhere. This is the `DNC-10` fail-open shape one layer up. |
| `WRITE_GUARD_CMDS` is exactly `{a, w, d}` per table | A missing `FOR DELETE` **is** the hole §D3 rejects the cheap shape for. |
| `WRITE_GUARD_ROLE_SCOPED == 0` | `polroles = '{0}'` — `TO PUBLIC`, never one named role. |
| `WRITE_GUARD_NAMES` set equality | Six policies over exactly two tables; a seventh on a third table fails with its name. |
| no restrictive policy is `FOR ALL` or `FOR SELECT` on these tables | A restrictive `FOR ALL` would **AND** into `SELECT` and hide every system role — locking all four portals out (`ADR-046 §D3`'s named forbidden fix). |
| `TENANT_ISOLATION_UNCHANGED` | `pg_get_expr(polqual)` on `role` / `role_permission` equals the `S-E01-1b` text. This is `AC-2`/`AC-3`'s "verbatim" as an executable precondition. |

### D6 — `tenant` and `permission` are **not** touched

`tenant` stays `SELECT`-only. `register.controller.ts`'s `tenant.upsert` remains a cutover blocker owned by `PF-185`.
Granting `INSERT` would make the application role able to **mint** tenants — `PF-185` made permanent — and the
argument in §D1 does **not** transfer: minting a tenant is not a narrowing of anything, it is a new capability with no
policy that could bound it (`tenant`'s own predicate is `id = <GUC>`, which a row being created does not yet satisfy
in any meaningful sense).

`permission` stays `SELECT`-only with no policy: measured genuinely global in `ADR-046 §D5`, and nothing writes it
outside the owner-connected seeds.

### D7 — `role.tenant_id` is **refused**, by name and with the reason

Adding a `tenant_id` column to `role` would make every predicate here trivial. It is refused because **custom roles
being global (`school_id IS NULL`) is today's PRODUCT behaviour**, owned by `PF-153` and `ADR-013`, and shipped in
`GET /roles`. Adding the column would either change what the admin portal lists, or add a column nothing populates —
a product change disguised as a migration. `S-E01-1b` refused exactly this and was right; the refusal is repeated
here rather than re-litigated. This ADR also changes nothing about what `GET /roles` returns.

### D8 — EXPAND only, and the rollback is EXECUTED

No column created, dropped or moved. No data rewritten. No application behaviour changed: the app still connects as
the owner, `FORCE ROW LEVEL SECURITY` is still absent, `DATABASE_URL` is untouched, and `schema.prisma` is **not**
touched — policies and grants are not modellable in Prisma, and this slice adds no constraint and no index, so the
`prisma generate` RED trap (`P-05`) is **not armed**. This is the first `V3-E01` migration since `S-E01-2c` for which
that is true, and it is a measurement, not a hope: the diff contains no `schema.prisma` hunk.

The rollback drops the six guard policies and revokes **only what this migration granted** — `INSERT, UPDATE, DELETE`
on `role`, `INSERT, DELETE` on `role_permission` — leaving `S-E01-1b`'s `SELECT` in place. It is **executed** by
`scripts/rls-isolation-check.js` and asserted by read-back (`AFTER_WRITE_GUARD|0`, and the two tables reading back
exactly `SELECT`), because a rollback that is never played is an assertion about a comment.

---

## The residual, stated plainly

**Argument 3 of the story, and then the sharper form of it that the measurement forces.**

The story states the residual as: *a tenant admin can still grant permissions to a CUSTOM role through the shipped
API, bounded by `assertWithinCeiling` (`PF-09`). That is product behaviour, not a database defect, and this slice
does not change it.* That is true and it is recorded.

It is **not the whole residual**, and the difference was measured rather than inferred. `roles.controller.ts:154`
never sets `schoolId`, so **every role the product can create has `school_id IS NULL`**. `role`'s predicate admits
that branch for **every** tenant (it is the SYSTEM-role / global-reference branch, `ADR-046 §D3`). The guard added
here only tests `is_system`. Therefore, after the cutover:

> `app_user` under tenant **A** may `UPDATE` or `DELETE` a **custom role created by tenant B**, and may rewrite its
> `role_permission` set.

This is **not a regression** — today the owner connection does the same with no predicate at all, and
`roles.controller.ts` carries no tenant filter on `findUnique({ where: { id } })` either — and it is **not fixable
here**, because the only fixes are the two this ADR refuses (`role.tenant_id` in §D7, or making the controller set
`schoolId`, which is `PF-08` / `ADR-015 D8.6` product territory). But it must be **named**, because `AC-8 (f)` tests
only the *school-scoped* shape — the shape the product **never produces** — and a green `AC-8 (f)` would otherwise
read as "cross-tenant role writes are impossible". That reading is `PF-02`'s own failure mode reproduced inside the
check built to refuse it.

It is recorded as **`PF-194`**, and the proof harness must carry it as an executed `[LIMIT]`: the `school_id IS NULL`
cross-tenant write is shown **ACCEPTED**, beside the school-scoped one shown refused. A limit proven by execution is
a fact; a limit written in a comment is a hope.

**One further consequence, small and worth writing down.** `role_permission_role_id_fkey` is `ON DELETE CASCADE`
(baseline `:1653`), and a referential-integrity cascade runs as the constraint's own trigger, **not** under the
child's RLS. So deleting a role also removes its `role_permission` rows regardless of the guard. That is bounded and
harmless: the only roles deletable at all are non-system ones that pass `tenant_isolation`, so the cascade can never
reach a system role's permissions.

---

## Consequences

**What this does NOT say.** The running application is still **not** RLS-isolated. It connects as the table owner.
This slice removes the *last* named blocker on the authorization surface so that `S-E01-1` can attempt the cutover;
the cutover is not here, and `PF-185` (the `tenant` upsert in registration) still blocks it.

**Positive.** `PF-193` closes. The `is_system` invariant stops being application-only. The verb-aware
`AC-9 CUTOVER READINESS` (`TOOL-32`) turns "this table has a grant row" into "this table has the privilege this verb
needs", which is what the block was always claimed to mean.

**Negative / accepted.** The application role can now write privilege data for custom roles — bounded by policy where
it previously was not bounded at all. `PF-194` is opened rather than closed. `ADR-042 §D5`'s zero becomes a named
two.

**Open, by name.**

| Finding | Priority | What it is |
|---|---|---|
| `PF-194` | **P1** | Cross-tenant custom-role write: every product-created role has `school_id IS NULL`, so tenant A may edit/delete tenant B's custom role and its permission set. Blocked on `PF-08` / `PF-153` / `ADR-015 D8.6` — the fix is a product decision, not a policy. Proven as an executed `[LIMIT]`, not asserted in prose. |
| `TOOL-32` | P2 | `AC-9 CUTOVER READINESS` aggregated `privilege_type` per table but tested only table-level reachability: a table granted `SELECT` and written by production code **passed**. Closed by this slice (`AC-10`). |
| `PF-185` | P1 | `register.controller.ts` upserts `tenant` by slug. Still the cutover's other blocker; `INSERT` on `tenant` refused here on purpose (§D6). |
| `PF-08` / `ADR-015 D8.6` | P2 | `roles.controller.ts` never sets `schoolId`. Named in `ADR-046 §D3`, and it is the root cause of `PF-194`. |
| `PF-09` | — | `assertWithinCeiling` bounds which permissions a grantor may attach. Unchanged by this slice; named so the residual is not read as unbounded. |
