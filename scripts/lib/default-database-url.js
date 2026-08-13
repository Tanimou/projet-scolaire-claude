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
 * Extract `DATABASE_URL` from one env file, or `undefined`.
 *
 * Deliberately a small hand-rolled reader rather than `dotenv`: these scripts run
 * before any install step is guaranteed, and a gate that cannot start because a
 * parser is missing is the failure mode the whole file family exists to avoid.
 *
 * Follows dotenv's semantics where it matters: the FIRST assignment wins, `#`
 * comments and blank lines are skipped, `export ` prefixes are tolerated, and
 * surrounding single or double quotes are stripped. An unreadable file is not an
 * error — it is simply not a source.
 */
function readDatabaseUrlFrom(file) {
  if (!existsSync(file)) return undefined;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/.exec(line);
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

module.exports = { ENV_FILES, FALLBACK_DATABASE_URL, defaultDatabaseUrl, readDatabaseUrlFrom };
