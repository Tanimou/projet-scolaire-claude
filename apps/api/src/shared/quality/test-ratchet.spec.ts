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
 * TOOL-13 — a suite that stops existing must not read as green
 *
 * WHAT THE DEFECT WAS
 * -------------------
 * The ratchet decided on a SET OF FAILURES: every `status === 'failed'` assertion
 * plus one load-failure sentinel, compared against a baseline OF FAILURES. It
 * never looked at a count of anything. A test that stops executing is not a
 * failure, so it was not in the set, so the ratchet printed `✓ no drift.` about a
 * check it had not performed — the one direction a merge gate may never be wrong
 * in.
 *
 * The proof was in this repository. `schema-drift-gate.spec.ts` turns its whole
 * end-to-end block into `describe.skip` when no PostgreSQL is reachable — this
 * machine — including the case whose entire job is to prove the drift gate is not
 * red on correct code. Measured on 2026-08-12 over the two spec files this slice
 * touches: `{"total":124,"passed":119,"failed":0,"pending":5}`. `numFailedTests`
 * was 0 and the ratchet's verdict on that report was `✓ no drift.`
 *
 * WHY THESE CASES CAN EXIST AT ALL
 * --------------------------------
 * The block above reads SOURCE, because `test-ratchet.js` cannot be `require()`d
 * (it reads `process.argv[2]`, can `process.exit(2)`, and calls `runJest()` at
 * module scope). The decision layer has therefore been extracted into
 * `scripts/lib/ratchet-core.js` — pure, no IO, no `process`, no clock — and the
 * cases below feed hand-written jest reports to THE EXACT MODULE THE GATE RUNS.
 * That is why the evidence and the gate cannot drift apart, and it is why the
 * alternative (an env var telling the script to read a report from disk) was
 * refused: a gate whose input can be chosen from the environment is a gate that
 * can be bypassed (DNC-10).
 * ================================================================== */

const CORE_PATH = join(REPO_ROOT, 'scripts', 'lib', 'ratchet-core.js');

interface ReducedReport {
  failing: string[];
  skipped: Record<string, number>;
  loadFailures: Array<{ key: string; cause: string }>;
  suites: string[];
}

interface Comparison {
  regressions: string[];
  fixed: string[];
  known: string[];
  knownSkipped: string[];
  skipRises: Array<{ key: string; from: number; to: number; newSuite: boolean }>;
  skipFalls: Array<{ key: string; from: number; to: number }>;
  missingSuites: Array<{ key: string; from: number }>;
  heldOutSkipCounts: number;
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
  INACTIVE_QUALIFIER: string;
  suiteKey: (specPath: string, appDir: string) => string;
  testKey: (specPath: string, fullName: string, appDir: string) => string;
  stripAnsi: (text: string) => string;
  loadFailureCause: (suite: unknown, maxLines?: number) => string;
  reduceReport: (input: { report: unknown; appDir: string }) => ReducedReport;
  compareToBaseline: (input: {
    reduced: ReducedReport;
    baselineApp: BaselineApp | undefined;
    skip: string | null;
  }) => Comparison;
  formatInactiveWarning: (app: string) => string;
}

/* eslint-disable @typescript-eslint/no-require-imports */
// Deliberately UNGUARDED, the same choice `schema-drift-gate.spec.ts:165` makes.
// If the core is absent or stops exporting its surface this suite must go red at
// load: a guard spec that degrades to "nothing to check" when its subject
// disappears is precisely the failure the subject exists to stop.
const core: RatchetCoreModule = require(CORE_PATH);
/* eslint-enable @typescript-eslint/no-require-imports */

/* ------------------------------------------------------------------ *
 * Fixtures — hand-written jest reports, copied from §1's MEASURED shapes
 * (jest 29.7.0, this repository, 2026-08-12). Backslashed paths on purpose:
 * they also exercise the forward-slash normalisation that makes a Windows run
 * and a Linux CI run produce the same key.
 * ------------------------------------------------------------------ */

const FIXTURE_APP_DIR = 'C:\\repo\\apps\\api';
const ESC = String.fromCharCode(27);

function fixturePath(rel: string): string {
  return `${FIXTURE_APP_DIR}\\${rel.split('/').join('\\')}`;
}

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

function suite(rel: string, status: string, assertions: FixtureAssertion[], message?: string): FixtureSuite {
  const built: FixtureSuite = { name: fixturePath(rel), status, assertionResults: assertions };
  if (message !== undefined) built.message = message;
  return built;
}

function report(...suites: FixtureSuite[]) {
  return { testResults: suites };
}

/**
 * §1.1's fixture, verbatim in shape: one passing `it`, a `describe.skip` holding
 * two `it`s (both 'pending'), one `it.skip` ('pending'), one `it.todo` ('todo').
 * numTotalTests 5 / numPassedTests 1 / numPendingTests 3 / numTodoTests 1.
 */
const SKIPPY = suite('src/skippy.spec.ts', 'focused', [
  { status: 'passed', fullName: 'outer runs' },
  { status: 'pending', fullName: 'outer skipped block a' },
  { status: 'pending', fullName: 'outer skipped block b' },
  { status: 'pending', fullName: 'outer single skipped' },
  { status: 'todo', fullName: 'outer a todo' },
]);

/** The same suite with one of its four not-executed tests un-skipped. */
const SKIPPY_FEWER = suite('src/skippy.spec.ts', 'focused', [
  { status: 'passed', fullName: 'outer runs' },
  { status: 'passed', fullName: 'outer skipped block a' },
  { status: 'pending', fullName: 'outer skipped block b' },
  { status: 'pending', fullName: 'outer single skipped' },
  { status: 'todo', fullName: 'outer a todo' },
]);

/** §1.3: a suite that failed to LOAD — zero assertions, cause in `message`,
 * ANSI escapes included exactly as jest emits them. */
const BROKEN_REASON = "Cannot find module './no-such-module-anywhere' from 'broken.spec.js'";
const BROKEN = suite(
  'src/broken.spec.ts',
  'failed',
  [],
  `  ● Test suite failed to run\n\n    ${BROKEN_REASON}\n\n${ESC}[0m${ESC}[31m at Resolver.resolveModule${ESC}[39m`,
);

/** §1.4: a suite skipped in its ENTIRETY — status 'skipped', and it STILL lists
 * its assertions. This is why it cannot be confused with a load failure. */
const ALL_SKIPPED = suite('src/allskipped.spec.ts', 'skipped', [
  { status: 'pending', fullName: 'nothing here ran' },
]);

/** A plain green suite, so the fixtures are not all pathological. */
const HEALTHY = suite('src/healthy.spec.ts', 'passed', [{ status: 'passed', fullName: 'it works' }]);

const KEY_SKIPPY = 'src/skippy.spec.ts';
const KEY_ALL_SKIPPED = 'src/allskipped.spec.ts';
const KEY_BROKEN = 'src/broken.spec.ts';

function reduce(...suites: FixtureSuite[]): ReducedReport {
  return core.reduceReport({ report: report(...suites), appDir: FIXTURE_APP_DIR });
}

describe('ratchet-core: a test that stops executing is a red like any other (TOOL-13)', () => {
  it('the core module exists and exports the surface the gate depends on', () => {
    // NON-VACUITY FIRST. Every case below reads one of these; if the module had
    // moved or shrunk, they would be claims about `undefined`.
    expect(existsSync(CORE_PATH)).toBe(true);
    for (const name of [
      'NOT_EXECUTED_STATUSES',
      'LOAD_FAILURE_SENTINEL',
      'suiteKey',
      'testKey',
      'reduceReport',
      'compareToBaseline',
      'formatInactiveWarning',
    ]) {
      expect([name, name in core]).toEqual([name, true]);
    }
    // The sentinel is a BASELINE KEY. Changing it would invalidate every existing
    // entry that uses it, so it is pinned byte-identical.
    expect(core.LOAD_FAILURE_SENTINEL).toBe('<suite failed to load>');
  });

  it('NOT_EXECUTED_STATUSES covers pending AND todo — and the "skipped"-only mutant counts ZERO (AC-5)', () => {
    expect(core.NOT_EXECUTED_STATUSES.has('pending')).toBe(true);
    expect(core.NOT_EXECUTED_STATUSES.has('todo')).toBe(true);

    // THE MUTANT, MEASURED. `describe.skip` and `it.skip` surface as 'pending' in
    // jest 29.7.0, never as 'skipped'. An implementation that counted only
    // 'skipped' would look like it counted skips and would count NOTHING — which
    // is exactly how this defect ships again. The number is asserted, not
    // described.
    const onlySkipped = new Set(['skipped']);
    const mutantCount = SKIPPY.assertionResults.filter((t) => onlySkipped.has(t.status)).length;
    expect(mutantCount).toBe(0);

    const realCount = SKIPPY.assertionResults.filter((t) => core.NOT_EXECUTED_STATUSES.has(t.status)).length;
    expect(realCount).toBe(4);
  });

  it('reduceReport counts the not-executed tests per suite, normalising the path (AC-1)', () => {
    const reduced = reduce(SKIPPY, HEALTHY, ALL_SKIPPED);
    expect(reduced.skipped).toEqual({ [KEY_SKIPPY]: 4, [KEY_ALL_SKIPPED]: 1 });
    // Only NON-ZERO entries are recorded, so the baseline stays meaningful.
    expect(Object.keys(reduced.skipped)).not.toContain('src/healthy.spec.ts');
    // …but the suite is still INVENTORIED, which is what lets a vanished suite be
    // told apart from a count that fell.
    expect(reduced.suites).toEqual([KEY_SKIPPY, 'src/healthy.spec.ts', KEY_ALL_SKIPPED]);
    expect(reduced.failing).toEqual([]);
  });

  it('a count that RISES fails the gate, and the script exits 1 on it (AC-1, the primary)', () => {
    const reduced = reduce(SKIPPY);
    const verdict = core.compareToBaseline({
      reduced,
      baselineApp: { failures: {}, skipped: { [KEY_SKIPPY]: 2 } },
      skip: null,
    });
    expect(verdict.skipRises).toEqual([{ key: KEY_SKIPPY, from: 2, to: 4, newSuite: false }]);
    expect(verdict.skipFalls).toEqual([]);
    expect(verdict.missingSuites).toEqual([]);

    // …and a rise really does reach `process.exit(1)` in the script. Without this
    // the comparator could be right while the gate stayed green.
    expect(EXECUTABLE_SCRIPT).toMatch(
      /if \(regressions\.length \|\| fixed\.length \|\| skipRises\.length \|\| missingSuites\.length\) process\.exit\(1\);/,
    );
  });

  it('the SAME fixture against a MATCHING baseline is clean — the control (AC-1)', () => {
    // Without this, the case above is satisfied by a comparator that always fails.
    const verdict = core.compareToBaseline({
      reduced: reduce(SKIPPY),
      baselineApp: { failures: {}, skipped: { [KEY_SKIPPY]: 4 } },
      skip: null,
    });
    expect(verdict.skipRises).toEqual([]);
    expect(verdict.skipFalls).toEqual([]);
    expect(verdict.missingSuites).toEqual([]);
    expect(verdict.regressions).toEqual([]);
    expect(verdict.fixed).toEqual([]);
  });

  it('a count that FALLS is reported, never failed — and the asymmetry is deliberate (AC-8)', () => {
    // A failure key is an IDENTITY; a skipped count is a MEASUREMENT over a suite
    // whose membership moves for legitimate reasons. Failing on a fall would red
    // the gate on the author who un-skipped a test, and the gate would be routed
    // around within a week.
    const verdict = core.compareToBaseline({
      reduced: reduce(SKIPPY_FEWER),
      baselineApp: { failures: {}, skipped: { [KEY_SKIPPY]: 4 } },
      skip: null,
    });
    expect(verdict.skipFalls).toEqual([{ key: KEY_SKIPPY, from: 4, to: 3 }]);
    expect(verdict.skipRises).toEqual([]);
    expect(verdict.missingSuites).toEqual([]);

    // The report has to be LOUD and has to name the honest limit: a fall is also
    // what a DELETED test looks like from inside a suite.
    expect(EXECUTABLE_SCRIPT).toContain('FEWER skipped tests than the baseline');
    expect(EXECUTABLE_SCRIPT).toContain('DISAPPEARANCE');
  });

  it('a baselined suite ABSENT from the report fails — the suite stopped existing (AC-7)', () => {
    // §1.2's second shape: the count does not move, the SUITE does. This is the
    // one that catches "its file no longer matched", the shape that moved the
    // denominator 2433 → 2219 across three runs on one unchanged branch.
    const verdict = core.compareToBaseline({
      reduced: reduce(HEALTHY),
      baselineApp: { failures: {}, skipped: { [KEY_SKIPPY]: 4 } },
      skip: null,
    });
    expect(verdict.missingSuites).toEqual([{ key: KEY_SKIPPY, from: 4 }]);
    expect(verdict.skipRises).toEqual([]);
    expect(verdict.skipFalls).toEqual([]);
  });

  it('a suite with skips and NO baseline entry is a rise from 0, and fails (AC-1)', () => {
    // Otherwise a new suite could arrive fully skipped and be green forever.
    // Escape by omission is what `boot-check.js`'s baseline and
    // `lint-ratchet.js`'s ceiling list already refuse.
    const verdict = core.compareToBaseline({
      reduced: reduce(ALL_SKIPPED),
      baselineApp: { failures: {}, skipped: {} },
      skip: null,
    });
    expect(verdict.skipRises).toEqual([{ key: KEY_ALL_SKIPPED, from: 0, to: 1, newSuite: true }]);
  });

  it('under --skip, matching suites are held out in BOTH directions (AC-3)', () => {
    // The gate's own tiering (`ci-gate.sh --skip src/shared/quality/`) chose not to
    // run those paths, so nothing is known about them in either direction. Under
    // `--skip` they contribute NO entry to the report at all — so without the
    // hold-out every one of them would look like a vanished suite and a `--skip`
    // run would fail the gate every single time.
    //
    // The same fixture is run with and without `skip`, and the verdicts must
    // differ exactly there.
    const reduced = reduce(HEALTHY);
    const baselineApp: BaselineApp = {
      failures: { 'src/shared/quality/thing.spec.ts::a known failure': { finding: 'X' } },
      skipped: { 'src/shared/quality/thing.spec.ts': 5 },
    };

    const without = core.compareToBaseline({ reduced, baselineApp, skip: null });
    expect(without.missingSuites).toEqual([{ key: 'src/shared/quality/thing.spec.ts', from: 5 }]);
    expect(without.fixed).toEqual(['src/shared/quality/thing.spec.ts::a known failure']);

    const withSkip = core.compareToBaseline({ reduced, baselineApp, skip: 'src/shared/quality/' });
    expect(withSkip.missingSuites).toEqual([]);
    expect(withSkip.skipRises).toEqual([]);
    expect(withSkip.skipFalls).toEqual([]);
    expect(withSkip.fixed).toEqual([]);
    // Held out is not the same as ignored: the count is reported.
    expect(withSkip.heldOutSkipCounts).toBe(1);
    expect(withSkip.knownSkipped).toEqual(['src/shared/quality/thing.spec.ts::a known failure']);

    // …and the two events are distinguished in the OUTPUT, not only in the data:
    // "the gate chose not to look" is a different sentence from "the suite ran and
    // decided not to execute".
    expect(EXECUTABLE_SCRIPT).toContain('skip-count entr(ies) ');
    expect(EXECUTABLE_SCRIPT).toContain('held out of the drift comparison');
  });

  it('a load-failed suite stays a FAILURE and contributes 0 to the skip counts (AC-6)', () => {
    const reduced = reduce(BROKEN, ALL_SKIPPED);
    // Unchanged semantics: the byte-identical sentinel key, under the suite path.
    expect(reduced.failing).toEqual([`${KEY_BROKEN}::<suite failed to load>`]);
    // Explicitly 0, not merely "absent": a load failure counted in both places
    // would make one disappearance read as two.
    expect(reduced.skipped[KEY_BROKEN]).toBeUndefined();
    expect(Object.keys(reduced.skipped)).toEqual([KEY_ALL_SKIPPED]);
    // §1.4, asserted rather than assumed: the two shapes cannot collide, because a
    // fully-skipped suite still lists its assertions and is status 'skipped'.
    expect(ALL_SKIPPED.assertionResults.length).toBe(1);
    expect(BROKEN.assertionResults.length).toBe(0);
  });

  it('TOOL-16(a): the load failure carries its CAUSE, ANSI-stripped and truncatable', () => {
    const reduced = reduce(BROKEN);
    expect(reduced.loadFailures).toHaveLength(1);
    const { key, cause } = reduced.loadFailures[0] ?? { key: '', cause: '' };
    expect(key).toBe(KEY_BROKEN);

    // THE MUTANT, MEASURED. The finding said the script "throws away the report's
    // `failureMessage`" — but in jest 29.7.0's --json output that key DOES NOT
    // EXIST (the suite object has `message`; `failureMessage` is the internal
    // field name `formatTestResults` renames on the way out). An implementation
    // reading `suite.failureMessage` would yield `undefined` and TOOL-16(a) would
    // ship as a no-op that prints nothing. So a NON-EMPTY cause is asserted, which
    // that mutant fails.
    expect((BROKEN as unknown as Record<string, unknown>).failureMessage).toBeUndefined();
    expect(typeof cause).toBe('string');
    expect(cause.length).toBeGreaterThan(0);
    expect(cause).toContain(BROKEN_REASON);

    // No control characters reach the gate log. The fixture's reason text contains
    // no bracket of its own, so `[` not matching is a real assertion about the
    // escape sequences rather than a coincidence of the wording.
    expect(cause).not.toContain(ESC);
    expect(cause).not.toMatch(/\[/);

    // Truncation states itself — a message that silently cuts is one an operator
    // cannot trust.
    const long = { message: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') };
    const truncated = core.loadFailureCause(long, 12);
    expect(truncated.split('\n')).toHaveLength(13);
    expect(truncated).toContain('(truncated; 12 of 40 lines)');
    expect(core.LOAD_FAILURE_CAUSE_LINES).toBe(12);

    // And the script actually PRINTS it, for every load-failed suite — baselined or
    // not, because a tolerated load failure whose cause changed is still something
    // the operator must see.
    expect(EXECUTABLE_SCRIPT).toContain('reduced.loadFailures');
    expect(EXECUTABLE_SCRIPT).toContain('failed to LOAD');
  });

  it('a baseline with no "skipped" block degrades LOUDLY, never silently (AC-9)', () => {
    const verdict = core.compareToBaseline({
      reduced: reduce(SKIPPY),
      baselineApp: { failures: {} },
      skip: null,
    });
    // No crash, and no invented comparison…
    expect(verdict.baselineHasSkipBlock).toBe(false);
    expect(verdict.skipRises).toEqual([]);
    expect(verdict.skipFalls).toEqual([]);
    expect(verdict.missingSuites).toEqual([]);

    // …but it does NOT pass quietly. Driven through the script's own formatter,
    // never asserted by eye.
    const warning = core.formatInactiveWarning('api');
    expect(warning).toContain('test-ratchet[api]');
    expect(warning).toContain('INACTIVE');
    expect(warning).toContain('--update');

    // …and the final verdict line is QUALIFIED, so the green is never unqualified.
    expect(core.INACTIVE_QUALIFIER).toContain('INACTIVE');
    expect(EXECUTABLE_SCRIPT).toContain('core.formatInactiveWarning(app)');
    expect(EXECUTABLE_SCRIPT).toMatch(
      /baselineHasSkipBlock \? 'no drift\.' : `no drift \(\$\{core\.INACTIVE_QUALIFIER\}\)\.`/,
    );
  });

  it('the logic really MOVED — the gate requires the core rather than duplicating it (AC-4)', () => {
    // If the reduction were copied instead of required, the fixtures above would
    // be exercising a second implementation and could pass while the gate stayed
    // broken. These two pins are what make every case above evidence about the
    // gate rather than about the spec.
    expect(EXECUTABLE_SCRIPT).toContain("require('./lib/ratchet-core')");
    expect(EXECUTABLE_SCRIPT).toContain('core.reduceReport(');
    expect(EXECUTABLE_SCRIPT).toContain('core.compareToBaseline(');
    // The reduction is no longer inline anywhere in the script.
    expect(EXECUTABLE_SCRIPT).not.toContain('assertionResults');
  });

  it('no new bypass surface came in with the testability (DNC-10, AC-12)', () => {
    // The module boundary is what makes these cases possible. An env var or a
    // `--report-file` flag would have given the same access AND a way to choose
    // what the gate compares — a bypass flag wearing a lab coat.
    for (const token of ['RATCHET_REPORT', 'REPORT_FILE', 'process.env', '--report', '--force']) {
      expect([token, EXECUTABLE_SCRIPT.includes(token)]).toEqual([token, false]);
    }
    // The core is pure: no IO, no process, no clock.
    const coreSource = executableJs(readFileSync(CORE_PATH, 'utf8'));
    for (const token of ['require(', 'process.', 'Date.now', 'readFileSync', 'console.']) {
      expect([token, coreSource.includes(token)]).toEqual([token, false]);
    }
  });

  it('--update writes the counts, and only ever from a complete run (AC-2)', () => {
    // The existing executed case above already proves `--update` + `--skip` exits
    // 2. What is added here is the SECOND reason, which is sharper than the first:
    // a partial run has no entry for the suites it did not run, so an --update
    // under --skip would write a `skipped` block with those suites DELETED — and
    // the gate would be permanently blind to exactly the suites the tiering skips,
    // which are the gate's own meta-tests.
    expect(EXECUTABLE_SCRIPT).toContain('--update and --skip are mutually exclusive.');
    expect(EXECUTABLE_SCRIPT).toContain('skipped counts of the suites it did ');
    expect(EXECUTABLE_SCRIPT).toContain('skipped: reduced.skipped');
  });

  it('the shipped baseline is honest about the half that is not yet armed', () => {
    // MEASURED STATE, recorded rather than papered over: `known-test-failures.json`
    // carries no `skipped` block, because it may only be written from a COMPLETE
    // run and the run that shipped TOOL-13 could not produce one (the full apps/api
    // suite takes ~350 s and is non-deterministic — TOOL-16(b)). Inventing numbers
    // would make the gate LOOK armed while comparing against fiction, so the
    // INACTIVE path above is the path this repository takes until an operator runs
    // --update. This case exists so that state is asserted, not assumed.
    const baseline = JSON.parse(
      readFileSync(join(REPO_ROOT, 'scripts', 'known-test-failures.json'), 'utf8'),
    ) as { $doc: string[]; apps: Record<string, BaselineApp> };
    expect(Object.keys(baseline.apps).sort()).toEqual(['api', 'worker']);
    for (const [app, baselineApp] of Object.entries(baseline.apps)) {
      const hasSkipBlock = baselineApp.skipped !== undefined;
      const verdict = core.compareToBaseline({
        reduced: reduce(SKIPPY),
        baselineApp,
        skip: null,
      });
      expect([app, verdict.baselineHasSkipBlock]).toEqual([app, hasSkipBlock]);
    }
    // The $doc says which half is armed and how to arm the other one.
    expect(baseline.$doc.join('\n')).toContain('skipped');
    expect(baseline.$doc.join('\n')).toContain('--update');
  });
});
