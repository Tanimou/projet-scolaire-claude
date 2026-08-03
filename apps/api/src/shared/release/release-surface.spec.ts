import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * PF-68 / R-05 guard — the release gate must keep covering **every** deployed
 * artefact, and must keep comparing the schema.
 *
 * WHAT PF-68's RESIDUAL HALF ACTUALLY WAS
 * ---------------------------------------
 * `S-E02-6` built a real, executed comparison — for one artefact. The deployment
 * has three (`api`, `worker`, `web`), built and deployed separately; all three
 * already carried a `GIT_SHA` baked at build time, and two of them had nothing
 * that could read it. The gate also *printed* `schemaVersion` without ever
 * comparing it, and never read `migrations.status` at all — so a `match` artefact
 * sitting on an un-baselined database passed.
 *
 * WHY A FILE-READING GUARD, AND WHAT IT DOES NOT CLAIM
 * ----------------------------------------------------
 * The behaviour itself is proven by execution elsewhere and deliberately not
 * re-asserted here:
 *   • `release-manifest.spec.ts`               — the comparator, every verdict.
 *   • `apps/worker/.../version-server.spec.ts` — a real socket, really queried.
 *   • `scripts/release-gate.sh`                — run against real manifests.
 * This file guards the *wiring*: that no artefact can quietly drop out of the
 * gate's scope, which is exactly how the first three quarters of this finding
 * came to exist. It never claims a deployment is conforming.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const GATE = join(REPO_ROOT, 'scripts', 'release-gate.sh');
const DEPLOY = join(REPO_ROOT, 'scripts', 'deploy-prod.sh');
const COMPOSE = join(REPO_ROOT, 'infra', 'docker-compose.yml');
const NGINX = join(REPO_ROOT, 'infra', 'nginx', 'conf.d', 'pilotage.conf');
const WORKER_SERVER = join(REPO_ROOT, 'apps', 'worker', 'src', 'shared', 'release', 'version-server.ts');
const WORKER_MAIN = join(REPO_ROOT, 'apps', 'worker', 'src', 'main.ts');
const WEB_ROUTE = join(REPO_ROOT, 'apps', 'web', 'src', 'app', 'version', 'web', 'route.ts');
const API_CONTROLLER = join(REPO_ROOT, 'apps', 'api', 'src', 'modules', 'health', 'health.controller.ts');
const SHARED = join(REPO_ROOT, 'packages', 'contracts', 'src', 'release', 'index.ts');

const read = (p: string) => readFileSync(p, 'utf8');

/** The three artefacts the deployment ships. Adding a fourth must break this list. */
const ARTIFACTS = ['api', 'worker', 'web'] as const;

describe('every deployed artefact publishes a manifest (S-E02-10 / PF-68)', () => {
  it('the comparator lives in one place, shared by all three', () => {
    expect(existsSync(SHARED)).toBe(true);
    const src = read(SHARED);
    for (const fn of ['evaluateRelease', 'isServable', 'buildManifestPayload', 'assertReleaseMatches']) {
      expect(src).toContain(`export function ${fn}`);
    }
    // Three copies of a version comparator drift, and a drifted copy would turn
    // green the half of the deployment it is not looking at.
    expect(src).toContain("export type ReleaseApp = 'api' | 'worker' | 'web'");
  });

  it('the api re-exports rather than re-implementing', () => {
    const manifest = read(join(REPO_ROOT, 'apps', 'api', 'src', 'shared', 'release', 'release-manifest.ts'));
    expect(manifest).toContain("from '@pilotage/contracts'");
    expect(manifest).not.toContain('function evaluateRelease');
  });

  it.each(ARTIFACTS)('%s serves a manifest naming itself', (app) => {
    const source = { api: API_CONTROLLER, worker: WORKER_SERVER, web: WEB_ROUTE }[app];
    expect(existsSync(source)).toBe(true);
    expect(read(source)).toContain(`buildManifestPayload('${app}')`);
  });

  it('the worker actually listens, and closes the socket on shutdown', () => {
    const main = read(WORKER_MAIN);
    expect(main).toContain('startVersionServer');
    expect(main).toContain('versionServer.close');
    // The worker writes real data from real queues: a drifted worker must refuse
    // to start, exactly as a drifted api refuses to serve.
    expect(main).toContain("assertReleaseMatches(bootLogger, 'worker')");
  });

  it('the web route is dynamic — a prerendered manifest would describe the build, not the container', () => {
    expect(read(WEB_ROUTE)).toContain("export const dynamic = 'force-dynamic'");
  });
});

describe('the gate interrogates all three, and the schema (S-E02-10 / PF-68)', () => {
  const gate = read(GATE);

  it.each(ARTIFACTS)('checks %s', (app) => {
    expect(gate).toMatch(new RegExp(`check_artifact\\s+${app}\\b`));
  });

  it('compares the schema instead of only printing it', () => {
    expect(gate).toContain('check_schema');
    // `status: clean` only means "this image's own migrations are applied", so an
    // older image is clean about its own lag. The useful comparison is against
    // what THIS checkout ships — read off the filesystem, not asked of the
    // artefact being judged.
    expect(gate).toContain('EXPECTED_SCHEMA');
    expect(gate).toContain('apps/api/prisma/migrations');
    for (const status of ['unbaselined', 'pending', 'failed']) {
      expect(gate).toContain(status);
    }
  });

  it('verifies which artefact answered', () => {
    // Without this, a misrouted proxy returning the api manifest on the worker
    // path is indistinguishable from a conforming worker — the gate would be
    // green on an artefact it never reached.
    expect(gate).toContain('reported_app');
  });

  it('treats an unreachable artefact as a failure, never as a skip (DNC-08)', () => {
    expect(gate).toContain('manifeste injoignable');
    expect(gate).not.toMatch(/\bskip|\bcontinue\b.*injoignable/i);
  });

  it('has no bypass flag (DNC-10)', () => {
    for (const flag of [
      'SKIP_RELEASE_GATE',
      'RELEASE_GATE_SKIP',
      'FORCE_RELEASE',
      'ALLOW_DRIFT',
      'RELEASE_GATE_DISABLE',
      'IGNORE_SCHEMA',
    ]) {
      expect(gate).not.toContain(flag);
    }
    // The URL overrides are addresses, not switches: none of them can remove an
    // artefact from the check, because the check runs unconditionally.
    for (const app of ARTIFACTS) {
      expect(gate).toMatch(new RegExp(`^check_artifact\\s+${app}\\b`, 'm'));
    }
  });
});

describe('the deployment wires the expectation into all three (S-E02-10 / PF-68)', () => {
  const compose = read(COMPOSE);
  const deploy = read(DEPLOY);
  const nginx = read(NGINX);

  it('injects EXPECTED_GIT_SHA into api, worker and web', () => {
    // Three occurrences: the value is what the operator BELIEVES they deployed.
    // An artefact that never receives it can only ever answer `unverified`.
    const injections = compose.match(/EXPECTED_GIT_SHA:\s*\$\{EXPECTED_GIT_SHA/g) ?? [];
    expect(injections).toHaveLength(ARTIFACTS.length);
  });

  it('bakes GIT_SHA into all three images at build time', () => {
    for (const app of ARTIFACTS) {
      const dockerfile = join(REPO_ROOT, 'infra', 'docker', `Dockerfile.${app}`);
      expect(read(dockerfile)).toContain('ARG GIT_SHA');
    }
  });

  it('reaches every manifest from deploy-prod.sh', () => {
    for (const app of ARTIFACTS) {
      expect(deploy).toContain(`RELEASE_GATE_${app.toUpperCase()}_URL=`);
    }
  });

  it('routes every manifest through nginx, so a remote operator can check too', () => {
    expect(nginx).toContain('location = /version {');
    expect(nginx).toContain('location = /version/worker {');
    expect(nginx).toContain('location = /version/web {');
    expect(nginx).toContain('worker_upstream');
  });

  it('publishes the worker manifest port on loopback only', () => {
    // It carries no business surface and nobody outside the host needs it; the
    // public path is nginx's rate-limited exact-match location.
    expect(compose).toContain('127.0.0.1:${WORKER_HTTP_PORT:-4001}:4001');
  });
});
