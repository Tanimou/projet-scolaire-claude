'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';

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
  let s = String(v);
  // Neutralise CSV formula injection: a cell starting with = + - @ (or a
  // leading tab/CR before one) can be executed as a formula when the file is
  // opened in Excel/LibreOffice. Prefix with a quote so it stays literal text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
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

interface CsvPayload {
  lines: string[];
  filename: string;
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Pure builder for the rules-configuration export (testable outside React). */
function buildRulesCsv(rules: AlertRule[], generatedAt: string): CsvPayload {
  const lines: string[] = [];
  lines.push('Règles d’alerte — Pilotage Scolaire');
  lines.push(`Généré le;${generatedAt}`);
  lines.push(`Règles;${rules.length}`);
  lines.push('');
  lines.push(
    ['Code', 'Règle', 'Sévérité', 'Activée', 'Description', 'Paramètres', 'Alertes ouvertes']
      .map(csvEscape)
      .join(';'),
  );
  for (const r of rules) {
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
  return { lines, filename: `regles-alertes-${todayStamp()}.csv` };
}

/** Pure builder for an alert-instance export (testable outside React). */
function buildInstancesCsv(
  rows: AlertInstance[],
  heading: string,
  slug: string,
  generatedAt: string,
): CsvPayload {
  // SEVERITY_ORDER is high → medium → low, so the smaller index is the more
  // severe level. Ascending sort therefore lists high severity first, then
  // most-recent within a level — i.e. the file reads as a triage list.
  const sevRank = (s: AlertInstance['severity']) => SEVERITY_ORDER.indexOf(s);
  const sorted = [...rows].sort((a, b) => {
    const bySev = sevRank(a.severity) - sevRank(b.severity);
    if (bySev !== 0) return bySev;
    return b.detectedAt.localeCompare(a.detectedAt);
  });

  const lines: string[] = [];
  lines.push(`${heading} — Pilotage Scolaire`);
  lines.push(`Généré le;${generatedAt}`);
  lines.push(`Alertes;${sorted.length}`);
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
  for (const a of sorted) {
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
  return { lines, filename: `${slug}-${todayStamp()}.csv` };
}

function triggerDownload({ lines, filename }: CsvPayload) {
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

  // Plain handler (not memoised): the button is a DOM element, so there is no
  // child to keep referentially stable, and the discriminated-union props make
  // a narrow dependency list awkward. Keeping it inline is simpler and correct.
  function handleExport() {
    setBusy(true);
    try {
      const generatedAt = new Date().toLocaleString('fr-FR');
      const payload =
        props.mode === 'rules'
          ? buildRulesCsv(props.rules, generatedAt)
          : buildInstancesCsv(props.rows, props.heading, props.slug, generatedAt);
      triggerDownload(payload);
    } finally {
      setBusy(false);
    }
  }

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
