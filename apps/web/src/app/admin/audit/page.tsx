import { Eye, FileSearch, History, ShieldCheck, UserCheck } from 'lucide-react';
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
} from '@pilotage/ui';

export const metadata: Metadata = { title: 'Audit' };
export const dynamic = 'force-dynamic';

interface AuditResponse {
  data: Array<{
    id: string;
    createdAt: string;
    actorId: string | null;
    actorName: string | null;
    actorRole: string | null;
    portal: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    detail: string | null;
    ipAddress: string | null;
  }>;
  total: number;
  kpis: {
    today: number;
    criticalChanges: number;
    sensitiveExports: number;
    adminLogins: number;
  };
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 20;

function pickActionTone(action: string): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  const a = action.toLowerCase();
  if (a.includes('création') || a.includes('publish') || a.includes('approve') || a.includes('create'))
    return 'success';
  if (a.includes('suppression') || a.includes('delete') || a.includes('reject')) return 'danger';
  if (a.includes('révision') || a.includes('update') || a.includes('mise à jour')) return 'warning';
  if (a.includes('export')) return 'info';
  return 'neutral';
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    action?: string;
    resourceType?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const qs = new URLSearchParams();
  if (sp.from) qs.set('from', sp.from);
  if (sp.to) qs.set('to', sp.to);
  if (sp.action) qs.set('action', sp.action);
  if (sp.resourceType) qs.set('resourceType', sp.resourceType);
  qs.set('limit', String(PAGE_SIZE));
  qs.set('offset', String(offset));

  const resp = await safe(api<AuditResponse>(`/api/v1/analytics/audit?${qs.toString()}`, { cache: 'no-store' }));
  const audit = resp ?? {
    data: [],
    total: 0,
    kpis: { today: 0, criticalChanges: 0, sensitiveExports: 0, adminLogins: 0 },
  };

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Audit' },
        ]}
        title="Journal d'audit"
        subtitle="Toutes les actions sensibles sur l'établissement, append-only et traçables"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={History} tone="blue" label="ACTIONS AUJOURD'HUI" value={audit.kpis.today}>
          Sur l&apos;ensemble de l&apos;établissement
        </KpiCard>
        <KpiCard
          icon={ShieldCheck}
          tone="rose"
          label="MODIFICATIONS CRITIQUES"
          value={audit.kpis.criticalChanges}
        >
          Suppressions et révisions
        </KpiCard>
        <KpiCard
          icon={FileSearch}
          tone="violet"
          label="EXPORTS SENSIBLES"
          value={audit.kpis.sensitiveExports}
        >
          Téléchargements de données
        </KpiCard>
        <KpiCard
          icon={UserCheck}
          tone="green"
          label="CONNEXIONS ADMIN"
          value={audit.kpis.adminLogins}
        >
          Sessions ouvertes
        </KpiCard>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {audit.data.length === 0 ? (
          <EmptyState
            icon={History}
            title="Aucune entrée d'audit"
            description="Les actions sensibles seront enregistrées ici. Une fois écrites, elles sont append-only et ne peuvent pas être modifiées."
            tone="slate"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Date & heure</th>
                    <th className="px-4 py-3">Utilisateur</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Ressource</th>
                    <th className="px-4 py-3">Détails</th>
                    <th className="px-4 py-3">IP / Portail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {audit.data.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {formatDateLong(a.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="font-bold text-slate-900">
                          {a.actorName ?? a.actorRole ?? '—'}
                        </span>
                        {a.actorRole && a.actorName && (
                          <span className="ml-1 text-[11px] text-slate-500">({a.actorRole})</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={a.action}
                          tone={pickActionTone(a.action)}
                          size="sm"
                          withDot
                        />
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{a.resourceType}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{a.detail ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {a.ipAddress ?? a.portal ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={audit.total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'entrée', plural: 'entrées' }}
            />
          </>
        )}
      </section>

      <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-slate-500">
        <Eye className="h-3 w-3" />
        Le journal d&apos;audit est append-only : une entrée ne peut être ni modifiée ni supprimée.
        Pour les RGPD requests (oubli), seules les colonnes PII peuvent être pseudonymisées.
      </p>
    </PortalShell>
  );
}
