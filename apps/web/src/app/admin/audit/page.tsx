import { Download, Eye, FileSearch, History, ShieldCheck, UserCheck } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  type SelectOption,
} from '@pilotage/ui';

import { exportAuditAction } from './actions';
import type { AuditEntry } from './AuditDetailDrawer';
import { AuditPageFilters, humanizePortal, humanizeResourceType } from './AuditPageFilters';
import { AuditTable } from './AuditTable';

export const metadata: Metadata = { title: 'Audit' };
export const dynamic = 'force-dynamic';

interface AuditResponse {
  data: AuditEntry[];
  total: number;
  kpis: {
    today: number;
    criticalChanges: number;
    sensitiveExports: number;
    adminLogins: number;
  };
}

interface AuditFacetsResponse {
  resourceTypes: string[];
  portals: string[];
  actions: string[];
  actors: Array<{ id: string; name: string; role: string | null }>;
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

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    action?: string;
    resourceType?: string;
    portal?: string;
    actorId?: string;
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
  if (sp.portal) qs.set('portal', sp.portal);
  if (sp.actorId) qs.set('actorId', sp.actorId);
  qs.set('limit', String(PAGE_SIZE));
  qs.set('offset', String(offset));

  const [resp, facets] = await Promise.all([
    safe(api<AuditResponse>(`/api/v1/analytics/audit?${qs.toString()}`, { cache: 'no-store' })),
    safe(api<AuditFacetsResponse>(`/api/v1/analytics/audit-facets`, { cache: 'no-store' })),
  ]);

  const audit = resp ?? {
    data: [],
    total: 0,
    kpis: { today: 0, criticalChanges: 0, sensitiveExports: 0, adminLogins: 0 },
  };
  const facetData = facets ?? { resourceTypes: [], portals: [], actions: [], actors: [] };

  const resourceTypeOptions: SelectOption[] = facetData.resourceTypes.map((rt) => ({
    value: rt,
    label: humanizeResourceType(rt),
    hint: rt,
  }));
  const portalOptions: SelectOption[] = facetData.portals.map((p) => ({
    value: p,
    label: humanizePortal(p),
  }));
  const actorOptions: SelectOption[] = facetData.actors.map((a) => ({
    value: a.id,
    label: a.name,
    hint: a.role ?? undefined,
  }));

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Audit' },
        ]}
        title="Journal d'audit"
        subtitle="Toutes les actions sensibles sur l'établissement, append-only et traçables"
        actions={
          <form action={exportAuditAction}>
            <input type="hidden" name="from" value={sp.from ?? ''} />
            <input type="hidden" name="to" value={sp.to ?? ''} />
            <button
              type="submit"
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
            >
              <Download className="h-4 w-4" />
              Exporter en CSV
            </button>
          </form>
        }
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

      <div className="mt-6">
        <AuditPageFilters
          initialQ={sp.action ?? ''}
          initialResourceType={sp.resourceType ?? ''}
          initialPortal={sp.portal ?? ''}
          initialActorId={sp.actorId ?? ''}
          initialFrom={sp.from ?? ''}
          initialTo={sp.to ?? ''}
          resourceTypeOptions={resourceTypeOptions}
          portalOptions={portalOptions}
          actorOptions={actorOptions}
        />
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {audit.data.length === 0 ? (
          <EmptyState
            icon={History}
            title="Aucune entrée d'audit"
            description={
              sp.action || sp.from || sp.to || sp.resourceType || sp.portal || sp.actorId
                ? "Aucune entrée ne correspond à vos filtres. Élargissez la période ou réinitialisez les filtres."
                : "Les actions sensibles seront enregistrées ici. Une fois écrites, elles sont append-only et ne peuvent pas être modifiées."
            }
            tone="slate"
          />
        ) : (
          <>
            <AuditTable rows={audit.data} />
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
