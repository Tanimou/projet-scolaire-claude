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
if (update && skip) {
  console.error('test-ratchet: --update and --skip are mutually exclusive.');
  console.error('  A baseline must be rebuilt from a complete run, or it drops what it did not see.');
  process.exit(2);
}

const appDir = join(REPO_ROOT, 'apps', app);
if (!existsSync(appDir)) {
  console.error(`test-ratchet: no such app directory: ${appDir}`);
  process.exit(2);
}

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

  const res = spawnSync(process.execPath, jestArgs, {
    cwd: appDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!existsSync(outFile)) {
    console.error(`test-ratchet: jest produced no report for ${app}. It probably failed to start.`);
    console.error(res.stderr || res.stdout || '(no output)');
    rmSync(scratch, { recursive: true, force: true });
    process.exit(2);
  }

  const report = JSON.parse(readFileSync(outFile, 'utf8'));
  rmSync(scratch, { recursive: true, force: true });
  return report;
}

/**
 * Stable identity for a test: "<spec path relative to the app>::<full test name>".
 * Path is normalised to forward slashes so a Windows run and a Linux CI run
 * produce the same key.
 */
function testKey(specPath, fullName) {
  const rel = specPath.replace(/\\/g, '/').replace(`${appDir.replace(/\\/g, '/')}/`, '');
  return `${rel}::${fullName}`;
}

const report = runJest();

const failing = new Set();
for (const suite of report.testResults || []) {
  for (const t of suite.assertionResults || []) {
    if (t.status === 'failed') failing.add(testKey(suite.name, t.fullName));
  }
  // A suite that fails to even load reports no assertions — that must not slip
  // through as "zero failures".
  if ((suite.assertionResults || []).length === 0 && suite.status === 'failed') {
    failing.add(testKey(suite.name, '<suite failed to load>'));
  }
}

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
  baseline.apps[app] = { failures };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`test-ratchet[${app}]: baseline updated — ${failing.size} known failure(s) recorded.`);
  process.exit(0);
}

const allKnown = Object.keys((baseline.apps[app] && baseline.apps[app].failures) || {});
// Baseline entries under a skipped path did not run, so they can be neither a
// regression nor a fix. Excluding them is what makes --skip safe.
const knownSkipped = skip ? allKnown.filter((k) => k.includes(skip)) : [];
const known = new Set(skip ? allKnown.filter((k) => !k.includes(skip)) : allKnown);

if (skip) {
  // Never silent: a run that covered less must say so, and say how much less.
  console.log(
    `test-ratchet[${app}]: SKIPPED specs matching "${skip}" ` +
      `(${knownSkipped.length} baseline entr(ies) held out of the drift comparison).`
  );
}

const regressions = [...failing].filter((k) => !known.has(k)).sort();
const fixed = [...known].filter((k) => !failing.has(k)).sort();

const total = report.numTotalTests || 0;
const passed = report.numPassedTests || 0;
console.log(
  `test-ratchet[${app}]: ${passed}/${total} passed · ${failing.size} failing · ${known.size} known-failing (baseline)`
);

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

if (regressions.length || fixed.length) process.exit(1);

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

console.log(`\n✓ test-ratchet[${app}]: no drift.`);
