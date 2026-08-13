import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * TOOL-17 — the proof for the shared walk-then-read seam (`scripts/lib/walk-read.js`).
 *
 * WHAT IT PROVES, AND WHY IT IS DRIVEN THIS WAY
 * --------------------------------------------
 * The defect: five gate specs hand-roll a `walk()` and then build a MODULE-LEVEL
 * Map by `readFileSync`-ing every walked path. Two other specs plant a probe file
 * into the REAL checkout and delete it again. Under parallel jest the probe is
 * listed by the walk and gone by the read, and jest reports
 * `<suite failed to load>` for a suite that has nothing to do with the diff. Two
 * consecutive `node scripts/test-ratchet.js api` runs on ONE unchanged tree
 * produced TWO DIFFERENT failure sets that way.
 *
 * Every case below runs against a SCRATCH tree under `mkdtempSync(tmpdir())`.
 * This suite never writes a probe into the real checkout — doing that to test
 * this would reproduce the very defect (AC-5), and it does not try to reproduce
 * the real parallel-jest race either: the honest fixture is a walk-then-read over
 * a directory where a file is deleted between the two phases.
 *
 * The FAILS-BEFORE half is proven INSIDE the run rather than by a git checkout:
 * `preSliceSourceMap` below re-implements the exact pre-slice construction
 * (`new Map(files.map((f) => [f, readFileSync(f, 'utf8')]))`) and is driven over
 * the same scratch fixture, where it throws ENOENT. This is the
 * `audit-provenance-gate.spec.ts` / `open-redirect-gate.spec.ts` pre-fix idiom,
 * and it is used for the reason those files write out: a `git show HEAD:`-based
 * control inverts the moment the slice is committed, and CI checks out at depth 1.
 *
 * BLAST RADIUS (AC-7 / PF-80) — which walkers see the two new files
 * ----------------------------------------------------------------
 * `scripts/lib/walk-read.js` is seen by NOTHING. Measured this run: every walk
 * root in this repository is `apps/<app>/src`, `apps/web/tests` or
 * `packages/<pkg>/src` — `audit-write-check.js:145`, `csv-escape-check.js:135-142`,
 * `production-artefact-check.js:100`, `link-integrity-check.js:186-198` (which
 * discovers Next apps and walks their `src`), plus the five victims' own roots.
 * `scripts/` is in none of them: every reference to `scripts/` in these specs is a
 * named-constant read, never a walk. It is also outside `apps/api/tsconfig.json`
 * (`include: src` only), so it is not typechecked, not collected by
 * `collectCoverageFrom`, and never emitted into `apps/api/dist`.
 * A `.ts` helper under `apps/api/src/shared/quality/` — including under
 * `__fixtures__/` — would have been an input to `audit-vocabulary-gate` (which
 * does filter `__fixtures__`), `audit-provenance-gate` and `trust-proxy-dnc10-gate`
 * (which do NOT), and would have shipped test infrastructure inside the production
 * API artefact.
 *
 * LOCATION — a reused convention, not a new one. `scripts/lib/ratchet-core.js`
 * (#231) is the same artefact class at the same address: a pure CJS helper
 * required by absolute path from a spec under `apps/api/src/shared/quality/`
 * (`test-ratchet.spec.ts:307`). Reusing it is what keeps this slice clear of the
 * ADR rule; the case below asserts the precedent still stands beside it, so a
 * future move of either one is caught here. The story spec's "do not put the
 * helper outside `apps/api/src`" was reasoned from a `tsc --noEmit` rootDir
 * violation that cannot occur for a computed `require(join(REPO_ROOT, …))` —
 * TypeScript never resolves such a specifier into the program.
 *
 * THIS file, being a `*.spec.ts`, is read by `audit-provenance-gate` and
 * `trust-proxy-dnc10-gate` into `EXECUTABLE` and filtered back out of `PRODUCTION`
 * (`:147` and `:83`), where all their rules live; `audit-vocabulary-gate` excludes
 * `*.spec.ts` from `WRITER_FILES` outright. It nudges `API_FILES.length` upward by
 * one, and every floor is `>=`, so one more file only helps.
 *
 * GATES. G-DNC only, and it is the whole story. G-TENANT / G-AUTHZ / G-MIGRATION /
 * G-AUDIT / G-TRUTH / G-PORTAL do not trigger and are not claimed: this slice
 * touches test infrastructure only — no Prisma query, no controller/guard/DTO, no
 * `schema.prisma` or SQL, no privileged mutation, no read projection or KPI, and
 * nothing rendered in any portal.
 *
 * RESIDUAL, RECORDED AND DELIBERATELY NOT FIXED (FR-12): `readdirSync` inside each
 * `walk()` can throw ENOENT too, if a DIRECTORY vanishes mid-walk. Neither probe
 * writes a directory, so it is unmeasured — same family, later finding. The
 * `walk()` bodies are untouched by this slice. Likewise TOOL-15 (hermetic probe
 * writers) stays OPEN: step 3 of the tolerance rethrows when a deleted file has
 * been re-created by the time the absence is re-checked, so TOOL-17 REDUCES the
 * flake rate and does not eliminate it.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const HELPER_REL = 'scripts/lib/walk-read.js';
const HELPER_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');
/** The precedent this location reuses — same artefact class, same require shape. */
const RATCHET_CORE_PATH = join(REPO_ROOT, 'scripts', 'lib', 'ratchet-core.js');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const QUALITY_DIR = join(API_SRC, 'shared', 'quality');

type ErrnoLike = Error & { code?: string };

interface Io {
  readFile: (path: string, encoding: string) => string;
  exists: (path: string) => boolean;
}

interface WalkRead {
  MAX_VANISHED_FILES: number;
  VANISHED_FRACTION: number;
  /** TOOL-17b — the corpus-scaled skip budget. */
  maxVanishedFor: (n: number) => number;
  /** TOOL-17b — a NAMED read out of a tolerant map: throws, never yields `''`. */
  namedReader: (label: string, map: Map<string, string>) => (key: string) => string;
  readWalkedFile: (
    path: string,
    options?: { encoding?: string; io?: Io; skipped?: string[] },
  ) => string | undefined;
  readWalkedFiles: (
    paths: string[],
    options?: { encoding?: string; io?: Io },
  ) => { contents: Map<string, string>; skipped: string[] };
  mapWalkedFiles: <V>(
    paths: string[],
    build: (path: string, source: string) => [string, V],
    options?: { encoding?: string; io?: Io },
  ) => { entries: [string, V][]; skipped: string[] };
  warnSkipped: (label: string, skipped: string[]) => boolean;
}

/* eslint-disable @typescript-eslint/no-require-imports */
// Unguarded on purpose (DNC-08): the module under test disappearing is a MISSING
// MODULE, which is a different seam from a VANISHING WALKED FILE. If the helper
// is gone this suite must fail at LOAD, not report "nothing to check".
const walkRead = require(HELPER_PATH) as WalkRead;
/* eslint-enable @typescript-eslint/no-require-imports */

const {
  MAX_VANISHED_FILES,
  mapWalkedFiles,
  maxVanishedFor,
  namedReader,
  readWalkedFile,
  readWalkedFiles,
  warnSkipped,
} = walkRead;

/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * TOOL-17b / AC-8 — the ratchet below is PARSED, never grepped, so the compiler
 * comes in the same computed, unguarded way the helper does.
 *
 * `typescript` is already a root devDependency (`hermetic-spec-writers-gate.spec.ts`
 * uses it exactly like this); no new dependency is taken.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ts = require('typescript') as any;
/* eslint-enable @typescript-eslint/no-require-imports */

/* ================================================================== *
 * The scratch tree — the ONLY filesystem this suite writes to
 * ================================================================== */

const scratch = mkdtempSync(join(tmpdir(), 'tool17-'));
const SCRATCH_DIR_ENTRY = join(scratch, 'nested');

const scratchFile = (name: string): string => join(scratch, name);

beforeAll(() => {
  mkdirSync(SCRATCH_DIR_ENTRY, { recursive: true });
  writeFileSync(scratchFile('alpha.ts'), 'export const alpha = 1;\n', 'utf8');
  writeFileSync(scratchFile('beta.ts'), 'export const beta = 2;\n', 'utf8');
  writeFileSync(scratchFile('probe.ts'), 'export const probe = 3;\n', 'utf8');
  writeFileSync(join(SCRATCH_DIR_ENTRY, 'gamma.ts'), 'export const gamma = 4;\n', 'utf8');
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The same shape the five victims hand-roll, over the scratch tree. */
function walkScratch(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) stack.push(join(current, entry.name));
      else if (entry.name.endsWith('.ts')) files.push(join(current, entry.name));
    }
  }
  return files.sort();
}

/**
 * The PRE-SLICE construction, re-implemented verbatim as a fixture.
 *
 * This is what every one of the five victims did at module level before this
 * slice. It is the fails-before oracle: driven over the scratch fixture with a
 * file deleted between walk and read, it THROWS — which is exactly the
 * `<suite failed to load>` the routine measured.
 */
function preSliceSourceMap(files: string[]): Map<string, string> {
  return new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
}

/** Walk, then delete one walked path — the honest fixture for the race. */
function walkThenVanish(): { walked: string[]; vanished: string } {
  const walked = walkScratch(scratch);
  const vanished = scratchFile('probe.ts');
  expect(walked).toContain(vanished);
  rmSync(vanished);
  return { walked, vanished };
}

/** Restore the probe so each case starts from the same four-file tree. */
afterEach(() => {
  if (!existsSync(scratchFile('probe.ts'))) {
    writeFileSync(scratchFile('probe.ts'), 'export const probe = 3;\n', 'utf8');
  }
});

/* ================================================================== *
 * 0 — the fixture is real (a scratch tree nobody walked is no proof)
 * ================================================================== */

describe('T-0 — the fixture is a real walk over a real scratch tree', () => {
  it('walks four files, and the scratch tree is under the OS temp dir, never the checkout', () => {
    expect(walkScratch(scratch).length).toBe(4);
    expect(scratch.startsWith(tmpdir())).toBe(true);
    // The defect is "a spec wrote a probe into the real working tree". This suite
    // must not become the third writer that does it.
    expect(scratch.startsWith(REPO_ROOT)).toBe(false);
  });
});

/* ================================================================== *
 * 1 (AC-5) — FAILS BEFORE: the pre-slice construction throws ENOENT
 * ================================================================== */

describe('AC-5 — the PRE-SLICE construction crashes on a file that vanished after the walk', () => {
  it('throws ENOENT, naming the vanished path — this is the load failure being fixed', () => {
    const { walked, vanished } = walkThenVanish();

    let caught: ErrnoLike | undefined;
    try {
      preSliceSourceMap(walked);
    } catch (error) {
      caught = error as ErrnoLike;
    }

    expect(caught).toBeDefined();
    expect(caught?.code).toBe('ENOENT');
    expect(caught?.message).toContain('probe.ts');
    // …and it is not a partial map: nothing usable comes back at all.
    expect(vanished.endsWith('probe.ts')).toBe(true);
  });
});

/* ================================================================== *
 * 2 (AC-1) — PASSES AFTER: the same walk, through the shared seam
 * ================================================================== */

describe('AC-1 — a walked file that DISAPPEARS before its read does not crash the caller', () => {
  it('reads the survivors, skips exactly the vanished path, and accounts for it', () => {
    const { walked, vanished } = walkThenVanish();

    const { contents, skipped } = readWalkedFiles(walked);

    expect(skipped).toEqual([vanished]);
    expect(contents.has(vanished)).toBe(false);
    expect(contents.size).toBe(walked.length - 1);
    // The accounting identity every victim now asserts next to its floors.
    expect(contents.size + skipped.length).toBe(walked.length);
    // The survivors are really read, not blanked — a seam that returned '' for
    // everything would satisfy "no crash" and prove nothing.
    expect(contents.get(scratchFile('alpha.ts'))).toContain('alpha');
  });

  it('mapWalkedFiles builds entries for survivors only, and never calls build for a skip', () => {
    const { walked, vanished } = walkThenVanish();
    const built: string[] = [];

    const { entries, skipped } = mapWalkedFiles(walked, (file, source): [string, number] => {
      built.push(file);
      return [file, source.length];
    });

    expect(built).not.toContain(vanished);
    expect(skipped).toEqual([vanished]);
    expect(entries.length + skipped.length).toBe(walked.length);
    expect(entries.every(([, length]) => length > 0)).toBe(true);
  });

  it('a walk that lost nothing skips nothing — the tolerance is inert on a quiet tree', () => {
    const walked = walkScratch(scratch);
    const { contents, skipped } = readWalkedFiles(walked);
    expect(skipped).toEqual([]);
    expect(contents.size).toBe(walked.length);
  });
});

/* ================================================================== *
 * 3 (AC-2 / AC-6) — every OTHER errno still throws, unwrapped
 * ================================================================== */

describe('AC-2 — only ENOENT is tolerated; every other errno propagates unchanged', () => {
  it('EISDIR from the REAL filesystem is rethrown with the same code and message', () => {
    // Real-filesystem case, no injection: `readFileSync` on a directory. The
    // control read below establishes what this platform actually throws, so the
    // assertion is about THIS host rather than about an assumed errno — and a
    // platform where reading a directory somehow succeeded would fail the control
    // instead of passing this vacuously.
    let control: ErrnoLike | undefined;
    try {
      readFileSync(SCRATCH_DIR_ENTRY, 'utf8');
    } catch (error) {
      control = error as ErrnoLike;
    }
    expect(control).toBeDefined();
    expect(control?.code).toBeDefined();
    expect(control?.code).not.toBe('ENOENT');

    let caught: ErrnoLike | undefined;
    try {
      readWalkedFile(SCRATCH_DIR_ENTRY);
    } catch (error) {
      caught = error as ErrnoLike;
    }
    expect(caught).toBeDefined();
    expect(caught?.code).toBe(control?.code);
    expect(caught?.message).toBe(control?.message);
  });

  it.each(['EACCES', 'EPERM', 'EBUSY', 'EISDIR', 'EMFILE'])(
    '%s propagates as the SAME error object — not re-wrapped, not swallowed',
    (code) => {
      // Driven through the `io` seam rather than with `chmod`: this repository is
      // developed on Windows, where a permissions-based unreadability fixture is
      // unreliable — the precedent and its reasoning are at
      // `audit-write-gate.spec.ts:726-733`.
      const boom: ErrnoLike = Object.assign(new Error(`${code}: injected`), { code });
      const io: Io = {
        readFile: () => {
          throw boom;
        },
        exists: () => false,
      };

      let caught: unknown;
      try {
        readWalkedFile(scratchFile('alpha.ts'), { io });
      } catch (error) {
        caught = error;
      }
      // Identity, not shape: `toBe` proves nothing re-wrapped it.
      expect(caught).toBe(boom);
    },
  );

  it('a non-ENOENT failure aborts the whole map — it is not "one file skipped"', () => {
    const walked = walkScratch(scratch);
    const boom: ErrnoLike = Object.assign(new Error('EACCES: injected'), { code: 'EACCES' });
    const io: Io = {
      readFile: () => {
        throw boom;
      },
      exists: () => false,
    };
    expect(() => readWalkedFiles(walked, { io })).toThrow(boom);
  });
});

/* ================================================================== *
 * 4 (AC-3) — the disappearance must be CONFIRMED, in both directions
 * ================================================================== */

describe('AC-3 — ENOENT is only tolerated once the absence is re-checked', () => {
  const enoent = (): ErrnoLike =>
    Object.assign(new Error('ENOENT: no such file or directory, open'), { code: 'ENOENT' });

  it('ENOENT + the path is PRESENT again → RETHROW the original object', () => {
    const boom = enoent();
    const io: Io = {
      readFile: () => {
        throw boom;
      },
      exists: () => true,
    };

    let caught: unknown;
    try {
      readWalkedFile(scratchFile('alpha.ts'), { io });
    } catch (error) {
      caught = error;
    }
    // A read that fails ENOENT while the file exists is NOT this race. Swallowing
    // it would be the blanket `try { read } catch { skip }` DNC-08 forbids.
    expect(caught).toBe(boom);
  });

  it('ENOENT + the path is genuinely ABSENT → skip, and record it', () => {
    const skipped: string[] = [];
    const io: Io = {
      readFile: () => {
        throw enoent();
      },
      exists: () => false,
    };

    const source = readWalkedFile(scratchFile('alpha.ts'), { io, skipped });

    expect(source).toBeUndefined();
    expect(skipped).toEqual([scratchFile('alpha.ts')]);
  });

  it('the re-check is asked about the SAME path that failed to read', () => {
    const asked: string[] = [];
    const io: Io = {
      readFile: () => {
        throw enoent();
      },
      exists: (path) => {
        asked.push(path);
        return false;
      },
    };
    readWalkedFile(scratchFile('beta.ts'), { io });
    expect(asked).toEqual([scratchFile('beta.ts')]);
  });
});

/* ================================================================== *
 * 5 (AC-4) — a skip is VISIBLE, and bounded
 * ================================================================== */

describe('AC-4 — a skip is never silent', () => {
  it('warnSkipped names every skipped path, not just how many there were', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const reported = warnSkipped('unit-under-test', [scratchFile('probe.ts'), scratchFile('x.ts')]);
      expect(reported).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0] ?? '');
      // A count with no identity is the same "cannot tell" failure DNC-08 guards
      // against, one layer up — so the paths must be in the message.
      expect(message).toContain('probe.ts');
      expect(message).toContain('x.ts');
      expect(message).toContain('DNC-08');
      // Borrowed from `scripts/audit-write-check.js` / `csv-escape-check.js`, whose
      // own unreadable-input message is `DNC-08 — <path> is unreadable: …`, so a
      // skip here is greppable against the scripts' verdicts. Those scripts FAIL
      // where this seam skips, on purpose: a check script IS the verdict and runs
      // alone; a spec MEASURES a tree a sibling worker is legitimately mutating,
      // and carries its verdict in the floors it asserts afterwards.
      expect(message).toContain('vanished');
    } finally {
      warn.mockRestore();
    }
  });

  it('an empty skip list prints nothing at all', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(warnSkipped('unit-under-test', [])).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('the skip budget is small, positive, and NOT zero', () => {
    // Not zero on purpose: `expect(skipped).toBe(0)` would convert the load crash
    // into a nondeterministic assertion failure — the same flake wearing a
    // different hat. Small on purpose: every floor in the five victims is asserted
    // on the walk LIST, so capping the skips is what carries those floors onto the
    // read map. Two writer specs exist; each plants exactly one probe.
    expect(MAX_VANISHED_FILES).toBeGreaterThan(0);
    expect(MAX_VANISHED_FILES).toBeLessThanOrEqual(10);
  });

  it('a wholesale-missing root is NOT absorbed as N skips — it walks to nothing', () => {
    // The skip counter must never be able to hide "the root is gone". `walk()`
    // returns [] for a missing root (all five do), so the corpus is empty and the
    // suites' floors — untouched by this slice — are what catch it.
    const walked = walkScratch(join(scratch, 'does-not-exist'));
    expect(walked).toEqual([]);
    const { contents, skipped } = readWalkedFiles(walked);
    expect(contents.size).toBe(0);
    expect(skipped).toEqual([]);
  });
});

/* ================================================================== *
 * 6 — the seam is the ONLY one, and it is wired into all five victims
 * ================================================================== */

describe('the tolerance lives in exactly one place, and every victim uses it', () => {
  const VICTIMS = [
    'audit-vocabulary-gate.spec.ts',
    'portal-landing-gate.spec.ts',
    'open-redirect-gate.spec.ts',
    'audit-provenance-gate.spec.ts',
    'trust-proxy-dnc10-gate.spec.ts',
  ] as const;

  it('the helper exists, is NOT under apps/api/src, and sits on the documented precedent', () => {
    expect(existsSync(HELPER_PATH)).toBe(true);
    expect(HELPER_PATH.startsWith(API_SRC)).toBe(false);
    // Stated as a path, not only as a boolean: the location IS the blast-radius
    // decision (PF-80), and a move back under `src` must go red here.
    expect(HELPER_PATH.slice(REPO_ROOT.length + 1).split('\\').join('/')).toBe(HELPER_REL);
    // …and it is not a location invented for this slice. `scripts/lib/ratchet-core.js`
    // is the same artefact class — a pure CJS helper required by absolute path from
    // a spec in this very directory (`test-ratchet.spec.ts:307`). If that precedent
    // ever moves, this helper's address stops being "the documented convention" and
    // the claim in the header above stops being true, so it is asserted, not assumed.
    expect(existsSync(RATCHET_CORE_PATH)).toBe(true);
    expect(readFileSync(join(QUALITY_DIR, 'test-ratchet.spec.ts'), 'utf8')).toContain(
      "join(REPO_ROOT, 'scripts', 'lib', 'ratchet-core.js')",
    );
  });

  it.each(VICTIMS)('%s requires the shared seam, unguarded', (victim) => {
    // Named individually rather than counted: a count is satisfied by five copies
    // of the same file, and the point is that each of these five specific suites
    // stopped hand-rolling its own read.
    const source = readFileSync(join(QUALITY_DIR, victim), 'utf8');
    expect(source).toContain("'walk-read.js'");
    expect(source).toContain('mapWalkedFiles');
    // The require stays unguarded (DNC-08): no `try` around it.
    expect(source).not.toMatch(/try\s*\{[^}]*require\([^)]*walk-read/);
  });

  it('no NON-spec file under apps/api/src reaches for it', () => {
    // If a production file imported it, the helper would be compiled into
    // `apps/api/dist` through `tsconfig.build.json` (which excludes only
    // `*.spec.ts` / `*.test.ts`) — test infrastructure inside the shipped API.
    const apiFiles = walkApiSrc();
    expect(apiFiles.length).toBeGreaterThanOrEqual(200);

    // Dogfooding: this scan is itself a walk-then-read over a tree the probe
    // writers mutate, so it goes through the seam like every other one.
    const { entries, skipped } = mapWalkedFiles(apiFiles, (file, source): [string, string] => [
      file,
      source,
    ]);
    warnSkipped('walk-read-gate / apps/api/src', skipped);
    expect(entries.length + skipped.length).toBe(apiFiles.length);
    // TOOL-17b: the budget scales with the walked list. `MAX_VANISHED_FILES` is
    // still the ceiling, so this only ever tightens.
    expect(skipped.length).toBeLessThanOrEqual(maxVanishedFor(apiFiles.length));

    const offenders = entries
      .filter(([file, source]) => !file.endsWith('.spec.ts') && source.includes('walk-read'))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('the helper carries the ONLY catch of this slice, and it is not a blanket one', () => {
    const helper = readFileSync(HELPER_PATH, 'utf8');
    expect(helper.match(/\bcatch\s*\(/g)?.length).toBe(1);
    // The three narrowing steps, present as code and not only as prose.
    expect(helper).toContain("code !== 'ENOENT'");
    expect(helper).toContain('io.exists(path)');
    expect(helper).toContain('skipped.push(path)');
    // No environment read, no CLI flag: a seam a caller can widen from outside is
    // a bypass flag wearing a different hat (DNC-10).
    expect(helper).not.toContain('process.env');
    expect(helper).not.toContain('process.argv');
  });
});

/* ================================================================== *
 * 7 (TOOL-17b) — a NAMED path is never served OUT of the tolerance
 * ================================================================== */

describe('TOOL-17b — namedReader turns an absent key into a failure, never into `\'\'`', () => {
  it('AC-1 — throws on a key the tolerance skipped, naming DNC-08, the site and the KEY', () => {
    const { walked, vanished } = walkThenVanish();
    const { contents, skipped } = readWalkedFiles(walked);
    // The precondition this case exists for: the key is absent BECAUSE it was
    // tolerated, not because the corpus was never built.
    expect(skipped).toEqual([vanished]);
    expect(contents.size).toBe(walked.length - 1);

    const read = namedReader('T-7 / scratch corpus', contents);
    expect(() => read(vanished)).toThrow(/DNC-08 \(TOOL-17b\)/);

    let message = '';
    try {
      read(vanished);
    } catch (error) {
      message = (error as Error).message;
    }
    // A count with no identity is the same "cannot tell" DNC-08 refuses, so the
    // message must carry the EXACT key and the reading site, not just a token.
    expect(message).toContain('DNC-08 (TOOL-17b)');
    expect(message).toContain('T-7 / scratch corpus');
    expect(message).toContain(vanished);
  });

  it('AC-2 — a present key is served byte-for-byte, unchanged', () => {
    const walked = walkScratch(scratch);
    const { contents } = readWalkedFiles(walked);
    const read = namedReader('T-7 / scratch corpus', contents);
    // `toBe`, not `toContain`: the accessor is a lookup, not a transformation.
    expect(read(scratchFile('alpha.ts'))).toBe('export const alpha = 1;\n');
    expect(read(scratchFile('probe.ts'))).toBe('export const probe = 3;\n');
  });

  it('AC-3 — the GREEN control: with no skips, every named key is served', () => {
    // This is the case that proves AC-1 detects a DEFECT rather than announcing a
    // change of behaviour: over the SAME tree, unskipped, the throw is unreachable.
    const walked = walkScratch(scratch);
    const { contents, skipped } = readWalkedFiles(walked);
    expect(skipped).toEqual([]);
    const read = namedReader('T-7 / scratch corpus', contents);
    for (const key of walked) {
      expect(() => read(key)).not.toThrow();
      expect(read(key).length).toBeGreaterThan(0);
    }
  });

  it('AC-6 — the skip budget is PROPORTIONAL: boundaries, never the formula', () => {
    // Deliberately no assertion on `VANISHED_FRACTION`'s value or on the shape of
    // the expression: pinning the arithmetic would make any re-derivation a RED
    // that says nothing about the invariant. These five properties are the invariant.
    const LADDER = [1, 10, 50, 108, 210, 300, 1000];

    // 1. the measured defect: `apps/web/tests` walks ~10 files, and a budget of 5
    //    let HALF of that corpus vanish while the gate stayed green.
    expect(maxVanishedFor(10)).toBeLessThan(MAX_VANISHED_FILES);
    expect(maxVanishedFor(10)).toBeGreaterThanOrEqual(1);
    // 2. large corpora keep the constant EXACTLY, so no existing assertion moved.
    expect(maxVanishedFor(300)).toBe(MAX_VANISHED_FILES);
    expect(maxVanishedFor(1000)).toBe(MAX_VANISHED_FILES);
    // 3. never 0 for a non-empty corpus — a zero budget is `toBe(0)`, i.e. the
    //    flake relocated from load time to assert time.
    expect(maxVanishedFor(1)).toBeGreaterThanOrEqual(1);
    for (const n of LADDER) expect(maxVanishedFor(n)).toBeGreaterThanOrEqual(1);
    // 4. monotonic non-decreasing.
    for (let i = 1; i < LADDER.length; i += 1) {
      expect(maxVanishedFor(LADDER[i] as number)).toBeGreaterThanOrEqual(
        maxVanishedFor(LADDER[i - 1] as number),
      );
    }
    // 5. the constant stays the CEILING.
    for (const n of LADDER) expect(maxVanishedFor(n)).toBeLessThanOrEqual(MAX_VANISHED_FILES);
  });
});

/* ================================================================== *
 * 8 (TOOL-17b / AC-8) — the ratchet, PARSED and never grepped
 * ================================================================== */

/**
 * R2 — no spec serves a NAMED path out of a tolerant map.
 *
 * Why this is an AST rule and not a `grep`: this very file, and the specs it
 * judges, spell `MAP.get(x) ?? ''` inside STRING LITERALS and COMMENTS — as
 * fixtures and as design notes. A text matcher flags its own needle, and the
 * only way to make a text matcher green again is to weaken it, which is `R-30`
 * exactly. The compiler sees a literal as a literal.
 *
 * Pure by construction: `(source: string) => Violation[]`, so it is driven over
 * SYNTHETIC sources for its red half and its green control, and the real corpus
 * is just one more input.
 */
interface TolerantDefault {
  rule: 'R2';
  line: number;
  text: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type TsNode = any;

export function findTolerantMapDefaults(
  source: string,
  fileName = 'synthetic.ts',
): TolerantDefault[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: TolerantDefault[] = [];
  const unwrap = (node: TsNode): TsNode =>
    ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
  const isEmptyStringLiteral = (node: TsNode): boolean =>
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === '';

  const visit = (node: TsNode): void => {
    if (
      ts.isBinaryExpression(node) &&
      // Both spellings: `??` is the one in the tree, `||` is the one a future
      // edit reaches for when `??` is banned.
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      isEmptyStringLiteral(unwrap(node.right))
    ) {
      const left = unwrap(node.left);
      if (
        ts.isCallExpression(left) &&
        ts.isPropertyAccessExpression(left.expression) &&
        left.expression.name.text === 'get'
      ) {
        found.push({
          rule: 'R2',
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          text: node.getText(sf),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('TOOL-17b / AC-8 — no spec serves a named path out of a tolerant map', () => {
  it('RED half — the classifier flags the defect, in both spellings', () => {
    const nullish = ["const MAP = new Map();", "const s = MAP.get('a/b.ts') ?? '';"].join('\n');
    const logical = ["const MAP = new Map();", "const s = MAP.get('a/b.ts') || '';"].join('\n');
    const parenthesised = [
      'const MAP = new Map();',
      "const n = (MAP.get('a/b.ts') ?? '').length;",
      'const t = MAP.get(KEY) ?? ``;',
    ].join('\n');

    expect(findTolerantMapDefaults(nullish)).toHaveLength(1);
    expect(findTolerantMapDefaults(nullish)[0]?.line).toBe(2);
    expect(findTolerantMapDefaults(logical)).toHaveLength(1);
    expect(findTolerantMapDefaults(parenthesised)).toHaveLength(2);
  });

  it('GREEN control — the CONVERTED shape is not flagged, and neither are look-alikes', () => {
    // Without this half, a classifier that returned every `??` would also be
    // "green on the corpus" for the worst possible reason.
    const converted = [
      'const read = namedReader("label", MAP);',
      "const s = read('a/b.ts');",
      'const n = read(KEY).length;',
    ].join('\n');
    const lookAlikes = [
      "const a = MAP.get('k') ?? 'fallback';", // a non-empty default is a choice, not a leak
      "const b = other.fetch('k') ?? '';", //   not a `.get`
      "const c = value ?? '';", //              not a call at all
      "const d = 'MAP.get(k) ?? \\'\\'';", //   the spelling INSIDE a string literal
    ].join('\n');

    expect(findTolerantMapDefaults(converted)).toEqual([]);
    expect(findTolerantMapDefaults(lookAlikes)).toEqual([]);
  });

  it('the real corpus under apps/** yields ZERO — over a corpus with a floor', () => {
    const specs = walkSpecCorpus();
    // The floor: "no violations" must never be able to mean "nothing was read".
    // Measured 110 spec files under `apps/**` on 2026-08-13.
    expect(specs.length).toBeGreaterThanOrEqual(100);

    // Dogfooding: this corpus read is itself a walk-then-read over a tree the
    // probe writers mutate, so it goes through the seam with the identity and
    // the scaled cap, like every other site.
    const { entries, skipped } = mapWalkedFiles(specs, (file, source): [string, string] => [
      file,
      source,
    ]);
    warnSkipped('walk-read-gate / apps spec corpus', skipped);
    expect(entries.length + skipped.length).toBe(specs.length);
    expect(skipped.length).toBeLessThanOrEqual(maxVanishedFor(specs.length));

    const offenders = entries.flatMap(([file, source]) =>
      findTolerantMapDefaults(source, file).map(
        (violation) => `${file.slice(REPO_ROOT.length + 1).split('\\').join('/')}:${violation.line} — ${violation.text}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

/** Every `*.spec.ts(x)` under `apps/**` — the corpus AC-8's R2 rule judges. */
function walkSpecCorpus(): string[] {
  const files: string[] = [];
  const stack = [join(REPO_ROOT, 'apps')];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['node_modules', '.next', '.turbo', 'dist', 'coverage'].includes(entry.name)) continue;
        stack.push(join(current, entry.name));
      } else if (/\.spec\.tsx?$/.test(entry.name)) {
        files.push(join(current, entry.name));
      }
    }
  }
  return files.sort();
}

function walkApiSrc(): string[] {
  const files: string[] = [];
  const stack = [API_SRC];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['node_modules', '.turbo', 'dist', 'coverage'].includes(entry.name)) continue;
        stack.push(join(current, entry.name));
      } else if (entry.name.endsWith('.ts')) {
        files.push(join(current, entry.name));
      }
    }
  }
  return files.sort();
}
