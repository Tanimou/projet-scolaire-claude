'use client';

import { Download } from 'lucide-react';
import { useCallback, useState } from 'react';

import {
  RULE_LABEL,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  STATUS_LABEL,
  type AlertInstance,
  type AlertRule,
} from './types';

function csvEscape(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatParameters(params: Record<string, unknown>): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
}

function triggerDownload(lines: string[], filename: string) {
  // BOM keeps accented characters readable when opened in Excel.
  const csv = '﻿' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type ExportMode =
  | { mode: 'instances'; rows: AlertInstance[]; slug: string; heading: string }
  | { mode: 'rules'; rules: AlertRule[] };

export type AlertsExportButtonProps = ExportMode & {
  /** When true, nothing can be exported (empty dataset) and the button is disabled. */
  disabled?: boolean;
};

export function AlertsExportButton(props: AlertsExportButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleExport = useCallback(() => {
    setBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const generatedAt = new Date().toLocaleString('fr-FR');
      const lines: string[] = [];

      if (props.mode === 'rules') {
        lines.push('Règles d’alerte — Pilotage Scolaire');
        lines.push(`Généré le;${generatedAt}`);
        lines.push(`Règles;${props.rules.length}`);
        lines.push('');
        lines.push(
          ['Code', 'Règle', 'Sévérité', 'Activée', 'Description', 'Paramètres', 'Alertes ouvertes']
            .map(csvEscape)
            .join(';'),
        );
        for (const r of props.rules) {
          lines.push(
            [
              csvEscape(r.code),
              csvEscape(r.label),
              csvEscape(SEVERITY_LABEL[r.severity]),
              csvEscape(r.enabled ? 'Oui' : 'Non'),
              csvEscape(r.description),
              csvEscape(formatParameters(r.parameters)),
              csvEscape(r.openInstances),
            ].join(';'),
          );
        }
        triggerDownload(lines, `regles-alertes-${stamp}.csv`);
        return;
      }

      // ── instances ── sort by severity (high → low) then most recent first so
      //    the export reads like a triage list.
      const sevRank = (s: AlertInstance['severity']) => SEVERITY_ORDER.indexOf(s);
      const rows = [...props.rows].sort((a, b) => {
        const bySev = sevRank(a.severity) - sevRank(b.severity);
        if (bySev !== 0) return bySev;
        return b.detectedAt.localeCompare(a.detectedAt);
      });

      lines.push(`${props.heading} — Pilotage Scolaire`);
      lines.push(`Généré le;${generatedAt}`);
      lines.push(`Alertes;${rows.length}`);
      lines.push('');
      lines.push(
        [
          'Statut',
          'Sévérité',
          'Règle',
          'Titre',
          'Détail',
          'Recommandation',
          'Élève',
          'Classe',
          'Matière',
          'Détectée le',
        ]
          .map(csvEscape)
          .join(';'),
      );
      for (const a of rows) {
        lines.push(
          [
            csvEscape(STATUS_LABEL[a.status]),
            csvEscape(SEVERITY_LABEL[a.severity]),
            csvEscape(RULE_LABEL[a.code] ?? a.code),
            csvEscape(a.title),
            csvEscape(a.body),
            csvEscape(a.recommendation ?? ''),
            csvEscape(a.studentName),
            csvEscape(a.classSectionName ?? ''),
            csvEscape(a.subjectName ?? ''),
            csvEscape(formatDate(a.detectedAt)),
          ].join(';'),
        );
      }
      triggerDownload(lines, `${props.slug}-${stamp}.csv`);
    } finally {
      setBusy(false);
    }
  }, [props]);

  const disabled = busy || props.disabled;

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={disabled}
      title={
        props.disabled
          ? 'Rien à exporter pour la vue actuelle'
          : 'Exporter la vue actuelle au format CSV (Excel)'
      }
      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-white disabled:hover:shadow-sm"
    >
      <Download className="h-4 w-4" />
      {busy ? 'Génération…' : 'Exporter CSV'}
    </button>
  );
}
