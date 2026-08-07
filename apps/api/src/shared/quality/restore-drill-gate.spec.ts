import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * VAL-03 / R-01 guard — the restore rehearsal must stay honest, and PF-84 must
 * never come back.
 *
 * WHAT THE FINDING IS
 * -------------------
 * R-01 is "a tenancy or schema migration moves data unrecoverably". Every
 * mitigation written for it assumed a backup existed to go back to, and nothing
 * in this repository had ever executed a restore. `scripts/restore-drill.js`
 * (S-E02-3) does: a real timed `pg_dump` → restore into a scratch database →
 * verify against a row-count + checksum + schema manifest, against the LOCAL
 * Docker stack.
 *
 * WHY THIS SPEC DOES NOT DO THE THING ITSELF
 * ------------------------------------------
 * Same division of labour as `boot-gate.spec.ts` and `web-artifact-gate.spec.ts`:
 *   • `scripts/restore-drill.js` — performs the drill. Its exit code is the gate,
 *     and it needs a running Postgres, so it is an operator artefact.
 *   • this file                  — proves the drill's verdict table, its refusals
 *     and its safety rules are still what they claim to be, from fixtures, with
 *     no database anywhere near it.
 * A jest suite that dumped a database would pass or fail depending on whether
 * the stack happened to be up, which is a flaky gate rather than a gate. It
 * `require()`s the script for its pure exports, which is only safe because the
 * script guards `main()` behind `require.main === module` — and the first test
 * below is precisely the regression test for that.
 *
 * WHY THE DRILL IS NOT A ci-gate.sh STAGE (asserted below, in the negative)
 * ------------------------------------------------------------------------
 * Every sibling guard asserts "ci-gate.sh runs it". This one asserts the
 * opposite, because the reason must not survive only as folklore: `ci-gate.sh`
 * deliberately needs no services, and a stage that cannot run where the gate runs
 * is either skipped — DNC-08, a success nobody obtained — or red on every run and
 * routed around, which is R-23. ADR-025 D1. What CI runs is this file, picked up
 * automatically by `node scripts/test-ratchet.js api` because `apps/api/
 * jest.config.js` matches `<rootDir>/src/**\/*.spec.ts`.
 *
 * WHY IT LIVES IN apps/api
 * ------------------------
 * With `lint-gate`, `boot-gate`, `web-artifact-gate`, `observability-gate` and
 * the rest of the repo-level guards. `apps/api` is the package whose jest suite
 * `ci-gate.sh` actually runs through the ratchet.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'restore-drill.js');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'restore-drill-baseline.json');
const RUNBOOK_PATH = join(REPO_ROOT, 'docs', 'runbooks', 'backup-restore-drill.md');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'ci-gate.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const DOCKERIGNORE_PATH = join(REPO_ROOT, '.dockerignore');
const COMPOSE_PATH = join(REPO_ROOT, 'infra', 'docker-compose.yml');
const MIGRATIONS_DIR = join(REPO_ROOT, 'apps', 'api', 'prisma', 'migrations');

/* ------------------------------------------------------------------ *
 * The script under guard, loaded for its pure exports only.
 * ------------------------------------------------------------------ */

interface DrillOutcome {
  verdict: string;
  exitCode: number;
  failures: string[];
  durations: Record<string, number> | null;
  sloExceeded: boolean;
  baselineWritable: boolean;
}

interface DrillModule {
  evaluateDrill: (input: unknown) => DrillOutcome;
  redactConnectionUrl: (url: string) => string;
  buildManifestDiff: (a: unknown, b: unknown) => Record<string, string[]>;
  isSafeScratchTarget: (scratch: unknown, source: unknown) => boolean;
  VERDICT_EXIT_CODES: Record<string, number>;
  VERDICT_PRECEDENCE: string[];
  SCRATCH_NAME_PATTERN: RegExp;
}

// The script is CommonJS at a path computed from the repo root, so `require` is
// the only way in. Same disable, same rule name and same enable/disable pair as
// observability-gate.spec.ts:56 — the idiom already exists in this directory, so
// this file uses it rather than inventing a third spelling. Note the rule is
// `no-require-imports`, not `no-var-requires`: the latter is not loaded by the
// flat config, so naming it disabled nothing and left a warning of its own.
/* eslint-disable @typescript-eslint/no-require-imports */
const drill: DrillModule = require(SCRIPT_PATH);
/* eslint-enable @typescript-eslint/no-require-imports */
const source = readFileSync(SCRIPT_PATH, 'utf8');

/* ------------------------------------------------------------------ *
 * Fixtures. Every one of them is a plain object: the point of the pure
 * `evaluateDrill` is that no branch needs a database to reach.
 * ------------------------------------------------------------------ */

interface TableEntry {
  name: string;
  rowCount: number;
  checksum: string;
}

/** 55 base tables were measured on the local stack (54 application tables + the
 * ledger). The fixture uses the real number because `evaluateDrill` refuses a
 * manifest below a floor — a comparison over a handful of tables is a pass that
 * proves nothing. */
function fixtureTables(): TableEntry[] {
  return Array.from({ length: 55 }, (_, i) => ({
    name: `table_${i}`,
    rowCount: i * 10,
    checksum: `checksum_${i}`,
  }));
}

function fixtureManifest(): { tables: TableEntry[]; schema: Record<string, Record<string, string>> } {
  return {
    tables: fixtureTables(),
    schema: {
      enum: { AlertSeverity: 'low,medium,high' },
      column: { 'table_0.id': 'text|NO|1' },
      index: { table_0_pkey: 'CREATE UNIQUE INDEX table_0_pkey ON public.table_0 USING btree (id)' },
      constraint: { table_0_pkey: 'table_0|PRIMARY KEY' },
      sequence: {},
    },
  };
}

// `unknown`, not `any`: the fixtures are only ever handed to `evaluateDrill`,
// which takes `unknown`, so nothing here needs to read a property off them. The
// `no-explicit-any` disable that used to sit on this line reported nothing, and
// an eslint-disable that disables nothing is a comment that outranks the linter
// in a reader's head while doing none of its work.
type Input = Record<string, unknown>;

/** A run that restored perfectly. Every failure fixture below is this, with one
 * field changed — so each test names exactly one cause. */
function passingRun(): Input {
  return {
    sourceReachable: true,
    toolingAvailable: true,
    dumpRouteIdentity: { matched: true, detail: 'container publishes 5432 on 5433' },
    readRole: { name: 'pilotage', superuser: true, bypassRls: true },
    scratchName: 'restore_drill_1786061599037',
    sourceDatabase: 'pilotage',
    scratchWasEmpty: true,
    restoreOk: true,
    sourceManifest: fixtureManifest(),
    restoredManifest: fixtureManifest(),
    sourceManifestAfterDump: fixtureManifest(),
    sourceLedger: { present: true, rows: [] },
    restoredLedger: {
      present: true,
      rows: [
        {
          migrationName: '0_baseline',
          checksum: '528b38c4',
          finished: true,
          rolledBack: false,
          appliedStepsCount: 1,
          expectedChecksum: '528b38c4',
        },
      ],
    },
    migrationDirectories: ['0_baseline'],
    durations: { dumpMs: 1298, restoreMs: 7602, verifyMs: 3564, totalMs: 22764 },
    baseline: {
      recordedFrom: '127.0.0.1:5433/pilotage (local Docker stack)',
      inventory: { tableCount: 55 },
      durations: {
        dumpMs: { value: 1298 },
        restoreMs: { value: 7602 },
        verifyMs: { value: 3564 },
        totalMs: { value: 22764 },
      },
      toleranceFactor: { value: 3 },
    },
    scratchDropped: true,
    faultInjected: false,
  };
}

function withRestoredTables(mutate: (tables: TableEntry[]) => TableEntry[]): Input {
  const input = passingRun();
  input.restoredManifest = { ...fixtureManifest(), tables: mutate(fixtureTables()) };
  return input;
}

/**
 * One fixture per verdict. This table IS the contract the drill exposes to an
 * operator: the verdict names what happened and the exit code decides whether
 * anyone notices.
 */
const VERDICT_FIXTURES: [string, Input][] = [
  ['ok', passingRun()],
  ['unreachable_source', { ...passingRun(), sourceReachable: false }],
  ['tooling_unavailable', { ...passingRun(), toolingAvailable: false }],
  [
    'dump_route_mismatch',
    { ...passingRun(), dumpRouteIdentity: { matched: false, detail: 'publishes 5432 on [5432]' } },
  ],
  [
    'insufficient_read_role',
    { ...passingRun(), readRole: { name: 'app_user', superuser: false, bypassRls: false } },
  ],
  ['unbaselined_ledger', { ...passingRun(), sourceLedger: { present: false, rows: [] } }],
  ['unsafe_scratch_target', { ...passingRun(), scratchName: 'pilotage' }],
  ['scratch_not_empty', { ...passingRun(), scratchWasEmpty: false }],
  ['restore_failed', { ...passingRun(), restoreOk: false }],
  [
    'empty_manifest',
    {
      ...passingRun(),
      sourceManifest: { tables: [], schema: {} },
      restoredManifest: { tables: [], schema: {} },
      sourceManifestAfterDump: { tables: [], schema: {} },
    },
  ],
  ['missing_table', withRestoredTables((t) => t.slice(0, 54))],
  [
    'unexpected_table',
    withRestoredTables((t) => [...t, { name: 'table_extra', rowCount: 1, checksum: 'x' }]),
  ],
  [
    'source_mutated_during_dump',
    (() => {
      const input = passingRun();
      const tables = fixtureTables();
      const first = tables[0];
      if (first) tables[0] = { ...first, rowCount: first.rowCount + 1, checksum: 'moved' };
      input.sourceManifestAfterDump = { ...fixtureManifest(), tables };
      return input;
    })(),
  ],
  [
    'row_count_divergence',
    withRestoredTables((tables) => {
      const third = tables[3];
      if (third) tables[3] = { ...third, rowCount: third.rowCount - 1 };
      return tables;
    }),
  ],
  [
    'checksum_divergence',
    withRestoredTables((tables) => {
      const third = tables[3];
      if (third) tables[3] = { ...third, checksum: 'mutated' };
      return tables;
    }),
  ],
  [
    'schema_divergence',
    (() => {
      const input = passingRun();
      const manifest = fixtureManifest();
      manifest.schema.enum = { AlertSeverity: 'low,medium' };
      input.restoredManifest = manifest;
      return input;
    })(),
  ],
  [
    'inventory_drift',
    (() => {
      const input = passingRun();
      input.baseline = { ...(passingRun().baseline as Record<string, unknown>), inventory: { tableCount: 54 } };
      return input;
    })(),
  ],
  ['pending_migration', { ...passingRun(), restoredLedger: { present: true, rows: [] } }],
  [
    'ledger_checksum_mismatch',
    (() => {
      const input = passingRun();
      input.restoredLedger = {
        present: true,
        rows: [
          {
            migrationName: '0_baseline',
            checksum: '528b38c4',
            finished: true,
            rolledBack: false,
            appliedStepsCount: 1,
            expectedChecksum: 'edited_after_it_was_applied',
          },
        ],
      };
      return input;
    })(),
  ],
  [
    'slo_unrecorded',
    (() => {
      const input = passingRun();
      input.baseline = { ...(passingRun().baseline as Record<string, unknown>), recordedFrom: null };
      return input;
    })(),
  ],
  ['fault_injected', { ...passingRun(), faultInjected: true }],
  ['scratch_cleanup_failed', { ...passingRun(), scratchDropped: false }],
  ['unknown', { ...passingRun(), fatalError: 'docker exec was killed mid-dump' }],
];

/* ================================================================== *
 * 1. The drill's verdict contract
 * ================================================================== */

describe('restore drill gate — the verdict contract (VAL-03, R-01)', () => {
  it('guards the guard: the script is where this spec thinks it is, and importing it runs no drill', () => {
    // A broken REPO_ROOT would make every assertion below pass vacuously over an
    // empty file — the bug that made the first draft of lint-ratchet.spec.ts
    // report zero decorator-metadata packages.
    //
    // This is also the FM-5 regression test. `scripts/web-artifact-check.js` ends
    // with a bare `main()` at module scope; copied here, this very `require`
    // would have created and dropped a database inside `pnpm test`, on every
    // developer's machine and every gate run. The script guards it behind
    // `require.main === module`, and the proof is that this file loaded at all.
    expect(existsSync(SCRIPT_PATH)).toBe(true);
    expect(typeof drill.evaluateDrill).toBe('function');
    expect(typeof drill.redactConnectionUrl).toBe('function');
    expect(typeof drill.buildManifestDiff).toBe('function');
    expect(source).toMatch(/if \(require\.main === module\)/);
    expect(source.length).toBeGreaterThan(5000);
  });

  it('a fully matching run is ok, exit 0, with nothing to report', () => {
    const outcome = drill.evaluateDrill(passingRun());
    expect(outcome.verdict).toBe('ok');
    expect(outcome.exitCode).toBe(0);
    expect(outcome.failures).toEqual([]);
    expect(outcome.sloExceeded).toBe(false);
    expect(outcome.baselineWritable).toBe(true);
  });

  it.each(VERDICT_FIXTURES)('%s maps to its documented exit code', (verdict, input) => {
    const outcome = drill.evaluateDrill(input);
    expect(outcome.verdict).toBe(verdict);
    expect(outcome.exitCode).toBe(drill.VERDICT_EXIT_CODES[verdict]);
    // Binary by design (ADR-025 D2): the verdict string discriminates, the exit
    // code only decides whether anyone notices.
    expect(outcome.exitCode).toBe(verdict === 'ok' ? 0 : 1);
    if (verdict !== 'ok') expect(outcome.failures.length).toBeGreaterThan(0);
  });

  it('every verdict in the exit-code table has a fixture, and vice versa', () => {
    // Without this, a verdict added later would be reachable in the script and
    // unproven here — the exit-code table would silently stop being the contract
    // this file claims to lock.
    const covered = VERDICT_FIXTURES.map(([verdict]) => verdict).sort();
    expect(covered).toEqual(Object.keys(drill.VERDICT_EXIT_CODES).sort());
    expect(drill.VERDICT_PRECEDENCE.slice().sort()).toEqual(covered);
  });

  it('an unrecognised state is `unknown` and exits non-zero, never a silent 0', () => {
    const outcome = drill.evaluateDrill(undefined);
    expect(outcome.verdict).toBe('unknown');
    expect(outcome.exitCode).toBe(1);
  });

  it('the highest-value single assertion: 55 source tables against 0 restored tables is missing_table', () => {
    // The difference between a restore drill and a green light. A comparison
    // driven by what the RESTORED database contains would compare zero tables
    // and report a clean pass on an empty database (FM-1).
    const outcome = drill.evaluateDrill(
      withRestoredTables(() => []),
    );
    expect(outcome.verdict).toBe('missing_table');
    expect(outcome.exitCode).toBe(1);
    expect(outcome.failures.length).toBeGreaterThanOrEqual(55);
    expect(outcome.failures[0]).toContain('table_0');
  });

  it('a divergence names the table AND the field AND both values', () => {
    const outcome = drill.evaluateDrill(
      withRestoredTables((tables) => {
        const third = tables[3];
        if (third) tables[3] = { ...third, rowCount: third.rowCount - 1 };
        return tables;
      }),
    );
    expect(outcome.verdict).toBe('row_count_divergence');
    expect(outcome.failures.join('\n')).toContain('table_3 — rowCount: source 30, restored 29');
  });

  it('a data divergence outranks a cleanup failure, and the cleanup failure is still reported', () => {
    // Otherwise a cleanup bug would downgrade a real data failure to a
    // housekeeping note, which is the wrong headline on a failing run.
    const input = withRestoredTables((tables) => {
      const third = tables[3];
      if (third) tables[3] = { ...third, checksum: 'mutated' };
      return tables;
    });
    input.scratchDropped = false;
    const outcome = drill.evaluateDrill(input);
    expect(outcome.verdict).toBe('checksum_divergence');
    expect(outcome.failures.join('\n')).toContain('was NOT dropped');
  });

  it('the precedence order is the documented one', () => {
    expect(drill.VERDICT_PRECEDENCE[drill.VERDICT_PRECEDENCE.length - 1]).toBe('ok');
    const rank = (verdict: string): number => drill.VERDICT_PRECEDENCE.indexOf(verdict);
    const ordered = [
      'unreachable_source',
      'tooling_unavailable',
      'unbaselined_ledger',
      'missing_table',
      'unexpected_table',
      'row_count_divergence',
      'checksum_divergence',
      'pending_migration',
      'scratch_cleanup_failed',
      'ok',
    ];
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1] as string;
      const current = ordered[i] as string;
      expect(rank(previous)).toBeGreaterThan(-1);
      expect(rank(previous)).toBeLessThan(rank(current));
    }
    // …and driving it end to end: an unreachable source wins over everything.
    const everything = withRestoredTables(() => []);
    everything.sourceReachable = false;
    everything.scratchDropped = false;
    expect(drill.evaluateDrill(everything).verdict).toBe('unreachable_source');
  });

  it('a slow run is reported, not failed (the deliberate concession)', () => {
    const input = passingRun();
    input.durations = { dumpMs: 1298 * 10, restoreMs: 7602, verifyMs: 3564, totalMs: 22764 };
    const outcome = drill.evaluateDrill(input);
    expect(outcome.sloExceeded).toBe(true);
    // A timing flake that turned the drill red would train the operator to
    // re-run until green, which is how a gate stops being read.
    expect(outcome.verdict).toBe('ok');
    expect(outcome.exitCode).toBe(0);
  });
});

/* ================================================================== *
 * 2. Safety: the one place the drill can destroy something
 * ================================================================== */

describe('restore drill gate — the scratch target is name-guarded (AC-6)', () => {
  it('accepts only a generated scratch name that is not the source', () => {
    expect(drill.isSafeScratchTarget('restore_drill_1786061599037', 'pilotage')).toBe(true);
    expect(drill.SCRATCH_NAME_PATTERN.source).toBe('^restore_drill_\\d+$');
  });

  it.each([
    ['pilotage', 'pilotage'],
    ['postgres', 'pilotage'],
    ['keycloak', 'pilotage'],
    ['restore_drill_', 'pilotage'],
    ['restore_drill_abc', 'pilotage'],
    ['', 'pilotage'],
    ['restore_drill_1', ''],
  ])('refuses %s as a drop target', (scratch, sourceDb) => {
    expect(drill.isSafeScratchTarget(scratch, sourceDb)).toBe(false);
  });

  it('refuses a scratch name equal to the source even when it matches the pattern', () => {
    // The mirror of the previous case, and the one that actually destroys data:
    // a resolver bug that let the target BE the source.
    expect(drill.isSafeScratchTarget('restore_drill_1', 'restore_drill_1')).toBe(false);
    expect(drill.isSafeScratchTarget(undefined, undefined)).toBe(false);
  });

  it('the drop re-checks the guard immediately before issuing the statement', () => {
    expect(source).toMatch(/function dropScratch[\s\S]{0,400}isSafeScratchTarget/);
    expect(source).toMatch(/REFUSING to drop/);
    // A failed drop prints the command an operator must run by hand: a leaked
    // scratch database accumulates and must never be swallowed.
    expect(source).toMatch(/DROP DATABASE[^\n]*WITH \(FORCE\)/);
  });

  it('cleanup runs on every exit path, including signals', () => {
    expect(source).toContain("'SIGINT', 'SIGTERM'");
    expect(source).toContain('uncaughtException');
    expect(source).toMatch(/\} finally \{\s*\n\s*cleanup\(\);/);
  });

  it('never invokes pg_dumpall', () => {
    // The cluster also hosts the `keycloak` database and roles with literal
    // passwords. `pg_dumpall --globals-only` "for completeness" would write those
    // role passwords into a dump file produced by a quality gate.
    expect(source).not.toContain('pg_dumpall');
  });

  it('the dump never lands in the repository tree', () => {
    // A 13 550-row extract of realistic child records inside the build context,
    // the diff, and the production-artefact scan.
    expect(source).toMatch(/\/tmp\/\$\{scratchName\}\.dump/);
    expect(source).not.toMatch(/join\(REPO_ROOT[^)]*dump/);
  });
});

/* ================================================================== *
 * 3. DNC-08 / DNC-10: it cannot report a success it did not obtain
 * ================================================================== */

describe('restore drill gate — no bypass, no skip (DNC-08, DNC-10, AC-5)', () => {
  it('has no bypass flag', () => {
    for (const flag of ['SKIP_RESTORE_DRILL', 'ALLOW_RESTORE_FAILURE', 'RESTORE_DRILL_SKIP']) {
      expect(source).not.toContain(flag);
    }
    expect(source).not.toMatch(/process\.env\.[A-Z_]*(SKIP|BYPASS|FORCE)[A-Z_]*/);
  });

  it('handles no skip/force/allow-failure argument', () => {
    expect(source).not.toContain('--skip');
    expect(source).not.toContain('--force');
    expect(source).not.toContain('--allow-failure');
    // An unknown option is refused rather than ignored, so a flag someone
    // *expects* to exist cannot silently do nothing.
    expect(source).toMatch(/unknown option/);
  });

  it('reads no environment variable except DATABASE_URL', () => {
    const reads = source.match(/process\.env\.[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    expect([...new Set(reads)]).toEqual(['process.env.DATABASE_URL']);
  });

  it('an unreachable source is a failure with its own verdict, never a no-op', () => {
    const outcome = drill.evaluateDrill({ ...passingRun(), sourceReachable: false });
    expect(outcome.verdict).toBe('unreachable_source');
    expect(outcome.exitCode).toBe(1);
    expect(outcome.baselineWritable).toBe(false);
  });

  it('--update refuses to write from a run that did not restore correctly', () => {
    // The rule boot-check.js learned the hard way: its first `--update` silently
    // dropped an application that had failed to boot, producing a baseline that
    // would then have passed the gate forever with that application
    // unrepresented. A failed restore is also FAST — it restored less — so
    // recording its durations would permanently loosen the SLO.
    expect(source).toMatch(/refusing to write the baseline/);
    expect(source).toMatch(/if \(!outcome\.baselineWritable\)/);

    for (const [verdict, input] of VERDICT_FIXTURES) {
      const outcome = drill.evaluateDrill(input);
      // Exactly two verdicts still permit a write, and both are BOOKKEEPING
      // verdicts about the baseline file rather than statements about the
      // restore's fidelity:
      //
      //   `slo_unrecorded`  — the durations are missing, and recording them is
      //                       precisely the remedy.
      //   `inventory_drift` — the source's table inventory no longer matches the
      //                       stored baseline, and re-recording it is again the
      //                       only remedy the runbook offers (§6).
      //
      // `inventory_drift` was added after adversarial review found that leaving
      // it out DEADLOCKED the file: the first legitimate migration that adds or
      // drops a table would turn the drill permanently red, with its own
      // documented fix — `--update` — refused by the same verdict. It is safe
      // because source-vs-restored fidelity is decided elsewhere entirely
      // (`missing_table`, `row_count_divergence`, `checksum_divergence`,
      // `schema_divergence`), and a run that drifted AND diverged still refuses,
      // because the divergence verdict is not on this list.
      //
      // Everything else — including a fault-injected run — is refused.
      const permitted =
        verdict === 'ok' || verdict === 'slo_unrecorded' || verdict === 'inventory_drift';
      expect([verdict, outcome.baselineWritable]).toEqual([verdict, permitted]);
    }
  });

  it('a run that drifted AND diverged still refuses to write the baseline', () => {
    // The exception above is only safe if it cannot be reached in company. This
    // is the case that proves it: an inventory drift with a real row-count
    // divergence must still be unwritable, or `inventory_drift` would have
    // become a way to freeze the durations of a restore that lost rows.
    const drifted = VERDICT_FIXTURES.find(([v]) => v === 'inventory_drift');
    const diverged = VERDICT_FIXTURES.find(([v]) => v === 'row_count_divergence');
    expect(drifted).toBeDefined();
    expect(diverged).toBeDefined();

    const both = drill.evaluateDrill({ ...drifted![1], ...diverged![1] });
    expect(both.baselineWritable).toBe(false);
    expect(both.exitCode).toBe(1);
  });

  it('an input carrying no evidence is `unknown`, never `ok` (DNC-08)', () => {
    // Every check in evaluateDrill is written as `if (x === false)` or
    // `if (x !== null)`, so OMITTING a field skips the check that would have
    // used it. `evaluateDrill({})` therefore returned `ok / exit 0 /
    // baselineWritable: true` — an object carrying no evidence at all read as a
    // clean drill. `null` was handled; `{}` was not, and `{}` is the dangerous
    // half, because a crashed or half-built run hands you an object.
    //
    // Found by this slice's own adversarial review, before merge. A verdict of
    // `ok` must require positive evidence from every stage; absence is never
    // agreement.
    const empty = drill.evaluateDrill({});
    expect(empty.verdict).toBe('unknown');
    expect(empty.exitCode).toBe(1);
    expect(empty.baselineWritable).toBe(false);
    expect(empty.failures.join(' ')).toMatch(/did not produce the evidence/i);

    // And it must name what is missing, or an operator cannot act on it.
    for (const field of [
      'sourceReachable',
      'restoreOk',
      'sourceManifest',
      'restoredManifest',
      'sourceLedger',
      'restoredLedger',
      'durations',
    ]) {
      expect(empty.failures.join(' ')).toContain(field);
    }

    // Dropping any single one of them from an otherwise-passing run is enough.
    const okFixture = VERDICT_FIXTURES.find(([v]) => v === 'ok');
    expect(okFixture).toBeDefined();
    for (const field of ['sourceManifest', 'restoredLedger', 'durations']) {
      const partial = { ...okFixture![1], [field]: null };
      expect([field, drill.evaluateDrill(partial).verdict]).toEqual([field, 'unknown']);
    }
  });

  it('a ledger row with applied_steps_count = 0 is NOT pending — that is how `migrate resolve` baselines', () => {
    // The obvious assertion ("applied_steps_count > 0, or the migration did
    // nothing") makes the drill report a false `pending_migration` on any
    // database baselined the way THIS repository documents:
    // `prisma migrate resolve --applied 0_baseline` inserts the ledger row
    // without executing steps, so the column takes its DDL default of 0. That
    // path is prescribed by infra/docker/migrate-entrypoint.sh's own refusal
    // message and by docs/runbooks/baseline-hosted-database.md §2 — so the drill
    // would have failed loudest at the moment an operator needed it most.
    //
    // What establishes "applied" is finished_at + not rolled back + checksum.
    expect(source).not.toMatch(/appliedStepsCount\s*\)?\s*<=\s*0/);

    const okFixture = VERDICT_FIXTURES.find(([v]) => v === 'ok');
    expect(okFixture).toBeDefined();
    const resolved = JSON.parse(JSON.stringify(okFixture![1]));
    for (const row of resolved.restoredLedger?.rows ?? []) {
      row.appliedStepsCount = 0;
    }
    expect(drill.evaluateDrill(resolved).verdict).toBe('ok');
  });

  it('the fault-injection seam is monotone in the failing direction, so it is not a bypass', () => {
    // It can make the drill fail; it can never make it pass, and it can never
    // write a baseline. That is what separates a test hook from an escape hatch.
    const injected = drill.evaluateDrill({ ...passingRun(), faultInjected: true });
    expect(injected.verdict).not.toBe('ok');
    expect(injected.exitCode).toBe(1);
    expect(injected.baselineWritable).toBe(false);
  });
});

/* ================================================================== *
 * 4. G-TENANT: the manifest and the logs cannot carry identity
 * ================================================================== */

describe('restore drill gate — G-TENANT, in both directions (AC-10)', () => {
  it('redacts the password out of a real-shaped connection string', () => {
    const redacted = drill.redactConnectionUrl('postgresql://pilotage:pilotage@127.0.0.1:5433/pilotage');
    expect(redacted).not.toContain('pilotage:pilotage');
    expect(redacted).toContain('***');
    // Still usable as a descriptor: host, port and database survive.
    expect(redacted).toContain('127.0.0.1:5433');
  });

  it('redacts even when the string is not a parseable URL', () => {
    // The path that matters is the error path: a child-process failure echoes
    // its argv, and a `pg` connection error embeds the DSN in its message.
    expect(drill.redactConnectionUrl('could not connect to postgres://u:s3cr3t@h:5432/db')).not.toContain(
      's3cr3t',
    );
    expect(drill.redactConnectionUrl('')).toBe('');
  });

  it('no verdict payload can carry a tenant id, a person, or a credential', () => {
    for (const [, input] of VERDICT_FIXTURES) {
      const serialised = JSON.stringify(drill.evaluateDrill(input));
      for (const forbidden of ['tenantId', 'tenant_id', 'email', 'firstName', 'lastName', 'password']) {
        expect(serialised).not.toContain(forbidden);
      }
    }
  });

  it('the manifest can only hold table names, integer counts and hex digests', () => {
    // Row content is touched exactly once, by a server-side one-way md5 over the
    // whole row, so no column value ever crosses the wire.
    expect(source).toContain('md5(x::text)');
    expect(source).not.toMatch(/JSON\.stringify\((row|record|entity)/);
    // A "helpful" fallback that printed the first differing row when a checksum
    // diverges would publish a child's name into a gate's output.
    expect(source).not.toMatch(/SELECT \* FROM/);
  });

  it('every printed connection string goes through the redactor', () => {
    const printsRawUrl = /console\.(log|error)\([^\n]*\$\{(source\.url|args\.source)\}/;
    expect(source).not.toMatch(printsRawUrl);
    expect(source).toMatch(/redactConnectionUrl\(source\.url\)/);
  });
});

/* ================================================================== *
 * 5. The reviewed SLO baseline
 * ================================================================== */

interface BaselineEntry {
  value: number;
  reason: string;
}

interface Baseline {
  $comment?: string;
  recordedAt?: string;
  recordedFrom?: string | null;
  source?: { host: string; port: number; database: string };
  inventory?: { tableCount: number; nonEmptyTableCount: number; totalRows: number; reason: string };
  ledger?: { migrations: string[]; reason: string };
  durations?: Record<string, BaselineEntry>;
  toleranceFactor?: BaselineEntry;
}

describe('restore drill gate — the SLO baseline is a reviewed record (AC-2)', () => {
  const baseline: Baseline | null = existsSync(BASELINE_PATH)
    ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline)
    : null;

  it('exists and parses', () => {
    expect(baseline).not.toBeNull();
    expect(baseline?.$comment).toBeTruthy();
  });

  it('the script references every top-level key the baseline declares', () => {
    // A baseline field the script never reads is decoration; a script field the
    // baseline never carries is a silent default. Either way the two drift.
    const keys = Object.keys(baseline ?? {});
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const key of keys) expect(source).toContain(key);
  });

  it('every duration and the tolerance carry a written reason — never a bare number', () => {
    const durations = baseline?.durations ?? {};
    expect(Object.keys(durations).sort()).toEqual(['dumpMs', 'restoreMs', 'totalMs', 'verifyMs']);
    for (const [key, entry] of Object.entries(durations)) {
      expect([key, typeof entry.value]).toEqual([key, 'number']);
      expect(entry.reason.length).toBeGreaterThan(40);
    }
    expect(typeof baseline?.toleranceFactor?.value).toBe('number');
    expect((baseline?.toleranceFactor?.reason ?? '').length).toBeGreaterThan(40);
    expect(baseline?.inventory?.reason?.length ?? 0).toBeGreaterThan(40);
    expect(baseline?.ledger?.reason?.length ?? 0).toBeGreaterThan(40);
  });

  it('the recorded inventory matches what the drill would compare against', () => {
    // A placeholder inventory would make `inventory_drift` unreachable; a
    // baseline that recorded fewer tables than the repository has would make it
    // fire on every run and then be "fixed" by deleting the check.
    expect(baseline?.inventory?.tableCount ?? 0).toBeGreaterThanOrEqual(50);
    expect(baseline?.inventory?.totalRows ?? 0).toBeGreaterThan(0);
  });

  it('the recorded ledger is exactly the migration directories on disk', () => {
    const onDisk = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    // Guards the guard: `migration_lock.toml` is in that directory too, and a
    // drill that demanded a migration by that name would fail on every run for
    // ever and would then be "fixed" by loosening the check.
    expect(onDisk).toContain('0_baseline');
    expect(onDisk).not.toContain('migration_lock.toml');
    expect(baseline?.ledger?.migrations ?? []).toEqual(onDisk);
  });

  it('records where it was measured, so the durations are not a fiction', () => {
    // `recordedFrom: null` is the "we have not measured this" state, and the
    // drill reports it as `slo_unrecorded` rather than as a pass.
    expect(baseline?.recordedFrom ?? null).not.toBeNull();
    expect(baseline?.recordedAt ?? '').toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

/* ================================================================== *
 * 6. The runbook, and the deliberate absence from CI
 * ================================================================== */

describe('restore drill gate — the runbook and the deliberate CI absence (AC-9)', () => {
  it('the runbook exists and references the script by its real path', () => {
    expect(existsSync(RUNBOOK_PATH)).toBe(true);
    const runbook = readFileSync(RUNBOOK_PATH, 'utf8');
    expect(runbook).toContain('scripts/restore-drill.js');
    // PF-86: Compose resolves `.env` from the compose file's directory (infra/),
    // and infra/.env does not exist, so an operator following a runbook without
    // `--env-file .env` starts a stack with no published ports and the drill's
    // first documented run fails for an unrelated reason.
    expect(runbook).toContain('--env-file .env');
    // The honesty clause is part of the deliverable, not a nicety. The runbooks
    // in this directory are written in French, like their siblings.
    expect(runbook).toContain('ne prouve pas');
    for (const limit of ['PITR', 'inter-machines', 'inter-versions', 'hébergée']) {
      expect(runbook).toContain(limit);
    }
  });

  it('ci-gate.sh and ci.yml do NOT run the drill — and that is the decision, not an oversight', () => {
    // The drill needs a live Postgres. `ci-gate.sh` deliberately needs no
    // services. A stage that cannot run where the gate runs is either skipped —
    // DNC-08, a success nobody obtained — or red on every run and routed around,
    // which is R-23. ADR-025 D1. This assertion is what stops a future run from
    // "fixing the missing stage".
    expect(readFileSync(GATE_PATH, 'utf8')).not.toContain('restore-drill');
    expect(readFileSync(WORKFLOW_PATH, 'utf8')).not.toContain('restore-drill');
  });

  it('the reason for that absence is written in the script and in the runbook', () => {
    // Left only in a commit message, the absence reads as an oversight and the
    // next maintainer's obvious "fix" is to wire it in.
    expect(source).toContain('ci-gate.sh');
    expect(source).toMatch(/deliberately needs no services/);
    expect(readFileSync(RUNBOOK_PATH, 'utf8')).toContain('ci-gate.sh');
  });
});

/* ================================================================== *
 * 7. PF-84 — the build context must contain the files the stack executes
 * ================================================================== */

/**
 * `.dockerignore` pattern semantics, implemented properly.
 *
 * A naive `content.includes('infra/docker')` would fail on the fix's own
 * five-line explanation, and the "fix" for that would be deleting the comment
 * that prevents recurrence. So: strip comments, evaluate pattern lines with
 * last-match-wins including `!` negation, leading `/`, trailing `/` and `**`.
 */
function parseIgnorePatterns(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function patternToRegExp(pattern: string): RegExp {
  const cleaned = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  let out = '';
  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i] as string;
    if (char === '*') {
      if (cleaned[i + 1] === '*') {
        if (cleaned[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  // A pattern matches the path itself and everything beneath it: `infra/docker`
  // excludes `infra/docker/migrate-entrypoint.sh`.
  return new RegExp(`^${out}(?:/.*)?$`);
}

function isExcluded(patterns: string[], path: string): boolean {
  let excluded = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    const body = negated ? pattern.slice(1) : pattern;
    if (patternToRegExp(body).test(path)) excluded = !negated;
  }
  return excluded;
}

/**
 * Every `command:`/`entrypoint:` value in a compose file, in all three YAML
 * forms: an exec list on one line, a shell string on one line, and a folded or
 * literal block (`>` / `|`) whose body is the following, more-indented lines.
 * A regex-only scanner misses the third, and `minio-init` uses it.
 */
function composeExecValues(content: string): { key: string; value: string }[] {
  const lines = content.split(/\r?\n/);
  const found: { key: string; value: string }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const match = /^(\s*)(command|entrypoint):\s*(.*)$/.exec(line);
    if (!match) continue;
    const indent = (match[1] ?? '').length;
    const key = match[2] as string;
    const inline = (match[3] ?? '').trim();
    if (inline !== '' && inline !== '>' && inline !== '|' && inline !== '>-' && inline !== '|-') {
      found.push({ key, value: inline });
      continue;
    }
    // Block scalar: consume the more-indented body.
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] as string;
      if (next.trim() === '') {
        body.push('');
        continue;
      }
      const nextIndent = next.length - next.trimStart().length;
      if (nextIndent <= indent) break;
      body.push(next.trim());
    }
    found.push({ key, value: body.join(' ') });
  }
  return found;
}

function appPathsIn(value: string): string[] {
  return (value.match(/\/app\/[A-Za-z0-9_./-]+/g) ?? []).map((p) => p.slice('/app/'.length));
}

describe('PF-84 — every file the stack executes survives the build context', () => {
  const dockerignore = readFileSync(DOCKERIGNORE_PATH, 'utf8');
  const patterns = parseIgnorePatterns(dockerignore);
  const compose = readFileSync(COMPOSE_PATH, 'utf8');
  const execValues = composeExecValues(compose);
  const appPaths = [...new Set(execValues.flatMap((entry) => appPathsIn(entry.value)))].sort();

  it('guards the guard: discovery actually found the compose commands and the ignore patterns', () => {
    // R-26 rule (b): a check written against a healthy repository can only
    // demonstrate that the repository is healthy. Everything below would pass
    // vacuously over empty lists.
    expect(patterns.length).toBeGreaterThan(20);
    expect(execValues.length).toBeGreaterThanOrEqual(5);
    expect(appPaths).toContain('infra/docker/migrate-entrypoint.sh');
  });

  it('parses the folded block form too, not only the one-line forms', () => {
    // `minio-init` uses `entrypoint: >`. A regex-only scanner reads it as an
    // empty value and would silently stop covering whatever it later contains.
    const folded = execValues.find((entry) => entry.value.includes('mc alias set'));
    expect(folded).toBeDefined();
    expect(execValues.some((entry) => entry.value.startsWith('['))).toBe(true);
  });

  it('reads executable content only — a comment can neither break nor satisfy the check', () => {
    // PF-83, R-26's ninth instance: boot-gate.spec.ts read a comment and went red
    // on a workflow whose order was never touched. `.dockerignore` now carries a
    // five-line explanation that names `infra/docker` three times, so a naive
    // `not.toContain` would fail on the fix's own documentation — and the
    // "fix" would be deleting the comment that prevents recurrence.
    expect(patterns.every((line) => !line.startsWith('#'))).toBe(true);
    expect(parseIgnorePatterns('# infra/docker\n\n  node_modules  \n')).toEqual(['node_modules']);
    expect(dockerignore).toContain('#');
  });

  it.each([
    'infra/docker',
    'infra/docker/',
    '/infra/docker',
    '**/infra/docker',
    'infra/**',
    'infra',
  ])('no effective pattern excludes infra/docker via %s', (shape) => {
    // Asserted as the general rule — "this path survives the context" — rather
    // than "this literal string is absent", so any spelling of the exclusion
    // fails, not just the one that was found.
    expect(patterns).not.toContain(shape);
    expect(isExcluded([shape], 'infra/docker/migrate-entrypoint.sh')).toBe(true);
  });

  it.each(appPaths)(
    '%s is in the repository AND survives .dockerignore',
    (relPath: string) => {
      expect(existsSync(join(REPO_ROOT, relPath))).toBe(true);
      // Existence alone would have passed while PF-84 was live: the file existed,
      // the build context excluded it, and `Dockerfile.api`'s COPY silently
      // omitted it, so the migrator exited 2 ("sh: can't open") on every stack
      // ever started — the safe migrator that replaced
      // `prisma db push --accept-data-loss` had never once run.
      expect(isExcluded(patterns, relPath)).toBe(false);
    },
  );

  it('proves the matcher in the negative, on a synthetic pattern list', () => {
    // Without this, a matcher that always returned false would pass every
    // assertion above and cover nothing.
    expect(isExcluded(['infra/docker'], 'infra/docker/migrate-entrypoint.sh')).toBe(true);
    expect(isExcluded(['infra/**'], 'infra/docker/migrate-entrypoint.sh')).toBe(true);
    expect(isExcluded(['**/dist'], 'apps/api/dist/main.js')).toBe(true);
    expect(isExcluded(['node_modules'], 'infra/docker/migrate-entrypoint.sh')).toBe(false);
    // …and that `!` negation is honoured with last-match-wins, or a repository
    // that re-included the path would still read as excluded.
    expect(isExcluded(['infra/**', '!infra/docker'], 'infra/docker/migrate-entrypoint.sh')).toBe(false);
  });

  it('the migrator still points at the entrypoint this guard is about', () => {
    // If the command were renamed away, every assertion above would keep passing
    // while covering a file nothing executes.
    expect(compose).toContain('/app/infra/docker/migrate-entrypoint.sh');
    const entrypoint = readFileSync(
      join(REPO_ROOT, 'infra', 'docker', 'migrate-entrypoint.sh'),
      'utf8',
    );
    expect(entrypoint.length).toBeGreaterThan(0);
  });

  it('states its own limit rather than implying coverage it does not have', () => {
    // The same class of defect applies to compose `volumes:` bind-mount sources
    // and to `COPY` sources in the Dockerfiles. Out of scope here, and said so
    // rather than left to be assumed. (Bind-mount sources are covered from the
    // other side by scripts/observability-check.js check 1.)
    expect(existsSync(join(REPO_ROOT, 'scripts', 'observability-check.js'))).toBe(true);
  });
});
