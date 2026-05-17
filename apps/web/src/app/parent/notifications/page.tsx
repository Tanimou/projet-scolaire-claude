import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

export default async function ParentNotificationsPage() {
  return (
    <PortalShell portal="parent">
      <NotificationCenter portal="parent" />
    </PortalShell>
  );
}
