import { CalendarCheck, CheckCircle2, Clock, LogOut, MinusCircle } from 'lucide-react';
import type { Metadata } from 'next';
import type { ComponentType } from 'react';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  SubjectChip,
  formatDateShort,
} from '@pilotage/ui';
import type {
  StudentAttendanceRecord,
  StudentAttendanceResponse,
  StudentAttendanceSummary,
} from '@pilotage/contracts';

import { StudentActivationGate } from '../_components/StudentActivationGate';
import { fetchStudentMe } from '../_lib/student-me';

export const metadata: Metadata = { title: 'Mon assiduité' };
export const dynamic = 'force-dynamic';

type AttendanceFetch =
  | { summary: StudentAttendanceSummary; records: StudentAttendanceRecord[] }
  | { error: true };

const ZERO_SUMMARY: StudentAttendanceSummary = {
  total: 0,
  present: 0,
  absent: 0,
  absentExcused: 0,
  late: 0,
  leftEarly: 0,
};

async function fetchAttendance(): Promise<AttendanceFetch> {
  try {
    const res = await api<StudentAttendanceResponse>('/api/v1/student/attendance', {
      cache: 'no-store',
    });
    return { summary: res.summary ?? ZERO_SUMMARY, records: res.records ?? [] };
  } catch (err) {
    if (err instanceof ApiError) return { error: true };
    throw err;
  }
}

/**
 * Status → kind, factual presentation. Icon + text (never colour alone), never a
 * disciplinary verdict. `variant` stays neutral/soft for absences — an absence is
 * stated, not judged (E8 non-stigmatising mandate).
 */
const STATUS_META: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'neutral'; Icon: ComponentType<{ className?: string }> }
> = {
  present: { label: 'Présent·e', variant: 'success', Icon: CheckCircle2 },
  absent: { label: 'Absence', variant: 'warning', Icon: MinusCircle },
  absent_excused: { label: 'Absence justifiée', variant: 'neutral', Icon: MinusCircle },
  late: { label: 'Retard', variant: 'warning', Icon: Clock },
  left_early: { label: 'Parti·e plus tôt', variant: 'neutral', Icon: LogOut },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, variant: 'neutral' as const, Icon: MinusCircle };
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-3 text-center shadow-sm ring-1 ring-slate-200/60">
      <div className="font-mono text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
    </div>
  );
}

export default async function StudentAttendancePage() {
  const me = await fetchStudentMe();

  if (!me.activated || !me.student) {
    return (
      <PortalShell portal="student" title="Mon assiduité" subtitle="Ton espace élève">
        <StudentActivationGate />
      </PortalShell>
    );
  }

  const headerName = me.student.firstName || 'Élève';
  const classLabel = me.student.classSectionName;
  const shellSubtitle = classLabel ? `${headerName} · ${classLabel}` : headerName;

  const attendance = await fetchAttendance();

  if ('error' in attendance) {
    return (
      <PortalShell portal="student" title="Mon assiduité" subtitle={shellSubtitle}>
        <PageHeader title="Mon assiduité" subtitle="Ta présence ce trimestre" />
        <ErrorState
          title="Impossible de charger ton assiduité"
          description="Réessaie dans un instant."
          className="mt-6"
        />
      </PortalShell>
    );
  }

  const { summary, records } = attendance;
  const absences = summary.absent + summary.absentExcused;
  const presenceRate =
    summary.total > 0 ? Math.round((summary.present / summary.total) * 100) : null;

  return (
    <PortalShell portal="student" title="Mon assiduité" subtitle={shellSubtitle}>
      <PageHeader title="Mon assiduité" subtitle="Ta présence, séance par séance" />

      {summary.total === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          tone="violet"
          title="Aucune séance enregistrée pour l'instant"
          description="Dès que ta présence est notée en classe, tu la retrouveras ici."
          className="mt-6"
        />
      ) : (
        <>
          {/* Calm factual summary — counts only, never a verdict, never un peer. */}
          <div className="mt-6">
            {presenceRate != null && (
              <p className="mb-3 text-sm text-slate-600">
                Tu as été présent·e à{' '}
                <span className="font-bold text-slate-900">{presenceRate}%</span> des séances ce
                trimestre.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Séances" value={summary.total} />
              <StatTile label="Présences" value={summary.present} />
              <StatTile label="Absences" value={absences} />
              <StatTile label="Retards" value={summary.late} />
            </div>
          </div>

          <ul className="mt-8 space-y-2" aria-label="Mes séances récentes">
            {records.map((r) => {
              const meta = statusMeta(r.status);
              const Icon = meta.Icon;
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/60"
                >
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {formatDateShort(r.date)}
                  </span>
                  {r.subjectName && (
                    <SubjectChip subjectCode={r.subjectName} label={r.subjectName} size="sm" />
                  )}
                  <Badge variant={meta.variant} className="ml-auto">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {meta.label}
                  </Badge>
                  {r.justification && (
                    <p className="w-full text-xs italic text-slate-500">
                      Motif : {r.justification}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </PortalShell>
  );
}
