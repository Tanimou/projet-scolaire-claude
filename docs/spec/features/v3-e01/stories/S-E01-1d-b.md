# S-E01-1d (b) — the tenant scope seam's GATE and its EXECUTED PROOF

**Epic** `V3-E01` — Tenant isolation and identity resolution · **Layer** L0 · **Risk tier** **P1**
**Second half of** [`S-E01-1d.md`](./S-E01-1d.md) — that file is the DESIGN record and is **already implemented**;
this file is the brief for the five deliverables that were never written.
**Advances** `PF-02` half (a) · **Records** `ADR-048`, `PF-198`, `PF-199`, `PF-200`, `TOOL-33`
**Gates** G-TENANT, G-AUTHZ, G-PORTAL, G-DNC · **G-MIGRATION NOT TRIGGERED — this slice ships NO migration**
**DNC** `DNC-10` (the silent fallback), `DNC-08` (the unclassifiable connection state)
**touchesUi** false · **touchesBackend** true · **touchesWorker** false
**Written** 2026-08-15 by `john:spec`, **after** reading the shipped implementation at `6504887`

---

## 0. Read this before you read anything else

**The implementation half is DONE and COMMITTED.** Branch `ci/2026-08-15-v3-e01-s-e01-1d`, commit `6504887`, in the
main checkout. A previous run built the seam and died before writing its proof.

**Do not re-implement it. Do not rewrite it. Do not "improve" it.** Read it, then build the half that is missing.

Already shipped (1937 lines, off-limits except where §3 below *requires* the edit):

| File | What it holds |
|---|---|
| `apps/api/src/shared/prisma/tenant-scope.ts` (251 l) | the PURE half: `TenantScopeError`, `TenantScopeState` (**three** states), the `AsyncLocalStorage` store, `APP_ROLE_REQUIRED_PRIVILEGES`, `appRoleVerdict()`, `readPoolSettings()` |
| `apps/api/src/shared/prisma/app-role-prisma.service.ts` (291 l) | the second `PrismaClient` on `DATABASE_URL_APP`, `probeAppRole()`, the boot-time probe, `ServiceUnavailableException` on `refused_unusable` — **no owner fallback** |
| `apps/api/src/shared/prisma/tenant-scope.service.ts` (159 l) | `TenantScopeService.run` — the FIRST production caller of `PrismaService.withTenant`; nesting reuse-on-same-tenant / throw-on-different |
| `apps/api/src/shared/prisma/tenant-scope.spec.ts` (537 l) | the unit spec |
| `apps/api/src/modules/calendar/calendar.controller.ts` | converted: **4** `this.scope.run(` call sites at `:229`, `:273`, `:318`, `:461`, covering the **7** Prisma call sites |
| `prisma.module.ts`, `metrics.registry.ts:100` (gauge `pilotage_tenant_scope_enforced`), `apps/api/.env.example`, `prisma.service.ts` docblock | the wiring |

**Where the ledger disagrees.** `docs/spec/features/v3-e01/PROGRESS.md` and `docs/daily-improvement-v3/NEXT.md` were last
written before `S-E01-1d` existed and point at `S-E01-1` (the global cutover). They are stale. The operator override
inserts **this** half. Implement it, then correct `PROGRESS.md` §9 so the next run does not re-read a consumed pointer.

---

## 1. The slice in five sentences

The seam exists and four handlers use it, but **nothing has ever proven that a statement issued through it is refused by
PostgreSQL** — every assertion so far is a unit test against a fake client. This slice builds the executed proof
(`scripts/tenant-scope-check.js`), redefines the coverage counter that the seam just falsified, moves the gate spec that
pins the old counter's source text, wires the new proof into both gates, and records `ADR-048`. The proof must run on a
**disposable scratch database** as a **proven non-owner role**, must show the rows **present** before it shows them
**absent**, and must drive the **compiled** seam rather than a hand-written `SET`. The counter must move from *"how many
times does the string `.withTenant(` appear"* to *"how many Prisma call sites sit inside a tenant scope, and is every
site outside one enumerated with a reason"*. **This slice is expected to land with the verdict still a `[LIMIT]` naming
roughly `7/792`; a truthful `[LIMIT]` is the deliverable, and a green here would be the finding.**

---

## 2. What was measured (verify each — do not trust this file)

Measured on `6504887`, 2026-08-15.

### 2.1 The database facts that decide the proof's shape

- The **live `pilotage` database has 2 migrations and 0 policies.** The RLS migrations have **never** been applied to
  it, **by design**. A proof that connects there would assert against an unprotected database and pass for the wrong
  reason. **The proof MUST create its own scratch database. It MUST NEVER touch `pilotage`.**
- Roles `pilotage` (owner) and `app_user` both exist on `127.0.0.1:5432`. **Neither holds `BYPASSRLS`.**
- The address comes from `scripts/lib/default-database-url.js`, which exports
  `{ APP_DATABASE_URL_VAR, ENV_FILES, FALLBACK_DATABASE_URL, defaultAppDatabaseUrl, defaultDatabaseUrl,
  readDatabaseUrlFrom, readEnvVarFrom }`. **Do not hardcode a host or a port.** That file reads `DATABASE_URL` only —
  deliberately (*"an address, never a bypass"*); the app DSN comes from `defaultAppDatabaseUrl()`.
- `apps/api/prisma/migrations/20260813120000_tenant_rls_policies/migration.sql` puts the `tenant_isolation` policy on
  the 44 tenant-column tables (`calendar_event` at `:372`, `enrollment` at `:381`), predicate
  `nullif(current_setting('app.current_tenant_id', true), '')::uuid = tenant_id`, plus the DML grant to `app_user`.

### 2.2 The precedent to copy structurally

`scripts/rls-isolation-check.js` (3831 l). Copy its **shape**, not its assertions:

| Element | Line | What to reuse |
|---|---|---|
| `SCRATCH_NAME_PATTERN` + refusal to drop an unmatched name | `:151`, `:2038` | the "only a name this script generated may ever be dropped" guard |
| scratch creation | `:2036-2046` | `CREATE DATABASE "<generated>"` over the maintenance DSN |
| schema application | `migrationFiles()` `:884`, applied `:2089` | it `psql`s each `migration.sql` in ledger order |
| `psql()` / `facts()` / `record()` / `fail()` / `expectEqual()` | `:832`, `:1953`, `:912`, `:916`, `:922` | the whole evidence-accumulation idiom, and `report()` at `:3742` |
| teardown in a `finally` | `:3703-3740` | drop, verify, never swallow — and never let cleanup downgrade a verdict |

### 2.3 The counter's current shape and every consumer

| Thing | Address |
|---|---|
| `cutoverVerdict({ files, withTenantCallers, prismaCallSites })` | `scripts/tenant-adversarial-check.js:1932` |
| `cutoverReadiness(ungrantedTables, { knownTables, grants })` | `:1972` |
| the counter itself | `:1996` — `withTenantCallers += (text.match(/\.withTenant\s*\(/g) ?? []).length` |
| the returned shape | `:2071` |
| the only production consumer | `:2726-2730` — `cutoverReadiness(...)` → `cutoverVerdict(...)` → `fail`/`limit`/`record` |
| the module export | `:3037` |
| the gate spec's typed handle | `apps/api/src/shared/quality/tenant-adversarial-gate.spec.ts:97-99` |
| the four branch cases | `:923` (0), `:930` (1/722 stays a `[LIMIT]`), `:940` (complete), `:946` (vacuous) |
| **the source-text pin that BREAKS** | `:1045` — `expect(CHECKER_CODE).toContain('withTenantCallers === 0')` |

**`.withTenant(` is the wrong unit and the shipped code proves it: 4 `run(...)` calls cover 7 call sites, so the counter
under-reports by construction.**

### 2.4 The gate's ordering facts

`scripts/ci-gate.sh`: `:267` rls isolation · `:306` **tenant adversarial** (triggered by `^apps/api/src/shared/prisma/`,
which this diff touches) · `:312` **prisma generate** · `:314` typecheck · `:328/:330` test:api ratchet ·
`:360` **build** · `:361` **boot** · `:362`+ the rest of tier 3.

`.github/workflows/ci.yml`: `:248` tenant adversarial · `:249` prisma generate · `:250` `pnpm build` · `:258` boot-check.

`scripts/boot-check.js:147` requires `apps/api/dist/app.module.js` and **fails with a named remedy** (`:152`,
*"run `pnpm build` before the boot check"*) rather than skipping. That is the pattern to copy.

### 2.5 Findings and ids

`PF-198`, `PF-199`, `PF-200`, `TOOL-33` are **absent from `docs/daily-improvement-v3/traceability/OPEN.md`** — they must
be added by this diff (§6). `ADR-047` is the highest ADR on disk; **`ADR-048` is free** (all 6 open PRs are dependabot).

---

## 3. The five deliverables

### 3.1 `scripts/tenant-scope-check.js` — the one that matters (AC-2)

A new executable proof. **AC-2's order is LOAD-BEARING and must be honoured exactly.**

**Lifecycle**

1. Resolve the owner DSN from `defaultDatabaseUrl()` and the app DSN from `defaultAppDatabaseUrl()`. Refuse with a
   NAMED reason (exit non-zero, never skip) if either is unresolvable, if no `psql` is found, or if the TCP preflight
   fails. Copy `rls-isolation-check.js`'s `ToolingUnavailable` idiom.
2. Generate a scratch name matching a `SCRATCH_NAME_PATTERN` this script owns (e.g. `/^tenant_scope_\d+_\d+$/`).
   **Refuse to proceed if the generated name fails its own pattern or equals the owner database.**
3. `CREATE DATABASE` over the maintenance DSN as the owner. Apply the schema: `prisma migrate deploy` with
   `DATABASE_URL` pointed at the **scratch owner** DSN. *(The precedent `psql`s the migration files directly; `migrate
   deploy` is preferred here because the compiled Prisma client is generated from `schema.prisma` and any drift between
   the two would surface as an opaque client error rather than a named failure. If `migrate deploy` is unavailable,
   fall back to `migrationFiles()` + `psql` and **say so in the evidence line**.)*
4. Seed two tenants (A and B) and one `calendar_event` per tenant **as the owner**, over `psql`, from a static SQL
   constant. No value is interpolated from anything but a constant declared in the file.
5. Run the assertions below over a **Prisma client** connected on the **scratch app DSN**.
6. Teardown in a `finally` (§3.1.5).

**3.1.1 — Whom am I, FIRST, over the connection under test**

Before any other assertion, over the app connection itself:

- `current_user` owns **ZERO** of the tables under test;
- `rolbypassrls` is **false**;
- `current_user` **≠ the owner of `calendar_event` read from the CATALOG** (`pg_tables.tableowner`), **never a literal
  role name** — a cluster whose owner role is named differently must be judged correctly, not declared sane by accident.

**Without this, a DSN accidentally pointed at `pilotage` makes every later assertion pass on an unprotected database.**
Reuse `probeAppRole()` from the compiled `dist/shared/prisma/app-role-prisma.service.js` (the source is
`app-role-prisma.service.ts` and `tsc` preserves the full basename — the spec first wrote `app-role-prisma.js`, which
names an artefact the build never emits) so the proof and production ask the
same questions, and feed the result through `appRoleVerdict()`.

**3.1.2 — POSITIVE CONTROL SECOND, before any denial**

With GUC = tenant **A**, through the scope:

- tenant A's own `calendar_event` **IS readable**;
- it **IS updatable** (the update affects exactly 1 row);
- an own-tenant `create` **SUCCEEDS**.

**`app_user` held no privilege at all before `S-E01-2b`, so a proof showing only absence would be green for the wrong
reason.** This is the assertion that distinguishes "RLS refused it" from "the role could never have done it".

**3.1.3 — THEN the denial**

With GUC = tenant **A**:

- tenant B's `calendar_event` is **NOT readable** — `findUnique` **by primary key** returns `null`;
- `update` and `delete` targeting tenant B's row **by primary key** affect **zero rows or raise**.

**Assert on the Prisma error object / the returned count. NEVER on a log line.**

**3.1.4 — The REAL compiled seam, not a hand-written `SET`**

The scoped statements must go through the **compiled** module:

```js
const { runWithTenant } = require(join(API_DIR, 'dist', 'shared', 'prisma', 'prisma.service.js'));
```

plus `dist/shared/prisma/tenant-scope.js` for the store. **An implementation that forgot to set the GUC must FAIL
here.** Prove that property explicitly: issue one control statement on the same client **outside** any scope and record
that it does *not* see tenant A's row either (no GUC ⇒ zero rows) — that is what makes the positive control attributable
to the seam rather than to the connection.

If `apps/api/dist/shared/prisma/prisma.service.js` or the generated client is absent, **FAIL with a named reason
naming the command that produces it** — `pnpm build`, `pnpm --filter @pilotage/api exec prisma generate` — exactly as
`boot-check.js:152` does. **Never skip** (DNC-08).

**3.1.5 — Cleanup EXECUTED, and verified independently**

**KNOWN HAZARD — TOOL-27, do not reintroduce it.** `DROP DATABASE ... WITH (FORCE)` run as `pilotage` **cannot**
terminate a session belonging to `app_user`: `pilotage` is a member of neither `app_user` nor `pg_signal_backend`. The
retry-with-`pg_terminate_backend` path at `rls-isolation-check.js:3716-3724` therefore **does not save this script** —
that precedent only ever holds short-lived `psql` sessions, this one holds a long-lived Node client.

The fix is deterministic, not privileged:

1. `await appClient.$disconnect()` in the `finally`, **before** the drop;
2. assert `SELECT count(*) FROM pg_stat_activity WHERE datname = '<scratch>'` is **0** — the independent verification;
3. then drop (with or without `FORCE`; retry once on failure).

**DO NOT "fix" it with `GRANT pg_signal_backend TO pilotage`.** That buys a green teardown at the price of a standing
privilege escalation on the very role the cutover targets.

The drop is **cleanup, never evidence**: a failed drop is a failure in its own right and must never downgrade or upgrade
the isolation verdict. Print a banner in the precedent's shape (`TENANT SCOPE: PROVEN … / NOT PROVEN / COULD NOT RUN`)
and, on the green path, print the honesty clause — the application at large is still **not** isolated, only the
converted module is, and only on a deployment that declares `DATABASE_URL_APP`.

### 3.2 The AC-9 redefinition in `scripts/tenant-adversarial-check.js`

Replace the string counter with a **brace-matched attribution pass**, kept **pure and spec-drivable** exactly as
`cutoverVerdict` and `privilegesForVerb` already are.

**(a) Attribution.** For each file, locate every scope-opening call — `\.(?:withTenant|run)\s*\(` — then **brace-match
from its opening parenthesis** to find the callback's byte range.

**(b) Classification.** A Prisma call site whose `match.index` falls inside such a range is **COVERED**; otherwise
**UNCOVERED**. The existing `lineOf` binary search (`:2007`) already gives byte-index → line, so the ranges compose with
it directly.

**(c) Shape.** `scopedCallSites` **replaces** `withTenantCallers` in the returned shape (`:2071`) and in the verdict
signature. Update the sole consumer at `:2726-2730` and the export at `:3037`.

**(d) Enumeration.** `cutoverVerdict` gains a **third input**, `enumeratedOutsideScope`: a **NAMED IN-SOURCE CONSTANT**
listing the file globs legitimately outside a scope, **each with its reason string**:

| Glob | Reason (verbatim shape) |
|---|---|
| bootstrap — `apps/api/src/main.ts`, `config-preflight.ts` | runs before any request; there is no tenant to scope to |
| migrations and seeds | schema and fixture authorship; runs as the owner by construction |
| health / release / migration-state readers | must answer while the tenant scope is degraded or refused |
| `apps/worker/src/**` | the worker has no request tenant; converting it is its own slice |
| `users.ensureUser` / `ctx.forTenant` / `studentAccess.scopeForUser` (§4.4 of `S-E01-1d.md`) | **it resolves the tenant** — a scope cannot be opened before its `tenantId` is known (`PF-199`) |
| `calendar-seed.service.ts:128/:169/:173/:211` | opens its own `$transaction` for a bulk import; cannot nest inside an interactive transaction and would not compile against `Prisma.TransactionClient` (`PF-198`) |

**The affirmative branch fires ONLY when `scopedCallSites + enumeratedCallSites === prismaCallSites`.** Anything else
stays a `[LIMIT]` naming the ratio. The `vacuous` branch (`files === 0`) is unchanged.

> **THE TRAP YOU MUST NOT FALL INTO.** Manufacturing a green by widening the enumeration. The enumeration is a list of
> **reasons**. **A "reason" that says "not converted yet" is NOT a reason — it belongs in the uncovered count.** It is
> **expected and correct** that this slice lands with the verdict a `[LIMIT]` naming a new ratio of roughly **7/792**
> covered. **A truthful `[LIMIT]` is the deliverable; a green here would be the finding.**

### 3.3 `apps/api/src/shared/quality/tenant-adversarial-gate.spec.ts` — it MUST move in this diff

- **`:1045` — replace it.** `expect(CHECKER_CODE).toContain('withTenantCallers === 0')` asserts the literal source text
  and **breaks the moment the counter changes**. Replace it with an assertion pinning the **NEW wall** — the
  `scoped + enumerated === total` equality — so the pin still fails if someone reintroduces a **tunable floor**. The
  neighbouring comment at `:1040-1043` (ratio vs verb-privilege are two questions) stays true and stays.
- **Keep and re-express the four branch cases** at `:923`, `:930`, `:940`, `:946` — including the one that matters most:
  **a single covered site out of 792 is STILL a `[LIMIT]`**, now written `scopedCallSites: 1`. Update the typed handle
  at `:97-99`.
- **ADD the manufactured-green mutant.** A case where `enumeratedCallSites` is **inflated to close the gap without
  covering anything**, asserting the verdict is **NOT affirmative** when the enumeration lacks a reason string.
  **It must be shown RED before it is shown GREEN** — run it against the un-hardened verdict first and record that it
  fails, then harden and record that it passes. An assertion that was never red proves nothing.

### 3.4 Wire the proof into both gates — `TOOL-33`

**The ordering dependency is the deliverable, and it must be STATED where it is created.**

`scripts/tenant-scope-check.js` drives the **compiled** seam, so it must run **after** `ci-gate.sh:312`
(`prisma generate`) and **after** `:360` (`build`) — the same guarantee `boot-check.js` (`:361`) already relies on.

- **`scripts/ci-gate.sh`** — place it **IMMEDIATELY AFTER the boot stage** (`:361`), in the `--full` tier:
  `run_stage <bound> "tenant scope" node scripts/tenant-scope-check.js`. Derive the timeout from a measured triple, not
  by copying a neighbour; **a flaky blocking stage is worse than no stage**. Carry the "Kept in step with
  `.github/workflows/ci.yml`" note (S-E02-2 AC-4).
- **`.github/workflows/ci.yml`** — the mirrored step, after `:258` (`node scripts/boot-check.js`). **No
  `continue-on-error`.**
- Note in the comment that `ci-gate.sh:305` already triggers the `tenant adversarial` stage on
  `^apps/api/src/shared/prisma/`, which this diff touches — so both stages fire on this change set.
- The stage **FAILS WITH A NAMED REASON — NEVER SKIPS** — if the generated client or the `dist/` module is absent,
  naming the command that produces it (DNC-08).

### 3.5 `docs/adr/ADR-048-tenant-scope-two-connections.md`, status `accepted`

D1..D8 per `S-E01-1d.md` §7, **with three of them corrected against what actually shipped**:

- **D1** Two connections, not one. Owner client keeps the 782 unconverted sites; the second client serves scoped sites.
  Cite `tenant-adversarial-check.js:1914-1930` as the refutation of per-call-site adoption on one connection.
- **D2** Why per-module beats big-bang: 792 sites / 223 files in one diff is not reviewable, and a missed site fails as
  a **silent zero-row read**, not an error.
- **D3** The interactive-transaction cost. **Record the MEASURED per-handler statement count inside the scope (AC-8:
  ≤ 2), not an assumed one** — count it at `calendar.controller.ts:229`, `:273`, `:318`, `:461`. Rule: identity
  resolution, bulk imports and reports never enter a scope.
- **D4** Nesting: reuse on the same tenant, refuse on a different one, with the second-connection reason.
- **D5** **The THREE-state design the implementation actually shipped** — `enforced` / `degraded_no_app_url` /
  **`refused_unusable`**, which **REFUSES rather than falling back to the owner**.
  **⚠️ This DEPARTS from `S-E01-1d.md` §4.3, which described only a two-state degraded fallback. The implementation is
  RIGHT and the ADR must say so and say why:** a declared-but-broken opt-in is a **misconfiguration**, and silently
  falling back is exactly the unclassifiable-connection-state shape **DNC-08 forbids**. Record the blast-radius
  reasoning already written at `app-role-prisma.service.ts:89-95` — the refusal is at the **seam's** scale (each
  converted site returns 503), not the process's, because killing boot would take down the 782 sites that never needed
  the second connection. Also record why not `/readyz` and not `/version`.
- **D6** What "covered" now means for AC-9 (§3.2), and the **explicit statement that this slice lands with a `[LIMIT]`,
  not a green**.
- **D7** **NO CODE COMPOSES A CONNECTION STRING.** `readPoolSettings()` only **READS**; the URL is passed to
  `datasourceUrl` **verbatim**; pool sizing is declared in the URL by the operator, and when `connection_limit` is
  absent the boot log **says so** instead of adding it.
  **⚠️ This DEPARTS from `S-E01-1d.md` §4.2 ("appended only if the URL does not already carry the parameter"). The
  implementation is RIGHT: code that can compose a connection string is code that can compose the wrong ROLE.**
- **D8** Not decided here: the global `DATABASE_URL` cutover (`S-E01-1`), blocked on `PF-185`
  (`register.controller.ts:365`) and `PF-197` (six raw-SQL sites); `PF-194` remains an accepted `[LIMIT]`, out of scope.

---

## 4. Acceptance criteria

- **AC-1 — the proof EXISTS and is EXECUTED.** `node scripts/tenant-scope-check.js` runs against a real PostgreSQL and
  exits 0. Quote its banner and its evidence lines. **Assertion text is not evidence; an execution transcript is.**

- **AC-2 — the proof's ORDER is honoured, exactly.** In this order: (2.1) whom-am-I over the connection under test,
  owner read from the **catalog**; (2.2) positive control — own-tenant read, update and create all **succeed**;
  (2.3) denial — foreign-tenant `findUnique` by primary key → `null`, `update`/`delete` by primary key affect **zero
  rows or raise**, asserted on the Prisma error/count and **never on a log line**; (2.4) driven through the **compiled**
  seam, with a no-scope control statement proving the GUC is what makes the difference; (2.5) cleanup executed and
  **verified independently** (`pg_stat_activity` = 0 for the scratch database before the drop).

- **AC-3 — the live database is untouched.** The script creates and drops its own scratch database, whose name matches
  a pattern the script owns, and refuses to drop anything else. `pilotage` is never connected to for anything but the
  maintenance `CREATE`/`DROP`. **Assert this by name in the evidence, not by intent.**

- **AC-4 — TOOL-27 is not reintroduced.** The `app_user` Prisma client is **disconnected deterministically before the
  drop**, and the absence of sessions is verified. **No `GRANT pg_signal_backend`, no new role membership, no
  superuser requirement** appears anywhere in the diff.

- **AC-5 — the counter counts SCOPED SITES.** `scopedCallSites` replaces `withTenantCallers` in `cutoverReadiness`'s
  returned shape and in `cutoverVerdict`'s signature; the attribution is brace-matched; `cutoverVerdict` stays a **pure
  function** drivable from the spec without a database.

- **AC-6 — the affirmative branch requires ENUMERATION.** `cutoverVerdict` fires `ok` **only** when
  `scopedCallSites + enumeratedCallSites === prismaCallSites`, and `enumeratedOutsideScope` is a named in-source
  constant whose every entry **carries a reason string**.

- **AC-7 — the verdict is a TRUTHFUL `[LIMIT]`.** `node scripts/tenant-adversarial-check.js` exits 0 printing a
  `[LIMIT]` naming the **new** ratio (≈ `7/792`). **A green here is a FAILURE of this AC, not a pass.** A literal edited
  to move a number is likewise a failure.

- **AC-8 — the gate spec moved, and the mutant was red first.** `:1045`'s source-text pin is replaced by one pinning the
  `scoped + enumerated === total` wall; the four branch cases are re-expressed (including `scopedCallSites: 1` staying a
  `[LIMIT]`); the manufactured-green mutant — enumeration inflated to close the gap **without a reason string** —
  asserts the verdict is **not** affirmative, and **was observed RED before it was observed GREEN**.

- **AC-9 — the new stage is wired, ordered, and cannot skip.** Present in `scripts/ci-gate.sh` **immediately after the
  boot stage** and in `.github/workflows/ci.yml` after `boot-check.js`, with **no `continue-on-error`** and no skip
  branch. The **ordering dependency is stated in a comment where the stage is created** (after `prisma generate` at
  `:312` and after `build` at `:360`), and the missing-artefact path fails naming the producing command.

- **AC-10 — NO MIGRATION.** `git diff --stat` shows **ZERO** files under `apps/api/prisma/migrations/` and
  `scripts/restore-drill-baseline.json` **unchanged** (`PF-80`). **If you discover a migration is needed, STOP AND SAY
  SO rather than adding one late.**

- **AC-11 — G-AUTHZ / G-PORTAL hold, untouched.** `apps/api/src/modules/calendar/calendar.access.spec.ts` is
  **byte-untouched and green**; `calendarVisibilityWhere` (`calendar.controller.ts:65`) is **unchanged byte for byte**.
  Per portal, the scope does not change the visible set: **admin** `{}`, **teacher** `all + staff_only`, **parent**
  `all` + relevant scopes **including the empty-`classSectionIds` fallback to `school_wide`**, **student** (holds no
  `calendar.write`). State this from the existing spec's results — **do not edit that spec to prove it.**

- **AC-12 — G-DNC.** No flag, no `NODE_ENV` branch, no `ALLOW_*` / `SKIP_*` variable added anywhere in this diff turns a
  degraded scope into a silent one, or an enforced scope into a bypassed one (`DNC-10`), and no state added to the new
  script is unclassifiable (`DNC-08`).

- **AC-13 — the ledger is corrected.** `ADR-048` exists with D1..D8, D3 carrying a **measured** statement count and D5
  and D7 **naming their departure from `S-E01-1d.md` §4.3 / §4.2 and why the implementation is right**. `PF-198`,
  `PF-199`, `PF-200` and `TOOL-33` are rows in `OPEN.md`. `PROGRESS.md` §9 points at the next slice.

- **AC-14 — the SEAM ITSELF IS BYTE-UNCHANGED by this half.** *(Added 2026-08-15 at land. It was the operating
  constraint of this slice from the first line of its brief — "DO NOT re-implement it, DO NOT rewrite it, DO NOT
  'improve' it" — and both `ADR-048 §D5` and two `OPEN.md` rows already deferred work **by citing it**. It was simply
  never written down, so those deferrals pointed at an acceptance criterion that did not exist. Writing it is the
  honest repair; deleting the deferrals would have been the dishonest one, because the constraint is real.)*

  `git diff` against `6504887` shows **zero** hunks in `apps/api/src/shared/prisma/tenant-scope.ts`,
  `app-role-prisma.service.ts`, `tenant-scope.service.ts`, `prisma.module.ts`, `prisma.service.ts` and
  `apps/api/src/modules/calendar/calendar.controller.ts`. The single permitted exception is
  `tenant-scope.spec.ts`, and only where §3.3 requires it.

  **Why the constraint is worth an AC rather than a convention.** The story was split precisely because the first half
  shipped unproven; a second half that may edit the thing it is proving can make its own proof pass by moving the
  subject. Keeping the seam frozen is what makes the transcript in `AC-1` evidence about `6504887` rather than
  evidence about whatever the gate half preferred. **What it costs, stated rather than hidden:** `PF-202`'s third
  remedy (the `refused_unusable` boot error must name `prisma migrate deploy`, `app-role-prisma.service.ts:125-131`)
  and `PF-203`'s runtime half both live inside frozen files and are therefore **carried open**, owned by the next
  slice entitled to edit the seam. That is a deliberate deferral with a named owner, not an omission.

---

## 5. Rollback

Deleting `scripts/tenant-scope-check.js` and its two gate stages removes the proof and leaves the seam exactly as
`6504887` shipped it. Reverting §3.2 restores the string counter — and would restore the under-report the seam already
falsifies, so the revert is a *reversal*, not a *fix*. **No schema change, no migration to undo.**

---

## 6. Findings this slice records in `docs/daily-improvement-v3/traceability/OPEN.md`

**None of the four is present today — verified by grep on `6504887`.**

- **`PF-198`** — *The calendar seed path is deliberately uncovered.* `calendar-seed.service.ts:169` opens its own
  `$transaction` for a bulk import + audit row; it cannot nest inside an interactive transaction and would not compile
  against `Prisma.TransactionClient`. Fix direction: the seed service opens the scope itself and passes its own `tx`
  down. **Not this slice.** Gate: G-TENANT.
- **`PF-199`** — *Identity and context resolution cannot be inside the scope it resolves.* `ensureUser`, `forTenant` and
  `scopeForUser` run on the owner connection **by necessity** — `ensureUser` produces the very `tenantId` a scope needs.
  The global cutover therefore needs a **named bootstrap allow-list** — the set of statements that legitimately execute
  without a tenant GUC — **not a widened grant**. Owned by `S-E01-1`. Gate: G-TENANT.
- **`PF-200`** — *The coverage counter is LEXICAL and cannot see a leak through `this`.* The brace-matched attribution
  marks a call site covered when its **text** sits inside a scope callback. A helper **called from inside** a scope that
  issues its statement on `this.prisma` executes on the **OWNER** connection and is still counted covered only if its
  text sits inside the callback — so the counter over-reports on that shape. The compile-time guard
  (`Prisma.TransactionClient` exposes no `$transaction`) binds the callback **body**, not its **callees**. Mitigation
  today: `TenantScopeService.current()` is explicit; a lint rule forbidding `this.prisma` inside converted modules is
  the candidate fix. Gate: G-TENANT, G-DNC.
- **`TOOL-33`** — *The new gate stage has an ordering dependency, and it must be stated where it is created.*
  `scripts/tenant-scope-check.js` drives the **compiled** seam, so it must run after `ci-gate.sh:312` (`prisma
  generate`) and after `:360` (`build`) — the guarantee `boot-check.js` (`:361`) already relies on. **It names the story
  it unblocks: `S-E01-1d` AC-2 has no other executable home, because agents never build and the gate does.** Gate:
  G-DNC.

---

## 7. Out of scope — do not widen

The `DATABASE_URL` flip itself (`S-E01-1`, still blocked on `PF-185` `register.controller.ts:365` and `PF-197`'s six
raw-SQL sites) · `PF-194` (cross-tenant role writes — a product decision wearing three ids) · converting any **second**
module · `FORCE ROW LEVEL SECURITY` · any change to `calendarVisibilityWhere` or to the ABAC · any UI change
(`touchesUi` false) · any worker change (`touchesWorker` false) · **any migration** · re-implementing, rewriting or
"improving" the seam shipped at `6504887`.

---

## 8. Definition of done

`node scripts/tenant-scope-check.js` exits 0 having proven AC-2 as a **proven non-owner role** with the **positive
control first**, on a scratch database, with the live `pilotage` untouched and the teardown independently verified ·
`node scripts/tenant-adversarial-check.js` exits 0 printing a **`[LIMIT]` naming the new ratio** · the gate spec is
green with the manufactured-green mutant **shown red first** · `calendar.access.spec.ts` untouched and green ·
`git diff --stat` shows **no migration**, **no `restore-drill-baseline.json` change**, and no file outside the touch
list · `ADR-048` exists with D3 measured and D5/D7 recording their departures · `PF-198`/`PF-199`/`PF-200`/`TOOL-33` are
rows in `OPEN.md` · `PROGRESS.md` §9 points at the next slice.
