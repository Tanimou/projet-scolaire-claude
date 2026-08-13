'use strict';

/**
 * The ONE place the default database address is decided.
 *
 * THE DEFECT THIS EXISTS FOR
 * --------------------------
 * `schema-drift-check.js` and `restore-drill.js` each carried the literal
 * `postgresql://pilotage:pilotage@127.0.0.1:5433/pilotage?schema=public`, with a
 * comment in each saying the two MUST agree because "two scripts addressing two
 * different databases by default would be a trap of its own". That property was
 * held by a comment and by nothing else.
 *
 * It was also already wrong in a second way: the literal names a port, and the
 * port the project actually uses lives in `.env` (`POSTGRES_PORT`, and the
 * `DATABASE_URL` compose reads). A checkout whose `.env` says 5432 had two gate
 * scripts confidently probing 5433 and reporting « no PostgreSQL server answered »
 * on a machine where one was answering the whole time. Measured 2026-08-13.
 *
 * WHAT THIS DOES NOT CHANGE — DNC-10
 * ----------------------------------
 * `DATABASE_URL` remains **an address, never a bypass**, and remains the only
 * variable either script reads. This module supplies the DEFAULT that applies
 * when it is unset; it does not add a second way to influence a verdict. The
 * structural argument is unchanged and still holds: wherever the address points,
 * the scratch database is created EMPTY and migrated from the migrations on disk,
 * so a different address cannot buy a pass — it can only make the run
 * unreachable, which is a failure with its own verdict.
 *
 * Reading the project's own `.env` is strictly MORE honest than a literal: it is
 * the same file `docker compose --env-file .env` is given, so the gate now probes
 * the address the stack is actually configured for rather than one a past author
 * typed.
 *
 * ORDER, AND WHY
 * --------------
 * 1. `apps/api/.env` — the API's own file, and the one Prisma's CLI loads, so the
 *    gate agrees with `prisma migrate deploy` about which database it means.
 * 2. `.env` at the repo root — what compose is given.
 * 3. The historical literal, kept so a checkout with no `.env` at all behaves
 *    exactly as it did before this module existed.
 *
 * The value is never logged here. Callers already mask the password when they
 * print an address, and this module must not become the place that leaks it.
 */

const { existsSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..', '..');

/**
 * The pre-2026-08-13 literal, unchanged. It is the fallback and NOT the first
 * choice — see the header. Kept byte-identical so a checkout without any `.env`
 * is not silently re-pointed by this refactor.
 */
const FALLBACK_DATABASE_URL = 'postgresql://pilotage:pilotage@127.0.0.1:5433/pilotage?schema=public';

/** Candidate env files, in precedence order. */
const ENV_FILES = [join(REPO_ROOT, 'apps', 'api', '.env'), join(REPO_ROOT, '.env')];

/**
 * The variable naming the NON-OWNER application role's address (S-E01-2b).
 *
 * `.env:20` has declared `DATABASE_URL_APP` since before any RLS policy existed,
 * and until this story nothing read it. `scripts/rls-isolation-check.js` reads it
 * to learn WHICH ROLE to prove the policies against — the whole point being that
 * the role must NOT be the table owner, because an owner is not subject to its
 * own policies without `FORCE`.
 *
 * It is an ADDRESS, never a bypass, and the checker does not take its word for
 * it: before any visibility assertion it asserts over that very connection that
 * `current_user` owns none of the tables under test and does not carry
 * `BYPASSRLS`. Pointing this variable at the owner therefore makes the check
 * FAIL, not pass — which is the only property that makes reading it safe.
 */
const APP_DATABASE_URL_VAR = 'DATABASE_URL_APP';

/**
 * Extract one variable from one env file, or `undefined`.
 *
 * Deliberately a small hand-rolled reader rather than `dotenv`: these scripts run
 * before any install step is guaranteed, and a gate that cannot start because a
 * parser is missing is the failure mode the whole file family exists to avoid.
 *
 * Follows dotenv's semantics where it matters: the FIRST assignment wins, `#`
 * comments and blank lines are skipped, `export ` prefixes are tolerated, and
 * surrounding single or double quotes are stripped. An unreadable file is not an
 * error — it is simply not a source.
 *
 * The name is anchored with `\s*=` immediately after it, so `DATABASE_URL` does
 * NOT match a line declaring `DATABASE_URL_APP` — the two are different variables
 * in this repository's `.env` and reading one for the other would silently point
 * a gate at the wrong ROLE. `default-database-url-gate.spec.ts` pins that case.
 */
function readEnvVarFrom(file, name) {
  if (!existsSync(file)) return undefined;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const pattern = new RegExp(`^(?:export\\s+)?${name}\\s*=\\s*(.*)$`);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = pattern.exec(line);
    if (!match) continue;
    let value = match[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    return value === '' ? undefined : value;
  }
  return undefined;
}

/** Extract `DATABASE_URL` from one env file, or `undefined`. Behaviour unchanged. */
function readDatabaseUrlFrom(file) {
  return readEnvVarFrom(file, 'DATABASE_URL');
}

/**
 * The default address, when `DATABASE_URL` is not already set in the environment.
 *
 * Callers keep their existing shape — `process.env.DATABASE_URL || defaultDatabaseUrl()`
 * — so an explicitly exported variable still wins, exactly as before.
 */
function defaultDatabaseUrl() {
  for (const file of ENV_FILES) {
    const url = readDatabaseUrlFrom(file);
    if (url) return url;
  }
  return FALLBACK_DATABASE_URL;
}

/**
 * The non-owner application role's address, or `undefined` when nothing declares
 * it.
 *
 * There is deliberately NO fallback literal here, unlike `defaultDatabaseUrl()`:
 * inventing a credential for a role that may not exist would let a checkout with
 * no `.env` reach a connection failure that reads like a server problem. Absent
 * means absent, and the one consumer FAILS with that word rather than guessing.
 */
function defaultAppDatabaseUrl() {
  for (const file of ENV_FILES) {
    const url = readEnvVarFrom(file, APP_DATABASE_URL_VAR);
    if (url) return url;
  }
  return undefined;
}

module.exports = {
  APP_DATABASE_URL_VAR,
  ENV_FILES,
  FALLBACK_DATABASE_URL,
  defaultAppDatabaseUrl,
  defaultDatabaseUrl,
  readDatabaseUrlFrom,
  readEnvVarFrom,
};
