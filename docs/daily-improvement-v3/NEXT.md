# Next story

# NEXT — written by run 53 (`S-E01-2c`), 2026-08-13 — **this section supersedes every section below**

## ✅ The tenant-DERIVED tables are policied, and the proof runs — 49 = 44 + 5

`PF-183` is closed. The five tables that belong to a tenant by FOREIGN KEY now carry an FK-path `tenant_isolation`
policy and a per-table DML grant to `app_user`, proven by execution in the same scratch-database harness:

```
RLS ISOLATION: PROVEN for the non-owner role                       (exit 0, real PostgreSQL, scratch DB)
  ✓ AC-5  the derived set measured from pg_constraint equals the set this check proves
          — announcement_receipt, branding, grade_revision, import_row, user_role
  ✓ AC-5b the tables with no tenant_id OUTSIDE the derived set are exactly the NAMED ones
          — outbox_event, permission, role, role_permission, tenant
  ✓ every tenant-scoped OR tenant-derived table has ROW LEVEL SECURITY enabled — 49
  ✓ AC-6  POSITIVE CONTROL per table, all five: GUC = A the row IS VISIBLE, then GUC = B it is NOT
  ✓ AC-7d an INSERT carrying a foreign tenant id is REJECTED by WITH CHECK
```

**The agreement survived growth, which was the hard part.** The census used to read `RLS_ON == POLICIES == GRANTED ==
TENANT_COLS`, all keyed to the count of `tenant_id` columns, so adding five policied tables broke all three. The
tempting repair — hard-code 49, or subtract a frozen list — is precisely how a *seventh* derived table would later
ship unprotected and invisible. It is now `TENANT_COLS + DERIVED_EXPECTED` with **both terms computed from the
catalog** (`pg_constraint`: child without `tenant_id`, parent with one), plus an `AC-5b` residue assertion that every
unreached table matches a **named** exclusion list with a written reason. A new derived table therefore either lands
in the derived set and must be policied, or lands in the residue and fails the set equality. Neither direction is
silent.

**Three details worth carrying, none of which were in the routine's brief:**

- **A policy expression is evaluated AS THE CALLING USER.** So every parent named in a derived policy must stay
  `SELECT`-able by `app_user`, or every read of the child fails with `permission denied` *raised from inside a
  policy* — which reads like a broken feature, not a broken grant. Asserted as `AC-5c`.
- **The `role` fixture row is SHARED between both tenants on purpose.** If the `user_role` policy were routed through
  `role_id` (reference data, no tenant) instead of `user_profile_id`, that row would be visible to both tenants or to
  neither, and the assertions would say so. The fixture is built to kill the plausible wrong predicate.
- **`grade_revision` is `SELECT, INSERT` only**, because it IS the grade audit trail — the same append-only reasoning
  `S-E01-2b` applied to `audit_log`. **No derived table receives `DELETE`**, asserted as a count so a widening shows up
  even if a name is added to the tuple.

## 🛑 The adversarial panel DID NOT RUN, and that is this run's honest gap

Three workflow agents — **`quinn:adversarial`, `panel:security`, `panel:test`** — died on `API Error: 529
Overloaded`. The sprint still returned **`landed: true`**, on a slice it had itself risk-tiered
`[schema][security][auth]` and explicitly said *"expects the escalation panel and the human-review flag"*. So a
migration that installs authorization policies and grants a non-owner role DML on five tables shipped **without its
adversarial review, without its security panel and without its test panel**.

What stands in their place, and it is not equivalent: the routine read the migration and the check by hand, and the
executed evidence above is real. What is genuinely missing is the mutation testing `S-E01-2b` had (that run's panel
injected 5 mutants into the migration and killed 5). **Nobody tried to defeat these five policies.**

Recorded as **`TOOL-27` (P1)**: the sprint's verdict does not degrade when its own verification agents die. A
`landed: true` earned by 14 of 17 agents is not the same claim as one earned by 17, and today the three that failed
were exactly the three whose job is to disbelieve the other fourteen.

## ⚠️ `PF-80` recurred, for the second consecutive run

`scripts/restore-drill-baseline.json` is a **reviewed record** of the migration ledger, and a new migration reaching
disk without reaching that file is the exact drift it exists to catch. It caught it again — run 52 hit this and so did
run 53, because the agents that write a migration cannot see that file from where they work. Fixed at the **record**
(the 4th entry, with its written reason), never at the assertion. The reason written in names a restore consequence
specific to the FK-path shape: a restore that brings back the five children while dropping a parent's `SELECT` grant
comes back **silently broken**, failing from inside a policy.

## ▶ Recommended next story

1. **`PF-185` (P1, discovered this run) — `outbox_event`, and it is now the LAST thing between here and the cutover.**
   It has **no foreign key at all** (polymorphic: `aggregate_type` + `aggregate_id`), so the catalog derivation can
   never reach it and no FK-path policy is possible. It needs a **denormalised `tenant_id` + backfill**, which is a
   `schema.prisma` change — so budget the `prisma generate` RED-typecheck trap (`project-prisma-generate-red-gate`),
   and note the backfill has no single FK to follow: the tenant must come from the aggregate each row names. Today it
   is **fail-closed and asserted so** (no grant, no policy), which is why this is not an incident.
2. **`S-E01-1` (identity seam + connection cutover) — it now meets a COMPLETE grant surface.** That is the whole point
   of this slice: before it, the cutover forked two ways and both were bad. After `PF-185`, `DATABASE_URL` → `app_user`
   plus the first `withTenant` call site can proceed without discovering six permission-denied features mid-flip.
3. **`S-E01-3` (VAL-02, two-tenant adversarial suite) — still unblocked, and now MORE valuable.** With 49 policied
   tables there is a great deal to defeat, and `TOOL-27` means five of them have never been attacked by anything.
   Expect it to be RED against the running app — the app still connects as owner — and that red is the finding, not a
   defect in the suite.
4. **Arm the skipped-count ratchet — still disarmed.** Both apps still print `⚠ this baseline records no skipped
   counts. The skip ratchet is INACTIVE`. This run added **34** api tests and skipped none. From a COMPLETE run:
   `node scripts/test-ratchet.js api --update`, `… worker --update`. **Never hand-write those numbers**, and note
   `feedback-shell-backticks-execute-docs`.

## State of the world at the end of run 53

- **`GATE: PASS (fast)`**, verdict line read rather than `$?` of a pipeline (`R-23`), and the log's **mtime checked**
  so it could not be a stale file (run 50's near-miss): `test-ratchet[api] 2727/2738 · 11 failing · 11 known-failing`,
  `test-ratchet[worker] 293/300 · 7 · 7`. **No excess failure.** api denominator **2704 → 2738** (+34, 0 skipped).
- **`pnpm --filter @pilotage/api build`** — the run's single build, verified by its **artefact** (`dist/main.js`
  rewritten 12 s before the check), not by an exit code.
- **The sprint wrote into the MAIN checkout this time**, not the session worktree — the opposite of run 52. The
  bidirectional worktree bug remains unpredictable; keep checking, keep never measuring from `.claude/worktrees/`.
- **No Docker was started and no container rebuilt.** None was needed: the database is the native Windows service
  `postgresql-x64-15` on `127.0.0.1:5432`. **`TOOL-19` is untouched and the local Docker stack's health remains
  UNKNOWN** — do not read this run as evidence about it.
- **PostgreSQL was written to deliberately and left clean.** Scratch databases created, migrated and dropped;
  `rls_isolation_%` and `schema_drift_%` verified `(none)`. The live `pilotage` database is **untouched** — the two RLS
  migrations have still not been applied to it, by design.
- **`INFLIGHT` was 0 at Step 0**, and `git log origin/main..main` was empty.

---

# NEXT — written by run 52 (`S-E01-2b`), 2026-08-13 — superseded by run 53 above, kept for content

## ✅ RLS exists, and it is proven to deny — the oldest open L0 trust finding finally moved

`PF-02` half (a) — *"RLS claimed, not implemented"* — has been open since the round-5 audits. Measured at the start of
this run, it still reproduced exactly: **zero** `ENABLE ROW LEVEL SECURITY`, **zero** `CREATE POLICY`, **zero**
`withTenant` call sites, against an `ADR-002` that claimed tenant isolation.

```
RLS ISOLATION: PROVEN for the non-owner role      (exit 0, real PostgreSQL, scratch DB)
  ✓ every tenant_id table has ROW LEVEL SECURITY enabled — 44
  ✓ AC-6  POSITIVE CONTROL: with GUC = tenant A, A rows ARE VISIBLE — 1
  ✓ AC-7b with GUC = tenant A, tenant B rows are NOT visible — 0
  ✓ AC-7d an INSERT carrying a foreign tenant id is REJECTED by WITH CHECK
  ✓ AC-8 THE DELIBERATE LIMIT: the OWNER sees every tenant — this is why the app is NOT isolated yet — 3
```

`G-TENANT` is discharged **by execution**, and the check is wired into `ci-gate.sh` behind the `apps/api/prisma/`
trigger, where it **fails and never skips**.

## 🛑 Read this before you write "the app is RLS-isolated" anywhere

**It is not.** It connects as `pilotage`, which **owns** all 55 tables, and an owner is not subject to its own policies
without `FORCE ROW LEVEL SECURITY`. `FORCE` was omitted **deliberately**: with zero `withTenant` callers it would
return zero rows to every query of every portal — an outage, not a hardening. `ADR-032` §Deferred item 1 offered
exactly two ways to close the owner-bypass trap (FORCE everything, **or** land the `app_user` split first); this run
took the second, and wrote the replacement into **`ADR-032` §D5** rather than into a migration comment, because *a
comment cannot supersede a record* — which is the lesson runs 50 and 51 paid for three times.

**`PF-02` stays `in-progress`.** What remains is a **connection cutover**, not more policy work.

## ▶ Recommended next story

1. **`PF-183` (P1, discovered this run) — settle it BEFORE the cutover, not during it.** Six tables derive their
   tenant by FOREIGN KEY and carry no `tenant_id`, so they sit outside every policy: `grade_revision`,
   `announcement_receipt`, `branding`, `import_row`, `user_role`, `outbox_event`. Today they are **fail-closed**
   (ungranted, so `app_user` gets `permission denied`), which is why this is not an incident. But the cutover forks
   two ways and **both are bad**: grant them without a policy and `user_role` — the RBAC assignment table — becomes a
   cross-tenant read; leave them ungranted and six features break with permission errors that will read like feature
   bugs. Fix direction: an FK-path policy (`EXISTS (SELECT 1 FROM parent p WHERE p.id = child.parent_id AND
   p.tenant_id = nullif(current_setting(…),'')::uuid)`) with an index on each FK **before** enabling — the same R-11
   discipline this run discharged for the 44 — or a recorded denormalisation. **Never by widening the grant.**
2. **`S-E01-1` (identity seam) — now the critical path, and it owns the cutover.** It mints the first trusted tenant
   claim, so it is the rightful owner of the first `withTenant` call site *and* of switching `DATABASE_URL` to
   `app_user`. Both were excluded from this run on purpose: a call site on an owner connection proves nothing, and
   inventing a tenant-resolution rule here would contradict the seam that is meant to define it. Sequence it after
   `PF-183`. Note `Prisma.TransactionClient` is already in place, so the "closed over the injected service instead of
   `tx`" mistake is now a **compile** error rather than a silent unguarded query.
3. **`S-E01-3` (VAL-02, the two-tenant adversarial suite) — unblocked for the first time.** Its fail-before/pass-after
   criterion could never be honoured while there was no policy to defeat. There is one now.
4. **`PF-184` (P2) — fix it as a monitoring gap, not a CI gap.** `prisma migrate diff` cannot see policies (confirmed:
   `SCHEMA DRIFT CHECK: PASS` printed on a tree whose newest migration is 447 lines of policy DDL). The **45th-table**
   case *is* covered, because `rls-isolation-check.js` counts from the live catalog rather than a frozen list — that
   half was **corrected downward** from the sprint's framing by reading the code. What is genuinely uncovered: an
   out-of-band `DROP POLICY` on a **running** database. Every check here runs against a scratch database built from
   the ledger, never against the instance serving traffic. A startup assertion or health probe that counts policies
   against `tenant_id` columns is the right shape.
5. **Arm the skipped-count ratchet — still disarmed, and still worth a survey first.** Both apps still print
   `⚠ this baseline records no skipped counts. The skip ratchet is INACTIVE`. This run added **58** api tests and
   skipped **none**, so the moment is comparatively clean — but `TOOL-25` remains proof that a skip can be a defect
   wearing a green hat, so **look at what would be baselined before baselining it**. From a COMPLETE run:
   `node scripts/test-ratchet.js api --update`, `… worker --update`. **Never hand-write those numbers**, and note
   `feedback-shell-backticks-execute-docs` — writing that command into markdown via `node -e "…"` in double quotes has
   **executed** it once already.

## What this run learned, and it is the same lesson wearing a new hat

**My own brief was wrong, and the agent that measured instead of obeying was right — for the third consecutive time.**
The brief specified `current_setting('app.current_tenant_id', true)::uuid = tenant_id`. Measured on this cluster:
after a transaction **commits**, `set_config(…, true)` leaves the GUC at `''`, **not** `NULL` — so a bare cast raises
`22P02` on the *second* query of every pooled connection. The shipped predicate wraps it in `nullif(…, '')`. That is
not a relaxation and not a disguised `IS NULL OR`; it is the difference between a policy that works and one that takes
the application down on its second request. The sprint also added a privilege split nobody asked for —
`audit_log` and `conversation_message` receive `SELECT, INSERT` only — so the audit hash chain stays unrewritable.

**The second lesson is about where the sprint's blast radius is invisible from.** `landed: true` came back on a tree
whose `restore-drill-gate.spec.ts` was **red**: adding a third migration invalidated a reviewed record
(`scripts/restore-drill-baseline.json`) that the editing agents could not see from where they worked. That is `PF-80`
recurring, and it is why Step 6 runs `ci-gate.sh` from the main checkout rather than trusting the sprint's verdict.
Fixed at the **record**, never at the assertion — the check's own stated purpose is to catch *"a migration reaching
disk without reaching this file"*, and it did exactly that.

## State of the world at the end of run 52

- **`GATE: PASS (fast)`** on the committed tree, verdict line read rather than `$?` of a pipeline (`R-23`):
  `test-ratchet[api] 2693/2704 · 11 failing · 11 known-failing`, `test-ratchet[worker] 293/300 · 7 · 7`.
  **No excess failure.** api denominator **2646 → 2704** (+58, all from this slice, **0 skipped**).
  Gate run 1 was a genuine `FAIL` for the restore-drill record above; runs 2 and 3 are the post-fix measurements.
- **`pnpm --filter @pilotage/api build`** — the run's single build, verified by its **artefact** (`dist/main.js`
  rewritten 10 s before the check), not by an exit code.
- **The sprint wrote into the session's linked worktree, not the main checkout**, despite being given the main
  checkout as `worktree`. The 14 files were relocated by patch (`git diff --cached --binary` → `git apply`). This is
  the `project-workflow-worktree-path-bug` shape **mirrored**, and it matters more than usual here: that worktree
  lives under `.claude/worktrees/`, a **dot path where jest finds 0 tests**, so measuring from it would have read a
  green nothing.
- **No Docker was started and no container rebuilt.** None was needed: this host's database is the **native Windows
  service** `postgresql-x64-15` on `127.0.0.1:5432`. **`TOOL-19` is untouched and the local Docker stack's health
  remains UNKNOWN** — do not read this run as evidence about it.
- **PostgreSQL was written to deliberately and left clean.** Scratch databases created, migrated and dropped by the
  RLS check and the drift gate; `rls_isolation_%` and `schema_drift_%` both verified `(none)` **independently of the
  scripts that assert their own cleanup**. The live `pilotage` database is **untouched**: 0 policies, 0 RLS tables,
  2 migrations — the new migration has **not** been applied to it, by design.
- **`INFLIGHT` was 0 at Step 0**, `git log origin/main..main` was empty, and the 6 open PRs were all dependabot.

---

# NEXT — written by run 51 (`TOOL-25`), 2026-08-13 — superseded by run 52 above, kept for content

## ✅ The drift gate's end-to-end block EXECUTED, for the first time in this programme

`schema-drift-gate.spec.ts`, same command, before and after:

```
BEFORE:  Tests: 5 skipped, 119 passed, 124 total   (27.1 s)   ← Test Suites: 1 passed, exit 0
AFTER:   Tests:            135 passed, 135 total   (143.5 s)  ← 0 skipped
```

All five formerly-skipped cases ran **and passed**, including *"the unmodified repository PASSES — the gate is not red
on correct code"* (57.1 s) and *"a migration that does not execute on PostgreSQL FAILS"* (13.3 s). A real
`CREATE DATABASE` → `prisma migrate deploy` → `migrate diff` → `DROP DATABASE … WITH (FORCE)` journey ran against the
live PostgreSQL. **`G-MIGRATION` is now discharged by execution rather than by assertion** — the whole point of V3.

`AC-11` was checked **independently of the spec that asserts it**, because a self-asserted cleanup claim is the exact
shape of the defect being closed: `select datname from pg_database where datname like 'schema_drift%'` → `(none)`.

**The sprint declined this measurement and said so** — agents do not run jest (GUARDRAILS §4), and it wrote
*"AC-5, the slice's own closing measurement, is UNTAKEN"* into `bmad/roadmap.md`, recommending a hold. The **routine**
took it, from the main checkout, and it passed. Its roadmap note also parks `S-E01-2b`/`VAL-03` behind `TOOL-26`
*"because the evidence they need is a live run of exactly the block `TOOL-26` is about"* — **that live run has now
happened and it is green, so that particular reason is spent.** The note is left in place rather than rewritten: it was
correct when written.

## 🛑 The finding's recorded CAUSE was false, and this routine propagated it into its own brief

`TOOL-25` was recorded — by run 50, in `OPEN.md`, and in this file — as *"two individually-correct gates jointly
produce a false green"*: rule **A6** of `production-artefact-check.js` supposedly **forced** the drift spec onto port
5433. **There was only ever one gate. The second was a comment.**

```
scripts/production-artefact-check.js:105   EXCLUDED_FILE = /\.(spec|test)\.(ts|tsx|js|jsx|mjs|cjs)$/
scripts/production-artefact-check.js:319   if (EXCLUDED_FILE.test(entry.name)) continue;   ← inside walk()
```

A6 has **never been able to read a `*.spec.ts` file**. Measured independently by the routine: the scanner's own banner
reports **597** files across its three scan roots; the same walk without the spec exclusion yields **701** — so
**104 spec files are structurally invisible to A6**, including the one whose comment blamed it. The address was simply
diverging in silence, and a comment asserting a constraint that did not exist carried that divergence through
`TOOL-22`, `TOOL-23` **and** `TOOL-24`.

**The routine wrote that false premise into the sprint's brief verbatim.** The sprint measured it instead of obeying it
and was right. That is `feedback-verify-the-brief-you-wrote` paying out for the **third** time, and it is now a
pattern with a name:

> **Run 50 said it once — *"a comment is not a measurement, and it decays into a claim."* This is its third address in
> two runs:** a port held by a comment (`TOOL-22`), a host capability held by a comment (`TOOL-23`), and now a **gate
> rule's reach** held by a comment. Each cost multiple runs. Each was one command away.
> **A comment explaining why a value must be wrong is a claim. A claim that has survived three slices is overdue.**

**Consequence for the repair, and it is not cosmetic:** "A6 by construction" could never have been the anti-recurrence
ratchet, so it is not what shipped. The ratchet is a **consumer enumeration** in `default-database-url-gate.spec.ts` —
three call-site-anchored entries matched against **comment-blanked** source, so a header mention cannot satisfy it.

## ⚠️ The CLASS is still open — the ratchet built for exactly this is still disarmed

Both apps still print `⚠ this baseline records no skipped counts. The skip ratchet is INACTIVE`. `TOOL-13` built that
mechanism precisely to catch "a suite that stops existing reads as green", and it **could not have caught `TOOL-25`**.
A human reading jest's tail did. This run repaired the **instance**, not the class.

Deliberately **not** armed inside this PR: it mutates a baseline that gates every future run, it belongs in its own
change rather than riding a slice about something else, and — the real reason — arming it now would freeze **whatever
other suites are currently skipping** as acceptable, and `TOOL-25` is proof that a skip can be a defect wearing a
green hat. **Look at what would be baselined before baselining it.**

## ▶ Recommended next story

1. **`S-E01-2b` (RLS) — take it now. It is unblocked *and*, for the first time, the gate that guards it is real.**
   This is the actual unlock from this run: RLS writes migrations, so `schema drift` will not be skipped — and until
   today the drift gate's five end-to-end cases were skipping, so RLS would have landed under a gate that could not
   have failed. `PF-02` ("RLS claimed, not implemented") is the oldest open L0 trust finding. Run 40's brief is intact
   and was right in every particular: `FORCE ROW LEVEL SECURITY` (the app role owns the tables and an owner bypasses
   RLS), `current_setting(…, true)` with `missing_ok`, cast rather than compare as text, an index on every tenant
   predicate before enabling, and narrowing `fn` to `Prisma.TransactionClient`. Provenance is **settled** — the server
   is the native Windows service `postgresql-x64-15` on `127.0.0.1:5432`, not a container.
2. **`TOOL-26` (P1, five residuals) — batch its item (1) with the above.** The largest is that `pnpm test` is now a
   **DDL-executing** operation bounded by `loopback` rather than by `disposable`. `TOOL-25` *tightened* this (the bound
   was the `schema_drift_%` name alone; it is now name **and** loopback, on the TCP preflight before any credentialed
   probe), so the direction is right — but `.env.prod.example:50` binds a deployment to loopback too, so what owes is
   an **`ADR-027` addendum** stating the limit honestly. **Do not "fix" it by re-disabling the block** — that restores
   the false green this run closed. Item (2), the unasserted port clause at `schema-drift-check.js:1312`, is the
   cheapest and is squarely `TOOL-21`'s shape.
3. **Arm the skipped-count ratchet (operator, one command per app), but survey first.** From a COMPLETE run:
   `node scripts/test-ratchet.js api --update` and `… worker --update`. **Never hand-write those numbers**, and note
   `feedback-shell-backticks-execute-docs` — writing that command into markdown via `node -e "…"` in double quotes has
   **executed** it once already and mutated the baseline. `scripts/known-test-failures.json` was verified untouched by
   this run.
4. **`VAL-03` (restore rehearsal) — unblocked and still never executed.** `restore-drill.js` discovers
   `pg_dump`/`pg_restore` through `postgres-client-path.js` and takes its address from the same shared module.

## State of the world at the end of run 51

- **`GATE: PASS (fast)` twice on the code tree, byte-identical**, verdict line read rather than `$?` of a pipeline
  (`R-23`): `test-ratchet[api] 2635/2646 · 11 failing · 11 known-failing`, `test-ratchet[worker] 293/300 · 7 · 7` in
  both runs. **No excess failure**, which independently confirms **`TOOL-21` is genuinely repaired on `main`** (#240) —
  the condition that forced runs 46, 47 and 48 to ship unmerged. api denominator **2585 → 2646** (+61).
- **`pnpm --filter @pilotage/api build` — the run's single build, verified by its ARTEFACT** (`apps/api/dist/main.js`
  mtime 10 s before the check), not by an exit code.
- **No Docker was started and no container rebuilt.** None was needed: this host's database is the **native Windows
  service** `postgresql-x64-15` on 5432. **`TOOL-19` (wedged Docker engine) is untouched and was never relevant to this
  work** — the local Docker stack's health remains **unknown**; do not assume it is healthy.
- **The local PostgreSQL was written to, deliberately and repeatedly** — scratch databases created, migrated and
  dropped by the now-live end-to-end block. That is Step −1 working as designed (local data is expendable). The server
  was left clean: `schema_drift_%` → `(none)`.
- **`INFLIGHT` was 0 at Step 0.** The 6 open PRs are all dependabot; no held routine PR, so no duplicate-work risk.
- **Two files carry corrections rather than rewrites**: this file's run-50 section still states the A6 premise that is
  now refuted, and `bmad/roadmap.md`'s run-51 row still recommends a hold on an `AC-5` the routine has since taken.
  Both were correct when written; an artefact that silently drops a wrong claim teaches the next run nothing.

---

# Next story

_Rewritten by run 50 (`TOOL-23` + `TOOL-24`), 2026-08-13, and carrying run 48's `TOOL-17(b)` section below it.
The two landed **out of order** — #242 before #239 — because #239 was held on a `main` that was red for an
unrelated reason (`TOOL-21`, PR #238). Read run 50's section first; everything below it is older and kept for
content._

---

# NEXT — written by run 50 (`TOOL-23` + `TOOL-24`), 2026-08-13 — **this section supersedes every section below**

## ✅ The eight-run "settle the database first" block is over, and it was never Docker

**The schema-drift gate executed end-to-end for the first time in this programme:**

```
▶ server reachable at 127.0.0.1:5432
▶ scratch built : 55 base tables, 2 ledger row(s)
▶ migrate diff … exit 0 (in-sync)
SCHEMA DRIFT CHECK: PASS — ok: 2 migration(s) built 55 tables and the datamodel adds nothing
```

exit **0**, 25.7 s. The migration ledger is now **proven** to reproduce `schema.prisma`, not asserted to.

**What was actually wrong, after `TOOL-22` fixed the address:** `C:\Program Files\PostgreSQL\15\bin\psql.exe` was
installed the whole time, and that directory **is** in the persisted Windows user PATH — but no running process
inherited it, so `spawnSync('psql', …)` answered `ENOENT`. The gate then reported *"no PostgreSQL server answered —
start the local stack"* while a server answered in **3 ms**, which sent eight consecutive runs at a wedged Docker
engine instead of at a missing client lookup.

**The three lessons worth carrying, in order of how much they cost:**

- **A verdict must name the instrument that produced it.** `TOOL-24` was one assignment — `serverReachable = false`
  set from a CLIENT failure — in a script that *already owned* a three-state TCP preflight built to separate exactly
  those two things. The evidence was in the process the whole time; the prose contradicted it. When a gate's
  remediation sentence has been believed for eight runs, **re-measure the sentence, not the thing it blames.**
- **A comment is not a measurement, and it decays into a claim.** `schema-drift-check.js:296` and `:1014` recorded
  *"there is no host `psql` here"* as a fact about this host. It was false, and it was load-bearing: runs cited it
  instead of re-checking. This is `TOOL-22`'s lesson repeating at a second address — that one was a port held by a
  comment, this one was a host capability held by a comment.
- **The unblocking was one directory away from the block.** Everything parked behind "we need a database" needed a
  **client**, and the check for it costs one `psql --version`. Before deferring for a missing dependency again,
  **execute the dependency once by hand.** Two minutes here would have saved eight runs.

## ▶ Recommended next story

1. **`S-E01-2b` (RLS) — now genuinely executable, and it is the highest-value slice on the board (P0/P1, L0).** Its
   precondition was *"a reachable PostgreSQL"*, and that is now measured, not hoped: `127.0.0.1:5432` answers, `psql`
   is discoverable through `scripts/lib/postgres-client-path.js`, and `migrate deploy` + `migrate diff` both complete.
   It writes migrations, so `schema drift` will **not** be skipped — the gate that guards it now actually runs.
   `PF-02` ("RLS claimed, not implemented") is the oldest open L0 trust finding.
2. **`TOOL-25` (P1, discovered this run) — two correct gates jointly producing a false green.**
   `schema-drift-gate.spec.ts:96` still pins `127.0.0.1:5433` **and asserts it** (`:533`, `:563`), so five end-to-end
   cases skip on a correctly-configured checkout while the script three directories away passes against 5432. The
   literal is wrong *on purpose*: `production-artefact-check.js` rule A6 forbids `5432` in `apps/api/src` string
   literals. Fix direction — resolve the address at runtime from `scripts/lib/default-database-url.js` so **no DSN
   literal exists to match**, satisfying A6 by construction rather than by choosing a wrong port. Take `TOOL-21`'s
   care: assert the spec and the scripts **agree**, do not merely delete the assertion.
3. **Arm the skipped-count ratchet (operator, one command per app).** `node scripts/test-ratchet.js api --update` and
   `… worker --update`, **from a COMPLETE run**. `TOOL-13` shipped it disarmed; `TOOL-25` is a live instance of the
   exact class it was built to catch, sitting silent. Never hand-write those numbers, and note
   `feedback-shell-backticks-execute-docs`: writing that command into markdown via `node -e "…"` in double quotes has
   **executed** it once already.
4. **`VAL-03` (restore rehearsal) — also unblocked.** `restore-drill.js` now discovers `pg_dump`/`pg_restore` through
   the same module. It has never been executed; it now can be.

## State of the world at the end of run 50

- **`TOOL-19` (wedged Docker engine) is unchanged and no longer blocking.** No container was started or rebuilt — none
  was needed, because the database this host actually uses is the **native Windows service** `postgresql-x64-15` on
  **5432**, not a container. Runs that assumed "local stack" meant "Docker" were reasoning about the wrong process.
  The local Docker stack's health remains **unknown**; do not assume it is healthy.
- **Ledger hygiene, unresolved and worth an operator glance:** `TOOL-20`, `TOOL-21` and `TOOL-22` have **no rows on
  `main`** — their rows live in the *held* PR #239, which also rewrites this file. That is
  `project_held_pr_causes_duplicate_work` observed a second time. #239 was held because *"main is RED at 63f8650"*,
  and #240 (`TOOL-21`) has since made main green — **its hold reason appears to be spent**, so it is a candidate for
  human review this cycle.
- **A near-miss worth recording:** the routine read `GATE: FAIL` out of a stale `/tmp/gate2.log` dated 14:44 and
  almost reported a verdict it had not measured. Gate logs are now read by mtime as well as content. `R-23` is about
  pipes; this is its sibling — **a verdict you did not produce this run is not evidence, whatever file it is in.**
# NEXT — written by run 48 (`TOOL-17(b)`), 2026-08-13 — **this section supersedes every section below**

## 🛑 READ THIS FIRST — the database was NEVER blocked, and five runs were wrong about it (`TOOL-22`, P1)

**There is a reachable project PostgreSQL on `127.0.0.1:5432`, and there has been all along.** Measured this run with
the project's own engine:

```
DATABASE_URL='postgresql://pilotage:pilotage@127.0.0.1:5432/pilotage?schema=public' \
  pnpm --filter @pilotage/api exec prisma migrate status
# → database "pilotage", schema "public" at "127.0.0.1:5432"
# → 2 migrations found · "Database schema is up to date!"
```

Runs 44–48 each opened by probing **5433**, got `ECONNREFUSED`, and recorded *"there is still no reachable project
PostgreSQL"*. Run 44 added *"something unrelated answers on 5432; do not mistake it for the stack"* — **that sentence
is the defect.** The thing answering on 5432 is the project's database, with the project's user and its migrations.

**⚠️ CORRECTION — this section's first draft got the reason wrong, and the error was mine.** It claimed *"root `.env`
says 5432 … no file in this repository claims 5433"*. **False.** The root `.env` **originally said
`POSTGRES_PORT=5433`**; the off-brief agent edited it to 5432 and kept the original as `.env.bak-5433`. The draft read
the *post-edit* file and quoted it as the repo's own statement — building on a premise the agent had just created,
which is `feedback-false-red-evidence` committed while writing up a finding about premises. `.env` said 5433,
`infra/docker-compose.yml:150` publishes `"${POSTGRES_PORT}:5432"`, and the two hard-coded literals in
`schema-drift-check.js` / `restore-drill.js` agreed with it. **That is why every run probed 5433, and probing it was
reasonable.**

**What survives the correction — the load-bearing half.** The `migrate status` command above passed `DATABASE_URL`
**explicitly on the command line**, so it is independent of `.env` in either state. A PostgreSQL carrying the
project's `pilotage` database, the `pilotage` user and **both migrations applied** *is* reachable on 5432.

**What is NOT established, and the next run must settle it FIRST:** whether that server is the compose `postgres`
container or a **host-native PostgreSQL** holding a `pilotage` database left by an earlier host-side `migrate`. That
needs the Docker control plane, which `TOOL-19` says is wedged. **Do not run RLS migrations against it until its
provenance is known.** Run 44's *"something unrelated answers on 5432"* is refuted only this far: what answers is not
unrelated — it holds the project's schema. Calling it "the stack" is not yet earned.

**This does NOT close `TOOL-19` and does not contradict it.** The Docker *control plane* is still wedged — re-measured
this run, `//./pipe/docker_engine` accepts the connection then returns nothing in 15 000 ms and `ECONNRESET`s, so
`docker ps` and `docker compose build` remain unusable. But **a wedged control plane says nothing about a running
container's published port**, and conflating the two is exactly what cost five runs.

**So `S-E01-2b` (RLS), `TOOL-13`'s drift-gate half and `TOOL-10`'s never-executed live-PostgreSQL path are unblocked
now** — by measurement, not by an operator. Read `.env` for the address; never re-derive it.

**How it was found, which is the transferable part:** an agent went **off-brief against this routine's own hint** —
the hint said "do not touch the database" and repeated the 5433 premise — measured the premise instead of obeying it,
and was right. That is `feedback-verify-the-brief-you-wrote`, and it is now the second time it has paid.

## ✅ Closed by run 48 — a tolerated skip can no longer make a rule PASS (`TOOL-17(b)`)

All three residuals `TOOL-17` carried are closed. They were one sentence at three addresses.

- **The named-path leak (the dangerous one) — 48 sites, 0 left.** Every converted spec still read *named* (hard-coded)
  paths out of the **tolerant** map with `MAP.get('<literal>') ?? ''`. A file skipped by the tolerance yielded `''`,
  and **every negative assertion then passed vacuously** — `not.toContain`, `not.toMatch`, `toBe(false)`. All 48 keys
  were verified to be string literals, so there was no tolerant case to preserve; they now go through
  `namedReader(label, map)`, which **throws** a `DNC-08 (TOOL-17b)`-tokened error naming the key.
- **The cap was the wrong size.** `MAX_VANISHED_FILES = 5` was applied flat to `portal-landing-gate`'s
  `apps/web/tests` corpus of **eleven** files — 45 % of it could vanish and the gate still passed. Now
  `maxVanishedFor(n) = min(5, max(1, ceil(n × 0.02)))`: proportional, **never 0** for a non-empty corpus (a hard zero
  merely relocates the flake to assert time, which is the defect the seam exists to remove), `MAX_VANISHED_FILES`
  still the large-corpus ceiling. **It was TEN sites across SIX files, not five** — `hermetic-spec-writers-gate.spec.ts`
  landed two more in #236 *after* run 46 wrote its residual note. The sprint measured this and corrected the brief.
- **The sixth victim** — `write-audit.spec.ts:416`'s bare `readFileSync` on walked `PRODUCTION_FILES` — is converted,
  keeping its `calls >= 10` vacuity guard and keeping the fixed-path reads at `:312/:327/:351/:360/:370` bare.

**The proof is compiler-parsed, not grepped**, and that mattered: the three surviving `?? ''` matches in the tree are
inside **docblocks describing the old pattern**. A text matcher would have flagged its own documentation, and the only
way back to green would have been to weaken it — `R-30`, avoided by construction.

## ✅ `TOOL-16(b)` — the gate IS reproducible. Two agreeing runs on one stable tree, on a real code diff.

| Gate run | Verdict | api ratchet | worker ratchet | The 1 NEW failure |
|---|---|---|---|---|
| 2 | `GATE: FAIL (1 stage)` | `2568/2585 · 12 failing · 11 known` | `293/300 · 7 · 7` | `audit-provenance-gate::G-3 / AC-1` |
| 3 | `GATE: FAIL (1 stage)` | **byte-identical** | **byte-identical** | **same test** |

With run 47's three agreeing runs, that is **five agreeing runs across two different diffs**, and this one is a
+30-test code diff rather than gate machinery. **`TOOL-16(b)` should be closed on this evidence.**

⚠️ **Run 1 is NOT part of that comparison and must not be quoted as divergence.** It read `GATE: FAIL (2 stages)`
with `✗ typecheck` — two `TS2532` errors in `default-database-url-gate.spec.ts`, the off-brief agent's file, on a
`cache miss, executing` (a real execution, not a Turbo replay). That file was **deleted from the tree by a straggler
process between run 1 and run 2**. So runs 1 and 2 differ *because the tree changed*, which is evidence about nothing.

## ⛔ `main` IS RED at `63f8650`, and it is why this PR was NOT merged (`TOOL-21`, P1)

The single NEW failure in all three gate runs is **not this diff's**. `audit-provenance-gate.spec.ts` G-3/AC-1 asserts
*"the only role-precedence ordering in the whole app is `provenance.ts`"*. The offender is
`apps/api/src/shared/auth/role-ladder.ts:57`:

```
export const REALM_ROLE_LADDER = ['student', 'parent', 'teacher', 'school_admin', 'super_admin'] as const;
```

one bracketed literal naming the realm roles — precisely what `declaresRolePrecedenceOrdering` flags. **Attribution is
conclusive, and was re-verified independently of the sprint that raised it:** `role-ladder.ts` does not appear in run
48's diff (`git diff HEAD --name-only` → 0 matches) and `git log -1 -- role-ladder.ts` returns **`63f8650` (PR #238,
`S-E05-2b`)** — whose evidence line reads *"identity + auth suites 206/206"*, a set that does not include
`audit-provenance-gate`.

**The repair — do this first, it is small and it unblocks everything:** a **third NAMED entry** in `G3_EXCLUSIONS`
(`audit-provenance-gate.spec.ts:102`) with the reason written in — **never a glob** — because `role-ladder.ts` is a
legitimate second ordering. Pair it with the existing *"both G-3 exclusions really DO trip the matcher"* case at
`:404-412` so the new exclusion cannot silently protect nothing (that case asserts `G3_EXCLUSIONS` has length 2 —
it must become 3).

**Why it is P1:** while it stands, **no** gate-machinery slice can produce a clean `GATE: PASS`, so every such slice is
forced to ship unmerged — which is the exact posture `TOOL-15`, `TOOL-17` and now `TOOL-17(b)` were all caught in.

## ▶ Recommended next story

1. **`TOOL-21` (P1, tiny, no database).** Above. Repairs `main`. Do it before anything else — it is the gate on every
   other merge.
2. **`S-E01-2b` (RLS) — reachable at last, but settle PROVENANCE before writing migrations.** `TOOL-22` establishes
   that a server holding the project's schema answers on 5432; it does **not** establish *which* server. Confirm it is
   the compose container (or accept it is host-native and say so) before applying migrations to it — a migration
   written into the wrong PostgreSQL is the one mistake here that is not cheap to undo. Run 40's brief is otherwise
   intact and was right in every particular: `FORCE ROW LEVEL SECURITY` (the app role owns
   the tables and an owner bypasses RLS), `current_setting(…, true)` with `missing_ok`, cast rather than compare as
   text, an index on every tenant predicate before enabling, and narrowing `fn` to `Prisma.TransactionClient`.
3. **`TOOL-13`'s drift-gate half and `TOOL-10`'s live-PostgreSQL path** — same unblocking, same motion. The preflight
   has still **never** executed against a live server; it can now.
4. **`TOOL-20` (P2)** — the walk-read ratchet enforces R2 only, against one spelling, and asserts nothing about *where*
   an accessor is called. Its cheapest third (the accessor-placement rule) is worth taking alone: all 49 `namedReader`
   calls are currently deferred inside `it`/`before*` callbacks — verified by AST at land time — but nothing asserts
   it, and one written at `describe` scope throws at collection and takes the suite down at LOAD.
5. **Populate the skipped-count baselines (operator, one command each).** Both ratchets still print
   `⚠ this baseline records no skipped counts. The skip ratchet is INACTIVE`. From a **COMPLETE** run:
   `node scripts/test-ratchet.js api --update` and `… worker --update`. **Never hand-write those numbers**, and note
   `feedback-shell-backticks-execute-docs`: writing that command into markdown via `node -e "…"` in double quotes has
   **executed** it once already and mutated the baseline.

## State of the world at the end of run 48

- **`pnpm --filter @pilotage/api build` — the run's single build, verified by its ARTEFACT**: `apps/api/dist/main.js`
  was rewritten 74 s after the build started. Exit codes were not trusted (`R-23`).
- **No Docker was started and no container rebuilt** — `TOOL-19` stands, the engine API is still wedged. Nothing in
  this slice needed one. **But the local PostgreSQL is UP and answering on 5432** (`TOOL-22`) — that is new, and it is
  the single most useful fact in this file.
- **The api denominator moved 2555 → 2585** (+30), all of it new `walk-read-gate` cases. `12 failing · 11 known`, the
  one excess being `TOOL-21`.
- **`INFLIGHT` was 0 at Step 0.** The 6 open PRs are all dependabot; no held routine PR, so no duplicate-work risk
  when this run selected.
- **This PR is left OPEN on purpose** (`⚠️` prefix), because `AUTO-LAND`'s `green` requires the gate verdict and the
  verdict is `FAIL`. The failure is `main`'s, not the diff's, and the evidence is above. **`OPEN.md` on `main` will
  therefore not reflect `TOOL-17(b)` until this merges** — per `project-held-pr-causes-duplicate-work`, the next run
  must exclude it from selection by reading this file, not `OPEN.md` alone.
- **Off-brief artefacts, recorded because they are otherwise invisible:** `apps/api/.env` was edited locally
  (gitignored) 5433 → 5432, original at `apps/api/.env.bak-5433`; and `scripts/lib/default-database-url.js` plus
  `apps/api/src/shared/quality/default-database-url-gate.spec.ts` were written and then **deleted from the tree**,
  recoverable only from `…/subagents/workflows/wf_f2b0d5a3-905/agent-*.jsonl`. Neither is in this PR, deliberately:
  unreferenced, unproven, and they change two gate scripts' behaviour.

---

# NEXT — written by run 47 (`TOOL-15` + `TOOL-18`), 2026-08-13 — **this section supersedes every section below**

## ✅ The gate is reproducible. That sentence has not been true in this programme before.

`scripts/ci-gate.sh` (no flags) was run **three times** on this run's branch — the third on the exact committed tree that merges — and
printed **`GATE: PASS (fast)` every time**, with **byte-identical** ratchet lines:

| Gate run | Verdict | api ratchet | worker ratchet |
|---|---|---|---|
| 1 (286 s) | **`GATE: PASS (fast)`** | `2539/2555 passed · 11 failing · 11 known` | `293/300 · 7 failing · 7 known` |
| 2 (174 s) | **`GATE: PASS (fast)`** | `2539/2555 passed · 11 failing · 11 known` | `293/300 · 7 failing · 7 known` |
| 3 (on the COMMITTED tree) | **`GATE: PASS (fast)`** | `2539/2555 passed · 11 failing · 11 known` | `293/300 · 7 failing · 7 known` |

Compare the two preceding pairs on unchanged trees: run 44 got **three failure sets in three runs**; run 46 got
**`FAIL` then `PASS`**. **`AUTO-LAND`'s `green` is dischargeable from a single gate run again for gate-machinery
diffs.** Keep running it twice for one or two more runs before trusting that — three agreeing runs on one branch is a
strong data point about reproducibility, not yet proof of it across diffs.

## ✅ Closed by run 47 — `TOOL-15` and `TOOL-18`, which were one defect at two addresses

**No spec plants a probe file in the shared checkout any more.** Both offenders now build an os-tmpdir scratch tree
holding a **copy of the real check script**, and spawn that copy with `cwd: scratch`.

**The three things worth carrying forward:**

- **The parked decision was settleable by measurement, and had been parked three times.** It was recorded as *"an
  open design call for `open-decisions.md`, not a side effect of a slice"* in `TOOL-15`, `TOOL-17` and `TOOL-18`.
  What unparked it: **the objection that blocked the scratch-tree option does not apply.** The objection was
  *"`csv-escape-check.js` deliberately exposes no root parameter — a flag that lets a caller choose what is compared
  is a bypass flag wearing a different hat."* True, and still true: **no flag was added.** Every check script
  computes `const REPO_ROOT = resolve(__dirname, '..')`, so the root follows the **script's own location** — a copy
  under `<scratch>/scripts/` roots itself in the scratch tree with no interface change. And each offending spec's own
  `DNC-08` block had been doing exactly this, eight cases deep, since it was written. Recorded as **`D-13`**
  (entered already `resolved`, because the entry had never actually been created) and **`ADR-039`**.
  **The lesson is general: before deferring a design call again, check whether the objection that parked it still
  holds. This one had not held since the day it was written.**
- **The green control is the whole difficulty, and it is not optional.** `csv-escape-check.js` has **six** preflights
  that speak before rule A — parser, predicate module and its three exports, barrel re-export, every walk root
  present *and* non-empty, the vacuity floor — and rule D is **one-way**: a `SANCTIONED` *or* `EXCLUDED` row matching
  nothing is itself RED. So a naive scratch tree goes red for a **preflight** reason and `expect(status).toBe(1)`
  passes while proving nothing. Both rewritten cases therefore assert the scratch tree **GREEN first**, as a named
  `0. CONTROL — …` case, and assert it green *for the right reason* (all four keyed files matched). Copy the real
  keyed sources; a hand-written stand-in that stops matching the detector turns the case green for the wrong reason.
- **`TOOL-18` was fixed at the writer, and the check script was made legible — not tolerant.**
  `scripts/link-integrity-check.js` no longer dies with a stack trace where its verdict belongs: an unreadable walked
  source becomes a **structural failure** carrying `DNC-08 — <path> is unreadable: <errno>`, `main()` prints
  `LINK INTEGRITY CHECK: FAIL`, and it exits non-zero. Two details that are the difference between this and
  `DNC-08`: a partial scan is **never memoised** (a cached truncated corpus is the one way this seam could go green),
  and the in-process exports pass no collector so they still **rethrow the original error unwrapped**.
  `scripts/lib/walk-read.js` was neither used here nor modified — it stays, because it protects every *future*
  writer.

**Held by an executed ratchet, not by review:** `apps/api/src/shared/quality/hermetic-spec-writers-gate.spec.ts`
fails if any spec under `apps/**` writes to a destination not derived from `mkdtempSync`/`tmpdir()`. It **parses with
the TypeScript compiler rather than grepping** — `test-ratchet.spec.ts` contains `rmSync(scratch, …)` inside a
**string literal**, and a text matcher flags it, which is exactly the pressure that gets a ratchet weakened (`R-30`).
It carries shown-red cases, including a scratch-*looking* name that was never rooted at `tmpdir()`.

## ⛔ `TOOL-19` — Docker's ENGINE is wedged, and three runs bounded the wrong layer

Runs 44, 45 and 46 each recorded `docker ps` hanging and concluded the **CLI** was the problem; run 44 added
`spawnSync`-level bounds on that basis. Measured a layer down this run: `//./pipe/docker_engine` **accepts a
connection** — the daemon is listening and the pipe exists — but `GET /v1.43/containers/json?all=1` returns
**nothing in 15 000 ms, then `ECONNRESET`**. The CLI is not slow; it is **blocked on an engine that never answers**,
and no client-side bound repairs that — it only makes the client give up sooner.

`dockerd` and `com.docker.service` are resident, alongside **11 orphaned `docker` CLI processes dated Aug 10–12** and
**5 `docker-ai` processes** (newest 2026-08-13 02:06 — notable, since this project's standing configuration records
`EnableDockerAI=false`).

**This is an operator action, not a story.** Restart the Docker engine; the 11 orphans should be reaped with it.
Until then **Step −1's "just rebuild the local stack" is not executable on this host**, and everything parked behind
"settle the database" stays blocked for an **8th consecutive run**.

Two cheap standing checks, so nobody re-measures the CLI: `127.0.0.1:5433` refuses in **5 ms**; the named-pipe probe
above distinguishes *no stack* from *no engine*.

## ▶ Recommended next story

1. **`TOOL-16(b)` — confirm or refute that the gate is now reproducible (P1, cheap, no database).** One of its two
   named causes is gone. Do not close it on this run's two agreeing runs alone: run the no-flag gate twice on an
   unrelated code diff and see whether they still agree. If they do, close it with the evidence; if they do not, the
   *second* cause is now isolated by construction, which is worth more than a guess. **This is the highest-value
   next slice precisely because it is a measurement, not a repair.**
2. **Populate the skipped-count baselines (operator, one command each).** Both ratchets still print
   `⚠ this baseline records no skipped counts. The skip ratchet is INACTIVE`. `TOOL-13` shipped it disarmed on
   purpose. From a **COMPLETE** run: `node scripts/test-ratchet.js api --update` and `… worker --update`.
   **Never hand-write those numbers** — and note `feedback-shell-backticks-execute-docs`: writing that command into
   markdown via `node -e "…"` in double quotes has **executed** it once already and mutated the baseline.
3. **`TOOL-17(b)`'s three residuals (P2, no database)** — the sixth walked-read victim at
   `apps/api/src/shared/audit/write-audit.spec.ts:416`; the FR-4 named-path leak (`MAP.get('<literal>') ?? ''` served
   from a tolerant map turns a skipped **named** file into `''`); and the shared `MAX_VANISHED_FILES = 5` applied to
   `portal-landing-gate`'s **10-file** corpus. All three are now *less* likely to fire — the writers are gone — which
   is an argument for doing them while they are cheap, not for dropping them.
4. **`S-E01-2b` (RLS)** — blocked for the **8th** run running, now with a named cause (`TOOL-19`) rather than "docker
   is slow". It writes migrations, so `schema drift` will not be skipped, and it needs a reachable PostgreSQL on
   `127.0.0.1:5433`. **Unblocked the moment an operator restarts the Docker engine** — at which point it, `TOOL-13`'s
   drift-gate half, and the never-executed live-PostgreSQL path of `TOOL-10`'s preflight all become available in one
   motion.

## State of the world at the end of run 47

- **`pnpm --filter @pilotage/api exec nest build` — the run's single build.** Verified by its **artefact**, not by
  `$?`: `apps/api/dist/main.js` was rewritten 12 s before the check. The first attempt read the exit code through a
  pipe, which reports `tail`'s status — **`R-23` committed by the routine itself**, caught and re-measured. `R-23`
  is about pipes and compound commands, and it is easy to commit while quoting it.
- **No Docker was started and no container was rebuilt** — see `TOOL-19`: on this host it is not currently possible.
  Nothing in this slice needed one (every fixture is a `mkdtempSync(tmpdir())` scratch tree). The stack's health is
  **unknown**, unchanged from runs 45 and 46. Do not assume it is healthy.
- **The api denominator moved 2532 → 2555** (+23), all of it the new hermetic-writers ratchet. `11 failing · 11
  known` in both runs, no drift.
- **`INFLIGHT` was 1 at Step 0** — PR #234, a docs-only correction to this file, was open and untouched by this run.
- Two ledger repairs made at land: the two closed `TOOL` rows were **moved** from `OPEN.md` to `CLOSED-L0.md`, which
  is `OPEN.md`'s own stated discipline and had not been done for them; and **`TOOL-19` was declared in both ledgers
  in the same commit that measured it** (the `TOOL-01`/`TOOL-05` id-allocation discipline). Note the standing
  convention drift: `TOOL-03…07` live in `audit-findings-index.md`'s register, `TOOL-08…18` only in `OPEN.md`.
  `TOOL-19` is in both.


---

## (previous NEXT, run 46 and earlier — kept for content)

# NEXT — written by run 46 (`TOOL-17`), 2026-08-13 — **this section supersedes every section below**

## ✅ Closed by run 46 — a vanishing probe file no longer takes an unrelated suite down at LOAD

`TOOL-17`'s **walked-read half** is closed. All five spec-side walkers now go through one seam,
`scripts/lib/walk-read.js`, which tolerates exactly one thing: a path that `walk()` listed and that is **confirmed
absent** when re-checked. Any other errno rethrows the original object unwrapped; an `ENOENT` on a path that is
**present again** rethrows too; only then is the path recorded as skipped.

**Two things that were nearly shipped wrong, and are worth carrying forward:**

- **The floors were guarding the wrong quantity.** Every existing floor asserts on the walk **list**
  (`WEB_SRC_FILES.length >= 300`, `API_FILES.length >= 200`, `WRITER_FILES.length >= 120`), but a tolerated skip
  shrinks the **map**. So the obvious `AC-4` — "keep the floors" — would have passed with 250 files skipped and a
  corpus that was effectively empty. Each floor is now an accounting identity (`map.size + skipped.length ===
  list.length`) plus a cap of `MAX_VANISHED_FILES = 5`, which transports the walk floor onto the read map. The cap is
  deliberately **not** `toBe(0)`: that would merely move the flake from load time to assert time.
- **WALKED paths and NAMED paths had to be split.** In `audit-vocabulary-gate.spec.ts`, `SEED_PATH` is a fixed
  constant, so it keeps its bare `readFileSync` and keeps failing at LOAD. A missing seed is the *missing-file* seam,
  not the *vanishing-walked-file* seam. Every deliberate unguarded `require()` at the top of these specs is untouched
  for the same reason.

The helper landed at `scripts/lib/walk-read.js` — **not** where the story spec first mandated. `apps/api/src/**` would
have made it an input to three of the five gates it repairs, and `apps/api/test/` would have been a new top-level
directory with no precedent (an ADR-shaped decision). `scripts/lib/ratchet-core.js` is the standing precedent: same
shape, same computed `require(join(REPO_ROOT, …))`, landed in #231. The story doc records the correction rather than
pretending it always said so.

## ⛔ `TOOL-18` — the same race lives in the CHECK SCRIPTS, and it is why the gate is STILL not reproducible

**Measured by this run's own gate, twice, on one unchanged tree** (`ci/2026-08-13-v3-e02-tool17`):

| Gate run | Verdict | api ratchet |
|---|---|---|
| 1 | **`GATE: FAIL (1 stage)`** | `2514/2532 · 13 failing · 11 known` — 2 NEW: `link-integrity-gate::the CLI verdict is the classifier verdict`, `csv-escape-gate::AC-7` |
| 2 | **`GATE: PASS (fast)`** | `2516/2532 · 11 failing · 11 known` — **no drift** |

**The denominator is 2532 in both runs**, so nothing stopped running and exactly two tests flipped. Both specs pass
**228/228 standalone**. Neither is in run 46's diff.

`scripts/link-integrity-check.js:1060-1061` walks `apps/web/src` and reads each file with a **bare `readFileSync` and
no `try`** — and `apps/web/src/lib/__csv_escape_probe.tsx` is planted and deleted inside that root by
`csv-escape-gate.spec.ts:493`. The CLI dies on an uncaught `ENOENT` and prints a stack trace instead of its verdict
line; `link-integrity-gate.spec.ts:1899-1900` then compares that CLI's exit status against an **in-process**
`classifyAll` that read the tree at a **different instant**.

**Do NOT "fix" this by routing the check scripts through `scripts/lib/walk-read.js`.** That module's own docblock
argues the divergence: a check script **is** the verdict, it runs once and alone, and an input it cannot read is a
verdict it cannot pronounce — tolerating the vanish there is `DNC-08` proper. The correct repair is **hermetic
writers (`TOOL-15`)**: stop planting probes in the shared checkout at all. `TOOL-18` is the second independent piece
of evidence that this design call has to be taken.

## ▶ Recommended next story

1. **`TOOL-15` + `TOOL-18` together (P1)** — the hermetic-writer decision. It is now blocking measurably rather than
   theoretically: it is the sole remaining reason `AUTO-LAND` cannot discharge `green` from a single gate run. Settle
   the contract question first (scratch-tree copy vs. serialising the two writer specs vs. a rule-scoped AC-7) — that
   is an `open-decisions.md` entry, not a side effect of a slice.
2. **Populate the skipped-count baselines.** Both ratchets printed `⚠ this baseline records no skipped counts. The
   skip ratchet is INACTIVE`. `TOOL-13` shipped the mechanism disarmed **on purpose**; it stays disarmed until an
   operator runs, from a COMPLETE run, `node scripts/test-ratchet.js api --update` and `… worker --update`. Had it
   been armed, it would have spoken to the run-1/run-2 divergence directly. **Never hand-write those numbers.**
3. **`S-E01-2b` (RLS)** — still blocked on the same precondition for the seventh run running: it writes migrations, so
   `schema drift` will not be skipped, and it needs a reachable PostgreSQL on `127.0.0.1:5433`.

## State of the world at the end of run 46

- **The gate can pass, and it can fail, on the same tree.** Run the gate **twice** before concluding anything about a
  gate-machinery diff.
- **Correction to this file as first written (run 46).** It claimed run 1 "printed `GATE: FAIL` and exited 0", offered
  as a fresh instance of `R-23`. **That was wrong, and the error was the author's, not the gate's:** `ci-gate.sh`
  exited **1**, correctly matching its printed verdict (`EXIT_RUN1=1`). The `exit code 0` that prompted the claim came
  from the harness reporting the *compound* command `bash scripts/ci-gate.sh; echo "EXIT_RUN1=$?"` — i.e. the trailing
  `echo`'s status, not the gate's. **`R-23` still stands and is still load-bearing** — `bash scripts/ci-gate.sh | tail`
  reports `tail`'s status, so read the printed `GATE:` line — but it stands on the pipeline case, which is real, not on
  this one, which was a measurement error. Left in rather than deleted: an artefact that quietly drops a wrong claim
  teaches the next run nothing, and this is the exact shape of `feedback-false-red-evidence` — the assertion was mine,
  and the tool was behaving correctly all along.
- **No Docker was started and no container was rebuilt.** Nothing in this slice needed a running artefact — the AC-5/
  AC-6 fixture is a `mkdtempSync(tmpdir())` scratch tree. The stack was **not** touched, so its health is unknown and
  unchanged from run 45's report (`docker ps` unresponsive, orphaned CLI processes dated Aug 10). Do not assume it is
  healthy; check before any story that needs it.
- **`pnpm --filter @pilotage/api build` — exit 0.** That was the run's single build.
- **The two held PRs that wedged the routine are gone** — the operator merged #231 and closed #232 before this run, and
  the gate's cleanup reaped both `ci/` branches. `INFLIGHT` was 0 at Step 0.


---

## (previous NEXT, run 45 and earlier — kept for content)

# NEXT — written by run 45 (`TOOL-13`), 2026-08-12 — **this section supersedes the three track sections below**

> The per-track NEXT files below are the pre-revert state, kept for their content. Read **this** section first.

## ✅ Closed by run 45 — the ratchet can no longer certify a check it did not perform

`TOOL-13`, `TOOL-16(a)`, `TOOL-11`, `TOOL-12` are **closed**. The decision layer is now `scripts/lib/ratchet-core.js`
(pure), the baseline carries per-suite not-executed counts, a rise fails, a fall is reported loudly, and a baseline
with no `skipped` block prints `INACTIVE` **and qualifies its verdict line**. The PR was left **OPEN** — see below.

**The one thing an operator must do:** the skip baseline ships **deliberately empty**. It may only be written from a
complete run, which this slice was forbidden to produce. Until then the ratchet is honest but disarmed:

```
node scripts/test-ratchet.js api --update      # from a COMPLETE run, never under --skip
node scripts/test-ratchet.js worker --update
```

Do **not** hand-write numbers into `scripts/known-test-failures.json`. A fabricated count makes the gate look armed,
which is the exact failure this story exists to remove.

## ⛔ Read before trusting any gate verdict — now with a mechanism, not just a warning

Run 44 recorded that three gate runs on one tree gave three failure sets. **Run 45 found why: `TOOL-17`.**

Specs write probe files **into the real working checkout** (`__audit_write_probe.ts`, `__csv_escape_probe.tsx`), and
other specs `walk()` those directories and then `readFileSync` each entry. Under parallel jest the probe is deleted
between the walk and the read, so the *reader* fails to LOAD. Measured twice on one unchanged tree, two different
victims:

| Run | Suite that failed to load | Missing probe | Written by |
|---|---|---|---|
| 1 | `audit-vocabulary-gate.spec.ts` | `__audit_write_probe.ts` | `audit-write-gate.spec.ts:689` |
| 2 | `portal-landing-gate.spec.ts` | `__csv_escape_probe.tsx` | `csv-escape-gate.spec.ts` (TOOL-15's own probe) |

`audit-vocabulary-gate.spec.ts` passes **73/73 alone** and the two racing specs pass **149/149 together** — the window
only opens under the full parallel suite, which is why it has read as flake for four runs. **The victims are
innocent**: both scanners do the correct thing. The writers are the defect.

Fix direction, cheapest first: make the walkers tolerate a file that vanishes between `walk` and `read` (two lines,
fixes every current and future victim), or probe in a scratch tree (the hermetic repair `TOOL-15` is parked on).
**`TOOL-17` is now the highest-value gate-machinery slice** — it is what stops `AUTO-LAND`'s `green` from being
dischargeable at all for this class of diff.

## ▶ Recommended next story

1. **`TOOL-17` (P1, `blockedBy` empty)** — the probe-file race. Cheap, mechanical, needs no database, and it unblocks
   every future auto-merge decision. Take the tolerate-a-vanishing-file half even if the hermetic half stays a design
   call in `open-decisions.md`.
2. **`S-E01-2b` (RLS)** — still blocked on the same precondition for the sixth run running: it writes migrations, so
   `schema drift` will **not** be skipped, and it needs a reachable PostgreSQL on `127.0.0.1:5433`.
3. **`TOOL-13`'s drift-gate half** — also database-blocked, for the same reason.

## State of the world at the end of run 45

- **Still no reachable project PostgreSQL**: `127.0.0.1:5433` → `ECONNREFUSED` in **30 ms** (measured this run).
- **Docker's control plane is unresponsive**: `docker ps` produced **no output in 12 minutes**, and the orphaned
  docker CLI processes dated Aug 10 are still resident. **No rebuild was attempted, deliberately** — this slice's
  AC-4 required database-free evidence, so a rebuild would have bought nothing and Step −1 asks for one only when the
  evidence needs it. Settling Docker is a prerequisite for items 2 and 3, not for item 1.
- **`main` moved twice mid-run** (#229 and #230 landed while the sprint was working). The branch was rebased onto it
  cleanly. Check `origin/main` before assuming your base is current — the gate's `ensure_clean_main` runs once, at
  Step 0, and the sprint outlives it.
- **The sprint's own verify phase graded the wrong tree.** It ran before the implementer wrote anything, reported the
  diff as "+27 doc lines", and returned a typecheck that described a docs-only tree. Its blocker was correct *at the
  time* and the fix phase then implemented the story. Do not inherit a sprint's typecheck number — re-measure it.

## (was NEXT-a.md)

# NEXT — track **a** (foundation) — written by run 44 (`TOOL-10`), 2026-08-12

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the
> decision from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.
>
> Track a owns `apps/api/prisma/**`, `apps/api/src/shared/prisma/**`, `apps/api/src/modules/analytics/**` and
> `apps/api/src/modules/school-structure/**` (`tracks.md`), i.e. epics **`V3-E01`** (tenancy) and **`V3-E03`**
> (canonical truth). `scripts/**` and `apps/api/src/shared/quality/**` are **shared** paths — claimable, declared in
> the PR body, kept minimal. Track a has now taken three gate-machinery slices in a row (`TOOL-06/07/08`, `TOOL-10`);
> that is precedent, not ownership.

---

## ✅ Closed by run 44 — the gate can now finish on a machine with no database

**`TOOL-10` is closed.** The drift check reaches its verdict in **825 ms** instead of never. What run 43 recorded as
89 745 ms had degraded further by this run: `node scripts/schema-drift-check.js` was killed at **>4 minutes** still on
its first `SELECT 1`, and `ps -W` listed **nine** orphaned `docker` processes dated **Aug 10** — bash `timeout` does
not kill the docker CLI on this platform, so route C's cost was *unbounded*, not 90 s.

The fix is the preflight the finding asked for, plus a `spawnSync`-level bound (which *does* kill on Windows, because
libuv maps it to `TerminateProcess`). `ci-gate.sh` is byte-identical — raising the bound was tried once already
(`2bd1a25`) and is not the fix.

**Two things worth carrying forward, and neither is about this script:**

- **Three states, not two.** The preflight distinguishes `refused` from `indeterminate`, and only `ECONNREFUSED` from
  every resolved address may stop the ladder. The review panel built the obvious simplification — `!pre.open` at the
  two call sites — and it left **all 123 other cases green** while making the gate permanently red on any machine
  whose probe cannot answer in 2 s. Measured both directions before trusting the new case: the short-circuit
  narration appears **0** times on correct code and **2** under the mutant, **with the verdict identical in both**.
  That identity is exactly why nothing else could see it. When a change makes a control cheaper, the test that earns
  its keep is the one that fails on the cheaper-still version you did not write.
- **A bound is not a safeguard if it is the wrong size.** `docker port` (metadata) and `docker exec … psql` (which
  carries `CREATE DATABASE` / `DROP DATABASE`) started with one number. A control-plane bound on the data plane kills
  a legitimate `CREATE` on a cold Docker Desktop and reports `scratch_create_failed` **on correct code** — and
  `run()`'s bound does not kill grandchildren, so the orphaned scratch database survives it. They now carry different
  numbers, and the spec pins that they differ.

---

## ▶ Next story → `TOOL-13` — a suite that stops existing must not read as green

| | |
|---|---|
| **Story** | `TOOL-13` *(no story file; the contract is its row in `OPEN.md` + this section)* |
| **Epic** | `V3-E02` |
| **Layer** | **L0** |
| **Size** | **S/M** |
| **Gates** | `G-DNC` |
| **blockedBy** | **empty** — and that is why it is selected over `S-E01-2b`, which is not |

### The finding, verified by reading the code rather than by inference

`schema-drift-gate.spec.ts:829` reads `const describeWithDb = reachable ? describe : describe.skip`. When no database
answers, the whole end-to-end block — **including the case named *"the unmodified repository PASSES — the gate is not
red on correct code"*** — becomes `describe.skip`.

`scripts/test-ratchet.js` cannot see that. Re-measured this run by reading it: it builds `failing` from
`t.status === 'failed'` (`:195`) and one `<suite failed to load>` sentinel (`:200`), compares that set against a
baseline of **failures**, and never looks at a count. A test that stops existing is not a failure, so it is not in the
set, so the ratchet reports **GREEN**.

That is the one direction a gate may never fail in, and it is **pre-existing** — `TOOL-10` did not introduce it. But
`TOOL-10` put a preflight *upstream* of `probeServer()`, so the blast radius is now one wrong `refused` away, which is
why it is next rather than someday.

### Acceptance, as it stands today

1. `test-ratchet.js` records a per-suite (or per-app) **skipped/pending count** in the baseline alongside failures, and
   **fails** when it rises. A disappearing case becomes a red like any other.
2. `--update` must rewrite that count only from a **complete** run — the file already refuses `--update` combined with
   `--skip` (`:68-73`) for exactly this class of reason; extend that rule, do not weaken it.
3. Baseline entries under a `--skip` path already "did not run" (`:222`) and are held out of the drift comparison.
   Skipped-count accounting must not collide with that: a path deliberately skipped by the gate's own tiering is not
   the same event as a suite that skipped itself.
4. Prove it with a fixture, not with the drift gate: the drift gate's own skip depends on a database this machine does
   not have, and a test that can only run where the bug cannot is not evidence.

**The fix does not need a database.** Only closing `TOOL-13`'s *drift-gate-specific* half does — see below.

---

> **Batch `TOOL-16(a)` with it.** Same file, same seam, same sentence: `scripts/test-ratchet.js:200` synthesises
> `<suite failed to load>` and throws away the jest report's `failureMessage`, so an operator gets a symptom and no
> cause — the adjacent branch of the very function `TOOL-10` half B just taught to say what happened. It is
> mechanical, and it should land **before** anyone tries to debug `TOOL-16(b)`, because (b) cannot be diagnosed
> without it.

---

## ⚠️ Read before trusting any gate verdict on a gate-machinery diff

`TOOL-16`: **three consecutive `ci-gate.sh` runs on run 44's unchanged branch produced three different failure
sets** — AC-5/AC-15 (real, repaired as `TOOL-14`), then `csv-escape-gate` AC-7 (`TOOL-15`), then two suites failing to
load with the denominator dropping `2433 → 2219`. **214 tests stopped running and the ratchet said nothing**, because
it ratchets failures and not counts — `TOOL-13`, demonstrated rather than argued.

So: a red on a gate-machinery diff is **not** evidence about that diff until it is reproduced, and `AUTO-LAND`'s
`green` condition currently cannot be discharged for this class of diff at all. Run the gate **twice** before
concluding anything, and read the *names* of the `✗` stages rather than the verdict line. This is the standing
`ci-gate.sh` habit, sharpened: it is no longer only that `main` moves under you, it is that the same tree answers
differently.

Two environment facts to check first, both recorded as hypotheses and **neither measured to cause**: this host runs
**Node v25.7.0** against the `.nvmrc` pin of **22.13.1** (GUARDRAILS §3 — "Node ≥ 23 breaks the local run"), and run
3's ratchet began seconds after `prisma generate` rewrote `@prisma/client` while `typecheck` and `lint` were served
from cache.

---

## Alternatives, in selection order

- **`TOOL-11` (P2)** — `exec()`'s cross-server guard throws from a path reached by a `finally` and by the signal
  handlers, so a future caller could end a run with **no verdict at all**: `DNC-08` committed by the anti-`DNC-08`
  machinery. Unreachable today (checked, not assumed: `deriveMaintenanceUrl` / `buildScratchUrl` vary only the
  database segment, and a spec pins the latter). One-line repair — `return { ok: false, detail: … }` — plus a case
  that drives the cleanup path. Cheap enough to **batch with `TOOL-13`**: same seam, same file family.
- **`TOOL-12` (P2)** — routes A and B still carry no spawn bound. Measured: `run('docker'` → 2 sites both bounded,
  `run('psql'` → 1 unbounded, `run(cli.command` → 1 unbounded. It does not bite here only because `psql` is `ENOENT`
  on Windows; on `ubuntu-latest`, where `ci.yml` runs, a client ships and the OS TCP timeout is ~130 s. So the
  `refused` path is bounded everywhere and the `indeterminate` path is bounded only on this machine. Also batchable.
- **`S-E01-2b`** — the RLS half. **Still blocked on the same precondition, for the fifth run running:** it writes
  migrations, so `schema drift` will *not* be skipped and it needs a reachable PostgreSQL on `127.0.0.1:5433`. Run
  40's brief for it is intact and was right in every particular — `FORCE ROW LEVEL SECURITY` (the app role owns the
  tables and an owner bypasses RLS), `current_setting(…, true)` with `missing_ok`, cast rather than compare as text,
  an index on every tenant predicate before enabling, and narrowing `fn` to `Prisma.TransactionClient`. Read
  `docs/daily-improvement-v3/` git history for run 40's version of this file rather than re-deriving it.

---

## State of the world at the end of run 44

- **There is still no reachable project PostgreSQL.** `127.0.0.1:5433` refuses connections (`ECONNREFUSED`, measured
  in 276-288 ms by the new preflight — which is at least now a *cheap* way to find out). Something unrelated answers
  on 5432; do not mistake it for the stack.
- **Docker is worse than run 43 recorded.** `docker ps` hangs past 150 s, `timeout` does not kill it, and **nine**
  orphaned `docker` CLI processes dated **Aug 10** are resident. `docker exec` reportedly still works. No rebuild was
  attempted and no container was started — nothing in `TOOL-10` needed one, and `TOOL-13` does not either.
- **The database is now the single blocker on the highest-value remaining track-a work.** It gates `S-E01-2b`,
  `TOOL-13`'s second half, and the one manual check this slice could not discharge: **the ladder has never run
  against a live PostgreSQL since the preflight landed.** If the preflight ever answered `refused` on a healthy
  server, the end-to-end block would vanish and the ratchet would say green. The unit case with a real
  `net.createServer()` listener proves `open` works on a live socket, which is as far as this machine can go.
  **Settling the database discharges all three in one motion — do it before planning, not during.**
- `TOOL-09` (P3, `runtime engines` runs only under `--full`) remains deliberately not storified: widening the fast
  tier's contract is an `open-decisions.md` call, not a repair.

## (was NEXT-b.md)

# NEXT — track **b** (authz & audit) · written by run 41 (`S-E05-7`), 2026-08-12

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the decision
> from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.
>
> Track b's seam (`tracks.md`): `apps/api/src/shared/auth/**` · `apps/api/src/modules/identity/**` ·
> `apps/api/src/modules/audit/**` · guards, DTOs and permission code in other `apps/api` modules.

## ▶ Next story → `S-E05-2b` — the fifth grant path (`PF-09` residual)

| | |
|---|---|
| **Story** | close the **`realmRole` invite channel** — the one grant path `S-E05-2`'s privilege ceiling does **not** cover |
| **Epic** | `V3-E05` |
| **Layer** | **L0** |
| **Size** | **M** |
| **Gates** | `G-AUTHZ`, `G-AUDIT`, `G-DNC` |
| **blockedBy** | ⚠️ **`D-12`, a human product call in `open-decisions.md`** — read the caveat below before selecting |

**Why it ranks first.** It is the epic's only remaining **live escalation path**. `S-E05-2` (run 39) put a privilege
ceiling on four of five grant channels — `roles.controller` create + update, `users.service.assignRole`, and
`invite.controller`'s `customRoleSlug` — and left `realmRole` invite provisioning unceilinged **by decision**, because a
naive subset ceiling there would refuse an ordinary "invite a teacher". So the escalation `S-E05-2` closed reproduces
**one email later**, and `PF-09` is recorded as *narrowed to 4 of 5 channels, not closed*.

**⚠️ Check the blocker before you commit to it.** The shape `S-E05-2` recommends is a **grantor-relative ladder**
(provision at or below your own level) rather than a subset ceiling, and that is the §2.4 option-2 delegation question
which needs its own `ADR-015` entry — i.e. it plausibly still needs **`D-12`**. **Read `open-decisions.md` first.** If
`D-12` is still unresolved, this story is **not selectable** (Step 1: never select a story with an unresolved
`requiresDecision`) — take the alternative below instead and say so in your report.

## Alternative if `D-12` is still open → `PF-175`

`PF-175` (P2) — pre-ceiling escalated grants pass the new ceiling **unconditionally**. The detection query is recorded
in `S-E05-2`'s notes and, as of this run, **has still never been run**. Squarely in your seam, needs no decision, and it
is a genuine "prove the fix is complete" slice: `S-E05-2` bounded what can be granted *from now on* and grandfathered
whatever was already granted. This was already flagged as run 40's second candidate and was not taken then either.

## Do NOT select

- **`PF-181`** (the throttled parent faces a disabled submit button) and **`PF-174`** / **`PF-129`**'s fix — all
  `apps/web` = **track c's seam**.
- **`PF-182`(b)** — the edge `limit_req` companion lives in `infra/nginx/**`, which belongs to no track; it needs an
  operator, not this routine.
- **`PF-153`** — needs `ADR-013`. Until it lands, the unfiltered role lookup at `users.service.ts:85` **must stay
  unfiltered** and its docblock at `:67-72` must stay.
- **`PF-178`** — needs `D-12` as well.

---

## What `S-E05-7` shipped, so you do not re-derive it

**`PF-46` NARROWED (not closed).** `POST /auth/register-parent` — the product's one public mutation — now refuses above
a two-tier fixed-window admission bound applied with `@UseGuards` on **that handler only**.

- **The design decision that matters is what it does *not* key on.** This endpoint has exactly one caller repo-wide and
  it is a Next.js **server action** issuing a container-to-container `fetch`, so `req.ip` is the **web container's
  egress address — one constant value shared by every registrant on earth**. A per-IP limiter would have been a
  self-DoS, not a weak bound. Nothing in `public-endpoint-throttle.ts` reads a request address or a forwarding header.
- **Tier 1** = 5 admissions per window per `sha256` digest of the submitted email — an enumeration-**rate** bound. The
  key is caller-chosen and therefore **rotatable**; it is *not* a security bound, and the docblock says so.
  **Tier 2** = 30 admissions per window endpoint-wide — the amplification bound, and the one that actually holds.
- **Counters count admissions, not attempts**, and tier 2 is evaluated **first**. This is not a detail: if refusals fed
  the global counter, an attacker hammering one address would exhaust the endpoint-wide ceiling and convert a
  per-identity bound into a global outage.
- **The window is epoch-aligned and the sweep is a whole-map clear**, done on the first line of `admit`. Per-key lazy
  expiry was rejected for a measured reason — it only shrinks for keys touched again, so one busy window leaves the map
  permanently full, the capacity test trips, and a fail-closed limiter turns signup off forever with no attacker.
- **No dependency added** (a bump is how the **NestJS v10 pin** breaks by accident), **no `prisma/**` change** (that is
  track a), and `register.controller.ts` differs from `HEAD` by **+7 lines** — so `ADR-035` D1's one-statement
  `writeAudit` and the `persistRegisteredParent` / `compensateOrphanedKeycloakUser` split are untouched.
- **All three refusal reasons return the byte-identical 429 with no `Retry-After`.** Making a per-address refusal
  distinguishable from a global one would have rebuilt the enumeration oracle `S-E05-11` had just closed at the two 409
  branches. The tier lives in a `Logger.warn` emitted **once per tier per window**, and nowhere else.
- **No `auditLog` row per refusal, deliberately** — a refused request performs no mutation, so `G-AUDIT` does not
  trigger, and a DB write per blocked anonymous request would rebuild the exact amplification the guard removes, one
  table over. The docblock argues this so the next author does not "fix" it.
- **Ships `ADR-038`** (in-process admission bounds on pre-auth endpoints), against the story's own §5 "no ADR" — because
  D2's **single-replica invariant** is a claim an `infra/` editor can silently break, and an ADR is where they meet it.

**Two corrections this run made to the sprint's own output**, both docblock honesty, both verified before editing:
the guard claimed *"every French string on the API side is straight"* (**false** — 30 files under `apps/api/src` use
`’`, including the sibling message at `write-audit.ts:129-130`), and the throttle's RGPD justification overstated what
an **unsalted** digest of a low-entropy identifier buys. Both now state the accurate claim.

**Unratified, and a human should look:** the shipped constants (`60 s · 5 · 30 · MAX_KEYS = 2×TIER2`) differ from the
story's own §1.4 draft (`10 min · 3 · 60 · =`). The shipped values were kept — their sizing argument is written against
a real scenario (a 200-parent onboarding evening ≈ 3.3 admissions/min, so 30/min leaves ~9× burst headroom) and tier 1
is sized for a **fumbling parent**, since guards run before the pipes and every 400 spends tier-1 budget. Every spec
references the constants **symbolically**, so no gate can go red for the numbers either way.

## (was NEXT-c.md)

# NEXT — track **c** (web surface) · written by run 40 (`S-E06-8`), 2026-08-12

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the decision
> from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.
>
> Track c's seam (`tracks.md`): `apps/web/**` · `packages/ui/**` · `packages/design-tokens/**`.
>
> **This file did not exist before run 40.** Runs 38–39 wrote the un-suffixed `NEXT.md`, which is track-agnostic and
> now describes a story (`PF-173` (b), the CSV brand) that is **still track c's and still open** — see below. Do not
> delete `NEXT.md`; read it *after* this one.

## 🛑 READ FIRST — `OPEN.md` is NOT the complete open set (`TOOL-07`, raised by this run)

**Do not select a story from `OPEN.md` alone until `TOOL-07` is fixed.** The reconciler folds the inbox into the
**main checkout's working tree** and never commits it, then deletes the inbox file there — so the fold happens once,
into a checkout no track reads, and can never be redone. Nine rows filed on 2026-08-11 are absent from `origin/main`'s
`OPEN.md`, including **`PF-174` (P1)**, which is the story *this* run implemented. Run 40 found it in `NEXT-b.md`
prose, not in the ledger.

**Until it is fixed, add one step to Step 1:** `ls docs/daily-improvement-v3/traceability/inbox/` and read every file
there. That is where the newest findings actually live. Full mechanism and recovery instructions in this run's inbox
file and in `audit-findings-index.md`.

---

## ▶ Next story → `S-E06-9` — route the three `admin/roles` actions through the shared converter (`PF-179` + F2)

| | |
|---|---|
| **Story** | close **`PF-179` (P2)**, and with it `S-E06-8`'s follow-up **F2** *(no story file yet; the contract is `PF-179`'s row in this run's inbox file)* |
| **Epic** | `V3-E06` |
| **Layer** | **L0** |
| **Size** | **S** — one file, three catch blocks |
| **Gates** | `G-DNC` · `G-PORTAL` **1/1, admin-only — verify, do not assert** · `G-TENANT`, `G-AUTHZ`, `G-MIGRATION`, `G-AUDIT`, `G-TRUTH` do **not** trigger |
| **blockedBy** | **nothing** |

**What it is.** `apps/web/src/app/admin/roles/actions.ts` — none of `createRoleAction` (`:24-31`),
`updateRoleAction` (`:44-50`) or `deleteRoleAction` (`:58-64`) re-throws the Next navigation signal. `api()` calls
`redirect()` on a 401; `redirect()` throws an error whose `digest` starts `NEXT_REDIRECT;`. Their blanket `catch`
returns that digest **as data**, and `RoleBuilderForm.tsx:236` renders it — so an admin whose session expired mid-edit
is shown `NEXT_REDIRECT;replace;/admin/login…` and is **never navigated to login**.

**Why it is small and safe now.** `S-E06-8` built exactly the seam this needs: `apiResultFromError`
(`apps/web/src/lib/api-client.ts`) checks `isNextNavigationSignal` **first**, then delegates to the total
`apiErrorMessage`. All three actions already return the compatible `{ ok, error }` shape, so the change is
`catch (err) { return apiResultFromError(err); }` three times. It closes **F2** in the same pass — those three catches
are the divergent copies (`createRoleAction` handles the nested `{ message: { message } }` form, the other two do
not), and `PF-180` (`admin/settings/preferences-actions.ts`, three more actions that render `HTTP 403` and discard the
message) is the natural batch partner: **same seam, same fix, one test — batch them.**

**The trap.** `createRoleAndRedirect` (`:67-71`) calls `redirect()` *itself* on success. It must keep working: the
re-throw is what makes that possible, but check that the success path is not accidentally routed through the catch.

**Second candidate if `PF-179` is closed by other work:** `PF-173` (b) — make an unescaped CSV cell a **type error**
via a branded `CsvCell` in `apps/web/src/lib/csv.ts`. Still track c's, still open, fully described in `NEXT.md`
(run 39). It is larger (a typed API across seven call sites) and, unlike `PF-179`, has no already-built seam waiting.

---

## What `S-E06-8` shipped, so you do not re-derive it

**`PF-174`'s silence half is closed. Its menu half is refused on purpose, and the difference is the whole story.**

- **The defect was singular, and that was measured rather than assumed.** `admin/users/actions.ts` was the **only**
  `'use server'` file in the entire web surface with **zero** `catch` clauses (counted across every `'use server'`
  file in `apps/web/src`). `admin/alerts/actions.ts` funnels its six actions through one catching `callApi`;
  `admin/settings/preferences-actions.ts` uses `Promise.allSettled`. **Do not go sweeping the other action files for
  this shape — it is not there.** What *is* there is a different defect: divergent hand-rolled extraction (`PF-179`,
  `PF-180`, F2).
- **One leaf module, importing nothing: `apps/web/src/lib/api-error-message.ts`.** That emptiness is the design, not
  tidiness. `api-client.ts` imports `next/headers` and `@/auth`; a **value** import of it from a `'use client'` file
  drags them into the browser graph and breaks `next build` — that is **`PF-133`**, and neither `tsc` nor `eslint`
  can see the edge. Two non-fixes are recorded in the docblock so nobody retries them: a **re-export** from
  `api-client.ts` does not help (the *import specifier* decides the graph, not the symbol), and `await import()` only
  moves the break out of the bundler's view.
- **`ApiError` now lives in the leaf and is re-exported from `api-client.ts`.** ~30 existing server callers and
  `instanceof` identity are untouched. Necessary because `apiErrorMessage` narrows by `instanceof`.
- **The extractor is total by `typeof`/`Array.isArray`/`in`, with no `as`.** That converts
  `privilege-ceiling.ts:147-152`'s *written plea* that its `message` "MUST stay a string" into a structural
  impossibility on the web side — a plea the API could not enforce, since `new ForbiddenException(obj)` accepts any
  object.
- **`AC-4` — the role menu is deliberately NOT pre-filtered**, and there is a comment at the menu saying so. Which
  roles a `school_admin` may grant is the open decision **`D-12` / `PF-178`**. **`DNC-09` is narrowed, not
  discharged.** If you are tempted to hide the failing options: that is the decision, not the fix.

## Findings this run

| Id | Pri | What |
|---|---|---|
| **`PF-174`** | **P1** | **Narrowed, not closed.** Silence half closed with evidence; menu half re-pointed at `D-12`. |
| **`TOOL-07`** | **P1** | **The reconciler never publishes its fold.** Read the banner at the top of this file. |
| **`TOOL-06`** | **P1** | **Escalated, not raised.** Its severity clause is wrong: on a code diff the seven broken stages **are** counted, so `GATE: PASS` is unreachable for any non-docs-only PR. See fact 2. |
| **`PF-179`** | **P2** | `admin/roles` actions render `NEXT_REDIRECT;…` instead of redirecting. **Next story.** |
| **`PF-180`** | **P3** | `preferences-actions.ts` renders `HTTP 403` and discards the API's message. |

All three new ids are declared in `audit-findings-index.md` in the same commit that raised them (`TOOL-01` applied
prospectively), and were allocated **after** a fresh `git fetch` per `TOOL-05` — `origin/main` was `c8ee4f3`
throughout run 40, so no concurrent track could have taken them.

## ⚠️ Facts for your next run

1. **A normal run does not build, and this one did not.** No `pnpm build`, no build slot taken, no Docker rebuild.
   The stack was **not** touched: `docker ps` did **not return within 120 s** at the start of run 40, so the daemon
   is slow or wedged. Nothing in this slice needed it — but **do not assume the stack is healthy**; check before any
   story that does, and budget for the daemon being unresponsive.
2. **🛑 `TOOL-06` means your PR CANNOT reach `GATE: PASS` — budget for it, do not debug your diff.** Run 40 measured
   the first full-code gate since that finding was raised: **every real stage passed** (`typecheck`, `lint`,
   `test:api` 1008/1019 no drift, `test:worker` 293/300 no drift, `audit writes`, `production artefacts`,
   `prisma generate`) and the verdict was still **`GATE: FAIL (7 stage(s))`** — the seven being exactly the
   `run_stage` calls that omit their timeout argument. `TOOL-06`'s text says those stages are *not* counted; that is
   true on a **docs-only** diff and **false on a code diff**. So `AUTO-LAND` is effectively off for every code change
   on all three tracks until someone repairs `scripts/ci-gate.sh`. **Do not go hunting in your own diff** — read the
   summary block, and if the only `✗` lines are `✗ node`/`✗ pnpm`, that is this. Report the per-stage results as your
   evidence and leave the PR open, as runs 39 and 40 both did.
3. **`TOOL-04` is live and it shapes what you may touch.** Any diff matching
   `^(scripts/|\.github/|infra/|apps/api/src/shared/quality/)` escalates the gate to an api suite that **cannot
   finish on this machine**. Run 40 deliberately did **not** add a web-side server-action ratchet under `scripts/`
   for exactly this reason — the right control, unbuildable without forfeiting `GATE: PASS`. It stays a follow-up
   until the gate is repaired.
4. **`apps/web` has no unit runner — verified this run, not inherited.** `apps/web/package.json` declares only
   `test:e2e*` Playwright scripts, and neither `jest` nor `vitest` is a devDependency. `pnpm typecheck` is genuine
   evidence for a type-level claim and is **not** evidence that anything rendered.
5. **The Turbo cache is shared across track worktrees.** A gate log will print `cache hit, replaying logs` with a
   path under **another track's** worktree (run 40 saw `v3-track-a` paths while running in `v3-track-c`). That is
   correct behaviour for identical inputs, not a leak — do not debug it.
6. **Disk: 22 GB free on `C:` (96 % used)**, down from run 39's 31 GB. Not an emergency, not comfortable. The
   worktree residue in `.claude/worktrees/` is still uncleaned; see run 38's `NEXT.md` for the list and the three
   tests to apply.

---

cleanup-pending: `C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\` residue — unchanged by run 40.
**New and more urgent:** the uncommitted 2026-08-11 ledger fold in `C:\Users\HP\Downloads\pilotage-scolaire-claude`
(`TOOL-07`). Commit it before any `git checkout .` or salvage-stash in the main checkout discards it.

