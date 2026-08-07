#!/usr/bin/env node
/**
 * link-integrity-check.js — the gate that reads every fully-literal internal link
 * in `apps/web` and resolves it against the EMITTED route inventory (S-E06-3,
 * PF-19).
 *
 * WHY A ROUTE-EXISTENCE CHECK CANNOT SEE THE DEFECT THIS CLOSES
 * ------------------------------------------------------------
 * `apps/web/src/app/admin/classes/page.tsx` linked to `/admin/classes/new`
 * twice — the `PageHeader` action ("Ajouter une classe") and the `EmptyState`
 * action, which is the only affordance a school with zero classes ever sees.
 * That route was never emitted.
 *
 * It nonetheless **resolves**. Next matches it against `/admin/classes/[id]`
 * with `id = "new"`, the detail page fetches a class whose id is the string
 * `new`, and the admin lands on an error boundary. So the naive gate — "does
 * every link target appear in the route table?" — answers *yes* and reports
 * green while the primary call to action of an admin surface crashes.
 *
 * The defect is not the ABSENCE of a match; it is the SHAPE of the match. A
 * fully-literal target that resolves only because a single-segment `[param]`
 * swallowed a literal segment means the author intended a static page. That
 * failure class — DYNAMIC CAPTURE — is the non-obvious half of this gate, and
 * it is the half that stops the class of defect rather than one instance of it.
 * It is why the classifier returns four verdicts rather than a boolean:
 *
 *     exact            matches a template with no dynamic segment      ALIVE
 *     catch-all        matches only through a catch-all segment        ALIVE
 *     dynamic-capture  matches only because a [param] ate a literal    FAIL, always
 *     dead             matches nothing at all                          FAIL unless baselined
 *
 * `catch-all` is ALIVE on purpose. Consuming literal segments is the *entire*
 * function of a catch-all: `/api/proxy/[...path]` legitimately swallows
 * `/api/proxy/v1/notifications/unread-count`, which is how every client fetch in
 * this application reaches the API. Conflating the two would make the gate
 * permanently red on correct code, and the only way back to green would be to
 * break the BFF proxy.
 *
 * IT READS THE EMITTED ARTEFACT, NEVER THE app/ DIRECTORY TREE
 * -----------------------------------------------------------
 * The route universe comes from `apps/web/.next/app-path-routes-manifest.json`,
 * the same source `scripts/web-artifact-check.js` uses and for the same reason.
 * PF-82 exists precisely because a sibling gate read source instead of the
 * artefact; this file does not reproduce it at a new address. A route that
 * exists under `app/` and was not emitted is exactly the state in which a
 * source-reading gate reports "the link is fine" about a link that 404s. The
 * gate therefore runs AFTER the build, and is skipped by `--quick`.
 *
 * WHAT COUNTS AS A LITERAL INTERNAL LINK, AND WHY EACH EXCLUSION EXISTS
 * --------------------------------------------------------------------
 * Source set: every .ts and .tsx file under `apps/web/src`, walked from the
 * filesystem. In scope: a fully-literal single- or double-quoted string whose
 * value starts with a slash.
 *
 *   - template literals are excluded — an interpolated href is a dynamic target,
 *     and a literal sitting in a dynamic slot is the thing this gate looks for,
 *     not the thing it should chase;
 *   - the bare root is excluded — it always resolves and carries no information;
 *   - anything under `_next` is excluded — build assets, not routes;
 *   - a last segment containing a dot is excluded — asset paths such as the
 *     favicon are served from `public/`, not from the router;
 *   - protocol-relative strings and anything containing a scheme separator are
 *     excluded — they are external;
 *   - `/api/v1/...` is excluded — that is the NestJS API's own namespace, reached
 *     through the BFF proxy, and it is not a Next route at any address;
 *   - query strings and fragments are stripped before matching.
 *
 * RATCHET DISCIPLINE
 * ------------------
 * `scripts/link-integrity-baseline.json` is a ceiling that may only ever SHRINK,
 * in the sense `scripts/known-test-failures.json` established: every entry
 * carries the finding id that owns the fix, so nothing here is "silenced" — it
 * is queued. Four ways to fail, and they are deliberately symmetric:
 *
 *   - a NEW dead target                            → FAIL;
 *   - a baselined target that is now ALIVE         → FAIL (remove the entry and
 *     close the finding; a ratchet that never tightens is a rubber band);
 *   - a baselined target nobody references any more → FAIL (a ceiling nobody is
 *     standing under silently re-authorises the target the day someone links it);
 *   - ANY dynamic capture                          → FAIL, unconditionally. It is
 *     not baselineable and `--update` refuses to record it.
 *
 * There is no bypass (DNC-10): no environment variable is read anywhere in this
 * file, and the only flags are `--update` (which rewrites the reviewed ceiling
 * and shows up in the diff) and `--help`. A flag that let a caller choose the
 * inventory would be a bypass wearing a different hat, so there is none — which
 * is also why both CI call sites invoke this script with zero arguments.
 *
 * USAGE
 *   node scripts/link-integrity-check.js            gate (exit 1 on any failure)
 *   node scripts/link-integrity-check.js --update   rewrite the reviewed baseline
 */
'use strict';

const { existsSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve, sep } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'link-integrity-baseline.json');

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage']);
const NEXT_CONFIG_NAMES = ['next.config.mjs', 'next.config.js', 'next.config.cjs', 'next.config.ts'];

/* ------------------------------------------------------------------ *
 * Discovery — from the filesystem, never from the baseline
 * ------------------------------------------------------------------ */

/**
 * Every Next.js application in the workspace.
 *
 * Driven by the filesystem for the same reason `web-artifact-check.js` is: a
 * list an application can quietly omit itself from reproduces PF-69/PF-70 at a
 * new address. A second Next app added tomorrow is walked and gated the day it
 * appears, without anyone remembering to enter it anywhere.
 */
function discoverNextApps() {
  const appsDir = join(REPO_ROOT, 'apps');
  const found = [];
  for (const name of readdirSync(appsDir)) {
    const dir = join(appsDir, name);
    if (!NEXT_CONFIG_NAMES.some((f) => existsSync(join(dir, f)))) continue;
    found.push({
      id: `apps/${name}`,
      dir,
      srcDir: join(dir, 'src'),
      manifestPath: join(dir, '.next', 'app-path-routes-manifest.json'),
    });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

function rel(path) {
  const normalized = path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1) : path;
  return normalized.split(sep).join('/');
}

/* ------------------------------------------------------------------ *
 * The route matcher
 * ------------------------------------------------------------------ */

function segmentsOf(path) {
  return path.split('/').filter((s) => s.length > 0);
}

/**
 * Route-group segments never appear in a URL, so they are stripped before the
 * template is compared with anything.
 */
function templateSegments(route) {
  return segmentsOf(route).filter((s) => !(s.startsWith('(') && s.endsWith(')')));
}

function isOptionalCatchAll(segment) {
  return segment.startsWith('[[...') && segment.endsWith(']]');
}

function isCatchAll(segment) {
  return !isOptionalCatchAll(segment) && segment.startsWith('[...') && segment.endsWith(']');
}

function isParam(segment) {
  return !isCatchAll(segment) && !isOptionalCatchAll(segment) && segment.startsWith('[') && segment.endsWith(']');
}

/**
 * Query string and fragment stripped, trailing slash removed, root preserved.
 */
function normalizeTarget(raw) {
  let value = String(raw);
  const hash = value.indexOf('#');
  if (hash >= 0) value = value.slice(0, hash);
  const query = value.indexOf('?');
  if (query >= 0) value = value.slice(0, query);
  value = value.replace(/\/+$/, '');
  return value === '' ? '/' : value;
}

/**
 * Match one template against one target.
 *
 * Returns `null` when it does not match, otherwise how it matched: `capture` is
 * true when a single-segment `[param]` consumed a literal segment, `catchAll` is
 * true when a catch-all did. Depth semantics are the sharp part and a
 * segment-count equality test gets them wrong invisibly on a healthy repository:
 * `[param]` is exactly one segment, `[...slug]` is one or more, `[[...slug]]` is
 * zero or more.
 */
function matchTemplate(tplSegs, tgtSegs) {
  function walk(ti, si, capture, catchAll) {
    if (ti === tplSegs.length) {
      return si === tgtSegs.length ? { capture, catchAll } : null;
    }
    const segment = tplSegs[ti];

    if (isOptionalCatchAll(segment) || isCatchAll(segment)) {
      const minimum = isOptionalCatchAll(segment) ? 0 : 1;
      for (let take = tgtSegs.length - si; take >= minimum; take--) {
        const matched = walk(ti + 1, si + take, capture, true);
        if (matched) return matched;
      }
      return null;
    }

    if (isParam(segment)) {
      if (si >= tgtSegs.length) return null;
      return walk(ti + 1, si + 1, true, catchAll);
    }

    if (segment !== tgtSegs[si]) return null;
    return walk(ti + 1, si + 1, capture, catchAll);
  }

  return walk(0, 0, false, false);
}

/**
 * Resolve a target against the whole inventory and report the best match.
 *
 * Precedence is exact over catch-all over capture: once `/admin/classes/new` is
 * emitted, the fact that `/admin/classes/[id]` would also have matched stops
 * mattering, and the gate must say so rather than keep reporting the fixed
 * defect.
 */
function resolveTarget(target, routes) {
  const tgtSegs = segmentsOf(normalizeTarget(target));
  let best = null;

  for (const route of routes) {
    const matched = matchTemplate(templateSegments(route), tgtSegs);
    if (!matched) continue;

    let verdict = 'exact';
    if (matched.capture) verdict = 'dynamic-capture';
    else if (matched.catchAll) verdict = 'catch-all';

    const rank = { exact: 3, 'catch-all': 2, 'dynamic-capture': 1 }[verdict];
    if (!best || rank > best.rank) best = { verdict, template: route, rank };
    if (verdict === 'exact') break;
  }

  return best ? { verdict: best.verdict, template: best.template } : { verdict: 'dead', template: null };
}

/** The pure classifier the guard spec drives with synthetic inventories. */
function classifyTarget(target, routes) {
  return resolveTarget(target, routes).verdict;
}

/* ------------------------------------------------------------------ *
 * The extractor
 * ------------------------------------------------------------------ */

function walkSources(root) {
  const files = [];
  if (!existsSync(root)) return files;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        stack.push(join(current, entry.name));
      } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        files.push(join(current, entry.name));
      }
    }
  }
  return files.sort();
}

/**
 * A fully-literal string whose value starts with a slash. Backticks are outside
 * the character class on purpose, so a template literal can never be mistaken
 * for a literal target.
 */
const LITERAL_LINK = /(['"])(\/[^'"`\n\r]*)\1/g;

/** Every exclusion in one place, each one named in the file header. */
function isInternalRouteTarget(value) {
  if (value === '/') return false;
  if (value.includes('://')) return false;
  if (value.startsWith('//')) return false;
  if (value.includes('${')) return false;
  if (value.startsWith('/_next')) return false;
  if (value.startsWith('/api/v1/') || value === '/api/v1') return false;
  const segments = segmentsOf(value);
  const last = segments[segments.length - 1];
  if (last && last.includes('.')) return false;
  // A first segment that does not begin with a letter is not a route. Next
  // route segments are named directories, and the strings this rule drops are
  // ratios and units written with a leading slash — `unit: '/20'` in
  // `admin/alerts/types.ts` is a suffix rendered next to a mark out of 20, not
  // a link. Measured: this rule removes exactly one target from the inventory.
  if (!/^[A-Za-z_]/.test(segments[0] || '')) return false;
  return /^\/[A-Za-z0-9\-._~\/]*$/.test(value);
}

/**
 * Every literal internal link target in one Next application's sources.
 *
 * Positions are reported repo-relative with forward slashes, and the captured
 * value can never carry a trailing carriage return: on a CRLF checkout — and
 * this repository is developed on Windows — a line-anchored capture that let
 * `\r` through would silently turn every single link dead while the gate
 * reported a precise-looking failure for all of them.
 */
function extractLiteralLinks(srcDir) {
  const root = srcDir || (discoverNextApps()[0] || {}).srcDir;
  if (!root) return [];

  const results = [];
  for (const file of walkSources(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, '');
      LITERAL_LINK.lastIndex = 0;
      let match = LITERAL_LINK.exec(line);
      while (match) {
        const raw = match[2];
        const value = normalizeTarget(raw);
        if (isInternalRouteTarget(value)) {
          results.push({ target: value, file: rel(file), line: i + 1 });
        }
        match = LITERAL_LINK.exec(line);
      }
    }
  }
  return results;
}

/* ------------------------------------------------------------------ *
 * The gate's verdict
 * ------------------------------------------------------------------ */

/**
 * The baseline is keyed on the TARGET and nothing else.
 *
 * Never on file plus line: `sidebar-items.ts` and `TopbarUserMenu.tsx` are
 * edited constantly, and a line-keyed ceiling turns red on every unrelated edit
 * above a link.
 */
function normalizeBaseline(raw) {
  const root = raw || {};
  const container = root.dead || root.entries || root.targets;
  if (Array.isArray(container)) return container.map((entry) => ({ ...entry }));
  if (container && typeof container === 'object') {
    return Object.entries(container).map(([target, value]) => ({ target, ...(value || {}) }));
  }
  return [];
}

function indent(text, spaces = 8) {
  const pad = ' '.repeat(spaces);
  return String(text)
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

function citations(entries) {
  return indent(entries.slice(0, 6).map((e) => `- ${e.file}:${e.line}`).join('\n'));
}

/**
 * Classify FIRST, reconcile SECOND.
 *
 * The precedence is load-bearing, not stylistic: a target that was baselined as
 * dead and has since become a capture must fail AS a capture. Reporting it as
 * "now alive, remove the entry" would tell the reader to delete the only written
 * record of a live defect.
 */
function classifyAll(input) {
  const targets = (input && input.targets) || [];
  const routes = (input && input.routes) || [];
  const baseline = (input && input.baseline) || [];

  const problems = [];
  const byTarget = new Map();
  for (const entry of targets) {
    const list = byTarget.get(entry.target) || [];
    list.push(entry);
    byTarget.set(entry.target, list);
  }

  const baselineByTarget = new Map();
  for (const entry of baseline) baselineByTarget.set(entry.target, entry);

  const stats = {
    filesScanned: new Set(targets.map((t) => t.file)).size,
    targets: byTarget.size,
    alive: 0,
    dead: 0,
    captures: 0,
    baselined: 0,
  };

  const seenInSource = new Set();

  for (const [target, references] of [...byTarget.entries()].sort()) {
    seenInSource.add(target);
    const { verdict, template } = resolveTarget(target, routes);
    const entry = baselineByTarget.get(target);

    if (verdict === 'dynamic-capture') {
      stats.captures++;
      problems.push(
        `DYNAMIC CAPTURE — ${target} resolves ONLY because the dynamic segment of\n` +
          `        ${template} swallowed a literal segment. The link looks alive to a\n` +
          `        route-existence check and lands on the wrong page at runtime (PF-19).\n` +
          `        This is NOT baselineable: create the real route, or change the link.\n` +
          citations(references),
      );
      continue;
    }

    if (verdict === 'dead') {
      stats.dead++;
      if (!entry) {
        problems.push(
          `DEAD LINK — ${target} matches no emitted route.\n` +
            `        Fix the link or the route. If it is a known gap owned by another\n` +
            `        slice, enter it in scripts/link-integrity-baseline.json with a reason\n` +
            `        AND the finding id that owns the fix.\n` +
            citations(references),
        );
        continue;
      }
      stats.baselined++;
      const reason = String(entry.reason || '').trim();
      const finding = String(entry.finding || '').trim();
      if (reason === '') {
        problems.push(
          `BASELINE ENTRY WITHOUT A REASON — ${target} in scripts/link-integrity-baseline.json.\n` +
            `        An entry with no reason is a silence, not a queue.`,
        );
      }
      if (!/^(PF|R|VAL|D)-\d+$/.test(finding)) {
        problems.push(
          `BASELINE ENTRY WITHOUT AN OWNING FINDING — ${target} in\n` +
            `        scripts/link-integrity-baseline.json carries no finding id, so nothing\n` +
            `        anywhere is committed to fixing it.`,
        );
      }
      continue;
    }

    stats.alive++;
    if (entry) {
      problems.push(
        `BASELINED BUT ALIVE — ${target} now resolves (${verdict}).\n` +
          `        The ceiling only comes down: remove the entry from\n` +
          `        scripts/link-integrity-baseline.json and close ${entry.finding || 'its finding'}.\n` +
          `        This is not a regression — it is a fix that was not recorded.`,
      );
    }
  }

  for (const entry of baseline) {
    if (seenInSource.has(entry.target)) continue;
    problems.push(
      `STALE BASELINE ENTRY — ${entry.target} is no longer linked from anywhere in the\n` +
        `        sources. Remove it from scripts/link-integrity-baseline.json: a ceiling\n` +
        `        nobody stands under silently re-authorises the target the day someone\n` +
        `        links it again.`,
    );
  }

  return { problems, stats };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function loadBaselineFile() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

const BASELINE_COMMENT =
  'Dead internal link targets, read off the EMITTED Next.js route inventory ' +
  '(.next/app-path-routes-manifest.json) by scripts/link-integrity-check.js, never off the app/ ' +
  'directory tree. Regenerate deliberately with `node scripts/link-integrity-check.js --update`; ' +
  'the diff is meant to be reviewed. A dynamic capture can never appear here — it is always a ' +
  'failure and --update refuses to record one.';

const BASELINE_DOC = [
  'Dead internal link targets tolerated until their owning finding is closed.',
  'This list may only ever SHRINK.',
  'Every entry carries the finding id that owns the fix, so nothing here is "silenced" — it is queued.',
  'An entry whose target resolves again, or that nothing links to any more, is a FAILURE: remove it.',
];

/**
 * Read one application's emitted inventory.
 *
 * A missing or empty manifest is a structural failure, never a skip: it is the
 * exact state in which every check below would vacuously pass, which is the
 * R-25 shape the sibling web artefact gate exists for.
 */
function readInventory(app) {
  const structural = [];
  if (!existsSync(join(app.dir, '.next'))) {
    structural.push(`${app.id} — no build output at ${rel(join(app.dir, '.next'))}; run \`pnpm build\` first`);
    return { routes: [], structural };
  }
  if (!existsSync(app.manifestPath)) {
    structural.push(`${app.id} — ${rel(app.manifestPath)} is missing; no app-router routes were emitted`);
    return { routes: [], structural };
  }
  const manifest = JSON.parse(readFileSync(app.manifestPath, 'utf8'));
  const routes = Object.values(manifest);
  if (routes.length === 0) {
    structural.push(`${app.id} — ${rel(app.manifestPath)} is empty; the build emitted no routes`);
  }
  return { routes, structural };
}

function printHelp() {
  const lines = [
    'link-integrity-check.js — literal internal links vs the EMITTED route inventory (S-E06-3, PF-19)',
    '',
    '  node scripts/link-integrity-check.js',
    '      Gate. Exits 1 on a new dead link, on any dynamic capture, on a baselined',
    '      target that is alive again or no longer referenced, and on a baseline entry',
    '      missing its reason or its owning finding.',
    '',
    '  node scripts/link-integrity-check.js --update',
    '      Rewrite the reviewed ceiling at scripts/link-integrity-baseline.json.',
    '      Refuses to write from a structurally broken artefact, and refuses to record',
    '      a dynamic capture.',
  ];
  console.log(lines.join('\n'));
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    printHelp();
    return;
  }
  const update = argv.includes('--update');

  const apps = discoverNextApps();
  if (apps.length === 0) {
    console.error('✗ link integrity check found no Next.js applications — discovery is broken, not the repo');
    process.exit(1);
  }

  const baselineRaw = loadBaselineFile();
  if (!baselineRaw && !update) {
    console.error(`✗ missing ${rel(BASELINE_PATH)} — run \`node scripts/link-integrity-check.js --update\``);
    process.exit(1);
  }
  const baseline = normalizeBaseline(baselineRaw);

  const failures = [];
  const structuralFailures = [];
  const unwritable = [];
  const deadForBaseline = new Map();

  for (const app of apps) {
    process.stdout.write(`▶ ${app.id} … `);
    const { routes, structural } = readInventory(app);
    if (structural.length > 0) {
      console.log('FAILED');
      structuralFailures.push(...structural);
      continue;
    }

    const targets = extractLiteralLinks(app.srcDir);
    const { problems, stats } = classifyAll({ targets, routes, baseline });
    console.log(
      `${routes.length} routes · ${stats.targets} literal targets · ` +
        `${stats.alive} alive · ${stats.dead} dead (${stats.baselined} baselined) · ` +
        `${stats.captures} captures`,
    );
    for (const problem of problems) failures.push(`${app.id} — ${problem}`);

    // Collected for `--update` only. In gate mode these same two facts are
    // already reported, with citations, by classifyAll — listing them twice
    // would make one defect read as two.
    for (const entry of targets) {
      const { verdict } = resolveTarget(entry.target, routes);
      if (verdict === 'dead') deadForBaseline.set(entry.target, entry);
      if (verdict === 'dynamic-capture') {
        unwritable.push(`${app.id} — ${entry.target} is a dynamic capture (${entry.file}:${entry.line})`);
      }
    }
  }

  if (update) {
    const refusals = [...structuralFailures, ...unwritable];
    if (refusals.length > 0) {
      console.error('\n✗ refusing to write the baseline: the artefact is not intact, or a capture is present.');
      for (const problem of refusals) console.error(`\n  ${problem}`);
      console.error('\n  A baseline recorded from a broken build freezes the breakage into the reviewed');
      console.error('  inventory, and a dynamic capture is never baselineable.\n');
      process.exit(1);
    }

    const known = new Map(baseline.map((entry) => [entry.target, entry]));
    const dead = {};
    const unexplained = [];
    for (const target of [...deadForBaseline.keys()].sort()) {
      const previous = known.get(target);
      dead[target] = {
        finding: (previous && previous.finding) || '',
        reason: (previous && previous.reason) || '',
      };
      if (!previous) unexplained.push(target);
    }

    const next = {
      $comment: BASELINE_COMMENT,
      $doc: BASELINE_DOC,
      dead,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    console.log(`\n✎ baseline rewritten: ${rel(BASELINE_PATH)}`);
    if (unexplained.length > 0) {
      console.log('\n  New entries were written WITHOUT a finding or a reason. The gate stays red');
      console.log('  until a human supplies both — that refusal is the point of the ratchet:');
      for (const target of unexplained) console.log(`    - ${target}`);
    }
    return;
  }

  const all = [...structuralFailures, ...failures];
  if (all.length > 0) {
    console.error('\n══════════════════════════════════════════════════════════════');
    console.error('  LINK INTEGRITY CHECK: FAIL');
    console.error('══════════════════════════════════════════════════════════════');
    for (const problem of all) console.error(`\n✗ ${problem}`);
    console.error('');
    process.exit(1);
  }

  console.log('\nLINK INTEGRITY CHECK: PASS — every literal internal link resolves, or is baselined with an owner');
}

module.exports = {
  classifyTarget,
  extractLiteralLinks,
  classifyAll,
  discoverNextApps,
  normalizeBaseline,
};

if (require.main === module) main();
