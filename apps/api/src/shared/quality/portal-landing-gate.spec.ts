import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * S-E06-5 — guard for the four bare portal roots, the ONE portal-landing constant,
 * the three new public pages, and the removal of the dead account-menu entries.
 *
 * WHAT WAS BROKEN
 * ---------------
 * Two defects, one theme: *a navigation affordance that points nowhere.*
 *
 *   1. `/admin`, `/teacher`, `/parent` and `/student` had no index route. The most
 *      guessable URL in each portal — the prefix itself, which is what a user gets
 *      by trimming a path or keeping a stale bookmark — returned 404 inside a portal
 *      that works (PF-93).
 *   2. The application shell's account menu rendered « Mon profil » at
 *      `` `/${portal}/profile` ``. No per-portal profile route was ever emitted, so
 *      the entry 404'd on every authenticated page of the admin, teacher and parent
 *      portals (PF-97) — and `scripts/link-integrity-check.js`, the gate written to
 *      stop exactly this, printed PASS, because its extractor could not see a
 *      backtick.
 *
 * WHAT THIS FILE GUARDS, AND WHY EACH RULE IS SHAPED THIS WAY
 * ----------------------------------------------------------
 * • **One landing constant, not two.** The obvious fix for (1) — a redirect page per
 *   portal — would have written the four landing paths a second time, next to the
 *   copy `middleware.ts` uses to bounce a fresh login. Two copies drift, and a
 *   drifted copy sends a whole portal to a page that moved. `S-E02-16` rule 2 (*a
 *   value is written exactly once*) applied to a route: the map MOVED to
 *   `apps/web/src/lib/portals.ts`, and this file fails if it is ever declared twice,
 *   if the middleware stops reading it, or if a root page writes a literal path.
 * • **G-AUTHZ, asserted in the negative, per role.** The roots are inside the
 *   middleware's protected zone by prefix — that is inherited, not new code, which
 *   is precisely why it must be asserted rather than assumed. The trap is real and
 *   cheap to fall into: `PUBLIC_PREFIXES` is matched with `startsWith`, so adding
 *   `'/admin'` to it to "just let the root bounce" would make **every admin page**
 *   unauthenticated. Every negative here is preceded by a positive control, so a
 *   regex that stopped matching cannot pass the suite forever (run-10).
 * • **Copy checked against code, not vibes.** The three public pages may not invent
 *   a price (`D-05` is open), an address, a phone number, a form (no endpoint
 *   accepts one — DNC-06) or holding copy (DNC-09). The DNC-09 rule is written as
 *   *"no sentence about the product's own availability or schedule"*, NOT as a bare
 *   grep: `/help` legitimately renders the row label « Évaluations à venir », and a
 *   naive `à venir` ban would go red on correct copy — PF-83 / R-30 one layer up.
 *
 * COMMENT-STRIPPED, USING THE GATE'S OWN STRIPPER
 * ----------------------------------------------
 * Every read below goes through `stripCommentsPreservingLines` from
 * `scripts/link-integrity-check.js`. Two reasons: PF-83 (a comment that merely
 * *names* a forbidden string turned a real guard red, and the files here explain at
 * length *why* they contain no price and no profile entry), and reuse — that
 * function is string-aware, so unlike a `/\/\/.*$/` one-liner it cannot delete the
 * rest of a line the moment it meets `https://`. It is itself proven in both
 * directions in `link-integrity-gate.spec.ts`.
 *
 * NOT TRIGGERED, and not claimed: G-TENANT (no Prisma query, no endpoint),
 * G-MIGRATION (no `schema.prisma` change), G-AUDIT (no privileged mutation),
 * G-TRUTH (no KPI, count or read projection). The only new server behaviour in the
 * slice is a redirect and one session read on `/help`.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'link-integrity-check.js');
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');
const WEB_TESTS = join(REPO_ROOT, 'apps', 'web', 'tests');
const WEB_ROUTE_BASELINE_PATH = join(REPO_ROOT, 'scripts', 'web-route-baseline.json');

const PORTALS_MODULE = join(WEB_SRC, 'lib', 'portals.ts');
const MIDDLEWARE_PATH = join(WEB_SRC, 'middleware.ts');
const TOPBAR_MENU_PATH = join(WEB_SRC, 'components', 'shell', 'TopbarUserMenu.tsx');
const ORPHAN_MENU_PATH = join(WEB_SRC, 'components', 'UserMenu.tsx');
const PUBLIC_CHROME_PATH = join(WEB_SRC, 'components', 'public', 'PublicInfoPage.tsx');

const PORTALS = ['admin', 'teacher', 'parent', 'student'] as const;
type Portal = (typeof PORTALS)[number];

const PUBLIC_PAGES = ['pricing', 'contact', 'help'] as const;

/** The seven routes this slice adds to the emitted inventory. */
const NEW_ROUTES = [
  '/admin',
  '/teacher',
  '/parent',
  '/student',
  '/pricing',
  '/contact',
  '/help',
];

/* eslint-disable @typescript-eslint/no-require-imports */
// Unguarded on purpose: if the gate script is gone or stops exporting its stripper,
// this suite must fail at load rather than degrade to "nothing to check".
const { stripCommentsPreservingLines } = require(SCRIPT_PATH) as {
  stripCommentsPreservingLines: (source: string) => string;
};
/**
 * TOOL-17 — the shared walk-then-read seam, required unguarded for the same
 * reason as the stripper above. It tolerates exactly one thing: a path that
 * `walk()` listed and that is CONFIRMED absent by the time it is read. Any other
 * errno, and any missing NAMED file, still fails loudly.
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

function rootPagePath(portal: Portal): string {
  return join(WEB_SRC, 'app', portal, 'page.tsx');
}

function publicPagePath(page: (typeof PUBLIC_PAGES)[number]): string {
  return join(WEB_SRC, 'app', page, 'page.tsx');
}

/** Every `.ts`/`.tsx` file under a root, walked from the filesystem. */
function walk(root: string): string[] {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  /* eslint-enable @typescript-eslint/no-require-imports */
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
const WEB_TEST_FILES = walk(WEB_TESTS);

/**
 * The whole app, comment-stripped, keyed by repo-relative path.
 *
 * TOOL-17: routed through the shared seam — `csv-escape-gate.spec.ts:493` plants
 * and deletes a probe inside this walk root, which used to take this suite down
 * at LOAD under parallel jest. Accounting identity + cap in the floor below.
 */
const { entries: EXECUTABLE_SRC_ENTRIES, skipped: VANISHED_WEB_SRC } = mapWalkedFiles(
  WEB_SRC_FILES,
  (file, source) => [
    file.slice(REPO_ROOT.length + 1).split('\\').join('/'),
    stripCommentsPreservingLines(source),
  ],
);
warnSkipped('portal-landing-gate / apps/web/src', VANISHED_WEB_SRC);
const EXECUTABLE_SRC = new Map<string, string>(EXECUTABLE_SRC_ENTRIES);

/**
 * The Playwright corpus, read the same way (site 2). The F16 rule below iterates
 * it, and its own `readFileSync` had the identical race.
 */
const { entries: WEB_TEST_ENTRIES, skipped: VANISHED_WEB_TESTS } = mapWalkedFiles(
  WEB_TEST_FILES,
  (file, source) => [file, stripCommentsPreservingLines(source)],
);
warnSkipped('portal-landing-gate / apps/web/tests', VANISHED_WEB_TESTS);
const EXECUTABLE_TESTS = new Map<string, string>(WEB_TEST_ENTRIES);

const reviewedRoutes: string[] =
  (
    JSON.parse(readFileSync(WEB_ROUTE_BASELINE_PATH, 'utf8')) as {
      apps: Record<string, { routes: string[] } | undefined>;
    }
  ).apps['apps/web']?.routes ?? [];

/**
 * Capture one bracketed array declaration out of comment-stripped middleware source.
 *
 * Returns `''` when the name is not found, which every caller must rule out with a
 * positive control BEFORE asserting an absence — a regex that silently matches
 * nothing satisfies every `not.toContain` in this file forever.
 */
function capturedArray(source: string, name: string): string {
  return new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(source)?.[1] ?? '';
}

/* ================================================================== *
 * 0. The floor — this suite is reading a real application
 * ================================================================== */

describe('the guard is not vacuous (run-10)', () => {
  it('walked apps/web/src and apps/web/tests, and found real files', () => {
    expect(WEB_SRC_FILES.length).toBeGreaterThanOrEqual(300);
    expect(WEB_TEST_FILES.length).toBeGreaterThanOrEqual(1);
    // TOOL-17 accounting. Both floors above are asserted on the walk LISTS, and a
    // tolerated skip shrinks the MAPS — so the identities are restated with the
    // skips added back, and the skips are capped. Deliberately not `toBe(0)`,
    // which would move the flake from LOAD to assert time and fix nothing.
    expect(EXECUTABLE_SRC.size + VANISHED_WEB_SRC.length).toBe(WEB_SRC_FILES.length);
    expect(EXECUTABLE_TESTS.size + VANISHED_WEB_TESTS.length).toBe(WEB_TEST_FILES.length);
    expect(VANISHED_WEB_SRC.length).toBeLessThanOrEqual(MAX_VANISHED_FILES);
    expect(VANISHED_WEB_TESTS.length).toBeLessThanOrEqual(MAX_VANISHED_FILES);
  });

  it('the stripper it borrows really strips, and really preserves', () => {
    // Guards the guard: a stripper that returned its input unchanged would make
    // every comment-stripped negative below testable only by luck, and a stripper
    // that returned '' would satisfy all of them vacuously.
    const source = ['// Mon profil', "const label = 'Paramètres';"].join('\n');
    const stripped = stripCommentsPreservingLines(source);
    expect(stripped).toHaveLength(source.length);
    expect(stripped).not.toContain('Mon profil');
    expect(stripped).toContain("'Paramètres'");
  });

  it('the reviewed route inventory is populated', () => {
    expect(reviewedRoutes.length).toBeGreaterThanOrEqual(110);
  });
});

/* ================================================================== *
 * 1. P-1 / P-2 — one landing constant, edge-safe, declared once
 * ================================================================== */

describe('P-1 — apps/web/src/lib/portals.ts is the single home of the landing map', () => {
  it('exists and exports PORTAL_IDS, PortalId and PORTAL_LANDING', () => {
    expect(existsSync(PORTALS_MODULE)).toBe(true);
    const source = executable(PORTALS_MODULE);
    expect(source).toMatch(/export const PORTAL_IDS/);
    expect(source).toMatch(/export type PortalId/);
    expect(source).toMatch(/export const PORTAL_LANDING/);
  });

  it.each(PORTALS)('maps %s to its own dashboard, and nothing else', (portal) => {
    const source = executable(PORTALS_MODULE);
    expect(source).toMatch(new RegExp(`${portal}:\\s*'/${portal}/dashboard'`));
    // The target must be an EMITTED route, or the fix moves the 404 rather than
    // removing it. (`/student/dashboard` is the E8-S3 hero page; the comment the map
    // used to carry in `middleware.ts` claimed the student portal had none, and that
    // comment was stale — which is itself the argument for one home, not two.)
    expect(reviewedRoutes).toContain(`/${portal}/dashboard`);
  });

  it('holds EXACTLY the four portals — no fifth key, no missing one', () => {
    const body = /export const PORTAL_LANDING[^{]*\{([\s\S]*?)\}/.exec(executable(PORTALS_MODULE))?.[1] ?? '';
    expect(body).not.toBe('');
    const keys = [...body.matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]).sort();
    expect(keys).toEqual([...PORTALS].sort());
  });

  it('is import-free and reads no environment variable — it is in the EDGE bundle', () => {
    // `middleware.ts` runs in the Edge runtime and pulls this module in. A
    // `next/*` import, a `'server-only'` marker or a `process.env` read here would
    // break the middleware at runtime while typecheck stayed green — and it is also
    // why the map is not in `packages/contracts`, which is built to CJS `dist/` and
    // shared with the api and worker runtimes that have no use for a Next route.
    const source = executable(PORTALS_MODULE);
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toContain('server-only');
    expect(source).not.toContain('process.env');
  });
});

describe('P-2 — AC-2: the landing map is declared ONCE and read everywhere', () => {
  const declarations = () => {
    const found: string[] = [];
    for (const [path, source] of EXECUTABLE_SRC) {
      if (/(?:export\s+)?const PORTAL_LANDING\b[^=]*=/.test(source)) found.push(path);
    }
    return found;
  };

  it('exactly one file in apps/web/src DECLARES it, and it is lib/portals.ts', () => {
    expect(declarations()).toEqual(['apps/web/src/lib/portals.ts']);
  });

  it('no file under apps/web/tests declares a second copy either (F16)', () => {
    // The duplication AC-2 forbids already existed once, outside `src`: the
    // Playwright fixture used to MIRROR the four literals with a comment saying so.
    // A guard scoped to `src` would have missed it, so this one is not.
    // TOOL-17: reads the corpus built once at module level through the shared
    // seam, instead of re-reading each file here. One read, one race window,
    // one place where a vanished path is accounted for.
    for (const [, source] of EXECUTABLE_TESTS) {
      expect(source).not.toMatch(/(?:export\s+)?const PORTAL_LANDING\b[^=]*=/);
    }
  });

  it('middleware.ts IMPORTS it and declares no landing map of its own', () => {
    const source = executable(MIDDLEWARE_PATH);
    expect(source).toMatch(/import\s*\{[^}]*PORTAL_LANDING[^}]*\}\s*from\s*'@\/lib\/portals'/);
    expect(source).not.toMatch(/const PORTAL_LANDING\b[^=]*=/);
    // …and it still USES it, or the import is decoration and the middleware has
    // quietly gone back to its own literal.
    expect(source).toContain('PORTAL_LANDING[portal]');
  });

  it('every consumer reads the module, so a fifth consumer cannot re-fork it', () => {
    const consumers = [...EXECUTABLE_SRC.entries()].filter(([, source]) => source.includes('PORTAL_LANDING'));
    // Floor first: middleware + four roots + /help = six files at minimum.
    expect(consumers.length).toBeGreaterThanOrEqual(6);
    for (const [path, source] of consumers) {
      if (path === 'apps/web/src/lib/portals.ts') continue;
      expect(source).toMatch(/from\s*'@\/lib\/portals'/);
    }
  });
});

/* ================================================================== *
 * 2. P-3 — the four roots, per portal (G-PORTAL)
 * ================================================================== */

describe.each(PORTALS)('P-3 — /%s is a real route that redirects (G-PORTAL)', (portal) => {
  it('the page file exists', () => {
    expect(existsSync(rootPagePath(portal))).toBe(true);
  });

  it('redirects to PORTAL_LANDING with a LITERAL key, never a derived one', () => {
    const source = executable(rootPagePath(portal));
    expect(source).toMatch(/from\s*'@\/lib\/portals'/);
    expect(source).toContain(`redirect(PORTAL_LANDING.${portal})`);
  });

  it('contains NO literal landing path — the constant is the only source (AC-2)', () => {
    // The whole point: if the path is written here as well, the two copies drift and
    // a portal ends up pointed at a page that moved.
    const source = executable(rootPagePath(portal));
    expect(source).not.toContain(`/${portal}/dashboard`);
  });

  it('declares force-dynamic, matching the /admin/classes/new precedent', () => {
    // The root layout already sets it, so this is belt-and-braces — but
    // `csp-check.js` refuses any prerendered document carrying a <script> (S-E06-2),
    // and the sibling guard pins the per-page form, so a new page without it is the
    // kind of thing that turns stage 12 red for a reason nobody connects to this PR.
    expect(executable(rootPagePath(portal))).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('is a SERVER redirect with no client bundle and no user-controlled input (G-AUTHZ)', () => {
    const source = executable(rootPagePath(portal));
    expect(source).not.toContain("'use client'");
    // A `useEffect` bounce would flash a blank frame and break without JS; a
    // `<meta http-equiv="refresh">` likewise. And nothing user-controlled may reach
    // the redirect: no searchParams, no header, no referrer, no cookie read. Those
    // are the ingredients of a fail-open open redirect.
    expect(source).not.toContain('useEffect');
    expect(source).not.toContain('http-equiv');
    expect(source).not.toContain('searchParams');
    expect(source).not.toContain('headers(');
    expect(source).not.toContain('cookies(');
  });

  it('mounts no shell — a redirect must not fetch /me before answering', () => {
    const source = executable(rootPagePath(portal));
    expect(source).not.toContain('AppShellRoot');
    expect(source).not.toContain('PortalShell');
  });

  it('the reviewed route inventory records it (the S-E06-3 lesson)', () => {
    // `web-artifact-check.js` fails on any emitted route absent from
    // `scripts/web-route-baseline.json`. Shipping the page without the inventory
    // line turns that stage red on a defect-free tree.
    expect(reviewedRoutes).toContain(`/${portal}`);
  });
});

/* ================================================================== *
 * 3. P-4 / P-5 — G-AUTHZ, negative per role, positive control first
 * ================================================================== */

describe('P-4 — the moved constant did not change the middleware behind it', () => {
  const source = executable(MIDDLEWARE_PATH);

  it.each(PORTALS)('still detects the %s portal by URL prefix', (portal) => {
    expect(source).toContain(`pathname.startsWith('/${portal}')`);
  });

  it('PORTAL_REQUIRED_ROLES is typed by PortalId and holds the exact four role sets', () => {
    // A moved constant must not have changed a value in passing, and the typing is
    // the mechanism that stops the portal set here, the landing map, and the four
    // roots from drifting apart silently.
    expect(source).toMatch(/const PORTAL_REQUIRED_ROLES: Record<PortalId, readonly string\[\]>/);
    const block = /const PORTAL_REQUIRED_ROLES[^{]*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? '';
    expect(block).not.toBe('');
    for (const [portal, roles] of [
      ['admin', "['super_admin', 'school_admin']"],
      ['teacher', "['teacher']"],
      ['parent', "['parent']"],
      ['student', "['student']"],
    ]) {
      expect(block).toContain(`${portal}: ${roles}`);
    }
  });

  it('the authed bounce target is the CONSTANT lookup, not a searchParam', () => {
    // The one place the middleware chooses a destination for an authenticated user.
    // `PORTAL_LANDING[portal]` where `portal` came from the URL PREFIX is a
    // compile-time-bounded lookup; anything read out of `searchParams` or a header
    // there is an open redirect.
    expect(source).toContain('NextResponse.redirect(new URL(PORTAL_LANDING[portal], req.nextUrl.origin))');
    const redirectLine = source.split('\n').find((line) => line.includes('PORTAL_LANDING[portal]')) ?? '';
    expect(redirectLine).not.toContain('searchParams.get');
    expect(redirectLine).not.toContain('headers');
  });
});

describe('P-5 — G-AUTHZ: a portal root is inside the protected zone, per role', () => {
  const source = executable(MIDDLEWARE_PATH);
  const publicPrefixes = capturedArray(source, 'PUBLIC_PREFIXES');

  it('the PUBLIC_PREFIXES capture found the real array (positive control)', () => {
    // Without this, every absence asserted below is satisfied by a regex that
    // matched nothing — and the suite would certify an unauthenticated portal.
    expect(publicPrefixes).toContain("'/legal'");
    expect(publicPrefixes).toContain("'/api/auth'");
  });

  it.each(PORTALS)('/%s is NOT public — PUBLIC_PREFIXES is a startsWith list', (portal) => {
    // The trap, and it is a one-line mistake: `PUBLIC_PREFIXES.some((p) =>
    // pathname.startsWith(p))` means adding `'/admin'` here to "let the root just
    // bounce" makes EVERY admin page unauthenticated. Asserted for all four.
    expect(publicPrefixes).not.toContain(`'/${portal}'`);
    for (const entry of publicPrefixes.split(',').map((e) => e.trim().replace(/^'|'$/g, '')).filter(Boolean)) {
      expect(`/${portal}`.startsWith(entry)).toBe(false);
    }
  });

  it('and that check FAILS on the mistake it exists to catch (proven in the negative)', () => {
    const injected = "const PUBLIC_PREFIXES = ['/_next', '/admin', '/legal'];";
    const captured = capturedArray(injected, 'PUBLIC_PREFIXES');
    expect(captured).toContain("'/legal'"); // the same positive control still holds
    expect(captured).toContain("'/admin'"); // …and the rule above would have failed
  });

  it.each(PORTALS)('/%s is not an AUTH route either, so it falls into the protected branch', (portal) => {
    const authBlock = source.slice(source.indexOf('const AUTH_ROUTES_BY_PORTAL'));
    expect(authBlock).not.toBe('');
    const block = new RegExp(`${portal}: \\[([^\\]]*)\\]`).exec(authBlock)?.[1] ?? '';
    // Positive control per portal: each block really is the auth list.
    expect(block).toContain(`'/${portal}/login'`);
    // The bare root is compared with `startsWith(r)`, so no entry may be a prefix
    // of it. `'/admin'` sitting here would exempt the root from auth entirely.
    for (const entry of block.split(',').map((e) => e.trim().replace(/^'|'$/g, '')).filter(Boolean)) {
      expect(`/${portal}`.startsWith(entry)).toBe(false);
    }
  });

  it('both protected-branch redirects still exist — unauthenticated, and wrong role', () => {
    // The two outcomes AC-7 requires for every portal. Neither ever serves the page.
    expect(source).toContain("url.searchParams.set('callbackUrl', pathname)");
    expect(source).toContain("url.searchParams.set('error', 'wrong_portal')");
    expect(source).toMatch(/if \(!session\?\.user\)/);
    expect(source).toMatch(/if \(!hasRequiredRole\)/);
    // …and the login target is derived from the detected portal, not from the URL.
    expect(source).toContain('new URL(`/${portal}/login`, req.nextUrl.origin)');
  });

  it('the three public pages carry no portal prefix, so they need no PUBLIC_PREFIXES entry', () => {
    // `middleware.ts` proceeds for any path it cannot map to a portal, which is why
    // `/pricing`, `/contact` and `/help` are public BY CONSTRUCTION. Adding them to
    // `PUBLIC_PREFIXES` would be a second declaration of a fact the router already
    // carries — and, being a `startsWith` list, `'/help'` would whitelist
    // `/helpdesk` too.
    expect(source).toMatch(/if \(!portal\) return proceed\(pathname\)/);
    for (const page of PUBLIC_PAGES) {
      expect(publicPrefixes).not.toContain(`'/${page}'`);
      for (const portal of PORTALS) expect(`/${page}`.startsWith(`/${portal}`)).toBe(false);
    }
  });
});

/* ================================================================== *
 * 4. P-6 — AC-4: no navigation entry at a route that does not exist
 * ================================================================== */

describe('P-6 — AC-4: no navigation entry points at a route that does not exist', () => {
  it('NO /profile href exists anywhere in comment-stripped apps/web/src', () => {
    // This is the actual invariant AC-4 asks for, and it is stated on the HREF rather
    // than on the label — see the next case for why the label is the wrong probe.
    const offenders = [...EXECUTABLE_SRC.entries()]
      .filter(([, source]) => /['"`]\/(?:admin|teacher|parent|student|\$\{[^}]*\})\/profile/.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('FALSIFIED, and pinned rather than hidden: a « Mon profil » TAB does exist', () => {
    // The story's premise was "no profile surface exists in any portal". Measured, it
    // is narrower than that: `/parent/settings` and `/teacher/settings` each render a
    // « Mon profil » TAB over a local `ProfilePanel`. A tab is not a navigation
    // entry — it has no href and cannot 404 — so it is not the defect AC-4 removes,
    // and deleting it would remove a working surface to satisfy a string match.
    //
    // Asserting the exact set both ways keeps the record honest: the label may not
    // reappear anywhere else (a third occurrence fails here), and the two legitimate
    // ones may not be quietly deleted either.
    const withLabel = [...EXECUTABLE_SRC.entries()]
      .filter(([, source]) => source.includes('Mon profil'))
      .map(([path]) => path)
      .sort();
    expect(withLabel).toEqual([
      'apps/web/src/app/parent/settings/page.tsx',
      'apps/web/src/app/teacher/settings/page.tsx',
    ]);
    for (const path of withLabel) {
      const source = EXECUTABLE_SRC.get(path) ?? '';
      expect(source).toContain('<TabsTrigger value="profile">Mon profil</TabsTrigger>');
      expect(source).toContain('ProfilePanel');
      // …and it is a tab, not a link: no href goes with it.
      expect(source).not.toMatch(/['"`]\/(?:parent|teacher)\/profile/);
    }
  });

  it('neither menu emits a /profile href, in any form', () => {
    for (const path of [TOPBAR_MENU_PATH, ORPHAN_MENU_PATH]) {
      const source = executable(path);
      expect(source).not.toContain('/profile');
      expect(source).not.toContain('Mon profil');
      expect(source).not.toContain('UserRound');
    }
  });

  it('no portal emits a /profile ROUTE, which is WHY the entries went (PF-99)', () => {
    // The defect removed is "a link 404s". What remains queued as PF-99 is narrower
    // than the story assumed and must be recorded as such: there is no DEDICATED
    // profile route in any portal, `/admin/settings` has no profile tab (it
    // configures the establishment, not the person), and the student portal has no
    // settings route at all (PF-57).
    for (const portal of PORTALS) {
      expect(reviewedRoutes).not.toContain(`/${portal}/profile`);
      expect(existsSync(join(WEB_SRC, 'app', portal, 'profile', 'page.tsx'))).toBe(false);
    }
    expect(executable(join(WEB_SRC, 'app', 'admin', 'settings', 'page.tsx'))).not.toContain('Mon profil');
    expect(existsSync(join(WEB_SRC, 'app', 'student', 'settings', 'page.tsx'))).toBe(false);
  });

  it('POSITIVE CONTROL: the menus were narrowed, not emptied', () => {
    // Deleting both files satisfies every negative above. These are the entries that
    // must survive.
    const topbar = executable(TOPBAR_MENU_PATH);
    expect(topbar).toContain("'Paramètres'");
    expect(topbar).toContain("Centre d'aide");
    expect(topbar).toContain("'/help'");
    expect(topbar).toContain('Se déconnecter');

    // The orphan file keeps its settings entry: its inline 3-portal union is the
    // in-repo canary for the widened extractor's 3-union path (PF-100 owns the file
    // itself; only its dead href was removed).
    const orphan = executable(ORPHAN_MENU_PATH);
    expect(existsSync(ORPHAN_MENU_PATH)).toBe(true);
    expect(orphan).toContain('Paramètres');
    expect(orphan).toContain('${portal}/settings');
  });

  it('the settings href is a LITERAL per-portal map that omits student (PF-57)', () => {
    // Today's `isStudent` branch, expressed as data. Two consequences, both
    // deliberate: the link gate reads three literal hrefs it can resolve instead of
    // a template whose fourth expansion is dead, and the student portal's documented
    // no-settings posture stops being a branch a static checker cannot evaluate.
    const source = executable(TOPBAR_MENU_PATH);
    const block = /PORTAL_SETTINGS_HREF[^{]*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? '';
    expect(block).not.toBe('');
    expect(block).toContain("admin: '/admin/settings'");
    expect(block).toContain("teacher: '/teacher/settings'");
    expect(block).toContain("parent: '/parent/settings'");
    expect(block).not.toContain('student');
    // …and the omission is honest: the route really does not exist.
    expect(reviewedRoutes).not.toContain('/student/settings');
    for (const portal of ['admin', 'teacher', 'parent']) {
      expect(reviewedRoutes).toContain(`/${portal}/settings`);
    }
  });

  it('the 4-portal signOut template stays — it is the in-repo union canary', () => {
    // All four `/<portal>/login` routes are emitted, so a correct expansion reports
    // nothing and a broken one reports four dead targets. Removing it would remove
    // the only place the 4-union path is exercised by real code.
    expect(executable(TOPBAR_MENU_PATH)).toContain('callbackUrl: `/${portal}/login`');
    for (const portal of PORTALS) expect(reviewedRoutes).toContain(`/${portal}/login`);
  });
});

/* ================================================================== *
 * 5. P-7 / P-8 — the three public pages, sentence by sentence
 * ================================================================== */

/** Copy that promises the product's own availability or schedule (DNC-09). */
const HOLDING_COPY = [
  /bient[oô]t disponible/i,
  /coming soon/i,
  /en cours de finalisation/i,
  /prochainement/i,
  /pr[eé]vu pour/i,
  /sera disponible/i,
];

/** Anything that would publish a price while D-05 is open. */
const PRICE_TOKENS = [
  /\d+\s*(?:€|EUR\b|euros?)/i,
  /\$\s*\d/,
  /par mois/i,
  /\/mois/i,
  /par élève/i,
  /par an\b/i,
  /\bHT\b/,
  /\bformule\b/i,
  /\boffre\b/i,
  /\babonnement\b/i,
  /\btarif de\b/i,
];

describe.each(PUBLIC_PAGES)('P-7 — /%s resolves and says only checkable things', (page) => {
  it('the page exists, is recorded in the inventory, and is force-dynamic', () => {
    expect(existsSync(publicPagePath(page))).toBe(true);
    expect(reviewedRoutes).toContain(`/${page}`);
    expect(executable(publicPagePath(page))).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('FLOOR: it is a real page — a title and the shared public chrome', () => {
    // Every negative below is satisfied by an empty file, so the floor comes first.
    const source = executable(publicPagePath(page));
    expect(source.length).toBeGreaterThan(1500);
    expect(source).toContain('PublicInfoPage');
    expect(source).toMatch(/title=/);
  });

  it('contains no email-address literal — the channel is the configured constant', () => {
    // S-E06-1's rule: a contact channel is a declaration, never a literal at a call
    // site. Four independent copies is how the previous drift happened.
    expect(executable(publicPagePath(page))).not.toMatch(/[\w.%+-]+@[\w.-]+\.\w{2,}/);
  });

  it('routes contact through the shared component, which reads SUPPORT_EMAIL', () => {
    const source = executable(publicPagePath(page));
    expect(source).toMatch(/Support(?:EmailLink|ContactBlock)/);
    const chrome = executable(PUBLIC_CHROME_PATH);
    expect(chrome).toMatch(/import\s*\{[^}]*SUPPORT_EMAIL[^}]*\}\s*from\s*'@\/lib\/support-contact'/);
    expect(chrome).toContain('mailto:${SUPPORT_EMAIL}');
    expect(chrome).not.toMatch(/[\w.%+-]+@[\w.-]+\.\w{2,}/);
  });

  it('promises no channel the runtime lacks: no phone, no hours, no form (DNC-06)', () => {
    // There is no endpoint that accepts a contact form, so shipping one would be
    // DNC-06 delivered as the fix for DNC-06. Same for a phone number or a
    // response-time promise: nothing in the deployment can honour either.
    const source = executable(publicPagePath(page));
    expect(source).not.toMatch(/<form\b/);
    expect(source).not.toMatch(/type="submit"/);
    expect(source).not.toMatch(/(?:\+?\d[\s.-]?){8,}/); // a phone-like run of digits
    expect(source).not.toMatch(/sous 24\s*h|dans les plus brefs délais|d[ée]lai de r[ée]ponse/i);
    expect(source).not.toMatch(/chat en direct|t[ée]l[ée]phone|horaires d'ouverture/i);
  });

  it.each(HOLDING_COPY)('carries no holding copy matching %s (DNC-09)', (pattern) => {
    // Phrased as "no sentence about the product's own availability or schedule", NOT
    // as a bare grep: `/help` legitimately renders « Évaluations à venir » as a row
    // label, and banning `à venir` outright would go red on correct copy (R-30).
    expect(executable(publicPagePath(page))).not.toMatch(pattern);
  });

  it('links to no /legal/* page — those do not exist and D-08 blocks them (R-13)', () => {
    expect(executable(publicPagePath(page))).not.toContain('/legal');
  });

  it('states no RGPD or data-controller policy — the routine may never author one', () => {
    expect(executable(publicPagePath(page))).not.toMatch(/RGPD|DPO|responsable de traitement|dur[ée]e de conservation/i);
  });
});

describe('P-8 — /pricing publishes no price, because D-05 is open', () => {
  const source = () => executable(publicPagePath('pricing'));

  it('FLOOR: it really is the tariff page, and it does route the question somewhere', () => {
    expect(source()).toContain('Tarifs');
    expect(source()).toMatch(/Support(?:EmailLink|ContactBlock)/);
    // …and it points at the one self-service surface that genuinely exists.
    expect(source()).toContain('/parent/register');
    expect(reviewedRoutes).toContain('/parent/register');
  });

  it.each(PRICE_TOKENS)('carries nothing matching %s', (pattern) => {
    // Inventing a price is the same class of overreach as authoring policy text
    // (R-13): a sentence the product cannot honour, shipped by a routine. The page
    // may state that tarifs are not published here — a present fact — and stop.
    expect(source()).not.toMatch(pattern);
  });

  it('and the check is not vacuous: the same patterns DO match invented copy', () => {
    const invented = 'À partir de 3 € par élève par mois — formule Établissement.';
    expect(PRICE_TOKENS.some((pattern) => pattern.test(invented))).toBe(true);
  });

  it('there is no payment code anywhere for it to describe (the claim is checkable)', () => {
    // « Aucun paiement n'est demandé ni traité dans l'application » is only sayable
    // because it is true: no billing surface exists in `apps/web/src`.
    const offenders = [...EXECUTABLE_SRC.entries()]
      .filter(([, content]) => /\b(?:stripe\.|Stripe|paddle|checkout\.session|createSubscription)\b/.test(content))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe('P-7b — /help is portal-agnostic and G-PORTAL-complete', () => {
  const source = () => executable(publicPagePath('help'));

  it('offers all FOUR portal logins (G-PORTAL made visible)', () => {
    for (const portal of PORTALS) {
      expect(source()).toContain(`/${portal}/login`);
    }
  });

  it('every internal link on it resolves against the reviewed inventory', () => {
    // The page's own promise — « Cette page ne décrit que des écrans présents dans
    // cette version » — is only true if this holds. The link gate proves it for the
    // whole tree; this asserts it here so a bad row fails the closest test to it.
    const hrefs = [...source().matchAll(/href:\s*'(\/[^']*)'/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(15);
    for (const href of hrefs) {
      expect(reviewedRoutes).toContain(href);
    }
  });

  it('does not offer a student a capability the student portal lacks (PF-57)', () => {
    // The student portal has no settings surface and no notification bell. A help
    // page that listed either would be DNC-06 with a friendly face.
    const studentBlock = /student:\s*\{([\s\S]*?)\n {2}\},/.exec(source())?.[1] ?? '';
    expect(studentBlock).not.toBe('');
    expect(studentBlock).toContain('/student/dashboard');
    expect(studentBlock).not.toContain('/student/settings');
    expect(studentBlock).not.toContain('/student/notifications');
  });

  it('the « retour » target is the PORTAL_LANDING constant, never a query param', () => {
    // `/help` is reached from inside the authenticated shell on all four portals, so
    // it needs a way back — and that target is the third consumer of the one
    // constant, indexed by the reader's own session claim through a type guard.
    // Anything read out of `searchParams`, a referrer or a header there would be an
    // open redirect on a public page (G-AUTHZ).
    const content = source();
    expect(content).toContain('PORTAL_LANDING[portal]');
    expect(content).toContain('isPortalId');
    expect(content).not.toContain('searchParams');
    expect(content).not.toContain('document.referrer');
    expect(content).not.toContain("headers()");
  });

  it('degrades to the signed-out layout rather than to an error state', () => {
    // A failed session read on a PUBLIC page means "signed out", which is the honest
    // default and a layout the page already has — not a 500 and not a spinner.
    expect(source()).toMatch(/catch\s*\{[\s\S]{0,80}return null;/);
  });
});

/* ================================================================== *
 * 6. P-9 — the hand-edited route inventory (no agent may build)
 * ================================================================== */

describe('P-9 — scripts/web-route-baseline.json records all seven new routes', () => {
  it.each(NEW_ROUTES)('contains %s', (route) => {
    expect(reviewedRoutes).toContain(route);
  });

  it('grew by exactly seven, from the 109 S-E06-3 left behind', () => {
    expect(reviewedRoutes).toHaveLength(116);
  });

  it('is in the plain sort order web-artifact-check.js writes', () => {
    // The file is HAND-EDITED here, because no agent may run `pnpm build` and this
    // inventory is read off the emitted output. A wrong count or a wrong position
    // shows up as a diff when the orchestrator runs
    // `node scripts/web-artifact-check.js --update` after its single build — which
    // is the intended detector, and the reason the order is asserted now.
    expect(reviewedRoutes).toEqual([...reviewedRoutes].sort());
  });

  it('changed nothing else: mustBeDynamic is still the single version route', () => {
    const parsed = JSON.parse(readFileSync(WEB_ROUTE_BASELINE_PATH, 'utf8')) as {
      apps: Record<string, { mustBeDynamic: string[] } | undefined>;
    };
    expect(parsed.apps['apps/web']?.mustBeDynamic).toEqual(['/version/web']);
  });
});
