#!/usr/bin/env node
/**
 * tenant-adversarial-check.js — VAL-02 / S-E01-3.
 *
 * The two-tenant ADVERSARIAL suite: it seeds two real tenants on a disposable
 * scratch database, connects as the NON-OWNER role `app_user`, and proves BY
 * EXECUTION, at catalog-enumerated BREADTH, that cross-tenant SELECT / UPDATE /
 * DELETE / INSERT are refused — with the positive control for each one running
 * FIRST, so that no denial can be recorded from a broken connection, an empty
 * table or a revoked grant.
 *
 * WHAT IT ADDS OVER `scripts/rls-isolation-check.js`, IN ONE WORD: BREADTH.
 * ----------------------------------------------------------------------
 * The sibling proves the policies EXIST, agree with the catalog, and deny — on
 * `school`, the five FK-derived tables and `outbox_event`. That is depth on a
 * sample. This file enumerates EVERY tenant-bearing table from the live catalog
 * of the scratch database and runs four verbs against each, in both directions.
 * If breadth is ever dropped from this file, the file becomes a rename of its
 * sibling and should be deleted rather than kept.
 *
 * The two scripts DUPLICATE their fixtures and share no fixture module. That is
 * FORCED, not chosen: this slice may not edit `rls-isolation-check.js`
 * (S-E01-3 hard constraint 2), so there is no seam to extract into. Recorded as
 * ADR-045 §D1 with the follow-up, so the next reader does not "fix" the
 * duplication by editing a file that is in flight on another branch.
 *
 * THE FIVE THINGS THAT WOULD MAKE THIS SUITE GREEN AND WORTHLESS
 * --------------------------------------------------------------
 * Each is closed by a named mechanism, and each mechanism is pinned by
 * `apps/api/src/shared/quality/tenant-adversarial-gate.spec.ts`:
 *
 *   1. THE B SIDE WAS NEVER SEEDED. Then `SELECT` returns 0, `UPDATE` affects 0
 *      and `DELETE` affects 0 — three green denials on an empty table. Closed by
 *      the COVERED / UNCOVERED partition: the OWNER counts A rows and B rows per
 *      enumerated table BEFORE any adversarial statement runs, a table with no B
 *      row is UNCOVERED and its denials are DISCARDED rather than recorded, and
 *      the UNCOVERED set is asserted by SET EQUALITY against a list named in this
 *      file with a reason per entry. A 51st table lands in UNCOVERED, is absent
 *      from the named list, and the gate FAILS printing its name.
 *   2. THE TRANSACTION ABORTED EARLY. In one psql session with
 *      `ON_ERROR_STOP=0`, the first expected rejection aborts the transaction and
 *      every later statement returns 25P02 emitting no output at all — a parser
 *      that reads a missing label as zero scores the whole remainder as PASS.
 *      Closed by running EVERY adversarial statement inside `adv_exec` /
 *      `adv_count`, whose `BEGIN … EXCEPTION` block is an implicit SAVEPOINT, and
 *      by asserting `emitted == planned` label-by-label with the missing names
 *      printed.
 *   3. `42501` WAS SCORED AS "DENIED". Seven tables measurably hold no DELETE and
 *      three hold no UPDATE, so a suite that reads `permission denied` as
 *      isolation would stay green with every policy dropped. Closed by reading
 *      the privilege matrix from `information_schema.role_table_grants` and
 *      asserting the EXPECTED outcome per (table, verb) — `0 rows` where the
 *      privilege is held, SQLSTATE `42501` where it is not — plus a set-equality
 *      assertion on the matrix ITSELF, so a silently widened grant is a FAILURE
 *      and not a newly-passing test. SQLSTATE, never message text: the message is
 *      locale-dependent (DNC-10).
 *   4. A CASCADE EMPTIED THE FIXTURE. 100 FK edges, `ON DELETE CASCADE`
 *      throughout: a positive-control DELETE on A's `school` removes A's rows
 *      everywhere, and every later denial then returns 0 because the row is GONE.
 *      Closed by running the whole mutating phase inside one transaction that is
 *      ROLLED BACK, with the DELETE probes ordered leaves-first, and by
 *      re-counting the owner-side fixture afterwards and failing on any drift.
 *   5. THE GREEN WAS READ AS "SAFE TO CUT OVER". Closed by the CUTOVER READINESS
 *      block, which is printed on the GREEN path and is itself a set of named
 *      assertions — see below.
 *
 * WHAT A GREEN FROM THIS SUITE DOES NOT SAY (ADR-045 §D5)
 * ------------------------------------------------------
 * That the application is isolated. It is not. The application connects as
 * `pilotage`, which OWNS the tables, and `FORCE ROW LEVEL SECURITY` was
 * deliberately omitted (ADR-032 §D5), so the owner BYPASSES every policy — proven
 * here by a POSITIVE assertion that the leak is present, not by a printed caveat,
 * so that the day someone adds FORCE this assertion goes red and says so. The
 * verdict vocabulary of this file therefore contains no bare word "isolated": the
 * success banner reads "the NON-OWNER role is isolated; the APPLICATION IS NOT".
 * No colour carries any distinction — a non-TTY CI log strips ANSI, and every
 * verdict line here is legible from its text alone.
 *
 * IT FAILS, IT NEVER SKIPS — DNC-08, ADR-027
 * ------------------------------------------
 * No PostgreSQL, no `psql`, no `app_user`, no `DATABASE_URL_APP`, no migrations:
 * each is a named non-zero exit. Three distinguishable exit codes (0 proven /
 * 1 could-not-run / 2 not-isolated), reused from the sibling so an operator reads
 * one vocabulary. There is NO environment variable and NO flag that turns any
 * verdict below into a pass (DNC-10). `DATABASE_URL` and `DATABASE_URL_APP` name
 * WHERE and AS WHOM, never WHETHER.
 *
 * THE DANGEROUS PART — read before editing
 * ----------------------------------------
 * This script CREATES and DROPS a database. The scratch name is generated here,
 * matched against `SCRATCH_NAME_PATTERN` before any DROP, and refused if it
 * equals the source database. The pattern is deliberately DIFFERENT from the
 * sibling's, so neither check can ever drop the other's database. It additionally
 * REFUSES to run against a non-loopback address, with no flag to override.
 *
 * TEARDOWN (AC-7, ADR-045 §D2) — MEASURED, not copied. `pilotage` is
 * `rolsuper=false`, `rolbypassrls=false` and a member of NO role, so it cannot
 * signal an `app_user` backend: the terminate-then-retry branch at
 * `rls-isolation-check.js:1650` is a NO-OP for exactly the case it was written
 * for. This file therefore opens no pooled or long-lived connection, holds no
 * handle across the drop, and QUIESCE-POLLS `pg_stat_activity` (readable by any
 * role — measured) until the scratch database has no backend left before
 * dropping. Buying a green teardown with `GRANT pg_signal_backend TO pilotage`
 * is FORBIDDEN and is mechanised as a forbidden string in the guard spec.
 *
 * CREDENTIALS NEVER REACH `argv` (ADR-025 D6). Every `psql` invocation takes its
 * password through `PGPASSWORD` in the CHILD environment and its address through
 * `-h/-p/-U/-d`. No connection string is ever an argument, and no address is ever
 * printed unredacted.
 */

'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const net = require('node:net');
const { extname, join, resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');

const {
  APP_DATABASE_URL_VAR,
  defaultAppDatabaseUrl,
  defaultDatabaseUrl,
} = require('./lib/default-database-url');
const { postgresClient } = require('./lib/postgres-client-path');

/**
 * The sibling is REQUIRED, never edited (hard constraint 2). Its `main()` is
 * guarded by `require.main === module`, so this import creates no database.
 *
 * Everything imported here is a CONSTANT or a PURE function. Two literals for one
 * GUC name is precisely the drift ADR-042 §D3 exists to forbid, so `TENANT_GUC`,
 * `POLICY_NAME`, `MIN_EXPECTED_TABLES`, `VERDICT_EXIT_CODES`, `DERIVED_TABLES`,
 * `NON_DERIVED_EXPECTED`, `OUTBOX_TABLE` and `OUTBOX_PRIVILEGES` are read from
 * there rather than re-declared. `fid`, `lit`, `redact`, `isLoopbackHost` and
 * `migrationFiles` come with them because re-typing them would be the same defect
 * one layer down.
 *
 * S-E01-1b — THE DERIVATION SQL IS IMPORTED TOO, and that is the lesson this
 * slice paid for. This file used to carry its OWN one-level census query for the
 * FK-derived set: a second hand-written statement about the same catalog fact,
 * which agreed with `DERIVED_TABLES` only while no derived table had a derived
 * child of its own. `role_permission` is that child. The moment the sibling
 * closed the derivation transitively, the two queries disagreed — 6 against 7 —
 * and the disagreement would have surfaced as a red on a merge, not as a red on
 * the diff that caused it. `DERIVED_SET_SQL` and `AUTO_DISCRIMINANT_SQL` now come
 * from the same place the constants do (ADR-042 §D3, one layer below where it was
 * written).
 */
const {
  AUTO_DISCRIMINANT_PRIVILEGES,
  AUTO_DISCRIMINANT_SQL,
  DERIVED_SET_SQL,
  DERIVED_TABLES,
  MIN_EXPECTED_TABLES,
  NON_DERIVED_EXPECTED,
  OUTBOX_PRIVILEGES,
  OUTBOX_TABLE,
  POLICY_NAME,
  REFERENCE_PRIVILEGES,
  REFERENCE_SURFACE,
  TENANT_GUC,
  VERDICT_EXIT_CODES,
  // S-E01-1c — the two tables the write guard covers, IMPORTED and never
  // re-typed: AC-10's fail-before / pass-after asserts that neither is a
  // verb-aware cutover blocker any more, and a local literal here would be a
  // second source of truth about which tables the sibling migration granted.
  WRITE_GUARD_TABLES,
  fid,
  isLoopbackHost,
  lit,
  migrationFiles,
  redact,
} = require('./rls-isolation-check');

/** The owner/maintenance address. An explicit variable still wins — a DEFAULT only. */
const DATABASE_URL = process.env.DATABASE_URL || defaultDatabaseUrl();

/** The role the policies are PROVEN against. Never the owner — asserted, not assumed. */
const APP_DATABASE_URL = process.env[APP_DATABASE_URL_VAR] || defaultAppDatabaseUrl();

/**
 * Only a name this script generated may ever be dropped, and the pattern is
 * DIFFERENT from `rls-isolation-check.js`'s `^rls_isolation_…` so that neither
 * check can drop the other's scratch database when both run concurrently.
 */
const SCRATCH_NAME_PATTERN = /^tenant_adversarial_\d+_\d+$/;

/**
 * Tenant A's id carries UPPERCASE hex, for the same reason as the sibling's and
 * not as decoration: PostgreSQL renders a `uuid` in lowercase, so a predicate
 * written `tenant_id::text = current_setting(…)` matches ZERO rows for this
 * tenant — fail-closed, and completely invisible. Because A is uppercase, the
 * cast direction is EXECUTED here; if someone rewrites the predicate to the text
 * form every positive control below goes red immediately.
 *
 * Both ids are DISJOINT from the sibling's (`AAAAAAAA-…` / `bbbbbbbb-…`), and the
 * fixture slots below use tenant slots 7 and 8 where the sibling uses 1 and 2, so
 * two concurrent runs on two scratch databases can never share a fixture id.
 */
const TENANT_A = 'AAAA7777-1111-4111-8111-AAAAAAAA7777';
const TENANT_B = 'bbbb8888-2222-4222-8222-bbbbbbbb8888';

/** Tenant A is slot 7, tenant B is slot 8. Used only to build fixture ids. */
const SLOT_A = 7;
const SLOT_B = 8;

/** The `role` row SHARED by both tenants — reference data, no tenant discriminant. */
const SHARED_ROLE = '99999999-0000-4000-8000-000000000077';

const TCP_PREFLIGHT_TIMEOUT_MS = 2000;
const PSQL_TIMEOUT_MS = 300000;

/** AC-7 — the bounded quiesce poll. Never unbounded, never a privilege escalation. */
const QUIESCE_ATTEMPTS = 50;
const QUIESCE_SLEEP_SECONDS = 0.1;

/**
 * The NON-VACUITY FLOOR (ADR-045 §D3).
 *
 * The COVERED / UNCOVERED partition is satisfied trivially if the fixture builder
 * fails and every table lands in UNCOVERED. This floor is what stops that: it is
 * a MINIMUM, not an expectation, so schema growth cannot make it red — only a
 * collapse of the fixture can. Measured today: 45 tenant-bearing tables plus the
 * five FK-derived ones are all seeded, so COVERED is 50.
 */
const MIN_COVERED_TABLES = 40;

/**
 * S-E01-1c / TOOL-32 — the NON-VACUITY FLOOR of the verb-aware scan.
 *
 * Measured on this checkout: 722 `prisma.<model>.<verb>` sites plus 86 `tx.`
 * ones, of which the great majority carry a recognised verb and a catalog table.
 * A MINIMUM and not an expectation, so the corpus growing cannot make it red.
 *
 * It exists because every AC-10 line is a DIFFERENCE between what a verb needs
 * and what a grant holds: a scan that matched nothing would print a clean bill
 * of health for a corpus it never read. That is PF-02's own failure mode, and
 * the previous anchor (`\bprisma\.`, which could not see one `tx.` call) is how
 * close this block already came to it.
 */
const MIN_CLASSIFIED_CALL_SITES = 400;

/**
 * AC-2 / ADR-045 §D3 — the UNCOVERED partition, NAMED with a reason per entry.
 *
 * READ THIS BEFORE ADDING A NAME. This list is not an exemption list and it never
 * subtracts from anything: it is the OTHER HALF of a set-equality assertion over
 * the tables the live catalog enumerates. A table that this suite cannot seed
 * lands in UNCOVERED; if its name is not here the gate FAILS and prints it. Adding
 * a name here is therefore a deliberate, reviewable statement that the table is
 * NOT PROVEN by this suite — never a way to make a red go away.
 *
 * It holds EXACTLY TWO NAMES today, and that is a measurement rather than an
 * aspiration: all 45 tenant-bearing tables and five of the seven FK-derived ones
 * are seeded for both tenants below. The two that are not are named here WITH
 * their reason, and the reason is structural rather than an omission:
 *
 *   • `role`            — S-E01-1b gave it `role_school_id_fkey`, so the closure
 *                         returns it, and ADR-046 §D5 grants it `SELECT` AND
 *                         NOTHING ELSE. Every table in `PLAN` is driven on four
 *                         verbs and the INSERT branch below is a HARD FAIL when
 *                         the grant is missing — deliberately, because a table
 *                         this suite cannot write is a table whose denials would
 *                         be vacuous. Seeding a read-only table into `PLAN` would
 *                         mean relaxing that branch, i.e. trading a real
 *                         protection for a coverage number.
 *   • `role_permission` — the same, one level deeper. It is PRIVILEGE data: a
 *                         role that could write it could grant itself every
 *                         permission in the schema (ADR-046 §D5 / PF-193).
 *
 * Neither is unproven in the programme — both are proven BY EXECUTION in the
 * sibling `scripts/rls-isolation-check.js`, including the measured cross-tenant
 * read (`A_SEES_B_ROLEPERM|1`) that the two-hop policy closes. What is true is
 * that THIS suite does not prove them, and that is what a name here says.
 * Removing a name without adding the table to `PLAN` fails, in both directions.
 *

 * THE SEQUENCING HAZARD FIRED, AND THIS IS WHAT IT COST. An earlier draft of this
 * file predicted it in the future tense: "when `S-E01-2d` lands it gives
 * `outbox_event` a real `tenant_id`, the census moves 44 -> 45, and both this list
 * and the `outbox_event` denial probe go red". `S-E01-2d` MERGED first (ADR-044),
 * so that red was the PRESENT state of this branch, not a future one, and it was
 * caught by review rather than by a run. What the live-catalog enumeration did is
 * exactly what it is for: it refused to agree with a frozen belief about the
 * schema. The response is the one the design prescribes — `outbox_event` joined
 * `PLAN` as an ordinary tenant-bearing table, seeded for both tenants and proven
 * on four verbs, and its old fail-closed probe was DELETED rather than kept
 * alongside. It is not named here, because naming it here would say "not proven",
 * which is now false.
 */
const UNCOVERED_EXPECTED = Object.freeze(['role', 'role_permission']);

/**
 * The append-only tables (ADR-032 §D7): `SELECT, INSERT` and nothing else.
 *
 * Named here because the PRIVILEGE MATRIX is a DECISION and not a catalog fact.
 * The matrix is asserted by set equality below, so a widened grant is a FAILURE
 * rather than a newly-passing test — which is the direction that actually hurts.
 */
const APPEND_ONLY_TABLES = Object.freeze(['audit_log', 'conversation_message']);

/**
 * The privilege string every OTHER tenant-bearing table holds.
 *
 * "Other" now excludes THREE shapes, not two: the append-only pair above, and
 * `outbox_event`, which ADR-044 §D3 decided holds `SELECT, INSERT, UPDATE` and
 * deliberately NOT `DELETE` — the relay mutates an event, it never erases an
 * undelivered one. That string is read from the sibling (`OUTBOX_PRIVILEGES`)
 * rather than re-typed, so the two files cannot disagree about a grant.
 */
const FULL_DML = 'DELETE|INSERT|SELECT|UPDATE';
const APPEND_ONLY_DML = 'INSERT|SELECT';

/** `SELECT, INSERT, UPDATE` -> `INSERT|SELECT|UPDATE`, the shape the catalog reports. */
const OUTBOX_DML = OUTBOX_PRIVILEGES.split(',')
  .map((privilege) => privilege.trim().toUpperCase())
  .sort()
  .join('|');

/** Exit codes, reused from the sibling so an operator reads ONE vocabulary. */
const EXIT = VERDICT_EXIT_CODES;

// ---------------------------------------------------------------------------
// Fixture slots — ids are GENERATED, never typed (the chains are too deep)
// ---------------------------------------------------------------------------

/**
 * One slot per fixture row. `fid(tenantSlot, slot)` puts the TENANT slot in the
 * last uuid group, so no id can collide across tenants.
 *
 * The `…2` slots are the SPARE PARENTS, and every one of them exists for a
 * measured reason: fourteen tables carry a UNIQUE index composed only of NOT NULL
 * foreign-key columns (`grade(assessment_id, student_id)`,
 * `enrollment(student_id, class_section_id, academic_year_id)`,
 * `user_role(user_profile_id, role_id, school_id)`, …), so an own-tenant INSERT
 * probe reusing the fixture's parents would be refused with 23505 — a unique
 * violation standing in for the RLS answer, which is exactly the ambiguity a
 * proof must never depend on. The probe rows therefore hang off a spare parent.
 *
 * `school2`, `userProfile2`, `announcement2`, `grade2` and `importBatch2` are
 * additionally seeded CHILDLESS in BOTH tenants, so the FK-path foreign-parent
 * INSERT of AC-4 can fail for exactly ONE reason: the policy.
 */
const SLOT = Object.freeze({
  school: 10,
  school2: 11,
  userProfile: 12,
  userProfile2: 13,
  academicYear: 14,
  cycle: 15,
  gradeLevel: 16,
  classSection: 17,
  term: 18,
  subject: 19,
  subject2: 20,
  teacherProfile: 21,
  student: 22,
  student2: 23,
  // A THIRD student, and the reason is a measurement: `grade` carries
  // UNIQUE(assessment_id, student_id), the spare parent `grade2` already occupies
  // (assessment, student2), and the fixture occupies (assessment, student). With
  // only two students the own-tenant INSERT probe on `grade` is refused 23505 —
  // a unique violation standing in for the policy's answer.
  student3: 65,
  teachingAssignment: 24,
  assessment: 25,
  grade: 26,
  grade2: 27,
  classSession: 28,
  attendanceRecord: 29,
  lessonEntry: 30,
  alertRule: 31,
  alertInstance: 32,
  conversation: 33,
  conversationMessage: 34,
  conversationParticipant: 35,
  conversationReport: 36,
  remediationPlan: 37,
  tutor: 38,
  tutorAvailability: 39,
  booking: 40,
  enrollment: 41,
  announcement: 42,
  announcement2: 43,
  announcementReceipt: 44,
  calendarEvent: 45,
  classSubjectDistribution: 46,
  subjectCoefficient: 47,
  studentGlobalSnapshot: 48,
  studentSubjectSnapshot: 49,
  guardian: 50,
  guardianship: 51,
  guardianshipClaim: 52,
  rosterSource: 53,
  importBatch: 54,
  importBatch2: 55,
  importRow: 56,
  notification: 57,
  notificationPreference: 58,
  exportJob: 59,
  auditLog: 60,
  snapshotRecomputeTrigger: 61,
  meetingRequest: 62,
  userRole: 63,
  gradeRevision: 64,
  // S-E01-2d / ADR-044: `outbox_event` acquired a DENORMALISED `tenant_id`, so it
  // stopped being the one table outside every policy and became an ordinary
  // tenant-bearing row this suite must seed for BOTH tenants.
  outboxEvent: 65,
});

/** The primary key of a PROBE row. Never a seeded slot — see `UNCOVERED_EXPECTED`. */
const OWN_PROBE_OFFSET = 100;
const FOREIGN_PROBE_OFFSET = 200;

/**
 * THE TABLE PLAN — topological, parents first.
 *
 * `columns(c)` returns the full `[name, sqlValue]` list for one row: every NOT
 * NULL column without a default, plus `tenant_id` where the table carries one.
 * The set was MEASURED from `information_schema.columns` on the live cluster, not
 * inferred from `schema.prisma`.
 *
 * `c.probe` is false for the seeded fixture and true for the INSERT probes, and
 * it is what selects the spare parent / varied unique value. `c.t` is the tenant
 * literal the ROW carries, which for the foreign INSERT probe is the OTHER
 * tenant's id while the parents stay this tenant's — that is the shape AC-2(d)
 * asks for, and PostgreSQL evaluates the RLS `WITH CHECK` before it inserts into
 * any index, so the answer is the policy's and not the unique index's.
 *
 * DELETE probes run in REVERSE order of this array (leaves first): `ON DELETE
 * CASCADE` is on all 100 FK edges, so deleting `school` first would empty the
 * fixture and turn every later denial green for the wrong reason.
 */
const PLAN = Object.freeze([
  {
    table: 'school',
    key: 'id',
    slot: SLOT.school,
    columns: (c) => [
      ['tenant_id', c.t],
      ['name', lit(`School ${c.tag}${c.sfx}`)],
      // globally unique, so it carries the tenant tag AND the probe suffix
      ['school_code', lit(`ADV-${c.tag}-${c.slot}${c.sfx}`)],
      ['country', lit('FR')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'user_profile',
    key: 'id',
    slot: SLOT.userProfile,
    columns: (c) => [
      ['tenant_id', c.t],
      ['first_name', lit('Member')],
      ['last_name', lit(c.tag)],
      ['email', lit(`member-${c.tag}-${c.slot}${c.sfx}@adv.test`)],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'academic_year',
    key: 'id',
    slot: SLOT.academicYear,
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['name', lit(`Year ${c.tag}${c.sfx}`)],
      ['start_date', "DATE '2026-09-01'"],
      ['end_date', "DATE '2027-06-30'"],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'cycle',
    key: 'id',
    slot: SLOT.cycle,
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['code', lit(`CYC-${c.tag}${c.sfx}`)],
      ['name', lit('Cycle')],
      ['order_index', String(1 + c.v)],
    ],
  },
  {
    table: 'grade_level',
    key: 'id',
    slot: SLOT.gradeLevel,
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['cycle_id', c.id('cycle')],
      ['code', lit(`GL-${c.tag}${c.sfx}`)],
      ['name', lit('Level')],
      ['order_index', String(1 + c.v)],
    ],
  },
  {
    table: 'class_section',
    key: 'id',
    slot: SLOT.classSection,
    columns: (c) => [
      ['tenant_id', c.t],
      ['academic_year_id', c.id('academicYear')],
      ['grade_level_id', c.id('gradeLevel')],
      ['name', lit(`Section ${c.tag}${c.sfx}`)],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'term',
    key: 'id',
    slot: SLOT.term,
    columns: (c) => [
      ['tenant_id', c.t],
      ['academic_year_id', c.id('academicYear')],
      ['name', lit(`Term ${c.tag}${c.sfx}`)],
      ['order_index', String(1 + c.v)],
      ['start_date', "DATE '2026-09-01'"],
      ['end_date', "DATE '2026-12-20'"],
    ],
  },
  {
    table: 'subject',
    key: 'id',
    slot: SLOT.subject,
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['code', lit(`SUB-${c.tag}${c.sfx}`)],
      ['name', lit('Subject')],
    ],
  },
  {
    table: 'teacher_profile',
    key: 'id',
    slot: SLOT.teacherProfile,
    // UNIQUE(user_profile_id) — the probe must hang off the spare user_profile.
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['user_profile_id', c.id(c.probe ? 'userProfile2' : 'userProfile')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'student',
    key: 'id',
    slot: SLOT.student,
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['first_name', lit('Student')],
      ['last_name', lit(`${c.tag}${c.sfx}`)],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'teaching_assignment',
    key: 'id',
    slot: SLOT.teachingAssignment,
    // UNIQUE(teacher_profile_id, class_section_id, subject_id) — vary the subject.
    columns: (c) => [
      ['tenant_id', c.t],
      ['teacher_profile_id', c.id('teacherProfile')],
      ['class_section_id', c.id('classSection')],
      ['subject_id', c.id(c.probe ? 'subject2' : 'subject')],
      ['academic_year_id', c.id('academicYear')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'assessment',
    key: 'id',
    slot: SLOT.assessment,
    columns: (c) => [
      ['tenant_id', c.t],
      ['teaching_assignment_id', c.id('teachingAssignment')],
      ['teacher_profile_id', c.id('teacherProfile')],
      ['title', lit(`Assessment ${c.tag}${c.sfx}`)],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'grade',
    key: 'id',
    slot: SLOT.grade,
    // UNIQUE(assessment_id, student_id) — vary the student, and it must be the
    // THIRD one: `grade2`, the childless parent the FK-path probe on
    // `grade_revision` needs, already occupies (assessment, student2).
    columns: (c) => [
      ['tenant_id', c.t],
      ['assessment_id', c.id('assessment')],
      ['student_id', c.id(c.probe ? 'student3' : 'student')],
      ['entered_by', c.id('userProfile')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'class_session',
    key: 'id',
    slot: SLOT.classSession,
    columns: (c) => [
      ['tenant_id', c.t],
      ['teaching_assignment_id', c.id('teachingAssignment')],
      ['teacher_profile_id', c.id('teacherProfile')],
      ['date', "DATE '2026-10-01'"],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'attendance_record',
    key: 'id',
    slot: SLOT.attendanceRecord,
    // UNIQUE(class_session_id, student_id) — vary the student.
    columns: (c) => [
      ['tenant_id', c.t],
      ['class_session_id', c.id('classSession')],
      ['student_id', c.id(c.probe ? 'student2' : 'student')],
      ['status', lit('present')],
      // NOT NULL, but no foreign key: measured on pg_constraint, not assumed.
      ['recorded_by', c.id('userProfile')],
    ],
  },
  {
    table: 'lesson_entry',
    key: 'id',
    slot: SLOT.lessonEntry,
    // UNIQUE(class_session_id) — and it is NULLABLE, so both rows leave it NULL.
    columns: (c) => [
      ['tenant_id', c.t],
      ['teaching_assignment_id', c.id('teachingAssignment')],
      ['teacher_profile_id', c.id('teacherProfile')],
      ['date', "DATE '2026-10-02'"],
      ['title', lit(`Lesson ${c.tag}${c.sfx}`)],
      ['content', lit('content')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'alert_rule',
    key: 'id',
    slot: SLOT.alertRule,
    // UNIQUE(tenant_id, school_id, code) — vary the enum, read from pg_enum.
    columns: (c) => [
      ['tenant_id', c.t],
      ['code', lit(c.probe ? 'NEGATIVE_TREND' : 'LOW_SUBJECT_AVG')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'alert_instance',
    key: 'id',
    slot: SLOT.alertInstance,
    columns: (c) => [
      ['tenant_id', c.t],
      ['rule_id', c.id('alertRule')],
      ['code', lit('LOW_SUBJECT_AVG')],
      ['severity', lit('medium')],
      ['student_id', c.id('student')],
      ['title', lit(`Alert ${c.tag}${c.sfx}`)],
      ['body', lit('body')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'conversation',
    key: 'id',
    slot: SLOT.conversation,
    // UNIQUE(tenant_id, parent_id, teacher_id, student_id) — vary the student.
    columns: (c) => [
      ['tenant_id', c.t],
      ['student_id', c.id(c.probe ? 'student2' : 'student')],
      ['parent_id', c.id('userProfile')],
      ['teacher_id', c.id('userProfile2')],
      ['created_by', c.id('userProfile')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'conversation_message',
    key: 'id',
    slot: SLOT.conversationMessage,
    columns: (c) => [
      ['tenant_id', c.t],
      ['conversation_id', c.id('conversation')],
      ['sender_id', c.id('userProfile')],
      ['sender_role', lit('parent')],
      ['body', lit(`message ${c.tag}${c.sfx}`)],
    ],
  },
  {
    table: 'conversation_participant',
    key: 'id',
    slot: SLOT.conversationParticipant,
    // UNIQUE(conversation_id, user_profile_id) — vary the user_profile.
    columns: (c) => [
      ['tenant_id', c.t],
      ['conversation_id', c.id('conversation')],
      ['user_profile_id', c.id(c.probe ? 'userProfile2' : 'userProfile')],
      ['role', lit('parent')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'conversation_report',
    key: 'id',
    slot: SLOT.conversationReport,
    // UNIQUE(conversation_id, reported_by, status) — vary the status enum.
    columns: (c) => [
      ['tenant_id', c.t],
      ['conversation_id', c.id('conversation')],
      ['reported_by', c.id('userProfile')],
      ['reason', lit('reason')],
      ['status', lit(c.probe ? 'reviewed' : 'open')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'remediation_plan',
    key: 'id',
    slot: SLOT.remediationPlan,
    // UNIQUE(tenant_id, student_id, subject_id, status) — vary the student.
    columns: (c) => [
      ['tenant_id', c.t],
      ['student_id', c.id(c.probe ? 'student2' : 'student')],
      ['subject_id', c.id('subject')],
      ['created_by', c.id('userProfile')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'tutor',
    key: 'id',
    slot: SLOT.tutor,
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['type', lit('external')],
      ['display_name', lit(`Tutor ${c.tag}${c.sfx}`)],
      ['created_by', c.id('userProfile')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'tutor_availability',
    key: 'id',
    slot: SLOT.tutorAvailability,
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['tutor_id', c.id('tutor')],
      ['kind', lit('one_off')],
      ['created_by', c.id('userProfile')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'booking',
    key: 'id',
    slot: SLOT.booking,
    // UNIQUE(availability_id, session_at, plan_id) — vary the timestamp.
    columns: (c) => [
      ['tenant_id', c.t],
      ['plan_id', c.id('remediationPlan')],
      ['tutor_id', c.id('tutor')],
      ['availability_id', c.id('tutorAvailability')],
      ['student_id', c.id('student')],
      ['session_at', `TIMESTAMPTZ '2026-11-0${1 + c.v} 10:00:00+00'`],
      ['booked_by', c.id('userProfile')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'enrollment',
    key: 'id',
    slot: SLOT.enrollment,
    // UNIQUE(student_id, class_section_id, academic_year_id) — vary the student.
    columns: (c) => [
      ['tenant_id', c.t],
      ['student_id', c.id(c.probe ? 'student2' : 'student')],
      ['class_section_id', c.id('classSection')],
      ['academic_year_id', c.id('academicYear')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'announcement',
    key: 'id',
    slot: SLOT.announcement,
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['title', lit(`Announcement ${c.tag}${c.sfx}`)],
      ['body', lit('body')],
      ['scope', lit('school_wide')],
      ['author_id', c.id('userProfile')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'calendar_event',
    key: 'id',
    slot: SLOT.calendarEvent,
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['type', lit('meeting')],
      ['title', lit(`Event ${c.tag}${c.sfx}`)],
      ['starts_at', 'now()'],
      ['ends_at', "now() + interval '1 hour'"],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'class_subject_distribution',
    key: 'id',
    slot: SLOT.classSubjectDistribution,
    // UNIQUE(class_section_id, subject_id, term_id) — vary the subject.
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['academic_year_id', c.id('academicYear')],
      ['class_section_id', c.id('classSection')],
      ['subject_id', c.id(c.probe ? 'subject2' : 'subject')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'subject_coefficient',
    key: 'id',
    slot: SLOT.subjectCoefficient,
    // UNIQUE(grade_level_id, subject_id) — vary the subject.
    columns: (c) => [
      ['tenant_id', c.t],
      ['grade_level_id', c.id('gradeLevel')],
      ['subject_id', c.id(c.probe ? 'subject2' : 'subject')],
      ['coefficient', '1'],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'student_global_snapshot',
    key: 'id',
    slot: SLOT.studentGlobalSnapshot,
    // UNIQUE(student_id, term_id) — term_id is NULLABLE and stays NULL, so two
    // rows for the same student do not collide (NULLs are distinct in a
    // btree unique index). Measured, not assumed.
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['academic_year_id', c.id('academicYear')],
      ['student_id', c.id(c.probe ? 'student2' : 'student')],
      ['class_section_id', c.id('classSection')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'student_subject_snapshot',
    key: 'id',
    slot: SLOT.studentSubjectSnapshot,
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['academic_year_id', c.id('academicYear')],
      ['student_id', c.id(c.probe ? 'student2' : 'student')],
      ['class_section_id', c.id('classSection')],
      ['subject_id', c.id('subject')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'guardian',
    key: 'id',
    slot: SLOT.guardian,
    // UNIQUE(user_profile_id) — NULLABLE, and left NULL in both rows.
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['first_name', lit('Guardian')],
      ['last_name', lit(`${c.tag}${c.sfx}`)],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'guardianship',
    key: 'id',
    slot: SLOT.guardianship,
    // UNIQUE(guardian_id, student_id) — vary the student.
    columns: (c) => [
      ['tenant_id', c.t],
      ['guardian_id', c.id('guardian')],
      ['student_id', c.id(c.probe ? 'student2' : 'student')],
      ['relationship', lit('mother')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'guardianship_claim',
    key: 'id',
    slot: SLOT.guardianshipClaim,
    // UNIQUE(guardianship_id) — NULLABLE, and left NULL in both rows.
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['guardian_id', c.id('guardian')],
      ['claimed_first_name', lit('Claimed')],
      ['claimed_last_name', lit(`${c.tag}${c.sfx}`)],
      ['relationship', lit('mother')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'roster_source',
    key: 'id',
    slot: SLOT.rosterSource,
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['kind', lit('oneroster_csv')],
      ['label', lit(`Roster ${c.tag}${c.sfx}`)],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'import_batch',
    key: 'id',
    slot: SLOT.importBatch,
    columns: (c) => [
      ['tenant_id', c.t],
      ['school_id', c.id('school')],
      ['type', lit('students')],
      ['file_name', lit(`adv-${c.tag}${c.sfx}.csv`)],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'notification',
    key: 'id',
    slot: SLOT.notification,
    columns: (c) => [
      ['tenant_id', c.t],
      ['user_profile_id', c.id('userProfile')],
      ['kind', lit('announcement')],
      ['title', lit(`Notification ${c.tag}${c.sfx}`)],
    ],
  },
  {
    table: 'notification_preference',
    key: 'id',
    slot: SLOT.notificationPreference,
    // UNIQUE(user_profile_id, kind) — vary the enum, read from pg_enum.
    columns: (c) => [
      ['tenant_id', c.t],
      ['user_profile_id', c.id('userProfile')],
      ['kind', lit(c.probe ? 'alert' : 'announcement')],
      ['updated_at', 'now()'],
    ],
  },
  {
    table: 'export_job',
    key: 'id',
    slot: SLOT.exportJob,
    columns: (c) => [
      ['tenant_id', c.t],
      ['requested_by', c.id('userProfile')],
      ['kind', lit('grades_xlsx')],
      ['file_name', lit(`export-${c.tag}${c.sfx}.xlsx`)],
    ],
  },
  {
    table: 'audit_log',
    key: 'id',
    slot: SLOT.auditLog,
    columns: (c) => [
      ['tenant_id', c.t],
      ['action', lit(`adv.probe${c.sfx}`)],
      ['resource_type', lit('tenant')],
    ],
  },
  {
    table: 'snapshot_recompute_trigger',
    key: 'id',
    slot: SLOT.snapshotRecomputeTrigger,
    // UNIQUE(tenant_id, coalesce_key, status) — vary the key.
    columns: (c) => [
      ['tenant_id', c.t],
      ['reason', lit('manual_rebuild')],
      ['coalesce_key', lit(`key-${c.tag}${c.sfx}`)],
    ],
  },
  {
    table: 'meeting_request',
    key: 'id',
    slot: SLOT.meetingRequest,
    // UNIQUE(tenant_id, alert_id, requested_by) — vary the requester.
    columns: (c) => [
      ['tenant_id', c.t],
      ['alert_id', c.id('alertInstance')],
      ['student_id', c.id('student')],
      ['alert_code', lit('LOW_SUBJECT_AVG')],
      ['requested_by', c.id(c.probe ? 'userProfile2' : 'userProfile')],
      ['updated_at', 'now()'],
    ],
  },
  // -------------------------------------------------------------------------
  // The FIVE tenant-DERIVED tables (ADR-042). No `tenant_id` column at all: the
  // ONLY thing between a caller and a cross-tenant write is the EXISTS subquery
  // over the parent, which is why each of them gets its own childless parent.
  // -------------------------------------------------------------------------
  {
    table: 'announcement_receipt',
    key: 'id',
    slot: SLOT.announcementReceipt,
    derived: true,
    // UNIQUE(announcement_id, user_profile_id) — vary the user_profile.
    columns: (c) => [
      ['announcement_id', c.id(c.probe ? 'announcement2' : 'announcement')],
      ['user_profile_id', c.id(c.probe ? 'userProfile2' : 'userProfile')],
    ],
  },
  {
    table: 'branding',
    key: 'school_id',
    slot: SLOT.school,
    derived: true,
    // The FK IS the primary key — the shape AC-4 requires one proof on. The probe
    // therefore hangs off `school2`, which is seeded CHILDLESS in both tenants so
    // that a foreign-parent INSERT cannot be refused by the unique index first.
    pk: (c) => c.id(c.probe ? 'school2' : 'school'),
    columns: (c) => [['display_name', lit(`Branding ${c.tag}${c.sfx}`)]],
  },
  {
    table: 'grade_revision',
    key: 'id',
    slot: SLOT.gradeRevision,
    derived: true,
    columns: (c) => [
      ['grade_id', c.id(c.probe ? 'grade2' : 'grade')],
      ['reason', lit(`revision ${c.tag}${c.sfx}`)],
      ['revised_by', c.id('userProfile')],
    ],
  },
  {
    table: 'import_row',
    key: 'id',
    slot: SLOT.importRow,
    derived: true,
    // UNIQUE(batch_id, row_index) — the probe hangs off the childless batch.
    columns: (c) => [
      ['batch_id', c.id(c.probe ? 'importBatch2' : 'importBatch')],
      ['row_index', String(1 + c.v)],
      ['payload', "'{}'::jsonb"],
    ],
  },
  {
    table: 'user_role',
    key: 'id',
    slot: SLOT.userRole,
    derived: true,
    // UNIQUE(user_profile_id, role_id, school_id) — the probe hangs off the
    // childless user_profile. The `role_id -> role` path is a DEAD END (ADR-042
    // §D2): `role` carries no tenant_id, so the tenant path is `user_profile_id`.
    // The shared role row below is what would expose a policy routed through the
    // wrong foreign key — it would be visible to BOTH tenants, or to neither.
    columns: (c) => [
      ['user_profile_id', c.id(c.probe ? 'userProfile2' : 'userProfile')],
      ['role_id', lit(SHARED_ROLE)],
    ],
  },
  {
    // S-E01-2d / ADR-044 — the table that used to be OUTSIDE every policy.
    //
    // It is LAST on purpose, and the reason is the same one the DELETE ordering
    // comment gives: the probes run in REVERSE plan order, so a leaf must come
    // last. `outbox_event` is a leaf by construction — nothing references it, and
    // its only foreign key points at `tenant`, which no probe touches.
    //
    // It holds `SELECT, INSERT, UPDATE` and NOT `DELETE`, so the write phase below
    // classifies its two DELETE probes as 42501 from `role_table_grants` rather
    // than reading a refusal as isolation. That branch already existed for the
    // ten tables that hold no UPDATE or no DELETE; this table needs no special
    // case, which is precisely the evidence that it has rejoined the ordinary
    // regime.
    //
    // `aggregate_id` is NOT a foreign key and never will be — `aggregate_type` /
    // `aggregate_id` are polymorphic and unconstrained (ADR-042 §D7, unchanged by
    // ADR-044). It is pointed at this tenant's `school` id only so the fixture
    // reads as a real event rather than a random uuid; nothing enforces it, and no
    // assertion below depends on it.
    table: 'outbox_event',
    key: 'id',
    slot: SLOT.outboxEvent,
    columns: (c) => [
      ['tenant_id', c.t],
      ['aggregate_type', lit('school')],
      ['aggregate_id', c.id('school')],
      ['type', lit(`adv.school.updated${c.sfx}`)],
      ['payload', `'{"tag":${JSON.stringify(String(c.tag))}}'::jsonb`],
    ],
  },
]);

/** The spare / childless parents, seeded for BOTH tenants. */
const SPARE_PARENTS = Object.freeze([
  'school2',
  'userProfile2',
  'subject2',
  'student2',
  'student3',
  'announcement2',
  'grade2',
  'importBatch2',
]);

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
 * Every invocation is a SEPARATE, SHORT-LIVED child that has fully exited before
 * the next statement of this file runs — that is AC-7's "holds no handle across
 * the drop" made structural rather than promised. `-X` skips `~/.psqlrc`, so a
 * developer's local settings cannot change what a gate observes.
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

function scalar(result) {
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.length > 0 ? lines[lines.length - 1].trim() : '';
}

/** `LABEL|value` lines back into a map. The parser reads FACTS, never row order. */
function facts(result) {
  const map = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    const at = line.indexOf('|');
    if (at <= 0) continue;
    map.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return map;
}

function names(cell) {
  return String(cell ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

// ---------------------------------------------------------------------------
// The verdict — text only. No colour carries any distinction (a non-TTY CI log
// strips ANSI, and the pass / fail / LIMIT distinction must survive that).
// ---------------------------------------------------------------------------

const failures = [];
const evidence = [];
const limits = [];

function record(label, detail) {
  evidence.push(`  [OK]   ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail) {
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  evidence.push(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
}

/** A named, EXPLICIT limit. Never a pass, never silent — see ADR-045 §D5. */
function limit(label, detail) {
  limits.push(`${label}${detail ? ` — ${detail}` : ''}`);
  evidence.push(`  [LIMIT] ${label}${detail ? ` — ${detail}` : ''}`);
}

function expectEqual(label, actual, expected) {
  if (String(actual) === String(expected)) record(label, `${actual}`);
  else fail(label, `expected ${expected}, got ${actual}`);
}

/** SET EQUALITY, in BOTH directions, with the offending NAMES printed. */
function expectSetEqual(label, actual, expected) {
  const got = [...new Set(actual.filter((name) => name !== ''))].sort();
  const want = [...new Set(expected)].sort();
  const missing = want.filter((name) => !got.includes(name));
  const unexpected = got.filter((name) => !want.includes(name));
  if (missing.length === 0 && unexpected.length === 0) {
    record(label, got.length === 0 ? '(empty, and asserted empty)' : got.join(', '));
    return;
  }
  fail(
    label,
    `missing [${missing.join(', ') || '—'}], unexpected [${unexpected.join(', ') || '—'}] ` +
      `(expected exactly: ${want.join(', ') || '—'})`,
  );
}

class ToolingUnavailable extends Error {}

// ---------------------------------------------------------------------------
// The probe harness — one SAVEPOINT per statement, SQLSTATE captured
// ---------------------------------------------------------------------------

/**
 * `adv_exec` / `adv_count` are the whole answer to failure mode 2.
 *
 * A plpgsql `BEGIN … EXCEPTION` block is an IMPLICIT SUBTRANSACTION, i.e. a
 * SAVEPOINT: the statement inside it can be refused without aborting the outer
 * transaction, and the handler records WHY — by SQLSTATE, never by message text,
 * which is locale-dependent (DNC-10). Every adversarial statement in this file
 * goes through one of these two, so no expected rejection can silently convert
 * the hundreds of statements after it into passes.
 *
 * They are `SECURITY INVOKER` — written out rather than left to the default,
 * because a `SECURITY DEFINER` here would execute every probe as the OWNER and
 * turn the entire suite into a proof about the wrong role. The guard spec pins
 * the words.
 *
 * `adv_result` is a TEMP table created by the connection under test, so it adds
 * nothing to the catalog the census enumerates and disappears with the session.
 */
const HARNESS_SQL = `
CREATE OR REPLACE FUNCTION public.adv_exec(p_label text, p_sql text) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER AS $adv$
DECLARE n bigint := 0;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO adv_result(label, outcome, nrows, state) VALUES (p_label, 'ok', n, '00000');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO adv_result(label, outcome, nrows, state) VALUES (p_label, 'err', -1, SQLSTATE);
  END;
END
$adv$;

CREATE OR REPLACE FUNCTION public.adv_count(p_label text, p_sql text) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER AS $adv$
DECLARE n bigint := 0;
BEGIN
  BEGIN
    EXECUTE p_sql INTO n;
    INSERT INTO adv_result(label, outcome, nrows, state) VALUES (p_label, 'ok', coalesce(n, 0), '00000');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO adv_result(label, outcome, nrows, state) VALUES (p_label, 'err', -1, SQLSTATE);
  END;
END
$adv$;
`;

/** Opened at the top of every `app_user` script; emitted before any ROLLBACK. */
const RESULT_TABLE_SQL = `
\\pset footer off
CREATE TEMP TABLE adv_result(label text, outcome text, nrows bigint, state text);
`;

const EMIT_SQL = `SELECT label || '|' || outcome || ':' || nrows || ':' || state FROM adv_result ORDER BY label;`;

/** One planned assertion. The plan is compared to what actually came back. */
class Planner {
  constructor() {
    this.planned = [];
  }

  count(label, sql) {
    this.planned.push(label);
    return `SELECT adv_count(${lit(label)}, ${lit(sql)});`;
  }

  exec(label, sql) {
    this.planned.push(label);
    return `SELECT adv_exec(${lit(label)}, ${lit(sql)});`;
  }
}

/**
 * `label -> {outcome, rows, state}`. A MISSING label is a hard FAILURE and never
 * a zero — that is failure mode 2 closed at the parser as well as at the harness.
 */
function readProbes(result, planner, phase) {
  const raw = facts(result);
  const probes = new Map();
  for (const [label, value] of raw) {
    const [outcome, rows, state] = String(value).split(':');
    probes.set(label, { outcome, rows: Number(rows), state: String(state ?? '') });
  }
  const missing = planner.planned.filter((label) => !probes.has(label));
  if (missing.length > 0) {
    fail(
      `AC-12 every planned assertion of phase "${phase}" reported back`,
      `${missing.length} of ${planner.planned.length} emitted NOTHING, which a naive parser would read as ` +
        `zero rows and score as a PASS: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''}` +
        (result.stderr.trim() ? `\n    psql stderr: ${result.stderr.trim()}` : ''),
    );
  } else {
    record(
      `AC-12 every planned assertion of phase "${phase}" reported back`,
      `${planner.planned.length}/${planner.planned.length} labels emitted`,
    );
  }
  return probes;
}

/** `ok:<n>` — the statement ran and affected/returned `n` rows. */
function expectRows(probes, label, expected, description) {
  const probe = probes.get(label);
  if (!probe) return; // already reported by readProbes
  if (probe.outcome !== 'ok') {
    fail(description, `${label} raised SQLSTATE ${probe.state} where ${expected} row(s) were expected`);
    return;
  }
  if (probe.rows !== expected) {
    fail(description, `${label} affected/returned ${probe.rows} row(s), expected ${expected}`);
    return;
  }
  record(description, `${label} = ${probe.rows}`);
}

/** `err:<sqlstate>` — the statement was refused, and for the STATED reason. */
function expectSqlState(probes, label, expected, description) {
  const probe = probes.get(label);
  if (!probe) return;
  if (probe.outcome === 'ok') {
    fail(description, `${label} was ACCEPTED (${probe.rows} row(s)) where SQLSTATE ${expected} was required`);
    return;
  }
  if (probe.state !== expected) {
    fail(description, `${label} was refused with SQLSTATE ${probe.state}, not ${expected} — a refusal for a ` +
      'DIFFERENT reason proves nothing about the policy');
    return;
  }
  record(description, `${label} refused with SQLSTATE ${expected}`);
}

/** The two SQLSTATEs this file ever asserts. Never a message string (DNC-10). */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = '42501';

// ---------------------------------------------------------------------------
// Fixtures — built by the OWNER. S-E01-1b CHANGED THE REASON, so the sentence is
// corrected rather than kept: `app_user` now holds `SELECT` on `tenant`
// (ADR-046 §D4) and still holds no INSERT there, and under GUC = A it could not
// write B's rows on any table anyway. "Never the owner" binds the ADVERSARIAL
// phase; it cannot bind the seed.
// ---------------------------------------------------------------------------

/**
 * The context one row is rendered with.
 *
 * `v` is 0 for the seeded fixture, 1 for the own-tenant INSERT probe and 2 for the
 * foreign-tenant INSERT probe; it drives both the suffix on every unique text
 * column and the choice of spare parent. `parentSlot` is what an FK points at,
 * and it differs from `slot` only for the FK-path foreign probe — where the ROW
 * is A-shaped but its PARENT belongs to B.
 */
function ctxFor({ slot, parentSlot, tenantLit, tag, v }) {
  return {
    slot,
    tag,
    v,
    t: tenantLit,
    probe: v > 0,
    sfx: v === 0 ? '' : `-p${v}`,
    id: (name) => lit(fid(parentSlot === undefined ? slot : parentSlot, SLOT[name])),
  };
}

function insertStatement(entry, c, pkValue) {
  const pairs = entry.columns(c);
  const columns = [entry.key, ...pairs.map(([name]) => name)];
  const values = [pkValue, ...pairs.map(([, value]) => value)];
  return `INSERT INTO ${entry.table} (${columns.join(', ')}) VALUES (${values.join(', ')})`;
}

function fixtureIdFor(entry, slot, v = 0) {
  if (typeof entry.pk === 'function') {
    return entry.pk(ctxFor({ slot, tenantLit: '', tag: '', v }));
  }
  return lit(fid(slot, entry.slot));
}

/** The seeded row for one table and one tenant. */
function fixtureInsert(entry, slot, tenantLit, tag) {
  const c = ctxFor({ slot, tenantLit, tag, v: 0 });
  return `${insertStatement(entry, c, fixtureIdFor(entry, slot, 0))};`;
}

/**
 * The SPARE and CHILDLESS parents.
 *
 * Written out rather than generated, because each one exists for a different
 * measured reason and a reader has to be able to see which.
 */
function earlySpareParents(slot, tenantLit, tag) {
  const id = (name) => lit(fid(slot, SLOT[name]));
  const t = tenantLit;
  return `
-- ${tag} · school2: CHILDLESS (no branding row). \`branding\`'s FK IS its primary
--        key, so an INSERT for a school that already has branding is refused by
--        the unique index; which error arrives first is an implementation detail
--        of ExecInsert and a proof must never depend on one.
INSERT INTO school (id, tenant_id, name, school_code, country, updated_at)
  VALUES (${id('school2')}, ${t}, 'School ${tag} spare', ${lit(`ADV-${tag}-SPARE`)}, 'FR', now());
-- ${tag} · user_profile2: CHILDLESS w.r.t. user_role, and the spare parent for
--        the four tables whose UNIQUE index is made only of NOT NULL FK columns.
INSERT INTO user_profile (id, tenant_id, first_name, last_name, email, updated_at)
  VALUES (${id('userProfile2')}, ${t}, 'Spare', ${lit(tag)}, ${lit(`spare-${tag}@adv.test`)}, now());
-- ${tag} · subject2 / student2: the other two spare parents.
INSERT INTO subject (id, tenant_id, school_id, code, name)
  VALUES (${id('subject2')}, ${t}, ${id('school')}, ${lit(`SUB-${tag}-SPARE`)}, 'Spare subject');
INSERT INTO student (id, tenant_id, school_id, first_name, last_name, updated_at) VALUES
  (${id('student2')}, ${t}, ${id('school')}, 'Spare', ${lit(tag)}, now()),
  (${id('student3')}, ${t}, ${id('school')}, 'Spare3', ${lit(tag)}, now());
`;
}

function lateSpareParents(slot, tenantLit, tag) {
  const id = (name) => lit(fid(slot, SLOT[name]));
  const t = tenantLit;
  return `
-- ${tag} · announcement2 / grade2 / importBatch2: CHILDLESS parents for the three
--        surrogate-key FK-derived tables, so their foreign-parent INSERT fails
--        for exactly ONE reason: the policy. They come AFTER the plan because they
--        hang off rows the plan itself creates (\`assessment\`, \`student2\`).
INSERT INTO announcement (id, tenant_id, school_id, title, body, scope, author_id, updated_at)
  VALUES (${id('announcement2')}, ${t}, ${id('school')}, 'Spare announcement', 'body', 'school_wide',
          ${id('userProfile')}, now());
INSERT INTO grade (id, tenant_id, assessment_id, student_id, entered_by, updated_at)
  VALUES (${id('grade2')}, ${t}, ${id('assessment')}, ${id('student2')}, ${id('userProfile')}, now());
INSERT INTO import_batch (id, tenant_id, school_id, type, file_name, updated_at)
  VALUES (${id('importBatch2')}, ${t}, ${id('school')}, 'students', ${lit(`adv-${tag}-spare.csv`)}, now());
`;
}

/**
 * The seed for one tenant, in FK order.
 *
 * `school` and `user_profile` come first because the EARLY spares hang off them,
 * and the early spares come before the rest of the plan because several plan rows
 * reference them (`conversation.teacher_id` is `user_profile2`). Getting this
 * wrong surfaces as a foreign-key violation in the FIXTURES — a red that costs an
 * hour and proves nothing about RLS, which is why the order is stated rather than
 * discovered.
 */
function fixturesForTenant(slot, tenantId, tag) {
  const t = lit(tenantId);
  const head = PLAN.slice(0, 2).map((entry) => fixtureInsert(entry, slot, t, tag));
  const rest = PLAN.slice(2).map((entry) => fixtureInsert(entry, slot, t, tag));
  return [
    head.join('\n'),
    earlySpareParents(slot, t, tag),
    rest.join('\n'),
    lateSpareParents(slot, t, tag),
  ].join('\n');
}

const FIXTURES_SQL = `
INSERT INTO tenant (id, name, slug, updated_at) VALUES
  (${lit(TENANT_A)}, 'Adversarial tenant A', 'adv-tenant-a', now()),
  (${lit(TENANT_B)}, 'Adversarial tenant B', 'adv-tenant-b', now());

-- ONE \`role\` row, SHARED by both tenants. \`role\` carries no \`tenant_id\`, so it
-- is reference data — and sharing it is what distinguishes a \`user_role\` policy
-- routed through \`user_profile_id\` (correct) from one routed through \`role_id\`
-- (the dead end of ADR-042 §D2): a row hanging off a shared role would be visible
-- to BOTH tenants, or to neither, and the assertions below would say so.
INSERT INTO role (id, name, slug) VALUES (${lit(SHARED_ROLE)}, 'Adversarial role', 'adv-role');
${fixturesForTenant(SLOT_A, TENANT_A, 'A')}
${fixturesForTenant(SLOT_B, TENANT_B, 'B')}
`;

// ---------------------------------------------------------------------------
// The phases
// ---------------------------------------------------------------------------

/** Every enumerated table's own row id, for one tenant. */
function rowIdFor(entry, slot) {
  return fixtureIdFor(entry, slot, 0);
}

/**
 * The column an FK-derived table's policy paths THROUGH, read from the sibling's
 * `DERIVED_TABLES` rather than re-typed here.
 *
 * The no-op UPDATE below assigns this column to itself: on a tenant-bearing table
 * `tenant_id = tenant_id` exercises USING *and* WITH CHECK on the discriminant
 * itself, and on a derived table the equivalent is the foreign key, because that
 * is the only thing the policy can read.
 */
/**
 * The primary key of the OWN-tenant INSERT probe row.
 *
 * One function, called by both the INSERT that creates the row and the DELETE
 * that removes it, so the two can never drift into addressing different rows.
 */
function ownProbePk(entry) {
  if (typeof entry.pk === 'function') {
    return entry.pk(ctxFor({ slot: SLOT_A, tenantLit: lit(TENANT_A), tag: 'A', v: 1 }));
  }
  return lit(fid(SLOT_A, entry.slot + OWN_PROBE_OFFSET));
}

function derivedFkColumn(table) {
  const entry = DERIVED_TABLES.find((d) => d.child === table);
  if (!entry) throw new Error(`no FK path is known for the derived table ${table}`);
  return entry.fk;
}

/**
 * PHASE 1 — WHOM DID IT CONNECT AS, and a FRESH connection with NO GUC.
 *
 * The identity assertions come before the first visibility query, over that very
 * connection: if the app DSN were ever pointed at the owner, every assertion in
 * every later phase would pass on a completely unprotected database.
 */
function identitySql(planner, ownerUser) {
  const lines = [
    RESULT_TABLE_SQL,
    `SELECT 'WHO|' || current_user;`,
    `SELECT 'OWNS|' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = current_user;`,
    `SELECT 'BYPASSRLS|' || rolbypassrls FROM pg_roles WHERE rolname = current_user;`,
    `SELECT 'IS_OWNER_ROLE|' || (current_user = ${lit(ownerUser)});`,
    `SELECT 'GUC_IS_NULL|' || (current_setting(${lit(TENANT_GUC)}, true) IS NULL);`,
  ];
  // AC-5 state (i): a FRESH connection, GUC NULL. Zero rows AND no error, on every
  // enumerated table — the "no error" half is what a bare cast without `nullif`
  // would break, and it breaks on the CHILD tables only.
  for (const entry of PLAN) {
    lines.push(planner.count(`FRESH_${entry.table}`, `SELECT count(*) FROM ${entry.table}`));
  }
  lines.push(EMIT_SQL);
  return lines.join('\n');
}

/**
 * PHASE 2 — the READ proof, in both directions, plus the two remaining no-GUC
 * states. One session, because the POOLED state (`GUC = ''` after a committed
 * `set_config(…, true)`) is only reachable on a connection that has already
 * served a transaction — and that is the STEADY STATE of every Prisma connection.
 */
function readSql(planner) {
  const lines = [RESULT_TABLE_SQL, 'BEGIN;', `SELECT set_config(${lit(TENANT_GUC)}, ${lit(TENANT_A)}, true);`];
  for (const entry of PLAN) {
    const own = rowIdFor(entry, SLOT_A);
    const foreign = rowIdFor(entry, SLOT_B);
    // POSITIVE CONTROL FIRST, ALWAYS. Without it the denial below is green on a
    // broken connection, an empty table or a revoked grant.
    lines.push(
      planner.count(`SEL_A_OWN_${entry.table}`, `SELECT count(*) FROM ${entry.table} WHERE ${entry.key} = ${own}`),
    );
    lines.push(
      planner.count(`SEL_A_FGN_${entry.table}`, `SELECT count(*) FROM ${entry.table} WHERE ${entry.key} = ${foreign}`),
    );
  }
  lines.push('COMMIT;');
  // AC-5 state (ii): the POOLED case. After a COMMITted `set_config(…, true)` the
  // custom GUC is '' and NOT NULL, so a bare `current_setting(…)::uuid` raises
  // 22P02 here. This is the second query of every pooled connection in production.
  lines.push(`SELECT 'POOLED_IS_NULL|' || (current_setting(${lit(TENANT_GUC)}, true) IS NULL);`);
  for (const entry of PLAN) {
    lines.push(planner.count(`POOLED_${entry.table}`, `SELECT count(*) FROM ${entry.table}`));
  }
  // AC-5 state (iii): the empty string set EXPLICITLY.
  lines.push(`SET ${TENANT_GUC} = '';`);
  for (const entry of PLAN) {
    lines.push(planner.count(`EMPTY_${entry.table}`, `SELECT count(*) FROM ${entry.table}`));
  }
  // The MIRRORED direction. Without it, a policy that denies everything to
  // everyone is indistinguishable from one that isolates.
  lines.push('BEGIN;', `SELECT set_config(${lit(TENANT_GUC)}, ${lit(TENANT_B)}, true);`);
  for (const entry of PLAN) {
    const own = rowIdFor(entry, SLOT_B);
    const foreign = rowIdFor(entry, SLOT_A);
    lines.push(
      planner.count(`SEL_B_OWN_${entry.table}`, `SELECT count(*) FROM ${entry.table} WHERE ${entry.key} = ${own}`),
    );
    lines.push(
      planner.count(`SEL_B_FGN_${entry.table}`, `SELECT count(*) FROM ${entry.table} WHERE ${entry.key} = ${foreign}`),
    );
  }
  lines.push('COMMIT;', EMIT_SQL);
  return lines.join('\n');
}

/**
 * PHASE 3 — the WRITE proof: INSERT, UPDATE and DELETE, positive control first.
 *
 * The WHOLE phase runs inside ONE transaction that is ROLLED BACK, and the
 * results are emitted BEFORE the rollback. That is not tidiness: `ON DELETE
 * CASCADE` is on all 100 FK edges, so a positive-control DELETE on A's `school`
 * empties A's fixture and every assertion after it goes green because the row is
 * GONE. Rolling back also means the own-tenant INSERT probes never persist, so no
 * later phase can trip over a row this one created.
 *
 * The DELETE probes run in REVERSE plan order — leaves first — so that even
 * WITHIN the transaction no cascade can precede an assertion that depends on the
 * row it would remove.
 */
function writeSql(planner) {
  const lines = [RESULT_TABLE_SQL, 'BEGIN;', `SELECT set_config(${lit(TENANT_GUC)}, ${lit(TENANT_A)}, true);`];

  // --- INSERT: own-tenant accepted (positive control), foreign REJECTED. ---
  for (const entry of PLAN) {
    const ownCtx = ctxFor({ slot: SLOT_A, tenantLit: lit(TENANT_A), tag: 'A', v: 1 });
    lines.push(planner.exec(`INS_A_OWN_${entry.table}`, insertStatement(entry, ownCtx, ownProbePk(entry))));

    // The foreign INSERT. For a tenant-BEARING table the row carries B's tenant
    // id; for an FK-DERIVED table there is no tenant column at all, so the row
    // instead hangs off B's CHILDLESS parent — the only thing standing between a
    // caller and a cross-tenant write there is the EXISTS subquery.
    const foreignCtx = entry.derived
      ? ctxFor({ slot: SLOT_A, parentSlot: SLOT_B, tenantLit: lit(TENANT_B), tag: 'B', v: 2 })
      : ctxFor({ slot: SLOT_A, tenantLit: lit(TENANT_B), tag: 'A', v: 2 });
    const foreignPk =
      typeof entry.pk === 'function'
        ? entry.pk(entry.derived ? foreignCtx : ctxFor({ slot: SLOT_B, tenantLit: lit(TENANT_B), tag: 'B', v: 2 }))
        : lit(fid(SLOT_A, entry.slot + FOREIGN_PROBE_OFFSET));
    lines.push(planner.exec(`INS_A_FGN_${entry.table}`, insertStatement(entry, foreignCtx, foreignPk)));
  }

  // --- UPDATE: a no-op self-assignment on the RLS-bearing column. It exercises
  //     USING *and* WITH CHECK without needing a per-table nullable column, and
  //     for a derived table the column is the FK the policy paths through.
  for (const entry of PLAN) {
    const column = entry.derived ? derivedFkColumn(entry.table) : 'tenant_id';
    const own = rowIdFor(entry, SLOT_A);
    const foreign = rowIdFor(entry, SLOT_B);
    lines.push(
      planner.exec(
        `UPD_A_OWN_${entry.table}`,
        `UPDATE ${entry.table} SET ${column} = ${column} WHERE ${entry.key} = ${own}`,
      ),
    );
    lines.push(
      planner.exec(
        `UPD_A_FGN_${entry.table}`,
        `UPDATE ${entry.table} SET ${column} = ${column} WHERE ${entry.key} = ${foreign}`,
      ),
    );
  }

  // --- DELETE, leaves first, and the positive control targets the row the INSERT
  //     phase just created rather than the fixture row.
  //
  //     THAT IS A MEASUREMENT AND NOT A CONVENIENCE. `ON DELETE CASCADE` is NOT
  //     universal in this schema: deleting A's fixture `school`, `user_profile`,
  //     `academic_year`, `cycle`, `grade_level` or `class_section` is refused with
  //     SQLSTATE 23503 by a RESTRICTing child. A fixture-row positive control
  //     therefore cannot mean "A's own rows are deletable" on those six — it means
  //     "this table happens to have no restricting child today", which is a fact
  //     about referential actions and not about RLS.
  //
  //     The own-INSERT probe row is a LEAF by construction — every other probe row
  //     hangs off a fixture or spare parent, never off another probe row — so
  //     deleting it isolates exactly the question AC-2(c) asks: does the policy let
  //     this role remove a row of its OWN tenant, and refuse one of the other's?
  //     The denial still targets B's FIXTURE row, where USING filters the row away
  //     before any referential action is considered (measured: 0 rows, no 23503).
  for (const entry of [...PLAN].reverse()) {
    const foreign = rowIdFor(entry, SLOT_B);
    lines.push(
      planner.exec(`DEL_A_FGN_${entry.table}`, `DELETE FROM ${entry.table} WHERE ${entry.key} = ${foreign}`),
    );
    lines.push(
      planner.exec(
        `DEL_A_OWN_${entry.table}`,
        `DELETE FROM ${entry.table} WHERE ${entry.key} = ${ownProbePk(entry)}`,
      ),
    );
  }

  // Emitted BEFORE the rollback: `adv_result` is a TEMP table and therefore
  // transactional, so a ROLLBACK would take the evidence with it.
  lines.push(EMIT_SQL, 'ROLLBACK;');
  return lines.join('\n');
}

/**
 * AC-6 — THE HONEST INVENTORY, as a POSITIVE assertion of the leak.
 *
 * Not a printed caveat: an assertion that the leak is PRESENT goes red the day
 * someone adds `FORCE ROW LEVEL SECURITY`, which is the correct alarm. The
 * owner-side fixture recount in the same script is failure mode 4's detector.
 */
function ownerSql() {
  const lines = [
    '\\pset footer off',
    `SELECT 'OWNER_WHO|' || current_user;`,
    'BEGIN;',
    `SELECT set_config(${lit(TENANT_GUC)}, ${lit(TENANT_A)}, true);`,
    `SELECT 'OWNER_CTX_A_FOREIGN_school|' || count(*) FROM school WHERE id = ${rowIdFor(PLAN[0], SLOT_B)};`,
    `SELECT 'OWNER_CTX_A_FOREIGN_user_profile|' || count(*) FROM user_profile WHERE id = ${rowIdFor(PLAN[1], SLOT_B)};`,
    'COMMIT;',
  ];
  // Failure mode 4 — the fixture is re-counted AFTER the adversarial phases. Any
  // drift means a cascade escaped the rolled-back transaction.
  for (const entry of PLAN) {
    lines.push(
      `SELECT 'FIXTURE_A_${entry.table}|' || count(*) FROM ${entry.table} WHERE ${entry.key} = ${rowIdFor(entry, SLOT_A)};`,
    );
    lines.push(
      `SELECT 'FIXTURE_B_${entry.table}|' || count(*) FROM ${entry.table} WHERE ${entry.key} = ${rowIdFor(entry, SLOT_B)};`,
    );
  }
  return lines.join('\n');
}

/** The owner-side existence proof, run BEFORE the adversarial phases (AC-11). */
function seedCensusSql() {
  return PLAN.map(
    (entry) =>
      `SELECT 'SEED_${entry.table}|' ||\n` +
      `  (SELECT count(*) FROM ${entry.table} WHERE ${entry.key} = ${rowIdFor(entry, SLOT_A)}) || ':' ||\n` +
      `  (SELECT count(*) FROM ${entry.table} WHERE ${entry.key} = ${rowIdFor(entry, SLOT_B)});`,
  ).join('\n');
}

// ---------------------------------------------------------------------------
// AC-9 — CUTOVER READINESS. A green isolation verdict must not print without it.
// ---------------------------------------------------------------------------

/** Every `.ts` file under a production source root, specs excluded. */
function sourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(full);
        continue;
      }
      if (extname(entry.name) !== '.ts') continue;
      if (/\.(spec|test|e2e-spec)\.ts$/.test(entry.name)) continue;
      out.push(full);
    }
  };
  try {
    if (statSync(root).isDirectory()) walk(root);
  } catch {
    /* an absent root is reported by the caller as a zero, never swallowed */
  }
  return out;
}

/** `outbox_event` -> `outboxEvent`, the name Prisma's client exposes. */
function prismaModelName(table) {
  return table.replace(/_([a-z0-9])/g, (_m, ch) => String(ch).toUpperCase());
}

// ---------------------------------------------------------------------------
// S-E01-1c / TOOL-32 — AC-9 becomes VERB-AWARE and RECEIVER-AWARE.
//
// THE DEFECT THIS CLOSES, measured before it was written. The block below used
// to ask ONE question: "does production code mention a table that holds NO grant
// row at all?" A table granted `SELECT` and WRITTEN by production code passed —
// which is exactly the state `role` and `role_permission` were in after
// `S-E01-1b`, i.e. the very PF-193 the current slice exists to close. The check
// built to say "the cutover is safe" was blind to the only blocker on its path.
//
// AND IT WAS AIMED AT THE WRONG TOKEN. The anchor was `\bprisma\.`, measured
// against the corpus: 722 `prisma.<model>.<verb>` sites and 86 `tx.<model>.<verb>`
// sites. ALL FIVE PF-193 writes are `tx.` calls (they are inside
// `$transaction(async (tx …)`), as is `tx.tenant.upsert` (PF-185). A verb-aware
// classifier on the old anchor would have returned ZERO of them.
// ---------------------------------------------------------------------------

/**
 * The receivers a Prisma model call can be reached through, as a NAMED CONSTANT
 * rather than a regex buried in a scan.
 *
 * `tx` is not a guess: it is the ONLY transaction-callback identifier in the
 * corpus (measured, 47/47 matches of `$transaction(async (tx`), and the scan
 * below REPORTS any other alias it finds instead of silently ignoring it — the
 * difference between a closed set and a hopeful one.
 */
const PRISMA_RECEIVERS = Object.freeze(['prisma', 'this.prisma', 'tx']);

/** Built from the constant, so adding a receiver is one edit and not two. */
const PRISMA_CALL_SITE_RE = new RegExp(
  `(?<![.\\w])(?:${PRISMA_RECEIVERS.map((r) => r.replace(/\./g, '\\.')).join('|')})` +
    '\\.([A-Za-z][A-Za-z0-9_]*)\\.([A-Za-z][A-Za-z0-9_]*)',
  'g',
);

/**
 * S-E01-1e — THE RECEIVERS THAT ARE THE SCOPE'S OWN TRANSACTION CLIENT.
 *
 * `PRISMA_CALL_SITE_RE` matches `prisma.`, `this.prisma.` and `tx.` identically,
 * and `covers()` is purely POSITIONAL. So until this constant existed, a site
 * written `this.scope.run(id, async (tx) => { await this.prisma.grade.findMany() })`
 * counted as SCOPED — the hard rule "inside the callback use `tx`, never
 * `this.prisma`" was unenforced by the only mechanism that reports the number.
 *
 * That is not a cosmetic gap: it is the DANGEROUS INVERSE of PF-200. The
 * statement runs on the OWNER connection, which escapes its own policies, while
 * the counter credits it to the callback. A half-converted handler produces a
 * HIGHER scoped count than a correct one, so the metric moves in the wrong
 * direction exactly when the code is wrong.
 *
 * An owner receiver inside a scope is therefore counted UNCOVERED and REPORTED
 * BY NAME — never scoped, and never quietly enumerated either.
 */
const SCOPE_SAFE_RECEIVERS = Object.freeze(['tx']);

/**
 * The attribution of ONE call site, as a PURE function so the gate spec drives
 * all four outcomes without a repository scan.
 *
 * ORDER IS THE PROPERTY: the owner-receiver check runs BEFORE the enumeration,
 * so a scope-covered `this.prisma.` site can never be laundered into the
 * enumerated column by a file that happens to be allow-listed.
 */
function classifyCallSite(receiver, { covered, enumerated }) {
  if (covered) return SCOPE_SAFE_RECEIVERS.includes(receiver) ? 'scoped' : 'owner-inside-scope';
  return enumerated ? 'enumerated' : 'uncovered';
}

/** Transaction callbacks whose parameter is NOT in `PRISMA_RECEIVERS`. */
const TRANSACTION_ALIAS_RE = /\$transaction\s*\(\s*async\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;

/** Raw SQL, which carries no model and no verb and therefore no classification. */
const RAW_SQL_RE = /\$(?:execute|query)Raw(?:Unsafe)?\s*[(`]/g;

// ---------------------------------------------------------------------------
// S-E01-1d (b) — AC-9's UNIT CHANGES: from "how many times does the string
// `.withTenant(` appear" to "how many Prisma call sites sit INSIDE a tenant
// scope, and is every site outside one ENUMERATED with a reason".
//
// WHY THE OLD UNIT WAS WRONG, AND THE SHIPPED CODE PROVES IT
// ----------------------------------------------------------
// `withTenantCallers += (text.match(/\.withTenant\s*\(/g) ?? []).length` counted
// SCOPE OPENINGS, not COVERED SITES. `calendar.controller.ts` opens FOUR scopes
// that between them cover SIX Prisma call sites, so the old counter under-reports
// by construction — and it under-reports in the direction that makes a converted
// module look less converted than it is, which is the direction that eventually
// gets "fixed" by widening a matcher. It is replaced here by attribution:
// brace-match each scope callback's byte range, and a call site whose index falls
// inside one is covered.
//
// Everything below is PURE — text in, numbers out, no database and no repository
// scan — so `tenant-adversarial-gate.spec.ts` drives every branch, including the
// ones that only occur on pathological source.
// ---------------------------------------------------------------------------

/**
 * The receivers whose `.run(` OPENS a tenant scope. A CLOSED set, and the reason
 * it must be closed was measured on this corpus rather than imagined.
 *
 * `\.(?:withTenant|run)\s*\(` alone matches ANY `.run(`. There are five in the
 * tree today: four `this.scope.run(` in `calendar.controller.ts` — the real ones
 * — and **`store.run(` in `tenant-scope.ts:89` itself**, the `AsyncLocalStorage`
 * call the seam is built on. No Prisma site sits inside that one today, so
 * coverage is unaffected today. Tomorrow a `this.queue.run(async () => { await
 * this.prisma.x.findMany() })` would silently manufacture coverage on the OWNER
 * connection — a green produced by a refactor in an unrelated module.
 *
 * So the receiver is CAPTURED and compared, and every other `.run(` receiver is
 * REPORTED, exactly as `TRANSACTION_ALIAS_RE` / `foreignReceivers` already does
 * for transaction aliases. A hopeful set would be the defect; a closed set that
 * prints what it rejected is the control.
 *
 * `.withTenant(` needs no receiver check: it is `PrismaService`'s own method and
 * nothing else in the tree carries the name.
 */
const SCOPE_RECEIVERS = Object.freeze(['scope', 'this.scope', 'tenantScope', 'this.tenantScope']);

/** `<dotted.receiver>.withTenant(` / `<dotted.receiver>.run(`, receiver captured. */
const SCOPE_OPENING_RE =
  /(?<![.\w$])((?:[A-Za-z_$][A-Za-z0-9_$]*\s*\.\s*)*[A-Za-z_$][A-Za-z0-9_$]*)\s*\.\s*(withTenant|run)\s*\(/g;

/**
 * Where a `/` may legally begin a REGEX LITERAL rather than a division.
 *
 * This is the standard preceding-token heuristic, and it is here for one reason:
 * a `(` or `)` inside a regex literal must not move the brace matcher's depth.
 * The failure it prevents is not cosmetic — see `matchingParen`.
 */
function startsRegexLiteral(previousSignificant) {
  return previousSignificant === '' || '(,=:[!&|?{};+-*%^~<>'.includes(previousSignificant);
}

/** The closing quote of a `'…'` / `"…"` literal, or -1 if it does not close. */
function skipQuoted(text, start, quote) {
  for (let i = start + 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === quote) return i;
    // A newline inside a single/double-quoted literal means the lexer has lost
    // its place. Bail rather than run to EOF: see `matchingParen`'s fail-closed
    // rule.
    if (c === '\n') return -1;
  }
  return -1;
}

/** The closing `/` of a regex literal, character classes included, or -1. */
function skipRegexLiteral(text, start) {
  for (let i = start + 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '[') {
      // Inside a character class `/` and `)` are literal and `]` is the exit.
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === '\\') {
          i += 1;
          continue;
        }
        if (text[i] === ']') break;
        if (text[i] === '\n') return -1;
      }
      continue;
    }
    if (c === '/') return i;
    if (c === '\n') return -1;
  }
  return -1;
}

/** The closing backtick of a template literal, `${…}` substitutions included. */
function skipTemplateLiteral(text, start) {
  for (let i = start + 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '`') return i;
    if (c === '$' && text[i + 1] === '{') {
      let depth = 1;
      i += 2;
      for (; i < text.length; i += 1) {
        const d = text[i];
        if (d === '\\') {
          i += 1;
          continue;
        }
        if (d === '`') {
          const end = skipTemplateLiteral(text, i);
          if (end === -1) return -1;
          i = end;
          continue;
        }
        if (d === "'" || d === '"') {
          const end = skipQuoted(text, i, d);
          if (end === -1) return -1;
          i = end;
          continue;
        }
        if (d === '{') depth += 1;
        else if (d === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (i >= text.length) return -1;
      continue;
    }
  }
  return -1;
}

/**
 * The index of the `)` matching the `(` at `openIndex`, or **-1**.
 *
 * A NAIVE DEPTH COUNTER OVER RAW TEXT IS NOT SAFE HERE, and the unsafe direction
 * is the silent one:
 *
 *  - a `)` inside a string closes the range EARLY, so sites really inside it are
 *    reported uncovered — noisy, and therefore self-correcting;
 *  - a `(` inside a string, a regex or a comment NEVER closes, so the range runs
 *    to END OF FILE and **every remaining Prisma call site in that file counts as
 *    covered**. That is mass phantom coverage, expressed as a number, which no
 *    reviewer sees. It is a manufactured green with no author.
 *
 * So strings, template literals (including `${…}`), regex literals and both
 * comment forms are skipped, and an unbalanced result is **-1** rather than a
 * guess. The caller's rule for -1 is FAIL-CLOSED: the file is REPORTED and every
 * site in it counts UNCOVERED. Under-reporting coverage is a limit; over-reporting
 * it is a lie.
 */
function matchingParen(text, openIndex) {
  let depth = 0;
  let previousSignificant = '';
  for (let i = openIndex; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const eol = text.indexOf('\n', i);
      if (eol === -1) return -1;
      i = eol;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = skipQuoted(text, i, c);
      if (end === -1) return -1;
      i = end;
      previousSignificant = c;
      continue;
    }
    if (c === '`') {
      const end = skipTemplateLiteral(text, i);
      if (end === -1) return -1;
      i = end;
      previousSignificant = '`';
      continue;
    }
    if (c === '/' && startsRegexLiteral(previousSignificant)) {
      const end = skipRegexLiteral(text, i);
      if (end !== -1) {
        i = end;
        previousSignificant = '/';
        continue;
      }
    }
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
    if (!/\s/.test(c)) previousSignificant = c;
  }
  return -1;
}

/**
 * Every tenant-scope callback's byte range in one file, PURE.
 *
 * Returns `{ ranges, foreignScopeReceivers, unbalanced }`. `unbalanced > 0` is
 * the fail-closed signal described on `matchingParen`.
 */
function scopeCallbackRanges(text) {
  const ranges = [];
  const foreignScopeReceivers = new Map();
  let unbalanced = 0;
  for (const match of text.matchAll(SCOPE_OPENING_RE)) {
    const receiver = String(match[1]).replace(/\s+/g, '');
    const verb = match[2];
    if (verb === 'run' && !SCOPE_RECEIVERS.includes(receiver)) {
      const key = `${receiver}.run`;
      foreignScopeReceivers.set(key, (foreignScopeReceivers.get(key) ?? 0) + 1);
      continue;
    }
    // The regex ends with `\(`, so the opening parenthesis is the match's last
    // character. Nothing is re-searched for, so nothing can drift.
    const open = match.index + match[0].length - 1;
    const close = matchingParen(text, open);
    if (close === -1) {
      unbalanced += 1;
      continue;
    }
    ranges.push({ start: open, end: close });
  }
  return { ranges, foreignScopeReceivers, unbalanced };
}

/**
 * `apps/api/src/**` -> a regex over the repository-relative, forward-slashed path.
 *
 * `**` crosses directory separators, `*` does not. Everything else is escaped, so
 * a `.` in a filename is a `.` and not "any character" — the difference between
 * enumerating `user-sync.service.ts` and enumerating `user-syncXservice.ts` too.
 */
function globToRegExp(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
      } else {
        out += '[^/]*';
      }
      continue;
    }
    out += /[a-zA-Z0-9_/-]/.test(c) ? c : `\\${c}`;
  }
  return new RegExp(out + '$');
}

/**
 * THE ENUMERATION — the file globs whose Prisma call sites are legitimately
 * OUTSIDE any tenant scope, **each with the reason it is outside one**.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE TRAP THIS CONSTANT IS THE ENTRANCE TO                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The affirmative branch fires when `scoped + enumerated === total`. There are
 * therefore TWO ways to reach it: convert call sites, or widen this list. The
 * second is free, invisible in a diff summary, and produces exactly the green a
 * reviewer is looking for. **It is the manufactured green, and it is the failure
 * mode of this whole block.**
 *
 * The discipline that makes the list safe is that it is a list of REASONS, not a
 * list of paths. **"Not converted yet" is not a reason — it belongs in the
 * uncovered count.** Every entry below names a property of the code that makes a
 * tenant scope *impossible* or *wrong*, not merely absent. `cutoverVerdict`
 * enforces the shape (an entry without a reason string makes the verdict
 * UNREASONED, which fails), and `tenant-adversarial-gate.spec.ts` carries a
 * mutant that inflates the enumeration to close the gap without covering
 * anything and asserts the verdict is not affirmative.
 *
 * It is deliberately NOT a directory sweep. `apps/api/src/shared/**` would
 * enumerate the identity seam and forty unrelated files with it.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ S-E01-1e / PF-199 / ADR-051 §D2 — THE UNIT SPLITS IN TWO                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The list above carried ONE reason per GLOB, and that coarseness failed in the
 * SILENT direction. `user-sync.service.ts` excused 5 statements the day it was
 * written and excuses whatever that file contains TOMORROW: a sixth, unrelated
 * query added to it is excused with **no diff to the enumeration at all** — the
 * manufactured green this very block exists to refuse, reproduced one level
 * down.
 *
 * So `kind` is now MANDATORY, and there are exactly two:
 *
 *  - **`'surface'`** — a whole-tree property. The reason is true of every
 *    statement in the tree BY CONSTRUCTION ("the worker has no request tenant",
 *    "boot runs before any request exists"), so enumerating statement by
 *    statement would be ceremony, not evidence. Reserved for boot globs and
 *    `apps/worker/src/**`. A `surface` entry naming a single `.ts` FILE under
 *    `apps/api/src/modules/**` FAILS: that is the discretion a converting module
 *    would otherwise use to hide behind the coarse kind.
 *  - **`'bootstrap'`** — identity/context resolution. The reason is a property of
 *    a SPECIFIC statement, so every statement is named with its OWN reason, and
 *    the declared multiset is compared for EQUALITY against what the scan
 *    observes (`enumerationDrift`). An unlisted statement FAILS; a dead entry
 *    FAILS; a statement without a reason FAILS.
 *
 * BOTH SIDES ARE DERIVED FROM THE SAME MATCHER, and that is the house rule
 * ("derive both sides and compare"), not a stylistic preference. It has one
 * honest consequence worth stating rather than hiding: `PRISMA_CALL_SITE_RE` is
 * a TEXT matcher, and `user-sync.service.ts` holds a DOCBLOCK reference to
 * `shared/prisma/prisma.service.ts:52-56` that it counts as a call site
 * (`service.ts`). It is declared below AS an artifact, with the reason saying so.
 * Declaring what the matcher actually sees is the only way the two sides can be
 * compared at all; quietly excluding it would be a second, hidden list.
 *
 * NO RATIO FLOOR. `cutoverVerdict`'s `scoped + enumerated === total` wall is
 * untouched — only the VALIDATION of the enumeration got finer. A floor is a
 * knob and a knob here is a bypass flag wearing a different hat (DNC-10). The
 * ledger paragraph asking for one is stale and was already overruled by the
 * shipped comment on `cutoverVerdict`.
 */
const ENUMERATED_OUTSIDE_SCOPE = Object.freeze([
  // ── LAYER A — STRUCTURAL. File globs, because the reason is a property of
  //    the whole tree and is true of every statement in it by construction.
  Object.freeze({
    kind: 'surface',
    glob: 'apps/api/src/main.ts',
    reason: 'bootstrap: runs before any request exists, so there is no tenant to scope to',
  }),
  Object.freeze({
    kind: 'surface',
    glob: 'apps/api/src/shared/config/config-preflight.ts',
    reason: 'bootstrap: preflight decides whether the process may serve at all, before any tenant',
  }),
  Object.freeze({
    kind: 'surface',
    glob: 'apps/api/src/shared/migrations/**',
    reason:
      'migration-state reader: `assertMigrationsClean` runs at boot and the health probe reads it on ' +
      'every call — it must answer while the tenant scope is degraded or refused',
  }),
  Object.freeze({
    kind: 'surface',
    glob: 'apps/api/src/shared/release/**',
    reason:
      'release-manifest reader: same obligation as the migration state — it must answer when the ' +
      'second connection is refused, which is precisely when someone is reading it',
  }),
  Object.freeze({
    kind: 'surface',
    glob: 'apps/api/src/modules/health/**',
    reason: 'health: a liveness answer that needs a working tenant scope is not a liveness answer',
  }),
  Object.freeze({
    kind: 'surface',
    glob: 'apps/worker/src/**',
    reason:
      'the worker has no request tenant: a job carries its tenant in its payload, and converting ' +
      'that seam is its own slice (touchesWorker false here)',
  }),

  // ── LAYER B — IDENTITY. One entry per STATEMENT, each with its OWN reason,
  //    ratcheted by set equality against the scan (`enumerationDrift`).
  Object.freeze({
    kind: 'bootstrap',
    glob: 'apps/api/src/shared/auth/user-sync.service.ts',
    reason:
      'PF-199 — IT RESOLVES THE TENANT. `ensureUser` reads `user_profile` from the Keycloak `sub` ' +
      'to PRODUCE the tenantId a scope would need; a scope cannot be opened before its own key exists',
    statements: Object.freeze([
      Object.freeze({
        model: 'userProfile',
        verb: 'findUnique',
        reason:
          'the `sub` -> profile lookup itself: inside a scope on app_user with no GUC it returns ZERO ' +
          'rows and every authenticated request of every portal answers 403 ACCOUNT_NOT_PROVISIONED',
      }),
      Object.freeze({
        model: 'userProfile',
        verb: 'findMany',
        reason:
          'the e-mail collision sweep that decides whether this `sub` is a RE-LINK of an existing ' +
          'profile — it must read across the profiles no tenant has been chosen for yet',
      }),
      Object.freeze({
        model: 'userProfile',
        verb: 'update',
        reason:
          'writes the resolved `keycloakId` back onto the profile it just linked; the tenant it would ' +
          'scope to is the value this very statement establishes',
      }),
      Object.freeze({
        model: 'userProfile',
        verb: 'findUnique',
        reason:
          'the re-read that confirms the link took, on the same pre-tenant path as the lookup above ' +
          '(second occurrence: the two are declared separately because the unit here is the STATEMENT)',
      }),
      Object.freeze({
        model: 'service',
        verb: 'ts',
        reason:
          'NOT A STATEMENT — a MATCHER ARTIFACT, declared because both sides of this ratchet are ' +
          'derived by the same text matcher and hiding it would be a second, invisible list. It is a ' +
          'docblock cross-reference to `shared/prisma/prisma.service.ts:52-56` that ' +
          '`PRISMA_CALL_SITE_RE` reads as `prisma.service.ts`. Recorded as PF-219: the corpus total ' +
          'is inflated by prose, and the matcher cannot currently tell code from a comment',
      }),
    ]),
  }),
  Object.freeze({
    kind: 'bootstrap',
    glob: 'apps/api/src/modules/school-structure/school-context.service.ts',
    reason:
      'PF-199 — `forTenant` resolves the school context a request runs in; same ordering constraint ' +
      'as `ensureUser`, one layer down',
    statements: Object.freeze([
      Object.freeze({
        model: 'school',
        verb: 'findFirst',
        reason:
          '`forTenant` picks the school a request runs in; it is the input to the scope, so it cannot ' +
          'be issued from within one',
      }),
      Object.freeze({
        model: 'academicYear',
        verb: 'findFirst',
        reason:
          'resolves the ACTIVE academic year for that school in the same pre-scope breath — the ' +
          'callers of `forTenant` destructure both from one call',
      }),
      Object.freeze({
        model: 'school',
        verb: 'findFirst',
        reason:
          'the explicit-`schoolId` branch: validates a caller-supplied school against the tenant ' +
          'before any scope exists (second occurrence, declared per statement)',
      }),
      Object.freeze({
        model: 'school',
        verb: 'findMany',
        reason:
          'the school PICKER for a multi-school tenant: it must list the choices before the request ' +
          'has a school, therefore before it has the context a scope is opened on',
      }),
    ]),
  }),
  Object.freeze({
    kind: 'bootstrap',
    glob: 'apps/api/src/modules/students/student-access.service.ts',
    reason:
      'PF-199 — `scopeForUser` resolves the ABAC scope itself; calling it from inside a scope would ' +
      'hold an owner connection AND an app connection for the transaction’s duration',
    statements: Object.freeze([
      Object.freeze({
        model: 'guardianship',
        verb: 'findMany',
        reason:
          'resolves WHICH students a parent may see — the ABAC scope itself. A scope cannot be the ' +
          'consumer of the boundary it is being opened to enforce',
      }),
      Object.freeze({
        model: 'student',
        verb: 'findFirst',
        reason:
          'the single-student check on the same pre-scope path; converting it alone would split one ' +
          'ABAC decision across two connections',
      }),
    ]),
  }),
  Object.freeze({
    kind: 'bootstrap',
    glob: 'apps/api/src/modules/teaching/teacher-profile.service.ts',
    reason:
      'PF-199 / S-E01-1e — THE SECOND IDENTITY RESOLVER, and it was MISSING from this list. It ' +
      'resolves `teacherProfileId` from a user profile and it WRITES while doing so; inside a scope ' +
      'it would silently issue on the OWNER connection while the app connection holds an open ' +
      'interactive transaction — the dangerous inverse of PF-200, invisible to any compile-time guard',
    statements: Object.freeze([
      Object.freeze({
        model: 'teacherProfile',
        verb: 'findUnique',
        reason:
          '`ensureForUser`’s hot path: the profile lookup by `userProfileId`, carrying no tenant ' +
          'predicate because the caller has not resolved one yet',
      }),
      Object.freeze({
        model: 'userProfile',
        verb: 'findUnique',
        reason:
          'reads the user’s `preferences` to pick a home school — a second identity read on the ' +
          'same pre-scope path',
      }),
      Object.freeze({
        model: 'school',
        verb: 'findFirst',
        reason: 'the PREFERRED-school branch: resolves the school the new teacher profile attaches to',
      }),
      Object.freeze({
        model: 'school',
        verb: 'findFirst',
        reason:
          'the FALLBACK branch (oldest school in the tenant) when no preference is set — declared ' +
          'separately because the unit here is the statement, not the model',
      }),
      Object.freeze({
        model: 'teacherProfile',
        verb: 'upsert',
        reason:
          'AUTO-PROVISIONS the profile. An INSERT cannot sit inside an interactive tenant transaction ' +
          'whose key it is still resolving, and under a GUC the pre-existing row it races against is ' +
          'INVISIBLE — the upsert would raise P2002 on a row the connection cannot see',
      }),
      Object.freeze({
        model: 'teacherProfile',
        verb: 'findFirst',
        reason:
          'S-E01-1e / ADR-051 §D1 — `findForUser`, the READ-ONLY resolver the converted lessons ' +
          'handlers use for their ownership comparison. Read-only precisely so that hoisting the ' +
          'resolution ahead of the 404 guard cannot put an unaudited write on a REFUSAL path',
      }),
      Object.freeze({
        model: 'teacherProfile',
        verb: 'findUnique',
        reason:
          '`getById`: the admin-facing lookup by profile id with its own tenant comparison, on the ' +
          'same owner connection as the rest of this service',
      }),
    ]),
  }),
  Object.freeze({
    kind: 'bootstrap',
    glob: 'apps/api/src/modules/calendar/calendar-seed.service.ts',
    reason:
      'PF-198 — it opens its OWN `$transaction` for a bulk import plus its audit row; it cannot nest ' +
      'inside an interactive transaction and would not compile against `Prisma.TransactionClient`',
    statements: Object.freeze([
      Object.freeze({
        model: 'academicYear',
        verb: 'findMany',
        reason:
          'reads the years the holidays are seeded into, BEFORE the seed transaction opens — the plan ' +
          'is computed outside the write it plans',
      }),
      Object.freeze({
        model: 'calendarEvent',
        verb: 'createMany',
        reason:
          'the bulk import itself, inside this service’s OWN `$transaction`; nesting it in an ' +
          'interactive tenant scope would take a second pool connection with no GUC on it',
      }),
      Object.freeze({
        model: 'auditLog',
        verb: 'create',
        reason:
          'the ONE audit row that must commit atomically with the import — it belongs to the seed’s ' +
          'own transaction, and moving it out would make the audit trail lie on a rollback',
      }),
    ]),
  }),
]);

/** The two enumeration kinds, as a named closed set rather than two string literals. */
const ENUMERATION_KINDS = Object.freeze(['surface', 'bootstrap']);

/**
 * ADR-051 §D2 — THE STATEMENT-LEVEL RATCHET, as a PURE function so the gate spec
 * drives every branch with no repository scan and no database.
 *
 * `observedByGlob` maps `glob -> Map<'model.verb', count>` — built by the scan
 * from the SAME `PRISMA_CALL_SITE_RE` the coverage arithmetic uses. The declared
 * side is hand-written (a REASON cannot be derived). Comparing the two as
 * MULTISETS is what makes the ratchet bite in both directions:
 *
 *  - a statement the scan sees and the list does not  -> `undeclared-statement`
 *  - an entry the list holds and the scan never sees  -> `dead-entry`
 *  - a statement with a blank / missing reason        -> `statement-without-reason`
 *  - a missing or unknown `kind`                      -> `unknown-kind` (fail-closed)
 *  - a `surface` entry pointing at ONE module file    -> `surface-hides-a-module-file`
 *
 * MULTISET, not set: `teacher_profile.findUnique` legitimately occurs twice in
 * one file, and collapsing duplicates would let a SECOND copy of an already
 * declared statement slip in unremarked — which is the exact silent direction
 * the file-level unit failed in.
 *
 * Returns a LIST of findings, never a boolean: the caller must be able to NAME
 * what drifted, and a ratchet that only says "no" gets deleted the first time it
 * fires on a Friday.
 */
function enumerationDrift(declared, observedByGlob) {
  const findings = [];
  const entries = Array.isArray(declared) ? declared : [];
  for (const entry of entries) {
    const glob = entry && typeof entry === 'object' ? String(entry.glob) : String(entry);
    const kind = entry && typeof entry === 'object' ? entry.kind : undefined;
    if (!ENUMERATION_KINDS.includes(kind)) {
      findings.push({
        glob,
        kind: 'unknown-kind',
        detail:
          `kind ${JSON.stringify(kind)} is not one of {${ENUMERATION_KINDS.join(', ')}}. An entry whose ` +
          'kind is missing is unclassifiable, therefore refused (DNC-08) — never defaulted to the ' +
          'coarse kind, which is the one that excuses future statements for free',
      });
      continue;
    }
    if (kind === 'surface') {
      if (entry.statements !== undefined) {
        findings.push({
          glob,
          kind: 'surface-with-statements',
          detail:
            'a `surface` entry declares a WHOLE-TREE property and must not carry `statements`: two ' +
            'units in one entry is how the two sides start drifting again',
        });
      }
      if (/^apps\/api\/src\/modules\/.*\.ts$/.test(glob)) {
        findings.push({
          glob,
          kind: 'surface-hides-a-module-file',
          detail:
            'a single .ts file under apps/api/src/modules/** may not be excused at `surface` ' +
            'granularity. A converting module would use exactly this to hide its unconverted ' +
            'statements behind a whole-tree reason',
        });
      }
      continue;
    }
    // kind === 'bootstrap'
    const statements = Array.isArray(entry.statements) ? entry.statements : null;
    if (statements === null || statements.length === 0) {
      findings.push({
        glob,
        kind: 'bootstrap-without-statements',
        detail:
          'a `bootstrap` entry MUST enumerate its statements: the whole point of this kind is that ' +
          'the reason is a property of a specific statement, not of the file',
      });
      continue;
    }
    const declaredCounts = new Map();
    for (const statement of statements) {
      const ok =
        statement !== null &&
        typeof statement === 'object' &&
        typeof statement.model === 'string' &&
        statement.model.length > 0 &&
        typeof statement.verb === 'string' &&
        statement.verb.length > 0;
      if (!ok) {
        findings.push({
          glob,
          kind: 'malformed-statement',
          detail: `${JSON.stringify(statement)} carries no (model, verb) pair to compare against`,
        });
        continue;
      }
      if (typeof statement.reason !== 'string' || statement.reason.trim().length === 0) {
        findings.push({
          glob,
          kind: 'statement-without-reason',
          detail:
            `${statement.model}.${statement.verb} carries no reason. The enumeration is a list of ` +
            'REASONS, not of paths: an entry without one closes the coverage gap without covering ' +
            'anything',
        });
      }
      const key = `${statement.model}.${statement.verb}`;
      declaredCounts.set(key, (declaredCounts.get(key) ?? 0) + 1);
    }
    const observed = observedByGlob instanceof Map ? observedByGlob.get(glob) ?? new Map() : new Map();
    for (const [key, seen] of observed) {
      const claimed = declaredCounts.get(key) ?? 0;
      if (claimed < seen) {
        findings.push({
          glob,
          kind: 'undeclared-statement',
          detail:
            `${key} runs ${seen}× outside any tenant scope but only ${claimed} occurrence(s) are ` +
            'declared. A statement added to an already-excused file used to be excused with NO DIFF ' +
            'to this enumeration — that is the hole ADR-051 §D2 closes',
        });
      }
    }
    for (const [key, claimed] of declaredCounts) {
      const seen = observed.get(key) ?? 0;
      if (claimed > seen) {
        findings.push({
          glob,
          kind: 'dead-entry',
          detail:
            `${key} is declared ${claimed}× but the scan observes ${seen}. A dead entry is an excuse ` +
            'kept alive after the code it excused was deleted or converted, and it is the direction ' +
            'that quietly widens the list',
        });
      }
    }
  }
  return findings;
}

/**
 * THE CLASSIFIER — a PURE function, so the guard spec drives every branch with
 * no database and no repository scan.
 *
 * An UNRECOGNISED verb returns `null` and is REPORTED, never silently dropped:
 * the failure mode of a lookup table is that a new Prisma verb (or a helper
 * named like one) quietly classifies as "needs nothing".
 */
const VERB_PRIVILEGES = Object.freeze({
  aggregate: Object.freeze(['SELECT']),
  count: Object.freeze(['SELECT']),
  create: Object.freeze(['INSERT']),
  createMany: Object.freeze(['INSERT']),
  createManyAndReturn: Object.freeze(['INSERT']),
  delete: Object.freeze(['DELETE']),
  deleteMany: Object.freeze(['DELETE']),
  findFirst: Object.freeze(['SELECT']),
  findFirstOrThrow: Object.freeze(['SELECT']),
  findMany: Object.freeze(['SELECT']),
  findUnique: Object.freeze(['SELECT']),
  findUniqueOrThrow: Object.freeze(['SELECT']),
  groupBy: Object.freeze(['SELECT']),
  // `upsert` needs BOTH, and that is the whole reason a table-level check could
  // never have said anything useful: `tenant.upsert` (PF-185) needs INSERT and
  // UPDATE on a table that holds SELECT.
  upsert: Object.freeze(['INSERT', 'UPDATE']),
  update: Object.freeze(['UPDATE']),
  updateMany: Object.freeze(['UPDATE']),
});

function privilegesForVerb(verb) {
  return Object.prototype.hasOwnProperty.call(VERB_PRIVILEGES, verb) ? VERB_PRIVILEGES[verb] : null;
}

/**
 * The AC-9 `withTenant` verdict, as a PURE function so the guard spec can drive
 * every branch without a database.
 *
 * WHY THIS IS NOT `withTenantCallers === 0 ? limit : ok` (the shape shipped in
 * the first draft of this slice, corrected at land by run 54):
 *
 *   After the `DATABASE_URL` cutover, EVERY Prisma call site that does not set
 *   the tenant GUC returns ZERO ROWS — that is AC-5, proven above. So a single
 *   `withTenant` caller out of 722 is not progress towards safety, it is one
 *   covered site and 721 outages. A `=== 0` threshold turns that state into an
 *   affirmative green line, which is `PF-02`'s own failure mode — "the guardrail
 *   is claimed, the guardrail is not there" — reproduced INSIDE the block built
 *   to refuse it.
 *
 *   So the affirmative branch requires coverage to be COMPLETE. Anything short
 *   of it stays a `[LIMIT]` that names the ratio. This is deliberately a wall
 *   rather than a tunable floor: a knob here is a bypass flag wearing a
 *   different hat (`DNC-10`), and the rule for what "covered" means once the
 *   cutover starts belongs to `S-E01-1`, which owns the cutover — it is the only
 *   slice entitled to redefine it, and it must do so consciously.
 *
 * WHAT `S-E01-1d (b)` CHANGED, AND WHY IT IS NOT A RELAXATION
 * ----------------------------------------------------------
 * The wall did not move; the UNIT under it did, and one term was added.
 *
 *  - `scopedCallSites` replaces `withTenantCallers`. The old input counted scope
 *    OPENINGS; four openings in `calendar.controller.ts` cover six call sites, so
 *    it under-reported by construction. It now counts sites ATTRIBUTED to a
 *    brace-matched callback range.
 *  - `enumeratedCallSites` is the new term, and it is the only way a site outside
 *    every scope can stop being counted against readiness. It is bounded by
 *    `ENUMERATED_OUTSIDE_SCOPE`, a named in-source constant where **every entry
 *    carries its reason**, and the `unreasoned` branch below refuses the verdict
 *    outright when one does not.
 *
 * The equality `scoped + enumerated === total` is the SAME wall as before with
 * the honest denominator: before this slice, `enumerated` was implicitly zero and
 * every bootstrap and worker site counted as a future outage, which was true of
 * the cutover but useless as a target. It is still not a floor and still has no
 * knob. **This slice is EXPECTED to land on the `limit` branch; a green here
 * would be the finding, not the pass.**
 */
function cutoverVerdict({
  files,
  scopedCallSites,
  enumeratedCallSites = 0,
  prismaCallSites,
  enumeratedOutsideScope = ENUMERATED_OUTSIDE_SCOPE,
  enumerationDrift: drift = [],
}) {
  if (files === 0) {
    return {
      kind: 'vacuous',
      label: 'AC-9 the CUTOVER READINESS block could read the application sources at all',
      detail: 'zero .ts files found under apps/api/src and apps/worker/src — the counts below would be vacuous',
    };
  }

  // THE ENUMERATION IS CHECKED BEFORE IT IS TRUSTED, and this branch runs first
  // on purpose: an enumeration whose entries carry no reason is the manufactured
  // green in its purest form — the gap closes, nothing was converted, and the
  // only thing missing is the sentence that would have made someone object.
  // Unclassifiable, therefore refused (DNC-08), and refused LOUDLY rather than
  // downgraded to a limit, because a limit is a state of the CORPUS while this is
  // a defect in the CHECKER'S OWN constant.
  const unreasoned = (Array.isArray(enumeratedOutsideScope) ? enumeratedOutsideScope : []).filter(
    (entry) =>
      entry === null ||
      typeof entry !== 'object' ||
      typeof entry.reason !== 'string' ||
      entry.reason.trim().length === 0,
  );
  if (enumeratedCallSites > 0 && unreasoned.length > 0) {
    return {
      kind: 'unreasoned',
      label:
        'AC-9 the OUT-OF-SCOPE ENUMERATION carries a reason for every entry — ' +
        `${unreasoned.length} entr(y/ies) do not`,
      detail:
        `${enumeratedCallSites} call site(s) are being excused by an enumeration whose entries do not ` +
        'all say WHY. The enumeration is a list of REASONS, not of paths: an entry without one closes ' +
        'the coverage gap without covering anything, which is the manufactured green this branch exists ' +
        'to refuse. "Not converted yet" is not a reason — it belongs in the uncovered count.',
    };
  }

  // ADR-051 §D2 — THE STATEMENT-LEVEL RATCHET, evaluated HERE and not merely
  // printed by the caller. A drift that is reported but not refused is a
  // ratchet with no teeth: the verdict function is the one place the whole gate
  // funnels through, so wiring it in is what makes "the ratchet bites"
  // structural rather than a convention someone has to remember.
  const drifted = Array.isArray(drift) ? drift : [];
  if (drifted.length > 0) {
    return {
      kind: 'unreasoned',
      label:
        'AC-9 the OUT-OF-SCOPE ENUMERATION matches the corpus STATEMENT BY STATEMENT — ' +
        `${drifted.length} drift(s)`,
      detail:
        drifted
          .map((finding) => `${finding.glob}: [${finding.kind}] ${finding.detail}`)
          .join(' | ') +
        '. Set equality is asserted in BOTH directions and derived on both sides from the same ' +
        'matcher: an unlisted statement fails, a dead entry fails, a statement with no reason fails. ' +
        'There is deliberately no ratio floor — a floor is a knob and a knob here is a bypass flag ' +
        'wearing a different hat (DNC-10).',
    };
  }

  const uncovered = prismaCallSites - scopedCallSites - enumeratedCallSites;
  if (uncovered !== 0) {
    // A NEGATIVE residue means the two counts overlap or the enumeration exceeds
    // the corpus — arithmetic that cannot describe any real tree. Never
    // affirmative.
    if (uncovered < 0) {
      return {
        kind: 'unreasoned',
        label: 'AC-9 CUTOVER READINESS: the coverage arithmetic is impossible',
        detail:
          `scoped ${scopedCallSites} + enumerated ${enumeratedCallSites} EXCEEDS ${prismaCallSites} total ` +
          'call sites. Either a site was counted twice or the enumeration is wider than the corpus; ' +
          'both are defects in this checker, and neither may resolve to a green.',
      };
    }
    const zero = scopedCallSites === 0;
    return {
      kind: 'limit',
      label:
        'AC-9 CUTOVER READINESS: the tenant scope covers ' +
        (zero
          ? 'ZERO production Prisma call sites'
          : `only PART of the corpus (${scopedCallSites} scoped + ${enumeratedCallSites} enumerated / ${prismaCallSites})`),
      detail:
        `${scopedCallSites}/${prismaCallSites} Prisma call sites sit inside a tenant scope across ${files} ` +
        `source files, and ${enumeratedCallSites} more are enumerated as legitimately outside one, so ` +
        `${uncovered} would return ZERO ROWS after the DATABASE_URL cutover. AC-5 above ("no GUC means ` +
        'zero rows") therefore describes the OUTAGE, not the safety. THE APPLICATION IS NOT READY TO CUT OVER.',
    };
  }
  return {
    kind: 'ok',
    label: 'AC-9 CUTOVER READINESS: every production Prisma call site is inside a tenant scope or enumerated',
    detail:
      `${scopedCallSites} scoped + ${enumeratedCallSites} enumerated === ${prismaCallSites} call sites ` +
      `across ${files} source files`,
  };
}

/**
 * S-E01-1c / TOOL-32 — the scan.
 *
 * `knownTables` is the LIVE catalog's table list, so the model -> table mapping
 * is measured rather than frozen, and a model no table answers to is reported
 * (`unmappedModels`) instead of being counted as satisfied.
 *
 * `grants` maps table -> `'DELETE|INSERT|SELECT'`, exactly as the census emits
 * it, so this function compares a REQUIRED privilege against a HELD one. That is
 * the whole change: the old form only asked whether the table had a grant ROW.
 */
function cutoverReadiness(ungrantedTables, { knownTables = [], grants = new Map() } = {}) {
  const roots = [join(REPO_ROOT, 'apps', 'api', 'src'), join(REPO_ROOT, 'apps', 'worker', 'src')];
  const files = roots.flatMap((root) => sourceFiles(root));
  const modelToTable = new Map(knownTables.map((table) => [prismaModelName(table), table]));

  let scopedCallSites = 0;
  let enumeratedCallSites = 0;
  let prismaCallSites = 0;
  let rawSqlSites = 0;
  let classified = 0;
  const reachable = new Map();
  /** Files whose scope callbacks did not brace-match — every site in them counts UNCOVERED. */
  const unbalancedScopes = new Map();
  /** `.run(` receivers that are NOT scope openings, reported rather than assumed absent. */
  const foreignScopeReceivers = new Map();
  /**
   * S-E01-1e — `prisma.` / `this.prisma.` sites sitting INSIDE a scope callback:
   * the OWNER connection running under a range the counter would otherwise
   * credit. Counted UNCOVERED and named here, never scoped.
   */
  const ownerReceiverInsideScope = new Map();
  /** glob -> how many call sites it excused, so a dead enumeration entry is visible. */
  const enumeratedByGlob = new Map();
  /**
   * ADR-051 §D2 — glob -> Map<'model.verb', count>. The OBSERVED half of the
   * statement-level ratchet, derived by the same matcher as the coverage
   * arithmetic so the two sides can be compared rather than both hand-written.
   */
  const enumeratedStatementsByGlob = new Map();
  const enumerationMatchers = ENUMERATED_OUTSIDE_SCOPE.map((entry) => ({
    entry,
    matches: globToRegExp(entry.glob),
  }));
  /** key `table\u0000PRIVILEGE` -> { table, privilege, verbs:Set, hits, example } */
  const required = new Map();
  const unknownVerbs = new Map();
  const unmappedModels = new Map();
  const foreignReceivers = new Map();

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const relative = file.slice(REPO_ROOT.length + 1).split('\\').join('/');

    // S-E01-1d (b) — ATTRIBUTION, not occurrence counting. The ranges are
    // computed once per file; `covers()` is a linear scan over a list that holds
    // FOUR entries on the only converted file in the tree today.
    const scopes = scopeCallbackRanges(text);
    if (scopes.unbalanced > 0) unbalancedScopes.set(relative, scopes.unbalanced);
    for (const [receiver, hits] of scopes.foreignScopeReceivers) {
      foreignScopeReceivers.set(receiver, (foreignScopeReceivers.get(receiver) ?? 0) + hits);
    }
    // FAIL-CLOSED: a file whose scope callbacks did not brace-match contributes
    // ZERO coverage. See `matchingParen` — the alternative is a range that runs to
    // EOF and marks every remaining site in the file covered.
    const covers = (index) =>
      scopes.unbalanced === 0 && scopes.ranges.some((range) => index > range.start && index < range.end);
    const enumeration = enumerationMatchers.find(({ matches }) => matches.test(relative));

    rawSqlSites += (text.match(RAW_SQL_RE) ?? []).length;
    for (const [, alias] of text.matchAll(TRANSACTION_ALIAS_RE)) {
      if (!PRISMA_RECEIVERS.includes(alias)) {
        foreignReceivers.set(alias, (foreignReceivers.get(alias) ?? 0) + 1);
      }
    }
    // The line index is built once per file: `String.prototype.split` over the
    // whole text for every match would be quadratic on a 700-site corpus.
    const lineStarts = [0];
    for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
    const lineOf = (index) => {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (lineStarts[mid] <= index) low = mid;
        else high = mid - 1;
      }
      return low + 1;
    };

    for (const match of text.matchAll(PRISMA_CALL_SITE_RE)) {
      const [, model, verb] = match;
      prismaCallSites += 1;
      // The receiver is the match minus its trailing `.model.verb`, so it is
      // READ rather than re-searched for and cannot drift from the regex.
      const receiver = match[0].slice(0, match[0].length - (model.length + verb.length + 2));
      // Attribution is decided BEFORE the model lookup, deliberately: a site
      // whose model the catalog does not know is still a site that either sits
      // in a scope or does not, and dropping it here would let the two counts
      // disagree with `prismaCallSites` — the arithmetic the wall depends on.
      const attribution = classifyCallSite(receiver, {
        covered: covers(match.index),
        enumerated: enumeration !== undefined,
      });
      if (attribution === 'owner-inside-scope') {
        // Counted UNCOVERED (it falls through both `if`s) and NAMED.
        const where = `${relative}:${lineOf(match.index)} ${match[0]}`;
        ownerReceiverInsideScope.set(where, (ownerReceiverInsideScope.get(where) ?? 0) + 1);
      }
      if (attribution === 'scoped') {
        scopedCallSites += 1;
      } else if (attribution === 'enumerated') {
        enumeratedCallSites += 1;
        enumeratedByGlob.set(enumeration.entry.glob, (enumeratedByGlob.get(enumeration.entry.glob) ?? 0) + 1);
        // Only `bootstrap` entries are ratcheted per statement; recording the
        // multiset for `surface` globs too would invite someone to "just add
        // the statements" to `apps/worker/src/**` and its 99 sites.
        if (enumeration.entry.kind === 'bootstrap') {
          const seen =
            enumeratedStatementsByGlob.get(enumeration.entry.glob) ??
            enumeratedStatementsByGlob.set(enumeration.entry.glob, new Map()).get(enumeration.entry.glob);
          const key = `${model}.${verb}`;
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }
      const table = modelToTable.get(model);
      if (table === undefined) {
        // `$transaction`, `$connect` and friends never reach here (they start
        // with `$`), so an unmapped model is a real gap: a model whose table the
        // catalog does not enumerate, or a property that merely looks like one.
        unmappedModels.set(model, (unmappedModels.get(model) ?? 0) + 1);
        continue;
      }
      const privileges = privilegesForVerb(verb);
      if (privileges === null) {
        unknownVerbs.set(`${model}.${verb}`, (unknownVerbs.get(`${model}.${verb}`) ?? 0) + 1);
        continue;
      }
      classified += 1;
      for (const privilege of privileges) {
        const key = `${table}\u0000${privilege}`;
        const entry = required.get(key) ?? {
          table,
          privilege,
          verbs: new Set(),
          hits: 0,
          example: `${relative}:${lineOf(match.index)}`,
        };
        entry.verbs.add(verb);
        entry.hits += 1;
        required.set(key, entry);
      }
      if (ungrantedTables.includes(table)) {
        reachable.set(table, (reachable.get(table) ?? 0) + 1);
      }
    }
  }

  // The verdict per (table, privilege): HELD or NOT. A table absent from
  // `grants` holds nothing, which is the old check's case as a special case of
  // the new one rather than a second code path.
  const held = (table, privilege) =>
    String(grants.get(table) ?? '')
      .split('|')
      .map((p) => p.trim().toUpperCase())
      .includes(privilege);
  const unsatisfied = [];
  const satisfied = [];
  for (const entry of required.values()) {
    (held(entry.table, entry.privilege) ? satisfied : unsatisfied).push(entry);
  }
  unsatisfied.sort((a, b) => (a.table + a.privilege).localeCompare(b.table + b.privilege));

  return {
    files: files.length,
    scopedCallSites,
    enumeratedCallSites,
    enumeratedByGlob,
    enumeratedStatementsByGlob,
    enumerationDrift: enumerationDrift(ENUMERATED_OUTSIDE_SCOPE, enumeratedStatementsByGlob),
    enumeratedOutsideScope: ENUMERATED_OUTSIDE_SCOPE,
    unbalancedScopes,
    foreignScopeReceivers,
    ownerReceiverInsideScope,
    prismaCallSites,
    rawSqlSites,
    classified,
    reachable,
    required,
    satisfied,
    unsatisfied,
    unknownVerbs,
    unmappedModels,
    foreignReceivers,
  };
}

// ---------------------------------------------------------------------------
// The run
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
      `${APP_DATABASE_URL_VAR} is not declared in the environment or in any of the project's .env files.\n` +
        '    It names the NON-OWNER role this suite is adversarial AGAINST. Without it there is nothing to\n' +
        '    prove: the owner bypasses RLS, so a run as the owner would be green and worthless.',
    );
  }
  const app = parseUrl(APP_DATABASE_URL);

  if (!isLoopbackHost(owner.host) || !isLoopbackHost(app.host)) {
    throw new ToolingUnavailable(
      'this check creates and drops a database, so it refuses to run against a non-loopback address ' +
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
      'apps/api/prisma/migrations holds no migration.sql — a check over an empty ledger passes vacuously.',
    );
  }

  // ---- 2. The role must EXIST. Roles are CLUSTER state, not database state, so a
  //         fresh CI service container has none while the development machine has
  //         one that belongs to the OPERATOR (it backs `.env`'s DATABASE_URL_APP).
  //
  //         THE `createdRole` GUARD IS THE WHOLE POINT and it is carried verbatim
  //         from the sibling: a role we created is a role we remove, and a role
  //         that was ALREADY there is NEVER touched. `DROP ROLE` is the one
  //         teardown action a scratch database does not undo — an unconditional
  //         one here would break the live environment and every later run.
  const maintenance = { ...owner, database: 'postgres' };
  const roleProbe = psql(client.command, maintenance, `SELECT count(*) FROM pg_roles WHERE rolname = ${lit(app.user)};`);
  if (roleProbe.status !== 0) {
    throw new ToolingUnavailable(`could not query pg_roles as ${redact(owner)}: ${roleProbe.stderr.trim()}`);
  }
  let createdRole = false;
  if (scalar(roleProbe) !== '1') {
    const create = psql(client.command, maintenance, `CREATE ROLE ${app.user} LOGIN PASSWORD ${lit(app.password)};`);
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
  const scratchName = `tenant_adversarial_${process.pid}_${Date.now()}`;
  if (!SCRATCH_NAME_PATTERN.test(scratchName) || scratchName === owner.database || scratchName === app.database) {
    throw new ToolingUnavailable(`refusing to use ${scratchName} as a scratch database name`);
  }
  const scratchOwner = { ...owner, database: scratchName };
  const scratchApp = { ...app, database: scratchName };

  const created = psql(client.command, maintenance, `CREATE DATABASE "${scratchName}";`);
  if (created.status !== 0) {
    throw new ToolingUnavailable(`could not create the scratch database: ${created.stderr.trim()}`);
  }

  try {
    // ---- 4. Apply the ledger with `psql`, file by file. NOT `prisma migrate
    //         deploy`: the sibling measurably does not use it either, it needs a
    //         DSN environment variable and the generated client, and it creates
    //         `_prisma_migrations`, which this scratch database therefore does not
    //         have. Measured, not inferred.
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
    record('AC-1 the migration ledger applied and built a real schema', `${scalar(tables)} base tables`);

    // ---- 5. THE ENUMERATION, from the LIVE CATALOG of the scratch database.
    //         Never a frozen list on this side — that is the whole reason a 45th
    //         table cannot slip past, and it is what makes the UNCOVERED
    //         set-equality below meaningful rather than circular.
    const census = psql(
      client.command,
      scratchOwner,
      `SELECT 'TENANT_TABLES|' || coalesce(string_agg(c.table_name, ',' ORDER BY c.table_name), '')
         FROM information_schema.columns c
         JOIN information_schema.tables t USING (table_schema, table_name)
        WHERE c.table_schema='public' AND c.column_name='tenant_id' AND t.table_type='BASE TABLE';
       SELECT 'TENANT_NULLABLE|' || coalesce(string_agg(c.table_name, ',' ORDER BY c.table_name), '')
         FROM information_schema.columns c
         JOIN information_schema.tables t USING (table_schema, table_name)
        WHERE c.table_schema='public' AND c.column_name='tenant_id' AND t.table_type='BASE TABLE'
          AND c.is_nullable = 'YES';
       -- S-E01-1b — the derivation is the SIBLING'S, imported rather than
       -- re-written here. It is TRANSITIVE (a recursive closure), so a child OF a
       -- derived table — \`role_permission\` — is returned. The one-level query
       -- this replaced returned 6 where the sibling's constant named 7.
       SELECT 'DERIVED_TABLES|' || coalesce(string_agg(child, ',' ORDER BY child), '')
         FROM (SELECT DISTINCT child FROM (${DERIVED_SET_SQL}) s) d;
       -- The AUTO-DISCRIMINANT term: the parents of every \`tenant_id\` foreign
       -- key. \`tenant\` carries no \`tenant_id\` of its own and has no FK out, so
       -- without this term it falls in the residue AND is policied — counted on
       -- one side and excused on the other.
       SELECT 'AUTODISC|' || coalesce(string_agg(name, ',' ORDER BY name), '')
         FROM (${AUTO_DISCRIMINANT_SQL}) a;
       -- Which reference-surface tables actually EXIST here. \`_prisma_migrations\`
       -- is created by Prisma's CLI and this scratch database applies the ledger
       -- with psql, so it is absent and the migration's own \`to_regclass\` guard
       -- emits no GRANT for it. Measured, never assumed — an expectation that
       -- named a grant nobody issued would fail the matrix for the wrong reason.
       SELECT 'REFERENCE_PRESENT|' || coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '')
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'
          AND c.relname IN (${REFERENCE_SURFACE.map(lit).join(', ')});
       SELECT 'RESIDUE|' || coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '')
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'
          AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
                            AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped)
          AND c.relname NOT IN (SELECT DISTINCT child FROM (${DERIVED_SET_SQL}) s)
          AND c.relname NOT IN (SELECT name FROM (${AUTO_DISCRIMINANT_SQL}) a);
       SELECT 'GRANTS|' || coalesce(string_agg(entry, ';' ORDER BY entry), '') FROM (
         SELECT g.table_name || '=' || string_agg(g.privilege_type, '|' ORDER BY g.privilege_type) AS entry
           FROM information_schema.role_table_grants g
          WHERE g.grantee=${lit(app.user)} AND g.table_schema='public'
          GROUP BY g.table_name) e;
       SELECT 'UNGRANTED|' || coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '')
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'
          AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g
                           WHERE g.grantee=${lit(app.user)} AND g.table_schema='public'
                             AND g.table_name = c.relname);
       SELECT 'POLICIES|' || count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND p.polname=${lit(POLICY_NAME)};
       -- S-E01-1c / TOOL-32 — EVERY base table, so the verb-aware scan maps a
       -- Prisma model back to a table from the LIVE CATALOG rather than from a
       -- frozen list. A model that answers to no table is REPORTED, never
       -- counted as satisfied.
       SELECT 'ALL_TABLES|' || coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '')
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r';`,
    );
    if (census.status !== 0) {
      throw new ToolingUnavailable(`the enumeration query failed: ${census.stderr.trim()}`);
    }
    const cen = facts(census);
    const tenantTables = names(cen.get('TENANT_TABLES'));
    const derivedTables = names(cen.get('DERIVED_TABLES'));
    const enumerated = [...tenantTables, ...derivedTables].sort();
    // S-E01-1b — the two terms the enumeration deliberately does NOT fold in.
    // They carry no `tenant_id` and are not FK-derived, so they are not part of
    // the COVERED/UNCOVERED partition; they exist here because the PRIVILEGE
    // MATRIX below is a set equality against every grant `app_user` holds, and
    // leaving them out would make that equality fail on the three tables
    // `S-E01-1b` grants (`tenant`, `permission`, and `_prisma_migrations` where
    // it exists) rather than on a real widening.
    const autoDiscriminant = names(cen.get('AUTODISC'));
    const referencePresent = names(cen.get('REFERENCE_PRESENT'));

    if (enumerated.length < MIN_COVERED_TABLES) {
      fail(
        'AC-2 the live catalog enumerates a real set of tenant-bearing tables',
        `only ${enumerated.length}, which is below the non-vacuity floor of ${MIN_COVERED_TABLES} — ` +
          'every partition assertion below would agree trivially',
      );
      return;
    }
    record(
      'AC-2 the table set is enumerated FROM THE LIVE CATALOG, never from a frozen list',
      `${tenantTables.length} tenant-bearing + ${derivedTables.length} FK-derived = ${enumerated.length}`,
    );

    // P3-10 — a nullable `tenant_id` makes `NULL = uuid` NULL, i.e. false, and the
    // rows become invisible to EVERYONE after the cutover: dark data, fail-closed
    // and silent. Cheap to assert, impossible to notice otherwise.
    expectSetEqual('AC-2 every tenant_id column is NOT NULL (a nullable one is silent dark data)', names(cen.get('TENANT_NULLABLE')), []);

    // The derived tables the sibling names, agreed against the catalog through
    // the sibling's OWN closure query — so this is an agreement between a
    // CONSTANT and a MEASUREMENT, never between two hand-written queries.
    expectSetEqual(
      'AC-4 the FK-derived set measured on pg_constraint is exactly the set the sibling names ' +
        '(SEVEN since S-E01-1b: role entered when role_school_id_fkey was materialised, and ' +
        'role_permission is the TWO-LEVEL residue a one-level derivation cannot see. outbox_event is ' +
        'absent because it now CARRIES a tenant_id — ADR-044 — not because it is unreachable; its ' +
        'aggregate_id still has NO foreign key at all, ADR-042 §D7)',
      derivedTables,
      DERIVED_TABLES.map((d) => d.child),
    );
    expectSetEqual(
      'AC-2 the tables with no tenant_id, outside the derived set AND outside the auto-discriminant ' +
        'term, are exactly the NAMED residue',
      names(cen.get('RESIDUE')).filter((name) => name !== '_prisma_migrations'),
      NON_DERIVED_EXPECTED.filter((name) => name !== '_prisma_migrations'),
    );
    // S-E01-1b — the third term, asserted by NAME and not by a count: a SECOND
    // auto-discriminant table shipped without a policy must fail here rather than
    // swap places with `tenant`.
    expectSetEqual(
      'AC-2 the AUTO-DISCRIMINANT set — the parents of every tenant_id foreign key — is exactly {tenant} ' +
        '(ADR-046 §D4: its primary key IS the discriminant, so it is policied by id = <GUC>, not by a column)',
      autoDiscriminant,
      ['tenant'],
    );

    // ---- 5b. THE PRIVILEGE MATRIX — a DECISION, asserted by set equality so a
    //          silently WIDENED grant is a FAILURE and not a newly-passing test.
    const grants = new Map();
    for (const entry of String(cen.get('GRANTS') ?? '').split(';')) {
      const at = entry.indexOf('=');
      if (at <= 0) continue;
      grants.set(entry.slice(0, at).trim(), entry.slice(at + 1).trim());
    }
    const decidedPrivileges = (table) => {
      if (APPEND_ONLY_TABLES.includes(table)) return APPEND_ONLY_DML;
      // ADR-044 §D3 decided this one SEPARATELY, so it belongs in the closed set
      // by name. Folding it into FULL_DML would assert a `DELETE` the migration
      // deliberately withholds, and the set equality would print the difference.
      if (table === OUTBOX_TABLE) return OUTBOX_DML;
      return FULL_DML;
    };
    const canon = (privileges) =>
      privileges
        .split(',')
        .map((p) => p.trim().toUpperCase())
        .sort()
        .join('|');
    const expectedMatrix = [
      ...tenantTables.map((table) => `${table}=${decidedPrivileges(table)}`),
      ...DERIVED_TABLES.map((d) => `${d.child}=${canon(d.privileges)}`),
      // S-E01-1b / ADR-046 §D5 — THE THIRD AND FOURTH GROUPS. Before this slice
      // the matrix was `tenantTables ∪ DERIVED_TABLES` and that WAS the whole
      // grant set. `S-E01-1b` grants the authorization join its reference
      // surface, so three more tables now hold a privilege. They are added as
      // NAMED groups with their own privilege constants, never by relaxing the
      // equality to a superset check — that relaxation is what would let
      // `GRANT … ON ALL TABLES IN SCHEMA public` through, and it is the one
      // property this assertion exists to hold.
      ...autoDiscriminant.map((table) => `${table}=${canon(AUTO_DISCRIMINANT_PRIVILEGES)}`),
      ...referencePresent.map((table) => `${table}=${canon(REFERENCE_PRIVILEGES)}`),
    ];
    expectSetEqual(
      'AC-2 the privilege matrix equals the CLOSED set ADR-032 §D7 / ADR-042 §D5 / ADR-046 §D5 decided ' +
        '(so a widened grant FAILS instead of quietly making a denial test pass)',
      [...grants].map(([table, privileges]) => `${table}=${privileges}`),
      expectedMatrix,
    );

    // ---- 6. Fixtures, built by the OWNER (`app_user` holds SELECT and nothing
    //         else on `tenant` since S-E01-1b, and under GUC=A it could not insert
    //         B's rows anyway: "never the owner" binds the ADVERSARIAL phase, and
    //         it cannot bind the seed).
    const fixtures = psql(client.command, scratchOwner, FIXTURES_SQL);
    if (fixtures.status !== 0) {
      throw new ToolingUnavailable(`could not build the fixtures: ${fixtures.stderr.trim()}`);
    }
    const harness = psql(client.command, scratchOwner, HARNESS_SQL);
    if (harness.status !== 0) {
      throw new ToolingUnavailable(`could not install the probe harness: ${harness.stderr.trim()}`);
    }

    // ---- 7. AC-11 — the OWNER-SIDE EXISTENCE PROOF, before any denial is
    //         recorded. This is failure mode 1 closed: a table with no B row makes
    //         SELECT/UPDATE/DELETE all return 0, three green denials on an empty
    //         table, and there is no way to tell that from isolation afterwards.
    const seedRun = psql(client.command, scratchOwner, `\\pset footer off\n${seedCensusSql()}`);
    if (seedRun.status !== 0) {
      throw new ToolingUnavailable(`the seed census failed: ${seedRun.stderr.trim()}`);
    }
    const seeds = facts(seedRun);
    const covered = [];
    const uncovered = [];
    for (const entry of PLAN) {
      const [a, b] = String(seeds.get(`SEED_${entry.table}`) ?? '0:0').split(':').map(Number);
      if (a >= 1 && b >= 1) covered.push(entry.table);
      else uncovered.push(`${entry.table} (A=${a}, B=${b})`);
    }
    // Anything the catalog enumerated that this suite does not even attempt.
    const attempted = new Set(PLAN.map((entry) => entry.table));
    const notAttempted = enumerated.filter((table) => !attempted.has(table));
    const uncoveredNames = [...uncovered.map((u) => u.split(' ')[0]), ...notAttempted];

    expectSetEqual(
      'AC-2 the COVERED / UNCOVERED partition — every enumerated table is either PROVEN below or NAMED ' +
        'in UNCOVERED_EXPECTED with its reason. A table added by a future migration lands in UNCOVERED, is ' +
        'absent from the named list, and FAILS',
      uncoveredNames,
      UNCOVERED_EXPECTED,
    );
    if (covered.length < MIN_COVERED_TABLES) {
      fail(
        'AC-3 the NON-VACUITY FLOOR: enough tables carry rows for BOTH tenants that the partition is not ' +
          'trivially satisfied by an empty database',
        `COVERED = ${covered.length}, floor = ${MIN_COVERED_TABLES}. Unseeded: ${uncovered.join(', ') || '—'}`,
      );
      return;
    }
    record(
      'AC-3 the NON-VACUITY FLOOR: both tenants really have rows in every covered table',
      `COVERED = ${covered.length} (floor ${MIN_COVERED_TABLES}), counted by the OWNER before any denial`,
    );

    // ---- 8. PHASE 1 — identity, and the FRESH no-GUC state.
    const identityPlanner = new Planner();
    const identityRun = psql(client.command, scratchApp, identitySql(identityPlanner, owner.user), {
      onErrorStop: false,
    });
    if (/permission denied/i.test(identityRun.stderr)) {
      fail(
        `AC-3 ${app.user} can reach the tables under test`,
        'psql reported "permission denied", which is a MISSING GRANT and never evidence of isolation:\n' +
          identityRun.stderr.trim(),
      );
      return;
    }
    const idFacts = facts(identityRun);
    const idProbes = readProbes(identityRun, identityPlanner, 'identity + fresh connection');

    expectEqual('AC-1b the connection under test owns ZERO of the tables under test', idFacts.get('OWNS'), 0);
    expectEqual('AC-1b the connection under test does not carry BYPASSRLS', idFacts.get('BYPASSRLS'), 'false');
    expectEqual(
      `AC-1b the connection under test is NOT the owner named by DATABASE_URL (${owner.user})`,
      idFacts.get('IS_OWNER_ROLE'),
      'false',
    );
    record('AC-1b connected as', String(idFacts.get('WHO')));
    expectEqual('AC-5 state (i): on a FRESH connection the tenant GUC is NULL, not empty', idFacts.get('GUC_IS_NULL'), 'true');
    for (const table of covered) {
      expectRows(
        idProbes,
        `FRESH_${table}`,
        0,
        `AC-5 state (i) FRESH connection, no GUC: zero ${table} rows AND no error`,
      );
    }

    // ---- 9. PHASE 2 — the READ proof, both directions, plus the two other
    //         no-GUC states.
    const readPlanner = new Planner();
    const readRun = psql(client.command, scratchApp, readSql(readPlanner), { onErrorStop: false });
    if (/permission denied/i.test(readRun.stderr)) {
      fail(
        `AC-3 ${app.user} can read the tables under test`,
        `psql reported "permission denied" in the READ phase:\n${readRun.stderr.trim()}`,
      );
      return;
    }
    const readFacts = facts(readRun);
    const readProbesMap = readProbes(readRun, readPlanner, 'read, both directions');
    expectEqual(
      "AC-5 state (ii): after a COMMITted set_config(…, true) the GUC is '' and NOT null — this is why the " +
        'predicate must carry nullif, and it is the steady state of every pooled Prisma connection',
      readFacts.get('POOLED_IS_NULL'),
      'false',
    );
    for (const table of covered) {
      // POSITIVE CONTROL FIRST, in the code as well as in the SQL.
      expectRows(readProbesMap, `SEL_A_OWN_${table}`, 1, `AC-3 POSITIVE CONTROL GUC=A: A's own ${table} row IS visible`);
      expectRows(readProbesMap, `SEL_A_FGN_${table}`, 0, `AC-2a GUC=A: tenant B's ${table} row is NOT visible`);
      expectRows(readProbesMap, `SEL_B_OWN_${table}`, 1, `AC-4 MIRRORED GUC=B: B's own ${table} row IS visible`);
      expectRows(readProbesMap, `SEL_B_FGN_${table}`, 0, `AC-4 MIRRORED GUC=B: tenant A's ${table} row is NOT visible`);
      expectRows(readProbesMap, `POOLED_${table}`, 0, `AC-5 state (ii) POOLED, GUC='': zero ${table} rows AND no error`);
      expectRows(readProbesMap, `EMPTY_${table}`, 0, `AC-5 state (iii) GUC set explicitly to '': zero ${table} rows AND no error`);
    }

    // ---- 10. PHASE 3 — the WRITE proof. Per (table, verb), the EXPECTED outcome
    //          is read from the privilege matrix: `0 rows` where the privilege is
    //          HELD, SQLSTATE 42501 where it is NOT. Scoring a 42501 as "denied"
    //          would leave this suite green on a database with zero policies.
    const writePlanner = new Planner();
    const writeRun = psql(client.command, scratchApp, writeSql(writePlanner), { onErrorStop: false });
    const writeProbesMap = readProbes(writeRun, writePlanner, 'write (rolled back)');
    for (const entry of PLAN) {
      if (!covered.includes(entry.table)) continue;
      const held = new Set(String(grants.get(entry.table) ?? '').split('|').filter(Boolean));

      // (d) INSERT — positive control first, then the WITH CHECK denial.
      if (held.has('INSERT')) {
        expectRows(
          writeProbesMap,
          `INS_A_OWN_${entry.table}`,
          1,
          `AC-3 POSITIVE CONTROL GUC=A: an OWN-tenant INSERT into ${entry.table} is ACCEPTED`,
        );
        expectSqlState(
          writeProbesMap,
          `INS_A_FGN_${entry.table}`,
          SQLSTATE_INSUFFICIENT_PRIVILEGE,
          entry.derived
            ? `AC-4 GUC=A: an INSERT into ${entry.table} whose PARENT belongs to tenant B is REJECTED by WITH CHECK`
            : `AC-2d GUC=A: an INSERT into ${entry.table} carrying tenant B's id is REJECTED by WITH CHECK`,
        );
      } else {
        fail(`AC-2 ${entry.table} is INSERT-able by ${app.user} at all`, 'no INSERT privilege — every INSERT assertion would be vacuous');
      }

      // (b) UPDATE.
      if (held.has('UPDATE')) {
        expectRows(
          writeProbesMap,
          `UPD_A_OWN_${entry.table}`,
          1,
          `AC-3 POSITIVE CONTROL GUC=A: an UPDATE of A's own ${entry.table} row affects 1 row`,
        );
        expectRows(
          writeProbesMap,
          `UPD_A_FGN_${entry.table}`,
          0,
          `AC-2b GUC=A: an UPDATE targeting tenant B's ${entry.table} row affects 0 rows (silently — USING ` +
            'filters it away before the write is considered)',
        );
      } else {
        expectSqlState(
          writeProbesMap,
          `UPD_A_OWN_${entry.table}`,
          SQLSTATE_INSUFFICIENT_PRIVILEGE,
          `AC-2b ${entry.table} holds NO UPDATE privilege, so even an own-tenant UPDATE is refused 42501 ` +
            '(append-only by decision — NOT read as isolation)',
        );
        expectSqlState(
          writeProbesMap,
          `UPD_A_FGN_${entry.table}`,
          SQLSTATE_INSUFFICIENT_PRIVILEGE,
          `AC-2b ${entry.table} holds NO UPDATE privilege, so a cross-tenant UPDATE is refused 42501`,
        );
      }

      // (c) DELETE.
      if (held.has('DELETE')) {
        expectRows(
          writeProbesMap,
          `DEL_A_OWN_${entry.table}`,
          1,
          `AC-3 POSITIVE CONTROL GUC=A: a DELETE of A's own ${entry.table} row affects 1 row`,
        );
        expectRows(
          writeProbesMap,
          `DEL_A_FGN_${entry.table}`,
          0,
          `AC-2c GUC=A: a DELETE targeting tenant B's ${entry.table} row affects 0 rows and raises nothing`,
        );
      } else {
        expectSqlState(
          writeProbesMap,
          `DEL_A_OWN_${entry.table}`,
          SQLSTATE_INSUFFICIENT_PRIVILEGE,
          `AC-2c ${entry.table} holds NO DELETE privilege (ADR-032 §D7 / ADR-042 §D5), so it is refused 42501 ` +
            '— classified from role_table_grants, never read as isolation',
        );
        expectSqlState(
          writeProbesMap,
          `DEL_A_FGN_${entry.table}`,
          SQLSTATE_INSUFFICIENT_PRIVILEGE,
          `AC-2c ${entry.table} holds NO DELETE privilege, so a cross-tenant DELETE is refused 42501`,
        );
      }
    }

    // ---- 11. AC-4b — `outbox_event` is no longer fail-closed, it is PROVEN, and
    //          the three assertions below are what stop it from quietly leaving
    //          the proof again.
    //
    //          The separate `permission denied` probe that used to live here is
    //          DELETED, not disabled: after ADR-044 the table holds a real grant,
    //          so "permission denied" would now be a MISSING GRANT — the exact
    //          false green every other phase of this file treats as a loud
    //          failure. Keeping the old probe alongside the new coverage would
    //          have asserted both halves of a contradiction.
    //
    //          What remains is NAMED rather than folded into the loop above,
    //          because this is the table a future run is most tempted to "fix"
    //          with a bare GRANT (ADR-042 §D7's warning, still live).
    if (!tenantTables.includes(OUTBOX_TABLE)) {
      fail(
        `AC-4b ${OUTBOX_TABLE} carries a tenant_id in the live catalog (ADR-044)`,
        'the census did not return it as tenant-bearing — the denormalised column was reverted, or the ' +
          'migration did not apply, and this suite would silently stop proving the table',
      );
    } else if (!covered.includes(OUTBOX_TABLE)) {
      fail(
        `AC-4b ${OUTBOX_TABLE} is SEEDED for both tenants and PROVEN like the other 44`,
        'it is enumerated but not covered — its denials below would be three green results on an empty table',
      );
    } else {
      record(
        `AC-4b ${OUTBOX_TABLE} rejoined the ORDINARY regime and is proven on four verbs (ADR-044, closes PF-185)`,
        'no longer fail-closed by an absent grant: it carries the same tenant_isolation predicate as the ' +
          'other 44, and its DELETE refusal is classified from role_table_grants',
      );
      expectEqual(
        `AC-4b ${OUTBOX_TABLE} holds exactly ${OUTBOX_DML} — ADR-044 §D3 withheld DELETE ON PURPOSE`,
        grants.get(OUTBOX_TABLE),
        OUTBOX_DML,
      );
    }

    // ---- 12. AC-6 — the HONEST INVENTORY, asserted as a POSITIVE leak, plus the
    //          fixture recount that closes failure mode 4.
    const ownerRun = psql(client.command, scratchOwner, ownerSql());
    if (ownerRun.status !== 0) {
      throw new ToolingUnavailable(`the owner-visibility case failed to run: ${ownerRun.stderr.trim()}`);
    }
    const own = facts(ownerRun);
    expectEqual('AC-6 the owner case really ran as the owner', own.get('OWNER_WHO'), owner.user);
    for (const table of ['school', 'user_profile']) {
      const value = Number(own.get(`OWNER_CTX_A_FOREIGN_${table}`));
      if (value >= 1) {
        limit(
          `AC-6 THE APPLICATION IS NOT ISOLATED: as the OWNER (${owner.user}) with GUC = tenant A, tenant B's ` +
            `${table} row IS STILL VISIBLE`,
          `${value} row(s). RLS is ENABLED, not FORCED (ADR-032 §D5), and the application connects as this very ` +
            'role. Asserted as a PRESENT leak, so the day FORCE lands this goes red and says so.',
        );
      } else {
        fail(
          `AC-6 the owner-bypass limit is PRESENT and asserted as present (${table})`,
          `expected >= 1 of tenant B's rows visible to the owner, got ${value}. Either FORCE ROW LEVEL SECURITY ` +
            'has landed — in which case the application, which connects as this role, now returns zero rows — or ' +
            'the fixture is broken. Both are failures of this assertion, and neither is a pass.',
        );
      }
    }
    let drift = 0;
    for (const entry of PLAN) {
      if (!covered.includes(entry.table)) continue;
      if (Number(own.get(`FIXTURE_A_${entry.table}`)) !== 1) drift += 1;
      if (Number(own.get(`FIXTURE_B_${entry.table}`)) !== 1) drift += 1;
    }
    expectEqual(
      'AC-3 the fixture is INTACT after the adversarial phases — no cascade escaped the rolled-back ' +
        'transaction, so no denial above was recorded against a row that had simply been deleted',
      drift,
      0,
    );

    // ---- 13. AC-8 — FAIL-BEFORE / PASS-AFTER, EXECUTED IN-SUITE.
    //
    //          It runs AFTER the main proof has produced its verdict and is
    //          structurally incapable of converting a failed proof into a pass:
    //          it only ever APPENDS its own named assertions.
    //
    //          The weakening is `DISABLE ROW LEVEL SECURITY` and not `DROP POLICY`
    //          for a measured reason: restoring a dropped policy would require
    //          re-authoring its predicate here, i.e. a SECOND source of truth for
    //          the very expression this suite exists to check. DISABLE/ENABLE is
    //          exactly as weakening and is exactly reversible.
    //
    //          The SQL itself asserts it is on a scratch database — a JS-side
    //          target object is not enough for a statement that turns a security
    //          control off.
    const guardedMutation = (statement) => `
DO $mut$
BEGIN
  IF current_database() !~ '^tenant_adversarial_' THEN
    RAISE EXCEPTION 'refusing to weaken %, which is not a scratch database of this suite', current_database();
  END IF;
  EXECUTE ${lit(statement)};
END
$mut$;`;

    const mutationProbe = (phase) => {
      const planner = new Planner();
      const sql = [
        RESULT_TABLE_SQL,
        'BEGIN;',
        `SELECT set_config(${lit(TENANT_GUC)}, ${lit(TENANT_A)}, true);`,
        planner.count('MUT_FOREIGN_school', `SELECT count(*) FROM school WHERE id = ${rowIdFor(PLAN[0], SLOT_B)}`),
        'COMMIT;',
        EMIT_SQL,
      ].join('\n');
      const run = psql(client.command, scratchApp, sql, { onErrorStop: false });
      const probes = readProbes(run, planner, phase);
      return probes.get('MUT_FOREIGN_school');
    };

    const weakened = psql(client.command, scratchOwner, guardedMutation('ALTER TABLE public.school DISABLE ROW LEVEL SECURITY'));
    if (weakened.status !== 0) {
      fail('AC-8 the deliberate weakening applied to the scratch database', weakened.stderr.trim());
    } else {
      const red = mutationProbe('AC-8 mutation, tenant_isolation DISABLED on public.school');
      const restored = psql(client.command, scratchOwner, guardedMutation('ALTER TABLE public.school ENABLE ROW LEVEL SECURITY'));
      if (restored.status !== 0) {
        fail('AC-8 the weakening was reverted on the scratch database', restored.stderr.trim());
      }
      const green = mutationProbe('AC-8 mutation, tenant_isolation RESTORED on public.school');
      // The SPECIFIC fact must flip. "the failure count rose" is satisfied by any
      // unrelated breakage, which is DNC-08 committed by the fix.
      if (red && red.outcome === 'ok' && red.rows >= 1 && green && green.outcome === 'ok' && green.rows === 0) {
        record(
          'AC-8 MUTANT_KILLED: with tenant_isolation disabled on public.school the named assertion ' +
            'CTX_A_FOREIGN_school went RED, and GREEN again once it was restored',
          `weakened = ${red.rows} foreign row(s) visible, restored = ${green.rows}`,
        );
      } else {
        fail(
          'AC-8 MUTANT_KILLED: the named assertion flips RED under a deliberately weakened policy',
          `it did not flip (weakened = ${red ? `${red.outcome}:${red.rows}` : 'no answer'}, restored = ` +
            `${green ? `${green.outcome}:${green.rows}` : 'no answer'}). The assertion it was validating is DEAD: ` +
            'it would stay green on a database with no policy at all.',
        );
      }
    }

    // ---- 14. AC-9 — CUTOVER READINESS. The isolation verdict is TRUE and the
    //          conclusion "safe to cut over" is FALSE, which is PF-02 one level
    //          down. This block is a set of named assertions, not prose.
    const ungranted = names(cen.get('UNGRANTED')).filter((table) => table !== '_prisma_migrations');
    const allTables = names(cen.get('ALL_TABLES'));
    const readiness = cutoverReadiness(ungranted, { knownTables: allTables, grants });
    const verdict = cutoverVerdict(readiness);
    // MAPPED FAIL-CLOSED, and the order matters more than it looks. The previous
    // shape was `vacuous -> fail / limit -> limit / else -> record`, so ANY kind
    // added later — `unreasoned` among them — would have landed on the
    // AFFIRMATIVE branch by default. Only the explicitly affirmative kind may
    // reach `record`; everything unrecognised is a failure (DNC-08).
    if (verdict.kind === 'ok') record(verdict.label, verdict.detail);
    else if (verdict.kind === 'limit') limit(verdict.label, verdict.detail);
    else fail(verdict.label, verdict.detail);

    // S-E01-1d (b) — the attribution's own honest edges, PRINTED. Both of these
    // are silent-over-report shapes if they are only counted (`PF-200`).
    if (readiness.unbalancedScopes.size > 0) {
      fail(
        'AC-9 every tenant-scope callback brace-matched',
        `${readiness.unbalancedScopes.size} file(s) hold a scope call whose callback did not close: ` +
          [...readiness.unbalancedScopes].map(([file, hits]) => `${file} (${hits})`).join(', ') +
          '. Their call sites are counted UNCOVERED — an unmatched range would otherwise run to end of ' +
          'file and mark every remaining site in it covered.',
      );
    }
    // S-E01-1e — the receiver-blind half of the counter, now visible. A `fail`
    // and not a `limit`: the rule "inside the callback use `tx`, never
    // `this.prisma`" is not a state of the corpus to be tolerated, it is the
    // difference between a converted handler and one that only looks converted.
    if (readiness.ownerReceiverInsideScope.size > 0) {
      fail(
        'AC-9 no OWNER-connection receiver runs inside a tenant-scope callback',
        `${readiness.ownerReceiverInsideScope.size} site(s) sit inside a scope range but issue on the ` +
          'owner client: ' +
          [...readiness.ownerReceiverInsideScope.keys()].join(', ') +
          `. The safe receiver set is {${SCOPE_SAFE_RECEIVERS.join(', ')}}. They are counted UNCOVERED ` +
          '— crediting them to the callback would make a half-converted handler report a HIGHER scoped ' +
          'count than a correct one (the dangerous inverse of PF-200).',
      );
    }
    if (readiness.foreignScopeReceivers.size > 0) {
      record(
        'AC-9 `.run(` receivers OUTSIDE the scope set are reported, never assumed to open a scope',
        [...readiness.foreignScopeReceivers].map(([receiver, hits]) => `${receiver} ×${hits}`).join(', ') +
          `; the closed set is {${SCOPE_RECEIVERS.join(', ')}}`,
      );
    }
    // ADR-051 §D2 — the enumeration is printed WITH ITS KIND and, for the
    // statement-level layer, with the declared/observed pair. A list whose two
    // sides are never printed side by side is a list nobody can audit.
    for (const entry of readiness.enumeratedOutsideScope) {
      const hits = readiness.enumeratedByGlob.get(entry.glob) ?? 0;
      const declared = Array.isArray(entry.statements) ? entry.statements.length : null;
      record(
        `AC-9 enumerated outside a scope [${entry.kind}]: ${entry.glob} (${hits} site(s)` +
          (declared === null ? ')' : `, ${declared} declared)`),
        entry.reason,
      );
    }
    // THE RATCHET, and it is a `fail` rather than a `limit`: a drift is a defect
    // in the CHECKER'S OWN constant, not a state of the corpus. `cutoverVerdict`
    // already refuses on the same input above — this block exists so the drift
    // is NAMED, statement by statement, instead of only collapsing the verdict.
    if (readiness.enumerationDrift.length > 0) {
      for (const finding of readiness.enumerationDrift) {
        fail(
          `AC-9 PF-199 the bootstrap allow-list matches the corpus: ${finding.glob} [${finding.kind}]`,
          finding.detail,
        );
      }
    } else {
      const ratcheted = readiness.enumeratedOutsideScope.filter((e) => e.kind === 'bootstrap');
      const statements = ratcheted.reduce((n, e) => n + (e.statements?.length ?? 0), 0);
      record(
        'AC-9 PF-199 the bootstrap allow-list is TWO-LAYERED and STATEMENT-RATCHETED (ADR-051 §D2)',
        `${ratcheted.length} identity file(s) declaring ${statements} statement(s), each with its own ` +
          'reason, compared for SET EQUALITY in both directions against the same matcher that produces ' +
          'the coverage arithmetic — an unlisted statement fails, a dead entry fails, a reasonless ' +
          'statement fails. No ratio floor: a floor is a knob and a knob here is a bypass flag wearing ' +
          'a different hat (DNC-10).',
      );
    }

    // ---- 14b. S-E01-1c / TOOL-32 — THE VERB-AWARE HALF.
    //
    //      NON-VACUITY FIRST, in both directions. Everything below is a
    //      difference between "what a verb needs" and "what the grant holds", so
    //      a scan that classified nothing would print a clean bill of health for
    //      a corpus it never read — the exact shape of PF-02.
    if (readiness.classified < MIN_CLASSIFIED_CALL_SITES) {
      fail(
        'AC-9 the verb-aware scan classified a real corpus',
        `only ${readiness.classified} (table, verb) call sites were classified across ${readiness.files} ` +
          `source files, below the floor of ${MIN_CLASSIFIED_CALL_SITES}. The old scan anchored on ` +
          '`\\bprisma\\.` and could not see a single `tx.` site — all five PF-193 writes are `tx.` calls — ' +
          'so a low number here is most likely the receiver set having regressed, not the corpus shrinking.',
      );
    } else if (readiness.satisfied.length === 0) {
      fail(
        'AC-9 the verb-aware scan can answer SATISFIED as well as UNSATISFIED',
        'not one (table, privilege) pair was found satisfied, so every "[LIMIT]" below would be printed by ' +
          'a comparison that always answers no',
      );
    } else {
      record(
        'AC-9 CUTOVER READINESS is VERB-AWARE (TOOL-32): each call site is classified by the privilege its ' +
          'verb needs, and that privilege is required in role_table_grants — not merely a grant row for the table',
        `${readiness.classified} classified call site(s) over ${readiness.required.size} (table, privilege) ` +
          `pair(s) from receivers {${PRISMA_RECEIVERS.join(', ')}}; ${readiness.satisfied.length} satisfied, ` +
          `${readiness.unsatisfied.length} not`,
      );
    }

    // ONE aggregated [LIMIT] per unsatisfied (table, verb-privilege), naming the
    // table, the verb, the call-site count and ONE path:line — enough to act on,
    // and never one line per call site.
    for (const entry of readiness.unsatisfied) {
      limit(
        `AC-9 CUTOVER BLOCKER: ${entry.table} needs ${entry.privilege} and ${app.user} does not hold it`,
        `${entry.hits} call site(s) via ${[...entry.verbs].sort().join(', ')} — e.g. ${entry.example}. ` +
          `Held today: ${grants.get(entry.table) || 'nothing'}. After the cutover each raises 42501.`,
      );
    }
    // AC-10's own fail-before / pass-after, asserted rather than narrated: these
    // two WERE in the list before this slice (SELECT held, five write call
    // sites), and their absence from it is what PF-193 closing MEANS.
    const blockedTables = new Set(readiness.unsatisfied.map((entry) => entry.table));
    for (const table of WRITE_GUARD_TABLES) {
      if (blockedTables.has(table)) {
        fail(
          `AC-10 PF-193 is CLOSED: ${table} is no longer a verb-aware cutover blocker`,
          `it is still listed above. The write GRANT this slice ships did not reach it, so the admin ` +
            'portal`s custom-role editor would still lose its write path at the cutover.',
        );
      } else {
        record(`AC-10 PF-193 CLOSED for ${table}: every verb its call sites use is now granted`);
      }
    }
    // AC-11 — WHAT THE VERB-AWARE SCAN ACTUALLY SURFACES BEYOND role /
    // role_permission, MEASURED THIS RUN INSTEAD OF ASSUMED.
    //
    // The slice brief pre-allocated two findings on a premise this scan
    // FALSIFIES, and reporting the measurement is the deliverable here — an id
    // spent on a defect that does not exist is worse than no id at all:
    //
    //   • "the 44 tenant-scoped tables hold SELECT, INSERT only while ~47
    //     (model, UPDATE) pairs exist" — FALSE. `20260813120000` line 480 grants
    //     `SELECT, INSERT, UPDATE, DELETE` to every tenant-scoped table that is
    //     not append-only; only `audit_log` and `conversation_message` are
    //     narrowed, and no production call site updates or deletes either.
    //   • "no DELETE is granted anywhere while 18 (model, DELETE) pairs exist" —
    //     FALSE for the same reason. `ADR-042 §D5`'s "no caller exists" was a
    //     measurement about the tenant-DERIVED five, never about the 44, and it
    //     is amended by ADR-047 §D4 rather than overridden.
    //
    // What remains is exactly what the pre-mortem predicted: TWO pairs, both on
    // `tenant`, both already owned by PF-185 — printed as [LIMIT] lines above by
    // the loop, not narrated here. Plus the scan's own edges, below.
    record(
      'AC-11 the verb-aware residual is REPORTED AS MEASURED, and it falsifies two pre-allocated findings',
      `${readiness.unsatisfied.length} unsatisfied (table, privilege) pair(s) repo-wide: ` +
        `${readiness.unsatisfied.map((e) => `${e.table}/${e.privilege}`).join(', ') || 'none'}. The 44 ` +
        'tenant-scoped tables DO hold UPDATE and DELETE (20260813120000:480), so the "SELECT, INSERT only" ' +
        'premise behind PF-195 / PF-196 is false and no id is spent on it.',
    );

    // The scan's HONEST EDGES, printed rather than implied. A technique's limit
    // stated is a limit; a technique's limit unstated is a false clean bill.
    if (readiness.rawSqlSites > 0) {
      limit(
        `AC-9 SCAN LIMIT: ${readiness.rawSqlSites} raw-SQL call site(s) carry no model and no verb, so this ` +
          'classifier cannot see them at all',
        'PF-197 (P2): two of them are boot-time `CREATE UNIQUE INDEX` through `$executeRawUnsafe` ' +
          '(`guardianship-claim-index.bootstrap.ts`, `booking-index.bootstrap.ts`). As a non-owner those ' +
          'raise `must be owner of relation`, and BOTH are wrapped in a try/catch that downgrades to ' +
          '`logger.warn` — so after the cutover the ADR-022 open-claim idempotency guard and the booking ' +
          'index silently stop being ensured. Soft-failing, and invisible to any grant matrix.',
      );
    }
    if (readiness.foreignReceivers.size > 0) {
      limit(
        'AC-9 SCAN LIMIT: a `$transaction` callback binds a receiver this scan does not follow',
        [...readiness.foreignReceivers].map(([alias, hits]) => `${alias} (${hits})`).join(', ') +
          `. The closed set is {${PRISMA_RECEIVERS.join(', ')}}, measured as complete when this was ` +
          'written; an alias appearing here means model calls inside that callback are UNCLASSIFIED, not ' +
          'that they are safe.',
      );
    } else {
      record(
        `AC-9 every \`$transaction\` callback binds one of {${PRISMA_RECEIVERS.join(', ')}} — the receiver ` +
          'set is closed BY MEASUREMENT and re-measured on every run, not asserted once and trusted',
      );
    }
    if (readiness.unknownVerbs.size > 0) {
      limit(
        'AC-9 SCAN LIMIT: an UNRECOGNISED verb was reported rather than dropped',
        [...readiness.unknownVerbs].map(([name, hits]) => `${name} (${hits})`).join(', ') +
          '. A lookup table`s failure mode is that a new verb classifies as "needs nothing"; these are ' +
          'printed so that failure cannot be silent.',
      );
    }
    if (readiness.unmappedModels.size > 0) {
      limit(
        'AC-9 SCAN LIMIT: a receiver property looks like a Prisma model but matches no catalog table',
        [...readiness.unmappedModels].map(([name, hits]) => `${name} (${hits})`).join(', '),
      );
    }
    // Prisma NESTED writes carry no `<receiver>.<model>.<verb>` token at all —
    // `roles.controller.ts:161` attaches permissions through
    // `rolePermissions: { create: [...] }`, a `role_permission` INSERT this scan
    // structurally cannot see. The table is still surfaced (via :252), so the
    // VERDICT is right and the call-site LIST is incomplete. Stated, because the
    // day the only writer of some table is a nested write, it will not be.
    record(
      'AC-9 SCAN LIMIT stated: Prisma NESTED writes (`rolePermissions: { create: [...] }`, ' +
        'roles.controller.ts:161) emit no receiver.model.verb token and are invisible to this classifier',
      'measured harmless today — every table reached by a nested write is also reached by a direct one — ' +
        'and recorded so that "every write is classified" is never read as a stronger claim than it is',
    );

    // The OLD table-level question is KEPT, not replaced: a table with NO grant
    // row at all is a different failure from a table missing one verb, and the
    // remedies differ (a GRANT versus a decision about whether to grant).
    if (readiness.reachable.size > 0) {
      limit(
        'AC-9 CUTOVER READINESS: production code reaches tables that are UNGRANTED to ' + app.user,
        [...readiness.reachable]
          .map(([table, hits]) => `${table} (${hits} call site(s))`)
          .join(', ') +
          '. After the cutover each raises 42501 on the AuthZ resolution path — a hard outage at the first ' +
          'request, and invisible to every isolation assertion above because these tables are not tenant-bearing.',
      );
    } else {
      record(
        `AC-9 CUTOVER READINESS: no production Prisma call site reaches a table ungranted to ${app.user}`,
        `checked ${ungranted.length} ungranted table(s): ${ungranted.join(', ') || '—'}`,
      );
    }
  } finally {
    // ---- 15. AC-7 — DETERMINISTIC TEARDOWN, by construction.
    //
    //          Every `app_user` child above has already exited (spawnSync is
    //          synchronous). That is NECESSARY and NOT SUFFICIENT: backend exit is
    //          asynchronous, and THAT is the whole race TOOL-27 recorded. So the
    //          OWNER polls `pg_stat_activity` — measured readable by `pilotage`
    //          for `app_user` backends, `usename`/`pid`/`datname` all visible —
    //          until the scratch database has no backend left, and only then
    //          drops.
    //
    //          FORBIDDEN, each a reviewable line: GRANT pg_signal_backend TO
    //          pilotage; ALTER ROLE pilotage SUPERUSER; connecting as postgres to
    //          force the drop; making the drop's failure non-fatal; copying the
    //          terminate-then-retry branch of rls-isolation-check.js, which is
    //          MEASURED inert — `pilotage` is rolsuper=false, rolbypassrls=false
    //          and a member of no role, so pg_terminate_backend fails with the
    //          same privilege error as the DROP.
    if (!SCRATCH_NAME_PATTERN.test(scratchName) || scratchName === owner.database) {
      fail('AC-7 the name about to be dropped is one this run generated', scratchName);
    } else {
      const quiesce = psql(
        client.command,
        maintenance,
        `DO $wait$
         DECLARE remaining integer;
         BEGIN
           FOR i IN 1..${QUIESCE_ATTEMPTS} LOOP
             SELECT count(*) INTO remaining FROM pg_stat_activity
              WHERE datname = ${lit(scratchName)} AND pid <> pg_backend_pid();
             EXIT WHEN remaining = 0;
             PERFORM pg_sleep(${QUIESCE_SLEEP_SECONDS});
           END LOOP;
         END
         $wait$;
         SELECT 'LEFTOVER|' || coalesce(string_agg(usename || '#' || pid, ',' ORDER BY pid), '')
           FROM pg_stat_activity WHERE datname = ${lit(scratchName)} AND pid <> pg_backend_pid();`,
      );
      const leftover = facts(quiesce).get('LEFTOVER') ?? '';
      if (leftover !== '') {
        fail(
          'AC-7 the scratch database quiesced before the drop',
          `after ${QUIESCE_ATTEMPTS} attempts these backends were still attached: ${leftover}. ` +
            'Never bought with a pg_signal_backend grant — that would be a standing privilege escalation for ' +
            'the exact role the cutover is about (AC-7, ADR-045 §D2).',
        );
      }
      const dropped = psql(client.command, maintenance, `DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE);`);
      if (dropped.status !== 0) {
        fail('AC-7 the scratch database was dropped', `${scratchName}: ${dropped.stderr.trim()}`);
      } else {
        record('AC-7 the scratch database was dropped after a clean quiesce', scratchName);
      }
    }
    // A role we created is a role we remove; a role that was ALREADY there is the
    // operator's and is never touched. Roles are cluster-wide, so this is the one
    // teardown action that would escape the scratch database if it were
    // unconditional — which is exactly why it is guarded and why the guard is
    // asserted by the spec rather than merely written here.
    if (createdRole) {
      const droppedRole = psql(client.command, maintenance, `DROP ROLE IF EXISTS ${app.user};`);
      if (droppedRole.status !== 0) {
        fail(`AC-7 the role ${app.user} this run created was removed`, droppedRole.stderr.trim());
      } else {
        record(`AC-7 the role ${app.user} this run created was removed`);
      }
    }
  }
}

/**
 * The verdict vocabulary contains no bare word "isolated" (ADR-045 §D5).
 *
 * Success reads "the NON-OWNER role is isolated; the APPLICATION IS NOT", in the
 * banner, not in an epilogue nobody reaches. Nothing here uses colour: a non-TTY
 * CI log strips ANSI and the pass / fail / LIMIT distinction would disappear with
 * it, so every line is legible from its text alone.
 */
function report(verdict) {
  const banner =
    verdict === 'isolated'
      ? 'TENANT ADVERSARIAL SUITE: the NON-OWNER role IS isolated — the APPLICATION IS NOT (it connects as the owner)'
      : verdict === 'not_isolated'
        ? 'TENANT ADVERSARIAL SUITE: NOT PROVEN — cross-tenant access was not refused as required'
        : 'TENANT ADVERSARIAL SUITE: COULD NOT RUN';
  console.log(`\n${banner}`);
  console.log(evidence.join('\n'));
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const line of failures) console.log(`  - ${line}`);
  }
  if (limits.length > 0) {
    console.log('\nNAMED LIMITS — these are NOT passes. Each is a fact this suite proved and refuses to hide:');
    for (const line of limits) console.log(`  ! ${line}`);
  }
  if (verdict === 'isolated') {
    console.log(
      '\nWHAT THIS DOES NOT SAY: that the running application is isolated. It is NOT.\n' +
        '  It connects as the table OWNER, which is not subject to these policies without\n' +
        '  FORCE ROW LEVEL SECURITY — proven above by execution, as a PRESENT leak. What is\n' +
        '  proven is that the policies DENY, at catalog-enumerated breadth, for a real,\n' +
        '  non-owner, login-capable role. The remaining step is the CONNECTION CUTOVER, and\n' +
        '  the CUTOVER READINESS limits above say what still blocks it. (PF-02, VAL-02.)',
    );
  }
  return EXIT[verdict];
}

// NOT a bare `main()` at module scope. The guard spec `require()`s this file to
// reach the pure exports, and it runs inside `pnpm test` on every developer's
// machine — a module-scope `main()` would create and drop a database as a side
// effect of loading it. Same shape as `scripts/rls-isolation-check.js`.
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
  APPEND_ONLY_DML,
  FULL_DML,
  MIN_CLASSIFIED_CALL_SITES,
  MIN_COVERED_TABLES,
  PRISMA_RECEIVERS,
  VERB_PRIVILEGES,
  OUTBOX_DML,
  OWN_PROBE_OFFSET,
  FOREIGN_PROBE_OFFSET,
  PLAN,
  QUIESCE_ATTEMPTS,
  SCRATCH_NAME_PATTERN,
  SHARED_ROLE,
  SLOT,
  SLOT_A,
  SLOT_B,
  SPARE_PARENTS,
  SQLSTATE_INSUFFICIENT_PRIVILEGE,
  TENANT_A,
  TENANT_B,
  UNCOVERED_EXPECTED,
  // S-E01-1d (b) — the ATTRIBUTION family is exported for the same reason
  // `cutoverVerdict` is: the gate spec drives the brace matcher over synthetic
  // source (a `)` in a string, a `(` in a regex, a foreign `.run(` receiver) with
  // no repository scan and no database. A matcher that is only ever exercised by
  // the real corpus is a matcher whose pathological branches are never tested.
  ENUMERATED_OUTSIDE_SCOPE,
  ENUMERATION_KINDS,
  SCOPE_RECEIVERS,
  SCOPE_SAFE_RECEIVERS,
  classifyCallSite,
  cutoverVerdict,
  // S-E01-1e / ADR-051 §D2 — the statement-level ratchet, PURE, so the gate spec
  // can make it FAIL on purpose (AC-7) without touching the repository.
  enumerationDrift,
  globToRegExp,
  matchingParen,
  scopeCallbackRanges,
  // S-E01-1c — the classifier is exported as a PURE function so the guard spec
  // drives every branch (each verb, the unrecognised one, upsert's two
  // privileges) with no database and no repository scan.
  privilegesForVerb,
  prismaModelName,
};
