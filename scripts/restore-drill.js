#!/usr/bin/env node
/**
 * restore-drill.js — the timed backup → restore → verify rehearsal (VAL-03, R-01).
 *
 * WHY THIS EXISTS
 * ---------------
 * R-01 is "a tenancy or schema migration moves data unrecoverably". Every
 * mitigation written for it so far — the safe migrator (S-E02-1), the baseline
 * runbook, the drift measurement (S-E02-5) — assumes that when something goes
 * wrong there is a backup to go back to. Nothing in this repository had ever
 * *executed* a restore. "We have `pg_dump`" is not a backup strategy; it is a
 * claim about one, and this epic exists because claims nobody executed were the
 * single largest category in the audit.
 *
 * So this file does the thing rather than asserting it: it dumps a real
 * database, restores it into a scratch database on the same server, rebuilds a
 * verification manifest from the RESTORED copy, and compares it field by field
 * against a manifest taken from the source. Divergence exits non-zero and names
 * the table and the field.
 *
 * WHAT IT CHECKS, AND WHICH DEFECT EACH CHECK IS FOR
 * --------------------------------------------------
 *   1. the source is reachable            → DNC-08. An unreachable database is
 *      the exact state in which every check below passes vacuously. It is a
 *      failure with its own verdict, never a no-op and never a pass.
 *   2. a dump route exists (container or host client)
 *                                         → same rule. No route is a failure
 *      naming both routes tried, never "nothing to do".
 *   3. the container we exec into publishes the port the source URL addresses
 *                                         → the two routes could address two
 *      different clusters (a stray second Postgres on the same port). Then the
 *      drill would dump one database and verify another.
 *   4. the reading role is superuser or BYPASSRLS
 *                                         → ADR-002 declares RLS as the tenancy
 *      mechanism and V3-E01 is the epic that lands it. Under an RLS-subject
 *      role `pg_dump` silently dumps only the visible rows, and a manifest built
 *      through the same role compares equal to the partial dump. The drill would
 *      report `ok` on an unrecoverable backup. One line today; after V3-E01 it
 *      is a drill that has been green on partial dumps for an unknown number of
 *      runs. The session also pins `row_security = off`.
 *   5. `_prisma_migrations` exists on the source
 *                                         → PF-03's exact state, reproduced on
 *      this very database earlier in run 19 (52 tables, no ledger, 24 DDL
 *      statements of drift). A dump of an un-baselined database restores data
 *      without the database's identity.
 *   6. the scratch database is new, empty, and is not the source
 *                                         → the only genuinely destructive line
 *      in this file. See THE ONE DANGEROUS PART below.
 *   7. `pg_restore` completed              → `pg_restore` returns non-zero and
 *      prints "errors ignored on restore" rather than aborting, unless it is
 *      given `--exit-on-error`. A drill that trusted the child exit code would
 *      report a successful restore of nothing.
 *   8. the table SET matches, then row counts, then per-table content checksums
 *                                         → driven by the SOURCE list, never by
 *      iterating what the restore happens to contain: a restore that created
 *      zero tables would otherwise compare zero tables and pass.
 *   9. the schema came back too            → enum labels, columns, indexes, key
 *      constraints. "The data came back" is not "the database came back", and
 *      R-01 is about being able to resume operating. A lost unique index passes
 *      a row-count comparison until the first insert.
 *  10. the source did not change under the dump
 *                                         → the manifest and the dump are two
 *      reads. With the app profile up, the alert cron and the snapshot drain are
 *      writing. A concurrent write is reported as `source_mutated_during_dump`,
 *      never as a data divergence — a gate that goes red for a reason that is
 *      not the restore is a gate that stops being read.
 *  11. the restored ledger is clean        → every directory under
 *      `apps/api/prisma/migrations` present, finished, not rolled back, with a
 *      checksum that still matches the bytes on disk.
 *  12. the scratch database was dropped    → its own verdict, never swallowed.
 *
 * THE ONE DANGEROUS PART — read before editing
 * --------------------------------------------
 * This script CREATES and DROPS a database on a real server. The drop is
 * refused unless the target matches `/^restore_drill_\d+$/` AND differs from the
 * source database name. Both conditions are hard-coded and are checked again
 * immediately before the statement is issued. There is no flag that widens them.
 * A bug that let the target resolve to the source would destroy the seeded local
 * dataset mid-run, and the follow-on failures would be attributed to something
 * else.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It is NOT wired into `scripts/ci-gate.sh` or `.github/workflows/ci.yml`, and
 * that absence is a decision, not an oversight (ADR-025 D1). The drill needs a
 * running Postgres; `ci-gate.sh` deliberately needs no services. A stage that
 * cannot run where the gate runs is either skipped — which is DNC-08, a success
 * nobody obtained — or red on every run and routed around, which is R-23. What
 * CI runs is the guard spec,
 * `apps/api/src/shared/quality/restore-drill-gate.spec.ts`, picked up
 * automatically by the `test:api (ratchet)` stage.
 *
 * It does not prove a restore at production data volume, a cross-machine or
 * cross-version restore, PITR/WAL archiving, retention, or an offsite copy, and
 * it has never run against the hosted database. `docs/runbooks/
 * backup-restore-drill.md` §7 states that list plainly rather than leaving it to
 * be discovered.
 *
 * A duration outside the reviewed tolerance is reported loudly and does NOT
 * change the exit code. These numbers are measured on a developer laptop against
 * a Docker volume under variable load; a timing flake that turned the drill red
 * would train the operator to re-run until green, which is how a gate stops
 * being read. Correctness diverging fails. Slowness is reported.
 *
 * There is no bypass: no skip flag, no force flag, no allow-failure flag, and no
 * environment variable is read anywhere except `DATABASE_URL` as a default
 * source (DNC-10). `--update` rewrites the reviewed SLO baseline and shows up in
 * the diff; it refuses to write from any run that found a correctness failure,
 * which is the rule `boot-check.js` learned the hard way when its first
 * `--update` silently froze a broken artefact into a reviewed record.
 *
 * `--inject-fault-sql` is not a bypass and is not an exception to that rule. It
 * can only make the drill fail: the SQL runs against the SCRATCH database
 * strictly between restore and verification, the run is reported with
 * `faultInjected: true`, and the verdict can never be `ok` and can never write a
 * baseline. A seam that is monotone in the failing direction is a test hook; one
 * that can turn a red run green is a bypass.
 *
 * USAGE
 *   node scripts/restore-drill.js                       # the drill (exit 1 on any failure)
 *   node scripts/restore-drill.js --source <url>        # override the source database
 *   node scripts/restore-drill.js --container <name>    # override the postgres container
 *   node scripts/restore-drill.js --mode host           # use a host-side pg client
 *   node scripts/restore-drill.js --update              # record the measured durations
 *   node scripts/restore-drill.js --inject-fault-sql "DELETE FROM student WHERE ctid IN (SELECT ctid FROM student LIMIT 1)"
 */
'use strict';

const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve, sep } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'restore-drill-baseline.json');
const MIGRATIONS_DIR = join(REPO_ROOT, 'apps', 'api', 'prisma', 'migrations');

/**
 * TOOL-22 — shared with `schema-drift-check.js` STRUCTURALLY, not by a comment.
 * Both scripts read this from `scripts/lib/default-database-url.js`, which
 * resolves the project's own env files before falling back to the historical
 * literal. Two scripts addressing two different databases by default was a trap
 * held shut by a promise; now it cannot happen by drift.
 */
const { defaultDatabaseUrl } = require('./lib/default-database-url');

/**
 * TOOL-23 — the same discipline for the CLIENT that TOOL-22 gave the ADDRESS, and
 * shared with `schema-drift-check.js` STRUCTURALLY rather than by a comment.
 *
 * `psql`, `pg_dump` and `pg_restore` used to be spawned as bare names, i.e.
 * through the inherited PATH and nothing else, and this file printed
 * « not found on PATH » as if that settled it. Measured 2026-08-13: the local
 * Windows machine has a complete PostgreSQL 15 client set at
 * `C:\Program Files\PostgreSQL\15\bin`, and only the inherited environment block
 * was stale. `postgresClient()` walks the PATH first (returning the bare name, so
 * nothing that works today changes) and then the well-known install roots — with
 * no variable and no flag that could substitute the client a gate reaches its
 * verdict with (DNC-10).
 */
const { postgresClient } = require('./lib/postgres-client-path');

const DEFAULT_SOURCE = defaultDatabaseUrl();
const DEFAULT_CONTAINER = 'pilotage_postgres';

/**
 * The scratch database name pattern. Hard-coded on purpose — see THE ONE
 * DANGEROUS PART. Nothing may widen it.
 */
const SCRATCH_NAME_PATTERN = /^restore_drill_\d+$/;

/* ================================================================== *
 * The pure verdict layer — no IO, no clock, no environment.
 *
 * Same discipline as `evaluateRelease()` in packages/contracts/src/release:
 * every input is passed in, so the guard spec can drive every branch from
 * fixtures without a database. It is exported from this script rather than from
 * `@pilotage/contracts` because it has exactly one consumer; putting a script's
 * internals into the CJS bundle all three applications load at runtime would be
 * a cost paid by production for a test hook (ADR-025 D3).
 * ================================================================== */

/**
 * Verdict → process exit code. Binary by design (ADR-025 D2): the verdict string
 * is the discriminator, the exit code is only "did it pass". Six sibling scripts
 * already use 0/1; a per-verdict exit namespace would be a new convention for
 * nothing.
 */
const VERDICT_EXIT_CODES = Object.freeze({
  ok: 0,
  unreachable_source: 1,
  tooling_unavailable: 1,
  dump_route_mismatch: 1,
  insufficient_read_role: 1,
  unbaselined_ledger: 1,
  unsafe_scratch_target: 1,
  scratch_not_empty: 1,
  restore_failed: 1,
  empty_manifest: 1,
  missing_table: 1,
  unexpected_table: 1,
  source_mutated_during_dump: 1,
  row_count_divergence: 1,
  checksum_divergence: 1,
  schema_divergence: 1,
  inventory_drift: 1,
  pending_migration: 1,
  ledger_checksum_mismatch: 1,
  slo_unrecorded: 1,
  fault_injected: 1,
  scratch_cleanup_failed: 1,
  unknown: 1,
});

/**
 * Fixed precedence, highest first. Tested, because it decides what an operator
 * reads at the top of a failing run. The rule that matters: a run that both
 * diverges AND fails to clean up reports the DIVERGENCE — otherwise a cleanup
 * bug would downgrade a real data failure — and still lists the cleanup failure
 * in `failures[]`.
 */
const VERDICT_PRECEDENCE = Object.freeze([
  'unreachable_source',
  'tooling_unavailable',
  'dump_route_mismatch',
  'insufficient_read_role',
  'unbaselined_ledger',
  'unsafe_scratch_target',
  'scratch_not_empty',
  'restore_failed',
  'empty_manifest',
  'missing_table',
  'unexpected_table',
  'source_mutated_during_dump',
  'row_count_divergence',
  'checksum_divergence',
  'schema_divergence',
  'inventory_drift',
  'pending_migration',
  'ledger_checksum_mismatch',
  'slo_unrecorded',
  'fault_injected',
  'scratch_cleanup_failed',
  'unknown',
  'ok',
]);

/**
 * The floor below which a "successful" comparison is not evidence of anything.
 * 55 base tables were measured on the local stack (54 application tables + the
 * ledger); a source that suddenly presents a handful of tables is a discovery
 * bug, not a small database.
 */
const MIN_EXPECTED_TABLES = 50;

/** Table name allowlist. The names come from the server, but this script must
 * not be the place a name becomes an injection site. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function isSafeScratchTarget(scratchName, sourceDatabase) {
  if (typeof scratchName !== 'string' || !SCRATCH_NAME_PATTERN.test(scratchName)) return false;
  if (typeof sourceDatabase !== 'string' || sourceDatabase.length === 0) return false;
  return scratchName !== sourceDatabase;
}

/**
 * Compare two manifests, driven by the SOURCE.
 *
 * The iteration order is the whole point (FM-1): a loop over what the RESTORED
 * database contains would compare zero tables when the restore created none,
 * and report a clean pass on an empty database.
 *
 * Pure. Exported so the guard spec can drive it directly.
 */
function buildManifestDiff(sourceManifest, restoredManifest) {
  const diff = {
    missingTables: [],
    unexpectedTables: [],
    rowCountDivergences: [],
    checksumDivergences: [],
    schemaDivergences: [],
  };
  const sourceTables = (sourceManifest && sourceManifest.tables) || [];
  const restoredTables = (restoredManifest && restoredManifest.tables) || [];
  const restoredByName = new Map(restoredTables.map((t) => [t.name, t]));
  const sourceNames = new Set(sourceTables.map((t) => t.name));

  for (const table of sourceTables) {
    const other = restoredByName.get(table.name);
    if (!other) {
      diff.missingTables.push(`${table.name} — present in the source, absent from the restore`);
      continue;
    }
    if (Number(table.rowCount) !== Number(other.rowCount)) {
      diff.rowCountDivergences.push(
        `${table.name} — rowCount: source ${table.rowCount}, restored ${other.rowCount}`,
      );
    }
    if (String(table.checksum) !== String(other.checksum)) {
      diff.checksumDivergences.push(
        `${table.name} — checksum: source ${table.checksum}, restored ${other.checksum}`,
      );
    }
  }
  for (const table of restoredTables) {
    if (!sourceNames.has(table.name)) {
      diff.unexpectedTables.push(`${table.name} — present in the restore, absent from the source`);
    }
  }

  diff.schemaDivergences = diffSchema(
    (sourceManifest && sourceManifest.schema) || null,
    (restoredManifest && restoredManifest.schema) || null,
  );
  return diff;
}

const SCHEMA_KINDS = ['enum', 'column', 'index', 'constraint', 'sequence'];

function diffSchema(sourceSchema, restoredSchema) {
  if (!sourceSchema || !restoredSchema) return [];
  const out = [];
  for (const kind of SCHEMA_KINDS) {
    const left = sourceSchema[kind] || {};
    const right = restoredSchema[kind] || {};
    for (const key of Object.keys(left).sort()) {
      if (!(key in right)) {
        out.push(`${kind} ${key} — present in the source, absent from the restore`);
      } else if (String(left[key]) !== String(right[key])) {
        out.push(`${kind} ${key} — source "${left[key]}", restored "${right[key]}"`);
      }
    }
    for (const key of Object.keys(right).sort()) {
      if (!(key in left)) {
        out.push(`${kind} ${key} — present in the restore, absent from the source`);
      }
    }
  }
  return out;
}

/**
 * Replace the password component of a connection string with `***`.
 *
 * Every line that prints a connection string goes through this. `DATABASE_URL`
 * is `postgresql://pilotage:pilotage@…` — one `console.log` of the raw value, or
 * one child-process error echoing its argv, publishes the credential into a log
 * an operator will paste somewhere (G-TENANT).
 */
function redactConnectionUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return '';
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url.replace(/(:\/\/[^:@/\s]+):[^@/\s]+@/g, '$1:***@');
  }
}

/**
 * The whole verdict, from inputs alone.
 *
 * Total function: a state it does not recognise is `unknown`, exit 1 — never a
 * silent 0, the same `*)` discipline `infra/docker/migrate-entrypoint.sh` uses.
 */
function evaluateDrill(input) {
  if (!input || typeof input !== 'object') {
    return {
      verdict: 'unknown',
      exitCode: VERDICT_EXIT_CODES.unknown,
      failures: ['evaluateDrill received no input — the drill could not describe its own run'],
      durations: null,
      sloExceeded: false,
      baselineWritable: false,
    };
  }

  const {
    sourceReachable = null,
    toolingAvailable = true,
    dumpRouteIdentity = null,
    readRole = null,
    scratchName = null,
    sourceDatabase = null,
    scratchWasEmpty = null,
    restoreOk = null,
    sourceManifest = null,
    restoredManifest = null,
    sourceManifestAfterDump = null,
    sourceLedger = null,
    restoredLedger = null,
    migrationDirectories = [],
    durations = null,
    baseline = null,
    scratchDropped = true,
    faultInjected = false,
    fatalError = null,
  } = input;

  /** @type {{ verdict: string, message: string }[]} */
  const findings = [];
  const fail = (verdict, message) => findings.push({ verdict, message });

  /* --- 0a. REQUIRED EVIDENCE -------------------------------------------
   * Every check below is written as `if (x === false)` / `if (x !== null)`, so
   * an input that simply OMITS a field skips the check that would have used it.
   * `evaluateDrill({})` therefore returned `ok / exit 0 / baselineWritable`
   * before this block existed: an object carrying NO evidence at all read as a
   * clean drill. That is DNC-08 committed by the function whose whole purpose is
   * to enforce DNC-08 — "a check that cannot run must FAIL, never silently
   * pass". `null` was handled and `{}` was not, which is the more dangerous
   * half, because a crashed or half-built run hands you an object, not a null.
   *
   * Found by this slice's own adversarial review, before it merged.
   *
   * The rule: `ok` requires POSITIVE evidence from every stage. Absence is never
   * agreement. */
  const REQUIRED_EVIDENCE = [
    ['sourceReachable', sourceReachable, 'whether the source database was reachable'],
    ['restoreOk', restoreOk, 'whether the restore into the scratch database completed'],
    ['sourceManifest', sourceManifest, 'the manifest taken from the source before the dump'],
    ['restoredManifest', restoredManifest, 'the manifest rebuilt from the restored database'],
    ['sourceLedger', sourceLedger, 'the source migration ledger'],
    ['restoredLedger', restoredLedger, 'the restored migration ledger'],
    ['durations', durations, 'the measured durations — an untimed drill is not a timed drill'],
  ];
  const missingEvidence = REQUIRED_EVIDENCE.filter(([, v]) => v === null || v === undefined);
  if (missingEvidence.length > 0) {
    fail(
      'unknown',
      'the drill did not produce the evidence a verdict requires, so there is no verdict to give. ' +
        `Missing: ${missingEvidence.map(([k, , what]) => `${k} (${what})`).join('; ')}. ` +
        'Reported as a failure rather than skipped, because a run that cannot describe itself is ' +
        'indistinguishable from one that was never attempted (DNC-08)',
    );
  }

  /* --- 0b. the drill could not describe its own run -------------------- */
  if (fatalError) {
    // A crash is not a pass. It lands as `unknown` rather than as a silent 0,
    // the same `*)` discipline infra/docker/migrate-entrypoint.sh uses.
    fail('unknown', `the drill did not complete: ${fatalError}`);
  }

  /* --- 1. reachability and tooling ------------------------------------- */
  if (sourceReachable === false) {
    fail(
      'unreachable_source',
      'the source database could not be reached. That is a FAILURE, and it is reported as one: ' +
        'an unreachable database is the state in which every check below would pass vacuously ' +
        '(DNC-08). The word for what this run is not appears nowhere in its output on purpose',
    );
  }
  if (toolingAvailable === false) {
    fail(
      'tooling_unavailable',
      'no dump route is available — neither `docker exec` into the postgres container nor a ' +
        'host-side `pg_dump` could be used',
    );
  }
  if (dumpRouteIdentity && dumpRouteIdentity.matched === false) {
    fail(
      'dump_route_mismatch',
      `the dump route and the source URL do not address the same server — ${dumpRouteIdentity.detail || 'identity check failed'}`,
    );
  }

  /* --- 2. the reading role -------------------------------------------- */
  if (readRole && readRole.superuser === false && readRole.bypassRls === false) {
    fail(
      'insufficient_read_role',
      `role "${readRole.name}" is neither SUPERUSER nor BYPASSRLS — under row-level security ` +
        'both the dump and the manifest would see only the visible rows, and a partial backup ' +
        'would compare equal to a partial manifest',
    );
  }

  /* --- 3. the source ledger ------------------------------------------- */
  if (sourceLedger && sourceLedger.present === false) {
    fail(
      'unbaselined_ledger',
      'the source database has no `_prisma_migrations` table — it is un-baselined (PF-03). A dump ' +
        'of it restores the data without the database\'s identity, and the next `migrate deploy` ' +
        'would re-run a migration that has already been applied',
    );
  }

  /* --- 4. the scratch target ------------------------------------------ */
  if (scratchName !== null && !isSafeScratchTarget(scratchName, sourceDatabase)) {
    fail(
      'unsafe_scratch_target',
      `refusing to operate on "${scratchName}": a scratch target must match ` +
        `${SCRATCH_NAME_PATTERN} and must not be the source database ("${sourceDatabase}")`,
    );
  }
  if (scratchWasEmpty === false) {
    fail(
      'scratch_not_empty',
      'the scratch database was not empty immediately after creation — the verification connection ' +
        'may be pointed at the source, in which case every comparison would compare the source ' +
        'with itself and pass for ever',
    );
  }

  /* --- 5. the restore -------------------------------------------------- */
  if (restoreOk === false) {
    fail('restore_failed', 'pg_restore did not complete cleanly — see its stderr above');
  }

  /* --- 6. the comparison, driven by the source ------------------------- */
  const sourceTables = (sourceManifest && sourceManifest.tables) || [];
  if (sourceManifest !== null) {
    if (sourceTables.length === 0) {
      fail(
        'empty_manifest',
        'the source manifest is empty — zero comparisons would have been performed, which is a ' +
          'pass that proves nothing',
      );
    } else if (sourceTables.length < MIN_EXPECTED_TABLES) {
      fail(
        'empty_manifest',
        `the source manifest holds only ${sourceTables.length} base tables (floor: ${MIN_EXPECTED_TABLES}) — ` +
          'table discovery is broken, or this is not the database the drill was meant to rehearse',
      );
    }
  }

  if (sourceManifest !== null && restoredManifest !== null) {
    const diff = buildManifestDiff(sourceManifest, restoredManifest);
    for (const m of diff.missingTables) fail('missing_table', m);
    for (const m of diff.unexpectedTables) fail('unexpected_table', m);
    for (const m of diff.rowCountDivergences) fail('row_count_divergence', m);
    for (const m of diff.checksumDivergences) fail('checksum_divergence', m);
    for (const m of diff.schemaDivergences) fail('schema_divergence', m);
  }

  /* --- 7. the source under the dump ------------------------------------ */
  if (sourceManifest !== null && sourceManifestAfterDump !== null) {
    const drift = buildManifestDiff(sourceManifest, sourceManifestAfterDump);
    const changed = [
      ...drift.missingTables,
      ...drift.unexpectedTables,
      ...drift.rowCountDivergences,
      ...drift.checksumDivergences,
    ];
    for (const m of changed) {
      fail(
        'source_mutated_during_dump',
        `${m} — the SOURCE changed while the dump ran; this is a concurrent write, not a restore ` +
          'defect. Re-run with the app profile stopped',
      );
    }
  }

  /* --- 8. the reviewed inventory --------------------------------------- */
  if (baseline && baseline.inventory && sourceManifest !== null && sourceTables.length > 0) {
    const expected = Number(baseline.inventory.tableCount);
    if (Number.isFinite(expected) && expected !== sourceTables.length) {
      fail(
        'inventory_drift',
        `the source has ${sourceTables.length} base tables, the reviewed baseline records ${expected}. ` +
          'A table dropped from schema.prisma disappears from the source AND the restore and would ' +
          'compare equal for ever; the reviewed inventory is what notices',
      );
    }
  }

  /* --- 9. the restored ledger ------------------------------------------ */
  if (restoredLedger !== null && Array.isArray(migrationDirectories)) {
    if (restoredLedger.present === false) {
      fail(
        'unbaselined_ledger',
        'the RESTORED database has no `_prisma_migrations` table — the restore brought back the data ' +
          'without the migration history',
      );
    } else {
      const rows = restoredLedger.rows || [];
      const byName = new Map(rows.map((r) => [r.migrationName, r]));
      for (const dir of migrationDirectories) {
        const row = byName.get(dir);
        if (!row) {
          fail('pending_migration', `migration "${dir}" is on disk but absent from the restored ledger`);
          continue;
        }
        if (row.finished !== true) {
          fail('pending_migration', `migration "${dir}" is in the restored ledger with finished_at NULL`);
        }
        if (row.rolledBack === true) {
          fail('pending_migration', `migration "${dir}" is marked rolled_back in the restored ledger`);
        }
        // `applied_steps_count` is DELIBERATELY not asserted. The obvious check
        // — "> 0, or the migration did nothing" — makes the drill report a false
        // `pending_migration` on any database baselined the way THIS REPOSITORY
        // documents: `prisma migrate resolve --applied 0_baseline` inserts the
        // ledger row without executing steps, so the column takes its DDL
        // default of 0. That path is prescribed by
        // infra/docker/migrate-entrypoint.sh's own refusal message and by
        // docs/runbooks/baseline-hosted-database.md §2, which is exactly the
        // situation the drill exists to reassure an operator about — it would
        // have failed loudest at the moment it was needed most.
        //
        // What actually establishes "applied" is `finished_at IS NOT NULL` and
        // `rolled_back_at IS NULL`, both asserted above, and the checksum match
        // asserted below. A resolved baseline satisfies all three, which is the
        // point of resolving it. Caught by adversarial review before merge.
        if (row.expectedChecksum && row.checksum && row.checksum !== row.expectedChecksum) {
          fail(
            'ledger_checksum_mismatch',
            `migration "${dir}" — checksum: ledger ${row.checksum}, recomputed from ` +
              `apps/api/prisma/migrations/${dir}/migration.sql ${row.expectedChecksum}. The file was ` +
              'edited after it was applied; the ledger and the disk describe different migrations',
          );
        }
      }
    }
  }

  /* --- 10. durations and the reviewed SLO ------------------------------ */
  let sloExceeded = false;
  if (baseline && durations) {
    if (baseline.recordedFrom === null || baseline.recordedFrom === undefined) {
      fail(
        'slo_unrecorded',
        'the SLO baseline carries placeholder durations (`recordedFrom` is null). "We have not ' +
          'measured this" is not a success (DNC-08). Record it with `--update` from a passing run',
      );
    }
    const tolerance =
      baseline.toleranceFactor && Number.isFinite(Number(baseline.toleranceFactor.value))
        ? Number(baseline.toleranceFactor.value)
        : 3;
    for (const key of ['dumpMs', 'restoreMs', 'verifyMs', 'totalMs']) {
      const recorded =
        baseline.durations && baseline.durations[key] ? Number(baseline.durations[key].value) : NaN;
      const measured = Number(durations[key]);
      if (!Number.isFinite(recorded) || recorded <= 0 || !Number.isFinite(measured)) continue;
      if (measured > recorded * tolerance) sloExceeded = true;
    }
  }

  /* --- 11. the fault-injection seam ------------------------------------ */
  if (faultInjected === true) {
    fail(
      'fault_injected',
      'this run injected a fault into the scratch database between restore and verification. It is ' +
        'reported as a non-passing run by construction, whatever it found, and it can never write a ' +
        'baseline',
    );
  }

  /* --- 12. cleanup ------------------------------------------------------ */
  if (scratchDropped === false) {
    fail(
      'scratch_cleanup_failed',
      'the scratch database was NOT dropped — a leaked scratch database is a real, accumulating cost ' +
        'and the next run\'s CREATE DATABASE would fail for the wrong reason',
    );
  }

  const failures = findings.map((f) => f.message);
  let verdict = 'ok';
  for (const candidate of VERDICT_PRECEDENCE) {
    if (candidate === 'ok') break;
    if (findings.some((f) => f.verdict === candidate)) {
      verdict = candidate;
      break;
    }
  }

  // `--update` may write only from a run with no correctness failure and no
  // injected fault. `slo_unrecorded` is the single verdict that still permits a
  // write, because recording the durations is precisely its remedy — every other
  // verdict means the numbers describe a run that did not restore correctly, and
  // a failed restore is *fast*, so freezing those durations would permanently
  // loosen the SLO.
  //
  // `inventory_drift` is the second, and it is here because leaving it out
  // deadlocked the file: the moment `schema.prisma` gains or loses a table, the
  // source table count stops matching `baseline.inventory.tableCount`, the
  // verdict becomes `inventory_drift`, `baselineWritable` goes false — and the
  // only remedy the runbook offers for a changed inventory is `--update`, which
  // the same flag now refuses. The drill would have gone permanently red on the
  // first legitimate migration, with its own documented fix unreachable.
  //
  // It is safe to allow precisely because it is an INVENTORY statement, not a
  // fidelity one: `inventory_drift` compares the source against the stored
  // baseline, while source-vs-restored fidelity is decided by `missing_table`,
  // `row_count_divergence`, `checksum_divergence` and `schema_divergence`, all
  // of which still block a write. A run that drifted AND diverged therefore
  // still refuses, because the divergence verdict is in this list.
  //
  // Both exceptions were found by this slice's adversarial review, before merge.
  const BASELINE_WRITABLE_DESPITE = new Set(['slo_unrecorded', 'inventory_drift']);
  const correctnessVerdicts = findings
    .map((f) => f.verdict)
    .filter((v) => !BASELINE_WRITABLE_DESPITE.has(v));
  const baselineWritable = correctnessVerdicts.length === 0;

  return {
    verdict,
    exitCode: VERDICT_EXIT_CODES[verdict] ?? VERDICT_EXIT_CODES.unknown,
    failures,
    durations: durations || null,
    sloExceeded,
    baselineWritable,
  };
}

/* ================================================================== *
 * The impure layer: everything below touches a real server.
 * ================================================================== */

/**
 * Session pins applied to EVERY connection, source and restored alike.
 *
 * `row_security = off` is the load-bearing one (see check 4). The other three
 * make `md5(row::text)` deterministic across two sessions: without them a
 * `timestamptz` renders in the session's TimeZone and DateStyle and a float in
 * the session's `extra_float_digits`, and the source read and the restored read
 * are different sessions. A checksum that changes without the data changing is a
 * bug in these pins, not a restore failure.
 */
const SESSION_PINS = [
  'SET row_security = off;',
  "SET TimeZone = 'UTC';",
  "SET DateStyle = 'ISO, MDY';",
  'SET extra_float_digits = 3;',
  "SET client_encoding = 'UTF8';",
];

/** ASCII unit separator (0x1F): it cannot occur in a table name, an index
 * definition or an md5 digest, so it is unambiguous as the column separator for
 * `psql -A -F`. Written as an escape, never as a literal control character. */
const FIELD_SEP = String.fromCharCode(31);

function parseArgs(argv) {
  const args = {
    source: process.env.DATABASE_URL || DEFAULT_SOURCE,
    container: DEFAULT_CONTAINER,
    mode: 'docker',
    update: false,
    injectFaultSql: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') args.source = argv[++i];
    else if (arg === '--container') args.container = argv[++i];
    else if (arg === '--mode') args.mode = argv[++i];
    else if (arg === '--update') args.update = true;
    else if (arg === '--inject-fault-sql') args.injectFaultSql = argv[++i];
    else if (arg.startsWith('--')) {
      console.error(`✗ unknown option ${arg}`);
      console.error('  This script has no bypass option. See the USAGE block in its header.');
      process.exit(1);
    }
  }
  if (args.mode !== 'docker' && args.mode !== 'host') {
    console.error(`✗ --mode must be "docker" or "host", got "${args.mode}"`);
    process.exit(1);
  }
  return args;
}

function parseSource(url) {
  const parsed = new URL(url);
  return {
    url,
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username || 'postgres'),
    password: decodeURIComponent(parsed.password || ''),
    database: decodeURIComponent((parsed.pathname || '/').slice(1)) || 'postgres',
  };
}

function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, {
    encoding: options.encoding === null ? 'buffer' : 'utf8',
    input: options.input,
    maxBuffer: 256 * 1024 * 1024,
    shell: false,
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
  return {
    status: result.error ? -1 : result.status,
    stdout: result.stdout ? String(result.stdout) : '',
    stderr: result.error ? String(result.error.message) : result.stderr ? String(result.stderr) : '',
  };
}

/**
 * A `run()`-SHAPED result for a client that could not be located (TOOL-23).
 *
 * Shaped rather than thrown, and shaped rather than a new branch at each caller:
 * every host-route call site already reports a non-zero `status` with its
 * `stderr`, so this makes the run describe the real reason — WHAT was searched —
 * with no new control flow and no broadened catch. A route that cannot be found
 * is still a FAILURE with a verdict (DNC-08); it is simply an actionable one.
 */
function unavailableClient(name, client) {
  return {
    status: -1,
    stdout: '',
    stderr:
      `${name} was not found on PATH nor at any well-known PostgreSQL install root. Searched:\n` +
      client.tried.map((line) => `      ${line}`).join('\n'),
  };
}

/**
 * One SQL round trip. SQL travels on **stdin**, never as a `-c` argument and
 * never through a shell: `docker exec sh -c` with a heredoc breaks on CRLF —
 * which has already bitten this repository once — and Windows `spawnSync`
 * quoting is its own trap.
 */
function makeRunner(source, args) {
  const psql = (database, sql, opts = {}) => {
    const flags = [
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-t',
      '-A',
      '-F',
      FIELD_SEP,
      '--no-psqlrc',
      '-d',
      database,
    ];
    const body = [...(opts.raw ? [] : SESSION_PINS), sql].join('\n');
    if (args.mode === 'docker') {
      return run('docker', ['exec', '-i', args.container, 'psql', '-U', source.user, ...flags], {
        input: body,
      });
    }
    // Host route. The password goes through the environment, never argv:
    // `docker inspect` and the process table both publish argv. TOOL-23 changed
    // WHICH binary is spawned — discovered rather than assumed to be on PATH —
    // and deliberately nothing about HOW the credential travels (ADR-025 D6).
    const psqlClient = postgresClient('psql');
    if (!psqlClient.command) return unavailableClient('psql', psqlClient);
    return run(psqlClient.command, ['-h', source.host, '-p', source.port, '-U', source.user, ...flags], {
      input: body,
      env: source.password ? { PGPASSWORD: source.password } : undefined,
    });
  };

  const rows = (database, sql, opts) => {
    const result = psql(database, sql, opts);
    if (result.status !== 0) {
      const error = new Error(result.stderr.trim() || `psql exited ${result.status}`);
      error.psql = true;
      throw error;
    }
    return result.stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => line.split(FIELD_SEP));
  };

  return { psql, rows };
}

/* ------------------------------------------------------------------ *
 * The manifest
 * ------------------------------------------------------------------ */

const TABLE_LIST_SQL = [
  "SELECT table_name FROM information_schema.tables",
  "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  'ORDER BY table_name;',
].join('\n');

/**
 * Row count AND content checksum for one table, in one scan.
 *
 * The checksum is an ORDER-INDEPENDENT ordered aggregate: hash each row, sort
 * the hashes, hash the concatenation. Sorting on the row hash rather than on a
 * key is deliberate — several tables have composite or no natural ordering key,
 * and a dump/restore does not preserve physical row order, so ordering by
 * anything else (`ctid` above all) would manufacture divergences. `COLLATE "C"`
 * pins the sort against the database's lc_collate.
 *
 * `md5(t::text)` is one-way and is computed server-side, so no row content ever
 * crosses the wire (G-TENANT).
 */
function tableProbeSql(tables) {
  return `${tables
    .map(
      (name) =>
        `SELECT '${name}' AS t, count(*)::text AS n, coalesce(md5(string_agg(h, '' ORDER BY h COLLATE "C")), '') AS c ` +
        `FROM (SELECT md5(x::text) AS h FROM "${name}" x) s`,
    )
    .join('\nUNION ALL\n')}\nORDER BY 1;`;
}

const SCHEMA_SQL = [
  "SELECT 'enum'::text AS kind, t.typname::text AS obj,",
  "       string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)::text AS val",
  '  FROM pg_type t',
  '  JOIN pg_enum e ON e.enumtypid = t.oid',
  '  JOIN pg_namespace n ON n.oid = t.typnamespace',
  "  WHERE n.nspname = 'public' GROUP BY t.typname",
  'UNION ALL',
  "SELECT 'column', (c.table_name || '.' || c.column_name)::text,",
  "       (c.udt_name || '|' || c.is_nullable || '|' || c.ordinal_position::text)::text",
  "  FROM information_schema.columns c WHERE c.table_schema = 'public'",
  'UNION ALL',
  "SELECT 'index', i.indexname::text, i.indexdef::text",
  "  FROM pg_indexes i WHERE i.schemaname = 'public'",
  'UNION ALL',
  // CHECK constraints are excluded on purpose: PostgreSQL names the implicit
  // NOT NULL checks after object OIDs, which differ between two databases by
  // construction, so including them would guarantee a false divergence.
  "SELECT 'constraint', tc.constraint_name::text, (tc.table_name || '|' || tc.constraint_type)::text",
  "  FROM information_schema.table_constraints tc",
  "  WHERE tc.table_schema = 'public'",
  "    AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')",
  'UNION ALL',
  "SELECT 'sequence', s.sequencename::text, coalesce(s.last_value::text, 'unset')",
  "  FROM pg_sequences s WHERE s.schemaname = 'public'",
  'ORDER BY 1, 2, 3;',
].join('\n');

const LEDGER_PRESENT_SQL = "SELECT (to_regclass('public._prisma_migrations') IS NOT NULL)::text;";

/** `psql -A -t` renders an uncast boolean as `t`/`f` and a `::text`-cast one as
 * `true`/`false`. Accepting both is not laxness: reading it wrong is silent — the
 * first run of this drill reported `superuser=false` on a superuser role and
 * `ledger ABSENT` on a database whose ledger was right there. */
const isTrue = (value) => value === 'true' || value === 't';

const LEDGER_SQL = [
  'SELECT migration_name, checksum, (finished_at IS NOT NULL)::text,',
  '       (rolled_back_at IS NOT NULL)::text, applied_steps_count::text',
  '  FROM "_prisma_migrations" ORDER BY migration_name;',
].join('\n');

function buildManifest(runner, database) {
  const tables = runner
    .rows(database, TABLE_LIST_SQL)
    .map((r) => r[0])
    .filter((name) => {
      if (SAFE_IDENTIFIER.test(name)) return true;
      throw new Error(
        `table name "${name}" does not match ${SAFE_IDENTIFIER} — refusing to interpolate it into SQL`,
      );
    });

  const probe = tables.length > 0 ? runner.rows(database, tableProbeSql(tables)) : [];
  const manifest = {
    tables: probe.map(([name, rowCount, checksum]) => ({
      name,
      rowCount: Number(rowCount),
      checksum,
    })),
    schema: { enum: {}, column: {}, index: {}, constraint: {}, sequence: {} },
  };
  for (const [kind, obj, val] of runner.rows(database, SCHEMA_SQL)) {
    if (manifest.schema[kind]) manifest.schema[kind][obj] = val ?? '';
  }
  return manifest;
}

function readLedger(runner, database) {
  const present = isTrue(runner.rows(database, LEDGER_PRESENT_SQL)[0][0]);
  if (!present) return { present: false, rows: [] };
  const rows = runner
    .rows(database, LEDGER_SQL)
    .map(([migrationName, checksum, finished, rolledBack, appliedStepsCount]) => ({
      migrationName,
      checksum,
      finished: isTrue(finished),
      rolledBack: isTrue(rolledBack),
      appliedStepsCount: Number(appliedStepsCount),
      expectedChecksum: migrationChecksumOnDisk(migrationName),
    }));
  return { present: true, rows };
}

/**
 * Prisma stores the sha256 of the migration file's raw bytes. Recomputing it
 * here is what catches a migration edited AFTER it was applied — the ledger
 * still says "applied" and the disk says something else, which is the
 * G-MIGRATION defect this epic exists for.
 */
function migrationChecksumOnDisk(migrationName) {
  const file = join(MIGRATIONS_DIR, migrationName, 'migration.sql');
  if (!existsSync(file)) return null;
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Directories only. `readdirSync` also returns `migration_lock.toml`, and a
 * drill that demanded a migration by that name would fail on every run for ever
 * and would then be "fixed" by loosening the check. */
function migrationDirectories() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/* ------------------------------------------------------------------ *
 * The drill
 * ------------------------------------------------------------------ */

function ms(start) {
  return Number((process.hrtime.bigint() - start) / 1000000n);
}

function describeSource(source) {
  return `${source.host}:${source.port}/${source.database} as ${source.user}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let source;
  try {
    source = parseSource(args.source);
  } catch (error) {
    // A source that is not even a connection string is unreachable, not a usage
    // error to shrug at: the run produced no evidence, so it exits non-zero with
    // the verdict that says so.
    console.error(`✗ --source is not a usable connection string: ${redactConnectionUrl(String(error.message))}`);
    const outcome = evaluateDrill({ sourceReachable: false });
    console.error(`\nRESTORE DRILL: FAIL — ${outcome.verdict}`);
    process.exitCode = outcome.exitCode;
    return outcome;
  }

  const runner = makeRunner(source, args);
  const scratchName = `restore_drill_${Date.now()}`;
  const dumpPath = `/tmp/${scratchName}.dump`;
  const faultInjected = typeof args.injectFaultSql === 'string' && args.injectFaultSql.length > 0;

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  RESTORE DRILL — timed dump → restore → verify (VAL-03, R-01)');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  source     : ${describeSource(source)}`);
  console.log(`  url        : ${redactConnectionUrl(source.url)}`);
  console.log(`  route      : ${args.mode === 'docker' ? `docker exec ${args.container}` : 'host pg client'}`);
  console.log(`  scratch    : ${scratchName}`);
  console.log('');

  const state = {
    sourceReachable: null,
    toolingAvailable: true,
    dumpRouteIdentity: null,
    readRole: null,
    scratchName: null,
    sourceDatabase: source.database,
    scratchWasEmpty: null,
    restoreOk: null,
    sourceManifest: null,
    restoredManifest: null,
    sourceManifestAfterDump: null,
    sourceLedger: null,
    restoredLedger: null,
    migrationDirectories: migrationDirectories(),
    durations: { dumpMs: 0, restoreMs: 0, verifyMs: 0, totalMs: 0 },
    baseline: loadBaseline(),
    scratchDropped: true,
    faultInjected,
    fatalError: null,
  };

  let scratchCreated = false;
  const cleanup = () => {
    if (!scratchCreated) return;
    scratchCreated = false;
    state.scratchDropped = dropScratch(runner, args, source, scratchName, dumpPath);
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.error(`\n✗ ${signal} received — dropping the scratch database before exiting`);
      cleanup();
      process.exit(1);
    });
  }
  process.on('uncaughtException', (error) => {
    console.error(`\n✗ ${error && error.message ? error.message : error}`);
    cleanup();
    process.exit(1);
  });

  const startedAt = process.hrtime.bigint();

  // The drill body. It never reports and never exits: every exit path — an early
  // failure, a crash, a signal — has to pass through the same cleanup and the
  // same single `report()` call below, or a run could end without dropping its
  // scratch database or without stating a verdict.
  const drill = () => {
    /* -- tooling ------------------------------------------------------ */
    state.toolingAvailable = checkTooling(args);
    if (!state.toolingAvailable) return;

    /* -- reachability -------------------------------------------------- */
    try {
      const role = runner.rows(
        source.database,
        [
          'SELECT current_user::text,',
          '       (SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user),',
          '       (SELECT rolbypassrls::text FROM pg_roles WHERE rolname = current_user),',
          '       current_database()::text;',
        ].join('\n'),
      )[0];
      state.sourceReachable = true;
      state.readRole = { name: role[0], superuser: isTrue(role[1]), bypassRls: isTrue(role[2]) };
      if (role[3] !== source.database) {
        state.dumpRouteIdentity = {
          matched: false,
          detail: `connected to "${role[3]}" but the source URL names "${source.database}"`,
        };
      }
      console.log(`▶ source reachable — role ${state.readRole.name} (superuser=${state.readRole.superuser}, bypassrls=${state.readRole.bypassRls})`);
    } catch (error) {
      state.sourceReachable = false;
      console.error(`✗ cannot reach ${describeSource(source)}: ${redactConnectionUrl(String(error.message))}`);
      return;
    }

    /* -- route identity ------------------------------------------------ */
    if (!state.dumpRouteIdentity) state.dumpRouteIdentity = checkRouteIdentity(args, source);

    /* -- source manifest, BEFORE the dump ------------------------------ */
    process.stdout.write('▶ building the source manifest … ');
    state.sourceManifest = buildManifest(runner, source.database);
    state.sourceLedger = readLedger(runner, source.database);
    console.log(
      `${state.sourceManifest.tables.length} base tables, ` +
        `${totalRows(state.sourceManifest)} rows, ledger ${state.sourceLedger.present ? 'present' : 'ABSENT'}`,
    );
    if (!state.sourceLedger.present) return;
    if (state.dumpRouteIdentity && state.dumpRouteIdentity.matched === false) {
      return;
    }

    /* -- the timed dump ------------------------------------------------ */
    process.stdout.write('▶ dumping … ');
    const dumpStart = process.hrtime.bigint();
    const dump = pgDump(args, source, dumpPath);
    state.durations.dumpMs = ms(dumpStart);
    if (dump.status !== 0) {
      console.log('FAILED');
      console.error(indent(dump.stderr.trim(), 4));
      state.restoreOk = false;
      return;
    }
    console.log(`${state.durations.dumpMs} ms`);

    /* -- re-read the source: did it change under the dump? ------------- */
    state.sourceManifestAfterDump = buildManifest(runner, source.database);

    /* -- the scratch database ------------------------------------------ */
    if (!isSafeScratchTarget(scratchName, source.database)) {
      state.scratchName = scratchName;
      return;
    }
    state.scratchName = scratchName;
    sweepOrphans(runner, args, source);
    createScratch(runner, args, source, scratchName);
    scratchCreated = true;

    const scratchTables = runner.rows(scratchName, TABLE_LIST_SQL).length;
    state.scratchWasEmpty = scratchTables === 0;
    if (!state.scratchWasEmpty) {
      console.error(`✗ the freshly created scratch database already holds ${scratchTables} base tables`);
      return;
    }

    /* -- the timed restore --------------------------------------------- */
    process.stdout.write('▶ restoring … ');
    const restoreStart = process.hrtime.bigint();
    const restore = pgRestore(args, source, scratchName, dumpPath);
    state.durations.restoreMs = ms(restoreStart);
    state.restoreOk = restore.status === 0;
    console.log(`${state.durations.restoreMs} ms${state.restoreOk ? '' : ' (pg_restore reported errors)'}`);
    // Always print the restore's stderr: pg_restore's warnings are the only
    // record of what it could not put back.
    if (restore.stderr.trim().length > 0) console.error(indent(restore.stderr.trim(), 4));

    /* -- the fault-injection seam -------------------------------------- */
    if (faultInjected) {
      console.log('▶ injecting a fault into the SCRATCH database (this run can never pass)');
      runner.psql(scratchName, args.injectFaultSql);
    }

    /* -- verification, its own phase ----------------------------------- */
    process.stdout.write('▶ verifying … ');
    const verifyStart = process.hrtime.bigint();
    const identity = runner.rows(scratchName, 'SELECT current_database()::text;')[0][0];
    if (identity !== scratchName) {
      // The one failure a comparison can never catch, because the comparison is
      // the thing that broke: a URL-rewrite bug that verifies the source against
      // itself matches every field for ever.
      throw new Error(
        `the verification connection reports current_database() = "${identity}", expected "${scratchName}"`,
      );
    }
    state.restoredManifest = buildManifest(runner, scratchName);
    state.restoredLedger = readLedger(runner, scratchName);
    state.durations.verifyMs = ms(verifyStart);
    console.log(
      `${state.durations.verifyMs} ms — ${state.restoredManifest.tables.length} base tables, ` +
        `${totalRows(state.restoredManifest)} rows`,
    );
  };

  try {
    drill();
  } catch (error) {
    // A crash is a FAILURE with a verdict, not a stack trace and an unknown
    // state: the run is reported as `unknown`, exit 1.
    state.fatalError = redactConnectionUrl(String((error && error.message) || error));
    console.error(`
✗ ${state.fatalError}`);
  } finally {
    cleanup();
    state.durations.totalMs = ms(startedAt);
  }

  return report(state, args, source);
}

function totalRows(manifest) {
  return (manifest.tables || []).reduce((sum, t) => sum + Number(t.rowCount || 0), 0);
}

function checkTooling(args) {
  if (args.mode === 'docker') {
    const docker = run('docker', ['inspect', '--format', '{{.State.Running}}', args.container]);
    if (docker.status === 0 && docker.stdout.trim() === 'true') return true;
    console.error(`✗ no dump route available. Tried:`);
    console.error(`    1. docker exec ${args.container} — ${docker.stderr.trim() || docker.stdout.trim() || 'container not running'}`);
    console.error(`    2. a host-side pg client — not attempted (use --mode host)`);
    return false;
  }
  // TOOL-23: the client is DISCOVERED before it is probed. The message that used
  // to stand here — "not found on PATH" — was, on this machine, a false statement
  // printed to an operator: a complete client set sat at
  // `C:\Program Files\PostgreSQL\15\bin` the whole time. A route that cannot be
  // found is still a failure, but the failure now names everything it searched so
  // the operator can act on it.
  const pgDumpClient = postgresClient('pg_dump');
  const host = pgDumpClient.command
    ? run(pgDumpClient.command, ['--version'])
    : unavailableClient('pg_dump', pgDumpClient);
  if (host.status === 0) return true;
  console.error('✗ no dump route available. Tried:');
  console.error(
    `    1. a host-side pg_dump — ${
      host.stderr.trim() || 'not found on PATH nor at any well-known PostgreSQL install root'
    }`,
  );
  console.error('    2. docker exec — not attempted (drop --mode host)');
  return false;
}

/**
 * The container we exec into must publish the port the source URL addresses.
 *
 * This is the cheap half of the "two independent sources" discipline the release
 * gate uses for GIT_SHA. It cannot catch every mismatch — it proves the port
 * mapping, not the cluster identity — and that limit is stated in the runbook
 * rather than implied away.
 */
function checkRouteIdentity(args, source) {
  if (args.mode !== 'docker') return { matched: true, detail: 'host route addresses the URL directly' };
  const mapped = run('docker', ['port', args.container, '5432/tcp']);
  if (mapped.status !== 0 || mapped.stdout.trim() === '') {
    return {
      matched: false,
      detail:
        `container ${args.container} publishes no port for 5432/tcp, so it cannot be the server at ` +
        `${source.host}:${source.port}. If the stack was started without \`--env-file .env\`, ` +
        'Compose resolved no POSTGRES_PORT and the container came up with no published ports (PF-86)',
    };
  }
  const ports = mapped.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(line.lastIndexOf(':') + 1));
  if (!ports.includes(String(source.port))) {
    return {
      matched: false,
      detail: `container ${args.container} publishes 5432 on [${ports.join(', ')}] but the source URL addresses port ${source.port}`,
    };
  }
  return { matched: true, detail: `container ${args.container} publishes 5432 on ${source.port}` };
}

function pgDump(args, source, dumpPath) {
  const flags = ['-Fc', '--no-owner', '--no-privileges', '-f', dumpPath, '-d', source.database];
  if (args.mode === 'docker') {
    return run('docker', ['exec', args.container, 'pg_dump', '-U', source.user, ...flags]);
  }
  const pgDumpClient = postgresClient('pg_dump');
  if (!pgDumpClient.command) return unavailableClient('pg_dump', pgDumpClient);
  return run(pgDumpClient.command, ['-h', source.host, '-p', source.port, '-U', source.user, ...flags], {
    env: source.password ? { PGPASSWORD: source.password } : undefined,
  });
}

function pgRestore(args, source, scratchName, dumpPath) {
  // `--exit-on-error` is not optional: without it pg_restore prints "errors
  // ignored on restore: N" and a drill that trusted the exit code would report a
  // successful restore of nothing. `--no-owner --no-privileges` removes the
  // benign ownership/ACL notices that would otherwise make --exit-on-error fire
  // on a healthy restore.
  const flags = ['--exit-on-error', '--no-owner', '--no-privileges', '-d', scratchName, dumpPath];
  if (args.mode === 'docker') {
    return run('docker', ['exec', args.container, 'pg_restore', '-U', source.user, ...flags]);
  }
  const pgRestoreClient = postgresClient('pg_restore');
  if (!pgRestoreClient.command) return unavailableClient('pg_restore', pgRestoreClient);
  return run(pgRestoreClient.command, ['-h', source.host, '-p', source.port, '-U', source.user, ...flags], {
    env: source.password ? { PGPASSWORD: source.password } : undefined,
  });
}

function createScratch(runner, args, source, scratchName) {
  // TEMPLATE template0 on purpose: template1 on a machine where someone once
  // seeded it would arrive pre-populated and defeat the emptiness assertion.
  // The collation is copied from the source so the `COLLATE "C"` sort and the
  // text rendering match on both sides.
  const sql = [
    `CREATE DATABASE "${scratchName}" TEMPLATE template0`,
    `  ENCODING 'UTF8'`,
    `  LC_COLLATE (SELECT datcollate FROM pg_database WHERE datname = '${source.database}')`,
    `  LC_CTYPE (SELECT datctype FROM pg_database WHERE datname = '${source.database}');`,
  ].join('\n');
  const attempt = runner.psql('postgres', sql, { raw: true });
  if (attempt.status === 0) return;
  // `CREATE DATABASE … LC_COLLATE (SELECT …)` is not accepted by every server
  // build; fall back to the plain form rather than failing the drill on syntax.
  const fallback = runner.psql('postgres', `CREATE DATABASE "${scratchName}" TEMPLATE template0;`, {
    raw: true,
  });
  if (fallback.status !== 0) {
    throw new Error(`could not create the scratch database: ${fallback.stderr.trim()}`);
  }
}

/**
 * Drop the scratch database, and the dump file with it.
 *
 * The two safety conditions are re-checked here, immediately before the
 * statement is issued, and not only at the call site. This is the one place the
 * drill can destroy something.
 */
function dropScratch(runner, args, source, scratchName, dumpPath) {
  if (!isSafeScratchTarget(scratchName, source.database)) {
    console.error(
      `✗ REFUSING to drop "${scratchName}": it does not match ${SCRATCH_NAME_PATTERN} or it is the source database`,
    );
    return false;
  }
  // Close nothing to close: every psql above is a separate short-lived process.
  // WITH (FORCE) still matters — a stray session (a psql left open by an
  // operator) would otherwise make the drop fail with "is being accessed by
  // other users" and leak the database.
  const dropped = runner.psql('postgres', `DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE);`, {
    raw: true,
  });
  if (args.mode === 'docker') {
    run('docker', ['exec', args.container, 'rm', '-f', dumpPath]);
  } else {
    run('rm', ['-f', dumpPath]);
  }
  if (dropped.status !== 0) {
    console.error(`✗ could not drop the scratch database "${scratchName}":`);
    console.error(indent(dropped.stderr.trim(), 4));
    console.error('  Run this by hand — a leaked scratch database accumulates:');
    console.error(`    docker exec ${args.container} psql -U ${source.user} -d postgres -c 'DROP DATABASE "${scratchName}" WITH (FORCE);'`);
    return false;
  }
  console.log(`▶ scratch database "${scratchName}" dropped`);
  return true;
}

/** Report, never silently remove: an orphan is evidence that a previous run
 * died on a path the cleanup did not cover. */
function sweepOrphans(runner, args, source) {
  let orphans = [];
  try {
    orphans = runner
      .rows('postgres', "SELECT datname::text FROM pg_database WHERE datname LIKE 'restore\\_drill\\_%';", {
        raw: true,
      })
      .map((r) => r[0]);
  } catch {
    return;
  }
  for (const orphan of orphans) {
    console.error(`⚠ leftover scratch database from an earlier run: ${orphan} — dropping it`);
    dropScratch(runner, args, source, orphan, `/tmp/${orphan}.dump`);
  }
}

/* ------------------------------------------------------------------ *
 * Baseline + report
 * ------------------------------------------------------------------ */

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

const BASELINE_COMMENT =
  'Reviewed SLO baseline for scripts/restore-drill.js. Every entry carries a written reason, never a ' +
  'bare number: a duration without the dataset and machine it was measured on is not an SLO. ' +
  'Rewritten deliberately with `node scripts/restore-drill.js --update`, which refuses to write from ' +
  'any run that found a correctness failure or injected a fault — the diff is meant to be reviewed. ' +
  'Exceeding toleranceFactor is reported as a WARN and does NOT fail the drill; see FR-8 in the ' +
  'runbook for why.';

function writeBaseline(state, source) {
  const previous = state.baseline || {};
  const manifest = state.sourceManifest || { tables: [] };
  const nonEmpty = manifest.tables.filter((t) => Number(t.rowCount) > 0).length;
  const next = {
    $comment: BASELINE_COMMENT,
    recordedAt: new Date().toISOString(),
    recordedFrom: `${source.host}:${source.port}/${source.database} (local Docker stack)`,
    source: { host: source.host, port: Number(source.port), database: source.database },
    inventory: {
      tableCount: manifest.tables.length,
      nonEmptyTableCount: nonEmpty,
      totalRows: totalRows(manifest),
      reason:
        'Measured by the drill on the local Docker stack after the migrator applied 0_baseline and the ' +
        'demo seed ran (tenant demo, school VOLTAIRE). tableCount drift is a hard failure: a table ' +
        'dropped from schema.prisma vanishes from the source AND the restore and would compare equal ' +
        'for ever. Row totals move with the seed and are reported, not enforced.',
    },
    ledger: {
      migrations: state.migrationDirectories,
      reason:
        'Every directory under apps/api/prisma/migrations must come back in the restored ' +
        '_prisma_migrations, finished and not rolled back. A restore without the migration history is a ' +
        'restore of the data, not of the database.',
    },
    durations: {
      dumpMs: { value: state.durations.dumpMs, reason: durationReason('pg_dump -Fc of the whole database') },
      restoreMs: {
        value: state.durations.restoreMs,
        reason: durationReason('pg_restore --exit-on-error into a fresh scratch database'),
      },
      verifyMs: {
        value: state.durations.verifyMs,
        reason: durationReason('rebuilding the manifest from the restored database and comparing it'),
      },
      totalMs: {
        value: state.durations.totalMs,
        reason: durationReason('the whole cycle, including manifest builds and cleanup'),
      },
    },
    toleranceFactor: {
      value:
        previous.toleranceFactor && Number.isFinite(Number(previous.toleranceFactor.value))
          ? Number(previous.toleranceFactor.value)
          : 3,
      reason:
        'Wide on purpose. The measurement is a developer laptop against a Docker volume under variable ' +
        'load; a tight factor would make the drill flake, and a gate that flakes is re-run until green ' +
        'instead of read. Exceeding it is a WARN, never a non-zero exit.',
    },
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`\n✎ baseline rewritten: ${rel(BASELINE_PATH)}`);
}

function durationReason(what) {
  return `Measured by \`node scripts/restore-drill.js --update\` — ${what}. Windows 11 host, Docker Desktop, postgres:15-alpine, the seeded demo dataset recorded under \`inventory\`.`;
}

function report(state, args, source) {
  const outcome = evaluateDrill(state);

  console.log('');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(
    `  durations: dump ${state.durations.dumpMs} ms · restore ${state.durations.restoreMs} ms · ` +
      `verify ${state.durations.verifyMs} ms · total ${state.durations.totalMs} ms`,
  );
  if (outcome.sloExceeded) {
    console.log('  WARN: a duration exceeded the reviewed tolerance. This is reported, not failed —');
    console.log('        see the SLO section of docs/runbooks/backup-restore-drill.md.');
  }
  console.log('──────────────────────────────────────────────────────────────');

  if (args.update) {
    if (!outcome.baselineWritable) {
      console.error('\n✗ refusing to write the baseline: this run did not restore correctly.');
      for (const failure of outcome.failures) console.error(`\n  ✗ ${failure}`);
      console.error('\n  A failed restore is FAST — it restored less. Recording its durations would');
      console.error('  permanently loosen the SLO, and recording its inventory would freeze the');
      console.error('  breakage into the reviewed record.\n');
      process.exitCode = 1;
      return outcome;
    }
    writeBaseline(state, source);
    process.exitCode = 0;
    return outcome;
  }

  if (outcome.verdict !== 'ok') {
    console.error('');
    console.error('══════════════════════════════════════════════════════════════');
    console.error(`  RESTORE DRILL: FAIL — ${outcome.verdict}`);
    console.error('══════════════════════════════════════════════════════════════');
    for (const failure of outcome.failures) console.error(`\n✗ ${failure}`);
    console.error('');
    console.error('  Verdict meanings and the operator action for each are in');
    console.error('  docs/runbooks/backup-restore-drill.md §5.');
    console.error('');
    process.exitCode = outcome.exitCode;
    return outcome;
  }

  console.log('');
  console.log(
    `RESTORE DRILL: PASS — ${state.sourceManifest.tables.length} tables, ` +
      `${totalRows(state.sourceManifest)} rows restored and verified row-count + checksum + schema`,
  );
  process.exitCode = 0;
  return outcome;
}

function rel(path) {
  return path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1).split(sep).join('/') : path;
}

function indent(text, spaces = 4) {
  const pad = ' '.repeat(spaces);
  return String(text)
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

module.exports = {
  evaluateDrill,
  redactConnectionUrl,
  buildManifestDiff,
  isSafeScratchTarget,
  VERDICT_EXIT_CODES,
  VERDICT_PRECEDENCE,
  SCRATCH_NAME_PATTERN,
};

// NOT a bare `main()` at module scope. The guard spec `require()`s this file to
// reach the pure exports, and it runs inside `pnpm test` on every developer's
// machine: a bare call would create and drop a database as a side effect of
// importing a module.
if (require.main === module) {
  main();
}
