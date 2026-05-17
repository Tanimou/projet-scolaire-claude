import { ArrowUpFromLine, CheckCircle2, Clock, FileText, FileUp, Upload, XCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';
import { KpiCard, PageHeader } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Imports en lot' };
export const dynamic = 'force-dynamic';

interface BatchListItem {
  id: string;
  type: 'students' | 'classes' | 'subjects' | string;
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
  summary: Record<string, unknown>;
  startedAt: string;
  appliedAt: string | null;
  rolledBackAt: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  students: 'Élèves',
  classes: 'Classes',
  subjects: 'Matières',
  teachers: 'Professeurs',
  parents: 'Parents',
  grades: 'Notes',
  attendance: 'Présences',
};

const STATUS_STYLE: Record<
  BatchListItem['status'],
  { label: string; class: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  uploaded: { label: 'Uploadé', class: 'bg-slate-100 text-slate-700', Icon: Clock },
  validating: { label: 'Validation…', class: 'bg-blue-50 text-blue-700', Icon: Clock },
  validated: { label: 'Validé · à confirmer', class: 'bg-amber-100 text-amber-800', Icon: FileText },
  applying: { label: 'Application…', class: 'bg-blue-50 text-blue-700', Icon: Clock },
  applied: { label: 'Appliqué', class: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle2 },
  failed: { label: 'Échec', class: 'bg-red-100 text-red-700', Icon: XCircle },
  rolled_back: { label: 'Annulé', class: 'bg-slate-100 text-slate-700', Icon: XCircle },
};

export default async function ImportsListPage() {
  const { data } = await api<{ data: BatchListItem[] }>('/api/v1/imports', { cache: 'no-store' });

  const succeeded = data.filter((b) => b.status === 'applied').length;
  const failed = data.filter((b) => b.status === 'failed').length;
  const totalRowsImported = data
    .filter((b) => b.status === 'applied')
    .reduce((sum, b) => {
      const s = b.summary as { applied?: number; total?: number } | null;
      return sum + (s?.applied ?? s?.total ?? 0);
    }, 0);
  const lastImport = data[0];

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
        <KpiCard icon={CheckCircle2} tone="green" label="IMPORTS RÉUSSIS" value={succeeded}>
          Lots appliqués
        </KpiCard>
        <KpiCard icon={XCircle} tone="rose" label="ERREURS" value={failed}>
          Lots en échec
        </KpiCard>
        <KpiCard icon={FileUp} tone="blue" label="LIGNES IMPORTÉES" value={totalRowsImported}>
          Toutes années confondues
        </KpiCard>
        <KpiCard
          icon={Clock}
          tone="violet"
          label="DERNIER IMPORT"
          value={
            lastImport
              ? new Date(lastImport.startedAt).toLocaleDateString('fr-FR', {
                  day: '2-digit',
                  month: 'short',
                })
              : '—'
          }
        >
          {lastImport ? TYPE_LABEL[lastImport.type] ?? lastImport.type : 'Aucun import enregistré'}
        </KpiCard>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Historique ({data.length})
          </h3>
        </div>
        {data.length === 0 ? (
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
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-6 py-3 text-left font-semibold">Type</th>
                <th className="px-6 py-3 text-left font-semibold">Fichier</th>
                <th className="px-6 py-3 text-left font-semibold">Stats</th>
                <th className="px-6 py-3 text-left font-semibold">Statut</th>
                <th className="px-6 py-3 text-left font-semibold">Date</th>
                <th className="px-6 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((b) => {
                const style = STATUS_STYLE[b.status];
                const summary = b.summary as { totalRows?: number; validCount?: number; invalidCount?: number; applied?: number };
                return (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3.5">
                      <span className="font-bold text-slate-900">{TYPE_LABEL[b.type] ?? b.type}</span>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="font-mono text-xs text-slate-600">{b.fileName}</span>
                    </td>
                    <td className="px-6 py-3.5 text-xs text-slate-600">
                      {summary.totalRows ? (
                        <>
                          <span className="font-mono">{summary.totalRows}</span> lignes
                          {typeof summary.validCount === 'number' && (
                            <span className="ml-2 text-emerald-700">
                              {summary.validCount} ok
                            </span>
                          )}
                          {typeof summary.invalidCount === 'number' && summary.invalidCount > 0 && (
                            <span className="ml-2 text-red-700">
                              {summary.invalidCount} erreur(s)
                            </span>
                          )}
                          {typeof summary.applied === 'number' && (
                            <span className="ml-2 font-bold text-slate-900">
                              {summary.applied} appliqués
                            </span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style.class}`}
                      >
                        <style.Icon className="h-3 w-3" />
                        {style.label}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-xs text-slate-600">
                      {new Date(b.startedAt).toLocaleString('fr-FR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <Link
                        href={`/admin/imports/${b.id}`}
                        className="text-xs font-bold text-blue-700 hover:underline"
                      >
                        Détail →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </PortalShell>
  );
}
