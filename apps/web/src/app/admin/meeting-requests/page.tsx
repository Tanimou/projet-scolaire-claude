import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { MeetingRequestList } from '@/components/meeting-requests/MeetingRequestList';
import type { MeetingRequest } from '@/components/meeting-requests/types';
import { api, isNextNavigationSignal } from '@/lib/api-client';
import { PageHeader } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Demandes de rendez-vous' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (isNextNavigationSignal(err)) throw err;
    console.error('[admin-meeting-requests] data fetch failed → empty state:', err);
    return null;
  }
}

export default async function AdminMeetingRequestsPage() {
  // Role-scoped aggregate: admin sees ALL requests in the tenant/school —
  // including unrouted ones that no teacher was resolved for. One query per
  // status, joined fields, no client N+1.
  const [openResp, resolvedResp, cancelledResp] = await Promise.all([
    safe(api<{ data: MeetingRequest[] }>('/api/v1/meeting-requests?status=open&limit=100', { cache: 'no-store' })),
    safe(api<{ data: MeetingRequest[] }>('/api/v1/meeting-requests?status=resolved&limit=100', { cache: 'no-store' })),
    safe(api<{ data: MeetingRequest[] }>('/api/v1/meeting-requests?status=cancelled&limit=100', { cache: 'no-store' })),
  ]);

  const requests: MeetingRequest[] = [
    ...(openResp?.data ?? []),
    ...(resolvedResp?.data ?? []),
    ...(cancelledResp?.data ?? []),
  ];

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Demandes de rendez-vous' },
        ]}
        title="Demandes de rendez-vous"
        subtitle="Les familles qui souhaitent un point sur une alerte. Traitez chaque demande : planifier un échange ou clôturer."
      />

      <div className="mt-6">
        <MeetingRequestList requests={requests} portal="admin" />
      </div>
    </PortalShell>
  );
}
