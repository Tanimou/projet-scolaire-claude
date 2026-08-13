import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/* eslint-disable @typescript-eslint/no-require-imports */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const MODULE_PATH = join(REPO_ROOT, 'scripts', 'lib', 'default-database-url.js');

/**
 * Unguarded on purpose: if this module disappears or stops exporting its
 * resolver, the two gate scripts that depend on it silently fall back to a
 * literal, so this suite must fail at LOAD rather than skip.
 */
const {
  ENV_FILES,
  FALLBACK_DATABASE_URL,
  defaultDatabaseUrl,
  readDatabaseUrlFrom,
} = require(MODULE_PATH) as {
  ENV_FILES: string[];
  FALLBACK_DATABASE_URL: string;
  defaultDatabaseUrl: () => string;
  readDatabaseUrlFrom: (file: string) => string | undefined;
};
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The defect, measured 2026-08-13: `schema-drift-check.js` and `restore-drill.js`
 * each hard-coded `…@127.0.0.1:5433/…` with a comment saying the two MUST agree.
 * That property was held by a comment. Worse, the literal names a port, and the
 * port the project uses lives in `.env` — so on a checkout configured for 5432
 * both gates probed 5433 and reported "no PostgreSQL server answered" while a
 * server was answering the whole time.
 */

const scratch = mkdtempSync(join(tmpdir(), 'dburl-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function envFile(name: string, body: string): string {
  const path = join(scratch, name);
  writeFileSync(path, body, 'utf8');
  return path;
}

describe('readDatabaseUrlFrom — a small reader, with dotenv semantics where they matter', () => {
  it('reads a plain assignment', () => {
    expect(readDatabaseUrlFrom(envFile('plain', 'DATABASE_URL=postgresql://u:p@h:5432/d\n'))).toBe(
      'postgresql://u:p@h:5432/d',
    );
  });

  it('takes the FIRST assignment, as dotenv does', () => {
    const file = envFile('dup', 'DATABASE_URL=first\nDATABASE_URL=second\n');
    expect(readDatabaseUrlFrom(file)).toBe('first');
  });

  it('skips comments and blank lines, and tolerates an `export` prefix', () => {
    const file = envFile('comments', '\n# DATABASE_URL=commented-out\n\nexport DATABASE_URL=real\n');
    expect(readDatabaseUrlFrom(file)).toBe('real');
  });

  it('strips surrounding quotes, single or double', () => {
    expect(readDatabaseUrlFrom(envFile('dq', 'DATABASE_URL="quoted"\n'))).toBe('quoted');
    expect(readDatabaseUrlFrom(envFile('sq', "DATABASE_URL='quoted'\n"))).toBe('quoted');
  });

  it('does NOT match a variable that merely ends in DATABASE_URL', () => {
    // DATABASE_URL_APP is a real, different variable in this repo's .env. Reading
    // it here would point the gate at the restricted application role.
    expect(readDatabaseUrlFrom(envFile('app', 'DATABASE_URL_APP=app-role-url\n'))).toBeUndefined();
  });

  it('returns undefined for an empty value, a missing key, and a missing file', () => {
    expect(readDatabaseUrlFrom(envFile('empty', 'DATABASE_URL=\n'))).toBeUndefined();
    expect(readDatabaseUrlFrom(envFile('absent', 'OTHER=1\n'))).toBeUndefined();
    expect(readDatabaseUrlFrom(join(scratch, 'does-not-exist'))).toBeUndefined();
  });
});

describe('defaultDatabaseUrl — the project config decides, not a literal', () => {
  it('prefers apps/api/.env, then the root .env, then the historical literal', () => {
    expect(ENV_FILES).toHaveLength(2);
    const normalised = ENV_FILES.map((file) => String(file).replace(/\\/g, '/'));
    expect(normalised[0]).toContain('apps/api/.env');
    expect(normalised[1]).toMatch(/\/\.env$/);
  });

  it('resolves to a real address on this checkout', () => {
    const url = defaultDatabaseUrl();
    expect(typeof url).toBe('string');
    expect(url).toMatch(/^postgresql:\/\//);
  });

  it('keeps the pre-refactor literal as the fallback, byte-identical', () => {
    // A checkout with no .env at all must behave exactly as it did before this
    // module existed. Changing this constant re-points every such checkout.
    expect(FALLBACK_DATABASE_URL).toBe('postgresql://pilotage:pilotage@127.0.0.1:5433/pilotage?schema=public');
  });
});

describe('DNC-10 — the two scripts share ONE default, and it is not a bypass', () => {
  const read = (rel: string): string =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('node:fs') as typeof import('node:fs')).readFileSync(join(REPO_ROOT, rel), 'utf8');

  it.each(['scripts/schema-drift-check.js', 'scripts/restore-drill.js'])(
    '%s takes its default from the shared module, not from its own literal',
    (file) => {
      const source = read(file);
      expect(source).toContain('default-database-url');
      // The whole point: the 5433 literal must no longer appear as this script's
      // own default. It lives in exactly one place now.
      expect(source).not.toContain("'postgresql://pilotage:pilotage@127.0.0.1:5433/pilotage?schema=public'");
    },
  );

  it('an explicit DATABASE_URL still wins — the module supplies a DEFAULT only', () => {
    // Both call sites keep the `process.env.DATABASE_URL || default` shape, so an
    // exported variable overrides as before. DNC-10 is unchanged: the variable
    // names WHERE the scratch database is built, never WHETHER the ledger
    // reproduces the schema.
    for (const file of ['scripts/schema-drift-check.js', 'scripts/restore-drill.js']) {
      expect(read(file)).toMatch(/process\.env\.DATABASE_URL\s*\|\|/);
    }
  });
});
