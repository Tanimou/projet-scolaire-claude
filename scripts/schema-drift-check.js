#!/usr/bin/env node
/**
 * schema-drift-check.js — the migration ledger must reproduce `schema.prisma`,
 * and this is the thing that says so (S-E02-5, PF-03 residual, G-MIGRATION).
 *
 * WHY THIS EXISTS
 * ---------------
 * Editing `apps/api/prisma/schema.prisma` without writing a migration passed
 * EVERY gate this repository had. `scripts/ci-gate.sh` runs `prisma generate`,
 * so it cheerfully generates a client for a schema no migration produces, and
 * then lints, typechecks, builds and boots against that fiction.
 * `infra/docker/migrate-entrypoint.sh` runs `migrate deploy` and only
 * `migrate deploy`, so the edit reaches no database, ever. The application
 * compiles against a column that does not exist and fails at the first query.
 * That is `db push`'s failure mode arriving through the front door, on a
 * repository whose migrations directory holds exactly ONE entry (`0_baseline`).
 *
 * So this file does the comparison rather than asserting it: it creates a
 * disposable scratch database on a real PostgreSQL, runs `prisma migrate deploy`
 * into it from `apps/api/prisma/migrations`, diffs THAT DATABASE against
 * `apps/api/prisma/schema.prisma`, and drops the scratch database on every exit
 * path. That is strictly stronger than a text diff: it proves the migrations
 * EXECUTE, in order, on a real PostgreSQL, and that what they build is what the
 * datamodel describes.
 *
 * WHY IT DIFFS A DATABASE AND NOT THE MIGRATIONS DIRECTORY — MEASURED
 * -------------------------------------------------------------------
 * The reflex implementation is `migrate diff --from-migrations ./prisma/migrations
 * --to-schema-datamodel ./prisma/schema.prisma --exit-code`. It was RUN against
 * this repository, unchanged, before a line of this file was written: it returns
 * **exit 2** and reports all five PostgreSQL extensions (`btree_gin`, `citext`,
 * `pg_trgm`, `pgcrypto`, `uuid-ossp`) as `[+] Added extensions`. They are not
 * missing — `apps/api/prisma/migrations/0_baseline/migration.sql` lines 2-14
 * create all five with `CREATE EXTENSION IF NOT EXISTS`, and the shadow database
 * that same command builds contains all five plus 54 tables. Diffing THAT
 * database against the datamodel returns `No difference detected`, exit 0.
 *
 * A `--from-migrations` gate would therefore be permanently red on a correct
 * repository, with no route back to green except breaking correct code — the
 * exact trap `S-E06-3` designed its catch-all verdict around. The string
 * `--from-migrations` must not reappear in this file, and
 * `schema-drift-gate.spec.ts` pins its absence so a future "simplification"
 * cannot silently re-arm it.
 *
 * WHY THE DIFF READS THE DATABASE THROUGH `--from-schema-datasource`
 * -----------------------------------------------------------------
 * `--from-url <scratchUrl>` would be the obvious spelling, and it is the one the
 * story proposed. It puts `pilotage:pilotage@…` into a child process's `argv`,
 * which the host process table publishes — the exposure `ADR-025 D6` forbids in
 * as many words ("the password reaches `pg_dump`/`psql` through the environment,
 * NEVER as a connection-string argument"). `schema.prisma`'s datasource is
 * already `url = env("DATABASE_URL")`, so `--from-schema-datasource <schema>`
 * with `DATABASE_URL` set **in the child environment only** addresses exactly the
 * same database by exactly the same URL, and no credential enters `argv` on any
 * of the four child processes. Measured equivalent: both spellings return
 * `No difference detected` / exit 0 on this repository and exit 2 on a drifted
 * datamodel. See ADR-027 §"The two rejected spellings".
 *
 * WHAT IT CHECKS, AND WHICH DEFECT EACH CHECK IS FOR
 * --------------------------------------------------
 *   1. a SQL route and the Prisma CLI exist   → DNC-08. Tooling that cannot run
 *      is the state in which every check below passes vacuously. It FAILS,
 *      naming every route it tried. It never prints "skipped" and exits 0.
 *   2. the server is reachable                → same rule.
 *   3. `apps/api/prisma/migrations` holds at least one DIRECTORY
 *                                             → a drift check over an empty
 *      ledger passes vacuously (PF-84's lesson: the cheapest way for a gate to be
 *      worthless is to compare nothing).
 *   4. the scratch target is safe             → the only destructive line in this
 *      file. See THE ONE DANGEROUS PART below.
 *   5. the freshly created scratch holds ZERO base tables
 *                                             → catches a URL-rewrite bug that
 *      pointed the run at the real database, where the diff would be clean
 *      WITHOUT the migrations having executed at all.
 *   6. `migrate deploy` completed             → a migration that does not execute
 *      on PostgreSQL is a broken ledger even if its text diffs clean.
 *   7. the scratch holds at least 50 base tables afterwards
 *                                             → the other half of check 3: a
 *      deploy that silently no-op'd leaves an empty database, whose diff would
 *      report all 54 tables as added and be misread as "massive drift".
 *   8. every on-disk migration is in the scratch `_prisma_migrations`, finished
 *      and not rolled back                    → the ledger and the disk must
 *      describe the same migrations.
 *   9. the diff's exit code is CLASSIFIED, not guessed
 *                                             → `--exit-code` is trinary: 0 = no
 *      difference, 2 = a difference, **1 = the command itself failed**. Reading
 *      `!== 0` as drift reports a crash as drift; reading `!== 2` as agreement
 *      reports a crash as success, which is DNC-08 committed inside the DNC-08
 *      enforcer. Three codes, three verdicts.
 *  10. the scratch database was dropped       → its own verdict, never swallowed,
 *      and it never downgrades a drift verdict.
 *
 * HOW LONG IT TAKES TO SAY "UNREACHABLE" (TOOL-10)
 * ------------------------------------------------
 * Checks 1 and 2 above FAIL rather than skip, and that is right. What was wrong
 * was how long they took to find out: with no server listening, the route ladder
 * descended into `docker`, which on this platform does not return — measured, a
 * single invocation was still running at >4 minutes, and `ps -W` lists orphaned
 * `docker` processes from earlier runs that bash `timeout` failed to kill. The
 * guard spec drives that ladder nine times, which is what overran `ci-gate.sh`'s
 * 2400 s `test:api` stage.
 *
 * So there are two belts, and neither changes a verdict:
 *
 *   • a bounded TCP PREFLIGHT (`probeAddress`) settles "is anything listening at
 *     this address" in ~260 ms, out of process. Only `ECONNREFUSED` from every
 *     resolved address short-circuits the ladder; a timeout or a resolution
 *     failure descends it, because a probe that cannot answer is not evidence a
 *     server is absent. The short-circuit throws the SAME `routeFailure` error,
 *     so the verdict stays `tooling_unavailable`, exit 1, byte for byte.
 *   • every `docker` and package-manager spawn carries a `spawnSync`-level
 *     `timeout`, which really kills on Windows where bash `timeout` does not, and
 *     a kill is surfaced as a NAMED bound ("did not answer within N ms and was
 *     killed") rather than a raw `ETIMEDOUT`.
 *
 * Raising the gate's stage timeout is NOT the fix and was tried once (2bd1a25).
 *
 * THE ONE DANGEROUS PART — read before editing
 * --------------------------------------------
 * This script CREATES and DROPS a database on a real server. Every destructive
 * statement is refused unless the target matches `/^schema_drift_\d+$/` AND
 * differs from the database named in the resolved URL. Both conditions are
 * hard-coded, re-checked immediately before CREATE and again immediately before
 * DROP, and there is no flag that widens them. `buildChildEnv()` applies the same
 * pattern to the URL handed to `migrate deploy` and `migrate diff`, so a bug that
 * let the target resolve to the seeded local database would raise rather than run
 * DDL against real child records.
 *
 * `DATABASE_URL` IS AN ADDRESS, NOT A BYPASS (DNC-10)
 * ---------------------------------------------------
 * The only environment variable this file reads is `DATABASE_URL`, as the default
 * address (falling back to the local stack, matching `restore-drill.js`'s
 * `DEFAULT_SOURCE`). That is not a DNC-10 escape, and the reason is structural
 * rather than a promise: the variable names WHERE a scratch database is built,
 * never WHETHER the ledger reproduces the schema. Wherever it points, the scratch
 * database is created EMPTY and migrated from the migrations on disk, so a
 * different address cannot buy a pass — it can only make the run unreachable,
 * which is a failure with its own verdict. `schema-drift-gate.spec.ts` proves
 * this by EXECUTION: with `DATABASE_URL` pointed at a dead address the CLI exits
 * non-zero, with or without every plausible bypass variable also set.
 *
 * THE PRECONDITION THIS ADDS TO `ci-gate.sh` — STATED, NOT DISCOVERED
 * ------------------------------------------------------------------
 * `bash scripts/ci-gate.sh` now REQUIRES a reachable PostgreSQL server. With the
 * local stack down it fails at this stage, including under `--quick`. That is
 * intended and there is no third option: a stage that degraded to a skip would be
 * DNC-08 at the address of the gate itself. It also CONTRADICTS `ADR-025 D1`,
 * which is why it ships with **`docs/adr/ADR-027-schema-drift-gate-needs-a-database.md`**:
 * the operator drill needs the SEEDED APPLICATION DATABASE — a STATE, which CI
 * cannot have and must not fabricate — while this check needs an EMPTY PostgreSQL
 * SERVER, a CAPABILITY that `ci.yml`'s build job already provisions as a service
 * and the local stack already runs. Remedy, one line:
 *
 *     docker compose --env-file .env -f infra/docker-compose.yml up -d postgres
 *
 * WHAT IT DELIBERATELY DOES NOT PROVE
 * -----------------------------------
 * That the ledger REPRODUCES and EXECUTES — not that a migration is SAFE. A
 * `DROP COLUMN` that destroys data passes this check. It runs against an EMPTY
 * scratch database, so it says nothing about applying the same migration to a
 * populated one. It reads no deployed database: `infra/docker/migrate-entrypoint.sh`
 * already refuses an un-baselined non-empty database, and the running-database
 * half is `scripts/restore-drill.js`'s seam. A migration deleted together with
 * the models it created is NOT caught — both sides move, and the diff is clean.
 * "schema drift: PASS" means the ledger builds the datamodel; it does not mean
 * the migration is safe to deploy.
 *
 * USAGE
 *   node scripts/schema-drift-check.js     # the check (exit 1 on any failure)
 *   node scripts/schema-drift-check.js --help
 *
 * There are no other options. No `--force`, no `--update`, no `--schema`, no
 * `--source`, no skip flag, no environment branch (DNC-10). The two
 * path-parameterised seams the guard spec needs — `deployMigrations()` and
 * `runDiff()` — are FUNCTION EXPORTS, never CLI flags, for the reason
 * `link-integrity-gate.spec.ts` already recorded: a flag that lets a caller
 * choose what is compared is a bypass flag wearing a different hat.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const { dirname, join, resolve, sep } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');
const API_DIR = join(REPO_ROOT, 'apps', 'api');
const PRISMA_DIR = join(API_DIR, 'prisma');
const SCHEMA_PATH = join(PRISMA_DIR, 'schema.prisma');
const MIGRATIONS_DIR = join(PRISMA_DIR, 'migrations');

/** The local Docker stack, the routine's own target (SKILL Step -1). Same
 * default as `restore-drill.js`, deliberately: two scripts addressing two
 * different databases by default would be a trap of its own. */
const DEFAULT_DATABASE_URL = 'postgresql://pilotage:pilotage@127.0.0.1:5433/pilotage?schema=public';
const DEFAULT_CONTAINER = 'pilotage_postgres';

/**
 * The scratch database name pattern. Hard-coded on purpose — see THE ONE
 * DANGEROUS PART. Nothing may widen it.
 */
const SCRATCH_NAME_PATTERN = /^schema_drift_\d+$/;

/**
 * The floor below which "the diff was clean" is not evidence of anything.
 * 55 base tables were measured on the local stack after `migrate deploy`
 * (54 application tables + `_prisma_migrations`); a scratch database presenting a
 * handful of tables means the deploy did not happen, not that the schema is small.
 */
const MIN_EXPECTED_TABLES = 50;

/**
 * The TCP preflight's budget, and why 2000 is generous rather than arbitrary.
 *
 * MEASURED on this tree while writing TOOL-10: a full out-of-process probe of a
 * closed loopback port — spawn `node`, resolve the host, connect, report — costs
 * **261-334 ms wall clock including node boot**. 2000 ms is therefore ~6× the
 * observed round trip, which leaves room for a loaded CI runner without ever
 * being the thing an operator waits on.
 *
 * It is a budget, never a verdict: a probe that times out is INDETERMINATE, not
 * "closed" (see `probeAddress`). Reading a timeout as absence is how a loaded but
 * healthy PostgreSQL would turn this gate permanently red on correct code.
 */
const TCP_PREFLIGHT_TIMEOUT_MS = 2000;

/** Slack over the in-child budget so the hard `spawnSync` bound is the SECOND
 * belt, not the first: the child should answer on its own and report an errno,
 * and only a child that cannot answer at all is killed from outside. */
const TCP_PREFLIGHT_SPAWN_SLACK_MS = 3000;

/**
 * The bound on the docker CONTROL plane — `docker port`, which asks the daemon
 * for a port mapping and computes nothing. Measured on this machine
 * (2026-08-12): under `spawnSync` `timeout: 5000` it returned at **5024 ms**
 * with `status null`, `signal SIGTERM`, `error.code ETIMEDOUT` — the docker CLI
 * here does not answer in 5 s, and the bound is real. Unbounded, the same call
 * did not return within 150 s. Re-measured end to end after the change: a run
 * whose preflight is `indeterminate` descends the ladder and concludes in
 * **5841 ms**, its output naming `docker did not answer within 5000 ms and was
 * killed` — a bound an operator can read, where bash `timeout` left orphans.
 */
const DOCKER_TIMEOUT_MS = 5000;

/**
 * The bound on the docker DATA plane — `docker exec … psql`, which is route C.
 * It is deliberately NOT `DOCKER_TIMEOUT_MS`, and the asymmetry was a review
 * finding on this slice rather than a guess: route C is the route that works on
 * the local Windows stack (there is no host `psql` here), and what travels over
 * it is `CREATE DATABASE … TEMPLATE template0` and `DROP DATABASE … WITH
 * (FORCE)`, not a metadata lookup. A cold `docker exec` on Docker Desktop
 * routinely spends 1–3 s before `psql` even starts, and `run()`'s bound does not
 * kill grandchildren — so a control-plane bound applied here would kill a
 * legitimate `CREATE` partway and report `scratch_create_failed` on correct
 * code, possibly leaving an orphan `schema_drift_*` database behind. Two minutes
 * is far above any healthy round trip and still a bound: the unbounded case is
 * what this slice exists to remove.
 *
 * It is reached only when the preflight did NOT refuse the address — i.e. when
 * something is listening — so it cannot lengthen the unreachable path the gate
 * pays on every PR.
 */
const DOCKER_EXEC_TIMEOUT_MS = 120000;

/**
 * The bound on the Prisma CLI fallback probe. It is the file's other spawn that
 * can reach a package manager, and it sits on the same critical path
 * (`probeServer` → `resolvePrismaCli`), so bounding docker and leaving this one
 * would be bounding half of the problem.
 */
const PRISMA_CLI_PROBE_TIMEOUT_MS = 60000;

/* ================================================================== *
 * The pure verdict layer — no IO, no clock, no environment.
 *
 * Exported from this script rather than from `@pilotage/contracts` because it
 * has exactly one consumer (its guard spec); putting a gate script's internals
 * into the CJS bundle all three applications load at runtime would be a cost
 * paid by production for a test hook (ADR-025 D3).
 * ================================================================== */

/**
 * Verdict → process exit code. Binary by design (ADR-025 D2): the verdict string
 * is the discriminator, the exit code is only "did it pass". `ok` is the ONLY
 * zero, and `ok` requires the positive evidence of REQUIRED_EVIDENCE below.
 */
const VERDICT_EXIT_CODES = Object.freeze({
  ok: 0,
  tooling_unavailable: 1,
  unreachable_server: 1,
  no_migrations: 1,
  unsafe_scratch_target: 1,
  scratch_create_failed: 1,
  scratch_not_empty: 1,
  migrate_deploy_failed: 1,
  empty_scratch_schema: 1,
  ledger_incomplete: 1,
  diff_tooling_failed: 1,
  schema_drift: 1,
  scratch_cleanup_failed: 1,
  unknown: 1,
});

/**
 * Fixed precedence, highest first. Tested, because it decides what an operator
 * reads at the top of a failing run. The rule that matters: a run that both
 * DRIFTED and failed to clean up reports the DRIFT — otherwise a cleanup bug
 * would downgrade the finding the gate exists for — and still lists the cleanup
 * failure in `failures[]`.
 */
const VERDICT_PRECEDENCE = Object.freeze([
  'tooling_unavailable',
  'unreachable_server',
  'no_migrations',
  'unsafe_scratch_target',
  'scratch_create_failed',
  'scratch_not_empty',
  'migrate_deploy_failed',
  'empty_scratch_schema',
  'ledger_incomplete',
  'diff_tooling_failed',
  'schema_drift',
  'scratch_cleanup_failed',
  'unknown',
  'ok',
]);

/**
 * `prisma migrate diff --exit-code` is TRINARY, and this is the one piece of
 * knowledge the whole design turns on:
 *
 *   0 — no difference detected
 *   2 — a non-empty diff
 *   1 — the command ITSELF failed (unreachable database, unreadable datamodel)
 *
 * Measured, both directions, before this file was written: a missing
 * `--to-schema-datamodel` path and a dead server both return 1, a drifted
 * datamodel returns 2. A gate that treated 1 as drift would send an operator to
 * edit `schema.prisma` over a connection error; a gate that treated any non-2 as
 * in-sync would report success on a crash. Neither is acceptable, so there are
 * three classes and three verdicts. Anything else — including `null` from a spawn
 * error and `-1` — is a tooling error, never agreement.
 */
function classifyDiffExit(code) {
  if (code === 0) return 'in-sync';
  if (code === 2) return 'drift';
  return 'tooling-error';
}

/**
 * The scratch target guard. Both conditions, always, with no flag that widens
 * them: the name is one this script generated, and it is not the database named
 * in the resolved URL.
 */
function isSafeScratchTarget(scratchName, sourceDatabase) {
  if (typeof scratchName !== 'string' || !SCRATCH_NAME_PATTERN.test(scratchName)) return false;
  if (typeof sourceDatabase !== 'string' || sourceDatabase.length === 0) return false;
  return scratchName !== sourceDatabase;
}

/**
 * Pure. Preserves host, port, user, password and query string; replaces ONLY the
 * database path segment. Throws if the name is not one this script could have
 * generated — a URL builder that accepts any name is a `DROP DATABASE` waiting
 * for a typo.
 */
function buildScratchUrl(baseUrl, scratchName) {
  if (typeof scratchName !== 'string' || !SCRATCH_NAME_PATTERN.test(scratchName)) {
    throw new Error(
      `refusing to build a connection URL for "${scratchName}": it does not match ${SCRATCH_NAME_PATTERN}`,
    );
  }
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${encodeURIComponent(scratchName)}`;
  return parsed.toString();
}

/**
 * The maintenance address: the same server, the `postgres` database. Derived in
 * code, never accepted from a flag — `CREATE DATABASE` cannot run from inside the
 * database being created, and an operator-supplied maintenance URL would be a
 * second address the safety checks would have to trust.
 */
function deriveMaintenanceUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

/**
 * The environment overlay for `migrate deploy` and `migrate diff`.
 *
 * This is the P0-4 mitigation, and it is a guard rather than a convenience:
 * `prisma migrate deploy` has no `--url` flag, so the target is chosen ENTIRELY
 * by `DATABASE_URL`. A missing or late override would run the ledger's DDL
 * against the seeded local database. So the URL is re-validated against the
 * scratch pattern here, immediately before every spawn, and a non-scratch target
 * raises instead of running.
 *
 * Measured while writing this file: Prisma's dotenv loader does NOT override an
 * already-set `DATABASE_URL` — `apps/api/.env` is reported as loaded and the
 * datasource line still names the scratch database.
 */
function buildChildEnv(scratchUrl) {
  const database = decodeURIComponent(new URL(scratchUrl).pathname.slice(1));
  if (!SCRATCH_NAME_PATTERN.test(database)) {
    throw new Error(
      `refusing to run a migration tool against "${database}" — only a scratch database matching ` +
        `${SCRATCH_NAME_PATTERN} may ever be the target of migrate deploy`,
    );
  }
  return { DATABASE_URL: scratchUrl };
}

/**
 * Replace the password component of a connection string with `***`.
 *
 * Every line that prints a connection string goes through this. One `console.log`
 * of the raw value, or one child-process error echoing its argv, publishes the
 * credential into a log an operator will paste somewhere (G-TENANT).
 */
function redactConnectionUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return '';
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url.replace(/(:\/\/[^:@/\s]+):[^@/\s]+@/g, '$1:***@');
  }
}

/**
 * The whole verdict, from inputs alone.
 *
 * Total function: a state it does not recognise is `unknown`, exit 1 — never a
 * silent 0, the same `*)` discipline `infra/docker/migrate-entrypoint.sh` uses.
 */
function evaluateDrift(input) {
  if (!input || typeof input !== 'object') {
    return {
      verdict: 'unknown',
      exitCode: VERDICT_EXIT_CODES.unknown,
      failures: [
        'evaluateDrift received no input — the check could not describe its own run, which is ' +
          'indistinguishable from one that was never attempted (DNC-08)',
      ],
    };
  }

  const {
    toolingAvailable = true,
    toolingDetail = null,
    serverReachable = null,
    migrationDirectories = null,
    scratchName = null,
    sourceDatabase = null,
    scratchCreated = null,
    scratchCreateError = null,
    scratchWasEmpty = null,
    migrateDeployOk = null,
    migrateDeployOutput = '',
    scratchTableCount = null,
    ledgerRows = null,
    diffExitCode = null,
    diffOutput = '',
    scratchDropped = null,
    scratchDropError = null,
    fatalError = null,
  } = input;

  /** @type {{ verdict: string, message: string }[]} */
  const findings = [];
  const fail = (verdict, message) => findings.push({ verdict, message });

  /* --- 0a. REQUIRED EVIDENCE -------------------------------------------
   * Every check below is written as `if (x === false)` / `if (x !== null)`, so an
   * input that simply OMITS a field skips the check that would have used it.
   * `evaluateDrill({})` in `restore-drill.js` therefore returned `ok / exit 0`
   * before its own adversarial review caught it: an object carrying NO evidence
   * read as a clean run. That is DNC-08 committed by the function whose whole
   * purpose is to enforce DNC-08, and `{}` is the dangerous half — a crashed or
   * half-built run hands you an object, not a null.
   *
   * The rule: `ok` requires POSITIVE evidence from every stage. Absence is never
   * agreement. */
  const REQUIRED_EVIDENCE = [
    ['serverReachable', serverReachable, 'whether a PostgreSQL server answered'],
    ['migrationDirectories', migrationDirectories, 'the migrations found on disk'],
    ['scratchCreated', scratchCreated, 'whether the scratch database was created'],
    ['scratchWasEmpty', scratchWasEmpty, 'whether the fresh scratch database held zero tables'],
    ['migrateDeployOk', migrateDeployOk, 'whether `prisma migrate deploy` completed'],
    ['scratchTableCount', scratchTableCount, 'the table count the migrations produced'],
    ['ledgerRows', ledgerRows, 'the scratch `_prisma_migrations` rows'],
    ['diffExitCode', diffExitCode, 'the exit code of `prisma migrate diff`'],
    ['scratchDropped', scratchDropped, 'whether the scratch database was dropped'],
  ];
  const missingEvidence = REQUIRED_EVIDENCE.filter(([, v]) => v === null || v === undefined);
  if (missingEvidence.length > 0) {
    fail(
      'unknown',
      'the check did not produce the evidence a verdict requires, so there is no verdict to give. ' +
        `Missing: ${missingEvidence.map(([k, , what]) => `${k} (${what})`).join('; ')}. ` +
        'Reported as a failure rather than skipped, because a run that cannot describe itself is ' +
        'indistinguishable from one that was never attempted (DNC-08)',
    );
  }

  /* --- 0b. the check could not describe its own run --------------------- */
  if (fatalError) {
    fail('unknown', `the check did not complete: ${fatalError}`);
  }

  /* --- 1. tooling and reachability -------------------------------------- */
  if (toolingAvailable === false) {
    fail(
      'tooling_unavailable',
      `no usable route to the database and/or to the Prisma CLI. ${toolingDetail || 'every route was tried and none worked'}. ` +
        'That is a FAILURE and it is reported as one: tooling that cannot run is the state in which ' +
        'every check below would pass vacuously (DNC-08)',
    );
  }
  if (serverReachable === false) {
    fail(
      'unreachable_server',
      'no PostgreSQL server answered at the resolved address. Start the local stack — ' +
        '`docker compose --env-file .env -f infra/docker-compose.yml up -d postgres` — and re-run. ' +
        'The route back to green is starting a database, never editing code (ADR-027)',
    );
  }

  /* --- 2. non-vacuity: there must be a ledger to reproduce -------------- */
  if (Array.isArray(migrationDirectories) && migrationDirectories.length === 0) {
    fail(
      'no_migrations',
      'apps/api/prisma/migrations contains no migration DIRECTORY. A drift check over an empty ' +
        'ledger compares nothing and passes vacuously — the cheapest way for a gate to be worthless ' +
        '(migration_lock.toml is a file, not a migration, and is not counted)',
    );
  }

  /* --- 3. the scratch target -------------------------------------------- */
  if (scratchName !== null && sourceDatabase !== null && !isSafeScratchTarget(scratchName, sourceDatabase)) {
    fail(
      'unsafe_scratch_target',
      `refusing "${scratchName}" as a scratch database: it must match ${SCRATCH_NAME_PATTERN} and must ` +
        `differ from the database named in the resolved URL ("${sourceDatabase}"). This is the only ` +
        'destructive path in the file and it has no flag that widens it',
    );
  }
  if (scratchCreated === false) {
    fail(
      'scratch_create_failed',
      `the scratch database could not be created${scratchCreateError ? `: ${scratchCreateError}` : ''}. ` +
        'The role needs CREATEDB (the local `pilotage` role and the CI `postgres` service role both have it)',
    );
  }
  if (scratchWasEmpty === false) {
    fail(
      'scratch_not_empty',
      'the freshly created scratch database already held base tables. That is not a small problem: it ' +
        'is the signature of a URL-rewrite bug pointing this run at a database the ledger did not ' +
        'build, where the diff would be clean WITHOUT the migrations having executed at all',
    );
  }

  /* --- 4. the ledger EXECUTES ------------------------------------------- */
  if (migrateDeployOk === false) {
    fail(
      'migrate_deploy_failed',
      '`prisma migrate deploy` did not complete against the scratch database — a migration that does ' +
        'not execute on PostgreSQL is a broken ledger however clean its text looks. Prisma said:\n' +
        indent(String(migrateDeployOutput || '(no output captured)').trim(), 4),
    );
  }
  if (typeof scratchTableCount === 'number' && scratchTableCount < MIN_EXPECTED_TABLES) {
    fail(
      'empty_scratch_schema',
      `the migrated scratch database holds ${scratchTableCount} base tables, below the floor of ` +
        `${MIN_EXPECTED_TABLES} (55 measured on the local stack: 54 application tables + ` +
        '`_prisma_migrations`). A deploy that silently no-op\'d leaves a database whose diff reports ' +
        'every table as added, which reads as massive drift and is really an empty comparison',
    );
  }

  /* --- 5. the ledger is complete ---------------------------------------- */
  if (Array.isArray(ledgerRows) && Array.isArray(migrationDirectories)) {
    const byName = new Map(ledgerRows.map((row) => [row && row.migrationName, row]));
    for (const dir of migrationDirectories) {
      const row = byName.get(dir);
      if (!row) {
        fail(
          'ledger_incomplete',
          `migration "${dir}" exists on disk but has no row in the scratch \`_prisma_migrations\` — ` +
            'it was not applied by `migrate deploy`',
        );
        continue;
      }
      if (row.finished !== true) {
        fail('ledger_incomplete', `migration "${dir}" is in the scratch ledger with finished_at NULL`);
      }
      if (row.rolledBack === true) {
        fail('ledger_incomplete', `migration "${dir}" is marked rolled_back in the scratch ledger`);
      }
      // `applied_steps_count` is DELIBERATELY not asserted. The obvious check —
      // "> 0, or the migration did nothing" — reports a false failure on any
      // database baselined the way this repository documents:
      // `prisma migrate resolve --applied 0_baseline` inserts the ledger row
      // without executing steps, so the column takes its DDL default of 0.
      // `restore-drill.js:567` already records the same trap.
    }
  }

  /* --- 6. the diff ------------------------------------------------------- */
  if (diffExitCode !== null && diffExitCode !== undefined) {
    const diffClass = classifyDiffExit(diffExitCode);
    if (diffClass === 'drift') {
      fail(
        'schema_drift',
        'the migration ledger does NOT reproduce apps/api/prisma/schema.prisma. `prisma migrate diff` ' +
          'reported, verbatim:\n' +
          indent(String(diffOutput || '(prisma reported a difference but printed nothing)').trim(), 4) +
          '\n\n    Write the missing migration:\n' +
          '      pnpm --filter @pilotage/api exec prisma migrate dev --name <what-changed>',
      );
    } else if (diffClass === 'tooling-error') {
      fail(
        'diff_tooling_failed',
        `\`prisma migrate diff --exit-code\` exited ${diffExitCode}, which is neither 0 (no difference) ` +
          'nor 2 (a difference) — the command itself failed. That is reported as a tooling failure and ' +
          'NEVER as drift: sending an operator to edit schema.prisma over a connection error is how a ' +
          'gate stops being read. Prisma said:\n' +
          indent(String(diffOutput || '(no output captured)').trim(), 4),
      );
    }
  }

  /* --- 7. cleanup -------------------------------------------------------- */
  if (scratchDropped === false) {
    fail(
      'scratch_cleanup_failed',
      `the scratch database was NOT dropped${scratchDropError ? `: ${scratchDropError}` : ''} — a leaked ` +
        'scratch database is a real, accumulating cost. It is its own verdict and it never downgrades a ' +
        'drift verdict (precedence puts schema_drift above it), but it is never swallowed either',
    );
  }

  const failures = findings.map((f) => f.message);
  let verdict = 'ok';
  for (const candidate of VERDICT_PRECEDENCE) {
    if (candidate === 'ok') break;
    if (findings.some((f) => f.verdict === candidate)) {
      verdict = candidate;
      break;
    }
  }

  return {
    verdict,
    exitCode: VERDICT_EXIT_CODES[verdict] ?? VERDICT_EXIT_CODES.unknown,
    failures,
  };
}

/* ================================================================== *
 * The impure layer: everything below touches a real server.
 * ================================================================== */

/** ASCII unit separator (0x1F): it cannot occur in a database or migration name,
 * so it is unambiguous as the column separator for `psql -A -F`. Written as an
 * escape, never as a literal control character. */
const FIELD_SEP = String.fromCharCode(31);

/**
 * `options.timeoutMs` reaches `spawnSync`'s own `timeout`, and that distinction is
 * the whole point (TOOL-10): bash's `timeout` demonstrably does NOT kill a hung
 * `docker` on Windows — `ps -W` on this machine still lists `docker` processes
 * dated Aug 10, orphaned by earlier runs that thought they had bounded it —
 * while `spawnSync`'s bound does, because libuv maps the kill to
 * `TerminateProcess`. Measured here: `spawnSync(node, ['-e','setTimeout(…,60000)'],
 * { timeout: 1500 })` returned at 1524 ms with `status null`, `signal SIGTERM`,
 * `error.code ETIMEDOUT`.
 *
 * That `ETIMEDOUT` is surfaced as a NAMED bound rather than a raw errno, the same
 * register `scripts/tracing-check.js:579-590` and `scripts/boot-check.js:228-234`
 * already use: an operator must read a number they can act on, not a mystery.
 *
 * MEASURED LIMITATION, stated rather than implied: the bound guarantees the CALL
 * returns. It does not guarantee the CLI's own grandchildren die — the orphans
 * above outlived their parents. Cleaning those up is a separate finding.
 */
function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, {
    encoding: 'utf8',
    input: options.input,
    cwd: options.cwd || REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    timeout: options.timeoutMs,
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  const stderr = timedOut
    ? `${command} did not answer within ${options.timeoutMs} ms and was killed`
    : result.error
      ? String(result.error.message)
      : result.stderr
        ? String(result.stderr)
        : '';
  return {
    status: result.error ? -1 : result.status,
    stdout: result.stdout ? String(result.stdout) : '',
    stderr,
    timedOut,
  };
}

function parseUrl(url) {
  const parsed = new URL(url);
  return {
    url,
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username || 'postgres'),
    password: decodeURIComponent(parsed.password || ''),
    database: decodeURIComponent((parsed.pathname || '/').slice(1)) || 'postgres',
  };
}

/* ------------------------------------------------------------------ *
 * The TCP preflight (TOOL-10)
 * ------------------------------------------------------------------ */

/**
 * The probe body, run in a CHILD via `node -e`, and the three reasons it is
 * spelled exactly this way.
 *
 * 1. **A child, not an in-process socket.** The whole call chain below is
 *    synchronous `spawnSync`; `net.Socket` is not. A child is the only way to ask
 *    a socket question from a synchronous ladder.
 * 2. **`-e` rather than re-entering `__filename` with a flag** (the spelling
 *    `scripts/boot-check.js:224` uses). That would put a second flag in front of
 *    `parseArgs`, whose surface `schema-drift-gate.spec.ts` pins to exactly
 *    `['--help','-h']` — a DNC-10 violation to buy a convenience.
 * 3. **Inline rather than a `scripts/tcp-probe.js`** (the spelling
 *    `scripts/tracing-check.js:577` uses). That adds a file to a SHARED path for
 *    one function.
 *
 * `process.argv[1..]` carries the arguments under `-e` (verified:
 * `node -e "console.log(process.argv[1])" foo` prints `foo`). Only `host`, `port`
 * and the budget are passed — NEVER a connection string, because argv is
 * published by the host process table (ADR-025 D6, the same exposure `--from-url`
 * was rejected for).
 *
 * It resolves the host with `dns.lookup(host, { all: true })` and races EVERY
 * resolved address, which is not defensive padding: `dns.lookup('localhost')`
 * returns `::1` first on this machine and on most CI runners, `ci.yml:156`
 * addresses the NAME `localhost`, and a PostgreSQL service published on IPv4 only
 * refuses on `::1` while `psql -h localhost` — which walks every address —
 * connects fine. A single-socket probe would report a working route as absent.
 *
 * Three states, never two. Only `ECONNREFUSED` from EVERY resolved address is
 * evidence the server is absent; a timeout, `ENOTFOUND`, `EHOSTUNREACH`, a child
 * that cannot start or output that will not parse are `indeterminate`, and
 * `indeterminate` descends the real ladder. The asymmetry is the design: a wrong
 * `open` costs one bounded ladder descent, a wrong `refused` is a gate that is red
 * on correct code with no route back to green.
 *
 * Read as EXECUTABLE SOURCE by the guard spec, because a string literal is code:
 * it therefore contains no `process.env` read, no `//` (which the spec's comment
 * blanker would eat to end of line, silently corrupting what the other assertions
 * read), and none of the tokens DNC-10 forbids.
 */
const TCP_PROBE_SOURCE = [
  "const net = require('node:net');",
  "const dns = require('node:dns');",
  'const host = process.argv[1];',
  'const port = Number(process.argv[2]);',
  'const budget = Number(process.argv[3]);',
  'const sockets = [];',
  'let settled = false;',
  'const finish = (state, detail, addresses) => {',
  '  if (settled) return;',
  '  settled = true;',
  '  for (const socket of sockets) socket.destroy();',
  '  process.stdout.write(JSON.stringify({ state: state, detail: detail, addresses: addresses }));',
  '};',
  'dns.lookup(host, { all: true }, (lookupError, resolved) => {',
  "  if (lookupError) return finish('indeterminate', String(lookupError.code || lookupError.message), []);",
  '  const list = (resolved || []).map((entry) => entry.address);',
  "  if (list.length === 0) return finish('indeterminate', 'the host resolved to no address', []);",
  '  const errors = [];',
  '  let pending = list.length;',
  '  for (const address of list) {',
  '    const socket = net.connect({ host: address, port: port });',
  '    sockets.push(socket);',
  '    socket.setTimeout(budget);',
  "    socket.once('connect', () => finish('open', 'connected to ' + address, list));",
  "    socket.once('timeout', () => socket.destroy(new Error('timed out after ' + budget + ' ms')));",
  "    socket.once('error', (error) => {",
  "      errors.push(address + ' ' + String(error.code || error.message));",
  '      pending -= 1;',
  '      if (pending > 0) return;',
  "      const allRefused = errors.every((entry) => entry.indexOf('ECONNREFUSED') !== -1);",
  "      finish(allRefused ? 'refused' : 'indeterminate', errors.join('; '), list);",
  '    });',
  '  }',
  '});',
].join('\n');

/** A resolved address that can only be this machine. Used to decide whether the
 * container route (which connects from INSIDE the container, not through the host
 * address) is settled by a host-side probe. */
function isLoopbackAddress(address) {
  const value = String(address);
  return value === '::1' || value === '0:0:0:0:0:0:0:1' || /^127\./.test(value);
}

/**
 * The one predicate that may stop the WHOLE ladder, routes A, B and C together.
 *
 * Both conditions, and neither is decoration: `refused` (never a timeout, never a
 * resolution failure — those are not evidence of absence) AND every resolved
 * address is on this machine (or route C, which connects from inside the
 * container, is not covered by a host-side probe at all).
 */
function preflightSettlesTheAddress(preflight) {
  return Boolean(preflight) && preflight.state === 'refused' && preflight.loopback === true;
}

/**
 * Is anything accepting TCP at `host:port`?
 *
 * Returns `{ open, state, detail, addresses, loopback, elapsedMs }`.
 * `state` is `'open' | 'refused' | 'indeterminate'` and it is the field callers
 * must branch on: `open` is false for BOTH `refused` and `indeterminate`, because
 * a probe that could not answer is never treated as a live server — but only
 * `refused` is evidence strong enough to stop a ladder.
 *
 * The `spawnSync` carries its own hard bound on top of the in-child budget, so
 * even the preflight is bounded.
 */
function probeAddress(host, port, timeoutMs = TCP_PREFLIGHT_TIMEOUT_MS) {
  const requested = Number(timeoutMs);
  const budget = Number.isFinite(requested) && requested > 0 ? requested : TCP_PREFLIGHT_TIMEOUT_MS;
  const startedAt = Date.now();
  const child = run(
    process.execPath,
    ['-e', TCP_PROBE_SOURCE, String(host), String(port), String(budget)],
    { timeoutMs: budget + TCP_PREFLIGHT_SPAWN_SLACK_MS },
  );
  const elapsedMs = Date.now() - startedAt;

  let answer = null;
  try {
    answer = JSON.parse(child.stdout.trim());
  } catch {
    answer = null;
  }

  if (!answer || typeof answer.state !== 'string') {
    // A child that could not answer says nothing about the server. Indeterminate,
    // so the caller descends the real ladder rather than concluding absence.
    return {
      open: false,
      state: 'indeterminate',
      detail: child.stderr.trim() || `the probe produced no verdict (exit ${child.status})`,
      addresses: [],
      loopback: false,
      elapsedMs,
    };
  }

  const addresses = Array.isArray(answer.addresses) ? answer.addresses : [];
  const loopback = addresses.length > 0 && addresses.every(isLoopbackAddress);
  if (answer.state === 'open') {
    return {
      open: true,
      state: 'open',
      detail: String(answer.detail || 'connected'),
      addresses,
      loopback,
      elapsedMs,
    };
  }
  const state = answer.state === 'refused' ? 'refused' : 'indeterminate';
  return {
    open: false,
    state,
    detail: String(answer.detail || state),
    addresses,
    loopback,
    elapsedMs,
  };
}

/**
 * The Prisma CLI is tooling too, and it is never assumed to be on PATH.
 *
 * Resolved as a module entry and spawned with `process.execPath` on purpose: a
 * `.bin` shim is a `.CMD` file on Windows, and `spawnSync` with `shell: false`
 * cannot execute one — a trap this repository has already hit.
 */
function resolvePrismaCli() {
  const tried = [];
  try {
    const entry = require.resolve('prisma/build/index.js', { paths: [API_DIR] });
    return { command: process.execPath, prefix: [entry], detail: `node ${rel(entry)}`, tried };
  } catch (error) {
    tried.push(`require.resolve('prisma/build/index.js', { paths: ['apps/api'] }) — ${error.message}`);
  }
  const probe = run('pnpm', ['--filter', '@pilotage/api', 'exec', 'prisma', '--version'], {
    timeoutMs: PRISMA_CLI_PROBE_TIMEOUT_MS,
  });
  if (probe.status === 0) {
    return {
      command: 'pnpm',
      prefix: ['--filter', '@pilotage/api', 'exec', 'prisma'],
      detail: 'pnpm --filter @pilotage/api exec prisma',
      tried,
    };
  }
  tried.push(
    `pnpm --filter @pilotage/api exec prisma — ${probe.stderr.trim() || probe.stdout.trim() || `exit ${probe.status}`}`,
  );
  return { command: null, prefix: [], detail: null, tried };
}

/**
 * `input` is not optional plumbing — it is the reason route A works at all, and
 * omitting it is a silent no-op rather than an error: `prisma db execute --stdin`
 * handed an EMPTY stdin prints "Script executed successfully" and exits 0 having
 * run nothing. That defect was committed in the first draft of this file and
 * caught by the emptiness assertion below (the scratch database did not exist),
 * which is the check earning its place on the day it was written.
 */
function prismaRun(cli, argv, envOverlay, input) {
  if (!cli || !cli.command) {
    return { status: -1, stdout: '', stderr: 'the Prisma CLI could not be resolved', output: '' };
  }
  const result = run(cli.command, [...cli.prefix, ...argv], { cwd: API_DIR, env: envOverlay, input });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

/**
 * The SQL routes, in the order they are TRIED, with every one of them NAMED in
 * the failure message (DNC-08 / FR-9). A route that errors falls through to the
 * next; exhausting them is a failure, never a skip.
 *
 *   A. `prisma db execute --schema <schema> --stdin` with DATABASE_URL in the
 *      child environment. Execute-only (it returns no rows). MEASURED before
 *      this file was written: Prisma 5.22 does NOT wrap the script in a
 *      transaction, so `CREATE DATABASE` is accepted — the one thing that had to
 *      be established by hand rather than assumed.
 *   B. a host-side `psql`, password through the environment, never argv
 *      (ADR-025 D6). This is the route that works in `ci.yml`'s build job —
 *      `ubuntu-latest` ships a PostgreSQL client, and a service container is NOT
 *      reachable as `pilotage_postgres`. It is tried before the container route
 *      for exactly that reason: the over-the-wire route is the portable one.
 *   C. `docker exec -i pilotage_postgres psql`, SQL on STDIN — never `-c`, never
 *      through a shell, because a heredoc through `sh -c` breaks on CRLF and this
 *      repository is developed on Windows. Guarded by the container publishing
 *      the port the URL addresses, so the two routes cannot address two different
 *      clusters. This is the route that works on the local stack, where there is
 *      no host `psql`.
 */
function makeSqlRoutes(cli, source) {
  const attempts = [];
  const psqlFlags = (database) => [
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
    '-t',
    '-A',
    '-F',
    FIELD_SEP,
    '--no-psqlrc',
    '-d',
    database,
  ];

  /* ---------------------------------------------------------------- *
   * The TCP preflight, and why one probe of one address settles a ladder of
   * three routes (TOOL-10).
   *
   * ROUTES A AND B: settled exactly. Both open a TCP connection to
   * `source.host:source.port` — A through `prisma db execute` with
   * `DATABASE_URL` in the child environment, B through `psql -h -p`. Every URL
   * this script ever opens is that same address: `buildScratchUrl()` and
   * `deriveMaintenanceUrl()` replace ONLY the database path segment (the former
   * is pinned to that by `schema-drift-gate.spec.ts`'s "replaces ONLY the
   * database segment" case), so host, port, user, password and query string are
   * invariant across the maintenance URL, the scratch URL and the base URL. One
   * probe therefore covers all of them.
   *
   * ROUTE C: settled only when the address is LOOPBACK, and the asymmetry is
   * real rather than pedantic. `docker exec pilotage_postgres psql` does not
   * traverse the host address at all — it connects from inside the container.
   * What ties it to the probe is `containerAddressesTheUrl()`, which requires
   * the container to PUBLISH the URL's port, and `infra/docker-compose.yml`
   * publishes `${POSTGRES_PORT}:5432` on all interfaces. So when the URL names
   * this machine, nothing listening on that host port means either no such
   * publication or a dead proxy, and C is refused by its own guard either way.
   * When the URL names something else — a compose service name, a remote — the
   * host probe says nothing about C, so C is still TRIED, now bounded — its
   * port lookup at DOCKER_TIMEOUT_MS, its SQL at DOCKER_EXEC_TIMEOUT_MS, which
   * are different numbers for the reason stated at their declarations. That
   * direction costs seconds in a configuration this repository does not
   * currently use; the other direction would be a false RED.
   *
   * Probed ONCE, LAZILY (on first `query()`/`exec()`, never at construction —
   * `openSqlRoutes()` is called in cheap contexts), memoised on this closure and
   * NEVER at module scope: a `LOCAL_URL` routes object and a dead-address one
   * coexist in the same jest process, and a module-global memo would answer for
   * the wrong address.
   * ---------------------------------------------------------------- */
  let preflight = null;
  const runPreflight = () => {
    if (preflight === null) preflight = probeAddress(source.host, source.port);
    return preflight;
  };

  const preflightHeadline = (pre) =>
    `nothing is accepting TCP at ${source.host}:${source.port} (${pre.detail} after ${pre.elapsedMs} ms)`;

  /** ONE composer for the short-circuit narration, used by both `query()` and
   * `exec()`. Two hand-written copies of a message this specific diverge, and the
   * lines are load-bearing: DNC-08 requires a run to describe itself, and the
   * guard spec asserts the output names `prisma db execute`, `psql` and
   * `pilotage_postgres`. They are pushed into `attempts[]` so `exec()`'s
   * `attempts[attempts.length - 1]` fallback still names route C. */
  let preflightRecorded = false;
  const recordPreflight = (pre) => {
    if (preflightRecorded) return;
    preflightRecorded = true;
    attempts.push(
      `preflight — ${preflightHeadline(pre)}. One probe of that address settles the ladder:`,
      'A. prisma db execute — it executes against that same address, so it cannot connect either',
      'B. host psql — it connects to that same address over the wire, so it cannot connect either',
      pre.loopback
        ? `C. docker exec ${DEFAULT_CONTAINER} psql — it requires the container to publish that same ` +
            'port on this machine, and nothing is listening there'
        : `C. docker exec ${DEFAULT_CONTAINER} psql — it connects from INSIDE the container, which a ` +
            `host-side probe does not settle, so it is still tried (its port lookup bounded at ` +
            `${DOCKER_TIMEOUT_MS} ms, its SQL at ${DOCKER_EXEC_TIMEOUT_MS} ms)`,
    );
  };

  let containerUsable = null;
  const containerAddressesTheUrl = () => {
    if (containerUsable !== null) return containerUsable;
    const mapped = run('docker', ['port', DEFAULT_CONTAINER, '5432/tcp'], {
      timeoutMs: DOCKER_TIMEOUT_MS,
    });
    if (mapped.status !== 0 || mapped.stdout.trim() === '') {
      attempts.push(
        `C. docker exec ${DEFAULT_CONTAINER} psql — ${mapped.stderr.trim() || 'the container publishes no port for 5432/tcp'}`,
      );
      containerUsable = false;
      return false;
    }
    const ports = mapped.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(line.lastIndexOf(':') + 1));
    containerUsable = ports.includes(String(source.port));
    if (!containerUsable) {
      attempts.push(
        `C. docker exec ${DEFAULT_CONTAINER} psql — the container publishes 5432 on [${ports.join(', ')}] ` +
          `but the resolved URL addresses port ${source.port}, so they are not the same server`,
      );
    }
    return containerUsable;
  };

  const psqlHost = (database, sql) =>
    run('psql', ['-h', source.host, '-p', source.port, '-U', source.user, ...psqlFlags(database)], {
      input: sql,
      env: source.password ? { PGPASSWORD: source.password } : undefined,
    });

  const psqlContainer = (database, sql) =>
    run('docker', ['exec', '-i', DEFAULT_CONTAINER, 'psql', '-U', source.user, ...psqlFlags(database)], {
      input: sql,
      timeoutMs: DOCKER_EXEC_TIMEOUT_MS,
    });

  /** Rows, as arrays of strings. Throws if no route could answer. */
  const query = (database, sql) => {
    const pre = runPreflight();
    if (pre.state === 'refused') {
      recordPreflight(pre);
    } else {
      const host = psqlHost(database, sql);
      if (host.status === 0) return splitRows(host.stdout);
      attempts.push(`B. host psql — ${host.stderr.trim() || `exit ${host.status}`}`);
    }
    if (!preflightSettlesTheAddress(pre) && containerAddressesTheUrl()) {
      const container = psqlContainer(database, sql);
      if (container.status === 0) return splitRows(container.stdout);
      attempts.push(`C. docker exec ${DEFAULT_CONTAINER} psql — ${container.stderr.trim() || `exit ${container.status}`}`);
    }
    const error = new Error(
      `no SQL route could answer. Tried:\n${indent(attempts.join('\n'), 4)}\n` +
        '    (route A, `prisma db execute`, can execute but returns no rows, so it cannot answer a query)',
    );
    error.routeFailure = true;
    throw error;
  };

  /** Execute-only. Returns `{ ok, detail }` rather than throwing, because every
   * caller has a verdict for a failure. */
  const exec = (url, sql) => {
    const target = parseUrl(url);
    // The preflight is memoised for ONE address, and `exec` takes a URL. Today
    // every caller passes a URL derived from `source` (the maintenance URL and the
    // scratch URL both replace only the database segment), but nothing enforced
    // it, and a memoised answer applied to a different server is a wrong verdict
    // waiting for the next caller. So it is enforced here rather than assumed.
    if (target.host !== source.host || String(target.port) !== String(source.port)) {
      throw new Error(
        `refusing to run SQL against ${target.host}:${target.port} through routes opened for ` +
          `${source.host}:${source.port} — these routes probed and describe one server, and reusing them ` +
          'for another would report the wrong one',
      );
    }

    const pre = runPreflight();
    let detailA;
    let detailB;
    if (pre.state === 'refused') {
      recordPreflight(pre);
      detailA = `A. prisma db execute — not attempted: ${preflightHeadline(pre)}`;
      detailB = `B. host psql — not attempted: ${preflightHeadline(pre)}`;
    } else {
      const viaPrisma = prismaRun(
        cli,
        ['db', 'execute', '--schema', SCHEMA_PATH, '--stdin'],
        { DATABASE_URL: url },
        sql,
      );
      if (viaPrisma.status === 0) return { ok: true, detail: 'prisma db execute' };
      detailA = `A. prisma db execute — ${redactConnectionUrl(viaPrisma.output.trim()) || `exit ${viaPrisma.status}`}`;

      const host = psqlHost(target.database, sql);
      if (host.status === 0) return { ok: true, detail: 'host psql' };
      detailB = `B. host psql — ${host.stderr.trim() || `exit ${host.status}`}`;
    }

    if (!preflightSettlesTheAddress(pre) && containerAddressesTheUrl()) {
      const container = psqlContainer(target.database, sql);
      if (container.status === 0) return { ok: true, detail: `docker exec ${DEFAULT_CONTAINER} psql` };
      return {
        ok: false,
        detail: `${detailA}\n${detailB}\nC. docker exec ${DEFAULT_CONTAINER} psql — ${container.stderr.trim() || `exit ${container.status}`}`,
      };
    }
    return {
      ok: false,
      detail: `${detailA}\n${detailB}\n${
        attempts[attempts.length - 1] || `C. docker exec ${DEFAULT_CONTAINER} psql — unavailable`
      }`,
    };
  };

  return { query, exec, attempts };
}

function splitRows(stdout) {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.split(FIELD_SEP));
}

/**
 * The route ladder, resolved from an address. Exported as PLUMBING, not as a
 * seam: it can create and drop databases and read catalogs, and it cannot change
 * a verdict — `evaluateDrift` is the only thing that decides one. The guard spec
 * uses it to build the scratch database its end-to-end cases need, over the same
 * ladder the CLI uses, so those cases work in CI (host `psql`) and locally
 * (`docker exec`) without the spec knowing which route it got.
 */
function openSqlRoutes(baseUrl) {
  const source = parseUrl(baseUrl || process.env.DATABASE_URL || DEFAULT_DATABASE_URL);
  return makeSqlRoutes(resolvePrismaCli(), source);
}

/**
 * A POSITIVE reachability probe, exported so the guard spec can decide whether
 * its end-to-end block can run — and say loudly when it cannot, rather than
 * guessing from `process.env.CI`.
 *
 * Its CONTRACT IS UNCHANGED: true only when a `SELECT 1;` returned a row. What
 * changed (TOOL-10) is the order — the TCP preflight runs BEFORE
 * `resolvePrismaCli()`, because this function is called at MODULE SCOPE by
 * `schema-drift-gate.spec.ts` and every jest worker that loads that file pays it.
 * The reorder cannot change the result: a refused loopback address returns false
 * either way, and a missing CLI still returns false below.
 */
function probeServer(baseUrl) {
  const url = baseUrl || process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  let source;
  try {
    source = parseUrl(url);
  } catch {
    return false;
  }
  // Only a refused loopback address short-circuits. An indeterminate probe
  // descends the real ladder, because "the probe could not answer" is not
  // evidence the server is absent.
  const preflight = probeAddress(source.host, source.port);
  if (preflightSettlesTheAddress(preflight)) return false;
  const cli = resolvePrismaCli();
  if (!cli.command) return false;
  try {
    const rows = makeSqlRoutes(cli, source).query('postgres', 'SELECT 1;');
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Directories only. `readdirSync` also returns `migration_lock.toml`, and a
 * check that demanded a migration by that name would fail on every run for ever
 * and would then be "fixed" by loosening the check. */
function migrationDirectories(dir) {
  const target = dir || MIGRATIONS_DIR;
  if (!existsSync(target)) return [];
  return readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Apply a migrations directory to the scratch database.
 *
 * A FUNCTION export, never a CLI flag (DNC-10): the guard spec proves "a
 * migration that does not execute fails the check" by handing this a temp
 * directory holding deliberately invalid SQL, and the CLI itself always passes
 * the fixed repository path. `prisma migrate deploy` finds its migrations beside
 * the schema it is given, so the directory must have a `schema.prisma` sibling —
 * the repository's own layout, and what the spec's fixture reproduces.
 */
function deployMigrations({ migrationsDir, scratchUrl, cli } = {}) {
  const prismaDir = dirname(migrationsDir || MIGRATIONS_DIR);
  const schemaPath = join(prismaDir, 'schema.prisma');
  if (!existsSync(schemaPath)) {
    return {
      status: -1,
      stdout: '',
      stderr: `no schema.prisma beside ${rel(migrationsDir || MIGRATIONS_DIR)}`,
      output: `no schema.prisma beside ${rel(migrationsDir || MIGRATIONS_DIR)}`,
    };
  }
  return prismaRun(cli || resolvePrismaCli(), ['migrate', 'deploy', '--schema', schemaPath], buildChildEnv(scratchUrl));
}

/**
 * Diff the scratch DATABASE against a datamodel.
 *
 * `--from-schema-datasource` reads only the datasource block of the repository
 * schema, whose url is `env("DATABASE_URL")` — so the "from" side is the scratch
 * database addressed by the child environment, and no credential enters `argv`
 * (ADR-025 D6). NOT `--from-migrations`: see the header measurement.
 *
 * `--exit-code` makes the result trinary; `classifyDiffExit` is the only place
 * that number is interpreted.
 */
function runDiff({ datamodelPath, scratchUrl, script = false, cli } = {}) {
  const argv = [
    'migrate',
    'diff',
    '--from-schema-datasource',
    SCHEMA_PATH,
    '--to-schema-datamodel',
    datamodelPath || SCHEMA_PATH,
  ];
  argv.push(script ? '--script' : '--exit-code');
  return prismaRun(cli || resolvePrismaCli(), argv, buildChildEnv(scratchUrl));
}

const SCRATCH_TABLE_COUNT_SQL = [
  'SELECT count(*)::text FROM information_schema.tables',
  "WHERE table_schema = 'public' AND table_type = 'BASE TABLE';",
].join('\n');

const LEDGER_SQL = [
  'SELECT migration_name, (finished_at IS NOT NULL)::text, (rolled_back_at IS NOT NULL)::text',
  '  FROM "_prisma_migrations" ORDER BY migration_name;',
].join('\n');

/** `psql -A -t` renders an uncast boolean as `t`/`f` and a `::text`-cast one as
 * `true`/`false`. Accepting both is not laxness: reading it wrong is silent. */
const isTrue = (value) => value === 'true' || value === 't';

/* ------------------------------------------------------------------ *
 * The check
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/schema-drift-check.js');
      console.log('');
      console.log('  Creates a disposable scratch database, applies apps/api/prisma/migrations to it,');
      console.log('  and diffs that database against apps/api/prisma/schema.prisma.');
      console.log('  Exit 0 only if the ledger reproduces the datamodel.');
      process.exit(0);
    }
    if (arg.startsWith('-')) {
      console.error(`✗ unknown option ${arg}`);
      console.error('  This script has no bypass option. See the USAGE block in its header.');
      process.exit(1);
    }
    console.error(`✗ unexpected argument ${arg}`);
    console.error('  This script has no bypass option. See the USAGE block in its header.');
    process.exit(1);
  }
  return {};
}

function main() {
  parseArgs(process.argv.slice(2));

  const baseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;

  const state = {
    toolingAvailable: true,
    toolingDetail: null,
    serverReachable: null,
    migrationDirectories: null,
    scratchName: null,
    sourceDatabase: null,
    scratchCreated: null,
    scratchCreateError: null,
    scratchWasEmpty: null,
    migrateDeployOk: null,
    migrateDeployOutput: '',
    scratchTableCount: null,
    ledgerRows: null,
    diffExitCode: null,
    diffOutput: '',
    scratchDropped: null,
    scratchDropError: null,
    fatalError: null,
  };

  let source;
  try {
    source = parseUrl(baseUrl);
  } catch (error) {
    console.error(`✗ DATABASE_URL is not a usable connection string: ${redactConnectionUrl(String(error.message))}`);
    state.serverReachable = false;
    return report(state);
  }
  state.sourceDatabase = source.database;

  // `Date.now()` alone collides when two runs start in the same millisecond; the
  // pid keeps the name unique while staying inside `/^schema_drift_\d+$/`, which
  // is the pattern every safety check is written against and which nothing may
  // widen.
  const scratchName = `schema_drift_${Date.now()}${process.pid}`;
  const maintenanceUrl = deriveMaintenanceUrl(baseUrl);

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  SCHEMA DRIFT CHECK — the ledger must reproduce schema.prisma');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  server     : ${source.host}:${source.port} as ${source.user}`);
  console.log(`  url        : ${redactConnectionUrl(baseUrl)}`);
  console.log(`  scratch    : ${scratchName}`);
  console.log('');

  const cli = resolvePrismaCli();
  if (!cli.command) {
    state.toolingAvailable = false;
    state.toolingDetail = `the Prisma CLI could not be resolved. Tried:\n${indent(cli.tried.join('\n'), 4)}`;
    return report(state);
  }
  console.log(`▶ prisma CLI : ${cli.detail}`);

  const routes = makeSqlRoutes(cli, source);
  let scratchCreated = false;

  const cleanup = () => {
    if (!scratchCreated) return;
    scratchCreated = false;
    const dropped = dropScratch(routes, maintenanceUrl, scratchName, source.database);
    state.scratchDropped = dropped.ok;
    state.scratchDropError = dropped.ok ? null : dropped.detail;
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.error(`\n✗ ${signal} received — dropping the scratch database before exiting`);
      cleanup();
      process.exit(1);
    });
  }
  process.on('uncaughtException', (error) => {
    console.error(`\n✗ ${error && error.message ? error.message : error}`);
    cleanup();
    process.exit(1);
  });

  const startedAt = Date.now();

  // The body never reports and never exits: every exit path — an early failure, a
  // crash, a signal — passes through the same cleanup and the same single
  // `report()` call, or a run could end without dropping its scratch database or
  // without stating a verdict.
  const check = () => {
    /* -- reachability -------------------------------------------------- */
    try {
      routes.query('postgres', 'SELECT 1;');
      state.serverReachable = true;
      console.log(`▶ server reachable at ${source.host}:${source.port}`);
    } catch (error) {
      state.serverReachable = false;
      if (error && error.routeFailure) {
        state.toolingAvailable = false;
        state.toolingDetail = String(error.message);
      }
      console.error(`✗ ${redactConnectionUrl(String((error && error.message) || error))}`);
      return;
    }

    /* -- non-vacuity: the ledger on disk -------------------------------- */
    state.migrationDirectories = migrationDirectories();
    console.log(`▶ ledger on disk : ${state.migrationDirectories.length} migration director(y|ies)`);
    if (state.migrationDirectories.length === 0) return;

    /* -- the scratch database ------------------------------------------- */
    state.scratchName = scratchName;
    if (!isSafeScratchTarget(scratchName, source.database)) return;

    sweepOrphans(routes, maintenanceUrl, source.database);

    // TEMPLATE template0 on purpose: template1 on a machine where someone once
    // seeded it would arrive pre-populated and defeat the emptiness assertion.
    const created = routes.exec(
      maintenanceUrl,
      `CREATE DATABASE "${scratchName}" TEMPLATE template0;`,
    );
    state.scratchCreated = created.ok;
    if (!created.ok) {
      state.scratchCreateError = created.detail;
      console.error('✗ could not create the scratch database. Routes tried:');
      console.error(indent(created.detail, 4));
      return;
    }
    scratchCreated = true;
    state.scratchDropped = false;
    console.log(`▶ scratch created via ${created.detail}`);

    const before = Number(routes.query(scratchName, SCRATCH_TABLE_COUNT_SQL)[0][0]);
    state.scratchWasEmpty = before === 0;
    if (!state.scratchWasEmpty) {
      console.error(`✗ the freshly created scratch database already holds ${before} base tables`);
      return;
    }

    /* -- the ledger EXECUTES -------------------------------------------- */
    const scratchUrl = buildScratchUrl(baseUrl, scratchName);
    process.stdout.write('▶ migrate deploy … ');
    const deployed = deployMigrations({ migrationsDir: MIGRATIONS_DIR, scratchUrl, cli });
    state.migrateDeployOk = deployed.status === 0;
    state.migrateDeployOutput = redactConnectionUrl(deployed.output);
    console.log(state.migrateDeployOk ? 'applied' : 'FAILED');
    if (!state.migrateDeployOk) {
      console.error(indent(state.migrateDeployOutput.trim(), 4));
      return;
    }

    state.scratchTableCount = Number(routes.query(scratchName, SCRATCH_TABLE_COUNT_SQL)[0][0]);
    state.ledgerRows = routes
      .query(scratchName, LEDGER_SQL)
      .map(([migrationName, finished, rolledBack]) => ({
        migrationName,
        finished: isTrue(finished),
        rolledBack: isTrue(rolledBack),
      }));
    console.log(
      `▶ scratch built : ${state.scratchTableCount} base tables, ${state.ledgerRows.length} ledger row(s)`,
    );

    /* -- the diff -------------------------------------------------------- */
    process.stdout.write('▶ migrate diff … ');
    const diff = runDiff({ datamodelPath: SCHEMA_PATH, scratchUrl, cli });
    // `null` is normalised to -1 here, and the distinction is load-bearing:
    // `spawnSync` reports `null` when the child was killed by a signal, while
    // `diffExitCode: null` in the state object means "the diff was never
    // attempted", which REQUIRED_EVIDENCE reports as `unknown`. Both are
    // failures, and both must stay distinguishable — a killed diff is a tooling
    // failure that DID happen, and reporting it as "no evidence" would hide it.
    state.diffExitCode = diff.status === null ? -1 : diff.status;
    state.diffOutput = redactConnectionUrl(diff.output);
    const diffClass = classifyDiffExit(diff.status);
    console.log(`exit ${diff.status} (${diffClass})`);

    if (diffClass === 'drift') {
      // Prisma's own words, verbatim and indented — never a paraphrase such as
      // "schemas differ". That output is what NAMES the drifted object, which is
      // acceptance criterion 1.
      console.error('');
      console.error(indent(state.diffOutput.trim(), 4));
      const asScript = runDiff({ datamodelPath: SCHEMA_PATH, scratchUrl, script: true, cli });
      if (asScript.status === 0) {
        console.error('');
        console.error('  The SQL a migration would have to contain:');
        console.error(indent(redactConnectionUrl(asScript.stdout).trim(), 4));
      } else {
        // Reported, and it does not change the verdict: the drift is already
        // established by the first invocation.
        console.error('  (could not render the equivalent SQL — the diff verdict is unaffected)');
      }
    }
  };

  try {
    check();
  } catch (error) {
    // A crash is a FAILURE with a verdict, not a stack trace and an unknown
    // state: the run is reported as `unknown`, exit 1.
    state.fatalError = redactConnectionUrl(String((error && error.message) || error));
    console.error(`\n✗ ${state.fatalError}`);
  } finally {
    cleanup();
  }

  console.log(`▶ elapsed : ${Date.now() - startedAt} ms`);
  return report(state);
}

/**
 * Drop the scratch database.
 *
 * The two safety conditions are re-checked HERE, immediately before the statement
 * is issued, and not only at the call site. This is the one place this file can
 * destroy something. `WITH (FORCE)` (Postgres 15) so a lingering session cannot
 * turn cleanup into a false `scratch_cleanup_failed`.
 */
function dropScratch(routes, maintenanceUrl, scratchName, sourceDatabase) {
  if (!isSafeScratchTarget(scratchName, sourceDatabase)) {
    const detail = `REFUSING to drop "${scratchName}": it does not match ${SCRATCH_NAME_PATTERN} or it is the source database`;
    console.error(`✗ ${detail}`);
    return { ok: false, detail };
  }
  const dropped = routes.exec(maintenanceUrl, `DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE);`);
  if (!dropped.ok) {
    console.error(`✗ could not drop the scratch database "${scratchName}". Routes tried:`);
    console.error(indent(dropped.detail, 4));
    console.error('  Run this by hand — a leaked scratch database accumulates:');
    console.error(`    docker exec ${DEFAULT_CONTAINER} psql -U <user> -d postgres -c 'DROP DATABASE "${scratchName}" WITH (FORCE);'`);
    return dropped;
  }
  console.log(`▶ scratch database "${scratchName}" dropped`);
  return dropped;
}

/** Sweep databases left by a killed earlier run. Name-pattern-guarded, exactly
 * like the drop path: an orphan is evidence a previous run died somewhere the
 * cleanup did not cover, and the next `CREATE DATABASE` would otherwise fail for
 * the wrong reason. */
function sweepOrphans(routes, maintenanceUrl, sourceDatabase) {
  let orphans = [];
  try {
    orphans = routes
      .query('postgres', "SELECT datname::text FROM pg_database WHERE datname LIKE 'schema\\_drift\\_%';")
      .map((row) => row[0]);
  } catch {
    return;
  }
  for (const orphan of orphans) {
    console.error(`⚠ leftover scratch database from an earlier run: ${orphan} — dropping it`);
    dropScratch(routes, maintenanceUrl, orphan, sourceDatabase);
  }
}

function report(state) {
  const outcome = evaluateDrift(state);

  if (outcome.verdict !== 'ok') {
    console.error('');
    console.error('══════════════════════════════════════════════════════════════');
    console.error(`  SCHEMA DRIFT CHECK: FAIL — ${outcome.verdict}`);
    console.error('══════════════════════════════════════════════════════════════');
    for (const failure of outcome.failures) console.error(`\n✗ ${failure}`);
    console.error('');
    console.error('  Verdict meanings and the operator action for each are in');
    console.error('  docs/runbooks/backup-restore-drill.md §8 and docs/adr/ADR-027-schema-drift-gate-needs-a-database.md.');
    console.error('');
    process.exitCode = outcome.exitCode;
    return outcome;
  }

  console.log('');
  console.log(
    `SCHEMA DRIFT CHECK: PASS — ${outcome.verdict}: ${state.migrationDirectories.length} migration(s) ` +
      `built ${state.scratchTableCount} tables and the datamodel adds nothing`,
  );
  process.exitCode = 0;
  return outcome;
}

function rel(path) {
  return path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1).split(sep).join('/') : path;
}

function indent(text, spaces = 4) {
  const pad = ' '.repeat(spaces);
  return String(text)
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

module.exports = {
  evaluateDrift,
  classifyDiffExit,
  isSafeScratchTarget,
  buildScratchUrl,
  buildChildEnv,
  deriveMaintenanceUrl,
  redactConnectionUrl,
  deployMigrations,
  runDiff,
  probeServer,
  probeAddress,
  openSqlRoutes,
  DEFAULT_DATABASE_URL,
  TCP_PREFLIGHT_TIMEOUT_MS,
  DOCKER_TIMEOUT_MS,
  DOCKER_EXEC_TIMEOUT_MS,
  migrationDirectories,
  SCRATCH_NAME_PATTERN,
  MIGRATIONS_DIR,
  SCHEMA_PATH,
  MIN_EXPECTED_TABLES,
  VERDICT_EXIT_CODES,
  VERDICT_PRECEDENCE,
};

// NOT a bare `main()` at module scope. The guard spec `require()`s this file to
// reach the pure exports, and it runs inside `pnpm test` on every developer's
// machine: a bare call would create and drop a database as a side effect of
// importing a module.
if (require.main === module) main();
