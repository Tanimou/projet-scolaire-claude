import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCheck,
  Megaphone,
  Pin,
  User,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { PageHeader, StatusBadge, formatDateLong } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Annonce' };
export const dynamic = 'force-dynamic';

interface AnnouncementDetail {
  id: string;
  title: string;
  body: string;
  scope: string;
  priority: 'normal' | 'high' | 'urgent';
  publishedAt: string | null;
  expiresAt: string | null;
  pinned: boolean;
  authorRoleHint: 'admin' | 'teacher' | null;
  cycle?: { name: string } | null;
  gradeLevel?: { name: string } | null;
  classSection?: { name: string } | null;
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

const PRIORITY_TONE: Record<
  'normal' | 'high' | 'urgent',
  { card: string; icon: string; badge: 'neutral' | 'warning' | 'danger' }
> = {
  normal: { card: 'ring-slate-200/70', icon: 'bg-blue-100 text-blue-700', badge: 'neutral' },
  high: { card: 'ring-amber-200', icon: 'bg-amber-100 text-amber-700', badge: 'warning' },
  urgent: { card: 'ring-rose-300/80', icon: 'bg-rose-100 text-rose-700', badge: 'danger' },
};

const PRIORITY_LABEL: Record<'normal' | 'high' | 'urgent', string> = {
  normal: 'Normale',
  high: 'Importante',
  urgent: 'Urgente',
};

function audienceLine(a: AnnouncementDetail): string {
  const base = SCOPE_LABEL[a.scope] ?? a.scope;
  const target =
    a.classSection?.name ??
    a.gradeLevel?.name ??
    a.cycle?.name ??
    (a.student ? `${a.student.firstName} ${a.student.lastName}` : null);
  return target ? `${base} · ${target}` : base;
}

export default async function ParentAnnouncementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let data: AnnouncementDetail | null = null;
  try {
    // GET auto-marks the receipt as read for parents (see API controller)
    data = await api<AnnouncementDetail>(`/api/v1/announcements/${id}`, {
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }

  if (!data) notFound();

  const tone = PRIORITY_TONE[data.priority];
  const Icon = data.priority === 'urgent' ? AlertTriangle : Megaphone;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Annonces', href: '/parent/announcements' },
          { label: data.title },
        ]}
        title={data.title}
        subtitle={`Publiée par ${data.authorRoleHint ? ROLE_LABEL[data.authorRoleHint] ?? 'l\'établissement' : "l'établissement"}`}
        actions={
          <Link
            href="/parent/announcements"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" /> Retour aux annonces
          </Link>
        }
      />

      <article
        className={`mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ${tone.card}`}
      >
        <header className="flex flex-wrap items-start gap-4 border-b border-slate-100 bg-gradient-to-br from-slate-50/60 to-white px-6 py-5">
          <div
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${tone.icon}`}
            aria-hidden
          >
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {data.pinned && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200"
                  title="Annonce épinglée"
                >
                  <Pin className="h-3 w-3" /> Épinglée
                </span>
              )}
              <StatusBadge
                label={PRIORITY_LABEL[data.priority]}
                tone={tone.badge}
                size="sm"
              />
              {data.readAt && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                  <CheckCheck className="h-3 w-3" /> Lue
                </span>
              )}
            </div>
            <h1 className="mt-2 text-xl font-bold text-slate-900">{data.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              {data.publishedAt && (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" /> {formatDateLong(data.publishedAt)}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {audienceLine(data)}
              </span>
              {data.authorRoleHint && (
                <span className="inline-flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />{' '}
                  {ROLE_LABEL[data.authorRoleHint] ?? data.authorRoleHint}
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="px-6 py-6">
          <div className="prose prose-slate max-w-none whitespace-pre-line text-[15px] leading-relaxed text-slate-800">
            {data.body}
          </div>
        </div>

        {data.expiresAt && (
          <footer className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3 text-xs text-slate-500">
            <Calendar className="h-3.5 w-3.5" />
            Cette annonce expirera le{' '}
            <span className="font-semibold text-slate-700">
              {formatDateLong(data.expiresAt)}
            </span>
          </footer>
        )}
      </article>

      <aside className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50/50 px-4 py-3 text-xs text-emerald-800 ring-1 ring-emerald-200">
        <Check className="h-4 w-4 shrink-0" />
        <span>
          Cette annonce a été automatiquement marquée comme lue en l&apos;ouvrant. Vous
          pouvez retrouver l&apos;ensemble de vos communications dans la liste des
          annonces.
        </span>
      </aside>
    </PortalShell>
  );
}
