/**
 * Shared CSV helpers for client-side exports.
 *
 * Conventions used across the app (FR Excel friendly):
 *  - `;` field delimiter (Excel locale uses comma as decimal separator)
 *  - CRLF line endings
 *  - UTF-8 BOM prefix so Excel auto-detects the encoding
 */

/** Byte-order mark that makes Excel read the file as UTF-8. */
export const CSV_BOM = '﻿';

/** Field separator — semicolon for FR Excel compatibility. */
export const CSV_SEPARATOR = ';';

/** Escape a single CSV cell, quoting only when needed. */
export function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
