#!/usr/bin/env node
/**
 * runtime-engines-check.js — the gate over the runtime this repository *claims*
 * to support (PF-73).
 *
 * WHY THIS EXISTS
 * ---------------
 * `engines.node` is a support declaration that nothing in this repository ever
 * checked. It said `>=20.0.0`, and on Node 20.0–20.18 the API **cannot start**:
 * `apps/api/src/shared/auth/jwt.strategy.ts` imports `jwks-rsa` at module top
 * level, `jwks-rsa@4`'s `src/utils.js` does a CommonJS `require('jose')`, and
 * `jose@6` is ESM-only (`"type": "module"`, `main: ./dist/webapi/index.js`, whose
 * first line is `export {…}`). `require()` of an ESM graph is available only from
 * Node 20.19 / 22.12. `AuthModule` is on the boot path via `AlertsModule`, so the
 * whole application dies before its first request.
 *
 * That is the same shape as every other finding this epic has closed — `PF-69`
 * (a directory in no gate), `PF-70` (a stage that never ran), `PF-72` (a build
 * that emitted nothing), `PF-74` (an artefact nothing inspected): **a statement
 * nobody verified.** The one-line fix to `engines.node` would have replaced one
 * unverified statement with another, so this file makes the statement checkable
 * instead.
 *
 * WHAT THE MEASUREMENT ACTUALLY SHOWED
 * ------------------------------------
 * Every installed package's own `engines.node` was read (671 of the 1294 declare
 * one) and probed. The finding's proposed fix, `>=22.12.0`, is wrong in **both**
 * directions:
 *
 *   • it **excludes** Node 20.19.x, which every installed dependency accepts —
 *     `require(esm)` was backported there, and `jwks-rsa@4.0.1` says so itself:
 *     `"node": "^20.19.0 || ^22.12.0 || >= 23.0.0"`;
 *   • it **blesses** 22.12.x and 23.x, which `eslint-visitor-keys` excludes
 *     (`"^20.19.0 || ^22.13.0 || >=24"`).
 *
 * The versions accepted by the whole installed set are 20.19.x · 22.13.x · ≥24.
 * What this repository *declares* is the narrower `^22.13.1 || >=24.0.0`, because
 * `engines` is a **support** statement, not a compatibility one: 22.13.1 is what
 * the three Dockerfiles build and ship, and ≥24 is what local development runs
 * on. Node 20.19 is compatible-but-untested, and saying so is the point.
 *
 * WHAT IT CHECKS
 * --------------
 *   1. every Node version blessed by `engines.node` is accepted by every
 *      installed dependency's own `engines.node`  — the assertion that would have
 *      caught PF-73 the day it was written, and that catches the *next* bump
 *      which raises a floor;
 *   2. every Node pin in the repository (`.nvmrc`, the three `ARG NODE_VERSION`
 *      defaults, `ci.yml`'s `NODE_VERSION`) is a **concrete** version, satisfies
 *      `engines.node`, and agrees with the others;
 *   3. `packageManager`'s pnpm version satisfies `engines.pnpm`, and the declared
 *      floor is inside the pinned major;
 *   4. `ci.yml`'s `PNPM_VERSION` equals the `packageManager` pin;
 *   5. the Node actually running the gate satisfies `engines.node`.
 *
 * (2) is not pedantry. `.nvmrc` said `22` and `ci.yml` said `'22'` — a floating
 * major that *resolves* to the newest 22.x today, but whose declared meaning
 * includes 22.0–22.11, the window in which the API provably cannot boot. A pin
 * that is only safe because of how a resolver happens to behave is the same
 * unverified statement one level down.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not start Node 20 and watch the API fail. That needs a second runtime
 * the gate does not have, so the boot failure below 20.19 stays **inferred** from
 * the packaging (which *was* read directly) rather than executed — stated here
 * and in the epic ledger rather than papered over. What is executed is the
 * arithmetic over declared ranges, which is what the declaration is.
 *
 * There is no bypass flag (DNC-10). The reviewed record is `engines` in
 * `package.json` itself, so widening support always shows up in the diff; there
 * is no `--update` that could quietly accept a regression.
 *
 * USAGE
 *   node scripts/runtime-engines-check.js
 */
'use strict';

const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const semver = require('semver');

const REPO_ROOT = resolve(__dirname, '..');

/* ------------------------------------------------------------------ *
 * Reading what the repository declares
 * ------------------------------------------------------------------ */

function readText(path) {
  return readFileSync(path, 'utf8');
}

/**
 * The `ARG NODE_VERSION=<v>` default of every Dockerfile under infra/docker.
 *
 * Discovered from the filesystem rather than from a list, for the reason
 * `boot-check.js` and `web-artifact-check.js` both discover their subjects: a
 * list an artefact can quietly omit itself from is how `PF-69` and `PF-70`
 * happened. A fourth Dockerfile added tomorrow is covered without anyone
 * remembering to add it here.
 */
function readDockerfilePins() {
  const dir = join(REPO_ROOT, 'infra', 'docker');
  const pins = [];
  if (!existsSync(dir)) return pins;
  for (const name of readdirSync(dir).sort()) {
    if (!name.startsWith('Dockerfile')) continue;
    const source = `infra/docker/${name}`;
    const match = /^ARG\s+NODE_VERSION=(\S+)\s*$/m.exec(readText(join(dir, name)));
    // A Dockerfile that stopped declaring the ARG is reported, never skipped:
    // silence would mean the image floats to whatever `node:` tag resolves to.
    pins.push({ source, value: match ? match[1] : null });
  }
  return pins;
}

function readWorkflowEnv(key) {
  const path = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
  if (!existsSync(path)) return null;
  const match = new RegExp(`^\\s{2}${key}:\\s*'?([^'\\s#]+)'?\\s*$`, 'm').exec(readText(path));
  return match ? match[1] : null;
}

/**
 * Every installed package that declares `engines.node`, read from pnpm's virtual
 * store — i.e. the dependency set the lockfile actually resolves, not the subset
 * someone remembered to list.
 */
function readInstalledEngineRanges() {
  const store = join(REPO_ROOT, 'node_modules', '.pnpm');
  if (!existsSync(store)) return null;

  const found = new Map();
  const collect = (base, depth) => {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const dir = join(base, entry.name);
      if (entry.name.startsWith('@') && depth === 0) {
        try {
          collect(dir, 1);
        } catch {
          /* a broken store link is not this gate's subject */
        }
        continue;
      }
      const manifest = join(dir, 'package.json');
      if (!existsSync(manifest)) continue;
      try {
        const pkg = JSON.parse(readText(manifest));
        if (pkg.name && pkg.engines && typeof pkg.engines.node === 'string') {
          found.set(`${pkg.name}@${pkg.version}`, {
            name: pkg.name,
            version: pkg.version,
            range: pkg.engines.node,
          });
        }
      } catch {
        /* an unparseable manifest in the store is not this gate's subject */
      }
    }
  };

  for (const entry of readdirSync(store)) {
    const nested = join(store, entry, 'node_modules');
    if (!existsSync(nested)) continue;
    try {
      collect(nested, 0);
    } catch {
      /* ditto */
    }
  }
  return [...found.values()];
}

/* ------------------------------------------------------------------ *
 * The evaluation — pure, so the spec can drive it with synthetic input
 * ------------------------------------------------------------------ */

/**
 * @param {object} input
 * @param {string}   input.declaredNode      root `engines.node`
 * @param {string}   input.declaredPnpm      root `engines.pnpm`
 * @param {string}   input.packageManager    root `packageManager` (e.g. `pnpm@9.12.3`)
 * @param {Array<{source: string, value: string|null}>} input.nodePins
 * @param {string|null} input.workflowPnpmVersion
 * @param {Array<{name: string, version: string, range: string}>|null} input.dependencyRanges
 * @param {string}   input.runningNode       e.g. `v22.13.1`
 * @returns {{problems: string[], notes: string[]}}
 */
function evaluateRuntimeSupport(input) {
  const problems = [];
  const notes = [];

  const { declaredNode, declaredPnpm, packageManager, nodePins, workflowPnpmVersion } = input;

  /* --- the declaration itself must be a usable range --------------- */

  if (!declaredNode || semver.validRange(declaredNode) === null) {
    problems.push(
      `package.json engines.node is not a valid semver range: ${JSON.stringify(declaredNode)}`,
    );
    // Everything below compares against it, so there is nothing further to say.
    return { problems, notes };
  }

  /* --- (1) the declaration must not bless a runtime a dependency refuses --- */

  if (input.dependencyRanges === null) {
    problems.push(
      'node_modules/.pnpm is missing — the dependency set cannot be read.\n' +
        '        This is a failure, not a skip: with no dependencies to compare against,\n' +
        '        every check below would pass vacuously. Run `pnpm install` first.',
    );
  } else {
    const unparseable = [];
    const conflicting = [];
    for (const dep of input.dependencyRanges) {
      if (semver.validRange(dep.range) === null) {
        unparseable.push(`${dep.name}@${dep.version} "${dep.range}"`);
        continue;
      }
      if (!semver.subset(declaredNode, dep.range, { loose: true })) {
        conflicting.push(dep);
      }
    }
    if (unparseable.length > 0) {
      notes.push(
        `${unparseable.length} installed package(s) declare an unparseable engines.node and were ` +
          `not compared: ${unparseable.slice(0, 5).join(', ')}${unparseable.length > 5 ? ', …' : ''}`,
      );
    }
    if (conflicting.length > 0) {
      problems.push(
        `engines.node "${declaredNode}" blesses Node versions that ${conflicting.length} installed ` +
          `dependenc${conflicting.length === 1 ? 'y' : 'ies'} refuse.\n` +
          '        This is PF-73 exactly: a supported-runtime claim that a dependency contradicts.\n' +
          conflicting
            .map((d) => `          - ${d.name}@${d.version} requires "${d.range}"`)
            .join('\n'),
      );
    } else {
      notes.push(
        `engines.node "${declaredNode}" is a subset of all ${input.dependencyRanges.length} ` +
          'installed engines.node ranges',
      );
    }
  }

  /* --- (2) every pin must be concrete, in range, and agree ---------- */

  const concrete = [];
  for (const pin of nodePins) {
    if (pin.value === null) {
      problems.push(`${pin.source} declares no Node version — the runtime there is unpinned`);
      continue;
    }
    const parsed = semver.valid(pin.value);
    if (parsed === null) {
      problems.push(
        `${pin.source} pins Node "${pin.value}", which is not a concrete version.\n` +
          '        A floating pin is only safe because of how a resolver happens to behave today:\n' +
          `        "22" declares 22.0.0-22.99.x, and the API cannot boot below 22.12 (jose@6 is\n` +
          '        ESM-only and jwks-rsa require()s it). Pin the exact version the images ship.',
      );
      continue;
    }
    concrete.push({ ...pin, value: parsed });
    if (!semver.satisfies(parsed, declaredNode)) {
      problems.push(
        `${pin.source} pins Node ${parsed}, which does NOT satisfy engines.node "${declaredNode}"`,
      );
    }
  }

  const distinct = [...new Set(concrete.map((p) => p.value))];
  if (distinct.length > 1) {
    problems.push(
      `the repository pins ${distinct.length} different Node versions; they must agree so there is ` +
        'one place to change:\n' +
        concrete.map((p) => `          - ${p.source}: ${p.value}`).join('\n'),
    );
  } else if (distinct.length === 1) {
    notes.push(`all ${concrete.length} Node pins agree on ${distinct[0]}`);
  }

  /* --- (3)/(4) pnpm ------------------------------------------------- */

  const pmMatch = /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageManager || '');
  if (!pmMatch) {
    problems.push(
      `package.json packageManager is ${JSON.stringify(packageManager)} — expected \`pnpm@x.y.z\``,
    );
  } else {
    const pinned = pmMatch[1];
    if (!declaredPnpm || semver.validRange(declaredPnpm) === null) {
      problems.push(
        `package.json engines.pnpm is not a valid semver range: ${JSON.stringify(declaredPnpm)}`,
      );
    } else {
      if (!semver.satisfies(pinned, declaredPnpm)) {
        problems.push(
          `packageManager pins pnpm ${pinned}, which does not satisfy engines.pnpm "${declaredPnpm}"`,
        );
      }
      // The floor must sit inside the pinned major. `>=8.0.0` alongside
      // `pnpm@9.12.3` blessed a pnpm that never produced this lockfile —
      // pnpm 8 writes lockfileVersion 6.0, and this repository's is 9.0.
      const floor = semver.minVersion(declaredPnpm);
      if (floor && semver.major(floor) !== semver.major(pinned)) {
        problems.push(
          `engines.pnpm "${declaredPnpm}" allows pnpm ${floor.version}, a different major from the ` +
            `packageManager pin (${pinned}).\n` +
            '        A pnpm major that never produced this lockfile cannot be a supported one.',
        );
      }
    }
    if (workflowPnpmVersion === null) {
      problems.push('.github/workflows/ci.yml declares no PNPM_VERSION');
    } else if (workflowPnpmVersion !== pinned) {
      problems.push(
        `ci.yml PNPM_VERSION is ${workflowPnpmVersion} but packageManager pins ${pinned} — ` +
          'CI would install a pnpm the repository does not pin',
      );
    }
  }

  /* --- (5) the gate must itself be running on a supported runtime --- */

  const running = semver.valid(semver.coerce(input.runningNode));
  if (running === null) {
    problems.push(`cannot parse the running Node version: ${JSON.stringify(input.runningNode)}`);
  } else if (!semver.satisfies(running, declaredNode)) {
    problems.push(
      `this gate is running on Node ${running}, which does not satisfy engines.node ` +
        `"${declaredNode}".\n` +
        '        Every stage downstream was therefore validated on an unsupported runtime.',
    );
  } else {
    notes.push(`the running Node (${running}) satisfies engines.node`);
  }

  return { problems, notes };
}

/* ------------------------------------------------------------------ *
 * Gate
 * ------------------------------------------------------------------ */

function collectFromRepo() {
  const pkg = JSON.parse(readText(join(REPO_ROOT, 'package.json')));
  const nvmrcPath = join(REPO_ROOT, '.nvmrc');

  const nodePins = [
    {
      source: '.nvmrc',
      value: existsSync(nvmrcPath) ? readText(nvmrcPath).trim() || null : null,
    },
    ...readDockerfilePins(),
    { source: '.github/workflows/ci.yml NODE_VERSION', value: readWorkflowEnv('NODE_VERSION') },
  ];

  return {
    declaredNode: pkg.engines && pkg.engines.node,
    declaredPnpm: pkg.engines && pkg.engines.pnpm,
    packageManager: pkg.packageManager,
    nodePins,
    workflowPnpmVersion: readWorkflowEnv('PNPM_VERSION'),
    dependencyRanges: readInstalledEngineRanges(),
    runningNode: process.version,
  };
}

function main() {
  const input = collectFromRepo();
  console.log(`▶ declared runtime: node "${input.declaredNode}", pnpm "${input.declaredPnpm}"`);
  console.log(
    `▶ dependency set   : ${
      input.dependencyRanges === null
        ? 'NOT INSTALLED'
        : `${input.dependencyRanges.length} packages declare engines.node`
    }`,
  );

  const { problems, notes } = evaluateRuntimeSupport(input);

  for (const note of notes) console.log(`  · ${note}`);

  if (problems.length > 0) {
    console.error('');
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error('');
    console.error(`RUNTIME ENGINES CHECK: FAIL (${problems.length} problem(s))`);
    process.exit(1);
  }

  console.log('');
  console.log('RUNTIME ENGINES CHECK: PASS');
}

module.exports = { evaluateRuntimeSupport, collectFromRepo };

if (require.main === module) main();
