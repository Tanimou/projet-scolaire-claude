#!/usr/bin/env node
/**
 * rls-isolation-check.js — the `tenant_isolation` policies must actually DENY,
 * and this is the thing that says so (S-E01-2b + S-E01-2c, PF-02 half (a),
 * G-TENANT).
 *
 * WHAT S-E01-2c ADDED, AND THE ONE SENTENCE THAT MATTERS
 * -----------------------------------------------------
 * Five tables BELONG to a tenant by FOREIGN KEY without carrying a `tenant_id`
 * column (`announcement_receipt`, `branding`, `grade_revision`, `import_row`,
 * `user_role`). They now carry an FK-path `tenant_isolation` policy, and the
 * three census assertions stopped being keyed to the count of `tenant_id`
 * columns alone. THE ONE SENTENCE: the right-hand side is
 * `TENANT_COLS + DERIVED_EXPECTED`, and `DERIVED_EXPECTED` is computed from
 * catalog STRUCTURE (`pg_constraint`) with NO reference to whether a policy
 * exists. Keying it to "derived tables that HAVE a policy" would be vacuous —
 * a sixth derived table shipped without one is absent from BOTH sides, the
 * counts still balance, and the gate passes on exactly the defect it exists to
 * catch. There is no literal 49 in this file, and there must never be one.
 *
 * `outbox_event` is the sixth table without a `tenant_id`, and it has NO foreign
 * key at all — polymorphic, unconstrained. It is therefore NOT derivable, stays
 * ungranted and unpolicied, and that is PROVEN by execution here (PF-185). It is
 * the only place in this file where `permission denied` is the EXPECTED result.
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
/**
 * A SECOND school for tenant B, deliberately WITHOUT a `branding` row.
 *
 * `branding`'s foreign key IS its primary key, so an attempt to insert branding
 * for a school that already has one would be refused by the unique index. Which
 * error arrives first — 23505 or the RLS violation — is an implementation detail
 * of `ExecInsert`, and a proof must never depend on one. This row makes the
 * foreign-parent INSERT of AC-7 fail for exactly ONE reason: the policy.
 */
const SCHOOL_B3 = '55555555-0000-4000-8000-000000000005';

// ---------------------------------------------------------------------------
// S-E01-2c — the tenant-DERIVED tables (ADR-042)
// ---------------------------------------------------------------------------

/**
 * The five tables that BELONG to a tenant by FOREIGN KEY and carry no
 * `tenant_id` column of their own (`ADR-042 §D1`).
 *
 * READ THIS BEFORE USING THIS ARRAY FOR ANYTHING COUNT-SHAPED. It is NOT what
 * the census agreement is keyed to, and it must never become that. The
 * agreement's right-hand side is `DERIVED_EXPECTED`, computed on the scratch
 * database from `pg_constraint` STRUCTURE, with no reference to this list and no
 * reference to whether a policy exists (§D3). A frozen list on the agreement's
 * side is exactly how a sixth derived table ships unprotected and invisible.
 *
 * What this list IS for: the two things a catalog count cannot do.
 *   1. NAME the tables the per-table proof must execute against — the census
 *      counts policies BY NAME and never reads a predicate, so a policy pointing
 *      at the wrong parent is counted as correct. Four of the five are generated
 *      from one `format()` call over a transposable tuple.
 *   2. State the PRIVILEGE each table may hold, which is a decision (§D5) and
 *      not a catalog fact.
 *
 * Both directions are asserted against the catalog below, so this list cannot
 * drift away from the database without failing.
 */
const DERIVED_TABLES = Object.freeze([
  Object.freeze({
    child: 'announcement_receipt',
    fk: 'announcement_id',
    parent: 'announcement',
    key: 'id',
    rowSlot: 'receipt',
    expectedRows: 1,
    privileges: 'SELECT, INSERT, UPDATE',
  }),
  Object.freeze({
    // The FK IS the primary key — the shape AC-7 requires one proof on.
    child: 'branding',
    fk: 'school_id',
    parent: 'school',
    key: 'school_id',
    rowSlot: null,
    expectedRows: 1,
    privileges: 'SELECT, INSERT, UPDATE',
  }),
  Object.freeze({
    child: 'grade_revision',
    fk: 'grade_id',
    parent: 'grade',
    key: 'id',
    rowSlot: 'gradeRevision',
    expectedRows: 1,
    privileges: 'SELECT, INSERT',
  }),
  Object.freeze({
    child: 'import_row',
    fk: 'batch_id',
    parent: 'import_batch',
    key: 'id',
    rowSlot: 'importRow',
    expectedRows: 1,
    privileges: 'SELECT, INSERT, UPDATE',
  }),
  Object.freeze({
    // `user_role` holds a SECOND foreign key, `role_id -> role`, and `role`
    // carries no `tenant_id`: that path is a dead end (ADR-042 §D2). The tenant
    // path is `user_profile_id`, never `role_id`.
    child: 'user_role',
    fk: 'user_profile_id',
    parent: 'user_profile',
    key: 'id',
    rowSlot: 'userRole',
    // two: the member's assignment, and the one AC-10's cascade will remove.
    expectedRows: 2,
    privileges: 'SELECT, INSERT, UPDATE',
  }),
]);

/**
 * The CLOSED set of privilege strings the derived tables may hold (ADR-042 §D5).
 *
 * TWO, not three — and the difference is a measurement, not a preference. The
 * story doc granted `DELETE` to `announcement_receipt`, `branding` and
 * `import_row`; re-measured, NO delete caller exists for any of the five
 * anywhere in `apps/**` or `packages/**` (`imports.service.ts` `rollback()`
 * re-classifies rows with `update`, it does not remove them). `ADR-032 §D7`
 * already fixed the principle — an unnecessary grant is a widened blast radius —
 * so the ruling in `ADR-042 §D5` is that none of the five receives `DELETE`.
 */
const DERIVED_PRIVILEGE_SETS = Object.freeze(['SELECT, INSERT', 'SELECT, INSERT, UPDATE']);

/**
 * The derived table that is APPEND-ONLY, for the same reason as `audit_log` and
 * a stronger one: `grade_revision` IS the grade audit trail (G-AUDIT), and
 * unlike `audit_log` it carries NO `hash`/`prev_hash` chain, so a rewrite would
 * leave nothing behind at all. Asserted BY NAME so it cannot widen silently.
 */
const APPEND_ONLY_DERIVED = Object.freeze(['grade_revision']);

/**
 * AC-5b — the RESIDUE, named and reasoned, never globbed.
 *
 * The structural derivation is ONE LEVEL DEEP: a future table with no
 * `tenant_id` whose foreign key points at a DERIVED table would fall outside
 * both counts and be invisible again. This closes that hole by SET EQUALITY in
 * both directions — the base tables in `public` with no `tenant_id` and outside
 * the derived set must be EXACTLY these six. A new table landing here FAILS the
 * gate, printing its name, until someone names it and says why.
 *
 * This set NEVER subtracts from the policy agreement. It is a partition check,
 * not an exemption list: `role` already carries a `school_id` column with no FK
 * constraint, and the day `ADR-015` custom roles add `role_school_id_fkey`,
 * `role` correctly ENTERS the derived set and the agreement correctly goes red.
 * A subtracting list would swallow exactly that alarm.
 */
const NON_DERIVED_EXPECTED = Object.freeze([
  // the migration ledger — not tenant data
  '_prisma_migrations',
  // reference data by design (ADR-015): no tenant discriminant, no FK to one
  'permission',
  'role',
  'role_permission',
  // PF-185 — no FK, no discriminant, NOT derivable. Fail-closed by design and
  // proven so below; needs a denormalised `tenant_id` + a backfill (ADR-042 §D7)
  'outbox_event',
  // AUTO-DISCRIMINANT: its PRIMARY KEY is the discriminant. A policy here would
  // break the identity seam, which must read `tenant` BY SLUG before any tenant
  // is resolved (S-E01-1). Excluded deliberately, not forgotten.
  'tenant',
]);

/** PF-185. The one table where `permission denied` is the EXPECTED result. */
const OUTBOX_TABLE = 'outbox_event';

/**
 * The migration ledger's own table, which is in `NON_DERIVED_EXPECTED` because
 * it is in every REAL database — and which is ABSENT from the scratch database
 * this check builds, because the ledger is applied here by `psql` file by file,
 * not by `prisma migrate deploy`. Prisma's CLI creates this table; the SQL does
 * not. So the residue assertion expects it only when it is actually there, and
 * WHICH branch was taken is printed, so this reasoning cannot rot silently the
 * day the harness changes how it applies the ledger.
 */
const LEDGER_TABLE = '_prisma_migrations';

/**
 * THE DERIVATION ITSELF — written ONCE, in SQL, over catalog STRUCTURE.
 *
 * > base tables in `public` with NO `tenant_id` column that hold at least one
 * > foreign key to a table which DOES have one.
 *
 * It never asks whether a policy exists. That is not a stylistic choice, it is
 * the entire point (ADR-042 §D3): the obvious formula
 * `RLS_ON == TENANT_COLS + DERIVED_POLICIED`, where the derived half counts the
 * tables that HAVE a policy, is VACUOUS — a sixth derived table shipped with no
 * policy is absent from BOTH sides, the counts still balance, and the gate
 * passes on exactly the defect it exists to catch. Against DERIVED_EXPECTED the
 * right-hand side rises to 6 while `RLS_ON` stays at 49, and the gate FAILS.
 *
 * Read from `pg_constraint` rather than `information_schema.table_constraints`
 * so that multi-column foreign keys are seen. `conkey[1]` is the FK's LEADING
 * column, which is the one R-11 cares about.
 */
const DERIVED_SET_SQL = `
  SELECT DISTINCT child.oid AS child_oid, child.relname AS child,
         parent.relname AS parent, k.conkey[1] AS fk_attnum
    FROM pg_constraint k
    JOIN pg_class child ON child.oid = k.conrelid
    JOIN pg_class parent ON parent.oid = k.confrelid
    JOIN pg_namespace n ON n.oid = child.relnamespace
   WHERE k.contype = 'f' AND n.nspname = 'public' AND child.relkind = 'r'
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = child.oid
                       AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped)
     AND     EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = parent.oid
                       AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped)`;

/**
 * Fixture ids are GENERATED, not typed.
 *
 * The `grade_revision` chain alone needs eleven rows per tenant, and a mistyped
 * nibble would surface as a foreign-key violation in the FIXTURES — a red that
 * costs an hour and proves nothing about RLS. `tenantSlot` occupies the last
 * group, so no id can collide across tenants, and every id is uuid-shaped.
 *
 * The tenant IDS themselves stay literal above, and `TENANT_A` stays UPPERCASE:
 * that is the trap that executes the cast direction, and every derived positive
 * control below resolves through a `TENANT_A` parent for exactly that reason.
 */
function fid(tenantSlot, slot) {
  return `${String(slot).padStart(8, '0')}-0000-4000-8000-${String(tenantSlot).padStart(12, '0')}`;
}

/** Named row slots, so a fixture and its assertion cannot drift apart. */
const SLOT = Object.freeze({
  member: 10,
  cascadeMember: 11,
  teacher: 12,
  announcement: 20,
  receipt: 21,
  importBatch: 30,
  importRow: 31,
  userRole: 40,
  cascadeRole: 41,
  academicYear: 50,
  cycle: 51,
  gradeLevel: 52,
  classSection: 53,
  subject: 54,
  teacherProfile: 55,
  teachingAssignment: 56,
  assessment: 57,
  student: 58,
  grade: 59,
  gradeRevision: 60,
});

/** Tenant A is slot 1, tenant B is slot 2. Used only to build fixture ids. */
const SLOT_A = 1;
const SLOT_B = 2;

/** The `role` row SHARED by both tenants — see `FIXTURES_SQL`. */
const SHARED_ROLE = '99999999-0000-4000-8000-000000000099';

/** Rows the PROOF creates: an own-tenant INSERT, and two that must be refused. */
const RECEIPT_OWN_INSERT = fid(SLOT_A, 70);
const RECEIPT_FOREIGN_INSERT = fid(SLOT_A, 71);
const RECEIPT_FOREIGN_READER = fid(SLOT_A, 72);

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

/**
 * SET EQUALITY, in BOTH directions, with the offending NAMES printed.
 *
 * One direction alone always lets the dangerous half through, and a bare count
 * mismatch tells an operator that something is wrong without telling them what.
 * Both differences are reported, because "missing" and "unexpected" have
 * opposite remedies.
 */
function expectSetEqual(label, actual, expected) {
  const got = [...new Set(actual.filter((name) => name !== ''))].sort();
  const want = [...new Set(expected)].sort();
  const missing = want.filter((name) => !got.includes(name));
  const unexpected = got.filter((name) => !want.includes(name));
  if (missing.length === 0 && unexpected.length === 0) {
    record(label, got.join(', '));
    return;
  }
  fail(
    label,
    `missing [${missing.join(', ') || '—'}], unexpected [${unexpected.join(', ') || '—'}] ` +
      `(expected exactly: ${want.join(', ')})`,
  );
}

/** `A,B,C` from one census cell back into a list. Empty stays empty, not ['']. */
function names(cell) {
  return String(cell ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/**
 * `table=SELECT, INSERT, UPDATE` -> `table=INSERT|SELECT|UPDATE`.
 *
 * `information_schema` hands privileges back in ALPHABETICAL order while the
 * migration writes them in the order a human reads them (`SELECT, INSERT,
 * UPDATE`). Comparing the two raw would fail on ordering and say nothing about
 * privileges — a red that costs an hour and proves nothing. Both sides are
 * canonicalised through this one function so neither can be quietly reordered
 * into agreement.
 */
function canonicalGrant(entry) {
  const at = String(entry).indexOf('=');
  if (at < 0) return String(entry);
  const table = String(entry).slice(0, at).trim();
  const privileges = String(entry)
    .slice(at + 1)
    .split(',')
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p !== '')
    .sort();
  return `${table}=${privileges.join('|')}`;
}

class ToolingUnavailable extends Error {}

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

/**
 * The DERIVED fixtures for one tenant — one row in each of the five, plus the
 * chain each of them needs.
 *
 * Every intermediate carries `tenant_id`, so all of it is inserted by the OWNER
 * before any `app_user` connection exists. The chains were MEASURED against the
 * catalog (NOT NULL columns without a default, and which columns actually carry
 * a foreign key), not inferred from `schema.prisma`:
 *
 *   • `branding`              — nothing beyond the existing `school` row.
 *   • `announcement_receipt`  — `announcement.author_id` and
 *     `announcement_receipt.user_profile_id` are NOT NULL with NO foreign key,
 *     so the chain is one row deep.
 *   • `import_row`            — one `import_batch`.
 *   • `user_role`             — one `user_profile`, plus the SHARED `role` row.
 *   • `grade_revision`        — the deep one: academic_year, cycle, grade_level,
 *     class_section, subject, a teacher `user_profile` + `teacher_profile`,
 *     teaching_assignment, assessment, student, grade. Eleven rows to reach one.
 */
function derivedFixtures(slot, tenantId, schoolId, tag) {
  const id = (n) => lit(fid(slot, n));
  const t = lit(tenantId);
  const s = lit(schoolId);
  return `
-- ${tag} · user_profile: the receipt reader, the cascade subject (AC-10), the teacher.
INSERT INTO user_profile (id, tenant_id, first_name, last_name, email, updated_at) VALUES
  (${id(SLOT.member)}, ${t}, 'Member', ${lit(tag)}, ${lit(`member-${tag}@rls.test`)}, now()),
  (${id(SLOT.cascadeMember)}, ${t}, 'Cascade', ${lit(tag)}, ${lit(`cascade-${tag}@rls.test`)}, now()),
  (${id(SLOT.teacher)}, ${t}, 'Teacher', ${lit(tag)}, ${lit(`teacher-${tag}@rls.test`)}, now());

-- ${tag} · branding: the FK IS the primary key. Cheapest of the five.
INSERT INTO branding (school_id, display_name) VALUES (${s}, ${lit(`Branding ${tag}`)});

-- ${tag} · announcement -> announcement_receipt.
INSERT INTO announcement (id, tenant_id, school_id, title, body, scope, author_id, updated_at)
  VALUES (${id(SLOT.announcement)}, ${t}, ${s}, ${lit(`Announcement ${tag}`)}, 'body', 'school_wide',
          ${id(SLOT.member)}, now());
INSERT INTO announcement_receipt (id, announcement_id, user_profile_id)
  VALUES (${id(SLOT.receipt)}, ${id(SLOT.announcement)}, ${id(SLOT.member)});

-- ${tag} · import_batch -> import_row.
INSERT INTO import_batch (id, tenant_id, school_id, type, file_name, updated_at)
  VALUES (${id(SLOT.importBatch)}, ${t}, ${s}, 'students', ${lit(`rls-${tag}.csv`)}, now());
INSERT INTO import_row (id, batch_id, row_index, payload)
  VALUES (${id(SLOT.importRow)}, ${id(SLOT.importBatch)}, 1, '{}'::jsonb);

-- ${tag} · user_role, through the SHARED role row. THE point of sharing it: if
--          the policy were routed through \`role_id\` instead of
--          \`user_profile_id\`, this row would be visible to BOTH tenants (or to
--          neither), and the assertions below would say so.
INSERT INTO user_role (id, user_profile_id, role_id) VALUES
  (${id(SLOT.userRole)}, ${id(SLOT.member)}, ${lit(SHARED_ROLE)}),
  (${id(SLOT.cascadeRole)}, ${id(SLOT.cascadeMember)}, ${lit(SHARED_ROLE)});

-- ${tag} · the grade chain, eleven rows, ending at ONE grade_revision.
INSERT INTO academic_year (id, tenant_id, school_id, name, start_date, end_date, updated_at)
  VALUES (${id(SLOT.academicYear)}, ${t}, ${s}, ${lit(`Year ${tag}`)}, DATE '2026-09-01', DATE '2027-06-30', now());
INSERT INTO cycle (id, tenant_id, school_id, code, name, order_index)
  VALUES (${id(SLOT.cycle)}, ${t}, ${s}, ${lit(`CYC-${tag}`)}, 'Cycle', 1);
INSERT INTO grade_level (id, tenant_id, school_id, cycle_id, code, name, order_index)
  VALUES (${id(SLOT.gradeLevel)}, ${t}, ${s}, ${id(SLOT.cycle)}, ${lit(`GL-${tag}`)}, 'Level', 1);
INSERT INTO class_section (id, tenant_id, academic_year_id, grade_level_id, name, updated_at)
  VALUES (${id(SLOT.classSection)}, ${t}, ${id(SLOT.academicYear)}, ${id(SLOT.gradeLevel)}, 'Section', now());
INSERT INTO subject (id, tenant_id, school_id, code, name)
  VALUES (${id(SLOT.subject)}, ${t}, ${s}, ${lit(`SUB-${tag}`)}, 'Subject');
INSERT INTO teacher_profile (id, tenant_id, school_id, user_profile_id, updated_at)
  VALUES (${id(SLOT.teacherProfile)}, ${t}, ${s}, ${id(SLOT.teacher)}, now());
INSERT INTO teaching_assignment
    (id, tenant_id, teacher_profile_id, class_section_id, subject_id, academic_year_id, updated_at)
  VALUES (${id(SLOT.teachingAssignment)}, ${t}, ${id(SLOT.teacherProfile)}, ${id(SLOT.classSection)},
          ${id(SLOT.subject)}, ${id(SLOT.academicYear)}, now());
INSERT INTO assessment (id, tenant_id, teaching_assignment_id, teacher_profile_id, title, updated_at)
  VALUES (${id(SLOT.assessment)}, ${t}, ${id(SLOT.teachingAssignment)}, ${id(SLOT.teacherProfile)},
          ${lit(`Assessment ${tag}`)}, now());
INSERT INTO student (id, tenant_id, school_id, first_name, last_name, updated_at)
  VALUES (${id(SLOT.student)}, ${t}, ${s}, 'Student', ${lit(tag)}, now());
INSERT INTO grade (id, tenant_id, assessment_id, student_id, entered_by, updated_at)
  VALUES (${id(SLOT.grade)}, ${t}, ${id(SLOT.assessment)}, ${id(SLOT.student)}, ${id(SLOT.teacher)}, now());
INSERT INTO grade_revision (id, grade_id, reason, revised_by)
  VALUES (${id(SLOT.gradeRevision)}, ${id(SLOT.grade)}, ${lit(`revision ${tag}`)}, ${id(SLOT.teacher)});
`;
}

/** The fixtures. Built by the OWNER, because `app_user` has no grant on `tenant`. */
const FIXTURES_SQL = `
INSERT INTO tenant (id, name, slug, updated_at) VALUES
  (${lit(TENANT_A)}, 'RLS proof tenant A', 'rls-proof-a', now()),
  (${lit(TENANT_B)}, 'RLS proof tenant B', 'rls-proof-b', now());
INSERT INTO school (id, tenant_id, name, school_code, country, updated_at) VALUES
  (${lit(SCHOOL_A)}, ${lit(TENANT_A)}, 'School A', 'RLS-A-1', 'FR', now()),
  (${lit(SCHOOL_B)}, ${lit(TENANT_B)}, 'School B', 'RLS-B-1', 'FR', now()),
  (${lit(SCHOOL_B3)}, ${lit(TENANT_B)}, 'School B3', 'RLS-B-3', 'FR', now());

-- ONE \`role\` row, SHARED by both tenants. \`role\` holds zero rows in the ledger
-- and carries no \`tenant_id\`, so it is reference data — and sharing it is the
-- single most valuable fixture in this file: it is what distinguishes a policy
-- routed through \`user_profile_id\` (correct) from one routed through \`role_id\`
-- (the dead end of ADR-042 §D2).
INSERT INTO role (id, name, slug) VALUES (${lit(SHARED_ROLE)}, 'RLS proof role', 'rls-proof-role');
${derivedFixtures(SLOT_A, TENANT_A, SCHOOL_A, 'A')}
${derivedFixtures(SLOT_B, TENANT_B, SCHOOL_B, 'B')}
`;

/**
 * The row of `child` that belongs to `tenantSlot`.
 *
 * `branding` has no surrogate key: its FOREIGN KEY *is* its primary key, so the
 * row is addressed by the school id. That asymmetry is the reason AC-7 demands a
 * proof on `branding` specifically.
 */
function derivedRowId(table, tenantSlot) {
  if (table.rowSlot === null) return tenantSlot === SLOT_A ? SCHOOL_A : SCHOOL_B;
  return fid(tenantSlot, SLOT[table.rowSlot]);
}

/** One `LABEL|value` step per derived table, for the no-context cases. */
function derivedCountSteps(label) {
  return DERIVED_TABLES.map((d) => `SELECT '${label}_${d.child}|' || count(*) FROM ${d.child};`).join('\n');
}

/**
 * THE PER-TABLE PROOF — positive control FIRST, then the denial, on ALL FIVE.
 *
 * Not "one per FK shape": there is only ONE shape here, and the variation is
 * chain depth. The census counts policies BY NAME and never reads a predicate,
 * so a policy pointing at the wrong parent, or joining `p.id = child.id` instead
 * of `p.id = child.<fk>`, is counted as correct. Four of the five come out of a
 * single `format()` call over a transposable tuple. This is the only mechanism
 * in the repository that reads the predicate.
 */
function derivedVisibilitySteps(ctx, ownSlot, foreignSlot, { totals = false } = {}) {
  return DERIVED_TABLES.map((d) => {
    const own = lit(derivedRowId(d, ownSlot));
    const foreign = lit(derivedRowId(d, foreignSlot));
    const total = totals
      ? `\nSELECT 'CTX_${ctx}_TOTAL_${d.child}|' || count(*) FROM ${d.child};`
      : '';
    return (
      `SELECT 'CTX_${ctx}_D_${d.child}|' || count(*) FROM ${d.child} WHERE ${d.key} = ${own};\n` +
      `SELECT 'CTX_${ctx}_FOREIGN_D_${d.child}|' || count(*) FROM ${d.child} WHERE ${d.key} = ${foreign};` +
      total
    );
  }).join('\n');
}

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
${derivedCountSteps('FRESH_D')}

BEGIN;
SELECT set_config(${lit(TENANT_GUC)}, ${lit(TENANT_A)}, true);
-- (A) THE POSITIVE CONTROL. Without this, everything below passes on a database
--     with no policies and no grants, for the wrong reason.
SELECT 'CTX_A_VISIBLE|' || count(*) FROM school WHERE id = ${lit(SCHOOL_A)};
-- (B) and the foreign tenant's row is gone from the same query.
SELECT 'CTX_A_FOREIGN|' || count(*) FROM school WHERE id = ${lit(SCHOOL_B)};

-- (A2) S-E01-2c — the SAME pair on each of the five tenant-DERIVED tables,
--      read BEFORE any INSERT below can change a total.
${derivedVisibilitySteps('A', SLOT_A, SLOT_B, { totals: true })}

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

-- ===========================================================================
-- S-E01-2c — the FK-path hazards, which have NO ANALOGUE in the 44.
-- ===========================================================================
-- There, a foreign INSERT is caught because the row itself carries the wrong
-- \`tenant_id\`. HERE THE CHILD ROW CARRIES NOTHING TENANT-SHAPED AT ALL: the only
-- thing between a caller and a cross-tenant write is the EXISTS subquery. Proven
-- on TWO shapes — \`branding\`, whose FK IS its primary key, and
-- \`announcement_receipt\`, which has its own surrogate key.

-- (G+) branding: own-tenant parent (School A2, inserted above in this
--      transaction) — the INSERT must SUCCEED.
INSERT INTO branding (school_id, display_name) VALUES (${lit(SCHOOL_A2)}, 'Branding A2');
SELECT 'D_OWN_INSERT_branding|' || count(*) FROM branding WHERE school_id = ${lit(SCHOOL_A2)};
-- (G-) branding: a FOREIGN-tenant parent (School B3, which deliberately has no
--      branding row, so a unique violation cannot stand in for the RLS one).
SAVEPOINT d_branding_foreign;
INSERT INTO branding (school_id, display_name) VALUES (${lit(SCHOOL_B3)}, 'Branding B3');
SELECT 'D_FOREIGN_INSERT_branding_ACCEPTED|1';
ROLLBACK TO SAVEPOINT d_branding_foreign;

-- (H+) announcement_receipt: own-tenant parent — must SUCCEED.
INSERT INTO announcement_receipt (id, announcement_id, user_profile_id)
  VALUES (${lit(RECEIPT_OWN_INSERT)}, ${lit(fid(SLOT_A, SLOT.announcement))}, ${lit(RECEIPT_FOREIGN_READER)});
SELECT 'D_OWN_INSERT_announcement_receipt|' || count(*) FROM announcement_receipt
  WHERE id = ${lit(RECEIPT_OWN_INSERT)};
-- (H-) announcement_receipt: a FOREIGN-tenant parent — must be REFUSED.
SAVEPOINT d_receipt_foreign;
INSERT INTO announcement_receipt (id, announcement_id, user_profile_id)
  VALUES (${lit(RECEIPT_FOREIGN_INSERT)}, ${lit(fid(SLOT_B, SLOT.announcement))}, ${lit(RECEIPT_FOREIGN_READER)});
SELECT 'D_FOREIGN_INSERT_announcement_receipt_ACCEPTED|1';
ROLLBACK TO SAVEPOINT d_receipt_foreign;

-- (I) THE SILENT ONE, on the FK path: a write against a foreign-parent row
--     touches NOTHING and raises NOTHING — USING filters it away before the
--     write is even considered. Code that reads "1 row updated" as success would
--     report success for an update that never happened.
--
--     It is an UPDATE and not a DELETE, and the reason is a MEASUREMENT, not a
--     preference: ADR-042 §D5 gives NO derived table the DELETE privilege, so a
--     DELETE here would fail with \`permission denied\` — LOUD, not silent, and
--     strictly safer. That absence is asserted separately (DERIVED_DELETE = 0);
--     the silent-write hazard is proven with the privilege the table actually
--     holds. \`school\` above still proves the DELETE variant for the 44.
UPDATE announcement_receipt SET read_at = now() WHERE id = ${lit(fid(SLOT_B, SLOT.receipt))};
SELECT 'D_FOREIGN_UPDATE_announcement_receipt|' || count(*) FROM announcement_receipt
  WHERE id = ${lit(fid(SLOT_B, SLOT.receipt))};

-- (J) AC-10 — THE CASCADE, EXECUTED RATHER THAN BELIEVED. \`user_role\` holds no
--     DELETE privilege while \`user_profile -> user_role\` is ON DELETE CASCADE.
--     PostgreSQL runs referential actions as the referencing table's owner with
--     row security off, so it SHOULD still fire — but that is a belief about the
--     engine sitting in a security path. A \`permission denied\` here is a LOUD
--     failure caught by the stderr guard below. Whether the child row is really
--     gone is asserted by the OWNER, for the same reason as (I).
DELETE FROM user_profile WHERE id = ${lit(fid(SLOT_A, SLOT.cascadeMember))};
SELECT 'CASCADE_PARENT_GONE|' || count(*) FROM user_profile
  WHERE id = ${lit(fid(SLOT_A, SLOT.cascadeMember))};
COMMIT;

-- (P) THE POOLED CASE. Same connection, transaction committed, no context set.
--     After a committed \`set_config(…, true)\` the custom GUC is '' — NOT NULL —
--     and a bare \`current_setting(…)::uuid\` raises 22P02 here. This is the
--     second query of every pooled connection in production.
SELECT 'POOLED_IS_NULL|' || (current_setting(${lit(TENANT_GUC)}, true) IS NULL);
SELECT 'POOLED_ROWS|' || count(*) FROM school;
-- …and on each derived table, because a child predicate written without
-- \`nullif\` raises 22P02 only on the CHILD: the \`school\`-only assertion above
-- would not see it.
${derivedCountSteps('POOLED_D')}

-- (Q) the empty string set EXPLICITLY, same requirement.
SET ${TENANT_GUC} = '';
SELECT 'EMPTY_ROWS|' || count(*) FROM school;
${derivedCountSteps('EMPTY_D')}

-- (R) switch context: B's row must REAPPEAR, and it must still exist despite (F).
BEGIN;
SELECT set_config(${lit(TENANT_GUC)}, ${lit(TENANT_B)}, true);
SELECT 'CTX_B_VISIBLE|' || count(*) FROM school WHERE id = ${lit(SCHOOL_B)};
SELECT 'CTX_B_FOREIGN|' || count(*) FROM school WHERE id = ${lit(SCHOOL_A)};
${derivedVisibilitySteps('B', SLOT_B, SLOT_A)}
COMMIT;
`;

/**
 * PF-185 — `outbox_event` is fail-closed, and here (and ONLY here) `permission
 * denied` is the EXPECTED result.
 *
 * It runs as its OWN `psql` invocation, deliberately: the main proof treats that
 * string anywhere in its stderr as a loud failure, and it must keep doing so.
 * Mixing the two would either weaken that guard or make this one unreadable.
 */
const OUTBOX_SQL = `
\\pset footer off
SELECT 'OUTBOX_PROBE|start';
SELECT 'OUTBOX_SELECT_ACCEPTED|' || count(*) FROM ${OUTBOX_TABLE};
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
-- The two facts the tenant-scoped connection CANNOT observe about itself: a row
-- it cannot see is indistinguishable from a row it deleted.
SELECT 'OWNER_FOREIGN_RECEIPT|' || count(*) FROM announcement_receipt
  WHERE id = ${lit(fid(SLOT_B, SLOT.receipt))};
SELECT 'OWNER_FOREIGN_RECEIPT_UNTOUCHED|' || count(*) FROM announcement_receipt
  WHERE id = ${lit(fid(SLOT_B, SLOT.receipt))} AND read_at IS NULL;
SELECT 'OWNER_CASCADE_CHILD|' || count(*) FROM user_role
  WHERE id = ${lit(fid(SLOT_A, SLOT.cascadeRole))};
SELECT 'OWNER_CASCADE_CONTROL|' || count(*) FROM user_role
  WHERE id = ${lit(fid(SLOT_B, SLOT.cascadeRole))};
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
          AND privilege_type NOT IN ('SELECT', 'INSERT');

       -- ===================================================================
       -- S-E01-2c — the tenant-DERIVED half. STRUCTURE ONLY: not one of the
       -- queries below asks whether a policy exists, and none reads a frozen
       -- list. That is the whole value of the agreement (ADR-042 §D3).
       -- ===================================================================
       SELECT 'DERIVED_EXPECTED|' || count(*) FROM (SELECT DISTINCT child FROM (${DERIVED_SET_SQL}) s) d;
       SELECT 'DERIVED_NAMES|' || coalesce(string_agg(child, ',' ORDER BY child), '')
         FROM (SELECT DISTINCT child FROM (${DERIVED_SET_SQL}) s) d;
       -- AC-5b: everything with no tenant_id that the derivation does NOT reach.
       SELECT 'RESIDUE_NAMES|' || coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '')
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'
          AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
                            AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped)
          AND c.relname NOT IN (SELECT DISTINCT child FROM (${DERIVED_SET_SQL}) s);
       -- AC-3: an index whose LEADING column is the FK column, on every derived
       -- table. Without it an FK-path policy is a sequential scan per row read.
       SELECT 'DERIVED_FK_INDEX_MISSING|' || count(*) FROM (${DERIVED_SET_SQL}) d
        WHERE NOT EXISTS (SELECT 1 FROM pg_index x
                           WHERE x.indrelid=d.child_oid AND x.indkey[0]=d.fk_attnum);
       -- AC-5c: a policy expression runs AS THE CALLING USER, so every parent
       -- named in a derived policy must stay SELECT-able by that user, or every
       -- derived read fails with \`permission denied\` raised from inside a policy.
       SELECT 'DERIVED_PARENTS|' || count(*) FROM (SELECT DISTINCT parent FROM (${DERIVED_SET_SQL}) s) p;
       SELECT 'PARENT_SELECT_MISSING|' || count(*)
         FROM (SELECT DISTINCT parent FROM (${DERIVED_SET_SQL}) s) p
        WHERE NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g
                           WHERE g.grantee=${lit(app.user)} AND g.table_schema='public'
                             AND g.table_name=p.parent AND g.privilege_type='SELECT');
       -- The per-table privilege SHAPE. The count agreement sees table COUNT and
       -- never privilege shape — the numbers are identical either way.
       SELECT 'DERIVED_GRANTS|' || coalesce(string_agg(entry, ';' ORDER BY entry), '') FROM (
         SELECT g.table_name || '=' || string_agg(g.privilege_type, ', ' ORDER BY g.privilege_type) AS entry
           FROM information_schema.role_table_grants g
          WHERE g.grantee=${lit(app.user)} AND g.table_schema='public'
            AND g.table_name IN (SELECT DISTINCT child FROM (${DERIVED_SET_SQL}) s)
          GROUP BY g.table_name) e;
       -- ADR-042 §D5 — NONE of the derived tables receives DELETE. Asserted as a
       -- count so a widening shows up even if a name is added to the tuple.
       SELECT 'DERIVED_DELETE|' || count(*) FROM information_schema.role_table_grants g
        WHERE g.grantee=${lit(app.user)} AND g.table_schema='public' AND g.privilege_type='DELETE'
          AND g.table_name IN (SELECT DISTINCT child FROM (${DERIVED_SET_SQL}) s);
       -- G-AUDIT — grade_revision reaches app_user AT ALL (else the next line is
       -- vacuously green), and nothing beyond SELECT/INSERT reaches it.
       SELECT 'GRADE_REVISION_REACHED|' || count(DISTINCT table_name)
         FROM information_schema.role_table_grants
        WHERE grantee=${lit(app.user)} AND table_schema='public'
          AND table_name IN (${APPEND_ONLY_DERIVED.map(lit).join(', ')});
       SELECT 'GRADE_REVISION_WRITE|' || count(*) FROM information_schema.role_table_grants
        WHERE grantee=${lit(app.user)} AND table_schema='public'
          AND table_name IN (${APPEND_ONLY_DERIVED.map(lit).join(', ')})
          AND privilege_type NOT IN ('SELECT', 'INSERT');
       -- USING and WITH CHECK must be IDENTICAL, not merely both present.
       -- WITH_CHECK_NULL only catches the omitted half.
       SELECT 'QUAL_MISMATCH|' || count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND p.polname=${lit(POLICY_NAME)}
          AND pg_get_expr(p.polqual, p.polrelid)
              IS DISTINCT FROM pg_get_expr(p.polwithcheck, p.polrelid);
       -- PF-185 — outbox_event: no policy, no RLS, no grant. Proven by execution
       -- separately; these three are the catalog half.
       SELECT 'OUTBOX_POLICIES|' || count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=${lit(OUTBOX_TABLE)};
       SELECT 'OUTBOX_RLS|' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=${lit(OUTBOX_TABLE)} AND c.relrowsecurity;
       SELECT 'OUTBOX_GRANTS|' || count(*) FROM information_schema.role_table_grants
        WHERE grantee=${lit(app.user)} AND table_schema='public' AND table_name=${lit(OUTBOX_TABLE)};
       -- Present in every real database, absent from this scratch one: the
       -- ledger is applied here file by file with psql, and Prisma's CLI — not
       -- the SQL — creates this table. Measured rather than assumed.
       SELECT 'LEDGER_TABLE|' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND c.relname=${lit(LEDGER_TABLE)};`,
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
    // ---- 5b. THE DERIVED HALF (S-E01-2c). The right-hand side of every
    //          agreement below is TENANT_COLS + DERIVED_EXPECTED, and both terms
    //          are catalog-computed. No literal 49 appears anywhere in this file.
    const derivedExpected = Number(c.get('DERIVED_EXPECTED'));
    if (!Number.isFinite(derivedExpected) || derivedExpected < 1) {
      fail(
        'the schema carries tenant-DERIVED tables',
        `DERIVED_EXPECTED = ${c.get('DERIVED_EXPECTED')} — a zero here would make every ` +
          'agreement below collapse back to the pre-S-E01-2c form and pass vacuously',
      );
      return;
    }
    const policiedExpected = tenantCols + derivedExpected;
    record(
      'AC-5 the census is an AGREEMENT: expected = tenant-scoped + tenant-DERIVED, both catalog-computed',
      `${tenantCols} + ${derivedExpected} (never written as a literal)`,
    );

    // The frozen tuple in this file NAMES the tables the per-table proof runs
    // against; it must not be allowed to drift away from the catalog. Set
    // equality in both directions — one direction would let the dangerous half
    // (a derived table nobody proves) through.
    expectSetEqual(
      'AC-5 the derived set measured from pg_constraint equals the set this check proves',
      names(c.get('DERIVED_NAMES')),
      DERIVED_TABLES.map((d) => d.child),
    );
    // AC-5b — the one-level derivation leaves a hole (a child OF a derived
    // table). Naming the residue is what turns that hole into a failure.
    //
    // `_prisma_migrations` is in the named six but is NOT in this scratch
    // database: the ledger is applied here file by file with `psql`, and
    // Prisma's CLI — not the SQL — creates that table. Its presence is MEASURED,
    // never assumed, and the branch taken is printed, so the day the harness
    // switches to `prisma migrate deploy` the expectation follows without anyone
    // having to remember this paragraph.
    const ledgerTablePresent = Number(c.get('LEDGER_TABLE')) === 1;
    record(
      `AC-5b the ledger table ${LEDGER_TABLE} is ${ledgerTablePresent ? 'PRESENT' : 'ABSENT'} in the scratch database`,
      ledgerTablePresent
        ? 'the harness applied the ledger through Prisma; it counts in the residue'
        : 'the harness applied the ledger with psql, which does not create it; excluded from the residue',
    );
    expectSetEqual(
      `AC-5b the tables with no tenant_id outside the derived set are exactly the NAMED ones ` +
        '(each with its reason in the source — never a glob, and never a set that SUBTRACTS from the agreement)',
      names(c.get('RESIDUE_NAMES')),
      NON_DERIVED_EXPECTED.filter((name) => name !== LEDGER_TABLE || ledgerTablePresent),
    );

    expectEqual(
      'every tenant-scoped OR tenant-derived table has ROW LEVEL SECURITY enabled',
      c.get('RLS_ON'),
      policiedExpected,
    );
    expectEqual(
      `every tenant-scoped OR tenant-derived table carries a ${POLICY_NAME} policy`,
      c.get('POLICIES'),
      policiedExpected,
    );
    expectEqual(
      `${app.user} is granted exactly the policied tables`,
      c.get('GRANTED'),
      policiedExpected,
    );
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

    // ---- 5c. The derived tables' SHAPE: index, parents, privileges, predicate.
    expectEqual(
      'AC-3 every derived table has an index whose LEADING column is its FK column (R-11)',
      c.get('DERIVED_FK_INDEX_MISSING'),
      0,
    );
    // Reached FIRST: "no parent is missing SELECT" is vacuously green over an
    // empty parent set.
    expectEqual(
      'AC-5c the derived policies name parents at all',
      c.get('DERIVED_PARENTS'),
      new Set(DERIVED_TABLES.map((d) => d.parent)).size,
    );
    expectEqual(
      `AC-5c every parent named in a derived policy is still SELECT-able by ${app.user} ` +
        '(a narrowed parent grant makes every derived read fail from INSIDE a policy)',
      c.get('PARENT_SELECT_MISSING'),
      0,
    );
    // ADR-042 §D5 — measured: no delete caller exists for any of the five.
    expectEqual(
      'AC-4 no tenant-derived table grants DELETE (ADR-042 §D5 — a privilege with no caller is pure blast radius)',
      c.get('DERIVED_DELETE'),
      0,
    );
    // G-AUDIT. Reachability first, for the same reason as the append-only pair.
    expectEqual(
      `G-AUDIT ${app.user} reaches ${APPEND_ONLY_DERIVED.join(', ')} at all`,
      c.get('GRADE_REVISION_REACHED'),
      APPEND_ONLY_DERIVED.length,
    );
    expectEqual(
      'G-AUDIT grade_revision grants nothing beyond SELECT/INSERT — it is the grade audit trail, ' +
        'and unlike audit_log it carries no hash chain, so a rewrite would leave nothing behind',
      c.get('GRADE_REVISION_WRITE'),
      0,
    );
    // The privilege SHAPE, per table, in both directions: every derived table is
    // granted, and each holds exactly the string ADR-042 §D5 decided.
    expectSetEqual(
      'AC-4 each derived table holds exactly its decided privilege string, drawn from the closed set ' +
        `of ${DERIVED_PRIVILEGE_SETS.length} (${DERIVED_PRIVILEGE_SETS.join(' | ')})`,
      String(c.get('DERIVED_GRANTS') ?? '')
        .split(';')
        .map((entry) => canonicalGrant(entry.trim()))
        .filter((entry) => entry !== ''),
      DERIVED_TABLES.map((d) => canonicalGrant(`${d.child}=${d.privileges}`)),
    );
    // WITH_CHECK_NULL only catches the OMITTED half. Two expressions can both be
    // present and say different things — and on an FK-path policy that is a
    // readable row that cannot be written, or worse, the reverse.
    expectEqual(
      'AC-2 every tenant_isolation policy declares USING and WITH CHECK IDENTICALLY, not merely both',
      c.get('QUAL_MISMATCH'),
      0,
    );
    // PF-185 — the catalog half. The execution half is step 7b.
    expectEqual(
      `PF-185 ${OUTBOX_TABLE} carries NO policy (no FK, no discriminant — not derivable; ADR-042 §D7)`,
      c.get('OUTBOX_POLICIES'),
      0,
    );
    expectEqual(`PF-185 ${OUTBOX_TABLE} has relrowsecurity = false`, c.get('OUTBOX_RLS'), 0);
    expectEqual(
      `PF-185 ${OUTBOX_TABLE} is granted NOTHING to ${app.user} — fail-closed by DECISION, ` +
        'never to be "fixed" by widening the grant',
      c.get('OUTBOX_GRANTS'),
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

    // ---- S-E01-2c: the same pair on ALL FIVE derived tables, positive control
    //      FIRST. `app_user` held ZERO privileges on these five before this
    //      migration, so a proof showing only ABSENCE would have been green on a
    //      database with no policies at all — for entirely the wrong reason.
    for (const d of DERIVED_TABLES) {
      expectEqual(
        `AC-6  POSITIVE CONTROL: GUC = tenant A, the ${d.child} row (via ${d.parent}.${d.fk}) IS VISIBLE`,
        f.get(`CTX_A_D_${d.child}`),
        1,
      );
      expectEqual(
        `AC-6  GUC = tenant A: tenant B's ${d.child} row is NOT visible`,
        f.get(`CTX_A_FOREIGN_D_${d.child}`),
        0,
      );
      expectEqual(
        `AC-6  GUC = tenant A: ${d.child} shows tenant A's rows and ONLY those`,
        f.get(`CTX_A_TOTAL_${d.child}`),
        d.expectedRows,
      );
      expectEqual(
        `AC-6  a fresh connection with NO tenant context sees zero ${d.child} rows`,
        f.get(`FRESH_D_${d.child}`),
        0,
      );
    }

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

    // ---- AC-7 — the FK-path write hazards, which have NO analogue in the 44:
    //      the child row carries nothing tenant-shaped, so the EXISTS subquery
    //      is the ONLY thing between a caller and a cross-tenant write. Two
    //      shapes: `branding` (its FK IS its primary key) and
    //      `announcement_receipt` (its own surrogate key).
    for (const child of ['branding', 'announcement_receipt']) {
      expectEqual(
        `AC-7 POSITIVE CONTROL: an INSERT into ${child} whose PARENT is own-tenant is accepted`,
        f.get(`D_OWN_INSERT_${child}`),
        1,
      );
      if (f.has(`D_FOREIGN_INSERT_${child}_ACCEPTED`)) {
        fail(
          `AC-7 an INSERT into ${child} whose PARENT belongs to a foreign tenant is REJECTED`,
          'the foreign-parent INSERT was ACCEPTED — the WITH CHECK subquery is not doing its job',
        );
      } else if (/violates row-level security policy/i.test(proof.stderr)) {
        record(`AC-7 an INSERT into ${child} whose PARENT belongs to a foreign tenant is REJECTED by WITH CHECK`);
      } else {
        fail(
          `AC-7 an INSERT into ${child} whose PARENT belongs to a foreign tenant is REJECTED`,
          `no RLS violation was reported:\n${proof.stderr.trim()}`,
        );
      }
    }
    expectEqual(
      'AC-7 the SILENT one on the FK path: a write against a foreign-parent row raises nothing (and, per ' +
        'the owner below, changed nothing)',
      f.get('D_FOREIGN_UPDATE_announcement_receipt'),
      0,
    );
    // AC-10 — the cascade. The parent really went; whether the CHILD went is a
    // question only the owner can answer, and it is asked below.
    expectEqual(
      'AC-10 the parent user_profile was really deleted by app_user under GUC = tenant A',
      f.get('CASCADE_PARENT_GONE'),
      0,
    );

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

    // Both no-context cases on EVERY derived table: a child predicate written
    // without `nullif` raises 22P02 only on the CHILD, so the `school`-only
    // assertions above would not see it.
    for (const d of DERIVED_TABLES) {
      expectEqual(
        `F-1 the SAME connection, after COMMIT, with no context: zero ${d.child} rows AND NO ERROR`,
        f.get(`POOLED_D_${d.child}`),
        0,
      );
      expectEqual(
        `AC-6  an explicitly EMPTY tenant context sees zero ${d.child} rows and raises nothing`,
        f.get(`EMPTY_D_${d.child}`),
        0,
      );
      expectEqual(
        `AC-6  switching the GUC to tenant B makes B's ${d.child} row reappear`,
        f.get(`CTX_B_D_${d.child}`),
        1,
      );
      expectEqual(
        `AC-6  GUC = tenant B: tenant A's ${d.child} row is NOT visible`,
        f.get(`CTX_B_FOREIGN_D_${d.child}`),
        0,
      );
    }

    // A 22P02 anywhere would mean the predicate is the bare cast form.
    if (/invalid input syntax for type uuid/i.test(proof.stderr)) {
      fail(
        'F-1 no connection ever raises 22P02 on the tenant GUC',
        'the predicate is missing nullif(…, \'\') — see the migration header:\n' + proof.stderr.trim(),
      );
    } else {
      record('F-1 no connection raised 22P02 on the tenant GUC');
    }

    // ---- 7b. PF-185 — `outbox_event` proven FAIL-CLOSED, by execution.
    //
    // This is the ONE place in this file where `permission denied` is the
    // EXPECTED result, and it runs as its own psql invocation so that the guard
    // above — which treats that string as a loud failure everywhere else — keeps
    // its meaning. `outbox_event` holds no foreign key and no discriminant, so
    // there is no path to write a policy over; isolating it needs a denormalised
    // column plus a backfill, which is a schema.prisma change and its own slice
    // (ADR-042 §D7). Measured: `outboxEvent.` has ZERO callers in apps/** and
    // packages/**, so the cost of leaving it fail-closed is zero features.
    //
    // THE POINT OF THIS ASSERTION is to stop the next run from "fixing" the
    // permission error at the call site by widening the grant.
    const outboxRun = psql(client.command, scratchApp, OUTBOX_SQL, { onErrorStop: false });
    const ob = facts(outboxRun);
    if (!ob.has('OUTBOX_PROBE')) {
      fail(
        `PF-185 the ${OUTBOX_TABLE} probe reached the server at all`,
        `nothing came back — the absence below would be meaningless:\n${outboxRun.stderr.trim()}`,
      );
    } else if (ob.has('OUTBOX_SELECT_ACCEPTED')) {
      fail(
        `PF-185 a SELECT on ${OUTBOX_TABLE} as ${app.user} is REFUSED`,
        `it was ACCEPTED (${ob.get('OUTBOX_SELECT_ACCEPTED')} rows). The table has NO policy, so a grant ` +
          'here is an unfiltered cross-tenant read. Fix the policy, never the grant.',
      );
    } else if (/permission denied/i.test(outboxRun.stderr)) {
      record(
        `PF-185 ${OUTBOX_TABLE} is FAIL-CLOSED by execution: "permission denied" for ${app.user}`,
        'expected HERE and only here — no FK, no discriminant, deferred by name (ADR-042 §D7)',
      );
    } else {
      fail(
        `PF-185 a SELECT on ${OUTBOX_TABLE} as ${app.user} is REFUSED with "permission denied"`,
        `it failed for a DIFFERENT reason, which proves nothing about the grant:\n${outboxRun.stderr.trim()}`,
      );
    }

    // ---- 8. AC-8 — the recorded LIMIT. Named so nobody reads it as a defect.
    const ownerRun = psql(client.command, scratchOwner, OWNER_SQL);
    if (ownerRun.status !== 0) {
      throw new ToolingUnavailable(`the owner-visibility case failed to run: ${ownerRun.stderr.trim()}`);
    }
    const o = facts(ownerRun);
    // 4 rows: three fixtures (A, B, and B3 — the school AC-7's foreign-parent
    // INSERT aims at) plus the own-tenant INSERT the proof committed.
    expectEqual(
      'AC-8 THE DELIBERATE LIMIT: the OWNER sees every tenant with NO context (RLS is ENABLED, not FORCED)',
      o.get('OWNER_NO_CTX'),
      4,
    );
    expectEqual(
      'AC-8 THE DELIBERATE LIMIT: the OWNER still sees every tenant WITH a context — this is why the app is NOT isolated yet',
      o.get('OWNER_CTX_A'),
      4,
    );
    // The two facts the tenant-scoped connection cannot observe about itself.
    expectEqual(
      "AC-7 the foreign-parent write reached NOTHING — the owner still sees tenant B's receipt",
      o.get('OWNER_FOREIGN_RECEIPT'),
      1,
    );
    expectEqual(
      "AC-7 …and it is UNCHANGED: read_at is still NULL, so the silent UPDATE really did nothing",
      o.get('OWNER_FOREIGN_RECEIPT_UNTOUCHED'),
      1,
    );
    // AC-10 — MEASURED, not believed. If this ever reads 1, the correct fix is
    // to add DELETE to user_role's privilege string in the migration WITH the
    // measured reason written in, never to delete this assertion.
    expectEqual(
      'AC-10 the ON DELETE CASCADE from user_profile removed the user_role row even though ' +
        'user_role grants no DELETE (referential actions run as the table owner, row security off)',
      o.get('OWNER_CASCADE_CHILD'),
      0,
    );
    expectEqual(
      "AC-10 CONTROL: tenant B's user_role row, whose parent was never deleted, is untouched",
      o.get('OWNER_CASCADE_CONTROL'),
      1,
    );

    // ---- 9. AC-12 — the rollback is EXECUTED, not merely written in a header.
    //
    //         S-E01-2c: the block below iterates every table carrying
    //         `relrowsecurity`, so it SHOULD pick the five derived tables up for
    //         free. That is a prediction, and AC-11 requires it VERIFIED — hence
    //         `ROLLBACK_TOUCHED`, counted inside the loop and asserted equal to
    //         the enlarged expectation, and `AFTER_GRANTS`, because the enlarged
    //         privilege sets are only reversed if the REVOKE reaches them too.
    const rollback = psql(
      client.command,
      scratchOwner,
      `DO $rollback$
       DECLARE
         t text;
         touched integer := 0;
       BEGIN
         FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity LOOP
           EXECUTE format('DROP POLICY IF EXISTS ${POLICY_NAME} ON public.%I', t);
           EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
           EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.%I FROM ${app.user}', t);
           touched := touched + 1;
         END LOOP;
         REVOKE USAGE ON SCHEMA public FROM ${app.user};
         CREATE TEMP TABLE rollback_witness AS SELECT touched AS touched;
       END
       $rollback$;
       SELECT 'ROLLBACK_TOUCHED|' || touched FROM rollback_witness;
       SELECT 'AFTER_POLICIES|' || count(*) FROM pg_policy p WHERE p.polname = ${lit(POLICY_NAME)};
       SELECT 'AFTER_RLS|' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relrowsecurity;
       SELECT 'AFTER_GRANTS|' || count(DISTINCT table_name) FROM information_schema.role_table_grants
        WHERE grantee=${lit(app.user)} AND table_schema='public';`,
    );
    if (rollback.status !== 0) {
      fail('AC-12 the stated rollback executes', rollback.stderr.trim());
    } else {
      const r = facts(rollback);
      expectEqual(
        'AC-11 the generic rollback really reaches the enlarged set (tenant-scoped + tenant-DERIVED), verified not assumed',
        r.get('ROLLBACK_TOUCHED'),
        policiedExpected,
      );
      expectEqual('AC-12 the rollback removes every policy', r.get('AFTER_POLICIES'), 0);
      expectEqual('AC-12 the rollback returns relrowsecurity to false', r.get('AFTER_RLS'), 0);
      expectEqual(
        'AC-11 the rollback also revokes the enlarged privilege sets — nothing is left granted',
        r.get('AFTER_GRANTS'),
        0,
      );
    }
  } finally {
    // ---- 10. Leave the server clean. Its own verdict, never swallowed, and it
    //          never downgrades an isolation verdict into a tooling one.
    //
    //          MEASURED (this run, twice in eight): `WITH (FORCE)` signals every
    //          other backend on the database and then waits FIVE SECONDS; a
    //          backend still attached after that makes the DROP error, the run
    //          exits 2, and a scratch database is left on the server — which a
    //          `psql -l` finds long after the log line that claimed otherwise.
    //          One retry, after explicitly terminating what is still attached,
    //          closes it. This changes NO verdict: the drop is CLEANUP, never
    //          evidence, and a still-failing drop is still a failure below.
    const dropSql = `DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE);`;
    let dropped = psql(client.command, maintenance, dropSql);
    if (dropped.status !== 0) {
      psql(
        client.command,
        maintenance,
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${lit(scratchName)};`,
      );
      dropped = psql(client.command, maintenance, dropSql);
    }
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
  APPEND_ONLY_DERIVED,
  APPEND_ONLY_TABLES,
  APP_DATABASE_URL_VAR,
  DERIVED_PRIVILEGE_SETS,
  DERIVED_TABLES,
  MIN_EXPECTED_TABLES,
  NON_DERIVED_EXPECTED,
  OUTBOX_TABLE,
  POLICY_NAME,
  SCRATCH_NAME_PATTERN,
  TENANT_A,
  TENANT_B,
  TENANT_GUC,
  VERDICT_EXIT_CODES,
  fid,
  isLoopbackHost,
  lit,
  migrationFiles,
  redact,
};
