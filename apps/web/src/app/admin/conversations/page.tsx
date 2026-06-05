import { Flag, MessageSquareWarning, ShieldCheck, UserRound } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, isNextNavigationSignal } from '@/lib/api-client';
import type { ConversationReportDto, ConversationReportsResponse } from '@pilotage/contracts';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  StatusBadge,
  formatDateLong,
  type StatusTone,
} from '@pilotage/ui';

export const metadata: Metadata = { title: 'Modération messagerie' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (isNextNavigationSignal(err)) throw err;
    console.error('[admin-conversation-moderation] fetch failed → empty state:', err);
    return null;
  }
}

const STATUS_META: Record<ConversationReportDto['status'], { label: string; tone: StatusTone }> = {
  open: { label: 'À examiner', tone: 'amber' },
  reviewed: { label: 'Examiné', tone: 'info' },
  dismissed: { label: 'Classé', tone: 'neutral' },
};

const THREAD_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  read_only: 'Lecture seule',
  archived: 'Archivée',
  blocked: 'Suspendue',
};

/**
 * Admin moderation oversight (E2-S4). Read-only surface over the admin-only
 * `GET /api/v1/conversations/reports` endpoint (`messaging.moderate`, granted to
 * admins only). Lists reported threads with their context (élève · parent ·
 * enseignant · raison) so an admin can triage safety reports WITHOUT
 * impersonating a participant — the admin never reads message bodies here, only
 * the report metadata. Each list read writes an append-only audit row server-side.
 *
 * Three role-scoped aggregate calls (open / reviewed / dismissed), no client N+1.
 * Copy is factual + non-stigmatising; the focus is the "À examiner" queue.
 */
export default async function AdminConversationModerationPage() {
  const [openResp, reviewedResp, dismissedResp] = await Promise.all([
    safe(
      api<ConversationReportsResponse>('/api/v1/conversations/reports?status=open&limit=100', {
        cache: 'no-store',
      }),
    ),
    safe(
      api<ConversationReportsResponse>('/api/v1/conversations/reports?status=reviewed&limit=100', {
        cache: 'no-store',
      }),
    ),
    safe(
      api<ConversationReportsResponse>('/api/v1/conversations/reports?status=dismissed&limit=100', {
        cache: 'no-store',
      }),
    ),
  ]);

  const openReports = openResp?.data ?? [];
  const reviewedReports = reviewedResp?.data ?? [];
  const dismissedReports = dismissedResp?.data ?? [];
  const history = [...reviewedReports, ...dismissedReports];

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Modération messagerie' },
        ]}
        title="Modération de la messagerie"
        subtitle="Les conversations parent ↔ enseignant signalées pour vérification. Examinez chaque signalement avec bienveillance ; l’historique reste consultable."
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="À examiner"
          value={String(openReports.length)}
          icon={Flag}
          tone={openReports.length > 0 ? 'amber' : 'slate'}
        />
        <KpiCard label="Examinés" value={String(reviewedReports.length)} icon={ShieldCheck} tone="blue" />
        <KpiCard label="Classés" value={String(dismissedReports.length)} icon={MessageSquareWarning} tone="slate" />
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">À examiner</h2>
        <div className="mt-3">
          {openReports.length === 0 ? (
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
              <EmptyState
                icon={ShieldCheck}
                title="Aucun signalement en attente"
                description="Tout est calme. Les conversations signalées par les familles ou les enseignants apparaîtront ici pour vérification."
                tone="green"
              />
            </div>
          ) : (
            <ul className="space-y-3">
              {openReports.map((r) => (
                <ReportRow key={r.id} report={r} />
              ))}
            </ul>
          )}
        </div>
      </section>

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Historique</h2>
          <ul className="mt-3 space-y-3">
            {history.map((r) => (
              <ReportRow key={r.id} report={r} muted />
            ))}
          </ul>
        </section>
      )}
    </PortalShell>
  );
}

function ReportRow({ report, muted }: { report: ConversationReportDto; muted?: boolean }) {
  const meta = STATUS_META[report.status];
  const threadStatus = report.conversationStatus
    ? (THREAD_STATUS_LABEL[report.conversationStatus] ?? report.conversationStatus)
    : null;
  return (
    <li
      className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 sm:p-5 ${
        muted ? 'opacity-90' : 'border-l-[3px] border-amber-400'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={report.status} label={meta.label} tone={meta.tone} />
            {threadStatus && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                Conversation : {threadStatus}
              </span>
            )}
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-700">
            <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
              <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              {report.parentName ?? 'Parent'}
            </span>
            <span className="text-slate-300">↔</span>
            <span className="font-semibold text-slate-900">{report.teacherName ?? 'Enseignant'}</span>
            {report.studentName && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-slate-500">au sujet de {report.studentName}</span>
              </>
            )}
          </p>
        </div>
        <p className="shrink-0 text-xs text-slate-400">{formatDateLong(report.createdAt)}</p>
      </div>

      <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/60">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Signalé par {report.reporterName}
        </p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">
          {report.reason ?? 'Aucune précision fournie.'}
        </p>
      </div>
    </li>
  );
}
