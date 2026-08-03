import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * R-25 guard (web half) — the Next.js build output must stay inside a gate.
 *
 * WHAT R-25 IS
 * ------------
 * "A build reports success while emitting nothing." It was not hypothetical when
 * it was found: `apps/worker` combined `deleteOutDir: true` with an inherited
 * `incremental: true`, so `nest build` deleted `dist/` and then emitted **0 files
 * at exit 0** — and turbo, whose `build` task declares `outputs: ["dist/**",
 * ".next/**", …]`, cached the empty directory as a successful output and replayed
 * it (`PF-72`, S-E02-9).
 *
 * The mitigation shipped with that story — `scripts/boot-check.js` — covers the
 * two Nest applications and **cannot** cover `apps/web`: its discovery is
 * `apps/*` containing `src/app.module.ts`, and Next.js has no module graph to
 * construct. So R-25 stayed open with the note "`web` uncovered", and the same
 * turbo caching rule applies to `.next/**` verbatim.
 *
 * Measured before `scripts/web-artifact-check.js` was written, not assumed: with
 * `apps/web/.next` deleted in its entirety, `node scripts/boot-check.js` returned
 * **exit 0** ("BOOT CHECK: PASS"), and `grep -rn '\.next' scripts/` returned
 * nothing. The whole web build could vanish and the gate stayed green.
 *
 * WHY THIS SPEC DOES NOT INSPECT `.next` ITSELF
 * ---------------------------------------------
 * Same division of labour as `boot-gate.spec.ts`:
 *   • `scripts/web-artifact-check.js` — inspects the artefact. Its exit code is
 *     the gate, and it runs after the build because `.next/` must exist first.
 *   • this file                       — proves that gate is still connected, and
 *     that the hand-maintained parts of its baseline have not been quietly
 *     emptied.
 * A jest suite that read `.next/` would pass or fail depending on whether someone
 * had built recently, which is a flaky gate rather than a gate.
 *
 * WHY IT LIVES IN apps/api
 * ------------------------
 * With `lint-gate`, `lint-ratchet` and `boot-gate`, next to the other guards for
 * repo-level gates. `apps/api` is the package whose jest suite `ci-gate.sh`
 * actually runs through the ratchet; `apps/web` has no unit-test runner at all,
 * only Playwright, which is itself not yet wired (`VAL-08`).
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'web-artifact-check.js');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'web-route-baseline.json');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'ci-gate.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

interface Baseline {
  $comment?: string;
  apps: Record<string, { routes: string[]; mustBeDynamic: string[] }>;
}

const NEXT_CONFIG_NAMES = ['next.config.mjs', 'next.config.js', 'next.config.cjs', 'next.config.ts'];

/** Filesystem discovery, mirroring `discoverNextApps()` in the script. */
function discoverNextApps(): string[] {
  const appsDir = join(REPO_ROOT, 'apps');
  return readdirSync(appsDir)
    .filter((name) => NEXT_CONFIG_NAMES.some((f) => existsSync(join(appsDir, name, f))))
    .map((name) => `apps/${name}`)
    .sort();
}

const nextApps = discoverNextApps();
const baseline = existsSync(BASELINE_PATH)
  ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline)
  : null;

describe('web artefact gate (R-25, web half)', () => {
  it('finds the Next.js application at all', () => {
    // Guards the guard. A broken REPO_ROOT would make every assertion below pass
    // vacuously over an empty list — the bug that made the first draft of
    // lint-ratchet.spec.ts report zero decorator-metadata packages.
    expect(nextApps).toContain('apps/web');
  });

  it('the web artefact check script exists', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  it('the route inventory exists and is not trivially small', () => {
    expect(baseline).not.toBeNull();
    const web = baseline?.apps['apps/web'];
    expect(web).toBeDefined();
    // 108 routes were measured when the inventory was created. An inventory that
    // collapsed to a handful would satisfy a naive "file exists" check while
    // covering almost nothing.
    expect(web?.routes.length ?? 0).toBeGreaterThanOrEqual(100);
  });

  it.each(nextApps)('%s has a baseline entry — no escape by omission', (app) => {
    // The script enforces this at runtime; asserting it here means a hand-edited
    // baseline that drops an application fails the fast suite too, rather than
    // only the slow post-build stage.
    expect(baseline?.apps[app]).toBeDefined();
  });

  it('the release manifest route is in the inventory and declared dynamic', () => {
    // `/version/web` is the web third of the release gate (S-E02-10, R-05). Its
    // source states the invariant — "pré-rendu au build, le manifeste figerait le
    // SHA du build de page au lieu de lire l'environnement du conteneur" — and
    // until this story nothing enforced it. Deleting one line of that file left
    // the route present, the build green, and the gate answering 200 with a
    // constant. `mustBeDynamic` is hand-maintained and never inferred from a
    // build, so it is exactly the kind of list that gets silently emptied.
    const web = baseline?.apps['apps/web'];
    expect(web?.routes ?? []).toContain('/version/web');
    expect(web?.mustBeDynamic ?? []).toContain('/version/web');
  });

  it('the source route still declares force-dynamic', () => {
    // Belt and braces with the manifest check in the script, and it fails
    // earlier: the script can only see the consequence in an emitted build,
    // whereas this fails on the diff that removes the directive.
    const route = readFileSync(
      join(REPO_ROOT, 'apps', 'web', 'src', 'app', 'version', 'web', 'route.ts'),
      'utf8',
    );
    expect(route).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('ci-gate.sh runs the web artefact check, after the build stage', () => {
    const gate = readFileSync(GATE_PATH, 'utf8');
    expect(gate).toMatch(/node\s+scripts\/web-artifact-check\.js/);
    // Ordering is a correctness requirement, not style: the check reads `.next/`,
    // so running it before the build would test a stale artefact or fail on a
    // missing one.
    const buildAt = gate.indexOf('run_stage "build"');
    const webAt = gate.indexOf('scripts/web-artifact-check.js');
    expect(buildAt).toBeGreaterThan(-1);
    expect(webAt).toBeGreaterThan(buildAt);
  });

  it('ci.yml runs it too, so the two gates cannot drift', () => {
    // S-E02-2 AC-4: scripts/ci-gate.sh and .github/workflows/ci.yml must stay the
    // same command list. A stage that exists only locally stops existing the
    // moment PF-59 is resolved and CI becomes the gate again.
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    expect(workflow).toMatch(/node\s+scripts\/web-artifact-check\.js/);
    const buildAt = workflow.indexOf('pnpm build');
    const webAt = workflow.indexOf('scripts/web-artifact-check.js');
    expect(buildAt).toBeGreaterThan(-1);
    expect(webAt).toBeGreaterThan(buildAt);
  });

  it('has no bypass flag (DNC-10)', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    for (const flag of ['SKIP_WEB_CHECK', 'ALLOW_WEB_FAILURE', 'WEB_CHECK_SKIP']) {
      expect(source).not.toContain(flag);
    }
    expect(source).not.toMatch(/process\.env\.[A-Z_]*(SKIP|BYPASS|FORCE)[A-Z_]*/);
  });

  it('refuses to write a baseline from a broken artefact', () => {
    // The rule boot-check.js learned the hard way: its first `--update` silently
    // dropped an application that had failed to boot, producing a baseline that
    // would then have passed the gate forever with that application
    // unrepresented. `--update` here refuses on any structural defect, so a
    // broken build cannot be frozen into the reviewed inventory.
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    expect(source).toMatch(/refusing to write the baseline/);
  });

  it('a missing build is a failure, never a skip', () => {
    // The R-25 shape is precisely "the artefact is not there and nothing minds".
    // A check that treated an absent `.next/` as "nothing to verify" would
    // reproduce the finding it was written to close.
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    expect(source).toMatch(/no build output at/);
  });

  it('reads the resolved config, not the config source', () => {
    // `output: 'standalone'` decides whether `.next/standalone/apps/web/server.js`
    // — the Dockerfile's CMD target — is required. It is read from
    // required-server-files.json, Next's own record of the config it ran with,
    // for the same reason boot-gate.spec.ts reads `incremental` through
    // `tsc --showConfig`: parsing next.config.mjs by regex would be guessing at a
    // value the build has already written down.
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    expect(source).toContain('required-server-files.json');
    expect(source).not.toMatch(/readFileSync\([^)]*next\.config/);
  });
});
