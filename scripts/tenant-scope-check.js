#!/usr/bin/env node
/**
 * tenant-scope-check.js — the tenant SCOPE SEAM must actually be REFUSED by
 * PostgreSQL, and this is the thing that says so (S-E01-1d (b), AC-1..AC-4,
 * PF-02 half (a), G-TENANT).
 *
 * WHY THIS FILE EXISTS, AND WHY NOTHING ELSE CAN DO ITS JOB
 * --------------------------------------------------------
 * `S-E01-1d` shipped the seam — `TenantScopeService.run`, the second
 * (non-owner) `PrismaClient` on `DATABASE_URL_APP`, and four converted handlers
 * in `calendar.controller.ts`. Every assertion behind it is a UNIT test against
 * a fake client: `tenant-scope.spec.ts` proves the *verdict logic* and the
 * *nesting semantics*, and it proves them without a database, on purpose.
 *
 * NOT ONE OF THEM SHOWS A ROW BEING REFUSED. `rls-isolation-check.js` and
 * `tenant-adversarial-check.js` drive `psql` and prove the POLICIES deny for a
 * real non-owner role — but they set the GUC with a hand-written `SET`, so they
 * say nothing about whether the APPLICATION's seam sets it. This file closes
 * exactly that gap and nothing else: it drives the **compiled** seam
 * (`dist/shared/prisma/prisma.service.js`'s `runWithTenant` plus
 * `dist/shared/prisma/tenant-scope.js`'s store) over a real connection, as a
 * role PROVEN — not assumed — to be a non-owner, and asserts on the Prisma
 * error object and on returned row counts. **Never on a log line.**
 *
 * THE ORDER IS THE PROOF, AND IT IS NOT NEGOTIABLE (AC-2)
 * ------------------------------------------------------
 *   0. ADDRESSES.        Both connections resolve to the SCRATCH database, and
 *                        the scratch name is not the live one. Asserted BY NAME,
 *                        never by intent (AC-3).
 *   1. WHOM AM I.        Over the connection under test: it owns ZERO of the
 *                        tables under test, carries no `BYPASSRLS`, is not a
 *                        member of the owner, and `current_user` differs from
 *                        the owner of `calendar_event` READ FROM THE CATALOG —
 *                        never from a literal role name. Without this, a DSN
 *                        accidentally pointed at the owner makes every later
 *                        assertion pass on an unprotected database.
 *   1b. RLS IS ON.       `relrowsecurity` is true and at least one `pg_policy`
 *                        row exists on each table under test. A database that
 *                        holds the GRANTS but not the POLICIES satisfies every
 *                        question `probeAppRole()` asks and enforces NOTHING —
 *                        recorded as `PF-203`, and asserted HERE because the
 *                        production probe cannot yet ask it.
 *   2. POSITIVE CONTROL. Tenant A's own row is READ, UPDATED and CREATED
 *                        through the scope, and all three SUCCEED. `app_user`
 *                        held no privilege at all before `S-E01-2b`, so a proof
 *                        showing only absence would be green for the wrong
 *                        reason. This is what distinguishes "RLS refused it"
 *                        from "the role could never have done it".
 *   3. DENIAL.           Tenant B's row, targeted BY PRIMARY KEY, is invisible
 *                        (`findUnique` -> `null`) and unwritable (`updateMany` /
 *                        `deleteMany` affect ZERO rows; `update` raises
 *                        `P2025`). Then the OWNER re-reads it, intact — so
 *                        "zero rows" cannot mean "the row was never there".
 *   4. NO-SCOPE CONTROL. The SAME client, OUTSIDE any scope, sees zero rows for
 *                        tenant A. That is what makes step 2 attributable to
 *                        the SEAM rather than to the connection: an
 *                        implementation that forgot to set the GUC fails step 2,
 *                        and one that leaks an ambient GUC fails step 4.
 *   5. CLEANUP.          Executed, and verified INDEPENDENTLY of the client that
 *                        made the mess.
 *
 * THE ONE DANGEROUS PART — read before editing
 * --------------------------------------------
 * This script CREATES and DROPS a database. The live `pilotage` database has
 * **2 migrations and 0 policies, by design** — the RLS ledger has never been
 * applied to it — so a proof that connected there would assert against an
 * unprotected database and pass for the wrong reason. It therefore builds its
 * own disposable scratch database, applies the ledger with `prisma migrate
 * deploy`, and connects there. The scratch name is generated here, matched
 * against `SCRATCH_NAME_PATTERN` before any `DROP`, and refused if it equals
 * either resolved database — the same three belts `rls-isolation-check.js`
 * wears. It additionally REFUSES to run at all against a non-loopback address,
 * and there is deliberately no flag to override that.
 *
 * THE ONE PLACE A CONNECTION STRING IS COMPOSED, AND ITS GUARD
 * -----------------------------------------------------------
 * `ADR-048 §D7` says no code composes a connection string. That is a claim
 * about PRODUCTION code and it stays exactly true: `readPoolSettings()` only
 * reads, and the URL reaches `datasourceUrl` verbatim. THIS FILE is the one
 * composer in the tree — it must be, because the seam it drives reads an
 * address it does not choose — and it composes exactly ONE component: the
 * DATABASE NAME. Host, port, role and credentials are carried over untouched
 * from the operator's own DSN, and step 0 asserts the result before a single
 * statement is issued. `process.env` is never mutated: the scratch owner DSN
 * reaches `prisma migrate deploy` through the CHILD's environment only, and the
 * scratch app DSN reaches Prisma through `datasourceUrl` only. There is no path
 * by which the live database can be reached by a client this file constructs.
 *
 * KNOWN HAZARD — TOOL-27, DO NOT REINTRODUCE IT
 * ---------------------------------------------
 * `DROP DATABASE ... WITH (FORCE)` run as `pilotage` CANNOT terminate a session
 * belonging to `app_user`: `pilotage` is a member of neither `app_user` nor
 * `pg_signal_backend`. The retry-with-`pg_terminate_backend` path that saves
 * `rls-isolation-check.js` does NOT save this one — that precedent only ever
 * holds short-lived `psql` sessions, this one holds a long-lived Node client.
 * The fix here is deterministic and unprivileged: `$disconnect()` in the
 * `finally` BEFORE the drop, then assert `pg_stat_activity` is empty for the
 * scratch database, then drop. **Do not "fix" a failing drop with
 * `GRANT pg_signal_backend TO pilotage`** — that buys a green teardown at the
 * price of a standing privilege escalation on the very role the cutover targets.
 *
 * IT FAILS; IT NEVER SKIPS (DNC-08)
 * ---------------------------------
 * No PostgreSQL, no `psql`, no `DATABASE_URL_APP`, no generated Prisma client,
 * no `dist/` — each is exit 1 with a NAME and, where one exists, the COMMAND
 * that produces the missing artefact (`pnpm build`,
 * `pnpm --filter @pilotage/api exec prisma generate`), exactly as
 * `scripts/boot-check.js:147-152` does. There is no flag, no `NODE_ENV` branch
 * and no `ALLOW_*`/`SKIP_*` variable anywhere in this file (DNC-10).
 *
 * CREDENTIALS NEVER REACH `argv` (ADR-025 D6). Every `psql` invocation takes its
 * password through `PGPASSWORD` in the CHILD environment and its address through
 * `-h/-p/-U/-d` flags. No address is ever printed unredacted.
 */

'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const net = require('node:net');
const { join, resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');
const API_DIR = join(REPO_ROOT, 'apps', 'api');
const DIST_PRISMA_DIR = join(API_DIR, 'dist', 'shared', 'prisma');
const SCHEMA_PATH = join(API_DIR, 'prisma', 'schema.prisma');

const {
  APP_DATABASE_URL_VAR,
  defaultAppDatabaseUrl,
  defaultDatabaseUrl,
} = require('./lib/default-database-url');
const { postgresClient } = require('./lib/postgres-client-path');

/** The owner/maintenance address. An explicit variable still wins — a DEFAULT only. */
const DATABASE_URL = process.env.DATABASE_URL || defaultDatabaseUrl();

/** The role the seam is PROVEN against. Never the owner — asserted, not assumed. */
const APP_DATABASE_URL = process.env[APP_DATABASE_URL_VAR] || defaultAppDatabaseUrl();

/** Only a name this script generated may ever be dropped. */
const SCRATCH_NAME_PATTERN = /^tenant_scope_\d+_\d+$/;

/** A ledger that silently built nothing would make every assertion below vacuous. */
const MIN_EXPECTED_TABLES = 50;

/** The tables this proof reads, writes and asserts RLS is ARMED on. */
const TABLES_UNDER_TEST = Object.freeze(['calendar_event', 'enrollment']);

/**
 * The compiled artefacts this proof drives, each with the command that makes it.
 *
 * Listed as DATA rather than as three `if (!existsSync)` blocks so the failure
 * names the artefact AND its remedy in one shape, and so adding a fourth is one
 * edit. `boot-check.js:147-152` is the precedent: a missing build is not a skip,
 * it is the state in which every check below would vacuously pass.
 */
const REQUIRED_ARTEFACTS = Object.freeze([
  {
    file: join(DIST_PRISMA_DIR, 'prisma.service.js'),
    holds: 'runWithTenant — the transaction that sets and RE-READS the tenant GUC',
    remedy: 'pnpm build',
  },
  {
    file: join(DIST_PRISMA_DIR, 'tenant-scope.js'),
    holds: 'appRoleVerdict + APP_ROLE_REQUIRED_PRIVILEGES + the AsyncLocalStorage store',
    remedy: 'pnpm build',
  },
  {
    // `.service` fait partie du basename de la source
    // (`app-role-prisma.service.ts`) et `tsc` le PRÉSERVE à l'émission — cf.
    // `dist/shared/prisma/prisma.service.js` juste au-dessus. Demander
    // `app-role-prisma.js` rendrait cette étape rouge sur un arbre parfaitement
    // construit, en nommant `pnpm build` comme remède impossible à satisfaire.
    file: join(DIST_PRISMA_DIR, 'app-role-prisma.service.js'),
    holds: 'probeAppRole — the SAME questions production asks of the connection',
    remedy: 'pnpm build',
  },
]);

/**
 * Tenant A's id carries UPPERCASE hex, on purpose and not as decoration.
 *
 * PostgreSQL renders a `uuid` in lowercase while `assertTenantId` deliberately
 * PRESERVES case, and the `tenant_isolation` predicate casts the GUC to `uuid`
 * rather than casting `tenant_id` to `text`. A rewrite to the text form would
 * match ZERO rows for this tenant — fail-closed, but completely invisible, which
 * is the worst shape a security control can have. Because A is uppercase, the
 * cast direction is EXECUTED here: rewrite the predicate and the POSITIVE
 * CONTROL goes red immediately. Same choice, same reason, as
 * `rls-isolation-check.js`.
 */
const TENANT_A = 'AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA';
const TENANT_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const SCHOOL_A = '11111111-0000-4000-8000-00000000000a';
const SCHOOL_B = '22222222-0000-4000-8000-00000000000b';

/** The two rows the whole proof turns on: one per tenant, addressed by PRIMARY KEY. */
const EVENT_A = 'e0000000-0000-4000-8000-00000000000a';
const EVENT_B = 'e0000000-0000-4000-8000-00000000000b';

/** The row the POSITIVE CONTROL's `create` writes. Its absence would be a red. */
const EVENT_A_CREATED = 'e0000000-0000-4000-8000-0000000000ac';

const TCP_PREFLIGHT_TIMEOUT_MS = 2000;
const PSQL_TIMEOUT_MS = 180000;
const MIGRATE_TIMEOUT_MS = 300000;

/** Exit codes, so an operator can tell the three failures apart. */
const VERDICT_EXIT_CODES = Object.freeze({
  proven: 0,
  tooling_unavailable: 1,
  not_proven: 2,
});

// ---------------------------------------------------------------------------
// Plumbing — the shapes are `rls-isolation-check.js`'s, deliberately
// ---------------------------------------------------------------------------

class ToolingUnavailable extends Error {}

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

/**
 * The SAME URL with a different DATABASE, and nothing else touched.
 *
 * This is the one composition in the tree (see the header). It rewrites
 * `pathname` and leaves the search string — `schema=public`,
 * `connection_limit`, `pool_timeout` — exactly as the operator wrote it, so the
 * scratch connection is sized the way the real one is. Host, port, user and
 * password are never re-encoded, only carried.
 */
function withDatabase(url, database) {
  const parsed = new URL(url);
  parsed.pathname = '/' + database;
  return parsed.toString();
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

/** Run one `psql` script against one database. `-X` skips `~/.psqlrc`. */
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

// ---------------------------------------------------------------------------
// The fixtures — a STATIC constant, interpolating only the constants above
// ---------------------------------------------------------------------------

/**
 * Two tenants, two schools, two calendar events. Inserted BY THE OWNER, before
 * any `app_user` connection exists, because the owner escapes its own policies
 * and the fixtures must exist regardless of the GUC.
 *
 * One row per tenant is enough and more would be noise: the denial is asserted
 * BY PRIMARY KEY, which is the strongest form — a filter cannot be credited for
 * the refusal, because the key names exactly one row and the answer is still
 * `null`.
 */
function fixtures() {
  const ts = "'2026-09-01T08:00:00Z'::timestamptz";
  const te = "'2026-09-01T10:00:00Z'::timestamptz";
  return `
INSERT INTO tenant (id, name, slug, updated_at) VALUES
  (${lit(TENANT_A)}, 'Tenant A', 'tenant-scope-a', now()),
  (${lit(TENANT_B)}, 'Tenant B', 'tenant-scope-b', now());

INSERT INTO school (id, tenant_id, name, school_code, country, updated_at) VALUES
  (${lit(SCHOOL_A)}, ${lit(TENANT_A)}, 'School A', 'TS-A', 'FR', now()),
  (${lit(SCHOOL_B)}, ${lit(TENANT_B)}, 'School B', 'TS-B', 'FR', now());

INSERT INTO calendar_event
  (id, tenant_id, school_id, type, title, starts_at, ends_at, updated_at) VALUES
  (${lit(EVENT_A)}, ${lit(TENANT_A)}, ${lit(SCHOOL_A)}, 'meeting',
   'A own event', ${ts}, ${te}, now()),
  (${lit(EVENT_B)}, ${lit(TENANT_B)}, ${lit(SCHOOL_B)}, 'meeting',
   'B foreign event', ${ts}, ${te}, now());
`;
}

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

async function main() {
  const owner = parseUrl(DATABASE_URL);
  const client = postgresClient('psql');

  // ---- 1. Tooling. Every one is exit 1 with a NAME, never a skip (DNC-08). ----
  if (!client.command) {
    throw new ToolingUnavailable(
      `no PostgreSQL client found. Searched:\n${client.tried.map((t) => `    - ${t}`).join('\n')}`,
    );
  }
  if (!APP_DATABASE_URL) {
    throw new ToolingUnavailable(
      `${APP_DATABASE_URL_VAR} is not declared in the environment, apps/api/.env or .env.\n` +
        '    This proof is ABOUT a non-owner role; there is deliberately no fallback literal for\n' +
        '    it, because inventing a credential would turn a missing address into what reads like\n' +
        '    a server problem. Declare it, or accept that the seam is unproven on this checkout.',
    );
  }
  const app = parseUrl(APP_DATABASE_URL);
  if (!isLoopbackHost(owner.host) || !isLoopbackHost(app.host)) {
    throw new ToolingUnavailable(
      `refusing to run against a non-loopback address (${owner.host} / ${app.host}). This script\n` +
        '    executes DDL; a checkout whose .env names a shared server must not have a database\n' +
        '    created and dropped on it by a gate. There is deliberately no flag to override this.',
    );
  }
  // Both hosts are already PROVEN loopback by the refusal above, so any spelling
  // of loopback names the same server and comparing the two host STRINGS would be
  // a false red: measured on this checkout, `.env` writes `127.0.0.1` for the
  // owner and `localhost` for the app role. Only the PORT can still disagree, and
  // a disagreement there really would be two servers.
  if (owner.port !== app.port) {
    throw new ToolingUnavailable(
      `DATABASE_URL and ${APP_DATABASE_URL_VAR} name different ports ` +
        `(${owner.host}:${owner.port} vs ${app.host}:${app.port}). The proof creates the scratch\n` +
        '    database on the first and connects to it on the second; two servers make that\n' +
        '    incoherent rather than merely slow.',
    );
  }
  const preflight = await probeAddress(owner.host, owner.port);
  if (!preflight.open) {
    throw new ToolingUnavailable(
      `no PostgreSQL server answered at ${owner.host}:${owner.port} (${preflight.state}: ${preflight.detail}).\n` +
        '    The remedy is to start PostgreSQL, never to edit code (ADR-027).',
    );
  }
  for (const artefact of REQUIRED_ARTEFACTS) {
    if (!existsSync(artefact.file)) {
      throw new ToolingUnavailable(
        `no built artefact at ${artefact.file}\n` +
          `    It holds: ${artefact.holds}\n` +
          `    Run \`${artefact.remedy}\` before this check.\n` +
          '    NOT a skip: this proof drives the COMPILED seam, and a missing build is the state\n' +
          '    in which every assertion below would vacuously pass (DNC-08).',
      );
    }
  }

  // The generated client is a separate artefact from the build, with a separate
  // remedy, and it fails in a separate way: `@prisma/client` RESOLVES whether or
  // not `prisma generate` has run, and only throws on construction.
  const requireFromApi = (spec) => require(require.resolve(spec, { paths: [API_DIR] }));
  let PrismaClient;
  try {
    requireFromApi('reflect-metadata');
    ({ PrismaClient } = requireFromApi('@prisma/client'));
    if (typeof PrismaClient !== 'function') throw new Error('@prisma/client exports no PrismaClient');
  } catch (error) {
    throw new ToolingUnavailable(
      'the generated Prisma client could not be loaded from apps/api: ' +
        String(error && error.message ? error.message.split('\n')[0] : error) +
        '\n    Run `pnpm --filter @pilotage/api exec prisma generate` before this check.\n' +
        '    (`pnpm --filter X prisma generate` is a no-op that exits 0 — it must be `exec`.)',
    );
  }
  const prismaCli = (() => {
    try {
      return require.resolve('prisma/build/index.js', { paths: [API_DIR] });
    } catch {
      return null;
    }
  })();
  if (prismaCli === null) {
    throw new ToolingUnavailable(
      'the `prisma` CLI is not installed under apps/api, so the ledger cannot be applied to the\n' +
        '    scratch database. Run `pnpm install` before this check.',
    );
  }

  // The COMPILED seam. Required by absolute path — never by package name — so
  // there is no chance of resolving a different copy than the one that shipped.
  const { runWithTenant } = require(join(DIST_PRISMA_DIR, 'prisma.service.js'));
  const {
    APP_ROLE_REQUIRED_PRIVILEGES,
    appRoleVerdict,
    currentTenantScopeFrame,
    runInTenantScope,
  } = require(join(DIST_PRISMA_DIR, 'tenant-scope.js'));
  const { probeAppRole } = require(join(DIST_PRISMA_DIR, 'app-role-prisma.service.js'));
  for (const [name, value] of [
    ['runWithTenant', runWithTenant],
    ['appRoleVerdict', appRoleVerdict],
    ['runInTenantScope', runInTenantScope],
    ['currentTenantScopeFrame', currentTenantScopeFrame],
    ['probeAppRole', probeAppRole],
  ]) {
    if (typeof value !== 'function') {
      throw new ToolingUnavailable(
        `the compiled seam does not export \`${name}\`. The build is stale relative to the source; ` +
          'run `pnpm build`.',
      );
    }
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
  // It must exist BEFORE the ledger is applied: `20260813120000_tenant_rls_policies`
  // guards every GRANT behind `has_app_user` and, when it is false, emits a
  // `RAISE NOTICE` while `migrate deploy` still exits 0. A scratch database built
  // in the other order has 50 policies and ZERO grants — which is failure family 2
  // in `appRoleVerdict`'s own docblock, and it would be scored here as a denial.
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
  const scratchName = `tenant_scope_${process.pid}_${Date.now()}`;
  if (
    !SCRATCH_NAME_PATTERN.test(scratchName) ||
    scratchName === owner.database ||
    scratchName === app.database
  ) {
    throw new ToolingUnavailable(`refusing to use ${scratchName} as a scratch database name`);
  }
  const scratchOwner = { ...owner, database: scratchName };
  const scratchApp = { ...app, database: scratchName };
  const scratchOwnerUrl = withDatabase(DATABASE_URL, scratchName);
  const scratchAppUrl = withDatabase(APP_DATABASE_URL, scratchName);

  const created = psql(client.command, maintenance, `CREATE DATABASE "${scratchName}";`);
  if (created.status !== 0) {
    throw new ToolingUnavailable(`could not create the scratch database: ${created.stderr.trim()}`);
  }

  /** @type {{ $disconnect: () => Promise<void> } | null} */
  let appClient = null;

  try {
    // ---- 4. AC-3 — THE ADDRESSES, ASSERTED BY NAME AND BEFORE ANYTHING ELSE.
    //
    //         The live `pilotage` database has 2 migrations and 0 policies by
    //         design. If either composed DSN still pointed there, the positive
    //         control's `create` would INSERT A ROW INTO IT and every denial
    //         below would be a statement about an unprotected database. This is
    //         the assertion that makes the rest safe to run, so it runs first
    //         and it names the databases rather than trusting the composition.
    expectEqual('AC-3 the scratch name matches the pattern this script owns', SCRATCH_NAME_PATTERN.test(scratchName), true);
    expectEqual('AC-3 the OWNER connection under test addresses the scratch database', parseUrl(scratchOwnerUrl).database, scratchName);
    expectEqual('AC-3 the APP connection under test addresses the scratch database', parseUrl(scratchAppUrl).database, scratchName);
    expectEqual(
      `AC-3 the scratch database is NOT the live one (${owner.database})`,
      scratchName !== owner.database && scratchName !== app.database,
      true,
    );
    record('AC-3 addresses under test (redacted)', `${redact(scratchOwner)} · ${redact(scratchApp)}`);

    // ---- 5. Apply the ledger with `prisma migrate deploy`.
    //
    //         The precedent `psql`s each migration.sql directly. `migrate deploy`
    //         is preferred HERE because the compiled Prisma client is generated
    //         from `schema.prisma`: any drift between the ledger and the schema
    //         would surface as an opaque client error at the first query instead
    //         of as a named failure at the ledger.
    //
    //         The scratch DSN reaches the CHILD's environment only. `process.env`
    //         is not mutated, so no later construction in this process can pick
    //         it up by accident — and dotenv does not override an env var that is
    //         already set, so `apps/api/.env`'s DATABASE_URL cannot win here.
    const deploy = spawnSync(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', SCHEMA_PATH],
      {
        encoding: 'utf8',
        cwd: API_DIR,
        shell: false,
        timeout: MIGRATE_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, DATABASE_URL: scratchOwnerUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      },
    );
    if (deploy.status !== 0) {
      fail(
        'the migration ledger applies to a fresh PostgreSQL (prisma migrate deploy)',
        String(deploy.stderr || deploy.stdout || (deploy.error && deploy.error.message) || '').trim(),
      );
      return;
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
    record('the ledger applied to the scratch database', `${scalar(tables)} tables`);

    // ---- 6. Seed, AS THE OWNER, before any app_user connection exists. ----
    const seeded = psql(client.command, scratchOwner, fixtures());
    if (seeded.status !== 0) {
      fail('the two-tenant fixtures were seeded by the OWNER', seeded.stderr.trim());
      return;
    }
    record('two tenants seeded by the owner', `${TENANT_A} / ${TENANT_B}, one calendar_event each`);

    appClient = new PrismaClient({ datasourceUrl: scratchAppUrl });
    await appClient.$connect();

    // ---- 7. AC-2.1 — WHOM AM I, over the connection under test, FIRST. ----
    //
    //         Through `probeAppRole` from the COMPILED module, so the proof and
    //         production ask the connection the SAME questions — and through
    //         `appRoleVerdict`, so they reach the verdict by the same rule.
    const probe = await probeAppRole(appClient);
    expectEqual('AC-2.1 current_user is readable on the connection under test', typeof probe.currentUser === 'string' && probe.currentUser.length > 0, true);
    expectEqual('AC-2.1 the owner of calendar_event is read from the CATALOG, never a literal', typeof probe.tableOwner === 'string' && probe.tableOwner.length > 0, true);
    expectEqual(
      `AC-2.1 current_user (${probe.currentUser}) is NOT the table owner (${probe.tableOwner})`,
      probe.currentUser !== probe.tableOwner,
      true,
    );
    expectEqual('AC-2.1 the role does NOT carry BYPASSRLS', probe.bypassRls, false);
    expectEqual('AC-2.1 the role is NOT a member of the owner', probe.memberOfOwner, false);

    const ownedRows = await appClient.$queryRaw`
      SELECT count(*)::int AS owned
      FROM pg_tables
      WHERE schemaname = 'public' AND tableowner = current_user
    `;
    expectEqual(
      'AC-2.1 current_user owns ZERO tables under test',
      Array.isArray(ownedRows) && ownedRows[0] ? ownedRows[0].owned : 'no answer',
      0,
    );

    const missingPrivileges = APP_ROLE_REQUIRED_PRIVILEGES.filter(
      (requirement) => probe.privileges[`${requirement.table}.${requirement.privilege}`] !== true,
    ).map((requirement) => `${requirement.table}.${requirement.privilege}`);
    expectEqual(
      `AC-2.1 the ${APP_ROLE_REQUIRED_PRIVILEGES.length} privileges the converted module needs are HELD`,
      missingPrivileges.length === 0 ? 'all held' : `missing ${missingPrivileges.join(', ')}`,
      'all held',
    );

    const verdict = appRoleVerdict(probe);
    expectEqual(
      'AC-2.1 appRoleVerdict — the SAME function production boots on — qualifies this connection as ENFORCING',
      verdict.enforcing === true ? 'enforcing' : `refused: ${verdict.reason}`,
      'enforcing',
    );
    if (verdict.enforcing !== true) {
      fail(
        'AC-2.1 the connection under test is a PROVEN non-owner — nothing below may be attempted',
        'a denial measured on a connection that was never qualified is not evidence of isolation',
      );
      return;
    }

    // ---- 7b. PF-203 — RLS IS ARMED. The question the production probe cannot ask.
    //
    //          `probeAppRole` measures identity, membership, BYPASSRLS and the
    //          eight privileges. It NEVER reads `pg_class.relrowsecurity` and
    //          never counts `pg_policy` rows. A database holding the GRANTS but
    //          not the POLICIES therefore satisfies every question it asks: the
    //          verdict is `enforcing`, the gauge reads 1, and every converted
    //          call site reads EVERY tenant's rows with no filter but the
    //          application `where`. That is strictly worse than
    //          `degraded_no_app_url`, because the gauge actively asserts safety —
    //          `PF-02`'s own shape reproduced inside the probe built to refuse it.
    //          It is reachable on this machine: the live database has 0 policies,
    //          so a partial repair that runs only the grants half lands there.
    //
    //          Asserted HERE, on the connection under test, until the probe can
    //          ask it. The seam shipped at `6504887` is out of this slice's scope
    //          by construction, so this is a RECORDED gap, not a widened one.
    const armed = await appClient.$queryRaw`
      SELECT c.relname::text AS table_name,
             c.relrowsecurity AS rls_on,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relname IN ('calendar_event', 'enrollment')
      ORDER BY c.relname
    `;
    for (const table of TABLES_UNDER_TEST) {
      const row = Array.isArray(armed) ? armed.find((r) => r.table_name === table) : undefined;
      expectEqual(`PF-203 ROW LEVEL SECURITY is ENABLED on public.${table}`, row ? row.rls_on : 'no answer', true);
      expectEqual(
        `PF-203 public.${table} carries at least one policy`,
        row && Number(row.policies) >= 1 ? 'yes' : `no (${row ? row.policies : 'no answer'})`,
        'yes',
      );
    }

    // ---- 8. AC-2.2 — POSITIVE CONTROL, SECOND, BEFORE ANY DENIAL. ----
    //
    //         `app_user` held no privilege at all before `S-E01-2b`. A proof
    //         showing only ABSENCE would be green on a role that could never
    //         have read anything — the difference between "RLS refused it" and
    //         "the role was never allowed to try". Read, UPDATE and CREATE, all
    //         through the compiled seam, all on tenant A's own row.
    //
    //         The store is exercised too, exactly as `TenantScopeService.run`
    //         composes it: `runWithTenant(...)` wrapping `runInTenantScope(...)`.
    //         An implementation that forgot to set the GUC fails HERE, at the
    //         first read, and not silently three assertions later.
    const control = await runWithTenant(appClient, TENANT_A, (tx) =>
      runInTenantScope({ tenantId: TENANT_A, tx }, async () => {
        const frame = currentTenantScopeFrame();
        const own = await tx.calendarEvent.findUnique({ where: { id: EVENT_A } });
        const updated = await tx.calendarEvent.updateMany({
          where: { id: EVENT_A },
          data: { title: 'A own event (updated through the scope)' },
        });
        const createdRow = await tx.calendarEvent.create({
          data: {
            id: EVENT_A_CREATED,
            tenantId: TENANT_A,
            schoolId: SCHOOL_A,
            type: 'meeting',
            title: 'A created through the scope',
            startsAt: new Date('2026-09-02T08:00:00Z'),
            endsAt: new Date('2026-09-02T10:00:00Z'),
          },
        });
        return {
          frameTenant: frame === undefined ? null : frame.tenantId,
          ownId: own === null ? null : own.id,
          ownTitle: own === null ? null : own.title,
          updatedCount: updated.count,
          createdId: createdRow.id,
        };
      }),
    );
    expectEqual('AC-2.4 the scope frame is installed for the duration of the callback', control.frameTenant, TENANT_A);
    expectEqual('AC-2.2 POSITIVE CONTROL — tenant A READS its own calendar_event by primary key', control.ownId, EVENT_A);
    expectEqual('AC-2.2 POSITIVE CONTROL — the UPDATE affects exactly one row', control.updatedCount, 1);
    expectEqual('AC-2.2 POSITIVE CONTROL — an own-tenant CREATE succeeds', control.createdId, EVENT_A_CREATED);

    // ---- 9. AC-2.3 — THEN the denial. BY PRIMARY KEY, on the count and on the
    //         Prisma error object. NEVER on a log line.
    const denial = await runWithTenant(appClient, TENANT_A, (tx) =>
      runInTenantScope({ tenantId: TENANT_A, tx }, async () => {
        const foreign = await tx.calendarEvent.findUnique({ where: { id: EVENT_B } });
        const updated = await tx.calendarEvent.updateMany({
          where: { id: EVENT_B },
          data: { title: 'B rewritten from tenant A' },
        });
        const deleted = await tx.calendarEvent.deleteMany({ where: { id: EVENT_B } });
        let raised = null;
        try {
          await tx.calendarEvent.update({
            where: { id: EVENT_B },
            data: { title: 'B rewritten from tenant A, by unique write' },
          });
        } catch (error) {
          // The CODE, off the Prisma error object. A message match would break
          // on a locale or a Prisma patch release and would be asserting on
          // prose rather than on behaviour.
          raised = error && typeof error.code === 'string' ? error.code : String(error && error.name);
        }
        return { foreign, updatedCount: updated.count, deletedCount: deleted.count, raised };
      }),
    );
    expectEqual(
      'AC-2.3 DENIAL — tenant B’s calendar_event is INVISIBLE to a findUnique BY PRIMARY KEY',
      denial.foreign === null ? 'null' : `row ${denial.foreign.id}`,
      'null',
    );
    expectEqual('AC-2.3 DENIAL — updateMany by primary key affects ZERO rows', denial.updatedCount, 0);
    expectEqual('AC-2.3 DENIAL — deleteMany by primary key affects ZERO rows', denial.deletedCount, 0);
    expectEqual(
      'AC-2.3 DENIAL — a unique `update` RAISES, and the assertion is on the Prisma error code',
      denial.raised,
      'P2025',
    );

    // ---- 9b. The row was really THERE. "Zero rows" must not be satisfiable by
    //          "the row never existed" — the owner re-reads it, intact, and the
    //          title is compared to the seeded literal so a successful foreign
    //          UPDATE could not hide inside a surviving row.
    const survivor = psql(
      client.command,
      scratchOwner,
      `SELECT title FROM calendar_event WHERE id = ${lit(EVENT_B)};`,
    );
    expectEqual(
      'AC-2.3 …and tenant B’s row is still there, UNCHANGED, read back by the OWNER',
      scalar(survivor),
      'B foreign event',
    );

    // ---- 10. AC-2.4 — THE NO-SCOPE CONTROL. What makes step 8 attributable to
    //          the SEAM rather than to the connection.
    //
    //          Same client, same role, same database, OUTSIDE any scope: no GUC,
    //          so `nullif(current_setting('app.current_tenant_id', true), '')::uuid`
    //          is NULL, the predicate is NULL, and the row set is empty. If this
    //          returned tenant A's row, the positive control above would prove
    //          nothing — it would mean the connection sees everything anyway.
    const noScope = await appClient.calendarEvent.findMany({ where: { id: EVENT_A } });
    expectEqual(
      'AC-2.4 NO-SCOPE CONTROL — the same client OUTSIDE any scope sees ZERO rows (the GUC is what makes the difference)',
      Array.isArray(noScope) ? noScope.length : 'no answer',
      0,
    );
    expectEqual(
      'AC-2.4 …and no scope frame leaked out of the callbacks above',
      currentTenantScopeFrame() === undefined ? 'none' : 'LEAKED',
      'none',
    );
  } finally {
    // ---- 11. AC-2.5 / AC-4 — CLEANUP, EXECUTED, VERIFIED INDEPENDENTLY.
    //
    //          TOOL-27, in the shape that actually applies here: `pilotage` is a
    //          member of neither `app_user` nor `pg_signal_backend`, so it cannot
    //          terminate this script's own Node client. The disconnect is
    //          therefore DETERMINISTIC and comes FIRST — it is not a retry, it is
    //          the design — and `pg_stat_activity` is asserted empty BEFORE the
    //          drop rather than after a failure.
    //
    //          The drop is CLEANUP, never EVIDENCE: a failed drop is a failure in
    //          its own right and never downgrades or upgrades the isolation
    //          verdict above.
    if (appClient !== null) {
      try {
        await appClient.$disconnect();
        record('AC-4 the app_user client was disconnected DETERMINISTICALLY, before the drop');
      } catch (error) {
        fail('AC-4 the app_user client was disconnected before the drop', String(error && error.message));
      }
    }

    const sessions = psql(
      client.command,
      maintenance,
      `SELECT count(*) FROM pg_stat_activity WHERE datname = ${lit(scratchName)};`,
    );
    expectEqual(
      'AC-4 no session remains attached to the scratch database (verified from a SEPARATE connection)',
      sessions.status === 0 ? scalar(sessions) : `psql failed: ${sessions.stderr.trim()}`,
      0,
    );

    // Without FORCE first, on purpose: FORCE signals every other backend and then
    // waits five seconds, which on this cluster is a wait the maintenance role
    // has no privilege to make succeed. If the disconnect above did its job there
    // is nothing to signal, so the plain DROP is the fast path AND the honest one.
    const dropSql = `DROP DATABASE IF EXISTS "${scratchName}";`;
    let dropped = psql(client.command, maintenance, dropSql);
    if (dropped.status !== 0) {
      dropped = psql(client.command, maintenance, `DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE);`);
    }
    if (dropped.status !== 0) {
      fail('the scratch database was dropped', `${scratchName}: ${dropped.stderr.trim()}`);
    } else {
      // Verified from a SEPARATE connection to the maintenance database, so
      // cleanup is confirmed by something other than the command that performed
      // it. `psql` exiting 0 is a claim; `pg_database` is the fact.
      const gone = psql(
        client.command,
        maintenance,
        `SELECT count(*) FROM pg_database WHERE datname = ${lit(scratchName)};`,
      );
      expectEqual(`the scratch database ${scratchName} is GONE (independently verified)`, scalar(gone), 0);
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
    verdict === 'proven'
      ? 'TENANT SCOPE: PROVEN — the compiled seam is refused by PostgreSQL for a non-owner role'
      : verdict === 'not_proven'
        ? 'TENANT SCOPE: NOT PROVEN'
        : 'TENANT SCOPE: COULD NOT RUN';
  console.log(`\n${banner}`);
  console.log(evidence.join('\n'));
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const line of failures) console.log(`  - ${line}`);
  }
  if (verdict === 'proven') {
    // The honesty clause, printed on the GREEN path on purpose: the only moment
    // anyone is tempted to over-read this gate is when it passes.
    console.log(
      '\nWHAT THIS DOES NOT SAY: the application at large is still NOT isolated.\n' +
        '  Only the call sites a module has explicitly converted go through this seam —\n' +
        '  today that is `calendar.controller.ts` and nothing else; every other site stays on\n' +
        '  the OWNER connection, which escapes its own policies without FORCE ROW LEVEL\n' +
        '  SECURITY. And coverage is a property of the DEPLOYMENT as much as of the source\n' +
        '  tree: where DATABASE_URL_APP is not declared, even the converted sites run on the\n' +
        '  owner (state `degraded_no_app_url`, gauge `pilotage_tenant_scope_enforced` = 0).\n' +
        '  What is proven above is that the SEAM sets the GUC, and that PostgreSQL refuses\n' +
        '  the foreign tenant when it does. (PF-02 half (a): the application half, one module.)',
    );
  }
  return VERDICT_EXIT_CODES[verdict];
}

// NOT a bare `main()` at module scope. The guard spec `require()`s this file to
// reach the pure exports, and it runs inside `pnpm test` on every developer's
// machine — a module-scope `main()` would create and drop a database as a side
// effect of loading it. Same shape as `scripts/rls-isolation-check.js`.
if (require.main === module) {
  main()
    .then(() => {
      process.exit(report(failures.length === 0 ? 'proven' : 'not_proven'));
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
  APP_DATABASE_URL_VAR,
  EVENT_A,
  EVENT_B,
  MIN_EXPECTED_TABLES,
  REQUIRED_ARTEFACTS,
  SCRATCH_NAME_PATTERN,
  TABLES_UNDER_TEST,
  TENANT_A,
  TENANT_B,
  VERDICT_EXIT_CODES,
  isLoopbackHost,
  lit,
  redact,
  withDatabase,
};
