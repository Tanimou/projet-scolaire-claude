# ADR-027 — The schema-drift gate needs a database; the operator drill needs a *dataset*

- **Status:** Accepted
- **Date:** 2026-08-07
- **Epic / Slice:** V3-E02 — Versioned database lifecycle and release integrity · `S-E02-5`
  (The migration ledger must reproduce `schema.prisma`, and something must say so)
- **Deciders:** Winston (Architect), Amelia (Backend)
- **Findings / risks / gates:** `PF-03` (residual half), `G-MIGRATION`, `G-DNC` (`DNC-08`/`DNC-10`),
  `R-23` (a red gate gets routed around), `R-01`
- **Relates / narrows:** **ADR-025 D1** (operator drills live outside `ci-gate.sh`) — narrowed, not
  superseded; ADR-025 D2 (binary exit codes), D3 (the evaluator lives in the script), D4 (scratch-name
  guard), D6 (credentials never in `argv`), D7 (a spec must not edit a tracked repo file);
  ADR-014 (Postgres 15); the `S-E02-2` rule that `scripts/ci-gate.sh` and `.github/workflows/ci.yml`
  must not drift

## Context

Editing `apps/api/prisma/schema.prisma` **without writing a migration** passed every gate this
repository had:

- `scripts/ci-gate.sh` runs `prisma generate`, so it generates a client for a schema **no migration
  produces**; lint, typecheck, build and boot then all validate against that fiction.
- `infra/docker/migrate-entrypoint.sh` runs `migrate deploy` and **only** `migrate deploy`, so the
  edit reaches no database, ever.
- `apps/api/prisma/migrations/` holds exactly one entry (`0_baseline`).

That is `db push`'s failure mode arriving through the front door: the application compiles against a
column that does not exist and fails at the first query. It is the residual half of `PF-03`.

Closing it requires **executing** the ledger — creating an empty database, applying the migrations to
it, and comparing the result with the datamodel. That gives `scripts/ci-gate.sh` its **first stage that
requires a running service**, which is the opposite of what `ADR-025 D1` decided three days earlier, in
three places (D1 itself, its Consequences, and its rejected-alternatives row *"Add a Postgres service
to `ci-gate.sh`"*). `bmad/project-context.md` §3 makes an undocumented architectural reversal a
blocking finding, so the stage lands with this record.

## Decision

### D1 — `scripts/schema-drift-check.js` IS a gate stage, and `ci-gate.sh` now requires a PostgreSQL server

Stage `0d`, after the compose-invocation stage and **before** `prisma generate`, **outside** the
`--quick` guard. `bash scripts/ci-gate.sh` therefore now fails on a machine with no reachable
PostgreSQL. That is intended, and `DNC-08` leaves no third option: a stage that degraded to a skip
would report a check that did not happen as a result, at the address of the gate itself.

### D2 — The distinction that makes this and ADR-025 D1 both true: a **capability**, not a **state**

This is the whole of the argument, and it is not a loophole:

| | `scripts/restore-drill.js` (ADR-025) | `scripts/schema-drift-check.js` (here) |
|---|---|---|
| what it needs | the **seeded application database** — 55 tables, 13 550 rows of realistic child records | an **empty PostgreSQL server** |
| can CI have it? | **no**, and it must not fabricate one: a drill against a database CI invented proves nothing about the database that matters | **yes** — `ci.yml`'s `build` job already declares a `postgres:15-alpine` service and a `DATABASE_URL`, and the local stack already runs one |
| what it touches | data it did **not** create (`pg_dump` of a populated database) | **no existing database object**: it creates an empty scratch, applies the ledger, reads catalogs, drops it |
| when the invariant must hold | on a **date** — its result is dated evidence | on the **diff that introduces the defect**, because the defect is committed by an edit to a tracked file |

`restore-drill.js` needs a **state**. `schema-drift-check.js` needs a **capability**. The drill's
absence from the gate stays correct; what is narrowed is only ADR-025's blanket phrasing *"the gate
needs no services"*. ADR-025 D1 is otherwise untouched, and its guard spec still asserts, in the
negative, that neither harness runs the drill.

A guard-spec-only design — the ADR-025 shape — was considered and rejected here for a reason specific
to this defect: it would assert the **apparatus** and never execute the **comparison**, so the one
thing the slice exists to measure would never run against a real PostgreSQL. That is exactly what
`PF-03`'s residual describes.

### D3 — The cost accepted, named: `R-23`

With the local stack down, `bash scripts/ci-gate.sh` reports `GATE: FAIL` on a defect-free tree. A red
gate gets routed around, so the mitigations are implemented, not promised:

1. **The verdict discriminates "the check could not run" from "the ledger diverges"**, even though both
   exit 1: `tooling_unavailable` / `unreachable_server` versus `schema_drift`. The verdict string is
   the discriminator (ADR-025 D2), and the failure message for the first two prints the **exact remedy
   command** — `docker compose --env-file .env -f infra/docker-compose.yml up -d postgres` — so the
   route back to green is starting a database and never editing code.
2. **Every route tried is named** (`prisma db execute`, host `psql`, `docker exec pilotage_postgres
   psql`) with the actual error from each, so "it does not work here" is actionable in one read.
3. **Hosted CI is never in that state**: the step runs in the only job that already owns a
   `postgres:15-alpine` service, and the guard spec fails if that service is removed — otherwise
   deleting the service would turn the stage red and the reflex fix would be to delete the stage.
4. **The precondition is written in three places** — the script header, the stage comment in
   `ci-gate.sh`, and `docs/runbooks/backup-restore-drill.md` §8 — so it is stated rather than
   discovered.

Measured cost in time: **≈ 17 s** on the local stack (create, `migrate deploy` of `0_baseline` into an
empty database, catalog reads, diff, drop). It is reported and does not change the exit code.

### D4 — The two rejected spellings of the comparison

**`--from-migrations` (rejected — it is permanently red on a correct repository).** Measured on this
repository, unchanged, before a line of the gate was written:

```
prisma migrate diff --from-migrations ./prisma/migrations \
                    --to-schema-datamodel ./prisma/schema.prisma --exit-code
→ exit 2
  [+] Added extensions
    - btree_gin, citext, pg_trgm, pgcrypto, uuid-ossp
```

Those five extensions are **not** missing: `apps/api/prisma/migrations/0_baseline/migration.sql` lines
2-14 create all five with `CREATE EXTENSION IF NOT EXISTS`, and the shadow database that same command
builds contains all five plus 54 tables. Diffing **that database** against the datamodel returns
`No difference detected`, **exit 0**. A gate spelled the first way is red on correct code with no route
back to green except breaking correct code — the trap `S-E06-3` designed its catch-all verdict around.
Recorded here because the next maintainer's obvious "simplification" is to delete the scratch database
and use `--from-migrations`; `schema-drift-gate.spec.ts` asserts the string's absence.

**`--from-url <scratchUrl>` (rejected — it violates ADR-025 D6).** It puts `pilotage:pilotage@…` into a
child process's `argv`, which the host process table publishes; D6 forbids exactly that ("the password
reaches `pg_dump`/`psql` through the environment, **never** as a connection-string argument"). Since
`schema.prisma`'s datasource is already `url = env("DATABASE_URL")`, the equivalent D6-clean spelling
is `--from-schema-datasource <schema>` with `DATABASE_URL` set in the **child environment only**. It
addresses the same database by the same URL. Measured equivalent in both directions: `exit 0` /
`No difference detected` on the unmodified repository, `exit 2` / `[+] Added tables - DriftProbe` on a
temp copy of the datamodel carrying one extra model.

### D5 — Three exit codes, three verdicts

`migrate diff --exit-code` is **trinary**: `0` no difference, `2` a difference, **`1` the command
itself failed** (measured: an unreadable `--to-schema-datamodel` path and a dead server both return 1).
`classifyDiffExit()` is the only place that number is interpreted, and it returns `in-sync` / `drift` /
`tooling-error`. Reading `!== 0` as drift would send an operator to edit `schema.prisma` over a
connection error; reading `!== 2` as agreement would report a crashed Prisma as success — `DNC-08`
committed inside the `DNC-08` enforcer.

### D6 — No new dependency, and no `pg` client

Creating and dropping the scratch database uses the **Prisma CLI itself**
(`prisma db execute --schema <schema> --stdin` against a **derived** maintenance URL — the resolved URL
with its database replaced by `postgres`, derived in code, never accepted from a flag). Measured before
committing to it: Prisma 5.22's `db execute` does **not** wrap the script in a transaction, so
`CREATE DATABASE` is accepted. Reading catalogs needs a route that returns rows, which `db execute`
does not, so the ladder continues to host `psql` (the portable, over-the-wire route — it is what works
in `ci.yml`, where a service container is *not* reachable as `pilotage_postgres`) and then to
`docker exec -i pilotage_postgres psql` with SQL on **stdin**, never `-c` and never through a shell
(a heredoc through `sh -c` breaks on CRLF, and this repository is developed on Windows). Adding the
`pg` npm package was rejected: it is in no workspace here, and `E11-S1` is the recorded cost of adding
a dependency mid-slice.

`ADR-025 D5`'s `row_security = off` / SUPERUSER-or-BYPASSRLS requirement deliberately does **not**
transfer. This check reads **catalogs only** — never a row, never a `tenant_id`, never a person — so
importing D5 would impose a privilege the check does not need and would make it fail on correct setups.
The privilege it *does* need is `CREATEDB`; failing to create is `scratch_create_failed`, exit 1,
naming it.

## Consequences

- `scripts/ci-gate.sh` no longer runs with zero services. Every other stage still does; this is the
  only one, and it is the first line of the summary when it fails.
- The scratch database is created **empty**, holds **zero** tenant rows at any instant, is dropped on
  every exit path (`finally`, `SIGINT`, `SIGTERM`, `uncaughtException`) with `WITH (FORCE)`, and a
  failed drop is its own verdict that never downgrades a drift verdict. Orphans from a killed earlier
  run are swept, name-pattern-guarded, before a new one is created.
- **No schema change ships with this slice, and that absence is itself an acceptance criterion:** a
  diff containing a migration would have made the gate green by editing the thing it measures.
- What it does **not** prove is written in the script header rather than left to be discovered: it
  proves the ledger *reproduces* and *executes*, not that a migration is **safe** (a `DROP COLUMN` that
  destroys data passes), not that it applies to a **non-empty** database, and not anything about a
  **deployed** database. A migration deleted together with the models it created is not caught — both
  sides move and the diff is clean.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Keep the ADR-025 shape: a guard spec, no executing stage | The comparison would never run against a real PostgreSQL, which is the entire strength of the design. It asserts the apparatus and measures nothing — `PF-03`'s residual, restated. |
| A `--from-migrations` text diff, no database | Permanently red on a correct repository (D4, measured). |
| Skip the stage when no database is reachable | `DNC-08`. A success nobody obtained. |
| Put the stage inside the `--quick` guard | It reads `prisma/` and a database, never `dist/` or `.next/`; the routine runs `--quick`, so the defect would be unguarded on exactly the path that runs most. |
| A dedicated `schema-drift` CI job with its own service | A second service block bought nothing: the `build` job already declares one, and two jobs would be two places for the wiring to drift. |
| Add the `pg` npm package | A new workspace dependency for a gate script — a new decision *and* `E11-S1`'s RED-gate class. |
| Let the spec add a field to the tracked `schema.prisma` and revert it | `ADR-025 D7` / `PF-77`: a jest process killed between the two halves leaves the tracked schema modified, and the routine's git salvage would commit it. The mutation lives in a temp directory and reaches the gate through an exported function, never through a CLI flag. |
