import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

/**
 * S-E02-5 / PF-03 (residual half) — guard for the schema-drift gate.
 *
 * WHAT THE DEFECT IS, AND WHY EVERY EXISTING GATE MISSES IT
 * ---------------------------------------------------------
 * Editing `apps/api/prisma/schema.prisma` without writing a migration passed
 * every gate this repository had. `scripts/ci-gate.sh` runs `prisma generate`, so
 * it generates a client for a schema no migration produces; lint, typecheck,
 * build and boot then all validate against that fiction, and
 * `infra/docker/migrate-entrypoint.sh` runs `migrate deploy` and only
 * `migrate deploy`, so the edit reaches no database ever. The application
 * compiles against a column that does not exist and fails at the first query.
 *
 * DIVISION OF LABOUR
 * ------------------
 *   • `scripts/schema-drift-check.js` — creates a disposable scratch database,
 *     applies `apps/api/prisma/migrations` to it, diffs THAT DATABASE against the
 *     datamodel, drops it on every exit path. Its exit code is the gate.
 *   • this file — drives the gate's pure exports in BOTH directions so every
 *     assertion here can actually fail, proves the stage is wired into
 *     `ci-gate.sh` AND `ci.yml`, and proves the absence of a bypass by EXECUTING
 *     the script rather than by grepping it.
 *
 * TWO THINGS THIS FILE PINS THAT LOOK LIKE STYLE AND ARE NOT
 * ---------------------------------------------------------
 * 1. **`--from-migrations` must never reappear.** Measured on this repository
 *    unchanged, before the gate was written: `migrate diff --from-migrations
 *    ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma
 *    --exit-code` returns **exit 2** and reports all five PostgreSQL extensions
 *    (`btree_gin`, `citext`, `pg_trgm`, `pgcrypto`, `uuid-ossp`) as
 *    `[+] Added extensions`, although `0_baseline/migration.sql` lines 2-14
 *    create every one of them with `CREATE EXTENSION IF NOT EXISTS`. The same
 *    comparison against the database those migrations BUILD returns
 *    `No difference detected`, exit 0. A gate spelled the first way is
 *    permanently red on a correct repository, with no route back to green except
 *    breaking correct code — the `S-E06-3` trap. The next maintainer's obvious
 *    "simplification" is to delete the scratch database, so its absence is a test.
 * 2. **The diff exit code is trinary.** `--exit-code` returns 0 for no
 *    difference, 2 for a difference, and **1 for its own failure** — measured in
 *    both directions (a missing datamodel path and a dead server both return 1).
 *    Reading `!== 0` as drift sends an operator to edit `schema.prisma` over a
 *    connection error; reading `!== 2` as agreement reports a crashed Prisma as
 *    success, which is DNC-08 committed inside the DNC-08 enforcer.
 *
 * WHY THE DIFF IS TAKEN WITH `--from-schema-datasource` AND NOT `--from-url`
 * -------------------------------------------------------------------------
 * `--from-url <scratchUrl>` puts `pilotage:pilotage@…` into a child process's
 * `argv`, which the host process table publishes — the exposure `ADR-025 D6`
 * forbids in as many words. `schema.prisma`'s datasource is already
 * `url = env("DATABASE_URL")`, so `--from-schema-datasource <schema>` with
 * `DATABASE_URL` set in the CHILD ENVIRONMENT ONLY addresses the same database by
 * the same URL with no credential in `argv`. Measured equivalent in both
 * directions (exit 0 clean, exit 2 drifted). `buildChildEnv()` re-validates that
 * URL against the scratch-name pattern immediately before every spawn, which is
 * what stops a missing override from running the ledger's DDL against the seeded
 * local database — `migrate deploy` has no `--url` flag, so the target is chosen
 * ENTIRELY by that variable.
 *
 * THE MODULE CONTRACT THIS SPEC PINS
 * ----------------------------------
 * `if (require.main === module) main();` plus a `module.exports` at the foot —
 * the idiom of `restore-drill.js:1497`, `link-integrity-check.js` and
 * `compose-invocation-check.js:578`. Requiring the module must have NO side
 * effect: this suite runs inside `pnpm test` on every developer's machine, and a
 * bare `main()` would create and drop a database as a side effect of an import.
 *
 * That sentence is still true of the REQUIRE, and since TOOL-25 it is no longer
 * true of the SUITE. Before TOOL-25 the end-to-end block below could only ever
 * address a port nothing on this project listens on, so it had never executed
 * anywhere; now that the address is resolved from the project's own
 * configuration, `pnpm test` on a configured machine really does `CREATE
 * DATABASE` / `DROP DATABASE` — reaching parity with `schema-drift-check.js:204`
 * and `restore-drill.js:145`, which have resolved the address that way since
 * #241. The blast radius is bounded on TWO axes, neither of them trust.
 *
 * By NAME — WHAT it may touch: `SCRATCH_NAME_PATTERN` is `^schema_drift_\d+$`,
 * `isSafeScratchTarget` is re-checked inside `dropScratch`, `buildChildEnv`
 * re-validates immediately before every spawn, and the drop runs on `SIGINT` /
 * `SIGTERM` / `uncaughtException` / `finally`. The suite can create and destroy
 * `schema_drift_%` and nothing else.
 *
 * By ADDRESS — WHERE it may touch it: `describeWithDb` requires the resolved
 * address to be BOTH reachable and on the loopback interface
 * (`gate.probeAddress(...).loopback`), so a checkout whose `.env` names a
 * production or shared-staging server skips with a reason instead of running DDL
 * there. Section 5f owns that guard and drives it in both directions. A name
 * bound alone answers "what", never "where", and `.env` is untracked — on a
 * deployed checkout it is a production DSN.
 *
 * The exports are those the story pins plus four the implementation needed:
 * `buildChildEnv` (the target guard above), `deriveMaintenanceUrl`,
 * `redactConnectionUrl` (G-TENANT, reused rather than re-implemented) and
 * `openSqlRoutes` (plumbing — it can build a database, it cannot decide a
 * verdict). `--from-url` does not appear for the reason given above; the
 * substance of that acceptance criterion — the diff reads the DATABASE the
 * ledger built, never the migrations directory — is asserted below.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'schema-drift-check.js');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'ci-gate.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const ADR_PATH = join(REPO_ROOT, 'docs', 'adr', 'ADR-027-schema-drift-gate-needs-a-database.md');
const ADR_025_PATH = join(REPO_ROOT, 'docs', 'adr', 'ADR-025-operator-drill-outside-the-ci-gate.md');

const SCRIPT_REF = 'scripts/schema-drift-check.js';

/**
 * THE DEFECT TOOL-25 REMOVED, AND THE FALSE PREMISE THAT KEPT IT ALIVE.
 *
 * Until TOOL-25 this file pinned a literal base address on a port nothing in this
 * project listens on, with a comment asserting the port was forced:
 * "`production-artefact-check.js` rule A6 matches a dev-service address on string
 * literals inside `apps/api/src`, so the CI DSN written out here would turn stage
 * 0b red."
 *
 * **That claim was false, and it was measured false on 2026-08-13.** A6 has never
 * been able to see this file: `production-artefact-check.js:105` defines
 * `EXCLUDED_FILE = /\.(spec|test)\.(ts|tsx|js|jsx|mjs|cjs)$/` and `:319` applies
 * it inside `walk()`, so every `*.spec.ts` is skipped before any rule runs. The
 * scanner's own banner reports 597 files across the three scan roots; walking
 * those roots with the same extensions and excluded directories but WITHOUT the
 * spec exclusion yields 701. 597 = the spec-excluded count. Conclusive, not
 * inferential.
 *
 * The cost of the false comment was three slices long: the wrong port survived
 * TOOL-22, TOOL-23 and TOOL-24 because each read a constraint that does not
 * exist. Meanwhile `schema-drift-check.js`, three directories away, ran the
 * identical journey against the address the project is actually configured for
 * and returned PASS, while the five end-to-end cases below printed `○ skipped`
 * and the suite reported green — DNC-08, committed inside the DNC-08 enforcer.
 *
 * So the address is now RESOLVED AT RUNTIME from the one module that decides it,
 * `scripts/lib/default-database-url.js` — the same module `schema-drift-check.js`
 * and `restore-drill.js` have used since #241. No literal is deleted "because a
 * gate forbade it"; it is deleted because a second copy of an address is the
 * defect, and one resolver is the repair.
 *
 * A6 is untouched, unweakened and un-excluded (R-30). Note what AC-2's evidence
 * therefore is and is not: re-running the scanner proves this diff did not
 * disturb the shipped-source scan. It is a NON-REGRESSION check. It provides zero
 * protection against a future author re-planting an address here, because the
 * scanner cannot read this file at all. The ratchet that does is the consumer
 * enumeration in `default-database-url-gate.spec.ts`.
 */
const DEFAULT_DB_URL_PATH = join(REPO_ROOT, 'scripts', 'lib', 'default-database-url.js');

/* eslint-disable @typescript-eslint/no-require-imports */
// Deliberately unguarded, exactly as `require(SCRIPT_PATH)` below and
// `test-ratchet.spec.ts:307/:356` are. If the shared resolver disappears, this
// suite must go red AT LOAD rather than fall back to a literal of its own —
// falling back is how the divergence this slice closes was born.
const {
  ENV_FILES,
  defaultDatabaseUrl,
  readDatabaseUrlFrom,
} = require(DEFAULT_DB_URL_PATH) as {
  ENV_FILES: string[];
  defaultDatabaseUrl: () => string;
  readDatabaseUrlFrom: (file: string) => string | undefined;
};
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The base address this checkout is configured for.
 *
 * NOT named `LOCAL_URL` any more, and the rename is load-bearing: `LOCAL_URL`
 * meant "a local address that is dead", and every assertion written against it
 * could safely be VALUE-shaped. This constant means "the live base this host
 * answers on", which an untracked `.env` chooses — so it is an INPUT, and it may
 * only ever appear on the left-hand side of an INVARIANCE ("the derived URL keeps
 * the base's host and port"). No assertion's MEANING may depend on its value.
 * Cases that need "a different server" or "these credentials" use the fixed
 * synthetic literals below instead.
 */
const RESOLVED_BASE_URL: string = defaultDatabaseUrl();

/** A closed port on the loopback interface. Used to prove that an unreachable
 * address FAILS rather than skips, and that no environment variable changes that. */
const DEAD_URL = 'postgresql://pilotage:pilotage@127.0.0.1:59999/pilotage?schema=public';
/** A FIXED address on a DIFFERENT server from `DEAD_URL` — different host AND
 * port. Every case whose MEANING is "these are two servers" uses this pair and
 * never the resolved base: an untracked `.env` could point the base at
 * `DEAD_URL`'s own host, and the case would silently stop meaning anything. */
const OTHER_SERVER_URL = 'postgresql://u:p@10.255.255.1:5432/other?schema=public';
/** A FIXED synthetic DSN for the redaction cases (G-TENANT).
 * `redactConnectionUrl` is a pure string transform, and an assertion phrased
 * against the resolved base would be satisfied by a redactor that does NOTHING on
 * any checkout whose credentials differ — or on one whose password is empty. A
 * credential-redaction guard is the last place in this file allowed to depend on
 * the host. `db.example` resolves nowhere and is contacted by nothing. */
const REDACTION_SAMPLE_URL = 'postgresql://u:s3cr3t@db.example:5433/x?schema=public';

type DiffClass = 'in-sync' | 'drift' | 'tooling-error';

interface LedgerRow {
  migrationName: string;
  finished: boolean;
  rolledBack: boolean;
}

interface Outcome {
  verdict: string;
  exitCode: number;
  failures: string[];
}

interface ChildResult {
  status: number | null;
  stdout: string;
  stderr: string;
  output: string;
}

interface SchemaDriftModule {
  evaluateDrift: (input: unknown) => Outcome;
  classifyDiffExit: (code: unknown) => DiffClass;
  isSafeScratchTarget: (scratchName: unknown, sourceDatabase: unknown) => boolean;
  buildScratchUrl: (baseUrl: string, scratchName: string) => string;
  buildChildEnv: (scratchUrl: string) => { DATABASE_URL: string };
  deriveMaintenanceUrl: (baseUrl: string) => string;
  redactConnectionUrl: (url: unknown) => string;
  deployMigrations: (input: { migrationsDir: string; scratchUrl: string }) => ChildResult;
  runDiff: (input: { datamodelPath?: string; scratchUrl: string; script?: boolean }) => ChildResult;
  probeServer: (baseUrl?: string) => boolean;
  probeAddress: (
    host: string,
    port: string | number,
    timeoutMs?: number,
  ) => {
    open: boolean;
    state: 'open' | 'refused' | 'indeterminate';
    detail: string;
    addresses: string[];
    loopback: boolean;
    elapsedMs: number;
  };
  openSqlRoutes: (baseUrl?: string) => {
    query: (database: string, sql: string) => string[][];
    exec: (url: string, sql: string) => { ok: boolean; detail: string };
  };
  migrationDirectories: (dir?: string) => string[];
  SCRATCH_NAME_PATTERN: RegExp;
  MIGRATIONS_DIR: string;
  SCHEMA_PATH: string;
  MIN_EXPECTED_TABLES: number;
  TCP_PREFLIGHT_TIMEOUT_MS: number;
  DOCKER_TIMEOUT_MS: number;
  DOCKER_EXEC_TIMEOUT_MS: number;
  PRISMA_CLI_PROBE_TIMEOUT_MS: number;
  PSQL_HOST_TIMEOUT_MS: number;
  PRISMA_RUN_TIMEOUT_MS: number;
  VERDICT_EXIT_CODES: Record<string, number>;
  VERDICT_PRECEDENCE: string[];
}

/* eslint-disable @typescript-eslint/no-require-imports */
// Deliberately unguarded. If the gate script is absent or stops exporting its
// core, this suite must go red at load: a guard spec that degrades to "nothing to
// check" when its gate disappears is the exact failure the gate exists to stop.
const gate: SchemaDriftModule = require(SCRIPT_PATH);
/* eslint-enable @typescript-eslint/no-require-imports */

const {
  evaluateDrift,
  classifyDiffExit,
  isSafeScratchTarget,
  buildScratchUrl,
  buildChildEnv,
  deriveMaintenanceUrl,
  VERDICT_EXIT_CODES,
  VERDICT_PRECEDENCE,
  SCRATCH_NAME_PATTERN,
  MIN_EXPECTED_TABLES,
} = gate;

const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, 'utf8');

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Executable content of a `#`-commented file, byte offsets preserved.
 *
 * Copied verbatim from `csp-gate.spec.ts:48-53`, as `link-integrity-gate.spec.ts`
 * copied it. PF-83: an `indexOf` assertion over the RAW text of a workflow was
 * turned red by a comment that merely NAMED a script. Blanking comments while
 * preserving length means neither a sentence of prose nor a commented-out line
 * can satisfy — or break — the check, and the ordering offsets stay meaningful.
 */
function executableContent(source: string): string {
  return source
    .split('\n')
    .map((line) => (line.trim().startsWith('#') ? ' '.repeat(line.length) : line))
    .join('\n');
}

/** Blank `//` and block comments in a JS source, length preserved. */
function executableJs(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

const EXECUTABLE_SCRIPT = executableJs(SCRIPT_SOURCE);

/**
 * Every `run(<anchor>…)` call site, extracted by BALANCING PARENTHESES.
 *
 * Not a line-scoped regex: the `docker exec` call spans three lines once its
 * options object carries a bound, so a per-line matcher would silently find zero
 * sites and the assertion built on it would pass by matching nothing — the exact
 * defect TOOL-07 and TOOL-08 were made of. Every caller therefore asserts the
 * extraction found something BEFORE asserting anything about its contents.
 */
function callSites(source: string, anchor: RegExp): string[] {
  const sites: string[] = [];
  const scanner = new RegExp(anchor.source, 'g');
  let match: RegExpExecArray | null = scanner.exec(source);
  while (match !== null) {
    const start = source.indexOf('(', match.index);
    let depth = 0;
    let i = start;
    for (; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    sites.push(source.slice(start, i + 1));
    match = scanner.exec(source);
  }
  return sites;
}

function runInChild(argv: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, ...argv], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/**
 * Complete, healthy evidence. Without this control every failure assertion below
 * would be satisfied by a function that always fails (AC-13).
 */
function healthyRun(): Record<string, unknown> {
  return {
    toolingAvailable: true,
    serverReachable: true,
    migrationDirectories: ['0_baseline'],
    scratchName: 'schema_drift_1',
    sourceDatabase: 'pilotage',
    scratchCreated: true,
    scratchWasEmpty: true,
    migrateDeployOk: true,
    scratchTableCount: 55,
    ledgerRows: [{ migrationName: '0_baseline', finished: true, rolledBack: false }] as LedgerRow[],
    diffExitCode: 0,
    diffOutput: 'No difference detected.',
    scratchDropped: true,
  };
}

/* ================================================================== *
 * 1. The diff exit code is CLASSIFIED, not guessed (AC-8)
 * ================================================================== */

describe('classifyDiffExit — `migrate diff --exit-code` is trinary', () => {
  it('0 is in-sync and 2 is drift', () => {
    expect(classifyDiffExit(0)).toBe('in-sync');
    expect(classifyDiffExit(2)).toBe('drift');
  });

  it.each([1, null, -1, 127, undefined, '2', NaN])(
    'exit %p is a tooling error — never agreement, never drift',
    (code) => {
      // 1 is Prisma's OWN failure, not a difference. Measured in both directions
      // before the gate was written: an unreadable `--to-schema-datamodel` path
      // and a dead server both return 1. `null` is what `spawnSync` reports when
      // the child could not be started at all.
      expect(classifyDiffExit(code)).toBe('tooling-error');
    },
  );

  it('a tooling error is its own verdict and exits 1', () => {
    for (const code of [1, -1, 127]) {
      const outcome = evaluateDrift({ ...healthyRun(), diffExitCode: code });
      expect([code, outcome.verdict]).toEqual([code, 'diff_tooling_failed']);
      expect(outcome.exitCode).toBe(1);
    }
  });

  it('a diff that was never ATTEMPTED is `unknown`, not a clean diff', () => {
    // The distinction the CLI must preserve, and does: `spawnSync` reports
    // `status: null` when the child was killed by a signal, while
    // `diffExitCode: null` in the evidence means "the diff never ran". Both are
    // failures and neither is `ok`, but collapsing them would hide a killed diff
    // inside "no evidence" — so the CLI normalises a null child status to -1,
    // which the classifier calls a tooling error, and leaves null to mean
    // "not attempted".
    const outcome = evaluateDrift({ ...healthyRun(), diffExitCode: null });
    expect(outcome.verdict).toBe('unknown');
    expect(outcome.exitCode).toBe(1);
    expect(EXECUTABLE_SCRIPT).toContain('diff.status === null ? -1 : diff.status');
  });

  it('exit 1 is never read as agreement', () => {
    // The dangerous direction: `status === 2 ? fail : pass` reports a crashed
    // Prisma as a clean schema.
    expect(evaluateDrift({ ...healthyRun(), diffExitCode: 1 }).exitCode).toBe(1);
  });
});

/* ================================================================== *
 * 2. The pure verdict function, in BOTH directions
 * ================================================================== */

describe('evaluateDrift — the control case, and every failure it must name', () => {
  it('complete healthy evidence is `ok` / exit 0 (AC-13)', () => {
    const outcome = evaluateDrift(healthyRun());
    expect(outcome.verdict).toBe('ok');
    expect(outcome.exitCode).toBe(0);
    expect(outcome.failures).toEqual([]);
  });

  it('drift is named, and Prisma\'s own words are carried verbatim (AC-1)', () => {
    const prismaSaid = '[+] Added column\n  - DriftProbe.driftProbeColumn';
    const outcome = evaluateDrift({ ...healthyRun(), diffExitCode: 2, diffOutput: prismaSaid });
    expect(outcome.verdict).toBe('schema_drift');
    expect(outcome.exitCode).toBe(1);
    // Verbatim, never a paraphrase such as "schemas differ": that output is what
    // NAMES the drifted object, which is the acceptance criterion.
    expect(outcome.failures.join('\n')).toContain('driftProbeColumn');
    expect(outcome.failures.join('\n')).toContain('[+] Added column');
    // …and it tells the operator what to do about it.
    expect(outcome.failures.join('\n')).toContain('prisma migrate dev');
  });

  it('a migration that does not execute fails the check (AC-3)', () => {
    const outcome = evaluateDrift({
      ...healthyRun(),
      migrateDeployOk: false,
      migrateDeployOutput: 'Error: P3018\nDatabase error: syntax error at or near "THIS"',
    });
    expect(outcome.verdict).toBe('migrate_deploy_failed');
    expect(outcome.exitCode).toBe(1);
    expect(outcome.failures.join('\n')).toContain('P3018');
  });

  it.each([
    ['tooling_unavailable', { toolingAvailable: false }],
    ['unreachable_server', { serverReachable: false }],
    ['no_migrations', { migrationDirectories: [] }],
    ['unsafe_scratch_target', { scratchName: 'pilotage', sourceDatabase: 'pilotage' }],
    ['scratch_create_failed', { scratchCreated: false }],
    ['scratch_not_empty', { scratchWasEmpty: false }],
    ['migrate_deploy_failed', { migrateDeployOk: false }],
    ['empty_scratch_schema', { scratchTableCount: 3 }],
    ['ledger_incomplete', { ledgerRows: [] }],
    ['diff_tooling_failed', { diffExitCode: 1 }],
    ['schema_drift', { diffExitCode: 2 }],
    ['scratch_cleanup_failed', { scratchDropped: false }],
    ['unknown', { fatalError: 'the run crashed' }],
  ])('%s is reachable from healthy evidence plus one defect', (verdict, defect) => {
    const outcome = evaluateDrift({ ...healthyRun(), ...(defect as object) });
    expect(outcome.verdict).toBe(verdict);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.failures.length).toBeGreaterThan(0);
  });

  it('is NOT vacuous — an empty ledger and an empty scratch are failures (AC-12)', () => {
    // The cheapest way for a gate to be worthless is to compare nothing.
    expect(evaluateDrift({ ...healthyRun(), migrationDirectories: [] }).verdict).toBe('no_migrations');
    expect(evaluateDrift({ ...healthyRun(), scratchTableCount: 3 }).verdict).toBe('empty_scratch_schema');
    expect(evaluateDrift({ ...healthyRun(), scratchTableCount: MIN_EXPECTED_TABLES }).verdict).toBe('ok');
    expect(evaluateDrift({ ...healthyRun(), scratchTableCount: MIN_EXPECTED_TABLES - 1 }).verdict).toBe(
      'empty_scratch_schema',
    );
  });

  it('an on-disk migration missing from the ledger is `ledger_incomplete` (AC-12)', () => {
    const twoOnDisk = { ...healthyRun(), migrationDirectories: ['0_baseline', '1_add_thing'] };
    expect(evaluateDrift(twoOnDisk).verdict).toBe('ledger_incomplete');
    expect(evaluateDrift(twoOnDisk).failures.join('\n')).toContain('1_add_thing');

    const unfinished = {
      ...healthyRun(),
      ledgerRows: [{ migrationName: '0_baseline', finished: false, rolledBack: false }],
    };
    expect(evaluateDrift(unfinished).verdict).toBe('ledger_incomplete');

    const rolledBack = {
      ...healthyRun(),
      ledgerRows: [{ migrationName: '0_baseline', finished: true, rolledBack: true }],
    };
    expect(evaluateDrift(rolledBack).verdict).toBe('ledger_incomplete');
  });

  it('applied_steps_count is NOT asserted — that is how `migrate resolve` baselines', () => {
    // The obvious check ("> 0, or the migration did nothing") reports a false
    // failure on any database baselined the way this repository documents:
    // `prisma migrate resolve --applied 0_baseline` inserts the row without
    // executing steps, so the column takes its DDL default of 0.
    // `restore-drill.js:567` records the same trap; copying the mistake here
    // would make the gate fail loudest at the moment an operator needed it most.
    expect(EXECUTABLE_SCRIPT).not.toMatch(/applied_?[Ss]teps/);
    const resolved = {
      ...healthyRun(),
      ledgerRows: [{ migrationName: '0_baseline', finished: true, rolledBack: false, appliedStepsCount: 0 }],
    };
    expect(evaluateDrift(resolved).verdict).toBe('ok');
  });

  it('cleanup is a verdict, and it never masks drift (AC-11)', () => {
    expect(evaluateDrift({ ...healthyRun(), scratchDropped: false }).verdict).toBe('scratch_cleanup_failed');

    const both = evaluateDrift({ ...healthyRun(), diffExitCode: 2, diffOutput: '[+] Added tables', scratchDropped: false });
    // Precedence puts schema_drift above scratch_cleanup_failed: a cleanup bug
    // must never downgrade the finding the gate exists for…
    expect(both.verdict).toBe('schema_drift');
    // …and the cleanup failure is still listed, never swallowed.
    expect(both.failures.join('\n')).toContain('was NOT dropped');
  });

  it('the verdict table and the precedence list describe the same universe (AC-4)', () => {
    const keys = Object.keys(VERDICT_EXIT_CODES).sort();
    expect([...VERDICT_PRECEDENCE].sort()).toEqual(keys);
    // `ok` is the ONLY zero. Everything else exits 1 (ADR-025 D2: binary exit
    // codes, the verdict string is the discriminator).
    const zeros = keys.filter((k) => VERDICT_EXIT_CODES[k] === 0);
    expect(zeros).toEqual(['ok']);
    expect(VERDICT_PRECEDENCE[VERDICT_PRECEDENCE.length - 1]).toBe('ok');
  });

  it('an input carrying no evidence is not `ok` (AC-4, the DNC-08 core)', () => {
    // This is the defect `restore-drill.js` shipped and had to fix in its own
    // adversarial review: every check is written `if (x === false)`, so an
    // OMITTED field skips the check that would have used it, and `{}` read as a
    // clean run. `null` was handled; `{}` is the dangerous half, because a
    // crashed or half-built run hands you an object.
    const empty = evaluateDrift({});
    expect(empty.verdict).toBe('unknown');
    expect(empty.exitCode).toBe(1);
    for (const field of [
      'serverReachable',
      'migrationDirectories',
      'scratchCreated',
      'scratchWasEmpty',
      'migrateDeployOk',
      'scratchTableCount',
      'ledgerRows',
      'diffExitCode',
      'scratchDropped',
    ]) {
      expect(empty.failures.join(' ')).toContain(field);
    }
  });

  it('dropping any single piece of evidence from a passing run is enough', () => {
    for (const field of [
      'serverReachable',
      'migrationDirectories',
      'scratchCreated',
      'scratchWasEmpty',
      'migrateDeployOk',
      'scratchTableCount',
      'ledgerRows',
      'diffExitCode',
      'scratchDropped',
    ]) {
      const partial = { ...healthyRun(), [field]: null };
      expect([field, evaluateDrift(partial).exitCode]).toEqual([field, 1]);
      expect([field, evaluateDrift(partial).verdict === 'ok']).toEqual([field, false]);
    }
  });

  it.each([null, undefined, 'nope', 42, []])('a non-object input %p is `unknown`, never ok', (input) => {
    const outcome = evaluateDrift(input);
    expect(outcome.verdict).not.toBe('ok');
    expect(outcome.exitCode).toBe(1);
  });
});

/* ================================================================== *
 * 3. The scratch target cannot become the real database (AC-10)
 * ================================================================== */

describe('scratch-target safety — the only destructive path in the file', () => {
  it('accepts only a generated scratch name that is not the source database', () => {
    expect(isSafeScratchTarget('schema_drift_1', 'pilotage')).toBe(true);
    expect(isSafeScratchTarget('schema_drift_17860954419812', 'pilotage')).toBe(true);
  });

  it.each([
    ['pilotage', 'pilotage'],
    ['schema_drift_1', 'schema_drift_1'],
    ['drop_me', 'pilotage'],
    ['schema_drift_', 'pilotage'],
    ['schema_drift_1x', 'pilotage'],
    ['', 'pilotage'],
    ['schema_drift_1', ''],
  ])('refuses (%p, %p)', (scratch, source) => {
    expect(isSafeScratchTarget(scratch, source)).toBe(false);
  });

  it.each([
    [undefined, undefined],
    [null, null],
    [1, 2],
  ])('refuses non-string inputs (%p, %p)', (scratch, source) => {
    expect(isSafeScratchTarget(scratch, source)).toBe(false);
  });

  it('buildScratchUrl replaces ONLY the database segment', () => {
    // REPLACED, never deleted (TOOL-21's lesson). The two lines that stood here
    // asserted `hostname === '127.0.0.1'` and `port === '5433'`; what they were
    // DEFENDING is that the builder moves the database segment and nothing else.
    // That property is asserted against the RESOLVED base, in the same idiom the
    // TOOL-11 invariance case below already uses, so it survives a checkout
    // configured for any address instead of pinning one.
    const base = new URL(RESOLVED_BASE_URL);
    const url = new URL(buildScratchUrl(RESOLVED_BASE_URL, 'schema_drift_7'));
    expect(url.pathname).toBe('/schema_drift_7');
    expect([url.hostname, url.port]).toEqual([base.hostname, base.port]);
    expect([url.username, url.password]).toEqual([base.username, base.password]);
    expect(url.search).toBe(base.search);
  });

  it('buildScratchUrl refuses to address anything that is not a scratch database', () => {
    expect(() => buildScratchUrl(RESOLVED_BASE_URL, 'pilotage')).toThrow();
    expect(() => buildScratchUrl(RESOLVED_BASE_URL, '')).toThrow();
    expect(() => buildScratchUrl(RESOLVED_BASE_URL, 'schema_drift_')).toThrow();
  });

  it('the migration tools are never handed the resolved base URL (FR-7)', () => {
    // `prisma migrate deploy` has NO `--url` flag: the target is chosen ENTIRELY
    // by DATABASE_URL. A missing or late override would run the ledger's DDL
    // against the seeded local database, and for the "a migration that does not
    // execute" case that means broken DDL against real child records. So the
    // overlay is re-validated immediately before every spawn.
    const env = buildChildEnv(buildScratchUrl(RESOLVED_BASE_URL, 'schema_drift_7'));
    expect(new URL(env.DATABASE_URL).pathname).toBe('/schema_drift_7');
    expect(() => buildChildEnv(RESOLVED_BASE_URL)).toThrow(/schema_drift/);
    expect(() => buildChildEnv(deriveMaintenanceUrl(RESOLVED_BASE_URL))).toThrow();
  });

  it('the maintenance URL is DERIVED, never supplied', () => {
    // `CREATE DATABASE` cannot run from inside the database being created, and an
    // operator-supplied maintenance address would be a second address every
    // safety check would have to trust.
    //
    // The port line here was the second of the two TOOL-25 replacements: it read
    // `expect(url.port).toBe('5433')`, which defended "the derivation does not
    // move the server". Same property, asserted against the resolved base.
    const base = new URL(RESOLVED_BASE_URL);
    const url = new URL(deriveMaintenanceUrl(RESOLVED_BASE_URL));
    expect(url.pathname).toBe('/postgres');
    expect([url.hostname, url.port]).toEqual([base.hostname, base.port]);
    expect(EXECUTABLE_SCRIPT).not.toMatch(/--maintenance|--admin-url/);
  });

  it('the drop is pattern-guarded, forced, and runs on every exit path (FR-8)', () => {
    expect(SCRATCH_NAME_PATTERN.source).toBe('^schema_drift_\\d+$');
    expect(EXECUTABLE_SCRIPT).toContain('WITH (FORCE)');
    expect(EXECUTABLE_SCRIPT).toContain('TEMPLATE template0');
    // The guard is re-checked inside dropScratch, not only at the call site.
    expect(EXECUTABLE_SCRIPT).toMatch(/function dropScratch[\s\S]{0,400}isSafeScratchTarget/);
    for (const path of ['SIGINT', 'SIGTERM', 'uncaughtException', 'finally']) {
      expect(EXECUTABLE_SCRIPT).toContain(path);
    }
    // …and orphans from a killed earlier run are swept, name-pattern-guarded.
    expect(EXECUTABLE_SCRIPT).toMatch(/sweepOrphans/);
    expect(EXECUTABLE_SCRIPT).toContain("datname LIKE 'schema\\\\_drift\\\\_%'");
  });

  it('no connection string is ever printed unredacted (G-TENANT)', () => {
    // FIXED synthetic input, deliberately NOT the resolved base. These assertions
    // are VALUE-shaped — they only mean anything because the input really carries
    // `u:s3cr3t` — so pointing them at an address an untracked `.env` chooses
    // would let a redactor that does nothing satisfy them on any checkout with
    // different credentials, and would make them meaningless on one with an empty
    // password. That is the failure mode this whole slice is repairing, and it is
    // not worth re-creating on the one tenant-adjacent guard in the file.
    expect(gate.redactConnectionUrl(REDACTION_SAMPLE_URL)).not.toContain('u:s3cr3t');
    expect(gate.redactConnectionUrl(REDACTION_SAMPLE_URL)).not.toContain('s3cr3t');
    expect(gate.redactConnectionUrl(REDACTION_SAMPLE_URL)).toContain('***');
    expect(gate.redactConnectionUrl('could not connect to postgres://u:s3cr3t@h:5433/db')).not.toContain(
      's3cr3t',
    );
    expect(gate.redactConnectionUrl('')).toBe('');
    // Every print of the resolved URL goes through the redactor.
    expect(EXECUTABLE_SCRIPT).not.toMatch(/console\.(log|error)\([^\n]*\$\{baseUrl\}/);
    expect(EXECUTABLE_SCRIPT).toContain('redactConnectionUrl(baseUrl)');
  });
});

/* ================================================================== *
 * 4. Wiring — both harnesses, right place, zero arguments (AC-5, AC-6, AC-7)
 * ================================================================== */

describe('the stage is wired into both harnesses and cannot drift', () => {
  const gateSource = readFileSync(GATE_PATH, 'utf8');
  const workflowSource = readFileSync(WORKFLOW_PATH, 'utf8');

  it.each([
    ['scripts/ci-gate.sh', GATE_PATH],
    ['.github/workflows/ci.yml', WORKFLOW_PATH],
  ])('%s runs the schema drift check', (_label, path) => {
    expect(existsSync(path)).toBe(true);
    expect(executableContent(readFileSync(path, 'utf8'))).toContain(SCRIPT_REF);
  });

  it('does not accept a commented-out invocation as wiring (PF-83)', () => {
    const commented = [`# run_stage "drift" node ${SCRIPT_REF}`, 'echo hello'].join('\n');
    expect(executableContent(commented)).not.toContain(SCRIPT_REF);
    expect(executableContent(`node ${SCRIPT_REF}`)).toContain(SCRIPT_REF);
  });

  it('preserves byte offsets when blanking comments', () => {
    const source = '# a comment\nreal line\n';
    expect(executableContent(source)).toHaveLength(source.length);
  });

  it('ci-gate.sh runs it BEFORE `prisma generate`, in the tier every PR runs (AC-6)', () => {
    // Order is correctness, not style: `prisma generate` will happily generate a
    // client for a schema no migration produces, so the ledger must be refused
    // BEFORE a client is generated against a fiction.
    //
    // This assertion used to read `run_stage "prisma generate"` — a literal that
    // matched ONLY the dead pre-#214 stage block, where the order did hold. The
    // live tier had the two the other way round from the rewrite until TOOL-06
    // was closed, and this test passed throughout by reading lines that exited
    // 125 without running anything. Anchor on the live call, timeout and all.
    const executable = executableContent(gateSource);
    const driftAt = executable.indexOf(SCRIPT_REF);
    const generateAt = executable.search(/run_stage\s+\d+\s+"prisma generate"/);
    expect(driftAt).toBeGreaterThan(-1);
    expect(generateAt).toBeGreaterThan(-1);
    expect(driftAt).toBeLessThan(generateAt);

    // Each stage is wired exactly once. Two call sites for one stage is how the
    // broken one stayed invisible: the working duplicate kept the suite green.
    expect(executable.split(SCRIPT_REF)).toHaveLength(2);

    // …and it is NOT inside the `--full` branch. It reads prisma/ and a
    // database, never dist/ or .next/, so a default run that skipped it would be
    // exactly the omission DNC-08 forbids. (The predecessor of this assertion
    // looked for a `${QUICK}` guard that the #214 rewrite had already replaced
    // with `$MODE`, so it asserted on a string the file no longer contained.)
    const fullBranchAt = executable.indexOf('if [ "$MODE" = full ]');
    expect(fullBranchAt).toBeGreaterThan(-1);
    expect(driftAt).toBeLessThan(fullBranchAt);
  });

  it('ci.yml runs it in the job that owns the database, before prisma generate (AC-6)', () => {
    // Job-blindness is the trap: "the string appears" is satisfied by a step in
    // the lint job, where there is no database and the step errors every run —
    // which is then "fixed" with continue-on-error.
    const executable = executableContent(workflowSource);
    const serviceAt = executable.indexOf('image: postgres:15-alpine');
    const driftAt = executable.indexOf(SCRIPT_REF);
    expect(serviceAt).toBeGreaterThan(-1);
    expect(driftAt).toBeGreaterThan(serviceAt);

    const buildJobAt = executable.indexOf('\n  build:');
    const generateInBuild = executable.indexOf('pnpm --filter @pilotage/api prisma generate', buildJobAt);
    expect(driftAt).toBeGreaterThan(buildJobAt);
    expect(driftAt).toBeLessThan(generateInBuild);
    expect(driftAt).toBeLessThan(executable.lastIndexOf('pnpm build'));
    // `node scripts/test-ratchet.js api` belongs to the later `test` job.
    expect(driftAt).toBeLessThan(executable.indexOf('node scripts/test-ratchet.js api'));

    expect(executable.slice(driftAt, driftAt + 200)).not.toContain('continue-on-error');
  });

  it('the postgres service and DATABASE_URL cannot be quietly removed (AC-7)', () => {
    // Without this, deleting the service would turn the stage red and the reflex
    // fix would be to delete the stage.
    const executable = executableContent(workflowSource);
    const buildJobAt = executable.indexOf('\n  build:');
    const testJobAt = executable.indexOf('\n  test:');
    const buildJob = executable.slice(buildJobAt, testJobAt);
    expect(buildJob).toContain('image: postgres:15-alpine');
    expect(buildJob).toContain('DATABASE_URL:');
    expect(buildJob).toContain(SCRIPT_REF);
  });

  it('both call sites invoke the script with ZERO arguments', () => {
    // A path or url seam in CI is a bypass flag wearing a different hat: either
    // one lets the gate be pointed at something that always passes.
    for (const source of [gateSource, workflowSource]) {
      const executable = executableContent(source);
      const invocations = executable.match(new RegExp(`${SCRIPT_REF.replace(/[/.]/g, '\\$&')}[^\\n]*`, 'g')) ?? [];
      expect(invocations.length).toBeGreaterThan(0);
      for (const invocation of invocations) {
        expect(invocation.slice(SCRIPT_REF.length).trim()).toBe('');
      }
    }
  });

  it('both files carry the anti-drift note the sibling stages carry (AC-5)', () => {
    // Read on RAW text on purpose — this one IS a comment, and it is the thing
    // that tells the next author the two files are a pair.
    for (const source of [gateSource, workflowSource]) {
      const at = source.indexOf(SCRIPT_REF);
      expect(at).toBeGreaterThan(-1);
      expect(source.slice(Math.max(0, at - 1400), at)).toContain('must not drift (S-E02-2 AC-4)');
    }
  });

  it('neither harness mentions the operator drill by filename (P0-2)', () => {
    // `restore-drill-gate.spec.ts:809-810` asserts, on RAW text, that neither
    // file contains that script's name — because ADR-025 D1 decided the drill is
    // NOT a gate stage, and a comment naming it would read as wiring. The most
    // natural comment to write above this new stage ("unlike the operator drill,
    // this one IS wired") would turn that sibling guard red and be misdiagnosed
    // as a drift-gate failure. Refer to it as "the operator drill (ADR-025)".
    for (const path of [GATE_PATH, WORKFLOW_PATH]) {
      expect(readFileSync(path, 'utf8')).not.toContain('restore-drill');
    }
  });

  it('the new stage names its decision record, and that record exists (AC-15)', () => {
    // This stage gives `ci-gate.sh` its first dependency on a running service,
    // which contradicts ADR-025 D1. project-context.md §3 makes an undocumented
    // architectural reversal a blocking finding, so it ships with an ADR.
    expect(existsSync(ADR_PATH)).toBe(true);
    expect(readFileSync(GATE_PATH, 'utf8')).toContain('ADR-027-schema-drift-gate-needs-a-database.md');

    const adr = readFileSync(ADR_PATH, 'utf8');
    // The distinction that makes both decisions coherent rather than one
    // overturning the other.
    expect(adr).toMatch(/capability/i);
    expect(adr).toMatch(/state/i);
    expect(adr).toContain('ADR-025');
    expect(adr).toContain('--from-migrations');
    // The cost accepted, named rather than implied.
    expect(adr).toMatch(/R-23/);
    // And ADR-025 points here, so a reader of D1 is not left with a decision
    // this slice quietly reversed.
    expect(readFileSync(ADR_025_PATH, 'utf8')).toContain('ADR-027');
  });
});

/* ================================================================== *
 * 5. DNC-08 / DNC-10 — proven by EXECUTING the script (AC-4, AC-9)
 * ================================================================== */

describe('there is no way to turn this gate off, and no way to skip it', () => {
  it('an unreachable address FAILS and names every route tried (AC-4)', () => {
    // No database required: this is the case that must hold in every
    // environment, including a machine with no container runtime at all.
    const run = runInChild([], { DATABASE_URL: DEAD_URL });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain('prisma db execute');
    expect(run.output).toContain('psql');
    expect(run.output).toContain('pilotage_postgres');
    expect(run.output).toMatch(/SCHEMA DRIFT CHECK: FAIL/);
  }, 180000);

  it('EXECUTES to the same non-zero verdict with every plausible escape set (AC-9)', () => {
    // Asserted by running it, not by reading it: a `process.env` scan proves a
    // string is absent from one file, and proves nothing about a dependency, a
    // default parameter, or a value read some other way.
    const control = runInChild([], { DATABASE_URL: DEAD_URL });
    expect(control.status).not.toBe(0);
    const verdict = /SCHEMA DRIFT CHECK: FAIL — (\w+)/.exec(control.output)?.[1];
    expect(verdict).toBeDefined();

    for (const escape of [
      { SKIP_SCHEMA_DRIFT: '1' },
      { ALLOW_SCHEMA_DRIFT: '1' },
      { SCHEMA_DRIFT_CHECK: '0' },
      { FORCE: '1' },
      { CI: 'false' },
      { NODE_ENV: 'production' },
      {
        SKIP_SCHEMA_DRIFT: '1',
        ALLOW_SCHEMA_DRIFT: '1',
        SCHEMA_DRIFT_CHECK: '0',
        FORCE: '1',
        CI: 'false',
        NODE_ENV: 'production',
      },
    ]) {
      const run = runInChild([], { ...escape, DATABASE_URL: DEAD_URL });
      expect([Object.keys(escape).join('+'), run.status]).toEqual([Object.keys(escape).join('+'), control.status]);
      expect(run.output).toContain(`SCHEMA DRIFT CHECK: FAIL — ${verdict}`);
    }
  }, 300000);

  it.each(['--force', '--update', '--skip', '--allow-drift', '--schema', '--source', '--from-migrations'])(
    'refuses the argument %s',
    (flag) => {
      const run = runInChild([flag], { DATABASE_URL: DEAD_URL });
      expect(run.status).toBe(1);
      expect(run.output).toContain('This script has no bypass option.');
    },
    180000,
  );

  it('reads no environment variable except DATABASE_URL', () => {
    const reads = EXECUTABLE_SCRIPT.match(/process\.env\.[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    expect([...new Set(reads)]).toEqual(['process.env.DATABASE_URL']);
    // DATABASE_URL is monotone in the failing direction: it names WHERE a scratch
    // database is built, never WHETHER the ledger reproduces the schema. The
    // scratch is created EMPTY and migrated from the migrations on disk wherever
    // it points, so a different address can only make the run unreachable — which
    // the executed case above shows is a failure.
    expect(EXECUTABLE_SCRIPT).not.toMatch(/process\.env\[/);
  });

  it('parseArgs knows exactly one flag, and it is --help (AC-9)', () => {
    // Scoped to parseArgs deliberately: the file DOES contain `--schema`,
    // `--stdin`, `--exit-code`, `--from-schema-datasource` and
    // `--to-schema-datamodel` as CHILD-PROCESS arguments, which are not a CLI
    // surface. What DNC-10 forbids is a way for a caller to influence this
    // script's verdict, and that surface is parseArgs.
    const parseArgs = /function parseArgs\(argv\)[\s\S]*?\n}/.exec(EXECUTABLE_SCRIPT)?.[0] ?? '';
    expect(parseArgs).not.toBe('');
    const flags = [...new Set(parseArgs.match(/'--?[a-z-]+'|"--?[a-z-]+"/g) ?? [])].map((f) => f.slice(1, -1));
    expect(flags.sort()).toEqual(['--help', '-h']);
    expect(parseArgs).toContain('This script has no bypass option.');
  });

  it.each(['SKIP_', 'ALLOW_', 'BYPASS', '--force', '--update', '--allow', '--source'])(
    'the script does not know %s',
    (token) => {
      expect(EXECUTABLE_SCRIPT).not.toContain(token);
    },
  );

  it('no code path prints "skip" as a passing outcome (AC-4)', () => {
    // The word appears in failure messages on purpose — "reported as a failure
    // rather than skipped" — so the assertion is about the PASSING path, not
    // about a substring anywhere in the file.
    expect(EXECUTABLE_SCRIPT).not.toMatch(/skip[^\n]*(exitCode: 0|exit 0|PASS)/i);
    expect(EXECUTABLE_SCRIPT).not.toMatch(/(exitCode: 0|PASS)[^\n]*skip/i);
    const zeros = Object.entries(VERDICT_EXIT_CODES).filter(([, code]) => code === 0);
    expect(zeros.map(([verdict]) => verdict)).toEqual(['ok']);
  });

  it('the `--from-migrations` trap is not reintroduced (AC-2, P2-16)', () => {
    // Measured on this repository unchanged: that spelling returns exit 2 and
    // reports all five PostgreSQL extensions as added although 0_baseline creates
    // every one of them, so a gate built on it is permanently red on correct code
    // with no route back to green except breaking correct code.
    expect(EXECUTABLE_SCRIPT).not.toContain('--from-migrations');
    // The diff must read the DATABASE the ledger built. `--from-schema-datasource`
    // resolves its url from `env("DATABASE_URL")`, which `buildChildEnv` pins to
    // the scratch database — the same target `--from-url` would name, without
    // putting a credential in argv (ADR-025 D6).
    expect(EXECUTABLE_SCRIPT).toContain('--from-schema-datasource');
    expect(EXECUTABLE_SCRIPT).toContain('--to-schema-datamodel');
    expect(EXECUTABLE_SCRIPT).toContain('--exit-code');
  });

  it('requiring the module has no side effect — main() is guarded (AC-14)', () => {
    expect(EXECUTABLE_SCRIPT).toMatch(/require\.main\s*===\s*module/);
    expect(EXECUTABLE_SCRIPT).not.toMatch(/^\s*main\(\);\s*$/m);
  });

  it('the real migrations directory is non-empty, and the lock file is not a migration (AC-12)', () => {
    const dirs = gate.migrationDirectories();
    expect(dirs.length).toBeGreaterThan(0);
    expect(dirs).not.toContain('migration_lock.toml');
    expect(existsSync(join(gate.MIGRATIONS_DIR, 'migration_lock.toml'))).toBe(true);
  });
});

/* ================================================================== *
 * 5b. The TCP preflight — the ladder concludes in milliseconds (TOOL-10)
 *
 * The defect: with no server listening, the route ladder descended into
 * `docker`, which on this platform does not return. Measured on this worktree
 * before the fix — one CLI invocation had NOT finished at 30 037 ms and was
 * killed (status null, signal SIGTERM, error.code ETIMEDOUT), last line printed
 * `▶ prisma CLI : …`. This file drives that ladder NINE times against DEAD_URL,
 * which is what overran `ci-gate.sh`'s 2400 s `test:api` stage (run 43: timed
 * out at 2827 s, jest worker exitCode 143 = SIGTERM).
 *
 * The rule the whole design turns on, and the reason these cases are written in
 * pairs: a wrong `open` costs one bounded ladder descent, a wrong `closed` is a
 * gate that is red on correct code with no route back to green except deleting
 * the check. Every choice is biased toward `open`.
 *
 * NOTE ON WHAT IS NOT EXECUTED HERE: no case invokes `docker`. That is not
 * timidity — it is the premise. `docker port pilotage_postgres 5432/tcp` did not
 * return within 150 s on this machine, `ps -W` lists `docker` processes orphaned
 * by earlier runs, and starting a container is out of scope for this slice. The
 * docker half is proven by (a) the bound being present at every call site, found
 * by paren-balancing, and (b) `spawnSync`'s timeout being demonstrated to kill on
 * this platform with a cheap node child.
 * ================================================================== */

describe('the TCP preflight settles the route ladder in milliseconds (TOOL-10)', () => {
  /** A closed port on the loopback interface. 59999 rather than 5432: the CI DSN
   * ports are matched by `production-artefact-check.js` rule A6 on string
   * literals inside `apps/api/src` and would turn stage 0b red. */
  const CLOSED_PORT = 59999;
  /** RFC 5737 TEST-NET-1: routable-looking, never routed. Used to force the
   * timeout path deterministically without depending on DNS behaviour. */
  const BLACKHOLE_HOST = '192.0.2.1';
  /** RFC 2606 reserves `.invalid` so it can never be delegated: `dns.lookup`
   * answers `ENOTFOUND`, which is the OTHER `indeterminate` shape and the one
   * that costs nothing to produce. Measured on this worktree: 288 ms. */
  const UNRESOLVABLE_HOST = 'schema-drift-gate.invalid';

  let server: ReturnType<typeof createServer> | null = null;
  let listeningPort = 0;

  beforeAll(async () => {
    // Explicit loopback, and port 0 so the OS assigns one: a real listener is the
    // only way to prove the probe can answer `open`, and a probe that could only
    // ever answer `closed` would satisfy every other case in this file while
    // making the gate permanently `tooling_unavailable` on a healthy machine.
    const listening = createServer();
    await new Promise<void>((ready) => {
      listening.listen(0, '127.0.0.1', () => ready());
    });
    const address = listening.address();
    listeningPort = typeof address === 'object' && address !== null ? address.port : 0;
    server = listening;
    expect(listeningPort).toBeGreaterThan(0);
  });

  afterAll(async () => {
    const listening = server;
    server = null;
    if (listening) await new Promise<void>((closed) => listening.close(() => closed()));
  });

  it('answers BOTH directions, and each answer is bounded (AC-1)', () => {
    const refusedAt = Date.now();
    const refused = gate.probeAddress('127.0.0.1', CLOSED_PORT);
    const refusedElapsed = Date.now() - refusedAt;
    expect(refused.state).toBe('refused');
    expect(refused.open).toBe(false);
    expect(refused.detail).toContain('ECONNREFUSED');
    expect(refused.loopback).toBe(true);

    // THE POSITIVE CONTROL. Without it every other assertion here is satisfied by
    // a function that always says "closed".
    const openAt = Date.now();
    const open = gate.probeAddress('127.0.0.1', listeningPort);
    const openElapsed = Date.now() - openAt;
    expect([open.state, open.open]).toEqual(['open', true]);

    // Measured on this tree: 261-334 ms per call, including node boot. The bound
    // is deliberately loose — it is here to catch "unbounded", not to police ms.
    expect(refusedElapsed).toBeLessThan(5000);
    expect(openElapsed).toBeLessThan(5000);
  }, 30000);

  it('walks EVERY address a name resolves to, not just the first (AC-P1)', () => {
    // `dns.lookup('localhost', { all: true })` returns `::1` FIRST on this machine
    // and on most modern runners, and `.github/workflows/ci.yml` addresses the
    // NAME `localhost`, not a literal. A single-socket probe would connect to
    // `::1`, take ECONNREFUSED from an IPv4-only PostgreSQL service, and report a
    // route that works — `psql -h localhost` walks every address — as absent.
    // This case fails on the naive implementation and passes on the correct one.
    const open = gate.probeAddress('localhost', listeningPort);
    expect([open.state, open.open]).toEqual(['open', true]);

    const refused = gate.probeAddress('localhost', CLOSED_PORT);
    expect(refused.state).toBe('refused');
    expect(refused.addresses.length).toBeGreaterThan(0);
  }, 30000);

  it('only ECONNREFUSED is evidence of absence — everything else is indeterminate (AC-P2)', () => {
    // A timeout is not "the server is not there": it is "the probe could not
    // answer". Reading it as absence turns a loaded-but-alive CI PostgreSQL, a
    // hostile NODE_OPTIONS, or a broken node invocation into a permanent gate
    // failure. `indeterminate` descends the real ladder instead, which is now
    // bounded by the second belt.
    const timedOut = gate.probeAddress(BLACKHOLE_HOST, 5433, 400);
    expect(timedOut.state).toBe('indeterminate');
    expect(timedOut.state).not.toBe('refused');
    // …and it is still not treated as a live server.
    expect(timedOut.open).toBe(false);
  }, 30000);

  it('the CLI against a refused address concludes fast, names the ladder, and keeps its verdict (AC-2, AC-3, AC-4, AC-5)', () => {
    const startedAt = Date.now();
    const run = runInChild([], { DATABASE_URL: DEAD_URL });
    const elapsedMs = Date.now() - startedAt;

    expect(run.status).not.toBe(0);

    // AC-P5: the elapsed bound ALONE would pass on a machine whose docker CLI is
    // healthy — i.e. it could not fail on the defect it was written for. So the
    // preflight must be shown to have run and to have produced this verdict.
    expect(run.output).toContain(`nothing is accepting TCP at 127.0.0.1:${CLOSED_PORT}`);
    expect(run.output).toContain('ECONNREFUSED');

    // AC-3 / DNC-08: the run still describes itself, naming all three routes.
    expect(run.output).toContain('prisma db execute');
    expect(run.output).toContain('psql');
    expect(run.output).toContain('pilotage_postgres');
    expect(run.output).toMatch(/SCHEMA DRIFT CHECK: FAIL/);

    // AC-4, the load-bearing anti-regression: the verdict did NOT move. Dropping
    // `error.routeFailure` would slide it to `unreachable_server`, which is also
    // exit 1 and would satisfy every other assertion here while desyncing
    // docs/runbooks/backup-restore-drill.md §8.
    expect(run.output).toContain('SCHEMA DRIFT CHECK: FAIL — tooling_unavailable');

    // AC-2 / AC-5: before the preflight this was unbounded — one invocation had
    // NOT finished at 30 037 ms and had to be killed, its last line still
    // `▶ prisma CLI : …`. Measured after, on this worktree: 442-598 ms across
    // three runs. 20 s is a ceiling with room for a loaded runner, not a target.
    expect(elapsedMs).toBeLessThan(20000);
  }, 60000);

  it('an INDETERMINATE probe descends the real ladder — only a refusal may stop it (AC-P16)', () => {
    // THE MUTANT THIS CASE EXISTS FOR, and it is not hypothetical: the review
    // panel on this slice built it and it left all 123 other cases green.
    // Replace `pre.state === 'refused'` with `!pre.open` at the two call sites in
    // `query()`/`exec()` and every other assertion in this file still passes —
    // while the gate becomes permanently RED on any machine whose probe cannot
    // answer inside its budget (a loaded runner, a hostile NODE_OPTIONS, a DNS
    // hiccup), because "the probe could not answer" would be read as "no server
    // exists". `open` is false for BOTH `refused` and `indeterminate`; only
    // `refused` is evidence, and nothing above this line can tell the two apart
    // at a call site. AC-P2 pins the distinction inside `probeAddress`; this pins
    // that the CALLERS honour it.
    //
    // The premise is asserted before the behaviour, so a resolver that hijacks
    // NXDOMAIN fails this case loudly instead of passing it vacuously.
    const probe = gate.probeAddress(UNRESOLVABLE_HOST, 5433);
    expect([probe.state, probe.open]).toEqual(['indeterminate', false]);

    const run = runInChild([], {
      DATABASE_URL: `postgresql://pilotage:pilotage@${UNRESOLVABLE_HOST}:5433/pilotage?schema=public`,
    });

    // The short-circuit narration is absent: the ladder was NOT stopped.
    // MEASURED against the mutant, both directions, rather than assumed —
    // correct code prints this 0 times, the mutant prints it twice.
    expect(run.output).not.toContain('settles the ladder');
    // Route B was really ATTEMPTED, not narrated. The two forms are what tell
    // them apart: a real attempt reports what the spawn did (`spawnSync psql
    // ENOENT` on a host with no client, an exit code on one that has it), while
    // the short-circuit substitutes a sentence explaining why it was skipped.
    // Asserting the presence of `B. host psql` alone would NOT discriminate —
    // the mutant prints that prefix too.
    expect(run.output).toContain('B. host psql —');
    expect(run.output).not.toContain('B. host psql — it connects to that same address');
    // It still fails, and still with the same verdict: descending the ladder is
    // not a way back to green.
    expect(run.output).toContain('SCHEMA DRIFT CHECK: FAIL — tooling_unavailable');
    expect(run.status).not.toBe(0);
  }, 180000);

  it('`unreachable_server` still exists — the two verdicts were not collapsed (AC-P13)', () => {
    expect(evaluateDrift({ ...healthyRun(), serverReachable: false, toolingAvailable: true }).verdict).toBe(
      'unreachable_server',
    );
    expect(
      evaluateDrift({ ...healthyRun(), serverReachable: false, toolingAvailable: false }).verdict,
    ).toBe('tooling_unavailable');
  });

  it('every `docker` invocation is bounded, and the extractor proves it found them (AC-6)', () => {
    const sites = callSites(EXECUTABLE_SCRIPT, /run\(\s*'docker'/);
    // Non-vacuity FIRST. An extractor that matched nothing would make the loop
    // below pass without reading a single call site.
    expect(sites.length).toBeGreaterThanOrEqual(2);
    // …and it found the right two, so an extractor returning garbage cannot pass.
    expect(sites.filter((site) => site.includes("'port'")).length).toBeGreaterThan(0);
    expect(sites.filter((site) => site.includes("'exec'")).length).toBeGreaterThan(0);
    for (const site of sites) {
      expect([site.slice(0, 40), site.includes('timeoutMs')]).toEqual([site.slice(0, 40), true]);
    }
  });

  it('the package-manager fallback is bounded too — it is on the same path (AC-P6)', () => {
    // `resolvePrismaCli()`'s `pnpm --filter … exec prisma --version` runs whenever
    // `require.resolve` misses (a non-hoisted or partial install), and
    // `probeServer` reaches it before any query. Bounding docker and leaving this
    // one would be bounding half the problem.
    const sites = callSites(EXECUTABLE_SCRIPT, /run\(\s*'pnpm'/);
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) expect(site).toContain('timeoutMs');
  });

  it('an overrun spawn is reported as a NAMED bound, not a raw ETIMEDOUT (AC-7)', () => {
    // The platform fact the branch rests on, measured here rather than assumed:
    // `spawnSync`'s own timeout really kills on Windows (libuv maps it to
    // TerminateProcess) and reports ETIMEDOUT — where bash `timeout` demonstrably
    // does not kill the docker CLI at all.
    const killed = spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeout: 1500 });
    expect((killed.error as NodeJS.ErrnoException | undefined)?.code).toBe('ETIMEDOUT');
    expect(killed.status).toBeNull();

    // …and `run()` turns exactly that into a sentence carrying the number, the
    // same register `scripts/tracing-check.js` and `scripts/boot-check.js` use.
    expect(EXECUTABLE_SCRIPT).toContain("result.error.code === 'ETIMEDOUT'");
    expect(EXECUTABLE_SCRIPT).toContain('did not answer within ');
    expect(EXECUTABLE_SCRIPT).toContain('and was killed');
  }, 30000);

  it('probeServer takes the same fast path and its contract is unchanged (AC-8)', () => {
    // It is paid at MODULE SCOPE by this very file on every jest run of it.
    const startedAt = Date.now();
    expect(gate.probeServer(DEAD_URL)).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(5000);

    // The contract itself: true ONLY on a positive `SELECT 1;` row. A bare TCP
    // listener is therefore NOT enough to make it true, and deliberately so — the
    // positive control for the probe layer is the `open` case above, not this one.
    expect(EXECUTABLE_SCRIPT).toMatch(/function probeServer[\s\S]{0,900}rows\.length > 0/);
    // …and the preflight runs BEFORE the CLI resolution it used to sit behind.
    const body = /function probeServer\(baseUrl\)[\s\S]*?\n}/.exec(EXECUTABLE_SCRIPT)?.[0] ?? '';
    expect(body).not.toBe('');
    expect(body.indexOf('probeAddress')).toBeGreaterThan(-1);
    expect(body.indexOf('probeAddress')).toBeLessThan(body.indexOf('resolvePrismaCli'));
  });

  it('a host-side probe does not silently delete route C (AC-P3)', () => {
    // Routes A and B open a TCP connection to the resolved address, so one probe
    // settles them exactly. Route C — `docker exec pilotage_postgres psql` —
    // connects from INSIDE the container and does not traverse that address at
    // all; what ties it to the probe is `containerAddressesTheUrl()`, which
    // requires the container to publish the URL's port on this machine. So the
    // whole ladder stops only when the address is BOTH refused AND loopback;
    // anything else still tries C, now bounded.
    const predicate = /function preflightSettlesTheAddress\([\s\S]*?\n}/.exec(EXECUTABLE_SCRIPT)?.[0] ?? '';
    expect(predicate).not.toBe('');
    expect(predicate).toContain("state === 'refused'");
    expect(predicate).toContain('loopback');
    expect(gate.probeAddress('127.0.0.1', CLOSED_PORT).loopback).toBe(true);
  }, 30000);

  it('exec() refuses a URL on another server rather than reusing the memoised probe (AC-P7)', () => {
    // The preflight is memoised for ONE address and `exec` takes a URL. Today
    // every caller derives it from the same base (only the database segment
    // moves), but nothing enforced it — and a memoised "refused" applied to a URL
    // on a different server is a wrong verdict waiting for the next caller.
    // No child is spawned by this case: the guard fires before any route.
    //
    // TOOL-11 changed the SHAPE of the refusal, never the rule: it returns
    // `{ ok:false, detail }` instead of throwing. The refusal itself is asserted
    // exactly as before — see the TOOL-11 block below for why the shape matters.
    //
    // TOOL-25: this case used to hand `exec` the base URL, which MEANT "another
    // server" only because the pinned literal named a different port from
    // `DEAD_URL`. Wiring it to the resolved base would make its meaning depend on
    // an untracked file — a checkout whose `.env` named `DEAD_URL`'s own host
    // would turn it vacuous. Two FIXED addresses instead, with the premise
    // asserted before the behaviour.
    expect(new URL(OTHER_SERVER_URL).host).not.toBe(new URL(DEAD_URL).host);
    const routes = gate.openSqlRoutes(DEAD_URL);
    expect(routes.exec(OTHER_SERVER_URL, 'SELECT 1;')).toEqual({
      ok: false,
      detail: expect.stringMatching(/one server/),
    });
  });

  it('the embedded probe source is executable code, and obeys DNC-10 (AC-P8)', () => {
    // Read from the RAW source: the literal lives inside EXECUTABLE_SCRIPT, so
    // asserting "it contains no `//`" against the already-blanked text would be
    // circular.
    // Terminated on a line that STARTS with `].join(` — the array's own closing
    // bracket. Anchoring on `.join(` alone would stop at `errors.join(` inside the
    // child source and silently truncate what is scanned.
    const literal = /const TCP_PROBE_SOURCE = \[[\s\S]*?\r?\n\]\.join\(/.exec(SCRIPT_SOURCE)?.[0] ?? '';
    expect(literal).not.toBe('');
    expect(literal).toContain('node:net');
    expect(literal).toContain('dns.lookup');

    // A string literal in executable position IS executable source to every pin in
    // this file. A `//` inside it would be blanked to end of line by
    // `executableJs`, silently corrupting what those pins read.
    expect(literal).not.toContain('//');
    expect(literal).not.toContain('process.env');
    // ADR-025 D6: host and port reach the child, never a connection string.
    expect(literal).not.toContain('://');
    expect(literal.toLowerCase()).not.toContain('skip');
    for (const token of ['SKIP_', 'ALLOW_', 'BYPASS', '--force', '--update', '--allow', '--source']) {
      expect([token, literal.includes(token)]).toEqual([token, false]);
    }
  });

  it('no probe child is ever handed a connection string (ADR-025 D6, AC-P9)', () => {
    const sites = callSites(EXECUTABLE_SCRIPT, /run\(\s*\n?\s*process\.execPath/);
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect([site.slice(0, 40), site.includes('://')]).toEqual([site.slice(0, 40), false]);
    }
    // The signature is (host, port, timeoutMs) — never a URL.
    expect(EXECUTABLE_SCRIPT).toMatch(/function probeAddress\(host, port, timeoutMs/);
  });

  it('the budgets are named constants, not magic numbers on the gate path (AC-P15)', () => {
    expect(gate.TCP_PREFLIGHT_TIMEOUT_MS).toBe(2000);
    expect(gate.DOCKER_TIMEOUT_MS).toBe(5000);
    expect(EXECUTABLE_SCRIPT).toContain('TCP_PREFLIGHT_TIMEOUT_MS');
    expect(EXECUTABLE_SCRIPT).toContain('DOCKER_TIMEOUT_MS');

    // The docker CONTROL plane (`docker port`, a metadata lookup) and the docker
    // DATA plane (`docker exec … psql`, which carries CREATE/DROP DATABASE) do
    // not share a bound, and that is deliberate — a review finding on this
    // slice. Collapsing them back onto one number would kill a legitimate
    // `CREATE DATABASE` on a cold Docker Desktop and report
    // `scratch_create_failed` on correct code, and `run()`'s bound does not kill
    // grandchildren, so the orphaned scratch database would survive it.
    expect(gate.DOCKER_EXEC_TIMEOUT_MS).toBe(120000);
    expect(gate.DOCKER_EXEC_TIMEOUT_MS).toBeGreaterThan(gate.DOCKER_TIMEOUT_MS);
    const execSite = callSites(EXECUTABLE_SCRIPT, /run\(\s*'docker',\s*\[\s*'exec'/);
    expect(execSite).toHaveLength(1);
    expect(execSite[0]).toContain('DOCKER_EXEC_TIMEOUT_MS');
  });

  it('ci-gate.sh was not touched — raising the bound is the wrong fix (AC-12)', () => {
    // `2bd1a25` already raised the `test:api` bound once, on the misreading this
    // slice removes. The stage bound is read here, never written.
    const gateSource = readFileSync(GATE_PATH, 'utf8');
    expect(gateSource).toContain(SCRIPT_REF);
    expect(gateSource).toContain('2400');
  });
});

/* ================================================================== *
 * 5b. TOOL-11 — a cleanup path that throws ends the run with no verdict
 *     TOOL-12 — routes A and B still descended an unbounded ladder
 *
 * PLACEMENT IS LOAD-BEARING. These cases sit ABOVE `describeWithDb`. Everything
 * below it becomes `describe.skip` on a machine with no reachable PostgreSQL —
 * which is this repository's own TOOL-13 defect, and putting evidence there would
 * mean evidence that can only run where the bug cannot.
 * ================================================================== */

/* `OTHER_SERVER_URL` — a URL on a DIFFERENT server from `DEAD_URL`, different
 * host AND port — is declared with the other fixed fixtures at the head of the
 * file since TOOL-25, because the cross-server case in §5 needs it too. */
/** The same server as `DEAD_URL`, a different database. The negative control. */
const SAME_SERVER_OTHER_DB_URL = 'postgresql://pilotage:pilotage@127.0.0.1:59999/postgres?schema=public';

describe('schema-drift-check: cleanup returns its refusal instead of throwing it (TOOL-11)', () => {
  // These EXECUTE `openSqlRoutes(...).exec(...)` — they are not text assertions.
  // The guard fires before any SQL route is attempted, so the cross-server cases
  // spawn nothing at all.

  it('the cross-server guard REFUSES by returning, with the same words (AC-13)', () => {
    const routes = gate.openSqlRoutes(DEAD_URL);
    let outcome: { ok: boolean; detail: string } | undefined;
    expect(() => {
      outcome = routes.exec(OTHER_SERVER_URL, 'SELECT 1;');
    }).not.toThrow();
    expect(outcome).toEqual({
      ok: false,
      detail: expect.stringContaining('refusing to run SQL against'),
    });
    // The rule is NOT weakened: the refusal still names both servers.
    expect(outcome?.detail).toContain('10.255.255.1:5432');
    expect(outcome?.detail).toContain('127.0.0.1:59999');
  });

  it('a cleanup-shaped `finally` completes, so the run still reaches its verdict (DNC-08)', () => {
    // WHY THIS SHAPE AND NOT A PLAIN CALL. `check()` ends with
    // `finally { cleanup(); }`; `cleanup()` → `dropScratch()` → `routes.exec(...)`.
    // A throw inside a `finally` REPLACES the normal completion of the block, so
    // the old code escaped past the elapsed line and past `return report(state)`
    // and the run ended with no verdict at all — DNC-08 committed by the machinery
    // built to prevent DNC-08. This reproduces that shape and measures it.
    const routes = gate.openSqlRoutes(DEAD_URL);
    let reported = false;

    const completed = (() => {
      try {
        return 'the verdict';
      } finally {
        // Exactly what dropScratch() does on the cleanup path.
        routes.exec(OTHER_SERVER_URL, 'DROP DATABASE "schema_drift_1" WITH (FORCE);');
      }
    })();
    reported = true;

    // Before TOOL-11 the throw replaced the `return`, the IIFE threw, and neither
    // of these lines was ever reached.
    expect(completed).toBe('the verdict');
    expect(reported).toBe(true);
  });

  it('a SAME-server URL is not refused — the negative control (AC-13)', () => {
    // Without this, the case above would be satisfied by an `exec` that refuses
    // everything. `DEAD_URL`'s port is closed, so the preflight settles the
    // address and no SQL route is attempted; the point is only that the outcome
    // is NOT the cross-server refusal.
    const routes = gate.openSqlRoutes(DEAD_URL);
    const outcome = routes.exec(SAME_SERVER_OTHER_DB_URL, 'SELECT 1;');
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).not.toContain('refusing to run SQL against');
  }, 30000);

  it('the guard rests on host/port invariance, and that invariance is pinned', () => {
    // The fast path is sound rather than lucky: `deriveMaintenanceUrl` and
    // `buildScratchUrl` vary ONLY the database path segment, so one probe really
    // does describe every URL `exec` is handed today. `buildScratchUrl` is pinned
    // elsewhere; the maintenance URL's HOST was not, and that is the fact this
    // whole guard rests on.
    const base = new URL(RESOLVED_BASE_URL);
    const maintenance = new URL(gate.deriveMaintenanceUrl(RESOLVED_BASE_URL));
    const scratch = new URL(gate.buildScratchUrl(RESOLVED_BASE_URL, 'schema_drift_11'));
    expect([maintenance.hostname, maintenance.port]).toEqual([base.hostname, base.port]);
    expect([scratch.hostname, scratch.port]).toEqual([base.hostname, base.port]);
    expect(maintenance.pathname).toBe('/postgres');
    expect(scratch.pathname).toBe('/schema_drift_11');
  });
});

describe('schema-drift-check: routes A and B are bounded, data-plane sized (TOOL-12)', () => {
  it('the host psql route carries a named bound, and it is NOT the control-plane one (AC-14)', () => {
    // Route B carries the same statements as route C — `CREATE DATABASE …
    // TEMPLATE template0`, `DROP DATABASE … WITH (FORCE)` — just over the wire
    // instead of through `docker exec`. Same work, same budget. Collapsing it
    // onto `DOCKER_TIMEOUT_MS` (a `docker port` metadata lookup) would kill a
    // legitimate CREATE partway and report `scratch_create_failed` on correct
    // code, which is the precedent `DOCKER_EXEC_TIMEOUT_MS` already carries.
    expect(gate.PSQL_HOST_TIMEOUT_MS).toBe(120000);
    expect(gate.PSQL_HOST_TIMEOUT_MS).toBeGreaterThan(gate.DOCKER_TIMEOUT_MS);

    // NON-VACUITY FIRST, on the comment-blanked source: a bound merely NAMED in a
    // comment must not satisfy this. TOOL-07 and TOOL-08 were made of exactly that.
    //
    // TOOL-23 moved the ANCHOR and nothing else: the call is now
    // `run(psql.command, …)` because the binary is discovered rather than assumed
    // to be on PATH, so `/run\(\s*'psql'/` matches zero sites. The two assertions
    // are kept verbatim — `toHaveLength(1)` is the non-vacuity half and the bound
    // is the TOOL-12 ratchet. Relaxing either (to `>= 1`, or to a looser regex
    // such as `/run\(\s*psql/i` that a comment could satisfy) would lose the
    // 120 s bound on the very route this slice exists to enable.
    const sites = callSites(EXECUTABLE_SCRIPT, /run\(\s*psql\.command/);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toContain('PSQL_HOST_TIMEOUT_MS');
    // …and the bare-name spelling is really gone, so the discovery module cannot
    // be reintroduced-around by a second, undiscovered call site.
    expect(callSites(EXECUTABLE_SCRIPT, /run\(\s*'psql'/)).toHaveLength(0);
  });

  it('the Prisma CLI route carries a named bound larger than the version probe (AC-14)', () => {
    // `PRISMA_CLI_PROBE_TIMEOUT_MS` bounds `prisma --version`, a lookup. Route A
    // is `db execute`, `migrate deploy` and `migrate diff` — `migrate deploy`
    // replays the entire ledger. Reusing the probe's bound here would kill a real
    // deploy, so the two are asserted DIFFERENT rather than merely present.
    expect(gate.PRISMA_RUN_TIMEOUT_MS).toBe(300000);
    expect(gate.PRISMA_RUN_TIMEOUT_MS).toBeGreaterThan(gate.PRISMA_CLI_PROBE_TIMEOUT_MS);

    const sites = callSites(EXECUTABLE_SCRIPT, /run\(\s*cli\.command/);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toContain('PRISMA_RUN_TIMEOUT_MS');
  });

  it('every spawn on the SQL ladder is now bounded — none is left unbounded', () => {
    // The sweep, so a future route added without a bound is caught rather than
    // discovered in CI. Measured against HEAD before this change: `run('psql'` and
    // `run(cli.command` each had exactly 1 site and NEITHER contained `timeoutMs`,
    // so both cases above are genuinely red-before / green-after.
    const ladder: Array<[string, RegExp]> = [
      // `psql.command` since TOOL-23 — the same single site, discovered instead of
      // assumed. See the anchor note in the case above.
      ['psql', /run\(\s*psql\.command/],
      ['prisma', /run\(\s*cli\.command/],
      ['docker exec', /run\(\s*'docker',\s*\[\s*'exec'/],
      ['docker port', /run\(\s*'docker',\s*\[\s*'port'/],
    ];
    for (const [name, anchor] of ladder) {
      const sites = callSites(EXECUTABLE_SCRIPT, anchor);
      // Non-vacuity before content, per site.
      expect([name, sites.length]).toEqual([name, 1]);
      expect([name, (sites[0] ?? '').includes('timeoutMs')]).toEqual([name, true]);
    }
  });
});

/* ================================================================== *
 * 5c. TOOL-23 / TOOL-24 — the client is DISCOVERED, and a client failure is no
 *     longer reported as an absent server
 *
 * PLACEMENT IS LOAD-BEARING, for the same reason the TOOL-11/TOOL-12 block above
 * says so: everything below `describeWithDb` becomes `describe.skip` on a machine
 * with no reachable PostgreSQL — which is precisely the machine this slice is
 * about — so evidence placed there would be evidence that can only run where the
 * bug cannot.
 *
 * THE DEFECT, MEASURED 2026-08-13 (run 50). `127.0.0.1:5432` accepts TCP in 3 ms,
 * a complete PostgreSQL 15 client set sits at `C:\Program Files\PostgreSQL\15\bin`
 * and `psql … -c "select version();"` returns `PostgreSQL 15.3` — and the gate
 * printed « no PostgreSQL server answered at the resolved address ». Two defects,
 * one sentence: the client was looked for on the inherited PATH and nowhere else
 * (TOOL-23), and `check()`'s catch asserted `serverReachable = false` for ANY
 * route failure although `error.routeFailure` is a statement about the CLIENT
 * (TOOL-24).
 *
 * WHY THESE CASES ASSERT ON `failures[]` AND NOT ON THE HEADLINE. On every path
 * the suite currently drives, the headline is ALREADY `tooling_unavailable` by
 * precedence and the exit code is ALREADY 1 — so a test written against the
 * headline would have been green before the change too. The only observable
 * deltas are inside the failure list, and they are asserted in BOTH directions:
 * the sentence must be GONE on a live preflight and PRESENT on a refused one. One
 * assertion that behaves differently on the two preflight states is the only proof
 * the conflation was removed rather than the sentence deleted globally.
 * ================================================================== */

describe('schema-drift-check: a client failure is not an absent server (TOOL-24)', () => {
  /** RFC 2606 reserves `.invalid`, so `dns.lookup` answers `ENOTFOUND` — the
   * cheapest deterministic `indeterminate`. */
  const LIVE_PREFLIGHT_URL = 'postgresql://pilotage:pilotage@schema-drift-gate.invalid:5433/pilotage?schema=public';

  it('a route failure with a NON-refused preflight no longer claims the server was absent (AC-4)', () => {
    const run = runInChild([], { DATABASE_URL: LIVE_PREFLIGHT_URL });

    // The premise, asserted before the behaviour: this really is the
    // `indeterminate` path, so the case cannot pass by addressing something else.
    expect(run.output).toContain('`indeterminate`');

    // 1. The false sentence is GONE. It is the sentence that parked RLS, VAL-03
    //    and TOOL-13's drift half for eight consecutive runs.
    expect(run.output).not.toContain('no PostgreSQL server answered');

    // 2. The run says what it actually MEASURED (DNC-08: a run must describe
    //    itself), and reports reachability as unknown rather than as absence —
    //    `serverReachable` now appears in the missing-evidence list, which is the
    //    truthful outcome and is exactly what `null` buys.
    expect(run.output).toContain('Reachability is therefore reported as UNKNOWN rather than as absence');
    expect(run.output).toContain('Missing: serverReachable');

    // 3. It is still a FAILURE, with the same verdict and a non-zero exit. This
    //    change removes a conflation; it must not make the gate tolerant.
    expect(run.output).toContain('SCHEMA DRIFT CHECK: FAIL — tooling_unavailable');
    expect(run.status).not.toBe(0);
  }, 180000);

  it('THE INVERTED CONTROL — a genuinely refused address still fires unreachable_server (AC-5)', () => {
    // Without this case, the one above is satisfied by deleting the sentence
    // unconditionally. `DEAD_URL` is a closed loopback port, i.e. a genuinely
    // absent server, and the preflight measures `refused` there.
    //
    // THIS IS ALSO THE MUTANT KILLER. Write the catch as
    // `serverReachable = routeFailure ? null : false` — dropping the conjunction —
    // and `unreachable_server` stops being emitted here, so this case goes red
    // while every other assertion in the file stays green.
    const run = runInChild([], { DATABASE_URL: DEAD_URL });
    expect(run.output).toContain('ECONNREFUSED');
    expect(run.output).toContain('no PostgreSQL server answered at the resolved address');
    expect(run.output).toContain('The route back to green is starting a database, never editing code');
    // The HEADLINE is unchanged and stays `tooling_unavailable` by precedence —
    // `unreachable_server` is a FINDING here, not the headline, and asserting the
    // headline would be testing the wrong thing (`docs/runbooks/…` §9 and the
    // existing case at "the CLI against a refused address" both record this).
    expect(run.output).toContain('SCHEMA DRIFT CHECK: FAIL — tooling_unavailable');
    expect(run.status).not.toBe(0);
  }, 120000);

  it('`serverReachable` stays true | false | null — a sentinel string never reaches ok (AC-4b)', () => {
    // The tri-state temptation: told "do not assert false", the obvious next move
    // is `serverReachable = 'unknown'`. `evaluateDrift` checks `=== false`
    // (skipped, truthy string) and REQUIRED_EVIDENCE filters `null`/`undefined`
    // (skipped, it is a string) — so a field carrying ZERO evidence would satisfy
    // the evidence requirement. That is DNC-08 committed inside the function
    // written to prevent DNC-08, the same defect `evaluateDrill({})` was caught
    // for. Pinned in `evaluateDrift` so it holds however the caller is written.
    for (const sentinel of ['unknown', 'indeterminate', 'maybe', 0, 1]) {
      const outcome = evaluateDrift({ ...healthyRun(), serverReachable: sentinel });
      expect([sentinel, outcome.verdict === 'ok']).toEqual([sentinel, false]);
      expect([sentinel, outcome.exitCode]).toEqual([sentinel, 1]);
    }
    // …and the three legitimate values behave as documented.
    expect(evaluateDrift({ ...healthyRun(), serverReachable: true }).verdict).toBe('ok');
    expect(evaluateDrift({ ...healthyRun(), serverReachable: false }).verdict).toBe('unreachable_server');
    expect(evaluateDrift({ ...healthyRun(), serverReachable: null }).verdict).toBe('unknown');
  });

  it('a TCP accept is never promoted to "a PostgreSQL answered" (AC-4c)', () => {
    // `preflight.state === 'open'` must NEVER set `serverReachable = true`: a
    // tunnel, a proxy, Traefik or any unrelated service accepts a connection
    // identically. Only a successful `SELECT 1;` may set it true, and it does so
    // on the SUCCESS path, never in the catch.
    const body = /const check = \(\) => \{[\s\S]*?\n {2}\};/.exec(EXECUTABLE_SCRIPT)?.[0] ?? '';
    expect(body).not.toBe('');
    const assignments = body.match(/state\.serverReachable = [^;]+;/g) ?? [];
    expect(assignments).toHaveLength(2);
    // The success path, and it is the ONLY `true`.
    expect(assignments.filter((line) => line.includes('true'))).toHaveLength(1);
    // The catch: conjunctive, and `'refused'` is what keeps `false` reachable.
    const inCatch = assignments.find((line) => line.includes('routeFailure')) ?? '';
    expect(inCatch).toContain("preflightState !== 'refused'");
    expect(inCatch).toContain('preflightState !== null');
    expect(inCatch).toContain('null : false');
    // No sentinel: the softened value is `null`, not a string.
    expect(body).not.toMatch(/state\.serverReachable = ['"]/);
  });

  it('the preflight state is CARRIED to the catch, never re-measured there', () => {
    // A second probe can disagree with the first, and the run would then report
    // two different truths about one address. It is attached at the throw site in
    // `query()` and read in `check()`.
    expect(EXECUTABLE_SCRIPT).toMatch(/error\.preflightState = pre\.state;/);
    const body = /const check = \(\) => \{[\s\S]*?\n {2}\};/.exec(EXECUTABLE_SCRIPT)?.[0] ?? '';
    expect(body).toContain('error.preflightState');
    expect(body).not.toContain('probeAddress');
  });

  it('preflightState is NARRATION — no verdict rests on it (AC-7 of the slice)', () => {
    // It is deliberately absent from REQUIRED_EVIDENCE: adding it would make a
    // run that never reached a preflight report `unknown` for a field that is not
    // evidence of anything.
    expect(evaluateDrift({ ...healthyRun() }).verdict).toBe('ok');
    expect(evaluateDrift({ ...healthyRun(), preflightState: 'open' }).verdict).toBe('ok');
    expect(evaluateDrift({ ...healthyRun(), preflightState: null }).verdict).toBe('ok');

    // …and when it IS present on a tooling failure it is APPENDED to the existing
    // message rather than replacing it. Both halves asserted, so a rewrite of the
    // original sentence is caught.
    const failures = evaluateDrift({
      ...healthyRun(),
      toolingAvailable: false,
      toolingDetail: 'every route was tried',
      serverReachable: null,
      preflightState: 'indeterminate',
    }).failures.join('\n');
    expect(failures).toContain('no usable route to the database and/or to the Prisma CLI');
    expect(failures).toContain('every check below would pass vacuously (DNC-08)');
    expect(failures).toContain('The TCP preflight measured `indeterminate` at the resolved address');
    expect(failures).not.toContain('no PostgreSQL server answered');

    // The same input with `refused` keeps the absence claim — the inverted control
    // at the level of the pure function.
    const refused = evaluateDrift({
      ...healthyRun(),
      toolingAvailable: false,
      serverReachable: false,
      preflightState: 'refused',
    }).failures.join('\n');
    expect(refused).toContain('no PostgreSQL server answered at the resolved address');
  });

  it('the psql binary comes from the shared discovery module, with no options (TOOL-23, DNC-10)', () => {
    // The ladder lives in ONE place — the sameness TOOL-22 made structural for the
    // ADDRESS is now structural for the CLIENT. And the injectable `options`
    // parameter that the module's own spec points at a fixture tree must NOT be
    // passed here: a production call site that supplied roots would BE the
    // backdoor the seam is otherwise not.
    expect(EXECUTABLE_SCRIPT).toContain("require('./lib/postgres-client-path')");
    const sites = callSites(EXECUTABLE_SCRIPT, /postgresClient\(/);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toBe("('psql')");
    // The credential still travels in the environment, never in argv — discovery
    // changed WHICH binary is spawned, not HOW the password travels (ADR-025 D6).
    const spawnSite = callSites(EXECUTABLE_SCRIPT, /run\(\s*psql\.command/)[0] ?? '';
    expect(spawnSite).toContain('PGPASSWORD: source.password');
    expect(spawnSite).not.toContain('--password');
    expect(spawnSite).not.toContain('://');
  });
});

/* ================================================================== *
 * 5d. TOOL-25 — the address is RESOLVED, and the resolver is the same file the
 *     two gate scripts load
 *
 * PLACEMENT IS LOAD-BEARING, for the third time in this file and for the same
 * reason spelled out at the TOOL-11 block: everything below `describeWithDb`
 * becomes `describe.skip` on a machine with no reachable PostgreSQL, and this
 * slice is ABOUT the machine that was wrongly classified that way. Evidence for
 * it may not live somewhere it can only run once the bug is gone.
 * ================================================================== */

const SPEC_PATH = join(REPO_ROOT, 'apps', 'api', 'src', 'shared', 'quality', 'schema-drift-gate.spec.ts');
const SPEC_SOURCE = readFileSync(SPEC_PATH, 'utf8');

/**
 * Which source decided the address — for the skip warning, and nothing else.
 *
 * DNC-08 in one line: « 5433 refused » is useless, « 5433, from the built-in
 * fallback because no `.env` was found » tells the reader the host was never
 * configured. Both arguments are REQUIRED and neither has a default: this is a
 * narration helper, it decides no verdict, and it must not read like a knob
 * (DNC-10). It is pure, so the cases below exercise the very code the warning
 * runs — a message that only executes on an unreachable host would otherwise ship
 * unexecuted, which is a fresh DNC-08 at the address of the DNC-08 guard.
 */
function describeAddressSource(env: NodeJS.ProcessEnv, files: string[]): string {
  if (env.DATABASE_URL) return 'the exported DATABASE_URL';
  for (const file of files) {
    if (readDatabaseUrlFrom(file)) return relative(REPO_ROOT, file).replace(/\\/g, '/');
  }
  return "the built-in fallback — no .env on this checkout supplies DATABASE_URL, so this host was never configured";
}

describe('the address is resolved through the shared module, and cannot diverge again (TOOL-25)', () => {
  it('the spec loads THE SAME FILE the two gate scripts load — asserted on identity, not on value', () => {
    // NOT `expect(RESOLVED_BASE_URL).toBe(defaultDatabaseUrl())`: that compares a
    // value to the call that produced it and is green by construction on every
    // host forever — the exact shape of check this slice exists to abolish. The
    // property that matters is MODULE IDENTITY.
    // Separators normalised and nothing else: both sides stay absolute paths, so
    // this remains an identity assertion and not a substring one.
    const norm = (path: string): string => resolve(path).replace(/\\/g, '/');
    expect(norm(require.resolve(DEFAULT_DB_URL_PATH))).toBe(
      norm(resolve(REPO_ROOT, 'scripts', 'lib', 'default-database-url.js')),
    );
    // …and the resolver really is what this file consulted: a base that came from
    // anywhere else would not be a string of the shape the module returns.
    expect(typeof RESOLVED_BASE_URL).toBe('string');
    expect(RESOLVED_BASE_URL).toMatch(/^postgres(?:ql)?:\/\//);
  });

  it('the module is really the decider — the negative control', () => {
    // Proof the seam is load-bearing rather than decorative: point the reader at a
    // fixture and it returns THAT value. If this file had its own resolution path,
    // this case would be about a function nothing consults.
    const dir = mkdtempSync(join(tmpdir(), 'drift-dburl-'));
    const file = join(dir, '.env');
    writeFileSync(file, 'DATABASE_URL=postgresql://fixture:pw@fixture.invalid:1/d\n', 'utf8');
    expect(readDatabaseUrlFrom(file)).toBe('postgresql://fixture:pw@fixture.invalid:1/d');
    expect(readDatabaseUrlFrom(join(dir, 'absent'))).toBeUndefined();
  });

  it('this spec carries NO second resolution path', () => {
    // One `DATABASE_URL` read, the module for everything else. A second env var,
    // or a second literal default, is how the divergence TOOL-22 fixed in the
    // scripts survived here for three more slices.
    // Non-vacuity: SPEC_SOURCE really is this file.
    expect(SPEC_SOURCE).toContain('the address is resolved through the shared module');
    // The same idiom the script's own case above uses, on the comment-blanked
    // text so a variable merely NAMED in prose cannot satisfy or break it.
    const reads = executableJs(SPEC_SOURCE).match(/process\.env\.[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    expect([...new Set(reads)]).toEqual(['process.env.DATABASE_URL']);
  });

  it('no DSN literal left in this file addresses the resolved base', () => {
    // A relationship, not a text pattern. A regex for one loopback spelling walks
    // straight past `localhost:5432` or `[::1]:5432`; "no literal in here names the
    // live server" is the actual property, and it holds because every literal that
    // survives exists to prove a FAILURE direction — `DEAD_URL`, `OTHER_SERVER_URL`,
    // `SAME_SERVER_OTHER_DB_URL`, `LIVE_PREFLIGHT_URL`, `REDACTION_SAMPLE_URL`.
    const dsns = (SPEC_SOURCE.match(/postgres(?:ql)?:\/\/[^\s'"`]+/g) ?? []).filter(
      (dsn) => !dsn.includes('${'),
    );
    // Non-vacuity first: a regex that found nothing would make the loop pass
    // without reading a single literal.
    expect(dsns.length).toBeGreaterThanOrEqual(4);
    const baseHost = new URL(RESOLVED_BASE_URL).host;
    for (const dsn of dsns) {
      expect([dsn, new URL(dsn).host === baseHost]).toEqual([dsn, false]);
    }
  });

  it('the skip warning names WHICH source resolved the address (DNC-08)', () => {
    // The warning text is only built on an unreachable host, so its builder is
    // exercised here instead — otherwise the P0-5 message ships unexecuted.
    expect(describeAddressSource({ DATABASE_URL: 'postgresql://u:p@h:1/d' }, [])).toContain(
      'exported DATABASE_URL',
    );

    const dir = mkdtempSync(join(tmpdir(), 'drift-src-'));
    const file = join(dir, '.env');
    writeFileSync(file, 'DATABASE_URL=postgresql://u:p@h:1/d\n', 'utf8');
    expect(describeAddressSource({}, [file])).toContain('.env');
    expect(describeAddressSource({}, [join(dir, 'absent')])).toContain('built-in fallback');

    // The three branches are DISTINCT — a helper that returned one sentence for
    // everything would satisfy the three assertions above only by accident.
    const answers = new Set([
      describeAddressSource({ DATABASE_URL: 'x' }, [file]),
      describeAddressSource({}, [file]),
      describeAddressSource({}, []),
    ]);
    expect(answers.size).toBe(3);
  });
});

/* ================================================================== *
 * 5f. The end-to-end block is bounded by ADDRESS as well as by NAME
 *
 * WHY THIS EXISTS. TOOL-25 replaced the dead 5433 literal with the project's own
 * resolver, and in doing so turned the end-to-end block below from a block that
 * had never executed anywhere into one that really runs `CREATE DATABASE`,
 * `prisma migrate deploy`, `DROP DATABASE … WITH (FORCE)` and a `pg_database`
 * scan on the maintenance database of whatever host the untracked `.env` names.
 * The containment argument written at the head of this file is stated purely in
 * terms of the NAME — `SCRATCH_NAME_PATTERN`, `isSafeScratchTarget`,
 * `buildChildEnv` — and that half is true and unchanged: this suite can create
 * and destroy `schema_drift_%` and nothing else. But a name bound says nothing
 * about WHERE, and `.env` on a deployed checkout (the Hostinger VPS is the
 * concrete instance) is a production DSN with production credentials. `pnpm test`
 * there would have run the ledger against the live server.
 *
 * THE REPAIR IS A NARROWING OF THE GUARD THAT ALREADY EXISTED, not a new option.
 * `describeWithDb` asked one question — "does a server answer?" — and it now asks
 * two: does a server answer, AND is the address this machine. Both answers come
 * from seams the gate already exports and this file already drives:
 * `gate.probeAddress(...).loopback` (pinned at AC-1 above) and `gate.probeServer`.
 * No flag, no environment knob, no `.env` key — DNC-10 is untouched. A
 * non-loopback address SKIPS with a reason that names the address, exactly as an
 * unreachable one already did; the gate itself (stage 0d of `ci-gate.sh`) is
 * unaffected and still fails rather than skipping (ADR-027).
 *
 * PLACEMENT, for the fourth time in this file and for the same reason: these
 * cases are a plain `describe`, defined ABOVE `describeWithDb`, and they inject
 * both probes. Evidence for a guard whose whole job is to decide whether the
 * destructive block runs may not itself live inside the destructive block.
 * ================================================================== */

type AddressProbe = ReturnType<SchemaDriftModule['probeAddress']>;

/**
 * Reachable AND loopback, or a named reason. Pure with respect to this file: the
 * two probes are injected so both directions can be driven deterministically on
 * any host, and the defaults are the gate's own exports — the same "a function
 * seam, never a CLI flag" idiom `deployMigrations` uses.
 *
 * ORDER IS LOAD-BEARING. The address is classified BEFORE `probeServer`, because
 * `probeServer` opens a credentialed `SELECT 1;` through the Prisma CLI. On a
 * production DSN even that is a connection this suite has no business making, so
 * a non-loopback target is refused on the TCP preflight alone.
 */
function classifyEndToEndTarget(
  url: string,
  probeAddress: (host: string, port: string) => AddressProbe = (host, port) => gate.probeAddress(host, port),
  probeServer: (target: string) => boolean = (target) => gate.probeServer(target),
): { runnable: boolean; why: string } {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { runnable: false, why: 'DATABASE_URL is not a usable connection string' };
  }
  const host = target.hostname;
  const port = target.port || '5432';
  const probe = probeAddress(host, port);
  const where = `${host}:${port} — ${probe.state}: ${probe.detail} (after ${probe.elapsedMs} ms)`;
  if (!probe.loopback) {
    // `loopback` is `addresses.length > 0 && addresses.every(isLoopbackAddress)`,
    // so a probe that could not answer at all (no addresses) lands HERE, on the
    // safe side. That is deliberate: this block is destructive, and "I could not
    // tell where this is" must not be read as "it is local".
    return {
      runnable: false,
      why:
        `${where}; it resolves to ${probe.addresses.join(', ') || 'no address'}, which is NOT the loopback ` +
        `interface — this block CREATEs and DROPs databases, so it only ever addresses this machine`,
    };
  }
  if (!probeServer(url)) return { runnable: false, why: where };
  return { runnable: true, why: where };
}

describe('the destructive end-to-end block is bounded by ADDRESS, not only by NAME', () => {
  const answer = (over: Partial<AddressProbe>): AddressProbe => ({
    open: true,
    state: 'open',
    detail: 'connected',
    addresses: ['127.0.0.1'],
    loopback: true,
    elapsedMs: 1,
    ...over,
  });

  it('a REACHABLE non-loopback target is refused, and nothing is sent to it', () => {
    // The defect in one case: before this guard, `probeServer` said "yes" on a
    // remote production DSN and the block below ran its DDL there.
    let serverProbes = 0;
    const verdict = classifyEndToEndTarget(
      OTHER_SERVER_URL,
      () => answer({ addresses: ['10.255.255.1'], loopback: false }),
      () => {
        serverProbes += 1;
        return true;
      },
    );
    expect(verdict.runnable).toBe(false);
    expect(verdict.why).toContain('10.255.255.1');
    expect(verdict.why).toContain('NOT the loopback');
    // …and the credentialed `SELECT 1;` never left this machine (see the order
    // note above). A guard that skipped only AFTER connecting would satisfy the
    // three assertions above and still touch the production server.
    expect(serverProbes).toBe(0);
  });

  it('THE POSITIVE CONTROL — a loopback target that answers still RUNS', () => {
    // Without this case the guard is satisfied by returning `false` always, which
    // would silently retire every end-to-end case in this file — the DNC-08 this
    // whole section exists to prevent, committed while preventing it.
    expect(classifyEndToEndTarget(DEAD_URL, () => answer({}), () => true).runnable).toBe(true);
  });

  it('a loopback target that does NOT answer is refused, with the probe detail carried', () => {
    const verdict = classifyEndToEndTarget(
      DEAD_URL,
      () => answer({ open: false, state: 'refused', detail: 'ECONNREFUSED' }),
      () => false,
    );
    expect(verdict.runnable).toBe(false);
    expect(verdict.why).toContain('ECONNREFUSED');
  });

  it('a probe that could not answer is refused — unknown is not local', () => {
    const verdict = classifyEndToEndTarget(
      DEAD_URL,
      () => answer({ open: false, state: 'indeterminate', detail: 'ENOTFOUND', addresses: [], loopback: false }),
      () => true,
    );
    expect(verdict.runnable).toBe(false);
    expect(verdict.why).toContain('no address');
  });

  it('an unusable connection string is refused rather than probed', () => {
    const verdict = classifyEndToEndTarget('not a connection string', () => answer({}), () => true);
    expect(verdict.runnable).toBe(false);
    expect(verdict.why).toContain('not a usable connection string');
  });

  it('the REAL probe distinguishes the two directions — the injected cases are not vacuous', () => {
    // AC-1 above already pins `loopback === true` for `127.0.0.1`. The negative
    // direction is what this guard turns on, and a `loopback` field that were
    // always true would make every assertion above pass against fixtures while
    // the shipped guard let a remote address through. RFC 5737 TEST-NET-1:
    // routable-looking, never routed, and bounded so it costs 400 ms.
    const remote = gate.probeAddress('192.0.2.1', 5432, 400);
    expect(remote.addresses).toContain('192.0.2.1');
    expect(remote.loopback).toBe(false);
  }, 30000);
});

/* ================================================================== *
 * 6. One agreement against a real PostgreSQL — guarded, never silent
 *
 * ORDERING NOTE, load-bearing: the full-CLI cases run FIRST, because the CLI
 * sweeps every `schema_drift_%` database it finds — including one this file
 * created. The fixture-driven block below therefore builds its scratch database
 * only after the CLI has finished.
 * ================================================================== */

/**
 * The ONE resolution expression in this file. Shape unchanged from before
 * TOOL-25 — an explicitly exported `DATABASE_URL` still wins, identically to
 * `schema-drift-check.js:204` and `restore-drill.js:145` — only the fallback
 * moved from a literal to the shared resolver. Hoisted and reused by the
 * end-to-end blocks below: three copies of the address expression inside the file
 * whose slice is about having ONE would be the joke telling itself.
 */
const PROBE_URL = process.env.DATABASE_URL || RESOLVED_BASE_URL;
/** Reachable AND loopback — see §5f for why the second half is not optional. */
const endToEndTarget = classifyEndToEndTarget(PROBE_URL);
const reachable = endToEndTarget.runnable;
const describeWithDb = reachable ? describe : describe.skip;

if (!reachable) {
  // Loud, not silent. No `eslint-disable` directive here on purpose:
  // `apps/api/eslint.config.js` sets `no-console: 'off'`, so the directive would
  // itself be an unused-directive warning that the lint ratchet catches — which
  // is how it caught `link-integrity-gate.spec.ts`.
  //
  // It names WHY, not just that (TOOL-10 / AC-P4): a false negative here does not
  // merely fail a stage — it turns the whole end-to-end block, including "the
  // unmodified repository PASSES", into `describe.skip` and reports green. That
  // is DNC-08 committed at the address of the DNC-08 guard, so the reason has to
  // be readable without re-running anything.
  //
  // The reason is CARRIED from the one classification, never re-measured here: a
  // second probe can disagree with the first, and the run would then print one
  // truth about the address while having acted on another — the mistake
  // `error.preflightState` was introduced to stop in `check()` (TOOL-24).
  console.warn(
    `[schema-drift-gate] the end-to-end cases are skipped: ${endToEndTarget.why} ` +
      `(address resolved from ${describeAddressSource(process.env, ENV_FILES)}). ` +
      `Every classifier, verdict, safety, wiring and DNC case in ` +
      `this file is deterministic and ran. The gate itself is stage 0d of ci-gate.sh, which DOES ` +
      `require a database and fails rather than skipping (ADR-027).`,
  );
}

describeWithDb('the CLI, executed against a real PostgreSQL', () => {
  it('the unmodified repository PASSES — the gate is not red on correct code (AC-2)', () => {
    const run = runInChild([], {});
    expect(run.output).toContain('SCHEMA DRIFT CHECK: PASS');
    expect(run.status).toBe(0);
  }, 180000);

  it('leaves no scratch database behind (AC-11)', () => {
    const rows = gate
      .openSqlRoutes(PROBE_URL)
      .query('postgres', "SELECT datname::text FROM pg_database WHERE datname LIKE 'schema\\_drift\\_%';");
    expect(rows.map((r) => r[0])).toEqual([]);
  }, 180000);
});

describeWithDb('the diff and the deploy, driven through the exported seams', () => {
  const baseUrl = PROBE_URL;
  const routes = gate.openSqlRoutes(baseUrl);
  const maintenanceUrl = deriveMaintenanceUrl(baseUrl);
  const scratchName = `schema_drift_${Date.now()}${process.pid}`;
  const scratchUrl = buildScratchUrl(baseUrl, scratchName);
  let created = false;

  beforeAll(() => {
    const create = routes.exec(maintenanceUrl, `CREATE DATABASE "${scratchName}" TEMPLATE template0;`);
    expect(create.ok).toBe(true);
    created = true;
    const deployed = gate.deployMigrations({ migrationsDir: gate.MIGRATIONS_DIR, scratchUrl });
    expect(deployed.status).toBe(0);
  }, 300000);

  afterAll(() => {
    if (created) routes.exec(maintenanceUrl, `DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE);`);
  }, 180000);

  it('the ledger really builds the schema the datamodel describes (AC-2)', () => {
    const count = Number(
      routes.query(
        scratchName,
        "SELECT count(*)::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';",
      )[0]?.[0],
    );
    expect(count).toBeGreaterThanOrEqual(MIN_EXPECTED_TABLES);

    const diff = gate.runDiff({ datamodelPath: gate.SCHEMA_PATH, scratchUrl });
    expect(classifyDiffExit(diff.status)).toBe('in-sync');
    expect(diff.output).toContain('No difference detected');
  }, 180000);

  it('a datamodel the ledger does not build FAILS, naming the drifted object (AC-1)', () => {
    // The tracked `schema.prisma` is opened READ-ONLY and never written. A spec
    // that edited it would leave the repository dirty on any crash — and the
    // routine's own git salvage would then commit a mutated schema, which
    // ADR-025 D7 already ruled on (PF-77 / R-27). The mutation lives in a temp
    // directory and reaches the gate through the exported seam, not through a
    // CLI flag.
    const dir = mkdtempSync(join(tmpdir(), 'schema-drift-spec-'));
    const datamodelPath = join(dir, 'schema.prisma');
    copyFileSync(gate.SCHEMA_PATH, datamodelPath);
    writeFileSync(
      datamodelPath,
      `${readFileSync(datamodelPath, 'utf8')}\nmodel DriftProbe {\n  id String @id @default(uuid()) @db.Uuid\n  driftProbeColumn String\n}\n`,
    );
    expect(readFileSync(gate.SCHEMA_PATH, 'utf8')).not.toContain('DriftProbe');

    const diff = gate.runDiff({ datamodelPath, scratchUrl });
    expect(classifyDiffExit(diff.status)).toBe('drift');
    expect(diff.status).toBe(2);
    // "naming the drifted object" — asserted on the object, not on the word
    // "differs".
    expect(diff.output).toContain('DriftProbe');

    const outcome = evaluateDrift({ ...healthyRun(), diffExitCode: diff.status, diffOutput: diff.output });
    expect(outcome.verdict).toBe('schema_drift');
    expect(outcome.exitCode).toBe(1);
    expect(outcome.failures.join('\n')).toContain('DriftProbe');
  }, 180000);

  it('a migration that does not execute on PostgreSQL FAILS (AC-3)', () => {
    // Its own scratch database: the shared one already carries the real ledger,
    // and a divergent migrations directory applied on top of it would fail for
    // the wrong reason.
    const dir = mkdtempSync(join(tmpdir(), 'schema-drift-badmig-'));
    mkdirSync(join(dir, 'migrations', '0_broken'), { recursive: true });
    copyFileSync(gate.SCHEMA_PATH, join(dir, 'schema.prisma'));
    writeFileSync(join(dir, 'migrations', 'migration_lock.toml'), 'provider = "postgresql"\n');
    writeFileSync(join(dir, 'migrations', '0_broken', 'migration.sql'), 'THIS IS NOT VALID SQL AT ALL;\n');

    const brokenName = `${scratchName}9`;
    const brokenUrl = buildScratchUrl(baseUrl, brokenName);
    expect(routes.exec(maintenanceUrl, `CREATE DATABASE "${brokenName}" TEMPLATE template0;`).ok).toBe(true);
    try {
      const deployed = gate.deployMigrations({ migrationsDir: join(dir, 'migrations'), scratchUrl: brokenUrl });
      expect(deployed.status).not.toBe(0);
      // The target really was the scratch database, not the seeded one.
      expect(deployed.output).toContain(brokenName);

      const outcome = evaluateDrift({
        ...healthyRun(),
        migrateDeployOk: deployed.status === 0,
        migrateDeployOutput: deployed.output,
      });
      expect(outcome.verdict).toBe('migrate_deploy_failed');
      expect(outcome.exitCode).toBe(1);
    } finally {
      routes.exec(maintenanceUrl, `DROP DATABASE IF EXISTS "${brokenName}" WITH (FORCE);`);
    }
  }, 300000);
});
