#!/usr/bin/env node
/**
 * S-E05-1 — the CSV-escaper ratchet (gates G-TRUTH, G-PORTAL, G-DNC · `ADR-037` D8).
 *
 * WHAT THIS GATE DECIDES
 * ----------------------
 * `PF-168` is the same security predicate answered differently by different
 * files. At HEAD, "is this cell dangerous?" had FIVE implementations across the
 * monorepo, and the same operator-entered `profession` string escaped three
 * different ways depending on which button emitted it. `S-E05-1` lifted the
 * predicate into `packages/contracts/src/security/csv-injection.ts` and deleted
 * the copies — but a sweep without a ratchet is a sweep that has to be done
 * again, and `PF-168` was itself raised against a slice that had already "fixed"
 * this once. This file is the ratchet: after `S-E05-1` the correct number of CSV
 * escapers is **two**, and two is the ceiling.
 *
 * There is deliberately **no baseline file and no baselineable class**. The other
 * ratchets in this directory carry one because they froze a large pre-existing
 * inventory; this one has a ceiling of two, and a JSON file whose purpose is to
 * add a third row to a two-row ceiling is the off switch with a house-style
 * alibi.
 *
 * THE WALK ROOT, STATED — AND WHY IT INCLUDES `.tsx`
 * -------------------------------------------------
 *     apps/web/src + apps/worker/src + apps/api/src +
 *     packages/contracts/src + packages/ui/src + packages/imports-core/src
 *
 * `.tsx` is walked as well as `.ts`, and that is not symmetry for its own sake:
 * THREE of the five copies this slice deleted lived in `.tsx` files
 * (`AlertsExportButton.tsx`, `parent/grades/GradesExport.tsx`,
 * `parent/attendance/AttendanceExport.tsx`). A `.ts`-only walk — the shape
 * `audit-write-check.js` legitimately uses for a root that holds no components —
 * would be blind to the exact defect being closed. That is `S-E06-5` (a surface
 * bundled into every portal but sitting outside the gate's walk root) recurring
 * at a third address. The root is printed on every run, PASS or FAIL, so a count
 * in a PR is never separable from the tree it was measured over.
 *
 * `*.spec.ts` / `*.spec.tsx` are excluded, and the exclusion is stated rather
 * than left implicit: `audit-csv.generator.spec.ts:582` deliberately declares a
 * `webEscape` mirror of the web dialect (T-3) because `apps/web` has no unit
 * runner, and `:487` asserts the trigger array element-by-element. Both are
 * assertions ABOUT the predicate, not second implementations OF it — a gate that
 * could not tell those apart would make its own driving test illegal.
 *
 * DIVERGENCE FROM THE STORY'S FR-5, RECORDED RATHER THAN SILENTLY ABSORBED
 * -----------------------------------------------------------------------
 * `docs/spec/features/v3-e05/stories/S-E05-1.md` FR-5 rule A defines the escaper
 * matcher as the NAME test `/^(csv[_-]?escape|escape[_-]?csv)$/i`. That matcher
 * was written from a measurement of three copies all called `csvEscape`. The
 * implementation then measured **five**: the two extra copies on the parent
 * portal were called `escapeCell`, which is precisely why `PF-168`'s own grep
 * (for `csvEscape`) reported the wrong count — the finding undercounted itself
 * for exactly the reason a name-only gate would be blind here.
 *
 * So rule A below is the union of TWO detectors, and the second is the load-
 * bearing one:
 *
 *   A-name   the declaration is CALLED something csv-escaper-ish (now including
 *            `escapeCell` / `cellEscape`), or
 *   A-shape  the declaration IS an RFC-4180 escaper, whatever it is called:
 *            its body both tests a character class containing `"` and performs
 *            the quote-doubling `.replace(/"/g, '""')`.
 *
 * A-shape is what makes this gate see a copy that simply picks a new name, which
 * is the failure mode a name-only rule invites the moment it is documented. It
 * is also what makes the exclusion list below REAL: the two `apps/api` transport
 * sites are named `escape`, match no name pattern, and would be invisible to
 * FR-5 as written — yet both files carry a shipped comment stating that
 * "`scripts/csv-escape-check.js` excludes this site by name". Under FR-5 as
 * written those two comments would be false. Under A-shape they are true, and
 * rule D fails on a stale exclusion, so they stay true.
 *
 * THE SANCTIONED SET, AND THE EXCLUDED SET — TWO DIFFERENT THINGS
 * --------------------------------------------------------------
 * SANCTIONED (2) are the escapers that MUST exist and MUST consume the shared
 * predicate. EXCLUDED (2) are sites that are deliberately NOT neutralised, each
 * with the reason in this file and the same reason in the source. The
 * distinction is the whole of `ADR-037` D8's second half: the neutraliser
 * belongs on PRESENTATION CSV — a file a human opens in a spreadsheet — and must
 * NOT be applied to TRANSPORT CSV that is stored and re-parsed, where an
 * apostrophe would corrupt the stored source data.
 *
 * THE FIVE RULES
 * --------------
 *   A  Any CSV escaper (by name or by shape) under the walk root that is neither
 *      SANCTIONED nor EXCLUDED is a FAILURE. There is no baseline to add it to.
 *   B  The trigger characters may be assembled ONLY inside
 *      `packages/contracts/src/security/csv-injection.ts`. A trigger array, or a
 *      `^`-anchored character class carrying both `=` and `@`, anywhere else is
 *      a FAILURE. This is the rule that catches a copy which avoided the NAME.
 *   C  Each SANCTIONED file must import `neutraliseCsvCell` from
 *      `@pilotage/contracts` AND its escaper body must CALL it. An escaper that
 *      stops calling the shared function is the regression this gate exists for,
 *      and — because `apps/web` has no unit runner — rule C is the ONLY executed
 *      evidence that the web half of `S-E05-1` is really wired.
 *   D  One-way, and vacuity-guarded (DNC-08). A sanctioned or excluded entry
 *      matching ZERO declarations is a FAILURE (stale — the ceiling only comes
 *      down). Fewer than 2 sanctioned escapers found is a FAILURE.
 *   E  No off switch (DNC-10). No environment variable is read. The only flag is
 *      `--help`; any other argument exits non-zero. There is deliberately no
 *      `--update`: an "update the ceiling" flag on a two-row ceiling IS the off
 *      switch.
 *
 * PARSED, NEVER GREPPED
 * ---------------------
 * `require('typescript')` — the root devDependency, and the pattern
 * `audit-write-check.js` established. The measured reason is sharper here than
 * there: this repository contains four files whose PROSE quotes the trigger
 * array in order to explain it (this file, `csv-injection.ts`'s doc comment,
 * `apps/web/src/lib/csv.ts`'s doc comment, and `ADR-037` D7). A regex gate would
 * report rule-B violations at lines holding no code, and the pressure would then
 * be to weaken rule B rather than to fix anything — the false-red lesson (`R-30`).
 *
 * DNC-08 — A CHECK THAT CANNOT RUN MUST FAIL
 * ------------------------------------------
 * Every one of these exits non-zero NAMING WHICH: `typescript` unresolvable · a
 * declared walk root absent · a walk root matching zero source files · a file
 * unreadable or unparseable · `csv-injection.ts` absent · `csv-injection.ts` not
 * exporting all three symbols · `security/index.ts` absent or not re-exporting
 * the module · a sanctioned or excluded entry matching nothing · fewer than two
 * sanctioned escapers. "Found nothing" is never a pass.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative, resolve, sep } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');

/**
 * The walk root. Stated as data, printed on every run, and asserted by the guard
 * spec — so a seventh root is added here once rather than remembered in seven
 * places.
 */
const WALK_ROOTS = [
  'apps/web/src',
  'apps/worker/src',
  'apps/api/src',
  'packages/contracts/src',
  'packages/ui/src',
  'packages/imports-core/src',
];

/** The one file allowed to assemble the predicate. It IS the shared module. */
const PREDICATE_REL = 'packages/contracts/src/security/csv-injection.ts';

/** The barrel that must re-export it, or no consumer can reach it. */
const SECURITY_INDEX_REL = 'packages/contracts/src/security/index.ts';

/** The symbols `PREDICATE_REL` must export for rules B and C to mean anything. */
const REQUIRED_PREDICATE_EXPORTS = ['CSV_INJECTION_TRIGGERS', 'CSV_NEUTRALISER', 'neutraliseCsvCell'];

/** The import specifier every consumer reaches the predicate through. */
const CONTRACTS_SPECIFIER = '@pilotage/contracts';

/** The shared function a sanctioned escaper must import AND call. */
const SHARED_FUNCTION = 'neutraliseCsvCell';

/**
 * The two escapers that are allowed to exist, keyed `path#symbol`.
 *
 * Two, not one, because the two surfaces speak different CSV DIALECTS: the web
 * exports are `;`-separated with a CRLF terminator for French Excel, the
 * regulator-facing audit export is `,`-separated with LF and its byte offsets
 * are frozen by `ADR-037` D4/D6. What is NOT duplicated any more is the
 * security-bearing part — the trigger set, the neutralising character, and the
 * decision of when to apply them. Unifying the dialect is `PF-169`, which is
 * OPEN and deliberately not taken by `S-E05-1`: changing a delimiter rewrites
 * every byte offset in a file downstream parsers key on, so it needs a
 * versioned, announced format change with its own slice.
 */
const SANCTIONED = {
  'apps/web/src/lib/csv.ts#csvEscape':
    'The ONE escaper under apps/web/src, consumed by seven export surfaces (admin/enrollments, ' +
    'admin/guardians, admin/alerts, teacher/reports, teacher/students, parent/grades, ' +
    'parent/attendance). Web dialect: quote trigger set keeps `;`. NOTE: these rules enforce ' +
    'UNIQUENESS of the escaper, not COVERAGE of the surfaces — a line hand-joined without any ' +
    'escaper declares nothing and passes. One such site is open as PF-173 ' +
    '(teacher/reports/_components/ExportReportButton.tsx:68).',
  'apps/worker/src/modules/exports/generators/audit-csv.generator.ts#csvEscape':
    'The DPO audit export. Worker dialect: quote trigger set is `,` and the record terminator is ' +
    'LF, both frozen by ADR-037 D4/D6 because a regulator-facing file has byte offsets.',
};

/**
 * Sites that write CSV and are deliberately NOT neutralised.
 *
 * Each entry is quoted, near enough verbatim, from the comment that ships in the
 * source file itself — both of those comments assert that this script excludes
 * the site BY NAME, and rule D makes that assertion falsifiable: if either
 * declaration disappears or is renamed, its row here matches nothing and the
 * gate goes red rather than quietly covering a site that no longer exists.
 *
 * The distinction both rows turn on is `ADR-037` D8's: `neutraliseCsvCell`
 * belongs on PRESENTATION CSV — a file a human opens in a spreadsheet. Neither
 * body below is ever opened.
 */
const EXCLUDED = {
  'apps/api/src/modules/imports/imports.service.ts#escape':
    'Inside `ImportsService#template` — the downloadable IMPORT TEMPLATE. Every cell is a dev-authored ' +
    'constant from `handler.template` (headers + a sample row): no user or tenant data, so there is no ' +
    'injection surface. It is also a template the admin fills in and RE-UPLOADS, so an apostrophe would ' +
    'come straight back through the import parser.',
  'apps/api/src/modules/integrations/oneroster.adapter.ts#escape':
    'Inside `rowsToCsv` — TRANSPORT CSV. The body produced here is never opened in a spreadsheet; it is ' +
    'stored as `ImportBatch.rawCsv` and RE-PARSED by the rollback and preview surfaces. Prefixing an ' +
    'apostrophe would write it into stored source data and corrupt the import.',
};

/**
 * The vacuity floor for rule D.
 *
 * Not a ratchet — the ratchet is that `SANCTIONED` has exactly two rows. This is
 * the guard against the matcher silently breaking: if a refactor renamed both
 * escapers, or the AST walk stopped seeing declarations at all, rules A and C
 * would have nothing to decide and this gate would print PASS over a tree it had
 * stopped reading.
 */
const MIN_SANCTIONED_ESCAPERS = 2;

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', '__fixtures__']);

/**
 * Rule A-name. Widened past the story's FR-5 regex to cover `escapeCell`, which
 * is what two of the five deleted copies were actually called — see the header.
 */
const ESCAPER_NAME = /^(csv[_-]?escape|escape[_-]?csv|escape[_-]?cell|cell[_-]?escape)$/i;

/** Rule B's trigger characters, as data. The `@` is required; two others suffice. */
const TRIGGER_CHARACTERS = ['=', '+', '-', '@', '\t', '\r'];

function rel(absolute) {
  return relative(REPO_ROOT, absolute).split(sep).join('/');
}

/* ------------------------------------------------------------------------- *
 * DNC-08: the parser itself is an input, and an absent one is a FAILURE
 * ------------------------------------------------------------------------- */

function loadTypeScript() {
  try {
    return require('typescript');
  } catch (cause) {
    return { error: `cannot require('typescript') — ${(cause && cause.message) || cause}` };
  }
}

/* ------------------------------------------------------------------------- *
 * Walking
 * ------------------------------------------------------------------------- */

/**
 * Production `.ts` AND `.tsx`: no `.spec.*`, no `.d.ts`.
 *
 * The `.tsx` half is the point — see the header. Three of the five copies this
 * slice deleted lived in components.
 */
function isProductionSource(name) {
  if (name.endsWith('.d.ts')) return false;
  if (name.endsWith('.spec.ts') || name.endsWith('.spec.tsx')) return false;
  if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) return false;
  return name.endsWith('.ts') || name.endsWith('.tsx');
}

function walkRoot(absoluteRoot) {
  const files = [];
  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        stack.push(join(current, entry.name));
      } else if (entry.isFile() && isProductionSource(entry.name)) {
        files.push(join(current, entry.name));
      }
    }
  }
  return files.sort();
}

/* ------------------------------------------------------------------------- *
 * The extractor
 * ------------------------------------------------------------------------- */

/** The declared name of a function-ish node, or `null` when it is anonymous. */
function declaredName(ts, node) {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (parent && ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  }
  return null;
}

/** `true` for a regex literal whose source has `"` inside a character class. */
function isQuoteClassRegex(text) {
  return /\[[^\]]*"[^\]]*\]/.test(text);
}

/**
 * `true` for a `^`-anchored character class carrying BOTH `=` and `@`.
 *
 * That is the re-inlined predicate wearing a regex: `/^[=+\-@\t\r]/` is the
 * trigger test with the array spelled differently.
 */
function isTriggerClassRegex(text) {
  const match = /^\/\^\[([^\]]*)\]/.exec(text);
  if (!match) return false;
  const body = match[1];
  return body.includes('=') && body.includes('@');
}

/** `true` for `<expr>.replace(/"/g, '""')` — the RFC-4180 quote doubling. */
function isQuoteDoublingCall(ts, node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'replace') return false;
  const [pattern, replacement] = node.arguments;
  if (!pattern || !ts.isRegularExpressionLiteral(pattern)) return false;
  if (!/^\/"\/[a-z]*$/.test(pattern.getText())) return false;
  if (!replacement || !ts.isStringLiteral(replacement)) return false;
  return replacement.text === '""';
}

/** `true` for any node that opens a new function scope. */
function isFunctionLike(ts, node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  );
}

/**
 * Walks ONE declaration's OWN body, stopping at every nested function boundary.
 *
 * The boundary matters, and it was measured rather than assumed. Both excluded
 * `apps/api` sites are a one-line arrow *inside* a larger method
 * (`imports.service.ts#template`, `oneroster.adapter.ts#rowsToCsv`). A walk that
 * descended through function boundaries reported FOUR escapers there instead of
 * two — the arrow, and again the method that merely contains it — so a single
 * copy would need two exclusion rows and deleting the arrow would leave one of
 * them stale. Attribution is to the INNERMOST declaration: that is the thing a
 * developer writes, names, and can delete.
 */
function visitOwnBody(ts, node, callback) {
  const visit = (current) => {
    callback(current);
    if (isFunctionLike(ts, current)) return;
    ts.forEachChild(current, visit);
  };
  ts.forEachChild(node, visit);
}

/**
 * Rule A-shape, for ONE declaration: does this body ESCAPE a CSV cell, whatever
 * it happens to be called?
 *
 * The conjunction is deliberate. `.replace(/"/g, '&quot;')` (three e-mail
 * templates in `apps/worker`) doubles nothing and is not an escaper; a regex
 * containing `"` on its own is not either. Together — test a character class
 * holding `"`, then double the quotes — they are the RFC-4180 escaper and
 * nothing else, which is the property that let this gate see the two `escapeCell`
 * copies whose NAME `PF-168`'s own grep could not.
 */
function escaperShapeOf(ts, node) {
  let quoteClassRegex = false;
  let quoteDoubling = false;
  visitOwnBody(ts, node, (current) => {
    if (ts.isRegularExpressionLiteral(current) && isQuoteClassRegex(current.getText())) quoteClassRegex = true;
    if (isQuoteDoublingCall(ts, current)) quoteDoubling = true;
  });
  return quoteClassRegex && quoteDoubling;
}

/**
 * `true` when the declaration's OWN body calls `neutraliseCsvCell(…)` — rule C.
 *
 * Same boundary, and here it is the stricter reading on purpose: a call sitting
 * in some nested closure is not the escaper consuming the shared predicate, and
 * rule C is the only executed evidence that the web half of this slice is wired.
 */
function callsSharedFunction(ts, node) {
  let found = false;
  visitOwnBody(ts, node, (current) => {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === SHARED_FUNCTION
    ) {
      found = true;
    }
  });
  return found;
}

/**
 * Extracts, from ONE parsed file: every CSV-escaper declaration (name or shape),
 * every re-inlined trigger literal, and whether the file imports the shared
 * function from `@pilotage/contracts`.
 *
 * Exported so the guard spec can drive it over synthetic sources in BOTH
 * directions — every assertion about this gate must be able to fail.
 */
function extractFromSource(ts, relPath, source) {
  const kind = relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, kind);

  const escapers = [];
  const triggerLiterals = [];
  const exportedNames = new Set();
  let importsShared = false;
  let reExportsPredicate = false;

  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const visit = (node) => {
    // ---- imports of the shared function (rule C, first half) --------------
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const bindings = node.importClause && node.importClause.namedBindings;
      if (
        (specifier === CONTRACTS_SPECIFIER || specifier.startsWith(`${CONTRACTS_SPECIFIER}/`)) &&
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some((element) => element.name.text === SHARED_FUNCTION)
      ) {
        importsShared = true;
      }
    }

    // ---- `export * from './csv-injection'` in the security barrel ----------
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (/(^|\/)csv-injection$/.test(node.moduleSpecifier.text)) reExportsPredicate = true;
    }

    // ---- exported symbol names of the predicate module ---------------------
    const modifiers = ts.canHaveModifiers && ts.canHaveModifiers(node) ? ts.getModifiers(node) || [] : [];
    const isExported = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (isExported) {
      if ((ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) {
        exportedNames.add(node.name.text);
      }
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) exportedNames.add(declaration.name.text);
        }
      }
    }
    if (ts.isVariableStatement(node)) {
      const statementModifiers = ts.getModifiers(node) || [];
      if (statementModifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) exportedNames.add(declaration.name.text);
        }
      }
    }

    // ---- rule A: escaper declarations, by NAME or by SHAPE ------------------
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      const name = declaredName(ts, node);
      const byName = Boolean(name) && ESCAPER_NAME.test(name);
      const byShape = escaperShapeOf(ts, node);
      if (byName || byShape) {
        escapers.push({
          file: relPath,
          symbol: name || '<anonymous>',
          line: lineOf(node),
          key: `${relPath}#${name || '<anonymous>'}`,
          detectedBy: byName && byShape ? 'name+shape' : byName ? 'name' : 'shape',
          callsShared: callsSharedFunction(ts, node),
        });
      }
    }

    // ---- rule B: the predicate, re-assembled -------------------------------
    if (ts.isArrayLiteralExpression(node)) {
      const literals = node.elements
        .filter((element) => ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element))
        .map((element) => element.text);
      if (literals.includes('@')) {
        const others = TRIGGER_CHARACTERS.filter((c) => c !== '@' && literals.includes(c));
        if (others.length >= 2) {
          triggerLiterals.push({
            file: relPath,
            line: lineOf(node),
            how: `an array literal holding '@' plus ${others.length} further trigger characters`,
          });
        }
      }
    }
    if (ts.isRegularExpressionLiteral(node) && isTriggerClassRegex(node.getText())) {
      triggerLiterals.push({
        file: relPath,
        line: lineOf(node),
        how: `the ^-anchored character class ${node.getText()}, which carries both '=' and '@'`,
      });
    }
    if (ts.isStringLiteral(node) && node.text.length <= 12 && node.text.includes('@')) {
      const others = TRIGGER_CHARACTERS.filter((c) => c !== '@' && node.text.includes(c));
      if (others.length >= 2) {
        triggerLiterals.push({
          file: relPath,
          line: lineOf(node),
          how: `the string literal ${JSON.stringify(node.text)}, a trigger set spelled as one token`,
        });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { escapers, triggerLiterals, importsShared, reExportsPredicate, exportedNames };
}

/* ------------------------------------------------------------------------- *
 * The pure core
 * ------------------------------------------------------------------------- */

/**
 * Reconciles measured escapers against the sanctioned and excluded sets.
 *
 * Returns `{ problems, stats }` — the shape `evaluateAuditWrites` and
 * `evaluateComposeInvocation` already established in this family, so the gate
 * can be driven from a spec without any `--allow` or `--update` flag existing.
 */
function evaluateCsvEscapers({ escapers, triggerLiterals, sanctioned = SANCTIONED, excluded = EXCLUDED }) {
  const problems = [];
  const sanctionedKeys = new Set(Object.keys(sanctioned));
  const excludedKeys = new Set(Object.keys(excluded));
  const seen = new Set();

  // Rule A — every measured escaper is sanctioned, or explicitly excluded.
  for (const escaper of escapers) {
    seen.add(escaper.key);
    if (sanctionedKeys.has(escaper.key) || excludedKeys.has(escaper.key)) continue;
    problems.push(
      `RULE A (a fourth CSV escaper) — ${escaper.file}:${escaper.line} declares \`${escaper.symbol}\`, ` +
        `detected by ${escaper.detectedBy}, and it is neither of the two sanctioned escapers nor a named ` +
        `exclusion. After S-E05-1 the correct count is 2 and 2 is the ceiling: there is no baseline file ` +
        `to add a row to. Import \`csvEscape\` from the surface's own module instead of re-declaring it ` +
        `[key: ${escaper.key}]`,
    );
  }

  // Rule D — staleness. The ceiling only ever comes down.
  for (const key of [...sanctionedKeys].sort()) {
    if (seen.has(key)) continue;
    problems.push(
      `RULE D (stale sanctioned entry) — ${key} is declared sanctioned but matches NO escaper ` +
        `declaration in the walk root. A renamed, moved or deleted escaper must be updated here: a ` +
        `sanctioned row that covers nothing is a hole shaped like a permission`,
    );
  }
  for (const key of [...excludedKeys].sort()) {
    if (seen.has(key)) continue;
    problems.push(
      `RULE D (stale exclusion) — ${key} is declared as a deliberately-not-neutralised site but matches ` +
        `NO declaration in the walk root. Both excluded files carry a shipped comment stating that this ` +
        `script "excludes this site by name"; an exclusion matching nothing makes that comment false`,
    );
  }

  // Rule C — the sanctioned escapers really consume the shared module.
  for (const escaper of escapers) {
    if (!sanctionedKeys.has(escaper.key)) continue;
    if (!escaper.callsShared) {
      problems.push(
        `RULE C (sanctioned escaper does not call ${SHARED_FUNCTION}) — ${escaper.file}:${escaper.line}. ` +
          `An escaper that stops calling the shared predicate is exactly the regression this gate exists ` +
          `for, and it would be SILENT: the file still compiles, still escapes, and answers "is this cell ` +
          `dangerous?" differently from the other surface`,
      );
    }
    if (!escaper.fileImportsShared) {
      problems.push(
        `RULE C (sanctioned file does not import ${SHARED_FUNCTION} from ${CONTRACTS_SPECIFIER}) — ` +
          `${escaper.file}. apps/web has no unit runner (PF-129/PF-133), so this executed import+call ` +
          `check is the ONLY evidence that the web half of S-E05-1 is wired at all`,
      );
    }
  }

  // Rule B — the predicate is assembled in exactly one place.
  for (const literal of triggerLiterals) {
    problems.push(
      `RULE B (the trigger predicate, re-inlined) — ${literal.file}:${literal.line} builds ${literal.how}. ` +
        `The trigger set may be assembled ONLY in ${PREDICATE_REL}. A copy that avoids the NAME csvEscape ` +
        `is still a copy: it is a second answer to "is this cell dangerous?", which is the G-TRUTH ` +
        `violation PF-168 recorded. Import CSV_INJECTION_TRIGGERS instead`,
    );
  }

  const sanctionedFound = escapers.filter((escaper) => sanctionedKeys.has(escaper.key)).length;

  // Rule D — the vacuity floor.
  if (sanctionedFound < MIN_SANCTIONED_ESCAPERS) {
    problems.push(
      `DNC-08 (vacuity floor) — found ${sanctionedFound} sanctioned escaper declaration(s) across the walk ` +
        `root, below the floor of ${MIN_SANCTIONED_ESCAPERS}. Rules A and C would have nothing to decide. ` +
        `Either the matcher is broken or both escapers were renamed; "found nothing" is never a pass`,
    );
  }

  return {
    problems,
    stats: {
      escapers: escapers.length,
      sanctioned: sanctionedFound,
      excluded: escapers.filter((escaper) => excludedKeys.has(escaper.key)).length,
      triggerLiterals: triggerLiterals.length,
    },
  };
}

/* ------------------------------------------------------------------------- *
 * CLI
 * ------------------------------------------------------------------------- */

function printHelp() {
  console.log(
    [
      'node scripts/csv-escape-check.js',
      '    Fails when a CSV escaper exists anywhere under the walk root outside the two',
      '    sanctioned ones, when the injection-trigger predicate is re-assembled outside',
      '    packages/contracts/src/security/csv-injection.ts, or when a sanctioned escaper',
      '    stops importing and calling neutraliseCsvCell.',
      '',
      `    Walk root: ${WALK_ROOTS.join(' + ')}`,
      `    Predicate: ${PREDICATE_REL}`,
      `    Sanctioned: ${Object.keys(SANCTIONED).join(', ')}`,
      `    Excluded:   ${Object.keys(EXCLUDED).join(', ')}`,
      '',
      '    There is no --skip, no --force, no --update, and no environment variable that',
      '    changes the verdict. The ceiling is two rows; a flag that raises it would be',
      '    the off switch. A check that cannot run exits non-zero naming what it could',
      '    not read.',
    ].join('\n'),
  );
}

function fail(lines) {
  console.error('\n══════════════════════════════════════════════════════════════');
  console.error('  CSV ESCAPE CHECK: FAIL');
  console.error('══════════════════════════════════════════════════════════════');
  for (const line of lines) console.error(`\n✗ ${line}`);
  console.error('');
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    printHelp();
    return;
  }
  if (argv.length > 0) {
    // DNC-10: an unrecognised argument is never ignored. Ignoring it is how
    // `--skip-csv` becomes a thing that "already works".
    fail([`unknown argument(s) ${argv.join(' ')} — the only flag is --help`]);
  }

  // ---- DNC-08: every input, checked before anything is measured ------------
  const ts = loadTypeScript();
  if (ts.error) fail([`DNC-08 — ${ts.error}. The parser is an input; an absent one is a FAILURE, not a skip`]);

  const predicatePath = join(REPO_ROOT, PREDICATE_REL);
  if (!existsSync(predicatePath)) {
    fail([
      `DNC-08 — the shared predicate ${PREDICATE_REL} does not exist. Rules B and C are both defined ` +
        `relative to it, so without it this gate would pass over a tree in which every escaper is a copy`,
    ]);
  }
  let predicateSource;
  try {
    predicateSource = readFileSync(predicatePath, 'utf8');
  } catch (cause) {
    fail([`DNC-08 — ${PREDICATE_REL} is unreadable: ${(cause && cause.message) || cause}`]);
  }
  const predicate = extractFromSource(ts, PREDICATE_REL, predicateSource);
  const missingExports = REQUIRED_PREDICATE_EXPORTS.filter((name) => !predicate.exportedNames.has(name));
  if (missingExports.length > 0) {
    fail([
      `DNC-08 — ${PREDICATE_REL} does not export ${missingExports.join(', ')}. A consumer importing a ` +
        `symbol the module no longer exports is a red typecheck, but a gate that never checked would ` +
        `still have printed PASS over it`,
    ]);
  }

  const barrelPath = join(REPO_ROOT, SECURITY_INDEX_REL);
  if (!existsSync(barrelPath)) {
    fail([`DNC-08 — ${SECURITY_INDEX_REL} does not exist; nothing re-exports the predicate to consumers`]);
  }
  const barrel = extractFromSource(ts, SECURITY_INDEX_REL, readFileSync(barrelPath, 'utf8'));
  if (!barrel.reExportsPredicate) {
    fail([
      `DNC-08 — ${SECURITY_INDEX_REL} does not re-export './csv-injection'. The predicate would then be ` +
        `unreachable through ${CONTRACTS_SPECIFIER} and rule C could never be satisfied by any file`,
    ]);
  }

  // ---- Walk ---------------------------------------------------------------
  const perRoot = [];
  for (const root of WALK_ROOTS) {
    const absolute = join(REPO_ROOT, root);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      fail([`DNC-08 — declared walk root ${root} does not exist. The root is data, not a guess`]);
    }
    const files = walkRoot(absolute);
    if (files.length === 0) {
      fail([`DNC-08 — declared walk root ${root} matched ZERO source files; the walk is broken, not the repo`]);
    }
    perRoot.push({ root, files });
  }

  const escapers = [];
  const triggerLiterals = [];
  for (const { root, files } of perRoot) {
    let rootEscapers = 0;
    let tsxFiles = 0;
    for (const file of files) {
      const relPath = rel(file);
      if (relPath.endsWith('.tsx')) tsxFiles += 1;
      let source;
      try {
        source = readFileSync(file, 'utf8');
      } catch (cause) {
        fail([`DNC-08 — ${relPath} is unreadable: ${(cause && cause.message) || cause}`]);
      }
      let extracted;
      try {
        extracted = extractFromSource(ts, relPath, source);
      } catch (cause) {
        fail([`DNC-08 — ${relPath} could not be parsed: ${(cause && cause.message) || cause}`]);
      }
      rootEscapers += extracted.escapers.length;
      for (const escaper of extracted.escapers) {
        escapers.push({ ...escaper, fileImportsShared: extracted.importsShared });
      }
      // The predicate module is the ONE place the trigger set may be assembled.
      if (relPath !== PREDICATE_REL) triggerLiterals.push(...extracted.triggerLiterals);
    }
    console.log(`▶ ${root} … ${files.length} files (${tsxFiles} .tsx) · ${rootEscapers} CSV escapers`);
  }

  const result = evaluateCsvEscapers({ escapers, triggerLiterals });

  // Printed on PASS as well as FAIL — the discharge of "reported, never dropped".
  console.log('\n  sanctioned escapers — two dialects, ONE predicate');
  for (const key of Object.keys(SANCTIONED).sort()) {
    const found = escapers.find((escaper) => escaper.key === key);
    console.log(`    · ${key}${found ? ` (line ${found.line}, calls ${SHARED_FUNCTION})` : '  ← NOT FOUND'}`);
  }
  console.log('\n  named exclusions — transport CSV, deliberately NOT neutralised (ADR-037 D8)');
  for (const key of Object.keys(EXCLUDED).sort()) {
    const found = escapers.find((escaper) => escaper.key === key);
    console.log(`    · ${key}${found ? ` (line ${found.line})` : '  ← NOT FOUND'}`);
  }

  if (result.problems.length > 0) fail(result.problems);

  console.log(
    `\nCSV ESCAPE CHECK: PASS — ${result.stats.escapers} CSV escapers over ${WALK_ROOTS.join(' + ')}: ` +
      `${result.stats.sanctioned} sanctioned and each importing AND calling ${SHARED_FUNCTION} from ` +
      `${CONTRACTS_SPECIFIER}, ${result.stats.excluded} named transport-CSV exclusions, 0 unaccounted for; ` +
      `the trigger predicate is assembled in ${PREDICATE_REL} and nowhere else`,
  );
}

module.exports = {
  WALK_ROOTS,
  PREDICATE_REL,
  SECURITY_INDEX_REL,
  REQUIRED_PREDICATE_EXPORTS,
  CONTRACTS_SPECIFIER,
  SHARED_FUNCTION,
  SANCTIONED,
  EXCLUDED,
  MIN_SANCTIONED_ESCAPERS,
  ESCAPER_NAME,
  TRIGGER_CHARACTERS,
  loadTypeScript,
  isProductionSource,
  walkRoot,
  extractFromSource,
  evaluateCsvEscapers,
};

if (require.main === module) main();
