import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * PF-73 guard — the declared runtime must stay checkable, and the check must stay
 * wired.
 *
 * WHAT PF-73 ACTUALLY IS
 * ----------------------
 * `engines.node` said `>=20.0.0`. On Node 20.0-20.18 the API cannot start at all:
 * `jwt.strategy.ts` imports `jwks-rsa` at module top level, `jwks-rsa@4` does a
 * CommonJS `require('jose')`, and `jose@6` is ESM-only — `require()` of an ESM
 * graph exists only from 20.19 / 22.12. `AuthModule` is on the boot path via
 * `AlertsModule`, so nothing starts.
 *
 * The finding proposed a one-line fix, `>=22.12.0`. Measuring the installed
 * dependency set showed that fix is wrong in **both** directions — it excludes
 * 20.19.x, which every dependency accepts, and blesses 22.12.x and 23.x, which
 * `eslint-visitor-keys` refuses. More to the point, replacing an unverified
 * declaration with another unverified declaration is the failure mode this whole
 * epic exists to end, so the declaration became a gate:
 * `scripts/runtime-engines-check.js`.
 *
 * WHAT THIS FILE DOES THAT THE SCRIPT CANNOT
 * ------------------------------------------
 * The script judges *this* repository, so a clean run only ever proves the
 * current state is fine — it can never demonstrate that the gate would catch a
 * regression. The evaluation is therefore a pure function, and this file drives
 * it with synthetic input: the exact historical state that shipped PF-73, a
 * dependency raising its floor tomorrow, disagreeing pins, and a gate running on
 * an unsupported runtime. Those are the cases that matter and none of them can be
 * produced by looking at a healthy repo.
 *
 * It also asserts the wiring, in the same spirit as `boot-gate.spec.ts`: a gate
 * that silently stops running is indistinguishable from one that passes.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'runtime-engines-check.js');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'ci-gate.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const PACKAGE_JSON_PATH = join(REPO_ROOT, 'package.json');
const NVMRC_PATH = join(REPO_ROOT, '.nvmrc');
const DOCKER_DIR = join(REPO_ROOT, 'infra', 'docker');

interface EvaluationInput {
  declaredNode: string;
  declaredPnpm: string;
  packageManager: string;
  nodePins: Array<{ source: string; value: string | null }>;
  workflowPnpmVersion: string | null;
  dependencyRanges: Array<{ name: string; version: string; range: string }> | null;
  runningNode: string;
}

interface Evaluation {
  problems: string[];
  notes: string[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { evaluateRuntimeSupport } = require(SCRIPT_PATH) as {
  evaluateRuntimeSupport: (input: EvaluationInput) => Evaluation;
};

/** The state the repository is in after this story — the control for every probe. */
function healthy(): EvaluationInput {
  return {
    declaredNode: '^22.13.1 || >=24.0.0',
    declaredPnpm: '>=9.0.0',
    packageManager: 'pnpm@9.12.3',
    nodePins: [
      { source: '.nvmrc', value: '22.13.1' },
      { source: 'infra/docker/Dockerfile.api', value: '22.13.1' },
      { source: 'infra/docker/Dockerfile.web', value: '22.13.1' },
      { source: 'infra/docker/Dockerfile.worker', value: '22.13.1' },
      { source: '.github/workflows/ci.yml NODE_VERSION', value: '22.13.1' },
    ],
    workflowPnpmVersion: '9.12.3',
    // The two ranges that actually bound this workspace, measured from the
    // installed set. `jwks-rsa` is PF-73's own dependency; `eslint-visitor-keys`
    // is the one that makes the finding's proposed `>=22.12.0` wrong.
    dependencyRanges: [
      { name: 'jwks-rsa', version: '4.0.1', range: '^20.19.0 || ^22.12.0 || >= 23.0.0' },
      { name: 'eslint-visitor-keys', version: '5.0.1', range: '^20.19.0 || ^22.13.0 || >=24' },
      { name: 'lru-cache', version: '11.3.6', range: '20 || >=22' },
    ],
    runningNode: 'v22.13.1',
  };
}

describe('runtime engines gate — the evaluation catches what PF-73 was', () => {
  it('passes on the state this story leaves the repository in', () => {
    const { problems } = evaluateRuntimeSupport(healthy());
    expect(problems).toEqual([]);
  });

  it('fails on the exact declaration that shipped PF-73', () => {
    // `>=20.0.0` blesses 20.0-20.18, where the API cannot boot. This is the
    // negative path the gate exists for, and it must name the dependency.
    const { problems } = evaluateRuntimeSupport({ ...healthy(), declaredNode: '>=20.0.0' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('jwks-rsa@4.0.1');
    expect(problems[0]).toContain('blesses Node versions');
  });

  it("fails on the finding's own proposed one-line fix", () => {
    // PF-73 recorded «Fix is one line (`>=22.12.0`)». It is not: 22.12.x and
    // 23.x are refused by eslint-visitor-keys. Recording this as a test is the
    // only way the correction survives the finding being re-read later.
    const { problems } = evaluateRuntimeSupport({ ...healthy(), declaredNode: '>=22.12.0' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('eslint-visitor-keys@5.0.1');
  });

  it('fails when a dependency raises its floor above the declared range', () => {
    // The forward-looking half. Today's ranges are satisfied; the gate has to
    // fail on the *next* bump that outgrows the declaration, or it only ever
    // documents history.
    const input = healthy();
    input.dependencyRanges = [
      ...(input.dependencyRanges ?? []),
      { name: 'some-future-dep', version: '2.0.0', range: '>=26.0.0' },
    ];
    const { problems } = evaluateRuntimeSupport(input);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('some-future-dep@2.0.0');
  });

  it('fails on a floating major pin, even though it resolves safely today', () => {
    // `.nvmrc: 22` is only safe because nvm and setup-node resolve it to the
    // newest 22.x. Its declared meaning includes 22.0-22.11, where boot is
    // impossible — a statement that is true by accident is the shape of this
    // whole finding.
    const input = healthy();
    input.nodePins[0] = { source: '.nvmrc', value: '22' };
    const { problems } = evaluateRuntimeSupport(input);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('.nvmrc pins Node "22"');
    expect(problems[0]).toContain('not a concrete version');
  });

  it('fails when the pins disagree with each other', () => {
    const input = healthy();
    input.nodePins[1] = { source: 'infra/docker/Dockerfile.api', value: '22.14.0' };
    const { problems } = evaluateRuntimeSupport(input);
    expect(problems.join('\n')).toContain('2 different Node versions');
  });

  it('fails when a Dockerfile stops declaring ARG NODE_VERSION', () => {
    // A missing declaration must be reported, never skipped: silence means the
    // image floats to whatever the `node:` tag resolves to at build time.
    const input = healthy();
    input.nodePins[1] = { source: 'infra/docker/Dockerfile.api', value: null };
    const { problems } = evaluateRuntimeSupport(input);
    expect(problems.join('\n')).toContain('declares no Node version');
  });

  it('fails when engines.pnpm blesses a major that never produced this lockfile', () => {
    // The second defect in the same field, which PF-73 never mentioned:
    // `>=8.0.0` alongside `pnpm@9.12.3`. pnpm 8 writes lockfileVersion 6.0 and
    // this repository's lockfile is 9.0.
    const { problems } = evaluateRuntimeSupport({ ...healthy(), declaredPnpm: '>=8.0.0' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('a different major from the packageManager pin');
  });

  it("fails when CI's PNPM_VERSION drifts from packageManager", () => {
    const { problems } = evaluateRuntimeSupport({ ...healthy(), workflowPnpmVersion: '9.15.0' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('PNPM_VERSION');
  });

  it('fails when the gate itself runs on an unsupported runtime', () => {
    // Everything downstream in ci-gate.sh is validated by whatever Node is
    // running it. A gate that tolerates being run on an unsupported runtime is
    // reporting on a configuration nobody ships.
    const { problems } = evaluateRuntimeSupport({ ...healthy(), runningNode: 'v20.11.0' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('this gate is running on Node 20.11.0');
  });

  it('treats an uninstalled dependency set as a failure, not a skip', () => {
    // Without node_modules there is nothing to compare against and check (1)
    // would pass vacuously — which is how PF-69, PF-70 and PF-74 all happened.
    const { problems } = evaluateRuntimeSupport({ ...healthy(), dependencyRanges: null });
    expect(problems.join('\n')).toContain('node_modules/.pnpm is missing');
    expect(problems.join('\n')).toContain('not a skip');
  });

  it('rejects an unparseable declaration rather than ignoring it', () => {
    const { problems } = evaluateRuntimeSupport({ ...healthy(), declaredNode: 'lts/*' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not a valid semver range');
  });
});

describe('runtime engines gate — the declaration in the repository', () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
    engines?: { node?: string; pnpm?: string };
    packageManager?: string;
    devDependencies?: Record<string, string>;
  };

  it('declares a Node range that excludes every version the API cannot boot on', () => {
    // Asserted as behaviour rather than as a string, so a future widening has to
    // be wrong to fail rather than merely different.
    const input = { ...healthy(), declaredNode: pkg.engines?.node ?? '' };
    const { problems } = evaluateRuntimeSupport(input);
    expect(problems).toEqual([]);
  });

  it('pins one concrete Node version in .nvmrc, every Dockerfile and ci.yml', () => {
    const pins = new Set<string>();
    pins.add(readFileSync(NVMRC_PATH, 'utf8').trim());

    const dockerfiles = readdirSync(DOCKER_DIR).filter((n) => n.startsWith('Dockerfile'));
    // Discovery, not a list — a fourth Dockerfile must be covered without anyone
    // remembering to add it here.
    expect(dockerfiles.length).toBeGreaterThan(0);
    for (const name of dockerfiles) {
      const match = /^ARG\s+NODE_VERSION=(\S+)\s*$/m.exec(readFileSync(join(DOCKER_DIR, name), 'utf8'));
      expect(match).not.toBeNull();
      pins.add(match?.[1] ?? '');
    }

    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    const nodeVersion = /^\s{2}NODE_VERSION:\s*'([^']+)'/m.exec(workflow);
    expect(nodeVersion).not.toBeNull();
    pins.add(nodeVersion?.[1] ?? '');

    expect([...pins]).toHaveLength(1);
    expect([...pins][0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('depends on semver directly rather than reaching into the virtual store', () => {
    // The comparison is version-range algebra. Hand-rolling it in a guard is how
    // run 10's JSONC-by-regex nearly passed vacuously, so the guard uses the real
    // implementation — and it must be a declared dependency, not a transitive one
    // that a future lockfile change could remove without warning.
    expect(pkg.devDependencies?.semver).toBeDefined();
    expect(readFileSync(SCRIPT_PATH, 'utf8')).toContain("require('semver')");
  });
});

describe('runtime engines gate — wiring', () => {
  it('runs as a stage of scripts/ci-gate.sh', () => {
    expect(existsSync(GATE_PATH)).toBe(true);
    expect(readFileSync(GATE_PATH, 'utf8')).toContain('node scripts/runtime-engines-check.js');
  });

  it('runs in .github/workflows/ci.yml too, so the two cannot drift', () => {
    // S-E02-2 AC-4. The local runner is the gate today (PF-59 keeps the hosted
    // runner dark); when Actions returns, both must still run this.
    expect(readFileSync(WORKFLOW_PATH, 'utf8')).toContain('node scripts/runtime-engines-check.js');
  });

  it('has no bypass flag (DNC-10)', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    for (const flag of ['SKIP_ENGINES_CHECK', 'ALLOW_ENGINE_MISMATCH', 'ENGINES_CHECK_SKIP']) {
      expect(source).not.toContain(flag);
    }
    expect(source).not.toMatch(/process\.env\.[A-Z_]*(SKIP|BYPASS|FORCE)[A-Z_]*/);
    // There is no `--update` either: the reviewed record is `engines` in
    // package.json, so widening support always appears in the diff.
    expect(source).not.toContain("'--update'");
  });
});
