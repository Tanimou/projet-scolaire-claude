import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * TOOL-23 — guard for the ONE place the PostgreSQL client binaries are located.
 *
 * THE DEFECT, MEASURED 2026-08-13 (run 50)
 * ----------------------------------------
 * `schema-drift-check.js` and `restore-drill.js` each spawned `psql`, `pg_dump`
 * and `pg_restore` by BARE NAME, i.e. through the inherited PATH and nothing else.
 * On this machine `C:\Program Files\PostgreSQL\15\bin\psql.exe` exists, that
 * directory IS in the persisted Windows user PATH, and the route works —
 * `psql -h 127.0.0.1 -p 5432 -U pilotage -d pilotage -c "select version();"`
 * returned `PostgreSQL 15.3`, exit 0 — but every running process had inherited a
 * stale environment block, so `spawnSync` answered `ENOENT` and both scripts
 * recorded « there is no host psql here » as a fact about the host. It was a fact
 * about one environment block, and it parked RLS, `VAL-03` and this gate's own
 * drift half for eight consecutive runs.
 *
 * WHY THIS FILE EXISTS RATHER THAN A CASE IN THE TWO CONSUMER SPECS
 * ----------------------------------------------------------------
 * `schema-drift-gate.spec.ts:799` and `restore-drill-gate.spec.ts:517` pin each
 * script's environment reads by SET EQUALITY — and each scans ONE FILE'S OWN TEXT.
 * Moving discovery into `scripts/lib/` therefore moves a ratcheted read into an
 * unratcheted file, and the guard would notice nothing. This file is the mirror
 * ratchet: without it the refactor would quietly open the DNC-10 hole that TOOL-15
 * was refused three runs running for.
 *
 * THE GREEN CONTROL IS THE WHOLE DIFFICULTY (run 47's lesson)
 * -----------------------------------------------------------
 * A discovery test that passes because a stub always returns a path proves
 * nothing, and on THIS machine `C:\Program Files\PostgreSQL\15\bin` really exists,
 * so a case asserting "resolution fails when the roots are absent" cannot be
 * written against the real filesystem at all. Both directions are therefore driven
 * through `resolveClientBinary`'s `options` parameter — an in-process FUNCTION
 * SEAM reachable only from `require()`, never an environment variable and never a
 * CLI flag — pointed at `mkdtempSync` fixture trees (ADR-039, and
 * `hermetic-spec-writers-gate.spec.ts` fails the build otherwise). The seam would
 * BE the backdoor if a production call site could use it, so the last case here
 * extracts both call sites and proves they pass no options at all.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const MODULE_PATH = join(REPO_ROOT, 'scripts', 'lib', 'postgres-client-path.js');

interface Resolution {
  command: string | null;
  source: string | null;
  tried: string[];
}

interface RootEntry {
  path: string;
  layout: 'versioned' | 'bin';
}

interface ResolveOptions {
  pathDirs?: string[];
  pathExts?: string[];
  roots?: Array<RootEntry | string>;
  platform?: string;
}

/**
 * Unguarded on purpose: if this module disappears or stops exporting its
 * resolver, both gate scripts silently fall back to a bare PATH lookup — the
 * defect itself — so this suite must fail at LOAD rather than skip.
 */
const { CLIENT_NAMES, WELL_KNOWN_ROOTS, resolveClientBinary, postgresClient } = require(MODULE_PATH) as {
  CLIENT_NAMES: string[];
  WELL_KNOWN_ROOTS: { win32: RootEntry[]; posix: RootEntry[] };
  resolveClientBinary: (name: string, options?: ResolveOptions) => Resolution;
  postgresClient: (name: string) => Resolution;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const MODULE_SOURCE = readFileSync(MODULE_PATH, 'utf8');

/** Blank `//` and block comments, length preserved — the same helper
 * `schema-drift-gate.spec.ts` and `csp-gate.spec.ts` use, for the same reason:
 * prose that NAMES a construct must neither satisfy nor break a pin. */
function executableJs(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

const EXECUTABLE_MODULE = executableJs(MODULE_SOURCE);

/** Every `<anchor>(…)` call site, extracted by BALANCING PARENTHESES. Copied from
 * `schema-drift-gate.spec.ts:224` rather than re-invented. */
function callSites(source: string, anchor: RegExp): string[] {
  const sites: string[] = [];
  const scanner = new RegExp(anchor.source, 'g');
  let match: RegExpExecArray | null = scanner.exec(source);
  while (match !== null) {
    const start = source.indexOf('(', match.index);
    let depth = 0;
    let i = start;
    for (; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    sites.push(source.slice(start, i + 1));
    match = scanner.exec(source);
  }
  return sites;
}

const scratch = mkdtempSync(join(tmpdir(), 'pg-client-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * A fake PostgreSQL install tree: `<scratch>/<name>/<major>/bin/<binary>`.
 *
 * The files are inert and empty. That is the deliberate consequence of accepting
 * a candidate by `statSync` rather than by spawning it — the module's header
 * states the trade and its cost — and it is what makes this suite hermetic: a
 * spawn-verifying implementation could only be tested by stubbing `spawnSync`,
 * which proves nothing.
 */
function installTree(name: string, majors: Record<string, string[]>): string {
  const root = join(scratch, name);
  for (const [major, binaries] of Object.entries(majors)) {
    const bin = join(root, major, 'bin');
    mkdirSync(bin, { recursive: true });
    for (const binary of binaries) {
      const file = join(bin, binary);
      writeFileSync(file, '', 'utf8');
      chmodSync(file, 0o755);
    }
  }
  return root;
}

const WINDOWS_SET = ['psql.exe', 'pg_dump.exe', 'pg_restore.exe'];
const POSIX_SET = ['psql', 'pg_dump', 'pg_restore'];

/** Windows resolution, with the inherited PATH deliberately EMPTY so only the
 * root ladder can answer. */
function windows(roots: Array<RootEntry | string>, pathDirs: string[] = []): ResolveOptions {
  return { platform: 'win32', pathExts: ['.exe'], pathDirs, roots };
}

function posix(roots: Array<RootEntry | string>, pathDirs: string[] = []): ResolveOptions {
  return { platform: 'linux', pathExts: [''], pathDirs, roots };
}

describe('the module contract', () => {
  it('names exactly the three client binaries the two gates spawn', () => {
    expect(CLIENT_NAMES).toEqual(['psql', 'pg_dump', 'pg_restore']);
  });

  it('carries well-known roots for BOTH platform families, so CI and Linux are not regressed', () => {
    // A Windows-only ladder would fix this machine and leave `ubuntu-latest`
    // exactly as it is — which is fine today, because the CI image ships a client
    // on PATH, and would be a silent trap the day it does not.
    expect(WELL_KNOWN_ROOTS.win32.map((r) => r.path)).toEqual([
      'C:\\Program Files\\PostgreSQL',
      'C:\\Program Files (x86)\\PostgreSQL',
    ]);
    expect(WELL_KNOWN_ROOTS.posix.map((r) => r.path)).toEqual([
      '/usr/lib/postgresql',
      '/usr/local/bin',
      '/opt/homebrew/bin',
    ]);
    // The Windows literals are FIXED, never the program-files environment
    // variable: that variable is caller-settable, and letting it redirect which
    // binary a gate spawns is DNC-10 wearing a different hat.
    expect(MODULE_SOURCE).not.toMatch(/ProgramFiles/i);
  });
});

describe('resolveClientBinary — RED when the roots are absent, GREEN naming the real path', () => {
  it('reports the binary as UNAVAILABLE when nothing is there, and names what it searched', () => {
    // THE RED-BEFORE CONTROL. Without it every case below is satisfied by a
    // resolver that always returns some path.
    const empty = join(scratch, 'no-postgres-here');
    mkdirSync(empty, { recursive: true });
    const outcome = resolveClientBinary('psql', windows([{ path: empty, layout: 'versioned' }]));
    expect(outcome.command).toBeNull();
    expect(outcome.source).toBeNull();
    // DNC-08: a route that cannot be found is still a failure, and the failure has
    // to be ACTIONABLE — it names the PATH and the roots, so an operator can act
    // without re-running anything.
    expect(outcome.tried.join('\n')).toContain('the inherited PATH');
    expect(outcome.tried.join('\n')).toContain(empty);
  });

  it('finds the binary under a well-known root and returns THAT EXACT PATH', () => {
    // Asserted by EQUALITY against the fixture path, never `toBeTruthy()`: a
    // resolver that returned the bare name would satisfy a truthiness check while
    // discovering nothing.
    const root = installTree('win-complete', { '15': WINDOWS_SET });
    const outcome = resolveClientBinary('psql', windows([{ path: root, layout: 'versioned' }]));
    expect(outcome.command).toBe(join(root, '15', 'bin', 'psql.exe'));
    expect(outcome.source).toBe(join(root, '15', 'bin'));
  });

  it('sorts majors NUMERICALLY, so 15 wins over 9 — not lexicographically (P1-8)', () => {
    // `['9','10','15'].sort()` puts `9` LAST, so a default sort selects the OLDEST
    // client. That is the direction that actually breaks: an old `pg_restore`
    // reading a newer archive fails with a format error that reads like
    // corruption, and the drill would report `restore_failed` on a healthy backup.
    const root = installTree('win-majors', { '9': WINDOWS_SET, '13': WINDOWS_SET, '15': WINDOWS_SET });
    const outcome = resolveClientBinary('pg_dump', windows([{ path: root, layout: 'versioned' }]));
    expect(outcome.command).toBe(join(root, '15', 'bin', 'pg_dump.exe'));
    expect(outcome.command).not.toContain(join(root, '9', 'bin'));
  });

  it('skips a NON-NUMERIC sibling directory rather than probing it (B6, measured)', () => {
    // MEASURED on this machine and not in the brief: `C:\Program Files\PostgreSQL\`
    // contains `15` AND `psqlODBC`. An unfiltered `readdirSync` plus a string sort
    // would probe `psqlODBC\bin\psql.exe` — and `psqlODBC` sorts AFTER `15`, so it
    // would have been probed first. The fixture reproduces exactly that shape.
    const root = installTree('win-odbc', { '15': WINDOWS_SET, psqlODBC: WINDOWS_SET });
    const outcome = resolveClientBinary('psql', windows([{ path: root, layout: 'versioned' }]));
    expect(outcome.command).toBe(join(root, '15', 'bin', 'psql.exe'));
    expect(outcome.command).not.toContain('psqlODBC');
  });

  it('REFUSES a directory holding only part of the client set (P1-6)', () => {
    // A stale `psql.exe` left by an uninstall, or a partial install, must not be
    // half-accepted: resolving each binary independently lets `restore-drill.js`
    // dump with one major and restore with another, and `pg_restore` reading a
    // newer archive reports corruption on a healthy backup — a false RED on the
    // release-integrity gate this epic exists for.
    const root = installTree('win-partial', { '16': ['psql.exe'], '15': WINDOWS_SET });
    const outcome = resolveClientBinary('psql', windows([{ path: root, layout: 'versioned' }]));
    // 16 is the highest major and holds a psql — and it is REFUSED, so the answer
    // is the complete set at 15.
    expect(outcome.command).toBe(join(root, '15', 'bin', 'psql.exe'));
    expect(outcome.tried.join('\n')).toContain(join(root, '16', 'bin'));
    expect(outcome.tried.join('\n')).toContain('pg_dump, pg_restore missing');

    // …and when the ONLY candidate is incomplete, the answer is unavailable
    // rather than a half-set.
    const only = installTree('win-partial-only', { '16': ['psql.exe'] });
    expect(resolveClientBinary('psql', windows([{ path: only, layout: 'versioned' }])).command).toBeNull();
  });

  it('resolves the POSIX layouts too — versioned roots and flat bin directories', () => {
    const versioned = installTree('posix-versioned', { '15': POSIX_SET });
    expect(resolveClientBinary('pg_restore', posix([{ path: versioned, layout: 'versioned' }])).command).toBe(
      join(versioned, '15', 'bin', 'pg_restore'),
    );

    // `/usr/local/bin` and `/opt/homebrew/bin` hold the binaries directly.
    const flat = join(scratch, 'posix-flat');
    mkdirSync(flat, { recursive: true });
    for (const binary of POSIX_SET) {
      const file = join(flat, binary);
      writeFileSync(file, '', 'utf8');
      chmodSync(file, 0o755);
    }
    expect(resolveClientBinary('psql', posix([{ path: flat, layout: 'bin' }])).command).toBe(join(flat, 'psql'));

    // The execute bit is required on POSIX — a non-executable file called `psql`
    // is not a client. Asserted on the source rather than by creating one: on
    // Windows `accessSync(…, X_OK)` succeeds for any existing file, so a
    // behavioural case would be vacuous on the machine this slice is about.
    expect(EXECUTABLE_MODULE).toContain('constants.X_OK');
  });

  it('the inherited PATH wins, and returns the BARE NAME so today\u2019s argv is unchanged (AC-1)', () => {
    // The rule that keeps CI safe: a checkout where this already works must spawn
    // exactly what it spawns today, never a silently different major.
    const onPath = installTree('win-on-path', { '15': WINDOWS_SET });
    const rooted = installTree('win-rooted', { '16': WINDOWS_SET });
    const outcome = resolveClientBinary(
      'psql',
      windows([{ path: rooted, layout: 'versioned' }], [join(onPath, '15', 'bin')]),
    );
    expect(outcome.command).toBe('psql');
    expect(outcome.source).toBe('PATH');
    // Non-vacuity: the root ladder WOULD have answered, and with a different value.
    expect(resolveClientBinary('psql', windows([{ path: rooted, layout: 'versioned' }])).command).toBe(
      join(rooted, '16', 'bin', 'psql.exe'),
    );
  });
});

describe('the resolver is TOTAL — a lookup error is never a thrown gate (P1-9)', () => {
  it('does not throw when a root is a FILE, is missing, or is nonsense', () => {
    // `readdirSync` on a Windows literal from a Linux runner raises ENOENT. A
    // throw escaping from here would end a gate run with NO VERDICT at all —
    // DNC-08 committed by the fix.
    const file = join(scratch, 'not-a-directory');
    writeFileSync(file, 'x', 'utf8');
    for (const root of [file, join(scratch, 'does-not-exist'), '', 'C:\\Program Files\\PostgreSQL']) {
      let outcome: Resolution | undefined;
      expect(() => {
        outcome = resolveClientBinary('psql', windows([{ path: root, layout: 'versioned' }]));
      }).not.toThrow();
      expect(Array.isArray(outcome?.tried)).toBe(true);
    }
    expect(resolveClientBinary('psql', windows([{ path: file, layout: 'versioned' }])).command).toBeNull();
  });

  it('an unknown binary name is refused by name, not silently resolved', () => {
    const outcome = resolveClientBinary('rm', windows([]));
    expect(outcome.command).toBeNull();
    expect(outcome.tried.join('\n')).toContain('psql, pg_dump, pg_restore');
  });

  it('postgresClient() is total on this checkout and memoises per name (P1-10)', () => {
    // `query()` is called four or more times in a run; a resolution is a
    // filesystem walk, and re-walking it per call would be a spawn-N+1's cheaper
    // cousin. The shape is asserted rather than a path, because the answer
    // legitimately differs between this machine and `ubuntu-latest`.
    const first = postgresClient('psql');
    expect(first).toBe(postgresClient('psql'));
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.command === null || typeof first.command === 'string').toBe(true);
    expect(Array.isArray(first.tried)).toBe(true);
  });
});

describe('DNC-10 — discovery adds no way to substitute the client (AC-3)', () => {
  it('reads PATH and PATHEXT and NOTHING else, by set equality', () => {
    // These two are exactly what `spawnSync('psql', …)` already consults to
    // perform today's bare-name lookup, so the module makes an EXISTING implicit
    // read explicit and adds no new influence over any verdict. The set equality
    // is what stops `scripts/lib/` becoming the loophole the two per-file scans
    // in the consumer specs cannot see.
    const reads = MODULE_SOURCE.match(/process\.env\.[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    expect([...new Set(reads)].sort()).toEqual(['process.env.PATH', 'process.env.PATHEXT']);
    expect(MODULE_SOURCE).not.toMatch(/process\.env\[/);
  });

  it.each(['SKIP_', 'ALLOW_', 'BYPASS', 'FORCE', 'PSQL_PATH', 'PG_BIN', '--force', '--update', '--allow', '--source'])(
    'the module does not know %s',
    (token) => {
      expect(MODULE_SOURCE).not.toContain(token);
    },
  );

  it('discovery is a filesystem walk — it spawns nothing (B1, P1-10)', () => {
    // "Is it on PATH" is NOT answered by spawning `psql --version`: that adds an
    // unbounded child to a ladder whose every spawn is ratcheted as bounded, it
    // would need a new timeout constant for a lookup, and a broken install
    // (missing DLL, a Windows error dialog) would hang the gate forever.
    expect(EXECUTABLE_MODULE).not.toContain('spawnSync');
    expect(EXECUTABLE_MODULE).not.toContain('child_process');
    expect(EXECUTABLE_MODULE).not.toContain('execSync');
  });

  it('the options seam is spec-only — no production call site passes it (AC-6b)', () => {
    // THE ANTI-BYPASS CASE. `options` is what makes the RED-before control
    // writable at all, and it would BE the backdoor if a consumer could reach it.
    // Both scripts call the zero-option export with a single quoted binary name.
    for (const file of ['scripts/schema-drift-check.js', 'scripts/restore-drill.js']) {
      const consumer = executableJs(readFileSync(join(REPO_ROOT, file), 'utf8'));
      expect(consumer).toContain("require('./lib/postgres-client-path')");
      const sites = callSites(consumer, /postgresClient\(/);
      // Non-vacuity FIRST: an extractor that matched nothing would make the loop
      // below pass without reading a single call site.
      expect([file, sites.length > 0]).toEqual([file, true]);
      for (const site of sites) {
        expect([file, /^\('(psql|pg_dump|pg_restore)'\)$/.test(site)]).toEqual([file, true]);
      }
      // The injectable resolver itself is never called from production code.
      expect([file, consumer.includes('resolveClientBinary')]).toEqual([file, false]);
    }
  });

  it('the ladder is NOT duplicated — both scripts share this one module (AC-2)', () => {
    // The sameness TOOL-22 made structural for the ADDRESS is structural for the
    // CLIENT too: no bare `run('psql'…)`, `run('pg_dump'…)` or `run('pg_restore'…)`
    // host-route call site remains in either file.
    for (const file of ['scripts/schema-drift-check.js', 'scripts/restore-drill.js']) {
      const consumer = executableJs(readFileSync(join(REPO_ROOT, file), 'utf8'));
      for (const binary of CLIENT_NAMES) {
        expect([file, binary, consumer.includes(`run('${binary}'`)]).toEqual([file, binary, false]);
      }
    }
  });

  it('the password never reaches argv — discovery changed the binary, not the credential (AC-7)', () => {
    // ADR-025 D6. Every host-route spawn still passes `PGPASSWORD` through
    // `options.env`, and no connection string, password or `-W`/`--password`
    // appears in any argv this module's consumers build.
    for (const file of ['scripts/schema-drift-check.js', 'scripts/restore-drill.js']) {
      const consumer = executableJs(readFileSync(join(REPO_ROOT, file), 'utf8'));
      const sites = callSites(consumer, /run\((?:psql|pgDumpClient|pgRestoreClient|psqlClient)\.command/);
      expect([file, sites.length > 0]).toEqual([file, true]);
      for (const site of sites) {
        expect([file, site.includes('--password'), site.includes('://')]).toEqual([file, false, false]);
      }
      expect([file, /PGPASSWORD: source\.password/.test(consumer)]).toEqual([file, true]);
    }
  });
});
