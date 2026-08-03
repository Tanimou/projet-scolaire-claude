#!/usr/bin/env node
/**
 * Lint-warning ratchet — the second half of the S-E02-7 lint gate (PF-71).
 *
 * WHY THIS EXISTS
 * ---------------
 * `S-E02-7` made the `lint` stage execute for the first time. Turning it on
 * revealed **996 warnings** that had accumulated invisibly, because no package
 * had loaded an ESLint config since the v9 bump. Warnings do not fail a build,
 * so the stage was honestly green and the debt was honestly unmeasured — and it
 * would have drifted straight back up.
 *
 * This is the same shape as `test-ratchet.js`, applied to lint:
 *
 *   • warnings ABOVE a package's ceiling  → FAIL (you added debt)
 *   • warnings BELOW a package's ceiling  → FAIL (lower the ceiling; a ratchet
 *                                           that never tightens is a rubber band)
 *   • any ESLint *error*                  → FAIL (errors were never tolerated)
 *   • a lintable package missing from the
 *     baseline                            → FAIL (no silent escape)
 *
 * The last rule matters most. `apps/api/prisma/` (PF-69) and, before it, seven
 * of eight packages (PF-70) escaped the gate simply by not being looked at. A
 * ceiling list that a new package can quietly omit itself from would reproduce
 * that exact failure at a new address.
 *
 * WHAT THE CEILING IS NOT
 * -----------------------
 * It is not permission to keep the remaining warnings. Every entry is debt with
 * a name; `docs/spec/features/v3-e02/PROGRESS.md` records what each one is and
 * why it was not fixed in the cut that created the baseline.
 *
 * USAGE
 *   node scripts/lint-ratchet.js             # gate (exit 1 on drift)
 *   node scripts/lint-ratchet.js --update    # rewrite the baseline to measured
 */
'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const REPO_ROOT = resolve(__dirname, '..');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'lint-warning-baseline.json');
const WORKSPACE_DIRS = ['apps', 'packages'];

const update = process.argv.includes('--update');

/**
 * Every workspace package that declares a `lint` script.
 *
 * Discovery is from the filesystem, not from the baseline, so that adding a
 * package cannot add an unmeasured blind spot: an undeclared package fails the
 * gate rather than passing it by omission.
 */
function discoverLintablePackages() {
  const found = [];
  for (const group of WORKSPACE_DIRS) {
    const groupDir = join(REPO_ROOT, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      const pkgJson = join(groupDir, name, 'package.json');
      if (!existsSync(pkgJson)) continue;
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(pkgJson, 'utf8'));
      } catch {
        continue;
      }
      if (!pkg.scripts || !pkg.scripts.lint) continue;
      found.push({ id: `${group}/${name}`, dir: join(groupDir, name), script: pkg.scripts.lint });
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Run ESLint over a package and return its counts.
 *
 * The report goes to a file rather than stdout: the JSON for `apps/web` is large
 * enough that piping it through a shell argument list fails on Windows.
 */
function runEslint(pkg) {
  // Resolved by walking `node_modules` rather than with `require.resolve`:
  // ESLint 9 ships an `exports` map that does not expose `./bin/eslint.js`, so
  // the subpath form throws ERR_PACKAGE_PATH_NOT_EXPORTED even when the file is
  // sitting right there. Nearest-first so a package-local install wins over the
  // hoisted root one.
  const eslintBin = [pkg.dir, REPO_ROOT]
    .map((base) => join(base, 'node_modules', 'eslint', 'bin', 'eslint.js'))
    .find((candidate) => existsSync(candidate));

  if (!eslintBin) {
    console.error(`lint-ratchet: eslint is not installed for ${pkg.id}. Run \`pnpm install\` first.`);
    process.exit(2);
  }

  const scratch = mkdtempSync(join(tmpdir(), 'lint-ratchet-'));
  const outFile = join(scratch, 'eslint.json');
  const res = spawnSync(process.execPath, [eslintBin, '.', '-f', 'json', '-o', outFile], {
    cwd: pkg.dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!existsSync(outFile)) {
    console.error(`lint-ratchet: eslint produced no report for ${pkg.id}. It probably failed to start.`);
    console.error(res.stderr || res.stdout || '(no output)');
    rmSync(scratch, { recursive: true, force: true });
    process.exit(2);
  }

  const report = JSON.parse(readFileSync(outFile, 'utf8'));
  rmSync(scratch, { recursive: true, force: true });

  let errors = 0;
  let warnings = 0;
  const byRule = {};
  for (const file of report) {
    errors += file.errorCount;
    warnings += file.warningCount;
    for (const m of file.messages) {
      if (m.severity !== 1) continue;
      const rule = m.ruleId || '(directive)';
      byRule[rule] = (byRule[rule] || 0) + 1;
    }
  }
  return { errors, warnings, byRule };
}

const packages = discoverLintablePackages();
if (packages.length === 0) {
  console.error('lint-ratchet: found no workspace package with a `lint` script. Refusing to report a vacuous pass.');
  process.exit(2);
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { $schema: 'lint-warning-baseline', packages: {} };
baseline.packages = baseline.packages || {};

const measured = [];
for (const pkg of packages) {
  const result = runEslint(pkg);
  measured.push({ ...pkg, ...result });
}

if (update) {
  const next = {};
  for (const m of measured) {
    const previous = baseline.packages[m.id] || {};
    next[m.id] = {
      maxWarnings: m.warnings,
      // Informational only — never enforced. Refreshed on every --update so it
      // cannot go stale while claiming to describe the current ceiling.
      rules: m.byRule,
      note: previous.note || (m.warnings === 0 ? 'clean' : 'TODO: describe this debt and give it an owner'),
    };
  }
  baseline.packages = next;
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  const total = measured.reduce((sum, m) => sum + m.warnings, 0);
  console.log(`lint-ratchet: baseline updated — ${total} warning(s) across ${measured.length} package(s).`);
  process.exit(0);
}

const problems = [];
let totalWarnings = 0;
let totalCeiling = 0;

for (const m of measured) {
  const entry = baseline.packages[m.id];
  totalWarnings += m.warnings;

  if (!entry) {
    problems.push(
      `${m.id}: lintable but absent from the baseline. Add it (or run --update) — a package must not escape the gate by omission.`
    );
    continue;
  }

  const ceiling = entry.maxWarnings;
  totalCeiling += ceiling;

  console.log(
    `lint-ratchet[${m.id}]: ${m.warnings} warning(s) · ceiling ${ceiling} · ${m.errors} error(s)`
  );

  if (m.errors > 0) {
    problems.push(`${m.id}: ${m.errors} ESLint error(s). Errors are never tolerated by this gate.`);
  }
  if (m.warnings > ceiling) {
    const top = Object.entries(m.byRule)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([r, c]) => `${r} (${c})`)
      .join(', ');
    problems.push(
      `${m.id}: ${m.warnings} warnings exceeds the ceiling of ${ceiling} (+${m.warnings - ceiling}). Top rules: ${top || 'n/a'}. Fix them — raising the ceiling is not a fix.`
    );
  }
  if (m.warnings < ceiling) {
    problems.push(
      `${m.id}: ${m.warnings} warnings is BELOW the ceiling of ${ceiling}. Lower it to ${m.warnings} (or run --update). The ratchet only turns one way.`
    );
  }
}

// A baseline entry for a package that no longer lints is stale bookkeeping: it
// inflates the headline ceiling and hides a package that was removed or lost its
// lint script.
for (const id of Object.keys(baseline.packages)) {
  if (!measured.some((m) => m.id === id)) {
    problems.push(`${id}: present in the baseline but no longer a lintable package. Remove the entry (or run --update).`);
  }
}

console.log(`\nlint-ratchet: ${totalWarnings} warning(s) total · ${totalCeiling} allowed`);

if (problems.length) {
  console.error(`\n✗ ${problems.length} lint-ratchet problem(s):\n`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

console.log('\n✓ lint-ratchet: no drift.');
