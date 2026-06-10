import type { Metadata } from 'next';
import { Inbox } from 'lucide-react';

import { PortalShell } from '@/components/PortalShell';
import { api, isNextNavigationSignal } from '@/lib/api-client';
import { KpiCard, PageHeader } from '@pilotage/ui';

import { ChildClaimsQueue } from './ChildClaimsQueue';
import type { AdminChildClaimQueueResponse } from './types';

export const metadata: Metadata = { title: 'Demandes de rattachement' };
export const dynamic = 'force-dynamic';

/**
 * Degrade a queue fetch to an empty state on failure. A 404/501/503 (the
 * additive S1 `db push` not yet applied) → a calm empty state, never a crash.
 * Next.js navigation signals are re-thrown so redirects still fire.
 */
async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (isNextNavigationSignal(err)) throw err;
    console.error('[admin-child-claims] data fetch failed → empty state:', err);
    return null;
  }
}

/**
 * /admin/child-claims — the admin "Demandes de rattachement" approval queue (E9-S2).
 *
 * One tenant-scoped aggregate read (`GET /admin/child-claims?status=submitted`,
 * walled by `guardianships.approve`, joined parent + matched student, no client
 * N+1). The page is `force-dynamic` and wraps the fetch in `safe()` so it degrades
 * to a calm empty state while the S1 schema push is pending — never a crash.
 *
 * Distinct from `/admin/enrollments` ("Demandes d'inscription" = class enrollment):
 * this is family-attachment (rattachement ≠ inscription).
 */
export default async function AdminChildClaimsPage() {
  const resp = await safe(
    api<AdminChildClaimQueueResponse>('/api/v1/admin/child-claims?status=submitted', {
      cache: 'no-store',
    }),
  );

  const rows = resp?.data ?? [];

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Demandes de rattachement' },
        ]}
        title="Demandes de rattachement"
        subtitle="Les familles qui demandent à rattacher leur enfant. Vérifiez chaque demande puis validez ou demandez une correction."
      />

      <div className="mt-6 max-w-xs">
        <KpiCard
          icon={Inbox}
          tone={rows.length > 0 ? 'amber' : 'slate'}
          label="En attente"
          value={rows.length}
        />
      </div>

      <div className="mt-6">
        <ChildClaimsQueue rows={rows} />
      </div>
    </PortalShell>
  );
}
