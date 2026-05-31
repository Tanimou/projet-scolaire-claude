'use client';

import { Download } from 'lucide-react';
import { useCallback } from 'react';

import { csvEscape, csvRow, downloadCsv } from '@/lib/csv';

/** Guardian row shape this export reads — a structural subset of the page's `GuardianItem`. */
export interface ExportGuardian {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  profession: string | null;
  guardianships: Array<{
    relationship: string;
    isPrimaryContact: boolean;
    status: 'pending' | 'active' | 'revoked';
    student: { firstName: string; lastName: string };
  }>;
}

export interface GuardiansExportButtonProps {
  /** Guardians in the exact order/filtering the admin currently sees. */
  guardians: ExportGuardian[];
  /** True when filters narrow the list — surfaced in the file header for clarity. */
  filtered?: boolean;
}

const RELATIONSHIP_LABEL: Record<string, string> = {
  mother: 'Mère',
  father: 'Père',
  legal_guardian: 'Tuteur',
  grandparent: 'Grand-parent',
  sibling: 'Frère/Sœur',
  other: 'Autre',
};

const STATUS_LABEL: Record<ExportGuardian['guardianships'][number]['status'], string> = {
  active: 'Approuvé',
  pending: 'En attente',
  revoked: 'Révoqué',
};

export function GuardiansExportButton({ guardians, filtered = false }: GuardiansExportButtonProps) {
  const isEmpty = guardians.length === 0;

  const handleExport = useCallback(() => {
    const lines: string[] = [];
    lines.push('Parents / Tuteurs — Pilotage Scolaire');
    lines.push(csvRow(['Généré le', new Date().toLocaleString('fr-FR')]));
    lines.push(csvRow(['Parents exportés', `${guardians.length}${filtered ? ' (filtrés)' : ''}`]));
    lines.push('');
    lines.push(
      csvRow([
        'Nom',
        'Prénom',
        'Email',
        'Téléphone',
        'Profession',
        'Élèves rattachés',
        'Élèves',
        'Relation principale',
        'Statut du lien',
      ]),
    );

    for (const g of guardians) {
      const primary = g.guardianships.find((gs) => gs.isPrimaryContact) ?? g.guardianships[0];
      const students = g.guardianships
        .map((gs) => `${gs.student.firstName} ${gs.student.lastName}`)
        .join(' · ');
      lines.push(
        csvRow([
          csvEscape(g.lastName),
          csvEscape(g.firstName),
          csvEscape(g.email),
          csvEscape(g.phone),
          csvEscape(g.profession),
          g.guardianships.length,
          csvEscape(students),
          csvEscape(primary ? (RELATIONSHIP_LABEL[primary.relationship] ?? primary.relationship) : ''),
          csvEscape(primary ? STATUS_LABEL[primary.status] : ''),
        ]),
      );
    }

    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`parents-tuteurs-${stamp}.csv`, lines);
  }, [guardians, filtered]);

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={isEmpty}
      title={isEmpty ? 'Aucun parent à exporter' : 'Exporter la liste au format CSV'}
      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
    >
      <Download className="h-4 w-4" />
      Exporter CSV
    </button>
  );
}
