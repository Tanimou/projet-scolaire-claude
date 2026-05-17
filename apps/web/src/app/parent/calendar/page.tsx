import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import {
  PortalCalendarView,
  type PortalCalendarEvent,
} from '@/components/calendar/PortalCalendarView';
import { api, ApiError } from '@/lib/api-client';
import { PageHeader } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Calendrier scolaire' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function ParentCalendarPage() {
  const resp = await safe(
    api<{ data: PortalCalendarEvent[] }>('/api/v1/calendar/events', { cache: 'no-store' }),
  );
  const events = resp?.data ?? [];

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Calendrier scolaire' },
        ]}
        title="Calendrier scolaire"
        subtitle="Vacances, jours fériés, périodes d'examens, cérémonies et événements de l'établissement"
      />
      <PortalCalendarView portal="parent" events={events} />
    </PortalShell>
  );
}
