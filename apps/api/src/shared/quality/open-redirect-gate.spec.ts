import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import * as ts from 'typescript';

/**
 * S-E05-12 / PF-102 guard — the post-authentication redirect target is
 * same-origin-only, on all four portal login forms.
 *
 * WHAT PF-102 IS
 * --------------
 * `apps/web/src/components/PortalLoginForm.tsx:76` read `callbackUrl` straight
 * off the query string with no same-origin validation, and `:125` handed it to
 * `router.push`. Next's App Router performs a hard `window.location` navigation
 * for a cross-origin href, so `/parent/login?callbackUrl=https://evil.example/`
 * served the GENUINE login page on the GENUINE origin, authenticated the parent
 * FOR REAL (the next-auth session cookie is set — nothing looks wrong), and then
 * landed them off-site. That is the maximally convincing phishing sequence, on a
 * platform whose users are parents of minors. `L0`, `BROKEN_SECURITY`, `P1`.
 *
 * The EMISSION side was already correct: `middleware.ts:158` sets `callbackUrl`
 * from `req.nextUrl.pathname`, which is server-derived. The defect was entirely
 * on the CONSUMPTION side, and `portal-landing-gate.spec.ts:362-371` pinned the
 * emission without ever pinning what the login form did with it. §"AC-5(e)"
 * below closes that asymmetry.
 *
 * WHY A SPEC ABOUT apps/web LIVES IN apps/api
 * -------------------------------------------
 * `apps/web` has no jest project; `scripts/ci-gate.sh` runs
 * `node scripts/test-ratchet.js api|worker` only, so a spec written under
 * `apps/web` would never be executed by the gate. `web-artifact-gate.spec.ts`
 * established this address for exactly that reason, and
 * `web-observability-gate.spec.ts:27-33` documents it.
 *
 * WHAT IS EXECUTED HERE, NOT ASSERTED
 * -----------------------------------
 *   • `apps/web/src/lib/safe-callback-url.ts` is really transpiled and really
 *     invoked, with a `require` that THROWS — so AC-1's "import-free, edge-safe"
 *     property is proven by EXECUTION rather than by grep;
 *   • the full 37-row accept/reject matrix runs through the real function, each
 *     row asserted three ways (expectation, differential origin oracle, and
 *     return-identity);
 *   • the rule the finding itself proposed is re-implemented as a fixture and
 *     driven through the same oracle, so its three measured holes are pinned as
 *     a MEASUREMENT and not as an opinion (a fourth spelling of the same cause,
 *     `/<CR><LF>/evil`, was found while implementing and is recorded in its own
 *     test rather than folded into the 37-row table other documents cite);
 *   • the pre-slice expression is re-implemented as a fixture and driven through
 *     the same scan function that walks the tree — fails-before proven INSIDE
 *     the run, because you cannot run a matrix against a line you deleted;
 *   • the module is re-loaded and re-driven under seven environment mutations
 *     across five variables, so DNC-10 is tested rather than merely grepped for.
 *
 * THE CORRECTED PREMISE (a corrected premise is a RESULT, not a failure)
 * ---------------------------------------------------------------------
 * `audit-findings-index.md:149` and the story's own AC-2 both proposed
 *
 *     raw.startsWith('/') && raw[1] !== '/' && raw[1] !== '\'
 *
 * That rule ACCEPTS three inputs that navigate off-origin. Measured against
 * Node's WHATWG `URL` with base `https://pilotage.example/parent/login`:
 * `'/<TAB>/evil.example'`, `'/<LF>/evil.example'` and `'/<CR>/evil.example'` all
 * resolve to `https://evil.example/` while passing the check, because `raw[1]`
 * is a tab — neither `/` nor `\`. The URL parser removes tab/LF/CR from ANYWHERE
 * in the string BEFORE parsing, so `/<TAB>/evil.example` becomes
 * `//evil.example` after our check has already passed it. The shipped rule adds
 * a fifth clause: no C0 control (U+0000–U+001F) and no U+007F, at any position.
 * `AC-2 correction` below re-runs both rules over the same 37 rows and asserts
 * the difference is exactly R25/R26/R27.
 *
 * COMMENT-STRIPPED, USING THE GATE'S OWN STRIPPER
 * ----------------------------------------------
 * Every structural read goes through `stripCommentsPreservingLines` from
 * `scripts/link-integrity-check.js`, `require`d UNGUARDED so this suite fails at
 * LOAD if the script stops exporting it, rather than degrading to "nothing to
 * check" (DNC-08; the `portal-landing-gate.spec.ts:90-96` idiom). PF-83's lesson
 * is live here: `apps/web/src/auth.ts` contains the word "redirect" three times
 * — all three in comments — so the raw-source version of the `auth.ts` assertion
 * below would be a false red on a correct file.
 *
 * WHAT THE STRUCTURAL SCAN DOES NOT CLAIM (DNC-08 honesty)
 * -------------------------------------------------------
 * The taint scan is LEXICAL and SINGLE-FILE. It matches a `const`/`let` whose
 * initialiser reads a search parameter, and a redirect sink whose whole first
 * argument is that identifier. It performs NO cross-file dataflow: a value
 * laundered through an intermediate helper, or passed between files as a prop,
 * is invisible to it. It closes the shape PF-102 actually is, and it says so
 * rather than implying more. It is also deliberately NOT anchored per-file
 * ("a file that uses `useSearchParams` must not call `router.push`"): measured,
 * 32 files under `apps/web/src` use `useSearchParams` and ~30 of them are
 * `*Filters.tsx` components doing `router.push(`${pathname}?${next}`)`, which is
 * correct code. A per-file rule would go red on all of them, and the only ways
 * out would be baselining 30 correct files or loosening the rule until PF-102
 * slipped back through. Both are worse than the defect. The discrimination is
 * proven in both directions below.
 *
 * PROXY HYGIENE, RECORDED NOT ASSERTED
 * ------------------------------------
 * `auth.ts:291` sets `trustHost: true`, so next-auth's `baseUrl` — the value its
 * DEFAULT redirect guard compares against — is derived from the `Host` /
 * `X-Forwarded-Host` header. Behind the existing Traefik that is fine, but it is
 * a second-order dependency on proxy configuration rather than on our code.
 * Validating once at the read site removes that dependency for the SSO branch
 * too, for free. It is deliberately NOT asserted here: a future hardening to
 * `trustHost: false` would be an improvement, and a gate that reddens on an
 * improvement is a gate people delete.
 *
 * GATES — every row answered, none left blank
 * -------------------------------------------
 *   G-AUTHZ    YES, primary — the executed matrix + the origin oracle + the
 *              fails-before/passes-after demonstration in both of its forms.
 *   G-PORTAL   YES — one component, four login routes, asserted as a SET.
 *   G-DNC      YES — DNC-10 structurally and by execution; DNC-08 by the
 *              unguarded `require` and the non-vacuity floor; DNC-06 by the
 *              fact that no UI copy is added or changed anywhere in the diff.
 *   G-TENANT   NO — this diff contains no Prisma query, no `where` clause, no
 *              `tenantId`. One pure function, one client-component line, one spec.
 *   G-MIGRATION NO — `schema.prisma` untouched, no migration added.
 *   G-AUDIT    NO — no privileged mutation, no `AuditLog` write, no endpoint.
 *   G-TRUTH    NO — no KPI, no count, no read projection, no dashboard figure.
 *
 * A gate marked "not triggered" with a blank cell is a blocker wearing a blank
 * cell, which is why each NO carries its reason.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');
const SAFE_CALLBACK_PATH = join(WEB_SRC, 'lib', 'safe-callback-url.ts');
const PORTALS_MODULE_PATH = join(WEB_SRC, 'lib', 'portals.ts');
const LOGIN_FORM_PATH = join(WEB_SRC, 'components', 'PortalLoginForm.tsx');
const MIDDLEWARE_PATH = join(WEB_SRC, 'middleware.ts');
const AUTH_PATH = join(WEB_SRC, 'auth.ts');
const LINK_INTEGRITY_SCRIPT = join(REPO_ROOT, 'scripts', 'link-integrity-check.js');

const PORTAL_IDS = ['admin', 'teacher', 'parent', 'student'] as const;

/** The base a browser would resolve `router.push(value)` against, in the oracle. */
const BASE = 'https://pilotage.example/parent/login';
const SAME_ORIGIN = 'https://pilotage.example';
/** The trusted fallback every reject row must land on. */
const FALLBACK = '/parent/dashboard';

/* eslint-disable @typescript-eslint/no-require-imports */
// Unguarded on purpose (DNC-08): if the gate script is gone or stops exporting
// its stripper, this suite must fail at LOAD rather than degrade to
// "nothing to check". Same posture as `portal-landing-gate.spec.ts:90-96`.
const { stripCommentsPreservingLines } = require(LINK_INTEGRITY_SCRIPT) as {
  stripCommentsPreservingLines: (source: string) => string;
};
/**
 * TOOL-17 — the shared walk-then-read seam. Unguarded on purpose for the SAME
 * DNC-08 reason as the stripper above: a MISSING MODULE must still fail at LOAD.
 * What the helper tolerates is narrower and different — a path that `walk()`
 * listed and that is CONFIRMED gone by the time it is read.
 */
const { mapWalkedFiles, warnSkipped, MAX_VANISHED_FILES } = require(
  join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js'),
) as {
  mapWalkedFiles: (
    paths: string[],
    build: (path: string, source: string) => [string, string],
  ) => { entries: [string, string][]; skipped: string[] };
  warnSkipped: (label: string, skipped: string[]) => boolean;
  MAX_VANISHED_FILES: number;
};
/* eslint-enable @typescript-eslint/no-require-imports */

function raw(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Executable content of a TS/TSX file — comments blanked, length preserved. */
function executable(path: string): string {
  return stripCommentsPreservingLines(raw(path));
}

/** Every `.ts`/`.tsx` file under a root, walked from the filesystem. */
function walk(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['node_modules', '.next', '.turbo', 'dist', 'coverage'].includes(entry.name)) continue;
        stack.push(join(current, entry.name));
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        files.push(join(current, entry.name));
      }
    }
  }
  return files.sort();
}

const WEB_SRC_FILES = walk(WEB_SRC);

function repoRelative(absolute: string): string {
  return absolute.slice(REPO_ROOT.length + 1).split('\\').join('/');
}

/**
 * The whole app, comment-stripped, keyed by repo-relative path.
 *
 * TOOL-17: routed through the shared seam. `csv-escape-gate.spec.ts:493` plants
 * `apps/web/src/lib/__csv_escape_probe.tsx` inside this very walk root and
 * deletes it again; under parallel jest that used to take this suite down at
 * LOAD. Only a CONFIRMED-absent walked path is skipped; the accounting identity
 * and the cap are asserted in the vacuity floor below.
 */
const { entries: EXECUTABLE_SRC_ENTRIES, skipped: VANISHED_WEB_FILES } = mapWalkedFiles(
  WEB_SRC_FILES,
  (file, source) => [repoRelative(file), stripCommentsPreservingLines(source)],
);
warnSkipped('open-redirect-gate / apps/web/src', VANISHED_WEB_FILES);
const EXECUTABLE_SRC = new Map<string, string>(EXECUTABLE_SRC_ENTRIES);

/* ================================================================== *
 * The harness — transpile and EXECUTE the real module
 * ================================================================== */

type SafeCallbackUrl = (rawValue: string | null | undefined, fallback: string) => string;

/**
 * Transpiles the REAL `safe-callback-url.ts` and evaluates it with a `require`
 * we control. Copied from `web-observability-gate.spec.ts:380-398` (`loadRegister`).
 *
 * Reading the source and asserting it "contains an allow-list" would be the
 * exact failure this epic exists to end. This runs it.
 *
 * The default `require` THROWS: an import-free module never calls it, so AC-1's
 * edge-safety property is proven by execution. That property is not decorative —
 * this module sits one import away from `middleware.ts`, which is bundled for
 * the Edge runtime, where a `next/*` import or a `process.env` read breaks the
 * middleware at runtime while typecheck stays green.
 */
function loadSafeCallbackUrl(
  load: (specifier: string) => unknown = (specifier) => {
    throw new Error(
      `safe-callback-url.ts must import NOTHING (AC-1, edge-safe) — it tried to load "${specifier}"`,
    );
  },
): SafeCallbackUrl {
  if (!existsSync(SAFE_CALLBACK_PATH)) {
    throw new Error(
      `PF-102 guard cannot run: ${repoRelative(SAFE_CALLBACK_PATH)} does not exist. ` +
        'This suite FAILS rather than skips (DNC-08).',
    );
  }
  const { outputText } = ts.transpileModule(raw(SAFE_CALLBACK_PATH), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const container = { exports: {} as Record<string, unknown> };
  const factory = new Function('module', 'exports', 'require', outputText) as (
    module: typeof container,
    exports: Record<string, unknown>,
    require: (specifier: string) => unknown,
  ) => void;

  factory(container, container.exports, load);

  const fn = container.exports.safeCallbackUrl;
  if (typeof fn !== 'function') {
    throw new Error('safe-callback-url.ts exports no safeCallbackUrl()');
  }
  return fn as SafeCallbackUrl;
}

// Loaded at module scope on purpose: a missing or import-carrying module must
// take the whole suite down loudly, not silently skip a security guard.
const safeCallbackUrl = loadSafeCallbackUrl();

/** The origin a browser would end up on, or `'THREW'` for an unparseable value. */
function originOf(value: string): string {
  try {
    return new URL(value, BASE).origin;
  } catch {
    return 'THREW';
  }
}

/* ================================================================== *
 * The matrix — 29 reject + 8 accept = 37 rows, every one executed
 * ================================================================== */

interface Row {
  id: string;
  input: string | null | undefined;
  verdict: 'reject' | 'accept';
  why: string;
}

const REJECT_ROWS: Row[] = [
  { id: 'R1', input: 'https://evil.example/', verdict: 'reject', why: 'absolute' },
  { id: 'R2', input: 'http://evil.example', verdict: 'reject', why: 'absolute' },
  { id: 'R3', input: 'HTTPS://evil.example', verdict: 'reject', why: 'uppercase scheme' },
  { id: 'R4', input: 'HtTpS://evil.example/x', verdict: 'reject', why: 'mixed-case scheme' },
  { id: 'R5', input: '//evil.example', verdict: 'reject', why: 'scheme-relative' },
  {
    id: 'R6',
    input: '//evil.example/parent/dashboard',
    verdict: 'reject',
    why: 'scheme-relative wearing a plausible path',
  },
  { id: 'R7', input: '/\\evil.example', verdict: 'reject', why: 'backslash' },
  { id: 'R8', input: '/\\/evil.example', verdict: 'reject', why: 'backslash-slash' },
  { id: 'R9', input: '\\/evil.example', verdict: 'reject', why: 'slash-leading only after normalisation' },
  { id: 'R10', input: '\\\\evil.example', verdict: 'reject', why: 'double backslash' },
  { id: 'R11', input: 'javascript:alert(1)', verdict: 'reject', why: 'pseudo-scheme' },
  { id: 'R12', input: 'JavaScript:alert(1)', verdict: 'reject', why: 'pseudo-scheme, mixed case' },
  { id: 'R13', input: 'vbscript:msgbox(1)', verdict: 'reject', why: 'pseudo-scheme' },
  {
    id: 'R14',
    input: 'data:text/html,<script>alert(1)</script>',
    verdict: 'reject',
    why: 'pseudo-scheme',
  },
  { id: 'R15', input: 'java\u0009script:alert(1)', verdict: 'reject', why: 'embedded tab in scheme' },
  { id: 'R16', input: 'java\u000Ascript:alert(1)', verdict: 'reject', why: 'embedded newline in scheme' },
  { id: 'R17', input: '\u000A//evil.example', verdict: 'reject', why: 'leading control byte' },
  { id: 'R18', input: ' //evil.example', verdict: 'reject', why: 'leading space' },
  { id: 'R19', input: '\u0000/x', verdict: 'reject', why: 'leading NUL' },
  {
    id: 'R20',
    input: '%2F%2Fevil.example',
    verdict: 'reject',
    why: 'percent-encoded — rejected because it is not `/`-first, NOT because it is decoded',
  },
  { id: 'R21', input: '%09//evil.example', verdict: 'reject', why: 'percent-encoded tab prefix' },
  { id: 'R22', input: '', verdict: 'reject', why: 'empty string' },
  { id: 'R23', input: null, verdict: 'reject', why: 'absent parameter' },
  { id: 'R24', input: undefined, verdict: 'reject', why: 'absent parameter' },
  {
    id: 'R25',
    input: '/\u0009/evil.example',
    verdict: 'reject',
    why: 'MEASURED HOLE in the briefed rule — resolves to https://evil.example/',
  },
  {
    id: 'R26',
    input: '/\u000A/evil.example',
    verdict: 'reject',
    why: 'MEASURED HOLE in the briefed rule — resolves to https://evil.example/',
  },
  {
    id: 'R27',
    input: '/\u000D/evil.example',
    verdict: 'reject',
    why: 'MEASURED HOLE in the briefed rule — resolves to https://evil.example/',
  },
  {
    id: 'R28',
    input: '/x/\u0009/y',
    verdict: 'reject',
    why: 'C0 anywhere, not only at [1] — same-origin today, refused as a class',
  },
  { id: 'R29', input: '/\u007F/x', verdict: 'reject', why: 'DEL — same class' },
];

const ACCEPT_ROWS: Row[] = [
  { id: 'A1', input: '/parent/messages', verdict: 'accept', why: 'ordinary path' },
  { id: 'A2', input: '/admin/dashboard?tab=1#anchor', verdict: 'accept', why: 'query + fragment survive' },
  { id: 'A3', input: '/', verdict: 'accept', why: 'raw[1] is undefined — do NOT "fix" this with a length check' },
  { id: 'A4', input: '/admin/students/a%2Fb', verdict: 'accept', why: 'encoded slash, still path-only' },
  {
    id: 'A5',
    input: '/teacher/gradebook?classSectionId=abc',
    verdict: 'accept',
    why: 'the realistic middleware-emitted shape',
  },
  { id: 'A6', input: '/student/dashboard', verdict: 'accept', why: 'fourth portal represented (G-PORTAL)' },
  {
    id: 'A7',
    input: '/ /evil.example',
    verdict: 'accept',
    why: 'MEASURED same-origin (the space is percent-escaped into the path) — accepting is honest',
  },
  {
    id: 'A8',
    input: '/@evil.example',
    verdict: 'accept',
    why: 'MEASURED same-origin — included so nobody "hardens" it into a red on a legal path',
  },
];

const MATRIX: Row[] = [...REJECT_ROWS, ...ACCEPT_ROWS];

/* ================================================================== *
 * 0. The floor — this suite is reading a real application (run-10)
 * ================================================================== */

describe('PF-102 — the guard is not vacuous', () => {
  it('walked apps/web/src and found a real tree', () => {
    // Without this, every `toEqual([])` below passes forever by walking nothing.
    expect(WEB_SRC_FILES.length).toBeGreaterThanOrEqual(300);
    // TOOL-17 accounting. Was `EXECUTABLE_SRC.size === WEB_SRC_FILES.length`; the
    // skips are ADDED back rather than the identity relaxed, and they are capped
    // because the floor above is asserted on the walk LIST while a skip shrinks
    // only the MAP. Not `toBe(0)`: that would relocate the flake, not remove it.
    expect(EXECUTABLE_SRC.size + VANISHED_WEB_FILES.length).toBe(WEB_SRC_FILES.length);
    expect(VANISHED_WEB_FILES.length).toBeLessThanOrEqual(MAX_VANISHED_FILES);
  });

  it('the stripper it borrows really strips, and really preserves length', () => {
    // Guards the guard: a stripper returning its input unchanged would make every
    // comment-stripped negative below testable only by luck; one returning '' would
    // satisfy all of them vacuously.
    const source = ['// async redirect', "const label = 'callbackUrl';"].join('\n');
    const stripped = stripCommentsPreservingLines(source);
    expect(stripped).toHaveLength(source.length);
    expect(stripped).not.toContain('async redirect');
    expect(stripped).toContain("'callbackUrl'");
  });

  it('the matrix is 29 reject + 8 accept = 37 rows, with unique ids', () => {
    expect(REJECT_ROWS).toHaveLength(29);
    expect(ACCEPT_ROWS).toHaveLength(8);
    expect(MATRIX).toHaveLength(37);
    expect(new Set(MATRIX.map((r) => r.id)).size).toBe(37);
  });

  it('the origin oracle itself is calibrated', () => {
    // If `originOf` were broken, every oracle assertion below would be noise.
    expect(originOf('/parent/dashboard')).toBe(SAME_ORIGIN);
    expect(originOf('https://evil.example/')).toBe('https://evil.example');
    expect(originOf('//evil.example')).toBe('https://evil.example');
    expect(originOf('javascript:alert(1)')).toBe('null');
  });
});

/* ================================================================== *
 * AC-1 — the module exists, and is import-free / edge-safe
 * ================================================================== */

describe('AC-1 — safe-callback-url.ts is pure, import-free and edge-safe', () => {
  it('exists at the address the story pins', () => {
    expect(existsSync(SAFE_CALLBACK_PATH)).toBe(true);
  });

  it('imports NOTHING — proven by EXECUTION, with a require that throws', () => {
    const attempted: string[] = [];
    const fn = loadSafeCallbackUrl((specifier) => {
      attempted.push(specifier);
      throw new Error('the edge bundle must never resolve this');
    });
    // Loading succeeded AND nothing was resolved. A module that imports anything
    // — `next/*`, `'server-only'`, a node builtin — cannot reach this line.
    expect(attempted).toEqual([]);
    expect(typeof fn).toBe('function');
  });

  it('and says so where a reader will look (the grep-level intent)', () => {
    // Kept ALONGSIDE the execution proof, not instead of it: these name the
    // intent at the place a future editor will be standing.
    const source = executable(SAFE_CALLBACK_PATH);
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toContain('server-only');
    expect(source).not.toContain('process.env');
    expect(source).toMatch(/export\s+(?:function\s+safeCallbackUrl|const\s+safeCallbackUrl)\b/);
  });

  it('does not declare a second PORTAL_LANDING — portal-landing-gate.spec.ts:242 owns that', () => {
    // The neighbouring gate asserts EXACTLY ONE declaring file. A local fallback
    // map here — even a well-meaning one — would turn that suite red.
    expect(executable(SAFE_CALLBACK_PATH)).not.toMatch(/const PORTAL_LANDING\b[^=]*=/);
  });
});

/* ================================================================== *
 * AC-2 — the matrix, driven through the REAL function
 * ================================================================== */

describe('AC-2 — the 37-row matrix, executed', () => {
  it.each(MATRIX)('$id $verdict — $why', (row: Row) => {
    const result = safeCallbackUrl(row.input, FALLBACK);

    // (1) the expectation column
    if (row.verdict === 'reject') expect(result).toBe(FALLBACK);
    else expect(result).toBe(row.input);

    // (2) the DIFFERENTIAL ORIGIN ORACLE — the property that actually matters,
    //     and the one a hand-written expectation column cannot silently drift from.
    expect(originOf(result)).toBe(SAME_ORIGIN);

    // (3) RETURN IDENTITY — the value validated is byte-for-byte the value
    //     returned. If the helper ever trimmed or normalised and returned the
    //     DERIVATIVE, we would be checking string A while the browser navigates
    //     to string B: the classic parser differential, and exactly how an
    //     open-redirect fix gets re-broken.
    expect(result === row.input || result === FALLBACK).toBe(true);
  });

  it('every ACCEPT row is same-origin on its own merits, not merely asserted', () => {
    // This is what makes the accept list DEFENSIBLE. If one of these ever stopped
    // resolving same-origin, accepting it would be the bug — not this assertion.
    for (const row of ACCEPT_ROWS) {
      expect(originOf(row.input as string)).toBe(SAME_ORIGIN);
    }
  });

  it('accepts "/" — raw[1] is undefined, and that is deliberate', () => {
    // Two readings of AC-2's prose are defensible and only one satisfies the
    // accept list: `raw[1] !== '/' && raw[1] !== '\\'` accepts "/" (raw[1] is
    // undefined), while `!/^\/[^/\\]/.test(raw)` REJECTS it (the regex demands a
    // second character). The shipped rule takes the first reading.
    expect(safeCallbackUrl('/', FALLBACK)).toBe('/');
  });

  it('rejects a non-string without throwing, on every shape a query read can produce', () => {
    expect(safeCallbackUrl(null, FALLBACK)).toBe(FALLBACK);
    expect(safeCallbackUrl(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('returns the fallback UNVALIDATED — the trust boundary is the call site', () => {
    // D3: validating `fallback` would need a fallback for the fallback (infinite
    // regress). The honest place to stop is here, with the call-site assertion in
    // AC-4 proving the only caller passes a compile-time constant.
    expect(safeCallbackUrl('https://evil.example/', '/admin/dashboard')).toBe('/admin/dashboard');
  });
});

/* ================================================================== *
 * AC-2 correction — the briefed rule is exploitable, MEASURED
 * ================================================================== */

/** The rule proposed by AC-2 and by `audit-findings-index.md:149`, verbatim. */
function briefedRule(rawValue: string | null | undefined, fallback: string): string {
  if (typeof rawValue !== 'string') return fallback;
  return rawValue.startsWith('/') && rawValue[1] !== '/' && rawValue[1] !== '\\'
    ? rawValue
    : fallback;
}

/** The pre-slice expression, verbatim: `params.get('callbackUrl') ?? DEFAULT_LANDING[accent]`. */
function legacyRule(rawValue: string | null | undefined, fallback: string): string {
  return rawValue ?? fallback;
}

function holesOf(rule: (r: string | null | undefined, f: string) => string): string[] {
  return MATRIX.filter((row) => originOf(rule(row.input, FALLBACK)) !== SAME_ORIGIN).map((r) => r.id);
}

describe('AC-2 correction — the rule the finding proposed has exactly three holes', () => {
  it('the briefed four-clause rule lets R25/R26/R27 navigate off-origin', () => {
    // Cause: the WHATWG URL parser removes tab/LF/CR from ANYWHERE in the string
    // BEFORE parsing, so `/<TAB>/evil.example` becomes `//evil.example` — after
    // the check has already passed it. `raw[1]` is a tab: neither `/` nor `\`.
    expect(holesOf(briefedRule)).toEqual(['R25', 'R26', 'R27']);
  });

  it('the shipped five-clause rule has none', () => {
    expect(holesOf(safeCallbackUrl)).toEqual([]);
  });

  it('the three holes are the SAME defect, spelled three ways', () => {
    for (const id of ['R25', 'R26', 'R27']) {
      const row = MATRIX.find((r) => r.id === id) as Row;
      expect(briefedRule(row.input, FALLBACK)).toBe(row.input); // briefed: ACCEPTED
      expect(originOf(row.input as string)).toBe('https://evil.example'); // …off-origin
      expect(safeCallbackUrl(row.input, FALLBACK)).toBe(FALLBACK); // shipped: refused
    }
  });

  it('a FOURTH hole was found while implementing — recorded here, not folded into the matrix', () => {
    // `/<CR><LF>/evil` passes the briefed rule and resolves to `https://evil/` —
    // a fourth spelling of R25/R26/R27's single cause. It is kept OUT of the
    // 37-row table on purpose: the story pins that count (29 + 8), the PR
    // evidence quotes it, and silently growing a table other documents cite is
    // how a "37-row matrix" claim becomes untrue. Recorded as its own row of
    // evidence instead, where it can neither be lost nor inflate a count.
    const crlf = '/' + '\u000D\u000A' + '/evil';
    expect(briefedRule(crlf, FALLBACK)).toBe(crlf); // briefed: ACCEPTED
    expect(originOf(crlf)).toBe('https://evil'); // …and off-origin
    expect(safeCallbackUrl(crlf, FALLBACK)).toBe(FALLBACK); // shipped: refused
  });

  it('no clause of the shipped rule is redundant — each catches a row the others miss', () => {
    // So a later "simplification" cannot delete one as dead weight. Each variant
    // below drops exactly one clause and must reopen at least one hole.
    // Same predicate as the shipped module, spelled as a code-unit scan for the
    // same reason it is spelled that way there: `no-control-regex` is an ESLint
    // ERROR in this repository, and these two variants tripped it at :554/:556.
    const hasC0 = (v: string) => {
      for (let i = 0; i < v.length; i += 1) {
        const code = v.charCodeAt(i);
        if (code <= 0x1f || code === 0x7f) return true;
      }
      return false;
    };
    const withoutC0 = (r: string | null | undefined, f: string) =>
      typeof r === 'string' && r[0] === '/' && r[1] !== '/' && r[1] !== '\\' ? r : f;
    const withoutSecondChar = (r: string | null | undefined, f: string) =>
      typeof r === 'string' && r[0] === '/' && !hasC0(r) ? r : f;
    const withoutFirstChar = (r: string | null | undefined, f: string) =>
      typeof r === 'string' && r[1] !== '/' && r[1] !== '\\' && !hasC0(r)
        ? r
        : f;

    expect(holesOf(withoutC0)).toEqual(['R25', 'R26', 'R27']);
    expect(holesOf(withoutSecondChar).length).toBeGreaterThan(0);
    expect(holesOf(withoutFirstChar).length).toBeGreaterThan(0);
  });
});

describe('AC-5(b)(i) — fails-before, proven INSIDE the run', () => {
  it('the pre-slice expression hands the attacker value to router.push on 21 rows', () => {
    // You cannot run a matrix against a line you deleted, so the deleted line is
    // re-implemented and co-driven. `?? fallback` only defends against null and
    // undefined; every other reject row goes straight through.
    const legacyHoles = holesOf(legacyRule);
    expect(legacyHoles).toEqual([
      'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10',
      'R11', 'R12', 'R13', 'R14', 'R15', 'R16', 'R17', 'R18',
      'R25', 'R26', 'R27',
    ]);
    expect(legacyHoles).toHaveLength(21);
  });

  it('and the shipped rule turns every one of those 21 into the portal dashboard', () => {
    for (const id of holesOf(legacyRule)) {
      const row = MATRIX.find((r) => r.id === id) as Row;
      expect(legacyRule(row.input, FALLBACK)).toBe(row.input); // before: attacker wins
      expect(safeCallbackUrl(row.input, FALLBACK)).toBe(FALLBACK); // after: silent fallback
    }
  });
});

/* ================================================================== *
 * AC-5(c) — the structural scan, ONE predicate, both directions
 * ================================================================== */

/**
 * A `const`/`let`/`var` whose initialiser reads a search parameter — and does NOT
 * route it through `safeCallbackUrl` — is TAINTED.
 *
 * The initialiser is captured up to the statement's `;`, capped at 400 chars so a
 * missing semicolon cannot make the regex run away over the rest of the file.
 */
const DECLARATION = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]{0,120})?=\s*([\s\S]{0,400}?);/g;
const SEARCH_PARAM_READ = /searchParams\s*\??\.\s*get\(|params\s*\??\.\s*get\(|useSearchParams\(\)/;
const VALIDATED = /safeCallbackUrl\(/;

/**
 * A redirect SINK whose whole first argument is a bare identifier (optionally
 * `ident!` or `ident as T`). `NextResponse.redirect(...)` is excluded by the
 * lookbehind: it is origin-anchored by construction, and it takes a `URL`.
 *
 * Anchoring on the ARGUMENT rather than on the file is the load-bearing choice —
 * see the header. `` router.push(`${pathname}?${next}`) `` is not this shape and
 * must never match; the discrimination is proven below in both directions.
 */
const SINK =
  /(?:router\s*\.\s*(?:push|replace)|(?<![.\w])redirect|window\s*\.\s*location\s*\.\s*(?:assign|replace))\(\s*([A-Za-z_$][\w$]*)\s*(?:!|\bas\s+[\w$.<>[\]| ]+)?\s*\)|window\s*\.\s*location\s*\.\s*href\s*=\s*([A-Za-z_$][\w$]*)\s*;/g;

function taintedBindings(source: string): Set<string> {
  const tainted = new Set<string>();
  DECLARATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DECLARATION.exec(source)) !== null) {
    const name = match[1] ?? '';
    const initialiser = match[2] ?? '';
    if (SEARCH_PARAM_READ.test(initialiser) && !VALIDATED.test(initialiser)) tainted.add(name);
  }
  return tainted;
}

function bareIdentifierSinks(source: string): { identifier: string; index: number }[] {
  const hits: { identifier: string; index: number }[] = [];
  SINK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SINK.exec(source)) !== null) {
    // Group 1 = the `router.push(ident)` family, group 2 = `window.location.href = ident`.
    // Exactly one of them is set on any match.
    hits.push({ identifier: match[1] ?? match[2] ?? '', index: match.index });
  }
  return hits;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/**
 * THE predicate — one function, used on the real tree AND on every fixture, so
 * the fixture regex and the scan regex cannot drift apart and make
 * "proven in the negative" a decorative claim.
 */
function scanForUnguardedRedirects(path: string, source: string): string[] {
  const tainted = taintedBindings(source);
  return bareIdentifierSinks(source)
    .filter((hit) => tainted.has(hit.identifier))
    .map((hit) => `${path}:${lineOf(source, hit.index)} → ${hit.identifier}`);
}

/** The pre-slice `PortalLoginForm.tsx:76`+`:125`, verbatim. */
const OLD_SHAPE = [
  'const params = useSearchParams();',
  "const callbackUrl = params.get('callbackUrl') ?? DEFAULT_LANDING[accent];",
  'router.push(callbackUrl);',
].join('\n');

/** The post-slice shape. */
const NEW_SHAPE = [
  'const params = useSearchParams();',
  "const callbackUrl = safeCallbackUrl(params.get('callbackUrl'), PORTAL_LANDING[accent]);",
  'router.push(callbackUrl);',
].join('\n');

/** The ~30-file `*Filters.tsx` shape the rule must stay silent on. */
const FILTER_SHAPE = [
  'const pathname = usePathname();',
  'const searchParams = useSearchParams();',
  'const next = new URLSearchParams(searchParams?.toString());',
  "next.set('page', String(page));",
  'router.push(`${pathname}?${next.toString()}`);',
].join('\n');

describe('AC-5(c) — the predicate discriminates, proven in BOTH directions', () => {
  it('reports the OLD expression as an offender', () => {
    // An assertion that can no longer fail is not a guard.
    expect(scanForUnguardedRedirects('fixture:old', OLD_SHAPE)).toEqual([
      'fixture:old:3 → callbackUrl',
    ]);
  });

  it('does NOT report the new expression', () => {
    expect(scanForUnguardedRedirects('fixture:new', NEW_SHAPE)).toEqual([]);
  });

  it('does NOT report the query-rebuild filter shape', () => {
    // Measured: 32 files under apps/web/src use `useSearchParams`, ~30 of them are
    // this exact shape. A per-file rule reddens all of them; this one must not.
    expect(scanForUnguardedRedirects('fixture:filter', FILTER_SHAPE)).toEqual([]);
  });

  it('does not confuse a validated binding for an unvalidated one', () => {
    const laundered = [
      "const target = safeCallbackUrl(searchParams.get('next'), '/parent/dashboard');",
      'router.replace(target);',
    ].join('\n');
    expect(scanForUnguardedRedirects('fixture:validated', laundered)).toEqual([]);
  });
});

describe('AC-5(c) — no file under apps/web/src hands a query value to a redirect sink', () => {
  it('the whole tree is clean', () => {
    const offenders: string[] = [];
    for (const [path, source] of EXECUTABLE_SRC) {
      offenders.push(...scanForUnguardedRedirects(path, source));
    }
    expect(offenders).toEqual([]);
  });

  it('the bare-identifier sink inventory is exactly the three reviewed sites', () => {
    // Both directions (PM-1): no NEW bare-identifier sink may appear, and the
    // reviewed ones may not be deleted to satisfy the rule above.
    const sites: string[] = [];
    for (const [path, source] of EXECUTABLE_SRC) {
      for (const hit of bareIdentifierSinks(source)) {
        sites.push(`${path}:${hit.identifier}`);
      }
    }
    expect(sites.sort()).toEqual(
      [
        'apps/web/src/components/PortalLoginForm.tsx:callbackUrl',
        'apps/web/src/components/notifications/NotificationListItem.tsx:link',
        'apps/web/src/components/notifications/NotificationListItem.tsx:link',
      ].sort(),
    );
  });

  it('POSITIVE CONTROL — the tree really does contain many redirect sinks', () => {
    // Without this, "3 bare-identifier sinks" could mean the sink regex stopped
    // matching anything at all. Measured before this slice: 55 `router.push|replace`
    // call sites across apps/web/src, ~52 of them literal- or pathname-rooted.
    let callSites = 0;
    for (const [, source] of EXECUTABLE_SRC) {
      callSites += (source.match(/router\s*\.\s*(?:push|replace)\(/g) ?? []).length;
    }
    expect(callSites).toBeGreaterThanOrEqual(40);
  });

  it('NotificationListItem.tsx pushes a row field, NOT a query value — recorded, not fixed', () => {
    // It is the same SINK class as PF-102 but a different SOURCE, so it is
    // outside this rule and outside this slice. Traced through the API before the
    // PR was opened: every writer of `Notification.link` composes a server-side
    // literal (or a literal template carrying a server-derived id) —
    // `alerts.service.ts:518,802`, `announcements.controller.ts:612`,
    // `child-claims.service.ts:679,695`, `enrollments.controller.ts:102`,
    // `assessments.controller.ts:345`, `lessons.controller.ts:129`,
    // `messaging.service.ts:589` (→ `portalLink`, literal at `:408,539`),
    // `remediation.controller.ts:340,476,663,979,1074,1085`,
    // `alerts-evaluator.service.ts:232`, `remediation-sweep-cron.service.ts:163`,
    // `notifications-digest-cron.service.ts:244,290`,
    // `parent-digest-cron.service.ts:221` — and NO DTO, Zod schema or contract
    // type accepts a `link` field on any request. Latent, not live.
    const source = executable(
      join(WEB_SRC, 'components', 'notifications', 'NotificationListItem.tsx'),
    );
    expect(source).toContain('router.push(link)');
    expect(source).not.toMatch(SEARCH_PARAM_READ);
  });
});

/* ================================================================== *
 * AC-5(d) — DNC-10, no bypass, tested in both halves
 * ================================================================== */

describe('AC-5(d) — DNC-10: the validator has no escape hatch', () => {
  it('declares none — structurally', () => {
    const source = executable(SAFE_CALLBACK_PATH);
    expect(source).not.toContain('process.env');
    expect(source).not.toContain('NODE_ENV');
    expect(source).not.toMatch(/\bCI\b/);
    expect(source).not.toMatch(/\b(SKIP|ALLOW|DISABLE|BYPASS|UNSAFE|FORCE)_/);
  });

  it('takes exactly two parameters — an options argument cannot hide from arity', () => {
    // Asserted on the EXECUTED function, not on the source text. A third
    // parameter IS the bypass, whatever it is called.
    expect(safeCallbackUrl.length).toBe(2);
  });

  it('and changes nothing under seven env mutations across five variables', () => {
    // Asserting a string is absent is not the same as asserting it does nothing:
    // an env var can be read through a computed key. So the module is RE-LOADED
    // (module-scope reads re-evaluate) and the whole reject set re-driven.
    // Mirrors `web-observability-gate.spec.ts:745-763`.
    const baseline = REJECT_ROWS.map((row) => safeCallbackUrl(row.input, FALLBACK));
    const saved = { ...process.env };

    const environments: Record<string, string>[] = [
      { SKIP_CALLBACK_VALIDATION: '1' },
      { ALLOW_OPEN_REDIRECT: '1' },
      { UNSAFE_CALLBACK_URL: '1' },
      { NODE_ENV: 'production' },
      { NODE_ENV: 'development' },
      { NODE_ENV: 'test' },
      { CI: 'false' },
    ];

    try {
      for (const overrides of environments) {
        Object.assign(process.env, overrides);
        const reloaded = loadSafeCallbackUrl();
        const observed = REJECT_ROWS.map((row) => reloaded(row.input, FALLBACK));
        expect(observed).toEqual(baseline);
        expect(observed.every((value) => value === FALLBACK)).toBe(true);
      }
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});

/* ================================================================== *
 * AC-5(e) — the emission side stays safe
 * ================================================================== */

describe('AC-5(e) — middleware.ts emits callbackUrl, and never reads one back', () => {
  const source = executable(MIDDLEWARE_PATH);

  it('POSITIVE CONTROL — it still emits from the server-derived pathname', () => {
    // Without this, every negative below is vacuous. (The neighbouring
    // `portal-landing-gate.spec.ts:417` also holds this; it is repeated here only
    // as the control the negatives need, not as a second owner of the invariant.)
    expect(source).toContain("url.searchParams.set('callbackUrl', pathname)");
    // …and `pathname` is still the SERVER-derived one. Asserted on the binding
    // the middleware actually writes (`const { pathname } = req.nextUrl;`, `:106`)
    // rather than on the literal `req.nextUrl.pathname`, which the file has never
    // contained — a guard must assert the code that exists, not the code the
    // story quoted from memory (R-30).
    expect(source).toMatch(/const\s*\{\s*pathname\s*\}\s*=\s*req\.nextUrl/);
  });

  it('THE NEGATIVE NOBODY ELSE HOLDS — it never reads callbackUrl out of the request query', () => {
    expect(source).not.toContain("searchParams.get('callbackUrl')");
    expect(source).not.toContain('searchParams.get("callbackUrl")');
    for (const line of source.split('\n')) {
      if (!line.includes('callbackUrl')) continue;
      expect(line).not.toContain('.get(');
      expect(line).not.toContain('nextUrl.searchParams');
    }
  });
});

describe('AC-5(e) — auth.ts still declares NO redirect callback', () => {
  it('so next-auth\u2019s default same-origin guard is the one covering the SSO branch', () => {
    // Overriding `redirect` is exactly how that default guard gets weakened, and
    // a future permissive override would reopen PF-102 at an address the rest of
    // this suite never looks at.
    //
    // Comment-stripped is load-bearing: the RAW file contains the word "redirect"
    // three times, ALL of them in comments (`:12`, `:90`, `:294`). A grep on raw
    // source would be a false red on a correct file — PF-83 / R-30.
    const source = executable(AUTH_PATH);
    expect(source).toContain('callbacks:'); // positive control
    expect(source).toContain('async jwt('); // …and it really is the callbacks block
    expect(source).not.toMatch(/\bredirect\s*[(:]/);
  });
});

/* ================================================================== *
 * AC-3 / AC-4 — the call site, validated once, on one constant
 * ================================================================== */

describe('AC-3 — PortalLoginForm validates ONCE, at the read site', () => {
  const source = executable(LOGIN_FORM_PATH);

  it('imports the helper and calls it on the query read', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*safeCallbackUrl[^}]*\}\s*from\s*'@\/lib\/safe-callback-url'/,
    );
    expect(source).toMatch(
      /const callbackUrl = safeCallbackUrl\(\s*params\.get\('callbackUrl'\)\s*,\s*PORTAL_LANDING\[accent\]\s*\)/,
    );
  });

  it('reads the parameter exactly once, so the SSO branch shares the SAME binding', () => {
    // One binding, two sinks. A second `params.get('callbackUrl')` anywhere in
    // the file would be a second, unvalidated read.
    expect(source.match(/params\.get\('callbackUrl'\)/g)).toHaveLength(1);
    expect(source.match(/const callbackUrl\b/g)).toHaveLength(1);
    expect(source).toContain('router.push(callbackUrl)');
    expect(source).toContain('{ callbackUrl }');
  });

  it('keeps the raw pre-slice expression nowhere in the file', () => {
    expect(source).not.toMatch(/params\.get\('callbackUrl'\)\s*\?\?/);
  });
});

describe('AC-4 — the fifth copy of the landing map is retired onto PORTAL_LANDING', () => {
  it('DEFAULT_LANDING exists in no file under apps/web/src', () => {
    const survivors = [...EXECUTABLE_SRC.entries()]
      .filter(([, source]) => source.includes('DEFAULT_LANDING'))
      .map(([path]) => path);
    expect(survivors).toEqual([]);
  });

  it('PortalLoginForm reads the ONE map and writes none of the four literals', () => {
    const source = executable(LOGIN_FORM_PATH);
    expect(source).toMatch(/import\s*\{[^}]*PORTAL_LANDING[^}]*\}\s*from\s*'@\/lib\/portals'/);
    for (const portal of PORTAL_IDS) {
      expect(source).not.toContain(`'/${portal}/dashboard'`);
    }
  });

  it('lib/portals.ts is still the single declaring file, and still import-free', () => {
    // The consumer count moves 6 → 7 against `portal-landing-gate.spec.ts:268`'s
    // `>= 6` floor, and the declaring file is untouched — so importing it into a
    // `'use client'` component adds nothing to the bundle but the object literal.
    const declarations = [...EXECUTABLE_SRC.entries()]
      .filter(([, source]) => /(?:export\s+)?const PORTAL_LANDING\b[^=]*=/.test(source))
      .map(([path]) => path);
    expect(declarations).toEqual(['apps/web/src/lib/portals.ts']);
    expect(executable(PORTALS_MODULE_PATH)).not.toMatch(/^\s*import\s/m);
  });
});

/* ================================================================== *
 * G-PORTAL — one component, four routes, asserted as a SET
 * ================================================================== */

describe('G-PORTAL — the fix holds on all four portals by construction', () => {
  it('exactly four */login/page.tsx files exist, and each renders PortalLoginForm', () => {
    const loginPages = [...EXECUTABLE_SRC.keys()].filter((path) =>
      /^apps\/web\/src\/app\/[^/]+\/login\/page\.tsx$/.test(path),
    );
    expect(loginPages.sort()).toEqual(
      PORTAL_IDS.map((p) => `apps/web/src/app/${p}/login/page.tsx`).sort(),
    );

    const accents: string[] = [];
    for (const path of loginPages) {
      const source = EXECUTABLE_SRC.get(path) as string;
      expect(source).toMatch(
        /import\s*\{\s*PortalLoginForm\s*\}\s*from\s*'@\/components\/PortalLoginForm'/,
      );
      accents.push(/accent="([^"]+)"/.exec(source)?.[1] ?? 'MISSING');
    }
    expect(accents.sort()).toEqual([...PORTAL_IDS].sort());
  });

  it('and exactly ONE file in the tree is a login form at all', () => {
    // A fifth login form — the way a shared component quietly re-forks — turns
    // this red. That is the intent, not an accident.
    const forms = [...EXECUTABLE_SRC.entries()]
      .filter(
        ([, source]) =>
          source.includes('useSearchParams') &&
          source.includes('router.push') &&
          source.includes('signIn('),
      )
      .map(([path]) => path);
    expect(forms).toEqual(['apps/web/src/components/PortalLoginForm.tsx']);
  });

  it('one code path serves four portals — no portal-conditional redirect branch', () => {
    // Asserted as the invariant rather than as a grep for `accent ===`: the file
    // legitimately branches on `accent` for the registration copy, so banning the
    // comparison outright would be a false red on correct code (PF-83 / R-30).
    // The invariant that actually matters is that there is ONE push and ONE
    // target binding.
    const source = executable(LOGIN_FORM_PATH);
    expect(source.match(/router\.push\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/switch\s*\(\s*accent\s*\)/);
  });
});
