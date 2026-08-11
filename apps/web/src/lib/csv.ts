/**
 * Shared CSV helpers for client-side exports.
 *
 * Conventions used across the app (FR Excel friendly):
 *  - `;` field delimiter (Excel locale uses comma as decimal separator)
 *  - CRLF line endings
 *  - UTF-8 BOM prefix so Excel auto-detects the encoding
 *  - every cell is neutralised against formula injection (see `csvEscape`)
 *
 * This module is the ONE escaper under `apps/web/src`: declaring a second one
 * anywhere below that root is a gate failure (`scripts/csv-escape-check.js`,
 * S-E05-1 / PF-168). Seven export surfaces consume it — admin/enrollments,
 * admin/guardians, admin/alerts, teacher/reports, teacher/students,
 * parent/grades and parent/attendance.
 *
 * **What the gate does NOT say, and this header must not either.** Rules A–E
 * inspect escaper *declarations*; nothing checks that a CSV line was built from
 * one. A surface that hand-joins user data — or calls `csvRow`, which is a bare
 * `cells.join(CSV_SEPARATOR)` — declares no escaper and passes every rule.
 * One such site exists today and is **not** closed by this slice:
 * `apps/web/src/app/teacher/reports/_components/ExportReportButton.tsx:68`
 * interpolates `academicYear?.name` straight into a line, so a year name
 * beginning with `=`/`+`/`-`/`@` is still live in a file a teacher opens.
 * Recorded as **PF-173**. Read this module as « one escaper, uniqueness
 * enforced », never as « every web cell is neutralised ».
 */

import { neutraliseCsvCell } from '@pilotage/contracts';

/** Byte-order mark that makes Excel read the file as UTF-8. */
export const CSV_BOM = '﻿';

/**
 * Field separator — semicolon for FR Excel compatibility.
 *
 * **PF-169 is deliberately NOT taken in this slice.** The worker's audit export
 * (`apps/worker/.../audit-csv.generator.ts`) joins with `,` and this one joins
 * with `;`, and both cite French Excel as the reason — they cannot both be
 * right. Reconciling them changes the bytes of every file already downloaded by
 * an admin, a teacher or a parent, so it is a **versioned, announced format
 * change**, not a drive-by inside a security fix. The separator, the BOM and the
 * CRLF join below are therefore untouched here; only the *cell* changes.
 */
export const CSV_SEPARATOR = ';';

/**
 * Escape a single CSV cell: neutralise formula injection, then quote when the
 * web dialect needs it.
 *
 * Quoting alone does not neutralise — Excel evaluates `"=1+1"` on CSV import —
 * so a cell whose FIRST character is `=`, `+`, `-`, `@`, TAB or CR is
 * **force-quoted AND prefixed with a single apostrophe**. The predicate and the
 * prefix live in `@pilotage/contracts` (`security/csv-injection.ts`, ADR-037 D8)
 * so that this file, the worker generator and nothing else define them; the
 * *dialect* stays here, because the web quote set keeps `;` and the worker's
 * does not.
 *
 * Consequences that are accepted, not accidents (uniform beats an allowlist,
 * ADR-037 D7): a guardian phone `+33 6 12 34 56 78` exports as
 * `"'+33 6 12 34 56 78"`, and a negative value routed through here would export
 * as text rather than a number — which is why the numeric cells built with
 * `csvFixed1` are deliberately passed to `csvRow` *without* escaping. Do not
 * "helpfully" wrap them. Non-triggering cells are byte-identical to before:
 * `Évaluation`, `Martin; Dupont` → `"Martin; Dupont"`, `—`, `’`, `''`, `a=b`.
 *
 * Strictly unary: it is passed directly to `.map(csvEscape)` at several call
 * sites, and `Array.prototype.map` would feed a second parameter the index.
 */
export function csvEscape(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  const { text, neutralised } = neutraliseCsvCell(String(v));
  if (neutralised || /[",;\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Format a number to one decimal, or '' for nullish values. */
export function csvFixed1(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** Join a row's already-resolved cells with the standard separator. */
export function csvRow(cells: Array<string | number>): string {
  return cells.join(CSV_SEPARATOR);
}

/** Assemble physical lines into a BOM-prefixed, CRLF-joined CSV string. */
export function buildCsv(lines: string[]): string {
  return CSV_BOM + lines.join('\r\n');
}

/** Trigger a browser download of the given lines as a `.csv` file. */
export function downloadCsv(filename: string, lines: string[]): void {
  const blob = new Blob([buildCsv(lines)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
