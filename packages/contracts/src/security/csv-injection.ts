/**
 * CSV formula-injection neutralisation — the ONE definition (S-E05-1 / PF-168).
 *
 * ---------------------------------------------------------------------------
 * WHY HERE
 * ---------------------------------------------------------------------------
 * At HEAD the same defence existed in THREE places that cannot see each other —
 * `apps/web/src/lib/csv.ts` (no neutralisation at all), a private copy inside
 * `apps/web/src/app/admin/alerts/AlertsExportButton.tsx` (prefix, but no
 * force-quote) and `apps/worker/.../audit-csv.generator.ts` (correct) — plus two
 * more `escapeCell` copies on the parent portal that a grep for `csvEscape`
 * could not see. Three implementations of one security predicate is three
 * different answers to "is this cell dangerous?", which is exactly the G-TRUTH
 * violation this module closes.
 *
 * `packages/contracts` is the only package all three runtimes already consume,
 * and `security/branding-css.ts` + `security/csp.ts` are the existing precedent
 * for *a pure shared security function at this address*. So this is a
 * **relocation of ADR-037 D7, not a change to it** — the behaviour below is the
 * worker's, byte for byte. See ADR-037 D8.
 *
 * This file imports **nothing**. It runs in a browser bundle (`'use client'`
 * export buttons), in a Node worker, and inside a `require()`-based gate script,
 * so it must not reach for zod, `node:*`, or any other contracts module. It also
 * declares **no class and no `instanceof`**: `packages/contracts` ships CJS
 * (`main → dist/index.js`, and `dist/` is git-ignored), so a spec resolving
 * `src/` and a runtime resolving `dist/` hold two different module objects. A
 * plain function returning a plain object literal cannot disagree with itself
 * across that seam; a class would.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------------------------------
 *  - **Nothing is ever dropped.** A triggering payload survives in full; the
 *    original is recovered by stripping exactly ONE leading apostrophe from a
 *    cell this function neutralised. Silent removal would be a worse defect than
 *    the injection itself.
 *  - **Uniform across every column, never a per-column allowlist.** An allowlist
 *    is precisely what drifts. The visible price is accepted and documented: an
 *    international phone number (`+33 …`) and a negative number (`-1.4`) both
 *    start with a trigger, so both are neutralised and Excel reads them as text.
 *  - **Applied at most once.** `'` is not itself a trigger, so a cell that
 *    already starts with one is left alone: `"'=1+1"` in yields `"'=1+1"` out,
 *    never `"''=1+1"`.
 *  - **Apostrophe, not a leading tab** — the other standard mitigation. A tab IS
 *    in the trigger set, so prefixing one produces a cell the escaper must
 *    consider dangerous again and the transform would recurse. `'` is not a
 *    trigger, so one pass suffices.
 *  - **Only the FIRST character is examined.** `a=b` and `2 = deux` are not
 *    formulas and pass through byte-identical, as does every non-triggering
 *    cell: `Évaluation`, `Résultats`, `role.delete`, `10.0.0.1`, `''`, and the
 *    typographic apostrophe `’` (U+2019) and em dash `—` (U+2014) the French
 *    copy uses freely. Only ASCII `-` (U+002D) triggers, never `—` or `–`.
 *  - **The DIALECT is NOT part of this contract.** The separator, the BOM and
 *    the record terminator stay per-surface: the web quotes on `[",;\n\r]` and
 *    joins with `;`, the worker quotes on `[",\n\r]` and joins with `,`. Folding
 *    them into one union regex would force-quote every worker cell containing a
 *    `;` — e.g. a `user_agent` header — and silently rewrite the regulator's
 *    audit file. **PF-169** (`;` vs `,`: both surfaces cite French Excel and both
 *    cannot be right) stays OPEN and is deliberately not taken here; unifying the
 *    dialect is a versioned, announced format change, not a security fix.
 */

/**
 * The characters that make a cell a **formula** rather than a record when the
 * file is opened as a spreadsheet — Excel, LibreOffice and Google Sheets all
 * evaluate a cell starting with one of these. `\t` and `\r` are here for a
 * second reason as well: pasted into a sheet they split the cell, and a bare
 * `\r` in an unquoted cell terminates the *record*.
 *
 * Assembling this list anywhere else is a gate failure — see
 * `scripts/csv-escape-check.js` rule B.
 */
export const CSV_INJECTION_TRIGGERS: readonly string[] = ['=', '+', '-', '@', '\t', '\r'];

/**
 * The neutralising prefix: ASCII apostrophe U+0027, never the typographic
 * U+2019 the French headings contain. See the header for why it is not a tab.
 */
export const CSV_NEUTRALISER = "'";

/** Result of the neutralisation step, before any dialect-specific quoting. */
export interface CsvNeutralisation {
  /** The cell text, apostrophe-prefixed if and only if `neutralised` is true. */
  readonly text: string;
  /**
   * True when a trigger was found and the prefix was applied. Each surface uses
   * this flag to force-quote, so no caller re-derives the trigger test and no
   * caller can drift by half.
   */
  readonly neutralised: boolean;
}

/**
 * Neutralise one CSV cell against formula injection.
 *
 * Pure, unary and total: every call site holds it (or a `csvEscape` built on it)
 * as a `.map(fn)` callback, where `Array.prototype.map` passes `(v, i, arr)` —
 * a second parameter would silently receive the array index, so this function
 * takes exactly one.
 */
export function neutraliseCsvCell(value: string): CsvNeutralisation {
  const dangerous = value.length > 0 && CSV_INJECTION_TRIGGERS.indexOf(value.charAt(0)) !== -1;
  return {
    text: dangerous ? CSV_NEUTRALISER + value : value,
    neutralised: dangerous,
  };
}
