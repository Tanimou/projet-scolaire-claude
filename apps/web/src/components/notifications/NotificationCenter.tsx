import {
  AlertTriangle,
  Bell,
  CheckCheck,
  ClipboardCheck,
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
import { NotificationsFilters } from './NotificationsFilters';

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

interface NotificationCenterParams {
  q?: string;
  status?: string;
  kind?: string;
  severity?: string;
}

interface DayBucket {
  key: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'older';
  label: string;
  items: NotificationRow[];
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/**
 * Bucket notifications into Aujourd'hui / Hier / Cette semaine / Ce mois /
 * Plus ancien based on `createdAt`. Order of buckets is preserved in render.
 */
function bucketByDay(items: NotificationRow[]): DayBucket[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);
  const startOfMonth = new Date(startOfToday);
  startOfMonth.setDate(startOfMonth.getDate() - 30);

  const today: NotificationRow[] = [];
  const yesterday: NotificationRow[] = [];
  const thisWeek: NotificationRow[] = [];
  const thisMonth: NotificationRow[] = [];
  const older: NotificationRow[] = [];

  for (const it of items) {
    const t = new Date(it.createdAt).getTime();
    if (Number.isNaN(t)) {
      older.push(it);
      continue;
    }
    if (t >= startOfToday.getTime()) today.push(it);
    else if (t >= startOfYesterday.getTime()) yesterday.push(it);
    else if (t >= startOfWeek.getTime()) thisWeek.push(it);
    else if (t >= startOfMonth.getTime()) thisMonth.push(it);
    else older.push(it);
  }

  const out: DayBucket[] = [
    { key: 'today', label: "Aujourd'hui", items: today },
    { key: 'yesterday', label: 'Hier', items: yesterday },
    { key: 'this_week', label: 'Cette semaine', items: thisWeek },
    { key: 'this_month', label: 'Ce mois-ci', items: thisMonth },
    { key: 'older', label: 'Plus ancien', items: older },
  ];
  return out.filter((b) => b.items.length > 0);
}

const KIND_VALUES: ReadonlyArray<NotificationKind> = [
  'announcement',
  'alert',
  'grade_published',
  'enrollment_status',
  'lesson_published',
  'system',
];
const SEVERITY_VALUES: ReadonlyArray<NotificationSeverity> = [
  'info',
  'success',
  'warning',
  'danger',
];

/**
 * Notification center — shared across `/admin/notifications`,
 * `/teacher/notifications` and `/parent/notifications`. The list mixes every
 * `Notification` row (announcement / alert / grade publication / etc.) sorted
 * by readAt asc then createdAt desc, so the unread items always float on top.
 *
 * Filters (search, status, kind, severity) and day-buckets are applied in
 * memory after fetching — the API returns up to 100 most-recent rows.
 */
export async function NotificationCenter({
  portal,
  params = {},
}: {
  portal: Portal;
  params?: NotificationCenterParams;
}) {
  const resp = await safe(
    api<{ data: NotificationRow[] }>('/api/v1/notifications?limit=100', {
      cache: 'no-store',
    }),
  );
  const items = resp?.data ?? [];

  // KPIs are intentionally computed on the unfiltered dataset so they
  // describe the whole inbox, not the current filter view.
  const unread = items.filter((n) => !n.readAt).length;
  const alerts = items.filter((n) => n.kind === 'alert').length;
  const announcements = items.filter((n) => n.kind === 'announcement').length;

  const q = (params.q ?? '').trim().toLowerCase();
  const status = params.status ?? '';
  const kindParam = params.kind ?? '';
  const kindFilter = (KIND_VALUES as readonly string[]).includes(kindParam)
    ? (kindParam as NotificationKind)
    : '';
  const severityParam = params.severity ?? '';
  const severityFilter = (SEVERITY_VALUES as readonly string[]).includes(severityParam)
    ? (severityParam as NotificationSeverity)
    : '';

  let filtered = items;
  if (q) {
    filtered = filtered.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        (n.body ?? '').toLowerCase().includes(q),
    );
  }
  if (status === 'unread') filtered = filtered.filter((n) => !n.readAt);
  if (status === 'read') filtered = filtered.filter((n) => !!n.readAt);
  if (kindFilter) filtered = filtered.filter((n) => n.kind === kindFilter);
  if (severityFilter) filtered = filtered.filter((n) => n.severity === severityFilter);

  const buckets = bucketByDay(filtered);
  const filteredCount = filtered.length;
  const hasActiveFilters =
    !!q || !!status || !!kindFilter || !!severityFilter;

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
          {unread > 0 ? 'À consulter' : 'Tout est à jour'}
        </KpiCard>
        <KpiCard icon={AlertTriangle} tone="amber" label="ALERTES" value={alerts}>
          Issues du moteur R6
        </KpiCard>
        <KpiCard icon={Megaphone} tone="violet" label="ANNONCES" value={announcements}>
          Diffusées par l&apos;établissement
        </KpiCard>
      </div>

      <div className="mt-6">
        <NotificationsFilters
          portal={portal}
          initialQ={q}
          initialStatus={status}
          initialKind={kindFilter}
          initialSeverity={severityFilter}
        />
      </div>

      {hasActiveFilters && items.length > 0 && (
        <p className="mt-3 text-[11px] font-medium text-slate-500">
          {filteredCount === 0
            ? '0 notification ne correspond à vos filtres'
            : filteredCount === 1
              ? '1 notification correspond à vos filtres'
              : `${filteredCount} notifications correspondent à vos filtres`}
          {' · '}
          <Link
            href={`/${portal}/notifications`}
            className="font-bold text-blue-700 hover:underline"
          >
            Réinitialiser
          </Link>
        </p>
      )}

      {filteredCount === 0 ? (
        <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
          {hasActiveFilters ? (
            <EmptyState
              icon={Bell}
              title="Aucune notification ne correspond à vos filtres"
              description="Essayez d'élargir votre recherche ou retirez un filtre pour voir plus de communications."
              tone="slate"
            />
          ) : (
            <EmptyState
              icon={Bell}
              title="Aucune notification"
              description="Toutes les nouvelles annonces, alertes et publications de notes apparaîtront ici."
              tone="slate"
            />
          )}
        </section>
      ) : (
        <div className="mt-4 space-y-4">
          {buckets.map((bucket) => (
            <section
              key={bucket.key}
              className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60"
            >
              <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  {bucket.label}
                </h2>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                  {bucket.items.length}
                </span>
              </header>
              <ul className="divide-y divide-slate-100">
                {bucket.items.map((n) => (
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
            </section>
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-500">
        Le centre de notifications est alimenté en temps réel par le module
        Alertes (toutes les 15 min) et par chaque nouvelle annonce publiée par
        l&apos;établissement. Cliquer sur une notification la marque
        automatiquement comme lue.
      </p>

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
