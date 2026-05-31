'use client';

import { Download } from 'lucide-react';
import { useCallback } from 'react';

import { csvEscape, csvFixed1, csvRow, downloadCsv } from '@/lib/csv';

/** Roster row shape this export reads — a structural subset of the page's `TeacherStudent`. */
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
  const isEmpty = students.length === 0;

  const handleExport = useCallback(() => {
    const lines: string[] = [];
    lines.push('Liste des élèves — Pilotage Scolaire');
    lines.push(csvRow(['Généré le', new Date().toLocaleString('fr-FR')]));
    lines.push(csvRow(['Élèves exportés', `${students.length}${filtered ? ' (filtrés)' : ''}`]));
    lines.push('');
    lines.push(
      csvRow([
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
      ]),
    );

    for (const s of students) {
      const avg20 = pctToGrade20(s.avgPct);
      lines.push(
        csvRow([
          csvEscape(s.lastName),
          csvEscape(s.firstName),
          csvEscape(s.externalRef),
          csvEscape(genderLabel(s.gender)),
          csvEscape(s.classes.map((c) => c.name).join(' · ')),
          csvEscape(uniqueLevels(s.classes)),
          s.gradesCount,
          csvFixed1(avg20),
          s.avgPct != null ? Math.round(s.avgPct) : '',
          csvEscape(formatDate(s.lastGradeAt)),
        ]),
      );
    }

    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`mes-eleves-${stamp}.csv`, lines);
  }, [students, filtered]);

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={isEmpty}
      title={isEmpty ? 'Aucun élève à exporter' : 'Exporter la liste au format CSV'}
      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
    >
      <Download className="h-4 w-4" />
      Exporter CSV
    </button>
  );
}
