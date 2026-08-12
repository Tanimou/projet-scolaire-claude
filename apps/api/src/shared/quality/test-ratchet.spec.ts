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
