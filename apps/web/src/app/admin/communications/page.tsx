import {
  AlertTriangle,
  Eye,
  FileEdit,
  Megaphone,
  Pin,
  Plus,
  Send,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  RowActions,
  StatusBadge,
  formatDateLong,
  formatDateShort,
} from '@pilotage/ui';

import { CommunicationsFilters } from './CommunicationsFilters';
import type {
  AnnouncementItem,
  AnnouncementPriority,
  AnnouncementScope,
  AnnouncementStatus,
  PinnedFilter,
  PriorityFilter,
  ScopeFilter,
  StatusFilter,
} from './types';

export const metadata: Metadata = { title: 'Communications' };
export const dynamic = 'force-dynamic';

const SCOPE_LABEL: Record<AnnouncementScope, string> = {
  school_wide: "Toute l'école",
  cycle_scope: 'Cycle',
  grade_level_scope: 'Niveau',
  class_section_scope: 'Classe',
  individual_student: 'Élève (parents)',
  individual_user: 'Utilisateur',
};

const SCOPE_TONE: Record<AnnouncementScope, 'info' | 'violet' | 'sky' | 'amber' | 'teal' | 'neutral'> = {
  school_wide: 'violet',
  cycle_scope: 'sky',
  grade_level_scope: 'info',
  class_section_scope: 'teal',
  individual_student: 'amber',
  individual_user: 'neutral',
};

const PRIORITY_TONE: Record<AnnouncementPriority, 'neutral' | 'warning' | 'danger'> = {
  normal: 'neutral',
  high: 'warning',
  urgent: 'danger',
};

const PRIORITY_LABEL: Record<AnnouncementPriority, string> = {
  normal: 'Normale',
  high: 'Haute',
  urgent: 'Urgente',
};

const STATUS_LABEL: Record<AnnouncementStatus, string> = {
  published: 'Publiée',
  expired: 'Expirée',
  draft: 'Brouillon',
};

const STATUS_TONE: Record<AnnouncementStatus, 'success' | 'neutral' | 'warning'> = {
  published: 'success',
  expired: 'neutral',
  draft: 'warning',
};

const VALID_SCOPES: ReadonlyArray<AnnouncementScope> = [
  'school_wide',
  'cycle_scope',
  'grade_level_scope',
  'class_section_scope',
  'individual_student',
  'individual_user',
];

const VALID_PRIORITIES: ReadonlyArray<AnnouncementPriority> = ['normal', 'high', 'urgent'];
const VALID_STATUSES: ReadonlyArray<AnnouncementStatus> = ['published', 'expired', 'draft'];

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 15;

function statusOf(a: AnnouncementItem, now: Date): AnnouncementStatus {
  if (!a.publishedAt) return 'draft';
  if (a.expiresAt && new Date(a.expiresAt) < now) return 'expired';
  return 'published';
}

function audienceLabel(a: AnnouncementItem): string {
  const main = SCOPE_LABEL[a.scope] ?? a.scope;
  const sub = a.classSection?.name ?? a.gradeLevel?.name ?? a.cycle?.name;
  return sub ? `${main} · ${sub}` : main;
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  const d = new Date(y, m - 1, 1);
  return d
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    .replace(/^./, (c) => c.toUpperCase());
}

export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    scope?: string;
    priority?: string;
    status?: string;
    pinned?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const resp = await safe(
    api<{ data: AnnouncementItem[] }>('/api/v1/announcements', { cache: 'no-store' }),
  );
  const all = resp?.data ?? [];
  const now = new Date();

  // KPIs computed on the full dataset so they stay stable across filters.
  const totalAll = all.length;
  const draftsAll = all.filter((a) => statusOf(a, now) === 'draft').length;
  const publishedAll = all.filter((a) => statusOf(a, now) === 'published').length;
  const urgentActive = all.filter(
    (a) => statusOf(a, now) === 'published' && a.priority === 'urgent',
  ).length;
  const pinnedActive = all.filter(
    (a) => a.pinned && statusOf(a, now) === 'published',
  ).length;
  const recipientsAll = all
    .filter((a) => statusOf(a, now) !== 'draft')
    .reduce((s, a) => s + (a._count?.recipients ?? 0), 0);

  // Derive scope options from the data so the dropdown shows only what's
  // actually present — admins on schools that never use individual_user
  // shouldn't see it as a filter.
  const availableScopes = Array.from(new Set(all.map((a) => a.scope))).filter(
    (s): s is AnnouncementScope => VALID_SCOPES.includes(s as AnnouncementScope),
  );

  // Validate filters against accepted values.
  const scopeFilter: ScopeFilter =
    sp.scope && VALID_SCOPES.includes(sp.scope as AnnouncementScope)
      ? (sp.scope as AnnouncementScope)
      : '';
  const priorityFilter: PriorityFilter =
    sp.priority && VALID_PRIORITIES.includes(sp.priority as AnnouncementPriority)
      ? (sp.priority as AnnouncementPriority)
      : '';
  const statusFilter: StatusFilter =
    sp.status && VALID_STATUSES.includes(sp.status as AnnouncementStatus)
      ? (sp.status as AnnouncementStatus)
      : '';
  const pinnedFilter: PinnedFilter = sp.pinned === 'pinned' ? 'pinned' : '';
  const search = (sp.q ?? '').trim().toLowerCase();

  // Apply filters: status → priority → scope → pinned → search.
  const filtered = all
    .filter((a) => (statusFilter ? statusOf(a, now) === statusFilter : true))
    .filter((a) => (priorityFilter ? a.priority === priorityFilter : true))
    .filter((a) => (scopeFilter ? a.scope === scopeFilter : true))
    .filter((a) => (pinnedFilter === 'pinned' ? a.pinned : true))
    .filter((a) => {
      if (!search) return true;
      const hay = [
        a.title,
        a.body,
        SCOPE_LABEL[a.scope] ?? '',
        a.classSection?.name ?? '',
        a.gradeLevel?.name ?? '',
        a.cycle?.name ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(search);
    });

  // Group by month of publication. Drafts are surfaced first under a dedicated
  // "Brouillons" bucket so admins can see and act on un-sent work before
  // browsing historical messages.
  type Bucket = { key: string; label: string; items: AnnouncementItem[] };
  const draftBucket: Bucket = {
    key: '__drafts__',
    label: 'Brouillons',
    items: [],
  };
  const monthBuckets = new Map<string, Bucket>();

  for (const a of filtered) {
    if (!a.publishedAt) {
      draftBucket.items.push(a);
      continue;
    }
    const key = monthKey(a.publishedAt);
    let bucket = monthBuckets.get(key);
    if (!bucket) {
      bucket = { key, label: formatMonthLabel(key), items: [] };
      monthBuckets.set(key, bucket);
    }
    bucket.items.push(a);
  }
  // Drafts always first; months sorted newest → oldest.
  const sortedMonths = Array.from(monthBuckets.values()).sort((a, b) =>
    b.key.localeCompare(a.key),
  );
  const groups: Bucket[] = [];
  if (draftBucket.items.length > 0) groups.push(draftBucket);
  groups.push(...sortedMonths);

  // Paginate within the filtered list while preserving group structure.
  const total = filtered.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;
  let seen = 0;
  const pageGroups: Bucket[] = [];
  for (const g of groups) {
    if (seen >= endIdx) break;
    const groupStart = seen;
    const groupEnd = seen + g.items.length;
    if (groupEnd <= startIdx) {
      seen = groupEnd;
      continue;
    }
    const sliceStart = Math.max(0, startIdx - groupStart);
    const sliceEnd = Math.min(g.items.length, endIdx - groupStart);
    pageGroups.push({ ...g, items: g.items.slice(sliceStart, sliceEnd) });
    seen = groupEnd;
  }

  // Active filter chip recap.
  const activeFilterChips: string[] = [];
  if (statusFilter) activeFilterChips.push(`Statut : ${STATUS_LABEL[statusFilter]}`);
  if (priorityFilter)
    activeFilterChips.push(`Priorité : ${PRIORITY_LABEL[priorityFilter]}`);
  if (scopeFilter) activeFilterChips.push(`Portée : ${SCOPE_LABEL[scopeFilter]}`);
  if (pinnedFilter === 'pinned') activeFilterChips.push('Épinglées uniquement');
  if (search) activeFilterChips.push(`Recherche : « ${search} »`);

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Communications' },
        ]}
        title="Communications"
        subtitle="Diffusez des annonces aux parents, enseignants ou élèves — filtrez par statut, portée ou priorité"
        actions={
          <Link
            href="/admin/announcements/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Nouvelle annonce
          </Link>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Megaphone} tone="blue" label="ANNONCES" value={totalAll}>
          Toutes années confondues
        </KpiCard>
        <KpiCard icon={Send} tone="green" label="PUBLIÉES ACTIVES" value={publishedAll}>
          {draftsAll > 0
            ? `${draftsAll} brouillon${draftsAll > 1 ? 's' : ''} en attente`
            : 'Aucun brouillon'}
        </KpiCard>
        <KpiCard icon={Users} tone="violet" label="DESTINATAIRES TOUCHÉS" value={recipientsAll}>
          Tous canaux confondus
        </KpiCard>
        <KpiCard
          icon={AlertTriangle}
          tone={urgentActive > 0 ? 'rose' : 'orange'}
          label="URGENTES ACTIVES"
          value={urgentActive}
        >
          {pinnedActive > 0
            ? `${pinnedActive} épinglée${pinnedActive > 1 ? 's' : ''}`
            : 'Aucune épinglée'}
        </KpiCard>
      </div>

      {/* Contextual action strip: urgent open OR drafts piling up */}
      {(urgentActive > 0 || draftsAll >= 3) && (
        <div className="mt-4 flex flex-wrap items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm text-amber-900">
            <p className="font-bold">
              {urgentActive > 0
                ? `${urgentActive} annonce${urgentActive > 1 ? 's' : ''} urgente${urgentActive > 1 ? 's' : ''} en cours`
                : `${draftsAll} brouillons en attente de publication`}
            </p>
            <p className="mt-0.5 text-xs text-amber-800/80">
              {urgentActive > 0
                ? 'Vérifiez la portée et la date d’expiration, puis surveillez la lecture côté parents.'
                : 'Ouvrez un brouillon depuis la liste ci-dessous pour le finaliser ou le publier.'}
            </p>
          </div>
          <div className="flex gap-2">
            {urgentActive > 0 && (
              <Link
                href="/admin/communications?priority=urgent&status=published"
                className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
              >
                Voir les urgentes
              </Link>
            )}
            {draftsAll > 0 && (
              <Link
                href="/admin/communications?status=draft"
                className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
              >
                Voir les brouillons
              </Link>
            )}
          </div>
        </div>
      )}

      {totalAll > 0 && (
        <div className="mt-6">
          <CommunicationsFilters
            availableScopes={availableScopes}
            q={search}
            scope={scopeFilter}
            priority={priorityFilter}
            status={statusFilter}
            pinned={pinnedFilter}
          />
        </div>
      )}

      <section className="mt-4 space-y-6">
        {totalAll === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Aucune annonce"
            description="Créez votre première annonce avec le bouton « Nouvelle annonce » ci-dessus."
            tone="slate"
            action={{ label: 'Créer une annonce', href: '/admin/announcements/new' }}
          />
        ) : total === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Aucune annonce avec ces filtres"
            description="Élargissez la sélection, retirez un filtre, ou videz la recherche pour voir plus de résultats."
            tone="slate"
          />
        ) : (
          pageGroups.map((g) => (
            <div key={g.key} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
                  {g.label}
                </h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-600">
                  {g.items.length} annonce{g.items.length > 1 ? 's' : ''}
                </span>
                {g.key === '__drafts__' && (
                  <StatusBadge label="À publier" tone="warning" size="sm" withDot />
                )}
              </div>
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        <th className="px-4 py-3">Titre</th>
                        <th className="px-4 py-3">Audience</th>
                        <th className="px-4 py-3">Priorité</th>
                        <th className="px-4 py-3 text-right">Destinataires</th>
                        <th className="px-4 py-3">Publication</th>
                        <th className="px-4 py-3">Statut</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {g.items.map((a) => {
                        const st = statusOf(a, now);
                        const audienceTone = SCOPE_TONE[a.scope];
                        return (
                          <tr key={a.id} className="hover:bg-slate-50/60">
                            <td className="px-4 py-3">
                              <div className="flex items-start gap-2">
                                {a.pinned && (
                                  <Pin
                                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500"
                                    aria-label="Épinglée"
                                  />
                                )}
                                <div className="flex min-w-0 flex-col">
                                  <span className="truncate text-sm font-bold text-slate-900">
                                    {a.title}
                                  </span>
                                  {a.expiresAt && (
                                    <span className="mt-0.5 text-[10px] text-slate-400">
                                      Expire le {formatDateShort(a.expiresAt)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge
                                label={audienceLabel(a)}
                                tone={audienceTone}
                                size="sm"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge
                                label={PRIORITY_LABEL[a.priority] ?? a.priority}
                                tone={PRIORITY_TONE[a.priority] ?? 'neutral'}
                                size="sm"
                                withDot={a.priority === 'urgent'}
                              />
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-slate-700">
                              {a._count.recipients}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500">
                              {a.publishedAt
                                ? formatDateLong(a.publishedAt)
                                : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge
                                label={STATUS_LABEL[st]}
                                tone={STATUS_TONE[st]}
                                size="sm"
                                withDot
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <RowActions
                                actions={[
                                  {
                                    id: 'view',
                                    icon: <Eye className="h-4 w-4" />,
                                    label: 'Voir',
                                    tone: 'blue',
                                    href: `/admin/announcements/${a.id}`,
                                  },
                                  ...(st === 'draft'
                                    ? [
                                        {
                                          id: 'edit',
                                          icon: <FileEdit className="h-3.5 w-3.5" />,
                                          label: 'Modifier le brouillon',
                                          tone: 'cyan' as const,
                                          href: `/admin/announcements/${a.id}`,
                                        },
                                      ]
                                    : []),
                                ]}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      {total > PAGE_SIZE && (
        <div className="mt-6">
          <Pagination
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel={{ singular: 'annonce', plural: 'annonces' }}
          />
        </div>
      )}

      {activeFilterChips.length > 0 && (
        <p className="mt-4 text-[11px] text-slate-500">
          Filtres actifs :{' '}
          {activeFilterChips.map((chip, idx) => (
            <span key={chip}>
              <span className="font-bold text-slate-700">{chip}</span>
              {idx < activeFilterChips.length - 1 && (
                <span className="text-slate-400"> · </span>
              )}
            </span>
          ))}
        </p>
      )}
    </PortalShell>
  );
}
