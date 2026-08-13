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
 * TOOL-17b — WHAT A TOLERATED SKIP MUST STILL NOT BUY YOU
 * -------------------------------------------------------
 * The tolerance above is correct and stays. What it opened is `DNC-08` one layer
 * up, at the READING sites, and both leaks have the same sentence: *a file that
 * was skipped must never satisfy a rule.*
 *
 * 1. THE NAMED-PATH LEAK. The victims build their corpus `Map` through the
 *    tolerant seam and then read FIXED, hard-coded paths back out of it with
 *    `MAP.get('<literal>') ?? ''`. If that named file was skipped, the accessor
 *    yields `''` — and every negative assertion downstream passes VACUOUSLY: an
 *    empty string contains nothing, matches no `toMatch`, and satisfies every
 *    `.not.` in the file forever. This is the rule stated above ("every fixed,
 *    named path keeps its bare `readFileSync` and keeps failing at load") being
 *    violated by reading a NAMED path out of a TOLERANT map. `namedReader()`
 *    below restores it at the only place it can be restored: the accessor
 *    THROWS on an absent key rather than serving `''`. Named is total; walked is
 *    tolerated. Nothing in between.
 *
 *    Consequence, and it is intended rather than a regression: if a named file
 *    is legitimately deleted by a future slice, the spec goes RED at the
 *    assertion that names the file, instead of passing on nothing.
 *
 *    One of the 48 converted call sites (`portal-landing-gate.spec.ts:520`) keys
 *    the map with a MAP-DERIVED key (`[...EXECUTABLE_SRC.entries()]`), so it can
 *    never take the throw branch. That is not an exception to carve out — it is
 *    the proof that the throw is reachable ONLY via the skip path. Recorded here
 *    so no reviewer has to re-derive it.
 *
 * 2. THE FLAT CAP. `MAX_VANISHED_FILES` is a budget of FIVE files, and it was
 *    applied unchanged to a corpus of TEN (`apps/web/tests`, measured on HEAD,
 *    asserted at `portal-landing-gate.spec.ts:217`): half the corpus could
 *    vanish and the gate still passed. A budget only transports a floor when it
 *    is small relative to the list, so `maxVanishedFor(n)` scales it and keeps
 *    `MAX_VANISHED_FILES` as the CEILING for large corpora — the large-corpus
 *    assertions keep their exact meaning. It never returns 0 for a non-empty
 *    corpus, for the same reason the constant is not 0: `toBe(0)` relocates the
 *    flake from load time to assert time, which is the defect this module exists
 *    to remove.
 *
 * RESIDUALS — recorded, NOT fixed here
 * -----------------------------------
 * • ~~The FR-4 named-path leak: `MAP.get('<literal>') ?? ''` served a skipped
 *   NAMED file as `''`.~~ **CLOSED by TOOL-17b** — `namedReader()` throws a
 *   greppable `DNC-08 (TOOL-17b)` error carrying the key; all 48 sites across
 *   `audit-provenance`, `audit-vocabulary`, `trust-proxy-dnc10` and
 *   `portal-landing` converted.
 * • ~~The shared cap of 5 applied to a 10-file corpus.~~ **CLOSED by TOOL-17b** —
 *   `maxVanishedFor(n)` at all twelve comparison sites.
 * • ~~A sixth victim: the bare `readFileSync` over a WALKED list inside
 *   `apps/api/src/shared/audit/write-audit.spec.ts:416` (AC-9).~~ **CLOSED by
 *   TOOL-17b** — routed through this seam, with the identity and the scaled cap
 *   asserted in the same `it()`; the five NAMED reads in that file
 *   (`:312/:327/:351/:360/:370`) deliberately keep their bare `readFileSync`,
 *   and a test now asserts they do.
 * • NEW (TOOL-17b, measured): the R1 half of the parsed ratchet — "no spec reads
 *   a WALK-DERIVED path with a bare `readFileSync`" — is NOT implemented. R2
 *   (no `.get(…) ?? ''` on a corpus map) is, and is enforced by a compiler-parsed
 *   classifier over every `*.spec.ts` under `apps/**`. R1 needs local
 *   call-graph reachability (`readdirSync` transitively, through locally-declared
 *   functions, then dataflow from that binding into a `readFileSync` argument);
 *   that is a second classifier of comparable size to this whole slice, and the
 *   honest cost is a slice of its own. Until it exists, a NEW bare walked read
 *   is caught by review, not by a gate.
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
 * The share of a walked list that may vanish before the corpus stops being
 * believable — 2 %.
 *
 * Not a measurement either: it is the smallest fraction that still leaves the
 * observed ceiling (two writer specs, one probe each) inside the budget for the
 * corpora that are actually raced (`apps/api/src` ≈ 210 files → 5), while
 * pulling the budget down to ONE for the small corpus that exposed the defect
 * (`apps/web/tests` ≈ 10 files, where the flat 5 let half the corpus disappear).
 * Pinned by BOUNDARIES in `walk-read-gate.spec.ts`, never by this literal — the
 * formula is free to change as long as the boundaries hold.
 */
const VANISHED_FRACTION = 0.02;

/**
 * The most files a walk of `n` paths may lose to the tolerance.
 *
 * Two non-negotiable properties, both inherited from the constant above:
 *   • it NEVER returns 0 for a non-empty corpus — a zero budget is
 *     `expect(skipped).toBe(0)`, i.e. the flake moved from load to assert time;
 *   • it NEVER exceeds `MAX_VANISHED_FILES`, which stays the ceiling — so every
 *     large-corpus assertion written against the constant keeps its meaning.
 *
 * @param {number} n the length of the WALK LIST (not of the read map)
 * @returns {number} the cap to compare `skipped.length` against
 */
function maxVanishedFor(n) {
  const size = Number.isFinite(n) && n > 0 ? n : 0;
  if (size === 0) return 0;
  return Math.min(MAX_VANISHED_FILES, Math.max(1, Math.ceil(size * VANISHED_FRACTION)));
}

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

/**
 * Serve a NAMED (fixed, hard-coded) path out of a corpus Map built by the
 * tolerant seam — by THROWING when the key is absent, never by yielding `''`.
 *
 * This is the other end of the rule stated at the top of this file: the
 * tolerance is for WALKED paths, and a named path read out of a tolerant map
 * must behave like the bare `readFileSync` it replaced — it must FAIL, loudly,
 * naming the file. Serving `''` instead is a vacuous PASS: every `.not.` and
 * every `toMatch` downstream is satisfied by the empty string.
 *
 * The message is deliberately greppable (`DNC-08 (TOOL-17b)`) against both the
 * skip warning above and the check scripts' own `DNC-08 —` vocabulary, and it
 * CARRIES THE KEY: a count with no identity is the same "cannot tell" failure
 * DNC-08 exists to refuse.
 *
 * @param {string} label the reading site, for the message
 * @param {Map<string, string>} map the corpus
 * @returns {(key: string) => string} a total accessor
 */
function namedReader(label, map) {
  return (key) => {
    const source = map.get(key);
    if (source === undefined) {
      throw new Error(
        `DNC-08 (TOOL-17b) — ${label}: named path '${key}' is absent from the corpus.\n` +
          'A named path is never tolerated: it was skipped by the walk/read tolerance, ' +
          'or never walked.\n' +
          "Refusing to serve '' — a vacuous PASS is not a PASS.",
      );
    }
    return source;
  };
}

module.exports = {
  DEFAULT_ENCODING,
  MAX_VANISHED_FILES,
  VANISHED_FRACTION,
  mapWalkedFiles,
  maxVanishedFor,
  namedReader,
  readWalkedFile,
  readWalkedFiles,
  warnSkipped,
};
