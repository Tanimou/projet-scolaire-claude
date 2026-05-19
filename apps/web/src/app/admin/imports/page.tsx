import {
  AlertTriangle,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  FileText,
  FileUp,
  Hourglass,
  Loader2,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { EmptyState, KpiCard, PageHeader, formatInDays } from '@pilotage/ui';

import { ImportsFilters } from './ImportsFilters';
import type {
  BatchListItem,
  ImportMode,
  ImportStatus,
  ImportType,
  ModeFilter,
  PeriodFilter,
  StatusFilter,
  TypeFilter,
  TypeOption,
} from './types';



export const metadata: Metadata = { title: 'Imports en lot' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const TYPE_LABEL: Record<string, string> = {
  students: 'Élèves',
  classes: 'Classes',
  subjects: 'Matières',
  teachers: 'Professeurs',
  parents: 'Parents',
  enrollments: 'Inscriptions',
  grades: 'Notes',
  attendance: 'Présences',
};

const TYPE_TONE: Record<string, string> = {
  students: 'bg-blue-50 text-blue-700 ring-blue-200',
  classes: 'bg-teal-50 text-teal-700 ring-teal-200',
  subjects: 'bg-violet-50 text-violet-700 ring-violet-200',
  teachers: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  parents: 'bg-amber-50 text-amber-700 ring-amber-200',
  enrollments: 'bg-sky-50 text-sky-700 ring-sky-200',
  grades: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  attendance: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const STATUS_STYLE: Record<
  ImportStatus,
  { label: string; class: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  uploaded: { label: 'Uploadé', class: 'bg-slate-100 text-slate-700', Icon: Hourglass },
  validating: { label: 'Validation…', class: 'bg-blue-50 text-blue-700', Icon: Loader2 },
  validated: { label: 'Validé · à confirmer', class: 'bg-amber-100 text-amber-800', Icon: FileText },
  applying: { label: 'Application…', class: 'bg-blue-50 text-blue-700', Icon: Loader2 },
  applied: { label: 'Appliqué', class: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle2 },
  failed: { label: 'Échec', class: 'bg-rose-100 text-rose-700', Icon: XCircle },
  rolled_back: { label: 'Annulé', class: 'bg-slate-100 text-slate-600', Icon: XCircle },
};

const MODE_LABEL: Record<ImportMode, string> = {
  all_or_nothing: 'all-or-nothing',
  skip_invalid: 'skip-invalid',
};

const VALID_STATUS: ReadonlyArray<StatusFilter> = ['', 'inflight', 'pending', 'applied', 'failed'];
const VALID_PERIOD: ReadonlyArray<PeriodFilter> = ['', '24h', '7d', '30d', '90d'];
const VALID_MODE: ReadonlyArray<ModeFilter> = ['', 'all_or_nothing', 'skip_invalid'];

const PERIOD_LABEL: Record<Exclude<PeriodFilter, ''>, string> = {
  '24h': 'dernières 24 h',
  '7d': '7 derniers jours',
  '30d': '30 derniers jours',
  '90d': '90 derniers jours',
};

const STATUS_FILTER_LABEL: Record<Exclude<StatusFilter, ''>, string> = {
  inflight: 'En cours',
  pending: 'À confirmer',
  applied: 'Appliqués',
  failed: 'En échec',
};

const PERIOD_MS: Record<Exclude<PeriodFilter, ''>, number> = {
  '24h': 24 * 3_600_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
};

function inStatusBucket(status: ImportStatus, bucket: Exclude<StatusFilter, ''>): boolean {
  switch (bucket) {
    case 'inflight':
      return status === 'uploaded' || status === 'validating' || status === 'applying';
    case 'pending':
      return status === 'validated';
    case 'applied':
      return status === 'applied';
    case 'failed':
      return status === 'failed' || status === 'rolled_back';
  }
}

function appliedRows(b: BatchListItem): number {
  const s = b.summary as { applied?: number; total?: number; totalRows?: number };
  return s?.applied ?? s?.total ?? 0;
}

function bucketDayKey(d: Date, today: Date): string {
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (sameDay(d, today)) return 'today';
  if (sameDay(d, yesterday)) return 'yesterday';
  const diffDays = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  if (diffDays < 7) {
    return `d:${d.toISOString().slice(0, 10)}`;
  }
  return `m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function bucketLabel(key: string): string {
  if (key === 'today') return "Aujourd'hui";
  if (key === 'yesterday') return 'Hier';
  if (key.startsWith('d:')) {
    const d = new Date(`${key.slice(2)}T00:00:00`);
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  if (key.startsWith('m:')) {
    const [y, m] = key.slice(2).split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }
  return key;
}

export default async function ImportsListPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
    status?: string;
    period?: string;
    mode?: string;
  }>;
}) {
  const sp = await searchParams;

  const resp = await safe(
    api<{ data: BatchListItem[] }>('/api/v1/imports', { cache: 'no-store' }),
  );
  const all = resp?.data ?? [];

  // KPIs on the full (unfiltered) dataset, so they stay stable.
  const succeededAll = all.filter((b) => b.status === 'applied').length;
  const failedAll = all.filter((b) => b.status === 'failed' || b.status === 'rolled_back').length;
  const pendingAll = all.filter((b) => b.status === 'validated').length;
  const totalRowsImported = all
    .filter((b) => b.status === 'applied')
    .reduce((sum, b) => sum + appliedRows(b), 0);

  // Derive type facet from data (count over full dataset).
  const typeMap = new Map<string, number>();
  for (const b of all) {
    typeMap.set(b.type, (typeMap.get(b.type) ?? 0) + 1);
  }
  const typeOptions: TypeOption[] = Array.from(typeMap.entries())
    .filter(([t]) => t in TYPE_LABEL)
    .map(([t, count]) => ({
      value: t as ImportType,
      label: TYPE_LABEL[t] ?? t,
      count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

  // Validate filters against what we actually have.
  const typeFilter: TypeFilter =
    sp.type && typeMap.has(sp.type) ? (sp.type as ImportType) : '';
  const statusFilter: StatusFilter = VALID_STATUS.includes(sp.status as StatusFilter)
    ? (sp.status as StatusFilter)
    : '';
  const periodFilter: PeriodFilter = VALID_PERIOD.includes(sp.period as PeriodFilter)
    ? (sp.period as PeriodFilter)
    : '';
  const modeFilter: ModeFilter = VALID_MODE.includes(sp.mode as ModeFilter)
    ? (sp.mode as ModeFilter)
    : '';
  const search = (sp.q ?? '').trim().toLowerCase();

  const now = new Date();
  const periodCutoff =
    periodFilter && periodFilter in PERIOD_MS
      ? new Date(now.getTime() - PERIOD_MS[periodFilter as Exclude<PeriodFilter, ''>])
      : null;

  // Filter pipeline: period → type → status → mode → search.
  const filtered = all
    .filter((b) => (periodCutoff ? new Date(b.startedAt) >= periodCutoff : true))
    .filter((b) => (typeFilter ? b.type === typeFilter : true))
    .filter((b) =>
      statusFilter ? inStatusBucket(b.status, statusFilter as Exclude<StatusFilter, ''>) : true,
    )
    .filter((b) => (modeFilter ? b.mode === modeFilter : true))
    .filter((b) => (search ? b.fileName.toLowerCase().includes(search) : true));

  // Group by day buckets for the last 7 days, then monthly.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const groups = new Map<string, BatchListItem[]>();
  for (const b of filtered) {
    const d = new Date(b.startedAt);
    const key = bucketDayKey(d, today);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }
  // groups already arrive in desc order because `all` is sorted desc by createdAt.
  const groupEntries = Array.from(groups.entries());

  const activeFilterChips: string[] = [];
  if (search) activeFilterChips.push(`Recherche : « ${search} »`);
  if (typeFilter) activeFilterChips.push(`Type : ${TYPE_LABEL[typeFilter] ?? typeFilter}`);
  if (statusFilter)
    activeFilterChips.push(`Statut : ${STATUS_FILTER_LABEL[statusFilter as Exclude<StatusFilter, ''>]}`);
  if (periodFilter)
    activeFilterChips.push(`Période : ${PERIOD_LABEL[periodFilter as Exclude<PeriodFilter, ''>]}`);
  if (modeFilter) activeFilterChips.push(`Mode : ${MODE_LABEL[modeFilter as ImportMode]}`);

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Imports' },
        ]}
        title="Imports en lot"
        subtitle="Importez des centaines d'élèves, classes ou matières via CSV avec validation et rollback 24h"
        actions={
          <Link
            href="/admin/imports/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Upload className="h-4 w-4" /> Nouvel import
          </Link>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={CheckCircle2} tone="green" label="IMPORTS RÉUSSIS" value={succeededAll}>
          Lots appliqués
        </KpiCard>
        <KpiCard icon={Database} tone="blue" label="LIGNES IMPORTÉES" value={totalRowsImported}>
          Toutes années confondues
        </KpiCard>
        <KpiCard
          icon={FileText}
          tone="amber"
          label="À CONFIRMER"
          value={pendingAll}
        >
          {pendingAll === 0 ? 'Aucun lot en attente' : 'Validés · à appliquer'}
        </KpiCard>
        <KpiCard icon={XCircle} tone="rose" label="ERREURS" value={failedAll}>
          {failedAll === 0 ? 'Aucun lot en échec' : 'Failed + annulés'}
        </KpiCard>
      </div>

      {/* Action strips: pending + failed. */}
      <div className="mt-4 space-y-3">
        {pendingAll > 0 && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1 text-sm text-amber-900">
              <p className="font-bold">
                {pendingAll} lot{pendingAll > 1 ? 's' : ''} validé{pendingAll > 1 ? 's' : ''} en
                attente de confirmation
              </p>
              <p className="mt-0.5 text-xs text-amber-800/80">
                Examinez le résumé et choisissez le mode (all-or-nothing / skip-invalid) avant
                d&apos;appliquer.
              </p>
            </div>
            <Link
              href="/admin/imports?status=pending"
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-amber-700"
            >
              Examiner
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}

        {failedAll > 0 && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1 text-sm text-rose-900">
              <p className="font-bold">
                {failedAll} lot{failedAll > 1 ? 's' : ''} en échec ou annulé{failedAll > 1 ? 's' : ''}
              </p>
              <p className="mt-0.5 text-xs text-rose-800/80">
                Ouvrez le détail pour voir le message d&apos;erreur ou les lignes invalides puis
                relancez avec un fichier corrigé.
              </p>
            </div>
            <Link
              href="/admin/imports?status=failed"
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-rose-600 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-rose-700"
            >
              Investiguer
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>

      {all.length > 0 && (
        <div className="mt-6">
          <ImportsFilters
            q={sp.q ?? ''}
            type={typeFilter}
            status={statusFilter}
            period={periodFilter}
            mode={modeFilter}
            typeOptions={typeOptions}
          />
        </div>
      )}

      <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {all.length === 0 ? (
          <div className="p-12 text-center">
            <ArrowUpFromLine className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm text-slate-600">Aucun import pour le moment.</p>
            <Link
              href="/admin/imports/new"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-blue-700 hover:underline"
            >
              Lancer mon premier import →
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FileUp}
            title="Aucun import avec ces filtres"
            description="Élargissez la période, retirez un filtre ou videz la recherche pour voir plus de résultats."
            tone="slate"
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {groupEntries.map(([key, items]) => {
              const inflightInGroup = items.filter(
                (b) =>
                  b.status === 'uploaded' || b.status === 'validating' || b.status === 'applying',
              ).length;
              const pendingInGroup = items.filter((b) => b.status === 'validated').length;
              const failedInGroup = items.filter(
                (b) => b.status === 'failed' || b.status === 'rolled_back',
              ).length;
              return (
                <div key={key}>
                  <div className="flex flex-wrap items-center gap-3 bg-slate-50/70 px-6 py-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      {bucketLabel(key)}
                    </h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                      {items.length}
                    </span>
                    {pendingInGroup > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        {pendingInGroup} à confirmer
                      </span>
                    )}
                    {inflightInGroup > 0 && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">
                        {inflightInGroup} en cours
                      </span>
                    )}
                    {failedInGroup > 0 && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                        {failedInGroup} en échec
                      </span>
                    )}
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {items.map((b) => {
                      const style = STATUS_STYLE[b.status];
                      const summary = b.summary as {
                        totalRows?: number;
                        validCount?: number;
                        invalidCount?: number;
                        applied?: number;
                        skipped?: number;
                      } | null;
                      const isInflight =
                        b.status === 'uploaded' ||
                        b.status === 'validating' ||
                        b.status === 'applying';
                      return (
                        <li
                          key={b.id}
                          className="group grid grid-cols-1 gap-3 px-6 py-4 transition hover:bg-slate-50/60 md:grid-cols-[1.4fr,2fr,auto,auto,auto] md:items-center md:gap-6"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${
                                  TYPE_TONE[b.type] ?? 'bg-slate-50 text-slate-700 ring-slate-200'
                                }`}
                              >
                                {TYPE_LABEL[b.type] ?? b.type}
                              </span>
                              {b.mode && (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                  {MODE_LABEL[b.mode]}
                                </span>
                              )}
                            </div>
                            <p
                              className="mt-1 truncate font-mono text-xs text-slate-700"
                              title={b.fileName}
                            >
                              {b.fileName}
                            </p>
                          </div>

                          <div className="min-w-0 text-xs text-slate-600">
                            {summary?.totalRows ? (
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="rounded-md bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
                                  {summary.totalRows} lignes
                                </span>
                                {typeof summary.validCount === 'number' && (
                                  <span className="text-emerald-700">
                                    <CheckCircle2 className="mr-0.5 inline h-3 w-3" />
                                    {summary.validCount} ok
                                  </span>
                                )}
                                {typeof summary.invalidCount === 'number' &&
                                  summary.invalidCount > 0 && (
                                    <span className="text-rose-700">
                                      <XCircle className="mr-0.5 inline h-3 w-3" />
                                      {summary.invalidCount} erreur
                                      {summary.invalidCount > 1 ? 's' : ''}
                                    </span>
                                  )}
                                {typeof summary.applied === 'number' && summary.applied > 0 && (
                                  <span className="font-bold text-slate-900">
                                    {summary.applied} appliqué{summary.applied > 1 ? 's' : ''}
                                  </span>
                                )}
                                {typeof summary.skipped === 'number' && summary.skipped > 0 && (
                                  <span className="text-amber-700">
                                    {summary.skipped} sautée{summary.skipped > 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                            ) : isInflight ? (
                              <span className="italic text-slate-400">Calcul en cours…</span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </div>

                          <div>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style.class}`}
                            >
                              <style.Icon
                                className={`h-3 w-3 ${
                                  b.status === 'validating' || b.status === 'applying'
                                    ? 'animate-spin'
                                    : ''
                                }`}
                              />
                              {style.label}
                            </span>
                          </div>

                          <div className="text-xs text-slate-500" title={new Date(b.startedAt).toLocaleString('fr-FR')}>
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-3 w-3 text-slate-400" />
                              {new Date(b.startedAt).toLocaleTimeString('fr-FR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {formatInDays(b.startedAt)}
                            </div>
                          </div>

                          <Link
                            href={`/admin/imports/${b.id}`}
                            className="inline-flex h-8 shrink-0 items-center justify-end gap-1 text-xs font-bold text-blue-700 transition hover:text-blue-800 group-hover:underline"
                          >
                            Détail
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {activeFilterChips.length > 0 && (
        <p className="mt-4 text-[11px] text-slate-500">
          Filtres actifs :{' '}
          {activeFilterChips.map((chip, idx) => (
            <span key={chip}>
              <span className="font-bold text-slate-700">{chip}</span>
              {idx < activeFilterChips.length - 1 && <span className="text-slate-400"> · </span>}
            </span>
          ))}
        </p>
      )}
    </PortalShell>
  );
}
