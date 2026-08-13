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

/**
 * EVERY consumer of the shared default, with the call site each one must carry.
 *
 * The list lives HERE, next to the seam, and is enumerated exactly once — the
 * shape `walk-read-gate.spec.ts` already uses for its own victims. Two
 * enumerations of "who shares the address" would be the same class of defect as
 * two literals of the address.
 *
 * TOOL-25 added the third entry. TOOL-22 fixed the two scripts and left the drift
 * gate's own SPEC on a divergent literal, where it survived TOOL-23 and TOOL-24 —
 * three slices — because a comment in it claimed `production-artefact-check.js`
 * rule A6 forced the wrong port. It never did: `production-artefact-check.js:105`
 * defines a `*.spec.ts` / `*.test.ts` exclusion and `:319` applies it inside
 * `walk()`, so A6 has never been able to read that file (measured 2026-08-13: the
 * scanner reports 597 files, the same walk WITHOUT the spec exclusion yields
 * 701). The address was simply diverging in silence, and the drift gate's five
 * end-to-end cases printed `○ skipped` while the suite reported green — DNC-08.
 * THIS enumeration, not A6, is what makes a fourth instance impossible.
 */
/** The two scripts sit beside `scripts/lib/`, so they require it by relative path. */
const RELATIVE_REQUIRE = /require\(\s*'\.\/lib\/default-database-url'\s*\)/;
/** The spec is five directories away, so it requires the SAME file by a path
 * computed from its own `REPO_ROOT` — the convention `test-ratchet.spec.ts:307`
 * established for `scripts/lib/ratchet-core.js`. */
const COMPUTED_REQUIRE = /require\(\s*DEFAULT_DB_URL_PATH\s*\)/;

const CONSUMERS: Array<[string, RegExp]> = [
  ['scripts/schema-drift-check.js', RELATIVE_REQUIRE],
  ['scripts/restore-drill.js', RELATIVE_REQUIRE],
  ['apps/api/src/shared/quality/schema-drift-gate.spec.ts', COMPUTED_REQUIRE],
];

/** The literal that used to be copied into each consumer. */
const RETIRED_LITERAL = 'postgresql://pilotage:pilotage@127.0.0.1:5433/pilotage?schema=public';

/**
 * Blank `//` and block comments, length preserved — the helper the gate specs in
 * this directory carry. Without it, `toContain('default-database-url')` is
 * satisfied by a file that merely MENTIONS the module in its header, and all
 * three of these files have a header that does exactly that. Verified in the
 * failing direction: deleting the require from a copy of `restore-drill.js` while
 * leaving its `:140` header sentence in place turns the case red.
 */
function executableJs(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

describe('DNC-10 — every consumer shares ONE default, and it is not a bypass', () => {
  const read = (rel: string): string =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('node:fs') as typeof import('node:fs')).readFileSync(join(REPO_ROOT, rel), 'utf8');

  it('the enumeration is not empty, and it names the drift gate SPEC too', () => {
    // Non-vacuity before content: an emptied list would make every case below
    // pass without reading a single file.
    expect(CONSUMERS).toHaveLength(3);
    expect(CONSUMERS.map(([file]) => file)).toContain('apps/api/src/shared/quality/schema-drift-gate.spec.ts');
  });

  it('a header MENTION does not satisfy the call-site anchor (the failing direction)', () => {
    const mentionOnly = '/* reads scripts/lib/default-database-url.js */\nconst x = 1;\n';
    expect(executableJs(mentionOnly)).not.toMatch(RELATIVE_REQUIRE);
    expect(executableJs("const { defaultDatabaseUrl } = require('./lib/default-database-url');")).toMatch(
      RELATIVE_REQUIRE,
    );
    // …and the same in the failing direction for the computed form.
    expect(executableJs('// const m = require(DEFAULT_DB_URL_PATH);\n')).not.toMatch(COMPUTED_REQUIRE);
    expect(executableJs('const m = require(DEFAULT_DB_URL_PATH);\n')).toMatch(COMPUTED_REQUIRE);
  });

  it.each(CONSUMERS)('%s takes its default from the shared module, not from its own literal', (file, anchor) => {
    const source = read(file);
    // Anchored to a CALL SITE, on comment-blanked source: a require deleted while
    // its explanatory comment survives is exactly how this list would rot.
    expect(executableJs(source)).toMatch(anchor);
    // The whole point: the retired literal must no longer appear as this
    // consumer's own default. It lives in exactly one place now.
    expect(source).not.toContain(`'${RETIRED_LITERAL}'`);
    expect(source).not.toContain(`"${RETIRED_LITERAL}"`);
  });

  it('an explicit DATABASE_URL still wins — the module supplies a DEFAULT only', () => {
    // Every call site keeps the `process.env.DATABASE_URL || default` shape, so an
    // exported variable overrides as before. DNC-10 is unchanged: the variable
    // names WHERE the scratch database is built, never WHETHER the ledger
    // reproduces the schema.
    for (const [file] of CONSUMERS) {
      expect(executableJs(read(file))).toMatch(/process\.env\.DATABASE_URL\s*\|\|/);
    }
  });
});
