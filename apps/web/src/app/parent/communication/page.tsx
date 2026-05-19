import {
  AlertOctagon,
  BellRing,
  Building2,
  GraduationCap,
  Inbox,
  Megaphone,
  MessageSquare,
  Pin,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  Avatar,
  EmptyState,
  KpiCard,
  PageHeader,
  StatusBadge,
  formatDateLong,
  formatRelativeTime,
} from '@pilotage/ui';

import { CommunicationFilters } from './CommunicationFilters';
import type {
  CommunicationItem,
  InterlocutorCard,
  PeriodFilter,
  SourceFilter,
  StatusFilter,
} from './types';

export const metadata: Metadata = { title: 'Communication' };
export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<'admin' | 'teacher', string> = {
  admin: "Direction de l'établissement",
  teacher: 'Enseignant',
};

const SCOPE_LABEL: Record<string, string> = {
  school_wide: "Toute l'école",
  cycle_scope: 'Cycle',
  grade_level_scope: 'Niveau',
  class_section_scope: 'Classe',
  individual_student: 'Élève',
  individual_user: 'Personnel',
};

const SCOPE_TONE: Record<string, string> = {
  school_wide: 'bg-violet-50 text-violet-700 ring-violet-200',
  cycle_scope: 'bg-sky-50 text-sky-700 ring-sky-200',
  grade_level_scope: 'bg-blue-50 text-blue-700 ring-blue-200',
  class_section_scope: 'bg-teal-50 text-teal-700 ring-teal-200',
  individual_student: 'bg-amber-50 text-amber-800 ring-amber-200',
  individual_user: 'bg-slate-50 text-slate-700 ring-slate-200',
};

const PERIOD_DAYS: Record<Exclude<PeriodFilter, ''>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

const PERIOD_LABEL: Record<Exclude<PeriodFilter, ''>, string> = {
  '7d': '7 derniers jours',
  '30d': '30 derniers jours',
  '90d': '90 derniers jours',
};

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

function audienceLabel(a: CommunicationItem): string | null {
  if (a.classSection?.name) return `Classe ${a.classSection.name}`;
  if (a.gradeLevel?.name) return a.gradeLevel.name;
  if (a.cycle?.name) return a.cycle.name;
  if (a.student) return a.student.firstName;
  return null;
}

function authorDisplay(a: CommunicationItem): {
  firstName: string;
  lastName: string;
  roleLabel: string;
} {
  const role = a.authorRoleHint ?? 'teacher';
  const roleLabel = ROLE_LABEL[role] ?? 'Équipe pédagogique';
  if (a.author) {
    return { firstName: a.author.firstName, lastName: a.author.lastName, roleLabel };
  }
  return {
    firstName: role === 'admin' ? 'Direction' : 'Enseignant·e',
    lastName: role === 'admin' ? "de l'école" : '',
    roleLabel,
  };
}

function monthKey(iso: string | null): string {
  if (!iso) return '__unknown__';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '__unknown__';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  if (key === '__unknown__') return 'Date inconnue';
  const [yearStr, monthStr] = key.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const d = new Date(year, month - 1, 1);
  return d
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    .replace(/^./, (c) => c.toUpperCase());
}

export default async function ParentCommunicationPage({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    status?: string;
    period?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;

  const resp = await safe(
    api<{ data: CommunicationItem[] }>('/api/v1/announcements', { cache: 'no-store' }),
  );
  const all = resp?.data ?? [];

  // KPIs computed on the unfiltered dataset so they describe the whole inbox.
  const totalAll = all.length;
  const unreadAll = all.filter((a) => !a.readAt).length;
  const urgentAll = all.filter((a) => a.priority === 'urgent').length;
  const distinctAuthors = new Set(
    all.map((a) => a.author?.id ?? `unknown-${a.authorRoleHint ?? 'none'}`),
  );

  // Validate filters.
  const sourceFilter: SourceFilter =
    sp.source === 'admin' || sp.source === 'teacher' ? sp.source : '';
  const statusFilter: StatusFilter =
    sp.status === 'unread' || sp.status === 'read' ? sp.status : '';
  const periodFilter: PeriodFilter =
    sp.period === '7d' || sp.period === '30d' || sp.period === '90d' ? sp.period : '';
  const search = (sp.q ?? '').trim().toLowerCase();

  // Apply filters.
  const now = Date.now();
  const periodCutoffMs = periodFilter
    ? now - PERIOD_DAYS[periodFilter] * 24 * 60 * 60 * 1000
    : null;

  const filtered = all.filter((a) => {
    if (sourceFilter && a.authorRoleHint !== sourceFilter) return false;
    if (statusFilter === 'unread' && a.readAt) return false;
    if (statusFilter === 'read' && !a.readAt) return false;
    if (periodCutoffMs !== null) {
      const ts = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      if (!ts || ts < periodCutoffMs) return false;
    }
    if (search) {
      const author = authorDisplay(a);
      const hay = [
        a.title,
        a.body,
        author.firstName,
        author.lastName,
        author.roleLabel,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Build interlocutors from the FILTERED dataset so the panel reflects
  // current selection. The KPIs above remain on the full inbox so the user
  // always sees the global picture.
  const interlocutorMap = new Map<string, InterlocutorCard>();
  for (const a of filtered) {
    const key = a.author?.id ?? `unknown-${a.authorRoleHint ?? 'none'}`;
    const author = authorDisplay(a);
    const card = interlocutorMap.get(key) ?? {
      key,
      authorId: a.author?.id ?? null,
      firstName: author.firstName,
      lastName: author.lastName,
      roleHint: a.authorRoleHint,
      total: 0,
      unread: 0,
      urgent: 0,
      lastMessageAt: null,
    };
    card.total += 1;
    if (!a.readAt) card.unread += 1;
    if (a.priority === 'urgent') card.urgent += 1;
    if (a.publishedAt) {
      if (!card.lastMessageAt || new Date(a.publishedAt) > new Date(card.lastMessageAt)) {
        card.lastMessageAt = a.publishedAt;
      }
    }
    interlocutorMap.set(key, card);
  }
  const interlocutors = Array.from(interlocutorMap.values()).sort((a, b) => {
    // Direction first, then most recent message.
    if (a.roleHint !== b.roleHint) {
      if (a.roleHint === 'admin') return -1;
      if (b.roleHint === 'admin') return 1;
    }
    if (b.unread !== a.unread) return b.unread - a.unread;
    const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bt - at;
  });

  // Build monthly timeline (most recent first), max 30 entries to keep the page light.
  const recent = filtered.slice(0, 30);
  const monthGroups = new Map<string, CommunicationItem[]>();
  for (const a of recent) {
    const key = monthKey(a.publishedAt);
    const arr = monthGroups.get(key) ?? [];
    arr.push(a);
    monthGroups.set(key, arr);
  }
  const monthList = Array.from(monthGroups.entries()).sort(([a], [b]) => {
    if (a === '__unknown__') return 1;
    if (b === '__unknown__') return -1;
    return b.localeCompare(a);
  });

  // Active filter chips recap.
  const activeFilterChips: string[] = [];
  if (sourceFilter)
    activeFilterChips.push(
      `Source : ${sourceFilter === 'admin' ? "Direction" : 'Enseignants'}`,
    );
  if (periodFilter) activeFilterChips.push(`Période : ${PERIOD_LABEL[periodFilter]}`);
  if (statusFilter)
    activeFilterChips.push(`Statut : ${statusFilter === 'unread' ? 'Non lues' : 'Lues'}`);
  if (search) activeFilterChips.push(`Recherche : « ${search} »`);

  const urgentUnread = filtered.filter((a) => a.priority === 'urgent' && !a.readAt).length;
  const hasActiveFilters = !!sourceFilter || !!statusFilter || !!periodFilter || !!search;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Communication' },
        ]}
        title="Communication"
        subtitle="Vos interlocuteurs au sein de l'école et l'historique des échanges qui vous concernent"
      />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard icon={Inbox} tone="blue" label="REÇUES" value={totalAll}>
          Cette année scolaire
        </KpiCard>
        <KpiCard icon={BellRing} tone="rose" label="NON LUES" value={unreadAll}>
          {unreadAll > 0 ? 'À consulter' : 'Tout est à jour'}
        </KpiCard>
        <KpiCard icon={AlertOctagon} tone="amber" label="URGENTES" value={urgentAll}>
          Priorité haute
        </KpiCard>
        <KpiCard
          icon={Users}
          tone="violet"
          label="INTERLOCUTEURS"
          value={distinctAuthors.size}
        >
          Émetteurs distincts
        </KpiCard>
      </div>

      {urgentUnread > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
            <AlertOctagon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm text-rose-900">
            <p className="font-bold">
              {urgentUnread} message{urgentUnread > 1 ? 's' : ''} urgent
              {urgentUnread > 1 ? 's' : ''} non lu{urgentUnread > 1 ? 's' : ''}
            </p>
            <p className="mt-0.5 text-xs text-rose-800/80">
              Consultez ces communications en priorité pour ne rien manquer.
            </p>
          </div>
          <Link
            href="/parent/announcements?status=unread&priority=urgent"
            className="shrink-0 self-center rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
          >
            Les voir
          </Link>
        </div>
      )}

      <div className="mt-6">
        <CommunicationFilters
          source={sourceFilter}
          status={statusFilter}
          period={periodFilter}
          q={search}
        />
      </div>

      {totalAll === 0 ? (
        <section className="mt-6 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200/60">
          <EmptyState
            icon={MessageSquare}
            title="Aucune communication pour le moment"
            description="Les messages de la direction et des enseignants apparaîtront ici. Vous recevrez une notification dès qu'une nouvelle communication vous est destinée."
            tone="slate"
          />
        </section>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
          {/* Interlocutors panel — 2/5 on desktop */}
          <section className="xl:col-span-2">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                Vos interlocuteurs
              </h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {interlocutors.length}
              </span>
            </header>
            {interlocutors.length === 0 ? (
              <div className="rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200/60">
                <EmptyState
                  icon={Users}
                  title="Aucun interlocuteur"
                  description="Modifiez vos filtres pour faire apparaître des interlocuteurs."
                  tone="slate"
                />
              </div>
            ) : (
              <ul className="space-y-2.5">
                {interlocutors.map((it) => {
                  const isAdmin = it.roleHint === 'admin';
                  const Icon = isAdmin ? Building2 : GraduationCap;
                  return (
                    <li
                      key={it.key}
                      className="group rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 transition hover:shadow-md hover:ring-slate-300"
                    >
                      <div className="flex items-start gap-3">
                        {it.authorId ? (
                          <Avatar
                            firstName={it.firstName}
                            lastName={it.lastName}
                            size="md"
                            tone={isAdmin ? 'violet' : 'auto'}
                          />
                        ) : (
                          <span
                            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                              isAdmin
                                ? 'bg-violet-100 text-violet-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            <Icon className="h-5 w-5" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="truncate text-sm font-bold text-slate-900">
                              {it.firstName} {it.lastName}
                            </p>
                            {it.unread > 0 && (
                              <StatusBadge
                                label={`${it.unread} non lu${it.unread > 1 ? 's' : ''}`}
                                tone="rose"
                                size="sm"
                              />
                            )}
                            {it.urgent > 0 && (
                              <StatusBadge label="Urgent" tone="amber" size="sm" withDot />
                            )}
                          </div>
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-slate-500">
                            <Icon className="h-3 w-3" />
                            {isAdmin
                              ? "Direction de l'école"
                              : it.roleHint === 'teacher'
                                ? 'Enseignant·e'
                                : 'Émetteur'}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                            <span>
                              <span className="font-bold text-slate-800">{it.total}</span>{' '}
                              message{it.total > 1 ? 's' : ''}
                            </span>
                            {it.lastMessageAt && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span>
                                  Dernier :{' '}
                                  <span className="font-medium text-slate-700">
                                    {formatRelativeTime(it.lastMessageAt)}
                                  </span>
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Timeline — 3/5 on desktop */}
          <section className="xl:col-span-3">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                Communications récentes
              </h2>
              <Link
                href="/parent/announcements"
                className="text-xs font-bold text-blue-600 hover:text-blue-700"
              >
                Voir toutes les annonces →
              </Link>
            </header>

            {filtered.length === 0 ? (
              <div className="rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200/60">
                <EmptyState
                  icon={Megaphone}
                  title="Aucune communication ne correspond à ces filtres"
                  description="Essayez d'élargir la sélection — retirez un filtre ou changez de période."
                  tone="slate"
                />
              </div>
            ) : (
              <div className="space-y-5">
                {monthList.map(([key, items]) => (
                  <div key={key}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-700">
                        {monthLabel(key)}
                        <span className="rounded-full bg-white px-1.5 text-[10px] font-bold text-slate-600">
                          {items.length}
                        </span>
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {items.map((a) => {
                        const author = authorDisplay(a);
                        const isUrgent = a.priority === 'urgent';
                        const isUnread = !a.readAt;
                        const audience = audienceLabel(a);
                        return (
                          <li key={a.id}>
                            <Link
                              href={`/parent/announcements/${a.id}`}
                              className={`flex gap-3 rounded-xl bg-white p-3.5 ring-1 transition hover:shadow-md ${
                                isUnread
                                  ? 'ring-blue-200 hover:ring-blue-300'
                                  : 'ring-slate-200/60 hover:ring-slate-300'
                              }`}
                            >
                              <Avatar
                                firstName={author.firstName}
                                lastName={author.lastName}
                                size="sm"
                                tone={a.authorRoleHint === 'admin' ? 'violet' : 'auto'}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  {isUnread && (
                                    <span
                                      aria-hidden
                                      className="h-2 w-2 shrink-0 rounded-full bg-blue-500"
                                    />
                                  )}
                                  {a.pinned && (
                                    <Pin className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                                  )}
                                  <p
                                    className={`truncate text-sm ${
                                      isUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'
                                    }`}
                                  >
                                    {a.title}
                                  </p>
                                  {isUrgent && (
                                    <StatusBadge
                                      label="Urgent"
                                      tone="rose"
                                      size="sm"
                                      withDot
                                    />
                                  )}
                                </div>
                                <p className="mt-0.5 line-clamp-1 text-[12px] text-slate-600">
                                  {a.body}
                                </p>
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                                  <span className="font-medium text-slate-700">
                                    {author.firstName} {author.lastName}
                                  </span>
                                  <span className="text-slate-300">·</span>
                                  <span
                                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${
                                      SCOPE_TONE[a.scope] ?? SCOPE_TONE.school_wide
                                    }`}
                                  >
                                    {SCOPE_LABEL[a.scope] ?? a.scope}
                                    {audience && (
                                      <span className="ml-1 normal-case opacity-80">
                                        · {audience}
                                      </span>
                                    )}
                                  </span>
                                  <span className="text-slate-300">·</span>
                                  <span>
                                    {a.publishedAt ? formatDateLong(a.publishedAt) : '—'}
                                  </span>
                                </div>
                              </div>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}

                {filtered.length > recent.length && (
                  <p className="text-center text-[11px] text-slate-500">
                    Aperçu des {recent.length} dernières communications ·{' '}
                    <Link
                      href="/parent/announcements"
                      className="font-bold text-blue-600 hover:text-blue-700"
                    >
                      voir toutes les annonces
                    </Link>
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {hasActiveFilters && totalAll > 0 && activeFilterChips.length > 0 && (
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
