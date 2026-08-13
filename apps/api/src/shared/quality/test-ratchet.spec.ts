import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TOOL-10 (half B) — a KILLED ratchet must not report itself as a startup failure.
 *
 * WHAT THE DEFECT WAS
 * -------------------
 * `scripts/test-ratchet.js` printed, unconditionally, whenever jest produced no
 * JSON report:
 *
 *     test-ratchet: jest produced no report for api. It probably failed to start.
 *
 * On 2026-08-12 it printed that about a jest that had NOT failed to start: the
 * `test:api (ratchet)` stage overran `ci-gate.sh`'s 2400 s bound and the worker
 * was torn down (jest reported `exitCode 143` — SIGTERM, i.e. still running).
 * That sentence sent the next investigator looking for a startup fault that did
 * not exist, and the "fix" it produced was raising the stage bound (`2bd1a25`).
 * A gate message that misnames its own failure is worse than no message.
 *
 * WHY THIS SPEC IS SOURCE-ONLY, AND WHAT THAT COSTS
 * -------------------------------------------------
 * It must NOT `require()` the script. `scripts/test-ratchet.js` has top-level
 * side effects — it reads `process.argv[2]`, prints usage and calls
 * `process.exit(2)` when the arguments are wrong, then calls `runJest()` at
 * module scope — so importing it from a jest worker would either terminate the
 * worker or launch a second full jest run. It is the one gate script here that
 * lacks the `if (require.main === module) main();` + `module.exports` idiom that
 * `schema-drift-check.js`, `restore-drill.js`, `link-integrity-check.js` and
 * `compose-invocation-check.js` all use.
 *
 * Converting it is deliberately NOT part of this slice: it is the script the
 * merge gate itself runs, and that diff does not belong under a latency fix. It
 * is recorded as its own `TOOL-` finding. The limitation is stated here rather
 * than hidden: **these cases read source, so they cannot prove the branch
 * behaves correctly at runtime — only that it exists, that it reads what
 * actually happened, and that it says which case it was.**
 *
 * TWO THINGS MAKE THAT HONEST RATHER THAN DECORATIVE
 * ---------------------------------------------------
 * 1. **Non-vacuity is asserted before anything else.** The `!existsSync(outFile)`
 *    block is extracted by BRACE MATCHING and the extraction is proven non-empty
 *    and proven to contain its own anchor before a single claim is made about its
 *    contents. A source assertion that matches nothing and passes is exactly the
 *    defect TOOL-07 and TOOL-08 were made of; `audit-write-gate.spec.ts` and
 *    `csv-escape-gate.spec.ts` adopted the same remedy.
 * 2. **A negative control.** The same extractor and the same matchers are run
 *    against a synthetic source that lacks the branch, and are asserted to FAIL
 *    there. A matcher that cannot fail proves nothing about the file that passes.
 *
 * …and the two cases at the foot EXECUTE the script, to prove this change did not
 * touch the argument contract `ci-gate.sh` and `ci.yml` depend on. Neither of
 * them runs jest.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'test-ratchet.js');

const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, 'utf8');

/** Blank `//` and block comments, length preserved — the same helper
 * `schema-drift-gate.spec.ts` and `csp-gate.spec.ts` use. A claim about a code
 * branch must not be satisfiable by a sentence of prose describing it. */
function executableJs(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

const EXECUTABLE_SCRIPT = executableJs(SCRIPT_SOURCE);

/**
 * The statement beginning at `anchor`, delimited by BRACE MATCHING, anchor
 * included.
 *
 * A line-scoped or `[\s\S]{0,N}` regex would silently return a truncated or empty
 * result the moment the block grew, and every assertion built on it would pass by
 * matching nothing. Returns `''` when the anchor is absent, which every caller
 * asserts against first.
 */
function blockAt(source: string, anchor: string): string {
  const at = source.indexOf(anchor);
  if (at === -1) return '';
  const open = source.indexOf('{', at);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  return '';
}

const NO_REPORT_ANCHOR = 'if (!existsSync(outFile))';
const NO_REPORT_BLOCK = blockAt(EXECUTABLE_SCRIPT, NO_REPORT_ANCHOR);
const STARTUP_SENTENCE = 'It probably failed to start.';

/** A source that describes the OLD behaviour. Every matcher below is run against
 * it to prove the matcher can fail. */
const SYNTHETIC_OLD_SOURCE = [
  'function runJest() {',
  '  const res = spawnSync(process.execPath, jestArgs, { cwd: appDir });',
  '  if (!existsSync(outFile)) {',
  '    console.error(`test-ratchet: jest produced no report for ${app}. It probably failed to start.`);',
  '    console.error(res.stderr || res.stdout || "(no output)");',
  '    rmSync(scratch, { recursive: true, force: true });',
  '    process.exit(2);',
  '  }',
  '}',
].join('\n');

describe('test-ratchet: the no-report branch must not misname a kill (TOOL-10)', () => {
  it('the script and the branch this file is about both exist', () => {
    // NON-VACUITY FIRST. Everything below reads NO_REPORT_BLOCK; if the extractor
    // returned nothing, every later assertion would be a claim about an empty
    // string. This case is the reason the rest can be believed.
    expect(existsSync(SCRIPT_PATH)).toBe(true);
    expect(NO_REPORT_BLOCK).not.toBe('');
    expect(NO_REPORT_BLOCK).toContain(NO_REPORT_ANCHOR);
    expect(NO_REPORT_BLOCK.length).toBeGreaterThan(200);
  });

  it('the extractor really extracts — proven against a source that lacks the branch', () => {
    // The negative control for the extractor itself.
    expect(blockAt(EXECUTABLE_SCRIPT, 'if (!existsSync(noSuchThing))')).toBe('');
    // …and it does find the branch in a source that has one.
    expect(blockAt(SYNTHETIC_OLD_SOURCE, NO_REPORT_ANCHOR)).toContain(STARTUP_SENTENCE);
  });

  it('reads source rather than importing, and the reason is in the script itself', () => {
    // Asserted rather than merely asserted-in-prose: `runJest()` is CALLED at
    // module scope, and the argument guard above it calls `process.exit(2)`. A
    // spec that imported this file would therefore either terminate the jest
    // worker or launch a second full jest run inside this one. That is the whole
    // justification for every text-reading case above, so it is pinned.
    expect(EXECUTABLE_SCRIPT).toMatch(/^const report = runJest\(\);$/m);
    expect(EXECUTABLE_SCRIPT).toMatch(/^const app = process\.argv\[2\];$/m);
  });

  it('the branch reads what actually happened: the signal, the spawn error, and the elapsed time', () => {
    // All three discriminators, because no single one is reliable. Measured on
    // this platform: `spawnSync`'s own timeout sets `error.code === 'ETIMEDOUT'`
    // AND `signal === 'SIGTERM'` AND `status === null` simultaneously, while an
    // EXTERNAL kill of a Windows child frequently surfaces as a plain non-zero
    // exit code with `signal === null`.
    expect(NO_REPORT_BLOCK).toContain('res.signal');
    expect(NO_REPORT_BLOCK).toContain('res.error');
    expect(NO_REPORT_BLOCK).toContain('res.status === null');
    expect(NO_REPORT_BLOCK).toContain('elapsedMs');

    // The negative control: none of that is in the old source.
    const old = blockAt(SYNTHETIC_OLD_SOURCE, NO_REPORT_ANCHOR);
    expect(old).not.toBe('');
    expect(old).not.toContain('res.signal');
    expect(old).not.toContain('elapsedMs');
  });

  it('`res.error` is inspected BEFORE `res.signal`, or the timeout hides in the wrong branch', () => {
    // A `spawnSync` timeout populates both. If the signal branch came first, the
    // very case this story is about — a bounded child that was killed — would be
    // reported through the branch meant to remove the misdirection.
    //
    // Anchored on the BRANCH KEYWORDS, not on first occurrence: both names also
    // appear earlier, in the line that prints the raw triple.
    const errorBranchAt = NO_REPORT_BLOCK.indexOf('if (res.error)');
    const signalBranchAt = NO_REPORT_BLOCK.indexOf('else if (res.signal');
    expect(errorBranchAt).toBeGreaterThan(-1);
    expect(signalBranchAt).toBeGreaterThan(-1);
    expect(errorBranchAt).toBeLessThan(signalBranchAt);
  });

  it('says explicitly that a killed run did NOT fail to start, and shows what it saw', () => {
    // The whole point: an operator must read "it was terminated", with the signal
    // and the elapsed ms, not a guess about a broken install.
    expect(NO_REPORT_BLOCK).toContain('did NOT fail to start');
    expect(NO_REPORT_BLOCK).toMatch(/TERMINATED/);
    expect(NO_REPORT_BLOCK).toContain('${elapsedMs} ms');
    // The raw triple is printed, so the claim shows its evidence.
    expect(NO_REPORT_BLOCK).toMatch(/status=\$\{res\.status\}/);
    expect(NO_REPORT_BLOCK).toMatch(/signal=\$\{res\.signal/);

    const old = blockAt(SYNTHETIC_OLD_SOURCE, NO_REPORT_ANCHOR);
    expect(old).not.toContain('did NOT fail to start');
  });

  it('"It probably failed to start." survives exactly once, on the fall-through branch only (AC-10)', () => {
    // Not deleted — it is the right sentence for the case it was written for.
    // What must not happen is it being printed about a kill.
    const occurrences = EXECUTABLE_SCRIPT.split(STARTUP_SENTENCE).length - 1;
    expect(occurrences).toBe(1);
    expect(NO_REPORT_BLOCK).toContain(STARTUP_SENTENCE);

    // It lies AFTER every discriminator, i.e. in the final `else`. If it appeared
    // before them it would be the unconditional print again.
    const sentenceAt = NO_REPORT_BLOCK.indexOf(STARTUP_SENTENCE);
    for (const discriminator of ['res.error', 'res.signal', 'res.status === null', 'TERMINATED']) {
      expect([discriminator, NO_REPORT_BLOCK.indexOf(discriminator) < sentenceAt]).toEqual([
        discriminator,
        true,
      ]);
    }
    // …and it is reached through an `else`, never as a statement of its own.
    expect(NO_REPORT_BLOCK).toMatch(/}\s*else\s*{[\s\S]{0,200}It probably failed to start\./);
  });

  it('every branch still exits 2, and the scratch directory is still removed', () => {
    // The contract `ci-gate.sh` reads. Three (or more) narrations, one exit code:
    // a single `process.exit(2)` after the branch, so no branch can drift.
    expect(NO_REPORT_BLOCK).toContain('process.exit(2)');
    expect(NO_REPORT_BLOCK).toMatch(/rmSync\(scratch, \{ recursive: true, force: true \}\)/);
    expect(NO_REPORT_BLOCK.split('process.exit(').length - 1).toBe(1);
    // No other exit code may appear in this block.
    expect(NO_REPORT_BLOCK).not.toMatch(/process\.exit\((?!2\))/);
  });

  it('no passing behaviour moved: the ratchet still only turns one way', () => {
    // The branch this slice touched is the FAILURE narration. Everything the gate
    // decides on is untouched, and these are the strings it decides with.
    expect(EXECUTABLE_SCRIPT).toContain('NEW test failure(s) — not in the baseline');
    expect(EXECUTABLE_SCRIPT).toContain('baseline entr(ies) now PASS — the ratchet only turns one way');
    expect(EXECUTABLE_SCRIPT).toContain('no drift.');
    expect(EXECUTABLE_SCRIPT).toContain('--update and --skip are mutually exclusive.');
  });

  it('the elapsed ceiling is a named constant with its reasoning, not a magic number', () => {
    expect(EXECUTABLE_SCRIPT).toContain('STARTUP_FAULT_CEILING_MS');
    expect(SCRIPT_SOURCE).toMatch(/STARTUP_FAULT_CEILING_MS[\s\S]{0,40}=\s*\d+/);
  });
});

describe('test-ratchet: the argument contract ci-gate.sh depends on is unchanged', () => {
  // These EXECUTE the script. Neither reaches `runJest()` — every one of them
  // exits in the argument guard at the top of the file — so no jest run is
  // launched from inside this jest run. Measured: ~200 ms each.
  function runScript(argv: string[]) {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, ...argv], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  it('no app argument prints the usage line and exits 2', () => {
    const run = runScript([]);
    expect(run.status).toBe(2);
    expect(run.output).toContain('usage: node scripts/test-ratchet.js <app>');
  }, 60000);

  it('--update and --skip together are still refused, and still exit 2', () => {
    // The guard that keeps a partial run from rewriting a baseline and silently
    // deleting the findings it did not see.
    const run = runScript(['api', '--update', '--skip', 'src/shared/quality/']);
    expect(run.status).toBe(2);
    expect(run.output).toContain('--update and --skip are mutually exclusive.');
  }, 60000);

  it('--skip without a pattern is refused rather than read as "skip nothing"', () => {
    const run = runScript(['api', '--skip']);
    expect(run.status).toBe(2);
    expect(run.output).toContain('usage: node scripts/test-ratchet.js <app>');
  }, 60000);

  it('an unknown app directory is refused before jest is spawned', () => {
    const run = runScript(['no-such-app']);
    expect(run.status).toBe(2);
    expect(run.output).toContain('no such app directory');
  }, 60000);
});

/* ================================================================== *
 * TOOL-13 — a suite that stops existing must not read as green.
 *
 * WHAT THE DEFECT WAS
 * -------------------
 * The ratchet decided on a SET OF FAILURES. A test that stops executing is not a
 * failure, so it is not in the set, so the verdict was `✓ no drift.` Measured on
 * this worktree on 2026-08-12: `schema-drift-gate.spec.ts` reported 5 pending and
 * 0 failed — including `the unmodified repository PASSES — the gate is not red on
 * correct code`, the one case whose whole job is to prove the drift gate is not
 * red on correct code. It has not executed on this machine in any run, and nothing
 * said so.
 *
 * WHY THESE CASES ARE DIFFERENT FROM THE ONES ABOVE
 * -------------------------------------------------
 * The cases above read SOURCE, because `test-ratchet.js` cannot be required from a
 * jest worker. These EXECUTE the decision itself: the pure layer now lives in
 * `scripts/lib/ratchet-core.js`, so a hand-written jest report can be fed to THE
 * EXACT CODE THE GATE RUNS and the verdict asserted. That is the whole reason the
 * module exists — not testability for its own sake, but evidence that cannot drift
 * away from the gate.
 * ================================================================== */

const CORE_PATH = join(REPO_ROOT, 'scripts', 'lib', 'ratchet-core.js');

interface ReducedReport {
  failing: string[];
  skipped: Record<string, number>;
  loadFailures: Array<{ key: string; cause: string }>;
  suites: string[];
}

interface SkipDelta {
  suite: string;
  from: number;
  to: number;
}

interface Verdict {
  regressions: string[];
  fixed: string[];
  knownSkipped: string[];
  heldOutSkipEntries: number;
  skipRises: SkipDelta[];
  skipFalls: SkipDelta[];
  missingSuites: Array<{ suite: string; from: number }>;
  baselineHasSkipBlock: boolean;
}

interface BaselineApp {
  failures?: Record<string, { finding?: string; reason?: string }>;
  skipped?: Record<string, number>;
}

interface RatchetCoreModule {
  NOT_EXECUTED_STATUSES: Set<string>;
  LOAD_FAILURE_SENTINEL: string;
  LOAD_FAILURE_CAUSE_LINES: number;
  stripAnsi: (value: unknown) => string;
  suiteKey: (specPath: string, appDir: string) => string;
  testKey: (specPath: string, fullName: string, appDir: string) => string;
  loadFailureCause: (suite: unknown) => string;
  reduceReport: (input: { report: unknown; appDir: string }) => ReducedReport;
  compareToBaseline: (input: {
    reduced: ReducedReport;
    baselineApp?: BaselineApp;
    skip?: string | null;
  }) => Verdict;
}

/* eslint-disable @typescript-eslint/no-require-imports */
// Deliberately unguarded, exactly as `schema-drift-gate.spec.ts:165` requires its
// own subject. If the core disappears or stops exporting its surface, this suite
// must go RED at load: a guard spec that degrades to "nothing to check" when its
// subject vanishes is the precise failure the subject exists to stop.
const core: RatchetCoreModule = require(CORE_PATH);
/* eslint-enable @typescript-eslint/no-require-imports */

/** A POSIX-shaped app directory: the keys are relative paths either way. */
const APP_DIR = '/repo/apps/api';
/** Written as a code, never as a literal control character in a source file. */
const ESC = String.fromCharCode(27);

interface FixtureAssertion {
  status: string;
  fullName: string;
}
interface FixtureSuite {
  name: string;
  status: string;
  assertionResults: FixtureAssertion[];
  message?: string;
}

function fixtureSuite(
  relPath: string,
  status: string,
  assertionResults: FixtureAssertion[],
  message?: string,
): FixtureSuite {
  return { name: `${APP_DIR}/${relPath}`, status, assertionResults, ...(message ? { message } : {}) };
}
const assertion = (status: string, fullName: string): FixtureAssertion => ({ status, fullName });

/**
 * §1.1's measured fixture, copied shape-for-shape: one passing `it`, a
 * `describe.skip` holding two, one `it.skip`, one `it.todo`. jest 29.7.0 reports
 * the first three of those as 'pending' and the last as 'todo'.
 */
const SKIPPING_SUITE = fixtureSuite('src/skipping.spec.ts', 'focused', [
  assertion('passed', 'outer runs'),
  assertion('pending', 'outer skipped block a'),
  assertion('pending', 'outer skipped block b'),
  assertion('pending', 'outer single skipped'),
  assertion('todo', 'outer a todo'),
]);

const FAILING_SUITE = fixtureSuite('src/red.spec.ts', 'failed', [
  assertion('failed', 'this one is genuinely red'),
]);

/** §1.3: `assertionResults: []`, `status: 'failed'`, cause in `message`, ANSI included. */
const LOAD_FAILED_SUITE = fixtureSuite(
  'src/broken.spec.ts',
  'failed',
  [],
  [
    '  ● Test suite failed to run',
    '',
    "    Cannot find module './no-such-module-anywhere' from 'broken.spec.ts'",
    '',
    `    ${ESC}[0m${ESC}[31m > 1 | require('./no-such-module-anywhere');${ESC}[39m`,
  ].join('\n'),
);

/** §1.4: a suite skipped in its entirety — status 'skipped', and it STILL lists
 * its assertions. This is what makes it unconfusable with a load failure. */
const ALL_SKIPPED_SUITE = fixtureSuite('src/allskipped.spec.ts', 'skipped', [
  assertion('pending', 'never runs at all'),
]);

const REPORT = {
  numTotalTests: 7,
  numPassedTests: 1,
  testResults: [SKIPPING_SUITE, FAILING_SUITE, LOAD_FAILED_SUITE, ALL_SKIPPED_SUITE],
};

const reduce = (report: unknown = REPORT): ReducedReport => core.reduceReport({ report, appDir: APP_DIR });
const compare = (baselineApp: BaselineApp, skip: string | null = null): Verdict =>
  core.compareToBaseline({ reduced: reduce(), baselineApp, skip });

/** The baseline that MATCHES the fixture above — the control every other case is
 * a single mutation away from. */
const MATCHING_BASELINE: BaselineApp = {
  failures: {
    'src/red.spec.ts::this one is genuinely red': { finding: 'FIXTURE' },
    'src/broken.spec.ts::<suite failed to load>': { finding: 'FIXTURE' },
  },
  skipped: { 'src/skipping.spec.ts': 4, 'src/allskipped.spec.ts': 1 },
};

describe('test-ratchet core: a test that STOPS RUNNING is drift (TOOL-13)', () => {
  it('the core module loads and exports the surface the gate decides with', () => {
    // NON-VACUITY FIRST. Every case below reads these exports.
    expect(existsSync(CORE_PATH)).toBe(true);
    expect(typeof core.reduceReport).toBe('function');
    expect(typeof core.compareToBaseline).toBe('function');
    expect(typeof core.testKey).toBe('function');
    expect(core.NOT_EXECUTED_STATUSES instanceof Set).toBe(true);
    expect(core.LOAD_FAILURE_SENTINEL).toBe('<suite failed to load>');
  });

  it('NOT_EXECUTED_STATUSES covers pending AND todo — the mutant that counts only "skipped" counts ZERO', () => {
    expect([...core.NOT_EXECUTED_STATUSES].sort()).toEqual(['disabled', 'pending', 'skipped', 'todo']);

    // The mutant, MEASURED rather than described: `describe.skip` does not produce
    // 'skipped' in jest 29.7.0, so a set of only ['skipped'] finds nothing on the
    // §1.1 fixture. Without this number, "we count skips" is satisfiable by
    // counting nothing — which is the defect shipping again under a new name.
    const mutantSet = new Set(['skipped']);
    const mutantCount = SKIPPING_SUITE.assertionResults.filter((t) => mutantSet.has(t.status)).length;
    expect(mutantCount).toBe(0);

    const realCount = SKIPPING_SUITE.assertionResults.filter((t) =>
      core.NOT_EXECUTED_STATUSES.has(t.status),
    ).length;
    expect(realCount).toBe(4);
  });

  it('reduceReport counts the tests that did not run, per suite, and records only non-zero entries', () => {
    const reduced = reduce();
    expect(reduced.skipped).toEqual({ 'src/skipping.spec.ts': 4, 'src/allskipped.spec.ts': 1 });
    // The red suite and the unloadable one have nothing skipped, so they are absent
    // rather than present-and-zero: the baseline stays small and every line in it
    // means something (§3.5(d)).
    expect(Object.keys(reduced.skipped)).not.toContain('src/red.spec.ts');
    expect(reduced.suites).toEqual([
      'src/skipping.spec.ts',
      'src/red.spec.ts',
      'src/broken.spec.ts',
      'src/allskipped.spec.ts',
    ]);
  });

  it('a RISE in the not-executed count fails the gate — the primary criterion (AC-1)', () => {
    const verdict = compare({
      ...MATCHING_BASELINE,
      skipped: { 'src/skipping.spec.ts': 2, 'src/allskipped.spec.ts': 1 },
    });
    expect(verdict.skipRises).toEqual([{ suite: 'src/skipping.spec.ts', from: 2, to: 4 }]);
    // …and it is genuinely a NEW verdict, not the old one wearing a new name: no
    // failure appeared, so the failure half of the ratchet is silent here.
    expect(verdict.regressions).toEqual([]);
    expect(verdict.fixed).toEqual([]);

    // The exit path. `test-ratchet.js` must actually exit 1 on a rise, or the
    // detection is a log line and not a gate.
    expect(EXECUTABLE_SCRIPT).toMatch(
      /if \(regressions\.length \|\| fixed\.length \|\| skipRises\.length \|\| missingSuites\.length\) process\.exit\(1\);/,
    );
  });

  it('the SAME fixture against a MATCHING baseline is clean — the control for the case above', () => {
    // Without this, the case above is satisfied by a comparator that always fails.
    const verdict = compare(MATCHING_BASELINE);
    expect(verdict.skipRises).toEqual([]);
    expect(verdict.skipFalls).toEqual([]);
    expect(verdict.missingSuites).toEqual([]);
    expect(verdict.regressions).toEqual([]);
    expect(verdict.fixed).toEqual([]);
  });

  it('a FALL is reported, never failed — the asymmetry with the failure list (AC-8)', () => {
    const verdict = compare({
      ...MATCHING_BASELINE,
      skipped: { 'src/skipping.spec.ts': 9, 'src/allskipped.spec.ts': 1 },
    });
    expect(verdict.skipFalls).toEqual([{ suite: 'src/skipping.spec.ts', from: 9, to: 4 }]);
    expect(verdict.skipRises).toEqual([]);
    expect(verdict.missingSuites).toEqual([]);
    // A skip count is a MEASUREMENT over a suite whose membership legitimately
    // changes; failing on a fall would red the gate on the author who un-skipped a
    // test, and the gate would be routed around within a week.
  });

  it('a baseline suite ABSENT from the report fails — the suite stopped existing (§3.5(c))', () => {
    // §1.2's second shape: not a count that moved, a suite that vanished. This is
    // the shape behind the 2433 → 2219 denominator movement the finding recorded.
    const verdict = compare({
      ...MATCHING_BASELINE,
      skipped: { ...MATCHING_BASELINE.skipped, 'src/vanished.spec.ts': 3 },
    });
    expect(verdict.missingSuites).toEqual([{ suite: 'src/vanished.spec.ts', from: 3 }]);
    expect(verdict.skipRises).toEqual([]);
  });

  it('a suite with skips and NO baseline entry is a rise from 0 (§3.5(b))', () => {
    // Otherwise a new suite could arrive fully skipped and be green forever —
    // escape by omission, which `boot-check.js` and `lint-ratchet.js` already refuse.
    const verdict = compare({ ...MATCHING_BASELINE, skipped: { 'src/skipping.spec.ts': 4 } });
    expect(verdict.skipRises).toEqual([{ suite: 'src/allskipped.spec.ts', from: 0, to: 1 }]);
  });

  it('under --skip, matching suites are held out of BOTH directions (AC-3)', () => {
    const baseline: BaselineApp = {
      ...MATCHING_BASELINE,
      skipped: { 'src/skipping.spec.ts': 2, 'src/allskipped.spec.ts': 1, 'src/skipping-gone.spec.ts': 7 },
    };

    // Without the hold-out: a rise AND a vanished suite.
    const unheld = compare(baseline);
    expect(unheld.skipRises).toEqual([{ suite: 'src/skipping.spec.ts', from: 2, to: 4 }]);
    expect(unheld.missingSuites).toEqual([{ suite: 'src/skipping-gone.spec.ts', from: 7 }]);

    // With it: the same fixture, and the verdict differs exactly there. This is
    // what stops every --skip run of ci-gate.sh from going red, since a suite the
    // tiering did not run contributes no entry and would look "vanished".
    const held = compare(baseline, 'src/skipping');
    expect(held.skipRises).toEqual([]);
    expect(held.skipFalls).toEqual([]);
    expect(held.missingSuites).toEqual([]);
    expect(held.heldOutSkipEntries).toBe(2);
    // …and the run says how much less it covered, in both currencies.
    expect(EXECUTABLE_SCRIPT).toContain('skip-count ');
    expect(EXECUTABLE_SCRIPT).toContain('held out of the drift comparison');
  });

  it('a load failure stays a FAILURE under the byte-identical sentinel and counts 0 skipped (AC-6)', () => {
    const reduced = reduce();
    expect(reduced.failing).toContain('src/broken.spec.ts::<suite failed to load>');
    // Byte-identical: it is a baseline key, and changing it would invalidate every
    // existing entry that uses it.
    expect(reduced.failing).toContain(`src/broken.spec.ts::${core.LOAD_FAILURE_SENTINEL}`);
    // ASSERTED, not assumed (§1.3/§1.4). A future jest that emitted a synthetic
    // pending assertion for an unloadable file would double-count it as both a
    // failure and a skip, and this is the line that would notice.
    expect(reduced.skipped['src/broken.spec.ts']).toBeUndefined();
    // …while a suite skipped in its ENTIRETY is a skip and not a load failure.
    expect(reduced.skipped['src/allskipped.spec.ts']).toBe(1);
    expect(reduced.loadFailures.map((l) => l.key)).toEqual(['src/broken.spec.ts']);
  });

  it('TOOL-16(a): the load failure carries its CAUSE, ANSI-stripped, truncated with a stated marker', () => {
    const [failure] = reduce().loadFailures;
    // NON-VACUITY: without this, every claim below would be a claim about
    // `undefined?.cause`, and the case would pass on a core that found no load
    // failure at all.
    expect(failure).toBeDefined();
    const cause = failure?.cause ?? '';
    // The mutant this kills: reading `suite.failureMessage` — which does not exist
    // in jest 29.7.0's --json output — yields undefined, and TOOL-16(a) ships as a
    // no-op that prints nothing. A non-empty cause is what that mutant fails.
    expect(typeof cause).toBe('string');
    expect(cause.length).toBeGreaterThan(0);
    expect(cause).toContain("Cannot find module './no-such-module-anywhere'");
    // No control characters reach the gate log.
    expect(cause).not.toContain(ESC);
    expect(cause).not.toContain('[31m');

    // Truncation SAYS SO: a message that silently cuts is one an operator cannot
    // trust.
    const overLong = fixtureSuite(
      'src/verbose.spec.ts',
      'failed',
      [],
      Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'),
    );
    const [truncated] = reduce({ testResults: [overLong] }).loadFailures;
    expect(truncated).toBeDefined();
    const lines = (truncated?.cause ?? '').split('\n');
    expect(lines).toHaveLength(core.LOAD_FAILURE_CAUSE_LINES + 1);
    expect(lines[lines.length - 1]).toBe(`… (truncated; ${core.LOAD_FAILURE_CAUSE_LINES} of 40 lines)`);
  });

  it('a baseline with NO skipped block degrades LOUDLY: inactive, not silently green (AC-9)', () => {
    const verdict = compare({ failures: MATCHING_BASELINE.failures });
    // No crash, and no fabricated verdict in either direction: an absent block is
    // "not measured", so nothing is compared…
    expect(verdict.baselineHasSkipBlock).toBe(false);
    expect(verdict.skipRises).toEqual([]);
    expect(verdict.skipFalls).toEqual([]);
    expect(verdict.missingSuites).toEqual([]);
    // …and the failure half is untouched by the migration.
    expect(verdict.regressions).toEqual([]);
    expect(verdict.fixed).toEqual([]);

    // The printed half is pinned on SOURCE rather than executed, and the reason is
    // the same one the file's header gives: reaching those two lines means running
    // `test-ratchet.js`, which runs jest. What is pinned is that the green is
    // chosen BY THIS FLAG and is never unqualified when the flag is false.
    expect(EXECUTABLE_SCRIPT).toContain('The skip ratchet is INACTIVE');
    expect(EXECUTABLE_SCRIPT).toContain('run --update from a COMPLETE run');
    expect(EXECUTABLE_SCRIPT).toMatch(
      /verdict\.baselineHasSkipBlock\s*\?\s*'no drift\.'\s*:\s*'no drift \(skipped-count ratchet INACTIVE/,
    );
  });
});

describe('test-ratchet: the decision really moved, and is not duplicated', () => {
  it('the script REQUIRES the core rather than re-implementing the reduction', () => {
    expect(EXECUTABLE_SCRIPT).toContain("require('./lib/ratchet-core')");
    // The reduction is no longer inline, so the fixture evidence above and the code
    // the gate runs cannot drift apart. Measured against this diff: zero remaining
    // references in executable source.
    expect(EXECUTABLE_SCRIPT).not.toContain('assertionResults');
    expect(EXECUTABLE_SCRIPT.split('reduceReport').length - 1).toBe(1);
    expect(EXECUTABLE_SCRIPT.split('compareToBaseline').length - 1).toBe(1);
  });

  it('no new flag, env var or parameter can choose the gate\'s input (DNC-10, AC-12)', () => {
    // The forbidden alternative, named in the story so nobody reaches for it: a
    // script that could read its report from disk is a gate that can be bypassed.
    expect(EXECUTABLE_SCRIPT).not.toMatch(/RATCHET_[A-Z_]*(?:FILE|INPUT|REPORT)/);
    expect(EXECUTABLE_SCRIPT).not.toContain('process.env');
    // The only report the script can decide on is the one it just produced itself.
    expect(EXECUTABLE_SCRIPT).toMatch(/^const report = runJest\(\);$/m);
    expect(EXECUTABLE_SCRIPT).toContain('--update and --skip are mutually exclusive.');
    // …and the refusal now names the counts as its second reason (AC-2).
    expect(EXECUTABLE_SCRIPT).toContain('silently disarming the half of the gate that notices tests that');
  });

  it('the INACTIVE disclosure is emitted BEFORE the exit, so a red run still discloses it (DNC-08)', () => {
    // "Could not check" is a property of THE run, not of a green one. Emitted after
    // the exit, this notice would be unreachable on exactly the runs that need it
    // most — a run already red for an unrelated regression would never disclose
    // that the skip half did not run at all. Ordering is the whole assertion, so
    // both anchors are proven to exist BEFORE any claim is made about their order:
    // a pin that silently passes because its needle vanished is the TOOL-07/TOOL-08
    // family of defect, and this file exists to not be that.
    const notice = EXECUTABLE_SCRIPT.indexOf('The skip ratchet is INACTIVE');
    const exit = EXECUTABLE_SCRIPT.indexOf('process.exit(1)');
    expect(notice).toBeGreaterThan(-1);
    expect(exit).toBeGreaterThan(-1);
    // Exactly one of each, or "before" is ambiguous and the assertion is theatre.
    expect(EXECUTABLE_SCRIPT.split('The skip ratchet is INACTIVE').length - 1).toBe(1);
    expect(EXECUTABLE_SCRIPT.split('process.exit(1)').length - 1).toBe(1);
    expect(notice).toBeLessThan(exit);
  });
});
