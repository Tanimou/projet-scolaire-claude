#!/usr/bin/env node
/**
 * rls-isolation-check.js — the `tenant_isolation` policies must actually DENY,
 * and this is the thing that says so (S-E01-2b, PF-02 half (a), G-TENANT).
 *
 * WHY THIS EXISTS, AND WHY NOTHING ELSE CAN DO ITS JOB
 * ---------------------------------------------------
 * `prisma migrate diff --from-schema-datasource --to-schema-datamodel` — the
 * comparison `scripts/schema-drift-check.js` is built on — CANNOT SEE POLICIES.
 * Measured: with `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY tenant_isolation`
 * and the `app_user` GRANTs installed, that diff returns `No difference
 * detected`, exit 0, byte-identical to the clean baseline. That is good news for
 * G-MIGRATION (this migration causes no false red) and it is the load-bearing
 * bad news: **the drift gate can never detect a policy dropped out of band, and
 * can never detect a 45th tenant-scoped table shipped without one.** Prisma
 * cannot model any of this, so `schema.prisma` cannot carry it either.
 *
 * So this file does the thing rather than asserting it: it builds a disposable
 * scratch database on a real PostgreSQL, applies every migration on disk to it,
 * connects AS THE NON-OWNER ROLE, and watches rows appear and disappear as the
 * tenant GUC changes.
 *
 * IT FAILS, IT NEVER SKIPS — DNC-08, ADR-027
 * ------------------------------------------
 * No PostgreSQL, no `psql`, no `app_user`, no `DATABASE_URL_APP`: every one is
 * exit 1 with a named reason. A tenancy gate that reports "skipped, therefore
 * fine" is worse than no gate, because the skip is invisible and this
 * repository's skip ratchet is disarmed. There is no environment variable and no
 * flag that turns any verdict below into a pass (DNC-10). `DATABASE_URL` and
 * `DATABASE_URL_APP` name WHERE and AS WHOM, never WHETHER.
 *
 * THE POSITIVE CONTROL IS THE POINT — READ THIS BEFORE EDITING ANY ASSERTION
 * -------------------------------------------------------------------------
 * `app_user` had ZERO table privileges before this migration: `select count(*)
 * from student` as `app_user` failed with *permission denied for table student*.
 * A check that only asserted "foreign tenant rows are not visible" would
 * therefore have PASSED, in full green, on a database with no policies at all —
 * for entirely the wrong reason. Only rows APPEARING and DISAPPEARING as the GUC
 * changes is evidence of RLS.
 *
 * Every deny assertion below is therefore paired with the visibility assertion
 * that makes it mean something, and a `permission denied` anywhere in the
 * visibility path is a LOUD FAILURE, never read as isolation:
 *
 *   • A's rows are VISIBLE under GUC=A      pairs with  B's rows are not
 *   • an own-tenant INSERT SUCCEEDS         pairs with  a foreign INSERT is refused
 *   • the owner sees EVERYTHING             pairs with  `app_user` sees one tenant
 *
 * AND IT PROVES WHOM IT CONNECTED AS
 * ----------------------------------
 * If the app DSN were ever pointed at the owner `pilotage`, every visibility
 * assertion would pass on a completely unprotected database. So before the first
 * visibility query, over the very connection under test, three facts are
 * asserted: `current_user` owns ZERO of the tables under test, `rolbypassrls` is
 * false, and `current_user` is not the owner named by the migration's grants.
 * Any of those failing FAILS the run; none of them can make it skip.
 *
 * THE ONE DANGEROUS PART — read before editing
 * --------------------------------------------
 * This script CREATES and DROPS a database. The scratch name is generated here,
 * matched against `SCRATCH_NAME_PATTERN` before any `DROP`, and refused if it
 * equals the source database — the same three belts `schema-drift-check.js`
 * wears. It additionally REFUSES to run at all against a non-loopback address:
 * a checkout whose `.env` names a shared server must not have DDL executed on
 * it by a gate, and there is deliberately no flag to override that.
 *
 * CREDENTIALS NEVER REACH `argv` (ADR-025 D6). Every `psql` invocation takes its
 * password through `PGPASSWORD` in the CHILD environment and its address through
 * `-h/-p/-U/-d` flags. No connection string is ever passed as an argument, and no
 * address is ever printed unredacted.
 */

'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const net = require('node:net');
const { join, resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'apps', 'api', 'prisma', 'migrations');

const {
  APP_DATABASE_URL_VAR,
  defaultAppDatabaseUrl,
  defaultDatabaseUrl,
} = require('./lib/default-database-url');
const { postgresClient } = require('./lib/postgres-client-path');

/** The owner/maintenance address. An explicit variable still wins — a DEFAULT only. */
const DATABASE_URL = process.env.DATABASE_URL || defaultDatabaseUrl();

/** The role the policies are PROVEN against. Never the owner — asserted, not assumed. */
const APP_DATABASE_URL = process.env[APP_DATABASE_URL_VAR] || defaultAppDatabaseUrl();

/** Only a name this script generated may ever be dropped. */
const SCRATCH_NAME_PATTERN = /^rls_isolation_\d+_\d+$/;

/** A deploy that silently built nothing would make every query below vacuous. */
const MIN_EXPECTED_TABLES = 50;

/** The name every policy this gate is about must carry. */
const POLICY_NAME = 'tenant_isolation';

/**
 * The tables the migration grants `SELECT, INSERT` on and NOTHING ELSE.
 *
 * These are append-only by decision (ADR-032 §D7). `audit_log` carries a
 * `hash`/`prev_hash` chain: with UPDATE, a tamper can be made CONSISTENT and is
 * therefore undetectable by chain verification, which is the whole point of the
 * chain. `conversation_message` is declared immutable by `schema.prisma`.
 *
 * The census below asserts BOTH directions — that these tables are granted at
 * all (a typo in the migration's array would otherwise silently revoke nothing
 * and this list would pass vacuously), and that no privilege outside
 * {SELECT, INSERT} ever reaches them. `GRANTED == tenantCols` cannot see this:
 * the table count is identical either way.
 */
const APPEND_ONLY_TABLES = Object.freeze(['audit_log', 'conversation_message']);

/** The GUC. It is asserted equal to `TENANT_GUC` in TypeScript by the guard spec. */
const TENANT_GUC = 'app.current_tenant_id';

/**
 * Tenant A's id carries UPPERCASE hex, on purpose and not as decoration.
 *
 * PostgreSQL renders a `uuid` in lowercase while `assertTenantId` deliberately
 * PRESERVES case. A predicate written `tenant_id::text = current_setting(…)`
 * would therefore match ZERO rows for this tenant — fail-closed, but completely
 * invisible, which is the worst shape a security control can have. Because A is
 * uppercase, the cast direction is EXECUTED here rather than merely asserted as
 * text: if someone rewrites the predicate to the text form, the positive control
 * below goes red immediately.
 */
const TENANT_A = 'AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA';
const TENANT_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const SCHOOL_A = '11111111-0000-4000-8000-000000000001';
const SCHOOL_B = '22222222-0000-4000-8000-000000000002';
const SCHOOL_A2 = '33333333-0000-4000-8000-000000000003';
const SCHOOL_B2 = '44444444-0000-4000-8000-000000000004';

const TCP_PREFLIGHT_TIMEOUT_MS = 2000;
const PSQL_TIMEOUT_MS = 180000;

/** Exit codes, so an operator can tell the three failures apart. */
const VERDICT_EXIT_CODES = Object.freeze({
  isolated: 0,
  tooling_unavailable: 1,
  not_isolated: 2,
});

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function parseUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username || 'postgres'),
    password: decodeURIComponent(parsed.password || ''),
    database: decodeURIComponent((parsed.pathname || '/').slice(1)) || 'postgres',
  };
}

/** Never print a password. Consumers print THIS, never the raw URL. */
function redact(target) {
  return `${target.user}@${target.host}:${target.port}/${target.database}`;
}

function isLoopbackHost(host) {
  const value = String(host).toLowerCase();
  return value === 'localhost' || value === '::1' || value === '0:0:0:0:0:0:0:1' || /^127\./.test(value);
}

/**
 * Is anything accepting TCP at `host:port`? Bounded, in-process, and it changes
 * no verdict — it only decides how FAST the failure is reported (TOOL-10).
 */
function probeAddress(host, port, timeoutMs = TCP_PREFLIGHT_TIMEOUT_MS) {
  return new Promise((settle) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (state, detail) => {
      if (done) return;
      done = true;
      socket.destroy();
      settle({ open: state === 'open', state, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('open', 'connected'));
    socket.once('timeout', () => finish('indeterminate', `no answer within ${timeoutMs} ms`));
    socket.once('error', (error) =>
      finish(error && error.code === 'ECONNREFUSED' ? 'refused' : 'indeterminate', String(error && error.code)),
    );
    socket.connect(Number(port), String(host));
  });
}

/**
 * Run one `psql` script against one database.
 *
 * `ON_ERROR_STOP` is a PARAMETER, not a constant: most calls must abort on the
 * first error, but the adversarial half deliberately provokes errors and needs
 * to read them. `-X` skips `~/.psqlrc`, so a developer's local settings cannot
 * change what a gate observes.
 */
function psql(client, target, sql, { onErrorStop = true } = {}) {
  const result = spawnSync(
    client,
    [
      '-X',
      '-q',
      '-A',
      '-t',
      '-v',
      `ON_ERROR_STOP=${onErrorStop ? 1 : 0}`,
      '-h',
      target.host,
      '-p',
      String(target.port),
      '-U',
      target.user,
      '-d',
      target.database,
      '-f',
      '-',
    ],
    {
      encoding: 'utf8',
      input: sql,
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
      shell: false,
      timeout: PSQL_TIMEOUT_MS,
      // The password reaches the child through the ENVIRONMENT. Never argv.
      env: { ...process.env, PGPASSWORD: target.password, PGCLIENTENCODING: 'UTF8' },
    },
  );
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  return {
    status: result.error ? -1 : result.status,
    stdout: result.stdout ? String(result.stdout) : '',
    stderr: timedOut
      ? `psql did not answer within ${PSQL_TIMEOUT_MS} ms and was killed`
      : result.error
        ? String(result.error.message)
        : String(result.stderr || ''),
    timedOut,
  };
}

/** One scalar out of a `-A -t` result. */
function scalar(result) {
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.length > 0 ? lines[lines.length - 1].trim() : '';
}

/** Every migration directory on disk, in the order PostgreSQL must see them. */
function migrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => join(MIGRATIONS_DIR, name, 'migration.sql'))
    .filter((file) => existsSync(file));
}

/**
 * A SQL string literal.
 *
 * Every value this script interpolates is a constant declared above — no input
 * reaches it — but the escaping is written anyway, because the day someone
 * parameterises a fixture is the day its absence becomes an injection.
 */
function lit(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

const failures = [];
const evidence = [];

function record(label, detail) {
  evidence.push(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail) {
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  evidence.push(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

/** `expected` and `actual` are both printed: a bare "mismatch" is unactionable. */
function expectEqual(label, actual, expected) {
  if (String(actual) === String(expected)) record(label, `${actual}`);
  else fail(label, `expected ${expected}, got ${actual}`);
}

class ToolingUnavailable extends Error {}

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

/** The fixtures. Built by the OWNER, because `app_user` has no grant on `tenant`. */
const FIXTURES_SQL = `
INSERT INTO tenant (id, name, slug, updated_at) VALUES
  (${lit(TENANT_A)}, 'RLS proof tenant A', 'rls-proof-a', now()),
  (${lit(TENANT_B)}, 'RLS proof tenant B', 'rls-proof-b', now());
INSERT INTO school (id, tenant_id, name, school_code, country, updated_at) VALUES
  (${lit(SCHOOL_A)}, ${lit(TENANT_A)}, 'School A', 'RLS-A-1', 'FR', now()),
  (${lit(SCHOOL_B)}, ${lit(TENANT_B)}, 'School B', 'RLS-B-1', 'FR', now());
`;

/**
 * The whole adversarial script, run in ONE `psql` session as `app_user`.
 *
 * ONE session is not a convenience: step (P) — the same connection, after the
 * transaction has COMMITTED, with no context — is only reachable inside a reused
 * connection, and it is the step every version of this check written against a
 * fresh connection would have missed. Prisma pools, so that state is the STEADY
 * STATE of every physical connection that has served one `withTenant`.
 *
 * Every step prints `LABEL|value` so the parser reads facts, not row order.
 */
const PROOF_SQL = `
\\pset footer off
-- (W) WHOM AM I? Asserted before anything else can be believed.
SELECT 'WHO|' || current_user;
SELECT 'OWNS|' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = current_user;
SELECT 'BYPASSRLS|' || rolbypassrls FROM pg_roles WHERE rolname = current_user;

-- (C) A FRESH connection with NO context: zero rows AND no error. Both halves.
SELECT 'FRESH_NO_CTX|' || count(*) FROM school;

BEGIN;
SELECT set_config(${lit(TENANT_GUC)}, ${lit(TENANT_A)}, true);
-- (A) THE POSITIVE CONTROL. Without this, everything below passes on a database
--     with no policies and no grants, for the wrong reason.
SELECT 'CTX_A_VISIBLE|' || count(*) FROM school WHERE id = ${lit(SCHOOL_A)};
-- (B) and the foreign tenant's row is gone from the same query.
SELECT 'CTX_A_FOREIGN|' || count(*) FROM school WHERE id = ${lit(SCHOOL_B)};
-- (D+) the WITH CHECK positive control: an OWN-tenant INSERT must SUCCEED.
INSERT INTO school (id, tenant_id, name, school_code, country, updated_at)
  VALUES (${lit(SCHOOL_A2)}, ${lit(TENANT_A)}, 'School A2', 'RLS-A-2', 'FR', now());
SELECT 'OWN_INSERT|' || count(*) FROM school WHERE id = ${lit(SCHOOL_A2)};
-- (D-) a FOREIGN INSERT must be refused by WITH CHECK.
SAVEPOINT foreign_insert;
INSERT INTO school (id, tenant_id, name, school_code, country, updated_at)
  VALUES (${lit(SCHOOL_B2)}, ${lit(TENANT_B)}, 'School B2', 'RLS-B-2', 'FR', now());
SELECT 'FOREIGN_INSERT_ACCEPTED|1';
ROLLBACK TO SAVEPOINT foreign_insert;
-- (E) an UPDATE must not move a row across tenants.
SAVEPOINT cross_update;
UPDATE school SET tenant_id = ${lit(TENANT_B)} WHERE id = ${lit(SCHOOL_A)};
SELECT 'CROSS_UPDATE_ACCEPTED|1';
ROLLBACK TO SAVEPOINT cross_update;
-- (F) a DELETE of a foreign row is a SILENT no-op — USING filters it away, so
--     nothing is raised and nothing is deleted. Code that reads "deleted" as
--     success reports success for a delete that did not happen.
DELETE FROM school WHERE id = ${lit(SCHOOL_B)};
SELECT 'FOREIGN_DELETE_ROWS|' || count(*) FROM school WHERE id = ${lit(SCHOOL_B)};
COMMIT;

-- (P) THE POOLED CASE. Same connection, transaction committed, no context set.
--     After a committed \`set_config(…, true)\` the custom GUC is '' — NOT NULL —
--     and a bare \`current_setting(…)::uuid\` raises 22P02 here. This is the
--     second query of every pooled connection in production.
SELECT 'POOLED_IS_NULL|' || (current_setting(${lit(TENANT_GUC)}, true) IS NULL);
SELECT 'POOLED_ROWS|' || count(*) FROM school;

-- (Q) the empty string set EXPLICITLY, same requirement.
SET ${TENANT_GUC} = '';
SELECT 'EMPTY_ROWS|' || count(*) FROM school;

-- (R) switch context: B's row must REAPPEAR, and it must still exist despite (F).
BEGIN;
SELECT set_config(${lit(TENANT_GUC)}, ${lit(TENANT_B)}, true);
SELECT 'CTX_B_VISIBLE|' || count(*) FROM school WHERE id = ${lit(SCHOOL_B)};
SELECT 'CTX_B_FOREIGN|' || count(*) FROM school WHERE id = ${lit(SCHOOL_A)};
COMMIT;
`;

/** AC-8 — the recorded, deliberate LIMIT of this slice. Not a defect. */
const OWNER_SQL = `
\\pset footer off
SELECT 'OWNER_WHO|' || current_user;
SELECT 'OWNER_NO_CTX|' || count(*) FROM school;
BEGIN;
SELECT set_config(${lit(TENANT_GUC)}, ${lit(TENANT_A)}, true);
SELECT 'OWNER_CTX_A|' || count(*) FROM school;
COMMIT;
`;

function facts(result) {
  const map = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    const at = line.indexOf('|');
    if (at <= 0) continue;
    map.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return map;
}

async function main() {
  const owner = parseUrl(DATABASE_URL);
  const client = postgresClient('psql');

  // ---- 1. Tooling. Every one of these is exit 1 with a name, never a skip. ----
  if (!client.command) {
    throw new ToolingUnavailable(
      `no PostgreSQL client found. Searched:\n${client.tried.map((t) => `    - ${t}`).join('\n')}`,
    );
  }
  if (!APP_DATABASE_URL) {
    throw new ToolingUnavailable(
      `${APP_DATABASE_URL_VAR} is not declared in the environment or in any of the project's .env files.\n` +
        '    It names the NON-OWNER role these policies must be proven against. Without it there is\n' +
        '    nothing to prove: the owner bypasses RLS, so a run as the owner would be green and worthless.',
    );
  }
  const app = parseUrl(APP_DATABASE_URL);

  if (!isLoopbackHost(owner.host) || !isLoopbackHost(app.host)) {
    throw new ToolingUnavailable(
      `this check creates and drops a database, so it refuses to run against a non-loopback address ` +
        `(${redact(owner)}). There is deliberately no flag to override that.`,
    );
  }
  const preflight = await probeAddress(owner.host, owner.port);
  if (!preflight.open) {
    throw new ToolingUnavailable(
      `no PostgreSQL server answered at ${owner.host}:${owner.port} (${preflight.state}: ${preflight.detail}).\n` +
        '    The remedy is to start PostgreSQL, never to edit code (ADR-027).',
    );
  }
  const migrations = migrationFiles();
  if (migrations.length === 0) {
    throw new ToolingUnavailable(
      `${MIGRATIONS_DIR} holds no migration.sql — a check over an empty ledger passes vacuously.`,
    );
  }

  // ---- 2. The role must EXIST. It is cluster state, not database state. ----
  const maintenance = { ...owner, database: 'postgres' };
  const roleProbe = psql(
    client.command,
    maintenance,
    `SELECT count(*) FROM pg_roles WHERE rolname = ${lit(app.user)};`,
  );
  if (roleProbe.status !== 0) {
    throw new ToolingUnavailable(`could not query pg_roles as ${redact(owner)}: ${roleProbe.stderr.trim()}`);
  }
  // Roles are CLUSTER state, not database state, so a fresh CI service container
  // has none. Create it when we can — CI's `POSTGRES_USER` IS the bootstrap
  // superuser there — and FAIL legibly when we cannot: on the development machine
  // `pilotage` is measured `rolcreaterole = false`, and inventing a skip at this
  // exact point is how a tenancy gate becomes decorative.
  let createdRole = false;
  if (scalar(roleProbe) !== '1') {
    const create = psql(
      client.command,
      maintenance,
      `CREATE ROLE ${app.user} LOGIN PASSWORD ${lit(app.password)};`,
    );
    if (create.status !== 0) {
      throw new ToolingUnavailable(
        `the role ${app.user} does not exist in this cluster and ${owner.user} could not create it:\n` +
          `    ${create.stderr.trim()}\n` +
          '    Create it once, as a superuser:\n' +
          `        CREATE ROLE ${app.user} LOGIN PASSWORD '…';\n` +
          '    Reported as a FAILURE and never as a skip: a tenancy gate that cannot run has no verdict.',
      );
    }
    createdRole = true;
  }

  // ---- 3. The scratch database. The only destructive lines in this file. ----
  const scratchName = `rls_isolation_${process.pid}_${Date.now()}`;
  if (!SCRATCH_NAME_PATTERN.test(scratchName) || scratchName === owner.database) {
    throw new ToolingUnavailable(`refusing to use ${scratchName} as a scratch database name`);
  }
  const scratchOwner = { ...owner, database: scratchName };
  const scratchApp = { ...app, database: scratchName };

  const created = psql(client.command, maintenance, `CREATE DATABASE "${scratchName}";`);
  if (created.status !== 0) {
    throw new ToolingUnavailable(`could not create the scratch database: ${created.stderr.trim()}`);
  }

  try {
    // ---- 4. Apply the ledger. A migration that does not execute is a broken one.
    for (const file of migrations) {
      const applied = psql(client.command, scratchOwner, readFileSync(file, 'utf8'));
      if (applied.status !== 0) {
        fail('the migration ledger applies to a fresh PostgreSQL', `${file}\n${applied.stderr.trim()}`);
        return;
      }
    }
    const tables = psql(
      client.command,
      scratchOwner,
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';",
    );
    if (Number(scalar(tables)) < MIN_EXPECTED_TABLES) {
      fail('the ledger built a real schema', `only ${scalar(tables)} tables, expected >= ${MIN_EXPECTED_TABLES}`);
      return;
    }

    // ---- 5. The AGREEMENT assertion — the anti-drift ratchet the drift gate
    //         cannot provide. It is an AGREEMENT, never a hard-coded 44, so it
    //         survives growth and cannot be satisfied by DELETING a table.
    const census = psql(
      client.command,
      scratchOwner,
      `SELECT 'TENANT_COLS|' || count(*) FROM information_schema.columns c
         JOIN information_schema.tables t USING (table_schema, table_name)
        WHERE c.table_schema='public' AND c.column_name='tenant_id' AND t.table_type='BASE TABLE';
       SELECT 'RLS_ON|' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity;
       SELECT 'POLICIES|' || count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND p.polname=${lit(POLICY_NAME)};
       SELECT 'FORCED|' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relforcerowsecurity;
       SELECT 'GRANTED|' || count(DISTINCT table_name) FROM information_schema.role_table_grants
        WHERE grantee=${lit(app.user)} AND table_schema='public';
       SELECT 'WITH_CHECK_NULL|' || count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND p.polname=${lit(POLICY_NAME)} AND p.polwithcheck IS NULL;
       SELECT 'ROLE_SCOPED|' || count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND p.polname=${lit(POLICY_NAME)} AND p.polroles <> '{0}'::oid[];
       SELECT 'APPEND_ONLY_REACHED|' || count(DISTINCT table_name) FROM information_schema.role_table_grants
        WHERE grantee=${lit(app.user)} AND table_schema='public'
          AND table_name IN (${APPEND_ONLY_TABLES.map(lit).join(', ')});
       SELECT 'APPEND_ONLY_WRITE|' || count(*) FROM information_schema.role_table_grants
        WHERE grantee=${lit(app.user)} AND table_schema='public'
          AND table_name IN (${APPEND_ONLY_TABLES.map(lit).join(', ')})
          AND privilege_type NOT IN ('SELECT', 'INSERT');`,
    );
    if (census.status !== 0) {
      throw new ToolingUnavailable(`the census query failed: ${census.stderr.trim()}`);
    }
    const c = facts(census);
    const tenantCols = Number(c.get('TENANT_COLS'));
    if (!Number.isFinite(tenantCols) || tenantCols < 1) {
      fail('the schema carries tenant-scoped tables', `TENANT_COLS = ${c.get('TENANT_COLS')}`);
      return;
    }
    expectEqual('every tenant_id table has ROW LEVEL SECURITY enabled', c.get('RLS_ON'), tenantCols);
    expectEqual(`every tenant_id table carries a ${POLICY_NAME} policy`, c.get('POLICIES'), tenantCols);
    expectEqual(`${app.user} is granted exactly the policied tables`, c.get('GRANTED'), tenantCols);
    // FORCE is absent DELIBERATELY, and its absence is asserted so nobody adds it
    // without reading why: the app still connects as the owner, so FORCE today
    // would return zero rows for every query in the application.
    expectEqual('no table is FORCE ROW LEVEL SECURITY (deliberate — see the migration header)', c.get('FORCED'), 0);
    // A policy with a NULL with_check falls back to USING. It looks right today
    // and becomes wrong the moment someone adds a permissive WITH CHECK.
    expectEqual('every policy declares WITH CHECK explicitly', c.get('WITH_CHECK_NULL'), 0);
    // A policy naming a role exempts every OTHER non-owner role, silently.
    expectEqual('every policy is FOR ALL TO PUBLIC, not scoped to one role', c.get('ROLE_SCOPED'), 0);
    // The append-only split (ADR-032 §D7). Reached FIRST — without it the second
    // assertion is vacuously green on a database where the grant never landed.
    expectEqual(
      `${app.user} reaches every append-only table (${APPEND_ONLY_TABLES.join(', ')})`,
      c.get('APPEND_ONLY_REACHED'),
      APPEND_ONLY_TABLES.length,
    );
    expectEqual(
      'no append-only table grants anything beyond SELECT/INSERT — the audit hash chain stays unrewritable',
      c.get('APPEND_ONLY_WRITE'),
      0,
    );

    // ---- 6. Fixtures, built by the OWNER (app_user has no grant on `tenant`).
    const fixtures = psql(client.command, scratchOwner, FIXTURES_SQL);
    if (fixtures.status !== 0) {
      throw new ToolingUnavailable(`could not build the fixtures: ${fixtures.stderr.trim()}`);
    }

    // ---- 7. THE PROOF, as the non-owner role. ----
    const proof = psql(client.command, scratchApp, PROOF_SQL, { onErrorStop: false });
    const f = facts(proof);

    // A `permission denied` anywhere in the visibility path is a LOUD failure. It
    // must never be read as isolation — that is the exact false green this whole
    // file is built to refuse.
    if (/permission denied/i.test(proof.stderr)) {
      fail(
        `${app.user} can reach the tables under test`,
        `psql reported "permission denied", which is a MISSING GRANT and not evidence of isolation:\n` +
          proof.stderr.trim(),
      );
      return;
    }

    expectEqual('AC-14 the connection under test is NOT the table owner', f.get('OWNS'), 0);
    // Boolean rendered through `||` is 'true'/'false', not psql's 'f' — pinned as text.
    expectEqual('AC-14 the connection under test does not carry BYPASSRLS', f.get('BYPASSRLS'), 'false');
    if (f.get('WHO') === owner.user) {
      fail('AC-14 the connection under test is not the owner role', `connected as ${f.get('WHO')}`);
      return;
    }
    record('AC-14 connected as', String(f.get('WHO')));

    expectEqual('AC-7c a fresh connection with NO tenant context sees zero rows', f.get('FRESH_NO_CTX'), 0);
    expectEqual('AC-6  POSITIVE CONTROL: with GUC = tenant A, A rows ARE VISIBLE', f.get('CTX_A_VISIBLE'), 1);
    expectEqual('AC-7b with GUC = tenant A, tenant B rows are NOT visible', f.get('CTX_A_FOREIGN'), 0);
    expectEqual('AC-7d POSITIVE CONTROL: an OWN-tenant INSERT is accepted', f.get('OWN_INSERT'), 1);

    if (f.has('FOREIGN_INSERT_ACCEPTED')) {
      fail('AC-7d an INSERT carrying a foreign tenant id is REJECTED', 'the foreign INSERT was accepted');
    } else if (/violates row-level security policy/i.test(proof.stderr)) {
      record('AC-7d an INSERT carrying a foreign tenant id is REJECTED by WITH CHECK');
    } else {
      fail('AC-7d an INSERT carrying a foreign tenant id is REJECTED', `no RLS violation was reported:\n${proof.stderr.trim()}`);
    }
    if (f.has('CROSS_UPDATE_ACCEPTED')) {
      fail('AC-7e an UPDATE cannot move a row across tenants', 'the cross-tenant UPDATE was accepted');
    } else {
      record('AC-7e an UPDATE cannot move a row across tenants');
    }

    // The silent one. Nothing is raised and nothing is deleted.
    expectEqual('F-4 a DELETE of a foreign row deletes nothing and raises nothing', f.get('FOREIGN_DELETE_ROWS'), 0);

    // THE POOLED CASE — the reason the predicate carries `nullif(…, '')`.
    expectEqual(
      "F-1 after a committed transaction the GUC is '' and NOT null (this is why nullif is mandatory)",
      f.get('POOLED_IS_NULL'),
      'false',
    );
    expectEqual(
      'F-1 the SAME connection, after COMMIT, with no context: zero rows AND NO ERROR',
      f.get('POOLED_ROWS'),
      0,
    );
    expectEqual('AC-4 an explicitly EMPTY tenant context sees zero rows and raises nothing', f.get('EMPTY_ROWS'), 0);
    expectEqual('AC-7a switching the GUC to tenant B makes B rows reappear', f.get('CTX_B_VISIBLE'), 1);
    expectEqual('AC-7b with GUC = tenant B, tenant A rows are NOT visible', f.get('CTX_B_FOREIGN'), 0);

    // A 22P02 anywhere would mean the predicate is the bare cast form.
    if (/invalid input syntax for type uuid/i.test(proof.stderr)) {
      fail(
        'F-1 no connection ever raises 22P02 on the tenant GUC',
        'the predicate is missing nullif(…, \'\') — see the migration header:\n' + proof.stderr.trim(),
      );
    } else {
      record('F-1 no connection raised 22P02 on the tenant GUC');
    }

    // ---- 8. AC-8 — the recorded LIMIT. Named so nobody reads it as a defect.
    const ownerRun = psql(client.command, scratchOwner, OWNER_SQL);
    if (ownerRun.status !== 0) {
      throw new ToolingUnavailable(`the owner-visibility case failed to run: ${ownerRun.stderr.trim()}`);
    }
    const o = facts(ownerRun);
    // 3 rows: two fixtures plus the own-tenant INSERT the proof committed.
    expectEqual(
      'AC-8 THE DELIBERATE LIMIT: the OWNER sees every tenant with NO context (RLS is ENABLED, not FORCED)',
      o.get('OWNER_NO_CTX'),
      3,
    );
    expectEqual(
      'AC-8 THE DELIBERATE LIMIT: the OWNER still sees every tenant WITH a context — this is why the app is NOT isolated yet',
      o.get('OWNER_CTX_A'),
      3,
    );

    // ---- 9. AC-12 — the rollback is EXECUTED, not merely written in a header.
    const rollback = psql(
      client.command,
      scratchOwner,
      `DO $rollback$
       DECLARE
         t text;
       BEGIN
         FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity LOOP
           EXECUTE format('DROP POLICY IF EXISTS ${POLICY_NAME} ON public.%I', t);
           EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
           EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.%I FROM ${app.user}', t);
         END LOOP;
         REVOKE USAGE ON SCHEMA public FROM ${app.user};
       END
       $rollback$;
       SELECT 'AFTER_POLICIES|' || count(*) FROM pg_policy p WHERE p.polname = ${lit(POLICY_NAME)};
       SELECT 'AFTER_RLS|' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relrowsecurity;`,
    );
    if (rollback.status !== 0) {
      fail('AC-12 the stated rollback executes', rollback.stderr.trim());
    } else {
      const r = facts(rollback);
      expectEqual('AC-12 the rollback removes every policy', r.get('AFTER_POLICIES'), 0);
      expectEqual('AC-12 the rollback returns relrowsecurity to false', r.get('AFTER_RLS'), 0);
    }
  } finally {
    // ---- 10. Leave the server clean. Its own verdict, never swallowed, and it
    //          never downgrades an isolation verdict into a tooling one.
    const dropped = psql(client.command, maintenance, `DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE);`);
    if (dropped.status !== 0) {
      fail('the scratch database was dropped', `${scratchName}: ${dropped.stderr.trim()}`);
    } else {
      record('the scratch database was dropped', scratchName);
    }
    // A role we created is a role we remove — roles are cluster-wide, so leaving
    // one behind would change the machine for every later run. A role that was
    // ALREADY there is never touched: it is the operator's, not ours.
    if (createdRole) {
      const droppedRole = psql(client.command, maintenance, `DROP ROLE IF EXISTS ${app.user};`);
      if (droppedRole.status !== 0) {
        fail(`the role ${app.user} this run created was removed`, droppedRole.stderr.trim());
      } else {
        record(`the role ${app.user} this run created was removed`);
      }
    }
  }
}

function report(verdict) {
  const banner =
    verdict === 'isolated'
      ? 'RLS ISOLATION: PROVEN for the non-owner role'
      : verdict === 'not_isolated'
        ? 'RLS ISOLATION: NOT PROVEN'
        : 'RLS ISOLATION: COULD NOT RUN';
  console.log(`\n${banner}`);
  console.log(evidence.join('\n'));
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const line of failures) console.log(`  - ${line}`);
  }
  if (verdict === 'isolated') {
    // The honesty clause. It is printed on the GREEN path on purpose: the only
    // moment anyone is tempted to over-read this gate is when it passes.
    console.log(
      '\nWHAT THIS DOES NOT SAY: the running application is still NOT isolated by RLS.\n' +
        '  It connects as the table OWNER, who is not subject to these policies without\n' +
        '  FORCE ROW LEVEL SECURITY. What is proven above is that the policies EXIST, are\n' +
        '  CORRECT, and DENY for a real, non-owner, login-capable role. The remaining step\n' +
        '  is the CONNECTION CUTOVER, not more policy work. (PF-02 half (a): partial.)',
    );
  }
  return VERDICT_EXIT_CODES[verdict];
}

// NOT a bare `main()` at module scope. The guard spec `require()`s this file to
// reach the pure exports, and it runs inside `pnpm test` on every developer's
// machine — a module-scope `main()` would create and drop a database as a side
// effect of loading it. Same shape as `scripts/schema-drift-check.js`.
if (require.main === module) {
  main()
    .then(() => {
      process.exit(report(failures.length === 0 ? 'isolated' : 'not_isolated'));
    })
    .catch((error) => {
      if (error instanceof ToolingUnavailable) {
        fail('the check could run at all', String(error.message));
        process.exit(report('tooling_unavailable'));
      }
      fail('the check completed without crashing', error && error.stack ? error.stack : String(error));
      process.exit(report('tooling_unavailable'));
    });
}

module.exports = {
  APPEND_ONLY_TABLES,
  APP_DATABASE_URL_VAR,
  MIN_EXPECTED_TABLES,
  POLICY_NAME,
  SCRATCH_NAME_PATTERN,
  TENANT_A,
  TENANT_B,
  TENANT_GUC,
  VERDICT_EXIT_CODES,
  isLoopbackHost,
  lit,
  migrationFiles,
  redact,
};
