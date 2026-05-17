import {
  AlertTriangle,
  Bell,
  CheckCheck,
  ClipboardCheck,
  GraduationCap,
  Inbox,
  Info,
  Megaphone,
  PenTool,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';

import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  StatusBadge,
  formatRelativeTime,
} from '@pilotage/ui';

import { MarkAllReadButton } from './MarkAllReadButton';
import { NotificationListItem } from './NotificationListItem';

export type Portal = 'admin' | 'teacher' | 'parent';

export type NotificationKind =
  | 'announcement'
  | 'alert'
  | 'grade_published'
  | 'enrollment_status'
  | 'lesson_published'
  | 'system';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'danger';

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  link: string | null;
  sourceType: string | null;
  sourceId: string | null;
  createdAt: string;
  readAt: string | null;
}

const KIND_LABEL: Record<NotificationKind, string> = {
  announcement: 'Annonce',
  alert: 'Alerte',
  grade_published: 'Note publiée',
  enrollment_status: 'Inscription',
  lesson_published: 'Cours publié',
  system: 'Système',
};

export const KIND_ICON: Record<NotificationKind, typeof Bell> = {
  announcement: Megaphone,
  alert: AlertTriangle,
  grade_published: PenTool,
  enrollment_status: UserPlus,
  lesson_published: ClipboardCheck,
  system: Info,
};

const PORTAL_BREADCRUMB: Record<Portal, { label: string; href: string }> = {
  admin: { label: 'Tableau de bord', href: '/admin/dashboard' },
  teacher: { label: 'Tableau de bord', href: '/teacher/dashboard' },
  parent: { label: 'Tableau de bord', href: '/parent/dashboard' },
};

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/**
 * Notification center — shared across `/admin/notifications`,
 * `/teacher/notifications` and `/parent/notifications`. The list mixes every
 * `Notification` row (announcement / alert / grade publication / etc.) sorted
 * by readAt asc then createdAt desc, so the unread items always float on top.
 */
export async function NotificationCenter({ portal }: { portal: Portal }) {
  const resp = await safe(
    api<{ data: NotificationRow[] }>('/api/v1/notifications?limit=100', {
      cache: 'no-store',
    }),
  );
  const items = resp?.data ?? [];

  const unread = items.filter((n) => !n.readAt).length;
  const alerts = items.filter((n) => n.kind === 'alert').length;
  const announcements = items.filter((n) => n.kind === 'announcement').length;

  const crumb = PORTAL_BREADCRUMB[portal];

  return (
    <>
      <PageHeader
        breadcrumb={[crumb, { label: 'Notifications' }]}
        title="Notifications"
        subtitle="Tout ce qui vous concerne au même endroit — alertes, annonces, publications de notes"
        actions={unread > 0 ? <MarkAllReadButton /> : undefined}
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Inbox} tone="blue" label="TOTAL" value={items.length}>
          Toutes notifications
        </KpiCard>
        <KpiCard icon={Bell} tone="rose" label="NON LUES" value={unread}>
          À consulter
        </KpiCard>
        <KpiCard icon={AlertTriangle} tone="amber" label="ALERTES" value={alerts}>
          Issues du moteur R6
        </KpiCard>
        <KpiCard icon={Megaphone} tone="violet" label="ANNONCES" value={announcements}>
          Diffusées par l&apos;établissement
        </KpiCard>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Aucune notification"
            description="Toutes les nouvelles annonces, alertes et publications de notes apparaîtront ici."
            tone="slate"
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((n) => (
              <NotificationListItem
                key={n.id}
                id={n.id}
                kind={n.kind}
                severity={n.severity}
                title={n.title}
                body={n.body}
                link={n.link}
                createdAt={n.createdAt}
                readAt={n.readAt}
                kindLabel={KIND_LABEL[n.kind]}
                relativeTime={formatRelativeTime(n.createdAt)}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="mt-4 text-[11px] text-slate-500">
        Le centre de notifications est alimenté en temps réel par le module
        Alertes (toutes les 15 min) et par chaque nouvelle annonce publiée par
        l&apos;établissement. Cliquer sur une notification la marque
        automatiquement comme lue.
      </p>

      {/* Quick legend (intentionally minimal — the badges already carry intent) */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <StatusBadge label="Non lue" tone="danger" size="sm" withDot />
        </span>
        <span className="inline-flex items-center gap-1">
          <CheckCheck className="h-3 w-3 text-emerald-600" /> Lue
        </span>
        <Link
          href={`/${portal}/dashboard`}
          className="ml-auto inline-flex items-center gap-1 font-bold text-blue-700 hover:underline"
        >
          ← Retour au tableau de bord
        </Link>
      </div>
    </>
  );
}
