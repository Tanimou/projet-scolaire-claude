'use strict';
/**
 * ratchet-core — the PURE decision layer of `scripts/test-ratchet.js` (TOOL-13).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * A merge gate is allowed to be wrong in one direction only: it may cry wolf. It
 * may never report green about a check it did not perform. The ratchet used to do
 * exactly that: it decided on a SET OF FAILURES, and a test that stops executing
 * is not a failure, so it was not in the set, so the verdict was `✓ no drift.`
 *
 * `apps/api/src/shared/quality/schema-drift-gate.spec.ts:1215` reads
 * `const describeWithDb = reachable ? describe : describe.skip;` — on a machine
 * with no reachable PostgreSQL the whole end-to-end block becomes `describe.skip`,
 * including the one case whose entire job is to prove the drift gate is not red on
 * correct code. Measured 2026-08-12: 124 total, 119 passed, 0 failed, 5 pending.
 * `numFailedTests` is 0, so the ratchet said `✓ no drift.` about five checks that
 * had not run.
 *
 * The decision layer lives here, separately from the script, for ONE reason: the
 * evidence must be fixture-driven. `test-ratchet.js` reads `process.argv`, can
 * `process.exit(2)`, and calls `runJest()` at module scope, so a spec cannot
 * `require()` it without killing the jest worker or starting a second full jest
 * run inside the first. A spec CAN require this file, feed it a hand-written jest
 * report, and assert on the verdict — exercising the exact code the gate runs.
 *
 * ⛔ THE FORBIDDEN ALTERNATIVE, NAMED SO NOBODY REACHES FOR IT
 * -----------------------------------------------------------
 * Do NOT add an env var or hidden flag (`RATCHET_REPORT_FILE`, `RATCHET_INPUT`,
 * anything of that shape) letting the script read a report from disk instead of
 * running jest. A gate whose input can be chosen from the environment is a gate
 * that can be bypassed — a bypass flag wearing a lab coat (`DNC-10`). The module
 * boundary gives a spec the same access with none of the attack surface.
 *
 * PURITY CONTRACT
 * ---------------
 * No I/O, no `process`, no clock, no environment, no `console`. Every one of those
 * stays in `test-ratchet.js`. Same discipline `schema-drift-check.js` applies to
 * its own verdict layer.
 */

/**
 * The jest assertion statuses that mean THE TEST DID NOT RUN.
 *
 * Measured against jest 29.7.0 on 2026-08-12 (fixture report, this repository):
 * `describe.skip` and `it.skip` both surface as 'pending'; `it.todo` as 'todo'.
 * 'skipped' and 'disabled' are jest statuses that fixture did not produce but that
 * the type union declares, and they mean the same thing, so they are here.
 *
 * Counting only 'skipped' would count ZERO — which is how this defect would ship
 * again. A future jest that renames a status makes this a VISIBLE edit rather than
 * a silent drift back to green.
 */
const NOT_EXECUTED_STATUSES = new Set(['pending', 'todo', 'skipped', 'disabled']);

/**
 * Byte-identical to what the script has always synthesised. It is a BASELINE KEY:
 * changing it invalidates every existing baseline entry that uses it.
 */
const LOAD_FAILURE_SENTINEL = '<suite failed to load>';

/**
 * How much of a load failure's cause is printed. jest's own block is a heading, a
 * blank line, the reason, then a code frame — 12 lines is ample, and a message
 * that silently cuts is a message an operator cannot trust, so a truncated cause
 * says so on its last line.
 */
const LOAD_FAILURE_CAUSE_LINES = 12;

/**
 * CSI escape sequences: ESC `[` … final byte. jest's `message` carries them
 * (measured 2026-08-12), and a gate log must not gain control characters.
 *
 * Anchored on the ESC itself, deliberately: a pattern without it would also eat
 * legitimate text — jest's own code frames are full of brackets — and a stripper
 * that mangles the cause is worse than one that leaves a colour code in.
 */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001B\[[0-9;]*[A-Za-z]/g;

function stripAnsi(value) {
  return String(value == null ? '' : value).replace(ANSI_PATTERN, '');
}

/**
 * Stable identity for a SUITE: its path relative to the app, forward slashes, so a
 * Windows run and a Linux CI run produce the same key. This is the one
 * normalisation — `testKey` builds on it rather than repeating it.
 */
function suiteKey(specPath, appDir) {
  const dir = String(appDir || '').replace(/\\/g, '/');
  return String(specPath || '')
    .replace(/\\/g, '/')
    .replace(`${dir}/`, '');
}

/**
 * Stable identity for a TEST: "<spec path relative to the app>::<full test name>".
 * Moved verbatim from `test-ratchet.js:185-188`; the keys it produces are baseline
 * keys and must not change.
 */
function testKey(specPath, fullName, appDir) {
  return `${suiteKey(specPath, appDir)}::${fullName}`;
}

/**
 * The cause of a suite-level load failure, ready to print.
 *
 * jest 29.7.0's `--json` report puts it in `message`. `failureMessage` — the name
 * the finding was written against — DOES NOT EXIST in that output: it is the field
 * name on jest's internal `TestResult`, which `formatTestResults` renames to
 * `message` on the way out. Reading `failureMessage` would yield `undefined` on
 * every suite and TOOL-16(a) would ship as a no-op that prints nothing. `message`
 * is the one this jest populates; the fallback is a belt, not the strap.
 */
function loadFailureCause(suite) {
  const raw = (suite && (suite.message || suite.failureMessage)) || '';
  const lines = stripAnsi(raw).replace(/\r\n/g, '\n').split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length <= LOAD_FAILURE_CAUSE_LINES) return lines.join('\n');
  return [
    ...lines.slice(0, LOAD_FAILURE_CAUSE_LINES),
    `… (truncated; ${LOAD_FAILURE_CAUSE_LINES} of ${lines.length} lines)`,
  ].join('\n');
}

/**
 * Reduce one jest JSON report to the four things the gate decides on.
 *
 *   failing      string[]                  — unchanged semantics: every failed
 *                                            assertion, plus the load sentinel.
 *   skipped      Record<suiteKey, number>  — per suite, assertions that DID NOT
 *                                            RUN. Non-zero entries only (§3.5(d)).
 *   loadFailures Array<{ key, cause }>     — one per suite that failed to load.
 *   suites       string[]                  — every suite key present, so the
 *                                            comparison can tell "count fell" from
 *                                            "suite absent" (the two shapes of
 *                                            disappearance are different bugs).
 *
 * A load-failed suite contributes to `failing` and must NOT contribute to
 * `skipped`: measured, it reports `assertionResults: []`, so the filter below
 * yields 0 on its own with no special case. That 0 is ASSERTED by the spec rather
 * than assumed here — a future jest emitting a synthetic pending assertion for an
 * unloadable file would otherwise double-count it silently, and the assertion is
 * what would notice.
 */
function reduceReport({ report, appDir }) {
  const failing = [];
  const seenFailing = new Set();
  const skipped = {};
  const loadFailures = [];
  const suites = [];

  const addFailing = (key) => {
    if (seenFailing.has(key)) return;
    seenFailing.add(key);
    failing.push(key);
  };

  for (const suite of (report && report.testResults) || []) {
    const key = suiteKey(suite.name, appDir);
    suites.push(key);
    const assertions = suite.assertionResults || [];

    for (const t of assertions) {
      if (t.status === 'failed') addFailing(testKey(suite.name, t.fullName, appDir));
    }

    const notExecuted = assertions.filter((t) => NOT_EXECUTED_STATUSES.has(t.status)).length;
    if (notExecuted > 0) skipped[key] = notExecuted;

    // A suite that fails to even load reports no assertions — that must not slip
    // through as "zero failures". Unchanged behaviour; the cause is new (TOOL-16a).
    if (assertions.length === 0 && suite.status === 'failed') {
      addFailing(testKey(suite.name, LOAD_FAILURE_SENTINEL, appDir));
      loadFailures.push({ key, cause: loadFailureCause(suite) });
    }
  }

  return { failing, skipped, loadFailures, suites };
}

/**
 * Compare a reduced report against one app's baseline block.
 *
 * THE ASYMMETRY, AND WHY IT IS NOT AN INCONSISTENCY
 * -------------------------------------------------
 * A baseline FAILURE that now passes fails the gate (the list may only shrink); a
 * baseline SKIP COUNT that falls does not. It looks inconsistent until you see
 * what each one is:
 *
 *   • a failure key is an IDENTITY — it names one test, and if that test passes
 *     the entry is simply stale and must be removed;
 *   • a skip count is a MEASUREMENT over a suite whose membership changes for
 *     unrelated legitimate reasons: the suite gains three passing tests, someone
 *     deletes an `it.todo`, a `describe.skip` is un-skipped.
 *
 * Failing on a fall would red the gate on the author who did the right thing, and
 * the gate would be routed around within a week. Failing on a RISE is the whole
 * finding: fewer tests executed than the baseline records.
 *
 * THE HONEST LIMIT, STATED RATHER THAN LEFT TO BE DISCOVERED
 * ----------------------------------------------------------
 * A suite that loses skipped tests by having them DELETED is reported, not failed
 * — the fall report says so in the operator's words. And because only non-zero
 * counts are recorded (§3.5(d)), a suite with ZERO recorded skips that vanishes
 * entirely is NOT caught by this comparison. Catching that needs a full suite
 * inventory (the shape of `scripts/web-route-baseline.json`), which is a bigger
 * change than this finding; it is recorded as a follow-on, not left unconsidered.
 */
function compareToBaseline({ reduced, baselineApp, skip }) {
  const app = baselineApp || {};
  const failures = app.failures || {};
  const allKnown = Object.keys(failures);
  const matchesSkip = (key) => Boolean(skip) && key.includes(skip);

  // Baseline entries under a skipped path did not run, so they can be neither a
  // regression nor a fix. Excluding them is what makes --skip safe.
  const knownSkipped = skip ? allKnown.filter(matchesSkip) : [];
  const known = new Set(skip ? allKnown.filter((k) => !matchesSkip(k)) : allKnown);

  const failingSet = new Set(reduced.failing);
  const regressions = [...failingSet].filter((k) => !known.has(k)).sort();
  const fixed = [...known].filter((k) => !failingSet.has(k)).sort();

  // An old baseline has no `skipped` block. That must degrade LOUDLY (the caller
  // prints the INACTIVE line and qualifies its verdict), never silently: comparing
  // against an absent block would read every suite as "rose from 0" and red the
  // gate with no way back, and defaulting to "nothing to compare" would be the
  // very silence this story removes.
  const baselineHasSkipBlock = Boolean(app.skipped) && typeof app.skipped === 'object';
  const baselineSkips = baselineHasSkipBlock ? app.skipped : {};

  const skipRises = [];
  const skipFalls = [];
  const missingSuites = [];
  let heldOutSkipEntries = 0;

  if (baselineHasSkipBlock) {
    const present = new Set(reduced.suites);
    const keys = new Set([...Object.keys(baselineSkips), ...Object.keys(reduced.skipped)]);
    for (const key of [...keys].sort()) {
      // The gate's own tiering skipped this path: nothing is known about it, in
      // either direction. Held out — and counted, so the run can say how much less
      // it covered. Without this, every suite under `--skip` would look like a
      // vanished suite and a `--skip` run would fail the gate every single time.
      if (matchesSkip(key)) {
        heldOutSkipEntries += 1;
        continue;
      }
      const from = Number(baselineSkips[key] || 0);
      const to = Object.prototype.hasOwnProperty.call(reduced.skipped, key)
        ? Number(reduced.skipped[key])
        : 0;
      // The second shape of disappearance: the suite stopped existing. At least as
      // suspicious as a count that rose, so it gets the same verdict.
      if (!present.has(key) && from > 0) {
        missingSuites.push({ suite: key, from });
        continue;
      }
      // A suite in the report with skips and no baseline entry is a rise from 0 —
      // otherwise a new suite could arrive fully skipped and be green forever.
      if (to > from) skipRises.push({ suite: key, from, to });
      else if (to < from) skipFalls.push({ suite: key, from, to });
    }
  }

  return {
    regressions,
    fixed,
    knownSkipped,
    heldOutSkipEntries,
    skipRises,
    skipFalls,
    missingSuites,
    baselineHasSkipBlock,
  };
}

module.exports = {
  NOT_EXECUTED_STATUSES,
  LOAD_FAILURE_SENTINEL,
  LOAD_FAILURE_CAUSE_LINES,
  stripAnsi,
  suiteKey,
  testKey,
  loadFailureCause,
  reduceReport,
  compareToBaseline,
};
