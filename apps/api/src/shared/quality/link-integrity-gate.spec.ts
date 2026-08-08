import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
 * WHAT S-E06-5 ADDED, AND THE HOLE IT CLOSED (PF-97)
 * --------------------------------------------------
 * `LITERAL_LINK` excluded the backtick, so every template-literal href in
 * `apps/web` was invisible to this gate — 391 single-line strings and 2 spanning
 * lines. Among them was the application shell's own account menu, which wrote
 * `` `/${portal}/profile` ``. No per-portal profile route was ever emitted, so
 * « Mon profil » 404'd on every authenticated page of three portals while the gate
 * printed `LINK INTEGRITY CHECK: PASS`. A gate that is blind where the shell lives
 * is worse than no gate: it certifies the defect.
 *
 * A template-literal href is now resolved over the DECLARED union of its
 * interpolated variable, or REPORTED — never dropped, because a silent drop is how
 * the hole was made. Three outcomes, and the arithmetic between them is asserted:
 *
 *     expanded   whole-segment interpolations whose variables have a declared
 *                union in the same file → the cross-product, each expansion
 *                classified by the SAME four verdicts as a quoted literal
 *     shape      anything else → a pattern (`/x/*`) checked for "a route of this
 *                shape and depth exists", listed in the run output, and FAILING
 *                unless baselined under `deadShapes`
 *     unparsed   a `/`-leading template that cannot be parsed → structural failure
 *
 * The union is READ, never guessed at "the four portals": `apps/web/src` declares
 * `Portal`-ish unions with three different arities, and a name-keyed guess would
 * manufacture findings correct code cannot produce (R-30, the false-red lesson).
 * Two candidate unions in one file is unresolvable, reported as a shape.
 *
 * THE MODULE CONTRACT THIS SPEC PINS
 * ----------------------------------
 * `scripts/link-integrity-check.js` must guard its CLI with
 * `if (require.main === module) main();` and export its pure core — the idiom of
 * `restore-drill.js:1497`, `compose-invocation-check.js:578` and
 * `runtime-engines-check.js:402`. Requiring the module must have no side effect.
 *
 *     classifyTarget(target: string, routes: string[]): Verdict
 *     classifyPattern(pattern: string, routes: string[]): ShapeVerdict
 *     stripCommentsPreservingLines(source: string): string
 *     resolveDeclaredUnion(name: string, source: string): string[] | null
 *     expandTemplateTarget(raw: string, source: string): ExpansionResult
 *     extractLiteralLinks(): Array<{ target: string; file: string; line: number }>
 *     extractTemplateLinks(): Array<TemplateRow>
 *     classifyAll({ targets, routes, baseline, templates?, deadShapes? })
 *         → { problems: string[]; stats: {...}; patterns: [...] }
 *
 * `templates` and `deadShapes` are OPTIONAL so every pre-S-E06-5 call site — every
 * case in section 3 below — still exercises exactly the behaviour it used to.
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
type ShapeVerdict = 'shape-alive' | 'shape-dead';

interface LinkTarget {
  target: string;
  file: string;
  line: number;
  /** Set by the extractor; `href-like` means the reference's line navigates. */
  context?: 'href-like' | 'plain';
}

interface BaselineEntry {
  target: string;
  finding?: string;
  reason?: string;
  class?: string;
}

interface ShapeBaselineEntry {
  pattern: string;
  finding?: string;
  reason?: string;
}

interface TemplateRow {
  raw: string;
  file: string;
  line: number;
  kind: 'expanded' | 'shape' | 'unparsed';
  expansions?: string[];
  pattern?: string;
  vars?: string[];
}

type ExpansionResult =
  | { kind: 'expanded'; expansions: string[]; vars: string[] }
  | { kind: 'shape'; pattern: string; vars: string[] }
  | { kind: 'unparsed'; raw: string };

interface Evaluation {
  problems: string[];
  stats: {
    filesScanned?: number;
    targets?: number;
    alive?: number;
    dead?: number;
    captures?: number;
    baselined?: number;
    prefixConstants?: number;
    deadDebt?: number;
    templateRows?: number;
    expanded?: number;
    shapeChecked?: number;
    unparsed?: number;
    shapes?: number;
    deadShapes?: number;
  };
  patterns?: Array<{ pattern: string; verdict: ShapeVerdict; sites: number; vars: string[] }>;
}

interface LinkIntegrityModule {
  classifyTarget: (target: string, routes: string[]) => Verdict;
  classifyPattern: (pattern: string, routes: string[]) => ShapeVerdict;
  stripCommentsPreservingLines: (source: string) => string;
  resolveDeclaredUnion: (name: string, source: string) => string[] | null;
  expandTemplateTarget: (raw: string, source: string) => ExpansionResult;
  extractLiteralLinks: (srcDir?: string) => LinkTarget[];
  extractTemplateLinks: (srcDir?: string) => TemplateRow[];
  normalizeShapeBaseline: (raw: unknown) => ShapeBaselineEntry[];
  classifyAll: (input: {
    targets: LinkTarget[];
    routes: string[];
    baseline: BaselineEntry[];
    templates?: TemplateRow[];
    deadShapes?: ShapeBaselineEntry[];
  }) => Evaluation;
}

/* eslint-disable @typescript-eslint/no-require-imports */
// Deliberately unguarded. If the gate script is absent or does not export its
// core, this suite must go red at load: a guard spec that degrades to "nothing to
// check" when its gate disappears is the exact failure the gate exists to stop.
const gate: LinkIntegrityModule = require(SCRIPT_PATH);
/* eslint-enable @typescript-eslint/no-require-imports */

const {
  classifyTarget,
  classifyPattern,
  classifyAll,
  extractLiteralLinks,
  extractTemplateLinks,
  expandTemplateTarget,
  resolveDeclaredUnion,
  stripCommentsPreservingLines,
  normalizeShapeBaseline,
} = gate;

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

/**
 * Every dead target measured for this slice, with the finding that owns the fix.
 *
 * `/help` used to be in this list under `PF-39`. S-E06-5 ships the page, so the row
 * is NARROWED into `MEASURED_ALIVE` below rather than deleted: the fact changed,
 * and both directions must still be asserted or the suite quietly stops covering
 * the target it was written for. (This is neither "the assertion was wrong" nor
 * "the code is wrong" — it is a measurement that a slice deliberately invalidated,
 * which is the one case where editing an assertion is correct.)
 *
 * `/api/auth` and `/favicon` also remain dead here and always will be: they are
 * still classified `dead` by the four-verdict classifier, and their
 * `class: 'prefix-constant'` changes only how the RECONCILER counts them (§4).
 *
 * `/admin/reports` used to head this list under `PF-14`. `S-E04-2` retired it, and
 * it moves to `MEASURED_RETIRED` below rather than being deleted — the same
 * narrowing `/help` got, for a DIFFERENT reason worth keeping straight. `/help`
 * became **alive**; `/admin/reports` is still dead and always will be, but nothing
 * references it any more, so it is no longer *debt* and the reviewed baseline may
 * no longer carry it. Deleting the row outright would have left three assertions
 * silently covering nothing.
 */
const MEASURED_DEAD: Array<[string, string]> = [
  ['/legal/privacy', 'PF-38'],
  ['/legal/terms', 'PF-38'],
  ['/legal/cookies', 'PF-38'],
  ['/parent/remediation', 'PF-92'],
  // Discovered BY the widening: a « Nouvelle annonce » CTA written as a template
  // literal, at a route that was never emitted (PF-98).
  ['/teacher/messaging', 'PF-98'],
  ...PHANTOM_AUTH_ROUTES.map((r): [string, string] => [r, 'PF-91']),
];

/**
 * The seven targets this slice takes OUT of the ceiling.
 *
 * Asserted alive, and asserted absent from the reviewed baseline, because the gate
 * fails on a baselined target that resolves again — that pre-existing rule is this
 * slice's bidirectional evidence (AC-6), and it only bites if the rows are gone.
 */
const CLOSED_BY_THIS_SLICE = ['/admin', '/teacher', '/parent', '/student', '/pricing', '/contact', '/help'];

/**
 * Targets a slice took out of the ceiling by REMOVING the reference, not by
 * building the route. Distinct from `CLOSED_BY_THIS_SLICE`, where the route came
 * to exist.
 *
 * `/admin/reports` (`PF-14`, `S-E04-2`): the « Rapports » sidebar item was
 * repointed to `/admin/analytics` — a real page that, until that slice, had no
 * sidebar entry at all while sitting under the very same `BarChart3` icon
 * (`PF-119`). So one edit removed a dead link and un-orphaned a live page.
 *
 * Both directions are asserted below, because each alone is satisfiable by a
 * mistake: "still matches no route" stays true if someone re-adds the link, and
 * "absent from the baseline" stays true if someone re-adds the link *and* forgets
 * the baseline — which is precisely the regression the gate exists to catch.
 */
const MEASURED_RETIRED: Array<[string, string]> = [['/admin/reports', 'PF-14']];

/**
 * Hand-listed live routes, one block per portal (G-PORTAL).
 *
 * PF-84's trap: a classifier that returned "no match" for everything satisfies
 * every negative assertion in this file. These are the positive direction, and
 * they span all four portals so the inventory is shown to cover the product
 * rather than one corner of it.
 */
const ALIVE_SAMPLES: Record<string, string[]> = {
  admin: ['/admin', '/admin/dashboard', '/admin/classes', '/admin/students/new', '/admin/roles/new', '/admin/audit'],
  teacher: ['/teacher', '/teacher/dashboard', '/teacher/classes', '/teacher/reports', '/teacher/conversations'],
  parent: ['/parent', '/parent/dashboard', '/parent/grades', '/parent/recommendations', '/parent/messages/new'],
  student: ['/student', '/student/dashboard', '/student/grades', '/student/attendance'],
  // The three public pages S-E06-5 ships. They are not a portal, and they are
  // deliberately outside every portal prefix — see `portal-landing-gate.spec.ts`.
  public: ['/pricing', '/contact', '/help'],
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
    'resolves the %s group’s real routes as exact (PF-84 — the positive direction)',
    (_group, samples) => {
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
    // makes the rest mean anything.
    //
    // The floor is RAISED for S-E06-5, and that matters more than it looks: the
    // widened extractor now reads comment-stripped content, and a comment stripper
    // that destroyed half of `apps/web/src` would still have cleared the old floor
    // of 80 while silently deleting real hrefs. Measured 2026-08-07 after the
    // widening: 353 source files, 173 files carrying a target, 116 distinct
    // literal internal targets (114 before, + the roots' own references).
    expect(targets.length).toBeGreaterThanOrEqual(114);
    expect(files.size).toBeGreaterThanOrEqual(120);
  });

  it.each([
    '/admin/dashboard',
    '/parent/dashboard',
    '/teacher/reports',
    '/student/grades',
    '/admin/classes/new',
    '/help',
  ])('finds the named canary %s', (canary) => {
    expect(targets).toContain(canary);
  });

  it('finds /teacher/messaging — a target ONLY the widened extractor can see', () => {
    // Measured: of the 116 distinct targets, exactly two are produced by no quoted
    // literal anywhere and come solely from a template literal. This is the
    // user-facing one — the « Nouvelle annonce » CTA at a route that was never
    // emitted (PF-98) — so it is the single strongest proof that the widening is
    // live rather than merely present. Delete the backtick handling and this case
    // is the first to go red.
    expect(targets).toContain('/teacher/messaging');
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
 * 2b. The widened extractor (S-E06-5 / PF-97) — resolve, or report
 * ================================================================== */

/**
 * The account menu AS IT WAS before this slice — a fixture string, deliberately
 * NOT the edited file.
 *
 * G-2 is the reproduction, and a reproduction has to survive the fix. Reading the
 * real `TopbarUserMenu.tsx` here would make this case pass because the defect was
 * removed, which proves the fix and nothing about the extractor. Held as a fixture,
 * it fails on the old extractor (which could not see a backtick href at all) and
 * passes on the new one, forever.
 */
const TOPBAR_USER_MENU_BEFORE = [
  "'use client';",
  '',
  'export interface TopbarUserMenuProps {',
  "  portal: 'admin' | 'teacher' | 'parent' | 'student';",
  '  firstName: string;',
  '}',
  '',
  'export function TopbarUserMenu({ portal }: TopbarUserMenuProps) {',
  '  const items = [',
  "    { id: 'profile', label: 'Mon profil', href: `/${portal}/profile` },",
  "    { id: 'settings', label: 'Paramètres', href: `/${portal}/settings` },",
  '  ];',
  '  return items;',
  '}',
].join('\n');

describe('stripCommentsPreservingLines — G-6, and the trap inside it', () => {
  it('blanks a JSDoc route TEMPLATE, so prose cannot become a dynamic capture', () => {
    // T2, measured: `admin/classes/new/page.tsx:16` documents `/admin/classes/[id]`
    // in a JSDoc block. Extracted, it is a DYNAMIC CAPTURE — which is unbaselineable
    // by design, so the gate would be permanently red with no way back to green.
    const source = ['/**', ' * Sibling of `/admin/classes/[id]`.', ' */', "const href = '/admin/dashboard';"].join('\n');
    const executable = stripCommentsPreservingLines(source);
    expect(executable).not.toContain('/admin/classes/[id]');
    expect(executable).toContain("'/admin/dashboard'");
  });

  it('is STRING-AWARE — a naive //-stripper would delete the href next to a URL', () => {
    // The hole being closed, re-opened at a new address. `/\/\/.*$/gm` eats
    // everything after the `//` in `https://`, taking real hrefs with it.
    const source = 'const doc = "https://x.test/a"; const href = "/admin/dead"; // gone';
    const executable = stripCommentsPreservingLines(source);
    expect(executable).toContain('"/admin/dead"');
    expect(executable).toContain('https://x.test/a');
    expect(executable).not.toContain('gone');
  });

  it('preserves byte length and every newline, so reported lines stay true', () => {
    const source = ['const a = 1; // tail', '/* block', '   spans lines */', 'const b = 2;'].join('\n');
    const executable = stripCommentsPreservingLines(source);
    expect(executable).toHaveLength(source.length);
    expect(executable.split('\n')).toHaveLength(source.split('\n').length);
    expect(executable).not.toContain('tail');
    expect(executable).not.toContain('spans lines');
  });

  it('leaves a comment-looking sequence inside a template literal alone', () => {
    expect(stripCommentsPreservingLines('const p = `/a/b`; // x')).toContain('`/a/b`');
    expect(stripCommentsPreservingLines('const r = /\\/\\/[a-z]+/; const h = "/admin/x";')).toContain('"/admin/x"');
  });

  it.each(['/me', '/students', '/calendar/events', '/messaging/eligible-teachers', '/analytics/parent-upcoming'])(
    'the real inventory does not contain %s — it exists only in JSDoc prose',
    (prose) => {
      // Measured: each of these is an API-relative path written in a comment. Read
      // as a link, every one of them is a dead route, and the gate would report five
      // defects that do not exist. The floor above (≥ 114 targets) is what stops
      // this from being satisfiable by an extractor that finds nothing.
      const extracted = new Set(extractLiteralLinks().map((e) => e.target));
      expect(extracted.size).toBeGreaterThanOrEqual(114);
      expect(extracted).not.toContain(prose);
    },
  );

  it('emits no `[param]` target at all — the whole class T2 warns about', () => {
    for (const entry of extractLiteralLinks()) {
      expect(entry.target).not.toContain('[');
      expect(entry.target).not.toContain(']');
    }
  });
});

/* ------------------------------------------------------------------ *
 * A JSX closing tag is not a regex opener
 * ------------------------------------------------------------------ */

/**
 * Write a one-file `src/app/page.tsx` tree and return its `src` directory, so the
 * scanners can be driven over a fixture instead of only over `apps/web/src`. The
 * real tree cannot pin this class: the shape is LATENT there (0 lines today), which
 * is exactly why the 168-row parity check kept passing while both scanners were
 * mis-reading it.
 */
const jsxFixtureRoots: string[] = [];

function fixtureSrcDir(body: string): string {
  const root = mkdtempSync(join(tmpdir(), 'link-integrity-jsx-'));
  jsxFixtureRoots.push(root);
  const src = join(root, 'src');
  mkdirSync(join(src, 'app'), { recursive: true });
  writeFileSync(join(src, 'app', 'page.tsx'), body, 'utf8');
  return src;
}

const TEMPLATE_HREF_LINE = '  return <q>%TAG%<a href={`/${p}/profile`}>go</a></q>;';

function templateHrefFixture(withClosingTag: boolean): string {
  return [
    "type P = 'admin' | 'teacher' | 'parent';",
    'export function C({ p }: { p: P }) {',
    TEMPLATE_HREF_LINE.replace('%TAG%', withClosingTag ? '<span>x</span>' : ''),
    '}',
    '',
  ].join('\n');
}

describe('both scanners — a `</tag>` is a closing tag, never a regex opener', () => {
  afterAll(() => {
    for (const root of jsxFixtureRoots) rmSync(root, { recursive: true, force: true });
  });

  // `'<'` sits in REGEX_MAY_FOLLOW_PUNCTUATION, so the `/` of a JSX closing tag
  // used to be read as opening a regex literal; the scanner then ran forward to the
  // next `/` on the line and swallowed whatever sat between. Both scanners share
  // the branch, so the same mis-read produced two distinct defects, below.

  it('D1 — strips a `//` comment that a closing tag precedes on the same line', () => {
    // PF-97 family: an ODD number of `</` before a `//` left the comment
    // UNSTRIPPED. A comment naming a concrete path then becomes a DYNAMIC CAPTURE,
    // which fails unconditionally and which `--update` refuses to record — the
    // "permanently red with no way back" mode this file's header names.
    const line = '      </div> // href="/admin/classes/[id]"';
    const stripped = stripCommentsPreservingLines(line);
    expect(stripped).not.toContain('/admin/classes/[id]');
    expect(stripped).toContain('</div>');
    expect(stripped).toHaveLength(line.length);
  });

  it('D1b — the control without the closing tag is stripped too (not a no-op stripper)', () => {
    // Without this pair, D1 is satisfiable by a stripper that strips nothing.
    const line = '      x;     // href="/admin/classes/[id]"';
    const stripped = stripCommentsPreservingLines(line);
    expect(stripped).not.toContain('/admin/classes/[id]');
    expect(stripped).toHaveLength(line.length);
  });

  it('D2 — a comment naming a concrete path raises no capture end to end', () => {
    const srcDir = fixtureSrcDir(
      ['export function C() {', '  return <p>a</p>; // renvoie vers "/parent/messages/inbox"', '}', ''].join('\n'),
    );
    const targets = extractLiteralLinks(srcDir);
    expect(targets).toHaveLength(0);
    const result = classifyAll({
      targets,
      templates: extractTemplateLinks(srcDir),
      routes: ['/parent/messages', '/parent/messages/[id]'],
      baseline: [],
      deadShapes: [],
    });
    expect(result.stats.captures).toBe(0);
    expect(result.problems).toHaveLength(0);
  });

  it('A1 — a template href sharing a line with a closing tag is NOT silently dropped', () => {
    // AC-1: never silently dropped. Before the fix this template was neither
    // expanded, nor shape-checked, nor reported `unparsed` — zero rows, and a
    // reader of the output could not tell it had been seen.
    const srcDir = fixtureSrcDir(templateHrefFixture(true));
    const rows = extractTemplateLinks(srcDir);
    expect(rows).toHaveLength(1);
    expect(rows.map((row) => row.kind)).toEqual(['expanded']);
    expect(rows.flatMap((row) => row.expansions ?? [])).toEqual([
      '/admin/profile',
      '/teacher/profile',
      '/parent/profile',
    ]);
    expect(extractLiteralLinks(srcDir).map((e) => e.target)).toEqual([
      '/admin/profile',
      '/teacher/profile',
      '/parent/profile',
    ]);
  });

  it('A1b — and it reads BYTE-IDENTICALLY to the same href without the closing tag', () => {
    // The href is byte-identical between the two fixtures; only the preceding
    // `</span>` differs. Any divergence here is the scanner reacting to the tag.
    const withTag = extractTemplateLinks(fixtureSrcDir(templateHrefFixture(true)));
    const withoutTag = extractTemplateLinks(fixtureSrcDir(templateHrefFixture(false)));
    // Pinned to 1, not merely to each other: "both dropped everything" must not pass.
    expect(withoutTag).toHaveLength(1);
    expect(withTag).toHaveLength(1);
    expect(withTag.map((row) => row.kind)).toEqual(withoutTag.map((row) => row.kind));
    expect(withTag.flatMap((row) => row.expansions ?? [])).toEqual(
      withoutTag.flatMap((row) => row.expansions ?? []),
    );
  });

  it('a real regex literal is still skipped — the narrowing did not disable the branch', () => {
    // The guard is keyed on ADJACENCY (`src[i - 1] === '<'`), so a regex in a
    // genuine value position keeps its old reading. A regex body in this repository
    // routinely contains quotes; mis-reading one as division is the failure the
    // `'<'` entry was there to prevent, and it must stay prevented.
    const stripped = stripCommentsPreservingLines('const r = /"[a-z]+\\/x/; const h = "/admin/dead";');
    expect(stripped).toContain('"/admin/dead"');
  });
});

describe('resolveDeclaredUnion — G-1: read the declaration, or say you cannot', () => {
  it('resolves an inline union (form a)', () => {
    expect(resolveDeclaredUnion('portal', "interface P { portal: 'admin' | 'teacher' | 'parent' }")).toEqual([
      'admin',
      'teacher',
      'parent',
    ]);
  });

  it('resolves a named alias (form b)', () => {
    const source = ["type AccountPortal = 'admin' | 'teacher';", 'interface P { portal: AccountPortal }'].join('\n');
    expect(resolveDeclaredUnion('portal', source)).toEqual(['admin', 'teacher']);
  });

  it('resolves `keyof typeof C` (form c)', () => {
    const source = [
      "const ROLES = { admin: ['a'], teacher: ['t'], parent: ['p'], student: ['s'] };",
      'let portal: keyof typeof ROLES | null = null;',
    ].join('\n');
    expect(resolveDeclaredUnion('portal', source)).toEqual(['admin', 'teacher', 'parent', 'student']);
  });

  it('returns null for an unknown name, and for a non-literal type', () => {
    expect(resolveDeclaredUnion('portal', 'const x = 1;')).toBeNull();
    expect(resolveDeclaredUnion('portal', 'function f(portal: string) { return portal; }')).toBeNull();
    // A cross-file type is the honest limit: `portal: Portal` imported from another
    // module cannot be read from this file, so the site stays shape-checked (§10.2).
    expect(resolveDeclaredUnion('portal', "import type { Portal } from './x';\nlet portal: Portal;")).toBeNull();
  });

  it('returns null when a file declares TWO candidate unions for the same name', () => {
    // Ambiguity is unresolvable, never a proximity pick. Picking the nearest one
    // would under-approximate the expansion invisibly, and an under-approximation
    // is a silent drop wearing a different hat — the defect PF-97 was.
    const source = ["interface A { portal: 'a' | 'b' }", "interface B { portal: 'c' | 'd' }"].join('\n');
    expect(resolveDeclaredUnion('portal', source)).toBeNull();
  });

  it('does not mistake a VALUE assignment for a one-member union', () => {
    // `{ portal: 'admin' }` occurs many times in this codebase. Read as a declared
    // union it would expand `` `/${portal}/x` `` to a single target and report the
    // other three as verified — silently wrong in the direction that looks green.
    expect(resolveDeclaredUnion('portal', "const props = { portal: 'admin' };")).toBeNull();
  });

  it('reads the declaration through comments, not around them', () => {
    const source = ["// portal: 'ghost' | 'phantom'", "interface P { portal: 'admin' | 'teacher' }"].join('\n');
    expect(resolveDeclaredUnion('portal', source)).toEqual(['admin', 'teacher']);
  });

  it('resolves the four real declarations this slice depends on', () => {
    // Floor first (run-10): these files exist and the resolver returns from them,
    // before any negative below is allowed to mean anything.
    const read = (...parts: string[]) => readFileSync(join(REPO_ROOT, 'apps', 'web', 'src', ...parts), 'utf8');
    expect(resolveDeclaredUnion('portal', read('components', 'shell', 'TopbarUserMenu.tsx'))).toEqual([
      'admin',
      'teacher',
      'parent',
      'student',
    ]);
    expect(resolveDeclaredUnion('portal', read('components', 'UserMenu.tsx'))).toEqual([
      'admin',
      'teacher',
      'parent',
    ]);
    // P1-C8 / R-30: three portals, NOT four. A resolver that guessed "the four
    // portals" would invent `/student/notifications` — a dead target correct code
    // cannot produce (PF-57 is out of scope and its href does not exist).
    expect(resolveDeclaredUnion('portal', read('components', 'notifications', 'NotificationCenter.tsx'))).toEqual([
      'admin',
      'teacher',
      'parent',
    ]);
    expect(resolveDeclaredUnion('portal', read('components', 'PortalErrorState.tsx'))).toEqual([
      'admin',
      'teacher',
      'parent',
    ]);
  });
});

describe('expandTemplateTarget — G-2, G-4, G-5: the reproduction and the two traps', () => {
  it('G-2 REPRODUCTION: `/${portal}/profile` expands to four targets, all DEAD', () => {
    const result = expandTemplateTarget('/${portal}/profile', TOPBAR_USER_MENU_BEFORE);
    expect(result.kind).toBe('expanded');
    const expansions = result.kind === 'expanded' ? result.expansions : [];
    expect(expansions).toEqual(['/admin/profile', '/teacher/profile', '/parent/profile', '/student/profile']);
    // …and every one of them is dead against the inventory AFTER this slice, which
    // is what makes « Mon profil » a defect rather than a style preference.
    for (const target of expansions) {
      expect(classifyTarget(target, ROUTES_AFTER)).toBe('dead');
    }
  });

  it('G-2, other direction: the sibling settings href expands to three LIVE targets', () => {
    // Same file, same union, opposite verdict. Without this the case above is
    // satisfied by an expander that reports everything dead.
    const result = expandTemplateTarget('/${portal}/settings', TOPBAR_USER_MENU_BEFORE);
    expect(result.kind).toBe('expanded');
    const expansions = result.kind === 'expanded' ? result.expansions : [];
    expect(expansions).toContain('/admin/settings');
    for (const alive of ['/admin/settings', '/teacher/settings', '/parent/settings']) {
      expect(classifyTarget(alive, ROUTES_AFTER)).toBe('exact');
    }
    // And it is why the union must be DECLARED, not guessed: `/student/settings` is
    // in this expansion and is dead (PF-57), which is precisely why the shipped code
    // states the three literal hrefs as data instead of interpolating a 4-portal id.
    expect(classifyTarget('/student/settings', ROUTES_AFTER)).toBe('dead');
  });

  it('G-4 (T1): an interpolation is masked BEFORE `?` is stripped', () => {
    // `RemediationProgressStrip.tsx:222`. Strip at the first `?` and the target
    // becomes `/parent/remediation/${visible[0]` — whose last segment matches
    // `[planId]`, i.e. a DYNAMIC CAPTURE. A capture can never be baselined, so the
    // gate would be red forever with no way back.
    const result = expandTemplateTarget('/parent/remediation/${visible[0]?.planId}', '');
    expect(result.kind).toBe('shape');
    expect(result.kind === 'shape' ? result.pattern : '').toBe('/parent/remediation/*');
    expect(classifyPattern('/parent/remediation/*', ROUTES_AFTER)).toBe('shape-alive');

    // Both halves of the trap, stated explicitly. The bogus target a `?`-first
    // stripper produces really WOULD be a dynamic capture…
    expect(classifyTarget('/parent/remediation/${visible[0]', ROUTES_AFTER)).toBe('dynamic-capture');
    // …and it never reaches the classifier, because nothing like it is ever emitted.
    const emitted = extractLiteralLinks().map((e) => e.target);
    expect(emitted).not.toContain('/parent/remediation/${visible[0]');
    expect(emitted.filter((t) => t.startsWith('/parent/remediation/'))).toEqual([]);
  });

  it('G-5 (T3): a mixed segment truncates at the interpolation, keeping the literal', () => {
    // `ParentActionCenter.tsx` × 4. The interpolation expands to a QUERY STRING, so
    // treating it as a segment reports four correct links dead — and throwing the
    // whole segment away reports them against `/parent`, the wrong target.
    const result = expandTemplateTarget('/parent/recommendations${childQuery(id)}', '');
    expect(result.kind).toBe('expanded');
    expect(result.kind === 'expanded' ? result.expansions : []).toEqual(['/parent/recommendations']);
    expect(classifyTarget('/parent/recommendations', ROUTES_AFTER)).toBe('exact');
  });

  it('a query-only interpolation is not reported at all', () => {
    const result = expandTemplateTarget('/admin/alerts?${next.toString()}', '');
    expect(result.kind).toBe('expanded');
    expect(result.kind === 'expanded' ? result.expansions : []).toEqual(['/admin/alerts']);
  });

  it('an unterminated interpolation is UNPARSED, never a silent skip (DNC-08)', () => {
    expect(expandTemplateTarget('/admin/${broken', '').kind).toBe('unparsed');
  });
});

describe('classifyPattern — weak by design, and not a constant function', () => {
  it('a `*` may align to a literal segment as well as to a [param]', () => {
    // Requiring a dynamic segment would make `` `/${portal}/settings` `` report dead
    // on a correct repository — the R-30 false red, one layer up.
    expect(classifyPattern('/*/settings', ROUTES_AFTER)).toBe('shape-alive');
    expect(classifyPattern('/admin/students/*', ROUTES_AFTER)).toBe('shape-alive');
  });

  it('a shape nothing matches is shape-dead, and depth is respected', () => {
    expect(classifyPattern('/*/profile', ROUTES_AFTER)).toBe('shape-dead');
    expect(classifyPattern('/admin/guardians/*', ROUTES_AFTER)).toBe('shape-dead');
    expect(classifyPattern('/admin/dashboard/*/deeper', ROUTES_AFTER)).toBe('shape-dead');
  });

  it('is not a constant function in either direction', () => {
    const verdicts = new Set([
      classifyPattern('/admin/students/*', ROUTES_AFTER),
      classifyPattern('/nowhere/*', ROUTES_AFTER),
    ]);
    expect(verdicts).toEqual(new Set(['shape-alive', 'shape-dead']));
  });
});

describe('extractTemplateLinks — G-3, G-7: over the real tree, and nothing dropped', () => {
  const rows = extractTemplateLinks();
  const expanded = rows.filter((r) => r.kind === 'expanded');
  const shapes = rows.filter((r) => r.kind === 'shape');
  const unparsed = rows.filter((r) => r.kind === 'unparsed');

  it('G-7 anti-drop: templateRows === expanded + shape + unparsed, and neither branch is dead code', () => {
    // The run-10 lesson made executable. Measured 2026-08-07: 168 rows =
    // 66 expanded + 102 shape + 0 unparsed.
    expect(rows.length).toBeGreaterThanOrEqual(120);
    expect(rows.length).toBe(expanded.length + shapes.length + unparsed.length);
    expect(expanded.length).toBeGreaterThan(0);
    expect(shapes.length).toBeGreaterThan(0);
  });

  it('reports ZERO unparsed rows on this tree — and an unparsed row is a failure, not a skip', () => {
    expect(unparsed).toEqual([]);
  });

  it.each([
    ['apps/web/src/app/parent/recommendations/alert-next-steps.ts', 70, '/parent/grades'],
    ['apps/web/src/app/parent/remediation/[planId]/page.tsx', 127, '/parent/recommendations'],
  ])('G-3: finds the MULTI-LINE template at %s:%i, which a line-based scanner drops silently', (file, line, target) => {
    // T4. Exactly two template literals in `apps/web/src` span lines, and both are
    // hrefs. A line-anchored scanner returns nothing for either and says nothing
    // about it — the precise failure AC-1 forbids.
    const row = rows.find((r) => r.file === file && r.line === line);
    expect(row).toBeDefined();
    expect(row?.raw).toContain('\n');
    expect(row?.kind).toBe('expanded');
    expect(row?.expansions).toContain(target);
  });

  it('every emitted row carries a repo-relative position with forward slashes', () => {
    for (const row of rows) {
      expect(row.file).not.toContain('\\');
      expect(row.line).toBeGreaterThan(0);
      expect(row.raw.startsWith('/')).toBe(true);
    }
  });

  it('excludes the API namespace, so a correct BFF fetch is never reported', () => {
    // `` `/api/v1/students/${id}` `` shape-checks as `/api/v1/students/*`, which no
    // Next route can match — correctly, it is the NestJS namespace. Reporting it
    // would make the gate red on every dynamic fetch in the application.
    for (const row of shapes) {
      expect(row.pattern?.startsWith('/api/v1')).toBe(false);
    }
  });

  it('G-8: the widened extractor is not a constant function', () => {
    // A dead expansion on a synthetic dead union, zero on a live one — driven
    // through the real module, so neither direction can be an artefact of the fixture.
    const deadUnion = "interface P { kind: 'nope' | 'nada' }";
    const deadResult = expandTemplateTarget('/admin/${kind}', deadUnion);
    expect(deadResult.kind).toBe('expanded');
    const deadTargets = deadResult.kind === 'expanded' ? deadResult.expansions : [];
    expect(deadTargets.every((t) => classifyTarget(t, ROUTES_AFTER) === 'dead')).toBe(true);

    const liveUnion = "interface P { section: 'dashboard' | 'settings' | 'audit' }";
    const liveResult = expandTemplateTarget('/admin/${section}', liveUnion);
    const liveTargets = liveResult.kind === 'expanded' ? liveResult.expansions : [];
    expect(liveTargets).toHaveLength(3);
    expect(liveTargets.every((t) => classifyTarget(t, ROUTES_AFTER) === 'exact')).toBe(true);
  });

  it('the two shape families this slice records are found, and the third is a concrete target', () => {
    // PF-98, measured. Two families cannot be resolved to concrete targets (no
    // `[id]` route exists to give them a shape), and one is fully literal once its
    // query string is stripped.
    const patterns = new Set(shapes.map((r) => r.pattern));
    expect(patterns).toContain('/admin/guardians/*');
    expect(patterns).toContain('/admin/assessments/*');
    expect(new Set(expanded.flatMap((r) => r.expansions ?? []))).toContain('/teacher/messaging');
  });

  it('tags an href-like reference as such, and a prefix-only one as plain (AC-5 machinery)', () => {
    const references = extractLiteralLinks();
    const contexts = new Set(references.map((r) => r.context));
    // Floor: BOTH values actually occur, or the refusal below is untestable.
    expect(contexts).toEqual(new Set(['href-like', 'plain']));

    // Was `/admin/reports` until S-E04-2 retired it. `/admin/analytics` is the
    // href that replaced it at the same sidebar site, so the specimen still comes
    // from the real tree and still exercises the `href:`-key shape.
    const hrefLike = references.filter((r) => r.target === '/admin/analytics');
    expect(hrefLike.length).toBeGreaterThan(0);
    expect(hrefLike.every((r) => r.context === 'href-like')).toBe(true);

    for (const target of ['/api/auth', '/favicon']) {
      const found = references.filter((r) => r.target === target);
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((r) => r.context === 'plain')).toBe(true);
    }
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
    //
    // The target used here must be one NOTHING links to, which is why it is not
    // `/help` any more: S-E06-5 ships that page, `/help` is now in ALIVE_SAMPLES,
    // and the case would have passed for the wrong reason (BASELINED BUT ALIVE
    // rather than STALE) while looking green.
    const result = classifyAll({
      targets: cleanTargets,
      routes: ROUTES_AFTER,
      baseline: [{ target: '/nobody/links/here', finding: 'PF-39', reason: 'not linked from anywhere' }],
    });
    expect(result.problems.length).toBeGreaterThan(0);
    const text = result.problems.join('\n');
    expect(text).toContain('/nobody/links/here');
    expect(text).toContain('STALE BASELINE ENTRY');
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
 * 3b. The prefix-constant class, the shape ceiling, and the anti-drop
 *     invariant — each proven in BOTH directions
 * ================================================================== */

describe('classifyAll — G-9: the prefix-constant class cannot hide a real href', () => {
  const cleanTargets = Object.values(ALIVE_SAMPLES)
    .flat()
    .map((t) => link(t));

  const prefixRow = (target: string): BaselineEntry => ({
    target,
    finding: 'PF-93',
    reason: 'a string used only as a prefix; nothing will ever create it',
    class: 'prefix-constant',
  });

  it('honours the class when every reference is plain, and stops counting it as dead DEBT', () => {
    const result = classifyAll({
      targets: [...cleanTargets, { target: '/api/auth', file: 'apps/web/src/middleware.ts', line: 34, context: 'plain' }],
      routes: ROUTES_AFTER,
      baseline: [prefixRow('/api/auth')],
    });
    expect(result.problems).toEqual([]);
    expect(result.stats.prefixConstants).toBe(1);
    expect(result.stats.deadDebt).toBe(0);
    // …and it is still DEAD to the classifier. The class changes the accounting, not
    // the verdict, which is why the row stays in `dead` and keeps its reason.
    expect(result.stats.dead).toBe(1);
  });

  it('REFUSES the class when any reference sits on an href-like line, naming file:line', () => {
    const result = classifyAll({
      targets: [
        ...cleanTargets,
        { target: '/api/auth', file: 'apps/web/src/middleware.ts', line: 34, context: 'plain' },
        { target: '/api/auth', file: 'apps/web/src/app/rogue/page.tsx', line: 12, context: 'href-like' },
      ],
      routes: ROUTES_AFTER,
      baseline: [prefixRow('/api/auth')],
    });
    const text = result.problems.join('\n');
    expect(result.problems.length).toBeGreaterThan(0);
    expect(text).toContain('PREFIX-CONSTANT CLASSIFICATION REFUSED');
    expect(text).toContain('apps/web/src/app/rogue/page.tsx:12');
    // The message must say what the class is FOR, or the next author "fixes" the
    // failure by tagging more rows — which is the thing being forbidden.
    expect(text).toContain('It is not a quieter baseline');
    // Refused ⇒ counted as ordinary dead debt again, not quietly excused.
    expect(result.stats.prefixConstants).toBe(0);
    expect(result.stats.deadDebt).toBe(1);
  });

  it('REFUSED against the real code: /parent/remediation may not be tagged prefix-constant', () => {
    // The negative proof AC-5 asks for, driven from the REAL extractor over the REAL
    // tree. This case used `/admin/reports` until S-E04-2 retired that target; the
    // specimen had to move to another REFERENCED dead route, because the whole point
    // is to drive the refusal from a real href with a real file:line. `PF-92`'s
    // `/parent/remediation` is that route — `href="/parent/remediation"` in the
    // parent dashboard's remediation strip. The mechanism must refuse it, and refuse
    // it BY NAME rather than merely fail somewhere.
    const baseline = BASELINE.map((entry) =>
      entry.target === '/parent/remediation' ? { ...entry, class: 'prefix-constant' } : entry,
    );
    const result = classifyAll({
      targets: extractLiteralLinks(),
      routes: REVIEWED_ROUTES,
      baseline,
      templates: extractTemplateLinks(),
      deadShapes: normalizeShapeBaseline(baselineRaw),
    });
    const text = result.problems.join('\n');
    expect(text).toContain('PREFIX-CONSTANT CLASSIFICATION REFUSED — /parent/remediation');
    expect(text).toContain('RemediationProgressStrip.tsx:233');
  });

  it('and the CONTROL: the committed baseline, unmodified, produces no refusal', () => {
    // Without this the case above passes for a gate that refuses every row.
    const result = classifyAll({
      targets: extractLiteralLinks(),
      routes: REVIEWED_ROUTES,
      baseline: BASELINE,
      templates: extractTemplateLinks(),
      deadShapes: normalizeShapeBaseline(baselineRaw),
    });
    expect(result.problems.join('\n')).not.toContain('PREFIX-CONSTANT CLASSIFICATION REFUSED');
    expect(result.stats.prefixConstants).toBe(2);
  });
});

describe('classifyAll — G-10: the shape ceiling obeys the same four rules', () => {
  const cleanTargets = Object.values(ALIVE_SAMPLES)
    .flat()
    .map((t) => link(t));

  const deadShapeRow = (pattern: string): TemplateRow => ({
    raw: '/admin/guardians/${g.id}',
    file: 'apps/web/src/app/admin/guardians/page.tsx',
    line: 192,
    kind: 'shape',
    pattern,
    vars: ['g.id'],
  });

  const aliveShapeRow: TemplateRow = {
    raw: '/admin/students/${s.id}',
    file: 'apps/web/src/app/admin/students/page.tsx',
    line: 10,
    kind: 'shape',
    pattern: '/admin/students/*',
    vars: ['s.id'],
  };

  const run = (templates: TemplateRow[], deadShapes: ShapeBaselineEntry[]) =>
    classifyAll({ targets: cleanTargets, routes: ROUTES_AFTER, baseline: [], templates, deadShapes });

  it('the control: a shape-alive pattern with no baseline row passes', () => {
    const result = run([aliveShapeRow], []);
    expect(result.problems).toEqual([]);
    expect(result.stats.shapeChecked).toBe(1);
    expect(result.stats.deadShapes).toBe(0);
  });

  it('fails an unbaselined shape-dead pattern', () => {
    const result = run([deadShapeRow('/admin/guardians/*')], []);
    expect(result.problems.join('\n')).toContain('DEAD LINK SHAPE');
    expect(result.problems.join('\n')).toContain('/admin/guardians/*');
    expect(result.problems.join('\n')).toContain('admin/guardians/page.tsx:192');
  });

  it('accepts it with a reason AND an owning finding', () => {
    const result = run(
      [deadShapeRow('/admin/guardians/*')],
      [{ pattern: '/admin/guardians/*', finding: 'PF-98', reason: 'no /admin/guardians/[id] route' }],
    );
    expect(result.problems).toEqual([]);
  });

  it('fails it without a reason, and fails it without a finding', () => {
    expect(
      run([deadShapeRow('/admin/guardians/*')], [{ pattern: '/admin/guardians/*', finding: 'PF-98' }]).problems.length,
    ).toBeGreaterThan(0);
    expect(
      run([deadShapeRow('/admin/guardians/*')], [{ pattern: '/admin/guardians/*', reason: 'known' }]).problems.length,
    ).toBeGreaterThan(0);
  });

  it('fails a baselined shape that is ALIVE again — the ceiling only comes down', () => {
    const result = run([aliveShapeRow], [{ pattern: '/admin/students/*', finding: 'PF-98', reason: 'stale' }]);
    expect(result.problems.join('\n')).toContain('BASELINED SHAPE BUT ALIVE');
  });

  it('fails a baselined shape nothing produces any more', () => {
    const result = run([aliveShapeRow], [{ pattern: '/gone/*', finding: 'PF-98', reason: 'nobody writes it' }]);
    expect(result.problems.join('\n')).toContain('STALE BASELINE SHAPE');
  });

  it('an UNPARSED row is a structural failure, never a skip (DNC-08)', () => {
    const result = run(
      [{ raw: '/admin/${broken', file: 'apps/web/src/app/x/page.tsx', line: 3, kind: 'unparsed' }],
      [],
    );
    expect(result.problems.join('\n')).toContain('UNPARSED TEMPLATE LITERAL');
    expect(result.stats.unparsed).toBe(1);
  });

  it('a template row that reconciles to nothing is itself a failure (the anti-drop invariant)', () => {
    // Driven by handing `classifyAll` a row with an unrecognised kind: the count of
    // rows read no longer equals expanded + shape + unparsed, which is exactly the
    // arithmetic that catches a future refactor quietly discarding sites.
    const result = run([{ raw: '/x', file: 'f.tsx', line: 1, kind: 'dropped' } as unknown as TemplateRow], []);
    expect(result.problems.join('\n')).toContain('TEMPLATE ROWS DO NOT RECONCILE');
  });

  it('reports every distinct shape back to the caller, on PASS as well as FAIL', () => {
    // "Reported, never dropped" is only true if the report exists when nothing is
    // wrong — a list that appears only on failure is not a disclosure.
    const result = run([aliveShapeRow, deadShapeRow('/admin/guardians/*')], [
      { pattern: '/admin/guardians/*', finding: 'PF-98', reason: 'no [id] route' },
    ]);
    expect(result.problems).toEqual([]);
    expect(result.patterns?.map((p) => p.pattern).sort()).toEqual(['/admin/guardians/*', '/admin/students/*']);
    expect(result.patterns?.find((p) => p.pattern === '/admin/students/*')?.verdict).toBe('shape-alive');
    expect(result.patterns?.find((p) => p.pattern === '/admin/guardians/*')?.verdict).toBe('shape-dead');
  });
});

describe('classifyAll — the real tree reconciles against the reviewed inventory', () => {
  it('PASSES against scripts/web-route-baseline.json, and the numbers are the measured ones', () => {
    // The end-to-end statement of the slice, deterministic (reviewed inventory, not
    // `.next/`): after the widening and the shrink, nothing is unaccounted for.
    const result = classifyAll({
      targets: extractLiteralLinks(),
      routes: REVIEWED_ROUTES,
      baseline: BASELINE,
      templates: extractTemplateLinks(),
      deadShapes: normalizeShapeBaseline(baselineRaw),
    });
    expect(result.problems).toEqual([]);
    // Dead debt came DOWN (24 → 16) while the extractor got WIDER — the direction is
    // the acceptance criterion, so it is asserted as an inequality, not a constant.
    expect(result.stats.dead).toBeLessThanOrEqual(18);
    expect(result.stats.deadDebt).toBeLessThanOrEqual(16);
    expect(result.stats.prefixConstants).toBe(2);
    expect(result.stats.captures).toBe(0);
    expect(result.stats.unparsed).toBe(0);
    expect(result.stats.expanded).toBeGreaterThan(0);
    expect(result.stats.shapeChecked).toBeGreaterThan(0);
    expect(result.stats.templateRows).toBe(
      (result.stats.expanded ?? 0) + (result.stats.shapeChecked ?? 0) + (result.stats.unparsed ?? 0),
    );
  });

  it.each(CLOSED_BY_THIS_SLICE)(
    'AC-6 bidirectional: leaving the closed row for %s in the baseline FAILS the gate',
    (target) => {
      // This is the evidence, and it is the pre-existing `BASELINED BUT ALIVE` rule
      // doing the work: the seven rows cannot be left behind, because a baselined
      // target that resolves again is a failure until its row is removed.
      const result = classifyAll({
        targets: extractLiteralLinks(),
        routes: REVIEWED_ROUTES,
        baseline: [...BASELINE, { target, finding: 'PF-93', reason: 'left behind on purpose' }],
        templates: extractTemplateLinks(),
        deadShapes: normalizeShapeBaseline(baselineRaw),
      });
      const text = result.problems.join('\n');
      expect(result.problems.length).toBeGreaterThan(0);
      expect(text).toContain('BASELINED BUT ALIVE');
      expect(text).toContain(target);
    },
  );
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

  it.each(MEASURED_RETIRED)(
    'no longer holds %s (%s) — the reference was removed, so the ceiling came down',
    (target) => {
      // Direction 1: the ceiling shrank. The gate itself FAILS on a baselined
      // target nobody references any more, so leaving the row would have been red
      // — this asserts the row was retired rather than re-reasoned.
      expect(BASELINED_TARGETS).not.toContain(target);
    },
  );

  it.each(MEASURED_RETIRED)('and nothing in apps/web references %s any more (%s)', (target) => {
    // Direction 2, and the one that actually guards the regression: re-adding the
    // sidebar entry would make this fail HERE, in a named test, rather than only
    // as a generic dead-link problem. Driven from the real extractor over the real
    // tree — not from the baseline, which is the thing being checked.
    const referenced = extractLiteralLinks().filter((r) => r.target === target);
    expect(referenced).toEqual([]);
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

  /* ---------------------------------------------------------------- *
   * G-11 — what S-E06-5 changed in the reviewed ceiling
   * ---------------------------------------------------------------- */

  it.each(CLOSED_BY_THIS_SLICE)('no longer holds %s — it resolves now (AC-6)', (target) => {
    expect(BASELINED_TARGETS).not.toContain(target);
    // Stated in the positive too, so the row's absence means "fixed" rather than
    // "quietly dropped from the inventory".
    expect(REVIEWED_ROUTES).toContain(target);
  });

  it('the ceiling SHRANK: fewer rows than the 24 S-E06-3 recorded, and 2 are prefix constants', () => {
    expect(BASELINE.length).toBeLessThan(24);
    const prefixConstants = BASELINE.filter((e) => e.class === 'prefix-constant').map((e) => e.target).sort();
    expect(prefixConstants).toEqual(['/api/auth', '/favicon']);
    // Dead DEBT — what someone still has to fix — is what actually came down.
    expect(BASELINE.length - prefixConstants.length).toBeLessThanOrEqual(16);
  });

  it('a prefix-constant row is NOT exempt from carrying a reason and an owning finding', () => {
    // The class must be a different way of COUNTING a row, never a quieter row. If
    // it excused the provenance requirements it would be an amnesty with a label.
    for (const entry of BASELINE.filter((e) => e.class === 'prefix-constant')) {
      expect((entry.reason ?? '').trim().length).toBeGreaterThan(20);
      expect(entry.finding ?? '').toMatch(/^(PF|R|VAL|D)-\d+$/);
    }
  });

  it('does NOT tag /legal prefix-constant — it is D-08-blocked debt, not a false positive', () => {
    // `/legal` is structurally eligible by exactly the same test as `/api/auth`: it
    // is a `PUBLIC_PREFIXES` member consumed by `startsWith`. Tagging it would erase
    // the only written record that `/legal/*` is blocked on decision D-08 (R-13: the
    // routine may never author policy text), while its three children stay dead. A
    // decision-blocked item must not be reclassified as a side effect.
    const legal = BASELINE.find((e) => e.target === '/legal');
    expect(legal).toBeDefined();
    expect(legal?.class).toBeUndefined();
    expect(legal?.finding).toBe('PF-38');
    for (const child of ['/legal/privacy', '/legal/terms', '/legal/cookies']) {
      expect(BASELINE.find((e) => e.target === child)?.class).toBeUndefined();
    }
  });

  it('records PF-98 — the three link families the widening discovered — with an owner', () => {
    const messaging = BASELINE.find((e) => e.target === '/teacher/messaging');
    expect(messaging?.finding).toBe('PF-98');
    // The reason must say WHY it is not simply retargeted, or the next reader "fixes"
    // it by pointing the CTA at `/teacher/messages/new`, which ignores classSectionId
    // and would compose an announcement for the wrong class — DNC-06 at a new address.
    expect(messaging?.reason).toMatch(/classSectionId/);

    const shapes = normalizeShapeBaseline(baselineRaw);
    expect(shapes.map((s) => s.pattern).sort()).toEqual(['/admin/assessments/*', '/admin/guardians/*']);
    for (const shape of shapes) {
      expect(shape.finding).toBe('PF-98');
      expect((shape.reason ?? '').trim().length).toBeGreaterThan(20);
      expect(shape.reason).toMatch(/Owner:/);
    }
  });

  it('every dead shape in the ceiling really is shape-dead against the reviewed inventory', () => {
    // Same rule as "no baselined entry is actually a capture", one layer up: a shape
    // sitting in the ceiling that already resolves is a stale amnesty.
    const shapes = normalizeShapeBaseline(baselineRaw);
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(classifyPattern(shape.pattern, REVIEWED_ROUTES)).toBe('shape-dead');
    }
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

  it('G-12: the WIDENED code paths read no environment variable either', () => {
    // The widening added a comment stripper, a union resolver, a template scanner and
    // a shape classifier — four new places a bypass could be hidden. Executed, not
    // read: the new exports are driven in a child process with every plausible escape
    // variable set, and the verdicts must be identical.
    const body = [
      `const g = require(${JSON.stringify(SCRIPT_PATH)});`,
      `const routes = ${JSON.stringify(ROUTES_AFTER)};`,
      `const fixture = ${JSON.stringify("interface P { portal: 'admin' | 'teacher' }")};`,
      `const union = g.resolveDeclaredUnion('portal', fixture) || [];`,
      `const expanded = g.expandTemplateTarget('/\${portal}/profile', fixture);`,
      `const dead = expanded.kind === 'expanded' && expanded.expansions.every((t) => g.classifyTarget(t, routes) === 'dead');`,
      `const shape = g.classifyPattern('/*/profile', routes) === 'shape-dead';`,
      `const stripped = !g.stripCommentsPreservingLines('// x').includes('x');`,
      `process.exit(union.length === 2 && dead && shape && stripped ? 1 : 0);`,
    ].join('\n');

    // Exit 1 means "the gate still found the defect". The control first.
    expect(runInChild(body, {}).status).toBe(1);
    for (const escape of [
      { SKIP_LINK_CHECK: '1' },
      { ALLOW_DEAD_LINKS: '1' },
      { ALLOW_TEMPLATE_LINKS: '1' },
      { LINK_CHECK_TEMPLATES: '0' },
      { NODE_ENV: 'production', CI: 'false', SKIP_LINK_CHECK: '1' },
    ]) {
      expect(runInChild(body, escape).status).toBe(1);
    }
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
      // The CLI now drives the template path too. Omitting it here would make the
      // agreement hold for the wrong reason: two different evaluations that happen
      // to agree on the exit code.
      templates: extractTemplateLinks(),
      deadShapes: normalizeShapeBaseline(baselineRaw),
    });
    const cli = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(cli.status).toBe(evaluation.problems.length > 0 ? 1 : 0);

    const output = `${cli.stdout ?? ''}${cli.stderr ?? ''}`;
    expect(output).toMatch(/LINK INTEGRITY CHECK: (PASS|FAIL)/);
    // "Reported, never dropped" has to be visible in what the run PRINTS, or the
    // blind spot is still a blind spot — just one with a counter behind it.
    expect(output).toMatch(/interpolated \(\d+ union-expanded · \d+ shape-checked/);
    expect(output).toContain('interpolated href shapes');
  });
});
