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
 * This is not "silencing failing tests" (S-E02-2 note 4 forbids that): every
 * tolerated failure is enumerated in `known-test-failures.json` with a reason and
 * a finding id, and the ratchet makes it impossible to add another one quietly.
 *
 * THE SECOND HALF: A TEST THAT STOPS EXISTING (TOOL-13)
 * ----------------------------------------------------
 * Everything above decides on a SET OF FAILURES. A test that stops executing is
 * not a failure, so it was not in the set, so this script reported `✓ no drift.`
 * about a check it had not performed — the one direction a merge gate may never
 * be wrong in. Measured here on 2026-08-12: `schema-drift-gate.spec.ts` turns its
 * whole end-to-end block into `describe.skip` when no PostgreSQL is reachable,
 * including the case whose job is to prove the drift gate is not red on correct
 * code, and `numFailedTests` was 0.
 *
 * So the baseline also records, per suite, HOW MANY tests did not execute:
 *
 *   • a skipped count that RISES              → the gate FAILS (a test stopped running)
 *   • a baselined suite ABSENT from the report → the gate FAILS (the suite stopped existing)
 *   • a skipped count that FALLS              → reported loudly, never failed (see
 *                                               `compareToBaseline`'s comment for
 *                                               why the two halves are asymmetric)
 *
 * The decision layer for both halves lives in `scripts/lib/ratchet-core.js` — pure,
 * importable, and therefore provable from a spec against hand-written jest reports.
 * This file keeps all of the IO: argv, the guards, `runJest()`, the baseline
 * read/write, every `console` call and every `process.exit`.
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

// The pure decision layer. It is a MODULE, deliberately not an env var or a
// hidden `--report-file` flag: a gate whose input can be chosen from the
// environment is a gate that can be bypassed (DNC-10). The guard spec exercises
// the exact code this file runs, so evidence and gate cannot drift apart.
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
// It protects the SKIPPED COUNTS more sharply still: a partial run has no entry
// at all for the suites it did not run, so an `--update` under `--skip` would
// write a `skipped` block with those suites DELETED — and the gate would then be
// permanently blind to exactly the suites the tiering skips, which are the gate's
// own meta-tests. There is no `--force`; a baseline is rebuilt from a complete
// run or not at all.
if (update && skip) {
  console.error('test-ratchet: --update and --skip are mutually exclusive.');
  console.error('  A baseline must be rebuilt from a complete run, or it drops what it did not see.');
  console.error(
    '  That now costs twice: the failures it did not see, AND the skipped counts of the suites it did ' +
      'not run — which would leave the skip ratchet blind to the gate\'s own meta-tests.',
  );
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

// The reduction — the failures, the per-suite not-executed counts, and the cause
// of every suite that failed to load — lives in `lib/ratchet-core.js`. `testKey`
// moved there verbatim (it gained an `appDir` parameter, since a pure module may
// not read this one from module scope).
const reduced = core.reduceReport({ report, appDir });
const failing = reduced.failing;

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
  // `skipped` is written from THIS run, and `--update` is refused under `--skip`
  // above, so it can only ever be written from a complete run.
  baseline.apps[app] = { failures, skipped: reduced.skipped };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `test-ratchet[${app}]: baseline updated — ${failing.length} known failure(s) and ` +
      `${Object.keys(reduced.skipped).length} suite(s) with not-executed tests recorded.`,
  );
  process.exit(0);
}

const {
  regressions,
  fixed,
  known,
  knownSkipped,
  skipRises,
  skipFalls,
  missingSuites,
  heldOutSkipCounts,
  baselineHasSkipBlock,
} = core.compareToBaseline({ reduced, baselineApp: baseline.apps[app], skip });

if (skip) {
  // Never silent: a run that covered less must say so, and say how much less.
  // Both numbers on one line, because they are two facets of the same hold-out:
  // the gate's own tiering chose not to run these paths, so nothing is known
  // about them in EITHER direction — which is a different event from a suite
  // that ran and skipped itself, and the two must never be conflated.
  console.log(
    `test-ratchet[${app}]: SKIPPED specs matching "${skip}" ` +
      `(${knownSkipped.length} baseline entr(ies) and ${heldOutSkipCounts} skip-count entr(ies) ` +
      `held out of the drift comparison).`
  );
}

if (!baselineHasSkipBlock) {
  // DNC-08: a run that could not perform half its check says so, unmissably, and
  // qualifies its verdict at the foot of this file. It does NOT fail — that would
  // leave the gate red with no way back except a complete run, which is not always
  // available — and it does NOT stay quiet, which is the defect itself.
  console.log(core.formatInactiveWarning(app));
}

const total = report.numTotalTests || 0;
const passed = report.numPassedTests || 0;
console.log(
  `test-ratchet[${app}]: ${passed}/${total} passed · ${failing.length} failing · ${known.length} known-failing (baseline)`
);

// TOOL-16(a): the report explains WHY a suite could not load, and that explanation
// used to be discarded — an operator read a symptom with no cause. Printed for
// EVERY load-failed suite, baselined or not: a tolerated load failure whose cause
// changed is still something the operator must be able to see.
if (reduced.loadFailures.length) {
  console.error(`\n✗ ${reduced.loadFailures.length} suite(s) failed to LOAD — jest's own explanation:\n`);
  for (const { key, cause } of reduced.loadFailures) {
    console.error(`    ${key}`);
    const body = cause || '(jest reported no message for this suite)';
    for (const line of body.split('\n')) console.error(`      ${line}`);
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

if (skipRises.length) {
  console.error(`\n✗ ${skipRises.length} suite(s) record MORE not-executed tests than the baseline:\n`);
  for (const r of skipRises) {
    console.error(`    ${r.key}   ${r.from} → ${r.to}   (+${r.to - r.from})${r.newSuite ? '   [no baseline entry — a rise from 0]' : ''}`);
  }
  console.error(
    '\n  A test that stopped running is a red like any other: it is not in the failure list precisely\n' +
      '  because it produced no result. Un-skip it, or fix what made it skip itself. A suite arriving\n' +
      '  fully skipped with no baseline entry is a rise from 0 for the same reason — escape by omission\n' +
      '  is still escape.'
  );
}

if (missingSuites.length) {
  console.error(`\n✗ ${missingSuites.length} baselined suite(s) are ABSENT from this report:\n`);
  for (const m of missingSuites) console.error(`    ${m.key}   (baseline recorded ${m.from} not-executed)`);
  console.error(
    '\n  The suite stopped existing — its file no longer matched, or it was renamed or deleted. That is at\n' +
      '  least as suspicious as a count that rose, so it gets the same verdict. If the rename or the deletion\n' +
      '  was deliberate, run --update from a COMPLETE run.'
  );
}

if (skipFalls.length) {
  // Reported, never failed — and the asymmetry with the failure list is deliberate.
  // See `compareToBaseline`'s comment: a failure key is an identity, a skipped count
  // is a measurement over a suite whose membership moves for legitimate reasons.
  // Failing on a fall would red the gate on the author who un-skipped a test, and
  // the gate would be routed around within a week.
  console.log(
    `\n▲ ${skipFalls.length} suite(s) record FEWER skipped tests than the baseline — good news if you ` +
      'un-skipped them,\n  and a DISAPPEARANCE if you did not. Check before you run --update:'
  );
  for (const f of skipFalls) console.log(`    ${f.key}   ${f.from} → ${f.to}   (-${f.from - f.to})`);
}

if (regressions.length || fixed.length || skipRises.length || missingSuites.length) process.exit(1);

if (failing.length) {
  console.log(`\n  ${failing.length} known failure(s) tolerated. Each is tracked:`);
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

// The green is never unqualified when half the check could not run (AC-9). The
// unqualified sentence is kept verbatim for the case where it is TRUE.
const verdict = baselineHasSkipBlock ? 'no drift.' : `no drift (${core.INACTIVE_QUALIFIER}).`;
console.log(`\n✓ test-ratchet[${app}]: ${verdict}`);
