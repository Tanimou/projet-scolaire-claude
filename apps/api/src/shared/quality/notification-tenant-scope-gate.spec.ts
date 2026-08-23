import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * S-E05-4 / PF-11 / ADR-068 — the ratchet that keeps the notification seam
 * tenant-scoped.
 *
 * THE RULE, IN ONE LINE
 * ---------------------
 * Every Prisma call on a `Notification*` model that takes a FILTER `where` must
 * carry `tenantId` in that filter — at the top level, or on every branch of an
 * `OR`. `ADR-068` records the decision; this file is its executed half.
 *
 * WHAT WENT WRONG
 * ---------------
 * `NotificationsService.createMany`'s source-dedup query filtered on
 * `userProfileId`, `sourceType` and `sourceId` with no tenant key anywhere,
 * while its own docblock claimed the dedup ran *"within the same tenant"*. It
 * was the ONLY `notification` query in either app that carried no tenant — the
 * four worker siblings that copy the same idea all carry one, and the worker's
 * comment even says it *"mirrors NotificationsService.createMany"*, which was
 * false in the one respect that mattered. That is `PF-11`, and a defect removed
 * without a ratchet comes back.
 *
 * The same pass found the softer form one file over: `preferences.service.ts`
 * spread its tenant in conditionally on four batch resolvers whose parameter was
 * OPTIONAL. Prisma drops an `undefined` key from a `where`, so an omitted
 * argument silently widened the query to every tenant — the absent-key fail-open
 * `ADR-065 §D5` names and forbids. Those parameters are now required, and this
 * gate is what stops the shape returning.
 *
 * PARSED, NEVER GREPPED
 * ---------------------
 * `hermetic-spec-writers-gate.spec.ts:26-34` already establishes the doctrine: a
 * text scan is beaten by an occurrence inside a STRING LITERAL, and the only way
 * to green it again is to weaken it (`R-30`). This file's own negative-control
 * fixtures are exactly such literals. `require('typescript')` is a root
 * devDependency and four sibling gates already do this, so no dependency and no
 * architectural decision is introduced.
 *
 * THE MODEL SET IS DERIVED FROM THE SCHEMA (DNC-10)
 * -------------------------------------------------
 * Not a hand-written pair of names — the twin-list failure this repository has
 * already paid for. The models are read out of `schema.prisma`: every `model`
 * whose name begins with `Notification` AND which declares a `tenantId` scalar.
 * A new `NotificationDigest` model would join the corpus the day it is written.
 *
 * WHY THE SEAM AND NOT EVERY TENANT-BEARING MODEL
 * -----------------------------------------------
 * Stated rather than hidden: `PF-11` is about the notification fan-out, and this
 * gate covers that seam exhaustively. Generalising the same classifier to all 40+
 * tenant-bearing models is the SYSTEMIC job `PF-291` already owns; doing it here
 * would mean either a large allowlist or a red gate, and both are worse than a
 * narrow gate that says where its edge is.
 *
 * THE EXEMPTION IS DERIVED, NOT ENUMERATED (DNC-10)
 * --------------------------------------------------
 * Two worker queries are cross-tenant ON PURPOSE — `tenantsWithDailyOptIns` and
 * `tenantsWithOptIns` enumerate which tenants have work so the cron can then loop
 * per tenant. They are not allowlisted by path. They are recognised by a
 * STRUCTURAL property: the query selects `tenantId` and NOTHING else, and
 * declares a `distinct` on it. Such a read returns tenant identifiers and no
 * tenant-owned column, so it cannot leak one tenant's data to another. Any query
 * that starts reading a second column loses the exemption automatically.
 *
 * WHAT THIS GATE DELIBERATELY DOES NOT COVER — said so the silence is not read
 * as coverage
 * ---------------------------------------------------------------------------
 * `findUnique` / `findUniqueOrThrow` / `update` / `delete` / `upsert` take a
 * UNIQUE selector, and `NotificationPreference`'s unique is
 * `@@unique([userProfileId, kind])` — no tenant in it, so Prisma REFUSES a
 * `tenantId` there. Requiring one would be a rule the type system cannot satisfy.
 * Those sites need a post-read tenant assertion or a compound unique instead, and
 * that is a different change: recorded as `PF-320` (`NotificationPreferences
 * Service.update`) and `PF-321` (`isEnabled`), not fixed here. The gate still
 * COUNTS them, so a new one cannot be added in silence.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO_ROOT, 'apps', 'api', 'src');
const WORKER_SRC = join(REPO_ROOT, 'apps', 'worker', 'src');
const SCHEMA_PATH = join(REPO_ROOT, 'apps', 'api', 'prisma', 'schema.prisma');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');

/* eslint-disable @typescript-eslint/no-require-imports */
// Unguarded on purpose (DNC-08): if either module evaporates this suite must die
// at LOAD rather than degenerate into "nothing to check, therefore pass".
const walkRead = require(WALK_READ_PATH) as {
  maxVanishedFor: (n: number) => number;
  mapWalkedFiles: <V>(
    paths: string[],
    build: (path: string, source: string) => [string, V],
  ) => { entries: [string, V][]; skipped: string[] };
  warnSkipped: (label: string, skipped: string[]) => boolean;
  readWalkedFile: (path: string, options?: { skipped?: string[] }) => string | undefined;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ts = require('typescript') as any;
/* eslint-enable @typescript-eslint/no-require-imports */

/* ================================================================== *
 * THE MODEL SET — derived from schema.prisma
 * ================================================================== */

/** `model X {` blocks whose body declares a `tenantId` scalar. */
function tenantBearingModels(schemaSource: string): string[] {
  const out: string[] = [];
  const re = /^model\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schemaSource)) !== null) {
    const name = m[1] as string;
    const body = m[2] as string;
    if (/^\s*tenantId\s+String/m.test(body)) out.push(name);
  }
  return out;
}

/** `Notification` becomes `notification`, the Prisma client accessor. */
const accessorOf = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

const SCHEMA_SOURCE = walkRead.readWalkedFile(SCHEMA_PATH);
if (SCHEMA_SOURCE === undefined) {
  throw new Error('notification-tenant-scope-gate: schema.prisma is unreadable');
}
const TENANT_MODELS = tenantBearingModels(SCHEMA_SOURCE);
const SEAM_MODELS = TENANT_MODELS.filter((m) => m.startsWith('Notification'));
const SEAM_ACCESSORS = new Set(SEAM_MODELS.map(accessorOf));

/**
 * Methods whose first argument's `where` is a FILTER. A missing `tenantId` in
 * one of these silently widens the query, which is the defect.
 */
const FILTER_METHODS = new Set([
  'aggregate',
  'count',
  'deleteMany',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'groupBy',
  'updateMany',
]);

/** Methods whose `where` is a UNIQUE selector — see the header for why. */
const UNIQUE_METHODS = new Set(['delete', 'findUnique', 'findUniqueOrThrow', 'update', 'upsert']);

/* ================================================================== *
 * THE CLASSIFIER
 * ================================================================== */

type Site = {
  file: string;
  line: number;
  accessor: string;
  method: string;
  scoped: boolean;
  tenantEnumeration: boolean;
  reason?: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

function propNamed(obj: any, name: string): any {
  if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name && p.name.getText() === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.getText() === name) return p.name;
  }
  return undefined;
}

function hasKey(obj: any, name: string): boolean {
  if (!obj || !ts.isObjectLiteralExpression(obj)) return false;
  return obj.properties.some(
    (p: any) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      p.name !== undefined &&
      p.name.getText() === name,
  );
}

/**
 * Resolve an identifier to the object literal a same-file `const`/`let` gave it.
 * `NotificationsService.list` builds its `where` in a variable first, so without
 * this the gate would report an unclassifiable site on correct code.
 */
function resolveIdentifier(node: any, sf: any): any {
  if (!node || !ts.isIdentifier(node)) return node;
  const wanted = node.text as string;
  let found: any;
  const visit = (n: any) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === wanted &&
      n.initializer !== undefined
    ) {
      found = n.initializer;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found ?? node;
}

/** The object an `OR` branch actually contributes, whatever syntax produced it. */
function orBranchObjects(orValue: any, sf: any): { objects: any[]; opaque: boolean } {
  const objects: any[] = [];
  const resolved = resolveIdentifier(orValue, sf);
  if (ts.isArrayLiteralExpression(resolved)) {
    let opaque = false;
    for (const el of resolved.elements) {
      const r = resolveIdentifier(el, sf);
      if (ts.isObjectLiteralExpression(r)) objects.push(r);
      else opaque = true;
    }
    return { objects, opaque };
  }
  // A `.map(cb)` — the branch is whatever the callback returns.
  if (
    ts.isCallExpression(resolved) &&
    ts.isPropertyAccessExpression(resolved.expression) &&
    resolved.expression.name.text === 'map' &&
    resolved.arguments.length > 0
  ) {
    const cb = resolved.arguments[0];
    if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
      const returns: any[] = [];
      if (!ts.isBlock(cb.body)) {
        const body = ts.isParenthesizedExpression(cb.body) ? cb.body.expression : cb.body;
        returns.push(body);
      } else {
        const visit = (n: any) => {
          if (ts.isReturnStatement(n) && n.expression) returns.push(n.expression);
          ts.forEachChild(n, visit);
        };
        visit(cb.body);
      }
      let opaque = returns.length === 0;
      for (const r of returns) {
        if (ts.isObjectLiteralExpression(r)) objects.push(r);
        else opaque = true;
      }
      return { objects, opaque };
    }
  }
  return { objects, opaque: true };
}

/**
 * Is this `where` tenant-scoped?
 *
 * `tenantId` at the top level scopes everything under it, including any `OR`.
 * Otherwise every `OR` branch must carry it. Anything the parser cannot resolve
 * counts as NOT scoped — DNC-08: an unclassifiable state is never a PASS.
 */
function isTenantScoped(whereValue: any, sf: any): { scoped: boolean; reason?: string } {
  const where = resolveIdentifier(whereValue, sf);
  if (!where || !ts.isObjectLiteralExpression(where)) {
    return { scoped: false, reason: 'the `where` is not a resolvable object literal' };
  }
  if (hasKey(where, 'tenantId')) return { scoped: true };
  const or = propNamed(where, 'OR');
  if (or === undefined) {
    return { scoped: false, reason: 'no `tenantId` key and no `OR` to carry one' };
  }
  const { objects, opaque } = orBranchObjects(or, sf);
  if (opaque || objects.length === 0) {
    return { scoped: false, reason: 'an `OR` branch could not be resolved to an object literal' };
  }
  const unscoped = objects.filter((o) => !hasKey(o, 'tenantId'));
  if (unscoped.length > 0) {
    return { scoped: false, reason: unscoped.length + ' OR branch(es) carry no tenantId' };
  }
  return { scoped: true };
}

/**
 * A tenant ENUMERATION: selects `tenantId` and nothing else, and is `distinct`
 * on it. Reads tenant identifiers, never a tenant-owned column.
 */
function isTenantEnumeration(arg: any): boolean {
  const select = propNamed(arg, 'select');
  const distinct = propNamed(arg, 'distinct');
  if (!select || !ts.isObjectLiteralExpression(select)) return false;
  const names = select.properties
    .map((p: any) => (p.name ? (p.name.getText() as string) : ''))
    .filter(Boolean);
  if (names.length !== 1 || names[0] !== 'tenantId') return false;
  if (!distinct || !ts.isArrayLiteralExpression(distinct)) return false;
  return distinct.elements.some((e: any) => ts.isStringLiteral(e) && e.text === 'tenantId');
}

/** Every seam-model Prisma call in one source file. */
function classify(file: string, source: string): { filter: Site[]; unique: Site[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const filter: Site[] = [];
  const unique: Site[] = [];
  const visit = (node: any) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text as string;
      const recv = node.expression.expression;
      if (ts.isPropertyAccessExpression(recv) && SEAM_ACCESSORS.has(recv.name.text as string)) {
        const accessor = recv.name.text as string;
        const line = (sf.getLineAndCharacterOfPosition(node.getStart(sf)).line as number) + 1;
        const arg = node.arguments[0];
        if (FILTER_METHODS.has(method)) {
          const enumeration = isTenantEnumeration(arg);
          const verdict = isTenantScoped(propNamed(arg, 'where'), sf);
          filter.push({
            file,
            line,
            accessor,
            method,
            scoped: verdict.scoped,
            tenantEnumeration: enumeration,
            reason: verdict.reason,
          });
        } else if (UNIQUE_METHODS.has(method)) {
          unique.push({ file, line, accessor, method, scoped: false, tenantEnumeration: false });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { filter, unique };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/* ================================================================== *
 * THE CORPUS
 * ================================================================== */

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // `__fixtures__` carries deliberate pre-fix sources: judging them would be
      // a self-red one would then "fix" by adding an exclusion.
      if (entry.name !== 'node_modules' && entry.name !== '__fixtures__') walkSources(path, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(path);
    }
  }
  return out.sort();
}

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

const SOURCE_FILES = [...walkSources(API_SRC), ...walkSources(WORKER_SRC)];

const { entries, skipped } = walkRead.mapWalkedFiles<{ filter: Site[]; unique: Site[] }>(
  SOURCE_FILES,
  (path, source) => [rel(path), classify(rel(path), source)],
);
const CLASSIFIED = new Map(entries);
walkRead.warnSkipped('notification-tenant-scope-gate', skipped);

const FILTER_SITES = [...CLASSIFIED.values()].flatMap((v) => v.filter);
const UNIQUE_SITES = [...CLASSIFIED.values()].flatMap((v) => v.unique);
const OFFENDERS = FILTER_SITES.filter((s) => !s.scoped && !s.tenantEnumeration);
const ENUMERATIONS = FILTER_SITES.filter((s) => s.tenantEnumeration);

const describeSite = (s: Site) =>
  s.file + ':' + s.line + ' ' + s.accessor + '.' + s.method + ' — ' + (s.reason ?? 'unscoped');

/**
 * Floors, measured 2026-08-23: 2 seam models, 20 filter sites, 3 unique-selector
 * sites (two findUnique + one upsert), 2 tenant enumerations. Each floor sits below the measurement with room
 * for ordinary deletion, because "found nothing, therefore pass" is the failure
 * mode a gate exists to prevent.
 */
const MIN_SEAM_MODELS = 2;
const MIN_FILTER_SITES = 14;
const MIN_SOURCE_FILES = 200;
const UNIQUE_SELECTOR_SITES = 3;

/* ================================================================== *
 * THE DERIVATION IS NOT VACUOUS
 * ================================================================== */

describe('notification tenant-scope gate — the corpus is really the corpus', () => {
  it('READ tenant-bearing models out of schema.prisma', () => {
    expect(TENANT_MODELS.length).toBeGreaterThanOrEqual(20);
  });

  it('derived the seam models from the schema rather than naming them', () => {
    expect(SEAM_MODELS.length).toBeGreaterThanOrEqual(MIN_SEAM_MODELS);
    expect(SEAM_MODELS).toEqual(expect.arrayContaining(['Notification', 'NotificationPreference']));
  });

  it('walked a real corpus — an empty walk is never a PASS', () => {
    expect(SOURCE_FILES.length).toBeGreaterThanOrEqual(MIN_SOURCE_FILES);
  });

  it('carries the accounting identity — a floor on the LIST does not transfer to the MAP', () => {
    expect(CLASSIFIED.size + skipped.length).toBe(SOURCE_FILES.length);
  });

  it('did not lose more than the budget calibrated on corpus size', () => {
    expect(skipped.length).toBeLessThanOrEqual(walkRead.maxVanishedFor(SOURCE_FILES.length));
  });

  it('found filter sites to judge — zero sites would make every assertion below vacuous', () => {
    expect(FILTER_SITES.length).toBeGreaterThanOrEqual(MIN_FILTER_SITES);
  });
});

/* ================================================================== *
 * THE CLASSIFIER MEASURES — negative and positive controls
 *
 * Fixture sources are assembled by CONCATENATION rather than written as one
 * literal, the remedy `PF-295` and the `rmSync` precedent in
 * `hermetic-spec-writers-gate.spec.ts:26-34` already established: a sibling text
 * scan must not be able to mistake this file's own fixtures for live code.
 * ================================================================== */

const CALL = (body: string) => 'class X { async m() { await this.prisma.' + body + '; } }';

describe('the classifier is not an always-pass', () => {
  it('FLAGS the exact pre-PF-11 shape: an OR whose branches carry no tenant', () => {
    const src = CALL(
      'notification' +
        '.findMany({ where: { OR: keys.map((k) => ({ userProfileId: k.userProfileId })) } })',
    );
    const { filter } = classify('fixture.ts', src);
    expect(filter).toHaveLength(1);
    expect(filter[0]!.scoped).toBe(false);
  });

  it('FLAGS a flat where with no tenant key', () => {
    const src = CALL('notification' + '.findMany({ where: { readAt: null } })');
    const { filter } = classify('fixture.ts', src);
    expect(filter[0]!.scoped).toBe(false);
  });

  it('FLAGS the absent-key spread — the shape ADR-065 §D5 forbids', () => {
    const src = CALL(
      'notificationPreference' +
        '.findMany({ where: { ...(tenantId ? { tenantId } : {}), kind: k } })',
    );
    const { filter } = classify('fixture.ts', src);
    expect(filter[0]!.scoped).toBe(false);
  });

  it('FLAGS a partially-scoped OR — one clean branch does not carry the others', () => {
    const src = CALL(
      'notification' +
        '.findMany({ where: { OR: [{ tenantId: t, userProfileId: a }, { userProfileId: b }] } })',
    );
    const { filter } = classify('fixture.ts', src);
    expect(filter[0]!.scoped).toBe(false);
  });

  it('PASSES a flat tenant-scoped where — without a case that must pass, an always-fail comparator satisfies every red case', () => {
    const src = CALL('notification' + '.findMany({ where: { tenantId, readAt: null } })');
    const { filter } = classify('fixture.ts', src);
    expect(filter[0]!.scoped).toBe(true);
  });

  it('PASSES an OR whose every branch carries the tenant — the shipped shape', () => {
    const src = CALL(
      'notification' +
        '.findMany({ where: { OR: keys.map((k) => ({ tenantId: k.tenantId, userProfileId: k.userProfileId })) } })',
    );
    const { filter } = classify('fixture.ts', src);
    expect(filter[0]!.scoped).toBe(true);
  });

  it('PASSES a top-level tenant that dominates an OR', () => {
    const src = CALL('notification' + '.findMany({ where: { tenantId, OR: [{ a: 1 }, { b: 2 }] } })');
    const { filter } = classify('fixture.ts', src);
    expect(filter[0]!.scoped).toBe(true);
  });

  it('resolves a `where` built in a variable first (NotificationsService.list)', () => {
    const src =
      'class X { async m() { const where = { tenantId: a, userProfileId: b }; ' +
      'await this.prisma.' +
      'notification' +
      '.findMany({ where }); } }';
    const { filter } = classify('fixture.ts', src);
    expect(filter[0]!.scoped).toBe(true);
  });

  it('recognises a tenant ENUMERATION structurally, not by path', () => {
    const src = CALL(
      'notificationPreference' +
        ".findMany({ where: { cadence: 'daily_digest' }, select: { tenantId: true }, distinct: ['tenantId'] })",
    );
    const { filter } = classify('fixture.ts', src);
    expect(filter[0]!.tenantEnumeration).toBe(true);
    expect(filter[0]!.scoped).toBe(false);
  });

  it('WITHDRAWS the enumeration exemption as soon as a second column is read', () => {
    const src = CALL(
      'notificationPreference' +
        ".findMany({ where: { cadence: 'daily_digest' }, select: { tenantId: true, userProfileId: true }, distinct: ['tenantId'] })",
    );
    const { filter } = classify('fixture.ts', src);
    expect(filter[0]!.tenantEnumeration).toBe(false);
  });

  it('ignores models outside the seam — the gate says where its edge is', () => {
    const src = CALL('student' + '.findMany({ where: { classSectionId } })');
    const { filter } = classify('fixture.ts', src);
    expect(filter).toHaveLength(0);
  });
});

/* ================================================================== *
 * THE VERDICT
 * ================================================================== */

describe('every notification filter query is tenant-scoped (PF-11)', () => {
  it('has ZERO unscoped filter sites across apps/api and apps/worker', () => {
    expect(OFFENDERS.map(describeSite)).toEqual([]);
  });

  it('scopes the dedup query PF-11 names, on every OR branch', () => {
    const site = FILTER_SITES.find(
      (s) =>
        s.file === 'apps/api/src/modules/notifications/notifications.service.ts' &&
        s.accessor === 'notification' &&
        s.method === 'findMany' &&
        s.line < 200,
    );
    expect(site).toBeDefined();
    expect(site!.scoped).toBe(true);
  });

  it('holds exactly TWO tenant enumerations, both in the worker crons', () => {
    expect(ENUMERATIONS).toHaveLength(2);
    expect(ENUMERATIONS.map((s) => s.file).sort()).toEqual([
      'apps/worker/src/modules/notifications-digest/notifications-digest-cron.service.ts',
      'apps/worker/src/modules/parent-digest/parent-digest-cron.service.ts',
    ]);
  });

  it('COUNTS the unique-selector sites this gate cannot judge (PF-320 / PF-321)', () => {
    // Not a pass and not a failure — a declared ceiling. If this number moves,
    // someone added a unique-selector read to the seam and owes it a tenant
    // assertion; the gate refuses to let that happen in silence.
    expect(UNIQUE_SITES.length).toBe(UNIQUE_SELECTOR_SITES);
  });
});
