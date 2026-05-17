import { AlertCircle, ArrowLeft, CheckCircle2, Clock, FileText, RotateCcw, XCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

import { ApplyControls, RollbackButtonClient } from './ApplyControls';

export const metadata: Metadata = { title: 'Détail import' };
export const dynamic = 'force-dynamic';

interface BatchDetail {
  id: string;
  type: string;
  fileName: string;
  status:
    | 'uploaded'
    | 'validating'
    | 'validated'
    | 'applying'
    | 'applied'
    | 'failed'
    | 'rolled_back';
  mode: 'all_or_nothing' | 'skip_invalid' | null;
  summary: {
    totalRows?: number;
    validCount?: number;
    invalidCount?: number;
    applied?: number;
    skipped?: number;
    missingHeaders?: string[];
  };
  startedAt: string;
  validatedAt: string | null;
  appliedAt: string | null;
  rolledBackAt: string | null;
  errorMessage: string | null;
  rows: BatchRow[];
}

interface BatchRow {
  id: string;
  rowIndex: number;
  status: 'pending' | 'valid' | 'invalid' | 'applied' | 'skipped' | 'rolled_back';
  payload: Record<string, unknown>;
  errors: Array<{ field?: string; message: string; hint?: string }> | null;
  createdEntityId: string | null;
}

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const batch = await api<BatchDetail>(`/api/v1/imports/${id}`, { cache: 'no-store' });

  return (
    <PortalShell portal="admin">
      <Link
        href="/admin/imports"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux imports
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">Import #{batch.id.slice(0, 8)}</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{batch.fileName}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Type : <strong>{batch.type}</strong> · démarré le{' '}
            {new Date(batch.startedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
          </p>
        </div>
        <StatusBadge status={batch.status} />
      </div>

      <SummaryCards batch={batch} />

      {batch.errorMessage && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="flex items-start gap-2">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-bold">Échec d&apos;application</div>
              <div className="mt-1 text-xs">{batch.errorMessage}</div>
            </div>
          </div>
        </div>
      )}

      {batch.status === 'validated' && (
        <div className="mt-6">
          <ApplyControls batchId={batch.id} invalidCount={batch.summary.invalidCount ?? 0} />
        </div>
      )}

      {batch.status === 'applied' && (
        <RollbackBlock batchId={batch.id} appliedAt={batch.appliedAt!} />
      )}

      <section className="mt-8 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Lignes ({batch.rows.length})
          </h3>
        </div>
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Ligne</th>
                <th className="px-4 py-3 text-left font-semibold">Statut</th>
                <th className="px-4 py-3 text-left font-semibold">Données</th>
                <th className="px-4 py-3 text-left font-semibold">Erreurs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batch.rows.map((r) => (
                <tr key={r.id} className={r.status === 'invalid' ? 'bg-red-50/40' : ''}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.rowIndex}</td>
                  <td className="px-4 py-3">
                    <RowStatus status={r.status} />
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-slate-700">{summariseRow(r.payload)}</code>
                  </td>
                  <td className="px-4 py-3">
                    {r.errors && r.errors.length > 0 && (
                      <ul className="space-y-1 text-xs">
                        {r.errors.map((e, idx) => (
                          <li key={idx} className="flex items-start gap-1.5">
                            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-600" />
                            <div>
                              {e.field && <span className="font-mono font-bold text-red-800">{e.field}: </span>}
                              <span className="text-red-700">{e.message}</span>
                              {e.hint && <div className="text-[10px] italic text-red-600">{e.hint}</div>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </PortalShell>
  );
}

function SummaryCards({ batch }: { batch: BatchDetail }) {
  const s = batch.summary;
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Total lignes" value={s.totalRows ?? 0} />
      <Stat label="Valides" value={s.validCount ?? 0} tone="success" />
      <Stat label="Invalides" value={s.invalidCount ?? 0} tone="danger" />
      <Stat
        label="Appliquées"
        value={s.applied ?? 0}
        tone={batch.status === 'applied' ? 'success' : 'neutral'}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'danger' | 'neutral' }) {
  const toneClass =
    tone === 'success' ? 'text-emerald-700' : tone === 'danger' ? 'text-red-700' : 'text-slate-900';
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: BatchDetail['status'] }) {
  const map: Record<BatchDetail['status'], { label: string; class: string; Icon: React.ComponentType<{ className?: string }> }> = {
    uploaded: { label: 'Uploadé', class: 'bg-slate-100 text-slate-700', Icon: Clock },
    validating: { label: 'Validation', class: 'bg-blue-50 text-blue-700', Icon: Clock },
    validated: { label: 'Validé · à confirmer', class: 'bg-amber-100 text-amber-800', Icon: FileText },
    applying: { label: 'Application', class: 'bg-blue-50 text-blue-700', Icon: Clock },
    applied: { label: 'Appliqué', class: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle2 },
    failed: { label: 'Échec', class: 'bg-red-100 text-red-700', Icon: XCircle },
    rolled_back: { label: 'Annulé', class: 'bg-slate-100 text-slate-700', Icon: RotateCcw },
  };
  const s = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${s.class}`}>
      <s.Icon className="h-3.5 w-3.5" />
      {s.label}
    </span>
  );
}

function RowStatus({ status }: { status: BatchRow['status'] }) {
  const map: Record<BatchRow['status'], { label: string; class: string }> = {
    pending: { label: 'pending', class: 'bg-slate-100 text-slate-700' },
    valid: { label: 'valide', class: 'bg-emerald-100 text-emerald-700' },
    invalid: { label: 'invalide', class: 'bg-red-100 text-red-700' },
    applied: { label: 'appliquée', class: 'bg-emerald-100 text-emerald-700' },
    skipped: { label: 'ignorée', class: 'bg-amber-100 text-amber-800' },
    rolled_back: { label: 'annulée', class: 'bg-slate-100 text-slate-700' },
  };
  const s = map[status];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${s.class}`}>{s.label}</span>;
}

function summariseRow(payload: Record<string, unknown>): string {
  const pairs = Object.entries(payload)
    .filter(([k, v]) => !k.startsWith('_') && v !== undefined && v !== '' && v !== null)
    .slice(0, 4)
    .map(([k, v]) => `${k}=${String(v)}`);
  return pairs.join(', ');
}

function RollbackBlock({ batchId, appliedAt }: { batchId: string; appliedAt: string }) {
  const expiresAt = new Date(new Date(appliedAt).getTime() + 24 * 3_600_000);
  const expired = Date.now() > expiresAt.getTime();
  return (
    <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <RotateCcw className="mt-0.5 h-5 w-5 text-amber-700" />
          <div>
            <div className="text-sm font-bold text-amber-900">Annulation possible</div>
            <p className="mt-1 text-xs text-amber-800">
              Vous pouvez annuler cet import jusqu&apos;à{' '}
              <strong>
                {expiresAt.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
              </strong>
              . Toutes les entités créées seront supprimées.
            </p>
          </div>
        </div>
        {!expired && (
          <form action={`/api/admin/imports/${batchId}/rollback`} method="POST" className="contents">
            <RollbackButton batchId={batchId} />
          </form>
        )}
        {expired && (
          <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-600">
            Fenêtre dépassée
          </span>
        )}
      </div>
    </div>
  );
}

// Stub here, real component is client-side
function RollbackButton({ batchId }: { batchId: string }) {
  return <RollbackButtonClient batchId={batchId} />;
}
