'use client';

import { Download } from 'lucide-react';
import { useCallback, useState } from 'react';

export interface ExportStudent {
  firstName: string;
  lastName: string;
  externalRef: string | null;
  gender: string | null;
  classes: Array<{ name: string; gradeLevelName: string }>;
  gradesCount: number;
  lastGradeAt: string | null;
  avgPct: number | null;
}

export interface ExportStudentsButtonProps {
  /** Roster rows in the exact order/filtering the teacher currently sees. */
  students: ExportStudent[];
  /** True when filters narrow the roster — surfaced in the file header for clarity. */
  filtered?: boolean;
}

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmt1(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return (Math.round(n * 10) / 10).toFixed(1);
}

function pctToGrade20(pct: number | null): number | null {
  if (pct === null) return null;
  return Math.round((pct / 100) * 20 * 10) / 10;
}

function uniqueLevels(classes: ExportStudent['classes']): string {
  return classes
    .map((c) => c.gradeLevelName)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' · ');
}

function genderLabel(g: string | null): string {
  if (g === 'M') return 'Garçon';
  if (g === 'F') return 'Fille';
  return '';
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function ExportStudentsButton({ students, filtered = false }: ExportStudentsButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleExport = useCallback(() => {
    setBusy(true);
    try {
      const lines: string[] = [];
      lines.push('Liste des élèves — Pilotage Scolaire');
      lines.push(`Généré le;${new Date().toLocaleString('fr-FR')}`);
      lines.push(`Élèves exportés;${students.length}${filtered ? ' (filtrés)' : ''}`);
      lines.push('');
      lines.push(
        [
          'Nom',
          'Prénom',
          'Référence',
          'Sexe',
          'Classe(s)',
          'Niveau(x)',
          'Nb de notes',
          'Moyenne /20',
          'Moyenne (%)',
          'Dernière note',
        ].join(';'),
      );

      for (const s of students) {
        const avg20 = pctToGrade20(s.avgPct);
        lines.push(
          [
            csvEscape(s.lastName),
            csvEscape(s.firstName),
            csvEscape(s.externalRef),
            csvEscape(genderLabel(s.gender)),
            csvEscape(s.classes.map((c) => c.name).join(' · ')),
            csvEscape(uniqueLevels(s.classes)),
            s.gradesCount,
            fmt1(avg20),
            s.avgPct != null ? Math.round(s.avgPct) : '',
            csvEscape(formatDate(s.lastGradeAt)),
          ].join(';'),
        );
      }

      // BOM prefix so Excel detects UTF-8; CRLF line endings for spreadsheet apps.
      const csv = '﻿' + lines.join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `mes-eleves-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }, [students, filtered]);

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={busy || students.length === 0}
      title={students.length === 0 ? 'Aucun élève à exporter' : 'Exporter la liste au format CSV'}
      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
    >
      <Download className="h-4 w-4" />
      {busy ? 'Génération…' : 'Exporter CSV'}
    </button>
  );
}
