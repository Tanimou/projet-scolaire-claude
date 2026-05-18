import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    kind?: string;
    severity?: string;
  }>;
}) {
  const sp = await searchParams;
  return (
    <PortalShell portal="admin">
      <NotificationCenter
        portal="admin"
        params={{
          q: sp.q,
          status: sp.status,
          kind: sp.kind,
          severity: sp.severity,
        }}
      />
    </PortalShell>
  );
}
