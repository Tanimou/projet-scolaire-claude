import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

export default async function TeacherNotificationsPage({
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
    <PortalShell portal="teacher">
      <NotificationCenter
        portal="teacher"
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
