import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Hourglass,
  ListChecks,
  Loader2,
  RotateCcw,
  Sparkles,
  Tag,
  XCircle,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  ProgressBar,
  SectionHeader,
  StatusBadge,
  type StatusTone,
  Timeline,
  type TimelineEntry,
} from '@pilotage/ui';

import { ApplyControls, RollbackButtonClient } from './ApplyControls';
import { ImportStatusPoller } from './ImportStatusPoller';
import { RowsFilters } from './RowsFilters';
import type {
  BatchDetail,
  BatchRow,
  BatchStatus,
  BatchSummary,
  ErrorFieldFacet,
  RowError,
  RowStatus,
  RowStatusFilter,
} from './types';

export const metadata: Metadata = { title: 'Détail import' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const ROLLBACK_WINDOW_HOURS = 24;

const TYPE_LABEL: Record<string, string> = {
  students: 'Élèves',
  classes: 'Classes',
  subjects: 'Matières',
  teachers: 'Professeurs',
  parents: 'Parents',
  grades: 'Notes',
  attendance: 'Présences',
};

const STATUS_LABEL: Record<BatchStatus, string> = {
  uploaded: 'Uploadé',
  validating: 'Validation…',
  validated: 'Validé · à confirmer',
  queued: 'En file d’attente',
  applying: 'Application…',
  applied: 'Appliqué',
  failed: 'Échec',
  rolled_back: 'Annulé',
};

const STATUS_TONE: Record<BatchStatus, StatusTone> = {
  uploaded: 'neutral',
  validating: 'info',
  validated: 'warning',
  queued: 'neutral',
  applying: 'info',
  applied: 'success',
  failed: 'danger',
  rolled_back: 'neutral',
};

const ROW_STATUS_LABEL: Record<RowStatus, string> = {
  pending: 'En attente',
  valid: 'Valide',
  invalid: 'Invalide',
  applied: 'Appliquée',
  skipped: 'Ignorée',
  rolled_back: 'Annulée',
};

const ROW_STATUS_TONE: Record<RowStatus, StatusTone> = {
  pending: 'neutral',
  valid: 'success',
  invalid: 'danger',
  applied: 'success',
  skipped: 'warning',
  rolled_back: 'neutral',
};

const VALID_ROW_STATUSES: RowStatusFilter[] = [
  '',
  'pending',
  'valid',
  'invalid',
  'applied',
  'skipped',
  'rolled_back',
];

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return '—';
  }
}

function fmtRelative(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    const d = new Date(iso).getTime();
    const diff = Date.now() - d;
    const minutes = Math.round(diff / 60_000);
    if (minutes < 1) return "à l'instant";
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    const days = Math.round(hours / 24);
    if (days < 30) return `il y a ${days} j`;
    return null;
  } catch {
    return null;
  }
}

function parseStatusFilter(raw: string | undefined): RowStatusFilter {
  if (!raw) return '';
  return (VALID_ROW_STATUSES as readonly string[]).includes(raw)
    ? (raw as RowStatusFilter)
    : '';
}

function rowHitsField(row: BatchRow, errorField: string): boolean {
  if (!errorField) return true;
  if (!row.errors || row.errors.length === 0) return false;
  if (errorField === '__unknown__') {
    return row.errors.some((e) => !e.field);
  }
  return row.errors.some((e) => e.field === errorField);
}

function rowMatchesSearch(row: BatchRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (String(row.rowIndex).includes(needle)) return true;
  for (const [k, v] of Object.entries(row.payload ?? {})) {
    if (k.toLowerCase().includes(needle)) return true;
    if (v === null || v === undefined) continue;
    if (String(v).toLowerCase().includes(needle)) return true;
  }
  if (row.errors) {
    for (const e of row.errors) {
      if (e.field && e.field.toLowerCase().includes(needle)) return true;
      if (e.message && e.message.toLowerCase().includes(needle)) return true;
    }
  }
  return false;
}

function buildErrorFacets(rows: BatchRow[]): ErrorFieldFacet[] {
  const counts = new Map<string, { label: string; rowCount: number }>();
  for (const r of rows) {
    if (r.status !== 'invalid' || !r.errors || r.errors.length === 0) continue;
    const fieldsOnRow = new Set<string>();
    for (const e of r.errors) {
      const key = e.field ?? '__unknown__';
      fieldsOnRow.add(key);
    }
    for (const key of fieldsOnRow) {
      const existing = counts.get(key);
      if (existing) {
        existing.rowCount += 1;
      } else {
        counts.set(key, {
          label: key === '__unknown__' ? '(sans champ)' : key,
          rowCount: 1,
        });
      }
    }
  }
  return Array.from(counts.entries())
    .map(([key, v]) => ({ key, label: v.label, rowCount: v.rowCount }))
    .sort((a, b) => b.rowCount - a.rowCount || a.label.localeCompare(b.label));
}

function buildTimeline(batch: BatchDetail): TimelineEntry[] {
  const s = batch.summary;
  const entries: TimelineEntry[] = [];

  entries.push({
    id: 'uploaded',
    title: 'Fichier uploadé',
    sub: s.totalRows
      ? `${s.totalRows} ligne${s.totalRows > 1 ? 's' : ''} détectée${s.totalRows > 1 ? 's' : ''}`
      : undefined,
    timestamp: fmtDateTime(batch.startedAt),
    tone: 'blue',
  });

  if (batch.validatedAt || batch.status !== 'uploaded') {
    const v = s.validCount ?? 0;
    const inv = s.invalidCount ?? 0;
    const validatingNow = batch.status === 'validating' && !batch.validatedAt;
    entries.push({
      id: 'validated',
      title: validatingNow ? 'Validation en cours' : 'Validation terminée',
      sub: validatingNow
        ? 'Analyse des lignes…'
        : `${v} valide${v > 1 ? 's' : ''} · ${inv} invalide${inv > 1 ? 's' : ''}`,
      timestamp: validatingNow ? '…' : fmtDateTime(batch.validatedAt),
      tone: validatingNow ? 'blue' : inv > 0 ? 'amber' : 'green',
    });
  }

  if (batch.status === 'queued') {
    entries.push({
      id: 'queued',
      title: 'En file d’attente',
      sub: "L'application va démarrer dans un instant",
      timestamp: '…',
      tone: 'slate',
    });
  }

  if (batch.appliedAt || batch.status === 'applying' || batch.status === 'applied') {
    const applied = s.applied ?? 0;
    const skipped = s.skipped ?? 0;
    const applyingNow = batch.status === 'applying' && !batch.appliedAt;
    const processed = s.processedRows ?? applied + skipped;
    const totalToApply = s.totalToApply ?? s.validCount ?? 0;
    entries.push({
      id: 'applied',
      title: applyingNow ? 'Application en cours' : 'Import appliqué',
      sub: applyingNow
        ? totalToApply > 0
          ? `Application en cours — ${processed}/${totalToApply} lignes`
          : 'Application en cours…'
        : `${applied} appliquée${applied > 1 ? 's' : ''}` +
          (skipped > 0 ? ` · ${skipped} ignorée${skipped > 1 ? 's' : ''}` : ''),
      timestamp: applyingNow ? '…' : fmtDateTime(batch.appliedAt),
      tone: applyingNow ? 'blue' : 'green',
    });
  }

  if (batch.rolledBackAt || batch.status === 'rolled_back') {
    entries.push({
      id: 'rolled_back',
      title: 'Import annulé',
      sub: 'Toutes les entités créées ont été supprimées',
      timestamp: fmtDateTime(batch.rolledBackAt),
      tone: 'slate',
    });
  }

  if (batch.status === 'failed') {
    entries.push({
      id: 'failed',
      title: "Échec d'application",
      sub:
        batch.errorMessage ??
        'Aucune donnée partielle conservée — vous pouvez relancer.',
      timestamp: fmtDateTime(batch.appliedAt ?? batch.validatedAt ?? batch.startedAt),
      tone: 'rose',
    });
  }

  return entries;
}

function summarisePayload(payload: Record<string, unknown>): Array<{ k: string; v: string }> {
  return Object.entries(payload ?? {})
    .filter(([k, v]) => !k.startsWith('_') && v !== undefined && v !== '' && v !== null)
    .slice(0, 5)
    .map(([k, v]) => ({ k, v: String(v) }));
}

export default async function ImportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const batch = await api<BatchDetail>(`/api/v1/imports/${id}`, { cache: 'no-store' });

  const status = parseStatusFilter(typeof sp.status === 'string' ? sp.status : undefined);
  const errorField = typeof sp.errorField === 'string' ? sp.errorField : '';
  const q = (typeof sp.q === 'string' ? sp.q : '').trim();
  const page = Math.max(1, Number(typeof sp.page === 'string' ? sp.page : '1') || 1);

  const allRows = batch.rows ?? [];
  const summary = batch.summary ?? {};
  const errorFacets = buildErrorFacets(allRows);
  const timeline = buildTimeline(batch);

  // Filter pipeline: status → errorField → search
  const filtered = allRows.filter((r) => {
    if (status && r.status !== status) return false;
    if (!rowHitsField(r, errorField)) return false;
    if (!rowMatchesSearch(r, q)) return false;
    return true;
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const totalRows = summary.totalRows ?? allRows.length;
  const validCount = summary.validCount ?? allRows.filter((r) => r.status === 'valid').length;
  const invalidCount =
    summary.invalidCount ?? allRows.filter((r) => r.status === 'invalid').length;
  const appliedCount = summary.applied ?? allRows.filter((r) => r.status === 'applied').length;
  const skippedCount = summary.skipped ?? allRows.filter((r) => r.status === 'skipped').length;
  const validRate = totalRows > 0 ? Math.round((validCount / totalRows) * 100) : 0;
  const appliedRate = totalRows > 0 ? Math.round((appliedCount / totalRows) * 100) : 0;

  const typeLabel = TYPE_LABEL[batch.type] ?? batch.type;
  const relative = fmtRelative(batch.startedAt);

  const hasActiveFilters = !!q || !!status || !!errorField;

  return (
    <PortalShell portal="admin">
      <Link
        href="/admin/imports"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux imports
      </Link>

      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Imports', href: '/admin/imports' },
          { label: batch.fileName },
        ]}
        title={batch.fileName}
        subtitle={
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
              <Tag className="h-3 w-3" /> {typeLabel}
            </span>
            <span className="ml-2 text-[12px] text-slate-500">
              Import #{batch.id.slice(0, 8)} · démarré le {fmtDateTime(batch.startedAt)}
              {relative ? ` (${relative})` : ''}
            </span>
          </>
        }
        actions={
          <StatusBadge
            tone={STATUS_TONE[batch.status]}
            label={STATUS_LABEL[batch.status]}
            withDot
          />
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={FileText} tone="blue" label="TOTAL LIGNES" value={totalRows}>
          Lignes détectées dans le CSV
        </KpiCard>
        <KpiCard
          icon={CheckCircle2}
          tone="green"
          label="VALIDES"
          value={validCount}
        >
          {totalRows > 0 ? `${validRate} % du fichier` : 'Aucune ligne'}
        </KpiCard>
        <KpiCard
          icon={AlertCircle}
          tone={invalidCount > 0 ? 'rose' : 'slate'}
          label="INVALIDES"
          value={invalidCount}
        >
          {invalidCount > 0
            ? `${errorFacets.length} champ${errorFacets.length > 1 ? 's' : ''} en erreur`
            : 'Aucune erreur détectée'}
        </KpiCard>
        <KpiCard
          icon={Sparkles}
          tone={batch.status === 'applied' ? 'violet' : 'slate'}
          label="APPLIQUÉES"
          value={appliedCount}
        >
          {batch.status === 'applied'
            ? `${appliedRate} % du fichier${skippedCount > 0 ? ` · ${skippedCount} ignorée${skippedCount > 1 ? 's' : ''}` : ''}`
            : batch.status === 'validated'
              ? 'En attente de confirmation'
              : batch.status === 'queued'
                ? 'En file d’attente…'
                : batch.status === 'applying'
                  ? 'Application en cours…'
                  : '—'}
        </KpiCard>
      </div>

      {totalRows > 0 && (
        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <span>Répartition des lignes</span>
            <span className="text-slate-400">
              {validCount + invalidCount} ligne{validCount + invalidCount > 1 ? 's' : ''} analysée
              {validCount + invalidCount > 1 ? 's' : ''}
            </span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>Valides</span>
                <span className="font-mono font-bold tabular-nums text-emerald-700">
                  {validCount} ({validRate}%)
                </span>
              </div>
              <ProgressBar value={validRate} tone="success" height={6} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>{batch.status === 'applied' ? 'Appliquées' : 'À appliquer'}</span>
                <span className="font-mono font-bold tabular-nums text-violet-700">
                  {appliedCount} ({appliedRate}%)
                </span>
              </div>
              <ProgressBar value={appliedRate} color="oklch(0.55 0.22 295)" height={6} />
            </div>
          </div>
        </section>
      )}

      {(batch.status === 'queued' || batch.status === 'applying') && (
        <LiveProgressStrip
          status={batch.status}
          summary={summary}
          totalRows={totalRows}
          validCount={validCount}
        />
      )}

      <ImportStatusPoller status={batch.status} />

      <div className="mt-6 grid gap-5 lg:grid-cols-5">
        <section className="lg:col-span-3 space-y-5">
          {batch.errorMessage && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
              <div className="flex items-start gap-2">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <div className="font-bold">Échec d&apos;application</div>
                  <div className="mt-1 text-xs">{batch.errorMessage}</div>
                </div>
              </div>
            </div>
          )}

          {batch.status === 'validated' && invalidCount > 0 && (
            <ActionStrip
              tone="amber"
              icon={AlertTriangle}
              title={`${invalidCount} ligne${invalidCount > 1 ? 's' : ''} à examiner`}
              body="Inspectez les lignes invalides avant d'appliquer l'import, ou passez en mode skip-invalid."
              actionLabel="Filtrer les invalides"
              actionHref="?status=invalid"
            />
          )}

          {batch.status === 'validated' && (
            <ApplyControls batchId={batch.id} invalidCount={invalidCount} />
          )}

          {batch.status === 'applied' && (
            <RollbackBlock batchId={batch.id} appliedAt={batch.appliedAt!} />
          )}

          {invalidCount > 0 && errorFacets.length > 0 && (
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
              <SectionHeader
                title="Erreurs par champ"
                subtitle="Cliquez sur un champ pour ne voir que les lignes concernées"
              />
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {errorFacets.slice(0, 8).map((f) => (
                  <li key={f.key}>
                    <Link
                      href={`?status=invalid&errorField=${encodeURIComponent(f.key)}`}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-rose-100 bg-rose-50/50 px-3 py-2 transition hover:border-rose-300 hover:bg-rose-50"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-bold text-rose-900">{f.label}</div>
                        <div className="text-[11px] text-rose-700">
                          {f.rowCount} ligne{f.rowCount > 1 ? 's' : ''} en erreur
                        </div>
                      </div>
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 group-hover:bg-rose-200">
                        {f.rowCount}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>

        <aside className="lg:col-span-2">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
            <SectionHeader title="Cycle de vie" subtitle="Étapes du traitement de cet import" />
            <div className="mt-4">
              <Timeline entries={timeline} />
            </div>
            {batch.mode && (
              <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                <span className="font-bold uppercase tracking-wider text-slate-500">Mode :</span>{' '}
                {batch.mode === 'all_or_nothing' ? 'All-or-nothing' : 'Skip-invalid'}
              </div>
            )}
            {Array.isArray(summary.missingHeaders) && summary.missingHeaders.length > 0 && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                <div className="font-bold">En-têtes manquants</div>
                <div className="mt-0.5 font-mono">{summary.missingHeaders.join(', ')}</div>
              </div>
            )}
          </div>
        </aside>
      </div>

      <section className="mt-6 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
              Lignes du fichier
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {hasActiveFilters
                ? `${total.toLocaleString('fr-FR')} ligne${total > 1 ? 's' : ''} après filtres`
                : `${allRows.length.toLocaleString('fr-FR')} ligne${allRows.length > 1 ? 's' : ''} au total`}
            </p>
          </div>
          {hasActiveFilters && <ActiveFiltersChips status={status} errorField={errorField} q={q} />}
        </div>

        <div className="border-b border-slate-100 px-5 py-3">
          <RowsFilters
            status={status}
            errorField={errorField}
            q={q}
            errorFields={errorFacets}
          />
        </div>

        {pageRows.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={ListChecks}
              title={hasActiveFilters ? 'Aucune ligne ne correspond à ces filtres' : 'Aucune ligne'}
              description={
                hasActiveFilters
                  ? 'Essayez d’élargir les filtres ou de réinitialiser la recherche.'
                  : "Ce batch n'a aucune ligne enregistrée."
              }
              tone="slate"
            />
          </div>
        ) : (
          <>
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Ligne</th>
                    <th className="px-4 py-3 text-left font-semibold">Statut</th>
                    <th className="px-4 py-3 text-left font-semibold">Données</th>
                    <th className="px-4 py-3 text-left font-semibold">Erreurs / Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((r) => (
                    <RowItem key={r.id} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
            {total > PAGE_SIZE && (
              <div className="border-t border-slate-100 px-5 py-3">
                <Pagination
                  page={safePage}
                  total={total}
                  pageSize={PAGE_SIZE}
                  itemLabel={{ singular: 'ligne', plural: 'lignes' }}
                />
              </div>
            )}
          </>
        )}
      </section>
    </PortalShell>
  );
}

function ActionStrip({
  tone,
  icon: Icon,
  title,
  body,
  actionLabel,
  actionHref,
}: {
  tone: 'amber' | 'rose' | 'blue';
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
}) {
  const toneClass =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : tone === 'rose'
        ? 'border-rose-200 bg-rose-50 text-rose-900'
        : 'border-blue-200 bg-blue-50 text-blue-900';
  const btnClass =
    tone === 'amber'
      ? 'bg-amber-600 hover:bg-amber-700'
      : tone === 'rose'
        ? 'bg-rose-600 hover:bg-rose-700'
        : 'bg-blue-600 hover:bg-blue-700';
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 rounded-2xl border p-4 ${toneClass}`}>
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <div className="text-sm font-bold">{title}</div>
          <div className="mt-0.5 text-xs">{body}</div>
        </div>
      </div>
      <Link
        href={actionHref}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white shadow-sm transition ${btnClass}`}
      >
        {actionLabel}
      </Link>
    </div>
  );
}

function ActiveFiltersChips({
  status,
  errorField,
  q,
}: {
  status: RowStatusFilter;
  errorField: string;
  q: string;
}) {
  const chips: Array<{ key: string; label: string }> = [];
  if (status) chips.push({ key: 'status', label: `Statut : ${ROW_STATUS_LABEL[status as RowStatus]}` });
  if (errorField)
    chips.push({
      key: 'errorField',
      label: `Champ : ${errorField === '__unknown__' ? '(sans champ)' : errorField}`,
    });
  if (q) chips.push({ key: 'q', label: `Recherche : "${q}"` });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-200"
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

function RowItem({ row }: { row: BatchRow }) {
  const pairs = summarisePayload(row.payload ?? {});
  const totalKeys = Object.keys(row.payload ?? {}).filter((k) => !k.startsWith('_')).length;
  const errored = row.status === 'invalid';
  return (
    <tr className={errored ? 'bg-rose-50/40' : undefined}>
      <td className="px-4 py-3 align-top">
        <span className="inline-flex h-6 min-w-[2rem] items-center justify-center rounded-md bg-slate-100 px-1.5 font-mono text-[11px] font-bold text-slate-700">
          {row.rowIndex}
        </span>
      </td>
      <td className="px-4 py-3 align-top">
        <StatusBadge
          size="sm"
          tone={ROW_STATUS_TONE[row.status]}
          label={ROW_STATUS_LABEL[row.status]}
        />
        {row.createdEntityId && (
          <div className="mt-1 font-mono text-[10px] text-slate-400">
            #{row.createdEntityId.slice(0, 8)}
          </div>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        {pairs.length === 0 ? (
          <span className="text-[11px] italic text-slate-400">(payload vide)</span>
        ) : (
          <dl className="grid gap-x-3 gap-y-1 text-[11px] sm:grid-cols-[auto_1fr]">
            {pairs.map(({ k, v }) => (
              <div key={k} className="contents">
                <dt className="font-mono font-bold text-slate-500">{k}</dt>
                <dd className="truncate font-mono text-slate-700" title={v}>
                  {v}
                </dd>
              </div>
            ))}
            {totalKeys > pairs.length && (
              <div className="col-span-full text-[10px] italic text-slate-400">
                +{totalKeys - pairs.length} autre{totalKeys - pairs.length > 1 ? 's' : ''} champ
                {totalKeys - pairs.length > 1 ? 's' : ''}
              </div>
            )}
          </dl>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        {errored && row.errors && row.errors.length > 0 ? (
          <ul className="space-y-1.5 text-xs">
            {row.errors.map((e: RowError, idx: number) => (
              <li key={idx} className="flex items-start gap-1.5">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-600" />
                <div className="min-w-0">
                  {e.field && (
                    <span className="rounded-md bg-rose-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-800">
                      {e.field}
                    </span>
                  )}
                  <span className={`text-rose-700 ${e.field ? 'ml-1.5' : ''}`}>{e.message}</span>
                  {e.hint && <div className="mt-0.5 text-[10px] italic text-rose-600">{e.hint}</div>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-[11px] text-slate-400">—</span>
        )}
      </td>
    </tr>
  );
}

function LiveProgressStrip({
  status,
  summary,
  totalRows,
  validCount,
}: {
  status: 'queued' | 'applying';
  summary: BatchSummary;
  totalRows: number;
  validCount: number;
}) {
  const isQueued = status === 'queued';
  const applied = summary.applied ?? 0;
  const skipped = summary.skipped ?? 0;
  const processed = summary.processedRows ?? applied + skipped;
  const totalToApply = summary.totalToApply ?? validCount ?? totalRows ?? 0;
  const pct = totalToApply > 0 ? Math.min(100, Math.round((processed / totalToApply) * 100)) : 0;

  // Phase-only accessible name → the polite region announces the milestone, not
  // every poll tick (the numeric caption below is aria-hidden).
  const phaseLabel = isQueued ? 'En file d’attente' : 'Application en cours';

  return (
    <section
      role="status"
      aria-live="polite"
      aria-label={phaseLabel}
      className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isQueued ? (
            <Hourglass aria-hidden className="h-4 w-4 text-slate-500" />
          ) : (
            <Loader2
              aria-hidden
              className="h-4 w-4 animate-spin text-sky-600 motion-reduce:animate-none"
            />
          )}
          <StatusBadge
            tone={isQueued ? 'neutral' : 'info'}
            label={isQueued ? 'En file d’attente' : 'Application en cours…'}
            withDot
          />
        </div>
        {!isQueued && totalToApply > 0 && (
          <span
            aria-hidden
            className="font-mono text-xs font-semibold tabular-nums text-slate-600"
          >
            {processed.toLocaleString('fr-FR')} / {totalToApply.toLocaleString('fr-FR')} lignes
            appliquées…
          </span>
        )}
      </div>

      <div className="mt-3">
        {isQueued ? (
          // Indeterminate / skeleton track — not 0 %, which reads as "stuck".
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-slate-300 motion-reduce:animate-none" />
          </div>
        ) : (
          <ProgressBar value={pct} tone="info" height={8} ariaLabel="Avancement de l'application" />
        )}
      </div>

      <p className="mt-2 text-xs text-slate-600">
        {isQueued
          ? "En file d'attente — l'application va démarrer dans un instant."
          : 'Vous pouvez quitter cette page, le traitement continue.'}
      </p>
    </section>
  );
}

function RollbackBlock({ batchId, appliedAt }: { batchId: string; appliedAt: string }) {
  const expiresAt = new Date(new Date(appliedAt).getTime() + ROLLBACK_WINDOW_HOURS * 3_600_000);
  const expired = Date.now() > expiresAt.getTime();
  const hoursLeft = Math.max(
    0,
    Math.round((expiresAt.getTime() - Date.now()) / 3_600_000),
  );
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <RotateCcw className="mt-0.5 h-5 w-5 text-amber-700" />
          <div>
            <div className="text-sm font-bold text-amber-900">
              {expired ? 'Fenêtre de rollback dépassée' : 'Annulation possible'}
            </div>
            <p className="mt-1 text-xs text-amber-800">
              {expired ? (
                <>
                  L&apos;import a plus de {ROLLBACK_WINDOW_HOURS} h — le rollback n&apos;est plus
                  disponible. Pour corriger, créez un nouvel import.
                </>
              ) : (
                <>
                  Vous pouvez annuler cet import jusqu&apos;à{' '}
                  <strong>{fmtDateTime(expiresAt.toISOString())}</strong>{' '}
                  <span className="text-amber-700">({hoursLeft} h restantes)</span>. Toutes les
                  entités créées seront supprimées.
                </>
              )}
            </p>
          </div>
        </div>
        {!expired ? (
          <RollbackButtonClient batchId={batchId} />
        ) : (
          <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-600">
            Fenêtre dépassée
          </span>
        )}
      </div>
    </div>
  );
}
