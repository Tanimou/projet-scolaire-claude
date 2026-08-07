# ADR-025 — Operator drills live outside `ci-gate.sh`; the guard spec is what CI runs

- **Status:** Accepted
- **Date:** 2026-08-06
- **Epic / Slice:** V3-E02 — Versioned database lifecycle and release integrity · `S-E02-3`
  (Timed backup → restore rehearsal, executed against the LOCAL Docker stack)
- **Deciders:** Winston (Architect)
- **Findings / risks / gates:** `VAL-03`, `R-01`, `G-MIGRATION`, `G-DNC` (`DNC-06`/`DNC-08`/`DNC-10`),
  `G-TENANT`; `PF-84` (the `.dockerignore` exclusion that made the safe migrator unreachable),
  `PF-86` (Compose resolves `.env` from the compose file's directory)
- **Supersedes / relates:** ADR-002 (multi-tenancy — `tenant_id` + RLS), ADR-014 (Postgres 15),
  the `S-E02-2` gate convention (`scripts/ci-gate.sh` and `.github/workflows/ci.yml` must not drift),
  the `S-E02-9`/`S-E02-11`/`S-E02-12` script-plus-guard-spec idiom.

## Context

Every executable check this epic has shipped so far obeys one shape:

> a `scripts/*-check.js` that judges the repository or its build output, wired as a stage in **both**
> `scripts/ci-gate.sh` and `.github/workflows/ci.yml`, plus a guard spec in
> `apps/api/src/shared/quality/` that fails if the stage is disconnected.

`boot-check.js`, `web-artifact-check.js`, `runtime-engines-check.js`, `observability-check.js`,
`tracing-check.js` and `production-artefact-check.js` are all that shape, and every one of their guard
specs asserts *"`ci-gate.sh` runs it"* and *"`ci.yml` runs it too, so the two cannot drift"*.

`S-E02-3` cannot be that shape, and pretending otherwise would break the epic's own premise:

1. **It needs services.** A backup → restore rehearsal needs a running Postgres holding real rows.
   `ci-gate.sh` deliberately needs none — that is what makes it runnable by the routine, on a locked
   CI account, at any hour. Its `.compile()`-not-`.init()` decision in `boot-check.js` exists for
   exactly this reason.
2. **It mutates.** It creates a scratch database and drops it. Every existing stage is read-only over
   the checkout and its build output.
3. **A stage that cannot run makes the gate lie.** Adding a stage that would be skipped, or that would
   fail on every machine without a container runtime, converts `GATE: PASS` from a measurement into a
   guess. That is `DNC-08` — reporting a check that did not happen as a result — at the address of the
   gate itself.

There is a second, independent decision forced by the same slice: `PF-84` proved that a build-context
exclusion can make a compose `command:` target unreachable *in every build that has ever run*, with no
gate noticing for the entire life of the file. That class of defect has no home in the existing shape
either, because no script reads `.dockerignore`.

## Decision

### D1 — The drill is an operator artefact; the guard spec is the CI-visible half

`scripts/restore-drill.js` is **not** a `ci-gate.sh` stage and **must not become one**. What CI runs is
`apps/api/src/shared/quality/restore-drill-gate.spec.ts`, which `ci-gate.sh` already picks up through
the `test:api (ratchet)` stage because it lives in `src/shared/quality` (`apps/api/jest.config.js`
matches `<rootDir>/src/**/*.spec.ts`). **No new stage is added to `ci-gate.sh` or `ci.yml`.**

This splits the two things the epic has so far kept together, and names which half proves what:

| Half | Proves | Runs |
|---|---|---|
| `scripts/restore-drill.js` | that a backup taken from a populated database restores into a scratch database with byte-equal content, and how long that takes | by the routine / an operator, against a running stack |
| `restore-drill-gate.spec.ts` | that the drill still exists, still has no bypass, still refuses to report success it did not earn, and that its baseline and runbook have not drifted from it | every `ci-gate.sh` run, with no services |

The reasoning is **part of the deliverable, not a footnote**: it is stated in the script header and in
`docs/runbooks/backup-restore-drill.md`. An undocumented absence from the gate is indistinguishable
from an oversight, and the next maintainer's obvious "fix" is to wire it in.

**Consequence, stated rather than hidden (`DNC-08`):** nothing mechanically forces the drill to be
re-run. Its result is evidence with a date on it, not a continuously-enforced invariant. The guard spec
holds the *apparatus*; only an executed run holds the *result*.

> **Narrowed by [`ADR-027`](./ADR-027-schema-drift-gate-needs-a-database.md) (2026-08-07, `S-E02-5`).**
> D1 stands for the drill, which needs the **seeded application database** — a *state* CI cannot have
> and must not fabricate. What no longer holds is the blanket phrasing *"the gate needs no services"*:
> `ci-gate.sh` stage 0d now requires an **empty PostgreSQL server** — a *capability* that `ci.yml`'s
> build job already provisions and the local stack already runs. Read ADR-027 before wiring any other
> service-dependent stage into the gate; the capability-versus-state distinction is what keeps both
> decisions true at once.

### D2 — Binary exit codes; the verdict is the discriminator

`evaluateDrill(input)` returns `{ verdict, exitCode, … }` with `exitCode ∈ {0, 1}` — `0` only for
`ok`, `1` for every failure verdict (`row-count-divergence`, `checksum-divergence`, `missing-table`,
`unbaselined-ledger`, `pending-migration`, `unreachable-source`, `scratch-cleanup-failed`). Six gate
scripts already speak exactly `0`/`1`; a per-verdict numeric exit namespace would be a **new
convention** bought for nothing, since the verdict string is already machine-readable and already
printed.

### D3 — `evaluateDrill` lives in the script, not in `packages/contracts`

`evaluateRelease()` is in `packages/contracts/src/release/` because **three separately-built artefacts**
consume it at runtime and three copies would drift — that is the whole argument recorded in `S-E02-10`.
`evaluateDrill` has exactly **one** consumer. Putting it in `packages/contracts` would ship an operator
drill's evaluator into the api, worker and web runtime bundles.

The convention it reuses instead is the one the sibling gate scripts already use:
`module.exports = { evaluateDrill, … }` at the foot of the script, `require`d by the spec
(`runtime-engines-check.js` exports `{ evaluateRuntimeSupport, collectFromRepo }`; `tracing-check.js`
and `observability-check.js` do the same). **No new package, no new subpath export** — and specifically
not a `@pilotage/contracts/*` subpath, which `S-E02-10` already established this workspace cannot
resolve under `moduleResolution: Node`.

### D4 — The scratch database is namespaced, and the drop is guarded by that namespace

The drill creates and drops a database. A `DROP DATABASE` in a script that also reads `DATABASE_URL` is
one typo away from destroying the thing it was written to protect.

- The scratch name is **generated by the script**, never supplied by a flag or an env var, and carries
  a fixed literal prefix (`pilotage_restore_drill_`).
- The drop path **re-checks the prefix immediately before executing** and refuses anything that does
  not match — including the source database name, checked explicitly.
- Cleanup runs on **every** exit path: success, every failure verdict, an exception, and `SIGINT`/
  `SIGTERM`. A failed cleanup is its own verdict (`scratch-cleanup-failed`, exit 1) — a leaked scratch
  database is a reportable defect, never a silent success.

### D5 — The dump and the manifest are taken with `row_security = off`, under a role that may

ADR-002 declares Postgres RLS as the tenancy mechanism. It is **not enabled in the database today** —
`V3-E01` is the epic that lands it. That is precisely why this constraint has to be written down now:

> `pg_dump` under a role subject to RLS silently dumps only the rows that role can see. If the
> verification manifest is built through the same restricted role, a **partial backup compares equal to
> a partial manifest** and the drill reports `ok` on an unrecoverable backup.

So: the manifest queries and `pg_dump` both run with `row_security = off` explicitly set (not inherited,
not assumed), under the table-owning role, and the drill **fails** if that setting cannot be applied.
Written today this costs one line; discovered after `V3-E01` it would mean the drill had been reporting
green on partial dumps for however long RLS had been on. This is the `G-MIGRATION`/`R-01` core: the
value of a restore rehearsal is entirely in whether the thing it restored was complete.

### D6 — Credentials never enter `argv`; the manifest carries no identifier

`G-TENANT`, applied to an artefact that is not an API surface:

- The password reaches `pg_dump`/`psql` through the environment (`PGPASSWORD` via `docker exec -e`),
  **never** as a connection-string argument — `docker exec` argv is visible in `docker inspect` and in
  the container's process table.
- Every log line and every error message prints a **redacted** connection descriptor (host, port,
  database name), never the URL.
- The manifest's per-table entry may contain only: the table name, a row count, and a hex digest. **No
  sample row, no min/max of a column, no `tenant_id` value, no person's name.** A digest is a
  one-way function of content; a "first row for context" would not be.
- The ledger section carries migration names, checksums and applied/rolled-back state — Prisma's own
  metadata, tenant-free by construction.

### D7 — The `PF-84` guard is a `.dockerignore` ↔ compose coherence rule, proven on a fixture

The guard asserts the **general rule**, not the one path that broke: every `/app/...` path referenced by
a `command:` or an `entrypoint:` in `infra/docker-compose.yml` must survive `.dockerignore`. Encoding
"`infra/docker` must not be excluded" would close one address and leave the class open — the same
argument `observability-check.js` made for checking *all* bind-mount sources rather than the three that
were missing.

Two binding conditions:

- The negative proof runs against an **in-memory fixture** (a `.dockerignore` string with the offending
  line re-added), **never** by mutating the real `.dockerignore`. `S-E02-13`'s probes mutated real files
  and had to restore them; a jest spec that edits a repo-root file races the routine's own git salvage.
- The matcher implements a **stated, deliberately narrow subset** of dockerignore semantics (literal
  paths, path prefixes, `**/` prefix globs, `!` negation), and says so in its header. It must assert it
  found something before asserting anything about it — the vacuous-pass failure mode that
  `lint-ratchet.spec.ts` shipped and had to fix.

## Consequences

**Positive.** The gate keeps its property of needing no services, so it stays runnable on the locked CI
account and in the routine. `R-01`'s mitigation stops being prose. `PF-84`'s class — a build-context
exclusion silently amputating a container's entrypoint — acquires a check, cheaply. The
`DNC-08`/`DNC-10` posture is unchanged: no `--skip`, no `--force`, no `ALLOW_*`/`SKIP_*`, and `--update`
refuses to rewrite the SLO baseline from a partial or failed run (`boot-check.js`'s hard-learned rule).

**Negative, and named.** The drill's *result* is not continuously enforced — see D1. And the drill
proves the **procedure**, not the **production case**: it does not establish a restore time at real data
volume, and it does not exercise a backup taken on one machine and restored on another. Both limits go
in the runbook, not in a footnote.

**Not claimed.** There is no production deployment to rehearse against
(`pilotage.srv861861.hstgr.cloud` is an audit fixture). This closes `VAL-03` for the local stack and
leaves the hosted half where `S-E02-1`'s residual and `S-E02-5` already sit: operator work.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Wire the drill into `ci-gate.sh` behind a "skip if no Postgres" branch | `DNC-08` verbatim — a stage that skips reports a check that did not happen as a pass. `boot-check.js` chose "a missing `dist/` is a failure, never a skip" for the same reason |
| Add a Postgres service to `ci-gate.sh` | Turns the one gate the routine can always run into one that needs a container runtime, an image pull and a port. The gate's portability is load-bearing while `PF-59` locks CI |
| Put `evaluateDrill` in `packages/contracts` | One consumer, three runtime bundles. See D3 |
| A per-verdict exit-code namespace (2 = divergence, 3 = ledger, …) | A new convention against six scripts of `0`/`1` precedent, for information the verdict string already carries |
| Run `pg_dump` from the host | Requires a host Postgres client at a matching major version. The `postgres:15-alpine` container already has `pg_dump`, `psql`, `createdb` and `dropdb` at exactly the server's version. The host route stays available and configurable; the drill **fails loudly** when neither route is available, rather than skipping |
| Encode "`infra/docker` must not be in `.dockerignore`" | Closes one address, leaves the class. See D7 |
| Mutate the real `.dockerignore` to prove the guard fires | Races the routine's git salvage path (`PF-77`/`R-27`). Fixture instead. See D7 |

## Amendment on land — what the shipped drill actually does (2026-08-07, run 19)

Two details of this ADR were written before `scripts/restore-drill.js` existed and are reconciled here
rather than left to be discovered as a contradiction between an ADR and its artefact.

- **D4, the scratch prefix.** The shipped literal is `restore_drill_<epochMillis>`, guarded by
  `/^restore_drill_\d+$/`, not `pilotage_restore_drill_`. The substance of D4 is unchanged — the name is
  generated by the script, never supplied by a flag or an environment variable, the drop re-checks the
  pattern *and* the source database name immediately before issuing the statement, and a failed drop is
  its own verdict. Only the literal differs, and it is the literal the story's guard spec locks
  (`restore-drill-gate.spec.ts` asserts `SCRATCH_NAME_PATTERN.source`), so the ADR follows the artefact.
- **Verdict spelling.** Verdicts are `snake_case` (`row_count_divergence`, `scratch_cleanup_failed`),
  not `kebab-case`. The exit-code contract in D2 is unchanged: `ok` → 0, every other verdict → 1.

Two decisions were sharpened during implementation and belong here:

- **D5 is honoured in both halves.** Every connection — source and restored — sets `row_security = off`
  together with `TimeZone`, `DateStyle` and `extra_float_digits`, under `ON_ERROR_STOP=1`, so a role that
  cannot apply the setting fails the drill instead of silently reading a subset. The drill additionally
  refuses a role that is neither `SUPERUSER` nor `BYPASSRLS` (`insufficient_read_role`), because the
  `SET` alone does not bypass RLS for a restricted role.
- **The manifest/dump race is closed at the "acceptable floor", not at the ideal.** Holding a
  `REPEATABLE READ` snapshot across a `pg_dump --snapshot=…` is not reachable from a script that speaks to
  the server through one short-lived `docker exec psql` per query. Instead the source manifest is
  **re-read after the dump**, and any difference is reported as its own verdict
  (`source_mutated_during_dump`) rather than as a data divergence — so a concurrent write from the alert
  cron never gets attributed to the restore. The runbook says so in §7.9.
