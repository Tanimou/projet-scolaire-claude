# ADR-045 — The adversarial tenant suite: a second prover, its teardown, its anti-vacuity device, its mutant, and what its green may say

- **Status**: accepted
- **Date**: 2026-08-14
- **Story**: `S-E01-3` / `VAL-02` (epic `V3-E01`, advances `PF-02`)
- **Extends**: `ADR-032` §D5–§D8, `ADR-042`, `ADR-027`. **Supersedes nothing.**
- **Artefacts**: `scripts/tenant-adversarial-check.js`,
  `apps/api/src/shared/quality/tenant-adversarial-gate.spec.ts`,
  `scripts/ci-gate.sh` (stage `tenant adversarial`), `.github/workflows/ci.yml`

> **Why `045` and not `044`.** `ADR-044-outbox-denormalised-tenant.md` was claimed
> by `S-E01-2d` while that branch was still open; it has since **merged** (`e53f2d9`,
> PR #247), so `ADR-044` is on `main` and `045` is the right number — but for the
> **opposite reason** to the one first written here, which asserted the branch was
> unmerged. The failure mode it guards against is real and unchanged: allocation
> reads `main`, not open PRs (`project_parallel_runs_collide_on_ids`). The claim is
> now closed by a check rather than by a sentence — the guard spec asserts that
> **both** `044` and `045` exist in `docs/adr/`.

## Context

`scripts/rls-isolation-check.js` (S-E01-2b/2c/2d) proves the `tenant_isolation`
policies EXIST, agree with the catalog, and DENY — on `school`, the five
FK-derived tables and `outbox_event`. That is **depth on a sample**.

`S-E01-1` switches `DATABASE_URL` from the owner `pilotage` to the non-owner
`app_user`. If a single policy is wrong, every portal returns zero rows. The
evidence that must exist before that cutover is **breadth**: every tenant-bearing
table, enumerated from the live catalog, four verbs, both directions, with the
positive control asserted first.

Building that raised four decisions that no existing convention covers closely
enough to ship silently, plus one that is really a rule about wording.

---

## D1 — A second prover coexists with `rls-isolation-check.js`, with duplicated fixtures and no shared fixture module

**Decision.** `scripts/tenant-adversarial-check.js` is a separate executable with
its own scratch database, its own fixture builder, its own tenant ids and its own
scratch-name pattern. It **`require()`s** the sibling for pure constants and pure
functions (`TENANT_GUC`, `POLICY_NAME`, `MIN_EXPECTED_TABLES`,
`VERDICT_EXIT_CODES`, `DERIVED_TABLES`, `NON_DERIVED_EXPECTED`, `OUTBOX_TABLE`,
`fid`, `lit`, `redact`, `isLoopbackHost`, `migrationFiles`) and **never edits it**.

**Why it cannot be silent.** The duplication is *forced*, not chosen: S-E01-3's
hard constraint 2 forbids editing the sibling, so there is no seam to extract a
shared `scripts/lib/tenant-fixtures.js` into, and `rls-isolation-check.js` was in
flight on another branch (`+370` lines) while this was written. Recorded here so
that the next reader does not "fix" the duplication by editing a file mid-flight.

**Consequence / follow-up.** When hard constraint 2 lifts and the in-flight
branches have landed, extract `scripts/lib/tenant-fixtures.js` and have both
checks consume it. Until then, two literals for one GUC name would be the drift
`ADR-042` §D3 exists to forbid — hence the `require()` rather than re-typing.

**Also decided here:** the two scratch-name patterns are deliberately different
(`^rls_isolation_\d+_\d+$` vs `^tenant_adversarial_\d+_\d+$`) so that neither
check can ever drop the other's database when both run concurrently.

---

## D2 — Teardown is a bounded quiesce poll, never a privilege escalation

**Decision.** After the last `app_user` statement — every `psql` child is a
`spawnSync` that has fully exited, and this suite opens no pooled or long-lived
connection and holds no handle across the drop — the **owner** polls
`pg_stat_activity` for the scratch database, bounded at 50 attempts with a 100 ms
`pg_sleep`, until no backend remains. Only then does it
`DROP DATABASE IF EXISTS … WITH (FORCE)`. A poll that exhausts is a **FAILURE**
naming the surviving `usename#pid` pairs — never a skip, never a swallowed error.

**Forbidden, each a reviewable line, each mechanised as a forbidden string in the
guard spec:** `GRANT pg_signal_backend TO pilotage`; `ALTER ROLE pilotage
SUPERUSER`; connecting as `postgres` to force the drop; making the drop's failure
non-fatal; copying the terminate-then-retry branch of `rls-isolation-check.js`.

**Why it cannot be silent — it DIVERGES from the sibling, on a measurement.**
`rls-isolation-check.js:1650` retries a failed drop by calling
`pg_terminate_backend()` as `pilotage`. Measured live on this cluster with an
`app_user` session held open:

```
pilotage|super=false|bypassrls=false|createrole=false   -- and ZERO role memberships
SEEN|app_user|pid=191272|db=pilotage                     -- pilotage CAN see the backend
ERROR:  must be a member of the role whose process is being terminated
        or member of pg_signal_backend                   -- but CANNOT kill it
```

That retry is therefore a **no-op for exactly the case it was written for**, and
`WITH (FORCE)` fails through the same `TerminateOtherDBBackends` privilege check.
Two sibling scripts tearing down differently is drift unless the divergence is
recorded with its evidence. Also measured, and what makes the poll possible with
no privilege at all: `pilotage` *can* read `usename`, `pid` and `datname` from
`pg_stat_activity` for `app_user` backends (masking only nulls the query/state
columns).

`WITH (FORCE)` is kept **after** the poll as a belt, not as the mechanism: the
poll is what makes the drop safe, and the flag is what makes a lost race loud
rather than long.

**Verified:** three consecutive runs, byte-identical output modulo the generated
scratch name, exit 0, and a catalog query afterwards showing zero leftover scratch
databases and `pilotage` still a member of no role.

---

## D3 — Anti-vacuity at breadth is a COVERED / UNCOVERED partition asserted by set equality, plus a floor

**Decision.** Per enumerated table, the **owner** counts tenant A's rows and
tenant B's rows *before* any adversarial statement runs.

1. A table with no B row is **UNCOVERED**; its denial results are **discarded**,
   never recorded green.
2. `COVERED ∪ UNCOVERED` partitions the catalog enumeration, and `UNCOVERED` is
   asserted by **SET EQUALITY** against a list named in the source with a reason
   per entry. A 45th table lands in `UNCOVERED`, is absent from the named list,
   and the gate **FAILS printing its name**.
3. `COVERED` carries a **non-vacuity floor** (`MIN_COVERED_TABLES`), so a fixture
   failure that empties the database cannot make the partition trivially agree.

**Why it cannot be silent.** A table with no seeded B row makes `SELECT` → 0,
`UPDATE` → 0 rows and `DELETE` → 0 rows: **three green denial assertions on an
empty table**, indistinguishable afterwards from isolation. This is `ADR-042`
§D3's principle (an expectation computed from structure, never from the thing
being checked) applied to **rows** rather than to policies; the principle is
documented, this target is not.

**Consequence.** If a future fixture budget will not stretch to a new table, the
honest move is to **shrink `COVERED` and name the table in `UNCOVERED_EXPECTED`
with its reason** — never to let breadth be bought with vacuum. `DNC-08` forbids
the alternative. The named list is **not an exemption list**: it subtracts from
nothing, it is one half of an equality.

**Measured today:** `UNCOVERED_EXPECTED` is empty, because all 45 tenant-bearing
tables and all five FK-derived ones are seeded for both tenants; `COVERED` = 50
against a floor of 40.

**Related decision, same paragraph of the same problem — the privilege matrix.**
Seven tables measurably hold no `DELETE` and three hold no `UPDATE`
(`ADR-032` §D7, `ADR-042` §D5). Catching `42501` and scoring it as "denied" would
leave the suite green on a database with **zero policies**. So the expected
outcome per `(table, verb)` is read from `information_schema.role_table_grants` —
`0 rows` where the privilege is held, SQLSTATE `42501` where it is not — and the
matrix **itself** is asserted by set equality against the closed decided set, so a
silently widened grant is a FAILURE and not a newly-passing test. Classification
is by **SQLSTATE, never by message text**, which is locale-dependent (`DNC-10`).

---

## D4 — In-gate mutation is permitted, under containment rules

**Decision.** The fail-before / pass-after evidence of AC-8 is produced **by the
suite itself, unconditionally**, with no flag and no environment variable:

- it runs **as the owner, on the scratch database only**, and the SQL itself
  asserts `current_database() ~ '^tenant_adversarial_'` before mutating — a
  JS-side target object is not enough for a statement that turns a security
  control off;
- it runs **after** the main proof has produced its verdict and only ever
  **appends** its own named assertions, so it is structurally incapable of
  converting a failed proof into a pass;
- it asserts a **specific fact flip** (`CTX_A_FOREIGN_school` goes `0 → 1` when
  RLS is disabled on `public.school`, and back to `0` when it is restored), never
  "the failure count rose" — a global counter is satisfied by any unrelated
  breakage, which is `DNC-08` committed by the fix;
- **if the flip does not occur, that is a FAILURE with its own name**
  (`MUTANT_KILLED`): the assertion it was validating is dead.

**The weakening is `DISABLE ROW LEVEL SECURITY`, not `DROP POLICY`,** and the
reason is a measurement rather than a preference: restoring a dropped policy would
require re-authoring its predicate inside the checker, i.e. a **second source of
truth for the very expression the suite exists to check**. `DISABLE`/`ENABLE` is
exactly as weakening and exactly reversible.

**Why it cannot be silent.** S-E01-2b injected mutants **by hand, out of band**.
Making mutation a permanent gate stage is new, and it is the one code path in this
repository that *expects* red. A `--weaken` flag or a `VAL02_MUTATE=1` variable
would be `DNC-10` verbatim — "a new flag that lets a caller choose what is
compared" — hence "unconditionally, in-suite".

---

## D5 — A green from this suite never says the application is isolated

**Decision.** The verdict vocabulary contains **no bare word "isolated"**. Success
reads:

> `TENANT ADVERSARIAL SUITE: the NON-OWNER role IS isolated — the APPLICATION IS NOT (it connects as the owner)`

and the limit is carried in the **banner and the verdict vocabulary**, not in an
epilogue. Two further rules:

- The owner-bypass is a **POSITIVE assertion that the leak is present** — as
  `pilotage`, with GUC = tenant A, tenant B's rows are visible, `expect ≥ 1` — not
  a printed caveat. An assertion that the leak is present goes **red** the day
  someone adds `FORCE ROW LEVEL SECURITY`, which is the correct alarm, because on
  that day the application (which connects as this very role) starts returning
  zero rows.
- A green **must not print without the CUTOVER READINESS block**, which is itself
  a set of named `[LIMIT]` lines: the count of `PrismaService.withTenant`
  production callers against the count of Prisma call sites (measured **0 / 722**
  across 223 source files), and the ungranted-table set cross-referenced against
  `prisma.<model>.` reachability in `apps/**` (measured: `tenant` ×2, `role` ×7,
  `permission` ×3 — each a `42501` on the AuthZ resolution path after the
  cutover, and invisible to every isolation assertion because none of the three is
  tenant-bearing).

**No distinction is carried by colour.** A non-TTY CI log strips ANSI; every
`[OK]` / `[FAIL]` / `[LIMIT]` line is legible from its text alone.

**Why it cannot be silent.** `ADR-032` §D5 and `PROGRESS.md` already say this in
prose. `PF-02` is the record of prose over-claiming what evidence supports. The
point of this decision is that the **machine** must say it, in the line an
operator actually reads.

---

## Consequences

- **Positive.** VAL-02 is discharged by execution at breadth: **675 assertions, 4
  named limits, 0 failures, exit 0**, 50 tables, four verbs, both directions,
  three consecutive byte-identical runs (20 s / 21 s / 20 s, modulo the generated
  scratch database name). The cutover has adversarial evidence *and* a named list
  of what still blocks it.
- **Cost.** ~20 s of wall time and one scratch database per run, plus a second
  fixture builder to maintain until D1's follow-up lands.
- **The sequencing hazard FIRED, and it is worth recording how.** This section
  originally predicted, in the future tense, that when `S-E01-2d` gave
  `outbox_event` a real `tenant_id` the census would move 44 → 45, `outbox_event`
  would become an ordinary tenant-bearing table, and both `UNCOVERED_EXPECTED` and
  the `outbox_event` fail-closed probe would go red on rebase. `S-E01-2d` merged
  **first** (`e53f2d9`), so that red was the branch's **present** state, and it was
  caught by review rather than by a run — the branch had been measured against a
  tree that no longer existed. The live-catalog enumeration did exactly what it is
  for: it refused to agree with a frozen belief about the schema. The response was
  the one this ADR prescribes — `outbox_event` joined `PLAN` as an ordinary
  tenant-bearing table (seeded for both tenants, four verbs), the privilege matrix
  gained its `SELECT, INSERT, UPDATE` decision by name from `ADR-044 §D3` instead
  of the `FULL_DML` default, and the fail-closed probe was **deleted** rather than
  kept alongside: after `ADR-044` a `permission denied` on that table would be a
  MISSING GRANT, which is the false green every other phase of the file treats as a
  loud failure. **The durable lesson is about evidence, not about the table:** an
  evidence line is only true of the tree it was measured on, so a rebase past a
  schema change invalidates it and the re-measurement is not optional.
- **Not decided here.** Whether to cut `DATABASE_URL` over. That is `S-E01-1`, and
  D5's readiness block is the reason it is not yet safe.
