# ADR-032 — Tenant enforcement: the context is a bound parameter, refused before it runs, and proven after it ran

- **Status**: accepted (partial) — D1–D4 below are decided **and executed** by `S-E01-2`. The RLS half
  (policies) and the application-level predicate remain **proposed and unimplemented**; see
  *What this ADR does not claim*.
- **Date**: 2026-08-11
- **Slice**: `S-E01-2` (V3-E01, finding `PF-02` half (b), track a)
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

## What this ADR does **not** claim

**It does not claim that repositories are tenant-isolated today. They are not.**

- Zero RLS policies exist (Context §3), so the database enforces nothing.
- Zero call sites exist (Context §2), so the application enforces nothing either.
- A well-formed UUID is a **shape**, not an **entitlement**. This helper cannot tell tenant A's id from tenant
  B's; resolution and authorisation live in the identity seam, which is another track's code this run.

`PF-02` therefore stays **open**: this slice closes half (b) — the interpolation — and half (a), « RLS
claimed, not implemented », is still true.

## Deferred — and the two ways the deferred half ships green while protecting nothing

Enabling RLS is a later story, because a policy predicate is worthless until call sites exist on the request
and job paths. Two prerequisites are recorded here so that story does not have to rediscover them:

1. **`FORCE ROW LEVEL SECURITY` is not optional.** A table's owner bypasses RLS. In the common Prisma setup
   the application role owns the tables, so a story that enables RLS, writes policies and watches every test
   go green can produce **zero** isolation. Either the `app_user` / `app_migrator` split of `ADR-002` lands
   first, or every policy-bearing table is `FORCE`d — and the cross-tenant denial test must run as the role
   the API actually uses.
2. **`current_setting(name)` must use its `missing_ok` argument.** `current_setting('app.current_tenant_id')::uuid`
   raises `42704` on any connection with no tenant context and `22P02` on an empty string — which takes out
   migrations, health checks, seeds and every job path on day one. The predicate must use
   `current_setting('app.current_tenant_id', true)` and handle `NULL` explicitly, deciding *deliberately*
   whether « no context » means « see nothing » (fail closed) or « exempt » (it must not).

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
