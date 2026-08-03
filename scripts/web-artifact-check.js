#!/usr/bin/env node
/**
 * web-artifact-check.js — the gate that looks at the Next.js build output (R-25).
 *
 * WHY THIS EXISTS
 * ---------------
 * `scripts/boot-check.js` (S-E02-9) closed the "nothing starts the app" gap for
 * the two NestJS applications. It cannot cover `apps/web`: its discovery is
 * `apps/*` containing `src/app.module.ts`, and Next.js has no module graph to
 * construct. So the third artefact of a three-artefact deployment had **no
 * build-output assertion of any kind**.
 *
 * Measured before writing this file, not assumed: with `apps/web/.next` deleted
 * in its entirety, `node scripts/boot-check.js` returned **exit 0**
 * ("BOOT CHECK: PASS"), and no other stage of `scripts/ci-gate.sh` reads `.next`
 * at all — `grep -rn '\.next' scripts/` returned nothing. The whole web build
 * could vanish and the gate stayed green.
 *
 * That is R-25 — "a build reports success while emitting nothing" — at the one
 * address the R-25 mitigation explicitly did not reach. The Nest half of R-25 was
 * not hypothetical when it was found (`PF-72`: the worker emitted 0 files at
 * exit 0, and turbo cached the empty `dist/**` as a successful output and
 * replayed it). turbo caches `.next/**` under exactly the same rule.
 *
 * WHAT IT CHECKS, AND WHICH DEFECT EACH CHECK IS FOR
 * --------------------------------------------------
 *   1. `.next/BUILD_ID` exists and is non-empty        — the build ran at all.
 *   2. the app-router route inventory matches a reviewed baseline
 *                                                      — the PF-62 shape: a page
 *      or route handler that silently stopped being emitted. New routes fail too,
 *      because the inventory is a reviewed record of what the artefact exposes.
 *   3. every route in the manifest has its emitted server file on disk
 *                                                      — a manifest that promises
 *      a route while nothing was written is the per-route form of "emits nothing".
 *   4. `.next/static` is non-empty                     — the Dockerfile copies it;
 *      without it every page renders unstyled and scriptless.
 *   5. when the resolved config says `output: 'standalone'`, the standalone
 *      server entrypoint exists                        — `Dockerfile.web` runs
 *      `node apps/web/server.js` from it. Absent, the image has no entrypoint.
 *   6. routes declared `mustBeDynamic` in the baseline are **not** prerendered
 *                                                      — see below.
 *
 * WHY (6) IS HERE AND NOT SOMEWHERE MORE OBVIOUS
 * ----------------------------------------------
 * `apps/web/src/app/version/web/route.ts` is the web third of the release gate
 * (S-E02-10, R-05). Its own header states the invariant:
 *
 *   « `force-dynamic` est obligatoire : pré-rendu au build, le manifeste figerait
 *     le SHA du build de page au lieu de lire l'environnement du conteneur — il
 *     décrirait un artefact au lieu de l'artefact qui tourne. »
 *
 * Nothing enforced it. Deleting one line of that file leaves the route present,
 * the build green, `scripts/release-gate.sh` still answering 200 — and the answer
 * describing the wrong thing. A release gate that can be silently turned into a
 * constant is worse than no release gate, because it reports confidence. This
 * check reads the **emitted** `prerender-manifest.json` rather than the source
 * directive, for the same reason `boot-check.js` reads `dist/`: the defect is in
 * the output, and the source is not the artefact that ships.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not start Next.js. Booting Next needs a listening port and, for most of
 * these 108 routes, a database and a Keycloak session behind them — which is the
 * cost the `.compile()`-not-`.init()` decision in `boot-check.js` avoids for the
 * same reason. So this proves the artefact **was produced and is complete**, not
 * that it serves correctly. That limit is real and is stated in the epic ledger
 * rather than papered over.
 *
 * There is no bypass flag (DNC-10). `--update` rewrites the reviewed inventory
 * and shows up in the diff; it is not a way to make a failure disappear, and it
 * refuses to run from a structurally broken artefact.
 *
 * USAGE
 *   node scripts/web-artifact-check.js            # gate (exit 1 on any failure)
 *   node scripts/web-artifact-check.js --update   # rewrite the route inventory
 */
'use strict';

const { existsSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve, sep } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'web-route-baseline.json');

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

const NEXT_CONFIG_NAMES = ['next.config.mjs', 'next.config.js', 'next.config.cjs', 'next.config.ts'];

/**
 * Every Next.js application in the workspace, discovered from the filesystem.
 *
 * Driven by the filesystem and **not** by the baseline, for the same reason
 * `boot-check.js` is: `PF-69` and `PF-70` were both "a thing no gate looked at",
 * and a list an application can quietly omit itself from reproduces that at a new
 * address. A second Next app added tomorrow fails this gate until it is entered
 * in the baseline deliberately.
 */
function discoverNextApps() {
  const appsDir = join(REPO_ROOT, 'apps');
  const found = [];
  for (const name of readdirSync(appsDir)) {
    const dir = join(appsDir, name);
    if (!NEXT_CONFIG_NAMES.some((f) => existsSync(join(dir, f)))) continue;
    found.push({ id: `apps/${name}`, dir });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------ *
 * Reading the emitted artefact
 * ------------------------------------------------------------------ */

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function countFilesRecursive(dir, limit = 1) {
  let seen = 0;
  const stack = [dir];
  while (stack.length > 0 && seen < limit) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) stack.push(join(current, entry.name));
      else if (++seen >= limit) break;
    }
  }
  return seen;
}

/**
 * Inspect one built Next application.
 *
 * Returns `{ routes, structural }` where `structural` lists defects that are not
 * a question of inventory drift — a missing BUILD_ID, an unemitted route file, an
 * absent standalone entrypoint. Those can never be accepted by `--update`.
 */
function inspect(app, baselineEntry) {
  const structural = [];
  const next = join(app.dir, '.next');

  if (!existsSync(next)) {
    // Not a skip. A missing build is the state in which every check below would
    // vacuously pass — which is precisely the R-25 shape this file exists for.
    structural.push(
      `no build output at ${rel(next)} — run \`pnpm build\` before the web artefact check`,
    );
    return { routes: [], structural };
  }

  // (1) The build ran at all.
  const buildIdPath = join(next, 'BUILD_ID');
  if (!existsSync(buildIdPath) || readFileSync(buildIdPath, 'utf8').trim() === '') {
    structural.push(`${rel(buildIdPath)} is missing or empty — the build emitted nothing usable`);
  }

  // (2)/(3) The route inventory, read off the emitted manifest.
  const manifestPath = join(next, 'app-path-routes-manifest.json');
  let routes = [];
  if (!existsSync(manifestPath)) {
    structural.push(`${rel(manifestPath)} is missing — no app-router routes were emitted`);
  } else {
    const manifest = readJson(manifestPath);
    const entries = Object.entries(manifest);
    if (entries.length === 0) {
      structural.push(`${rel(manifestPath)} is empty — the build emitted no routes`);
    }
    routes = entries.map(([, route]) => route).sort();

    // A manifest entry whose server file was never written is the per-route form
    // of "reports success, emits nothing". Cheap to check, and it is the only
    // check here that looks at the emitted code rather than at metadata about it.
    const unemitted = entries
      .filter(([key]) => !existsSync(join(next, 'server', 'app', `${key}.js`)))
      .map(([key, route]) => `${route}  (expected .next/server/app${key}.js)`);
    if (unemitted.length > 0) {
      structural.push(
        `${unemitted.length} route(s) are declared in the manifest but have no emitted server file:\n` +
          indent(unemitted.map((r) => `- ${r}`).join('\n'), 8),
      );
    }
  }

  // (4) Static assets. `Dockerfile.web` copies `.next/static` into the runtime
  // image; an empty one ships a site with no CSS and no client chunks.
  const staticDir = join(next, 'static');
  if (!existsSync(staticDir) || countFilesRecursive(staticDir) === 0) {
    structural.push(`${rel(staticDir)} is missing or empty — no client assets were emitted`);
  }

  // (5) The standalone entrypoint, when the *resolved* config asks for one.
  //
  // Read from `.next/required-server-files.json`, which is Next's own record of
  // the config it actually ran with — the same reasoning as reading `incremental`
  // through `tsc --showConfig` in boot-gate.spec.ts. Regex-parsing next.config.mjs
  // would be guessing at a value the build has already written down.
  const requiredPath = join(next, 'required-server-files.json');
  if (!existsSync(requiredPath)) {
    structural.push(`${rel(requiredPath)} is missing — cannot tell what the build was asked to emit`);
  } else {
    const required = readJson(requiredPath);
    if (required.config && required.config.output === 'standalone') {
      const relApp = app.id.split('/').join(sep);
      const server = join(next, 'standalone', relApp, 'server.js');
      if (!existsSync(server)) {
        structural.push(
          `config resolves \`output: "standalone"\` but ${rel(server)} was not emitted —\n` +
            `        Dockerfile.web's CMD is \`node apps/web/server.js\`, so this image would have no entrypoint`,
        );
      }
    }
  }

  // (6) Routes that must not be prerendered.
  const mustBeDynamic = (baselineEntry && baselineEntry.mustBeDynamic) || [];
  const prerenderPath = join(next, 'prerender-manifest.json');
  if (mustBeDynamic.length > 0) {
    if (!existsSync(prerenderPath)) {
      structural.push(`${rel(prerenderPath)} is missing — cannot prove the release manifest stays dynamic`);
    } else {
      const prerender = readJson(prerenderPath);
      const frozen = new Set([
        ...Object.keys(prerender.routes || {}),
        ...Object.keys(prerender.dynamicRoutes || {}),
      ]);
      for (const route of mustBeDynamic) {
        if (!routes.includes(route)) {
          structural.push(
            `${route} is declared \`mustBeDynamic\` but is not in the emitted route inventory at all`,
          );
        } else if (frozen.has(route)) {
          structural.push(
            `${route} was PRERENDERED at build time, and it must not be.\n` +
              `        It is the web third of the release gate (S-E02-10 / R-05): prerendered, it\n` +
              `        answers with the SHA of the machine that built the page instead of reading\n` +
              `        the container's environment — describing an artefact rather than the artefact\n` +
              `        that is running. Restore \`export const dynamic = 'force-dynamic'\`.`,
          );
        }
      }
    }
  }

  return { routes, structural };
}

function rel(path) {
  return path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1).split(sep).join('/') : path;
}

/* ------------------------------------------------------------------ *
 * Gate
 * ------------------------------------------------------------------ */

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return readJson(BASELINE_PATH);
}

function main() {
  const update = process.argv.includes('--update');
  const apps = discoverNextApps();

  if (apps.length === 0) {
    console.error('✗ web artefact check found no Next.js applications — discovery is broken, not the repo');
    process.exit(1);
  }

  const baseline = loadBaseline();
  if (!baseline && !update) {
    console.error(`✗ missing ${rel(BASELINE_PATH)} — run \`node scripts/web-artifact-check.js --update\``);
    process.exit(1);
  }

  const failures = [];
  let structuralFailures = 0;
  const measured = {};

  for (const app of apps) {
    const expected = baseline && baseline.apps ? baseline.apps[app.id] : undefined;
    process.stdout.write(`▶ inspecting ${app.id} … `);
    const { routes, structural } = inspect(app, expected);

    if (structural.length > 0) {
      console.log('FAILED');
      structuralFailures += structural.length;
      for (const problem of structural) failures.push(`${app.id} — ${problem}`);
      continue;
    }
    console.log(`ok (${routes.length} routes, BUILD_ID present, static + standalone emitted)`);
    measured[app.id] = {
      routes,
      mustBeDynamic: (expected && expected.mustBeDynamic) || [],
    };

    if (update) continue;

    if (!expected) {
      // The "no silent escape" rule. See discoverNextApps().
      failures.push(
        `${app.id} — is a Next.js application but has no entry in scripts/web-route-baseline.json.\n` +
          `        Add it deliberately with \`node scripts/web-artifact-check.js --update\`.`,
      );
      continue;
    }

    const missing = expected.routes.filter((r) => !routes.includes(r));
    const added = routes.filter((r) => !expected.routes.includes(r));

    if (missing.length > 0) {
      failures.push(
        `${app.id} — ${missing.length} route(s) in the baseline are NOT in the emitted artefact.\n` +
          `        This is the PF-62 shape at the web address: a page or route handler that\n` +
          `        stopped being reachable while the build still reported success.\n` +
          indent(missing.map((r) => `- ${r}`).join('\n'), 8),
      );
    }
    if (added.length > 0) {
      failures.push(
        `${app.id} — ${added.length} route(s) are emitted but absent from the baseline.\n` +
          `        The inventory is a reviewed record of what the artefact exposes: a new page\n` +
          `        must appear in the diff. Run \`--update\` to accept.\n` +
          indent(added.map((r) => `+ ${r}`).join('\n'), 8),
      );
    }
  }

  if (update) {
    // Refuse to write from a structurally broken artefact — the same rule
    // boot-check.js learned the hard way, where the first `--update` silently
    // dropped an application that had failed to boot and would then have passed
    // the gate forever with that application unrepresented.
    if (structuralFailures > 0) {
      console.error('\n✗ refusing to write the baseline: the build output is not intact.');
      for (const f of failures) console.error(`\n  ${f}`);
      console.error('\n  Fix the artefact first — a baseline recorded from a broken build would');
      console.error('  freeze the breakage into the reviewed inventory.\n');
      process.exit(1);
    }
    const next = { ...(baseline ?? {}), apps: { ...measured } };
    next.$comment = BASELINE_COMMENT;
    writeFileSync(BASELINE_PATH, `${JSON.stringify(reorder(next), null, 2)}\n`, 'utf8');
    console.log(`\n✎ baseline rewritten: ${rel(BASELINE_PATH)}`);
    return;
  }

  if (failures.length > 0) {
    console.error('\n══════════════════════════════════════════════════════════════');
    console.error('  WEB ARTEFACT CHECK: FAIL');
    console.error('══════════════════════════════════════════════════════════════');
    for (const f of failures) console.error(`\n✗ ${f}`);
    console.error('');
    process.exit(1);
  }

  console.log('\nWEB ARTEFACT CHECK: PASS — build output complete, route inventory unchanged');
}

const BASELINE_COMMENT =
  'Route inventory read off the EMITTED Next.js build output ' +
  '(.next/app-path-routes-manifest.json) by scripts/web-artifact-check.js, not off the app/ ' +
  'directory tree. Regenerate deliberately with `node scripts/web-artifact-check.js --update`; ' +
  'the diff is meant to be reviewed, because it shows exactly which pages and route handlers a ' +
  'change adds or removes. `mustBeDynamic` lists routes that must NOT be prerendered — they are ' +
  'hand-maintained and are never inferred from a build.';

function reorder(obj) {
  const { $comment, ...rest } = obj;
  return { $comment, ...rest };
}

function indent(text, spaces = 4) {
  const pad = ' '.repeat(spaces);
  return String(text)
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

main();
