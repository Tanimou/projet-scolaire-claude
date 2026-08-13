# Next story

_Rewritten by run 46 (`TOOL-17`), 2026-08-13. Read this section first; everything below it is older and kept for content._

---

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

