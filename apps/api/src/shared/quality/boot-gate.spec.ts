import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * PF-67 / R-24 guard — the boot check must stay wired, and must keep covering
 * every Nest application.
 *
 * WHAT PF-67 ACTUALLY IS
 * ----------------------
 * Not "the module-wiring guards read source text". That was the first symptom.
 * The finding was widened twice, and its real shape is: **nothing in this
 * repository starts either application.** A change can be type-correct, build
 * cleanly, satisfy ESLint and pass every wiring spec while making the app
 * impossible to construct — that is R-24, measured on emitted
 * `design:paramtypes`, and no amount of reading source can catch it.
 *
 * `scripts/boot-check.js` closes that by constructing the real module graph from
 * the built artefact. This file guards the *wiring* of that script, in the same
 * spirit as `lint-gate.spec.ts`: it cannot itself boot Nest (see below), so it
 * asserts the gate cannot silently stop running or silently stop covering an
 * application.
 *
 * WHY THIS SPEC DOES NOT SIMPLY BOOT THE APP ITSELF
 * -------------------------------------------------
 * It cannot, and the reason is worth recording so nobody "simplifies" it back:
 * importing `AppModule` under jest pulls
 * `AlertsModule → AuthModule → JwtStrategy → jwks-rsa → jose`, and `jose@6` is
 * ESM-only. ts-jest's CommonJS runtime fails to parse it and the suite dies
 * before the first assertion. Verified by probe during S-E02-9. The boot check
 * runs outside jest, under plain Node, which loads `jose` natively.
 *
 * So the division of labour is explicit:
 *   • `scripts/boot-check.js` — executes the boot. Its exit code is the gate.
 *   • this file               — proves the gate is still connected to CI.
 * Neither is a substitute for the other, and this file never claims the app
 * boots.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'boot-check.js');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'boot-route-baseline.json');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'ci-gate.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

interface Baseline {
  $comment?: string;
  apps: Record<string, { routes: string[] }>;
}

/**
 * Blank the `#` comments of a shell or YAML file, preserving byte offsets so an
 * `indexOf` still points at the same line.
 *
 * WHY THIS EXISTS — it is R-26 rule (a), learned the hard way a second time.
 * The two ordering assertions below compare `indexOf(…)` positions to prove the
 * boot check runs AFTER the build. They read the file as raw text, so any
 * *mention* of `scripts/boot-check.js` counts as an occurrence — and `indexOf`
 * returns the FIRST one. S-E06-1 added a comment to `.github/workflows/ci.yml`
 * explaining why its new env block is safe for the boot check; that comment sits
 * above the build step, so the guard read the prose, computed bootAt(4409) <
 * buildAt(5543), and failed on a workflow whose actual step order was never
 * touched. A guard that a comment can turn red is a guard that gets deleted.
 *
 * The fix is to assert against what the runner EXECUTES, not what the file says
 * — the same discipline as reading `tsc --showConfig` rather than the tsconfig
 * source. Offsets are preserved (comments become spaces rather than being
 * removed) so failure messages still name a position in the real file.
 *
 * Quoting is deliberately not modelled: neither file contains a `#` inside a
 * string on a line that matters here, and a half-correct shell parser would be a
 * worse guard than an honest textual one. `stripComments.spec` coverage lives in
 * the two "a comment cannot satisfy the ordering assertion" cases below.
 */
function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const at = line.indexOf('#');
      return at === -1 ? line : line.slice(0, at) + ' '.repeat(line.length - at);
    })
    .join('\n');
}

/** Filesystem discovery, mirroring `discoverNestApps()` in the script. */
function discoverNestApps(): string[] {
  const appsDir = join(REPO_ROOT, 'apps');
  return readdirSync(appsDir)
    .filter((name) => existsSync(join(appsDir, name, 'src', 'app.module.ts')))
    .map((name) => `apps/${name}`)
    .sort();
}

const nestApps = discoverNestApps();
const baseline = existsSync(BASELINE_PATH)
  ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline)
  : null;

describe('boot gate (PF-67, R-24)', () => {
  it('finds the Nest applications at all', () => {
    // Guards the guard. A broken REPO_ROOT would make every assertion below
    // pass vacuously over an empty list — the exact bug that made the first
    // draft of lint-ratchet.spec.ts report zero decorator-metadata packages.
    expect(nestApps).toContain('apps/api');
    expect(nestApps).toContain('apps/worker');
  });

  it('the boot check script exists', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  it('the route baseline exists and is not trivially small', () => {
    expect(baseline).not.toBeNull();
    const api = baseline?.apps['apps/api'];
    expect(api).toBeDefined();
    // 228 routes were measured when the baseline was created. A baseline that
    // collapsed to a handful would pass a naive "file exists" check while
    // covering almost nothing.
    expect(api?.routes.length ?? 0).toBeGreaterThanOrEqual(200);
  });

  it.each(nestApps)('%s has a baseline entry — no escape by omission', (app) => {
    // The script enforces this at runtime; asserting it here means a
    // hand-edited baseline that drops an application fails the test suite too,
    // rather than only failing the slower gate stage.
    expect(baseline?.apps[app]).toBeDefined();
  });

  it.each(nestApps)('%s can resolve @nestjs/testing, or the check cannot run', (app) => {
    // apps/worker did not depend on @nestjs/testing until S-E02-9 added it.
    // Removing it again would turn the boot check into an unconditional failure
    // — or, worse, invite someone to "fix" that by skipping the app.
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, app, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    expect(deps['@nestjs/testing']).toBeDefined();
  });

  it('the baseline still contains the routes PF-62 lost', () => {
    // These three are not decoration. `GradesModule` lost its `controllers:`
    // line on 2026-06-01 and these returned 404 in production for seven weeks
    // while every gate stayed green. If they ever disappear from the booted
    // route table again, the boot check fails and names them — and if someone
    // regenerates the baseline to make that failure go away, this test fails.
    const routes = baseline?.apps['apps/api']?.routes ?? [];
    expect(routes.length).toBeGreaterThan(0);
    for (const route of [
      'GET /assessments',
      'POST /assessments',
      'GET /grades/gradebook/:teachingAssignmentId',
      'POST /grades/batch',
    ]) {
      expect(routes).toContain(route);
    }
  });

  it('ci-gate.sh runs the boot check, after the build stage', () => {
    const gate = stripComments(readFileSync(GATE_PATH, 'utf8'));
    expect(gate).toMatch(/node\s+scripts\/boot-check\.js/);
    // Ordering is a correctness requirement, not style: the check reads
    // `dist/`, so running it before the build would either test a stale
    // artefact or fail on a missing one.
    // Anchored on the call INCLUDING its timeout: `run_stage "build"` stopped
    // matching when #214 gave every stage a bound, and this assertion has been
    // red ever since — unseen, because the ratchet skips src/shared/quality/
    // unless the diff touches gate machinery (TOOL-06).
    const buildAt = gate.search(/run_stage\s+\d+\s+"build"/);
    const bootAt = gate.indexOf('scripts/boot-check.js');
    expect(buildAt).toBeGreaterThan(-1);
    expect(bootAt).toBeGreaterThan(buildAt);
  });

  it('ci.yml runs the boot check too, so the two gates cannot drift', () => {
    // S-E02-2 AC-4: scripts/ci-gate.sh and .github/workflows/ci.yml must stay
    // the same command list. A stage that exists only locally is a stage that
    // stops existing the moment PF-59 is resolved and CI becomes the gate again.
    const workflow = stripComments(readFileSync(WORKFLOW_PATH, 'utf8'));
    expect(workflow).toMatch(/node\s+scripts\/boot-check\.js/);
    const buildAt = workflow.indexOf('pnpm build');
    const bootAt = workflow.indexOf('scripts/boot-check.js');
    expect(buildAt).toBeGreaterThan(-1);
    expect(bootAt).toBeGreaterThan(buildAt);
  });

  // The negative direction of the fix above. Both cases reproduce the exact
  // S-E06-1 defect against the REAL file: a comment naming the script, inserted
  // before the build step. On the pre-fix guard each of these passes its
  // ordering check by accident and fails the assertion — which is what made the
  // gate red on a correct workflow.
  it('a comment naming the boot check cannot satisfy the ci.yml ordering assertion', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf8');
    const poisoned = `# see scripts/boot-check.js for why this is safe\n${raw}`;

    // Raw text: the comment is found first, so the ordering "fails" — this is
    // the false positive, reproduced.
    expect(poisoned.indexOf('scripts/boot-check.js')).toBeLessThan(poisoned.indexOf('pnpm build'));

    // Executable content: the comment is invisible and the real order stands.
    const stripped = stripComments(poisoned);
    expect(stripped.indexOf('scripts/boot-check.js')).toBeGreaterThan(stripped.indexOf('pnpm build'));
  });

  it('a comment naming the boot check cannot satisfy the ci-gate.sh ordering assertion', () => {
    const raw = readFileSync(GATE_PATH, 'utf8');
    const poisoned = `# see scripts/boot-check.js for why this is safe\n${raw}`;

    // Same stale anchor as the ordering test above: `run_stage "build"` has not
    // matched since #214 gave every stage a timeout, so both comparisons ran
    // against -1 and this test was red on main (TOOL-07).
    const buildRe = /run_stage\s+\d+\s+"build"/;
    expect(poisoned.indexOf('scripts/boot-check.js')).toBeLessThan(poisoned.search(buildRe));

    const stripped = stripComments(poisoned);
    expect(stripped.indexOf('scripts/boot-check.js')).toBeGreaterThan(stripped.search(buildRe));
  });

  it('stripping comments does not blind the guard to a genuinely misordered file', () => {
    // The complement of the two cases above, and the one that matters: the fix
    // must not turn the assertion into one that can no longer fail. A REAL
    // invocation moved before the build is still caught.
    const misordered = ['- run: node scripts/boot-check.js', '- run: pnpm build'].join('\n');
    const stripped = stripComments(misordered);
    expect(stripped.indexOf('scripts/boot-check.js')).toBeLessThan(stripped.indexOf('pnpm build'));
  });

  it('has no bypass flag (DNC-10)', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    // A gate with an env-var escape hatch is a gate that is off in exactly the
    // situation it was written for. `--update` is not a bypass: it rewrites the
    // reviewed inventory and shows up in the diff.
    for (const flag of ['SKIP_BOOT_CHECK', 'ALLOW_BOOT_FAILURE', 'BOOT_CHECK_SKIP']) {
      expect(source).not.toContain(flag);
    }
    expect(source).not.toMatch(/process\.env\.[A-Z_]*(SKIP|BYPASS|FORCE)[A-Z_]*/);
  });

  it('refuses to write a baseline from a partial run', () => {
    // Found while building this story: the first `--update` recorded apps/api
    // and silently dropped apps/worker, which had failed to boot. That baseline
    // would then have passed the gate forever with one application
    // unrepresented — escape by omission, reintroduced through the update path.
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    expect(source).toMatch(/refusing to write the baseline/);
  });
});

describe('a build that deletes its output directory must not be incremental (PF-72)', () => {
  /**
   * The defect this exists to prevent, measured during S-E02-9:
   *
   *   `nest-cli.json` sets `deleteOutDir: true`, and `apps/worker` inherited
   *   `incremental: true` from `@pilotage/tsconfig/base.json`. The build deletes
   *   `dist/`, then asks a compiler holding a `.tsbuildinfo` that says
   *   "everything is already emitted" to emit. It emits **nothing** and exits
   *   **0**.
   *
   *   Observed: with the stale build-info present, `nest build` produced 0 files
   *   and exit 0. Removing only the build-info and rerunning produced 53 files
   *   including `main.js`. Nothing in the repository noticed — `pnpm build`
   *   reported success, and turbo cached the empty `dist/**` as that build's
   *   output, so the emptiness replayed on every later cache hit.
   *
   * `apps/api` already carried `incremental: false`, which is why only the
   * worker was affected and why the API kept building correctly. That made the
   * override look like a stylistic difference between two app configs rather
   * than the load-bearing setting it is — so it is asserted here.
   *
   * Read through `tsc --showConfig` deliberately: the value is inherited, so a
   * hand-rolled parse of the app's own tsconfig would miss it, and JSONC
   * parsing by regex is how the previous story's guard nearly passed vacuously.
   */
  const appsDir = join(REPO_ROOT, 'apps');
  const nestApps = readdirSync(appsDir)
    .filter((name) => existsSync(join(appsDir, name, 'src', 'app.module.ts')))
    .map((name) => ({ id: `apps/${name}`, dir: join(appsDir, name) }));

  const deleting = nestApps.filter((app) => {
    const cliPath = join(app.dir, 'nest-cli.json');
    if (!existsSync(cliPath)) return false;
    const cli = JSON.parse(readFileSync(cliPath, 'utf8')) as {
      compilerOptions?: { deleteOutDir?: boolean };
    };
    return cli.compilerOptions?.deleteOutDir === true;
  });

  it('finds applications that delete their output directory', () => {
    // Guards the guard: if this list is empty, every assertion below is vacuous.
    expect(deleting.length).toBeGreaterThanOrEqual(2);
  });

  it.each(deleting.map((a) => [a.id, a] as const))(
    '%s resolves incremental:false in the config nest build uses',
    (_id, app) => {
      const project = existsSync(join(app.dir, 'tsconfig.build.json'))
        ? 'tsconfig.build.json'
        : 'tsconfig.json';
      // Spawn the compiler directly rather than through `pnpm exec` in a shell:
      // a shell invocation needs `shell: true` on Windows, which Node deprecates
      // (DEP0190) precisely because the arguments stop being escaped.
      const tsc = require.resolve('typescript/bin/tsc', { paths: [app.dir] });
      const res = spawnSync(process.execPath, [tsc, '--showConfig', '-p', project], {
        cwd: app.dir,
        encoding: 'utf8',
      });
      expect(res.status).toBe(0);
      const config = JSON.parse(res.stdout) as {
        compilerOptions?: { incremental?: boolean };
      };
      expect(config.compilerOptions?.incremental).not.toBe(true);
    },
    120_000,
  );
});
