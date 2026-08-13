'use strict';

/**
 * The ONE place the PostgreSQL client binaries are located (TOOL-23).
 *
 * THE DEFECT THIS EXISTS FOR — MEASURED 2026-08-13
 * ------------------------------------------------
 * `schema-drift-check.js` and `restore-drill.js` each resolved `psql`, `pg_dump`
 * and `pg_restore` by handing the BARE NAME to `spawnSync`, i.e. through the
 * inherited PATH and nothing else. On this machine
 * `C:\Program Files\PostgreSQL\15\bin\psql.exe` exists, that directory IS in the
 * persisted Windows user PATH, and the route it opens is fully functional —
 * `psql -h 127.0.0.1 -p 5432 -U pilotage -d pilotage -c "select version();"`
 * returned `PostgreSQL 15.3` — yet every running process inherited an older
 * environment block, so `spawnSync('psql', …)` returned `ENOENT` and both gate
 * scripts recorded « there is no host psql here » as a fact about the host.
 *
 * That is the same shape TOOL-22 removed for the ADDRESS, one seam over: a
 * property that was really about the machine, hard-coded into two files that then
 * disagreed with the machine. The sameness is now STRUCTURAL — both scripts call
 * `postgresClient()` from here, so the ladder cannot drift into two copies.
 *
 * WHAT THIS DOES NOT ADD — DNC-10
 * -------------------------------
 * There is **no environment variable and no CLI flag** that names a client
 * binary. A caller-supplied client path would let the caller substitute the
 * program a gate uses to reach its verdict, which is a bypass wearing a different
 * hat and is the objection recorded against TOOL-15. Discovery is deterministic
 * from the filesystem, and the ONLY variables read are `PATH` and (on Windows)
 * `PATHEXT` — the two `spawnSync` already consults to perform today's bare-name
 * lookup. This module makes an existing implicit read explicit; it adds no new
 * influence over any verdict. `postgres-client-path-gate.spec.ts` pins that set
 * by equality, so `scripts/lib/` cannot become the loophole the per-file env scans
 * in `schema-drift-gate.spec.ts` and `restore-drill-gate.spec.ts` would miss.
 *
 * The Windows install roots are FIXED LITERALS rather than the program-files
 * environment variable for exactly that reason: that variable is caller-settable
 * and would redirect which binary a gate spawns. A machine with a relocated
 * install simply falls through to "unavailable", which is today's behaviour and
 * therefore not a regression.
 *
 * THE LADDER, AND WHY IN THIS ORDER
 * ---------------------------------
 *   1. **The inherited PATH**, returning the BARE NAME. A checkout where this
 *      already works must spawn exactly today's argv — `ci.yml` runs on
 *      `ubuntu-latest`, whose image ships a PostgreSQL client, and silently
 *      switching it to a different major would be a change nobody asked for.
 *      Resolution is a pure filesystem walk (`PATH`, plus `PATHEXT` on Windows),
 *      never a `--version` spawn: a spawn would add an unbounded child to a ladder
 *      whose every spawn is ratcheted as bounded, and it would be paid again on
 *      each of the four queries a run issues.
 *   2. **Well-known platform install roots**, highest major first. Windows
 *      `C:\Program Files\PostgreSQL\<major>\bin` then the x86 tree; POSIX
 *      `/usr/lib/postgresql/<major>/bin`, `/usr/local/bin`, `/opt/homebrew/bin`.
 *      Versioned roots are enumerated with `readdirSync`, filtered to `/^\d+$/`
 *      and sorted NUMERICALLY descending. Both halves of that are load-bearing and
 *      both were measured: `C:\Program Files\PostgreSQL\` on this machine contains
 *      `15` **and `psqlODBC`**, so an unfiltered listing would probe
 *      `psqlODBC\bin\psql.exe`; and `['9','10','15'].sort()` puts `9` last, so a
 *      default lexicographic sort would select the OLDEST client — the direction
 *      that actually breaks, since an old `pg_restore` reading a newer archive
 *      fails with a format error that reads like corruption.
 *   3. **Give up**, reporting the binary as unavailable exactly as before, with
 *      the list of everything that was searched so an operator can act on it.
 *
 * A ROOT QUALIFIES ONLY IF IT HOLDS THE WHOLE CLIENT SET
 * -----------------------------------------------------
 * A candidate bin directory is accepted only when it contains EVERY name in
 * `CLIENT_NAMES`. Resolving each binary independently would let `restore-drill.js`
 * dump with one major and restore with another on a machine carrying two installs,
 * and `pg_restore` reading a newer archive reports `restore_failed` on a healthy
 * backup — a false RED on the release-integrity gate this epic exists for. A
 * directory holding a stale `psql.exe` left by an uninstall is therefore rejected
 * rather than half-accepted.
 *
 * ACCEPTANCE IS `statSync`, NOT A SPAWN — STATED, WITH ITS COST
 * ------------------------------------------------------------
 * A candidate is accepted because the file EXISTS (and, on POSIX, is executable),
 * never because it ran. That choice is what makes the guard spec hermetic: an
 * `mkdtempSync` fixture can only contain inert files, and a spawn-verifying
 * implementation could only be tested by stubbing `spawnSync`, which proves
 * nothing. The cost, accepted and stated rather than implied away: a broken
 * install is SELECTED and then fails at spawn — so every consumer's failure
 * message must name the path it chose.
 *
 * TOTAL, NEVER THROWING
 * ---------------------
 * Every filesystem call is guarded. `readdirSync` on a Windows literal from a
 * Linux runner raises `ENOENT`, and a throw escaping from here would end a gate
 * run with no verdict at all — DNC-08 committed by the fix. The catches are narrow
 * to the LOOKUP and wrap no spawn: turning a real client failure into
 * "unavailable" would relabel a connection error as a tooling verdict.
 *
 * Unlike its sibling `scripts/lib/default-database-url.js` this module needs no
 * `resolve(__dirname, '..', '..')` repo rooting: every path it produces is an
 * absolute OS path, and a repo-relative one would be a vendored binary this module
 * must never prefer.
 */

const { accessSync, constants, readdirSync, statSync } = require('node:fs');
const { delimiter, join } = require('node:path');

/**
 * The client set. It is a SET rather than three independent lookups — see "A root
 * qualifies only if it holds the whole client set" above.
 */
const CLIENT_NAMES = Object.freeze(['psql', 'pg_dump', 'pg_restore']);

/**
 * Where a PostgreSQL client is installed when it is not on the PATH.
 *
 * `layout: 'versioned'` means the entry holds one directory per MAJOR whose
 * `bin` subdirectory carries the binaries (`…/PostgreSQL/15/bin`).
 * `layout: 'bin'` means the entry IS the directory holding the binaries.
 */
const WELL_KNOWN_ROOTS = Object.freeze({
  win32: Object.freeze([
    Object.freeze({ path: 'C:\\Program Files\\PostgreSQL', layout: 'versioned' }),
    Object.freeze({ path: 'C:\\Program Files (x86)\\PostgreSQL', layout: 'versioned' }),
  ]),
  posix: Object.freeze([
    Object.freeze({ path: '/usr/lib/postgresql', layout: 'versioned' }),
    Object.freeze({ path: '/usr/local/bin', layout: 'bin' }),
    Object.freeze({ path: '/opt/homebrew/bin', layout: 'bin' }),
  ]),
});

/** What Windows uses when `PATHEXT` is unset. Only the executable forms matter. */
const DEFAULT_WINDOWS_PATHEXT = '.COM;.EXE;.BAT;.CMD';

function rootsFor(platform) {
  return platform === 'win32' ? WELL_KNOWN_ROOTS.win32 : WELL_KNOWN_ROOTS.posix;
}

/** The inherited PATH, split the way the OS splits it. Quoted entries — legal on
 * Windows — are unwrapped, because `statSync` would not find a quoted directory. */
function inheritedPathDirs() {
  const raw = process.env.PATH;
  if (typeof raw !== 'string' || raw === '') return [];
  return raw
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter((entry) => entry !== '');
}

/** The extensions Windows appends to a bare name. `['']` off Windows, where the
 * name is the file name. */
function inheritedPathExts(platform) {
  if (platform !== 'win32') return [''];
  const raw = process.env.PATHEXT;
  const value = typeof raw === 'string' && raw.trim() !== '' ? raw : DEFAULT_WINDOWS_PATHEXT;
  return value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => (entry.startsWith('.') ? entry : `.${entry}`));
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isExecutableFile(path) {
  if (!isFile(path)) return false;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The absolute path of `name` inside `dir`, or `null`.
 *
 * Windows honours `PATHEXT`; POSIX requires the execute bit, because a
 * non-executable file called `psql` is not a client and selecting it would turn a
 * missing client into a spawn error one layer further down.
 */
function binaryIn(dir, name, platform, pathExts) {
  if (platform === 'win32') {
    for (const ext of pathExts) {
      const candidate = join(dir, `${name}${ext}`);
      if (isFile(candidate)) return candidate;
    }
    return null;
  }
  const candidate = join(dir, name);
  return isExecutableFile(candidate) ? candidate : null;
}

/** Major-version subdirectories, NUMERICALLY descending. `psqlODBC` and every
 * other non-numeric entry is dropped rather than sorted. */
function numericSubdirectoriesDescending(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => {
      try {
        return entry.isDirectory();
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(b) - Number(a));
}

/** Normalise a root entry: a bare string is treated as a versioned root. */
function normaliseRoot(root) {
  if (typeof root === 'string') return { path: root, layout: 'versioned' };
  if (!root || typeof root.path !== 'string' || root.path === '') return null;
  return { path: root.path, layout: root.layout === 'bin' ? 'bin' : 'versioned' };
}

/** Every bin directory the well-known roots offer, best candidate first. */
function candidateBinDirs(roots) {
  const dirs = [];
  for (const entry of roots || []) {
    const root = normaliseRoot(entry);
    if (!root) continue;
    if (root.layout === 'bin') {
      dirs.push(root.path);
      continue;
    }
    for (const major of numericSubdirectoriesDescending(root.path)) {
      dirs.push(join(root.path, major, 'bin'));
    }
  }
  return dirs;
}

function describeRoots(roots) {
  return (roots || [])
    .map((entry) => normaliseRoot(entry))
    .filter(Boolean)
    .map((root) => root.path)
    .join(', ');
}

/**
 * Locate one PostgreSQL client binary.
 *
 * Returns `{ command, source, tried }`:
 *   • `command` — the BARE NAME when the inherited PATH already resolves it (so a
 *     checkout where this works today spawns exactly today's argv), an ABSOLUTE
 *     PATH when it was discovered under a well-known root, `null` when neither.
 *   • `source`  — `'PATH'`, or the absolute bin directory it was found in, or
 *     `null`.
 *   • `tried`   — every place that was searched and did not answer, in order.
 *
 * `options` is an in-process FUNCTION PARAMETER — `{ pathDirs, pathExts, roots,
 * platform }` — reachable only through `require()`. It is the seam the guard spec
 * points at an `mkdtempSync` fixture tree, and it is deliberately not an
 * environment variable and not an argument: the two production call sites pass no
 * options at all, and the spec proves that by extracting them.
 */
function resolveClientBinary(name, options = {}) {
  const platform = options.platform || process.platform;
  const pathExts = options.pathExts || inheritedPathExts(platform);
  const pathDirs = options.pathDirs || inheritedPathDirs();
  const roots = options.roots || rootsFor(platform);
  const tried = [];

  if (!CLIENT_NAMES.includes(name)) {
    tried.push(
      `"${name}" is not one of the PostgreSQL client binaries this module resolves (${CLIENT_NAMES.join(', ')})`,
    );
    return { command: null, source: null, tried };
  }

  for (const dir of pathDirs) {
    if (binaryIn(dir, name, platform, pathExts) !== null) {
      return { command: name, source: 'PATH', tried };
    }
  }
  tried.push(`the inherited PATH (${pathDirs.length} directories) — no ${name} there`);

  const candidates = candidateBinDirs(roots);
  if (candidates.length === 0) {
    tried.push(`no PostgreSQL install directory under any well-known root (${describeRoots(roots)})`);
  }
  for (const dir of candidates) {
    const missing = CLIENT_NAMES.filter((client) => binaryIn(dir, client, platform, pathExts) === null);
    if (missing.length > 0) {
      tried.push(
        `${dir} — ${missing.join(', ')} missing, so it is not a complete client set and is refused rather ` +
          'than half-accepted (dumping with one major and restoring with another reports corruption on a ' +
          'healthy backup)',
      );
      continue;
    }
    return { command: binaryIn(dir, name, platform, pathExts), source: dir, tried };
  }
  return { command: null, source: null, tried };
}

/**
 * The zero-option export both gate scripts call.
 *
 * Memoised per binary name for the life of the process: `query()` is called four
 * or more times in a run and a resolution is a filesystem walk. Safe at module
 * scope — unlike the TCP preflight it does not depend on an address, so there is
 * no per-address answer to get wrong. The result is frozen so a consumer cannot
 * mutate the memo for the next caller.
 */
const memoised = new Map();

function postgresClient(name) {
  const cached = memoised.get(name);
  if (cached) return cached;
  const resolved = resolveClientBinary(name);
  const frozen = Object.freeze({
    command: resolved.command,
    source: resolved.source,
    tried: Object.freeze(resolved.tried.slice()),
  });
  memoised.set(name, frozen);
  return frozen;
}

module.exports = { CLIENT_NAMES, WELL_KNOWN_ROOTS, resolveClientBinary, postgresClient };
