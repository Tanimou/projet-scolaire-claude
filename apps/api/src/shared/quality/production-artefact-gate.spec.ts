import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * PF-17 / PF-54 guard — development artefacts must not ship in
 * production-facing source (S-E06-1).
 *
 * WHAT WAS ACTUALLY WRONG
 * -----------------------
 * Four surfaces on the hosted deployment rendered, to real users, an
 * instruction to look for their activation email in `http://localhost:1080` —
 * a Maildev container that exists only in a developer's compose stack. And the
 * Keycloak admin client resolved its credentials with `?? 'admin'` while
 * `infra/docker-compose.yml` declared neither variable, so the hosted API
 * really did authenticate as `admin`/`admin`.
 *
 * Both were found by reading. This suite exists so that neither can come back
 * without something failing.
 *
 * DIVISION OF LABOUR (the house shape — boot-gate, web-artifact-gate, …)
 * ---------------------------------------------------------------------
 *   • `scripts/production-artefact-check.js` — owns the exit code and IS the
 *     gate stage.
 *   • this file — proves that gate is still connected to both gate files, that
 *     it still fires, and that its scope has not been quietly narrowed.
 *
 * The scanner is EXECUTED here, in both directions, rather than asserted about.
 * The negative direction runs over a throw-away fixture tree in `os.tmpdir()`,
 * never against the repository: planting `http://localhost:1080` in a tracked
 * file to prove the detector works would leave every later gate run red if the
 * suite were aborted — and this project has a documented history of runs being
 * reclaimed mid-flight.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'production-artefact-check.js');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'production-artefact-baseline.json');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'ci-gate.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

/** The roots the scan must never stop covering. */
const SCAN_ROOTS = ['apps/web/src', 'apps/api/src', 'apps/worker/src'];

/**
 * The four surfaces that carried the Maildev copy. Asserted independently of
 * the scanner, so a scanner whose regex silently stopped matching does not make
 * this suite green over a reintroduced leak.
 */
const HISTORICAL_SURFACES = [
  'apps/web/src/app/admin/register/page.tsx',
  'apps/web/src/app/teacher/register/page.tsx',
  'apps/web/src/app/admin/users/invite/InviteForm.tsx',
];

let scratch: string;

function run(args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: 'utf8' });
}

function fixture(name: string, files: Record<string, string>): string {
  const dir = join(scratch, name);
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(dir, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }
  return dir;
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'production-artefact-gate-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('production artefact gate (S-E06-1 / PF-17, PF-54)', () => {
  it('resolves the repository and every scan root — guards the guard', () => {
    // A broken REPO_ROOT would make every assertion below pass vacuously over
    // an empty tree, which is the bug that made the first draft of
    // lint-ratchet.spec.ts report zero packages.
    expect(existsSync(join(REPO_ROOT, 'package.json'))).toBe(true);
    for (const root of SCAN_ROOTS) {
      expect(existsSync(join(REPO_ROOT, root))).toBe(true);
    }
  });

  it('the scanner declares all three application sources as scan roots', () => {
    // A later narrowing — "just scan apps/web, that is where the leak was" —
    // would turn this gate into a tautology over four lines someone deleted.
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    for (const root of SCAN_ROOTS) {
      expect(source).toContain(root);
    }
  });

  it('exits 0 on the fixed tree — executed, not asserted', () => {
    const res = run();
    expect(`${res.stdout}${res.stderr}`).toContain('production-artefact-check:');
    expect(res.status).toBe(0);
  });

  it('scans a non-trivial number of files — a scan over nothing is not a pass', () => {
    const res = run();
    const match = /production-artefact-check: (\d+) file\(s\)/.exec(res.stdout);
    expect(match).not.toBeNull();
    expect(Number(match?.[1] ?? 0)).toBeGreaterThan(100);
  });

  it('exits 1 on a reintroduced Maildev URL, naming file:line', () => {
    const dir = fixture('maildev', {
      'note.tsx': ['export const Hint = () => (', '  <p>Maildev → http://localhost:1080</p>', ');', ''].join('\n'),
    });
    const res = run(['--root', dir]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('note.tsx:2');
    expect(res.stderr).toMatch(/\[A1\]/);
    expect(res.stderr).toMatch(/\[A3\]/);
  });

  it('exits 1 on a reintroduced default-credential fallback, naming file:line', () => {
    const dir = fixture('credential', {
      'apps/api/src/kc.ts': [
        'export const user = process.env.KEYCLOAK_ADMIN_USER ?? "admin";',
        '',
      ].join('\n'),
    });
    const res = run(['--root', dir]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('apps/api/src/kc.ts:1');
    expect(res.stderr).toMatch(/\[A5\]/);
  });

  it('exits 1 on a hard-coded seed identity, naming file:line', () => {
    const dir = fixture('seed', {
      'apps/api/src/demo.ts': ['export const owner = "Sophie Dupont";', ''].join('\n'),
    });
    const res = run(['--root', dir]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('apps/api/src/demo.ts:1');
    expect(res.stderr).toMatch(/\[A4\]/);
  });

  it('does not flag a doc comment that accurately explains Maildev', () => {
    // Deleting true documentation to satisfy a regex makes the codebase worse.
    // The api/worker rule matches string LITERALS; comments are left alone, and
    // this asserts that distinction is real rather than claimed.
    const commented = fixture('doc-comment', {
      'apps/api/src/mailer.ts': [
        '/**',
        ' * In dev these point at the Maildev catcher wired in infra/docker-compose.yml.',
        ' */',
        'export const ok = 1;',
        '',
      ].join('\n'),
    });
    expect(run(['--root', commented]).status).toBe(0);

    const literal = fixture('string-literal', {
      'apps/api/src/mailer.ts': ['export const host = "maildev";', ''].join('\n'),
    });
    const res = run(['--root', literal]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/\[A2\]/);
  });

  it('the four historical surfaces no longer carry the dev copy', () => {
    // Independent of the scanner entirely. If the regex silently stopped
    // matching, this still fails.
    for (const rel of HISTORICAL_SURFACES) {
      const source = readFileSync(join(REPO_ROOT, rel), 'utf8');
      expect(source).not.toMatch(/maildev/i);
      expect(source).not.toMatch(/localhost:1080/);
    }
  });

  it('the API no longer falls back to default Keycloak credentials', () => {
    const admin = readFileSync(
      join(REPO_ROOT, 'apps', 'api', 'src', 'shared', 'keycloak', 'keycloak-admin.service.ts'),
      'utf8',
    );
    expect(admin).not.toMatch(/KEYCLOAK_ADMIN_USER'\)\s*\?\?/);
    expect(admin).not.toMatch(/KEYCLOAK_ADMIN_PASSWORD'\)\s*\?\?/);
    expect(admin).not.toMatch(/KEYCLOAK_URL'\)\s*\?\?/);

    const jwt = readFileSync(
      join(REPO_ROOT, 'apps', 'api', 'src', 'shared', 'auth', 'jwt.strategy.ts'),
      'utf8',
    );
    expect(jwt).not.toMatch(/KEYCLOAK_URL'\)\s*\?\?/);

    const kcModule = readFileSync(
      join(REPO_ROOT, 'apps', 'api', 'src', 'shared', 'keycloak', 'keycloak.module.ts'),
      'utf8',
    );
    // The compose service name must not survive as a VALUE. A comment that
    // explains why it was removed is accurate documentation, and the scanner's
    // A2 rule reads string literals rather than comments for the same reason.
    expect(kcModule).not.toMatch(/(?:\?\?|\|\|)\s*['"`]maildev['"`]/i);
    expect(kcModule).not.toMatch(/:\s*['"`]maildev['"`]/i);
  });

  describe('Tier-B ratchet', () => {
    const FALLBACK = "export const url = process.env.REDIS_URL ?? 'redis://localhost:6379';\n";

    function ratchetFixture(name: string, ceiling: number | null) {
      const files: Record<string, string> = { 'apps/api/src/q.ts': FALLBACK };
      if (ceiling !== null) {
        files['scripts/production-artefact-baseline.json'] = JSON.stringify({
          files: { 'apps/api/src/q.ts': ceiling },
        });
      }
      return fixture(name, files);
    }

    it('fails on a file with a hit that is absent from the baseline', () => {
      const res = run(['--root', ratchetFixture('tier-b-unlisted', null)]);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/absent from the Tier-B baseline/);
    });

    it('fails on a count ABOVE the baseline', () => {
      const res = run(['--root', ratchetFixture('tier-b-above', 0)]);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/exceeds the baseline/);
    });

    it('fails on a count BELOW the baseline, asking for it to be lowered', () => {
      // A ratchet that never tightens is a rubber band.
      const res = run(['--root', ratchetFixture('tier-b-below', 2)]);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/is BELOW the baseline/);
      expect(res.stderr).toMatch(/Lower it to 1/);
    });

    it('passes on an exact match', () => {
      expect(run(['--root', ratchetFixture('tier-b-exact', 1)]).status).toBe(0);
    });

    it('refuses to --update while any Tier-A rule fires', () => {
      // The rule boot-check.js and web-artifact-check.js both learned: never
      // freeze a broken tree into the reviewed inventory.
      const dir = fixture('tier-b-refuse-update', {
        'apps/api/src/q.ts': FALLBACK,
        'apps/api/src/leak.ts': 'export const host = "maildev";\n',
      });
      const res = run(['--root', dir, '--update']);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/refusing to write the baseline/);
      expect(existsSync(join(dir, 'scripts', 'production-artefact-baseline.json'))).toBe(false);
    });

    it('the repository baseline is a reviewed inventory, not an empty shell', () => {
      const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as {
        files: Record<string, number>;
      };
      const entries = Object.entries(baseline.files);
      // 16 files / 17 fallbacks measured when the inventory was created. A
      // baseline that collapsed to a handful would satisfy a naive "file
      // exists" check while covering almost nothing.
      expect(entries.length).toBeGreaterThanOrEqual(15);
      for (const [file, count] of entries) {
        expect(existsSync(join(REPO_ROOT, file))).toBe(true);
        expect(count).toBeGreaterThan(0);
      }
    });
  });

  describe('gate wiring', () => {
    it('ci-gate.sh runs the scan, early — before the build stage', () => {
      const gate = readFileSync(GATE_PATH, 'utf8');
      expect(gate).toMatch(/node\s+scripts\/production-artefact-check\.js/);
      // Ordering is a correctness requirement, not style: the scan reads source
      // only, so it needs no install, no Prisma client and no build. Running it
      // early means it fails on the diff rather than ten minutes later — and it
      // runs under `--quick` too, which the post-build stages do not.
      // `run_stage` now carries a timeout argument, and the build moved to the
      // --full tier. Both leave this ordering requirement intact: the scan is
      // source-only, so it must still come before anything that needs a build.
      const scanAt = gate.indexOf('scripts/production-artefact-check.js');
      const buildAt = gate.search(/run_stage\s+\d+\s+"build"/);
      expect(scanAt).toBeGreaterThan(-1);
      expect(buildAt).toBeGreaterThan(-1);
      expect(scanAt).toBeLessThan(buildAt);
    });

    it('ci.yml runs it too, so the two gates cannot drift (S-E02-2 AC-4)', () => {
      const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
      expect(workflow).toMatch(/node\s+scripts\/production-artefact-check\.js/);
    });

    it('neither gate file passes --root — the fixture hatch is for the spec only', () => {
      for (const path of [GATE_PATH, WORKFLOW_PATH]) {
        const contents = readFileSync(path, 'utf8');
        const line = contents
          .split(/\r?\n/)
          .find((l) => l.includes('production-artefact-check.js'));
        expect(line).toBeDefined();
        expect(line).not.toContain('--root');
      }
    });

    it('ci.yml supplies the now-required configuration to the boot stage', () => {
      // The fail-fast is only safe because CI can satisfy it. `apps/api/.env` is
      // gitignored, so a fresh checkout has nothing; without these the boot,
      // observability and tracing stages would go red on a slice that shipped
      // no bug. Placeholders are honest here — nothing in boot-check contacts
      // Keycloak.
      const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
      for (const name of ['KEYCLOAK_URL', 'KEYCLOAK_ADMIN_USER', 'KEYCLOAK_ADMIN_PASSWORD']) {
        expect(workflow).toContain(`${name}:`);
      }
    });
  });

  describe('no escape hatch (DNC-10)', () => {
    it('the scanner reads no bypass environment variable', () => {
      const source = readFileSync(SCRIPT_PATH, 'utf8');
      for (const flag of [
        'SKIP_ARTEFACT_CHECK',
        'ALLOW_DEV_ARTEFACTS',
        'PRODUCTION_ARTEFACT_CHECK',
        'BYPASS',
      ]) {
        expect(source).not.toContain(`process.env.${flag}`);
      }
      expect(source).not.toMatch(/process\.env\.[A-Z_]*(SKIP|BYPASS|FORCE|ALLOW)[A-Z_]*/);
    });

    it('the config preflight cannot be switched off either', () => {
      const source = readFileSync(
        join(REPO_ROOT, 'apps', 'api', 'src', 'shared', 'config', 'config-preflight.ts'),
        'utf8',
      );
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/[A-Z_]*(SKIP|BYPASS|FORCE|ALLOW)[A-Z_]*\s*===/);
    });
  });

  describe('configuration supply parity — the deploy must not discover this', () => {
    // FM-1: making a variable required while no compose file declares it turns
    // the next deploy into a crash loop. This is the assertion that would have
    // caught it before the server did, and it needs no runtime.
    const REQUIRED = ['KEYCLOAK_ADMIN_USER', 'KEYCLOAK_ADMIN_PASSWORD'];

    it.each(REQUIRED)('%s is declared in infra/docker-compose.yml', (name) => {
      const compose = readFileSync(join(REPO_ROOT, 'infra', 'docker-compose.yml'), 'utf8');
      expect(compose).toContain(`${name}:`);
    });

    it.each(REQUIRED)('%s is required by infra/docker-compose.prod.yml', (name) => {
      const compose = readFileSync(join(REPO_ROOT, 'infra', 'docker-compose.prod.yml'), 'utf8');
      // `${VAR:?…}` makes compose refuse the deploy COMMAND by name, rather
      // than crash-looping a container on the server.
      expect(compose).toMatch(new RegExp(`\\$\\{${name}:\\?`));
    });

    it.each(REQUIRED)('%s is documented in both env templates', (name) => {
      for (const file of ['.env.example', '.env.prod.example']) {
        expect(readFileSync(join(REPO_ROOT, file), 'utf8')).toContain(`${name}=`);
      }
    });

    it('the Keycloak service keeps its own untouched bootstrap admin', () => {
      // Rotating KEYCLOAK_ADMIN/KEYCLOAK_ADMIN_PASSWORD on the `keycloak`
      // service would not rotate anything — those only create the bootstrap
      // admin on a FIRST start — but it would leave the API unable to
      // authenticate against the existing hosted database. Rotation is an
      // operator action, recorded rather than performed.
      const compose = readFileSync(join(REPO_ROOT, 'infra', 'docker-compose.yml'), 'utf8');
      expect(compose).toMatch(/KEYCLOAK_ADMIN:\s*admin/);
    });
  });
});
