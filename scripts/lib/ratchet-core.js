'use strict';

/**
 * The pure decision layer of the test ratchet (TOOL-13 / TOOL-16(a)).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `scripts/test-ratchet.js` cannot be `require()`d from a spec: it reads
 * `process.argv[2]`, can `process.exit(2)` in its argument guard, and calls
 * `runJest()` at module scope — so importing it from a jest worker would either
 * terminate the worker or launch a second full jest run inside the first. That
 * left the ratchet's actual decision logic unprovable, and it is the logic that
 * decides whether every merge in this repository is green.
 *
 * So the decision layer lives here: **no IO, no `process`, no clock, no
 * environment** — the same discipline `schema-drift-check.js` applies to its own
 * verdict layer. `test-ratchet.js` keeps ALL of the IO (argv, the guards,
 * `runJest()`, the baseline read/write, every `console` call and every
 * `process.exit`) and `require()`s this module for the reduction and the
 * comparison. The guard spec then feeds hand-written jest reports to **the exact
 * code the gate runs**, so evidence and gate cannot drift apart.
 *
 * ⛔ WHAT THIS IS *NOT*, NAMED SO NOBODY REACHES FOR IT
 * -----------------------------------------------------
 * This module boundary is deliberately NOT an env var or hidden flag
 * (`RATCHET_REPORT_FILE` and friends) that would let a caller feed the gate a
 * report from disk instead of running jest. A gate whose input can be chosen from
 * the environment is a gate that can be bypassed — a bypass flag wearing a lab
 * coat (`DNC-10`). The module gives a spec the same access with none of the
 * attack surface.
 *
 * THE DEFECT THIS CLOSES
 * ----------------------
 * The ratchet decided on a **set of failures** and never looked at a count of
 * anything. A test that stops executing is not a failure, so it was not in the
 * set, so the ratchet reported `✓ no drift.` about a check it had not performed.
 * Measured in this repository on 2026-08-12: `schema-drift-gate.spec.ts` turns
 * its whole end-to-end block into `describe.skip` when no PostgreSQL is
 * reachable — including the case whose entire job is to prove the drift gate is
 * not red on correct code — and `numFailedTests` was 0. A merge gate may cry
 * wolf; it may never report green about a check it did not perform.
 */

/**
 * The jest assertion statuses that mean THE TEST DID NOT RUN.
 *
 * Measured against jest 29.7.0 on 2026-08-12 (fixture report, this repository):
 * `describe.skip` and `it.skip` both surface as 'pending'; `it.todo` as 'todo'.
 * 'skipped' and 'disabled' are jest statuses that fixture did not produce but
 * that the status union declares, and they mean the same thing, so they are here.
 *
 * Counting only 'skipped' would count ZERO — which is how this defect would ship
 * again. Keeping the set named and explicit makes a future jest that renames a
 * status a VISIBLE edit rather than a silent drift back to green.
 */
const NOT_EXECUTED_STATUSES = new Set(['pending', 'todo', 'skipped', 'disabled']);

/**
 * The synthetic key for a suite that failed to LOAD. Byte-identical to what the
 * ratchet has always written: it is a baseline key, and changing it would
 * invalidate every existing baseline entry that uses it.
 */
const LOAD_FAILURE_SENTINEL = '<suite failed to load>';

/**
 * How many lines of a load failure's cause are printed. jest's own block is a
 * heading, a blank line, the reason, then a code frame — 12 is ample, and a
 * message that is cut says so on its last line rather than trailing off.
 */
const LOAD_FAILURE_CAUSE_LINES = 12;

/** The qualifier appended to the verdict when the skip half could not run (AC-9). */
const INACTIVE_QUALIFIER = 'skipped-count ratchet INACTIVE — baseline has no "skipped" block';

/**
 * Stable identity for a SUITE: its path relative to the app, forward slashes.
 * The same normalisation `testKey` applies, so a Windows run and a Linux CI run
 * produce the same key. One normaliser, used by both — never a second one.
 */
function suiteKey(specPath, appDir) {
  return String(specPath)
    .replace(/\\/g, '/')
    .replace(`${String(appDir).replace(/\\/g, '/')}/`, '');
}

/**
 * Stable identity for a TEST: "<spec path relative to the app>::<full test name>".
 * Moved verbatim from `test-ratchet.js` (only `appDir` became a parameter, since
 * this module may not read the environment).
 */
function testKey(specPath, fullName, appDir) {
  return `${suiteKey(specPath, appDir)}::${fullName}`;
}

/**
 * The ESC byte, built rather than typed: a literal control character in a source
 * file is invisible to review and survives copy-paste badly. Same reason the
 * bracket below is written as its unicode escape.
 */
const ESC = String.fromCharCode(27);

/**
 * A full CSI sequence — ESC, `[`, parameters, final byte.
 *
 * MEASURED, not assumed: jest 29.7.0's `--json` output carries the colour codes
 * verbatim inside a suite `message`. Printed raw, they put control characters
 * into the gate log.
 */
const ANSI_CSI = new RegExp(ESC + '\\u005B[0-9;]*[A-Za-z]', 'g');

/**
 * The same sequence with its ESC already lost in transit, which is how it reads
 * once a log has been through a text pipeline. Deliberately NARROW — at least one
 * digit and a literal `m` — so it cannot eat a character class out of a
 * legitimate failure message.
 */
const ANSI_CSI_ORPHANED = new RegExp('\\u005B[0-9]+(?:;[0-9]+)*m', 'g');

/** Strip ANSI escape sequences so a cause can be printed into a plain log. */
function stripAnsi(text) {
  return String(text).replace(ANSI_CSI, '').replace(ANSI_CSI_ORPHANED, '');
}

/**
 * The cause of a load failure, ready to print.
 *
 * ⚠ The key is `message`, NOT `failureMessage`. Measured on jest 29.7.0: the
 * `--json` report's suite object has exactly
 * `assertionResults, coverage, endTime, message, name, startTime, status, summary`
 * — `failureMessage` is the field name on jest's *internal* `TestResult`, which
 * `formatTestResults` renames to `message` on the way out. Reading
 * `suite.failureMessage` yields `undefined` on every suite, and TOOL-16(a) would
 * ship as a no-op that prints nothing: a fix that is green and does nothing,
 * which is the exact family of defect this track exists to remove. The fallback
 * is a belt for a future jest, not the field this one populates.
 */
function loadFailureCause(suite, maxLines = LOAD_FAILURE_CAUSE_LINES) {
  const raw = stripAnsi((suite && (suite.message || suite.failureMessage)) || '').trimEnd();
  if (raw === '') return '';
  const lines = raw.split(/\r?\n/);
  if (lines.length <= maxLines) return lines.join('\n');
  // A message that silently cuts is a message an operator cannot trust, so the
  // truncation states itself.
  return [...lines.slice(0, maxLines), `    … (truncated; ${maxLines} of ${lines.length} lines)`].join('\n');
}

/**
 * Reduce one jest JSON report to the material the ratchet decides on.
 *
 * @returns {{
 *   failing: string[],                                   // unchanged semantics
 *   skipped: Record<string, number>,                     // per suite, non-zero only
 *   loadFailures: Array<{ key: string, cause: string }>,
 *   suites: string[],
 * }}
 */
function reduceReport({ report, appDir }) {
  const failing = new Set();
  /** Only NON-ZERO entries are recorded — see `compareToBaseline` for the cost. */
  const skipped = {};
  const loadFailures = [];
  const suites = [];

  for (const suite of (report && report.testResults) || []) {
    const key = suiteKey(suite.name, appDir);
    suites.push(key);
    const assertions = suite.assertionResults || [];

    for (const t of assertions) {
      if (t.status === 'failed') failing.add(testKey(suite.name, t.fullName, appDir));
    }

    // A suite that fails to even load reports no assertions — that must not slip
    // through as "zero failures". Measured (§1.4): a suite skipped in its
    // ENTIRETY is `status: 'skipped'` and still lists its assertions, so the two
    // shapes cannot collide and this stays a failure rather than a skip.
    const isLoadFailure = assertions.length === 0 && suite.status === 'failed';
    if (isLoadFailure) {
      failing.add(testKey(suite.name, LOAD_FAILURE_SENTINEL, appDir));
      loadFailures.push({ key, cause: loadFailureCause(suite) });
    }

    // A load-failed suite contributes to `failing` and must NEVER also contribute
    // to `skipped`. It has zero assertions today, so the filter already yields 0
    // — this is written EXPLICITLY rather than relied upon, because a future jest
    // that synthesised a pending assertion for an unloadable file would otherwise
    // count it in both places and one disappearance would read as two.
    const notExecuted = isLoadFailure
      ? 0
      : assertions.filter((t) => NOT_EXECUTED_STATUSES.has(t.status)).length;
    if (notExecuted > 0) skipped[key] = notExecuted;
  }

  return { failing: [...failing].sort(), skipped, loadFailures, suites };
}

/**
 * Compare a reduced report against one app's baseline entry.
 *
 * THE ASYMMETRY, AND WHY IT IS NOT AN INCONSISTENCY
 * -------------------------------------------------
 * For FAILURES the ratchet turns one way only: a new failure fails the gate, and
 * a baseline entry that now passes ALSO fails the gate (remove it). For SKIPPED
 * COUNTS only a RISE fails; a fall is reported.
 *
 * A failure key is an **identity**: it names one test, and if that test passes the
 * entry is simply stale. A skipped count is a **measurement** over a suite whose
 * membership changes for unrelated legitimate reasons — a suite gains three
 * passing tests, someone deletes an `it.todo`, a `describe.skip` is un-skipped.
 * Failing on a fall would red the gate on the author who did the right thing, and
 * the gate would be routed around within a week. Failing on a rise is the whole
 * finding.
 *
 * THE HONEST LIMIT, stated here rather than left for a reader to discover: a suite
 * that loses skipped tests by having them DELETED is reported, not failed. That is
 * why the fall report has to be loud and has to name the possibility.
 *
 * THE RESIDUAL, likewise: only NON-ZERO counts are recorded, so the baseline stays
 * small and every line in it means something. The cost is that **a suite with zero
 * recorded skips that vanishes entirely is NOT caught by this comparison** — the
 * `missingSuites` rule below can only miss what the baseline knew about. Catching
 * that needs a full suite inventory (the shape of `scripts/web-route-baseline.json`),
 * which is a bigger change than this finding; it is recorded as a follow-on, not
 * left unconsidered.
 */
function compareToBaseline({ reduced, baselineApp, skip }) {
  const app = baselineApp || {};
  const failingSet = new Set(reduced.failing);

  const allKnown = Object.keys(app.failures || {});
  // Baseline entries under a skipped path did not run, so they can be neither a
  // regression nor a fix. Excluding them is what makes --skip safe.
  const knownSkipped = skip ? allKnown.filter((k) => k.includes(skip)) : [];
  const known = new Set(skip ? allKnown.filter((k) => !k.includes(skip)) : allKnown);

  const regressions = reduced.failing.filter((k) => !known.has(k)).sort();
  const fixed = [...known].filter((k) => !failingSet.has(k)).sort();

  // An old baseline with no `skipped` key must degrade LOUDLY, never silently:
  // no crash, no red gate (that would leave no way back except a complete run,
  // which is not always available) — but the caller MUST say the half did not run
  // and MUST qualify its verdict. That is DNC-08 applied to this file.
  const baselineHasSkipBlock = Boolean(app.skipped) && typeof app.skipped === 'object';
  const baselineSkips = baselineHasSkipBlock ? app.skipped : {};

  const skipRises = [];
  const skipFalls = [];
  const missingSuites = [];
  let heldOutSkipCounts = 0;

  if (baselineHasSkipBlock) {
    const reportSuites = new Set(reduced.suites);
    const keys = [...new Set([...Object.keys(reduced.skipped), ...Object.keys(baselineSkips)])].sort();
    for (const key of keys) {
      // The gate's own tiering skipped this path: nothing is known about it, in
      // EITHER direction. Without this hold-out every `--skip` run would see the
      // suite as vanished (the rule below) and the gate would fail every time.
      // This is a DIFFERENT event from a suite that skipped itself, and the two
      // must never be conflated: one means "we chose not to look", the other
      // means "it ran and decided not to execute".
      if (skip && key.includes(skip)) {
        heldOutSkipCounts += 1;
        continue;
      }
      const hasBaselineEntry = Object.prototype.hasOwnProperty.call(baselineSkips, key);
      const from = hasBaselineEntry ? Number(baselineSkips[key]) || 0 : 0;
      const to = reduced.skipped[key] || 0;

      // A suite the baseline knows about that is ABSENT from the report: the suite
      // stopped existing. At least as suspicious as a count that rose, so it gets
      // the same verdict — a legitimate rename or deletion is resolved by --update,
      // the same escape hatch `fixed` already uses.
      if (hasBaselineEntry && !reportSuites.has(key)) {
        missingSuites.push({ key, from });
        continue;
      }
      // A suite with skips and NO baseline entry is a rise from 0, and it fails:
      // otherwise a new suite could arrive fully skipped and be green forever.
      // Escape by omission is what `boot-check.js`'s baseline and
      // `lint-ratchet.js`'s ceiling list already refuse.
      if (to > from) skipRises.push({ key, from, to, newSuite: !hasBaselineEntry });
      else if (to < from) skipFalls.push({ key, from, to });
    }
  }

  return {
    regressions,
    fixed,
    known: [...known].sort(),
    knownSkipped,
    skipRises,
    skipFalls,
    missingSuites,
    heldOutSkipCounts,
    baselineHasSkipBlock,
  };
}

/** The unmissable line printed when the baseline carries no `skipped` block (AC-9). */
function formatInactiveWarning(app) {
  return (
    `⚠ test-ratchet[${app}]: this baseline records no skipped counts. The skip ratchet is ` +
    'INACTIVE for this app; run --update from a COMPLETE run.'
  );
}

module.exports = {
  NOT_EXECUTED_STATUSES,
  LOAD_FAILURE_SENTINEL,
  LOAD_FAILURE_CAUSE_LINES,
  INACTIVE_QUALIFIER,
  suiteKey,
  testKey,
  stripAnsi,
  loadFailureCause,
  reduceReport,
  compareToBaseline,
  formatInactiveWarning,
};
