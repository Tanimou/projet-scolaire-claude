import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_FAMILIES,
  AUDIT_CRITICAL_ACTIONS,
  AUDIT_EXPORT_ACTIONS,
  AUDIT_LOGIN_ACTIONS,
  AUDIT_PORTALS,
  AUDIT_RESOURCE_TYPES,
  LEGACY_AUDIT_ACTION_ALIASES,
  LEGACY_AUDIT_RESOURCE_TYPE_ALIASES,
  LEGACY_FORMAT_MARKER,
  PORTALS,
  TEACHER_BOOKING_TRANSITION,
  classifyAuditAction,
  classifyAuditPortal,
  classifyAuditResourceType,
} from '@pilotage/contracts';
import * as ts from 'typescript';

import {
  auditCriticalActionCodes,
  auditExportActionCodes,
  auditLoginActionCodes,
} from '../../modules/analytics/analytics.service';

/**
 * S-E04-4 — the audit vocabulary gate (PF-32, ADR-037, gates G-TRUTH / G-PORTAL
 * / G-DNC, DNC-08 + DNC-09).
 *
 * WHAT WAS BROKEN
 * ---------------
 * Three populations disagreed about what `audit_log.action` and
 * `audit_log.resource_type` are:
 *
 *   A. the 54 seeded/live rows carry FRENCH DISPLAY STRINGS in structural
 *      columns (`'Suppression'`, `'Élève'`);
 *   B. the API + `imports-core` call sites write MACHINE CODES
 *      (`'role.delete'`, `'user_profile'`);
 *   C. `apps/web/.../audit-labels.ts` held a 13-key map of which SEVEN keys
 *      nobody writes, and which was missing `calendar_event` — something a
 *      real writer emits on every holiday seed.
 *
 * …and `analytics.service.ts` matched a FOURTH set straddling both vocabularies
 * (`['delete', 'Suppression', 'Révision', 'revise']`, of which exactly one
 * string could match any row that exists).
 *
 * WHY THIS FILE IS IN `apps/api`, NOT IN `packages/contracts`
 * -----------------------------------------------------------
 * Measured: `packages/contracts/package.json` has **no `test` script** and zero
 * spec files; `apps/web` has only Playwright. `scripts/test-ratchet.js` runs
 * `api` and `worker` only. A "contracts-level" spec written next to the
 * declaration would be **file-present and never executed** — the exact class of
 * defect the ratchet was built for (PF-55 / VAL-01). So the decidable logic
 * lives in `packages/contracts/src/audit/` and its proof lives here, beside the
 * seven gates already in this directory. Do not "fix" its location.
 *
 * WHICH HALVES ARE BEHAVIOURAL AND WHICH ARE TEXTUAL — SAY IT OUT LOUD
 * --------------------------------------------------------------------
 * G-TRUTH names three consumers. Presenting a textual guard as a behavioural one
 * is the failure mode this epic is named after, so:
 *
 *   • **contracts resolvers** — behavioural (imported and called).
 *   • **API KPI predicates** — behavioural: `analytics.service.ts` exports
 *     `auditCriticalActionCodes()` / `auditExportActionCodes()` and this file
 *     drives the REAL functions, not a copy of their bodies.
 *   • **web adapter** — behavioural: `audit-labels.ts` is a neutral module whose
 *     only import is `@pilotage/contracts`, so it can be required from here and
 *     called. (DOM-level proof that the marker renders is Playwright's and is
 *     NOT claimed by this slice.)
 *   • **worker CSV generator** — TEXTUAL here, behavioural in
 *     `apps/worker/src/modules/exports/generators/audit-csv.generator.spec.ts`.
 *     `apps/api` cannot import `apps/worker`; asserting the CSV path from here
 *     would be a fiction.
 *
 * WHY THE EXTRACTOR USES THE TYPESCRIPT AST AND NOT A GREP (PF-105)
 * -----------------------------------------------------------------
 * A completeness test driven off a hand-written list is `A ≡ A`. The written set
 * below is re-derived from the SOURCES on every run. It has to be an AST walk:
 * the run brief's `grep -rhoE "action:\s*'[a-z_]+'"` under-counts the written
 * set by ~34 %, because fourteen codes reach `auditLog.create` through a
 * parameter — five distinct shapes, each with a named case in `V-1`. The same
 * grep also matches Prisma `orderBy` clauses and yields the bogus code `asc`,
 * which would then force a French label for a sort direction; `V-1` asserts
 * `asc`/`desc` are absent from BOTH axes.
 *
 * COMMENT-STRIPPED, USING THE LINK GATE'S OWN STRIPPER (PF-83)
 * ------------------------------------------------------------
 * Every *textual* read goes through `stripCommentsPreservingLines`
 * (`scripts/link-integrity-check.js`, proven both ways in
 * `link-integrity-gate.spec.ts`). The files this slice touches *explain at
 * length* the strings they no longer contain; a raw grep would go red on the
 * documentation of the fix. The AST extractor is unaffected — comments are not
 * nodes.
 *
 * NOT CLAIMED: the audit read path (`S-E04-7`, PF-121/122/123 — read while
 * writing the extractor, deliberately not fixed); provenance (`S-E04-3`);
 * a login writer (DNC-09 is discharged by REPORTING the gap, not by inventing
 * an emitter); a `portal: 'student'` writer (none exists; none was fabricated).
 * G-MIGRATION / G-TENANT / G-AUDIT do not trigger: no schema change, no new
 * query, no new privileged mutation.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'link-integrity-check.js');

/* eslint-disable @typescript-eslint/no-require-imports */
// Unguarded on purpose (DNC-08): if the stripper disappears this suite must fail
// at LOAD rather than degrade into "nothing to check, therefore pass".
const { stripCommentsPreservingLines } = require(SCRIPT_PATH) as {
  stripCommentsPreservingLines: (source: string) => string;
};

/**
 * The web adapter, loaded at RUNTIME rather than with a static import.
 *
 * G-TRUTH wants the *real* `humanizeResourceType`, not a re-implementation of
 * it — but `apps/api/tsconfig.json` pins `rootDir: "./src"`, so a relative
 * `import … from '../../../../web/src/…'` puts a file outside the root into the
 * program and TS6059's the typecheck gate. (`@pilotage/contracts` escapes that
 * only because it resolves through `node_modules`.) A `require()` of a computed
 * absolute path is invisible to the compiler and still goes through ts-jest's
 * transform, so the assertion stays behavioural without dragging `apps/web` into
 * the API's compilation unit.
 *
 * Unguarded, again on purpose: if the module moves or stops exporting these,
 * this suite must fail at load.
 */
const WEB_AUDIT_LABELS = require(
  join(REPO_ROOT, 'apps', 'web', 'src', 'app', 'admin', 'audit', 'audit-labels'),
) as {
  humanizeAction: (action: string) => string;
  humanizeResourceType: (rt: string) => string;
  humanizePortal: (p: string | null) => string;
};
const { humanizeAction, humanizePortal, humanizeResourceType } = WEB_AUDIT_LABELS;
/* eslint-enable @typescript-eslint/no-require-imports */

const repoRel = (file: string): string => relative(REPO_ROOT, file).split(sep).join('/');

function walk(root: string, accept: (name: string) => boolean): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['node_modules', '.turbo', 'dist', 'coverage', '.next'].includes(entry.name)) continue;
        stack.push(join(current, entry.name));
      } else if (accept(entry.name)) {
        files.push(join(current, entry.name));
      }
    }
  }
  return files.sort();
}

/* ================================================================== *
 * The extractor — the authoritative written set, derived from source
 * ================================================================== */

/**
 * The three writer populations. `packages/imports-core/src` is included on
 * purpose and this DIFFERS from `audit-provenance-gate.spec.ts:75-78`, which
 * declares it outside its walk root by contract — do not copy that constant
 * here: `engine.ts` writes two real audit rows, and leaving it out would make
 * the reverse-completeness direction demand their labels be deleted.
 */
const WRITER_ROOTS = [
  join(REPO_ROOT, 'apps', 'api', 'src'),
  join(REPO_ROOT, 'packages', 'imports-core', 'src'),
];
const SEED_PATH = join(REPO_ROOT, 'apps', 'api', 'prisma', 'seed-demo.ts');

const WRITER_FILES = [
  ...WRITER_ROOTS.flatMap((root) =>
    walk(root, (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')),
  ).filter((f) => !repoRel(f).includes('__fixtures__')),
  SEED_PATH,
];

const SOURCES = new Map<string, ts.SourceFile>(
  WRITER_FILES.map((file) => [
    file,
    ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true),
  ]),
);

type Axis = 'action' | 'resourceType';

interface Extraction {
  actions: Set<string>;
  resourceTypes: Set<string>;
  /** Prefixes of `` `x_${runtimeValue}` `` shapes — NOT pretended to be literals. */
  families: Set<string>;
  /** Every `auditLog.create` site found, for the vacuity floor. */
  seams: number;
  /** Private helpers that forward an `action` into a seam (the closure list). */
  forwarders: Set<string>;
}

function extract(): Extraction {
  const out: Extraction = {
    actions: new Set(),
    resourceTypes: new Set(),
    families: new Set(),
    seams: 0,
    forwarders: new Set(),
  };
  const pendingForwarders: Array<{
    file: string;
    name: string;
    paramIndex: number;
    member?: string;
    axis: Axis;
  }> = [];

  const sink = (axis: Axis, value: string): void => {
    (axis === 'action' ? out.actions : out.resourceTypes).add(value);
  };

  const enclosingFunction = (node: ts.Node): ts.SignatureDeclaration | undefined => {
    let n: ts.Node | undefined = node.parent;
    while (n) {
      if (
        ts.isMethodDeclaration(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n)
      ) {
        return n;
      }
      n = n.parent;
    }
    return undefined;
  };

  const functionName = (fn: ts.SignatureDeclaration | undefined): string | undefined => {
    if (!fn) return undefined;
    if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
    const parent = fn.parent;
    if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
    return undefined;
  };

  /**
   * Resolve a declared TYPE into literals. Returns false when the type is open
   * (`string`, or a template-literal type) — the caller then falls through to
   * call-site resolution rather than guessing.
   */
  const fromTypeNode = (tn: ts.TypeNode | undefined, axis: Axis): boolean => {
    if (!tn) return false;
    if (ts.isLiteralTypeNode(tn) && ts.isStringLiteral(tn.literal)) {
      sink(axis, tn.literal.text);
      return true;
    }
    if (ts.isUnionTypeNode(tn)) {
      let closed = true;
      for (const t of tn.types) closed = fromTypeNode(t, axis) && closed;
      return closed;
    }
    if (ts.isTemplateLiteralTypeNode(tn)) {
      out.families.add(tn.head.text);
      return false;
    }
    return false;
  };

  const parameterInfo = (
    fn: ts.SignatureDeclaration | undefined,
    rootName: string,
    memberName?: string,
  ): { index: number; typeNode?: ts.TypeNode; member?: string } | undefined => {
    if (!fn) return undefined;
    for (let i = 0; i < fn.parameters.length; i++) {
      const p = fn.parameters[i]!;
      if (!ts.isIdentifier(p.name) || p.name.text !== rootName) continue;
      if (!memberName) return { index: i, typeNode: p.type };
      const literals: ts.TypeLiteralNode[] = [];
      if (p.type && ts.isTypeLiteralNode(p.type)) literals.push(p.type);
      if (p.type && ts.isIntersectionTypeNode(p.type)) {
        for (const t of p.type.types) if (ts.isTypeLiteralNode(t)) literals.push(t);
      }
      for (const lit of literals) {
        const m = lit.members.find(
          (mm) => mm.name && ts.isIdentifier(mm.name) && mm.name.text === memberName,
        );
        if (m && ts.isPropertySignature(m)) return { index: i, typeNode: m.type, member: memberName };
      }
      return { index: i, typeNode: undefined, member: memberName };
    }
    return undefined;
  };

  const resolveExpression = (expr: ts.Expression, file: string, axis: Axis, depth = 0): void => {
    if (depth > 4) return;
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      sink(axis, expr.text);
      return;
    }
    if (ts.isAsExpression(expr) || ts.isParenthesizedExpression(expr)) {
      resolveExpression(expr.expression, file, axis, depth);
      return;
    }
    // Shape 1 — the ternary in the key: `body.flagged ? 'grade.flag' : 'grade.unflag'`.
    if (ts.isConditionalExpression(expr)) {
      resolveExpression(expr.whenTrue, file, axis, depth + 1);
      resolveExpression(expr.whenFalse, file, axis, depth + 1);
      return;
    }
    // A computed code. Recorded as a FAMILY, never as a literal.
    if (ts.isTemplateExpression(expr)) {
      out.families.add(expr.head.text);
      return;
    }
    if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr)) {
      let rootName: string;
      let memberName: string | undefined;
      if (ts.isIdentifier(expr)) {
        rootName = expr.text;
      } else if (ts.isIdentifier(expr.expression)) {
        rootName = expr.expression.text;
        memberName = expr.name.text;
      } else {
        return;
      }
      const fn = enclosingFunction(expr);
      const info = parameterInfo(fn, rootName, memberName);
      if (!info) return;
      // Shapes 2 & 3 — a union-typed parameter (`'a' | 'b'`) resolves here.
      if (fromTypeNode(info.typeNode, axis)) return;
      // Shapes 4 & 5 — `action: string` and a template-literal type: the
      // enclosing function is a FORWARDER; resolve it from its call sites.
      const name = functionName(fn);
      if (!name) return;
      out.forwarders.add(`${repoRel(file)}#${name}`);
      pendingForwarders.push({ file, name, paramIndex: info.index, member: info.member, axis });
    }
  };

  // ---- Phase A: the `auditLog.create` seams. Only the `data:` object literal
  // is read, which is what structurally excludes `orderBy: { action: 'asc' }`.
  for (const [file, sf] of SOURCES) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'create' &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === 'auditLog'
      ) {
        out.seams += 1;
        const arg = node.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const dataProp = arg.properties.find(
            (p) => p.name && ts.isIdentifier(p.name) && p.name.text === 'data',
          );
          if (
            dataProp &&
            ts.isPropertyAssignment(dataProp) &&
            ts.isObjectLiteralExpression(dataProp.initializer)
          ) {
            for (const axis of ['action', 'resourceType'] as Axis[]) {
              const p = dataProp.initializer.properties.find(
                (x) => x.name && ts.isIdentifier(x.name) && x.name.text === axis,
              );
              if (!p) continue;
              if (ts.isPropertyAssignment(p)) resolveExpression(p.initializer, file, axis);
              else if (ts.isShorthandPropertyAssignment(p)) resolveExpression(p.name, file, axis);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // ---- Phase B: call-site resolution for the registered forwarders. Scoped to
  // the DECLARING file — every one of the six is a `private` method, and a
  // repo-wide name match would apply one helper's parameter position to
  // another's arguments.
  const done = new Set<string>();
  for (let pass = 0; pass < 3 && pendingForwarders.length > 0; pass++) {
    const batch = pendingForwarders.splice(0);
    for (const fw of batch) {
      const key = `${fw.file}#${fw.name}#${fw.paramIndex}#${fw.member ?? ''}`;
      if (done.has(key)) continue;
      done.add(key);
      const sf = SOURCES.get(fw.file);
      if (!sf) continue;
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const name = ts.isIdentifier(callee)
            ? callee.text
            : ts.isPropertyAccessExpression(callee)
              ? callee.name.text
              : undefined;
          if (name === fw.name) {
            let arg = node.arguments[fw.paramIndex];
            if (arg) {
              if (fw.member) {
                while (arg && (ts.isAsExpression(arg) || ts.isParenthesizedExpression(arg))) {
                  arg = arg.expression;
                }
                if (arg && ts.isObjectLiteralExpression(arg)) {
                  const mp = arg.properties.find(
                    (x) => x.name && ts.isIdentifier(x.name) && x.name.text === fw.member,
                  );
                  if (mp && ts.isPropertyAssignment(mp)) {
                    resolveExpression(mp.initializer, fw.file, fw.axis);
                  } else if (mp && ts.isShorthandPropertyAssignment(mp)) {
                    resolveExpression(mp.name, fw.file, fw.axis);
                  }
                }
              } else {
                resolveExpression(arg, fw.file, fw.axis);
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }

  return out;
}

const EXTRACTED = extract();

/* ================================================================== *
 * The seed's own writes — array-literal driven, so read separately
 * ================================================================== */

interface SeedCodes {
  canonicalActions: string[];
  canonicalResourceTypes: string[];
  legacyActions: string[];
  legacyResourceTypes: string[];
  legacyRowCount: number;
}

function readSeedCodes(): SeedCodes {
  const sf = SOURCES.get(SEED_PATH)!;
  const result: SeedCodes = {
    canonicalActions: [],
    canonicalResourceTypes: [],
    legacyActions: [],
    legacyResourceTypes: [],
    legacyRowCount: 0,
  };

  const stringElements = (init: ts.Expression | undefined): string[] =>
    init && ts.isArrayLiteralExpression(init)
      ? init.elements.filter(ts.isStringLiteral).map((e) => e.text)
      : [];

  const objectRows = (
    init: ts.Expression | undefined,
  ): Array<{ action?: string; resourceType?: string }> => {
    if (!init || !ts.isArrayLiteralExpression(init)) return [];
    return init.elements.filter(ts.isObjectLiteralExpression).map((obj) => {
      const read = (key: string): string | undefined => {
        const p = obj.properties.find((x) => x.name && ts.isIdentifier(x.name) && x.name.text === key);
        return p && ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer)
          ? p.initializer.text
          : undefined;
      };
      return { action: read('action'), resourceType: read('resourceType') };
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (name === 'namedAuditEntries') {
        for (const row of objectRows(node.initializer)) {
          if (row.action) result.canonicalActions.push(row.action);
          if (row.resourceType) result.canonicalResourceTypes.push(row.resourceType);
        }
      } else if (name === 'auditActions') {
        result.canonicalActions.push(...stringElements(node.initializer));
      } else if (name === 'auditResources') {
        result.canonicalResourceTypes.push(...stringElements(node.initializer));
      } else if (name === 'legacyFormatFixtureRows') {
        const rows = objectRows(node.initializer);
        result.legacyRowCount = rows.length;
        for (const row of rows) {
          if (row.action) result.legacyActions.push(row.action);
          if (row.resourceType) result.legacyResourceTypes.push(row.resourceType);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return result;
}

const SEED = readSeedCodes();

/** Everything a writer emits: the AST seams plus the seed's array-driven rows. */
const WRITTEN_ACTIONS = new Set<string>([...EXTRACTED.actions, ...SEED.canonicalActions]);
const WRITTEN_RESOURCE_TYPES = new Set<string>([
  ...EXTRACTED.resourceTypes,
  ...SEED.canonicalResourceTypes,
]);

/* ================================================================== *
 * The declaration, indexed
 * ================================================================== */

const DECLARED_ACTIONS = AUDIT_ACTIONS.map((a) => a.code);
const DECLARED_RESOURCE_TYPES = AUDIT_RESOURCE_TYPES.map((r) => r.code);
const FAMILY_MEMBERS = new Set(AUDIT_ACTION_FAMILIES.flatMap((f) => f.members));
const LEGACY_ACTION_CODES = LEGACY_AUDIT_ACTION_ALIASES.map((a) => a.code);
const LEGACY_RESOURCE_TYPE_CODES = LEGACY_AUDIT_RESOURCE_TYPE_ALIASES.map((a) => a.code);

/* ================================================================== *
 * V-0 — the vacuity floor, FIRST
 * ================================================================== */

describe('V-0 — the gate is not vacuous', () => {
  it('the extractor walked a real application and found real audit seams', () => {
    // Measured 2026-08-09 on this branch: 168 non-spec `.ts` files (156 under
    // apps/api/src, 11 under packages/imports-core/src, plus the seed) and 32
    // `auditLog.create` sites. Floors sit below the measurement so a legitimate
    // deletion is not red, and far above zero so an empty walk cannot pass.
    expect(WRITER_FILES.length).toBeGreaterThanOrEqual(120);
    expect(EXTRACTED.seams).toBeGreaterThanOrEqual(25);
    expect(WRITTEN_ACTIONS.size).toBeGreaterThanOrEqual(40);
    expect(WRITTEN_RESOURCE_TYPES.size).toBeGreaterThanOrEqual(20);
  });

  it('the declaration is non-empty and every entry carries a real French label', () => {
    expect(DECLARED_ACTIONS.length).toBeGreaterThanOrEqual(40);
    expect(DECLARED_RESOURCE_TYPES.length).toBeGreaterThanOrEqual(20);
    for (const entry of [...AUDIT_ACTIONS, ...AUDIT_RESOURCE_TYPES, ...AUDIT_PORTALS]) {
      expect(entry.label.length).toBeGreaterThan(1);
      // A label that repeats the machine code is not a label.
      expect(entry.label).not.toBe(entry.code);
    }
  });

  it('no code is declared twice on either axis', () => {
    expect(new Set(DECLARED_ACTIONS).size).toBe(DECLARED_ACTIONS.length);
    expect(new Set(DECLARED_RESOURCE_TYPES).size).toBe(DECLARED_RESOURCE_TYPES.length);
  });

  it('the borrowed stripper really strips, and really preserves length', () => {
    const source = ["// action: 'Suppression' is what this file no longer writes", "const x = 'keep';"].join(
      '\n',
    );
    const stripped = stripCommentsPreservingLines(source);
    expect(stripped).toHaveLength(source.length);
    expect(stripped).not.toContain('Suppression');
    expect(stripped).toContain("'keep'");
  });
});

/* ================================================================== *
 * V-1 (AC-2 / AC-7) — completeness, in BOTH directions
 * ================================================================== */

describe('V-1 / AC-2 / AC-7 — every written code has a label, and every label has a writer', () => {
  it('THE TRAP — no Prisma sort direction leaked in from an orderBy clause', () => {
    // `analytics.service.ts` (object form, twice) and `roles.controller.ts:92`
    // (array form) both carry `orderBy: { action: 'asc' }`. A naive
    // `action:\s*'…'` grep collects `asc` and then demands a French label for a
    // sort direction. The extractor reads only the `data:` object of an
    // `auditLog.create` call, which excludes them structurally — this asserts
    // the exclusion actually held.
    for (const bogus of ['asc', 'desc']) {
      expect(WRITTEN_ACTIONS.has(bogus)).toBe(false);
      expect(WRITTEN_RESOURCE_TYPES.has(bogus)).toBe(false);
    }
  });

  it('the trap is REAL — the naive grep this extractor replaces does collect `asc`', () => {
    // The negative control's positive half. Without it, "no `asc`" could be true
    // because the extractor found nothing at all.
    const naive = (source: string): string[] =>
      [...source.matchAll(/action:\s*'([^']+)'/g)].map((m) => m[1]!);
    const analytics = readFileSync(
      join(REPO_ROOT, 'apps', 'api', 'src', 'modules', 'analytics', 'analytics.service.ts'),
      'utf8',
    );
    expect(naive(analytics)).toContain('asc');
  });

  it('the five hard literal shapes are actually recovered — a regex extractor fails this', () => {
    // One named case per shape. If any is missing, the extractor regressed to a
    // grep and fourteen codes silently lost their labels again.
    expect(WRITTEN_ACTIONS.has('grade.unflag')).toBe(true); // ternary in the key
    expect(WRITTEN_ACTIONS.has('remediation.plan_reopened')).toBe(true); // union-typed param
    expect(WRITTEN_ACTIONS.has('academic_year.delete')).toBe(true); // positional arg
    expect(WRITTEN_ACTIONS.has('guardianship.claim_approved')).toBe(true); // `action: string`
    expect(WRITTEN_ACTIONS.has('remediation.booking_created')).toBe(true); // template-literal type
    expect(WRITTEN_RESOURCE_TYPES.has('calendar_event')).toBe(true); // AC-2's named miss
    expect(WRITTEN_RESOURCE_TYPES.has('import_batch')).toBe(true); // packages/imports-core
    expect(WRITTEN_RESOURCE_TYPES.has('student')).toBe(true); // the seed
  });

  it('the OPEN-parameter forwarder list is CLOSED — every one is registered by name', () => {
    // Six private helpers relay an `action` into a seam. Two of them
    // (`alerts.service.ts#writeAuditEntry`, `remediation.controller.ts#
    // writeAvailabilityAudit`) declare it as a closed UNION type, so the
    // extractor reads the type and never needs their call sites. The four below
    // declare it OPEN — `action: string`, or the template-literal type — and are
    // resolvable only through their arguments.
    //
    // Pinned as a list, not a count: a new helper with an open `action`
    // parameter that this run did not discover would silently shrink the written
    // set, and a shrunken written set makes the REVERSE completeness direction
    // demand that real labels be deleted. That is the failure this assertion
    // exists to make loud.
    expect([...EXTRACTED.forwarders].sort()).toEqual([
      'apps/api/src/modules/child-claims/child-claims.service.ts#audit',
      'apps/api/src/modules/integrations/integrations.service.ts#audit',
      'apps/api/src/modules/remediation/remediation.controller.ts#writeBookingAudit',
      'apps/api/src/modules/school-structure/academic-years.controller.ts#audit',
    ]);
    // …and the two union-typed helpers are accounted for by their codes being
    // present, which is the only way their type-resolution path can be green.
    expect(WRITTEN_ACTIONS.has('alert.dismiss')).toBe(true);
    expect(WRITTEN_ACTIONS.has('remediation.availability_updated')).toBe(true);
  });

  it('FORWARD — every written action has a label', () => {
    const declared = new Set(DECLARED_ACTIONS);
    expect([...WRITTEN_ACTIONS].filter((c) => !declared.has(c)).sort()).toEqual([]);
  });

  it('FORWARD — every written resourceType has a label', () => {
    const declared = new Set(DECLARED_RESOURCE_TYPES);
    expect([...WRITTEN_RESOURCE_TYPES].filter((c) => !declared.has(c)).sort()).toEqual([]);
  });

  it('REVERSE — no dead action label (this is what deletes the 7 orphan keys)', () => {
    // Family members are exempt and ONLY family members: they are produced by a
    // template literal that no AST walk can enumerate, and `V-2` proves the
    // family's declared membership covers the computing site.
    expect(
      DECLARED_ACTIONS.filter((c) => !WRITTEN_ACTIONS.has(c) && !FAMILY_MEMBERS.has(c)).sort(),
    ).toEqual([]);
  });

  it('REVERSE — no dead resourceType label', () => {
    expect(DECLARED_RESOURCE_TYPES.filter((c) => !WRITTEN_RESOURCE_TYPES.has(c)).sort()).toEqual([]);
  });

  it('the 7 keys nobody writes are gone, by name (AC-2)', () => {
    // Named individually so a reader can see exactly which orphans the reverse
    // direction removed, rather than trusting an empty array.
    const declared = new Set([...DECLARED_RESOURCE_TYPES]);
    for (const orphan of [
      'enrollment',
      'enrollment_request',
      'class_section',
      'teacher_profile',
      'announcement',
    ]) {
      expect(declared.has(orphan)).toBe(false);
      expect(WRITTEN_RESOURCE_TYPES.has(orphan)).toBe(false);
    }
    // …and the two that stay, because they ARE written.
    expect(declared.has('student')).toBe(true);
    expect(declared.has('grade')).toBe(true);
  });
});

/* ================================================================== *
 * V-2 — the computed family, declared rather than pretended
 * ================================================================== */

describe('V-2 — `remediation.booking_*` is declared as a FAMILY, and its members cover the writer', () => {
  it('every prefix the extractor saw is declared, and every declared prefix was seen', () => {
    const declaredPrefixes = AUDIT_ACTION_FAMILIES.map((f) => f.prefix).sort();
    expect([...EXTRACTED.families].sort()).toEqual(declaredPrefixes);
    expect(declaredPrefixes).toEqual(['remediation.booking_']);
  });

  it('every declared member starts with its prefix and carries a label', () => {
    const declared = new Set(DECLARED_ACTIONS);
    for (const family of AUDIT_ACTION_FAMILIES) {
      expect(family.members.length).toBeGreaterThan(0);
      for (const member of family.members) {
        expect(member.startsWith(family.prefix)).toBe(true);
        expect(declared.has(member)).toBe(true);
      }
    }
  });

  it('the declared members COVER everything the computing site can produce', () => {
    // `remediation.controller.ts` builds `` `remediation.booking_${dto.toStatus}` ``
    // and `dto` is a `TransitionBookingDto`, whose `toStatus` is
    // `z.enum(TEACHER_BOOKING_TRANSITION)` — including `no_show`, which is NOT a
    // `BOOKING_STATUS`. Both halves are asserted: the closed set of statuses,
    // and the source shape that consumes it.
    const members = new Set(AUDIT_ACTION_FAMILIES[0]!.members);
    for (const status of TEACHER_BOOKING_TRANSITION) {
      expect(members.has(`remediation.booking_${status}`)).toBe(true);
    }
    expect(members.has('remediation.booking_created')).toBe(true);
    expect(members.has('remediation.booking_cancelled')).toBe(true);
    const controller = stripCommentsPreservingLines(
      readFileSync(
        join(REPO_ROOT, 'apps', 'api', 'src', 'modules', 'remediation', 'remediation.controller.ts'),
        'utf8',
      ),
    );
    expect(controller).toContain('`remediation.booking_${dto.toStatus}`');
    expect(controller).toMatch(/dto:\s*TransitionBookingDto/);
  });
});

/* ================================================================== *
 * V-3 (AC-1) — exactly ONE declaration, stated over the SHAPE
 * ================================================================== */

/**
 * The single-declaration matcher.
 *
 * Stated over the BEHAVIOUR — "this source associates two or more audit codes
 * with French labels" — never over an identifier name. `S-E06-5` measured a
 * name-based guard passing over a fifth copy of `PORTAL_LANDING` purely because
 * the copy was called something else.
 *
 * Two association shapes are matched, because the vocabulary can be re-declared
 * in either:
 *   • the map form   `academic_year: 'Année scolaire'`
 *   • the descriptor form `{ code: 'academic_year', label: 'Année scolaire' }`
 *
 * The KEY side is restricted to CANONICAL codes. Legacy alias codes are French
 * words (`Inscription`, `Classe`) that appear as ordinary object keys elsewhere,
 * and the four portal codes (`admin`, `teacher`, `parent`, `student`) are too
 * generic to key on in the map form — three unrelated role-label maps in
 * `apps/web` would otherwise be reported. The VALUE side accepts any
 * French-looking string rather than only the exact shipped labels: the pre-fix
 * map used `'Utilisateurs'` where the declaration says `'Utilisateur'`, and a
 * matcher that only fired on an exact match would have missed the copy it exists
 * to find.
 *
 * WHY THE PORTAL EXCLUSION IS SUBTRACTED AND NOT MERELY "NOT ADDED"
 * -----------------------------------------------------------------
 * The portal set is NOT disjoint from the canonical set: `student` is a portal
 * code AND `AUDIT_RESOURCE_TYPES` entry (`vocabulary.ts:94` and `:121`) — the
 * only one of the four that is both. So building the map-form key set as "the
 * canonical codes, to which the portals are simply not added" leaves `student`
 * in it, and the exclusion the paragraph above states is silently not applied to
 * the one portal code that needed it most. Measured: it made
 * `apps/web/src/components/shell/AppShellRoot.tsx` — an untouched file with two
 * portal-keyed maps, `student: 'Mes notes'` and `student: 'Ton espace élève'` —
 * the sole reported offender of AC-1, for holding one key twice rather than two
 * audit codes once. `MAP_FORM_CODES` therefore subtracts the portal codes
 * explicitly; the descriptor form keeps them, because there `code:`/`label:`
 * pairing makes the intent unambiguous.
 */
const CANONICAL_CODES = new Set([...DECLARED_ACTIONS, ...DECLARED_RESOURCE_TYPES]);
const PORTAL_CODES = new Set<string>(AUDIT_PORTALS.map((p) => p.code));
const MAP_FORM_CODES = new Set([...CANONICAL_CODES].filter((code) => !PORTAL_CODES.has(code)));
const CANONICAL_CODES_WITH_PORTALS = new Set([...CANONICAL_CODES, ...PORTAL_CODES]);
const FRENCH_LOOKING = /^[A-ZÀ-Þ]|[À-ÿ]/;

export function auditLabelAssociations(source: string): string[] {
  const found = new Set<string>();
  const mapForm = /(?:^|[{,\s])(['"]?)([A-Za-z_][A-Za-z0-9_.]*)\1\s*:\s*(['"])([^'"\n]{2,})\3/g;
  for (const m of source.matchAll(mapForm)) {
    if (MAP_FORM_CODES.has(m[2]!) && FRENCH_LOOKING.test(m[4]!)) found.add(`${m[2]}=${m[4]}`);
  }
  const descriptorForm = /code:\s*(['"])([^'"\n]+)\1\s*,\s*label:\s*(['"])([^'"\n]{2,})\3/g;
  for (const m of source.matchAll(descriptorForm)) {
    if (CANONICAL_CODES_WITH_PORTALS.has(m[2]!) && FRENCH_LOOKING.test(m[4]!)) {
      found.add(`${m[2]}=${m[4]}`);
    }
  }
  return [...found].sort();
}

/** The ONE declaration. */
const DECLARATION_REL = 'packages/contracts/src/audit/vocabulary.ts';
/**
 * A named, reasoned exclusion — NOT a glob (a `*.tsx` or `*.spec.ts` glob is the
 * evasion route `audit-provenance-gate.spec.ts:87-102` records).
 *
 * `RoleBuilderForm.tsx` declares `RESOURCE_LABEL`, the PERMISSION-domain label
 * map (`school`, `term`, `cycle`, `attendance`, `lesson`, …). It collides with
 * the audit vocabulary on exactly four tokens (`academic_year`, `assessment`,
 * `grade`, `role`) by accident of both being French labels for school nouns. It
 * is a different vocabulary, it is not read by any audit surface, and forcing it
 * through the audit declaration would be a wrong fix. Both properties are
 * asserted below.
 */
const SINGLE_DECLARATION_EXCLUSIONS = [
  DECLARATION_REL,
  'apps/web/src/app/admin/roles/RoleBuilderForm.tsx',
];

const CONSUMER_ROOTS = [
  join(REPO_ROOT, 'apps', 'api', 'src'),
  join(REPO_ROOT, 'apps', 'web', 'src'),
  join(REPO_ROOT, 'apps', 'worker', 'src'),
  ...readdirSync(join(REPO_ROOT, 'packages'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(REPO_ROOT, 'packages', d.name, 'src')),
];

const CONSUMER_SOURCES = new Map<string, string>(
  CONSUMER_ROOTS.flatMap((root) => walk(root, (n) => n.endsWith('.ts') || n.endsWith('.tsx'))).map(
    (file) => [repoRel(file), stripCommentsPreservingLines(readFileSync(file, 'utf8'))],
  ),
);

/* ------------------------------------------------------------------ *
 * The recorded pre-fix bytes — AC-1's positive control
 * ------------------------------------------------------------------ */

const PRE_FIX_REV = 'db04843';
const PRE_FIX_DIR = join(__dirname, '__fixtures__', 'pre-fix');
const PRE_FIX_FIXTURE = 'audit-labels.ts.txt';
const PRE_FIX_SOURCE = {
  from: 'apps/web/src/app/admin/audit/audit-labels.ts',
  sha256: '39bb427423545b68fad3dc627675a1e4cba2af385d81dfd5ea90a1084ec01687',
  minLength: 4_500,
} as const;

/**
 * Unguarded on purpose (DNC-08): a missing fixture must fail at read, never
 * degrade into "nothing recorded, therefore pass". Read as the real pre-fix
 * bytes (`git show db04843:<from>`) and NOT via `git show HEAD:` — the reason is
 * written out at `audit-provenance-gate.spec.ts:42-61`: a `HEAD`-reading control
 * inverts the moment the slice is committed, and CI checks out at depth 1 so a
 * pinned revision is not reachable either.
 */
function preFixBytes(): string {
  return readFileSync(join(PRE_FIX_DIR, PRE_FIX_FIXTURE), 'utf8').replace(/\r\n/g, '\n');
}

describe('V-3 / AC-1 — the audit vocabulary is declared exactly once', () => {
  it('the declaration exists, and is the file the exclusion names', () => {
    expect(existsSync(join(REPO_ROOT, DECLARATION_REL))).toBe(true);
    expect(auditLabelAssociations(CONSUMER_SOURCES.get(DECLARATION_REL) ?? '').length).toBeGreaterThan(
      40,
    );
  });

  it('the map-form portal exclusion is a SUBTRACTION, and it is load-bearing', () => {
    // Regression guard for the false RED this matcher shipped with: the portal
    // codes overlap the canonical codes, so "not adding" them left `student`
    // keyed in the map form and turned every portal-keyed label map in
    // `apps/web` into an AC-1 offender. Both halves are asserted — that an
    // overlap exists at all (otherwise the filter below is decorative and can be
    // deleted by a future refactor without anything going red), and that the
    // subtraction removes every portal code from the map-form key set.
    expect(AUDIT_PORTALS.map((p) => p.code).filter((code) => CANONICAL_CODES.has(code))).toEqual([
      'student',
    ]);
    expect([...PORTAL_CODES].filter((code) => MAP_FORM_CODES.has(code))).toEqual([]);
    expect(MAP_FORM_CODES.size).toBe(CANONICAL_CODES.size - 1);
    // …and the descriptor form still accepts them, where `code:`/`label:` pairing
    // makes the intent unambiguous.
    expect([...PORTAL_CODES].every((code) => CANONICAL_CODES_WITH_PORTALS.has(code))).toBe(true);
  });

  it('nothing else in apps/*/src or packages/*/src declares two or more audit labels', () => {
    const offenders = [...CONSUMER_SOURCES]
      .filter(
        ([path, source]) =>
          !SINGLE_DECLARATION_EXCLUSIONS.includes(path) &&
          auditLabelAssociations(source).length >= 2,
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('BOTH exclusions really DO trip the matcher — the exclusion is load-bearing', () => {
    for (const path of SINGLE_DECLARATION_EXCLUSIONS) {
      expect(auditLabelAssociations(CONSUMER_SOURCES.get(path) ?? '').length).toBeGreaterThanOrEqual(
        2,
      );
    }
    expect(SINGLE_DECLARATION_EXCLUSIONS).toHaveLength(2);
  });

  it('the permission-label exclusion is not an audit consumer — it reads nothing from the module', () => {
    const roleBuilder = CONSUMER_SOURCES.get('apps/web/src/app/admin/roles/RoleBuilderForm.tsx') ?? '';
    expect(roleBuilder).not.toBe('');
    expect(roleBuilder).not.toMatch(/classifyAudit/);
    expect(roleBuilder).not.toMatch(/audit-labels/);
  });

  it('AC-1 integrity — the recorded pre-fix fixture is intact (sha256 as taken from db04843)', () => {
    const bytes = preFixBytes();
    expect({ from: PRE_FIX_SOURCE.from, long: bytes.length >= PRE_FIX_SOURCE.minLength }).toEqual({
      from: PRE_FIX_SOURCE.from,
      long: true,
    });
    expect(createHash('sha256').update(bytes, 'utf8').digest('hex')).toBe(PRE_FIX_SOURCE.sha256);
    expect(PRE_FIX_REV).toBe('db04843');
  });

  it('AC-1 positive control — the SAME matcher FLAGGED the pre-fix audit-labels.ts', () => {
    // This is what separates this guard from one that is green because it
    // matches nothing. The input is the real pre-fix source (digest pinned
    // above), so it cannot be satisfied by a string invented here.
    const flagged = auditLabelAssociations(stripCommentsPreservingLines(preFixBytes()));
    expect(flagged.length).toBeGreaterThanOrEqual(5);
    expect(flagged).toContain('academic_year=Année scolaire');
    expect(flagged).toContain('user_profile=Utilisateurs');
  });

  it('AC-1 — and the SAME matcher is now clean on the current audit-labels.ts', () => {
    expect(
      auditLabelAssociations(CONSUMER_SOURCES.get(PRE_FIX_SOURCE.from) ?? ''),
    ).toEqual([]);
  });

  it('the fixture directory contributes nothing to any walk (it is evidence, not code)', () => {
    expect(existsSync(PRE_FIX_DIR)).toBe(true);
    expect([...CONSUMER_SOURCES.keys()].filter((p) => p.includes('__fixtures__/pre-fix'))).toEqual([]);
    expect(WRITER_FILES.filter((f) => repoRel(f).includes('__fixtures__'))).toEqual([]);
  });
});

/* ================================================================== *
 * V-4 (AC-6, G-TRUTH) — one fixture, every real label path
 * ================================================================== */

/** One fixture set: canonical / legacy / unknown / the fourth portal. */
const TRUTH_FIXTURE = [
  { action: 'role.delete', resourceType: 'calendar_event', portal: 'admin' },
  { action: 'Suppression', resourceType: 'Résultats', portal: 'teacher' },
  { action: 'zz.not_a_real_code', resourceType: 'zz_unknown_type', portal: 'student' },
] as const;

describe('V-4 / AC-6 / G-TRUTH — one fixture, identical labels from every consumer', () => {
  it('the web adapter returns byte-identical labels to the contracts resolver', () => {
    // BEHAVIOURAL. `audit-labels.ts` is the neutral module `page.tsx` calls; its
    // only import is `@pilotage/contracts`, so it can be driven from here.
    for (const row of TRUTH_FIXTURE) {
      expect(humanizeAction(row.action)).toBe(classifyAuditAction(row.action).label);
      expect(humanizeResourceType(row.resourceType)).toBe(
        classifyAuditResourceType(row.resourceType).label,
      );
      expect(humanizePortal(row.portal)).toBe(classifyAuditPortal(row.portal).label);
    }
  });

  it('the API KPI predicates classify the legacy row the same way the renderer does', () => {
    // BEHAVIOURAL — the REAL exported predicate builders, not a copy of them.
    const critical = auditCriticalActionCodes();
    expect(classifyAuditAction('Suppression').vocabulary).toBe('legacy');
    expect(critical).toContain('Suppression');
    expect(auditExportActionCodes()).toContain('Export');
    expect(classifyAuditAction('Export').vocabulary).toBe('legacy');
    // …and the unknown row is in NEITHER predicate, without being relabelled.
    expect(critical).not.toContain('zz.not_a_real_code');
    expect(classifyAuditAction('zz.not_a_real_code').label).toBe('zz.not_a_real_code');
  });

  it('the worker CSV generator reads the same declaration (textual — behavioural half lives in apps/worker)', () => {
    // Stated as textual ON PURPOSE. `apps/api` cannot import `apps/worker`;
    // asserting the CSV bytes from here would be a fiction. The behavioural
    // proof is `audit-csv.generator.spec.ts`, executed by
    // `node scripts/test-ratchet.js worker`.
    const generator = readFileSync(
      join(
        REPO_ROOT,
        'apps',
        'worker',
        'src',
        'modules',
        'exports',
        'generators',
        'audit-csv.generator.ts',
      ),
      'utf8',
    );
    const stripped = stripCommentsPreservingLines(generator);
    expect(stripped).toMatch(/from '@pilotage\/contracts'/);
    expect(stripped).toMatch(/classifyAuditAction\(r\.action\)/);
    expect(stripped).toMatch(/classifyAuditResourceType\(r\.resourceType\)/);
    // The raw columns survive byte-for-byte beside the labels (AC-4's posture).
    expect(stripped).toMatch(/'action',\s*'action_label',/);
    expect(stripped).toMatch(/'resource_type',\s*'resource_type_label',/);
    expect(auditLabelAssociations(stripped)).toEqual([]);
  });

  it('AC-6 — no consumer holds a local copy of either deleted map', () => {
    const webLabels = CONSUMER_SOURCES.get(PRE_FIX_SOURCE.from) ?? '';
    expect(webLabels).not.toBe('');
    expect(webLabels).not.toMatch(/RESOURCE_TYPE_LABELS/);
    expect(webLabels).not.toMatch(/PORTAL_LABELS/);
    expect(webLabels).toMatch(/from '@pilotage\/contracts'/);
    // PF-14 regression guard: this module is CALLED from a server component.
    expect(webLabels).not.toMatch(/['"]use client['"]/);
    // S-E04-3 must not be collateral damage.
    for (const kept of ['PROVENANCE_UNAVAILABLE', 'hasNoProvenance', 'humanizeUserAgent']) {
      expect(webLabels).toContain(kept);
    }
  });
});

/* ================================================================== *
 * V-5 (AC-4) — the legacy row is marked, never rewritten
 * ================================================================== */

describe('V-5 / AC-4 — a legacy value is marked, not relabelled, not hidden', () => {
  it('a legacy French value resolves to itself, flagged legacy', () => {
    expect(classifyAuditResourceType('Résultats')).toEqual({
      code: 'Résultats',
      label: 'Résultats',
      vocabulary: 'legacy',
    });
    expect(classifyAuditAction('Suppression').vocabulary).toBe('legacy');
  });

  it('an undeclared code is returned VERBATIM — the de-underscore fallback is gone (ADR-037 D4)', () => {
    const resolved = classifyAuditResourceType('some_new_code');
    expect(resolved.label).toBe('some_new_code');
    expect(resolved.vocabulary).toBe('unknown');
    // The old behaviour, pinned in the negative so it cannot be "helpfully"
    // restored: a guessed label is indistinguishable from a canonical one.
    expect(resolved.label).not.toBe('Some new code');
  });

  it('every legacy alias resolves to legacy, and none of them is a canonical code', () => {
    for (const code of LEGACY_ACTION_CODES) {
      expect(classifyAuditAction(code).vocabulary).toBe('legacy');
      expect(CANONICAL_CODES.has(code)).toBe(false);
    }
    for (const code of LEGACY_RESOURCE_TYPE_CODES) {
      expect(classifyAuditResourceType(code).vocabulary).toBe('legacy');
    }
  });

  it('the marker exists, is neutral, and reaches the two rendering surfaces', () => {
    expect(LEGACY_FORMAT_MARKER.toLowerCase()).toContain('hérité');
    for (const rel of [
      'apps/web/src/app/admin/audit/AuditTable.tsx',
      'apps/web/src/app/admin/audit/AuditDetailDrawer.tsx',
    ]) {
      const source = CONSUMER_SOURCES.get(rel) ?? '';
      expect(source).not.toBe('');
      expect(source).toMatch(/vocabulary/);
      // Neutral tone, never alert semantics: these rows are older than the
      // vocabulary, not suspect.
      expect(source).not.toMatch(/AlertTriangle/);
    }
  });

  it('no UPDATE or DELETE is issued against audit_log anywhere in the diff surface', () => {
    const offenders: string[] = [];
    for (const [path, source] of CONSUMER_SOURCES) {
      if (/auditLog\.(update|updateMany|delete)\b/.test(source)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== *
 * V-6 (AC-3, AC-5, G-PORTAL) — four portals, three login portals
 * ================================================================== */

describe('V-6 / AC-3 / G-PORTAL — four audit portals, and PORTALS is NOT widened', () => {
  it('AUDIT_PORTALS names all four and labels each in French', () => {
    expect(AUDIT_PORTALS.map((p) => p.code)).toEqual(['admin', 'teacher', 'parent', 'student']);
    // Asserted field-by-field rather than as one object literal: an inline
    // `{ code: 'student', label: 'Élève' }` in this file is an association the
    // AC-1 matcher above would count, and a guard that trips on its own test
    // data is PF-83 inside the file written to prevent it.
    const fourth = classifyAuditPortal('student');
    expect(fourth.code).toBe('student');
    expect(fourth.label).toBe('Élève');
    expect(fourth.vocabulary).toBe('canonical');
    for (const p of AUDIT_PORTALS) {
      expect(classifyAuditPortal(p.code).vocabulary).toBe('canonical');
    }
  });

  it('PORTALS in enums/index.ts is STILL exactly three, and login still validates against it', () => {
    // The non-widening is tested, not assumed. `dto/auth.ts` consumes `PORTALS`
    // as `portal: z.enum(PORTALS)` for LOGIN; adding `student` there would make
    // it a legal login portal — a real authz change, out of scope (ADR-037 D2).
    expect([...PORTALS]).toEqual(['admin', 'teacher', 'parent']);
    const auth = readFileSync(
      join(REPO_ROOT, 'packages', 'contracts', 'src', 'dto', 'auth.ts'),
      'utf8',
    );
    expect(auth).toMatch(/portal:\s*z\.enum\(PORTALS\)/);
  });

  it('AC-5 — only the admin portal renders audit vocabulary; the other three are checked, not assumed', () => {
    // G-PORTAL: name all four and say what was checked for each, rather than
    // reporting only the one being edited.
    const importsAuditVocabulary = (prefix: string): string[] =>
      [...CONSUMER_SOURCES]
        .filter(
          ([path, source]) =>
            path.startsWith(`apps/web/src/app/${prefix}/`) &&
            /(?:audit-labels|classifyAudit)/.test(source),
        )
        .map(([path]) => path);
    expect(importsAuditVocabulary('teacher')).toEqual([]);
    expect(importsAuditVocabulary('parent')).toEqual([]);
    expect(importsAuditVocabulary('student')).toEqual([]);
    expect(importsAuditVocabulary('admin').length).toBeGreaterThan(0);
  });

  it('no writer emits portal: student today — the label exists, the writer was NOT fabricated', () => {
    const provenance = readFileSync(
      join(REPO_ROOT, 'apps', 'api', 'src', 'shared', 'audit', 'provenance.ts'),
      'utf8',
    );
    expect(stripCommentsPreservingLines(provenance)).not.toMatch(/['"]student['"]/);
  });
});

/**
 * The audit half of `analytics.service.ts` — from the exported KPI predicate
 * builders through the end of `auditFacets`. Several DNC-08 rules are about the
 * audit surface, not about a 3 400-line service that also aggregates grades.
 */
function auditKpiRegion(): string {
  const source = CONSUMER_SOURCES.get('apps/api/src/modules/analytics/analytics.service.ts') ?? '';
  const start = source.indexOf('export function auditCriticalActionCodes');
  const auditList = source.indexOf('async auditList(');
  const end = source.indexOf('async auditFacets(');
  expect(start).toBeGreaterThan(-1);
  expect(auditList).toBeGreaterThan(start);
  expect(end).toBeGreaterThan(auditList);
  return source.slice(start, start + 4_000) + source.slice(auditList, end);
}

/* ================================================================== *
 * V-7 (DNC-08) — what cannot be classified stays visible
 * ================================================================== */

describe('V-7 / DNC-08 — an unclassifiable code is never dropped, bucketed or swallowed', () => {
  it('the resolvers are total: any non-empty token returns a non-empty label equal to itself', () => {
    const tokens = ['a', 'Z', '_', '...', 'Élève ', 'role.delete ', '  ', '0', 'ĝ'];
    for (const token of tokens) {
      for (const resolved of [
        classifyAuditAction(token),
        classifyAuditResourceType(token),
        classifyAuditPortal(token),
      ]) {
        expect(resolved.code).toBe(token);
        expect(resolved.label.length).toBeGreaterThan(0);
        if (resolved.vocabulary === 'unknown') expect(resolved.label).toBe(token);
      }
    }
  });

  it('no consumer relabels an unknown code into a generic bucket', () => {
    const surfaces: Array<[string, string]> = [
      ...[
        PRE_FIX_SOURCE.from,
        'apps/web/src/app/admin/audit/AuditTable.tsx',
        'apps/web/src/app/admin/audit/AuditDetailDrawer.tsx',
        'apps/web/src/app/admin/audit/page.tsx',
      ].map((rel): [string, string] => [rel, CONSUMER_SOURCES.get(rel) ?? '']),
      // Scoped to the audit KPI region rather than the whole 3 400-line
      // service: `analytics.service.ts:2329` carries `label: 'Autre'` for an
      // unrelated grade-level bucket, and reddening on it would be PF-83 — a
      // rule going off on code the slice never touched.
      ['analytics.service.ts (audit KPI region)', auditKpiRegion()],
    ];
    for (const [name, source] of surfaces) {
      expect({ name, empty: source === '' }).toEqual({ name, empty: false });
      for (const bucket of ["'Inconnu'", "'Autre'", "'N/A'"]) {
        expect({ name, bucket, present: source.includes(bucket) }).toEqual({
          name,
          bucket,
          present: false,
        });
      }
    }
  });

  it('no consumer wraps a resolver call in a try/catch', () => {
    // A resolver that cannot throw does not need one; a `catch` around it is how
    // a row silently disappears from a governance surface.
    for (const [path, source] of CONSUMER_SOURCES) {
      if (!/classifyAudit\w+\(/.test(source)) continue;
      const wrapped = /try\s*\{[^}]*classifyAudit\w+\([^}]*\}\s*catch/s.test(source);
      expect({ path, wrapped }).toEqual({ path, wrapped: false });
    }
  });

  it('the facet builder maps every observed value — no filter between the array and its map', () => {
    const page = CONSUMER_SOURCES.get('apps/web/src/app/admin/audit/page.tsx') ?? '';
    expect(page).not.toBe('');
    expect(page).not.toMatch(/facets\.resourceTypes[^\n;]*\.filter\(/);
    expect(page).not.toMatch(/facets\.portals[^\n;]*\.filter\(/);
    expect(page).not.toMatch(/facets\.actions[^\n;]*\.filter\(/);
  });

  it('the facets themselves still return raw distinct codes (S-E04-7 is not pre-empted)', () => {
    const analytics = CONSUMER_SOURCES.get('apps/api/src/modules/analytics/analytics.service.ts') ?? '';
    expect(analytics).toMatch(/distinct: \['resourceType'\]/);
    expect(analytics).toMatch(/distinct: \['portal'\]/);
  });
});

/* ================================================================== *
 * V-8 (DNC-09, AC-8) — no KPI card can structurally read only 0
 * ================================================================== */

describe('V-8 / DNC-09 / AC-8 — every populated KPI can match, and the empty one says so', () => {
  it('criticalChanges spans BOTH vocabularies — canonical codes AND frozen legacy aliases', () => {
    const critical = auditCriticalActionCodes();
    // Both declared halves are non-empty: an "empty canonical half" would mean
    // the card counts only history, and an empty legacy half would mean it
    // counts nothing on any tenant that exists today.
    expect(AUDIT_CRITICAL_ACTIONS.length).toBeGreaterThan(0);
    expect(LEGACY_AUDIT_ACTION_ALIASES.some((a) => a.critical)).toBe(true);
    expect(critical.some((c) => CANONICAL_CODES.has(c))).toBe(true);
    expect(critical.some((c) => LEGACY_ACTION_CODES.includes(c))).toBe(true);
    // Named: the demo tenant's only matchable row today, and a code the API
    // actually writes.
    expect(critical).toContain('Suppression');
    expect(critical).toContain('role.delete');
    // The three strings that matched nothing are gone.
    for (const dead of ['delete', 'revise', 'Révision']) {
      expect(critical).not.toContain(dead);
    }
  });

  it('sensitiveExports spans both, and the substring predicate is gone', () => {
    const exports = auditExportActionCodes();
    expect(exports).toContain('export.bulletin.request');
    expect(exports).toContain('Export');
    expect(AUDIT_EXPORT_ACTIONS.length).toBeGreaterThan(0);
    const analytics = CONSUMER_SOURCES.get('apps/api/src/modules/analytics/analytics.service.ts') ?? '';
    expect(analytics).not.toMatch(/contains:\s*'Export'/);
    expect(analytics).not.toMatch(/contains:\s*'login'/);
  });

  it('every declared export action is actually an export.* code — the derivation is complete', () => {
    const written = [...WRITTEN_ACTIONS].filter((c) => c.startsWith('export.')).sort();
    expect(written.length).toBeGreaterThan(0);
    expect([...AUDIT_EXPORT_ACTIONS].sort()).toEqual(written);
  });

  it('adminLogins is NOT instrumented, is null, and never runs a { in: [] } count', () => {
    expect(AUDIT_LOGIN_ACTIONS).toHaveLength(0);
    expect(auditLoginActionCodes()).toEqual([]);
    const analytics = CONSUMER_SOURCES.get('apps/api/src/modules/analytics/analytics.service.ts') ?? '';
    // Three counts in the Promise.all, and the fourth value is a null, not a
    // query that can only read 0.
    expect(analytics).toMatch(/const \[today, criticalChanges, sensitiveExports\] = await Promise\.all/);
    expect(analytics).toMatch(/loginActions\.length === 0\s*\?\s*null/);
    expect(analytics).toMatch(/adminLogins: number \| null;/);
    // PF-138 — the branch is dormant, so no runtime assertion can catch it
    // losing the scope its own card claims. The card reads « CONNEXIONS ADMIN »;
    // the query that wakes up when `AUDIT_LOGIN_ACTIONS` gains a code must still
    // be admin-scoped, or the first slice to instrument login silently makes an
    // RGPD governance card over-report teacher, parent and student sessions.
    // Asserted on the source precisely because there is no behaviour to assert.
    expect(analytics).toMatch(
      /where: \{ tenantId, portal: 'admin', action: \{ in: loginActions \} \}/,
    );
  });

  it('the page reports the gap rather than a fabricated zero', () => {
    const page = CONSUMER_SOURCES.get('apps/web/src/app/admin/audit/page.tsx') ?? '';
    expect(page).toContain('Non instrumenté');
  });

  it('the KPI predicates hold NO inline vocabulary of their own', () => {
    const analytics = CONSUMER_SOURCES.get('apps/api/src/modules/analytics/analytics.service.ts') ?? '';
    expect(analytics).toMatch(/AUDIT_CRITICAL_ACTIONS/);
    expect(analytics).toMatch(/LEGACY_AUDIT_CRITICAL_ALIASES/);
    expect(analytics).toMatch(/from '@pilotage\/contracts'/);
    expect(auditLabelAssociations(analytics)).toEqual([]);
  });
});

/* ================================================================== *
 * V-9 — ADR-037 is on the record
 * ================================================================== */

describe('V-9 — ADR-037 records the five decisions', () => {
  const ADR_PATH = join(REPO_ROOT, 'docs', 'adr', 'ADR-037-one-canonical-audit-vocabulary.md');
  const adr = (): string => readFileSync(ADR_PATH, 'utf8');

  it('exists', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  it('D1 — the new module, not an append to enums/index.ts', () => {
    const text = adr();
    expect(text).toMatch(/packages\/contracts\/src\/audit/);
    expect(text).toMatch(/enums\/index\.ts/);
  });

  it('D2 — PORTALS is NOT widened, with the dto/auth.ts reason', () => {
    const text = adr();
    expect(text).toMatch(/dto\/auth\.ts/);
    expect(text).toMatch(/z\.enum\(PORTALS\)/);
    expect(text).toMatch(/AUDIT_PORTALS/);
  });

  it('D3 — a Prisma enum is refused, in writing', () => {
    const text = adr();
    expect(text).toMatch(/enum Prisma|Prisma enum/i);
    expect(text).toMatch(/refus/i);
  });

  it('D4 — the legacy rows are never updated, and the fallback behaviour changed', () => {
    const text = adr();
    expect(text).toMatch(/append-only/i);
    expect(text).toMatch(/verbatim/i);
    expect(text).toMatch(/format hérité/i);
  });

  it('D5 — the worker value-imports contracts and contracts/dist is a build prerequisite', () => {
    const text = adr();
    expect(text).toMatch(/dist/);
    expect(text).toMatch(/worker/i);
  });
});

/* ================================================================== *
 * V-10 — the seed writes the declaration, and stays append-only
 * ================================================================== */

describe('V-10 — a fresh seed writes canonical codes plus exactly three legacy fixtures', () => {
  it('every canonical code the seed writes is a member of the declaration', () => {
    expect(SEED.canonicalActions.length).toBeGreaterThan(0);
    expect(SEED.canonicalResourceTypes.length).toBeGreaterThan(0);
    const actions = new Set(DECLARED_ACTIONS);
    const resourceTypes = new Set(DECLARED_RESOURCE_TYPES);
    expect(SEED.canonicalActions.filter((c) => !actions.has(c)).sort()).toEqual([]);
    expect(SEED.canonicalResourceTypes.filter((c) => !resourceTypes.has(c)).sort()).toEqual([]);
  });

  it('the legacy fixture block holds exactly three rows, all from the frozen alias table', () => {
    // Three, and named: without them a fresh machine cannot demonstrate AC-4's
    // rendering or DNC-09's alias matching at all. They are a fixture, not a
    // template — nothing else in the seed writes a French display string.
    expect(SEED.legacyRowCount).toBe(3);
    expect(SEED.legacyActions.filter((c) => !LEGACY_ACTION_CODES.includes(c))).toEqual([]);
    expect(SEED.legacyResourceTypes.filter((c) => !LEGACY_RESOURCE_TYPE_CODES.includes(c))).toEqual(
      [],
    );
    // They cover both KPI aliases, so `criticalChanges` and `sensitiveExports`
    // are non-zero on a fresh seed (DNC-09 is demonstrable, not just argued).
    expect(SEED.legacyActions).toContain('Suppression');
    expect(SEED.legacyActions).toContain('Export');
  });

  it('the seed still never updates or deletes an audit row beyond the tenant reset', () => {
    const seed = stripCommentsPreservingLines(readFileSync(SEED_PATH, 'utf8'));
    expect(seed).not.toMatch(/auditLog\.(update|updateMany|delete)\b/);
    const deleteMany = seed.match(/auditLog\.deleteMany/g) ?? [];
    expect(deleteMany).toHaveLength(1);
    // …and it is the demo-tenant reset, not a widened purge.
    expect(seed).toMatch(/auditLog\.deleteMany\(\{ where: \{ tenantId: T \} \}\)/);
  });
});
