import {
  AlertTriangle,
  Bell,
  Download,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  History,
  RefreshCw,
  Users,
  XCircle,
} from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  StatusBadge,
  formatDateLong,
  formatRelativeTime,
} from '@pilotage/ui';

import { ExportDownloadButton } from './ExportDownloadButton';
import { ExportLauncher } from './ExportLauncher';
import { ExportsFilters } from './ExportsFilters';
import { ExportsRefresher } from './ExportsRefresher';
import type {
  ExportKind,
  ExportKindFilter,
  ExportPeriod,
  ExportRow,
  ExportStatus,
  ExportStatusFilter,
  ExportsListResp,
  RequesterOption,
} from './types';

export const metadata: Metadata = { title: 'Exports' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 20;
/**
 * Backend caps at 100; we fetch the latest slice unfiltered so KPIs stay stable
 * across filter changes and filter dropdowns can be derived from real data.
 */
const FETCH_LIMIT = 100;

const STATUS_LABEL: Record<ExportStatus, string> = {
  pending: 'En file',
  running: 'En cours',
  succeeded: 'Prêt',
  failed: 'Échec',
};

const STATUS_TONE: Record<ExportStatus, 'neutral' | 'sky' | 'success' | 'danger'> = {
  pending: 'neutral',
  running: 'sky',
  succeeded: 'success',
  failed: 'danger',
};

const KIND_LABEL: Record<ExportKind, string> = {
  grades_xlsx: 'Notes',
  attendance_xlsx: 'Présences',
  enrollment_xlsx: 'Inscriptions',
  audit_csv: 'Audit',
  report_card_pdf: 'Bulletins',
};

const KIND_ICON: Record<ExportKind, typeof FileSpreadsheet> = {
  grades_xlsx: FileSpreadsheet,
  attendance_xlsx: GraduationCap,
  enrollment_xlsx: Users,
  audit_csv: History,
  report_card_pdf: FileText,
};

const KIND_TONE: Record<ExportKind, string> = {
  grades_xlsx: 'bg-emerald-50 text-emerald-600',
  attendance_xlsx: 'bg-amber-50 text-amber-600',
  enrollment_xlsx: 'bg-blue-50 text-blue-600',
  audit_csv: 'bg-violet-50 text-violet-600',
  report_card_pdf: 'bg-rose-50 text-rose-600',
};

const KIND_EXT: Record<ExportKind, 'xlsx' | 'pdf' | 'csv'> = {
  grades_xlsx: 'xlsx',
  attendance_xlsx: 'xlsx',
  enrollment_xlsx: 'xlsx',
  audit_csv: 'csv',
  report_card_pdf: 'pdf',
};

const VALID_PERIODS: ExportPeriod[] = ['all', '24h', '7d', '30d', '90d'];
const VALID_KIND_FILTERS: ExportKindFilter[] = [
  '',
  'grades_xlsx',
  'attendance_xlsx',
  'enrollment_xlsx',
  'report_card_pdf',
  'audit_csv',
  'xlsx',
  'pdf',
  'csv',
];
const VALID_STATUS_FILTERS: ExportStatusFilter[] = [
  '',
  'pending',
  'running',
  'succeeded',
  'failed',
  'inflight',
  'completed',
];

function formatBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysAgo(n: number, now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n: number, now: Date): Date {
  const d = new Date(now);
  d.setHours(d.getHours() - n);
  return d;
}

function isInPeriod(iso: string, period: ExportPeriod, now: Date): boolean {
  if (period === 'all') return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (period === '24h') return t >= hoursAgo(24, now).getTime();
  if (period === '7d') return t >= daysAgo(7, now).getTime();
  if (period === '30d') return t >= daysAgo(30, now).getTime();
  if (period === '90d') return t >= daysAgo(90, now).getTime();
  return true;
}

function matchesKind(row: ExportRow, kind: ExportKindFilter): boolean {
  if (!kind) return true;
  if (kind === 'xlsx' || kind === 'pdf' || kind === 'csv') {
    return KIND_EXT[row.kind] === kind;
  }
  return row.kind === kind;
}

function matchesStatus(row: ExportRow, status: ExportStatusFilter): boolean {
  if (!status) return true;
  if (status === 'inflight') {
    return row.status === 'pending' || row.status === 'running';
  }
  if (status === 'completed') {
    return row.status === 'succeeded' || row.status === 'failed';
  }
  return row.status === status;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function dayLabel(date: Date, now: Date): string {
  const today = startOfDay(now).getTime();
  const target = startOfDay(date).getTime();
  if (target === today) return "Aujourd'hui";
  if (target === today - 86_400_000) return 'Hier';
  return formatDateLong(date);
}

function monthLabel(date: Date): string {
  const raw = date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

interface Group {
  key: string;
  label: string;
  hint: string;
  rows: ExportRow[];
  failed: number;
  inflight: number;
}

function groupForRow(row: ExportRow, now: Date): {
  key: string;
  label: string;
  hint: 'day' | 'month';
} {
  const d = new Date(row.createdAt);
  const sevenAgo = daysAgo(7, now).getTime();
  if (d.getTime() >= sevenAgo) {
    return { key: `d-${dayKey(d)}`, label: dayLabel(d, now), hint: 'day' };
  }
  return { key: `m-${monthKey(d)}`, label: monthLabel(d), hint: 'month' };
}

export default async function ExportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    period?: string;
    kind?: string;
    status?: string;
    requesterId?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const period: ExportPeriod = VALID_PERIODS.includes(sp.period as ExportPeriod)
    ? (sp.period as ExportPeriod)
    : 'all';
  const kindFilter: ExportKindFilter = VALID_KIND_FILTERS.includes(sp.kind as ExportKindFilter)
    ? (sp.kind as ExportKindFilter)
    : '';
  const statusFilter: ExportStatusFilter = VALID_STATUS_FILTERS.includes(
    sp.status as ExportStatusFilter,
  )
    ? (sp.status as ExportStatusFilter)
    : '';
  const requesterId = (sp.requesterId ?? '').trim();
  const search = (sp.q ?? '').trim().toLowerCase();

  const resp = await safe(
    api<ExportsListResp>(`/api/v1/exports?limit=${FETCH_LIMIT}&offset=0`, {
      cache: 'no-store',
    }),
  );
  const allRows: ExportRow[] = resp?.data ?? [];
  const totalServer = resp?.total ?? 0;
  const now = new Date();

  // KPIs computed on the UNFILTERED fetched dataset (up to 100 most recent).
  const bulletinsPdf = allRows.filter((e) => e.kind === 'report_card_pdf').length;
  const xlsxOnly = allRows.filter((e) => KIND_EXT[e.kind] === 'xlsx').length;
  const inflight = allRows.filter(
    (e) => e.status === 'pending' || e.status === 'running',
  ).length;
  const failedRecent = allRows.filter((e) => e.status === 'failed').length;
  const failedLast24h = allRows.filter(
    (e) => e.status === 'failed' && isInPeriod(e.createdAt, '24h', now),
  ).length;

  // Derive requester options from real data so the dropdown matches what's visible.
  const requesterMap = new Map<string, RequesterOption>();
  for (const r of allRows) {
    if (r.requesterId && !requesterMap.has(r.requesterId)) {
      requesterMap.set(r.requesterId, { id: r.requesterId, name: r.requesterName ?? '—' });
    }
  }
  const requesters = Array.from(requesterMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'fr'),
  );
  const activeRequesterId = requesterId && requesterMap.has(requesterId) ? requesterId : '';

  // Apply filters: period → kind → status → requester → search.
  const filtered = allRows
    .filter((r) => isInPeriod(r.createdAt, period, now))
    .filter((r) => matchesKind(r, kindFilter))
    .filter((r) => matchesStatus(r, statusFilter))
    .filter((r) => (activeRequesterId ? r.requesterId === activeRequesterId : true))
    .filter((r) => {
      if (!search) return true;
      const hay = [
        r.fileName,
        r.requesterName ?? '',
        KIND_LABEL[r.kind],
        r.errorMessage ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(search);
    });

  const totalFiltered = filtered.length;

  // Group filtered rows (date-desc from API already).
  const groups: Group[] = [];
  for (const r of filtered) {
    const g = groupForRow(r, now);
    let bucket = groups[groups.length - 1];
    if (!bucket || bucket.key !== g.key) {
      bucket = { key: g.key, label: g.label, hint: g.hint, rows: [], failed: 0, inflight: 0 };
      groups.push(bucket);
    }
    bucket.rows.push(r);
    if (r.status === 'failed') bucket.failed += 1;
    if (r.status === 'pending' || r.status === 'running') bucket.inflight += 1;
  }

  // Slice across groups so pagination still works with section headers.
  const startIdx = (page - 1) * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;
  let seen = 0;
  const pageGroups: Group[] = [];
  for (const g of groups) {
    if (seen >= endIdx) break;
    const rows: ExportRow[] = [];
    for (const r of g.rows) {
      if (seen >= startIdx && seen < endIdx) rows.push(r);
      seen++;
    }
    if (rows.length > 0) {
      pageGroups.push({ ...g, rows });
    }
  }

  // Active filter chips summary (under the list).
  const activeFilterChips: string[] = [];
  if (period !== 'all') {
    const periodLabels: Record<Exclude<ExportPeriod, 'all'>, string> = {
      '24h': '24 dernières heures',
      '7d': '7 derniers jours',
      '30d': '30 derniers jours',
      '90d': '90 derniers jours',
    };
    activeFilterChips.push(periodLabels[period]);
  }
  if (kindFilter) {
    const labels: Record<Exclude<ExportKindFilter, ''>, string> = {
      grades_xlsx: 'Notes (Excel)',
      attendance_xlsx: 'Présences (Excel)',
      enrollment_xlsx: 'Inscriptions (Excel)',
      report_card_pdf: 'Bulletins (PDF)',
      audit_csv: 'Audit (CSV)',
      xlsx: 'Tous les Excel',
      pdf: 'Tous les PDF',
      csv: 'Tous les CSV',
    };
    activeFilterChips.push(`Type : ${labels[kindFilter]}`);
  }
  if (statusFilter) {
    const labels: Record<Exclude<ExportStatusFilter, ''>, string> = {
      pending: 'En file',
      running: 'En cours',
      succeeded: 'Prêts',
      failed: 'En échec',
      inflight: 'En file ou en cours',
      completed: 'Terminés',
    };
    activeFilterChips.push(`Statut : ${labels[statusFilter]}`);
  }
  if (activeRequesterId && requesterMap.has(activeRequesterId)) {
    activeFilterChips.push(`Demandeur : ${requesterMap.get(activeRequesterId)!.name}`);
  }
  if (search) activeFilterChips.push(`Recherche : « ${search} »`);

  const filtersActive = activeFilterChips.length > 0;
  const fetchSummary =
    totalServer > FETCH_LIMIT
      ? `${FETCH_LIMIT} derniers exports affichés (${totalServer} au total)`
      : `${totalServer} export${totalServer > 1 ? 's' : ''} au total`;

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Exports' },
        ]}
        title="Exports & Rapports"
        subtitle="Génération asynchrone via BullMQ — fichiers stockés dans MinIO, téléchargement par URL signée 1 h."
      />

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Download} tone="blue" label="EXPORTS GÉNÉRÉS" value={totalServer}>
          Tous statuts confondus
        </KpiCard>
        <KpiCard icon={FileText} tone="rose" label="BULLETINS PDF" value={bulletinsPdf}>
          Sur les {Math.min(allRows.length, FETCH_LIMIT)} récents
        </KpiCard>
        <KpiCard icon={FileSpreadsheet} tone="green" label="EXPORTS EXCEL" value={xlsxOnly}>
          Notes · Présences · Inscriptions
        </KpiCard>
        <KpiCard
          icon={inflight > 0 ? RefreshCw : Bell}
          tone={inflight > 0 ? 'orange' : 'slate'}
          label="EN COURS"
          value={inflight}
        >
          {inflight > 0 ? 'Actualisation auto · 3 s' : 'File BullMQ vide'}
        </KpiCard>
      </div>

      {/* Failed-export alert strip */}
      {failedRecent > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm text-rose-900">
            <p className="font-bold">
              {failedRecent} export{failedRecent > 1 ? 's' : ''} en échec sur les{' '}
              {Math.min(allRows.length, FETCH_LIMIT)} derniers
              {failedLast24h > 0 ? ` · ${failedLast24h} dans les 24 h` : ''}
            </p>
            <p className="mt-0.5 text-xs text-rose-800/80">
              Filtrez ci-dessous par « En échec » pour consulter les messages d&apos;erreur et
              relancer le job depuis la file.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6">
        <ExportLauncher />
      </div>

      {/* Filter strip */}
      <div className="mt-6">
        <ExportsFilters
          period={period}
          status={statusFilter}
          kind={kindFilter}
          requesterId={activeRequesterId}
          q={search}
          requesters={requesters}
        />
      </div>

      {/* Grouped exports list */}
      <section className="mt-4 space-y-4">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            {filtersActive
              ? `Exports filtrés (${totalFiltered})`
              : `Exports récents (${allRows.length})`}
          </h3>
          <p className="text-[11px] text-slate-500">{fetchSummary}</p>
        </header>

        {pageGroups.length === 0 ? (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
            <EmptyState
              icon={Download}
              title={
                allRows.length === 0
                  ? 'Aucun export généré'
                  : 'Aucun export avec ces filtres'
              }
              description={
                allRows.length === 0
                  ? 'Lancez un export depuis les boutons ci-dessus. Vous serez notifié(e) quand le fichier sera prêt.'
                  : 'Élargissez la période, changez le type, ou videz la recherche pour voir plus de résultats.'
              }
              tone="slate"
            />
          </div>
        ) : (
          pageGroups.map((g) => (
            <article
              key={g.key}
              className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60"
            >
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <h3 className="text-sm font-bold text-slate-700">{g.label}</h3>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span>
                    {g.rows.length} export{g.rows.length > 1 ? 's' : ''}
                  </span>
                  {g.inflight > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">
                      <RefreshCw className="h-3 w-3" />
                      {g.inflight} en cours
                    </span>
                  )}
                  {g.failed > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">
                      <XCircle className="h-3 w-3" />
                      {g.failed} échec{g.failed > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </header>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-white">
                    <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-3">Fichier</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3 text-right">Taille</th>
                      <th className="px-4 py-3">Demandé par</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Statut</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {g.rows.map((e) => {
                      const Icon = KIND_ICON[e.kind];
                      const isInflight =
                        e.status === 'pending' || e.status === 'running';
                      return (
                        <tr key={e.id} className="hover:bg-slate-50/60">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${KIND_TONE[e.kind]}`}
                              >
                                <Icon className="h-4 w-4" />
                              </span>
                              <div className="flex min-w-0 flex-col">
                                <span className="truncate text-sm font-bold text-slate-900">
                                  {e.fileName}
                                </span>
                                {e.status === 'failed' && e.errorMessage && (
                                  <span
                                    className="truncate text-[10px] text-rose-600"
                                    title={e.errorMessage}
                                  >
                                    {e.errorMessage}
                                  </span>
                                )}
                                {isInflight && (
                                  <span className="text-[10px] text-sky-600">
                                    {e.status === 'pending'
                                      ? 'En file BullMQ…'
                                      : 'Traitement en cours…'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                              {KIND_LABEL[e.kind]} · {KIND_EXT[e.kind]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-500">
                            {formatBytes(e.fileSizeBytes)}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {e.requesterName ?? '—'}
                          </td>
                          <td
                            className="px-4 py-3 text-xs text-slate-500"
                            title={new Date(e.createdAt).toLocaleString('fr-FR')}
                          >
                            {formatRelativeTime(e.createdAt, now)}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              label={STATUS_LABEL[e.status]}
                              tone={STATUS_TONE[e.status]}
                              size="sm"
                              withDot
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            {e.status === 'succeeded' ? (
                              <ExportDownloadButton id={e.id} />
                            ) : (
                              <span className="text-[11px] text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          ))
        )}

        {totalFiltered > PAGE_SIZE && (
          <Pagination
            page={page}
            total={totalFiltered}
            pageSize={PAGE_SIZE}
            itemLabel={{ singular: 'export', plural: 'exports' }}
          />
        )}

        {filtersActive && pageGroups.length > 0 && (
          <p className="text-[11px] text-slate-500">
            Filtres actifs :{' '}
            {activeFilterChips.map((chip, idx) => (
              <span key={chip}>
                <span className="font-bold text-slate-700">{chip}</span>
                {idx < activeFilterChips.length - 1 && (
                  <span className="text-slate-400"> · </span>
                )}
              </span>
            ))}
          </p>
        )}
      </section>

      {/* Refresh every 3 s when something is in-flight */}
      <ExportsRefresher hasInflight={inflight > 0} />
    </PortalShell>
  );
}
