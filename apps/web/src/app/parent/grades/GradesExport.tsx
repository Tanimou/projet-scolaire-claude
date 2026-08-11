'use client';

import { Button } from '@pilotage/ui';
import { Download } from 'lucide-react';
import { useState } from 'react';

// S-E05-1 / PF-168: this file used to declare its own `escapeCell` — a copy the
// PF-168 grep for `csvEscape` could not see. The `Commentaire` column below is
// teacher-authored free text opened in Excel, so the neutralisation is not
// optional here. Separator, BOM and record terminator are unchanged (`;`, BOM,
// CRLF).
//
// THE QUOTE SET IS NOT THE ONE THIS FILE USED — this is DELTA 3, corrected in
// the land pass because the first version of this comment asserted the opposite.
// The deleted `escapeCell` quoted on `/[";\r\n]/`, with NO comma; the shared
// `csvEscape` quotes on `/[",;\n\r]/`, comma included. `Note /20` (`scoreOn20`,
// a French decimal such as "15,0") and `Coefficient` therefore now export as
// `"15,0"` / `"1,5"` — EVERY row of this export changes bytes. It parses
// identically under the `;` delimiter and Excel still reads the column, but it
// is a visible change to a file parents have already downloaded, so it is stated
// in the PR and pinned by test (`audit-csv.generator.spec.ts`, « DELTA 3 »)
// rather than left to be found later.
import { csvEscape } from '@/lib/csv';

export interface GradeExportRow {
  /** ISO date of the assessment (scheduled or, failing that, published). */
  date: string;
  subject: string;
  assessment: string;
  /** Localised assessment kind label, e.g. "Contrôle écrit". */
  kind: string;
  term: string;
  /** Raw score, e.g. "15 / 20" or "Absent". */
  score: string;
  /** Normalised /20 value with a French decimal comma, e.g. "15,0" or "". */
  scoreOn20: string;
  coefficient: string;
  /** "Publiée" / "Révisée" / "Brouillon". */
  status: string;
  comment: string;
}

const COLUMNS: Array<{ header: string; key: keyof GradeExportRow }> = [
  { header: 'Date', key: 'date' },
  { header: 'Matière', key: 'subject' },
  { header: 'Évaluation', key: 'assessment' },
  { header: 'Type', key: 'kind' },
  { header: 'Trimestre', key: 'term' },
  { header: 'Note', key: 'score' },
  { header: 'Note /20', key: 'scoreOn20' },
  { header: 'Coefficient', key: 'coefficient' },
  { header: 'Statut', key: 'status' },
  { header: 'Commentaire', key: 'comment' },
];

/** "2026-05-31T..." → "31/05/2026" (falls back to the raw value if unparsable). */
function formatFrDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function buildCsv(rows: GradeExportRow[]): string {
  const headerLine = COLUMNS.map((c) => csvEscape(c.header)).join(';');
  const bodyLines = rows.map((row) =>
    COLUMNS.map((c) => {
      const raw = c.key === 'date' ? formatFrDate(row.date) : row[c.key];
      return csvEscape(raw ?? '');
    }).join(';'),
  );
  // CRLF + UTF-8 BOM so Excel opens accented French text correctly.
  return '﻿' + [headerLine, ...bodyLines].join('\r\n');
}

/** ASCII-safe slug for filenames: "Quentin Roux" → "quentin-roux". */
function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'enfant'
  );
}

/**
 * One-click CSV export of the (filtered) published grades for the selected
 * child. Generates the file client-side — no extra round-trip — and mirrors the
 * exact rows the parent is currently looking at (WYSIWYG with the filters), the
 * same approach as the attendance export.
 */
export function GradesExport({
  rows,
  childName,
  filtered,
}: {
  rows: GradeExportRow[];
  childName: string;
  filtered: boolean;
}) {
  const [done, setDone] = useState(false);
  const disabled = rows.length === 0;

  function handleExport() {
    if (disabled) return;
    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);
    const link = document.createElement('a');
    link.href = url;
    link.download = `notes_${slugify(childName)}_${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setDone(true);
    window.setTimeout(() => setDone(false), 2500);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={disabled}
      title={
        disabled
          ? 'Aucune note à exporter'
          : filtered
            ? 'Exporter les notes filtrées au format CSV'
            : 'Exporter toutes les notes au format CSV'
      }
      aria-label="Exporter les notes au format CSV"
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
      {done ? 'Exporté ✓' : 'Exporter (.csv)'}
    </Button>
  );
}
