'use client';

import { Download } from 'lucide-react';
import { useCallback } from 'react';

import { csvEscape, csvRow, downloadCsv } from '@/lib/csv';

/**
 * Ligne plate, prête à l'affichage — le serveur a déjà résolu le libellé de
 * statut et le lien de parenté avant de la passer ici.
 *
 * `type` a disparu (S-E03-5) : il valait `Inscription` ou `Rattachement` selon
 * un champ `kind` d'une enveloppe JSON de `notes` qu'**aucun chemin d'écriture
 * ne produit**. Une colonne CSV qui ne peut prendre qu'une seule valeur annonce
 * une distinction inexistante — dans un fichier qui, lui, se conserve et se
 * transmet. Le lien de parenté la remplace : il est écrit à chaque création de
 * rattachement.
 */
export interface EnrollmentExportRow {
  guardianFirstName: string;
  guardianLastName: string;
  guardianEmail: string | null;
  guardianPhone: string | null;
  studentFirstName: string;
  studentLastName: string;
  relationship: string;
  className: string;
  statusLabel: string;
  createdAt: string;
}

export interface EnrollmentsExportButtonProps {
  /**
   * Les demandes de la **page courante** de l'onglet actif.
   *
   * ⚠ Depuis S-E03-5, la file est paginée CÔTÉ SERVEUR : la page n'a pas les
   * autres lignes et ne peut donc pas les exporter. Ce n'est pas une régression
   * déguisée — l'export précédent portait sur une lecture plafonnée à 200
   * parents et se présentait, lui, comme exhaustif. La troncature n'a pas été
   * introduite ; elle a été **rendue visible**, sur le bouton et dans l'en-tête
   * du fichier.
   */
  rows: EnrollmentExportRow[];
  /** Human label of the active tab, surfaced in the file header. */
  tabLabel: string;
  /** Slug of the active tab, used in the file name. */
  tabSlug: string;
  /** Total SERVEUR de l'onglet — écrit dans l'en-tête à côté du nombre exporté. */
  total: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function EnrollmentsExportButton({
  rows,
  tabLabel,
  tabSlug,
  total,
}: EnrollmentsExportButtonProps) {
  const partial = rows.length < total;
  const isEmpty = rows.length === 0;

  const handleExport = useCallback(() => {
    const lines: string[] = [];
    lines.push('Inscriptions — Pilotage Scolaire');
    lines.push(csvRow(['Onglet', tabLabel]));
    lines.push(csvRow(['Généré le', new Date().toLocaleString('fr-FR')]));
    // Le nombre exporté ET le total de l'onglet. Un CSV est durable et se
    // partage : le laisser affirmer implicitement l'exhaustivité serait la
    // faute même que cette tranche vient de retirer de l'écran (DNC-01).
    lines.push(csvRow(['Demandes exportées', rows.length]));
    lines.push(csvRow([`Total de l'onglet « ${tabLabel} »`, total]));
    if (partial) {
      lines.push(
        csvRow([
          'Portée du fichier',
          'Page courante uniquement — les autres pages ne sont pas incluses.',
        ]),
      );
    }
    lines.push('');
    lines.push(
      csvRow([
        'Demandeur (nom)',
        'Demandeur (prénom)',
        'Email',
        'Téléphone',
        'Élève (nom)',
        'Élève (prénom)',
        'Lien de parenté',
        'Classe',
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
          csvEscape(r.relationship),
          csvEscape(r.className),
          csvEscape(r.statusLabel),
          csvEscape(formatDate(r.createdAt)),
        ]),
      );
    }

    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`inscriptions-${tabSlug}-${stamp}.csv`, lines);
  }, [rows, tabLabel, tabSlug, total, partial]);

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={isEmpty}
      title={
        isEmpty
          ? 'Aucune demande à exporter'
          : partial
            ? `Exporter les ${rows.length} demandes de la page courante (sur ${total})`
            : 'Exporter les demandes au format CSV'
      }
      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-700 ring-1 ring-slate-200 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
    >
      <Download className="h-4 w-4" />
      Exporter CSV
    </button>
  );
}
