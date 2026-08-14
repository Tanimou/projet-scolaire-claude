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
 * WHAT S-E01-2d CHANGED, AND THE ASSERTIONS THAT FLIPPED
 * ------------------------------------------------------
 * `outbox_event` USED TO BE the sixth table without a `tenant_id`, and it holds
 * NO foreign key at all — polymorphic, unconstrained — so it was not derivable,
 * stayed ungranted and unpolicied, and was PROVEN fail-closed by execution here
 * (PF-185). It was the only place in this file where `permission denied` was the
 * EXPECTED result. THAT IS OVER. It now carries a DENORMALISED `tenant_id`
 * (ADR-044), so it is an ordinary tenant-SCOPED table: it counts inside
 * `TENANT_COLS`, it is NOT in the residue, and a `permission denied` on it is
 * once again a LOUD failure like everywhere else. It never became derivable — it
 * stopped needing to be.
 *
 * READ THIS BEFORE "SIMPLIFYING" THE OUTBOX ASSERTIONS AWAY: they did not
 * disappear, they INVERTED. Deleting them instead would remove the only thing
 * that notices the column, the policy or the grant being dropped out of band —
 * and the drift gate cannot see two of those three.
 *
 * WHAT S-E01-1b CHANGED — THE DERIVATION IS NOW TRANSITIVELY CLOSED
 * ----------------------------------------------------------------
 * S-E01-2c's derivation was ONE LEVEL DEEP and said so. That was survivable only
 * while no derived table had a child of its own. `S-E01-1b` materialises
 * `role_school_id_fkey`, so `role` ENTERS the derived set — exactly as the
 * comment on `NON_DERIVED_EXPECTED` predicted it would — and the moment it does,
 * `role_permission` becomes the TWO-LEVEL residue that a one-level derivation
 * cannot see. It was MEASURED as a real cross-tenant read (`A_SEES_B_ROLEPERM|1`
 * under a bare grant), so the derivation below became a RECURSIVE CTE. No
 * literal moved; the closure did the work.
 *
 * And a THIRD catalog-derived term joined the agreement: the AUTO-DISCRIMINANT
 * tables — the parents of every foreign key whose LEADING child column is named
 * `tenant_id`. Measured: exactly `{tenant}`. `tenant` is neither tenant-scoped
 * (its discriminant is its own primary key) nor tenant-derived (it has no FK
 * out), so before this slice it sat in the residue. It is now policied, so it
 * must count — and it counts through a CATALOG QUERY, never through a literal 1.
 *
 * The remaining residue is therefore exactly `{permission, _prisma_migrations}`,
 * and both are GENUINELY global: `permission` carries `id/code/label/
 * resource_type/action/description` — no discriminant, no FK to one.
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
    // `user_role` holds a SECOND foreign key, `role_id -> role`. Since
    // `S-E01-1b` that edge is no longer a DEAD END for the DERIVATION — `role`
    // is tenant-derived now — but it is still not the POLICY path, and the
    // reason changed rather than disappeared: a SYSTEM role (`school_id IS
    // NULL`) is visible to everyone, so routing `user_role` through `role_id`
    // would make every assignment to a system role visible to every tenant.
    // The tenant path is `user_profile_id`, never `role_id` (ADR-042 §D2, as
    // amended by ADR-046 §D2).
    child: 'user_role',
    fk: 'user_profile_id',
    parent: 'user_profile',
    key: 'id',
    rowSlot: 'userRole',
    // two: the member's assignment, and the one AC-10's cascade will remove.
    expectedRows: 2,
    privileges: 'SELECT, INSERT, UPDATE',
  }),
  Object.freeze({
    // S-E01-1b — the table this slice DRAGS into the derived set by giving it
    // the foreign key it never had. Its FK is NULLABLE, which is the whole
    // reason it was missed: `school_id IS NULL` means SYSTEM role, global
    // reference data by design (ADR-015), and the predicate admits it
    // explicitly. See ADR-046 §D3 for why that `IS NULL OR` is not the DNC-10
    // fail-open shape.
    child: 'role',
    fk: 'school_id',
    parent: 'school',
    key: 'id',
    rowSlot: 'customRole',
    // two under a context: the tenant's own custom role, and the SHARED system
    // role, which is visible under every context AND under none.
    expectedRows: 2,
    privileges: 'SELECT',
    // …which is why this table is the FIRST in this file whose no-context count
    // is not zero. Written as a MEASURED number per table, never as a relaxed
    // assertion: the day the system role stops being visible without a context,
    // every portal loses its seeded roles and this line goes red.
    noContextRows: 1,
  }),
  Object.freeze({
    // S-E01-1b / C-1 — the TWO-LEVEL residue. Nothing saw it until the
    // derivation was closed transitively, and a bare grant on it was MEASURED
    // to leak tenant B's custom-role privilege composition to tenant A.
    child: 'role_permission',
    fk: 'role_id',
    parent: 'role',
    // Addressed by its FK, not by a surrogate key — it has none (its PRIMARY KEY
    // is `(role_id, permission_id)`), which is a third key shape after
    // `branding`'s FK-as-PK and the surrogate-keyed four.
    key: 'role_id',
    rowSlot: 'customRole',
    expectedRows: 2,
    privileges: 'SELECT',
    noContextRows: 1,
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
const DERIVED_PRIVILEGE_SETS = Object.freeze([
  // S-E01-1b / ADR-046 §D5 — `SELECT` ALONE joins the closed set, and the reason
  // is written beside it because a THIRD string in a closed set looks like a
  // widening and is the opposite: `role` and `role_permission` are PRIVILEGE
  // data. A role that can rewrite `role_permission` can grant itself every
  // permission in the schema, so this slice gives them READ only. That is a
  // scope statement for THIS slice, not a claim that the app never writes them —
  // `roles.controller.ts` does, and the write path is deferred as PF-193.
  'SELECT',
  'SELECT, INSERT',
  'SELECT, INSERT, UPDATE',
]);

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
 * The base tables in `public` that carry no `tenant_id`, that the (now
 * transitively closed) derivation does not reach, and that are not
 * AUTO-DISCRIMINANT, must be EXACTLY these two. A new table landing here FAILS
 * the gate, printing its name, until someone names it and says why.
 *
 * This set NEVER subtracts from the policy agreement. It is a partition check,
 * not an exemption list.
 *
 * S-E01-1b — THREE NAMES LEFT THIS LIST, AND NOT ONE OF THEM BY DELETION:
 *   • `role`            — it now HAS `role_school_id_fkey`, so the derivation
 *                         RETURNS it. The comment that used to stand here
 *                         predicted exactly this ("the day ADR-015 custom roles
 *                         add `role_school_id_fkey`, `role` correctly ENTERS the
 *                         derived set"). It was right, and PF-191 records that
 *                         classifying it as globally scoped was wrong.
 *   • `role_permission` — the derivation is now TRANSITIVELY closed, so it is
 *                         reached through `role`. Under a one-level derivation
 *                         plus a bare grant it was a MEASURED cross-tenant read.
 *   • `tenant`          — it is AUTO-DISCRIMINANT (its primary key IS the
 *                         discriminant) and is counted by its own catalog term
 *                         below, never by a literal. The reason it used to be
 *                         excluded — "the identity seam must read `tenant` BY
 *                         SLUG before any tenant is resolved" — was MEASURED
 *                         FALSE after S-E01-1a: there is no by-slug read left in
 *                         `apps/api/src` (ADR-046 §D4).
 *
 * Removing any of those names WITHOUT shipping the structure would fail here
 * with the name printed, in both directions. That is the whole point.
 */
const NON_DERIVED_EXPECTED = Object.freeze([
  // the migration ledger — not tenant data. Granted SELECT anyway: `main.ts`
  // reads it at boot and `health.controller.ts` on every probe.
  '_prisma_migrations',
  // GENUINELY global (ADR-046 §D5): `id`, `code`, `label`, `resource_type`,
  // `action`, `description` — no discriminant, and no FK to a table with one.
  // Unlike `role`, this classification was MEASURED rather than inherited.
  'permission',
]);
// S-E01-2d: `outbox_event` LEFT this list. It did not leave because someone
// deleted a name — it left because it now HAS a `tenant_id`, so the residue
// query (base tables with no `tenant_id` outside the derived set) no longer
// returns it. The set equality is measured against the catalog in BOTH
// directions, so removing the name without shipping the column would fail here
// with the name printed, which is the whole point of a residue check.

/**
 * S-E01-1b — THE REFERENCE SURFACE: everything `app_user` may READ that is NOT
 * one of the policied tables.
 *
 * Before this slice the census asserted `GRANTED == policiedExpected` — "the
 * app role is granted exactly the policied tables". That equality is what makes
 * `GRANT … ON ALL TABLES IN SCHEMA public` impossible to ship, and it must NEVER
 * be relaxed to an inequality: doing so would delete the only protection against
 * handing out every unpolicied table in one line.
 *
 * The connection cutover needs `app_user` to complete
 * `user_profile -> user_role -> role -> role_permission -> permission`, and
 * `permission` will never carry a policy because it has no tenant to filter by.
 * So the invariant is RESTATED, not weakened:
 *
 *     GRANTED == POLICIED ∪ REFERENCE_SURFACE
 *
 * — a NAMED set, both directions, plus a second assertion that every table in it
 * holds EXACTLY `SELECT` and nothing more.
 *
 * `_prisma_migrations` is in the set and is ABSENT from the scratch database
 * (see `LEDGER_TABLE`), so it is expected only on the branch where it exists,
 * and the branch taken is printed.
 */
const REFERENCE_SURFACE = Object.freeze(['_prisma_migrations', 'permission']);

/** The privilege every reference-surface table holds, and the only one. */
const REFERENCE_PRIVILEGES = 'SELECT';

/**
 * S-E01-1b / ADR-046 §D5 — the privilege the AUTO-DISCRIMINANT table holds, and
 * the only one.
 *
 * Kept as its OWN constant rather than folded into `REFERENCE_PRIVILEGES`,
 * because the two name different things and a reader who conflates them will
 * widen the wrong one: the reference surface is UNPOLICIED by nature
 * (`permission` has no tenant to filter by), whereas `tenant` IS policied — its
 * primary key is the discriminant, so `id = <GUC>` is a real predicate. They
 * happen to agree on the string today; the day one of them widens, the diff must
 * show WHICH.
 *
 * Exported because `scripts/tenant-adversarial-check.js` asserts the same
 * privilege matrix by set equality, and two literals for one grant is exactly
 * the drift `ADR-042 §D3` forbids.
 */
const AUTO_DISCRIMINANT_PRIVILEGES = 'SELECT';

/**
 * PF-185, CLOSED by S-E01-2d. This table has no foreign key and no derivable
 * path, so it was deferred by name and left fail-closed (ADR-042 §D7). It now
 * carries a DENORMALISED `tenant_id` (ADR-044) and is proven ISOLATED here, on
 * the same terms as the other 44: positive control first, then the denial.
 *
 * It keeps its own constant because every assertion about it is a NAMED one:
 * this is the table a future run is most tempted to "fix" with a bare GRANT.
 */
const OUTBOX_TABLE = 'outbox_event';

/** The privilege string ADR-044 §D3 decided for it. `DELETE` is deliberately absent. */
const OUTBOX_PRIVILEGES = 'SELECT, INSERT, UPDATE';

/**
 * The migration ledger's own table.
 *
 * It is created by Prisma's CLI, never by a `migration.sql`, and this harness
 * applies the ledger with `psql` file by file — so until `S-E01-1b` it was
 * simply ABSENT here, and two things were therefore unprovable: that the
 * reference-surface GRANT on it lands, and that `app_user` can read it. Both
 * matter at the cutover (`main.ts` at boot, `health.controller.ts` per probe),
 * so the harness now CREATES it explicitly before applying the ledger, with
 * Prisma 5.22's own shape (step 3b).
 *
 * The presence branch is KEPT rather than simplified away: the migration's own
 * `to_regclass` guard still has to work on a database where the table is absent,
 * and printing which branch was taken is what stops this paragraph rotting the
 * day someone changes how the harness bootstraps.
 */
const LEDGER_TABLE = '_prisma_migrations';

/**
 * THE DERIVATION ITSELF — written ONCE, in SQL, over catalog STRUCTURE.
 *
 * > base tables in `public` with NO `tenant_id` column, reachable by a chain of
 * > foreign keys from a table which DOES have one.
 *
 * It never asks whether a policy exists. That is not a stylistic choice, it is
 * the entire point (ADR-042 §D3): the obvious formula
 * `RLS_ON == TENANT_COLS + DERIVED_POLICIED`, where the derived half counts the
 * tables that HAVE a policy, is VACUOUS — a derived table shipped with no policy
 * is absent from BOTH sides, the counts still balance, and the gate passes on
 * exactly the defect it exists to catch.
 *
 * S-E01-1b — WHY IT IS NOW RECURSIVE, and why that is a CORRECTION and not a
 * refactor. ADR-042 §D3 recorded the derivation as ONE LEVEL DEEP and named the
 * hole out loud: "a future table with no `tenant_id` whose foreign key points at
 * a DERIVED table would fall outside both counts and be invisible again."
 * `role_permission` IS that table, and it stopped being hypothetical the moment
 * `role_school_id_fkey` landed. Measured, as `app_user` under GUC = tenant A,
 * against a `role_permission` row belonging to tenant B's custom role and a bare
 * grant: `A_SEES_B_ROLEPERM|1`. So the closure is transitive, ADR-042 §D3 is
 * annotated in place, and ADR-046 cites the amendment.
 *
 * Termination: the recursive term draws from the FINITE `fk` relation and the
 * `UNION` de-duplicates whole rows, so a foreign-key cycle cannot loop.
 *
 * Read from `pg_constraint` rather than `information_schema.table_constraints`
 * so that multi-column foreign keys are seen. `conkey[1]` is the FK's LEADING
 * column, which is the one R-11 cares about.
 */
const DERIVED_SET_SQL = `
  WITH RECURSIVE fk AS (
    SELECT child.oid AS child_oid, child.relname AS child, parent.oid AS parent_oid,
           parent.relname AS parent, k.conkey[1] AS fk_attnum
      FROM pg_constraint k
      JOIN pg_class child ON child.oid = k.conrelid
      JOIN pg_class parent ON parent.oid = k.confrelid
      JOIN pg_namespace n ON n.oid = child.relnamespace
     WHERE k.contype = 'f' AND n.nspname = 'public' AND child.relkind = 'r'
  ), scoped AS (
    SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
                     AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped)
  ), closure AS (
    SELECT f.child_oid, f.child, f.parent, f.fk_attnum FROM fk f
     WHERE f.parent_oid IN (SELECT oid FROM scoped)
       AND f.child_oid NOT IN (SELECT oid FROM scoped)
    UNION
    SELECT f.child_oid, f.child, f.parent, f.fk_attnum FROM fk f
      JOIN closure c ON c.child_oid = f.parent_oid
     WHERE f.child_oid NOT IN (SELECT oid FROM scoped)
  )
  SELECT DISTINCT child_oid, child, parent, fk_attnum FROM closure`;

/**
 * S-E01-1b — THE THIRD TERM: the AUTO-DISCRIMINANT tables, derived and never
 * written as a literal `1`.
 *
 * > the PARENTS of every foreign key whose LEADING child column is `tenant_id`.
 *
 * A table that other tables point at THROUGH their `tenant_id` column IS the
 * tenant dimension. It carries no `tenant_id` of its own (its primary key is the
 * discriminant) and it has no FK out, so it is neither tenant-scoped nor
 * tenant-derived — it fell in the residue, which is why it went unpoliced for
 * three slices. Measured on the catalog: exactly `{tenant}`.
 *
 * Written as a query rather than as `+ 1` for the same reason as the other two
 * terms: a SECOND auto-discriminant table shipped without a policy must make the
 * agreement fail, not be swallowed by a constant.
 */
const AUTO_DISCRIMINANT_SQL = `
  SELECT DISTINCT parent.relname AS name
    FROM pg_constraint k
    JOIN pg_class child ON child.oid = k.conrelid
    JOIN pg_class parent ON parent.oid = k.confrelid
    JOIN pg_namespace n ON n.oid = child.relnamespace
    JOIN pg_attribute a ON a.attrelid = child.oid AND a.attnum = k.conkey[1]
   WHERE k.contype = 'f' AND n.nspname = 'public' AND child.relkind = 'r'
     AND a.attname = 'tenant_id'`;

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
  // S-E01-2d — the outbox row. It needs NO chain: `aggregate_id` is polymorphic
  // and UNCONSTRAINED, which is exactly why no FK path could ever be written for
  // this table and why it needed a denormalised column instead (ADR-044 §D1).
  outboxEvent: 61,
  // S-E01-1b — the tenant's own CUSTOM role: `school_id` -> a school of THIS
  // tenant. It is the row that proves `role`'s policy, and it is deliberately a
  // row the PRODUCT cannot currently create — `roles.controller.ts` never sets
  // `schoolId`, so every role it makes is a SYSTEM role. That gap is named in
  // ADR-046 §D3 as the residue (PF-08 / ADR-015 D8.6); it is NOT silently fixed
  // here, and the fixture exists so the policy is proven against the shape it
  // was written for rather than against the shape that happens to exist today.
  customRole: 62,
});

/** Tenant A is slot 1, tenant B is slot 2. Used only to build fixture ids. */
const SLOT_A = 1;
const SLOT_B = 2;

/** The `role` row SHARED by both tenants — see `FIXTURES_SQL`. */
const SHARED_ROLE = '99999999-0000-4000-8000-000000000099';

/**
 * S-E01-1b — the ONE `permission` row. `permission` is genuinely global, so a
 * single row is enough: what has to be proven about it is that `app_user` can
 * READ it (the authorization join dead-ends on it otherwise) and that it holds
 * nothing beyond `SELECT`.
 */
const SHARED_PERMISSION = '66666666-0000-4000-8000-000000000066';

/**
 * The `role` row the proof ATTEMPTS to create with a FOREIGN-tenant `school_id`.
 * `role` holds no INSERT privilege this slice, so this attempt must be refused
 * — and the assertion below reads WHICH refusal arrived, because
 * `permission denied` and `violates row-level security policy` mean opposite
 * things about whether the policy works.
 */
const ROLE_FOREIGN_INSERT = fid(SLOT_A, 75);

/** Rows the PROOF creates: an own-tenant INSERT, and two that must be refused. */
const RECEIPT_OWN_INSERT = fid(SLOT_A, 70);
const RECEIPT_FOREIGN_INSERT = fid(SLOT_A, 71);
const RECEIPT_FOREIGN_READER = fid(SLOT_A, 72);

/** S-E01-2d — the two outbox rows the proof writes: one accepted, one refused. */
const OUTBOX_OWN_INSERT = fid(SLOT_A, 73);
const OUTBOX_FOREIGN_INSERT = fid(SLOT_A, 74);

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

-- ${tag} · S-E01-1b · the tenant's own CUSTOM role, and its permission row. This
--          is the pair that S-E01-1b exists to hide from the other tenant: the
--          role carries the tenant's identity ONLY through \`school_id\`, and
--          \`role_permission\` carries it only through TWO hops. Both were
--          MEASURED visible across tenants under a bare grant.
INSERT INTO role (id, school_id, name, slug)
  VALUES (${id(SLOT.customRole)}, ${s}, ${lit(`Custom ${tag}`)}, ${lit(`custom-${tag.toLowerCase()}`)});
INSERT INTO role_permission (role_id, permission_id)
  VALUES (${id(SLOT.customRole)}, ${lit(SHARED_PERMISSION)});

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

/**
 * S-E01-2d — one `outbox_event` row per tenant.
 *
 * It hangs off NOTHING: `aggregate_type` + `aggregate_id` are polymorphic and
 * carry no constraint, so `aggregate_id` here names the tenant's student purely
 * for readability — the database does not check it, and that is precisely why no
 * FK-path policy could ever have been written for this table (ADR-042 §D7). Its
 * `tenant_id` is the ONLY thing that places the row in a tenant, which makes the
 * pair of assertions below a direct test of the denormalised column.
 *
 * `status` is left at its default `pending`, so the OWNER can later prove that a
 * foreign-tenant UPDATE from `app_user` changed NOTHING — a row the tenant-scoped
 * connection cannot see is indistinguishable, from that connection, from a row it
 * successfully updated.
 */
function outboxFixture(slot, tenantId, tag) {
  return `
-- ${tag} · outbox_event: no chain, no FK to an aggregate. Only \`tenant_id\`.
INSERT INTO outbox_event (id, tenant_id, aggregate_type, aggregate_id, type, payload)
  VALUES (${lit(fid(slot, SLOT.outboxEvent))}, ${lit(tenantId)}, 'student',
          ${lit(fid(slot, SLOT.student))}, ${lit(`student.created.${tag}`)}, '{}'::jsonb);
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
-- Its \`school_id\` is NULL, which S-E01-1b makes load-bearing rather than
-- incidental: it is a SYSTEM role, so it must be visible under BOTH GUCs and
-- under NONE. That is the branch of \`role\`'s predicate that keeps every seeded
-- portal role reachable after the cutover.
INSERT INTO role (id, name, slug) VALUES (${lit(SHARED_ROLE)}, 'RLS proof role', 'rls-proof-role');

-- S-E01-1b · the one \`permission\` row and the SYSTEM role's grant of it. Both
-- are global reference data; together with the row above they are what the
-- authorization join \`user_profile -> user_role -> role -> role_permission ->
-- permission\` walks, and that join raised \`permission denied\` before this slice.
INSERT INTO permission (id, code, label, resource_type, action)
  VALUES (${lit(SHARED_PERMISSION)}, 'rls.proof.read', 'RLS proof permission', 'rls_proof', 'read');
INSERT INTO role_permission (role_id, permission_id)
  VALUES (${lit(SHARED_ROLE)}, ${lit(SHARED_PERMISSION)});
${derivedFixtures(SLOT_A, TENANT_A, SCHOOL_A, 'A')}
${derivedFixtures(SLOT_B, TENANT_B, SCHOOL_B, 'B')}
${outboxFixture(SLOT_A, TENANT_A, 'A')}
${outboxFixture(SLOT_B, TENANT_B, 'B')}
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
SELECT 'FRESH_OUTBOX|' || count(*) FROM ${OUTBOX_TABLE};

-- (C2) S-E01-1b — the reference surface with NO context at all, stated rather
--      than left to be discovered. This is the honest exposure ADR-046 §D3
--      records: global reference data IS readable without a tenant, and the
--      school-scoped half is NOT. Both halves are asserted, because "no rows"
--      here would be a broken cutover and "all rows" would be a leak.
SELECT 'NOCTX_SYSTEM_ROLE|' || count(*) FROM role WHERE id = ${lit(SHARED_ROLE)};
SELECT 'NOCTX_SCOPED_ROLE|' || count(*) FROM role WHERE id = ${lit(fid(SLOT_A, SLOT.customRole))};
SELECT 'NOCTX_PERMISSIONS|' || count(*) FROM permission;
-- …and the one that would be an ENUMERATION ORACLE if it answered (epic §10):
-- with no context, \`app_user\` must not be able to list a single tenant.
SELECT 'NOCTX_TENANTS|' || count(*) FROM tenant;
SELECT 'NOCTX_LEDGER|' || count(*) FROM ${LEDGER_TABLE};

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

-- (A3) S-E01-2d — the SAME pair on \`outbox_event\`, which until this slice was
--      the one table where a \`permission denied\` was expected. Its row hangs off
--      NOTHING: the denormalised \`tenant_id\` is the only thing placing it in a
--      tenant, so this pair tests the column and its policy directly, with no FK
--      path and no parent to hide behind.
SELECT 'CTX_A_OUTBOX|' || count(*) FROM ${OUTBOX_TABLE} WHERE id = ${lit(fid(SLOT_A, SLOT.outboxEvent))};
SELECT 'CTX_A_FOREIGN_OUTBOX|' || count(*) FROM ${OUTBOX_TABLE} WHERE id = ${lit(fid(SLOT_B, SLOT.outboxEvent))};
SELECT 'CTX_A_TOTAL_OUTBOX|' || count(*) FROM ${OUTBOX_TABLE};

-- (A4) S-E01-1b — THE AUTHORIZATION JOIN, END TO END. This is the reason the
--      slice exists: before this migration the very same statement raised
--      \`permission denied for table role\` as \`app_user\` (measured, and the
--      fail-before half is executed by this harness's own "before" comparison —
--      a run against the ledger WITHOUT the new migration still reports it).
--      Its result is the tenant's OWN reachable permissions, so it doubles as a
--      positive control: a zero here would mean the join completes and returns
--      nothing, which is a broken cutover wearing a green badge.
SELECT 'AUTHZ_JOIN|' || count(*) FROM user_profile up
  JOIN user_role ur ON ur.user_profile_id = up.id
  JOIN role r ON r.id = ur.role_id
  JOIN role_permission rp ON rp.role_id = r.id
  JOIN permission p ON p.id = rp.permission_id
 WHERE up.id = ${lit(fid(SLOT_A, SLOT.member))};
-- …and the same join for a user of the OTHER tenant returns NOTHING from here:
-- the join completing is not the same claim as the join staying tenant-scoped.
SELECT 'AUTHZ_JOIN_FOREIGN|' || count(*) FROM user_profile up
  JOIN user_role ur ON ur.user_profile_id = up.id
  JOIN role r ON r.id = ur.role_id
  JOIN role_permission rp ON rp.role_id = r.id
  JOIN permission p ON p.id = rp.permission_id
 WHERE up.id = ${lit(fid(SLOT_B, SLOT.member))};

-- (A5) S-E01-1b — the SYSTEM role under a context. It is visible here, under
--      GUC = B below, and under NO GUC above: three readings of one row, which
--      together say "global reference data" rather than "leak".
SELECT 'CTX_A_SYSTEM_ROLE|' || count(*) FROM role WHERE id = ${lit(SHARED_ROLE)};
-- …and the tenant dimension itself: exactly ONE tenant is visible, and it is
-- tenant A. A bare grant with no policy would have shown both.
SELECT 'CTX_A_TENANTS|' || count(*) FROM tenant;
SELECT 'CTX_A_OWN_TENANT|' || count(*) FROM tenant WHERE id = ${lit(TENANT_A)};
SELECT 'CTX_A_FOREIGN_TENANT|' || count(*) FROM tenant WHERE id = ${lit(TENANT_B)};
-- …and the ledger, which \`main.ts\` reads at boot and the health probe reads per
-- request. It carries no tenant, so a context must not change it.
SELECT 'CTX_A_LEDGER|' || count(*) FROM ${LEDGER_TABLE};

-- (A6) The WRITE half of the reference surface is deliberately NOT here.
--      \`role\`, \`role_permission\` and \`tenant\` hold NO write privilege at all
--      this slice (ADR-046 §D5), so an attempted write raises
--      \`permission denied\` — the one string this script treats as a LOUD
--      FAILURE anywhere in the visibility path. It therefore runs in its OWN
--      psql invocation (\`REFERENCE_WRITE_SQL\`), exactly as \`outbox_event\` did
--      while it was fail-closed, so the stderr guard over THIS script stays
--      armed over the reference surface too.

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

-- ===========================================================================
-- S-E01-2d — the WRITE half on \`outbox_event\`, the table that held NO grant at
-- all until this slice. The read half above is only a positive control; the
-- reason this table needed a decision rather than a grant is that an unfiltered
-- outbox is EVERY aggregate of EVERY tenant, so the write path is where the
-- damage would be.
-- ===========================================================================
-- (K+) own-tenant INSERT — must SUCCEED. Without it, (K-) below would be green
--      on a database where the INSERT privilege simply never landed.
INSERT INTO ${OUTBOX_TABLE} (id, tenant_id, aggregate_type, aggregate_id, type, payload)
  VALUES (${lit(OUTBOX_OWN_INSERT)}, ${lit(TENANT_A)}, 'student',
          ${lit(fid(SLOT_A, SLOT.student))}, 'student.updated', '{}'::jsonb);
SELECT 'OUTBOX_OWN_INSERT|' || count(*) FROM ${OUTBOX_TABLE} WHERE id = ${lit(OUTBOX_OWN_INSERT)};
-- (K-) an INSERT carrying a FOREIGN tenant id — must be refused by WITH CHECK.
SAVEPOINT outbox_foreign;
INSERT INTO ${OUTBOX_TABLE} (id, tenant_id, aggregate_type, aggregate_id, type, payload)
  VALUES (${lit(OUTBOX_FOREIGN_INSERT)}, ${lit(TENANT_B)}, 'student',
          ${lit(fid(SLOT_B, SLOT.student))}, 'student.updated', '{}'::jsonb);
SELECT 'OUTBOX_FOREIGN_INSERT_ACCEPTED|1';
ROLLBACK TO SAVEPOINT outbox_foreign;
-- (L) THE SILENT ONE, again: marking a FOREIGN tenant's event as delivered
--     touches NOTHING and raises NOTHING — USING filters it away first. Relay
--     code that reads "1 row updated" as "delivered" would report a delivery
--     that never happened. Whether tenant B's row is really untouched is a
--     question only the OWNER can answer, and it is asked in OWNER_SQL.
UPDATE ${OUTBOX_TABLE} SET status = 'sent', sent_at = now()
  WHERE id = ${lit(fid(SLOT_B, SLOT.outboxEvent))};
SELECT 'OUTBOX_FOREIGN_UPDATE|' || count(*) FROM ${OUTBOX_TABLE}
  WHERE id = ${lit(fid(SLOT_B, SLOT.outboxEvent))};

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
SELECT 'POOLED_OUTBOX|' || count(*) FROM ${OUTBOX_TABLE};

-- (Q) the empty string set EXPLICITLY, same requirement.
SET ${TENANT_GUC} = '';
SELECT 'EMPTY_ROWS|' || count(*) FROM school;
${derivedCountSteps('EMPTY_D')}
SELECT 'EMPTY_OUTBOX|' || count(*) FROM ${OUTBOX_TABLE};

-- (R) switch context: B's row must REAPPEAR, and it must still exist despite (F).
BEGIN;
SELECT set_config(${lit(TENANT_GUC)}, ${lit(TENANT_B)}, true);
SELECT 'CTX_B_VISIBLE|' || count(*) FROM school WHERE id = ${lit(SCHOOL_B)};
SELECT 'CTX_B_FOREIGN|' || count(*) FROM school WHERE id = ${lit(SCHOOL_A)};
${derivedVisibilitySteps('B', SLOT_B, SLOT_A)}
SELECT 'CTX_B_OUTBOX|' || count(*) FROM ${OUTBOX_TABLE} WHERE id = ${lit(fid(SLOT_B, SLOT.outboxEvent))};
SELECT 'CTX_B_FOREIGN_OUTBOX|' || count(*) FROM ${OUTBOX_TABLE} WHERE id = ${lit(fid(SLOT_A, SLOT.outboxEvent))};
-- S-E01-1b — the SYSTEM role is visible under B as well. Read together with
-- CTX_A_SYSTEM_ROLE and NOCTX_SYSTEM_ROLE, these three say "global reference
-- data", which one of them alone could not distinguish from a leak.
SELECT 'CTX_B_SYSTEM_ROLE|' || count(*) FROM role WHERE id = ${lit(SHARED_ROLE)};
SELECT 'CTX_B_OWN_TENANT|' || count(*) FROM tenant WHERE id = ${lit(TENANT_B)};
SELECT 'CTX_B_FOREIGN_TENANT|' || count(*) FROM tenant WHERE id = ${lit(TENANT_A)};
COMMIT;
`;

/**
 * S-E01-1b — THE WRITE REFUSALS, in their OWN psql process.
 *
 * `role`, `role_permission` and `tenant` are granted `SELECT` and nothing else,
 * so every statement here is EXPECTED to raise `permission denied` — the exact
 * string `PROOF_SQL`'s stderr guard treats as a loud failure. Running them there
 * would make the whole check red for succeeding.
 *
 * Why execute this at all when the catalog already says `role=SELECT`? Because
 * "the grant string is SELECT" and "a write is actually refused" are different
 * claims, and the second is the one G-AUTHZ is about. `ON_ERROR_STOP` is off so
 * every statement runs and each refusal is read independently.
 *
 * Two of these are REAL application call sites, named rather than hypothetical:
 * `roles.controller.ts` creates and edits custom roles, and
 * `register.controller.ts` upserts a tenant by slug. Both work today because the
 * app connects as the OWNER; both would fail after the cutover. That is recorded
 * (PF-193 for the role write path, PF-185 for the tenant upsert) and is NOT
 * silently unblocked by widening a grant here.
 */
const REFERENCE_WRITE_SQL = `
\\pset footer off
SET ${TENANT_GUC} = ${lit(TENANT_A)};
-- Each probe is wrapped in its OWN transaction, and that is not decoration: with
-- \`ON_ERROR_STOP\` off and OUTSIDE a transaction, a failed statement does not
-- stop the next one, so the \`…_ACCEPTED\` marker below it would print
-- unconditionally and every one of these assertions would be green for the
-- opposite of the right reason. Inside a transaction the failure ABORTS it, the
-- marker cannot run, and its absence is the evidence. (Measured: the first
-- version of this block reported four false failures for exactly this reason.)
BEGIN;
INSERT INTO role (id, school_id, name, slug)
  VALUES (${lit(ROLE_FOREIGN_INSERT)}, ${lit(SCHOOL_A)}, 'Smuggled', 'smuggled');
SELECT 'ROLE_INSERT_ACCEPTED|1';
ROLLBACK;
BEGIN;
UPDATE role SET name = 'Escalated' WHERE id = ${lit(SHARED_ROLE)};
SELECT 'ROLE_UPDATE_ACCEPTED|1';
ROLLBACK;
BEGIN;
DELETE FROM role_permission WHERE role_id = ${lit(SHARED_ROLE)};
SELECT 'ROLE_PERMISSION_DELETE_ACCEPTED|1';
ROLLBACK;
BEGIN;
INSERT INTO tenant (id, name, slug, updated_at)
  VALUES (${lit(fid(SLOT_A, 76))}, 'Minted', 'minted', now());
SELECT 'TENANT_INSERT_ACCEPTED|1';
ROLLBACK;
-- The floor that makes the four absences above mean something: this connection
-- CAN still read. Without it, "no marker printed" would also be the reading on a
-- connection that died after the first statement.
SELECT 'WRITE_PROBE_STILL_READS|' || count(*) FROM role WHERE id = ${lit(SHARED_ROLE)};
SELECT 'WRITE_PROBE_RAN|1';
`;

/**
 * S-E01-2d — WHY THERE IS NO LONGER A SEPARATE `OUTBOX_SQL` INVOCATION.
 *
 * Until this slice, `outbox_event` ran in its OWN `psql` process because
 * `permission denied` was its EXPECTED result, and the main proof treats that
 * string anywhere in its stderr as a loud failure. Now that the table is granted
 * and policied, the expectation is inverted: a `permission denied` on it is a
 * MISSING GRANT and must be read exactly as it is read for the other 49. Folding
 * it back into `PROOF_SQL` is therefore not tidying — it is what re-arms the
 * stderr guard over this table. Keeping the separate invocation would have left
 * the one table in the schema whose permission errors were silently tolerated.
 */

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
-- S-E01-2d — the same question for the outbox: tenant B's event must still be
-- there AND still \`pending\`. From \`app_user\`'s side under GUC = A, an event it
-- could not see and an event it just marked delivered look identical.
SELECT 'OWNER_FOREIGN_OUTBOX|' || count(*) FROM ${OUTBOX_TABLE}
  WHERE id = ${lit(fid(SLOT_B, SLOT.outboxEvent))};
SELECT 'OWNER_FOREIGN_OUTBOX_UNTOUCHED|' || count(*) FROM ${OUTBOX_TABLE}
  WHERE id = ${lit(fid(SLOT_B, SLOT.outboxEvent))} AND status = 'pending' AND sent_at IS NULL;
-- The cross-tenant INSERT of (K-) was rolled back to a savepoint. If WITH CHECK
-- had accepted it, the row would exist here — the tenant-scoped connection under
-- GUC = A could never tell the difference.
SELECT 'OWNER_OUTBOX_FOREIGN_INSERT|' || count(*) FROM ${OUTBOX_TABLE}
  WHERE id = ${lit(OUTBOX_FOREIGN_INSERT)};

`;

/**
 * S-E01-1b — THE STRUCTURE, asked of the only connection that can ask it, and in
 * its OWN process because one of its two statements is EXPECTED to raise.
 *
 * (1) The foreign key REFUSES an orphan. Before this slice `role.school_id`
 *     carried no foreign key at all, so a role could point at a deleted school —
 *     and under the new policy such a row would be invisible to EVERY tenant,
 *     silently removing its permissions from the authorization join. That is
 *     fail-closed presenting as a WRONG ANSWER rather than a denial, which is
 *     the worst shape a security control can have. The FK makes the state
 *     unreachable; this proves the refusal instead of asserting it.
 *
 * (2) What `ON DELETE CASCADE` actually DOES (ADR-046 §D2): deleting a school
 *     now removes its custom roles, where they were previously left behind. That
 *     is a real semantic change, so it is EXECUTED rather than written in a
 *     comment — and rolled back, because the fixtures below it still matter.
 */
const OWNER_STRUCTURE_SQL = `
\\pset footer off
BEGIN;
INSERT INTO role (id, school_id, name, slug)
  VALUES (${lit(fid(SLOT_A, 77))}, ${lit(fid(SLOT_A, 78))}, 'Orphan', 'orphan');
SELECT 'OWNER_ORPHAN_ROLE_ACCEPTED|1';
ROLLBACK;
BEGIN;
SELECT 'OWNER_ROLES_BEFORE_CASCADE|' || count(*) FROM role WHERE school_id = ${lit(SCHOOL_B)};
DELETE FROM school WHERE id = ${lit(SCHOOL_B)};
SELECT 'OWNER_ROLES_AFTER_CASCADE|' || count(*) FROM role WHERE school_id = ${lit(SCHOOL_B)};
SELECT 'OWNER_SYSTEM_ROLE_SURVIVES|' || count(*) FROM role WHERE id = ${lit(SHARED_ROLE)};
ROLLBACK;

-- (3) THE PREDICATE, EVALUATED AS THE OWNER — the assertion a mutation test
--     forced into existence, and the most important one in this block.
--
--     MEASURED: removing \`AND s.tenant_id = <GUC>\` from \`role\`'s predicate —
--     a real cross-tenant defect — left the ENTIRE harness green. Every
--     visibility assertion runs as \`app_user\`, and there the \`school\`
--     sub-query is ALREADY filtered by \`school\`'s own policy, so the clause is
--     genuinely dead code for that role. It is the OWNER — who runs the
--     migrations, the seeds and the whole application today, and to whom no
--     policy applies — for whom that clause is the only thing working. This is
--     ADR-042 §D1 clause 3 stated as an executable test instead of a paragraph.
--
--     The predicate is not re-typed here: it is read back from \`pg_policy\` with
--     \`pg_get_expr\` and EXECUTED against the table as an ordinary WHERE. So
--     this reads whatever was actually installed, including a transposition the
--     census (which counts policies BY NAME and never reads a predicate) cannot
--     see.
SET ${TENANT_GUC} = ${lit(TENANT_A)};
DO $owner_pred$
DECLARE
  e text;
  n integer;
BEGIN
  CREATE TEMP TABLE owner_predicate_witness (name text, rows integer);
  FOREACH e IN ARRAY ARRAY['role', 'role_permission'] LOOP
    DECLARE expr text; cnt integer;
    BEGIN
      SELECT pg_get_expr(p.polqual, p.polrelid) INTO expr
        FROM pg_policy p
       WHERE p.polname = ${lit(POLICY_NAME)} AND p.polrelid = format('public.%I', e)::regclass;
      IF expr IS NULL THEN
        RAISE EXCEPTION 'no % policy installed on public.%', ${lit(POLICY_NAME)}, e;
      END IF;
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', e, expr) INTO cnt;
      INSERT INTO owner_predicate_witness VALUES (e, cnt);
    END;
  END LOOP;
  n := 0;
END
$owner_pred$;
SELECT 'OWNER_PRED_' || name || '|' || rows FROM owner_predicate_witness;
RESET ${TENANT_GUC};
SELECT 'STRUCTURE_PROBE_RAN|1';
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
    // ---- 3b. S-E01-1b / AC-4d — CREATE THE LEDGER TABLE, BEFORE the ledger.
    //
    // `_prisma_migrations` is created by Prisma's CLI, not by any `migration.sql`
    // — and this harness applies the ledger file by file with `psql`, so until
    // now the table simply did not exist here. That made TWO things unprovable:
    // that the reference-surface GRANT on it lands at all, and that `app_user`
    // can read it. Both are load-bearing at the cutover: `apps/api/src/main.ts`
    // runs `assertMigrationsClean` at BOOT and `health.controller.ts` calls
    // `readMigrationState` on EVERY health probe, so a missing SELECT here would
    // break the cutover twice over.
    //
    // The shape is Prisma 5.22's own. The row is inserted so the SELECT below is
    // not vacuously green on an empty table, and it carries the two columns
    // `readMigrationState` actually reads (`finished_at`, `rolled_back_at`)
    // besides `migration_name` — it never reads `checksum`.
    const ledgerCreate = psql(
      client.command,
      scratchOwner,
      `CREATE TABLE public._prisma_migrations (
         id                  varchar(36) PRIMARY KEY NOT NULL,
         checksum            varchar(64) NOT NULL,
         finished_at         timestamptz,
         migration_name      varchar(255) NOT NULL,
         logs                text,
         rolled_back_at      timestamptz,
         started_at          timestamptz NOT NULL DEFAULT now(),
         applied_steps_count integer NOT NULL DEFAULT 0
       );
       INSERT INTO public._prisma_migrations
         (id, checksum, finished_at, migration_name, applied_steps_count)
       VALUES ('00000000-0000-0000-0000-000000000000', 'rls-isolation-check', now(),
               '0_baseline', 1);`,
    );
    if (ledgerCreate.status !== 0) {
      throw new ToolingUnavailable(`could not create the ledger table: ${ledgerCreate.stderr.trim()}`);
    }

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
       -- S-E01-1b — the same thing BY NAME. The count alone cannot express
       -- \`GRANTED == POLICIED ∪ REFERENCE_SURFACE\`, and the tempting repair for
       -- the count going out of balance is relaxing it to an inequality — which
       -- would delete the one thing that makes \`GRANT … ON ALL TABLES IN SCHEMA
       -- public\` impossible to ship.
       SELECT 'GRANTED_NAMES|' || coalesce(string_agg(DISTINCT table_name, ',' ORDER BY table_name), '')
         FROM information_schema.role_table_grants
        WHERE grantee=${lit(app.user)} AND table_schema='public';
       SELECT 'POLICIED_NAMES|' || coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '')
         FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND p.polname=${lit(POLICY_NAME)};
       -- Every reference-surface table holds EXACTLY SELECT — read per table, so
       -- a balancing count can never stand in for it (G-AUTHZ).
       SELECT 'REFERENCE_GRANTS|' || coalesce(string_agg(entry, ';' ORDER BY entry), '') FROM (
         SELECT g.table_name || '=' || string_agg(g.privilege_type, ', ' ORDER BY g.privilege_type) AS entry
           FROM information_schema.role_table_grants g
          WHERE g.grantee=${lit(app.user)} AND g.table_schema='public'
            AND g.table_name IN (${REFERENCE_SURFACE.map(lit).join(', ')})
          GROUP BY g.table_name) e;
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
       -- S-E01-1b — THE THIRD TERM, derived and never a literal 1. See
       -- AUTO_DISCRIMINANT_SQL. Names as well as count: a count alone would let
       -- a SECOND auto-discriminant table swap places with \`tenant\`.
       SELECT 'AUTODISC_EXPECTED|' || count(*) FROM (${AUTO_DISCRIMINANT_SQL}) a;
       SELECT 'AUTODISC_NAMES|' || coalesce(string_agg(name, ',' ORDER BY name), '')
         FROM (${AUTO_DISCRIMINANT_SQL}) a;
       -- AC-5b: everything with no tenant_id that neither the derivation NOR the
       -- auto-discriminant term reaches. The third exclusion joined the query in
       -- S-E01-1b; without it \`tenant\` would be both policied AND in the
       -- residue, i.e. counted on one side and excused on the other.
       SELECT 'RESIDUE_NAMES|' || coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '')
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'
          AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
                            AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped)
          AND c.relname NOT IN (SELECT DISTINCT child FROM (${DERIVED_SET_SQL}) s)
          AND c.relname NOT IN (SELECT name FROM (${AUTO_DISCRIMINANT_SQL}) a);
       -- S-E01-1b — the STRUCTURE this slice adds, without which \`role\` is not
       -- derivable at all. \`confdeltype='c'\` is CASCADE: \`SET NULL\` ('n') would
       -- PROMOTE a school-scoped role to GLOBAL the day its school is deleted,
       -- which is the most severe escalation shape this repository knows how to
       -- report. Asserted as an equality on the ACTION, not on mere existence.
       SELECT 'ROLE_FK_CASCADE|' || count(*) FROM pg_constraint k
        WHERE k.conname='role_school_id_fkey' AND k.conrelid='public.role'::regclass
          AND k.contype='f' AND k.confrelid='public.school'::regclass AND k.confdeltype='c';
       SELECT 'ROLE_FK_SETNULL|' || count(*) FROM pg_constraint k
        WHERE k.conrelid='public.role'::regclass AND k.contype='f' AND k.confdeltype='n';
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
       -- PF-185, now CLOSED (S-E01-2d) — outbox_event: a tenant_id column, ONE
       -- policy, RLS on, a leading index, and exactly the decided privileges.
       -- Every one of these four assertions is the INVERSE of what S-E01-2c
       -- asserted; the execution half is inside the main proof, not beside it.
       SELECT 'OUTBOX_TENANT_COL|' || count(*) FROM pg_attribute a
        WHERE a.attrelid=${lit('public.' + OUTBOX_TABLE)}::regclass AND a.attname='tenant_id'
          AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull;
       -- ADR-044 §D1: the FK to \`tenant\` is MATERIALISED, ON DELETE CASCADE, like
       -- school and user_profile. \`c\` = cascade; anything else is a silent change
       -- of what closing a tenant does to its undelivered events.
       SELECT 'OUTBOX_FK_CASCADE|' || count(*) FROM pg_constraint k
        WHERE k.conrelid=${lit('public.' + OUTBOX_TABLE)}::regclass AND k.contype='f'
          AND k.confrelid='public.tenant'::regclass AND k.confdeltype='c';
       -- R-11: an index whose LEADING column is tenant_id. Unlike the 44 and the
       -- 5, this one had to be CREATED by the migration — the column is new.
       SELECT 'OUTBOX_TENANT_INDEX|' || count(*) FROM pg_index x
        WHERE x.indrelid=${lit('public.' + OUTBOX_TABLE)}::regclass
          AND x.indkey[0]=(SELECT a.attnum FROM pg_attribute a
                            WHERE a.attrelid=${lit('public.' + OUTBOX_TABLE)}::regclass AND a.attname='tenant_id');
       SELECT 'OUTBOX_POLICIES|' || count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=${lit(OUTBOX_TABLE)};
       SELECT 'OUTBOX_RLS|' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=${lit(OUTBOX_TABLE)} AND c.relrowsecurity;
       SELECT 'OUTBOX_GRANTS|' || coalesce(string_agg(privilege_type, ', ' ORDER BY privilege_type), '')
         FROM information_schema.role_table_grants
        WHERE grantee=${lit(app.user)} AND table_schema='public' AND table_name=${lit(OUTBOX_TABLE)};
       -- ADR-044 §D3 — DELETE is WITHHELD. Counted separately from the shape
       -- above so a widening fails with its own named assertion.
       SELECT 'OUTBOX_DELETE|' || count(*) FROM information_schema.role_table_grants
        WHERE grantee=${lit(app.user)} AND table_schema='public' AND table_name=${lit(OUTBOX_TABLE)}
          AND privilege_type='DELETE';
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
    // ---- 5b-bis. S-E01-1b — THE THIRD TERM. Catalog-derived like the other two.
    //          A zero here would silently collapse the agreement back to its
    //          pre-S-E01-1b form and let `tenant` go unpoliced again.
    const autoDiscExpected = Number(c.get('AUTODISC_EXPECTED'));
    if (!Number.isFinite(autoDiscExpected) || autoDiscExpected < 1) {
      fail(
        'the schema carries an AUTO-DISCRIMINANT tenant table',
        `AUTODISC_EXPECTED = ${c.get('AUTODISC_EXPECTED')} — the parents of the tenant_id foreign keys ` +
          'must be discoverable, or the third term of the agreement is vacuous',
      );
      return;
    }
    expectSetEqual(
      'S-E01-1b the AUTO-DISCRIMINANT set derived from pg_constraint is exactly the tenant dimension ' +
        '(the parents of every FK whose LEADING child column is tenant_id) — names, not just a count',
      names(c.get('AUTODISC_NAMES')),
      ['tenant'],
    );
    const policiedExpected = tenantCols + derivedExpected + autoDiscExpected;
    record(
      'AC-5 the census is an AGREEMENT: expected = tenant-scoped + tenant-DERIVED + AUTO-DISCRIMINANT, ' +
        'all three catalog-computed',
      `${tenantCols} + ${derivedExpected} + ${autoDiscExpected} (never written as a literal)`,
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
        ? 'created by this harness before the ledger (S-E01-1b / AC-4d), with Prisma 5.22`s own shape, so ' +
          'the reference-surface GRANT on it and its readability are both PROVEN rather than skipped'
        : 'ABSENT — the ledger was applied with psql, which does not create it. This is now the UNEXPECTED ' +
          'branch: step 3b creates it explicitly, so reaching here means that step was removed',
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
    // S-E01-1b — RESTATED, never RELAXED. The old form was
    // `GRANTED == policiedExpected` ("granted exactly the policied tables").
    // The cutover needs `permission` and `_prisma_migrations` too, and neither
    // will ever carry a policy: `permission` has no tenant to filter by and the
    // ledger is not tenant data. The locally cheapest repair — turning the
    // equality into `>=` — would delete the ONE thing that makes
    // `GRANT … ON ALL TABLES IN SCHEMA public` impossible to ship. So the
    // invariant becomes a NAMED set equality, in both directions, with the
    // offending names printed.
    const referenceSurfacePresent = REFERENCE_SURFACE.filter(
      (name) => name !== LEDGER_TABLE || ledgerTablePresent,
    );
    expectSetEqual(
      `AC-4f ${app.user} is granted exactly POLICIED ∪ REFERENCE_SURFACE (${referenceSurfacePresent.join(', ')}) ` +
        '— never relaxed to an inequality, which is how ON ALL TABLES would get in',
      names(c.get('GRANTED_NAMES')),
      [...names(c.get('POLICIED_NAMES')), ...referenceSurfacePresent],
    );
    // The count is KEPT beside the set equality, and it is not redundant: the
    // set above is measured against POLICIED_NAMES (tables that HAVE a policy),
    // while this one is measured against the STRUCTURAL expectation. A policy
    // missing from a table that structurally needs one makes the set equality
    // still pass and this line fail — which is the defect the whole file exists
    // to catch, one level up.
    expectEqual(
      `${app.user} is granted exactly the policied tables, plus the ${referenceSurfacePresent.length}-table ` +
        'reference surface the authorization join needs',
      c.get('GRANTED'),
      policiedExpected + referenceSurfacePresent.length,
    );
    // G-AUTHZ, per table and never by a balancing count: privilege data the
    // application role could WRITE is a privilege-escalation path.
    expectSetEqual(
      `AC-4f every reference-surface table holds EXACTLY "${REFERENCE_PRIVILEGES}" for ${app.user} ` +
        '(ADR-046 §D5 — read-only for this slice; the write path is deferred as PF-193)',
      String(c.get('REFERENCE_GRANTS') ?? '')
        .split(';')
        .map((entry) => canonicalGrant(entry.trim()))
        .filter((entry) => entry !== ''),
      referenceSurfacePresent.map((table) => canonicalGrant(`${table}=${REFERENCE_PRIVILEGES}`)),
    );
    // S-E01-1b — the STRUCTURE the derivation depends on. Without this FK,
    // `role` is not derivable and `DERIVED_EXPECTED` never moves; with it as
    // `SET NULL`, deleting a school would PROMOTE its roles to global.
    expectEqual(
      'AC-2b role_school_id_fkey exists, points at school, and is ON DELETE CASCADE (ADR-046 §D2)',
      c.get('ROLE_FK_CASCADE'),
      1,
    );
    expectEqual(
      'AC-2b no foreign key on role is ON DELETE SET NULL — that action would turn a school-scoped role ' +
        'into a GLOBAL one at the moment its school is deleted',
      c.get('ROLE_FK_SETNULL'),
      0,
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
    // ---- PF-185, CLOSED by S-E01-2d — the catalog half. Every assertion here
    //      is the INVERSE of the one S-E01-2c shipped, and the ORDER matters:
    //      the column comes first, because a policy on a table without the
    //      column could not exist, and a green "policy = 1" read before checking
    //      the column would say nothing about which column it filters on.
    expectEqual(
      `S-E01-2d ${OUTBOX_TABLE} carries a NOT NULL tenant_id — the denormalised discriminant ` +
        'ADR-042 §D7 deferred and ADR-044 §D1 decided (it is still NOT derivable, and never became so)',
      c.get('OUTBOX_TENANT_COL'),
      1,
    );
    expectEqual(
      `ADR-044 §D1 ${OUTBOX_TABLE}.tenant_id carries a FOREIGN KEY to tenant with ON DELETE CASCADE, ` +
        'the same shape as school and user_profile',
      c.get('OUTBOX_FK_CASCADE'),
      1,
    );
    expectEqual(
      `R-11 an index LEADS by ${OUTBOX_TABLE}.tenant_id — created by this migration, because unlike ` +
        'the 44 and the 5 the column did not exist before it',
      c.get('OUTBOX_TENANT_INDEX'),
      1,
    );
    expectEqual(
      `S-E01-2d ${OUTBOX_TABLE} carries EXACTLY ONE ${POLICY_NAME} policy`,
      c.get('OUTBOX_POLICIES'),
      1,
    );
    expectEqual(`S-E01-2d ${OUTBOX_TABLE} has relrowsecurity = true`, c.get('OUTBOX_RLS'), 1);
    expectEqual(
      `ADR-044 §D3 ${OUTBOX_TABLE} holds EXACTLY "${OUTBOX_PRIVILEGES}" for ${app.user} — the grant is ` +
        'admissible because the POLICY exists and is proven first, never as a way to silence a permission error',
      canonicalGrant(`${OUTBOX_TABLE}=${c.get('OUTBOX_GRANTS')}`),
      canonicalGrant(`${OUTBOX_TABLE}=${OUTBOX_PRIVILEGES}`),
    );
    expectEqual(
      `ADR-044 §D3 ${OUTBOX_TABLE} does NOT hold DELETE — retention is an OWNER job, and a DELETE here ` +
        'would let the application role erase UNDELIVERED events, the one loss the outbox pattern exists to prevent',
      c.get('OUTBOX_DELETE'),
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

    // ---- S-E01-1b — THE REASON THIS SLICE EXISTS, asserted before anything
    //      else it touches. `permission denied for table role` is what this
    //      exact statement raised as `app_user` against the ledger WITHOUT the
    //      new migration; a count of 1 here is the fail-before/pass-after pair
    //      closing. It is ALSO a positive control: the join completing and
    //      returning zero rows would be a broken cutover wearing a green badge.
    expectEqual(
      'AC-4a POSITIVE CONTROL: the authorization join user_profile -> user_role -> role -> ' +
        'role_permission -> permission COMPLETES as ' +
        `${app.user} (it raised "permission denied for table role" before this slice)`,
      f.get('AUTHZ_JOIN'),
      1,
    );
    expectEqual(
      'AC-4a …and the SAME join for a user of the OTHER tenant returns nothing — completing the join and ' +
        'keeping it tenant-scoped are two different claims',
      f.get('AUTHZ_JOIN_FOREIGN'),
      0,
    );
    // The three readings of ONE system role. Separately, each is ambiguous;
    // together they say "global reference data" and not "leak" (ADR-046 §D3).
    expectEqual('AC-4c a SYSTEM role (school_id IS NULL) is visible under GUC = tenant A', f.get('CTX_A_SYSTEM_ROLE'), 1);
    expectEqual('AC-4c …and under GUC = tenant B', f.get('CTX_B_SYSTEM_ROLE'), 1);
    expectEqual('AC-4c …and under NO tenant context at all — the honest exposure ADR-046 §D3 records', f.get('NOCTX_SYSTEM_ROLE'), 1);
    // …paired with the half that makes those three mean something: the SCHOOL-
    // SCOPED role is NOT visible without a context. Without this pair, "roles
    // are visible" would be indistinguishable from "role has no policy".
    expectEqual(
      'AC-4c CONTROL: a SCHOOL-SCOPED role is NOT visible without a tenant context — so the three ' +
        'lines above are about the IS NULL branch, not about a missing policy',
      f.get('NOCTX_SCOPED_ROLE'),
      0,
    );
    expectEqual(
      'AC-4a `permission` is readable with no context — it is genuinely global (no discriminant, no FK ' +
        'to one), which is why it is in the reference surface and not under a policy',
      f.get('NOCTX_PERMISSIONS'),
      1,
    );
    // AC-3 — the enumeration oracle the epic §10 forbids, closed by execution.
    expectEqual(
      'AC-3 with NO tenant context, `app_user` cannot enumerate a single tenant — the plain `id = <GUC>` ' +
        'policy closes the oracle, so no SECURITY DEFINER lookup function was needed (ADR-046 §D4)',
      f.get('NOCTX_TENANTS'),
      0,
    );
    expectEqual('AC-3 with GUC = tenant A, exactly ONE tenant row is visible', f.get('CTX_A_TENANTS'), 1);
    expectEqual('AC-3 …and it is tenant A', f.get('CTX_A_OWN_TENANT'), 1);
    expectEqual('AC-3 …and tenant B is NOT visible from it', f.get('CTX_A_FOREIGN_TENANT'), 0);
    expectEqual('AC-3 switching to GUC = tenant B makes B visible', f.get('CTX_B_OWN_TENANT'), 1);
    expectEqual('AC-3 …and tenant A disappears', f.get('CTX_B_FOREIGN_TENANT'), 0);
    // AC-4d — the ledger. `main.ts` reads it at BOOT (`assertMigrationsClean`)
    // and `health.controller.ts` reads it on EVERY probe (`readMigrationState`),
    // so a missing SELECT here breaks the cutover twice. It carries no tenant,
    // so it must read the SAME with and without a context.
    expectEqual(
      `AC-4d ${LEDGER_TABLE} is readable by ${app.user} with NO context — main.ts asserts migrations ` +
        'clean at BOOT, before any tenant exists',
      f.get('NOCTX_LEDGER'),
      1,
    );
    expectEqual(
      `AC-4d …and identically under a context — health.controller.ts reads it on every probe, and it ` +
        'carries no tenant, so a context must not change it',
      f.get('CTX_A_LEDGER'),
      1,
    );
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
      // `noContextRows` is 0 for the five FK-path tables and 1 for `role` /
      // `role_permission`, and that difference is the POINT rather than a
      // tolerance: a SYSTEM role (`school_id IS NULL`) is global reference data
      // and MUST stay readable without a tenant context, or every portal loses
      // its seeded roles at the cutover. It is written as a measured number per
      // table so a change is a diff, not a silently loosened assertion.
      expectEqual(
        `AC-6  a fresh connection with NO tenant context sees exactly ${d.noContextRows ?? 0} ${d.child} row(s)`,
        f.get(`FRESH_D_${d.child}`),
        d.noContextRows ?? 0,
      );
    }

    // ---- S-E01-2d: the same pair on `outbox_event`. This is the assertion that
    //      most needs its positive control: until this slice `app_user` held ZERO
    //      privileges here, so "tenant B's event is not visible" was green on a
    //      table nobody could read at all. The row hangs off nothing — the
    //      denormalised column is the only thing placing it in a tenant.
    expectEqual(
      `S-E01-2d POSITIVE CONTROL: GUC = tenant A, the ${OUTBOX_TABLE} row IS VISIBLE ` +
        '(it was `permission denied` before this slice)',
      f.get('CTX_A_OUTBOX'),
      1,
    );
    expectEqual(
      `S-E01-2d GUC = tenant A: tenant B's ${OUTBOX_TABLE} row is NOT visible`,
      f.get('CTX_A_FOREIGN_OUTBOX'),
      0,
    );
    expectEqual(
      `S-E01-2d GUC = tenant A: ${OUTBOX_TABLE} shows tenant A's rows and ONLY those`,
      f.get('CTX_A_TOTAL_OUTBOX'),
      1,
    );
    expectEqual(
      `S-E01-2d a fresh connection with NO tenant context sees zero ${OUTBOX_TABLE} rows`,
      f.get('FRESH_OUTBOX'),
      0,
    );

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

    // ---- S-E01-2d — the WRITE half on `outbox_event`. An unfiltered outbox is
    //      every aggregate of every tenant, so this is where the damage would be.
    expectEqual(
      `S-E01-2d POSITIVE CONTROL: an OWN-tenant INSERT into ${OUTBOX_TABLE} is accepted`,
      f.get('OUTBOX_OWN_INSERT'),
      1,
    );
    if (f.has('OUTBOX_FOREIGN_INSERT_ACCEPTED')) {
      fail(
        `S-E01-2d an INSERT into ${OUTBOX_TABLE} carrying a FOREIGN tenant id is REJECTED`,
        'it was ACCEPTED — WITH CHECK is not doing its job on the denormalised column',
      );
    } else if (/violates row-level security policy/i.test(proof.stderr)) {
      record(`S-E01-2d an INSERT into ${OUTBOX_TABLE} carrying a FOREIGN tenant id is REJECTED by WITH CHECK`);
    } else {
      fail(
        `S-E01-2d an INSERT into ${OUTBOX_TABLE} carrying a FOREIGN tenant id is REJECTED`,
        `no RLS violation was reported:\n${proof.stderr.trim()}`,
      );
    }
    expectEqual(
      `S-E01-2d the SILENT one: marking a FOREIGN tenant's event delivered raises nothing (and, per the ` +
        'owner below, changed nothing) — relay code reading "1 row updated" as delivered would be wrong',
      f.get('OUTBOX_FOREIGN_UPDATE'),
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
        `F-1 the SAME connection, after COMMIT, with no context: exactly ${d.noContextRows ?? 0} ` +
          `${d.child} row(s) AND NO ERROR`,
        f.get(`POOLED_D_${d.child}`),
        d.noContextRows ?? 0,
      );
      expectEqual(
        `AC-6  an explicitly EMPTY tenant context sees exactly ${d.noContextRows ?? 0} ${d.child} row(s) ` +
          'and raises nothing',
        f.get(`EMPTY_D_${d.child}`),
        d.noContextRows ?? 0,
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

    // The same four no-context / context-switch cases on `outbox_event`. The
    // pooled one is not redundant with `school`: a predicate written without
    // `nullif` raises 22P02 on the table that carries it, and this table's
    // predicate was written last and copied by hand.
    expectEqual(
      `F-1 the SAME connection, after COMMIT, with no context: zero ${OUTBOX_TABLE} rows AND NO ERROR`,
      f.get('POOLED_OUTBOX'),
      0,
    );
    expectEqual(
      `S-E01-2d an explicitly EMPTY tenant context sees zero ${OUTBOX_TABLE} rows and raises nothing`,
      f.get('EMPTY_OUTBOX'),
      0,
    );
    expectEqual(
      `S-E01-2d switching the GUC to tenant B makes B's ${OUTBOX_TABLE} row reappear`,
      f.get('CTX_B_OUTBOX'),
      1,
    );
    expectEqual(
      `S-E01-2d GUC = tenant B: tenant A's ${OUTBOX_TABLE} row is NOT visible`,
      f.get('CTX_B_FOREIGN_OUTBOX'),
      0,
    );

    // A 22P02 anywhere would mean the predicate is the bare cast form.
    if (/invalid input syntax for type uuid/i.test(proof.stderr)) {
      fail(
        'F-1 no connection ever raises 22P02 on the tenant GUC',
        'the predicate is missing nullif(…, \'\') — see the migration header:\n' + proof.stderr.trim(),
      );
    } else {
      record('F-1 no connection raised 22P02 on the tenant GUC');
    }

    // ---- 7b. PF-185, CLOSED (S-E01-2d). There is nothing to run here any more,
    //      and the absence is the evidence.
    //
    // S-E01-2c ran a SEPARATE `psql` invocation over `outbox_event` because
    // `permission denied` was its EXPECTED result and the stderr guard above
    // treats that string as a loud failure everywhere else. The table now carries
    // a denormalised `tenant_id`, a policy and a grant (ADR-044), so its proof is
    // in `PROOF_SQL` with the other 49 — which means the guard above now covers
    // it, and a lost grant on this table can no longer be read as isolation.
    //
    // If this ever needs to become a separate invocation again, that is a signal
    // the table was made fail-closed once more, and it needs an ADR, not a probe.
    record(
      `PF-185 CLOSED: ${OUTBOX_TABLE} is proven ISOLATED inside the main proof, not fail-closed beside it`,
      'a "permission denied" on it is once again a LOUD failure, like every other table under test',
    );

    // ---- 7c. S-E01-1b / G-AUTHZ — THE WRITE REFUSALS, in their own process.
    //
    //      Separate because `permission denied` is the EXPECTED result here and
    //      the guard above treats that string as a loud failure. "The grant
    //      string is SELECT" and "a write is actually refused" are different
    //      claims; the catalog answers the first, only execution answers the
    //      second, and privilege data the application role could write is a
    //      privilege-escalation path (ADR-046 §D5).
    const referenceWrite = psql(client.command, scratchApp, REFERENCE_WRITE_SQL, { onErrorStop: false });
    const w = facts(referenceWrite);
    // Non-vacuity first: if the script never reached its last line, every
    // `has(...)` below would be false for the wrong reason.
    expectEqual('AC-4g the write-refusal probe actually ran to the end', w.get('WRITE_PROBE_RAN'), 1);
    expectEqual(
      'AC-4g …and the probing connection can still READ — otherwise "no marker printed" would also be ' +
        'the reading on a connection that simply died',
      w.get('WRITE_PROBE_STILL_READS'),
      1,
    );
    for (const [label, marker] of [
      ['an INSERT into `role` (roles.controller.ts creates custom roles — PF-193)', 'ROLE_INSERT_ACCEPTED'],
      ['an UPDATE of `role` (roles.controller.ts edits them — PF-193)', 'ROLE_UPDATE_ACCEPTED'],
      [
        'a DELETE from `role_permission` (roles.controller.ts replaces a role`s permission set — PF-193)',
        'ROLE_PERMISSION_DELETE_ACCEPTED',
      ],
      ['an INSERT into `tenant` (register.controller.ts upserts by slug — PF-185)', 'TENANT_INSERT_ACCEPTED'],
    ]) {
      if (w.has(marker)) {
        fail(
          `AC-4g ${label} is REFUSED for ${app.user}`,
          'it was ACCEPTED — the reference surface is not read-only, and a role that can rewrite ' +
            'privilege data can grant itself every permission in the schema',
        );
      } else {
        record(`AC-4g ${label} is REFUSED for ${app.user}`);
      }
    }
    if (/permission denied/i.test(referenceWrite.stderr)) {
      record(
        'AC-4g …and the refusal is the PRIVILEGE one (`permission denied`), not a policy violation',
        'the grant is absent, so the write never reaches WITH CHECK at all',
      );
    } else {
      fail(
        'AC-4g the write refusals are privilege refusals',
        `no "permission denied" was reported, so the writes were stopped by something else — or not at ` +
          `all:\n${referenceWrite.stderr.trim()}`,
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
    // S-E01-2d — the same two facts for the outbox, asked of the only connection
    // that can answer them.
    expectEqual(
      `S-E01-2d the foreign UPDATE reached NOTHING — the owner still sees tenant B's ${OUTBOX_TABLE} row`,
      o.get('OWNER_FOREIGN_OUTBOX'),
      1,
    );
    expectEqual(
      "S-E01-2d …and it is UNCHANGED: still `pending`, sent_at still NULL, so the silent UPDATE really " +
        'delivered nothing',
      o.get('OWNER_FOREIGN_OUTBOX_UNTOUCHED'),
      1,
    );
    expectEqual(
      `S-E01-2d the refused cross-tenant INSERT left NO row behind in ${OUTBOX_TABLE} — measured by the ` +
        'owner, because the tenant-scoped connection could not tell the difference',
      o.get('OWNER_OUTBOX_FOREIGN_INSERT'),
      0,
    );

    // ---- 8b. S-E01-1b — the STRUCTURE, as the owner, in its own process
    //      because the orphan INSERT is EXPECTED to raise.
    const structure = psql(client.command, scratchOwner, OWNER_STRUCTURE_SQL, { onErrorStop: false });
    const st = facts(structure);
    expectEqual('AC-2b the structure probe actually ran to the end', st.get('STRUCTURE_PROBE_RAN'), 1);
    if (st.has('OWNER_ORPHAN_ROLE_ACCEPTED')) {
      fail(
        'AC-2b role_school_id_fkey REFUSES a role pointing at a non-existent school',
        'the orphan row was ACCEPTED — such a row is invisible to EVERY tenant under the new policy, so ' +
          'its permissions vanish from the authorization join with no error raised anywhere',
      );
    } else if (/violates foreign key constraint/i.test(structure.stderr)) {
      record('AC-2b role_school_id_fkey REFUSES a role pointing at a non-existent school (FK violation)');
    } else {
      fail(
        'AC-2b role_school_id_fkey REFUSES a role pointing at a non-existent school',
        `no foreign-key violation was reported:\n${structure.stderr.trim()}`,
      );
    }
    // Reached FIRST: "after the cascade there are zero" is vacuously green if
    // there were zero to begin with.
    expectEqual(
      'AC-2b CONTROL: tenant B really has a school-scoped role before the cascade',
      st.get('OWNER_ROLES_BEFORE_CASCADE'),
      1,
    );
    expectEqual(
      'AC-2b ON DELETE CASCADE removes a school`s custom roles — EXECUTED, because it is a real change ' +
        'of what deleting a school does (they used to be left behind, orphaned and invisible)',
      st.get('OWNER_ROLES_AFTER_CASCADE'),
      0,
    );
    expectEqual(
      'AC-2b …and the SYSTEM role survives it: the cascade follows school_id, so a role belonging to no ' +
        'school is untouched',
      st.get('OWNER_SYSTEM_ROLE_SURVIVES'),
      1,
    );
    // ---- THE PREDICATE, EVALUATED AS THE OWNER. Read the long comment in
    //      OWNER_STRUCTURE_SQL before touching these two numbers: a mutation
    //      test proved that deleting `AND s.tenant_id = <GUC>` from `role`'s
    //      predicate — a real cross-tenant defect — left EVERY other assertion
    //      in this file green, because as `app_user` the sub-query is already
    //      filtered by `school`'s own policy. These two lines are the only
    //      thing in the repository that fails on it.
    //
    //      Two, not three: tenant A's own custom role, plus the SYSTEM role.
    //      Tenant B's custom role must NOT be counted, and it is the one the
    //      defect lets through.
    for (const child of ['role', 'role_permission']) {
      expectEqual(
        `AC-2 the installed ${child} predicate, read back with pg_get_expr and evaluated AS THE OWNER ` +
          '(to whom NO policy applies), still admits ONLY tenant A`s row plus the global one — this is the ' +
          'assertion that fails when the redundant-for-app_user tenant comparison is deleted as "dead code"',
        st.get(`OWNER_PRED_${child}`),
        2,
      );
    }

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
         -- S-E01-1b — the generic loop above iterates \`relrowsecurity\`, so it
         -- CANNOT reach the reference-surface tables that hold a grant and no
         -- policy. Leaving them granted would make \`AFTER_GRANTS = 0\` false and,
         -- worse, would leave a real privilege behind after a "complete"
         -- rollback. Named explicitly, guarded on existence like the migration.
         FOREACH t IN ARRAY ARRAY[${REFERENCE_SURFACE.map(lit).join(', ')}] LOOP
           IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
             EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.%I FROM ${app.user}', t);
           END IF;
         END LOOP;
         -- …and the STRUCTURE this slice added, which no DROP POLICY reverses.
         ALTER TABLE public.role DROP CONSTRAINT IF EXISTS role_school_id_fkey;
         DROP INDEX IF EXISTS public.user_role_role_id_idx;
         REVOKE USAGE ON SCHEMA public FROM ${app.user};
         CREATE TEMP TABLE rollback_witness AS SELECT touched AS touched;
       END
       $rollback$;
       SELECT 'ROLLBACK_TOUCHED|' || touched FROM rollback_witness;
       SELECT 'AFTER_POLICIES|' || count(*) FROM pg_policy p WHERE p.polname = ${lit(POLICY_NAME)};
       SELECT 'AFTER_RLS|' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relrowsecurity;
       SELECT 'AFTER_GRANTS|' || count(DISTINCT table_name) FROM information_schema.role_table_grants
        WHERE grantee=${lit(app.user)} AND table_schema='public';
       SELECT 'AFTER_ROLE_FK|' || count(*) FROM pg_constraint
        WHERE conname='role_school_id_fkey' AND conrelid='public.role'::regclass;
       SELECT 'AFTER_ROLE_INDEX|' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='user_role_role_id_idx';`,
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
      // S-E01-1b — the two things a DROP POLICY / DISABLE RLS pair cannot undo.
      // This slice is the first that is not an EXPAND PUR, so "the generic block
      // covers it" stopped being true and had to be verified rather than assumed.
      expectEqual(
        'AC-4h the rollback also drops role_school_id_fkey — this slice is NOT an expand PUR, so a ' +
          'DROP POLICY / DISABLE pair is no longer a sufficient reversal',
        r.get('AFTER_ROLE_FK'),
        0,
      );
      expectEqual(
        'AC-4h …and the index the FK made necessary (user_role_role_id_idx)',
        r.get('AFTER_ROLE_INDEX'),
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
  // S-E01-1b — the DERIVATION ITSELF is exported, not just its result. The
  // adversarial sibling used to carry its own ONE-LEVEL census SQL, which agreed
  // with `DERIVED_TABLES` only for as long as no derived table had a derived
  // child. `role_permission` is that child, so the two disagreed the moment this
  // slice closed the derivation transitively — a disagreement between two
  // hand-written queries about the same catalog fact, i.e. `ADR-042 §D3` drift
  // one layer below the constants it was written for.
  AUTO_DISCRIMINANT_PRIVILEGES,
  AUTO_DISCRIMINANT_SQL,
  DERIVED_PRIVILEGE_SETS,
  DERIVED_SET_SQL,
  DERIVED_TABLES,
  MIN_EXPECTED_TABLES,
  NON_DERIVED_EXPECTED,
  OUTBOX_PRIVILEGES,
  OUTBOX_TABLE,
  POLICY_NAME,
  REFERENCE_PRIVILEGES,
  REFERENCE_SURFACE,
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
