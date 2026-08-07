import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * PF-86 guard — the documented way to start the stack must start the stack that
 * is documented (S-E02-16).
 *
 * WHAT PF-86 IS
 * -------------
 * Docker Compose resolves `.env` from the **project directory** — the directory
 * of the compose file, `infra/` — not from the caller's cwd. `infra/.env` does
 * not exist here; every port lives in the **root** `.env`, beside the
 * `DATABASE_URL` that prisma, the seeds and every host-side script read. So
 * `docker compose -f infra/docker-compose.yml up -d` — the command in this
 * repository's own compose header, and in the routine's SKILL Step -1 — saw
 * none of those variables and fell silently through to `${VAR:-default}`.
 *
 * Two commands that look identical produced two different stacks, and the
 * difference was invisible until something outside a container tried to
 * connect.
 *
 * MEASURED, AND WORSE THAN RECORDED
 * ---------------------------------
 * PF-86 was filed as `TECH_DEBT` — "a defect in how the system is described to
 * be run". Measuring it produced a functional break needing no reference to any
 * untracked file. Inside `infra/docker-compose.yml` alone:
 *
 *   KC_HOSTNAME:         http://localhost:8180        (hard-coded)
 *   KEYCLOAK_PUBLIC_URL: http://localhost:8180        (hard-coded — and the api
 *                                                      uses it as the EXPECTED
 *                                                      TOKEN ISSUER)
 *   keycloak.ports:      ${KEYCLOAK_PORT:-8080}:8080
 *   web NEXT_PUBLIC_KEYCLOAK_URL: http://localhost:${KEYCLOAK_PORT:-8080}
 *
 * On the documented path Keycloak published on host 8080, announced itself as
 * 8180, sent the browser to 8080, and the api rejected the resulting token for
 * a wrong issuer. Login was broken by construction — and appeared to work only
 * because one machine's gitignored `.env` happened to say 8180, on a code path
 * where compose never read it.
 *
 * WHY THE EVALUATION IS A PURE FUNCTION
 * -------------------------------------
 * The method established by S-E02-12 and restated by every gate since: a check
 * run against a healthy repository can only demonstrate that the repository is
 * healthy. It can never demonstrate that the check would catch a regression. So
 * `evaluateComposeInvocation` takes a plain object, and this spec drives it with
 * configurations known to be wrong — including, verbatim, the one that shipped
 * before this slice.
 *
 * DIVISION OF LABOUR
 * ------------------
 *   • `scripts/compose-invocation-check.js` — inspects the real compose file and
 *     the real documentation, and executes `docker compose config` in both
 *     directions; its exit code is the gate.
 *   • this file — drives the evaluator with synthetic input in both directions,
 *     and proves the gate is still wired into `ci-gate.sh` and `ci.yml`.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'compose-invocation-check.js');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'ci-gate.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const COMPOSE_PATH = join(REPO_ROOT, 'infra', 'docker-compose.yml');
const ENV_EXAMPLE_PATH = join(REPO_ROOT, '.env.example');

interface Evaluation {
  problems: string[];
  stats: {
    services: number;
    portEntries: number;
    publishedPortVars: string[];
    requiredVars: string[];
    literalHostPorts: string[];
    invocationsChecked: number;
  };
}

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  evaluateComposeInvocation,
  splitPortEntry,
  classifyInterpolation,
  interpolationsIn,
  envNames,
  DOCUMENTED_INVOCATION_FILES,
} = require(SCRIPT_PATH) as {
  evaluateComposeInvocation: (input: unknown) => Evaluation;
  splitPortEntry: (entry: string) => {
    bindAddress: string | null;
    hostSpec: string | null;
    containerSpec: string;
  };
  classifyInterpolation: (text: string) => { variable: string; kind: string } | null;
  interpolationsIn: (text: string) => Array<{ variable: string; kind: string }>;
  envNames: (text: string) => string[];
  DOCUMENTED_INVOCATION_FILES: string[];
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** The message the real file uses; irrelevant to the rules, so kept short here. */
const REQ = (v: string) => `\${${v}:?${v} missing}`;

type Svc = Record<string, unknown>;
type Project = { services: Record<string, Svc> };

/**
 * Mutable accessor for a fixture service.
 *
 * `noUncheckedIndexedAccess` is on, so indexing a `Record` yields `T | undefined`
 * and every fixture mutation would need a non-null assertion at the call site.
 * Throwing here instead keeps the assertions readable AND turns a typo in a
 * fixture name into a named failure rather than a silent no-op mutation on
 * `undefined` — which would make the case pass for the wrong reason.
 */
function svc(project: Project, name: string): Svc {
  const found = project.services[name];
  if (!found) throw new Error(`fixture has no service "${name}"`);
  return found;
}

/** Add or replace a service in the fixture. */
function put(project: Project, name: string, definition: Svc): void {
  project.services[name] = definition;
}

/** A minimal healthy project the individual cases mutate. */
function healthy(): Project {
  return {
    services: {
      postgres: { ports: [`${REQ('POSTGRES_PORT')}:5432`] },
      keycloak: {
        environment: { KC_HOSTNAME: `http://localhost:${REQ('KEYCLOAK_PORT')}` },
        ports: [`${REQ('KEYCLOAK_PORT')}:8080`],
      },
      migrator: { profiles: ['app', 'seed'] },
      seed: {
        profiles: ['seed'],
        depends_on: { migrator: { condition: 'service_completed_successfully' } },
      },
    },
  };
}

const HEALTHY_ENV = ['POSTGRES_PORT', 'KEYCLOAK_PORT'];

function run(compose: unknown, envExampleNames = HEALTHY_ENV, invocationLines: unknown[] = []) {
  return evaluateComposeInvocation({ compose, envExampleNames, invocationLines });
}

describe('compose invocation gate (PF-86 / S-E02-16)', () => {
  // -------------------------------------------------------------------------
  // The positive direction, once — everything else drives a known-bad input.
  // -------------------------------------------------------------------------
  it('passes a coherent project', () => {
    expect(run(healthy()).problems).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // C1 — no silent default on a published host port
  // -------------------------------------------------------------------------
  describe('C1 — a published host port may not carry a silent default', () => {
    it('fails the exact shape that shipped before this slice', () => {
      const compose = healthy();
      // Verbatim pre-slice: `${KEYCLOAK_PORT:-8080}:8080`.
      svc(compose, 'keycloak').ports = [
        '${KEYCLOAK_PORT:-8080}:8080',
      ];
      const { problems } = run(compose);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('C1');
      expect(problems[0]).toContain('KEYCLOAK_PORT');
      expect(problems[0]).toContain('silent default');
    });

    it('fails a bare ${VAR}, which substitutes the empty string rather than refusing', () => {
      const compose = healthy();
      svc(compose, 'postgres').ports = [
        '${POSTGRES_PORT}:5432',
      ];
      const { problems } = run(compose);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('bare interpolation');
    });

    it('accepts a literal host port — nothing can diverge from a constant', () => {
      const compose = healthy();
      svc(compose, 'postgres').ports = ['5433:5432'];
      // The literal is now a published port, so C3 has something to match too.
      expect(run(compose).problems).toEqual([]);
    });

    it('holds the long syntax as well as the short one', () => {
      const compose = healthy();
      svc(compose, 'postgres').ports = [
        { target: 5432, published: '${POSTGRES_PORT:-5432}', protocol: 'tcp' },
      ];
      const { problems } = run(compose);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('C1');
    });

    it('ignores a container-only entry, which publishes an ephemeral port', () => {
      const compose = healthy();
      svc(compose, 'postgres').ports = ['5432'];
      expect(run(compose).problems).toEqual([]);
    });

    it('reads the host side of the 127.0.0.1:HOST:CONTAINER form', () => {
      const compose = healthy();
      svc(compose, 'postgres').ports = [
        '127.0.0.1:${WORKER_HTTP_PORT:-4001}:4001',
      ];
      const { problems } = run(compose);
      expect(problems.some((p) => p.includes('C1') && p.includes('WORKER_HTTP_PORT'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // C2 — the refusal must be actionable
  // -------------------------------------------------------------------------
  describe('C2 — every required variable is documented', () => {
    it('fails when a :? variable is absent from .env.example', () => {
      const { problems } = run(healthy(), ['POSTGRES_PORT']);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('C2');
      expect(problems[0]).toContain('KEYCLOAK_PORT');
    });

    it('collects required variables from the whole file, not only from ports:', () => {
      const compose = healthy();
      put(compose, 'migrator', {
        environment: { SOME_URL: `http://x:${REQ('MYSTERY_PORT')}` },
      });
      const { problems } = run(compose);
      expect(problems.some((p) => p.includes('C2') && p.includes('MYSTERY_PORT'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // C3 — a port written twice diverges
  // -------------------------------------------------------------------------
  describe('C3 — no browser-facing URL hard-codes a variable host port', () => {
    it('fails the KC_HOSTNAME contradiction verbatim', () => {
      const compose = healthy();
      (svc(compose, 'keycloak').environment as Record<string, string>).KC_HOSTNAME = 'http://localhost:8180';
      const { problems } = run(compose);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('C3');
      expect(problems[0]).toContain('8180');
      expect(problems[0]).toContain('KC_HOSTNAME');
    });

    it('fails the issuer the api actually validates against', () => {
      const compose = healthy();
      (svc(compose, 'keycloak').environment as Record<string, string>).KEYCLOAK_PUBLIC_URL = 'http://127.0.0.1:8180';
      const { problems } = run(compose);
      expect(problems.some((p) => p.includes('C3') && p.includes('KEYCLOAK_PUBLIC_URL'))).toBe(true);
    });

    it('accepts a literal that IS a literal published port — no second source exists', () => {
      const compose = healthy();
      svc(compose, 'postgres').ports = ['5433:5432'];
      svc(compose, 'keycloak').environment = {
        KC_HOSTNAME: `http://localhost:${REQ('KEYCLOAK_PORT')}`,
        SOME_HOST_URL: 'http://localhost:5433',
      };
      expect(run(compose).problems).toEqual([]);
    });

    it('ignores an in-container address, which is not a host port', () => {
      const compose = healthy();
      (svc(compose, 'keycloak').environment as Record<string, string>).INTERNAL = 'http://keycloak:8080';
      expect(run(compose).problems).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // C4 — a profile must activate its own dependencies
  // -------------------------------------------------------------------------
  describe('C4 — profile reachability', () => {
    it('fails the seed/api shape verbatim: the documented seed command was an invalid project', () => {
      const compose = healthy();
      put(compose, 'api', { profiles: ['app'] });
      put(compose, 'seed', {
        profiles: ['seed'],
        depends_on: { api: { condition: 'service_healthy' } },
      });
      const { problems } = run(compose);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('C4');
      expect(problems[0]).toContain('--profile seed');
      expect(problems[0]).toContain('INVALID');
    });

    it('fails the nginx/web shape this gate discovered on its first run', () => {
      const compose = healthy();
      put(compose, 'web', { profiles: ['app'] });
      put(compose, 'nginx', {
        profiles: ['prod'],
        depends_on: { web: { condition: 'service_healthy' } },
      });
      const { problems } = run(compose);
      expect(problems.some((p) => p.includes('C4') && p.includes('--profile prod'))).toBe(true);
    });

    it('fails an always-on service depending on a profiled one — a plain `up` is invalid', () => {
      const compose = healthy();
      put(compose, 'alwaysOn', { depends_on: { migrator: { condition: 'service_started' } } });
      const { problems } = run(compose);
      expect(problems.some((p) => p.includes('C4') && p.includes('always enabled'))).toBe(true);
    });

    it('accepts a dependency on an unprofiled service — it is always enabled', () => {
      const compose = healthy();
      put(compose, 'seed', {
        profiles: ['seed'],
        depends_on: { postgres: { condition: 'service_healthy' } },
      });
      expect(run(compose).problems).toEqual([]);
    });

    it('names a depends_on target that does not exist at all', () => {
      const compose = healthy();
      put(compose, 'seed', { profiles: ['seed'], depends_on: { ghost: {} } });
      const { problems } = run(compose);
      expect(problems.some((p) => p.includes('C4') && p.includes('not defined at all'))).toBe(true);
    });

    it('reads the list form of depends_on as well as the mapping form', () => {
      const compose = healthy();
      put(compose, 'api', { profiles: ['app'] });
      put(compose, 'seed', { profiles: ['seed'], depends_on: ['api'] });
      const { problems } = run(compose);
      expect(problems.some((p) => p.includes('C4'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // C5 — documented invocations
  // -------------------------------------------------------------------------
  describe('C5 — a documented invocation carries --env-file', () => {
    it('fails an invocation without --env-file', () => {
      const { problems } = run(healthy(), HEALTHY_ENV, [
        { file: 'docs/X.md', line: 7, text: 'docker compose -f infra/docker-compose.yml up -d' },
      ]);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('C5');
      expect(problems[0]).toContain('docs/X.md:7');
    });

    it('accepts an invocation that carries it', () => {
      const { problems } = run(healthy(), HEALTHY_ENV, [
        {
          file: 'docs/X.md',
          line: 7,
          text: 'docker compose --env-file .env -f infra/docker-compose.yml up -d',
        },
      ]);
      expect(problems).toEqual([]);
    });

    it('exempts the hosted prod overlay, which is driven with its own env file', () => {
      const { problems } = run(healthy(), HEALTHY_ENV, [
        {
          file: 'scripts/deploy-prod.sh',
          line: 3,
          text: 'docker compose -f infra/docker-compose.prod.yml up -d',
        },
      ]);
      expect(problems).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Parsing helpers — the sharp edges, driven directly.
  // -------------------------------------------------------------------------
  describe('parsing', () => {
    it('splits on colons OUTSIDE an interpolation, so a :? message cannot fool it', () => {
      const entry = '${POSTGRES_PORT:?POSTGRES_PORT missing: run with --env-file .env}:5432';
      const { hostSpec, containerSpec } = splitPortEntry(entry);
      expect(containerSpec).toBe('5432');
      expect(hostSpec).toContain('POSTGRES_PORT');
    });

    it('classifies every interpolation form compose accepts', () => {
      expect(classifyInterpolation('${A:?x}')).toEqual({ variable: 'A', kind: 'required' });
      expect(classifyInterpolation('${A?x}')).toEqual({ variable: 'A', kind: 'required' });
      expect(classifyInterpolation('${A:-x}')).toEqual({ variable: 'A', kind: 'default' });
      expect(classifyInterpolation('${A-x}')).toEqual({ variable: 'A', kind: 'default' });
      expect(classifyInterpolation('${A}')).toEqual({ variable: 'A', kind: 'bare' });
    });

    it('finds several interpolations in one value', () => {
      const found = interpolationsIn('http://${HOST:-x}:${PORT:?y}/p');
      expect(found.map((f) => f.variable)).toEqual(['HOST', 'PORT']);
      expect(found.map((f) => f.kind)).toEqual(['default', 'required']);
    });

    it('reads names, never values, from an env file', () => {
      const names = envNames('# comment\nA=1\n\nB=secret\nnot a var\n');
      expect(names).toEqual(['A', 'B']);
    });
  });

  // -------------------------------------------------------------------------
  // The real repository — the shapes this slice fixed must stay fixed.
  // -------------------------------------------------------------------------
  describe('the repository itself', () => {
    const compose = readFileSync(COMPOSE_PATH, 'utf8');

    it('has no `${VAR:-…}` left on a published host port', () => {
      // The port lines are the ones ending `}:<container port>"`.
      const offenders = compose
        .split(/\r?\n/)
        .filter((l) => /^\s*-\s*"(?:127\.0\.0\.1:)?\$\{[A-Z_]+:-\d+\}:\d+"/.test(l));
      expect(offenders).toEqual([]);
    });

    it('no longer hard-codes the Keycloak issuer port anywhere', () => {
      // The header explains PF-86 and legitimately quotes `8180` in prose;
      // what must not exist is a VALUE carrying it.
      const valueLines = compose
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith('#'))
        .filter((l) => /localhost:8180/.test(l));
      expect(valueLines).toEqual([]);
    });

    it('declares every :? variable in .env.example', () => {
      // Comments are stripped first: the header explains the `${VAR:?…}` rule in
      // prose, and a placeholder inside an explanation is not a requirement the
      // file imposes. The check script does not need this because it reads the
      // PARSED yaml, where comments do not exist — this assertion reads raw text
      // and so has to say so explicitly.
      const composeValues = compose
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith('#'))
        .join('\n');
      const required = new Set(
        [...composeValues.matchAll(/\$\{([A-Z_]+):\?/g)]
          .map((m) => m[1])
          .filter((v): v is string => typeof v === 'string'),
      );
      const declared = new Set(envNames(readFileSync(ENV_EXAMPLE_PATH, 'utf8')));
      const missing = [...required].filter((v) => !declared.has(v)).sort();
      expect(missing).toEqual([]);
      expect(required.size).toBeGreaterThanOrEqual(13);
    });
  });

  // -------------------------------------------------------------------------
  // Wiring — a gate nobody runs is not a gate.
  // -------------------------------------------------------------------------
  describe('wiring', () => {
    it('the check script exists', () => {
      expect(existsSync(SCRIPT_PATH)).toBe(true);
    });

    it('is a stage of scripts/ci-gate.sh', () => {
      expect(readFileSync(GATE_PATH, 'utf8')).toContain('scripts/compose-invocation-check.js');
    });

    it('is a step of .github/workflows/ci.yml', () => {
      expect(readFileSync(WORKFLOW_PATH, 'utf8')).toContain('scripts/compose-invocation-check.js');
    });

    it('has no SKIP/ALLOW/BYPASS/FORCE escape hatch (DNC-10)', () => {
      const source = readFileSync(SCRIPT_PATH, 'utf8');
      // `--no-docker` is an explicit argument for environments without a docker
      // binary; it narrows the probe and is REPORTED, it does not pass the gate.
      expect(source).not.toMatch(/process\.env\.(SKIP|ALLOW|BYPASS|FORCE)/);
    });

    it('every file it claims to police still exists', () => {
      for (const rel of DOCUMENTED_INVOCATION_FILES) {
        expect(existsSync(join(REPO_ROOT, rel))).toBe(true);
      }
    });
  });
});
