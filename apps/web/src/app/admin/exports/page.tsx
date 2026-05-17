import { Bell, Download, FileSpreadsheet, FileText, History } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  StatusBadge,
  formatDateShort,
} from '@pilotage/ui';

import { ExportDownloadButton } from './ExportDownloadButton';
import { ExportLauncher } from './ExportLauncher';
import { ExportsRefresher } from './ExportsRefresher';

export const metadata: Metadata = { title: 'Exports' };
export const dynamic = 'force-dynamic';

type ExportKind =
  | 'grades_xlsx'
  | 'attendance_xlsx'
  | 'enrollment_xlsx'
  | 'report_card_pdf'
  | 'audit_csv';

type ExportStatus = 'pending' | 'running' | 'succeeded' | 'failed';

interface ExportRow {
  id: string;
  kind: ExportKind;
  status: ExportStatus;
  fileName: string;
  fileUrl: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
  requesterName: string | null;
  parameters: Record<string, unknown>;
  createdAt: string;
  finishedAt: string | null;
}

interface ExportsListResp {
  data: ExportRow[];
  total: number;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 15;

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

const KIND_ICON: Record<ExportKind, typeof FileSpreadsheet> = {
  grades_xlsx: FileSpreadsheet,
  attendance_xlsx: FileSpreadsheet,
  enrollment_xlsx: FileSpreadsheet,
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

const KIND_EXT: Record<ExportKind, string> = {
  grades_xlsx: 'xlsx',
  attendance_xlsx: 'xlsx',
  enrollment_xlsx: 'xlsx',
  audit_csv: 'csv',
  report_card_pdf: 'pdf',
};

function formatBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function ExportsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const resp = await safe(
    api<ExportsListResp>(`/api/v1/exports?limit=${PAGE_SIZE}&offset=${offset}`, {
      cache: 'no-store',
    }),
  );
  const { data: rows, total } = resp ?? { data: [], total: 0 };

  // KPIs computed from the whole page payload — good enough until total volumes
  // justify a dedicated aggregate endpoint.
  const totalGenerated = total;
  const bulletinsPdf = rows.filter((e) => e.kind === 'report_card_pdf').length;
  const xlsxOnly = rows.filter((e) => KIND_EXT[e.kind] === 'xlsx').length;
  const inflight = rows.filter((e) => e.status === 'pending' || e.status === 'running').length;

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
        <KpiCard icon={Download} tone="blue" label="EXPORTS GÉNÉRÉS" value={totalGenerated}>
          Tous statuts confondus
        </KpiCard>
        <KpiCard icon={FileText} tone="rose" label="BULLETINS PDF" value={bulletinsPdf}>
          Bulletins trimestriels
        </KpiCard>
        <KpiCard icon={FileSpreadsheet} tone="green" label="EXPORTS EXCEL" value={xlsxOnly}>
          Notes / Présences / Inscriptions
        </KpiCard>
        <KpiCard icon={Bell} tone="orange" label="EN COURS" value={inflight}>
          File BullMQ active
        </KpiCard>
      </div>

      <div className="mt-6">
        <ExportLauncher />
      </div>

      {/* Recent exports table */}
      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Exports récents ({total})
          </h3>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={Download}
            title="Aucun export généré"
            description="Lancez un export depuis les boutons ci-dessus. Vous serez notifié(e) quand le fichier sera prêt."
            tone="slate"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
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
                  {rows.map((e) => {
                    const Icon = KIND_ICON[e.kind];
                    return (
                      <tr key={e.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${KIND_TONE[e.kind]}`}
                            >
                              <Icon className="h-4 w-4" />
                            </span>
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-slate-900">{e.fileName}</span>
                              {e.status === 'failed' && e.errorMessage && (
                                <span className="text-[10px] text-rose-600">
                                  {e.errorMessage}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs uppercase tracking-wider text-slate-600">
                          {KIND_EXT[e.kind]}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-500">
                          {formatBytes(e.fileSizeBytes)}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {e.requesterName ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {formatDateShort(e.createdAt)}
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
            <Pagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'export', plural: 'exports' }}
            />
          </>
        )}
      </section>

      {/* Refresh every 3 s when something is in-flight */}
      <ExportsRefresher hasInflight={inflight > 0} />
    </PortalShell>
  );
}
