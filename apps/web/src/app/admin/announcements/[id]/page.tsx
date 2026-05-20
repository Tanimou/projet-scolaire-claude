import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Mail,
  Megaphone,
  Paperclip,
  Pin,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  Avatar,
  DonutChart,
  EmptyState,
  KpiCard,
  PageHeader,
  ProgressBar,
  StatusBadge,
  formatDateLong,
  formatRelativeTime,
} from '@pilotage/ui';

import { DetailActions } from './DetailActions';
import { RecipientsFilters } from './RecipientsFilters';
import type {
  AnnouncementAttachment,
  AnnouncementDetail,
  AnnouncementPriority,
  AnnouncementRecipient,
  AnnouncementScope,
  AnnouncementStatus,
  RecipientReadFilter,
} from './types';

export const metadata: Metadata = { title: 'Annonce — détail' };
export const dynamic = 'force-dynamic';

const SCOPE_LABEL: Record<AnnouncementScope, string> = {
  school_wide: "Toute l'école",
  cycle_scope: 'Cycle',
  grade_level_scope: 'Niveau',
  class_section_scope: 'Classe',
  individual_student: 'Élève (parents)',
  individual_user: 'Utilisateur',
};

const SCOPE_TONE: Record<
  AnnouncementScope,
  'info' | 'violet' | 'sky' | 'amber' | 'teal' | 'neutral'
> = {
  school_wide: 'violet',
  cycle_scope: 'sky',
  grade_level_scope: 'info',
  class_section_scope: 'teal',
  individual_student: 'amber',
  individual_user: 'neutral',
};

const PRIORITY_LABEL: Record<AnnouncementPriority, string> = {
  normal: 'Normale',
  high: 'Haute',
  urgent: 'Urgente',
};

const PRIORITY_TONE: Record<AnnouncementPriority, 'neutral' | 'warning' | 'danger'> = {
  normal: 'neutral',
  high: 'warning',
  urgent: 'danger',
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

// Friendly French labels for the role slugs we expect to surface most often.
// Falls back to the raw slug if a school added a custom role we don't know.
const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super-admin',
  school_admin: 'Admin école',
  teacher: 'Enseignant·e',
  parent: 'Parent',
  guardian: 'Tuteur·trice',
  student: 'Élève',
  staff: 'Personnel',
};

const ROLE_TONE: Record<string, 'violet' | 'info' | 'teal' | 'amber' | 'sky' | 'neutral'> = {
  super_admin: 'violet',
  school_admin: 'violet',
  teacher: 'info',
  parent: 'amber',
  guardian: 'amber',
  student: 'teal',
  staff: 'sky',
};

function statusOf(a: AnnouncementDetail, now: Date): AnnouncementStatus {
  if (!a.publishedAt) return 'draft';
  if (a.expiresAt && new Date(a.expiresAt) < now) return 'expired';
  return 'published';
}

function audienceLabel(a: AnnouncementDetail): string {
  const main = SCOPE_LABEL[a.scope] ?? a.scope;
  const sub =
    a.classSection?.name ??
    a.gradeLevel?.name ??
    a.cycle?.name ??
    (a.student ? `${a.student.firstName} ${a.student.lastName}` : null);
  return sub ? `${main} · ${sub}` : main;
}

function formatMinutesToRead(min: number | null): string {
  if (min == null || !Number.isFinite(min)) return '—';
  if (min < 1) return "< 1 min";
  if (min < 60) return `${Math.round(min)} min`;
  const hr = min / 60;
  if (hr < 24) return `${hr.toFixed(hr < 10 ? 1 : 0)} h`;
  const day = hr / 24;
  return `${day.toFixed(day < 10 ? 1 : 0)} j`;
}

function bestRoleSlug(roles: string[]): string | null {
  if (roles.length === 0) return null;
  // Priorities mirror how the rest of the app surfaces "primary" identity.
  const priority = [
    'super_admin',
    'school_admin',
    'staff',
    'teacher',
    'parent',
    'guardian',
    'student',
  ];
  for (const p of priority) if (roles.includes(p)) return p;
  return roles[0] ?? null;
}

function roleLabelOf(slug: string): string {
  return ROLE_LABEL[slug] ?? slug.replace(/_/g, ' ');
}

function recipientName(r: AnnouncementRecipient): string {
  if (!r.userProfile) return 'Destinataire supprimé';
  return `${r.userProfile.firstName} ${r.userProfile.lastName}`.trim() || '—';
}

export default async function AnnouncementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; read?: string; role?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  let a: AnnouncementDetail;
  try {
    a = await api<AnnouncementDetail>(`/api/v1/announcements/${id}`, {
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const now = new Date();
  const st = statusOf(a, now);
  const isDraft = st === 'draft';
  const isExpired = st === 'expired';

  const stats = a.stats ?? {
    total: 0,
    read: 0,
    unread: 0,
    readRate: 0,
    firstReadAt: null,
    lastReadAt: null,
    medianMinutesToRead: null,
  };
  const recipients = a.recipients ?? [];

  // ---------- Recipient filter pipeline ----------
  const search = (sp.q ?? '').trim().toLowerCase();
  const readFilter: RecipientReadFilter =
    sp.read === 'read' || sp.read === 'unread' ? sp.read : '';
  const roleFilter = (sp.role ?? '').trim();

  // Build role facets off the FULL roster so the dropdown stays stable even
  // when the user filters down to a subset.
  const roleCounts = new Map<string, number>();
  for (const r of recipients) {
    const slug = bestRoleSlug(r.userProfile?.roles ?? []);
    if (slug) roleCounts.set(slug, (roleCounts.get(slug) ?? 0) + 1);
  }
  const roleOptions = Array.from(roleCounts.entries())
    .sort((x, y) => y[1] - x[1])
    .map(([slug, count]) => ({
      value: slug,
      label: roleLabelOf(slug),
      count,
    }));

  const filtered = recipients.filter((r) => {
    if (readFilter === 'read' && !r.readAt) return false;
    if (readFilter === 'unread' && r.readAt) return false;
    if (roleFilter) {
      const slug = bestRoleSlug(r.userProfile?.roles ?? []);
      if (slug !== roleFilter) return false;
    }
    if (search) {
      const hay = [
        r.userProfile?.firstName,
        r.userProfile?.lastName,
        r.userProfile?.email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Split filtered roster: unread first (action-oriented), then read.
  const filteredUnread = filtered.filter((r) => !r.readAt);
  const filteredRead = filtered
    .filter((r) => r.readAt)
    .sort((x, y) => (y.readAt ?? '').localeCompare(x.readAt ?? ''));

  const activeFilterChips: string[] = [];
  if (readFilter === 'read') activeFilterChips.push('Statut : Lues');
  if (readFilter === 'unread') activeFilterChips.push('Statut : Non lues');
  if (roleFilter) activeFilterChips.push(`Rôle : ${roleLabelOf(roleFilter)}`);
  if (search) activeFilterChips.push(`Recherche : « ${search} »`);

  const readRatePct = Math.round((stats.readRate ?? 0) * 100);
  const readRateTone: 'slate' | 'green' | 'blue' | 'amber' | 'rose' =
    stats.total === 0
      ? 'slate'
      : readRatePct >= 80
        ? 'green'
        : readRatePct >= 50
          ? 'blue'
          : readRatePct >= 25
            ? 'amber'
            : 'rose';

  const attachments = (a.attachments ?? []) as AnnouncementAttachment[];

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Communications', href: '/admin/communications' },
          { label: a.title },
        ]}
        title={a.title}
        subtitle={
          isDraft
            ? `Brouillon créé le ${formatDateLong(a.createdAt)}`
            : a.publishedAt
              ? `Publiée le ${formatDateLong(a.publishedAt)}${
                  a.author ? ` · par ${a.author.firstName} ${a.author.lastName}` : ''
                }`
              : `Créée le ${formatDateLong(a.createdAt)}`
        }
        actions={<DetailActions id={a.id} isDraft={isDraft} />}
      />

      {/* Identity badges row */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusBadge label={STATUS_LABEL[st]} tone={STATUS_TONE[st]} size="sm" withDot />
        <StatusBadge
          label={audienceLabel(a)}
          tone={SCOPE_TONE[a.scope] ?? 'neutral'}
          size="sm"
        />
        <StatusBadge
          label={`Priorité ${PRIORITY_LABEL[a.priority] ?? a.priority}`}
          tone={PRIORITY_TONE[a.priority] ?? 'neutral'}
          size="sm"
          withDot={a.priority === 'urgent'}
        />
        {a.pinned && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200">
            <Pin className="h-3 w-3" /> Épinglée
          </span>
        )}
        {a.expiresAt && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-600 ring-1 ring-slate-200">
            <Calendar className="h-3 w-3" />
            {isExpired
              ? `Expirée le ${formatDateLong(a.expiresAt)}`
              : `Expire le ${formatDateLong(a.expiresAt)}`}
          </span>
        )}
      </div>

      {/* Action strip — draft */}
      {isDraft && (
        <div className="mt-6 flex flex-wrap items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm text-amber-900">
            <p className="font-bold">Cette annonce n&apos;a pas encore été publiée</p>
            <p className="mt-0.5 text-xs text-amber-800/80">
              Vérifiez la portée et la date d&apos;expiration, puis cliquez sur « Publier maintenant ».
              Les destinataires recevront aussi une notification.
            </p>
          </div>
        </div>
      )}

      {/* Action strip — expired */}
      {isExpired && (
        <div className="mt-6 flex flex-wrap items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <Clock className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm text-slate-700">
            <p className="font-bold">Cette annonce est expirée</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Elle n&apos;apparaît plus dans les boîtes des destinataires, mais reste consultable ici
              pour archivage.
            </p>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} tone="violet" label="DESTINATAIRES" value={stats.total}>
          {stats.total === 0
            ? isDraft
              ? 'Publiez pour générer les reçus'
              : 'Aucun destinataire ciblé'
            : `${stats.total === 1 ? '1 personne touchée' : `${stats.total} personnes touchées`}`}
        </KpiCard>
        <KpiCard icon={Eye} tone="green" label="LECTURES" value={stats.read}>
          {stats.unread > 0
            ? `${stats.unread} non lue${stats.unread > 1 ? 's' : ''}`
            : stats.total === 0
              ? '—'
              : 'Tous les destinataires ont lu'}
        </KpiCard>
        <KpiCard
          icon={CheckCircle2}
          tone={readRateTone}
          label="TAUX DE LECTURE"
          value={stats.total === 0 ? '—' : `${readRatePct} %`}
        >
          {stats.medianMinutesToRead != null
            ? `Médiane : ${formatMinutesToRead(stats.medianMinutesToRead)} après publication`
            : stats.total > 0
              ? 'En attente des premières lectures'
              : '—'}
        </KpiCard>
        <KpiCard
          icon={Clock}
          tone={stats.lastReadAt ? 'blue' : 'orange'}
          label="DERNIÈRE LECTURE"
          value={stats.lastReadAt ? formatRelativeTime(stats.lastReadAt, now) : '—'}
        >
          {stats.firstReadAt
            ? `Première : ${formatRelativeTime(stats.firstReadAt, now)}`
            : stats.total > 0
              ? "Personne n'a encore ouvert"
              : '—'}
        </KpiCard>
      </div>

      {/* Body + read-rate widget */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Body */}
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60 lg:col-span-2">
          <header className="mb-3 flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600">
              Contenu de l&apos;annonce
            </h2>
          </header>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
            {a.body || (
              <span className="italic text-slate-400">Aucun contenu rédigé.</span>
            )}
          </div>

          {attachments.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                <Paperclip className="h-3 w-3" />
                Pièces jointes ({attachments.length})
              </div>
              <ul className="flex flex-wrap gap-2">
                {attachments.map((att, idx) => {
                  const label = att.name ?? att.url ?? `Pièce ${idx + 1}`;
                  const inner = (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">
                      <Paperclip className="h-3 w-3 text-slate-400" />
                      {label}
                    </span>
                  );
                  return (
                    <li key={idx}>
                      {att.url ? (
                        <a href={att.url} target="_blank" rel="noopener noreferrer">
                          {inner}
                        </a>
                      ) : (
                        inner
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {/* Read rate panel */}
        <aside className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <header className="mb-4 flex items-center gap-2">
            <Eye className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600">
              Engagement
            </h2>
          </header>

          {stats.total === 0 ? (
            <p className="text-sm text-slate-500">
              {isDraft
                ? 'Les reçus seront générés au moment de la publication.'
                : 'Cette annonce n’a pas de destinataires.'}
            </p>
          ) : (
            <>
              <DonutChart
                height={180}
                innerRatio={0.68}
                segments={[
                  {
                    label: 'Lues',
                    value: stats.read,
                    color: '#10b981',
                    hint: `${stats.read}`,
                  },
                  {
                    label: 'Non lues',
                    value: stats.unread,
                    color: '#f59e0b',
                    hint: `${stats.unread}`,
                  },
                ]}
                centerLabel={`${readRatePct}%`}
                centerSubLabel="Lu"
                legendPosition="bottom"
              />
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <span>Progression</span>
                  <span className="text-slate-700">
                    {stats.read} / {stats.total}
                  </span>
                </div>
                <ProgressBar
                  value={stats.read}
                  max={Math.max(1, stats.total)}
                  tone={readRatePct >= 80 ? 'success' : readRatePct >= 50 ? 'brand' : 'warning'}
                />
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Recipients */}
      {recipients.length > 0 && (
        <section className="mt-8">
          <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-600">
                <Users className="h-4 w-4 text-slate-400" />
                Destinataires
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-600">
                  {filtered.length}
                  {filtered.length !== recipients.length ? ` / ${recipients.length}` : ''}
                </span>
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Filtrez par statut de lecture, rôle, ou recherchez par nom / e-mail.
              </p>
            </div>
          </header>

          <RecipientsFilters
            q={search}
            readStatus={readFilter}
            roleSlug={roleFilter}
            roleOptions={roleOptions}
          />

          <div className="mt-4 space-y-5">
            {filtered.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Aucun destinataire avec ces filtres"
                description="Élargissez la sélection, retirez un filtre, ou videz la recherche pour voir plus de monde."
                tone="slate"
              />
            ) : (
              <>
                {filteredUnread.length > 0 && (
                  <RecipientsBucket
                    label="Non lues"
                    tone="warning"
                    items={filteredUnread}
                    now={now}
                  />
                )}
                {filteredRead.length > 0 && (
                  <RecipientsBucket
                    label="Lues"
                    tone="success"
                    items={filteredRead}
                    now={now}
                  />
                )}
              </>
            )}
          </div>

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
        </section>
      )}

      {/* No recipients (draft or scope with no match) */}
      {recipients.length === 0 && (
        <section className="mt-8">
          <EmptyState
            icon={isDraft ? Megaphone : Users}
            title={
              isDraft
                ? 'Pas encore de destinataires'
                : "Cette annonce n'a touché personne"
            }
            description={
              isDraft
                ? 'Les destinataires sont calculés à la publication selon la portée choisie.'
                : 'Vérifiez la portée — elle n’a peut-être pas matché de famille / classe / utilisateur.'
            }
            tone="slate"
          />
        </section>
      )}
    </PortalShell>
  );
}

function RecipientsBucket({
  label,
  tone,
  items,
  now,
}: {
  label: string;
  tone: 'success' | 'warning';
  items: AnnouncementRecipient[];
  now: Date;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
          {label}
        </h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-600">
          {items.length}
        </span>
        {tone === 'warning' && items.length > 0 && (
          <StatusBadge label="À relancer" tone="warning" size="sm" withDot />
        )}
      </div>
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Destinataire</th>
                <th className="px-4 py-3">Rôle</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((r) => {
                const name = recipientName(r);
                const slug = bestRoleSlug(r.userProfile?.roles ?? []);
                const roleLabel = slug ? roleLabelOf(slug) : '—';
                const roleTone = slug ? (ROLE_TONE[slug] ?? 'neutral') : 'neutral';
                return (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          firstName={r.userProfile?.firstName}
                          lastName={r.userProfile?.lastName}
                          size="sm"
                        />
                        <span className="truncate text-sm font-bold text-slate-900">
                          {name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge label={roleLabel} tone={roleTone} size="sm" />
                    </td>
                    <td className="px-4 py-3">
                      {r.userProfile?.email ? (
                        <a
                          href={`mailto:${r.userProfile.email}`}
                          className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:accent-text hover:underline"
                        >
                          <Mail className="h-3 w-3 text-slate-400" />
                          {r.userProfile.email}
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.readAt ? (
                        <div className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                          <Eye className="h-3.5 w-3.5" />
                          <span>Lue {formatRelativeTime(r.readAt, now)}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-[11px] text-amber-700">
                          <EyeOff className="h-3.5 w-3.5" />
                          <span>Non lue</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {tone === 'success' && items.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-400">
          Triées par date de lecture (la plus récente en premier).
        </p>
      )}
    </div>
  );
}

