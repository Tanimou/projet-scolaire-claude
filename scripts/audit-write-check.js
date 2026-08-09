#!/usr/bin/env node
/**
 * S-E04-7 — the audit-write ratchet (gates G-AUDIT, G-DNC · `ADR-035` D11-D14).
 *
 * WHAT THIS GATE DECIDES
 * ----------------------
 * `PF-31` has been open across two epics. `S-E06-6` moved ONE handler of ~20
 * onto a transaction; `S-E04-6` closed five privileged families and built the
 * seam (`apps/api/src/shared/audit/write-audit.ts`). Both were real, and both
 * left the CLASS open, because nothing stopped the twenty-first site from being
 * written the old way tomorrow. A sweep without a ratchet is a sweep that has to
 * be done again. This file is the ratchet.
 *
 * THE WALK ROOT, STATED — NOT `apps/api/src` ALONE
 * ------------------------------------------------
 *     apps/api/src  +  apps/worker/src  +  packages/imports-core/src
 *
 * `packages/imports-core/src/engine.ts` writes two audit rows (`:197`, `:288`).
 * A gate rooted at the API would report green over them forever — which is
 * `S-E06-5` exactly: `packages/ui` was bundled into every portal and sat outside
 * that gate's walk root, so the gate certified a surface it could not see. The
 * root is printed on every run, PASS or FAIL, so a number in a PR is never
 * separable from the tree it was measured over.
 *
 * MEASURED WHEN THIS FILE WAS WRITTEN (branch `ci/2026-08-09-v3-e04-s7`):
 * 27 `auditLog.create` sites outside the seam, across 16 files — 25 in
 * `apps/api/src`, 0 in `apps/worker/src`, 2 in `packages/imports-core/src`.
 * S-E04-7 converts 10 and baselines 17. `tasks.md` AC-1's "30" is stale (it is
 * the pre-`S-E04-6` figure) and `ADR-035` D9's "27 across 15 files" is off by one
 * on the file count and attributes all 27 to `apps/api`.
 *
 * ONE DELIBERATE EXCLUSION, RECORDED RATHER THAN LEFT IMPLICIT
 * ------------------------------------------------------------
 * `apps/api/prisma/seed-demo.ts` writes audit rows and is OUTSIDE the walk root.
 * It is a seed, not a mutation path, and `S-E02-4` keeps it out of production.
 * `audit-vocabulary-gate.spec.ts` already reads it for its own purpose. An
 * unstated exclusion is the `S-E06-5` shape whatever its merits, so it is stated
 * here. `*.spec.ts` is excluded for the same class of reason: a spec that
 * constructs a fake audit row is not a mutation path either.
 *
 * THE FIVE RULES
 * --------------
 *   A  Any `<expr>.auditLog.create(…)` under the walk root is a FAILURE unless
 *      its site key is in the reviewed baseline. Reaching the table directly is
 *      the defect; the seam exists so that "in the same transaction" is a
 *      property of the type rather than of a review.
 *   B  Every `writeAudit(…)` call's first argument must be a transaction client:
 *      an identifier bound by an enclosing `$transaction(async (tx) => …)`
 *      callback parameter, OR a parameter of an enclosing function declared
 *      `AuditTransactionClient` / `Prisma.TransactionClient`. A member
 *      expression (`this.prisma`), a call, or an unbound identifier FAILS and is
 *      NOT baselineable.
 *   C  Every `writeAudit(…)` call's second argument must be an inline object
 *      literal. Not style: `audit-vocabulary-gate.spec.ts` resolves the action
 *      and resourceType of each row from the call-site AST, and a pre-built
 *      variable drops the site out of the written set — after which the gate's
 *      REVERSE completeness direction demands the code's real French label be
 *      deleted. `ADR-035` D6's failure mode, arriving through the front door.
 *   D  One-way ratchet. A site not in the baseline is red; a baseline row
 *      matching zero sites is red (stale — the ceiling only ever comes down);
 *      two sites resolving to one key is red (ambiguity, never silent coverage).
 *   E  Every baseline row's `finding` must RESOLVE to a real row in
 *      `docs/daily-improvement-v3/audit-findings-index.md` — not merely match
 *      `PF-\d+`. `S-E06-5` measured three live rows in `link-integrity-baseline
 *      .json` citing ids that existed nowhere, because that gate validated the
 *      id's SHAPE. A resolver that cannot fail is not a resolver.
 *
 * Plus one rule the seam's own spec already carries for a SMALLER root, restated
 * here over the whole walk root: **no `writeAudit` call may sit inside a `try`
 * block.** `ADR-035` D2 makes an audit failure fail the mutation; a `try/catch`
 * that downgrades it to a warning is the DNC-10 bypass wearing different clothes.
 *
 * WHAT RULE B PROVES, AND WHAT IT DOES NOT
 * ----------------------------------------
 * It proves the argument is *lexically* bound by a transaction: a `$transaction`
 * callback parameter, or a parameter declared as a transaction-client type. An
 * alias (`const tx = this.prisma; writeAudit(tx, …)`) is bound by neither and is
 * therefore REJECTED — measured, not assumed, and pinned by a driven case in
 * `audit-write-gate.spec.ts`.
 *
 * What it does NOT prove is what the parameter RECEIVES. A helper declaring
 * `tx: Prisma.TransactionClient` is accepted here even if some caller hands it a
 * full client, because deciding that is assignability and a textual rule cannot
 * decide assignability. That is the other half's job: the COMPILE-TIME brand
 * (`AuditTransactionClient`, `ADR-035` D1). `Prisma.TransactionClient` alone does
 * NOT reject a full client — `Omit` removes members, it does not forbid them, and
 * TypeScript is structural — so the brand re-adds `$transaction`/`$connect` as
 * optional `never`, and `write-audit.spec.ts:223` pins it with a
 * `@ts-expect-error` that goes red in both directions. Neither half replaces the
 * other: a type cannot see a site that never calls the seam, and this file cannot
 * see what a value is.
 *
 * SITE KEYS ARE `path#symbol`, NEVER `path:line`
 * ----------------------------------------------
 * `link-integrity-check.js` states the rule for its own baseline and it is
 * sharper here: `remediation.controller.ts` and `messaging.service.ts` churn, and
 * a line-keyed row silently un-baselines its site (or, worse, starts covering a
 * different one) on any edit above it. The key is
 * `<repo-relative posix path>#<enclosing function name>` with a `#<ordinal>`
 * suffix when one function holds several writes, and the ordinal is assigned in
 * source order.
 *
 * PARSED, NEVER GREPPED
 * ---------------------
 * `require('typescript')` — the root devDependency, and the precedent set by
 * `audit-vocabulary-gate.spec.ts`. Measured reason, not taste: a grep for
 * `auditLog.create` over the walk root returns 29 hits for 27 sites, because
 * `alerts.service.ts:606` and `child-claims.service.ts:710` mention it inside
 * JSDoc. A regex gate would report two violations at lines holding no code, and
 * neither would be baselineable in any honest sense.
 *
 * DNC-08 — A CHECK THAT CANNOT RUN MUST FAIL
 * ------------------------------------------
 * Every one of these exits non-zero NAMING WHICH: a walk-root directory absent ·
 * zero `.ts` files walked in ANY ONE root · `typescript` unresolvable · a file
 * unreadable · a file the parser reports syntax errors for · the baseline absent
 * or invalid JSON · the seam file absent · the findings index absent,
 * unreadable, or yielding zero ids · fewer `writeAudit` call sites than the
 * reviewed floor. That last pair is the vacuity guard: zero WRITES in a root is
 * a normal PASS (and `apps/worker/src` has exactly that today), but zero FILES,
 * or a findings index that parses to nothing, means the gate is measuring
 * nothing and calling it green.
 *
 * DNC-10 — NO OFF SWITCH
 * ----------------------
 * This file reads no environment variable at all. The only flags are `--help`
 * and `--update`; any other argument exits non-zero. `--update` refuses to write
 * a row that lacks a `reason` or whose `finding` does not resolve, and refuses
 * outright while any rule-B/C violation is present — the refusal is what keeps
 * `--update` from being the off switch (`link-integrity-check.js:1625` sets the
 * precedent for the same reason).
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { existsSync, readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { join, relative, resolve, sep } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');

/**
 * The walk root. Stated as data, printed on every run, and asserted by the guard
 * spec — so a fourth root (the finance module `S-E04-6` note 2 anticipates)
 * is added here once rather than remembered in four places.
 */
const WALK_ROOTS = ['apps/api/src', 'apps/worker/src', 'packages/imports-core/src'];

/** The one file allowed to touch `auditLog.create`. It IS the seam. */
const SEAM_REL = 'apps/api/src/shared/audit/write-audit.ts';

const BASELINE_REL = 'scripts/audit-write-baseline.json';
const FINDINGS_INDEX_REL = 'docs/daily-improvement-v3/audit-findings-index.md';

/**
 * The reviewed floor for `writeAudit` call sites across the walk root.
 *
 * NOT a ceiling and not a ratchet — it is the vacuity guard. If the seam is
 * renamed, or the matcher below breaks, rules B and C would have nothing to
 * check and this gate would print PASS over a tree it stopped reading. Measured
 * at 20 when S-E04-7 landed; set below that so ordinary refactoring does not
 * trip it, and high enough that "found nothing" cannot pass.
 */
const MIN_WRITE_AUDIT_CALLS = 12;

/** The three declared baseline classes. A row outside this set is refused. */
const BASELINE_CLASSES = new Set([
  // A best-effort post-commit notice: the site's own comment says an audit
  // failure is swallowed and never rolls back the mutation. Converting it is a
  // SEMANTIC change (fail-closed, ADR-035 D2), not a sweep — so it is queued
  // under its owning finding rather than silently flipped.
  'best-effort-post-commit',
  // A write in a package that CANNOT import the seam: `@pilotage/imports-core`
  // is a dependency OF `apps/api`, so importing `apps/api/src/shared/audit`
  // would be a dependency cycle. Structural and permanent (PF-121).
  'cross-package-seam',
  // Declared and currently EMPTY: a site with no actor in scope at all. Declared
  // so that the next such site lands in a named class instead of inventing one.
  'no-actor-in-scope',
]);

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.turbo', 'coverage', '__fixtures__']);

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

/** Production `.ts` only: no `.spec.ts`, no `.d.ts`, no `.tsx` (none in root). */
function isProductionSource(name) {
  return name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts');
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

/**
 * The nearest ENCLOSING named function-ish scope, walked outward.
 *
 * An arrow function passed to `$transaction` is anonymous, so the walk continues
 * to the method that opened it — which is what makes the key stable under the
 * reformatting that a line number is not.
 */
function enclosingSymbol(ts, node) {
  let current = node.parent;
  while (current) {
    if (ts.isMethodDeclaration(current) && current.name && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isConstructorDeclaration(current)) return 'constructor';
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      current.parent &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      current.parent &&
      ts.isPropertyAssignment(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
    current = current.parent;
  }
  return '<module>';
}

/** `true` when the node has a `try` BLOCK (not a catch/finally) as an ancestor. */
function insideTryBlock(ts, node) {
  let current = node.parent;
  let child = node;
  while (current) {
    if (ts.isTryStatement(current) && current.tryBlock === child) return true;
    child = current;
    current = current.parent;
  }
  return false;
}

const TRANSACTION_CLIENT_TYPE_NAMES = new Set([
  'AuditTransactionClient',
  'TransactionClient',
  'Prisma.TransactionClient',
]);

function typeNodeText(ts, typeNode) {
  if (!typeNode) return '';
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNode.typeName;
    if (ts.isIdentifier(name)) return name.text;
    if (ts.isQualifiedName(name)) return `${name.left.getText()}.${name.right.text}`;
  }
  return typeNode.getText();
}

/**
 * Rule B's decision, for one identifier.
 *
 * Accepted when the identifier is bound by
 *   (1) a parameter of a callback passed to `<expr>.$transaction(…)`, or
 *   (2) a parameter of ANY enclosing function whose declared type is a
 *       transaction-client type.
 *
 * (2) is not a loosening: `remediation.controller.ts` relays its audit through
 * four private helpers that take `tx` as a parameter and contain no lexical
 * `$transaction` at all. A rule that demanded (1) only would report five CORRECT
 * sites red, and the pressure would then be to weaken the rule rather than to
 * fix the code — the false-red lesson (`R-30`).
 */
function transactionBindingOf(ts, identifier) {
  const name = identifier.text;
  let current = identifier.parent;
  while (current) {
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current)
    ) {
      for (const parameter of current.parameters) {
        if (!ts.isIdentifier(parameter.name) || parameter.name.text !== name) continue;
        // (1) a `$transaction` callback parameter.
        const owner = current.parent;
        if (
          owner &&
          ts.isCallExpression(owner) &&
          ts.isPropertyAccessExpression(owner.expression) &&
          owner.expression.name.text === '$transaction'
        ) {
          return { ok: true, how: '$transaction callback parameter' };
        }
        // (2) a parameter declared as a transaction-client type.
        const declared = typeNodeText(ts, parameter.type);
        if (TRANSACTION_CLIENT_TYPE_NAMES.has(declared)) {
          return { ok: true, how: `parameter typed ${declared}` };
        }
        return {
          ok: false,
          how: declared
            ? `bound by a parameter typed ${declared}, which is not a transaction client`
            : 'bound by an untyped parameter of an enclosing function',
        };
      }
    }
    current = current.parent;
  }
  return { ok: false, how: 'not bound by any enclosing transaction' };
}

function describeArgument(ts, argument) {
  if (!argument) return '<missing>';
  if (ts.isIdentifier(argument)) return argument.text;
  if (ts.isPropertyAccessExpression(argument)) return argument.getText();
  if (ts.isCallExpression(argument)) return `${argument.expression.getText()}(…)`;
  return ts.SyntaxKind[argument.kind];
}

/**
 * Extracts, from ONE parsed file: every `auditLog.create` site, every
 * `writeAudit` call, and the verdicts rules B/C reach on each of the latter.
 *
 * Exported so the guard spec can drive it over synthetic sources in BOTH
 * directions — every assertion about this gate must be able to fail.
 */
function extractFromSource(ts, relPath, source) {
  const sourceFile = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const creates = [];
  const writeAuditCalls = [];

  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;

      // `<expr>.auditLog.create(…)` — rule A.
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'create' &&
        ts.isPropertyAccessExpression(callee.expression) &&
        callee.expression.name.text === 'auditLog'
      ) {
        creates.push({
          file: relPath,
          symbol: enclosingSymbol(ts, node),
          line: lineOf(node),
          // `tx.auditLog.create` (transactional but off-seam) and
          // `this.prisma.auditLog.create` (not transactional at all) are
          // DIFFERENT debts and are reported as such.
          receiver: callee.expression.expression.getText(),
        });
      }

      // `writeAudit(…)` — rules B and C.
      if (ts.isIdentifier(callee) && callee.text === 'writeAudit') {
        const [first, second] = node.arguments;
        const call = {
          file: relPath,
          symbol: enclosingSymbol(ts, node),
          line: lineOf(node),
          firstArgument: describeArgument(ts, first),
          transactional: { ok: false, how: 'no first argument' },
          inlineLiteral: Boolean(second && ts.isObjectLiteralExpression(second)),
          secondArgument: describeArgument(ts, second),
          insideTry: insideTryBlock(ts, node),
        };
        if (first) {
          call.transactional = ts.isIdentifier(first)
            ? transactionBindingOf(ts, first)
            : {
                ok: false,
                how: ts.isPropertyAccessExpression(first)
                  ? `a member expression (${first.getText()}), never a transaction client`
                  : 'not an identifier',
              };
        }
        writeAuditCalls.push(call);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { creates, writeAuditCalls };
}

/* ------------------------------------------------------------------------- *
 * Site keys
 * ------------------------------------------------------------------------- */

/**
 * `path#symbol`, plus `#<ordinal>` when one symbol holds several writes.
 *
 * The ordinal is assigned in source order and ONLY when it is needed, so the
 * common case reads as the human-meaningful thing it is and the rare case is
 * still unambiguous — which rule D then asserts.
 */
function keySites(sites) {
  const byPrefix = new Map();
  for (const site of sites) {
    const prefix = `${site.file}#${site.symbol}`;
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(site);
  }
  const keyed = [];
  for (const [prefix, group] of byPrefix) {
    group.sort((a, b) => a.line - b.line);
    if (group.length === 1) {
      keyed.push({ ...group[0], key: prefix });
      continue;
    }
    group.forEach((site, index) => keyed.push({ ...site, key: `${prefix}#${index + 1}` }));
  }
  return keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/* ------------------------------------------------------------------------- *
 * Rule E — the finding register is RESOLVED, never shape-matched
 * ------------------------------------------------------------------------- */

/**
 * The ids `audit-findings-index.md` actually DECLARES — read off its `| **PF-nn**
 * |` row openers, not off every `PF-nn` mention in prose.
 *
 * That distinction is rule E: a finding *referenced* in another row's narrative
 * is not a finding the register *holds*, and a resolver that could not tell them
 * apart would be the regex `S-E06-5` measured, one indirection out.
 */
function declaredFindingIds(markdown) {
  const ids = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\|\s*\*{0,2}(PF-\d+)\*{0,2}\s*\|/.exec(line.trim());
    if (match) ids.add(match[1]);
  }
  return ids;
}

/* ------------------------------------------------------------------------- *
 * The pure core
 * ------------------------------------------------------------------------- */

/**
 * Reconciles measured sites against the reviewed baseline.
 *
 * Returns `{ problems, stats }` — the shape `evaluateComposeInvocation` and
 * `classifyAll` already established in this family, so the gate can be driven
 * from a spec without any `--allow`, `--force` or `--inventory` flag existing.
 */
function evaluateAuditWrites({ creates, writeAuditCalls, baseline, findingIds }) {
  const problems = [];
  const keyed = keySites(creates);

  const rows = (baseline && baseline.sites) || {};
  const rowKeys = new Set(Object.keys(rows));
  const seen = new Set();

  // Rule D — ambiguity. Two sites resolving to one key is never silent coverage.
  const counts = new Map();
  for (const site of keyed) counts.set(site.key, (counts.get(site.key) || 0) + 1);
  for (const [key, count] of counts) {
    if (count > 1) {
      problems.push(
        `RULE D (ambiguous key) — ${count} audit writes resolve to the site key ${key}; ` +
          `one baseline row cannot honestly cover two sites`,
      );
    }
  }

  // Rule A — every measured site is behind the seam, or baselined.
  for (const site of keyed) {
    seen.add(site.key);
    if (rowKeys.has(site.key)) continue;
    problems.push(
      `RULE A (auditLog.create outside shared/audit) — ${site.file}:${site.line} ` +
        `writes \`${site.receiver}.auditLog.create\` and is not in ${BASELINE_REL}. ` +
        `Move it onto writeAudit(tx, {…}) inside the mutation's transaction, or baseline it ` +
        `with a reason and an owning finding id [key: ${site.key}]`,
    );
  }

  // Rule D — staleness. The ceiling only ever comes down.
  for (const key of [...rowKeys].sort()) {
    if (seen.has(key)) continue;
    problems.push(
      `RULE D (stale baseline row) — ${BASELINE_REL} holds ${key}, which matches no audit write ` +
        `in the walk root. A converted or deleted site must be REMOVED from the baseline: ` +
        `the ratchet only turns one way`,
    );
  }

  // Rules D/E — every row is classed, reasoned and owned by a resolvable finding.
  for (const key of [...rowKeys].sort()) {
    const row = rows[key] || {};
    if (!row.reason || String(row.reason).trim() === '') {
      problems.push(`RULE D (unreasoned baseline row) — ${key} carries no \`reason\``);
    }
    if (!row.class || !BASELINE_CLASSES.has(row.class)) {
      problems.push(
        `RULE D (unclassed baseline row) — ${key} carries class ${JSON.stringify(row.class)}; ` +
          `the declared classes are ${[...BASELINE_CLASSES].join(', ')}`,
      );
    }
    const finding = row.finding;
    if (!finding) {
      problems.push(`RULE E (unowned baseline row) — ${key} carries no \`finding\``);
    } else if (!findingIds.has(finding)) {
      problems.push(
        `RULE E (unresolvable finding) — ${key} cites ${finding}, which is not a declared row in ` +
          `${FINDINGS_INDEX_REL}. The shape PF-nnn is not enough: S-E06-5 measured three live ` +
          `baseline rows citing ids that existed nowhere, because the id's SHAPE was all that was checked`,
      );
    }
  }

  // Rules B and C — the seam's own call sites.
  for (const call of writeAuditCalls) {
    if (!call.transactional.ok) {
      problems.push(
        `RULE B (writeAudit without transaction client) — ${call.file}:${call.line} passes ` +
          `\`${call.firstArgument}\` as the first argument: ${call.transactional.how}. ` +
          `This is NOT baselineable`,
      );
    }
    if (!call.inlineLiteral) {
      problems.push(
        `RULE C (writeAudit second argument is not an inline object literal) — ${call.file}:${call.line} ` +
          `passes \`${call.secondArgument}\`. audit-vocabulary-gate.spec.ts resolves action/resourceType ` +
          `from the call-site AST; a pre-built variable drops the codes out of the written set and the ` +
          `reverse completeness direction then demands their real French labels be deleted`,
      );
    }
    if (call.insideTry) {
      problems.push(
        `RULE B (writeAudit inside a try block) — ${call.file}:${call.line}. ADR-035 D2 makes an audit ` +
          `failure fail the mutation; a catch that downgrades it to a warning is a DNC-10 bypass wearing ` +
          `different clothes`,
      );
    }
  }

  const baselined = keyed.filter((site) => rowKeys.has(site.key)).length;
  return {
    problems,
    stats: {
      sites: keyed.length,
      baselined,
      converted: keyed.length - baselined,
      writeAuditCalls: writeAuditCalls.length,
      rows: rowKeys.size,
    },
    keyed,
  };
}

/* ------------------------------------------------------------------------- *
 * CLI
 * ------------------------------------------------------------------------- */

const BASELINE_COMMENT =
  'Audit writes that still reach `auditLog.create` directly, measured by ' +
  'scripts/audit-write-check.js over the walk root apps/api/src + apps/worker/src + ' +
  'packages/imports-core/src (production .ts, excluding *.spec.ts and the seam ' +
  'apps/api/src/shared/audit/write-audit.ts). Keyed on path#symbol, NEVER on path:line — ' +
  'a line-keyed row silently un-baselines its site on any edit above it. This list may only ' +
  'ever SHRINK: a row matching no site is a FAILURE, not a leftover.';

const BASELINE_DOC = [
  'Every row carries a class, a reason, and a finding id that RESOLVES to a declared row in',
  'docs/daily-improvement-v3/audit-findings-index.md — not merely one shaped like PF-nnn.',
  'S-E06-5 measured three live baseline rows citing ids that existed nowhere, because only the',
  'id SHAPE was validated. Rule E is that measurement turned into a check.',
  '',
  'The three declared classes:',
  '  best-effort-post-commit — the site swallows its audit failure by design and says so in its',
  '    own comment. Converting it is a SEMANTIC change (fail-closed, ADR-035 D2), not a sweep.',
  '  cross-package-seam — the write lives in a package that CANNOT import the seam without',
  '    inverting a dependency (@pilotage/imports-core is a dependency OF apps/api). Structural.',
  '  no-actor-in-scope — declared and currently EMPTY, so the next such site lands in a named',
  '    class rather than inventing one.',
];

function printHelp() {
  console.log(
    [
      'node scripts/audit-write-check.js',
      '    Fails when any auditLog.create under the walk root is neither behind writeAudit',
      '    inside a transaction nor baselined, and when any writeAudit call is given a',
      '    non-transactional first argument or a non-literal second argument.',
      '',
      `    Walk root: ${WALK_ROOTS.join(' + ')}`,
      `    Baseline:  ${BASELINE_REL}`,
      `    Findings:  ${FINDINGS_INDEX_REL}`,
      '',
      '    There is no --skip, no --force, and no environment variable that changes the',
      '    verdict. A check that cannot run exits non-zero naming what it could not read.',
      '',
      'node scripts/audit-write-check.js --update',
      '    Rewrite the reviewed ceiling. REFUSES while any rule-B or rule-C violation is',
      '    present, and writes a new row with an empty class/reason/finding so the gate',
      '    stays red until a human supplies all three. That refusal is the ratchet.',
    ].join('\n'),
  );
}

function fail(lines) {
  console.error('\n══════════════════════════════════════════════════════════════');
  console.error('  AUDIT WRITE CHECK: FAIL');
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
  const unknown = argv.filter((argument) => argument !== '--update');
  if (unknown.length > 0) {
    // DNC-10: an unrecognised argument is never ignored. Ignoring it is how
    // `--skip-audit` becomes a thing that "already works".
    fail([`unknown argument(s) ${unknown.join(' ')} — the only flags are --help and --update`]);
  }
  const update = argv.includes('--update');

  // ---- DNC-08: every input, checked before anything is measured ------------
  const ts = loadTypeScript();
  if (ts.error) fail([`DNC-08 — ${ts.error}. The parser is an input; an absent one is a FAILURE, not a skip`]);

  const seamPath = join(REPO_ROOT, SEAM_REL);
  if (!existsSync(seamPath)) {
    fail([`DNC-08 — the seam ${SEAM_REL} does not exist. Every rule here is defined relative to it`]);
  }

  const findingsPath = join(REPO_ROOT, FINDINGS_INDEX_REL);
  if (!existsSync(findingsPath)) {
    fail([`DNC-08 — the findings register ${FINDINGS_INDEX_REL} does not exist; rule E cannot resolve anything`]);
  }
  let findingIds;
  try {
    findingIds = declaredFindingIds(readFileSync(findingsPath, 'utf8'));
  } catch (cause) {
    fail([`DNC-08 — ${FINDINGS_INDEX_REL} is unreadable: ${(cause && cause.message) || cause}`]);
  }
  if (findingIds.size === 0) {
    fail([
      `DNC-08 — ${FINDINGS_INDEX_REL} parsed to ZERO declared finding ids. Rule E would then accept ` +
        `nothing, or (worse) be quietly relaxed to accept everything. "Nothing to resolve against" is ` +
        `never a pass`,
    ]);
  }

  const baselinePath = join(REPO_ROOT, BASELINE_REL);
  if (!existsSync(baselinePath) && !update) {
    fail([`DNC-08 — missing ${BASELINE_REL}. Run \`node scripts/audit-write-check.js --update\` and review the diff`]);
  }
  let baseline = { sites: {} };
  if (existsSync(baselinePath)) {
    let raw;
    try {
      raw = readFileSync(baselinePath, 'utf8');
    } catch (cause) {
      fail([`DNC-08 — ${BASELINE_REL} is unreadable: ${(cause && cause.message) || cause}`]);
    }
    try {
      baseline = JSON.parse(raw);
    } catch (cause) {
      fail([`DNC-08 — ${BASELINE_REL} is not valid JSON: ${(cause && cause.message) || cause}`]);
    }
    if (!baseline || typeof baseline.sites !== 'object' || baseline.sites === null) {
      fail([`DNC-08 — ${BASELINE_REL} has no \`sites\` object; the reviewed ceiling is unreadable`]);
    }
  }

  // ---- Walk -------------------------------------------------------------
  const perRoot = [];
  for (const root of WALK_ROOTS) {
    const absolute = join(REPO_ROOT, root);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      fail([`DNC-08 — declared walk root ${root} does not exist. The root is data, not a guess`]);
    }
    const files = walkRoot(absolute);
    if (files.length === 0) {
      // Zero FILES, never zero writes: `apps/worker/src` legitimately holds zero
      // audit writes today and that is a PASS. Zero files means the walk broke.
      fail([`DNC-08 — declared walk root ${root} matched ZERO production .ts files; the walk is broken, not the repo`]);
    }
    perRoot.push({ root, files });
  }

  const creates = [];
  const writeAuditCalls = [];
  for (const { root, files } of perRoot) {
    let rootCreates = 0;
    for (const file of files) {
      const relPath = rel(file);
      if (relPath === SEAM_REL) continue;
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
      rootCreates += extracted.creates.length;
      creates.push(...extracted.creates);
      writeAuditCalls.push(...extracted.writeAuditCalls);
    }
    console.log(`▶ ${root} … ${files.length} files · ${rootCreates} direct audit writes`);
  }

  if (writeAuditCalls.length < MIN_WRITE_AUDIT_CALLS) {
    fail([
      `DNC-08 (vacuity floor) — found ${writeAuditCalls.length} writeAudit call sites across the walk root, ` +
        `below the reviewed floor of ${MIN_WRITE_AUDIT_CALLS}. Rules B and C would have nothing to decide. ` +
        `Either the seam was renamed or the matcher is broken; "found nothing" is never a pass`,
    ]);
  }

  const result = evaluateAuditWrites({ creates, writeAuditCalls, baseline, findingIds });

  if (update) {
    const blocking = result.problems.filter((problem) => problem.startsWith('RULE B') || problem.startsWith('RULE C'));
    if (blocking.length > 0) {
      console.error('\n✗ refusing to write the baseline while a rule-B or rule-C violation is present.');
      for (const problem of blocking) console.error(`\n  ${problem}`);
      console.error('\n  A non-transactional writeAudit call is never baselineable, and recording a ceiling');
      console.error('  from a tree that holds one would freeze the breakage into the reviewed inventory.\n');
      process.exit(1);
    }
    const previous = (baseline && baseline.sites) || {};
    const sites = {};
    const unexplained = [];
    for (const site of result.keyed) {
      const before = previous[site.key];
      sites[site.key] = {
        class: (before && before.class) || '',
        finding: (before && before.finding) || '',
        reason: (before && before.reason) || '',
      };
      if (!before) unexplained.push(site.key);
    }
    const next = { $comment: BASELINE_COMMENT, $doc: BASELINE_DOC, walkRoots: WALK_ROOTS, sites };
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    console.log(`\n✎ baseline rewritten: ${BASELINE_REL}`);
    if (unexplained.length > 0) {
      console.log('\n  New rows were written WITHOUT a class, a finding or a reason. The gate stays RED');
      console.log('  until a human supplies all three — that refusal is the point of the ratchet:');
      for (const key of unexplained) console.log(`    - ${key}`);
    }
    return;
  }

  // Printed on PASS as well as FAIL — the discharge of "reported, never dropped".
  const byClass = new Map();
  for (const [key, row] of Object.entries((baseline && baseline.sites) || {})) {
    const bucket = (row && row.class) || '<unclassed>';
    if (!byClass.has(bucket)) byClass.set(bucket, []);
    byClass.get(bucket).push(key);
  }
  if (byClass.size > 0) {
    console.log('\n  baselined audit writes — queued under an owning finding, never silenced');
    for (const [bucket, keys] of [...byClass].sort()) {
      console.log(`    ${bucket} (${keys.length})`);
      for (const key of keys.sort()) {
        const row = baseline.sites[key];
        console.log(`      · ${key}  ← ${(row && row.finding) || '<none>'}`);
      }
    }
  }
  for (const declared of BASELINE_CLASSES) {
    if (!byClass.has(declared)) console.log(`    ${declared} (0 — declared and empty)`);
  }

  if (result.problems.length > 0) fail(result.problems);

  console.log(
    `\nAUDIT WRITE CHECK: PASS — ${result.stats.sites + result.stats.writeAuditCalls} audit writes over ` +
      `${WALK_ROOTS.join(' + ')}: ${result.stats.writeAuditCalls} through the seam inside a transaction, ` +
      `${result.stats.baselined} baselined with a reason and a resolving finding id, 0 unaccounted for`,
  );
}

module.exports = {
  WALK_ROOTS,
  SEAM_REL,
  BASELINE_REL,
  FINDINGS_INDEX_REL,
  BASELINE_CLASSES,
  MIN_WRITE_AUDIT_CALLS,
  loadTypeScript,
  isProductionSource,
  walkRoot,
  extractFromSource,
  keySites,
  declaredFindingIds,
  evaluateAuditWrites,
};

if (require.main === module) main();
