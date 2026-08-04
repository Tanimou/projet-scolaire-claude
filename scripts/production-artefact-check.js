#!/usr/bin/env node
/**
 * Production-artefact scan — development leftovers must not ship in
 * production-facing source (S-E06-1 / PF-17, PF-54).
 *
 * WHY THIS EXISTS
 * ---------------
 * The hosted deployment rendered, to real users, on four surfaces:
 *
 *     "Dev: les emails sont catchés par Maildev → localhost:1080"
 *
 * Maildev is a container in the developer's compose stack. It does not exist on
 * the server. So the page told a school administrator to go and look for their
 * invitation in a place that cannot exist — the failure is not cosmetic, it is
 * an untrue instruction on the activation path. Alongside it, the Keycloak admin
 * client resolved its credentials with `?? 'admin'`, and compose declared
 * neither variable: the hosted API really did authenticate as `admin`/`admin`.
 *
 * Both defects were found by reading. Nothing executed. This script is what
 * turns "someone noticed" into "the gate refuses" — the V3 premise that a
 * guardrail is executed rather than asserted.
 *
 * SCOPE — POSITIVE ROOTS, NOT NEGATIVE EXCLUSIONS
 * -----------------------------------------------
 * Scanned: `apps/web/src`, `apps/api/src`, `apps/worker/src`. That is the code
 * compiled into the three shipped artefacts.
 *
 * Everything else is out of scope BY DESIGN, and the distinction is the point:
 * `infra/docker-compose.yml`, `scripts/dev.sh`, `.env*.example`, `docs/` and
 * `prisma/` legitimately name Maildev, MinIO and localhost ports, because they
 * ARE the development stack or its documentation. A scan that banned the word
 * everywhere would be satisfied only by deleting accurate documentation, which
 * makes the codebase worse while the report goes green.
 *
 * The roots are a positive allowlist rather than a `docs/**` exclusion for the
 * same reason: an exclusion silently blesses whatever is dropped into the
 * excluded path later. `production-artefact-gate.spec.ts` asserts the root list
 * still contains all three application sources, so a later narrowing fails
 * loudly instead of quietly reporting a vacuous pass.
 *
 * Test files (`*.spec.ts(x)`, `*.test.ts(x)`, `__tests__/`, `__fixtures__/`)
 * are excluded: a fixture that plants `http://localhost:1080` in order to prove
 * the detector fires is not a leak, and banning it would make the negative
 * direction of the proof unwritable.
 *
 * TWO TIERS
 * ---------
 * **Tier A — zero tolerance, no allowlist.** Strings that have no legitimate
 * reason to exist in application source at all. Any hit fails.
 *
 * **Tier B — a ratchet, not an amnesty.** ~17 `?? 'http://localhost:…'`
 * configuration fallbacks remain in the tree; they are real instances of the
 * same finding (PF-54's "development URLs ship in production-facing code") but
 * removing them touches nine call sites with a genuine local-dev regression
 * risk, so this slice inventories rather than fixes them. The counts are
 * per-file and enforced in BOTH directions — above the baseline fails (you
 * added debt), below it fails too (lower the ceiling; a ratchet that never
 * tightens is a rubber band), and a file absent from the baseline with a hit
 * fails (no escape by omission). Exactly the semantics of
 * `scripts/lint-ratchet.js`, applied to a different measurement.
 *
 * A Tier-B line is deliberately NOT also reported by Tier A rule A6: the two
 * sets are disjoint by construction, so the same fallback cannot be both
 * "inventoried" and "forbidden". `:1080` (A3) is the exception — Maildev never
 * becomes acceptable by being placed behind a `??`.
 *
 * NO BYPASS (DNC-10)
 * ------------------
 * There is no `SKIP_*`, `ALLOW_*`, `BYPASS` or `FORCE` environment read
 * anywhere in this file, and the gate spec asserts it. `--root <dir>` exists
 * for exactly one reason — so the spec can execute THIS scanner over a
 * throw-away fixture tree in `os.tmpdir()` instead of planting a poisoned file
 * in the repository, where an aborted run would leave every later gate red for
 * reasons unrelated to the diff. It cannot skip a rule, and the spec asserts
 * that neither `scripts/ci-gate.sh` nor `.github/workflows/ci.yml` passes it.
 *
 * A MEASURED NARROWING, STATED RATHER THAN HIDDEN
 * -----------------------------------------------
 * Rule A5 ("a credential fallback") was first drafted as `?? '(admin|…)'`.
 * Measured over the tree, that also matched `session?.portal ?? 'admin'` and
 * `role.portal ?? 'admin'` — two portal names, not credentials. A rule that
 * fires on those would have been "fixed" by weakening it later, in a hurry. It
 * is therefore anchored to an environment/configuration READ on the left-hand
 * side, which is what makes the value a credential. Before this slice it
 * matched exactly the two lines of `keycloak-admin.service.ts`; after, zero.
 *
 * USAGE
 *   node scripts/production-artefact-check.js               # gate (exit 1 on any hit)
 *   node scripts/production-artefact-check.js --root <dir>  # scan a fixture tree (spec only)
 *   node scripts/production-artefact-check.js --update      # rewrite the Tier-B baseline
 */
'use strict';

const { existsSync, readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { join, relative, resolve, sep } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');

/** The source of the three shipped artefacts. Asserted by the gate spec. */
const SCAN_ROOTS = ['apps/web/src', 'apps/api/src', 'apps/worker/src'];

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const EXCLUDED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '__tests__', '__fixtures__']);
const EXCLUDED_FILE = /\.(spec|test)\.(ts|tsx|js|jsx|mjs|cjs)$/;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const update = argv.includes('--update');
const rootFlag = argv.indexOf('--root');
const scanBase = rootFlag === -1 ? REPO_ROOT : resolve(argv[rootFlag + 1] || '');
const isFixtureRun = rootFlag !== -1;

/**
 * Resolved against the scanned tree, not against `__dirname`, so the Tier-B
 * ratchet is the SAME code path in the gate and in the spec's fixture run. A
 * ratchet only ever exercised against the repository would be a ratchet nobody
 * has ever seen fail.
 */
const BASELINE_PATH = join(scanBase, 'scripts', 'production-artefact-baseline.json');

if (rootFlag !== -1 && !argv[rootFlag + 1]) {
  console.error('production-artefact-check: --root requires a directory.');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * A quoted dev-service URL used as a `??` / `||` configuration fallback.
 * This is the Tier-B measurement AND the carve-out that keeps rule A6 from
 * double-reporting an inventoried line.
 */
const TIER_B = /(?:\?\?|\|\|)\s*['"`][a-z][a-z0-9+.-]*:\/\/(?:localhost|127\.0\.0\.1)/gi;

const SEED_IDENTITIES = /(Sophie Dupont|M\. Lefebvre|mme\.dupont@voltaire\.fr|voltaire-demo|Demo!2024Pilotage|Changeme123!)/g;

/**
 * `scope`  — 'web' (apps/web/src), 'server' (apps/api|worker/src), 'any'
 * `where`  — 'raw' (the whole file, comments included)
 *            'code' (comments blanked, string literals preserved)
 *            'strings' (string-literal contents only)
 */
const TIER_A_RULES = [
  {
    id: 'A1',
    scope: 'web',
    where: 'raw',
    pattern: /maildev/gi,
    why: 'apps/web is the artefact users actually read — a dev mail catcher must not be named anywhere in it, comments included.',
  },
  {
    id: 'A2',
    scope: 'server',
    where: 'strings',
    pattern: /maildev/gi,
    why: 'a Maildev hostname inside a string literal is a compose service name compiled into the server artefact. Doc comments that EXPLAIN Maildev are accurate and deliberately not matched.',
  },
  {
    id: 'A3',
    scope: 'any',
    where: 'raw',
    pattern: /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]):1080\b/gi,
    why: 'the Maildev web UI. Never legitimate in application source — not even behind a configuration fallback.',
  },
  {
    id: 'A4',
    scope: 'any',
    where: 'raw',
    pattern: SEED_IDENTITIES,
    why: 'a demonstration seed identity or password hard-coded into shipped source (PF-17).',
  },
  {
    id: 'A5',
    scope: 'any',
    where: 'code',
    pattern:
      /(?:process\.env\.[A-Z0-9_]+|(?:config|configService)\.get(?:<[^>]*>)?\(\s*['"][A-Z0-9_]+['"]\s*\))\s*(?:\?\?|\|\|)\s*['"`](admin|password|changeme|secret|root)['"`]/gi,
    why: 'a configuration read falling back to a default credential. The API must refuse to start instead (S-E06-1 / PF-54).',
  },
  {
    id: 'A6',
    scope: 'any',
    where: 'code',
    pattern: /(?:localhost|127\.0\.0\.1):(?:8025|9000|9001|5432|6379)\b/gi,
    exemptWhenTierB: true,
    why: 'a hard-coded dev-service address (mail catcher, MinIO, Postgres, Redis) with no configuration override.',
  },
];

// ---------------------------------------------------------------------------
// Source analysis
// ---------------------------------------------------------------------------

/**
 * Split each line into `code` (comments blanked out) and `strings` (string
 * literal contents only), so a rule can distinguish "a hostname compiled into
 * the artefact" from "a comment that accurately documents the dev stack".
 *
 * Deliberately a small state machine rather than a parser: single- and
 * double-quoted strings reset at end of line, so a regex literal containing a
 * stray quote can confuse at most one line instead of the rest of the file.
 */
function analyse(source) {
  const lines = source.split(/\r?\n/);
  const analysed = [];
  let inBlockComment = false;
  let inTemplate = false;

  for (const line of lines) {
    let code = '';
    let strings = '';
    let quote = inTemplate ? '`' : null;
    let i = 0;

    while (i < line.length) {
      const c = line[i];

      if (inBlockComment) {
        if (c === '*' && line[i + 1] === '/') {
          inBlockComment = false;
          code += '  ';
          strings += '  ';
          i += 2;
          continue;
        }
        code += ' ';
        strings += ' ';
        i += 1;
        continue;
      }

      if (quote) {
        if (c === '\\') {
          code += line.slice(i, i + 2).padEnd(2, ' ');
          strings += '  ';
          i += 2;
          continue;
        }
        if (c === quote) {
          if (c === '`') inTemplate = false;
          quote = null;
          code += c;
          strings += ' ';
          i += 1;
          continue;
        }
        code += c;
        strings += c;
        i += 1;
        continue;
      }

      if (c === '/' && line[i + 1] === '/') {
        const blank = ' '.repeat(line.length - i);
        code += blank;
        strings += blank;
        break;
      }
      if (c === '/' && line[i + 1] === '*') {
        inBlockComment = true;
        code += '  ';
        strings += '  ';
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        quote = c;
        if (c === '`') inTemplate = true;
        code += c;
        strings += ' ';
        i += 1;
        continue;
      }

      code += c;
      strings += ' ';
      i += 1;
    }

    // An unterminated ' or " is a misparse (most often a regex literal), not a
    // multi-line string: reset so the damage stops at this line.
    if (quote && quote !== '`') inTemplate = false;

    analysed.push({ raw: line, code, strings });
  }

  return analysed;
}

function matchesOf(text, pattern) {
  pattern.lastIndex = 0;
  const found = [];
  let m;
  while ((m = pattern.exec(text)) !== null) {
    found.push(m[0]);
    if (m.index === pattern.lastIndex) pattern.lastIndex += 1;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function walk(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), acc);
      continue;
    }
    if (!entry.isFile()) continue;
    if (EXCLUDED_FILE.test(entry.name)) continue;
    if (!SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    acc.push(join(dir, entry.name));
  }
  return acc;
}

/**
 * The directories to walk.
 *
 * Under the real repository root a missing root is a FAILURE, never a skip:
 * "the source tree is not there and nothing minds" is the shape of defect this
 * gate exists to refuse. Under an explicit `--root` fixture the tree is
 * synthetic, so the fixture directory itself is scanned.
 */
function resolveScanDirs() {
  const dirs = SCAN_ROOTS.map((rel) => ({ rel, abs: join(scanBase, rel) })).filter((d) =>
    existsSync(d.abs),
  );

  if (isFixtureRun) {
    if (dirs.length > 0) return dirs;
    if (!existsSync(scanBase) || !statSync(scanBase).isDirectory()) {
      console.error(`production-artefact-check: no directory at ${scanBase}`);
      process.exit(2);
    }
    return [{ rel: '.', abs: scanBase }];
  }

  const missing = SCAN_ROOTS.filter((rel) => !existsSync(join(scanBase, rel)));
  if (missing.length > 0) {
    console.error(`✗ no source tree at ${missing.join(', ')} — the scan roots must exist for this gate to mean anything.`);
    process.exit(1);
  }
  return dirs;
}

function scopeOf(relPath) {
  const p = relPath.split(sep).join('/');
  return /(^|\/)apps\/(api|worker)\//.test(p) || /(^|\/)(api|worker)\/src\//.test(p) ? 'server' : 'web';
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const scanDirs = resolveScanDirs();
const files = [];
for (const dir of scanDirs) walk(dir.abs, files);

if (files.length === 0) {
  console.error(`✗ scanned ${scanDirs.length} root(s) and found 0 files. A scan over nothing is not a pass.`);
  process.exit(1);
}

const tierAHits = [];
/** @type {Record<string, number>} */
const tierBCounts = {};

for (const abs of files) {
  const relPath = relative(scanBase, abs).split(sep).join('/');
  const scope = scopeOf(relPath);
  const source = readFileSync(abs, 'utf8');
  const analysed = analyse(source);

  analysed.forEach((line, index) => {
    const lineNo = index + 1;
    const tierBOnThisLine = matchesOf(line.code, TIER_B).length;
    if (tierBOnThisLine > 0) {
      tierBCounts[relPath] = (tierBCounts[relPath] || 0) + tierBOnThisLine;
    }

    for (const rule of TIER_A_RULES) {
      if (rule.scope !== 'any' && rule.scope !== scope) continue;
      if (rule.exemptWhenTierB && tierBOnThisLine > 0) continue;
      const text = line[rule.where];
      for (const matched of matchesOf(text, rule.pattern)) {
        tierAHits.push({ file: relPath, line: lineNo, rule, matched: matched.trim() });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`production-artefact-check: ${files.length} file(s) across ${scanDirs.map((d) => d.rel).join(', ')}`);

if (tierAHits.length > 0) {
  console.error(`\n✗ Tier A — ${tierAHits.length} development artefact(s) in production-facing source:\n`);
  for (const hit of tierAHits) {
    console.error(`    ${hit.file}:${hit.line}  [${hit.rule.id}] ${hit.matched}`);
  }
  const rules = [...new Set(tierAHits.map((h) => h.rule.id))];
  console.error('');
  for (const id of rules) {
    const rule = TIER_A_RULES.find((r) => r.id === id);
    console.error(`    ${id}: ${rule.why}`);
  }
}

// ---------------------------------------------------------------------------
// Tier B ratchet
// ---------------------------------------------------------------------------

const tierBProblems = [];

{
  const baseline = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    : { $schema: 'production-artefact-baseline', files: {} };
  baseline.files = baseline.files || {};

  if (update) {
    // The rule `web-artifact-check.js` and `boot-check.js` both learned the hard
    // way: never freeze a broken tree into the reviewed inventory.
    if (tierAHits.length > 0) {
      console.error('\n✗ refusing to write the baseline: Tier A is failing. Fix the artefacts first — a baseline taken from a broken tree would bless it forever.');
      process.exit(1);
    }
    const next = {};
    for (const file of Object.keys(tierBCounts).sort()) {
      next[file] = tierBCounts[file];
    }
    baseline.files = next;
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    const total = Object.values(next).reduce((a, b) => a + b, 0);
    console.log(`production-artefact-check: Tier-B baseline updated — ${total} fallback(s) across ${Object.keys(next).length} file(s).`);
    process.exit(0);
  }

  for (const [file, count] of Object.entries(tierBCounts)) {
    const ceiling = baseline.files[file];
    if (ceiling === undefined) {
      tierBProblems.push(
        `${file}: ${count} dev-URL fallback(s) but absent from the Tier-B baseline. Remove them, or add the file (--update) — no escape by omission.`,
      );
      continue;
    }
    if (count > ceiling) {
      tierBProblems.push(
        `${file}: ${count} dev-URL fallback(s) exceeds the baseline of ${ceiling} (+${count - ceiling}). Adding one back is the finding, not a new one.`,
      );
    }
  }
  for (const [file, ceiling] of Object.entries(baseline.files)) {
    const count = tierBCounts[file] || 0;
    if (count < ceiling) {
      tierBProblems.push(
        `${file}: ${count} dev-URL fallback(s) is BELOW the baseline of ${ceiling}. Lower it to ${count} (or run --update). The ratchet only turns one way.`,
      );
    }
  }

  const total = Object.values(tierBCounts).reduce((a, b) => a + b, 0);
  const allowed = Object.values(baseline.files).reduce((a, b) => a + b, 0);
  console.log(`production-artefact-check: Tier B — ${total} inventoried dev-URL fallback(s) · ${allowed} allowed`);
}

if (tierBProblems.length > 0) {
  console.error(`\n✗ Tier B — ${tierBProblems.length} ratchet problem(s):\n`);
  for (const p of tierBProblems) console.error(`    ${p}`);
}

if (tierAHits.length > 0 || tierBProblems.length > 0) {
  console.error('\nPRODUCTION ARTEFACT CHECK: FAIL');
  process.exit(1);
}

console.log('\n✓ production-artefact-check: no development artefact in production-facing source.');
