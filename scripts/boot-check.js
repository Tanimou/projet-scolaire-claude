#!/usr/bin/env node
/**
 * boot-check.js — the gate that starts the applications (PF-67, R-24).
 *
 * WHY THIS EXISTS
 * ---------------
 * Until this script, **nothing in this repository ever instantiated a NestJS
 * module graph.** Grepping both applications' sources for `createTestingModule`
 * returned zero call sites. Every gate we had proves the code *compiles*:
 *
 *   • `tsc --noEmit`  — types are consistent
 *   • `nest build`    — it emits
 *   • ESLint          — it obeys the rules
 *   • the wiring specs — a module's *source text* lists its controllers
 *
 * None of them starts the app, and two separate incidents landed in that gap:
 *
 *   PF-62 — `GradesModule` lost its `controllers:` line on 2026-06-01. Every
 *           gate stayed green; `/api/v1/assessments` and `/api/v1/grades/*`
 *           were 404 in production for seven weeks. Teachers could not enter a
 *           grade. It was eventually caught only because the deletion happened
 *           to be textual, and a source-reading spec could see it.
 *
 *   R-24  — `eslint --fix` for `consistent-type-imports` rewrites a NestJS
 *           constructor-injected import to `import type`, which erases the
 *           runtime `require()` and reduces the emitted
 *           `design:paramtypes` to `[Object, Object, Object]`. Nest cannot
 *           resolve the provider at boot. `tsc --noEmit` returns **exit 0** on
 *           the broken file, `nest build` succeeds, ESLint is satisfied because
 *           it authored the change, and the wiring specs never look at a
 *           constructor. That defect is *invisible to source text* — no
 *           textual guard can ever catch it.
 *
 * The common cause is not "the guards are textual". It is that **nothing boots
 * the app**. This script boots it.
 *
 * WHAT IT CHECKS
 * --------------
 *   1. Every Nest application's module graph **compiles** — i.e. every provider
 *      and every controller in the graph is actually constructible, with its
 *      dependencies resolved from real emitted metadata. This is the R-24 class.
 *   2. The API's **route table**, read off the booted container, matches
 *      `scripts/boot-route-baseline.json`. This is the PF-62 class.
 *
 * WHY IT RUNS AGAINST `dist/`, NOT THE TYPESCRIPT SOURCE
 * ------------------------------------------------------
 * Two reasons, and the first is the decisive one.
 *
 *   • `dist/` is the artefact that ships. R-24 is a defect in *emitted*
 *     metadata: the TypeScript is valid either way, and only the compiler's
 *     output differs. A check that re-compiles the source through ts-jest would
 *     be judging a different build than the one deployed.
 *   • The source cannot be booted under the existing test runner anyway.
 *     `AppModule → AlertsModule → AuthModule → JwtStrategy → jwks-rsa → jose`,
 *     and `jose@6` is ESM-only, so ts-jest's CommonJS runtime dies parsing
 *     `export {...}` before a single assertion runs. Verified, not assumed —
 *     that is the blocker `docs/spec/features/v3-e02/PROGRESS.md` records, and
 *     it is why the obvious "just add a jest spec" does not work. Plain Node
 *     ≥22.12 loads `jose` through its own require(ESM) support, so running
 *     outside jest sidesteps the problem entirely rather than papering over it
 *     with a mock of the very thing we want to prove loads.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It calls `.compile()`, never `.init()`. `compile()` constructs the whole
 * graph; `init()` additionally fires `onModuleInit`, which would open Postgres
 * and Redis connections. The distinction is the entire reason this check can run
 * in a gate with no infrastructure. It therefore proves **the application can be
 * constructed**, not that it can serve traffic — a connection string that is
 * wrong at runtime is not this script's business.
 *
 * There is no bypass flag (DNC-10). A boot failure is a build failure.
 *
 * USAGE
 *   node scripts/boot-check.js              # gate (exit 1 on any failure)
 *   node scripts/boot-check.js --update     # rewrite the route baseline
 *   node scripts/boot-check.js --boot-one <appDir>   # internal: child process
 */
'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'boot-route-baseline.json');

/**
 * How long one application gets to construct its graph before we call it hung.
 *
 * A provider whose constructor blocks (a synchronous connect, a retry loop) is a
 * real boot defect, and hanging the gate forever is the worst way to report it.
 * The API takes ~20 s cold on a developer machine; 180 s is a wide margin that
 * still terminates.
 */
const BOOT_TIMEOUT_MS = 180_000;

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

/**
 * Every Nest application in the workspace, discovered from the filesystem.
 *
 * Discovery is deliberately **not** driven by the baseline. `PF-69` and `PF-70`
 * were both "a thing no gate looked at", and a list an application can quietly
 * omit itself from would reproduce that at a new address. An app that has an
 * `app.module.ts` but no baseline entry fails the gate; it cannot pass by being
 * forgotten.
 *
 * `apps/web` is Next.js and has no `app.module.ts`, so it is correctly absent.
 */
function discoverNestApps() {
  const appsDir = join(REPO_ROOT, 'apps');
  const found = [];
  for (const name of readdirSync(appsDir)) {
    const dir = join(appsDir, name);
    if (!existsSync(join(dir, 'src', 'app.module.ts'))) continue;
    found.push({ id: `apps/${name}`, dir });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------ *
 * Child: boot one application and report its route table
 * ------------------------------------------------------------------ */

/**
 * Booted in a child process, one per application.
 *
 * Isolation is not fussiness: two Nest applications shared into a single
 * process would share `reflect-metadata` and the global Nest logger, so a
 * failure in one could be caused by the other. A child per app also means a
 * hard crash reports which app crashed instead of ending the run.
 */
function bootOne(appDir) {
  // Resolve Nest from the *application's* own dependency tree. Under pnpm the
  // root has no @nestjs/testing, and resolving it from here would either fail or
  // silently pick up a different copy than the app was built against.
  const req = (spec) => require(require.resolve(spec, { paths: [appDir] }));

  req('reflect-metadata');
  const { Test } = req('@nestjs/testing');
  const { PATH_METADATA, METHOD_METADATA } = req('@nestjs/common/constants');
  const { RequestMethod } = req('@nestjs/common');

  const distEntry = join(appDir, 'dist', 'app.module.js');
  if (!existsSync(distEntry)) {
    // Not a skip. A missing build is the state in which every other check in
    // this file would vacuously pass.
    throw new Error(
      `no built artefact at ${distEntry} — run \`pnpm build\` before the boot check`,
    );
  }

  const { AppModule } = require(distEntry);
  if (!AppModule) throw new Error(`${distEntry} does not export AppModule`);

  return Test.createTestingModule({ imports: [AppModule] })
    .compile()
    .then(async (ref) => {
      const routes = collectRoutes(ref, { PATH_METADATA, METHOD_METADATA, RequestMethod });
      const modules = ref.container.getModules();
      let controllers = 0;
      for (const [, mod] of modules) controllers += mod.controllers.size;
      await ref.close();
      return { modules: modules.size, controllers, routes };
    });
}

/**
 * The route table, read off the **booted container** rather than off module
 * source text.
 *
 * This is the difference that matters for PF-62. A source-reading guard sees the
 * `controllers: [...]` array a developer wrote. This sees the controllers Nest
 * actually instantiated — so a controller that is listed but fails to
 * instantiate, or one reachable only through a conditional import, is reported
 * as it truly is.
 *
 * Paths are **controller-relative**: they do not carry `main.ts`'s
 * `api/v1` global prefix, because the prefix is applied by `NestFactory`, not by
 * the metadata. `GET /me` here is served at `GET /api/v1/me`. The check is about
 * a route existing or not, so the prefix would add churn without adding signal.
 */
function collectRoutes(ref, { PATH_METADATA, METHOD_METADATA, RequestMethod }) {
  const routes = new Set();
  for (const [, mod] of ref.container.getModules()) {
    for (const [, wrapper] of mod.controllers) {
      const cls = wrapper.metatype;
      if (typeof cls !== 'function' || !cls.prototype) continue;
      const base = normalise(Reflect.getMetadata(PATH_METADATA, cls));
      for (const key of Object.getOwnPropertyNames(cls.prototype)) {
        if (key === 'constructor') continue;
        let handler;
        try {
          handler = cls.prototype[key];
        } catch {
          continue; // a getter that throws is not a route
        }
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const sub = normalise(Reflect.getMetadata(PATH_METADATA, handler));
        const path = `/${[base, sub].filter(Boolean).join('/')}`.replace(/\/{2,}/g, '/');
        routes.add(`${RequestMethod[method]} ${path}`);
      }
    }
  }
  return [...routes].sort();
}

function normalise(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/^\/+|\/+$/g, '');
}

/* ------------------------------------------------------------------ *
 * Parent: run every app, compare against the baseline
 * ------------------------------------------------------------------ */

function runChild(app) {
  const res = spawnSync(
    process.execPath,
    [__filename, '--boot-one', app.dir],
    {
      cwd: app.dir,
      timeout: BOOT_TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: process.env,
    },
  );

  if (res.error && res.error.code === 'ETIMEDOUT') {
    return { ok: false, reason: `boot did not finish within ${BOOT_TIMEOUT_MS / 1000}s (hung constructor?)` };
  }

  const marker = res.stdout ? res.stdout.indexOf('__BOOT_RESULT__') : -1;
  if (res.status !== 0 || marker === -1) {
    const detail = [res.stdout, res.stderr].filter(Boolean).join('\n').trim();
    return { ok: false, reason: detail || `child exited ${res.status}` };
  }

  return { ok: true, ...JSON.parse(res.stdout.slice(marker + '__BOOT_RESULT__'.length)) };
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function main() {
  const update = process.argv.includes('--update');
  const apps = discoverNestApps();

  if (apps.length === 0) {
    console.error('✗ boot check found no Nest applications — discovery is broken, not the repo');
    process.exit(1);
  }

  const baseline = loadBaseline();
  if (!baseline && !update) {
    console.error(`✗ missing ${BASELINE_PATH} — run \`node scripts/boot-check.js --update\``);
    process.exit(1);
  }

  const failures = [];
  const measured = {};

  for (const app of apps) {
    process.stdout.write(`▶ booting ${app.id} … `);
    const result = runChild(app);
    if (!result.ok) {
      console.log('FAILED');
      failures.push(`${app.id} — did not boot:\n${indent(result.reason)}`);
      continue;
    }
    console.log(
      `ok (${result.modules} modules, ${result.controllers} controllers, ${result.routes.length} routes)`,
    );
    measured[app.id] = { routes: result.routes };

    if (update) continue;

    const expected = baseline.apps ? baseline.apps[app.id] : undefined;
    if (!expected) {
      // The "no silent escape" rule. See discoverNestApps().
      failures.push(
        `${app.id} — is a Nest application but has no entry in scripts/boot-route-baseline.json.\n` +
          `        Add it deliberately with \`node scripts/boot-check.js --update\`.`,
      );
      continue;
    }

    const missing = expected.routes.filter((r) => !result.routes.includes(r));
    const added = result.routes.filter((r) => !expected.routes.includes(r));

    if (missing.length > 0) {
      failures.push(
        `${app.id} — ${missing.length} route(s) present in the baseline are NOT mounted on the booted app.\n` +
          `        This is the PF-62 shape: a controller that stopped being reachable.\n` +
          indent(missing.map((r) => `- ${r}`).join('\n'), 8),
      );
    }
    if (added.length > 0) {
      failures.push(
        `${app.id} — ${added.length} route(s) are mounted but absent from the baseline.\n` +
          `        The route table is a reviewed inventory: new endpoints must appear in the\n` +
          `        diff so a reviewer sees what a change exposes. Run \`--update\` to accept.\n` +
          indent(added.map((r) => `+ ${r}`).join('\n'), 8),
      );
    }
  }

  if (update) {
    // Refuse to write a baseline from an incomplete run. Caught during this
    // story's own development: the first `--update` recorded apps/api and
    // silently dropped apps/worker, which had failed to boot — producing a
    // baseline that would then have passed the gate forever with one
    // application unrepresented. That is precisely the "escape by omission"
    // shape the discovery rule exists to prevent, reintroduced through the
    // update path.
    if (failures.length > 0) {
      console.error('\n✗ refusing to write the baseline: not every application booted.');
      for (const f of failures) console.error(`\n  ${f}`);
      console.error('\n  Fix the boot failure first — a baseline recorded from a partial run');
      console.error('  would silently drop the broken application from the gate.\n');
      process.exit(1);
    }
    const next = { ...(baseline ?? {}), apps: { ...measured } };
    next.$comment = BASELINE_COMMENT;
    writeFileSync(BASELINE_PATH, `${JSON.stringify(reorder(next), null, 2)}\n`, 'utf8');
    console.log(`\n✎ baseline rewritten: ${BASELINE_PATH}`);
    return;
  }

  if (failures.length > 0) {
    console.error('\n══════════════════════════════════════════════════════════════');
    console.error('  BOOT CHECK: FAIL');
    console.error('══════════════════════════════════════════════════════════════');
    for (const f of failures) console.error(`\n✗ ${f}`);
    console.error('');
    process.exit(1);
  }

  console.log('\nBOOT CHECK: PASS — every Nest application constructs, route table unchanged');
}

const BASELINE_COMMENT =
  'Route table read off the BOOTED Nest container (scripts/boot-check.js), not off module ' +
  'source text. Paths are controller-relative and do NOT include main.ts\'s api/v1 global ' +
  'prefix. Regenerate deliberately with `node scripts/boot-check.js --update`; the diff is ' +
  'meant to be reviewed, because it shows exactly which endpoints a change exposes or removes.';

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

/* ------------------------------------------------------------------ */

const bootOneIndex = process.argv.indexOf('--boot-one');
if (bootOneIndex !== -1) {
  const appDir = process.argv[bootOneIndex + 1];
  bootOne(appDir)
    .then((result) => {
      // Exit from the write callback, not after it. stdout on a pipe is
      // asynchronous, so `write(); process.exit()` can truncate the payload and
      // the parent would report a JSON parse error as a boot failure.
      // Constructing the graph can leave handles open (pools, timers) even
      // without init(), so exiting explicitly is correct here; waiting for the
      // event loop to drain would turn a healthy boot into a gate timeout.
      process.stdout.write(`__BOOT_RESULT__${JSON.stringify(result)}`, () => process.exit(0));
    })
    .catch((err) => {
      console.error(err && err.stack ? err.stack : String(err));
      process.exit(1);
    });
} else {
  main();
}
