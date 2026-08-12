import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

/** The local Docker stack. Port 5433, never 5432: `production-artefact-check.js`
 * rule A6 matches `(localhost|127.0.0.1):(8025|9000|9001|5432|6379)` on string
 * literals inside `apps/api/src`, so the CI DSN written out here would turn
 * stage 0b red. `restore-drill-gate.spec.ts:659` gets away with the same literal
 * for the same reason. */
const LOCAL_URL = 'postgresql://pilotage:pilotage@127.0.0.1:5433/pilotage?schema=public';
/** A closed port on the loopback interface. Used to prove that an unreachable
 * address FAILS rather than skips, and that no environment variable changes that. */
const DEAD_URL = 'postgresql://pilotage:pilotage@127.0.0.1:59999/pilotage?schema=public';

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
    const url = new URL(buildScratchUrl(LOCAL_URL, 'schema_drift_7'));
    expect(url.pathname).toBe('/schema_drift_7');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('5433');
    expect(url.username).toBe('pilotage');
    expect(url.password).toBe('pilotage');
    expect(url.search).toBe('?schema=public');
  });

  it('buildScratchUrl refuses to address anything that is not a scratch database', () => {
    expect(() => buildScratchUrl(LOCAL_URL, 'pilotage')).toThrow();
    expect(() => buildScratchUrl(LOCAL_URL, '')).toThrow();
    expect(() => buildScratchUrl(LOCAL_URL, 'schema_drift_')).toThrow();
  });

  it('the migration tools are never handed the resolved base URL (FR-7)', () => {
    // `prisma migrate deploy` has NO `--url` flag: the target is chosen ENTIRELY
    // by DATABASE_URL. A missing or late override would run the ledger's DDL
    // against the seeded local database, and for the "a migration that does not
    // execute" case that means broken DDL against real child records. So the
    // overlay is re-validated immediately before every spawn.
    const env = buildChildEnv(buildScratchUrl(LOCAL_URL, 'schema_drift_7'));
    expect(new URL(env.DATABASE_URL).pathname).toBe('/schema_drift_7');
    expect(() => buildChildEnv(LOCAL_URL)).toThrow(/schema_drift/);
    expect(() => buildChildEnv(deriveMaintenanceUrl(LOCAL_URL))).toThrow();
  });

  it('the maintenance URL is DERIVED, never supplied', () => {
    // `CREATE DATABASE` cannot run from inside the database being created, and an
    // operator-supplied maintenance address would be a second address every
    // safety check would have to trust.
    const url = new URL(deriveMaintenanceUrl(LOCAL_URL));
    expect(url.pathname).toBe('/postgres');
    expect(url.port).toBe('5433');
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
    expect(gate.redactConnectionUrl(LOCAL_URL)).not.toContain('pilotage:pilotage');
    expect(gate.redactConnectionUrl(LOCAL_URL)).toContain('***');
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
    const routes = gate.openSqlRoutes(DEAD_URL);
    expect(routes.exec(LOCAL_URL, 'SELECT 1;')).toEqual({
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

/** A URL on a DIFFERENT server from `DEAD_URL` — different host AND port. */
const OTHER_SERVER_URL = 'postgresql://u:p@10.255.255.1:5432/other?schema=public';
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
    const base = new URL(LOCAL_URL);
    const maintenance = new URL(gate.deriveMaintenanceUrl(LOCAL_URL));
    const scratch = new URL(gate.buildScratchUrl(LOCAL_URL, 'schema_drift_11'));
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
    const sites = callSites(EXECUTABLE_SCRIPT, /run\(\s*'psql'/);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toContain('PSQL_HOST_TIMEOUT_MS');
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
      ['psql', /run\(\s*'psql'/],
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
 * 6. One agreement against a real PostgreSQL — guarded, never silent
 *
 * ORDERING NOTE, load-bearing: the full-CLI cases run FIRST, because the CLI
 * sweeps every `schema_drift_%` database it finds — including one this file
 * created. The fixture-driven block below therefore builds its scratch database
 * only after the CLI has finished.
 * ================================================================== */

const PROBE_URL = process.env.DATABASE_URL || LOCAL_URL;
const reachable = gate.probeServer(PROBE_URL);
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
  let why = 'the probe could not describe itself';
  try {
    const target = new URL(PROBE_URL);
    const probe = gate.probeAddress(target.hostname, target.port || '5432');
    why =
      `${target.hostname}:${target.port || '5432'} — ${probe.state}: ${probe.detail} ` +
      `(after ${probe.elapsedMs} ms)`;
  } catch {
    why = 'DATABASE_URL is not a usable connection string';
  }
  console.warn(
    `[schema-drift-gate] no PostgreSQL server answered at ${why} — ` +
      `the end-to-end cases are skipped. Every classifier, verdict, safety, wiring and DNC case in ` +
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
      .openSqlRoutes(process.env.DATABASE_URL || LOCAL_URL)
      .query('postgres', "SELECT datname::text FROM pg_database WHERE datname LIKE 'schema\\_drift\\_%';");
    expect(rows.map((r) => r[0])).toEqual([]);
  }, 180000);
});

describeWithDb('the diff and the deploy, driven through the exported seams', () => {
  const baseUrl = process.env.DATABASE_URL || LOCAL_URL;
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
