import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * S-E06-3 / PF-19 — guard for the link-integrity gate.
 *
 * WHAT PF-19 IS, AND WHY A ROUTE-EXISTENCE CHECK CANNOT SEE IT
 * -----------------------------------------------------------
 * `apps/web/src/app/admin/classes/page.tsx` links to `/admin/classes/new` twice —
 * once as the `PageHeader` action ("Ajouter une classe"), once as the `EmptyState`
 * action. That route was never emitted. It nonetheless **resolves**: Next matches
 * it against `/admin/classes/[id]` with `id = "new"`, and the class-detail page
 * then loads a class whose id is the string `new`.
 *
 * So the naive gate — "does every link target exist in the route table?" — answers
 * *yes* and reports green, while the primary call to action of an admin surface
 * lands on an error boundary. The defect is not the **absence** of a match; it is
 * the **shape** of the match. That is the non-obvious half of this gate and the
 * reason the classifier returns four verdicts rather than a boolean:
 *
 *     exact           the target matches a route template with no dynamic segment
 *     catch-all       it matches only through `[...slug]` / `[[...slug]]`  → ALIVE
 *     dynamic-capture it matches only because a single-segment `[param]` swallowed
 *                     a literal segment                                   → FAIL, always
 *     dead            it matches nothing at all                           → FAIL unless baselined
 *
 * `catch-all` is ALIVE on purpose (pre-mortem P0-C1): consuming literal segments
 * is the *entire* function of a catch-all, and `/api/proxy/[...path]` legitimately
 * swallows `/api/proxy/v1/notifications/unread-count`. Only a **single-segment**
 * `[param]` eating a literal segment is the PF-19 shape. Conflating the two would
 * make the gate permanently red on correct code, and the only way back to green
 * would be to break the BFF proxy.
 *
 * DIVISION OF LABOUR
 * ------------------
 *   • `scripts/link-integrity-check.js` — extracts literal internal link targets
 *     from `apps/web/src`, resolves them against the **emitted**
 *     `apps/web/.next/app-path-routes-manifest.json` (PF-82: read the artefact,
 *     never the `app/` directory tree), reconciles against the reviewed
 *     `scripts/link-integrity-baseline.json`. Its exit code is the gate.
 *   • this file — drives the gate's pure exports with synthetic inventories in
 *     BOTH directions, so every assertion here can actually fail; and proves the
 *     stage is still wired into `ci-gate.sh` and `ci.yml`.
 *
 * THE MODULE CONTRACT THIS SPEC PINS
 * ----------------------------------
 * `scripts/link-integrity-check.js` must guard its CLI with
 * `if (require.main === module) main();` and export its pure core — the idiom of
 * `restore-drill.js:1497`, `compose-invocation-check.js:578` and
 * `runtime-engines-check.js:402`. Requiring the module must have no side effect.
 *
 *     classifyTarget(target: string, routes: string[]): Verdict
 *     extractLiteralLinks(): Array<{ target: string; file: string; line: number }>
 *     classifyAll({ targets, routes, baseline }): { problems: string[]; stats: {...} }
 *
 * `classifyAll` returns `{ problems, stats }` — the shape
 * `evaluateComposeInvocation` already established, so the gate can be driven
 * without any `--inventory`, `--force` or `--allow-dead` flag existing (FR-12 /
 * DNC-10). A CLI flag that lets a caller choose the inventory is a bypass flag
 * wearing a different hat, which is why the wiring assertions below also require
 * both CI call sites to invoke the script with **zero arguments**.
 *
 * WHY THE ROUTE UNIVERSE HERE COMES FROM THE REVIEWED BASELINE, NOT `.next/`
 * -------------------------------------------------------------------------
 * `web-artifact-gate.spec.ts` states the rule: *"a jest suite that read `.next/`
 * would pass or fail depending on whether someone had built recently, which is a
 * flaky gate rather than a gate."* It is worse than stylistic here —
 * `.github/workflows/ci.yml`'s `test` job has no `pnpm build` step at all, and
 * `scripts/ci-gate.sh` runs `test:api` (stage 6) **before** `build` (stage 7). A
 * spec that demanded a fresh manifest would be red on a defect-free tree for
 * reasons that have nothing to do with this slice.
 *
 * So the deterministic assertions below use `scripts/web-route-baseline.json` —
 * the *reviewed* record of the emitted inventory, committed, present in every job.
 * The one test that touches the real `.next/` asserts an **agreement** (the CLI's
 * exit code equals the classifier's verdict over the same manifest), which is
 * stable whether or not `/admin/classes/new` has been built yet, and it skips
 * loudly rather than silently when there is no build to read.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'link-integrity-check.js');
const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'link-integrity-baseline.json');
const WEB_ROUTE_BASELINE_PATH = join(REPO_ROOT, 'scripts', 'web-route-baseline.json');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'ci-gate.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const MANIFEST_PATH = join(REPO_ROOT, 'apps', 'web', '.next', 'app-path-routes-manifest.json');
const NEW_PAGE_PATH = join(REPO_ROOT, 'apps', 'web', 'src', 'app', 'admin', 'classes', 'new', 'page.tsx');

const SCRIPT_REF = 'scripts/link-integrity-check.js';

/* ------------------------------------------------------------------ *
 * The gate's pure core
 * ------------------------------------------------------------------ */

type Verdict = 'exact' | 'catch-all' | 'dynamic-capture' | 'dead';

interface LinkTarget {
  target: string;
  file: string;
  line: number;
}

interface BaselineEntry {
  target: string;
  finding?: string;
  reason?: string;
  class?: string;
}

interface Evaluation {
  problems: string[];
  stats: {
    filesScanned?: number;
    targets?: number;
    alive?: number;
    dead?: number;
    captures?: number;
    baselined?: number;
  };
}

interface LinkIntegrityModule {
  classifyTarget: (target: string, routes: string[]) => Verdict;
  extractLiteralLinks: () => LinkTarget[];
  classifyAll: (input: {
    targets: LinkTarget[];
    routes: string[];
    baseline: BaselineEntry[];
  }) => Evaluation;
}

/* eslint-disable @typescript-eslint/no-require-imports */
// Deliberately unguarded. If the gate script is absent or does not export its
// core, this suite must go red at load: a guard spec that degrades to "nothing to
// check" when its gate disappears is the exact failure the gate exists to stop.
const gate: LinkIntegrityModule = require(SCRIPT_PATH);
/* eslint-enable @typescript-eslint/no-require-imports */

const { classifyTarget, classifyAll, extractLiteralLinks } = gate;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Executable content of a `#`-commented file, byte offsets preserved.
 *
 * Copied verbatim from `csp-gate.spec.ts:48-53`. PF-83: an `indexOf` assertion
 * over the raw text of a workflow was turned red by a comment that merely *named*
 * the script. Blanking comments while preserving length means neither a sentence
 * of prose nor a commented-out line can satisfy — or break — the check, and the
 * offsets used by the ordering assertions stay meaningful.
 */
function executableContent(source: string): string {
  return source
    .split('\n')
    .map((line) => (line.trim().startsWith('#') ? ' '.repeat(line.length) : line))
    .join('\n');
}

/** Blank `//` and block comments in a JS source, length preserved. */
function executableJs(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The baseline is keyed on the TARGET and nothing else.
 *
 * Never on `file:line` — `sidebar-items.ts` and `TopbarUserMenu.tsx` are edited
 * constantly, and a line-keyed ceiling turns red on every unrelated edit above a
 * link. `production-artefact-baseline.json` keys on file + count for the same
 * reason. Both the record form (`known-test-failures.json`) and the array form
 * are accepted here so the reviewed file can pick either; every entry is held to
 * the same requirements either way.
 */
function normalizeBaseline(raw: unknown): BaselineEntry[] {
  const root = (raw ?? {}) as Record<string, unknown>;
  const container = root['dead'] ?? root['entries'] ?? root['targets'];
  if (Array.isArray(container)) {
    return container.map((e) => ({ ...(e as BaselineEntry) }));
  }
  if (container && typeof container === 'object') {
    return Object.entries(container as Record<string, unknown>).map(([target, value]) => ({
      target,
      ...((value ?? {}) as Omit<BaselineEntry, 'target'>),
    }));
  }
  return [];
}

function link(target: string, file = 'apps/web/src/app/fixture/page.tsx', line = 1): LinkTarget {
  return { target, file, line };
}

/** Run a body of JS in a child process with a chosen environment. */
function runInChild(body: string, env: NodeJS.ProcessEnv): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, ['-e', body], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status, stderr: result.stderr ?? '' };
}

/* ------------------------------------------------------------------ *
 * Fixtures — the route universe
 * ------------------------------------------------------------------ */

const webRouteBaseline = readJson(WEB_ROUTE_BASELINE_PATH) as {
  apps: Record<string, { routes: string[]; mustBeDynamic: string[] } | undefined>;
};
const REVIEWED_ROUTES: string[] = webRouteBaseline.apps['apps/web']?.routes ?? [];

/** The pre-slice inventory: whatever is reviewed today, minus the route being added. */
const ROUTES_BEFORE = REVIEWED_ROUTES.filter((r) => r !== '/admin/classes/new');
/** The post-slice inventory. */
const ROUTES_AFTER = [...ROUTES_BEFORE, '/admin/classes/new'].sort();

const baselineRaw = existsSync(BASELINE_PATH) ? readJson(BASELINE_PATH) : null;
const BASELINE = normalizeBaseline(baselineRaw);
const BASELINED_TARGETS = BASELINE.map((e) => e.target);

/** The nine auth paths exempted by `middleware.ts` for routes that do not exist (PF-91). */
const PHANTOM_AUTH_ROUTES = [
  '/admin/forgot-password',
  '/admin/reset-password',
  '/admin/accept-invite',
  '/teacher/forgot-password',
  '/teacher/reset-password',
  '/teacher/accept-invite',
  '/parent/forgot-password',
  '/parent/reset-password',
  '/parent/verify-email',
];

/** Every dead target measured for this slice, with the finding that owns the fix. */
const MEASURED_DEAD: Array<[string, string]> = [
  ['/admin/reports', 'PF-14'],
  ['/help', 'PF-39'],
  ['/legal/privacy', 'PF-38'],
  ['/legal/terms', 'PF-38'],
  ['/legal/cookies', 'PF-38'],
  ['/parent/remediation', 'PF-92'],
  ...PHANTOM_AUTH_ROUTES.map((r): [string, string] => [r, 'PF-91']),
];

/**
 * Hand-listed live routes, one block per portal (G-PORTAL).
 *
 * PF-84's trap: a classifier that returned "no match" for everything satisfies
 * every negative assertion in this file. These are the positive direction, and
 * they span all four portals so the inventory is shown to cover the product
 * rather than one corner of it.
 */
const ALIVE_SAMPLES: Record<string, string[]> = {
  admin: ['/admin/dashboard', '/admin/classes', '/admin/students/new', '/admin/roles/new', '/admin/audit'],
  teacher: ['/teacher/dashboard', '/teacher/classes', '/teacher/reports', '/teacher/conversations'],
  parent: ['/parent/dashboard', '/parent/grades', '/parent/recommendations', '/parent/messages/new'],
  student: ['/student/dashboard', '/student/grades', '/student/attendance'],
};

/* ================================================================== *
 * 1. The classifier — four verdicts, and none of them vacuous
 * ================================================================== */

describe('classifyTarget — the four verdicts', () => {
  it('the route universe it is driven with is not empty', () => {
    // Guards the guard. A broken REPO_ROOT or a renamed baseline would make every
    // assertion below pass vacuously over an empty list — the bug that made the
    // first draft of lint-ratchet.spec.ts report zero packages.
    expect(REVIEWED_ROUTES.length).toBeGreaterThanOrEqual(100);
    expect(ROUTES_BEFORE).not.toContain('/admin/classes/new');
    expect(ROUTES_AFTER).toContain('/admin/classes/new');
  });

  it.each(Object.entries(ALIVE_SAMPLES))(
    'resolves the %s portal’s real routes as exact (PF-84 — the positive direction)',
    (_portal, samples) => {
      for (const target of samples) {
        expect(REVIEWED_ROUTES).toContain(target);
        expect(classifyTarget(target, REVIEWED_ROUTES)).toBe('exact');
      }
    },
  );

  it('PRE-FIX: /admin/classes/new is a DYNAMIC CAPTURE, not a dead link and not alive', () => {
    // The whole point of the slice. `/admin/classes/[id]` is in the inventory, so
    // a route-existence check answers "resolves, fine" — and the admin lands on
    // the class-detail page for a class whose id is the string "new".
    expect(ROUTES_BEFORE).toContain('/admin/classes/[id]');
    expect(classifyTarget('/admin/classes/new', ROUTES_BEFORE)).toBe('dynamic-capture');
  });

  it('POST-FIX: the same target is exact once the route is emitted', () => {
    // And the branch is live, so the assertion above is about something.
    expect(classifyTarget('/admin/classes/new', ROUTES_AFTER)).toBe('exact');
  });

  it('a catch-all consuming literal segments is ALIVE, never a capture (P0-C1)', () => {
    // `/api/proxy/[...path]` exists to swallow literal segments; that is its
    // entire function. Classifying it as a capture would make the gate red on
    // correct code — `TopbarBell.tsx` fetches through it — and the only route
    // back to green would be breaking the BFF proxy.
    expect(REVIEWED_ROUTES).toContain('/api/proxy/[...path]');
    expect(classifyTarget('/api/proxy/v1/notifications/unread-count', REVIEWED_ROUTES)).toBe('catch-all');
    expect(classifyTarget('/api/auth/session', REVIEWED_ROUTES)).toBe('catch-all');
  });

  it('a catch-all is greedy — it matches any depth ≥ 1', () => {
    expect(classifyTarget('/api/proxy/a/b/c/d/e', REVIEWED_ROUTES)).toBe('catch-all');
  });

  it('an optional catch-all matches zero segments, a required one does not', () => {
    // `[[...slug]]` ≥ 0, `[...slug]` ≥ 1. A segment-count equality test gets both
    // of these wrong, and the mistake is invisible on a healthy repository.
    expect(classifyTarget('/docs', ['/docs/[[...slug]]'])).toBe('catch-all');
    expect(classifyTarget('/docs', ['/docs/[...slug]'])).toBe('dead');
    expect(classifyTarget('/docs/a/b', ['/docs/[...slug]'])).toBe('catch-all');
  });

  it('a [param] consumes EXACTLY one segment', () => {
    // If `[id]` were allowed to eat two, `/admin/classes/a/b` would report as a
    // capture instead of dead and the depth semantics would be wrong everywhere.
    expect(classifyTarget('/admin/classes/a/b', ROUTES_BEFORE)).toBe('dead');
    expect(classifyTarget('/admin/classes/abc', ROUTES_BEFORE)).toBe('dynamic-capture');
  });

  it.each(MEASURED_DEAD)('%s matches no route at all', (target) => {
    expect(classifyTarget(target, REVIEWED_ROUTES)).toBe('dead');
  });

  it('is not a constant function in either direction', () => {
    // Belt and braces against the two degenerate classifiers: one that answers
    // "dead" for everything (satisfies every negative assertion) and one that
    // answers "exact" for everything (satisfies every positive one).
    const verdicts = new Set([
      classifyTarget('/admin/dashboard', REVIEWED_ROUTES),
      classifyTarget('/admin/classes/new', ROUTES_BEFORE),
      classifyTarget('/api/proxy/x/y', REVIEWED_ROUTES),
      classifyTarget('/nowhere/at/all', REVIEWED_ROUTES),
    ]);
    expect(verdicts).toEqual(new Set(['exact', 'dynamic-capture', 'catch-all', 'dead']));
  });

  it('normalises query and hash before matching, and never treats /_not-found as a target', () => {
    expect(classifyTarget('/admin/classes?year=2025', REVIEWED_ROUTES)).toBe('exact');
    expect(classifyTarget('/admin/classes#list', REVIEWED_ROUTES)).toBe('exact');
    expect(classifyTarget('/admin/classes/', REVIEWED_ROUTES)).toBe('exact');
    expect(classifyTarget('/', REVIEWED_ROUTES)).toBe('exact');
  });
});

/* ================================================================== *
 * 2. The extractor — over the real repository, and not vacuous either
 * ================================================================== */

describe('extractLiteralLinks — measured over apps/web/src', () => {
  const extracted = extractLiteralLinks();
  const targets = [...new Set(extracted.map((e) => e.target))];
  const files = new Set(extracted.map((e) => e.file));

  it('scans a real inventory, not an empty one (P1-C8)', () => {
    // The cheapest way for this gate to be worthless is a bad walk root, a `.tsx`
    // filter typo or a Windows separator slip: the extractor finds nothing, finds
    // no dead links, and reports PASS forever. Every negative assertion in this
    // file is satisfied by an empty inventory, so the floor is the assertion that
    // makes the rest mean anything. Measured 2026-08-07: 353 source files,
    // ~102 distinct literal internal targets.
    expect(targets.length).toBeGreaterThanOrEqual(80);
    expect(files.size).toBeGreaterThanOrEqual(20);
  });

  it.each([
    '/admin/dashboard',
    '/parent/dashboard',
    '/teacher/reports',
    '/student/grades',
    '/admin/classes/new',
  ])('finds the named canary %s', (canary) => {
    expect(targets).toContain(canary);
  });

  it('covers all four portals', () => {
    for (const portal of ['admin', 'teacher', 'parent', 'student']) {
      expect(targets.filter((t) => t.startsWith(`/${portal}/`)).length).toBeGreaterThan(0);
    }
  });

  it('emits only fully-literal internal targets', () => {
    for (const t of targets) {
      expect(t.startsWith('/')).toBe(true);
      expect(t.startsWith('//')).toBe(false);
      expect(t).not.toContain('${');
      expect(t).not.toContain('`');
      expect(t).not.toMatch(/^\/api\/v1\//); // the backend, not a web route
    }
  });

  it('reports positions with forward slashes and no stray carriage return (P2-C14)', () => {
    // A line-anchored capture on a CRLF checkout silently appends `\r` to the
    // target, which turns every single link dead. On Windows that is not a
    // hypothetical: this repository is developed on one.
    for (const entry of extracted.slice(0, 200)) {
      expect(entry.file).not.toContain('\\');
      expect(entry.target).not.toContain('\r');
      expect(entry.line).toBeGreaterThan(0);
    }
  });

  it('at least 80 of the extracted targets resolve ALIVE against the reviewed inventory', () => {
    // The other half of PF-84: a matcher that resolves nothing would still pass
    // every "this is dead" assertion above.
    const alive = targets.filter((t) => {
      const v = classifyTarget(t, ROUTES_AFTER);
      return v === 'exact' || v === 'catch-all';
    });
    expect(alive.length).toBeGreaterThanOrEqual(80);
  });
});

/* ================================================================== *
 * 3. Ratchet discipline — the ceiling only comes down
 * ================================================================== */

describe('classifyAll — the gate fails in every direction it claims to', () => {
  const cleanTargets = Object.values(ALIVE_SAMPLES)
    .flat()
    .map((t) => link(t));

  it('passes on a tree whose every target resolves', () => {
    // The control. Without it, a `classifyAll` that always returned a problem
    // would satisfy every failure case below.
    const result = classifyAll({ targets: cleanTargets, routes: ROUTES_AFTER, baseline: [] });
    expect(result.problems).toEqual([]);
  });

  it('fails on a NEW dead target', () => {
    const result = classifyAll({
      targets: [...cleanTargets, link('/admin/definitely-not-a-route')],
      routes: ROUTES_AFTER,
      baseline: [],
    });
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.problems.join('\n')).toContain('/admin/definitely-not-a-route');
  });

  it('accepts a dead target that is baselined with a reason and an owning finding', () => {
    const result = classifyAll({
      targets: [...cleanTargets, link('/admin/reports')],
      routes: ROUTES_AFTER,
      baseline: [{ target: '/admin/reports', finding: 'PF-14', reason: 'admin reports surface, V3-E04' }],
    });
    expect(result.problems).toEqual([]);
  });

  it('fails a baseline entry that is missing its reason', () => {
    const result = classifyAll({
      targets: [...cleanTargets, link('/admin/reports')],
      routes: ROUTES_AFTER,
      baseline: [{ target: '/admin/reports', finding: 'PF-14' }],
    });
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('fails a baseline entry that is missing its owning finding', () => {
    const result = classifyAll({
      targets: [...cleanTargets, link('/admin/reports')],
      routes: ROUTES_AFTER,
      baseline: [{ target: '/admin/reports', reason: 'known dead' }],
    });
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('fails a baselined entry that is now ALIVE — the ceiling only comes down', () => {
    // `lint-ratchet.js`'s rubber-band rule. Without it the baseline is an amnesty
    // rather than an inventory, and S-E06-4 could ship `/legal/*` while the gate
    // kept tolerating the entry that says they are broken.
    const result = classifyAll({
      targets: cleanTargets,
      routes: ROUTES_AFTER,
      baseline: [{ target: '/admin/dashboard', finding: 'PF-39', reason: 'stale' }],
    });
    expect(result.problems.length).toBeGreaterThan(0);
    const text = result.problems.join('\n');
    expect(text).toContain('/admin/dashboard');
    // The message has to be actionable, or the pull request that legitimately
    // fixes the link reads as a regression to whoever sees it fail.
    expect(text).toContain('link-integrity-baseline.json');
  });

  it('fails a baselined entry that is no longer referenced anywhere', () => {
    // Same rule, second shape: a ceiling nobody is standing under is stale, and a
    // stale ceiling silently re-authorises the target the day someone links it again.
    const result = classifyAll({
      targets: cleanTargets,
      routes: ROUTES_AFTER,
      baseline: [{ target: '/help', finding: 'PF-39', reason: 'help centre not built' }],
    });
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.problems.join('\n')).toContain('/help');
  });

  it('fails a DYNAMIC CAPTURE unconditionally — it is not baselineable', () => {
    const result = classifyAll({
      targets: [...cleanTargets, link('/admin/classes/new', 'apps/web/src/app/admin/classes/page.tsx', 155)],
      routes: ROUTES_BEFORE,
      baseline: [{ target: '/admin/classes/new', finding: 'PF-19', reason: 'trying to buy it off' }],
    });
    expect(result.problems.length).toBeGreaterThan(0);
    const text = result.problems.join('\n');
    expect(text).toContain('/admin/classes/new');
    // The message must name the swallowing template, or the next engineer
    // "fixes" it by adding a baseline entry — which this rule forbids.
    expect(text).toContain('/admin/classes/[id]');
  });

  it('classifies BEFORE it reconciles — a capture is never reported as “now alive”', () => {
    // Precedence seam. A target that was baselined as dead and has since become a
    // capture must fail as a capture; reporting "now alive, remove the entry"
    // would tell the reader to delete the only record of a live defect.
    const result = classifyAll({
      targets: [...cleanTargets, link('/admin/classes/new')],
      routes: ROUTES_BEFORE,
      baseline: [{ target: '/admin/classes/new', finding: 'PF-19', reason: 'was dead' }],
    });
    const text = result.problems.join('\n');
    expect(text).toMatch(/capture/i);
  });
});

/* ================================================================== *
 * 4. The reviewed baseline
 * ================================================================== */

describe('scripts/link-integrity-baseline.json', () => {
  it('exists and is not empty', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    expect(BASELINE.length).toBeGreaterThan(0);
  });

  it('carries a reason AND an owning finding on every entry (AC-6)', () => {
    for (const entry of BASELINE) {
      expect(typeof entry.target).toBe('string');
      expect((entry.reason ?? '').trim().length).toBeGreaterThan(0);
      expect(entry.finding ?? '').toMatch(/^(PF|R|VAL|D)-\d+$/);
    }
  });

  it.each(MEASURED_DEAD)('holds %s under %s', (target, finding) => {
    const entry = BASELINE.find((e) => e.target === target);
    expect(entry).toBeDefined();
    expect(entry?.finding).toBe(finding);
  });

  it('baselines /legal/* rather than fixing it — S-E06-4 owns it, blocked on D-08', () => {
    // R-13: the routine may ship holding pages, never author policy text. A
    // "coming soon" page here would clear the entry and would be worse than the
    // entry (DNC-09, open-decisions.md:116).
    for (const legal of ['/legal/privacy', '/legal/terms', '/legal/cookies']) {
      expect(BASELINED_TARGETS).toContain(legal);
      expect(existsSync(join(REPO_ROOT, 'apps', 'web', 'src', 'app', legal.slice(1), 'page.tsx'))).toBe(false);
    }
  });

  it('does NOT baseline /admin/classes/new — it is fixed, not tolerated', () => {
    expect(BASELINED_TARGETS).not.toContain('/admin/classes/new');
  });

  it('contains no entry that is actually a dynamic capture', () => {
    // The rule stated as a property of the committed artefact rather than of the
    // code path: whatever `--update` did or did not do, a capture cannot be
    // sitting in the reviewed ceiling.
    for (const target of BASELINED_TARGETS) {
      expect(classifyTarget(target, ROUTES_AFTER)).toBe('dead');
    }
  });

  it('names PF-91 and PF-92, the two findings this slice records but does not fix', () => {
    const findings = new Set(BASELINE.map((e) => e.finding));
    expect(findings).toContain('PF-91'); // 9 phantom auth routes exempted by middleware.ts
    expect(findings).toContain('PF-92'); // /parent/remediation has no index
  });
});

/* ================================================================== *
 * 5. Wiring — both harnesses, same script, right place
 * ================================================================== */

describe('the stage is wired into both harnesses and cannot drift', () => {
  const gateSource = readFileSync(GATE_PATH, 'utf8');
  const workflowSource = readFileSync(WORKFLOW_PATH, 'utf8');

  it.each([
    ['scripts/ci-gate.sh', GATE_PATH],
    ['.github/workflows/ci.yml', WORKFLOW_PATH],
  ])('%s runs the link integrity check', (_label, path) => {
    expect(existsSync(path)).toBe(true);
    expect(executableContent(readFileSync(path, 'utf8'))).toContain(SCRIPT_REF);
  });

  it('does not accept a commented-out invocation as wiring (PF-83)', () => {
    const commented = [`# run_stage "links" node ${SCRIPT_REF}`, 'echo hello'].join('\n');
    expect(executableContent(commented)).not.toContain(SCRIPT_REF);
    expect(executableContent(`node ${SCRIPT_REF}`)).toContain(SCRIPT_REF);
  });

  it('preserves byte offsets when blanking comments', () => {
    const source = '# a comment\nreal line\n';
    expect(executableContent(source)).toHaveLength(source.length);
  });

  it('ci-gate.sh runs it AFTER the build, inside the --quick guard', () => {
    // Ordering is correctness, not style: the script reads the emitted manifest,
    // so running it before the build reads a stale artefact (reporting
    // /admin/classes/new as a capture after it was fixed) or a missing one.
    const executable = executableContent(gateSource);
    const buildAt = executable.indexOf('run_stage "build"');
    const linkAt = executable.indexOf(SCRIPT_REF);
    expect(buildAt).toBeGreaterThan(-1);
    expect(linkAt).toBeGreaterThan(buildAt);

    // …and it is skipped by --quick like every other post-build stage, rather
    // than failing a quick run on an absent .next/.
    const guardAt = executable.lastIndexOf('if [ "${QUICK}" -eq 0 ]', linkAt);
    expect(guardAt).toBeGreaterThan(buildAt);
  });

  it('ci.yml runs it in the build job, after pnpm build, with no continue-on-error', () => {
    // Job-blindness is the trap: an assertion that only says "the string appears"
    // is satisfied by a step wired into the lint job, where there is no .next/ and
    // the step errors every run — which is then "fixed" with continue-on-error.
    const executable = executableContent(workflowSource);
    const buildAt = executable.indexOf('pnpm build');
    const linkAt = executable.indexOf(SCRIPT_REF);
    expect(buildAt).toBeGreaterThan(-1);
    expect(linkAt).toBeGreaterThan(buildAt);

    const testJobAt = executable.indexOf('node scripts/test-ratchet.js api');
    expect(testJobAt).toBeGreaterThan(-1);
    expect(linkAt).toBeLessThan(testJobAt);

    const window = executable.slice(linkAt, linkAt + 200);
    expect(window).not.toContain('continue-on-error');
  });

  it('both call sites invoke the script with ZERO arguments', () => {
    // `--update` or an `--inventory` seam in CI is a bypass flag wearing a
    // different hat (DNC-10): either one lets the gate be pointed at something
    // that always passes.
    for (const source of [gateSource, workflowSource]) {
      const executable = executableContent(source);
      const invocations = executable.match(new RegExp(`${SCRIPT_REF.replace(/[/.]/g, '\\$&')}[^\\n]*`, 'g')) ?? [];
      expect(invocations.length).toBeGreaterThan(0);
      for (const invocation of invocations) {
        expect(invocation.slice(SCRIPT_REF.length).trim()).toBe('');
      }
    }
  });

  it('both files carry the anti-drift note the eight sibling stages carry', () => {
    // Read on RAW text on purpose — this one is a comment, and it is the thing
    // that tells the next author the two files are a pair (S-E02-2 AC-4).
    for (const source of [gateSource, workflowSource]) {
      const linkAt = source.indexOf(SCRIPT_REF);
      expect(linkAt).toBeGreaterThan(-1);
      expect(source.slice(Math.max(0, linkAt - 1400), linkAt)).toContain('must not drift (S-E02-2 AC-4)');
    }
  });
});

/* ================================================================== *
 * 6. No bypass — proven by executing it, not by reading it (DNC-10)
 * ================================================================== */

describe('DNC-10 — there is no way to turn this gate off', () => {
  const source = readFileSync(SCRIPT_PATH, 'utf8');
  const executable = executableJs(source);

  it.each([
    'SKIP_LINK_CHECK',
    'ALLOW_DEAD_LINKS',
    'LINK_CHECK_SKIP',
    'BYPASS',
    '--force',
    '--allow-dead',
    '--inventory',
  ])('the script does not know the flag %s', (flag) => {
    expect(executable).not.toContain(flag);
  });

  it('reads no environment variable at all', () => {
    expect(executable).not.toContain('process.env');
  });

  it('knows exactly one write flag, --update, and no other verb', () => {
    const flags = [...new Set(executable.match(/'--[a-z-]+'|"--[a-z-]+"/g) ?? [])].map((f) =>
      f.slice(1, -1),
    );
    expect(flags).toContain('--update');
    // `--help` is the only other flag a reviewer should ever find here. Anything
    // else is a second way to influence the verdict, which is the thing DNC-10
    // forbids whatever it is called.
    expect(flags.filter((f) => f !== '--update' && f !== '--help')).toEqual([]);
  });

  it('refuses to write the baseline from a structurally broken artefact', () => {
    // The rule boot-check.js learned the hard way: its first `--update` silently
    // dropped an application that had failed to boot, and would then have passed
    // forever with that application unrepresented.
    expect(source).toMatch(/refusing to write the baseline/);
    expect(source).toMatch(/app-path-routes-manifest\.json/);
  });

  it('EXECUTES to the same verdict with every plausible escape variable set', () => {
    // Asserted by running it, not by reading it. A `process.env` scan proves the
    // string is absent from the file; it proves nothing about a dependency, a
    // default parameter, or a value read some other way.
    const body = [
      `const { classifyAll } = require(${JSON.stringify(SCRIPT_PATH)});`,
      `const routes = ${JSON.stringify(ROUTES_AFTER)};`,
      `const targets = [{ target: '/admin/definitely-not-a-route', file: 'x.tsx', line: 1 }];`,
      `const r = classifyAll({ targets, routes, baseline: [] });`,
      `process.exit(r.problems.length > 0 ? 1 : 0);`,
    ].join('\n');

    // The control: it really does fail on a clean environment.
    expect(runInChild(body, {}).status).toBe(1);

    for (const escape of [
      { NODE_ENV: 'production' },
      { SKIP_LINK_CHECK: '1' },
      { ALLOW_DEAD_LINKS: '1' },
      { LINK_CHECK: '0' },
      { CI: 'false' },
      { NODE_ENV: 'production', SKIP_LINK_CHECK: '1', ALLOW_DEAD_LINKS: '1', CI: 'false' },
    ]) {
      expect(runInChild(body, escape).status).toBe(1);
    }
  });

  it('EXECUTES the pre-slice inventory to a non-zero exit (FR-15)', () => {
    // The pre-fix state, driven end to end through the same entry point the CLI
    // uses, in a child process — so the proof is an exit code and not a return
    // value this suite chose how to interpret.
    const body = [
      `const { classifyAll } = require(${JSON.stringify(SCRIPT_PATH)});`,
      `const routes = ${JSON.stringify(ROUTES_BEFORE)};`,
      `const targets = [{ target: '/admin/classes/new', file: 'apps/web/src/app/admin/classes/page.tsx', line: 155 }];`,
      `const r = classifyAll({ targets, routes, baseline: [] });`,
      `process.exit(r.problems.length > 0 ? 1 : 0);`,
    ].join('\n');
    expect(runInChild(body, {}).status).toBe(1);
  });

  it('requiring the module has no side effect — main() is guarded', () => {
    expect(executable).toMatch(/require\.main\s*===\s*module/);
    // A bare `main()` at module scope is what `web-artifact-check.js:381` does;
    // copying it here would make `require()`ing the gate run the gate.
    expect(executable).not.toMatch(/^\s*main\(\);\s*$/m);
  });
});

/* ================================================================== *
 * 7. The PF-19 fix itself, and the gates it perturbs
 * ================================================================== */

describe('the /admin/classes/new fix', () => {
  it('the page exists as a real create surface', () => {
    expect(existsSync(NEW_PAGE_PATH)).toBe(true);
    const page = readFileSync(NEW_PAGE_PATH, 'utf8');
    // `force-dynamic` is not optional: S-E06-2 brought prerendered documents to
    // 2/2 and `csp-check.js` now refuses any prerendered page carrying a
    // <script>. A new admin page without it turns stage 12 red.
    expect(page).toMatch(/export const dynamic = 'force-dynamic'/);
    expect(page).toContain('PortalShell');
    // DNC-09: a dead end must name the real prerequisite, never be gated behind
    // holding copy. Read on comment-stripped content — PF-83's lesson applies to
    // this assertion as much as to the workflow ones: the page's own header
    // explains *why* it does not say "bientôt disponible", and a raw-text check
    // would be turned red by the explanation.
    expect(executableJs(page)).not.toMatch(/bient[oô]t disponible|coming soon/i);
  });

  it('the reviewed route inventory records the new route (P1-C5)', () => {
    // `web-artifact-check.js` fails on any emitted route absent from
    // `scripts/web-route-baseline.json` ("route(s) are emitted but absent from
    // the baseline"). Shipping the page without the inventory line turns stage 8
    // red on a defect-free tree, which then gets misdiagnosed.
    expect(REVIEWED_ROUTES).toContain('/admin/classes/new');
  });

  it('adds no unauthenticated surface (AC-9 — verified, not assumed)', () => {
    const middleware = readFileSync(join(REPO_ROOT, 'apps', 'web', 'src', 'middleware.ts'), 'utf8');

    const publicPrefixes = /const PUBLIC_PREFIXES = \[([^\]]*)\]/.exec(middleware)?.[1] ?? '';
    // Proves the capture found the right array before the negative below means
    // anything — a regex that matched nothing would "pass" this test forever.
    expect(publicPrefixes).toContain("'/legal'");
    expect(publicPrefixes).not.toContain('/admin/classes');

    // …and it is not in the admin auth allowlist either, so it falls into the
    // protected branch by prefix. Anchored on AUTH_ROUTES_BY_PORTAL: a bare
    // /admin: \[…\]/ matches PORTAL_REQUIRED_ROLES first, which is a different
    // array that would satisfy the assertion for the wrong reason.
    const authBlock = middleware.slice(middleware.indexOf('const AUTH_ROUTES_BY_PORTAL'));
    expect(authBlock).not.toBe('');
    const adminAuth = /admin: \[([^\]]*)\]/.exec(authBlock)?.[1] ?? '';
    expect(adminAuth).toContain("'/admin/login'");
    expect(adminAuth).not.toContain('/admin/classes/new');
  });

  it('the two entry points are unchanged — the route was the defect, not the links', () => {
    const list = readFileSync(
      join(REPO_ROOT, 'apps', 'web', 'src', 'app', 'admin', 'classes', 'page.tsx'),
      'utf8',
    );
    const occurrences = list.split('/admin/classes/new').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

/* ================================================================== *
 * 8. One agreement against the real build — guarded, never silent
 * ================================================================== */

const hasBuild = existsSync(MANIFEST_PATH);
const describeWithBuild = hasBuild ? describe : describe.skip;

if (!hasBuild) {
  // Loud, not silent. `ci.yml`'s test job has no build step and `ci-gate.sh` runs
  // test:api before build, so this is the ordinary case rather than a defect —
  // but a reader must be able to see that it did not run.
  //
  // No `eslint-disable` directive here, on purpose: `apps/api/eslint.config.js`
  // sets `no-console: 'off'`, so the directive would itself be an unused-directive
  // warning. That is not hypothetical — it is how the lint ratchet caught this
  // file (apps/api measured 10 against a ceiling of 9), which is the ratchet
  // doing exactly what S-E02-8 built it for.
  console.warn(
    `[link-integrity-gate] apps/web/.next/app-path-routes-manifest.json is absent — the ` +
      `end-to-end CLI agreement case is skipped. Every other case in this file is ` +
      `deterministic and ran. The gate itself is stage 13 of ci-gate.sh, after the build.`,
  );
}

describeWithBuild('the CLI verdict is the classifier verdict — no gap between them', () => {
  it('exits 1 if and only if the classifier reports a problem', () => {
    // Deliberately not "exits 0": before the orchestrator's build the emitted
    // manifest still lacks /admin/classes/new, so the honest run is non-zero;
    // after it, zero. Asserting either constant would be wrong half the time.
    // The invariant that holds in both states is that the exit code is not
    // decided anywhere other than the classifier.
    const manifest = readJson(MANIFEST_PATH) as Record<string, string>;
    const routes = Object.values(manifest);
    expect(routes.length).toBeGreaterThanOrEqual(100);

    const evaluation = classifyAll({
      targets: extractLiteralLinks(),
      routes,
      baseline: BASELINE,
    });
    const cli = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(cli.status).toBe(evaluation.problems.length > 0 ? 1 : 0);

    const output = `${cli.stdout ?? ''}${cli.stderr ?? ''}`;
    expect(output).toMatch(/LINK INTEGRITY CHECK: (PASS|FAIL)/);
  });
});
