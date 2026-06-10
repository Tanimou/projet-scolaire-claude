import { Megaphone } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { EmptyState, ErrorState, PageHeader } from '@pilotage/ui';
import type {
  StudentAnnouncementRow,
  StudentAnnouncementsResponse,
} from '@pilotage/contracts';

import { StudentActivationGate } from '../_components/StudentActivationGate';
import { fetchStudentMe } from '../_lib/student-me';
import { StudentAnnouncementCard } from './StudentAnnouncementCard';

export const metadata: Metadata = { title: 'Annonces' };
export const dynamic = 'force-dynamic';

type AnnouncementsFetch = { data: StudentAnnouncementRow[] } | { error: true };

const SCOPE_LABEL: Record<string, string> = {
  school_wide: "Toute l'école",
  cycle_scope: 'Cycle',
  grade_level_scope: 'Niveau',
  class_section_scope: 'Classe',
  individual_student: 'Pour toi',
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Direction de l'établissement",
  teacher: 'Ton professeur',
};

async function fetchAnnouncements(): Promise<AnnouncementsFetch> {
  try {
    const res = await api<StudentAnnouncementsResponse>('/api/v1/student/announcements', {
      cache: 'no-store',
    });
    return { data: res.data ?? [] };
  } catch (err) {
    if (err instanceof ApiError) return { error: true };
    throw err;
  }
}

export default async function StudentAnnouncementsPage() {
  const me = await fetchStudentMe();

  // Unlinked → the calm full-page activation gate, inside the shell.
  if (!me.activated || !me.student) {
    return (
      <PortalShell portal="student" title="Annonces" subtitle="Ton espace élève">
        <StudentActivationGate />
      </PortalShell>
    );
  }

  const headerName = me.student.firstName || 'Élève';
  const classLabel = me.student.classSectionName;
  const shellSubtitle = classLabel ? `${headerName} · ${classLabel}` : headerName;

  const announcements = await fetchAnnouncements();

  if ('error' in announcements) {
    return (
      <PortalShell portal="student" title="Annonces" subtitle={shellSubtitle}>
        <PageHeader title="Annonces" subtitle="Les messages de ton école et de tes profs" />
        <ErrorState
          title="Impossible de charger tes annonces"
          description="Réessaie dans un instant."
          className="mt-6"
        />
      </PortalShell>
    );
  }

  const rows = announcements.data;
  const unreadCount = rows.filter((a) => !a.readAt).length;

  return (
    <PortalShell portal="student" title="Annonces" subtitle={shellSubtitle}>
      <PageHeader title="Annonces" subtitle="Les messages de ton école et de tes profs" />

      {rows.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          tone="violet"
          title="Aucune annonce pour le moment"
          description="Les messages de ton école et de tes profs apparaîtront ici."
          className="mt-6"
        />
      ) : (
        <>
          {/* Calm count line — never an administrative KPI grid. */}
          <p className="mt-6 text-sm text-slate-600">
            <span className="font-bold text-slate-900">{rows.length}</span> annonce
            {rows.length > 1 ? 's' : ''}
            {unreadCount > 0 ? (
              <>
                {' · '}
                <span className="font-bold text-violet-700">{unreadCount} non lue{unreadCount > 1 ? 's' : ''}</span>
              </>
            ) : (
              ' · tout est à jour'
            )}
          </p>

          <section className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {rows.map((a) => (
              <StudentAnnouncementCard
                key={a.id}
                id={a.id}
                title={a.title}
                body={a.body}
                priority={a.priority}
                pinned={a.pinned}
                publishedAt={a.publishedAt}
                scopeLabel={SCOPE_LABEL[a.scope] ?? a.scope}
                audienceLabel={a.audienceLabel}
                authorLabel={a.authorRoleHint ? ROLE_LABEL[a.authorRoleHint] ?? null : null}
                readAt={a.readAt}
              />
            ))}
          </section>
        </>
      )}
    </PortalShell>
  );
}
