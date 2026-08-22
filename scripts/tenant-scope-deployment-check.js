#!/usr/bin/env node
/**
 * S-E01-1h / PF-242 — THE SEAM WAS BUILT, PROVEN, AND NEVER TURNED ON.
 *
 * WHAT WAS MEASURED
 * -----------------
 * `AppRolePrismaService` opens its second, RLS-bearing connection **only when
 * `DATABASE_URL_APP` is declared**. On 2026-08-22 that variable appeared in
 * `.env.example` and nowhere in `infra/docker-compose.yml`, so on the stack this
 * routine calls its runtime target it was simply absent:
 *
 *     docker exec pilotage_api sh -c 'echo "APP=$DATABASE_URL_APP"'   →  APP=
 *
 * Every call site three runs had converted (calendar, lessons, announcements)
 * therefore executed on the **owner** connection — `pilotage`, which carries
 * `rolbypassrls = true` — in the named state `degraded_no_app_url`, with
 * `pilotage_tenant_scope_enforced` at 0.
 *
 * The failure is silent by construction, and that is the part worth a gate.
 * `AppRolePrismaService` **degrades rather than crashes** when the URL is absent
 * or wrong — a deliberate and correct choice, because a deployment that cannot
 * open the second connection must still serve. The cost of that choice is that
 * an absent URL, a typo'd URL, a URL naming the owner role and a URL naming a
 * host that does not resolve all produce the *same* observable: a healthy stack
 * with the gauge at 0. Nothing goes red. Nothing is logged at error level. The
 * tenant scope simply is not the thing being exercised.
 *
 * WHY A GATE AND NOT A README LINE
 * --------------------------------
 * `PF-02`'s closure condition is a **connection** change, so the file that
 * describes the connection is load-bearing security configuration. Two prior
 * findings have exactly this shape and both were compose omissions:
 *
 *   • `PF-86`  — the documented command started a stack the document did not
 *                describe (defaults instead of the root `.env`);
 *   • `PF-222` — compose passes three of the four portal client secrets, so one
 *                portal is silently unconfigurable.
 *
 * This is the third. A variable that must be present for a security control to
 * execute cannot be left to a reviewer noticing its absence.
 *
 * WHAT THIS CHECKS, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------
 * It checks the **deployment description** — that the services which consume the
 * app-role connection declare it, that the ones which must not are not given it,
 * and that the declared URL cannot be one of the four silently-degrading shapes.
 *
 * It does **not** claim the running stack is enforcing. That is a property of a
 * process, not of a file, and it is proven separately by reading the gauge off a
 * booted api (`S-E01-1h` AC-4). A checker that read the running container would
 * be green on a laptop and vacuous in CI; this one is true of the repository.
 *
 * DIVISION OF LABOUR (the house pattern — S-E02-12 and every gate since)
 * ---------------------------------------------------------------------
 *   • `evaluateTenantScopeDeployment` — a PURE function over a plain object, so
 *     the spec can drive it with configurations known to be wrong. A check run
 *     against a healthy repository can only prove the repository is healthy; it
 *     can never prove the check would catch a regression.
 *   • `main()` — the IO half: reads the real compose file, resolves it through
 *     `docker compose config` when available, and exits non-zero on any problem.
 */

const { existsSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');
const COMPOSE_PATH = join(REPO_ROOT, 'infra', 'docker-compose.yml');

/** The variable that switches the whole tenant scope from `degraded` to `enforced`. */
const VAR = 'DATABASE_URL_APP';

/**
 * Services that MUST declare it: the ones that run request-scoped Prisma work
 * through `TenantScopeService`.
 *
 * `api` is the only member today, and that is a measurement, not a simplification:
 * `worker`'s 99 call sites are enumerated OUTSIDE any scope by
 * `tenant-adversarial-check.js` (a job carries its tenant in its payload, so
 * there is no request tenant to open a scope on).
 */
const MUST_DECLARE = ['api'];

/**
 * Services that MUST NOT declare it, each with the reason it is forbidden rather
 * than merely unnecessary. An unnecessary declaration is a lie about capability;
 * a forbidden one would break the service.
 */
const MUST_NOT_DECLARE = {
  migrator:
    'the migrator CREATES the objects and issues the GRANTs — a role cannot grant ' +
    'itself privileges it does not hold, and `app_user` owns nothing by design',
  worker:
    'the worker has no request tenant: its call sites are enumerated outside any ' +
    'scope, so declaring this URL would announce a capability no statement exercises',
};

/** The owner role — naming it here would re-open exactly what RLS is meant to close. */
const OWNER_ROLE = 'pilotage';

/**
 * Host names that resolve on a developer's laptop and NOT inside a compose
 * network. `.env.example` ships `localhost:5433` for host-side tooling, and
 * copying that literal into compose is the single most likely regression: it
 * looks configured, and it degrades silently.
 */
const HOST_ONLY_HOSTS = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];

/** Parse `postgresql://user:pw@host:port/db?...` without pulling in a URL polyfill. */
function parsePostgresUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const m = /^postgres(?:ql)?:\/\/([^:/?#@]+)(?::[^@]*)?@([^:/?#]+)(?::(\d+))?\/([^?#]+)/.exec(
    raw.trim(),
  );
  if (m === null) return null;
  return { role: m[1], host: m[2], port: m[3] ?? null, database: m[4] };
}

/**
 * PURE. `input.services` maps a service name to its resolved environment object
 * (exactly what `docker compose config` produces), so this function never reads
 * a file and never needs a running daemon.
 */
function evaluateTenantScopeDeployment(input) {
  const services = input && input.services ? input.services : {};
  const problems = [];
  const declaredBy = [];

  for (const [name, env] of Object.entries(services)) {
    const value = env == null ? undefined : env[VAR];
    if (value !== undefined && String(value).trim() !== '') declaredBy.push(name);
  }

  // 1. Every consumer declares it. This is the regression that was live.
  for (const name of MUST_DECLARE) {
    if (!Object.prototype.hasOwnProperty.call(services, name)) continue; // profile not selected
    if (!declaredBy.includes(name)) {
      problems.push(
        `service \`${name}\` does not declare ${VAR}. The tenant scope will run in ` +
          '`degraded_no_app_url` — every converted call site executes on the OWNER ' +
          'connection, which carries BYPASSRLS, and `pilotage_tenant_scope_enforced` ' +
          'stays 0. Nothing else goes red (PF-242).',
      );
    }
  }

  // 2. Nobody else declares it — an unexercised declaration certifies a closure
  //    nobody checks, the same objection ADR-054 §D3 makes to over-declared grants.
  for (const [name, why] of Object.entries(MUST_NOT_DECLARE)) {
    if (declaredBy.includes(name)) {
      problems.push(`service \`${name}\` must NOT declare ${VAR}: ${why}.`);
    }
  }

  // 3. The declared URL cannot be one of the shapes that degrade silently.
  for (const name of declaredBy) {
    const raw = String(services[name][VAR]);
    const parsed = parsePostgresUrl(raw);

    if (parsed === null) {
      problems.push(
        `service \`${name}\` declares ${VAR} but it is not a parseable postgres URL. ` +
          'An unparseable URL degrades exactly like an absent one.',
      );
      continue;
    }

    if (parsed.role === OWNER_ROLE) {
      problems.push(
        `service \`${name}\` points ${VAR} at the OWNER role \`${OWNER_ROLE}\`. The owner ` +
          'carries BYPASSRLS and owns every table, so the policies would be inert and ' +
          'the gauge would read 1 — a green light over zero isolation. This is the ' +
          'worst of the four failure shapes, because it is the only one that LOOKS ' +
          'enforced.',
      );
    }

    if (HOST_ONLY_HOSTS.includes(parsed.host)) {
      problems.push(
        `service \`${name}\` points ${VAR} at \`${parsed.host}\`, which does not resolve ` +
          'inside the compose network. `.env.example` ships that literal for HOST-side ' +
          'tooling; copied into compose it degrades silently to the same gauge-0 state ' +
          'as an absent variable.',
      );
    }

    const own = parsePostgresUrl(services[name].DATABASE_URL);
    if (own !== null && parsed.database !== own.database) {
      problems.push(
        `service \`${name}\` points ${VAR} at database \`${parsed.database}\` while ` +
          `DATABASE_URL names \`${own.database}\`. The two connections must address the ` +
          'SAME database or the scope opens against a schema the request never reads.',
      );
    }
    if (own !== null && parsed.host !== own.host) {
      problems.push(
        `service \`${name}\` points ${VAR} at host \`${parsed.host}\` while DATABASE_URL ` +
          `names \`${own.host}\`. Two addresses for one database is how PF-86 happened.`,
      );
    }
  }

  return { problems, stats: { declaredBy: declaredBy.sort(), checked: Object.keys(services).sort() } };
}

/* --------------------------------- IO half -------------------------------- */

/**
 * Read the environment blocks straight out of the compose YAML.
 *
 * Deliberately textual rather than `docker compose config`: this gate must be
 * true of the REPOSITORY and must run where no docker daemon exists (CI is
 * exactly that). `TOOL-36` is the standing lesson about a checker that answers
 * from whatever happens to be running locally.
 */
function servicesFromCompose(text) {
  const yaml = require('js-yaml');
  const doc = yaml.load(text, { json: true });
  const out = {};
  if (doc == null || typeof doc !== 'object' || doc.services == null) return out;
  for (const [name, body] of Object.entries(doc.services)) {
    if (body == null || typeof body !== 'object') continue;
    const env = body.environment;
    if (env == null) {
      out[name] = {};
    } else if (Array.isArray(env)) {
      const o = {};
      for (const entry of env) {
        const i = String(entry).indexOf('=');
        if (i > 0) o[String(entry).slice(0, i)] = String(entry).slice(i + 1);
      }
      out[name] = o;
    } else {
      out[name] = env;
    }
  }
  return out;
}

function main() {
  if (!existsSync(COMPOSE_PATH)) {
    console.error(`GATE: FAIL — compose file not found at ${COMPOSE_PATH}`);
    process.exit(1);
  }

  const services = servicesFromCompose(readFileSync(COMPOSE_PATH, 'utf8'));
  const { problems, stats } = evaluateTenantScopeDeployment({ services });

  console.log('TENANT SCOPE DEPLOYMENT — the second connection must be DECLARED, not assumed');
  console.log(`  services inspected : ${stats.checked.join(', ') || '(none)'}`);
  console.log(`  declare ${VAR} : ${stats.declaredBy.join(', ') || '(none)'}`);

  if (problems.length > 0) {
    console.error('');
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error('');
    console.error(`GATE: FAIL (${problems.length} problem(s))`);
    process.exit(1);
  }

  console.log('');
  console.log('GATE: PASS');
  process.exit(0);
}

module.exports = {
  evaluateTenantScopeDeployment,
  parsePostgresUrl,
  servicesFromCompose,
  VAR,
  MUST_DECLARE,
  MUST_NOT_DECLARE,
  OWNER_ROLE,
  HOST_ONLY_HOSTS,
};

if (require.main === module) main();
