import { PageHeader } from '@pilotage/ui';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import {
  PortalCalendarView,
  type PortalCalendarEvent,
} from '@/components/calendar/PortalCalendarView';
import { api, ApiError } from '@/lib/api-client';
import { resolveSchoolCalendarAnchor } from '@/lib/school-calendar-anchor';

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

export default async function TeacherCalendarPage() {
  const resp = await safe(
    api<{ data: PortalCalendarEvent[] }>('/api/v1/calendar/events', { cache: 'no-store' }),
  );
  const events = resp?.data ?? [];

  // L'instant de référence est résolu ICI, une fois par requête (la page est
  // `force-dynamic`), et traverse la frontière serveur/client en prop. C'est la
  // SEULE horloge lue par la surface calendrier : la vue portail n'en lit plus
  // aucune, donc SSR et hydratation calculent les mêmes compteurs
  // (S-E03-8 / PF-40 / ADR-078).
  const anchor = resolveSchoolCalendarAnchor();

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Calendrier scolaire' },
        ]}
        title="Calendrier scolaire"
        subtitle="Vacances, jours fériés, périodes d'examens, réunions et journées pédagogiques"
      />
      <PortalCalendarView portal="teacher" events={events} anchor={anchor} />
    </PortalShell>
  );
}
