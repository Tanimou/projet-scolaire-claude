# ADR-048 — The tenant scope seam: TWO connections, and the cutover stops being an event

- **Status**: `accepted` — the two-connection shape, the three-state posture of the second connection, the nesting
  rule, the transaction budget and the redefinition of `AC-9 CUTOVER READINESS` are decided and implemented. What
  this ADR does **not** decide is the global `DATABASE_URL` cutover (`S-E01-1`), which stays blocked on `PF-185` and
  `PF-197`.
- **Date**: 2026-08-15
- **Story**: `S-E01-1d` (epic `V3-E01`), advancing `PF-02` half (a) *without closing it*, unblocking `S-E01-1`,
  recording `PF-198`, `PF-199`, `PF-200`, `PF-201`, `PF-202` and `TOOL-33`.
- **Relates to**: `ADR-002` (multi-tenancy: shared DB + `tenant_id` + RLS) · `ADR-032 §D1–§D8` (tenant context is a
  bound parameter, read back, fail-closed; the owner bypasses its own policies; `FORCE` deliberately absent) ·
  `ADR-035` (no shared interceptor: each call site enters the seam explicitly) · `ADR-042 §D4` / `ADR-046 §D1`
  (`tenant` is outside policy on purpose, so identity can resolve before a tenant exists) · `ADR-045` (the
  adversarial suite and its executed-proof bar) · `ADR-047` (the authorization write surface; `PF-194` stays an
  accepted `[LIMIT]`).
- **Number**: `048`. Allocated against `main` **plus every open pull request** (`TOOL-30` anti-recurrence): `047` is
  the highest on `main`, in-flight was 0, and all six open PRs are Dependabot bumps claiming no ADR and no finding id.
- **Departures from the story spec, made by measurement and argued below**: `§D5` departs from spec `§4.3`
  (two-state degraded fallback → **three** states, the third of which **refuses**), and `§D7` departs from spec
  `§4.2` (append `connection_limit` if absent → **read only, compose nothing**). `§D9` records a decision the spec
  did not anticipate at all.

---

## Context — measured on 2026-08-15 against this checkout, not relayed

The application connects as `pilotage`, which **owns** all 55 tables. A table owner is exempt from its own policies
while `FORCE ROW LEVEL SECURITY` is absent (`ADR-032 §D5`, absent deliberately). So the 50 policies shipped by
`S-E01-2b`/`2c`/`2d`/`1b`/`1c` are complete **and enforce nothing on the running system**. That is `PF-02` half (a),
stated exactly.

Flipping `DATABASE_URL` to `app_user` is all-or-nothing in the worst possible direction. `scripts/tenant-adversarial-check.js:1914-1930`
already says why, in the file, and this ADR does not improve on it: after the cutover **every** Prisma call site that
does not set the tenant GUC returns **zero rows** — not an error, a silent empty result. One covered site out of ~792
is therefore not one step towards safety; it is one covered site and ~791 outages, and the coverage would have to
reach 100 % on a single day, across 223 files, in one diff no review absorbs.

Re-measured on this tree with the brace-matched attribution `§D6` installs:

| Fact | Value |
|---|---|
| `.ts` files scanned under `apps/api/src` + `apps/worker/src` (specs and `.d.ts` excluded) | 223 |
| Prisma call sites (receivers `prisma`, `this.prisma`, `tx`) | **794** |
| Call sites inside a tenant-scope callback after this slice | **6** |
| Distinct `run(...)` call sites in `calendar.controller.ts` (`:229`, `:273`, `:318`, `:461`) | 4 |

Two things about that table are load-bearing and are **not** what the story spec predicted (`~7 / 792`); both are
recorded as findings rather than smoothed over. See `§D6`.

`DATABASE_URL_APP` already existed — `.env:20`, `.github/workflows/ci.yml:170` — and **nothing in application code
read it**. `scripts/lib/default-database-url.js` reads `DATABASE_URL` only, by its own rule (*"an address, never a
bypass"*), and this slice does not change that: the second client reads `DATABASE_URL_APP` **directly**.

---

## Decision

### D1 — Two connections, not one

The owner client (`PrismaService`) keeps serving the ~788 unconverted call sites, unchanged. A **second**
`PrismaClient`, bound to `DATABASE_URL_APP` and held by `AppRolePrismaService` (composition, never `extends
PrismaService` — extending would replay `onModuleInit` and connect the owner twice), serves only the call sites a
module has explicitly moved into a scope.

Coverage then grows **module by module**, each module genuinely RLS-enforced the day it converts, and an unconverted
site keeps working instead of becoming an outage. The asymmetry that makes an opt-in seam acceptable here — and it
must be written down, because `ADR-035` refused an opt-in for audit — is this: **forgetting to open a scope leaves
that call site in the pre-story status quo** (owner connection, no new leak, no outage), whereas forgetting an audit
write leaves a governance hole. Different failure shapes, different verdicts, same reasoning.

`AppRolePrismaService` is provided by `PrismaModule` (already `@Global()`, so a converting module wires nothing) and
is injected **nowhere except `TenantScopeService`**. That is the structural proof AC-4 asks for: the second
connection is unreachable except through the seam.

### D2 — Why per-module beats big-bang

794 call sites across 223 files in one diff is not reviewable, and the failure mode of a missed site is a **silent
zero-row read**, not an error — the shape this programme has ruled against repeatedly (`DNC-08`, `DNC-10`). A
per-module migration makes each conversion small enough that its blast radius is the module, and makes the residual
**countable** rather than asserted (`§D6`).

### D3 — The interactive-transaction cost, MEASURED per handler

`withTenant` opens a Prisma **interactive transaction** (`maxWait` 2 s / `timeout` 5 s, `prisma.service.ts:276-282`).
That is a real cost, and this slice pays it on four handlers that previously ran in autocommit. AC-8 bounds it at
≤ 2 statements inside the scope; the measurement, not an assumption:

| Handler | Statements inside the scope | Note |
|---|---|---|
| `list` (`:229`) | **1**, or **2** on the parent branch | `enrollment.findMany` (parent only), then `calendarEvent.findMany` |
| `update` (`:273`) | **2** | `calendarEvent.findUnique` (guard) then `calendarEvent.update` — deliberately in the **same** scope, so both see the same GUC |
| `remove` (`:318`) | **2** | `findUnique` then `delete`, same reason |
| `create` (`:461`) | **1** | all validation is pure and happens outside |

Maximum **2**. `set_config` is not counted; it is the seam's own statement.

> **AMENDED 2026-08-15 by `ADR-049 §D4` (`S-E01-5`, closing `PF-204`) — the maximum is now 3, and the NUMBER is
> replaced by a RULE.**
>
> The sentence below — *"all validation is pure and happens outside"* — was true of the validation that existed when
> this table was measured, and **false as a general claim**. `PF-204` is a scope foreign key that must be checked for
> **ownership**, and ownership validation is **not pure**: it needs the database, and it must run **inside** the
> scope, because running it outside would validate against the owner connection, which can see every tenant — the bug
> re-implemented as a check. So the amendment is a real cost, argued in `ADR-049 §D4`, not a number quietly moved.
>
> The amended maximum is **3**, on the two **write** handlers only, and only when the body names a scope id:
> `update` 2 → **3** (guard read, ≤ 1 ownership probe, write), `create` 1 → **3** (≤ 1 scope-id probe, ≤ 1
> `academicYearId` probe, write). `list` and `remove` are **unchanged**; **no read path gains a statement**. The
> worst case is held at 3 rather than 4 by `ADR-049 §D3`, which makes the three scope ids mutually exclusive — a
> hardening that also closes the inference hole at `calendar.controller.ts:449-457`.
>
> **What replaces "≤ 2", and it is stricter where it matters:** `≤ 2` was a *measurement* with no principle under it,
> which is why it could not survive the first non-pure validation. The invariant is now — *the number of statements
> inside a tenant scope must be bounded by the **schema**, never by the **request***. A handler doing
> `for (const id of body.ids) await tx.x.findFirst(…)` violates it **even at count 2 today**, because a caller can
> make it 500 tomorrow; the old numeric bound would have passed it. The table above and the one in `ADR-049 §D4`
> remain as the audit trail of the constant; the invariant is what the next converting module must satisfy.

The rule this yields, and it is the reusable part: **late scope, early close.** Everything on the owner connection
finishes before the scope opens. Concretely — **identity resolution, bulk imports and reports never enter a scope**.
`UserSyncService.ensureUser` reads `user_profile` (a policied table) to resolve a profile from a Keycloak `sub`
*without knowing a tenant*: it **produces** the tenant, it cannot consume it, and under `app_user` with no GUC it
would return zero rows and every authenticated request on every portal would answer 403. `SchoolContextService.forTenant`
and `StudentAccessService.scopeForUser` are in the same position (`school`, `academic_year`, `guardianship`,
`student` are all policied). This is recorded as `PF-199`, and it is the structural reason the cutover cannot be an
event.

Corollary, stated as a rule: calling `scopeForUser` **from inside** a scope would make the process hold an owner
connection **and** an application connection simultaneously for the life of the transaction. `list` therefore hoists
`scopeForUser` above the `run(...)` and passes the resolved `studentIds` in.

### D4 — Nesting: reuse on the same tenant, refuse on a different one

`run(...)` consults the `AsyncLocalStorage` frame first.

- **Same tenant** → the already-open `tx` is passed to `fn` and **nothing is opened**. Opening a second interactive
  transaction would make Prisma take **another pooled connection, where the GUC is not set**; the nested block would
  execute out of context while looking covered. Zero rows, silently, presenting as "a bug in the feature".
- **Different tenant** → `TenantScopeError`, naming both tenants. "Open tenant B inside tenant A" has no reasonable
  reading: it is either context confusion or a confused-deputy attempt. Both must be loud (`DNC-08`).

The store carries `tx` as `unknown` **on purpose**. The architectural rule is *lexical scope, not ambient*: a
consumer receives its transaction client as a **callback parameter**. A public `getCurrentTx(): PrismaClient` would
be exactly the ambient form a future service could reach without registering with the seam — the objection `ADR-035`
raises against interceptors. `current()` returns the tenant id only; the seam is not traversable backwards.

### D5 — The degraded mode is THREE states, and the third one REFUSES *(departs from spec §4.3)*

The story spec described two states: declared (enforced) and absent (degraded onto the owner). The implementation
ships **three**, and this ADR ratifies the departure.

| State | Trigger | Behaviour |
|---|---|---|
| `enforced` | declared **and** the boot probe passes | scope runs on the non-owner client; gauge = 1 |
| `degraded_no_app_url` | unset or empty | scope opens **on the owner client**; one `warn` at boot; gauge = 0 |
| `refused_unusable` | declared **but** the probe fails | `ServiceUnavailableException` per converted call site; **no fallback to the owner**; `error` at boot; gauge = 0 |

The missing third state is the one that matters. **Declaring the variable IS the operator's opt-in.** A declared-but-broken
opt-in is a *misconfiguration*, and silently falling back to the owner would produce precisely the
unclassifiable connection state `DNC-08` forbids: the deployment believes it is enforcing, the gauge would have to
lie or be meaningless, and the operator gets a green from a connection that protects nothing. Refusing is louder,
smaller and truthful.

Three ways the second connection can be a **disguised owner**, all of which the probe (`appRoleVerdict`) rejects and
none of which is a detail: (a) `DATABASE_URL_APP` copy-pasted from `DATABASE_URL`, a superuser, or a `BYPASSRLS`
role; (b) a role that connects but was **never granted** — the RLS migration computes `has_app_user` and, when false,
emits a `RAISE NOTICE` while `migrate deploy` still goes green, so a cluster where `app_user` was created *after* the
migration has 50 policies and zero grants; (c) `calendar_event` absent, so there is no owner to compare against.
The owner is read from the **catalog** (`pg_tables.tableowner`), never from a literal role name, so a cluster whose
owner role is named differently is judged correctly instead of declared healthy by accident.

**`refused_unusable` is not a theoretical state — it is the state of every database that exists today, and this ADR
records that rather than discovering it in production (`PF-202`).** Measured read-only against the live `pilotage`
database on 2026-08-15:

```
current_user=pilotage · _prisma_migrations=2 · pg_policies(public)=0
calendar_event owner=pilotage
has_table_privilege('app_user','calendar_event','SELECT') = f
has_table_privilege('app_user','enrollment','SELECT')     = f
```

`20260813120000_tenant_rls_policies` has **never been applied** to it, by design. So `appRoleVerdict` fails on the
*privileges* branch — failure family (b) above, exactly — and `.env:20` **already declares `DATABASE_URL_APP`**
against that database. The consequence, stated plainly: **on this machine, and on any deployment carrying that line,
booting the API puts the calendar module into `refused_unusable` and every calendar request in all four portals
answers 503.**

The decision does **not** change in response — weakening the refusal to a fallback is precisely `DNC-10`, and a
release that 503s one module is a smaller and louder failure than one that reports enforcement it does not have. What
changes is that the state acquires an **operator precondition and a named remedy**, and both are requirements on the
implementation, not commentary:

1. The `refused_unusable` boot `error` must name the **remedy** — `prisma migrate deploy` (the missing grants come
   from an un-applied migration) — not only the symptom. "Correct the configuration, not the code" is true and
   insufficient when the configuration is correct and the *database* is behind.
2. ~~`.env.example` keeps the variable **declared** — a fresh checkout applies the full ledger and therefore lands in
   `enforced`, which is the state this slice wants to be the default~~ — **CORRECTED AT LAND, 2026-08-15: that premise
   is FALSE, and this repository's own migration falsifies it.** `20260813120000_tenant_rls_policies` **never creates
   the `app_user` role** — it guards every `GRANT` behind `has_app_user` and exits 0 with a `RAISE NOTICE` when the
   role is absent. So `cp .env.example .env && prisma migrate deploy` on a clean cluster yields **no `app_user`**,
   `$connect()` throws, the state becomes `refused_unusable`, and the calendar answers **503 on all four portals** —
   on a module that works today. A default that breaks the fresh checkout is not a default worth having.

   **So `.env.example` ships the variable COMMENTED OUT**, and the comment block states the **precondition**
   explicitly rather than implying it: *declaring this against a database whose RLS migrations are not applied puts
   the calendar module into `refused_unusable` (503)*, with the one-line check
   (`SELECT has_table_privilege('app_user','public.calendar_event','SELECT')`) beside it. Commented out, a fresh
   checkout lands in `degraded_no_app_url` — the pre-story behaviour: named, gauge 0, nothing broken. Declaring it is
   an **operator act**, taken after the precondition holds.

   **This moves the DEFAULT, never the SEMANTICS.** The three states, the refusal, and the absence of any fallback are
   untouched — weakening those would be `DNC-10`, which is precisely what this ADR exists to refuse. It also brings
   the file into agreement with the ledger, which already described the remedy as *"the **commented-out**
   `.env.example` entry"* in both the `PF-202` row below and in `OPEN.md`, while the file itself shipped it
   uncommented.
3. `PROGRESS.md` and the PR description state it as a rollout order: **apply the ledger, then declare the variable**
   — and say out loud that the operator's own `.env:20` is currently on the wrong side of it.

**Landing status of those three, recorded rather than implied.** (2) and (3) landed with this diff. **(1) did NOT, and
the reason is a boundary rather than an oversight:** the remedy sentence lives in
`app-role-prisma.service.ts:125-131`, and `S-E01-1d (b)` AC-14 lists that file among the ones the gate half must
leave **byte-unchanged** — the whole point of splitting the story was that the second half does not get to edit the
first. Touching it here would be exactly the "improve the seam while you are in there" move the slice forbids, and it
would do it inside the file the AC names. It is therefore carried as the open half of **`PF-202`** and owned by the
next slice that may edit the seam. What this diff *can* do without crossing that line, and does: the executed proof
(`scripts/tenant-scope-check.js`) refuses to run at all unless the connection under test qualifies as enforcing, and
it names the ledger and the role when it does not — so the failure is legible from the gate even while the boot log's
wording lags.

**Why the refusal does not kill the process** — an assumed variance, not an oversight. Refusing to boot on a
misconfigured *second* connection would take down all four portals and the ~788 call sites that never needed it: a
blast radius strictly larger than the failure being avoided. The refusal is therefore **scoped to the seam** — each
converted call site answers 503 — and it is never silent: `logger.error`, gauge 0, and one exception per affected
request.

**The degraded state is named in three places**, and no flag, `NODE_ENV` branch or `ALLOW_*`/`SKIP_*` variable
changes any of them (`DNC-10`): one boot `warn` naming the *variable* (never its value, never a role, never a host);
the Prometheus gauge `pilotage_tenant_scope_enforced` (no labels — `/metrics` is unauthenticated, so an identifier
label would be both a cardinality explosion and a leak, and the gauge is **seeded to 0** so an absent series can
never read as green); and `scripts/tenant-scope-check.js`, which fails by name if it cannot connect as a proven
non-owner.

**Not `/readyz`, and not `/version`, decided with the reason.** `/readyz` down on a degraded scope would take PROD
offline the first time an operator's `.env` lacks the variable — a self-inflicted outage, not a defence. `/version`'s
own docblock commits to carrying *no tenant data and no connection string*; a public unauthenticated posture oracle
widens that surface for no operator benefit the gauge does not already provide.

### D6 — What "covered" means for `AC-9`, and the measured ratio this slice lands with

`AC-9 CUTOVER READINESS` counted occurrences of the string `.withTenant(`. That is the wrong unit twice over: four
`run(...)` calls cover six call sites (so it under-reports by construction), and a helper that opens no scope but
sits inside one is invisible to it. It is replaced by a **brace-matched attribution**: locate every scope-opening
call, brace-match to the callback's byte range, and a Prisma call site whose match index falls inside that range is
**covered**. `scopedCallSites` replaces `withTenantCallers` in the returned shape and in the verdict.

The affirmative branch additionally requires **enumeration**: `cutoverVerdict` takes a third input,
`enumeratedOutsideScope`, a named in-source constant listing the file globs legitimately outside a scope (bootstrap
`main.ts` / `config-preflight.ts`, migrations and seeds, health, the release/migration-state readers, the worker)
plus the `§4.4` entries **each with its reason string**. The affirmative branch fires only when
`scopedCallSites + enumeratedCallSites === prismaCallSites`.

**This is a wall, not a tunable floor**, and the reason is the same one `ADR-047`'s predecessor gave: a knob here is
a bypass flag wearing a different hat (`DNC-10`). The trap is symmetrical and must be named: **manufacturing a green
by widening the enumeration.** The enumeration is a list of *reasons*; "not converted yet" is not a reason and
belongs in the uncovered count. The gate spec therefore carries a *manufactured-green mutant* — enumeration inflated
to close the gap without covering anything, and without a reason string — which must be shown **red** before it is
shown green.

**This slice lands with a `[LIMIT]`, and that is the deliverable.** Measured by executing the attribution over the
corpus on 2026-08-15, with the implementation as shipped:

```
files 226 · prismaCallSites 794 · scopedCallSites 6 · enumeratedCallSites 113 · uncovered 675
scoped, all six, all in the file this slice converts:
  calendar.controller.ts:239 tx.calendarEvent.findMany   :274 findUnique  :286 update
  calendar.controller.ts:319 findUnique                  :322 delete      :462 create
enumerated, by glob: apps/worker/src/** 99 · user-sync.service.ts 5 · school-context.service.ts 4
                     calendar-seed.service.ts 3 · student-access.service.ts 2
foreign `.run(` receivers REPORTED, not counted: store.run ×1   (tenant-scope.ts:89 — the ALS call itself)
files whose scope callbacks failed to brace-match: 0
verdict: limit — "the tenant scope covers only PART of the corpus (6 scoped + 113 enumerated / 794)"
```

Three of those numbers are worth reading twice. **`store.run ×1`** is the receiver check earning its place on its
first run: `\.(?:withTenant|run)\s*\(` alone would have credited the `AsyncLocalStorage` call inside the seam itself.
**`0` unbalanced files** means the brace matcher survived 226 real files, which is what makes its fail-closed branch a
safety net rather than the normal path. And **five enumeration globs matched zero sites** (`main.ts`,
`config-preflight.ts`, health, release, migration-state) — they are kept, and printed with their hit count, because a
dead entry that is *visible* is a fact and a dead entry that is *silent* is future cover.

The measured ratio is **6 / 794**, not the `~7 / 792` the story spec predicted, and both halves of the discrepancy are
real defects rather than rounding:

- **6, not 7 — `PF-200`, live in the very file this slice converts.** `resolveParentClassSectionIds` receives `tx` as
  a lexical parameter (correct, and safe), but its *text* sits outside every callback range, so its
  `tx.enrollment.findMany` is attributed **uncovered**. The counter is lexical; it cannot follow a client through a
  call. The inverse — a helper called from inside a scope that issues its statement on `this.prisma`, i.e. on the
  **owner** — is the dangerous direction, and it would be counted uncovered too, which is the right answer for the
  wrong reason. The compile-time guard (`Prisma.TransactionClient` exposes no `$transaction`) binds the callback
  body, not its callees. Mitigation available today: `current()` is explicit; the candidate fix is a lint rule
  forbidding `this.prisma` inside converted modules.
- **794, not 792 — `PF-201`, new.** `PRISMA_CALL_SITE_RE` does not strip comments, and the string `prisma.service.ts`
  — a **file path in a docblock** — matches it as receiver `prisma`, model `service`, verb `ts`. Two such mentions in
  `tenant-scope.ts` inflated the AC-9 **denominator** by two. The scanner already routes them to `unmappedModels`,
  but `prismaCallSites += 1` happens *before* the model lookup, so prose can move the ratio a story reports. Prose
  must not be able to move a security metric in either direction.

### D7 — The pool is DECLARED in the URL; no code composes a connection string *(departs from spec §4.2)*

The story spec said `connection_limit=5` would be *"appended only if the URL does not already carry the parameter"*.
The implementation **reads and never writes**, and this ADR ratifies that: `readPoolSettings(url)` returns two
integers and nothing else — never the host, never the database, never the role, never the credentials. The URL is
passed **verbatim** to `datasourceUrl`.

**Scope of the claim, stated precisely, because the gate half makes the imprecise version false.** "No code composes
a connection string" is a rule about **production code**, and there it holds without exception. There is exactly one
composer in the tree and it is `scripts/tenant-scope-check.js`: the proof must reach a *scratch* database, and the
seam it drives deliberately reads an address it does not choose, so the proof has to build one. Three properties keep
that from being a loophole rather than an exception:

1. it composes **one component** — the database name — and carries host, port, role, credentials and query string
   over untouched, so it can never compose a different **role**, which is the failure D7 exists to prevent;
2. it asserts the result **by name before issuing a single statement**: both resolved DSNs must name the generated
   scratch database, and the scratch name must differ from the live one. That assertion is first in the file, ahead of
   the whom-am-I probe, because the positive control performs a `create` and a mis-composed DSN would write a row into
   the live database;
3. it never mutates `process.env`. The scratch owner DSN reaches `prisma migrate deploy` through the **child's**
   environment and the scratch app DSN reaches Prisma through `datasourceUrl` — so nothing constructed later in that
   process can inherit either by accident.

The reason is not fastidiousness. **Code that can compose a connection string is code that can compose the wrong
ROLE**, and the whole point of this slice is that one specific connection is provably not the owner. `ADR-032 §D2`'s
posture is *refuse, never sanitise*; appending a parameter is sanitising, and it puts a string-building path one edit
away from the address that decides who the database thinks you are. Sizing is declared in the URL, where Prisma
reads it; the boot log reports the **effective** value, and says so out loud when `connection_limit` is absent (Prisma
then applies `cpus*2+1` **in addition to** the owner pool, on the VPS's `max_connections`). `connection_limit=5` in
`.env.example` is a documented starting point for one converted module out of ~26 — **to be revisited per module**,
not a constant.

`DATABASE_URL_APP` is deliberately **absent from `REQUIRED_ENV`** (`config-preflight.ts`): requiring it would refuse
boot on every current deployment, where it is declared nowhere. Same precedent as `AUDIT_FORWARD_TOKEN` (`ADR-036 D9`) —
a **named** fail-safe absence beats a requirement that pushes a future author towards a guessed default (`PF-54`).

### D8 — Not decided here

The global `DATABASE_URL` cutover (`S-E01-1`) stays blocked on `PF-185` (`register.controller.ts:365` needs
`INSERT`/`UPDATE` on `tenant`) and `PF-197` (six raw-SQL sites, two of them boot-time `CREATE UNIQUE INDEX` that
swallow their own failure). `PF-194` (cross-tenant custom-role writes) remains an accepted `[LIMIT]` from `ADR-047`
and is **out of scope**. `FORCE ROW LEVEL SECURITY` stays absent. No second module is converted. **No migration is
shipped by this slice** — `apps/api/prisma/migrations/` is untouched and `scripts/restore-drill-baseline.json` is
unchanged (`PF-80`).

### D9 — Hardening a write must not create an existence oracle *(not anticipated by the spec)*

This decision is new, it is not in the story spec, and it is the one an implementer would most easily have got wrong
by omission.

Before this slice, `update` / `remove` answered **404** for another tenant's event, via the application `if`. Under a
set GUC on a non-owner connection, `calendarEvent.update({ where: { id } })` on a non-visible row raises Prisma
`P2025`, which Nest renders as **500**. A 500 where the guard gives a 404 distinguishes *"exists in another tenant"*
from *"does not exist"* — an existence oracle across tenants, **introduced by the hardening itself**, that the code
before the slice did not have.

`P2025` is therefore mapped to `NotFoundException` (`mapWriteRefusal`, `calendar.controller.ts:162`), so the database
floor and the application guard become **externally indistinguishable**. The application `if` is **kept** — defence
in depth, and it is the only guard on the owner connection and in degraded mode; removing it would be a visibility
change dressed as a fix. Copy contract: no visible change (`CalendarManager.tsx` renders `res.error` verbatim, so a
raw Postgres message would land untranslated in front of an administrator).

**The general rule, for the next module that converts:** when a database refusal replaces an application refusal, the
two must be indistinguishable *from outside*. Otherwise the difference between them is the leak.

---

## Consequences

**What this does NOT say.** The running application is **still not RLS-isolated**. It connects as the table owner for
~788 of 794 call sites, and on a deployment where `DATABASE_URL_APP` is not declared, **even the six converted sites
run on the owner**. Coverage is a property of the **deployment** as much as of the source tree — a call-site counter
in the repository can rise while every container runs degraded because the variable is declared nowhere under
`infra/`. That is `PF-02`'s own shape, and `pilotage_tenant_scope_enforced` exists so the second cannot pass for the
first.

**Positive.** `PrismaService.withTenant` has its first production caller, ~4 years of "the seam exists, unused" ends,
and the cutover becomes a per-module migration with a countable residual. `calendar_event` reads and writes are now
refused **by PostgreSQL** rather than by an application `if` on any deployment that declares the variable. `AC-9`
stops measuring a string and starts measuring coverage.

**Negative / accepted.** Four handlers now run inside an interactive transaction that they did not before, including
in degraded mode — bounded at ≤ 2 statements (`§D3`) and paid on the lowest-traffic converted module on purpose. A
second connection pool is added to the same `max_connections` budget (`§D7`). The seam is **opt-in**, so a future
author can forget it — mitigated by the asymmetry in `§D1` (forgetting leaves the status quo, not a hole) and made
visible by `§D6`.

**Rollback (AC-6), stated and true.** Reverting the four `run(...)` call sites in `calendar.controller.ts` returns
the module to the owner connection. **No schema change, no migration to undo.** `TenantScopeService` and
`AppRolePrismaService` become dead code that constructs nothing — the second client is only built when the variable
is declared. There is **no interceptor to remove**: there never was one, and there could not have been (it would hold
the interactive transaction open across `ensureUser` and `forTenant`, breaking identity resolution *and* the 5 s
timeout).

**Open, by name.**

| Finding | Priority | What it is |
|---|---|---|
| `PF-198` | P2 | The calendar **seed** path is deliberately uncovered. `calendar-seed.service.ts:169` opens its own `$transaction` for a bulk import + audit row; it cannot nest inside an interactive transaction and would not compile against `Prisma.TransactionClient`. Splitting it to fit the scope would pay the conversion in *audit* guarantees (`ADR-035`). Fix direction: the seed opens the scope itself and passes its own `tx` down. |
| `PF-199` | **P1** | Identity and context resolution **cannot** run inside the scope it resolves. `ensureUser`, `forTenant`, `scopeForUser` stay on the owner connection by necessity. The global cutover therefore needs a named **bootstrap allow-list** — the set of statements that legitimately execute with no tenant GUC — not a widened grant. Owned by `S-E01-1`. |
| `PF-200` | **P1** | The coverage counter is **lexical** and cannot see a leak through `this`. Live in this diff: `resolveParentClassSectionIds` is attributed uncovered though it is safe, and the dangerous inverse (a helper issuing on `this.prisma` from inside a scope) is invisible to the type guard. Candidate fix: a lint rule forbidding `this.prisma` inside converted modules. |
| `PF-202` | **P1** | **New, and it blocks the landing until §D5's three requirements are met.** `refused_unusable` is reachable **today**: `.env:20` declares `DATABASE_URL_APP` against the live `pilotage` database, which has 2 migrations, 0 policies and grants `app_user` nothing on `calendar_event` or `enrollment` — so the boot probe refuses and the calendar module answers **503 in all four portals**. The refusal is the correct design; the missing pieces are the named remedy in the error, the commented-out `.env.example` entry, and the stated rollout order (apply the ledger, then declare the variable). |
| `PF-201` | P2 | **New.** `PRISMA_CALL_SITE_RE` does not strip comments: the file path `prisma.service.ts` in a docblock counts as a Prisma call site and inflates the `AC-9` denominator (792 → 794). Prose must not be able to move a security ratio. **Left unfixed on purpose and the denominator left at 794:** fixing it moves the ratio in the *favourable* direction, and a security number that improves inside the same diff that redefines how it is computed is a number nobody can audit. It is a one-line move of `prismaCallSites += 1` past the model lookup, owned by whoever next touches the scan. |
| `PF-203` | **P1** | **New, and it is the one that could make the gauge lie.** `probeAppRole` measures identity, ownership, `BYPASSRLS`, membership and the eight privileges. It **never reads `pg_class.relrowsecurity` and never counts `pg_policy` rows.** A database holding the GRANTS but not the POLICIES therefore satisfies every question it asks: verdict `enforcing`, gauge = **1**, and every converted call site reads **every tenant's** rows with nothing but the application `where` in the way. That is strictly worse than `degraded_no_app_url`, because the gauge *actively asserts* safety — `PF-02`'s own shape reproduced inside the probe built to refuse it — and it is reachable here, since the live database has 0 policies and a partial repair that runs only the grants half lands exactly there. **Asserted in `scripts/tenant-scope-check.js` for now** (`relrowsecurity` true and ≥ 1 policy on `calendar_event` and `enrollment`, on the connection under test); moving it into `appRoleVerdict` needs an edit to the seam that `AC-14` forbids this half, so it is the next slice's. |
| `TOOL-33` | P2 | The new gate stage has an **ordering dependency** and it is stated where it is created: `scripts/tenant-scope-check.js` drives the **compiled** seam, so it runs after `ci-gate.sh:312` (`prisma generate`) and after `:360` (`build`), immediately after `boot` — the same guarantee `scripts/boot-check.js:361` relies on. It **fails with a named reason, never skips**, when the generated client or the `dist/` module is absent, naming the command that produces it (`DNC-08`). It names the story it unblocks: `S-E01-1d` AC-2 has no other executable home, because agents never build and the gate does. **Bound derived from a measured triple**, not copied: the scratch lifecycle (`CREATE DATABASE` + `migrate deploy` of the 55-table / 59-policy ledger + `DROP`) took **20.9 s / 16.0 s / 16.2 s** on this checkout, so the stage is bounded at **180 s** — ~6× the worst observed. **Carried limit:** tier 3 is `--full` only, so a fast-tier PR reports `GATE: PASS` without ever running this proof; the ordering makes that unavoidable and the comment says so where the stage is created. |
| `PF-185` / `PF-197` | **P1** | The cutover's two remaining blockers. Unchanged by this slice, named so the residual is not read as clear. |
| `PF-194` | **P1** | Cross-tenant custom-role write (`ADR-047`). Still an accepted `[LIMIT]`; out of scope. |

**Known operational hazard for the proof script (`TOOL-27`, do not reintroduce).** `DROP DATABASE ... WITH (FORCE)`
run as `pilotage` cannot terminate a session belonging to `app_user` — `pilotage` is a member of neither `app_user`
nor `pg_signal_backend`. The scratch teardown must **disconnect the `app_user` client deterministically before
dropping**, or drop without `FORCE` and retry. It must **not** be "fixed" with `GRANT pg_signal_backend TO pilotage`:
that buys a green teardown with a standing privilege escalation on the very role the cutover targets.
