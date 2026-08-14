# ADR-032 — Tenant enforcement: the context is a bound parameter, refused before it runs, and proven after it ran

- **Status**: accepted (partial) — D1–D4 are decided **and executed** by `S-E01-2`; **D5–D8**, added
  2026-08-13, are decided **and executed** by `S-E01-2b`. What remains unimplemented is no longer the
  policies — they exist — but the **connection cutover**; see *What this ADR does not claim*.
- **Date**: 2026-08-11 (D1–D4) · amended 2026-08-13 (D5–D8)
- **Slice**: `S-E01-2` (V3-E01, finding `PF-02` half (b), track a) · amended by `S-E01-2b` (`PF-02` half (a))
- **Supersedes in part**: `ADR-002` — specifically its line
  *« Middleware Prisma exécute `SET LOCAL app.current_tenant_id = <id>` au début de chaque transaction »*.
  That literal mechanism is replaced by D1. Everything else in `ADR-002` (shared DB, `tenant_id` on every
  business table, RLS as the enforcement layer, the `app_user` / `app_migrator` / `auditor` role split) stands
  and is **still the target**, not yet the state.
- **Numbering**: this file holds `ADR-032`. `docs/daily-improvement-v3/architecture-impact.md` §4 reserves
  exactly this decision under `ADR-032` (*« Tenant enforcement: RLS + application predicate, fail-closed,
  parameterised GUC »*, V3-E01, blocking). That table is **not** editable from this track, so the reservation
  is reconciled here rather than there — the precedent is `ADR-028`'s own numbering note (`PF-110`: the
  register of record is the first file committed, and a shipped ADR is never renumbered).

## Context — measured, not assumed

Three greps, run on this tree at the time of writing, are the entire basis of this ADR. Anyone re-reading it
later should re-run them rather than trust the sentence.

1. **The tenant id was interpolated into raw SQL.** `apps/api/src/shared/prisma/prisma.service.ts:29` read:

   ```
   await tx.$executeRawUnsafe("SET LOCAL app.current_tenant_id = '" + tenantId + "'")
   ```

   (written as a template literal). That is `PF-02` half (b): a latent SQL-injection sink on the one seam
   whose entire job is isolation.

2. **`withTenant` has zero call sites.** A grep for `withTenant` across `apps/**` and `packages/**` returns
   exactly one hit — its own definition. So the injection above was **latent, not exploited**, and the
   docblock's claim *« Used by all repositories so RLS policies apply »* was false on its first clause.

3. **There is no RLS in this database.** A repo-wide grep for `ENABLE ROW LEVEL SECURITY` and `CREATE POLICY`
   returns **zero** SQL occurrences, `0_baseline` included. The only textual hit is a comment in
   `apps/api/prisma/migrations/20260809120000_tenant_timezone/migration.sql` which says exactly that. So the
   docblock's second clause was false too.

`ADR-002` has carried an unchecked Action Item #1 (*« Middleware Prisma `withTenant(tenantId)` qui SET LOCAL
avant chaque transaction »*) and #2 (*« Migration template avec `ALTER TABLE … ENABLE ROW LEVEL SECURITY` +
policy »*) since 2026-05-15. This ADR records the half that is now done, and pins the two landmines that
would let the other half ship green while protecting nothing.

## Decision

### D1 — the tenant value reaches PostgreSQL only as a bound parameter

The context is applied with

```sql
SELECT set_config('app.current_tenant_id', $1, true) AS applied
```

issued through Prisma's tagged-template `$queryRaw`, so `$1` is bound by the driver. `SET LOCAL <name> = $1`
is **not** valid PostgreSQL — `SET` accepts no parameters — which is why the mechanism named in `ADR-002`
cannot be parameterised and had to be replaced rather than fixed. `set_config(name, value, true)` is the
transaction-local form and is semantically identical to `SET LOCAL`.

The GUC **name** stays a literal in the SQL text: `set_config` could take it as a parameter, but binding it
would invite a later caller to make it dynamic. It is exported once as `TENANT_GUC` so the future policy
predicate references the same string — a divergence between helper and predicate is undetectable until an RLS
integration test exists, and its symptom is the worst possible one: everything works, nothing is isolated.

`$executeRawUnsafe` no longer appears in `apps/api/src/shared/prisma/**`, and a source-reading test asserts it
cannot come back (see *Evidence*).

### D2 — a malformed tenant id is refused **before** any query runs

`assertTenantId(value)` accepts exactly the canonical UUID form
(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, case-insensitive), rejects everything else
with the exported `TenantContextError`, and is called **before** `$transaction` — not inside its callback.
The ordering is the decision, not a style: validating inside the callback would check out a pooled connection
and issue `BEGIN`/`ROLLBACK` for every refused request, which is a free denial-of-service amplifier, and it
would make the property « no query was issued at all » unobservable.

Three sub-rulings, each of which is a way this could have been done wrong:

- **Non-string values are refused before the regex.** `tenantId: string` is a compile-time promise only; the
  real value comes from a JWT claim. `['<uuid>']` and `{ toString() { … } }` both coerce through a regex test
  and would have passed.
- **Refusal, never sanitisation.** No `trim()`, no case folding, no character stripping. A sanitiser that
  removes a quote turns an attack into a silently *wrong* tenant context, which is worse than a crash. Case
  folding would additionally break D3, which compares the read-back against the original.
- **Deliberately narrower than the database, deliberately wider than RFC-4122.** PostgreSQL's `uuid` also
  accepts brace-wrapped and unhyphenated forms; being narrower is the fail-closed direction. But the version
  and variant nibbles are *not* checked: a legitimate tenant whose id came from a v7 generator, an import or a
  fixture would otherwise be refused by a rule stricter than the database's own — an availability bug wearing
  a security costume. The security property comes from the **alphabet** (hex and hyphens carry no quote,
  semicolon, backslash, whitespace or comment marker), not from the version nibble.
- **The nil UUID is not special-cased in either direction.** It is well-formed, so it passes D2 and will match
  no `tenant` row. Whether it means anything is a policy question, not a shape question.

### D3 — the applied context is read back, not assumed

`set_config` returns the value it set. The implementation reads `rows[0]?.applied` and throws unless it
strictly equals the requested id. One `!==` comparison covers four distinct failures — empty result set,
missing or renamed column, non-string value, different value — and it must not be « simplified » into an
optional check, because the `undefined` branch *is* the fail-closed branch. `fn` is never invoked on that
branch. This costs zero extra round trips.

What the read-back proves is that the context was **applied**, not that it will persist: the setting's scope
is the transaction, so the statement must be issued on the transaction client and not on the root client. A
`set_config` issued on the root client would run in its own implicit single-statement transaction, echo the
value correctly, and evaporate before `fn` ran — the read-back alone cannot tell those two worlds apart, so
the test asserts the root client's call log is **empty**.

### D4 — no bypass exists (DNC-10)

There is no allow-listed tenant id, no `system` / `public` / `default` value, no environment escape hatch, no
« migration mode » branch, and no options bag. A background job that needs to run outside a tenant must not
route through this helper at all: `ADR-002` already provisions that at the **database role** layer
(`app_migrator`, `auditor`), which is where a bypass belongs — never a string comparison in application code.
The exports' arity is asserted by a test so an options object (`{ skipTenantCheck: true }`) cannot arrive
later without turning red.

---

## Amendment, 2026-08-13 — D5–D8, decided and executed by `S-E01-2b`

`S-E01-2b` writes the RLS half this ADR deferred. It is recorded **here**, as an amendment to the
tenant-enforcement decision, rather than as a new ADR: `ADR-032` *is* that decision and its own §Deferred
names precisely this half. Splitting one seam across two ADRs is how references start pointing at the wrong
decision. **No second tenant-enforcement ADR exists and none is intended** — the migration, its guard spec and
its checker cite `ADR-032 §D5`–`§D8`.

> **Annotated in place, 2026-08-14 (`S-E01-1a`).** This clause originally read *« No `ADR-042` exists and none
> is intended »*. That wording **pinned a decision to an integer**, and the integer has since been claimed
> twice. The sentence was only ever **scoped to this seam** — it refused a second ADR for *tenant enforcement*,
> not a second ADR anywhere — so it is restated above in terms of the seam and the numbering note moved here.
>
> **Who holds which number, as of this commit.** `ADR-043` is identity resolution in `UserSyncService`
> (`PF-01` half (a), this slice) — it is the file that exists on this branch. **`ADR-042` is reserved for
> FK-path tenant isolation** (`PF-183`), which is written and awaiting review in **open PR #245**; it is
> therefore *not* on `main` yet, and this annotation must not be read as evidence that it is.
>
> `S-E01-1a` originally took `042` as "the next free number" and was **renumbered to `043` at land** precisely
> because #245 had already taken it — an id collision that the ledger, not the compiler, was going to catch.
> The three seams are neighbours and easy to confuse, which is why this note lives here rather than only in
> `ADR-043` §Numbering. Nothing about §D5–§D8 changes.

> **Annotated in place, 2026-08-13 by `S-E01-2c` — `ADR-042` now exists, and the sentence above was right about
> its own scope and wrong about the next one.** The claim held for *this* seam: tenant enforcement for the tables
> that **carry a `tenant_id` column**. `S-E01-2c` isolates a different class — tables that carry **no** `tenant_id`
> and belong to a tenant only **through a parent row** — and that class needs decisions this ADR does not make and
> cannot be stretched to make: the `EXISTS`-over-parent predicate, the rule for a child with two tenant-bearing
> parents, an agreement whose *derived* half is computed from `pg_constraint`, the `ON DELETE CASCADE` limit on
> append-only, and a **named** deferral for `outbox_event` (no FK, no discriminant). Under the ADR rule
> (`GUARDRAILS` §2) that is a new architectural decision, so it lands as a record rather than as a comment.
>
> The risk the struck sentence named is real and is mitigated rather than ignored: **`ADR-042` declares itself an
> *extension*, not a fork.** It reuses `§D6`'s `nullif(current_setting(…, true), '')::uuid` **verbatim** and cites
> it instead of restating it, keeps the policy name `tenant_isolation`, and repeats `§D5`'s limit — the application
> still connects as the owner and is still **not** RLS-isolated. Nothing in `§D5`–`§D8` is superseded. **`PF-02`
> still stays `in-progress`.**

The four artefacts are `apps/api/prisma/migrations/20260813120000_tenant_rls_policies/migration.sql`,
`scripts/rls-isolation-check.js` (the executed proof), `apps/api/src/shared/quality/rls-isolation-gate.spec.ts`
(the text ratchet), and the `Prisma.TransactionClient` narrowing in `prisma.service.ts`.

### D5 — RLS is **ENABLED**, deliberately **not `FORCE`d**, and the owner-bypass is closed by the connection cutover instead

`ENABLE ROW LEVEL SECURITY` + one `tenant_isolation` policy on the 44 tenant-scoped tables. **No
`FORCE ROW LEVEL SECURITY`.**

This **partially supersedes §Deferred item 1 below**, which required *either* the `app_user` split *or*
`FORCE` on every policy-bearing table. Measured on this checkout: the API, every seed and `prisma migrate`
connect as `pilotage`, which **owns all 55 tables**, and `withTenant` still has **zero** call sites — so no
connection sets the GUC. `FORCE` today would make **every query in the entire application return zero rows**.
That is a local outage dressed as a hardening.

The correct repair for owner-bypass is not `FORCE`; it is that **the application must stop connecting as the
table owner**. `app_user` already exists for that (non-owner, `rolbypassrls = f`, login-capable) and
`DATABASE_URL_APP` is already declared. So this slice makes the policies **exist**, be **correct**, and be
**proven to deny for a real non-owner role**; the remaining step is a **connection cutover**, not more policy
work.

§Deferred item 1's other half is honoured as written: *« the cross-tenant denial test must run as the role the
API actually uses »* is not yet satisfiable, so the proof runs as `app_user` **and the gap is stated on the
green path** — `rls-isolation-check.js` prints, when it passes, that the running application is still **not**
isolated. The absence of `FORCE` is asserted in three places (migration text ratchet, `pg_class.relforcerowsecurity = 0`
in the executed census, and `prisma.service.spec.ts`) so it can only be added deliberately, by someone who
comes to read this paragraph.

**`PF-02` therefore stays `in-progress`.** Nothing in this amendment may be read as *"the application is
RLS-isolated"*.

### D6 — the predicate, and the four ways of writing it wrong

```sql
nullif(current_setting('app.current_tenant_id', true), '')::uuid = tenant_id
```

written **identically** in `USING` and in `WITH CHECK`, on a `FOR ALL TO PUBLIC` policy.

- **`missing_ok` (the `true`) is mandatory.** Without it, any connection that never set the GUC raises `42704` —
  migrations, seeds, health checks and every BullMQ job break on day one. This was §Deferred item 2.
- **`nullif(…, '')` is mandatory too, and it is not decoration.** Measured: after a transaction that ran
  `set_config(…, true)` **commits**, the custom GUC returns to `''`, **not** to non-existence, on that same
  session. Prisma pools connections, so `''` is the **steady state** of every physical connection that has
  served one `withTenant`; a bare cast would raise `22P02` on the *second* query of each. `nullif` maps `''` to
  `NULL`, and `NULL` lets **no** row through — it relaxes nothing, and the shape stays a single equality.
- **Cast to `uuid`, never compare as text.** `tenant_id::text = current_setting(…)` matches **zero** rows for an
  upper/mixed-case tenant id, because PostgreSQL renders `uuid` lowercase while `assertTenantId` (D2)
  deliberately preserves case. Fail-closed but **invisible**, which is the worst shape a control can have. The
  proof's tenant A carries uppercase hex so the cast direction is **executed**, not merely asserted.
- **No context means SEE NOTHING, decided.** GUC unset (`NULL`) or empty (`''` → `NULL`): the predicate is
  `NULL`, no row passes, **no error is raised**. Fail-closed by construction, with no extra clause.
  `current_setting(…) IS NULL OR tenant_id = …` — the tempting repair — fails **open for the whole
  application** and is DNC-10 committed in SQL. It is banned by a text ratchet, not by this sentence.
- **`TO PUBLIC`, never `TO app_user`.** A policy naming a role constrains only that role; every other
  present-or-future non-owner role would be exempt in silence. Asserted as `polroles = '{0}'` in the census.
- **`WITH CHECK` written explicitly.** Omitted, PostgreSQL falls back to `USING` — correct-looking today, wrong
  the day someone adds a permissive `WITH CHECK`. Asserted as `polwithcheck IS NOT NULL`.

### D7 — grants: exactly the 44, guarded by `pg_roles`, and **not uniform** — two tables are append-only

- **Exactly the 44 policied tables**, never `ON ALL TABLES IN SCHEMA public`: that form would hand `app_user`
  the 11 tables that carry **no** policy, i.e. unfiltered access granted by the very gesture that claims to
  restrict. Those 11 each need their own decision, which belongs to the cutover slice. No sequence grants —
  there are zero sequences in `public` (uuid primary keys), and an unnecessary grant is a widened blast radius.
  > **Annotated 2026-08-13 by `S-E01-2c` (`ADR-042`).** *"Which belongs to the cutover slice"* is superseded on
  > **timing**, not on substance: the decision is taken **before** `S-E01-1`, not during it, because deciding it
  > mid-cutover forces the wrong branch under pressure. Of the 11, **five** — `grade_revision`,
  > `announcement_receipt`, `branding`, `import_row`, `user_role` — are decided by `ADR-042 §D1`/`§D5` (an
  > `EXISTS`-over-parent policy plus a per-table grant, none receiving `DELETE`). `outbox_event` is deferred
  > **by name** and stays fail-closed (`ADR-042 §D7`, `PF-185`) — it holds **no** FK, so there is no path to
  > predicate on. `tenant`, `permission`, `role`, `role_permission` and `_prisma_migrations` stay outside, named
  > with reasons (`ADR-042 §D4`). The count `11` is unchanged and correct; what changes is that ten of them now
  > have an owner and a record.
- **Guarded by `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')`.** Roles are **cluster** state while
  migrations apply to a **database**; the drift gate creates scratch databases and CI provisions a fresh
  container. The `ENABLE` / `CREATE POLICY` half stays **unconditional** — it is the security property and it
  depends on no role.
- **Two tables receive `SELECT, INSERT` only: `audit_log` and `conversation_message`.** A uniform DML grant
  would hand `UPDATE`/`DELETE` on the audit trail to the role the application is about to connect as.
  `schema.prisma` delegates the append-only property of `audit_log` to *"RLS + REVOKE configurés en migration
  SQL"* — this migration **is** that SQL — and `AuditLog` carries a `hash`/`prev_hash` chain whose `prev_hash`
  would be rewritable, making a tamper **consistent and therefore undetectable** by chain verification.
  Append-only audit is non-negotiable (GUARDRAILS §1, RGPD). `ConversationMessage` is declared immutable by
  the schema (*"No edit, no soft-delete in the MVP"*); moderation goes through report + `status=blocked`.
  Measured before restricting: **zero** `conversationMessage.update|delete|upsert` call sites, and the single
  `auditLog.deleteMany` is `apps/api/prisma/seed-demo.ts`, which connects as the **owner** and is unaffected.
- **`conversation_report` is explicitly NOT in that set**, and the exclusion is written down so nobody adds it
  by analogy: it carries `status`, `reviewed_by`, `reviewed_at`, `updated_at` — moderation makes it mutate by
  construction. One more "append-only" table would be an outage, not a hardening.
- **The exemption cannot widen silently.** The append-only names are a second literal array in the migration,
  checked to be a subset of the 44 (the migration **refuses to apply** otherwise), ratcheted in
  `rls-isolation-gate.spec.ts`, and asserted by the executed census (`privilege_type` for those tables ⊆
  {SELECT, INSERT}, and non-empty). The `GRANTED == tenant-column count` agreement assertion is unaffected —
  the tables are still granted, with fewer privileges.

### D8 — rollback: pure expand, so `DROP`/`DISABLE` is sufficient — and it is **executed**, not merely written

The migration adds policies and grants. It alters no column, drops nothing, creates no index (all 44 already
carry `tenant_id` as an index's leading column, so prerequisite (4) below was already satisfied) and rewrites
no data. **There is no contract phase**, which is exactly why a `DROP POLICY` + `DISABLE ROW LEVEL SECURITY` +
matching `REVOKE`s down path restores the prior state with no data to reconstruct. It is stated in full in the
migration header and **run** by `rls-isolation-check.js`, which applies, proves denial, reverses, and asserts
`pg_policy` is back to its prior count and `relrowsecurity` back to `f`. A rollback never played is an
assertion about a comment. The `REVOKE` stays uniform over the 44: revoking a privilege the role never held is
a silent no-op in PostgreSQL, and a second array would be a drift source for no effect.

The migration is also **re-playable**: `CREATE POLICY` has no `IF NOT EXISTS` in PG 15, so every `CREATE` is
preceded by `DROP POLICY IF EXISTS`.

---

## What this ADR does **not** claim

**It does not claim that repositories are tenant-isolated today. They are not.**

- ~~Zero RLS policies exist (Context §3), so the database enforces nothing.~~ **Amended 2026-08-13 (D5):**
  44 policies now exist and are **proven by execution** to deny for the non-owner role `app_user`. The database
  still enforces nothing **against the running application**, for a different reason — the application connects
  as the table **owner**, who is exempt without `FORCE`. The conclusion of this bullet is unchanged; its cause
  is not.
- Zero call sites exist (Context §2), so the application enforces nothing either.
- A well-formed UUID is a **shape**, not an **entitlement**. This helper cannot tell tenant A's id from tenant
  B's; resolution and authorisation live in the identity seam, which is another track's code this run.

`PF-02` therefore stays **open**: this slice closes half (b) — the interpolation — and half (a), « RLS
claimed, not implemented », is still true. **Amended 2026-08-13:** half (a) is now **partially** closed — the
policies exist and deny for a real non-owner role — and `PF-02` stays **`in-progress`**, because the role the
API actually uses is still the owner `pilotage`.

## Deferred — and the two ways the deferred half ships green while protecting nothing

> **Amended 2026-08-13.** This section was written when enabling RLS was still a later story. That story is
> `S-E01-2b`, and it has landed: item 1 is **partially superseded by §D5** and item 2 is **satisfied and
> extended by §D6**. Both are kept in place, annotated rather than deleted — the trap each one names is still
> the trap, and the amendment is only readable against the original wording.

1. **`FORCE ROW LEVEL SECURITY` is not optional.** A table's owner bypasses RLS. In the common Prisma setup
   the application role owns the tables, so a story that enables RLS, writes policies and watches every test
   go green can produce **zero** isolation. Either the `app_user` / `app_migrator` split of `ADR-002` lands
   first, or every policy-bearing table is `FORCE`d — and the cross-tenant denial test must run as the role
   the API actually uses.

   > **Partially superseded by §D5.** Neither branch is taken as written: `S-E01-2b` enables **without**
   > `FORCE`, and the API still connects as the owner. Taking either branch today would return zero rows for
   > every query in the application. The hazard this item names is **not** waved away — it is closed by the
   > **connection cutover** (`DATABASE_URL` → `app_user`), which §D5 records as the one remaining step, and it
   > is made non-silent in the meantime: the denial proof runs as a real non-owner role and the gate prints, on
   > its **green** path, that the running application is still not isolated. `PF-02` stays `in-progress` until
   > the cutover lands. **This item is not superseded by any migration comment** — §D5, in this file, is the
   > decision of record.

2. **`current_setting(name)` must use its `missing_ok` argument.** `current_setting('app.current_tenant_id')::uuid`
   raises `42704` on any connection with no tenant context and `22P02` on an empty string — which takes out
   migrations, health checks, seeds and every job path on day one. The predicate must use
   `current_setting('app.current_tenant_id', true)` and handle `NULL` explicitly, deciding *deliberately*
   whether « no context » means « see nothing » (fail closed) or « exempt » (it must not).

   > **Satisfied and extended by §D6.** `missing_ok` is used, and « no context » is decided as **see nothing**.
   > What this item did not foresee, and §D6 measures: `missing_ok` covers only *never set*. After a committed
   > `set_config(…, true)` the GUC returns to `''` on the **same pooled connection**, and a bare cast raises
   > `22P02` there — hence the mandatory `nullif(…, '')`.

A third, smaller one: `withTenant` opens a Prisma **interactive** transaction (defaults `maxWait` 2 s,
`timeout` 5 s). The first real call site on an import or report path will time out mid-work, and the tempting
misdiagnosis is « the tenant helper is broken ». Short units of work only; and never call it from inside an
already-open transaction, or Prisma opens a second independent transaction on a different connection and the
context applies only to that one.

## Consequences

**Easier.** The one seam that will carry tenant isolation is now injection-proof, fail-closed and
self-verifying, and it says so in its own docblock instead of claiming an isolation that does not exist. The
GUC name is a single exported symbol the future migration can reference.

**Harder.** A caller must now hold a well-formed UUID before it can open a tenant-scoped transaction; there is
no way to « just run this one query » without one. That is the intended cost.

**Unchanged.** No schema change, no migration, no new dependency, no HTTP surface. `TenantContextError` is
API-internal and is deliberately **not** an `HttpException`: this is the persistence layer, and a
`BadRequestException` would both leak transport semantics downward and hand an attacker a 400 confirming that
their payload's shape was inspected. An unhandled `TenantContextError` surfacing as a 500 is the fail-closed
default. When call sites do appear, they must surface a generic 5xx/403 that echoes **no** tenant id — the
refused value can be attacker-supplied, so it belongs in the audit log, never in a rendered message. For the
same reason the error message names the reason and the *shape* (type, length) and never the value itself.

## Evidence

`apps/api/src/shared/prisma/prisma.service.spec.ts` — no database, no generated client, no `DATABASE_URL`.
The fake client implements **all four** raw entry points (`$queryRaw`, `$queryRawUnsafe`, `$executeRaw`,
`$executeRawUnsafe`) and records every call as `{ method, sql, params }`, with the tagged template
reconstructed by joining its static segments. That detail is what makes the assertions real rather than
tautological: a fake implementing only `$queryRaw` would inspect a SQL string made solely of compile-time
literals, so « the id is absent from the SQL » could never fail, and the old implementation would have died on
a missing method — a shape failure, not a security one.

Asserted: the id appears in no emitted SQL text and appears in exactly one call's bound parameters; the
statement is issued on the transaction client and the root client's log is empty; an injection payload, an
empty string, a non-string, a wrapped UUID and a coercing object are all refused with `$transaction` never
called; every malformed read-back throws `TenantContextError` with `fn` never invoked; the happy path calls
`fn` exactly once with the transaction client and passes through a **falsy** return value (so a
`result || fallback` would turn red). Plus a source-reading ratchet over every module in
`apps/api/src/shared/prisma/`: no `$executeRawUnsafe`, no assignment-form `SET LOCAL <name> =`, no template
literal that interpolates into SQL text unless it is tagged `$queryRaw`, and none of the tokens a bypass would
arrive under.
