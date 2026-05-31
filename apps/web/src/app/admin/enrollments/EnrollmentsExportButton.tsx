'use client';

import { Download } from 'lucide-react';
import { useCallback } from 'react';

import { csvEscape, csvRow, downloadCsv } from '@/lib/csv';

/** Flat, presentation-ready row — the server resolves the notes-JSON flags before passing it down. */
export interface EnrollmentExportRow {
  guardianFirstName: string;
  guardianLastName: string;
  guardianEmail: string | null;
  guardianPhone: string | null;
  studentFirstName: string;
  studentLastName: string;
  type: string;
  className: string;
  statusLabel: string;
  createdAt: string;
}

export interface EnrollmentsExportButtonProps {
  /** Requests in the currently selected tab. */
  rows: EnrollmentExportRow[];
  /** Human label of the active tab, surfaced in the file header. */
  tabLabel: string;
  /** Slug of the active tab, used in the file name. */
  tabSlug: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function EnrollmentsExportButton({ rows, tabLabel, tabSlug }: EnrollmentsExportButtonProps) {
  const isEmpty = rows.length === 0;

  const handleExport = useCallback(() => {
    const lines: string[] = [];
    lines.push('Inscriptions — Pilotage Scolaire');
    lines.push(csvRow(['Onglet', tabLabel]));
    lines.push(csvRow(['Généré le', new Date().toLocaleString('fr-FR')]));
    lines.push(csvRow(['Demandes exportées', rows.length]));
    lines.push('');
    lines.push(
      csvRow([
        'Demandeur (nom)',
        'Demandeur (prénom)',
        'Email',
        'Téléphone',
        'Élève (nom)',
        'Élève (prénom)',
        'Type',
        'Classe souhaitée',
        'Statut',
        'Date',
      ]),
    );

    for (const r of rows) {
      lines.push(
        csvRow([
          csvEscape(r.guardianLastName),
          csvEscape(r.guardianFirstName),
          csvEscape(r.guardianEmail),
          csvEscape(r.guardianPhone),
          csvEscape(r.studentLastName),
          csvEscape(r.studentFirstName),
          csvEscape(r.type),
          csvEscape(r.className),
          csvEscape(r.statusLabel),
          csvEscape(formatDate(r.createdAt)),
        ]),
      );
    }

    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`inscriptions-${tabSlug}-${stamp}.csv`, lines);
  }, [rows, tabLabel, tabSlug]);

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={isEmpty}
      title={isEmpty ? 'Aucune demande à exporter' : 'Exporter les demandes au format CSV'}
      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
    >
      <Download className="h-4 w-4" />
      Exporter CSV
    </button>
  );
}
