#!/usr/bin/env node
/**
 * Test ratchet — the executable half of the S-E02-2 merge gate (PF-55 / VAL-01).
 *
 * WHY THIS EXISTS
 * ---------------
 * The audit found ~50 spec files that had never been executed, so "a spec file
 * exists" was being read as "that behaviour passes". When the suites were finally
 * run (2026-08-02) 20 tests were red on `main`, one of which — the GradesModule
 * wiring guard — had been failing for seven weeks while the entire teacher
 * grading REST surface was unmounted in production.
 *
 * A plain `jest` call cannot gate merges while those 20 are red, and deleting or
 * skipping them would destroy exactly the signal that caught the outage. So the
 * gate is a RATCHET instead of a pass/fail:
 *
 *   • a failure that is NOT in the baseline  → the gate FAILS (you broke something)
 *   • a baseline entry that now PASSES       → the gate FAILS (remove it; the list
 *                                              may only ever shrink)
 *   • a baseline entry that still fails      → reported, tolerated, and carries a
 *                                              finding id so it is tracked, not lost
 *
 * A SET OF FAILURES IS NOT ENOUGH (TOOL-13)
 * -----------------------------------------
 * The ratchet used to decide on that set alone — and a test that STOPS EXECUTING
 * is not a failure, so it was not in the set, so the verdict was `✓ no drift.`
 * Measured on 2026-08-12: `schema-drift-gate.spec.ts` reported 5 pending and 0
 * failed, including the one case whose whole job is to prove the drift gate is not
 * red on correct code — and this script said green about all five.
 *
 * So the baseline now carries a second half: a per-suite count of tests that DID
 * NOT RUN. A rise fails the gate exactly the way a new failure does; a fall is
 * reported, never failed (see `scripts/lib/ratchet-core.js` for why that asymmetry
 * is not an inconsistency). The decision layer lives in that module so a spec can
 * feed it hand-written jest reports and prove the verdict — this file keeps ALL
 * the I/O: argv, the guards, `runJest()`, the baseline read/write, every `console`
 * call and every `process.exit`.
 *
 * This is not "silencing failing tests" (S-E02-2 note 4 forbids that): every
 * tolerated failure is enumerated in `known-test-failures.json` with a reason and
 * a finding id, and the ratchet makes it impossible to add another one quietly.
 *
 * USAGE
 *   node scripts/test-ratchet.js <app>              # gate (exit 1 on drift)
 *   node scripts/test-ratchet.js <app> --update     # rewrite this app's baseline
 *
 * `<app>` is a workspace directory under apps/ (api | worker).
 */
'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

// The PURE decision layer. Required — never inlined, never duplicated — so that
// `test-ratchet.spec.ts` exercises the EXACT code this gate runs on hand-written
// jest reports, and the evidence cannot drift away from the gate.
const core = require('./lib/ratchet-core');

const REPO_ROOT = resolve(__dirname, '..');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'known-test-failures.json');

const app = process.argv[2];
const update = process.argv.includes('--update');

// --skip <pattern>: do not run specs whose path matches, AND drop the matching
// baseline entries from the drift comparison.
//
// The second half is the part that matters. `fixed` is computed as "known
// failures that did not fail this run", so skipping a spec would make every
// baselined failure inside it look newly fixed, and the ratchet would fail the
// gate with "baseline entries now PASS". A test that did not run is not
// evidence in either direction, and this keeps it out of both sets.
//
// Used by ci-gate.sh for `src/shared/quality/`: 20 of the api app's 71 specs are
// meta-tests asserting on scripts/, ci-gate.sh and ci.yml, and they are by far
// the slowest (180s, 122s, 93s…). A diff touching none of those files cannot
// change their outcome. When the diff DOES touch gate machinery they all run —
// the only case in which they can tell you anything.
const skipIdx = process.argv.indexOf('--skip');
const skip = skipIdx !== -1 ? process.argv[skipIdx + 1] : null;

if (!app || (skipIdx !== -1 && !skip)) {
  console.error('usage: node scripts/test-ratchet.js <app> [--update] [--skip <path-pattern>]');
  process.exit(2);
}

// --update rewrites the baseline from the run's failures. Combined with --skip
// it would rewrite it from a PARTIAL run and silently delete every baselined
// failure under the skipped path — losing the findings they carry.
//
// The rule now protects the SKIPPED COUNTS too, and more sharply: a partial run
// has no entry at all for the skipped suites, so an --update under --skip would
// write a `skipped` block with those suites DELETED — and the gate would then be
// permanently blind to exactly the suites the tiering skips, which are the gate's
// own meta-tests. No --force. DNC-10.
if (update && skip) {
  console.error('test-ratchet: --update and --skip are mutually exclusive.');
  console.error('  A baseline must be rebuilt from a complete run, or it drops what it did not see.');
  console.error('  That now applies twice over: the skipped-test counts of the unrun suites would be');
  console.error('  written as absent, silently disarming the half of the gate that notices tests that');
  console.error('  stopped running.');
  process.exit(2);
}

const appDir = join(REPO_ROOT, 'apps', app);
if (!existsSync(appDir)) {
  console.error(`test-ratchet: no such app directory: ${appDir}`);
  process.exit(2);
}

/**
 * Above this, "it probably failed to start" is not a claim this script is
 * entitled to make (TOOL-10).
 *
 * A jest that cannot start fails in seconds — a missing module, a broken config,
 * a transform error. A jest that ran for minutes and produced no report was
 * TERMINATED. On Windows an external kill (the CI job's own limit, a `timeout`
 * wrapper, the OOM killer) frequently surfaces as a plain non-zero exit code with
 * `signal === null`, so a branch written on `res.signal` alone would fall through
 * to the startup-fault sentence and re-commit the misdirection this bound exists
 * to remove. 30 s is far above any observed startup failure and far below the
 * 2400 s stage bound.
 */
const STARTUP_FAULT_CEILING_MS = 30000;

/** Run jest and return its structured result, independent of the process exit code. */
function runJest() {
  const scratch = mkdtempSync(join(tmpdir(), 'ratchet-'));
  const outFile = join(scratch, 'jest.json');
  // `--ci` disables snapshot writing; `--silent` keeps Nest's logger off stdout so
  // the JSON report is the only thing we have to parse (it goes to a file anyway,
  // but a quiet run makes CI logs readable).
  // Resolve jest's own CLI entrypoint and run it with the current node binary.
  // Spawning `npx`/`jest.cmd` instead would need `shell: true` on Windows (Node
  // refuses to exec `.cmd` without a shell), which drags in quoting bugs for no
  // benefit — we already know exactly which jest we want.
  let jestBin;
  try {
    jestBin = require.resolve('jest/bin/jest', { paths: [appDir, REPO_ROOT] });
  } catch {
    console.error(`test-ratchet: jest is not installed for ${app}. Run \`pnpm install\` first.`);
    rmSync(scratch, { recursive: true, force: true });
    process.exit(2);
  }

  const jestArgs = [jestBin, '--ci', '--silent', '--json', `--outputFile=${outFile}`];
  if (skip) jestArgs.push(`--testPathIgnorePatterns=${skip}`, '--testPathIgnorePatterns=/node_modules/');

  const startedAt = Date.now();
  const res = spawnSync(process.execPath, jestArgs, {
    cwd: appDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const elapsedMs = Date.now() - startedAt;

  if (!existsSync(outFile)) {
    // "It probably failed to start." was printed here unconditionally, and on
    // 2026-08-12 it was printed about a jest that had been KILLED at the stage
    // bound (worker exitCode 143 = SIGTERM). That sentence sent the next
    // investigator to look for a startup fault that did not exist, and the
    // "fix" it produced was raising the bound (2bd1a25). So the branch now reads
    // what actually happened and says which it was.
    //
    // The raw triple is printed in EVERY branch: a claim about why a child
    // vanished must show the evidence it was made from.
    const seen = `status=${res.status} signal=${res.signal || 'none'} spawnError=${
      res.error ? res.error.code || res.error.message : 'none'
    }`;
    if (res.error) {
      // Checked FIRST, and deliberately: spawnSync's own `timeout` sets
      // `error.code === 'ETIMEDOUT'` AND `signal === 'SIGTERM'` AND
      // `status === null` all at once (measured), so the signal branch below
      // would otherwise swallow it. This branch therefore carries the same
      // "did NOT fail to start" clause.
      console.error(
        `test-ratchet: jest produced no report for ${app} after ${elapsedMs} ms — the child process ` +
          `itself faulted: ${res.error.code || res.error.message} (${seen}). It did NOT fail to start ` +
          `for lack of an install; node could not run it to completion.`,
      );
    } else if (res.signal || res.status === null) {
      console.error(
        `test-ratchet: jest produced no report for ${app} after ${elapsedMs} ms — it was TERMINATED by ` +
          `${res.signal || 'an external kill'} (${seen}). It did NOT fail to start: it was running when ` +
          `something stopped it, so look for the bound that expired (a CI job limit, a stage timeout, the ` +
          `OOM killer), not for a broken install.`,
      );
    } else if (elapsedMs >= STARTUP_FAULT_CEILING_MS) {
      console.error(
        `test-ratchet: jest produced no report for ${app} after ${elapsedMs} ms and exited ${res.status} ` +
          `(${seen}). That is far longer than any startup fault takes, so it ran and was then stopped — it ` +
          `did NOT fail to start. Look for the bound that expired.`,
      );
    } else {
      console.error(`test-ratchet: jest produced no report for ${app}. It probably failed to start.`);
      console.error(`  (${seen}, after ${elapsedMs} ms)`);
    }
    console.error(res.stderr || res.stdout || '(no output)');
    rmSync(scratch, { recursive: true, force: true });
    process.exit(2);
  }

  const report = JSON.parse(readFileSync(outFile, 'utf8'));
  rmSync(scratch, { recursive: true, force: true });
  return report;
}

const report = runJest();

// The reduction and the comparison are the ratchet's DECISION, and they live in
// `scripts/lib/ratchet-core.js` — pure, and therefore provable against fixture
// reports. Key identity (`testKey`) moved with them: it is a baseline key, so it
// has exactly one definition.
const reduced = core.reduceReport({ report, appDir });
const failing = new Set(reduced.failing);

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { $schema: 'known-test-failures', apps: {} };
baseline.apps = baseline.apps || {};

if (update) {
  const previous = (baseline.apps[app] && baseline.apps[app].failures) || {};
  const failures = {};
  for (const key of [...failing].sort()) {
    failures[key] = previous[key] || { finding: 'UNTRIAGED', reason: 'TODO: triage and assign a finding id' };
  }
  // Only NON-ZERO counts are recorded, so the baseline stays small and every line
  // in it means something. The cost is real and is written down at
  // `ratchet-core.js`'s `compareToBaseline`: a suite with zero recorded skips that
  // vanishes entirely is NOT caught by this half.
  //
  // Reached only from a COMPLETE run — the --skip guard at the top of this file is
  // what makes that true, and it is the reason this write can be trusted.
  const skipped = {};
  for (const key of Object.keys(reduced.skipped).sort()) skipped[key] = reduced.skipped[key];
  baseline.apps[app] = { failures, skipped };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `test-ratchet[${app}]: baseline updated — ${failing.size} known failure(s) recorded, ` +
      `and ${Object.keys(skipped).length} suite(s) with tests that did not run.`
  );
  process.exit(0);
}

const verdict = core.compareToBaseline({
  reduced,
  baselineApp: baseline.apps[app],
  skip,
});
const { regressions, fixed, knownSkipped, skipRises, skipFalls, missingSuites } = verdict;
const known = new Set(
  Object.keys((baseline.apps[app] && baseline.apps[app].failures) || {}).filter(
    (k) => !(skip && k.includes(skip))
  )
);

if (skip) {
  // Never silent: a run that covered less must say so, and say how much less —
  // now in both currencies, because a held-out COUNT is as much unmeasured ground
  // as a held-out failure. This is the gate's own tiering choosing not to run a
  // path; it is NOT a suite that skipped itself, and the two must never be
  // conflated: the second is counted, compared and failed on a rise.
  console.log(
    `test-ratchet[${app}]: SKIPPED specs matching "${skip}" ` +
      `(${knownSkipped.length} baseline entr(ies) and ${verdict.heldOutSkipEntries} skip-count ` +
      `entr(ies) held out of the drift comparison).`
  );
}

const total = report.numTotalTests || 0;
const passed = report.numPassedTests || 0;
const notExecuted = Object.values(reduced.skipped).reduce((a, b) => a + b, 0);
console.log(
  `test-ratchet[${app}]: ${passed}/${total} passed · ${failing.size} failing · ${notExecuted} not executed · ` +
    `${known.size} known-failing (baseline)`
);

// TOOL-16(a): a suite that failed to load is reported with its CAUSE, for every
// such suite — baselined or not, because a tolerated load failure whose cause
// changed is still something the operator must be able to see. Previously the
// script synthesised the sentinel and discarded the report's explanation, so an
// operator read a symptom with no cause.
if (reduced.loadFailures.length) {
  console.error(`\n✗ ${reduced.loadFailures.length} suite(s) FAILED TO LOAD — none of their tests ran:\n`);
  for (const lf of reduced.loadFailures) {
    console.error(`    ${lf.key}`);
    for (const line of (lf.cause || '(jest reported no cause)').split('\n')) {
      console.error(`      ${line}`);
    }
  }
}

if (regressions.length) {
  console.error(`\n✗ ${regressions.length} NEW test failure(s) — not in the baseline:\n`);
  for (const k of regressions) console.error(`    ${k}`);
  console.error('\n  Fix the change that broke them. Adding them to the baseline is not a fix.');
}

if (fixed.length) {
  console.error(`\n✗ ${fixed.length} baseline entr(ies) now PASS — the ratchet only turns one way:\n`);
  for (const k of fixed) console.error(`    ${k}`);
  console.error(
    `\n  Remove them from ${'scripts/known-test-failures.json'} (or run --update) and close the finding they carry.`
  );
}

// A RISE is the whole finding: fewer tests executed than the baseline records.
// It fails exactly the way a new failure does.
if (skipRises.length) {
  console.error(`\n✗ ${skipRises.length} suite(s) record MORE tests that DID NOT RUN than the baseline:\n`);
  for (const r of skipRises) console.error(`    ${r.suite}   ${r.from} → ${r.to}   (+${r.to - r.from})`);
  console.error(
    '\n  A test that stopped executing is not a failure, so nothing else here would have noticed it.' +
      '\n  Find why it stopped (a `describe.skip` on an absent dependency is the usual cause) — do not run --update.'
  );
}

// The third case, and the one that catches the OTHER shape of disappearance: the
// suite stopped existing. At least as suspicious as a count that rose.
if (missingSuites.length) {
  console.error(
    `\n✗ ${missingSuites.length} suite(s) recorded in the baseline are ABSENT from this run:\n`
  );
  for (const m of missingSuites) console.error(`    ${m.suite}   (baseline recorded ${m.from} not executed)`);
  console.error(
    '\n  The suite was renamed, deleted, or no longer matched jest\'s test paths. If that was deliberate,' +
      '\n  run --update from a COMPLETE run — the same escape hatch a fixed baseline entry uses.'
  );
}

// A FALL is good news — more tests executed — and failing on it would red the gate
// on the very change that improved it. Reported loudly all the same, because a
// fall is ALSO what a deleted test looks like from inside a suite.
if (skipFalls.length) {
  console.log(
    `\n▲ ${skipFalls.length} suite(s) record FEWER skipped tests than the baseline — good news if you` +
      '\n  un-skipped them, and a DISAPPEARANCE if you did not. Check before you run --update:\n'
  );
  for (const f of skipFalls) console.log(`    ${f.suite}   ${f.from} → ${f.to}   (${f.to - f.from})`);
}

// A run that could not perform half its check SAYS SO — it never implies it did
// (DNC-08). An old baseline with no `skipped` block does not crash and does not
// fail the gate (that would leave it red with no way back except a complete run,
// which is not always available), but the green it prints is never unqualified.
//
// This sits UPSTREAM of the single exit deliberately. Emitted after it, the
// notice would be unreachable on precisely the runs that need it most: a run
// already red for an unrelated regression would never disclose that the skip
// half did not run at all. "Could not check" is not a property of a green run —
// it is a property of THE run, so it is disclosed before the verdict branches.
if (!verdict.baselineHasSkipBlock) {
  console.log(
    `\n⚠ test-ratchet[${app}]: this baseline records no skipped counts. The skip ratchet is INACTIVE ` +
      'for this app; run --update from a COMPLETE run.'
  );
}

if (regressions.length || fixed.length || skipRises.length || missingSuites.length) process.exit(1);

if (failing.size) {
  console.log(`\n  ${failing.size} known failure(s) tolerated. Each is tracked:`);
  const entries = baseline.apps[app].failures;
  const byFinding = new Map();
  for (const k of [...failing].sort()) {
    const f = entries[k].finding || 'UNTRIAGED';
    byFinding.set(f, (byFinding.get(f) || 0) + 1);
  }
  for (const [finding, count] of [...byFinding].sort()) {
    console.log(`    ${finding}: ${count} test(s)`);
  }
}

const verdictLine = verdict.baselineHasSkipBlock
  ? 'no drift.'
  : 'no drift (skipped-count ratchet INACTIVE — baseline has no "skipped" block).';
console.log(`\n✓ test-ratchet[${app}]: ${verdictLine}`);
