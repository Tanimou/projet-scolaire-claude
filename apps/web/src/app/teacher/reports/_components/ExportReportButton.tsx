'use client';

import { Download } from 'lucide-react';
import { useCallback, useState } from 'react';

import { csvEscape, csvFixed1, downloadCsv } from '@/lib/csv';

interface ClassRow {
  classSectionName: string;
  subjectName: string;
  studentCount: number;
  publishedAssessments: number;
  average: number | null;
  passRate: number | null;
  perTerm: Array<{ termName: string; average: number | null }>;
}

interface AssessmentRow {
  title: string;
  kind: string;
  classSectionName: string;
  subjectName: string;
  publishedAt: string | null;
  average: number | null;
  gradedCount: number;
  absentCount: number;
  maxScore: number;
}

interface Term {
  id: string;
  name: string;
  orderIndex: number;
}

interface Kpis {
  overallAverage: number | null;
  trendDelta: number | null;
  publishedAssessments: number;
  publishedGrades: number;
  passRate: number | null;
}

export interface ExportReportButtonProps {
  classes: ClassRow[];
  recentAssessments: AssessmentRow[];
  terms: Term[];
  academicYear: { id: string; name: string } | null;
  kpis: Kpis;
}

const fmt1 = csvFixed1;

export function ExportReportButton({
  classes,
  recentAssessments,
  terms,
  academicYear,
  kpis,
}: ExportReportButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleExport = useCallback(() => {
    setBusy(true);
    try {
      const lines: string[] = [];
      lines.push('Rapport enseignant — Pilotage Scolaire');
      // PF-173 (a) — the live half, closed at land of S-E05-1. This line is
      // hand-joined rather than built from `csvRow`, so it declared no escaper
      // and passed every rule of `scripts/csv-escape-check.js` while shipping
      // exactly the defect PF-168 names: `academicYear.name` is tenant-authored
      // free text reaching a `.csv` a teacher opens in Excel, which evaluates a
      // formula in ANY column, not only the first. The structural half of
      // PF-173 — a branded `CsvCell` that makes an unescaped cell a type error
      // across all seven call sites (the ADR-035 `write-audit.ts` pattern) —
      // stays OPEN and wants its own slice; this is the stated minimum.
      lines.push(`Année;${csvEscape(academicYear?.name ?? '')}`);
      lines.push(`Généré le;${new Date().toLocaleString('fr-FR')}`);
      lines.push('');
      lines.push('INDICATEURS GLOBAUX');
      lines.push(`Moyenne globale;${fmt1(kpis.overallAverage)}`);
      lines.push(`Tendance (pts);${fmt1(kpis.trendDelta)}`);
      lines.push(`Taux de réussite (%);${fmt1(kpis.passRate)}`);
      lines.push(`Évaluations publiées;${kpis.publishedAssessments}`);
      lines.push(`Notes publiées;${kpis.publishedGrades}`);
      lines.push('');
      lines.push('PERFORMANCE PAR CLASSE');
      const termsHeader = terms.map((t) => csvEscape(t.name)).join(';');
      lines.push(
        ['Classe', 'Matière', 'Élèves', 'Évaluations', termsHeader, 'Moyenne', 'Réussite (%)']
          .filter(Boolean)
          .join(';'),
      );
      for (const c of classes) {
        const termVals = terms.map((t) => {
          const match = c.perTerm.find((p) => p.termName === t.name);
          return fmt1(match?.average ?? null);
        });
        lines.push(
          [
            csvEscape(c.classSectionName),
            csvEscape(c.subjectName),
            c.studentCount,
            c.publishedAssessments,
            termVals.map(csvEscape).join(';'),
            fmt1(c.average),
            fmt1(c.passRate),
          ].join(';'),
        );
      }
      lines.push('');
      lines.push('ÉVALUATIONS RÉCENTES');
      lines.push(
        ['Titre', 'Type', 'Classe', 'Matière', 'Publiée le', 'Moyenne /20', 'Notes', 'Absents', 'Barème'].join(';'),
      );
      for (const a of recentAssessments) {
        lines.push(
          [
            csvEscape(a.title),
            csvEscape(a.kind),
            csvEscape(a.classSectionName),
            csvEscape(a.subjectName),
            csvEscape(a.publishedAt ?? ''),
            fmt1(a.average),
            a.gradedCount,
            a.absentCount,
            a.maxScore,
          ].join(';'),
        );
      }

      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`rapport-enseignant-${academicYear?.name ?? 'export'}-${stamp}.csv`, lines);
    } finally {
      setBusy(false);
    }
  }, [classes, recentAssessments, terms, academicYear, kpis]);

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Download className="h-4 w-4" />
      {busy ? 'Génération…' : 'Exporter CSV'}
    </button>
  );
}
