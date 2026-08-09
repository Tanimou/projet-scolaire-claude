import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E04-1 — the single-declaration guard for audit provenance (AC-1, AC-2, AC-6,
 * AC-7, AC-9, DNC-08, DNC-10).
 *
 * WHAT WAS BROKEN
 * ---------------
 * "Who acted, and through which portal" was answered **four** times in
 * production code:
 *
 *   A. `modules/alerts/alert-provenance.ts` — the correct mapper, in a FEATURE
 *      module, so ~20 future call sites would have had to import from `alerts`
 *      to audit an import or a role change.
 *   B. `modules/analytics/analytics.controller.ts:293-297` — an **anonymous**
 *      inline `['super_admin','school_admin','teacher','parent'].find(...)`, with
 *      no portal derivation at all (the portal was the literal `'admin'` it fed
 *      at `snapshot-ops.service.ts:196`).
 *   C. `modules/grades/grades.controller.ts:332-336` + `:345` — the same
 *      anonymous array PLUS a second, **contradicting** portal map:
 *      `actorRole === 'teacher' ? 'teacher' : actorRole ? 'admin' : null`, which
 *      recorded a `parent` actor as having acted in the `admin` portal.
 *   D. eight sites writing the literal `actorRole: 'school_admin'` with no
 *      derivation at all.
 *
 * WHY THIS GUARD IS STATED OVER THE INVARIANT, NOT OVER A NAME
 * -----------------------------------------------------------
 * B and C carry **no shared identifier** — B and C carry no identifier at all.
 * A guard that grepped for `deriveAlertActorProvenance` would have been green
 * over both of them, which is precisely what `S-E06-5` measured on
 * `PORTAL_LANDING`: its guard passed over a fifth copy because the copy carried a
 * different name. So the rules below are stated over the **behaviour** — "a
 * role-precedence ordering" and "an inline portal decision" — and the negative
 * control is not hypothetical: the AC-7 case in `G-3` runs the very same matchers
 * over the three **recorded** pre-fix sources under
 * `shared/audit/__fixtures__/pre-fix/` and asserts they FLAGGED all three copies.
 * That is the difference between this guard and the one `S-E06-5` recorded as
 * useless.
 *
 * WHY THE CONTROL READS FIXTURES AND NOT `git show HEAD:`
 * ------------------------------------------------------
 * It used to read `git show HEAD:<path>`, which is green **only while this slice
 * is uncommitted** — the state it was first measured in. The moment it is
 * committed (and permanently on `main` after the squash-merge) `HEAD` *is* the
 * fixed tree: `alert-provenance.ts` does not exist there, so `git show` exits 128
 * and `execFileSync` throws inside the test; and the two survivors return the
 * *collapsed* sources, so every `toBe(true)` below inverts. The one assertion this
 * slice presents as its proof of non-vacuity would have been permanently RED on
 * `main` from the first commit — which is how a guard gets `.skip`-ed, taking the
 * whole single-decision invariant with it. Pinning a sha instead of `HEAD` does
 * not fix it either: `.github/workflows/ci.yml` uses `actions/checkout@v4` with no
 * `fetch-depth`, i.e. depth 1, so `e218017` is not reachable in the job that runs
 * `node scripts/test-ratchet.js api`.
 *
 * The fixtures keep the property that mattered — they are the **real** pre-fix
 * bytes, taken from `e218017` with `git show`, not a string the author believed
 * was there (`R-30`) — and add none of the fragility: no `git` binary, no `.git`
 * directory, no history depth. Their sha256 is pinned below, so editing one to
 * quiet a red test is itself a red test.
 *
 * COMMENT-STRIPPED, USING THE LINK GATE'S OWN STRIPPER
 * ---------------------------------------------------
 * Every read goes through `stripCommentsPreservingLines`
 * (`scripts/link-integrity-check.js`, proven in both directions in
 * `link-integrity-gate.spec.ts`). Reason: `PF-83`. The files this slice touches
 * *explain at length* why they no longer contain `actorRole: 'school_admin'` or a
 * hard-coded `portal: 'admin'`, and `shared/audit/provenance.ts` quotes both
 * strings in its own header. A raw grep would go red on the documentation of the
 * fix. The stripper is string-aware, so unlike a `/\/\/.*$/` one-liner it does
 * not delete the rest of a line the moment it meets `https://`.
 *
 * NOT CLAIMED: transactionality (`S-E04-6`), a real `ipAddress`/`userAgent`
 * (`S-E04-3` — this guard asserts the null is *structural*, not that it is
 * right), the `packages/imports-core` literals (`PF-121`, owner `S-E04-7` — they
 * are outside this walk root **by contract**, and AC-2 is scoped to
 * `apps/api/src`). G-TENANT / G-MIGRATION are not triggered: no query, no schema.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'link-integrity-check.js');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');

/** The ONE declaration site. Every rule below is stated relative to it. */
const PROVENANCE_REL = 'apps/api/src/shared/audit/provenance.ts';
/**
 * This file. It is excluded from `G-3` because it necessarily QUOTES the shapes
 * it forbids — the four role names in one array (as the matcher's own input) and
 * copy C's ternary (as `G-7`'s positive control). A guard that matched its own
 * fixtures would be `PF-83` inside the file written to prevent it, and excluding
 * all `*.spec.ts` instead would open exactly the evasion route the pre-mortem
 * names (a second declaration planted in any spec becomes invisible).
 *
 * The exclusion is therefore **two named files**, not a glob, and it is bounded
 * three ways below: both excluded files are asserted to actually TRIP the matcher
 * (so the exclusion is load-bearing rather than decorative), and no production
 * file may import a `*.spec.ts` — so an excluded file cannot be a decision site
 * for any real audit row.
 */
const AUDIT_GATE_REL = 'apps/api/src/shared/quality/audit-provenance-gate.spec.ts';
const G3_EXCLUSIONS = [AUDIT_GATE_REL, PROVENANCE_REL];
const PROVENANCE_PATH = join(API_SRC, 'shared', 'audit', 'provenance.ts');
const BARREL_PATH = join(API_SRC, 'shared', 'audit', 'index.ts');

/** T-0's deleted originals — asserted absent as FILES, not only as declarations. */
const DELETED_ORIGINALS = [
  'apps/api/src/modules/alerts/alert-provenance.ts',
  'apps/api/src/modules/alerts/alert-provenance.spec.ts',
];
const CALENDAR_SEED_PATH = join(API_SRC, 'modules', 'calendar', 'calendar-seed.service.ts');

/* eslint-disable @typescript-eslint/no-require-imports */
// Unguarded on purpose (DNC-08): if the gate script disappears or stops exporting
// its stripper, this suite must fail at LOAD rather than degrade into "nothing to
// check, therefore pass".
const { stripCommentsPreservingLines } = require(SCRIPT_PATH) as {
  stripCommentsPreservingLines: (source: string) => string;
};
/* eslint-enable @typescript-eslint/no-require-imports */

function walk(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;
  const stack = [root];
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

const repoRel = (file: string): string => relative(REPO_ROOT, file).split(sep).join('/');

const API_FILES = walk(API_SRC);
/** Every `.ts` under `apps/api/src`, comment-stripped, keyed by repo-relative path. */
const EXECUTABLE = new Map<string, string>(
  API_FILES.map((file) => [repoRel(file), stripCommentsPreservingLines(readFileSync(file, 'utf8'))]),
);
const PRODUCTION = [...EXECUTABLE].filter(([path]) => !path.endsWith('.spec.ts'));

/* ================================================================== *
 * The matchers — one place, so the rules and the negative control
 * below CANNOT drift apart. A negative control that exercised a
 * second copy of the regex would prove nothing about the rule.
 * ================================================================== */

const ROLES = ['super_admin', 'school_admin', 'teacher', 'parent'] as const;

/** Innermost bracketed literals only — a nested `[[a],[b]]` never counts as one group. */
function bracketGroups(source: string): string[] {
  return source.match(/\[[^[\]]*\]/g) ?? [];
}

/**
 * "This source decides an actor role from realm roles by ORDERING them."
 * True when one bracketed literal names all four realm roles — the shape of a
 * precedence list, whatever the surrounding code calls itself (copies B and C
 * called themselves nothing).
 */
export function declaresRolePrecedenceOrdering(source: string): boolean {
  return bracketGroups(source).some((group) =>
    ROLES.every((role) => group.includes(`'${role}'`) || group.includes(`"${role}"`)),
  );
}

/**
 * "This source decides a PORTAL inline." A `portal:` property whose value is a
 * conditional resolving to a portal name — copy C's ternary, and any re-spelling
 * of it. Deliberately NOT a ban on the word `portal`: `roles.includes('teacher')`
 * authorization checks (`grades.controller.ts:439`) decide access, not a portal,
 * and a rule that reddened on them would be `PF-83` one layer up.
 */
export function declaresInlinePortalDecision(source: string): boolean {
  return /portal:\s*[^,;\n}]*\?[^,;\n}]*(?:'admin'|'teacher'|'parent'|"admin"|"teacher"|"parent")/.test(
    source,
  );
}

const HARDCODED_ACTOR_ROLE = /actorRole:\s*(['"])school_admin\1/;
const HARDCODED_PORTAL = /portal:\s*(['"])admin\1/;

function declarationRegex(name: string): RegExp {
  return new RegExp(`(?:export\\s+)?(?:const|function)\\s+${name}\\b`);
}

/* ================================================================== *
 * The recorded pre-fix sources (AC-7's negative control)
 * ================================================================== */

/** The commit `S-E04-1` forked from — the tree the three copies still lived in. */
const PRE_FIX_REV = 'e218017';
const PRE_FIX_DIR = join(API_SRC, 'shared', 'audit', '__fixtures__', 'pre-fix');

/**
 * fixture → the path it was taken from at `PRE_FIX_REV`, the sha256 of its
 * LF-normalised bytes, and a length floor.
 *
 * The digest is what keeps these *recorded* rather than *authored*: they are the
 * real bytes (`git show e218017:<from>`), and a future edit that trimmed one down
 * to whatever makes a red matcher green again changes the digest, so the tamper is
 * a failing test instead of a silently weakened control. The floor is a second,
 * cruder net for the truncation case (an empty file satisfies no `toBe(true)`, but
 * it must fail *loudly* here, at the integrity check, naming the reason).
 *
 * LF-normalised because `.gitattributes` pins `eol=lf` for these but a checkout
 * that lost the attribute would otherwise change every digest on Windows.
 */
const PRE_FIX_SOURCES = {
  'analytics.controller.ts.txt': {
    from: 'apps/api/src/modules/analytics/analytics.controller.ts',
    sha256: 'bc6fd58d95f55c3f071e420378799ca9bb362838effeb3546cc68c207e375de1',
    minLength: 11_000,
  },
  'grades.controller.ts.txt': {
    from: 'apps/api/src/modules/grades/grades.controller.ts',
    sha256: '91ca89f6a649c14bcae1a47629754d7c4da90adc2288f6d02f7124a1512fe0b3',
    minLength: 19_000,
  },
  'alert-provenance.ts.txt': {
    from: 'apps/api/src/modules/alerts/alert-provenance.ts',
    sha256: '57a2eb0eba7e154cd8763e8a6e7bd3ec08a13e6e68052394cb4344e71175d2bc',
    minLength: 1_500,
  },
} as const;

type PreFixFixture = keyof typeof PRE_FIX_SOURCES;

/**
 * Unguarded on purpose (DNC-08): a missing or unreadable fixture must fail at
 * read, never degrade into "nothing recorded, therefore pass".
 */
function preFixBytes(fixture: PreFixFixture): string {
  return readFileSync(join(PRE_FIX_DIR, fixture), 'utf8').replace(/\r\n/g, '\n');
}

/** The same stripper every other read in this file goes through (`PF-83`). */
function preFix(fixture: PreFixFixture): string {
  return stripCommentsPreservingLines(preFixBytes(fixture));
}

/* ================================================================== *
 * G-1 — the vacuity floor, FIRST. A guard that walked nothing
 * satisfies every `not.toMatch` below forever.
 * ================================================================== */

describe('G-1 — the guard is not vacuous', () => {
  it('walked apps/api/src and found a real application', () => {
    // Measured 2026-08-08 on this branch: 210 `.ts` files, 154 of them non-spec.
    // The floors are below the measurement so a legitimate deletion does not go
    // red, and far above zero so an empty walk cannot pass.
    expect(API_FILES.length).toBeGreaterThanOrEqual(200);
    expect(PRODUCTION.length).toBeGreaterThanOrEqual(150);
    expect(EXECUTABLE.size).toBe(API_FILES.length);
  });

  it('the stripper it borrows really strips, and really preserves length', () => {
    const source = ["// actorRole: 'school_admin' is what this file no longer writes", "const x = 'keep';"].join(
      '\n',
    );
    const stripped = stripCommentsPreservingLines(source);
    expect(stripped).toHaveLength(source.length);
    expect(HARDCODED_ACTOR_ROLE.test(stripped)).toBe(false);
    expect(stripped).toContain("'keep'");
  });

  it('the declaration site itself is present and non-empty', () => {
    expect(existsSync(PROVENANCE_PATH)).toBe(true);
    expect(EXECUTABLE.get(PROVENANCE_REL)?.length ?? 0).toBeGreaterThan(500);
  });
});

/* ================================================================== *
 * G-2 (AC-2) — zero literals left in production code
 * ================================================================== */

describe('G-2 / AC-2 — no hard-coded actorRole or portal remains in apps/api/src', () => {
  it("declares no actorRole: 'school_admin' outside *.spec.ts", () => {
    const offenders = PRODUCTION.filter(([, source]) => HARDCODED_ACTOR_ROLE.test(source)).map(
      ([path]) => path,
    );
    expect(offenders).toEqual([]);
  });

  it('G-7 positive control — the actorRole regex DOES match the literal it forbids', () => {
    expect(HARDCODED_ACTOR_ROLE.test("        actorRole: 'school_admin',")).toBe(true);
    expect(HARDCODED_ACTOR_ROLE.test('        actorRole: "school_admin",')).toBe(true);
    expect(HARDCODED_ACTOR_ROLE.test('        actorRole,')).toBe(false);
  });

  it("no production file DECIDES a portal by writing 'admin' — and now none reads one either", () => {
    // FLIPPED BACK, exactly as the S-E04-4 inversion said it would be — and by
    // the protocol that inversion wrote down, not by deleting the case.
    //
    // The history, because the count has now moved twice and the reason matters
    // more than the number:
    //
    //  * `S-E04-1` measured exactly ONE surviving literal and stated the rule
    //    over its SHAPE (a `where:` filter, never a write) rather than over a
    //    path, so a future WRITE added to `analytics.service.ts` could not hide
    //    behind a file exclusion. That literal was the `adminLogins` KPI query.
    //  * `S-E04-4` measured that **no call site writes any login action** and no
    //    legacy row carries the substring, so the card could only ever read 0 —
    //    a live DNC-09 violation. It stopped issuing the query and reported
    //    `adminLogins: null` («Non instrumenté»), and the filter went with it,
    //    so the case was inverted to length 0.
    //  * The same run's escalation panel then found that the re-armable branch
    //    had silently dropped the scope (`PF-138`): the query that wakes up when
    //    `AUDIT_LOGIN_ACTIONS` gains a code would have counted teacher, parent
    //    and student logins behind a card labelled « CONNEXIONS ADMIN ». Scope
    //    restored in the same run, so the literal is back — as a FILTER.
    //  * `S-E04-5` **removed the card**. « Connexions admin » was honest about
    //    being un-instrumented, but it spent a quarter of a governance surface
    //    on a sentence that could never become a number, and « Acteurs
    //    distincts » — computed over the table's own `where` — took the slot.
    //    The dormant query went with it, so PF-138 closes **by deletion**, not
    //    by a fix, and the count returns to 0. Real login/session auditing is
    //    owned by V3-E05 (PF-26).
    //
    // The invariant never moved, and this is its third measurement rather than
    // its third rewrite: no production file under `apps/api/src` DECIDES a
    // portal by writing the literal `'admin'`. A read-side `where:` filter was
    // legal and pinned by shape while one existed; a write is not, at any count.
    // The shape rule is kept below as a POSITIVE CONTROL so that going to zero
    // did not turn this case into a rule that checks nothing (DNC-08).
    const occurrences: { path: string; line: string }[] = [];
    for (const [path, source] of PRODUCTION) {
      for (const line of source.split(/\r?\n/)) {
        if (HARDCODED_PORTAL.test(line)) occurrences.push({ path, line: line.trim() });
      }
    }
    expect(occurrences).toEqual([]);
    // The scan itself still works: PRODUCTION is populated, and the matcher
    // still finds the literal when it is present. Without these two, `[]` above
    // would also be the result of scanning nothing with a broken regex.
    expect(PRODUCTION.length).toBeGreaterThan(10);
    expect(HARDCODED_PORTAL.test("      where: { tenantId, portal: 'admin' },")).toBe(true);
  });

  it('G-7 positive control — the portal regex DOES match a write-shaped literal', () => {
    expect(HARDCODED_PORTAL.test("        portal: 'admin',")).toBe(true);
    expect(HARDCODED_PORTAL.test('        portal: "admin",')).toBe(true);
    expect(HARDCODED_PORTAL.test('        portal,')).toBe(false);
  });
});

/* ================================================================== *
 * G-3 (AC-1 / AC-7) — the load-bearing rule: one DECISION, stated
 * over the invariant, never over an identifier name
 * ================================================================== */

describe('G-3 / AC-1 — exactly one file in apps/api/src decides an actor role from realm roles', () => {
  it('the only role-precedence ordering in the whole app is provenance.ts', () => {
    const offenders = [...EXECUTABLE]
      .filter(([path, source]) => !G3_EXCLUSIONS.includes(path) && declaresRolePrecedenceOrdering(source))
      .map(([path]) => path);
    // Spec files are INCLUDED here, deliberately: the exclusion is two NAMED files
    // rather than a `*.spec.ts` glob. A test that re-declares the ordering asserts
    // against its own copy instead of the shipped one — the `S-E06-5` failure at
    // test level. A future test that needs per-role coverage must drive
    // `deriveAuditProvenance` once per role (see `shared/audit/provenance.spec.ts`
    // and `shared/audit/provenance-callsites.spec.ts`, neither of which lists the
    // four roles in one array), never re-list the four in one bracketed literal.
    expect(offenders).toEqual([]);
  });

  it('both G-3 exclusions really DO trip the matcher — the exclusion is load-bearing', () => {
    // If either stopped tripping it, the exclusion would be silently protecting
    // nothing and could be deleted; if BOTH stopped, the matcher itself is broken.
    for (const path of G3_EXCLUSIONS) {
      expect(declaresRolePrecedenceOrdering(EXECUTABLE.get(path) ?? '')).toBe(true);
    }
    expect(G3_EXCLUSIONS).toHaveLength(2);
  });

  it('no production file imports a *.spec.ts — an excluded file decides no real audit row', () => {
    const offenders = PRODUCTION.filter(([, source]) =>
      /(?:from|require\()\s*['"][^'"]*\.spec['"]/.test(source),
    ).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('no file decides a portal inline', () => {
    const offenders = [...EXECUTABLE]
      .filter(([path, source]) => path !== AUDIT_GATE_REL && declaresInlinePortalDecision(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('G-7 positive control — both matchers fire on the exact copies B and C, in reverse order too', () => {
    expect(
      declaresRolePrecedenceOrdering(
        "const r = ['parent', 'teacher', 'school_admin', 'super_admin'].find((x) => roles.includes(x));",
      ),
    ).toBe(true);
    expect(
      declaresInlinePortalDecision(
        "portal: actorRole === 'teacher' ? 'teacher' : actorRole ? 'admin' : null,",
      ),
    ).toBe(true);
    // …and NOT on the authorization checks that legitimately read roles, nor on a
    // threaded value. A rule that reddened on these would be PF-83 / R-30.
    expect(declaresRolePrecedenceOrdering("if (roles.includes('teacher')) return;")).toBe(false);
    expect(declaresInlinePortalDecision('portal,')).toBe(false);
    expect(declaresInlinePortalDecision('portal: provenance.portal,')).toBe(false);
  });

  it.each(Object.keys(PRE_FIX_SOURCES) as PreFixFixture[])(
    "AC-7 integrity — the recorded pre-fix fixture %s is intact (sha256 as taken from e218017)",
    (fixture) => {
      const { sha256, minLength, from } = PRE_FIX_SOURCES[fixture];
      const bytes = preFixBytes(fixture);
      // Named in the failure so a reader is not left guessing which evidence moved:
      // the fixture is `git show e218017:<from>` and nothing else.
      expect({ fixture, from, length: bytes.length >= minLength }).toEqual({
        fixture,
        from,
        length: true,
      });
      expect(createHash('sha256').update(bytes, 'utf8').digest('hex')).toBe(sha256);
    },
  );

  it('AC-7 — the fixture directory contributes NOTHING to the walk (it is evidence, not code)', () => {
    // The extension is `.ts.txt` precisely so these three copies are not collected
    // by `walk()` and not compiled by ts-jest/tsc. If someone renames one to `.ts`,
    // G-3 above reports it as an offender — fail-closed, but permanently red — so
    // assert the arrangement here, where the message can explain it.
    expect(existsSync(PRE_FIX_DIR)).toBe(true);
    const walked = [...EXECUTABLE.keys()].filter((path) => path.includes('__fixtures__/pre-fix'));
    expect(walked).toEqual([]);
    expect(PRE_FIX_REV).toBe('e218017');
  });

  it('AC-7 negative control — the SAME matchers FLAGGED all three pre-fix copies', () => {
    // This is the assertion that separates this guard from a name-based one. The
    // three inputs are the real pre-fix bytes recorded from `git show e218017:…`
    // (digests pinned by the case above), so it cannot be satisfied by a string the
    // author invented — and, unlike the `git show HEAD:` form it replaces, it does
    // not invert the moment this slice is committed.
    const analytics = preFix('analytics.controller.ts.txt');
    const grades = preFix('grades.controller.ts.txt');
    const alerts = preFix('alert-provenance.ts.txt');

    // Copy B — anonymous inline array, no portal derivation of its own.
    expect(declaresRolePrecedenceOrdering(analytics)).toBe(true);
    // Copy C — the anonymous array AND the contradicting portal ternary.
    expect(declaresRolePrecedenceOrdering(grades)).toBe(true);
    expect(declaresInlinePortalDecision(grades)).toBe(true);
    // Copy A — the named one, in a feature module.
    expect(declaresRolePrecedenceOrdering(alerts)).toBe(true);

    // …and all three are gone from the working tree.
    expect(declaresRolePrecedenceOrdering(EXECUTABLE.get('apps/api/src/modules/analytics/analytics.controller.ts') ?? '')).toBe(false);
    expect(declaresRolePrecedenceOrdering(EXECUTABLE.get('apps/api/src/modules/grades/grades.controller.ts') ?? '')).toBe(false);
    expect(declaresInlinePortalDecision(EXECUTABLE.get('apps/api/src/modules/grades/grades.controller.ts') ?? '')).toBe(false);
  });
});

/* ================================================================== *
 * G-4 (AC-1) — the sanitisers are declared exactly once
 * ================================================================== */

describe('G-4 / AC-1 — the four helpers are DECLARED in provenance.ts and nowhere else', () => {
  it.each([
    'MAX_USER_AGENT_LENGTH',
    'sanitiseInetOrNull',
    'truncateUserAgent',
    'deriveAuditProvenance',
    'deriveAlertActorProvenance',
  ])('%s is declared in exactly one file, and it is provenance.ts', (name) => {
    const regex = declarationRegex(name);
    const declaring = [...EXECUTABLE].filter(([, source]) => regex.test(source)).map(([path]) => path);
    expect(declaring).toEqual([PROVENANCE_REL]);
  });

  it('G-7 positive control — the declaration regex matches a declaration and NOT a mention', () => {
    // The positive half uses a SYNTHETIC name on purpose: spelling
    // `function sanitiseInetOrNull(` here would plant a second "declaration" in
    // this very file and turn the rule above red — the self-poisoning shape the
    // pre-mortem names. The regex is built the same way for both, so the control
    // still exercises the real construction.
    const probe = declarationRegex('sanitiseInetOrNullProbe');
    expect(probe.test('export function sanitiseInetOrNullProbe(raw: string | null) {')).toBe(true);
    expect(probe.test('const sanitiseInetOrNullProbe = (raw) => raw;')).toBe(true);
    // Every importer MENTIONS the real name; only the home declares it.
    const real = declarationRegex('sanitiseInetOrNull');
    expect(real.test("import { sanitiseInetOrNull } from '../../shared/audit/provenance';")).toBe(false);
    expect(real.test('ipAddress: sanitiseInetOrNull(ip),')).toBe(false);
  });

  it('the barrel re-exports and declares nothing of its own', () => {
    const barrel = stripCommentsPreservingLines(readFileSync(BARREL_PATH, 'utf8'));
    expect(barrel).toMatch(/from '\.\/provenance'/);
    expect(barrel).not.toMatch(/(?:export\s+)?(?:const|function)\s+\w/);
  });
});

/* ================================================================== *
 * G-5 (AC-9) — T-0's originals are GONE, and no shim replaced them
 * ================================================================== */

describe('G-5 / AC-9 — the old homes do not exist, and nothing re-exports them', () => {
  it.each(DELETED_ORIGINALS)('%s does not exist as a FILE', (path) => {
    // Asserted separately from declaration absence on purpose: a re-export shim
    // satisfies "declares nothing" while keeping the old import path alive, and a
    // live old path is how a second copy grows back (pre-mortem #1).
    expect(existsSync(join(REPO_ROOT, path))).toBe(false);
  });

  it('no file under apps/api/src imports or re-exports from an alert-provenance path', () => {
    const offenders = [...EXECUTABLE]
      .filter(([, source]) => /(?:from|require\()\s*['"][^'"]*alert-provenance['"]/.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('calendar-seed.service.ts declares none of the three sanitiser helpers, and still exists', () => {
    expect(existsSync(CALENDAR_SEED_PATH)).toBe(true);
    const source = stripCommentsPreservingLines(readFileSync(CALENDAR_SEED_PATH, 'utf8'));
    for (const name of ['MAX_USER_AGENT_LENGTH', 'sanitiseInetOrNull', 'truncateUserAgent']) {
      expect(declarationRegex(name).test(source)).toBe(false);
    }
    // The file stays — only the helpers moved out of the FEATURE module.
    expect(source).toMatch(/export class CalendarSeedService/);
    expect(declarationRegex('resolveAcademicYearId').test(source)).toBe(true);
  });

  it('AC-10 (S-E04-3 restatement) — calendar.controller.ts reaches provenance through the SEAM', () => {
    // RESTATED, NOT DELETED. `S-E04-1` pinned the literal decorators `@Ip()` /
    // `@Headers('user-agent')` because at that moment they were the only real
    // client capture in the repository, and routing them through a function that
    // returned null by decision would have REDUCED what the site records. That
    // promise — this slice must not reduce what any site records — is the
    // invariant, and it survives the move; the decorators were only ever its
    // implementation. `S-E04-3` replaces them with `extractAuditClientHints`,
    // which returns MORE than `@Ip()` did on the UI-driven path (the operator's
    // address instead of the web container's) and never less.
    //
    // So the rule is now stated over the property: the handler still derives
    // BOTH fields from the shared seam, still hands the service a pre-sanitised
    // pair (the `S-E06-6` reason: a failed `inet` cast must not roll back the
    // transaction it audits), and the old per-call-site header reads are GONE —
    // asserted in the negative, because a leftover `@Ip()` beside the seam would
    // be a second, contradicting capture.
    const controller = EXECUTABLE.get('apps/api/src/modules/calendar/calendar.controller.ts') ?? '';
    expect(controller).not.toBe('');
    expect(controller).toMatch(/extractAuditClientHints\(req\)/);
    expect(controller).toMatch(/from '\.\.\/\.\.\/shared\/audit\/client-hints'/);
    expect(controller).toMatch(/ipAddress,/);
    expect(controller).toMatch(/userAgent,/);
    // The per-call-site capture the ADR wanted replaced by ONE seam.
    expect(controller).not.toMatch(/@Ip\(\)/);
    expect(controller).not.toMatch(/@Headers\('user-agent'\)/);
  });

  it('AC-4 — a SECOND, /admin-reachable UI-driven write now carries provenance end-to-end', () => {
    // One site proves the seam compiles; it does not prove the slice is usable.
    // `PUT /api/v1/subjects/coefficients/matrix` is driven from
    // `apps/web/src/app/admin/subjects/actions.ts` through the shared server
    // seam, with the demo admin credentials and no new UI — so AC-4's "UI-driven
    // audited write" is reachable by a human, not only by a test.
    const subjects =
      EXECUTABLE.get('apps/api/src/modules/school-structure/subjects.controller.ts') ?? '';
    expect(subjects).not.toBe('');
    expect(subjects).toMatch(/extractAuditClientHints\(req\)/);
    expect(subjects).toMatch(/deriveAuditProvenance\(\s*jwt,/);
    // S-E04-7 AMENDED this needle rather than deleting it. The row is still
    // written inside the same transaction carrying the same four provenance
    // fields; it goes through the shared seam now (`writeAudit`), which is the
    // property `ADR-035` D1 exists to make true. Asserting the old spelling would
    // make a successful migration read as a regression.
    expect(subjects).toMatch(/writeAudit\(tx, \{/);
    expect(subjects).toMatch(/ipAddress,/);
    expect(subjects).toMatch(/userAgent,/);
  });
});

/* ================================================================== *
 * G-6 (AC-6 / DNC-10) — no off switch, structurally
 * ================================================================== */

describe('G-6 / AC-6 / DNC-10 — nothing can change what deriveAuditProvenance returns', () => {
  const source = () => EXECUTABLE.get(PROVENANCE_REL) ?? '';

  it.each(['process.env', 'ConfigService', 'NODE_ENV', 'featureFlag', 'getFlag('])(
    'provenance.ts contains no %s read',
    (needle) => {
      expect(source()).not.toContain(needle);
    },
  );

  it('reads no request, no header and no socket address — the purity is structural (ADR-036 D5)', () => {
    // THESE FOUR ARE THE INVARIANT THAT SURVIVES S-E04-3, VERBATIM. The
    // extraction moved to `client-hints.ts`; the purity did not move with it.
    // `provenance.ts` is the one place every audit write funnels through, and if
    // a request were in scope there the next author would wire `req.ip` in — the
    // option ADR-036 D5 refuses structurally rather than by convention.
    const s = source();
    expect(s).not.toMatch(/\breq\.ip\b/);
    expect(s).not.toMatch(/x-forwarded-for/i);
    expect(s).not.toMatch(/\bheaders\b/);
    expect(s).not.toMatch(/trust proxy/);
  });

  it('AC-10 — the second parameter is NARROWED to AuditClientHints, never widened back', () => {
    // RESTATED, NOT DELETED. Until S-E04-3 this pinned the literal
    // `(jwt: KeycloakJwtPayload, _req?: unknown)` — a shape whose whole point was
    // that nothing switchable was in scope. The narrowing is the one-line change
    // ADR-036 D5 reserved the parameter for, and the rule is pinned again on the
    // NEW shape so that a future widening back to `unknown` (or, worse, to
    // `Request`) is a RED test rather than a quiet regression.
    const s = source();
    expect(s).toMatch(/deriveAuditProvenance\(\s*jwt: KeycloakJwtPayload,\s*hints\?: AuditClientHints,?\s*\)/);
    expect(s).not.toMatch(/_req\?: unknown/);
    expect(s).not.toMatch(/hints\?: unknown/);
    expect(s).not.toMatch(/:\s*Request\b/);
    // The type arrives as a TYPE, so no runtime require() cycle is closed and no
    // header read is carried into scope with it.
    expect(s).toMatch(/import type \{ AuditClientHints \} from '\.\/client-hints'/);
  });

  it('AC-10 — provenance.ts never INVENTS a value: the only producers are `hints?.x ?? null`', () => {
    // RESTATED, NOT DELETED. The old form counted `ipAddress: null` twice, which
    // was the executable shape of "returned null unconditionally by decision".
    // Both branches now carry the hints, so the surviving property is the one
    // that actually mattered: this file neither reads, normalises, defaults nor
    // guesses a provenance value — it forwards what the seam already sanitised.
    const s = source();
    expect(s).toMatch(/const ipAddress = hints\?\.ipAddress \?\? null;/);
    expect(s).toMatch(/const userAgent = hints\?\.userAgent \?\? null;/);
    // No second source: no literal address, no sanitiser call, no fallback.
    expect(s).not.toMatch(/sanitiseInetOrNull\(\s*hints/);
    expect(s).not.toMatch(/ipAddress:\s*['"]/);
    expect(s).not.toMatch(/ipAddress:\s*hints\?\.ipAddress \?\? [^n]/);
  });

  it('exports EXACTLY the four public functions — no *Unsafe sibling can appear unnoticed', () => {
    const exported = [...source().matchAll(/export function (\w+)/g)].map((m) => m[1]).sort();
    expect(exported).toEqual([
      'deriveAlertActorProvenance',
      'deriveAuditProvenance',
      'sanitiseInetOrNull',
      'truncateUserAgent',
    ]);
  });

  it('ROLE_PRECEDENCE and ROLE_PORTAL stay module-private — no caller can fork the map', () => {
    const s = source();
    expect(s).toMatch(/^const ROLE_PRECEDENCE/m);
    expect(s).toMatch(/^const ROLE_PORTAL/m);
    expect(s).not.toMatch(/export const ROLE_PRECEDENCE/);
    expect(s).not.toMatch(/export const ROLE_PORTAL/);
  });

  it('does NOT import REALM_ROLES from @pilotage/contracts (a set is not an ordering)', () => {
    // `packages/contracts/src/enums/index.ts` declares the same four strings in the
    // same order today, by accident. Importing it would make a harmless reorder of
    // a display list silently reorder audit attribution.
    expect(source()).not.toContain('REALM_ROLES');
  });
});

/* ================================================================== *
 * G-AUDIT (partial) — every edited write site still writes a row
 * ================================================================== */

describe('G-AUDIT — the touched write sites still write their audit row, with a derived value', () => {
  /**
   * S-E04-7 — the needle is "writes an audit row", not "spells `auditLog.create`".
   *
   * Six of these eight sites moved onto the shared seam in S-E04-7, so the literal
   * `auditLog.create` is gone from them. What this suite exists to prove is
   * unchanged and is still proven: the row is still written, and the value in it
   * is still DERIVED rather than hard-coded. Asserting the old spelling would have
   * made a successful migration read as a regression — and the fix a reviewer
   * would reach for is to un-migrate, which is the wrong direction.
   *
   * The two that did NOT move (`snapshot-ops`, `grades`) are baselined in
   * `scripts/audit-write-baseline.json` with an owning finding, so their old
   * spelling is still the true one and the alternation covers both honestly.
   */
  const WRITES_AN_AUDIT_ROW = /auditLog\.create|writeAudit\(/;
  const WRITE_SITES: [string, RegExp][] = [
    ['apps/api/src/modules/identity/invite.controller.ts', WRITES_AN_AUDIT_ROW],
    ['apps/api/src/modules/identity/roles.controller.ts', WRITES_AN_AUDIT_ROW],
    ['apps/api/src/modules/imports/imports.service.ts', WRITES_AN_AUDIT_ROW],
    ['apps/api/src/modules/integrations/integrations.service.ts', WRITES_AN_AUDIT_ROW],
    ['apps/api/src/modules/school-structure/academic-years.controller.ts', WRITES_AN_AUDIT_ROW],
    ['apps/api/src/modules/school-structure/subjects.controller.ts', WRITES_AN_AUDIT_ROW],
    ['apps/api/src/modules/analytics/snapshot-ops.service.ts', WRITES_AN_AUDIT_ROW],
    ['apps/api/src/modules/grades/grades.controller.ts', WRITES_AN_AUDIT_ROW],
  ];

  it.each(WRITE_SITES)('%s still writes an audit row', (path, needle) => {
    expect(EXECUTABLE.get(path) ?? '').toMatch(needle);
  });

  it('roles.controller.ts still writes THREE audit rows (create / update / delete)', () => {
    const source = EXECUTABLE.get('apps/api/src/modules/identity/roles.controller.ts') ?? '';
    // S-E04-7: three rows, each now INSIDE the transaction that performs the
    // mutation. The direct spelling is gone from this file entirely, and that is
    // asserted in the negative so a regression to two statements is loud.
    expect((source.match(/writeAudit\(tx, \{/g) ?? []).length).toBe(3);
    expect(source).not.toMatch(/auditLog\.create/);
    expect((source.match(/deriveAuditProvenance\(jwt\)/g) ?? []).length).toBe(3);
  });

  it('every edited handler file reads the derivation from the shared home', () => {
    const CONSUMERS = [
      'apps/api/src/modules/identity/invite.controller.ts',
      'apps/api/src/modules/identity/roles.controller.ts',
      'apps/api/src/modules/imports/imports.controller.ts',
      'apps/api/src/modules/integrations/integrations.controller.ts',
      'apps/api/src/modules/school-structure/academic-years.controller.ts',
      'apps/api/src/modules/school-structure/subjects.controller.ts',
      'apps/api/src/modules/analytics/analytics.controller.ts',
      'apps/api/src/modules/grades/grades.controller.ts',
    ];
    for (const path of CONSUMERS) {
      expect(EXECUTABLE.get(path) ?? '').toMatch(/from '\.\.\/\.\.\/shared\/audit\/provenance'/);
    }
  });

  it('the two services take the provenance as a NON-OPTIONAL widened actor seam', () => {
    // Non-optional so a missed caller is a compile error, never a null at runtime
    // (pre-mortem #5). Asserted on source because a type is not observable at
    // runtime — the compile-time half is the typecheck gate's.
    for (const path of [
      'apps/api/src/modules/imports/imports.service.ts',
      'apps/api/src/modules/integrations/integrations.service.ts',
    ]) {
      const source = EXECUTABLE.get(path) ?? '';
      expect(source).toMatch(/&\s*AuditActorProvenance/);
      expect(source).not.toMatch(/AuditActorProvenance\s*\|\s*undefined/);
      expect(source).not.toMatch(/Partial<AuditActorProvenance>/);
    }
  });

  it('snapshot-ops.service.ts takes portal as a threaded argument, not a literal', () => {
    const source = EXECUTABLE.get('apps/api/src/modules/analytics/snapshot-ops.service.ts') ?? '';
    expect(source).toMatch(/portal: string \| null;/);
    expect(HARDCODED_PORTAL.test(source)).toBe(false);
    // No system-provenance constant was introduced: the brief's "no JWT in scope"
    // caveat was falsified — `enqueueRebuild` has exactly one caller and it is an
    // HTTP handler carrying `@CurrentJwt()`.
    expect(EXECUTABLE.get(PROVENANCE_REL) ?? '').not.toContain('SYSTEM_AUDIT_PROVENANCE');
  });
});

/* ================================================================== *
 * ADR-036 (AC-4, AC-5) — the decision is on the record
 * ================================================================== */

describe('ADR-036 — pinned hop count, blanket XFF refused, S-E04-3 named as owner', () => {
  const ADR_PATH = join(
    REPO_ROOT,
    'docs',
    'adr',
    'ADR-036-client-provenance-behind-the-reverse-proxy.md',
  );
  const adr = () => readFileSync(ADR_PATH, 'utf8');

  it('exists', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  it('AC-4 — pins a hop count PER TOPOLOGY and names what it could not establish', () => {
    const text = adr();
    expect(text).toMatch(/N = 2/);
    expect(text).toMatch(/N = 0/);
    expect(text).toMatch(/does \*\*not\*\* establish|does not establish/);
    expect(text).toMatch(/outside this repository/);
  });

  it('AC-4 — refuses blanket X-Forwarded-For trust IN WRITING, with the reason', () => {
    const text = adr();
    expect(text).toMatch(/trust proxy/);
    expect(text).toMatch(/refused/i);
    expect(text).toMatch(/forgeable/i);
    expect(text).toMatch(/strictly worse than/i);
  });

  it('AC-5 — states the API cannot see client IP/UA until apps/web forwards them, and names S-E04-3', () => {
    const text = adr();
    expect(text).toMatch(/apps\/web/);
    expect(text).toMatch(/S-E04-3/);
  });

  it('AC-11 (S-E04-3 inversion) — main.ts applies the hop count ONCE, from the shared applier', () => {
    // INVERTED, NOT DELETED. `S-E04-1` asserted `main.ts` contains no
    // `trust proxy` — true of the slice that wrote the ADR, and the assertion
    // this slice exists to falsify. The surviving invariant is the one the
    // absence was standing in for: the hop count is never chosen HERE. `main.ts`
    // calls the one exported applier, which reads the declared key; it holds no
    // literal, no `true`, no `'*'`.
    const main = EXECUTABLE.get('apps/api/src/main.ts') ?? '';
    expect(main).not.toBe('');
    expect(main).toMatch(/applyTrustProxy\(app, process\.env\)/);
    expect((main.match(/applyTrustProxy\(/g) ?? []).length).toBe(1);
    // The decision is not re-taken here: no `app.set('trust proxy', …)` in main.
    expect(main).not.toMatch(/set\(\s*['"]trust proxy['"]/);
    expect(main).not.toMatch(/trust proxy['"],\s*(?:true|'\*'|"\*")/);
  });

  it('AC-6 — the hop count is read from a DECLARED, boot-refusing key, never coerced', () => {
    const preflight = EXECUTABLE.get('apps/api/src/shared/config/config-preflight.ts') ?? '';
    expect(preflight).toMatch(/'TRUST_PROXY_HOPS'/);
    const parser = EXECUTABLE.get('apps/api/src/shared/config/trust-proxy.ts') ?? '';
    expect(parser).not.toBe('');
    // ADR-036 D3's forbidden shape, in every spelling it could take.
    for (const forbidden of [
      /Number\(\s*process\.env/,
      /process\.env\.TRUST_PROXY_HOPS\s*\?\?/,
      /TRUST_PROXY_HOPS\]\s*\?\?/,
      /\?\?\s*['"]?\d/,
      /\|\|\s*['"]?\d/,
    ]) {
      expect(parser).not.toMatch(forbidden);
    }
    // Strict, and bounded — an unbounded count is `trust proxy: true` by another
    // name, because Express pads and the leftmost (caller-chosen) entry wins.
    expect(parser).toMatch(/\^\\d\+\$/);
    expect(parser).toMatch(/MAX_TRUST_PROXY_HOPS/);
  });
});

/* ================================================================== *
 * S-E04-3 — the mirror guards for the NEW extraction seam
 * ================================================================== */

describe('S-E04-3 / DNC-10 — client-hints.ts is the ONE seam, and it has no off switch', () => {
  const CLIENT_HINTS_REL = 'apps/api/src/shared/audit/client-hints.ts';
  const TRUST_PROXY_REL = 'apps/api/src/shared/config/trust-proxy.ts';
  const seam = () => EXECUTABLE.get(CLIENT_HINTS_REL) ?? '';

  it('exists and is not empty — the vacuity floor for every rule below', () => {
    expect(seam().length).toBeGreaterThan(500);
    expect((EXECUTABLE.get(TRUST_PROXY_REL) ?? '').length).toBeGreaterThan(500);
  });

  it.each(['process.env', 'ConfigService', 'NODE_ENV', 'featureFlag', 'getFlag(', 'SKIP_', 'ALLOW_', 'BYPASS_', 'FORCE_'])(
    'client-hints.ts contains no %s',
    (needle) => {
      // Stated as ZERO env reads, which is stronger than the "exactly one key"
      // the design allowed for: the hop count AND the forward token are handed
      // to this file by argument from `main.ts`, so there is no key to override
      // here and no second source of truth for N.
      expect(seam()).not.toContain(needle);
    },
  );

  it('does not decide the hop count — the seam knows nothing about N', () => {
    // The blanket-form and hop-literal absences live in ONE home,
    // `trust-proxy-dnc10-gate.spec.ts`, with their companion red control. Two
    // homes for one rule is exactly the shape S-E04-1 spent a slice collapsing.
    expect(seam()).not.toMatch(/trust proxy/);
    expect(seam()).not.toMatch(/TRUST_PROXY/);
    const setters = PRODUCTION.filter(([, s]) => /\.set\(\s*['"]trust proxy['"]/.test(s)).map(
      ([path]) => path,
    );
    expect(setters).toEqual([TRUST_PROXY_REL]);
  });

  it('G-AUTHZ (structural) — the seam is not reachable from the guard chain', () => {
    // The behavioural half (valid forward token + no Bearer ⇒ 401) lives with the
    // auth suite. This is the half a behavioural test cannot give: the token
    // CANNOT influence authorisation, tenant resolution or role derivation,
    // because the only files that import the seam are HTTP handlers — invoked
    // AFTER the guards have already decided.
    const importers = PRODUCTION.filter(([, s]) =>
      /(?:from|require\()\s*['"][^'"]*audit\/client-hints['"]/.test(s),
    ).map(([path]) => path);
    expect(importers.length).toBeGreaterThan(0);
    for (const path of importers) {
      expect(path).not.toMatch(/\/shared\/auth\//);
      expect(path).not.toMatch(/\.guard\.ts$/);
      expect(path).not.toMatch(/\.strategy\.ts$/);
      expect(path).not.toMatch(/\.middleware\.ts$/);
      expect(path).not.toMatch(/\.interceptor\.ts$/);
    }
    // No interceptor was built (the standing ruling at calendar.controller.ts).
    expect(seam()).not.toMatch(/NestInterceptor|@Injectable\(\)/);
  });

  it('G-AUTHZ — the forward token never becomes an output: no log, no message, no echo', () => {
    const s = seam();
    expect(s).not.toMatch(/console\./);
    expect(s).not.toMatch(/logger/i);
    expect(s).not.toMatch(/setAttribute|span\./);
    // The configured token is kept as a DIGEST, never as the raw string, so it
    // is not a value that can be echoed by accident.
    expect(s).toMatch(/forwardTokenDigest/);
    expect(s).toMatch(/timingSafeEqual/);
    // main.ts logs the PRESENCE, never the value: the raw token is read at
    // exactly one place, and that place is the argument of the configure call.
    const main = EXECUTABLE.get('apps/api/src/main.ts') ?? '';
    expect(main).not.toMatch(/\$\{[^}]*AUDIT_FORWARD_TOKEN[^}]*\}/);
    expect((main.match(/process\.env\[AUDIT_FORWARD_TOKEN_ENV\]/g) ?? []).length).toBe(1);
    expect(main).toMatch(/forwardToken: process\.env\[AUDIT_FORWARD_TOKEN_ENV\],/);
    // Only the boolean derived from it is ever interpolated into a message.
    expect(main).toMatch(/\$\{forwardTokenConfigured \?/);
  });

  it('AC-3 — the token branch NEVER falls back to the relay: req.ip and x-real-ip are refused there', () => {
    const s = seam();
    // `req.ip` appears exactly once in this file, and it is on branch 2 (the
    // no-forwarder branch). `x-real-ip` is never read at all — it is the subtler
    // trap, because nginx sets it on every request including the prod hairpin.
    expect((s.match(/req\.ip/g) ?? []).length).toBe(1);
    expect(s).not.toMatch(/['"]x-real-ip['"]/);
  });
});
