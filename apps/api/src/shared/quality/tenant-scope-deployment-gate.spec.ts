import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * S-E01-1h / PF-242 — the tenant scope was BUILT, PROVEN and never TURNED ON.
 *
 * THE MEASUREMENT THIS FILE EXISTS FOR
 * ------------------------------------
 * Three runs converted three modules (`calendar`, `lessons`, `announcements`) to
 * `TenantScopeService.run(...)`, and each proved its seam by execution against a
 * scratch database. None of them was ever exercised on the stack this routine
 * calls its runtime target, because `infra/docker-compose.yml` never declared
 * `DATABASE_URL_APP`:
 *
 *     docker exec pilotage_api sh -c 'echo "APP=$DATABASE_URL_APP"'   →  APP=
 *
 * `AppRolePrismaService` opens the RLS-bearing connection only when that
 * variable is present, so the api sat in `degraded_no_app_url` and every
 * converted call site ran on the OWNER connection — `pilotage`, measured
 * `rolbypassrls = true`. The scratch-database proofs were true and the
 * deployment was not covered by them.
 *
 * WHY THIS NEEDS A RATCHET RATHER THAN A REVIEW
 * ---------------------------------------------
 * The degradation is SILENT BY DESIGN, and the design is right: a deployment
 * that cannot open the second connection must still serve. The price is that
 * four different mistakes produce one indistinguishable observable — a healthy
 * stack with `pilotage_tenant_scope_enforced` at 0:
 *
 *   1. the variable is absent            (what shipped, and what this closes)
 *   2. the variable names a host that does not resolve inside the network
 *      (`.env.example` ships `localhost:5433` for HOST-side tooling — copying
 *      that literal in is the single most likely regression)
 *   3. the variable names a database other than the one the request reads
 *   4. the variable names the OWNER role — the only shape that reads as
 *      ENFORCED while isolating nothing, because the owner bypasses RLS
 *
 * Case 4 is why the checker refuses more than emptiness. A gate that only
 * asserted "declared" would go green on the one configuration that is worse
 * than the bug.
 *
 * THIS IS THE THIRD COMPOSE-OMISSION FINDING
 * ------------------------------------------
 * `PF-86` (the documented command started an undocumented stack) and `PF-222`
 * (three of four portal secrets passed) have the same shape: security-relevant
 * configuration absent from the file that describes the deployment, invisible
 * until something outside a container tried to use it.
 *
 * WHAT IS DELIBERATELY OUT OF SCOPE HERE
 * --------------------------------------
 * This spec asserts nothing about a RUNNING stack. Enforcement is a property of
 * a process, not of a file, and it is proven separately by reading the gauge off
 * a booted api (`S-E01-1h` AC-4, executed at land). A checker that read the
 * local containers would be green on a laptop and vacuous in CI — precisely the
 * defect `TOOL-36` names, where a probe answered from whatever happened to be
 * running rather than from what it was pointed at.
 *
 * METHOD (S-E02-12, restated by every gate since)
 * -----------------------------------------------
 * A check run against a healthy repository can only demonstrate that the
 * repository is healthy. It can never demonstrate that the check would catch a
 * regression. So `evaluateTenantScopeDeployment` is a PURE function over a plain
 * object, and the negative controls below drive it with the four broken shapes —
 * including, verbatim, the configuration that shipped before this slice.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'tenant-scope-deployment-check.js');
const COMPOSE_PATH = join(REPO_ROOT, 'infra', 'docker-compose.yml');
const CI_GATE_PATH = join(REPO_ROOT, 'scripts', 'ci-gate.sh');
const CI_WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

interface EvalResult {
  problems: string[];
  stats: { declaredBy: string[]; checked: string[] };
}

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  evaluateTenantScopeDeployment,
  parsePostgresUrl,
  servicesFromCompose,
  VAR,
  MUST_DECLARE,
  MUST_NOT_DECLARE,
  OWNER_ROLE,
} = require(SCRIPT_PATH) as {
  evaluateTenantScopeDeployment: (input: {
    services: Record<string, Record<string, string> | null>;
  }) => EvalResult;
  parsePostgresUrl: (
    raw: unknown,
  ) => { role: string; host: string; port: string | null; database: string } | null;
  servicesFromCompose: (text: string) => Record<string, Record<string, string>>;
  VAR: string;
  MUST_DECLARE: string[];
  MUST_NOT_DECLARE: Record<string, string>;
  OWNER_ROLE: string;
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** The shape this slice ships — the only one that must be green. */
const GOOD = 'postgresql://app_user:app_user@postgres:5432/pilotage?schema=public';
const OWNER_URL = 'postgresql://pilotage:pilotage@postgres:5432/pilotage?schema=public';

function withApi(env: Record<string, string>): { services: Record<string, Record<string, string>> } {
  return { services: { api: { DATABASE_URL: OWNER_URL, ...env } } };
}

describe('S-E01-1h — the tenant scope must be DECLARED in the deployment, not assumed', () => {
  it('the checker exists and is executable as a script', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  describe('AC-1 — the positive control: the shape this slice ships is accepted', () => {
    it('an api declaring the compose-network app-role URL has no problem', () => {
      const r = evaluateTenantScopeDeployment(withApi({ [VAR]: GOOD }));
      expect(r.problems).toEqual([]);
      expect(r.stats.declaredBy).toEqual(['api']);
    });

    it('the REAL compose file passes — this is the assertion that regresses', () => {
      const services = servicesFromCompose(readFileSync(COMPOSE_PATH, 'utf8'));
      const r = evaluateTenantScopeDeployment({ services });
      expect(r.problems).toEqual([]);
      // Vacuity floor: a checker that inspected zero services would also report
      // zero problems. Name the consumer explicitly.
      expect(r.stats.declaredBy).toEqual(MUST_DECLARE);
    });
  });

  describe('AC-2 — negative control 1: ABSENT (the configuration that shipped)', () => {
    it('an api with no DATABASE_URL_APP is refused, and the message names the degraded state', () => {
      const r = evaluateTenantScopeDeployment(withApi({}));
      expect(r.problems).toHaveLength(1);
      expect(r.problems[0]).toContain('does not declare');
      expect(r.problems[0]).toContain('degraded_no_app_url');
      expect(r.problems[0]).toContain('PF-242');
    });

    it('an EMPTY string is refused exactly like an absent one — it degrades identically', () => {
      const r = evaluateTenantScopeDeployment(withApi({ [VAR]: '   ' }));
      expect(r.problems).toHaveLength(1);
      expect(r.problems[0]).toContain('does not declare');
    });

    it('the pre-slice compose file is RED — the fail-before, replayed from git history', () => {
      // Reconstructed rather than quoted: the point is the SHAPE (an api service
      // whose environment carries DATABASE_URL but not DATABASE_URL_APP), which
      // is what `main` carried on 2026-08-22.
      const r = evaluateTenantScopeDeployment({
        services: {
          api: { DATABASE_URL: OWNER_URL, PORT: '4000' },
          worker: { DATABASE_URL: OWNER_URL },
          migrator: { DATABASE_URL: OWNER_URL },
        },
      });
      expect(r.problems).toHaveLength(1);
      expect(r.stats.declaredBy).toEqual([]);
    });
  });

  describe('AC-3 — negative control 2: the OWNER role, the shape that looks enforced', () => {
    it('pointing the app connection at the owner is refused BY NAME', () => {
      const r = evaluateTenantScopeDeployment(withApi({ [VAR]: OWNER_URL }));
      expect(r.problems).toHaveLength(1);
      expect(r.problems[0]).toContain(OWNER_ROLE);
      expect(r.problems[0]).toContain('BYPASSRLS');
    });

    it('and the refusal says WHY it is the worst shape, not merely that it is wrong', () => {
      const r = evaluateTenantScopeDeployment(withApi({ [VAR]: OWNER_URL }));
      // The gauge would read 1. A reviewer who saw only "enforced" would stop
      // looking — so the message has to carry that, or it teaches nothing.
      expect(r.problems[0]).toMatch(/LOOKS\s+enforced/);
    });
  });

  describe('AC-4 — negative control 3: a host that does not resolve in the network', () => {
    it.each(['localhost', '127.0.0.1'])(
      'the .env.example literal on host `%s` is refused',
      (host) => {
        const r = evaluateTenantScopeDeployment(
          withApi({ [VAR]: `postgresql://app_user:app_user@${host}:5433/pilotage?schema=public` }),
        );
        expect(r.problems.length).toBeGreaterThanOrEqual(1);
        expect(r.problems.join(' ')).toContain('does not resolve');
      },
    );
  });

  describe('AC-5 — negative control 4: two addresses for one database', () => {
    it('a different DATABASE than DATABASE_URL is refused', () => {
      const r = evaluateTenantScopeDeployment(
        withApi({ [VAR]: 'postgresql://app_user:app_user@postgres:5432/other?schema=public' }),
      );
      expect(r.problems.join(' ')).toContain('SAME database');
    });

    it('a different HOST than DATABASE_URL is refused, and cites PF-86', () => {
      const r = evaluateTenantScopeDeployment(
        withApi({ [VAR]: 'postgresql://app_user:app_user@other-db:5432/pilotage?schema=public' }),
      );
      expect(r.problems.join(' ')).toContain('PF-86');
    });

    it('an unparseable value is refused rather than ignored', () => {
      const r = evaluateTenantScopeDeployment(withApi({ [VAR]: 'not-a-url' }));
      expect(r.problems.join(' ')).toContain('not a parseable postgres URL');
    });
  });

  describe('AC-6 — the services that must NOT hold it', () => {
    it.each(Object.keys(MUST_NOT_DECLARE))('`%s` declaring it is refused, with its reason', (svc) => {
      const r = evaluateTenantScopeDeployment({
        services: {
          api: { DATABASE_URL: OWNER_URL, [VAR]: GOOD },
          [svc]: { DATABASE_URL: OWNER_URL, [VAR]: GOOD },
        },
      });
      expect(r.problems).toHaveLength(1);
      expect(r.problems[0]).toContain(`\`${svc}\` must NOT declare`);
      // The reason travels with the refusal — an unexplained "forbidden" is the
      // thing the next author relaxes. `String(...)` rather than `!`: the length
      // assertion is the only one here that DEREFERENCES, and a non-null
      // assertion would silence the compiler on exactly the case (empty
      // `problems`) this assertion exists to catch.
      expect(String(r.problems[0]).length).toBeGreaterThan(60);
    });

    it('the real compose file gives it to neither migrator nor worker', () => {
      const services = servicesFromCompose(readFileSync(COMPOSE_PATH, 'utf8'));
      for (const svc of Object.keys(MUST_NOT_DECLARE)) {
        expect(services[svc]?.[VAR]).toBeUndefined();
      }
    });
  });

  describe('AC-7 — the URL parser, driven directly', () => {
    it('reads role, host, port and database', () => {
      expect(parsePostgresUrl(GOOD)).toEqual({
        role: 'app_user',
        host: 'postgres',
        port: '5432',
        database: 'pilotage',
      });
    });

    it('accepts the `postgres://` spelling as well as `postgresql://`', () => {
      expect(parsePostgresUrl('postgres://u:p@h:1/d')?.database).toBe('d');
    });

    it('returns null — never throws — on the values a misconfiguration produces', () => {
      for (const bad of ['', '   ', 'not-a-url', undefined, null, 42, {}]) {
        expect(parsePostgresUrl(bad)).toBeNull();
      }
    });
  });

  describe('AC-8 — the gate is WIRED, not merely present (DNC-08)', () => {
    it('ci-gate.sh invokes the checker', () => {
      const gate = readFileSync(CI_GATE_PATH, 'utf8');
      expect(gate).toContain('tenant-scope-deployment-check.js');
    });

    it('the GitHub workflow invokes it too, so the two cannot drift', () => {
      if (!existsSync(CI_WORKFLOW_PATH)) return;
      const wf = readFileSync(CI_WORKFLOW_PATH, 'utf8');
      expect(wf).toContain('tenant-scope-deployment-check.js');
    });

    it('the checker is not skippable by an environment variable', () => {
      const src = readFileSync(SCRIPT_PATH, 'utf8');
      expect(src).not.toMatch(/SKIP|ALLOW_|_BYPASS|process\.env\.[A-Z_]*(SKIP|FORCE)/);
    });
  });
});
