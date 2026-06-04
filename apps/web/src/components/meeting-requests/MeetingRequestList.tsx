import {
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  MessageSquarePlus,
  ShieldAlert,
  TrendingDown,
  UserRound,
  UserX,
} from 'lucide-react';

import {
  EmptyState,
  KpiCard,
  StatusBadge,
  SubjectChip,
  formatDateLong,
  formatInDays,
  type StatusTone,
} from '@pilotage/ui';

import { MeetingRequestActions } from './MeetingRequestActions';
import {
  ALERT_CODE_LABEL,
  SEVERITY_LABEL,
  type AlertCode,
  type AlertSeverity,
  type MeetingRequest,
  type MeetingRequestPortal,
  type MeetingRequestStatus,
} from './types';

/**
 * MeetingRequestList — the ONE shared triage surface for E1-S3, rendered by
 * both `/teacher/meeting-requests` and `/admin/meeting-requests`.
 *
 * Recipe mirrors `admin/alerts`: a KPI row + two sections ("À traiter" /
 * "Historique"), a severity-striped row that carries the originating alert's
 * explainability (child · rule · subject · severity) so the assignee sees *why*
 * a family wrote in without drilling in. Pending requests are sorted
 * oldest-first (longest-waiting family on top) with severity as a tiebreak.
 *
 * Responsive: a real `<table>` (with `<th scope="col">`) on `sm+`, wrapped in
 * `overflow-x-auto`; a `role="list"` of stacked cards on mobile. The resolve
 * controls are the only interactive client island (`MeetingRequestActions`).
 */

const ALERT_ICON: Record<AlertCode, typeof AlertTriangle> = {
  LOW_SUBJECT_AVG: TrendingDown,
  NEGATIVE_TREND: TrendingDown,
  REPEATED_FAILURE: AlertTriangle,
  MISSING_ASSESSMENT: AlertTriangle,
  HIGH_ABSENCE: UserX,
  TEACHER_COMMENT_FLAG: ShieldAlert,
  BEHAVIOR_ALERT: ShieldAlert,
};

const SEVERITY_STRIPE: Record<AlertSeverity, string> = {
  high: 'border-rose-500',
  medium: 'border-amber-500',
  low: 'border-sky-500',
};

const SEVERITY_TONE: Record<AlertSeverity, StatusTone> = {
  high: 'danger',
  medium: 'warning',
  low: 'sky',
};

const STATUS_TONE: Record<MeetingRequestStatus, StatusTone> = {
  open: 'warning',
  resolved: 'success',
  cancelled: 'neutral',
};

const STATUS_LABEL: Record<MeetingRequestStatus, string> = {
  open: 'À traiter',
  resolved: 'Traitée',
  cancelled: 'Clôturée',
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Whole-day age of a still-open request (for the "en attente depuis N j" pill). */
function ageInDays(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.floor((Date.now() - then) / 86_400_000);
}

function sortPending(rows: MeetingRequest[]): MeetingRequest[] {
  // Oldest-first (longest-waiting family up top), severity as the tiebreak so a
  // critical alert outranks a low one of similar age — the action bias.
  return [...rows].sort((a, b) => {
    const t = new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime();
    if (t !== 0) return t;
    return SEVERITY_RANK[a.alertSeverity] - SEVERITY_RANK[b.alertSeverity];
  });
}

function sortHistory(rows: MeetingRequest[]): MeetingRequest[] {
  // Most-recently-handled first.
  return [...rows].sort((a, b) => {
    const at = a.resolvedAt ? new Date(a.resolvedAt).getTime() : 0;
    const bt = b.resolvedAt ? new Date(b.resolvedAt).getTime() : 0;
    return bt - at;
  });
}

export function MeetingRequestList({
  requests,
  portal,
}: {
  requests: MeetingRequest[];
  portal: MeetingRequestPortal;
}) {
  const pending = sortPending(requests.filter((r) => r.status === 'open'));
  const history = sortHistory(requests.filter((r) => r.status !== 'open'));

  const resolvedCount = history.filter((r) => r.status === 'resolved').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          icon={MessageSquarePlus}
          tone={pending.length > 0 ? 'orange' : 'green'}
          label="À TRAITER"
          value={pending.length}
        >
          Familles en attente d&apos;un retour
        </KpiCard>
        <KpiCard icon={CheckCircle2} tone="green" label="TRAITÉES" value={resolvedCount}>
          Échanges planifiés
        </KpiCard>
        <KpiCard
          icon={MessageSquare}
          tone="slate"
          label="CLÔTURÉES"
          value={history.length - resolvedCount}
        >
          Clôturées sans suite
        </KpiCard>
      </div>

      {/* ───────────── À traiter ───────────── */}
      <Section
        title="À traiter"
        count={pending.length}
        tone="warning"
        emptyIcon={CheckCircle2}
        emptyTitle="Aucune demande en attente"
        emptyDescription="Les familles n'ont pas de demande de rendez-vous ouverte. Vous serez notifié dès qu'une arrive."
        rows={pending}
        portal={portal}
      />

      {/* ───────────── Historique ───────────── */}
      <Section
        title="Historique"
        count={history.length}
        tone="neutral"
        emptyIcon={MessageSquare}
        emptyTitle="Aucun historique pour le moment"
        emptyDescription="Les demandes traitées ou clôturées apparaîtront ici."
        rows={history}
        portal={portal}
      />
    </div>
  );
}

function Section({
  title,
  count,
  tone,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  rows,
  portal,
}: {
  title: string;
  count: number;
  tone: StatusTone;
  emptyIcon: typeof CheckCircle2;
  emptyTitle: string;
  emptyDescription: string;
  rows: MeetingRequest[];
  portal: MeetingRequestPortal;
}) {
  const headerBg = tone === 'warning' ? 'bg-amber-50/70' : 'bg-slate-50/70';
  const stripe = tone === 'warning' ? 'border-amber-500' : 'border-slate-300';

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
      <div
        className={`flex items-center justify-between gap-2 border-l-4 ${stripe} ${headerBg} px-5 py-3`}
      >
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        <StatusBadge label={String(count)} tone={tone} size="sm" />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
          tone="slate"
        />
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <ul role="list" className="divide-y divide-slate-100 sm:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <RequestCard request={r} portal={portal} />
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-4 py-3">
                    Élève
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Alerte
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Demandée
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Statut
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <RequestRow key={r.id} request={r} portal={portal} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function AlertContext({ request }: { request: MeetingRequest }) {
  const Icon = ALERT_ICON[request.alertCode];
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          request.alertSeverity === 'high'
            ? 'bg-rose-100 text-rose-700'
            : request.alertSeverity === 'medium'
              ? 'bg-amber-100 text-amber-800'
              : 'bg-sky-100 text-sky-700'
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            {ALERT_CODE_LABEL[request.alertCode]}
          </span>
          {request.subjectCode && request.subjectName && (
            <SubjectChip subjectCode={request.subjectCode} label={request.subjectName} size="sm" />
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-600" title={request.alertTitle}>
          {request.alertTitle}
        </p>
      </div>
    </div>
  );
}

function StudentCell({ request }: { request: MeetingRequest }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-bold text-slate-900">{request.studentName}</span>
        {request.classSectionName && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
            {request.classSectionName}
          </span>
        )}
      </div>
      {request.requestedByName && (
        <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-600">
          <UserRound className="h-3 w-3 text-slate-400" aria-hidden />
          {request.requestedByName}
        </p>
      )}
    </div>
  );
}

function RequestedAtCell({ request }: { request: MeetingRequest }) {
  const days = request.status === 'open' ? ageInDays(request.requestedAt) : 0;
  return (
    <div className="space-y-1">
      <div className="text-xs text-slate-600">
        <span>{formatDateLong(request.requestedAt)}</span>
        <span className="ml-1 text-slate-400">· {formatInDays(request.requestedAt)}</span>
      </div>
      {days >= 2 && (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
          En attente depuis {days}&nbsp;jour{days > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

function StatusCell({ request }: { request: MeetingRequest }) {
  return (
    <StatusBadge
      label={STATUS_LABEL[request.status]}
      tone={STATUS_TONE[request.status]}
      size="sm"
      withDot
    />
  );
}

function RequestRow({
  request,
  portal,
}: {
  request: MeetingRequest;
  portal: MeetingRequestPortal;
}) {
  return (
    <tr className={`border-l-4 ${SEVERITY_STRIPE[request.alertSeverity]} hover:bg-slate-50/60`}>
      <td className="px-4 py-3 align-top">
        <StudentCell request={request} />
      </td>
      <td className="px-4 py-3 align-top">
        <AlertContext request={request} />
      </td>
      <td className="px-4 py-3 align-top">
        <RequestedAtCell request={request} />
      </td>
      <td className="px-4 py-3 align-top">
        <StatusCell request={request} />
      </td>
      <td className="px-4 py-3 text-right align-top">
        <MeetingRequestActions
          id={request.id}
          status={request.status}
          studentName={request.studentName}
          portal={portal}
        />
      </td>
    </tr>
  );
}

function RequestCard({
  request,
  portal,
}: {
  request: MeetingRequest;
  portal: MeetingRequestPortal;
}) {
  return (
    <div className={`border-l-4 ${SEVERITY_STRIPE[request.alertSeverity]} p-4`}>
      <div className="flex items-start justify-between gap-2">
        <StudentCell request={request} />
        <StatusCell request={request} />
      </div>
      <div className="mt-3">
        <AlertContext request={request} />
      </div>
      <div className="mt-3">
        <RequestedAtCell request={request} />
      </div>
      {request.status === 'open' && (
        <div className="mt-3">
          <MeetingRequestActions
            id={request.id}
            status={request.status}
            studentName={request.studentName}
            portal={portal}
          />
        </div>
      )}
    </div>
  );
}
