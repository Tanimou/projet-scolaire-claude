# TOOL-10 — the drift check must conclude "unreachable" in milliseconds, and a killed ratchet must not report itself as a startup failure

> **Epic** `V3-E02` — Versioned database lifecycle and release integrity (gate-hardening track)
> **Layer** L0 · **Risk tier** P1 · **Mode** `epic-slice` · **Track** a
> **Branch** `ci/2026-08-12-v3-a-tool10-drift-preflight`
> **Closes** `TOOL-10` (recorded by run 43 in
> `docs/daily-improvement-v3/traceability/inbox/ci-2026-08-12-v3-a-gate-unbounded-stages.md`)
> **Touches** UI: **no** · backend: **no** (test files only under `apps/api`) · worker: **no** · gate scripts: **yes**
> **Gates triggered** `G-DNC` (always). **`G-MIGRATION` is NOT triggered** — this slice writes no migration and does
> not open `apps/api/prisma/**`.

---

## 0. Read this first — what this slice is, and what it is not

This slice repairs **how long a gate takes to reach a verdict it already reaches correctly**. Nothing a parent,
teacher or admin can see changes. No schema, no endpoint, no controller, no guard, no permission, no contract, no
dashboard value, no production application code. The diff is two CI scripts and two test files.

**The verdict must not move.** On a machine with no reachable PostgreSQL, `node scripts/schema-drift-check.js`
today prints `SCHEMA DRIFT CHECK: FAIL — tooling_unavailable` and exits 1. After this slice it must print the
**same verdict** and exit **the same 1** — only in about a second instead of never. The finding says so in as
many words: *"the current design is right to FAIL rather than skip (DNC-08 — a run that cannot describe itself is
indistinguishable from one never attempted); it is only wrong about how long it takes to find out."*

If your change makes the unreachable case *pass*, *skip*, or report any verdict other than `tooling_unavailable`,
you have implemented the opposite of this story.

**Raising a timeout is explicitly not the fix.** `2bd1a25` already raised the `test:api (ratchet)` bound once, on
a misreading of the symptom. **Do not touch `scripts/ci-gate.sh`.** No stage bound goes up or down in this slice.

---

## 1. The defect, measured on this worktree on 2026-08-12

Every number below was produced on `C:/Users/HP/Downloads/pilotage-worktrees/v3-track-a` during the authoring of
this story. None is quoted from an earlier run. Reproduce them before you start — they are the fail-before half of
this slice's evidence.

### 1.1 One unreachable-address invocation of the CLI does not finish

```
node -e "const {spawnSync}=require('node:child_process');
const t0=Date.now();
const r=spawnSync(process.execPath,['scripts/schema-drift-check.js'],{encoding:'utf8',timeout:30000,
  env:{...process.env,DATABASE_URL:'postgresql://pilotage:pilotage@127.0.0.1:59999/pilotage?schema=public'}});
console.log(Date.now()-t0, r.status, r.signal, r.error&&r.error.code);"
```

**Measured:** `30037  null  SIGTERM  ETIMEDOUT`. The last line the child printed was
`▶ prisma CLI : node node_modules/.pnpm/prisma@5.22.0/node_modules/prisma/build/index.js` — i.e. it had entered
`check()` → `routes.query('postgres', 'SELECT 1;')` (`scripts/schema-drift-check.js:1019`) and never came out.

### 1.2 Where inside the ladder it stops

`query()` (`:736`) tries route B (host `psql`, `ENOENT` here, fast), then calls `containerAddressesTheUrl()`
(`:699`), which runs `run('docker', ['port', 'pilotage_postgres', '5432/tcp'])` with **no bound at all**.

```
node -e "const {spawnSync}=require('node:child_process');const t0=Date.now();
const r=spawnSync('docker',['port','pilotage_postgres','5432/tcp'],{encoding:'utf8',timeout:8000});
console.log(JSON.stringify({elapsedMs:Date.now()-t0,status:r.status,signal:r.signal,errCode:r.error&&r.error.code}));"
```

**Measured:** `{"elapsedMs":8026,"status":null,"signal":"SIGTERM","errCode":"ETIMEDOUT"}` — the docker CLI did not
answer in 8 s, and **`spawnSync`'s own `timeout` killed it**. (bash `timeout` does *not*: `ps -W` on this host
shows orphaned `/c/Program Files/Docker/Docker/resources/bin/docker` processes dated **Aug 10**, left by earlier
runs whose bash-level `timeout` failed to kill them. libuv maps `SIGTERM` to `TerminateProcess` on Windows, so a
`spawnSync`-level bound is a real bound where a bash-level one is not. This is the fact the second belt in §3.4
turns on.)

So the cost of route C on this platform is **unbounded**, not the ~90 s run 43 recorded.

### 1.3 Why that overruns the 2400 s ratchet stage

`apps/api/src/shared/quality/schema-drift-gate.spec.ts` reaches the route ladder **ten** times:

| Where | Count |
|---|---|
| `:698` `an unreachable address FAILS and names every route tried (AC-4)` | 1 |
| `:709` `EXECUTES to the same non-zero verdict with every plausible escape set (AC-9)` — 1 control + 7 escape sets | 8 |
| `:829` `gate.probeServer(...)` at module scope | 1 (in-process) |

The seven `it.each` flag-refusal cases at `:740` exit inside `parseArgs` before any route and are already fast —
leave them alone. Each of the ten above pays the unbounded docker cost. That is what turns a 2400 s stage into the
`✗ test:api (ratchet) — TIMED OUT after 2400s` at 2827 s that run 43 measured, with
`A jest worker process crashed for an unknown reason: exitCode=143` inside it — **143 is SIGTERM**, i.e. the
worker was *still running* when the bound expired, not crashing.

### 1.4 A TCP preflight settles the same question in a fifth of a second

The exact child this story asks for (`node -e <source> host port timeoutMs`, `node:net`), measured through
`spawnSync` from a parent, wall clock including child boot:

```
127.0.0.1:5433   wall=235ms  status=0  {"open":false,"detail":"ECONNREFUSED"}
127.0.0.1:59999  wall=207ms  status=0  {"open":false,"detail":"ECONNREFUSED"}
```

In-process the socket answers in **17–25 ms**; the rest is node boot. A control server
(`net.createServer().listen(0)`) is detected `{"open":true}` in **12 ms**, so the probe is not a function that
always answers "closed".

**There is no reachable project PostgreSQL on this machine**: `127.0.0.1:5433` refuses connections. That is
exactly the condition under test, which is why every case in this story is runnable right now.

### 1.5 The second, separable half — the ratchet misdescribes a kill

`scripts/test-ratchet.js:113` prints, when jest wrote no JSON report:

```
test-ratchet: jest produced no report for api. It probably failed to start.
```

Run 43 measured that sentence printed on a run where jest **had started and was killed**. The finding's words:
*"jest did not fail to start, it was killed, and that sentence sends the next investigator to look for a startup
fault that does not exist."* That misreading is what produced `2bd1a25`.

---

## 2. Where the code is

| What | Where |
|---|---|
| The gate script this slice bounds | `scripts/schema-drift-check.js` (1249 lines) |
| `run()` — the single `spawnSync` wrapper every route goes through | `:587–601` |
| `makeSqlRoutes(cli, source)` — the ladder | `:683–782` |
| `containerAddressesTheUrl()` — unbounded `docker port` | `:699–722` |
| `psqlContainer()` — unbounded `docker exec` | `:730–733` |
| `query()` — throws with `error.routeFailure = true` | `:736–751` |
| `exec()` — returns `{ ok, detail }` | `:755–779` |
| `probeServer()` — exported, used by the spec at module scope | `:809–825` |
| `module.exports` | `:1222–1242` |
| The ratchet | `scripts/test-ratchet.js`, `runJest()` at `:84–122`, the no-report branch at `:112–117` |
| The guard spec (add to it) | `apps/api/src/shared/quality/schema-drift-gate.spec.ts` (~960 lines) |
| Its module typing (must gain `probeAddress`) | same file, `interface SchemaDriftModule` at `:121–143` |
| Its helpers you will reuse | `runInChild()` `:196`, `executableJs()` `:188`, `EXECUTABLE_SCRIPT` `:194`, `DEAD_URL` `:98` |
| The new spec | `apps/api/src/shared/quality/test-ratchet.spec.ts` (**new**) |
| Its model | `apps/api/src/shared/quality/lint-ratchet.spec.ts` (source-only, no toolchain invoked) |

---

## 3. What to change — half A: `scripts/schema-drift-check.js`

> ### ⚠️ Deviation from this authored story, recorded by the land pass — read before §3.1 and §3.2
>
> **The shipped probe is three-state, not two.** §3.1 below specifies `{ open, detail }` and says *"a probe that
> cannot answer is **closed** … never open"*; §3.2 then short-circuits the ladder on a **closed** address. That is
> **not what landed**, and the difference decides whether `docker` is invoked. What landed is
> `{ open, state: 'open' | 'refused' | 'indeterminate', detail, addresses, loopback, elapsedMs }`, and
> `preflightSettlesTheAddress()` stops the ladder **only** when `state === 'refused' && loopback === true`.
>
> **Why the deviation is right, and was kept.** A two-state probe reads a *timeout* as absence. That makes a
> loaded-but-alive PostgreSQL — or a slow resolver, or a node child that cannot start — report
> `tooling_unavailable` permanently, with no route back to green except deleting the check. That is this story's own
> **#1 pre-mortem row**: a gate that is red on correct code. Only `ECONNREFUSED` **from every resolved address** is
> evidence of absence; a timeout, `ENOTFOUND` or unparseable child output is `indeterminate` and **deliberately
> descends the full (now bounded) ladder**. The `&& loopback` half is the same bias: `containerAddressesTheUrl()`
> admits route C only when the container publishes the port **on this host**, so refused-on-loopback genuinely
> implies C is unusable, while a non-loopback URL (a compose service name, a remote host) still descends.
>
> So read §3.1's `{ open, detail }`, §3.2's *"when the address is closed"*, the typing snippet in §4 and AC-1 as the
> **authored** design; the six-field tri-state above is the **shipped** contract, and the `SchemaDriftModule`
> interface in `schema-drift-gate.spec.ts` mirrors it. `module.exports` is also wider than the *"the only new module
> surface is `probeAddress`"* line: it additionally exports `TCP_PREFLIGHT_TIMEOUT_MS` and `DOCKER_TIMEOUT_MS`, both
> read by the guard spec. **Two further deviations** are recorded in `../PROGRESS.md` § `TOOL-10`: §3.4 says to leave
> `pnpm` unbounded and the diff bounds it at 60 000 ms, and `exec()` gained a cross-server guard that **throws**
> against a docstring saying it never does.

### 3.1 `probeAddress(host, port, timeoutMs)` — a new export

Add a function that answers one question — *is anything accepting TCP at this address?* — and returns
`{ open: boolean, detail: string }`, where `detail` is the errno (`ECONNREFUSED`, `EHOSTUNREACH`, …) or
`timed out after <n> ms`. Default `timeoutMs` **2000**.

Implement it as `run(process.execPath, ['-e', <source>, host, String(port), String(timeoutMs)], { timeoutMs: … })`
with the child using `node:net`. **Two constraints on the implementation, both load-bearing:**

1. **It must be a child process, not an in-process socket.** Everything in this file is synchronous
   (`spawnSync`); `net.Socket` is not, and there is no synchronous way to await it inside `query()`/`exec()`.
   Spawning a node child keeps the whole call chain synchronous *and* buys the hard bound of §3.4 for free.
2. **Under `node -e`, the extra arguments start at `process.argv[1]`** — not `[2]`. Verified:
   `node -e "console.log(process.argv[1])" foo` prints `foo`. Getting this wrong yields `Number(undefined)` → the
   probe connects to port `NaN` and the whole fast path silently degrades.

Give the `spawnSync` itself a `timeout` of roughly `timeoutMs + 5000`, so even the probe is bounded when node
itself cannot start. A probe that cannot answer is **closed** with a detail saying so — never "open".

The child source must not contain the tokens `process.env.`, `process.env[`, `SKIP_`, `ALLOW_`, `BYPASS`,
`--force`, `--update`, `--allow`, `--source`, or the word `skip` near `PASS`/`exit 0`. Those are asserted on the
comment-blanked source by existing cases at `:750`, `:775` and `:782`, and the child source is a **string in
executable position**, so it is scanned. §5.4 lists the same rule as a constraint.

Export `probeAddress` from `module.exports`.

### 3.2 Use it to short-circuit the ladder in `makeSqlRoutes(cli, source)`

Probe **once**, **lazily** (on the first `query()`/`exec()`, not at construction — construction happens in
`openSqlRoutes()`, which the guard spec calls in contexts that must stay cheap), memoised on the routes object.

When the address is **closed**:

- `query()` must throw the **same** error it throws today, carrying **`error.routeFailure = true`**, **without
  invoking `psql`, `docker` or `prisma`.**
- `exec()` must return `{ ok: false, detail }`, likewise without invoking anything.

**Why `routeFailure` is not optional:** `check()` at `:1024` reads it, and *only* it, to set
`state.toolingAvailable = false`; `evaluateDrift` then produces `tooling_unavailable`, which
`VERDICT_PRECEDENCE` ranks first and `VERDICT_EXIT_CODES` maps to 1. Drop the flag and the verdict silently
becomes `unreachable_server` — a different string, a different runbook entry, and a broken §5.3 assertion.

When the address is **open**, behaviour is byte-for-byte what it is today: the ladder runs exactly as written.
The preflight is a *negative* fast path only.

### 3.3 The short-circuit message — name every route, in full

`AC-4` (`:698`) asserts the output contains `prisma db execute`, **and** `psql`, **and** `pilotage_postgres`; and
DNC-08/FR-9 require a run to describe itself. So the preflight failure is **more** verbose than a bare
"connection refused", not less. Write it as: the address and the errno, then the ladder A/B/C each named on its
own line with the reason the one probe settles that route. For example:

```
no SQL route could answer: nothing is accepting TCP at 127.0.0.1:59999
(ECONNREFUSED after 21 ms), and all three routes address that one server:
    A. prisma db execute — executes its script against that address (DATABASE_URL in the child
       environment), so it cannot connect either
    B. host psql — connects to that same host and port over the wire
    C. docker exec pilotage_postgres psql — is accepted only when the container publishes the port
       the resolved URL addresses, and nothing is listening on it
```

Do **not** weaken this into a paraphrase, and do not drop a route name to shorten it. The wording above is the
contract §5.2 tests.

**Justify the short-circuit in a comment, with the fact that makes it sound:** all three routes address the *same
server*; `buildScratchUrl()` (`:280`) and `deriveMaintenanceUrl()` (`:297`) replace **only** the database path
segment of the URL — `buildScratchUrl` is already pinned to do exactly that by the case at `:480` — so one probe
of the resolved `host:port` covers **every** URL this script ever opens (`baseUrl`, `maintenanceUrl`,
`scratchUrl`). Without that sentence the next reader cannot tell whether the fast path is sound or lucky.

### 3.4 Second belt — bound every `docker` invocation

The preflight cannot cover one case: **the port is open but the docker CLI is hung**. §1.2 measured that state on
this very host. So:

- Give `run()` an `options.timeoutMs` that reaches `spawnSync`'s `timeout` option.
- Pass a short bound (**5000 ms** is ample) to **every** `docker` invocation — the `docker port` at `:701` and the
  `docker exec` at `:731`. Measured today: **2** `run('docker'` call sites, **0** of them bounded.
- `spawnSync` sets `result.error.code === 'ETIMEDOUT'` on a timeout kill (measured, §1.2). Surface that as a
  **named** stderr — e.g. `docker did not answer within 5000 ms and was killed` — so the operator reads a bound
  rather than a mystery. Today `run()` would report the raw `spawnSync docker ETIMEDOUT`, which names neither the
  bound nor the fact that the kill was deliberate.

Leave `psql`, `pnpm` and `prisma` invocations unbounded: nothing has measured them hanging, and inventing bounds
for them widens the diff past its finding.

### 3.5 `probeServer()` gets the same fast path

`probeServer()` (`:809`) is called at **module scope** by the guard spec (`:829`) to decide whether the
end-to-end block runs, so it is paid on **every** jest run of that file, reachable database or not. It must take
the same preflight: closed address → `false`, in ~0.2 s, without touching docker. Its contract is unchanged —
`true` only on a **positive** answer (`SELECT 1;` returned a row).

---

## 4. What to change — half B: `scripts/test-ratchet.js`

In `runJest()`, time the `spawnSync` and branch the no-report case (`:112`) on what actually happened. Three
branches, one exit code:

| Condition | What it must say |
|---|---|
| `res.signal` is set, **or** `res.status === null` | jest was **terminated** — name the signal and the elapsed ms, and say **explicitly that it did not fail to start**. If the caller's own harness (`ci-gate.sh`'s `timeout`) killed it, this is the sentence that tells the reader so. |
| `res.error` is set (and no signal) | a **spawn** fault — name `res.error.code` / message. |
| neither | keep today's wording, verbatim: `It probably failed to start.` |

Constraints:

- **Exit code stays 2 in all three branches.** The callers (`ci-gate.sh`, `ci.yml`) distinguish 2 = the ratchet
  could not run from 1 = drift. Changing it is out of scope and would be a silent contract break.
- **The temp directory is still removed** on every branch (`rmSync(scratch, …)`), as today.
- **No passing behaviour changes.** Do not touch the report parsing, the baseline comparison, `--skip`,
  `--update`, or any output on a successful run.
- `It probably failed to start.` must **not** be printed on the killed path. That string is the anti-regression
  §5.5 pins.

---

## 5. Tests — a triggered gate without evidence is a blocker

Every assertion below must be able to fail. Before trusting an anchor that reads source text, **evaluate it
against the file as shipped with `node -e` and confirm it matches what you think it matches** — a source
assertion that matches zero call sites and passes green is precisely the defect `TOOL-07` and `TOOL-08` were made
of.

### 5.1 `probeAddress` unit cases — deterministic, environment-independent

Add a `describe` block to `apps/api/src/shared/quality/schema-drift-gate.spec.ts`:

- **Negative:** a closed port (`127.0.0.1:59999`, the port `DEAD_URL` already uses) returns `open: false` with an
  errno in `detail` (`/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|timed out/`).
- **Positive — this is the case that makes the block non-vacuous:** stand up a real
  `net.createServer().listen(0, '127.0.0.1')` in `beforeAll`, probe **its** port, expect `open: true`; close it in
  `afterAll`. Without this, a `probeAddress` that always answered "closed" would pass every other case in this
  story *and* would make the whole gate permanently `tooling_unavailable`, including on a healthy machine — the
  worst outcome this slice could ship.
- **Bound each call's wall clock** (`Date.now()` around it; a few seconds is generous — measured 207–235 ms).
- Add `probeAddress: (host: string, port: number | string, timeoutMs?: number) => { open: boolean; detail: string }`
  to `interface SchemaDriftModule` (`:121`), or the file will not typecheck.

### 5.2 End-to-end: the CLI concludes fast against `DEAD_URL`

One case using the existing `runInChild([], { DATABASE_URL: DEAD_URL })` helper:

- `elapsed < 20000` ms — deliberately generous; the target is ~1 s and the pre-fix behaviour is **unbounded**
  (§1.1: not finished at 30 s), so this assertion is a real discriminator, not a tight timing test that will
  flake on a loaded host.
- `status !== 0`.
- output still contains `prisma db execute`, `psql`, `pilotage_postgres`, and `SCHEMA DRIFT CHECK: FAIL`.

### 5.3 Anti-regression: the verdict did not move

A refused address still reports **`SCHEMA DRIFT CHECK: FAIL — tooling_unavailable`**, exactly. This is the case
that fails if the preflight became a skip, or if it dropped `error.routeFailure` and slid the verdict to
`unreachable_server`. Assert the full string, not a regex over `FAIL`.

### 5.4 Every `docker` invocation in the script is bounded

Write this so it **can** fail:

1. Take the **comment-blanked** source (`executableJs`, already in the file at `:188`) — a bound mentioned only
   in a comment must not satisfy this.
2. Find all `run('docker'` call sites and slice each one to its **matching closing paren** (balance the parens;
   do not take a single line — the `docker exec` call at `:731` spans three lines and a line-scoped regex would
   silently miss its options object).
3. `expect(sites.length).toBeGreaterThan(0)` — the non-vacuity guard.
4. `expect(site).toContain('timeoutMs')` for **each** site.

**Verified against the shipped file before this story was written:** the balancer finds **exactly 2** sites
(`:701` `docker port`, `:731` `docker exec`) and **neither** contains `timeoutMs`. So the case is **red before
the change and green after** — fail-before/pass-after, measured, not assumed.

### 5.5 New: `apps/api/src/shared/quality/test-ratchet.spec.ts`

Source-only and fast, modelled on `lint-ratchet.spec.ts`. **It must not `require()` `scripts/test-ratchet.js`** —
that file has no `module.exports` and calls `runJest()` at module scope (`:134`), so importing it would launch a
full jest run inside a jest run. Read it with `readFileSync` and blank its comments the way the sibling spec does.

Assert, on the comment-blanked source of `runJest()`:

- The no-report branch **reads the outcome** — it references `res.signal` (or `res.status === null`) and
  `res.error`, so it can tell a kill from a spawn fault.
- The **killed** branch says so: it contains a message naming the signal and stating the run did **not** fail to
  start, and `It probably failed to start.` is **not** on that branch.
- `It probably failed to start.` still exists exactly once, on the remaining branch.
- Elapsed milliseconds are reported (the branch references the timing variable).
- **Exit code 2 on every branch of the no-report path** — count the `process.exit(2)` calls inside the branch and
  assert none is `process.exit(0)` or `process.exit(1)`.
- Non-vacuity first: assert the `runJest` slice was actually found (`expect(runJestSource).not.toBe('')`) before
  asserting anything about its contents. A regex that captured nothing and passed is `TOOL-07`'s exact family.

---

## 6. Hard constraints (G-DNC — reproduce none of DNC-01..DNC-12)

**DNC-08 — a run that cannot describe itself is indistinguishable from one never attempted.**
- The preflight **FAILS loudly** and **names the whole ladder**. It never prints "skipped", never exits 0, and
  never downgrades the verdict.
- `ok` stays the only zero in `VERDICT_EXIT_CODES` (pinned at `:788`).

**DNC-10 — no new bypass surface.**
- **No new CLI flag.** `parseArgs` still knows exactly `--help` and `-h` (pinned at `:762`).
- **No new environment branch.** `process.env` reads in the executable source stay exactly
  `['process.env.DATABASE_URL']` (pinned at `:750`), and `process.env[` never appears.
- The tokens `SKIP_`, `ALLOW_`, `BYPASS`, `--force`, `--update`, `--allow`, `--source` must not appear in
  executable source (pinned at `:775`) — including inside the `probeAddress` child-source string.
- `--from-migrations` must not reappear; `--from-schema-datasource`, `--to-schema-datamodel` and `--exit-code`
  must remain (pinned at `:792`).
- `if (require.main === module) main();` stays; no bare `main()` (pinned at `:807`).

**G-MIGRATION is not triggered.** Do not open `apps/api/prisma/**`. Write no migration. Run no
`prisma generate`, no `db push`.

---

## 7. Scope — the complete list of files this slice may touch

```
scripts/schema-drift-check.js
scripts/test-ratchet.js
apps/api/src/shared/quality/schema-drift-gate.spec.ts
apps/api/src/shared/quality/test-ratchet.spec.ts          (new)
```

Plus this story file and the run's own traceability inbox file.

`scripts/**` and `apps/api/src/shared/quality/**` are **shared paths** (`docs/daily-improvement-v3/tracks.md`
§"Shared paths — claim before touching"): keep the change minimal and **declare it in the PR body**.

**Explicitly out of scope — do not do these:**

- **Do not touch `scripts/ci-gate.sh`.** No stage bound moves, up or down. `TOOL-10` says raising the timeout is
  the wrong fix and `2bd1a25` already tried it.
- **Do not promote `runtime engines` into TIER 1.** That is `TOOL-09`, deliberately left un-storified — widening
  the fast tier is an `open-decisions.md` call, not a side effect of a repair.
- **Do not start Docker or a database.** The machine has no reachable PostgreSQL and that is the condition under
  test.
- **Do not run `pnpm build`**, `next build`, `docker build`, or `infra/pilotage.sh update|rebuild|reset`.
- **Do not run `pnpm typecheck`** — only the test-architect does, once per sprint.
- Do not change `evaluateDrift`, the verdict table, the precedence list, the scratch-name pattern, or any safety
  check. This slice adds a fast path and two bounds; it decides nothing new.

---

## 8. Acceptance criteria

| # | Criterion | How it is proven |
|---|---|---|
| **AC-1** | `probeAddress(host, port, timeoutMs)` is exported, returns `{ open, detail }`, answers a **closed** port with `open:false` and an errno, and a **listening** port with `open:true` | §5.1, with a real `net.createServer()` control |
| **AC-2** | Against `DEAD_URL` the CLI concludes in **< 20 000 ms** (target ~1 s; pre-fix: not finished at 30 000 ms, measured) with `status !== 0` | §5.2 |
| **AC-3** | That output still contains `prisma db execute`, `psql`, `pilotage_postgres` and `SCHEMA DRIFT CHECK: FAIL` — the ladder is still named in full | §5.2 |
| **AC-4** | The verdict is **unchanged**: `SCHEMA DRIFT CHECK: FAIL — tooling_unavailable`, exit 1. `query()` still throws with `routeFailure = true`; `exec()` still returns `{ ok:false, detail }` | §5.3 |
| **AC-5** | When the address is closed, **no** `psql`, `docker` or `prisma` child is spawned by the ladder | the elapsed bound of AC-2 (unbounded → ~1 s) plus the message shape of §5.3 |
| **AC-6** | **Every** `run('docker'` call site passes a `timeoutMs`; the assertion finds > 0 sites | §5.4 — red before (0 of 2), green after |
| **AC-7** | A `docker` timeout is surfaced as a named bound (`did not answer within N ms and was killed`), not a raw `ETIMEDOUT` | source assertion in §5.4's block |
| **AC-8** | `probeServer()` returns `false` on a closed address in well under a second, without touching docker | timing assertion beside §5.1 |
| **AC-9** | `test-ratchet.js` distinguishes a **signal kill** (names the signal + elapsed ms, states it did **not** fail to start) from a **spawn fault** from a genuine startup failure; exit code stays **2** on all three | §5.5 |
| **AC-10** | `It probably failed to start.` is no longer printed on the killed path | §5.5 |
| **AC-11** | `parseArgs` still knows only `--help`/`-h`; `process.env` reads stay exactly `['process.env.DATABASE_URL']`; none of the forbidden tokens appears | the existing cases at `:750`, `:762`, `:775` stay green |
| **AC-12** | `scripts/ci-gate.sh` is **byte-identical** to `HEAD` | `git diff --stat` in the PR body |

---

## 9. How to verify what you wrote — run these, paste the real numbers

The machine has **no reachable PostgreSQL**, which is exactly the condition under test. Everything here is
runnable right now.

```bash
# 1. Fail-before (do this BEFORE editing, and keep the output):
node -e "const {spawnSync}=require('node:child_process');const t0=Date.now();
const r=spawnSync(process.execPath,['scripts/schema-drift-check.js'],{encoding:'utf8',timeout:30000,
 env:{...process.env,DATABASE_URL:'postgresql://pilotage:pilotage@127.0.0.1:59999/pilotage?schema=public'}});
console.log(Date.now()-t0, r.status, r.signal, r.error&&r.error.code);"
#   expected before the change: ~30000 null SIGTERM ETIMEDOUT   (measured 30037)

# 2. Pass-after — the real check, unbounded, against the default (closed) 5433:
node scripts/schema-drift-check.js ; echo "exit=$?"
#   expected: ▶ elapsed : ~1000 ms or less, "SCHEMA DRIFT CHECK: FAIL — tooling_unavailable", exit 1

# 3. Pass-after — the DEAD_URL path the spec exercises nine times:
DATABASE_URL='postgresql://pilotage:pilotage@127.0.0.1:59999/pilotage?schema=public' \
  node scripts/schema-drift-check.js ; echo "exit=$?"

# 4. The flag-refusal path is still instant and still exit 1:
node scripts/schema-drift-check.js --force ; echo "exit=$?"

# 5. The anchors, evaluated against the file as shipped — before trusting them:
node -e "…balance the parens over run('docker' …; print site count and whether each has timeoutMs"
```

**Rules for the evidence you record:**

- Paste **real elapsed numbers** from your own run. Never record evidence you did not produce.
- Anything asserted about docker behaviour must be **measured**. If a docker call hangs, that **is** the finding —
  report the wall clock, do not retry until it looks better.
- Do **not** run the full `apps/api` jest suite to "check"; that is the 2400 s stage this story exists to fix, and
  the test-architect owns the single typecheck/test pass.

---

## 10. Pre-mortem — assume this shipped and broke something

| Failure mode | Why it would happen | The acceptance criterion that catches it |
|---|---|---|
| The gate goes permanently `tooling_unavailable` on a **healthy** machine | `probeAddress` always answers "closed" (bad argv indexing under `-e`, a probe error read as closed, a too-short timeout on a slow host) | AC-1's **positive** control against a real listening socket; the default 2000 ms bound |
| The preflight becomes a skip | someone "simplifies" the failure into an early `return` or a 0 exit | AC-4 asserts the exact verdict string and exit 1; `ok` stays the only zero in the verdict table |
| The verdict slides to `unreachable_server` | `routeFailure` dropped from the short-circuit error | AC-4's full-string assertion |
| AC-4's output assertions go vacuous | the route names dropped to shorten the message | AC-3 pins all three literals; §5.2 keeps them in the same case as the timing |
| The docker-bound assertion passes without bounding anything | a line-scoped regex misses the multi-line `docker exec` call, or matches zero sites | §5.4's paren balancer + `sites.length > 0`, verified 2/2 against the shipped file |
| The ratchet's new message hides a real startup failure | the "killed" branch catches too much (e.g. treats any non-zero as a kill) | AC-9 keeps three distinct branches; the third keeps today's wording verbatim |
| A hung docker still stalls a run where the port **is** open | the preflight cannot see a hung CLI behind an open port | AC-6/AC-7 — the 5 s `spawnSync` bound, which §1.2 measured actually kills on Windows |
| The diff sprawls into `ci-gate.sh` | "while I'm here, the bound could come down now" | AC-12 — `ci-gate.sh` byte-identical |

---

## 11. Ledger note

`docs/spec/features/v3-e02/PROGRESS.md` and its slice table carry **no row for `TOOL-10`** — they track the
`S-E02-*` product/infrastructure slices and were last written on 2026-08-08, before run 43 recorded this finding.
The `TOOL-*` ids live in the traceability inbox
(`docs/daily-improvement-v3/traceability/inbox/ci-2026-08-12-v3-a-gate-unbounded-stages.md`), where `TOOL-10` is
`open`, `P1`, `L0`. That is not a contradiction — it is a gap: the epic ledger does not yet index the gate-hardening
findings. The operator-supplied slice governs.
