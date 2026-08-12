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
