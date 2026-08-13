'use strict';

/**
 * TOOL-17 — the ONE place a **walked** path is turned into its contents.
 *
 * THE DEFECT THIS EXISTS FOR
 * --------------------------
 * Two quality specs plant a probe file into the REAL working tree and delete it
 * again (`audit-write-gate.spec.ts:689` writes `apps/api/src/shared/quality/
 * __audit_write_probe.ts`; `csv-escape-gate.spec.ts:493` writes
 * `apps/web/src/lib/__csv_escape_probe.tsx`). Five OTHER specs hand-roll a
 * `walk()` and then build a module-level Map by `readFileSync`-ing every walked
 * path. Under parallel jest the probe is listed by the walk and gone by the
 * read, the module-level read throws, and jest reports `<suite failed to load>`
 * — a red that has nothing to do with the diff under test. Two consecutive
 * `node scripts/test-ratchet.js api` runs on ONE unchanged tree produced TWO
 * DIFFERENT failure sets that way.
 *
 * The victims are innocent: walk-then-read is the correct thing to do. The race
 * is the defect, and this module is the only seam that tolerates it.
 *
 * WHY THE TOLERANCE IS THIS NARROW (DNC-08 — "an unclassifiable state must
 * never be reported as a PASS")
 * ------------------------------------------------------------------------
 * A blanket `try { read } catch { skip }` would convert five deliberate
 * load-time failures into "nothing to check, therefore pass" and weaken five
 * merge gates at once — PF-146 / PF-105 at a third address. So the tolerance is
 * exactly four steps, written once, in `readOrConfirmVanished` below:
 *
 *   1. read;
 *   2. if the errno is NOT `ENOENT`, rethrow the ORIGINAL error object,
 *      unwrapped — same instance, same `code`, same message;
 *   3. if the path EXISTS again, rethrow — a read that fails ENOENT while the
 *      file is present is not this race and must never be swallowed;
 *   4. only then record the path as skipped and return `undefined`.
 *
 * It applies to WALK-DERIVED paths only. Every fixed, named path (a seed, a
 * baseline JSON, a pre-fix fixture) keeps its bare `readFileSync` and keeps
 * failing at load, and every unguarded `require()` at the top of those specs
 * stays unguarded: a MISSING MODULE is a different seam from a VANISHING WALKED
 * FILE.
 *
 * WHY IT DIVERGES FROM THE CHECK SCRIPTS, DELIBERATELY
 * ---------------------------------------------------
 * `scripts/audit-write-check.js` and `scripts/csv-escape-check.js` answer the
 * same question the other way — on an unreadable walked file they
 * `fail(['DNC-08 — <path> is unreadable: …'])`. That is right for THEM: those
 * scripts ARE the verdict, they run once, alone, and an input they cannot read
 * is a verdict they cannot pronounce. A spec is different: it is MEASURING the
 * tree while a sibling worker legitimately mutates it, and its verdict is
 * carried by floors it asserts afterwards. The divergence is deliberate, and the
 * skip record below borrows the scripts' own `DNC-08 —` vocabulary so a skip is
 * greppable against their messages.
 *
 * WHY IT LIVES IN `scripts/lib/`
 * -----------------------------
 * Because this repository ALREADY has this artefact class at this address, so no
 * new architectural decision is taken. `scripts/lib/ratchet-core.js` is a pure
 * CJS helper required BY ABSOLUTE PATH from a spec under
 * `apps/api/src/shared/quality/` (`test-ratchet.spec.ts:307`:
 * `join(REPO_ROOT, 'scripts', 'lib', 'ratchet-core.js')`). This module is the
 * same shape, required the same way, and so lands beside it rather than founding
 * a new top-level directory.
 *
 * Blast radius (PF-80) is met identically. Three of the five victims walk
 * `apps/api/src` itself and read every `.ts` under it;
 * `audit-vocabulary-gate.spec.ts` additionally walks `apps/web/src`,
 * `apps/worker/src` and every `packages/<pkg>/src`. Measured this run, EVERY
 * walk root in this repo is `apps/<app>/src`, `apps/web/tests` or
 * `packages/<pkg>/src` (`audit-write-check.js:145`, `csv-escape-check.js:135-142`,
 * `production-artefact-check.js:100`, and `link-integrity-check.js:186-198`,
 * which discovers Next apps and walks their `src`). `scripts/` is in NONE of
 * them — every reference to `scripts/` in the specs is a named-constant read, not
 * a walk — so this file is seen by NOTHING, is outside the `src`-only `include`
 * of `apps/api/tsconfig.json`, and never reaches `apps/api/dist`. A `.ts` helper
 * under `apps/api/src/shared/quality/` would have been an input to the very gates
 * it is fixing AND would have shipped test infrastructure inside the production
 * API artefact.
 *
 * The story spec forbade "outside `apps/api/src`" on the premise that
 * `tsc --noEmit` would fail with *"file is not under rootDir"*. That premise does
 * not hold for THIS construction: every consumer reaches this module through a
 * computed `require(join(REPO_ROOT, …))`, which TypeScript never resolves into
 * the program, so there is no rootDir edge to violate. `ratchet-core.js` is the
 * standing proof — same pattern, green typecheck, landed in #231.
 *
 * It is required unguarded, exactly like `scripts/lib/ratchet-core.js` is at
 * `test-ratchet.spec.ts:307`: if this file disappears, the five suites must
 * still fail at LOAD.
 *
 * RESIDUALS — recorded, NOT fixed here
 * -----------------------------------
 * • `readdirSync` inside each `walk()` can also throw ENOENT if a DIRECTORY
 *   vanishes mid-walk. Neither probe writes a directory; same family, later
 *   finding. `walk()` bodies are untouched by this slice.
 * • Step 3 is itself racy in the opposite direction: a probe that has been
 *   re-created by the time `exists()` runs makes this RETHROW, i.e. the original
 *   load crash, rarer. TOOL-17 REDUCES the flake rate; only hermetic writers
 *   (TOOL-15, still OPEN) remove it.
 * • On Windows a delete-in-flight can surface `EPERM`/`EBUSY` rather than
 *   `ENOENT`. Those are NOT tolerated here, on purpose. On every measured
 *   occurrence the errno was `ENOENT`; an `EPERM`/`EBUSY` sighting is a NEW
 *   finding, not a regression of this one.
 * • If both the walk and the read win the race, the probe's CONTENT enters the
 *   corpus. That is a content hazard TOOL-15 closes, not this slice — which is
 *   why no floor here is turned into an exact count.
 */

/** Default text encoding — every victim reads `'utf8'`. */
const DEFAULT_ENCODING = 'utf8';

/**
 * The most files a single walk may lose to this tolerance and still be believed.
 *
 * This is the number that keeps AC-4 honest. Every existing floor in the five
 * victims is asserted on the WALK LIST (`WEB_SRC_FILES.length >= 300`,
 * `API_FILES.length >= 200`, `WRITER_FILES.length >= 120`), and a skip shrinks
 * the MAP, not the list — so identity + walk-floor alone would still pass with
 * 250 files skipped and a corpus that is effectively empty. Capping the skips
 * transports the walk floor onto the read map: `map.size >= floor - 5`.
 *
 * Five is a budget, not a measurement: exactly two writer specs exist and each
 * plants exactly ONE probe, so the observed ceiling is 2. It is deliberately NOT
 * zero — `expect(skipped).toBe(0)` would merely relocate the flake from a load
 * failure to an assertion failure, which is the defect this module removes.
 */
const MAX_VANISHED_FILES = 5;

/**
 * The default IO seam.
 *
 * `node:fs` is dereferenced at CALL time, off the shared module object, rather
 * than destructured at module scope. That is a testability constraint, not a
 * style note: `chmod` is a no-op on Windows, so the only portable way to prove
 * the non-ENOENT branch (AC-2/AC-6) is to inject a reader that throws a chosen
 * errno — or to spy on the shared `fs`.
 */
function defaultIo() {
  const fs = require('node:fs');
  return {
    readFile: (path, encoding) => fs.readFileSync(path, encoding),
    exists: (path) => fs.existsSync(path),
  };
}

/**
 * The ONLY `catch` in this slice. Four steps, in order, and nothing else.
 *
 * @returns the file contents, or `undefined` iff the path was CONFIRMED absent.
 */
function readOrConfirmVanished(path, encoding, io, skipped) {
  try {
    return io.readFile(path, encoding);
  } catch (error) {
    // 2. Not ENOENT → not this race. Rethrow the original object, unwrapped.
    if (!error || error.code !== 'ENOENT') throw error;
    // 3. ENOENT but the path is there → not this race either. Rethrow.
    if (io.exists(path)) throw error;
    // 4. Confirmed absent: record it. A skip is never silent.
    skipped.push(path);
    return undefined;
  }
}

/**
 * Read ONE walked path.
 *
 * @param {string} path absolute path produced by a `walk()`
 * @param {{encoding?: string, io?: object, skipped?: string[]}} [options]
 * @returns {string|undefined} `undefined` iff the file vanished
 */
function readWalkedFile(path, options) {
  const opts = options || {};
  return readOrConfirmVanished(
    path,
    opts.encoding || DEFAULT_ENCODING,
    opts.io || defaultIo(),
    opts.skipped || [],
  );
}

/**
 * Map a walked list into `[key, value]` entries, skipping only vanished paths.
 *
 * @param {string[]} paths the output of a `walk()`
 * @param {(path: string, source: string) => [unknown, unknown]} build
 * @param {{encoding?: string, io?: object}} [options]
 * @returns {{entries: Array, skipped: string[]}}
 */
function mapWalkedFiles(paths, build, options) {
  const opts = options || {};
  const encoding = opts.encoding || DEFAULT_ENCODING;
  const io = opts.io || defaultIo();
  const skipped = [];
  const entries = [];
  for (const path of paths) {
    const source = readOrConfirmVanished(path, encoding, io, skipped);
    if (source === undefined) continue;
    entries.push(build(path, source));
  }
  return { entries, skipped };
}

/**
 * Read a walked list into a Map keyed by absolute path.
 *
 * @returns {{contents: Map<string, string>, skipped: string[]}}
 */
function readWalkedFiles(paths, options) {
  const { entries, skipped } = mapWalkedFiles(paths, (path, source) => [path, source], options);
  return { contents: new Map(entries), skipped };
}

/**
 * Report a non-empty skip list, naming EVERY path and the site that lost it.
 *
 * A count with no identity is the same "cannot tell" failure DNC-08 guards
 * against, one layer up — so the paths are printed, not just their number. The
 * warn is the human-facing supplement only: the asserted accounting identity and
 * the suites' own floors carry the weight (`trust-proxy-dnc10-gate.spec.ts:312`
 * already records this repo's view of "a console.warn nobody reads").
 *
 * @returns {boolean} whether anything was reported
 */
function warnSkipped(label, skipped) {
  if (!skipped || skipped.length === 0) return false;
  console.warn(
    `DNC-08 (TOOL-17) — ${label}: skipped ${skipped.length} file(s) that vanished ` +
      `between walk() and readFileSync: ${skipped.join(', ')}`,
  );
  return true;
}

module.exports = {
  DEFAULT_ENCODING,
  MAX_VANISHED_FILES,
  mapWalkedFiles,
  readWalkedFile,
  readWalkedFiles,
  warnSkipped,
};
