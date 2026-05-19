import { AlertTriangle, BellRing, Inbox, Megaphone, Pin } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
} from '@pilotage/ui';

import { AnnouncementCard } from './AnnouncementCard';
import { AnnouncementsFilters } from './AnnouncementsFilters';

export const metadata: Metadata = { title: 'Annonces' };
export const dynamic = 'force-dynamic';

interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  scope: string;
  priority: 'normal' | 'high' | 'urgent';
  publishedAt: string | null;
  expiresAt: string | null;
  pinned: boolean;
  authorRoleHint: 'admin' | 'teacher' | null;
  classSection?: { name: string } | null;
  gradeLevel?: { name: string } | null;
  cycle?: { name: string } | null;
  student?: { id: string; firstName: string; lastName: string } | null;
  readAt?: string | null;
}

const SCOPE_LABEL: Record<string, string> = {
  school_wide: "Toute l'école",
  cycle_scope: 'Cycle',
  grade_level_scope: 'Niveau',
  class_section_scope: 'Classe',
  individual_student: 'Élève',
  individual_user: 'Personnel',
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Direction de l'établissement",
  teacher: 'Enseignant',
};

const PAGE_SIZE = 10;

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

function audienceLabel(a: AnnouncementItem): string | null {
  if (a.classSection?.name) return `Classe ${a.classSection.name}`;
  if (a.gradeLevel?.name) return a.gradeLevel.name;
  if (a.cycle?.name) return a.cycle.name;
  if (a.student) return `${a.student.firstName}`;
  return null;
}

export default async function ParentAnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    status?: string;
    priority?: string;
    scope?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const q = (sp.q ?? '').trim().toLowerCase();
  const status = sp.status ?? '';
  const priority = sp.priority ?? '';
  const scope = sp.scope ?? '';

  const resp = await safe(
    api<{ data: AnnouncementItem[] }>('/api/v1/announcements', { cache: 'no-store' }),
  );
  const all = resp?.data ?? [];

  // KPIs computed on the unfiltered dataset so they describe the whole inbox
  const unreadCount = all.filter((a) => !a.readAt).length;
  const pinnedCount = all.filter((a) => a.pinned).length;
  const urgentCount = all.filter((a) => a.priority === 'urgent').length;

  // Apply filters in memory — the API already scopes to the parent's receipts
  let filtered = all;
  if (q) {
    filtered = filtered.filter(
      (a) =>
        a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q),
    );
  }
  if (status === 'unread') filtered = filtered.filter((a) => !a.readAt);
  if (status === 'read') filtered = filtered.filter((a) => !!a.readAt);
  if (priority) filtered = filtered.filter((a) => a.priority === priority);
  if (scope) filtered = filtered.filter((a) => a.scope === scope);

  // Pinned-first ordering is already enforced server-side, preserve it here
  const total = filtered.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  const hasActiveFilters = !!q || !!status || !!priority || !!scope;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Annonces' },
        ]}
        title="Annonces"
        subtitle="Communications de l'établissement et de l'équipe pédagogique qui vous concernent"
      />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard icon={Inbox} tone="blue" label="TOTAL" value={all.length}>
          Cette année scolaire
        </KpiCard>
        <KpiCard icon={BellRing} tone="rose" label="NON LUES" value={unreadCount}>
          {unreadCount > 0 ? 'À consulter' : 'Tout est à jour'}
        </KpiCard>
        <KpiCard icon={AlertTriangle} tone="amber" label="URGENTES" value={urgentCount}>
          Priorité haute
        </KpiCard>
        <KpiCard icon={Pin} tone="violet" label="ÉPINGLÉES" value={pinnedCount}>
          Maintenues en tête
        </KpiCard>
      </div>

      <div className="mt-6">
        <AnnouncementsFilters
          initialQ={q}
          initialStatus={status}
          initialPriority={priority}
          initialScope={scope}
        />
      </div>

      {total === 0 ? (
        <section className="mt-6 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200/60">
          {hasActiveFilters ? (
            <EmptyState
              icon={Megaphone}
              title="Aucune annonce ne correspond à vos filtres"
              description="Essayez d'élargir votre recherche ou de retirer un filtre pour voir plus de communications."
              tone="slate"
            />
          ) : (
            <EmptyState
              icon={Megaphone}
              title="Aucune annonce pour le moment"
              description="Les communications de l'école et des enseignants apparaîtront ici. Vous recevrez également une notification dès qu'une nouvelle annonce vous est destinée."
              tone="slate"
            />
          )}
        </section>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {pageRows.map((a) => (
              <AnnouncementCard
                key={a.id}
                id={a.id}
                title={a.title}
                body={a.body}
                priority={a.priority}
                pinned={a.pinned}
                publishedAt={a.publishedAt ?? null}
                scopeLabel={SCOPE_LABEL[a.scope] ?? a.scope}
                audienceLabel={audienceLabel(a)}
                authorLabel={a.authorRoleHint ? ROLE_LABEL[a.authorRoleHint] ?? null : null}
                readAt={a.readAt ?? null}
              />
            ))}
          </section>

          <div className="mt-4">
            <Pagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'annonce', plural: 'annonces' }}
            />
          </div>
        </>
      )}
    </PortalShell>
  );
}
