import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * TOOL-15 AC-4 — the ratchet that keeps spec writers hermetic.
 *
 * THE RULE, IN ONE LINE
 * ---------------------
 * A spec may write only into a tree it created under `tmpdir()`. `ADR-039`
 * records the decision; this file is the executed half of it.
 *
 * WHAT WENT WRONG, AND WHY A RATCHET RATHER THAN A FIX
 * ----------------------------------------------------
 * Two specs planted a probe file inside the REAL working checkout and deleted it
 * again — `csv-escape-gate.spec.ts` wrote `apps/web/src/lib/__csv_escape_probe
 * .tsx`, `audit-write-gate.spec.ts` wrote `apps/api/src/shared/quality/
 * __audit_write_probe.ts`. Under parallel jest any process that LISTED one of
 * those directories and then READ what it listed could be handed a path that no
 * longer existed. Five spec suites died at LOAD that way (`TOOL-17`), and
 * `scripts/link-integrity-check.js` printed a stack trace where its verdict line
 * belongs (`TOOL-18`). Two `node scripts/test-ratchet.js api` runs over ONE
 * unchanged tree produced two DIFFERENT failure sets.
 *
 * Both probes are relocated by this story. This file is what stops the third one
 * from being written: a defect removed without a ratchet comes back.
 *
 * PARSED, NEVER GREPPED — AND THIS ONE IS MEASURED, NOT PREFERRED
 * ---------------------------------------------------------------
 * `test-ratchet.spec.ts:110` and `:214` contain
 * `rmSync(scratch, { recursive: true, force: true })` INSIDE STRING LITERALS —
 * it asserts over the text of another file. A text scan flags both, and the only
 * way to make a text scan green again is to weaken it, which is `R-30` exactly.
 * So the corpus is parsed. `require('typescript')` is a root devDependency and
 * both sibling check scripts already state this doctrine, so no dependency and
 * no architectural decision is introduced.
 *
 * WHY THE CLASSIFIER IS THIS SHAPE AND NOT "initialised from mkdtempSync"
 * -----------------------------------------------------------------------
 * The narrow phrasing — *"the destination derives from a binding INITIALISED
 * from `mkdtempSync`/`tmpdir()`"* — was measured against the real corpus and
 * false-reds FOUR of the seven legitimate writers. Each defeats it differently,
 * and each is asserted BY NAME below so a future narrowing is caught here:
 *
 *   (a) `observability-gate.spec.ts` — `let dir = '';` then `dir = mkdtempSync(…)`
 *       in `beforeAll`. The initialiser is a STRING LITERAL; the scratch value
 *       arrives by ASSIGNMENT.
 *   (b) `production-artefact-gate.spec.ts` — `let scratch: string;` with NO
 *       initialiser at all, assigned in `beforeAll`, and the write sits three
 *       hops away inside `fixture()`, across a function boundary.
 *   (c) `walk-read-gate.spec.ts` — the destination is a CALL EXPRESSION,
 *       `scratchFile('alpha.ts')`, whose arrow body returns `join(scratch, name)`.
 *   (d) `link-integrity-gate.spec.ts` — derived two hops inside a factory
 *       function, and its cleanup iterates an array of collected scratch roots.
 *
 * So a destination is legitimate iff it TRANSITIVELY derives from a binding whose
 * initialiser OR ANY ASSIGNMENT is `mkdtempSync(…)` / a `join()` rooted at
 * `tmpdir()`, following (i) `join`/`resolve`/`dirname` argument chains,
 * (ii) assignments as well as declarations, and (iii) the returns of
 * locally-declared functions and arrows. Measured over all 108 spec files under
 * `apps/**`: 61 write calls, 0 violations — no allowlist was needed, and none is
 * declared. `AC-4` permitted a hand-maintained allowlist as the fallback; it is
 * not taken, and this paragraph is the "say which you chose and why".
 *
 * WHY IT LIVES HERE
 * -----------------
 * `apps/api/src/shared/quality/`, beside its siblings. `TOOL-04` escalates the
 * gate on a diff matching `apps/api/src/shared/quality/` — this diff already
 * matches on that and on `scripts/`, so the escalation is priced in and is not a
 * reason to put the file somewhere else.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const WALK_READ_PATH = join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js');
const CORPUS_ROOT = join(REPO_ROOT, 'apps');

/**
 * The floor on the corpus.
 *
 * Measured **108** spec files under `apps/**` this run. Ninety has headroom for
 * ordinary deletion without being vacuous — "found nothing, therefore pass" is
 * the failure mode every gate in this directory exists to refuse.
 */
const MIN_SPEC_FILES = 90;

/**
 * The floor on what the classifier actually SAW.
 *
 * A ratchet that parsed 108 files and recognised zero write calls would be green
 * for the worst possible reason. Measured 61; the floor is set below it so a
 * refactor does not trip it and high enough that a broken matcher cannot pass.
 */
const MIN_WRITE_CALLS = 30;

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage']);
const SPEC_FILE = /\.(spec|test)\.tsx?$/;

/* eslint-disable @typescript-eslint/no-require-imports */
// Unguarded on purpose (DNC-08): a MISSING MODULE is a different seam from a
// VANISHING WALKED FILE. If either of these disappears this suite must fail at
// LOAD rather than degrade into "nothing to check, therefore pass".
const walkRead = require(WALK_READ_PATH) as {
  MAX_VANISHED_FILES: number;
  maxVanishedFor: (n: number) => number;
  mapWalkedFiles: <V>(
    paths: string[],
    build: (path: string, source: string) => [string, V],
  ) => { entries: [string, V][]; skipped: string[] };
  warnSkipped: (label: string, skipped: string[]) => boolean;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ts = require('typescript') as any;
/* eslint-enable @typescript-eslint/no-require-imports */

/* ================================================================== *
 * The classifier — exported shape, driven by string in the red-proof
 * ================================================================== */

/** Calls whose named argument is a filesystem DESTINATION, and which argument that is. */
const WRITE_CALLS = new Map<string, number>([
  ['writeFileSync', 0],
  ['writeFile', 0],
  ['appendFileSync', 0],
  ['appendFile', 0],
  ['mkdirSync', 0],
  ['mkdir', 0],
  ['mkdtempSync', 0],
  ['rmSync', 0],
  ['rm', 0],
  ['rmdirSync', 0],
  ['unlinkSync', 0],
  ['truncateSync', 0],
  ['openSync', 0],
  ['createWriteStream', 0],
  ['chmodSync', 0],
  ['utimesSync', 0],
  // Two-argument forms: the SOURCE may legitimately be the real tree; the
  // DESTINATION may not. `schema-drift-gate.spec.ts` copies the real schema into
  // its scratch tree exactly this way.
  ['copyFileSync', 1],
  ['cpSync', 1],
  ['renameSync', 1],
  ['symlinkSync', 1],
  ['linkSync', 1],
]);

/** The two roots that make a destination hermetic, plus the path combinators that carry them. */
const SCRATCH_ROOTS = new Set(['mkdtempSync', 'mkdtemp', 'tmpdir']);
const PATH_COMBINATORS = new Set(['join', 'resolve', 'dirname', 'normalize', 'relative', 'format']);

interface Violation {
  line: number;
  call: string;
  destination: string;
}

interface Classification {
  writes: number;
  violations: Violation[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function classify(relPath: string, source: string): Classification {
  const sourceFile = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  /** name → every expression ever assigned to it (declaration AND assignment). */
  const assignments = new Map<string, any[]>();
  /** locally-declared function/arrow name → every expression it can return. */
  const returns = new Map<string, any[]>();
  /** array binding name → literal elements plus everything `push`ed onto it. */
  const arrays = new Map<string, any[]>();
  /** `for (const x of E)` bindings, resolved once the arrays are known. */
  const forOfBindings: { name: string; iterable: any }[] = [];
  const writes: { node: any; destination: any; call: string }[] = [];

  const record = (map: Map<string, any[]>, key: string, value: any) => {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  };

  const calleeName = (node: any): string => {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) return callee.text;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) return callee.name.text;
    return '';
  };

  const unwrap = (node: any): any => {
    let current = node;
    for (;;) {
      if (!current) return current;
      if (
        ts.isParenthesizedExpression(current) ||
        ts.isAwaitExpression(current) ||
        ts.isNonNullExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isSpreadElement(current)
      ) {
        current = current.expression;
      } else {
        return current;
      }
    }
  };

  /** Return expressions of one function body, NOT descending into nested functions. */
  const collectReturns = (body: any): any[] => {
    const found: any[] = [];
    const walk = (node: any) => {
      if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return;
      if (ts.isReturnStatement(node) && node.expression) found.push(node.expression);
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(body, walk);
    return found;
  };

  const visit = (node: any) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      const init = unwrap(node.initializer);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        // A concise arrow body IS the return expression — shape (c).
        returns.set(name, ts.isArrowFunction(init) && !ts.isBlock(init.body) ? [init.body] : collectReturns(init.body));
      } else if (ts.isArrayLiteralExpression(init)) {
        arrays.set(name, [...init.elements]);
      } else {
        record(assignments, name, init);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      returns.set(node.name.text, collectReturns(node.body));
    }
    // Shapes (a) and (b): the scratch value arrives by ASSIGNMENT, often in a
    // `beforeAll`, sometimes onto a binding declared with no initialiser at all.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      record(assignments, node.left.text, unwrap(node.right));
    }
    if (ts.isForOfStatement(node)) {
      const declarations = node.initializer;
      const first = ts.isVariableDeclarationList(declarations) ? declarations.declarations[0] : undefined;
      if (first && ts.isIdentifier(first.name)) {
        forOfBindings.push({ name: first.name.text, iterable: unwrap(node.expression) });
      }
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (
        name === 'push' &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression)
      ) {
        for (const argument of node.arguments) record(arrays, node.expression.expression.text, argument);
      }
      if (WRITE_CALLS.has(name)) {
        writes.push({ node, destination: node.arguments[WRITE_CALLS.get(name) as number], call: name });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const hermetic = new Set<string>();

  const isHermetic = (expression: any, seen: Set<string>): boolean => {
    const node = unwrap(expression);
    if (!node) return false;
    if (ts.isIdentifier(node)) return hermetic.has(node.text);
    if (ts.isTemplateExpression(node)) {
      return node.templateSpans.some((span: any) => isHermetic(span.expression, seen));
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return isHermetic(node.left, seen) || isHermetic(node.right, seen);
    }
    if (ts.isConditionalExpression(node)) {
      // Strict on purpose: a branch that can yield a real-tree path is a violation.
      return isHermetic(node.whenTrue, seen) && isHermetic(node.whenFalse, seen);
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (SCRATCH_ROOTS.has(name)) return true;
      if (PATH_COMBINATORS.has(name)) return node.arguments.some((argument: any) => isHermetic(argument, seen));
      if (returns.has(name)) {
        if (seen.has(name)) return false; // recursion guard
        seen.add(name);
        const bodies = returns.get(name) as any[];
        const ok = bodies.length > 0 && bodies.every((body) => isHermetic(body, seen));
        seen.delete(name);
        return ok;
      }
    }
    return false;
  };

  // Fixpoint: a binding can become hermetic through another binding that only
  // becomes hermetic later in the file (a `beforeAll` below its declaration).
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, expressions] of assignments) {
      if (hermetic.has(name)) continue;
      if (expressions.some((expression) => isHermetic(expression, new Set()))) {
        hermetic.add(name);
        changed = true;
      }
    }
    for (const { name, iterable } of forOfBindings) {
      if (hermetic.has(name)) continue;
      let elements: any[] | null = null;
      if (ts.isIdentifier(iterable) && arrays.has(iterable.text)) elements = arrays.get(iterable.text) as any[];
      else if (ts.isArrayLiteralExpression(iterable)) elements = [...iterable.elements];
      if (elements && elements.length > 0 && elements.every((element) => isHermetic(element, new Set()))) {
        hermetic.add(name);
        changed = true;
      }
    }
  }

  const violations: Violation[] = [];
  for (const write of writes) {
    if (!write.destination) continue;
    if (isHermetic(write.destination, new Set())) continue;
    const { line } = sourceFile.getLineAndCharacterOfPosition(write.node.getStart(sourceFile));
    violations.push({
      line: line + 1,
      call: write.call,
      destination: String(write.destination.getText(sourceFile)).slice(0, 120),
    });
  }
  return { writes: writes.length, violations };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ================================================================== *
 * The corpus — walked, then read through the ONE tolerant seam
 * ================================================================== */

function walkSpecs(root: string): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        stack.push(join(current, entry.name));
      } else if (SPEC_FILE.test(entry.name)) {
        files.push(join(current, entry.name));
      }
    }
  }
  return files.sort();
}

const rel = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

const SPEC_FILES = walkSpecs(CORPUS_ROOT);

// Read through `scripts/lib/walk-read.js` — the seam that exists precisely
// because a walked path can vanish before it is read. Once this ratchet is green
// nothing plants such a path any more, but the seam stays: any FUTURE writer,
// and the five sites TOOL-17 converted, still need it.
const { entries, skipped } = walkRead.mapWalkedFiles<Classification>(SPEC_FILES, (path, source) => [
  rel(path),
  classify(rel(path), source),
]);
const CLASSIFIED = new Map(entries);
walkRead.warnSkipped('hermetic-spec-writers-gate', skipped);

/* ================================================================== *
 * 1 — the walk is believable before anything is concluded from it
 * ================================================================== */

describe('the corpus this ratchet judged is the corpus it walked', () => {
  it('carries the accounting identity — a floor on the LIST does not transport to the MAP', () => {
    expect(CLASSIFIED.size + skipped.length).toBe(SPEC_FILES.length);
  });

  it('lost no more than the corpus-scaled budget to the walk/read race', () => {
    // TOOL-17b: the budget scales with the walked list — a flat 5 is negligible
    // against 108 spec files but was half the corpus at `portal-landing-gate`'s
    // 10-file walk. `MAX_VANISHED_FILES` stays the ceiling.
    expect(skipped.length).toBeLessThanOrEqual(walkRead.maxVanishedFor(SPEC_FILES.length));
  });

  it('has a FLOOR — an empty walk is never a pass', () => {
    expect(SPEC_FILES.length).toBeGreaterThanOrEqual(MIN_SPEC_FILES);
    // The map floor tightens with the same scaled budget: it is a SUBTRACTION,
    // not a comparison, so it must move together with the cap above or the two
    // halves of the same accounting drift apart.
    expect(CLASSIFIED.size).toBeGreaterThanOrEqual(
      MIN_SPEC_FILES - walkRead.maxVanishedFor(SPEC_FILES.length),
    );
  });

  it('actually RECOGNISED write calls — a matcher that sees none is green for the worst reason', () => {
    const total = [...CLASSIFIED.values()].reduce((sum, result) => sum + result.writes, 0);
    expect(total).toBeGreaterThanOrEqual(MIN_WRITE_CALLS);
  });
});

/* ================================================================== *
 * 2 — the rule itself
 * ================================================================== */

describe('AC-4 — no spec under apps/** writes outside a tree it created under tmpdir()', () => {
  it('reports ZERO violations across the whole corpus', () => {
    const offenders = [...CLASSIFIED.entries()]
      .filter(([, result]) => result.violations.length > 0)
      .map(([path, result]) => `${path} → ${result.violations.map((v) => `${v.call} @${v.line} ${v.destination}`).join(' | ')}`);
    expect(offenders).toEqual([]);
  });

  it('the two relocated probes are gone from the corpus TEXT as well as from the rule', () => {
    // The rule above is about DESTINATIONS. This is the direct observation of the
    // two specific paths TOOL-15/TOOL-17/TOOL-18 were raised over, so a rewrite
    // that satisfied the classifier while keeping a real-tree probe alive under
    // another spelling still fails here.
    for (const probe of ['__csv_escape_probe', '__audit_write_probe']) {
      const planted = [...CLASSIFIED.keys()].filter((path) => {
        const result = CLASSIFIED.get(path) as Classification;
        return result.violations.some((v) => v.destination.includes(probe));
      });
      expect(planted).toEqual([]);
    }
  });
});

/* ================================================================== *
 * 3 — the four shapes that a narrower rule would false-red, BY NAME
 * ================================================================== */

describe('the legitimate scratch writers stay green — each shape asserted by name', () => {
  const named = (path: string) => CLASSIFIED.get(path) as Classification | undefined;

  it.each([
    // shape (a) — `let dir = ''` then assigned from mkdtempSync in beforeAll
    ['apps/api/src/shared/quality/observability-gate.spec.ts'],
    // shape (b) — `let scratch: string` with NO initialiser, write three hops away
    ['apps/api/src/shared/quality/production-artefact-gate.spec.ts'],
    // shape (c) — destination is a CALL EXPRESSION, `scratchFile('alpha.ts')`
    ['apps/api/src/shared/quality/walk-read-gate.spec.ts'],
    // shape (d) — two hops inside a factory, cleanup iterating collected roots
    ['apps/api/src/shared/quality/link-integrity-gate.spec.ts'],
    // the two relocated writers themselves
    ['apps/api/src/shared/quality/csv-escape-gate.spec.ts'],
    ['apps/api/src/shared/quality/audit-write-gate.spec.ts'],
    // and the copyFileSync(src → scratch) shape
    ['apps/api/src/shared/quality/schema-drift-gate.spec.ts'],
  ])('%s writes only into its scratch tree, and its writes WERE seen', (path) => {
    const result = named(path);
    expect(result).toBeDefined();
    // Both halves matter: zero violations over zero recognised writes proves
    // nothing about this file.
    expect((result as Classification).writes).toBeGreaterThan(0);
    expect((result as Classification).violations).toEqual([]);
  });
});

/* ================================================================== *
 * 4 — SHOWN able to fail, without writing into apps/**
 * ================================================================== */

/**
 * The red-proof is driven with the fixture source AS A STRING.
 *
 * Planting a fixture spec inside the corpus to prove the ratchet can fail would
 * recreate the exact defect this story removes, and placing it under a scratch
 * tree would still leave the walk root untouched — so the classifier is called
 * directly. *"An assertion about a gate that cannot fail is not an assertion"*
 * (`R-30`), and this is the executed answer to it.
 */
describe('R-30 — the ratchet is SHOWN red, and red for the stated reason', () => {
  it('flags a write whose destination is rooted at REPO_ROOT — the exact defect TOOL-15 removed', () => {
    const fixture = [
      "import { writeFileSync } from 'node:fs';",
      "import { join, resolve } from 'node:path';",
      "const REPO_ROOT = resolve(__dirname, '..', '..');",
      "it('plants a probe in the checkout', () => {",
      "  writeFileSync(join(REPO_ROOT, 'apps', 'web', 'src', 'lib', '__probe.tsx'), 'x', 'utf8');",
      '});',
      '',
    ].join('\n');
    const result = classify('apps/api/src/shared/quality/__fixture.spec.ts', fixture);
    expect(result.writes).toBe(1);
    expect(result.violations).toHaveLength(1);
    const [violation] = result.violations as [Violation];
    expect(violation.call).toBe('writeFileSync');
    expect(violation.destination).toContain('__probe.tsx');
  });

  it('flags a two-argument copy whose DESTINATION is the real tree, even when the source is scratch', () => {
    const fixture = [
      "import { copyFileSync, mkdtempSync } from 'node:fs';",
      "import { tmpdir } from 'node:os';",
      "import { join, resolve } from 'node:path';",
      "const REPO_ROOT = resolve(__dirname, '..');",
      "const scratch = mkdtempSync(join(tmpdir(), 'x-'));",
      "copyFileSync(join(scratch, 'a.ts'), join(REPO_ROOT, 'apps', 'web', 'src', 'a.ts'));",
      '',
    ].join('\n');
    const result = classify('apps/api/src/shared/quality/__fixture.spec.ts', fixture);
    expect(result.violations.map((v) => v.call)).toEqual(['copyFileSync']);
  });

  it('is not fooled by a scratch-LOOKING name that was never rooted at tmpdir()', () => {
    const fixture = [
      "import { writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "const scratch = join(__dirname, '__scratch');",
      "writeFileSync(join(scratch, 'probe.ts'), 'x', 'utf8');",
      '',
    ].join('\n');
    const result = classify('apps/api/src/shared/quality/__fixture.spec.ts', fixture);
    expect(result.violations).toHaveLength(1);
  });

  it('and is GREEN on the same write once the binding is genuinely rooted at tmpdir()', () => {
    const fixture = [
      "import { mkdtempSync, writeFileSync } from 'node:fs';",
      "import { tmpdir } from 'node:os';",
      "import { join } from 'node:path';",
      'let scratch: string;',
      'beforeAll(() => {',
      "  scratch = mkdtempSync(join(tmpdir(), 'x-'));",
      '});',
      "const at = (name: string) => join(scratch, name);",
      "writeFileSync(at('probe.ts'), 'x', 'utf8');",
      '',
    ].join('\n');
    const result = classify('apps/api/src/shared/quality/__fixture.spec.ts', fixture);
    expect(result.writes).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
  });

  it('does NOT flag a write call that only exists inside a string literal (R-30, the reason this parses)', () => {
    // `test-ratchet.spec.ts:110` is exactly this, and a text scan flags it.
    const fixture = [
      'const NO_REPORT_BLOCK = [',
      "  '    rmSync(scratch, { recursive: true, force: true });',",
      "].join('\\n');",
      'export { NO_REPORT_BLOCK };',
      '',
    ].join('\n');
    const result = classify('apps/api/src/shared/quality/__fixture.spec.ts', fixture);
    expect(result.writes).toBe(0);
    expect(result.violations).toEqual([]);
  });
});
