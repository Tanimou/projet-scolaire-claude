import { CheckCircle2, Clock, FileWarning, UserX } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  StatusBadge,
  SubjectChip,
  formatDateShort,
} from '@pilotage/ui';

import { ChildSelector } from '../_components/ChildSelector';

export const metadata: Metadata = { title: 'Absences et retards' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
}

interface AttendanceRecord {
  id: string;
  status: 'present' | 'absent' | 'absent_excused' | 'late' | 'left_early';
  arrivedAt: string | null;
  comment: string | null;
  recordedAt: string;
  justifiedAt: string | null;
  justification: string | null;
  classSession: {
    date: string;
    teachingAssignment: {
      subject: { id: string; name: string; color: string | null };
      classSection: { id: string; name: string };
    } | null;
  };
}

interface AttendanceResp {
  records: AttendanceRecord[];
  summary: {
    total: number;
    present: number;
    absent: number;
    absentExcused: number;
    late: number;
    leftEarly: number;
  };
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const STATUS_LABEL: Record<AttendanceRecord['status'], string> = {
  present: 'Présent',
  absent: 'Absent',
  absent_excused: 'Absent (justifié)',
  late: 'Retard',
  left_early: 'Parti·e tôt',
};

const STATUS_TONE: Record<
  AttendanceRecord['status'],
  'success' | 'danger' | 'sky' | 'warning'
> = {
  present: 'success',
  absent: 'danger',
  absent_excused: 'sky',
  late: 'warning',
  left_early: 'warning',
};

const PAGE_SIZE = 25;

export default async function ParentAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const studentsResp = await safe(
    api<{ data: StudentSummary[] }>('/api/v1/students', { cache: 'no-store' }),
  );
  const children = studentsResp?.data ?? [];

  if (children.length === 0) {
    return (
      <PortalShell portal="parent">
        <PageHeader
          breadcrumb={[
            { label: 'Tableau de bord', href: '/parent/dashboard' },
            { label: 'Absences et retards' },
          ]}
          title="Absences et retards"
        />
        <EmptyState
          icon={UserX}
          title="Aucun enfant rattaché"
          description="Les présences et absences apparaîtront ici dès qu'un enfant sera lié à votre compte."
          tone="amber"
          className="mt-6"
        />
      </PortalShell>
    );
  }

  const activeStudentId =
    sp.studentId && children.find((c) => c.id === sp.studentId)
      ? sp.studentId
      : children[0]!.id;

  const resp = await safe(
    api<AttendanceResp>(`/api/v1/attendance/students/${activeStudentId}`, {
      cache: 'no-store',
    }),
  );
  const records = resp?.records ?? [];
  const summary = resp?.summary ?? {
    total: 0,
    present: 0,
    absent: 0,
    absentExcused: 0,
    late: 0,
    leftEarly: 0,
  };

  const unjustified = records.filter(
    (r) => r.status === 'absent' && !r.justifiedAt,
  ).length;

  const total = records.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const pageRows = records.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Absences et retards' },
        ]}
        title="Absences et retards"
        subtitle="Historique d'assiduité — pensez à transmettre les justificatifs sous 48 h"
      />

      <div className="mt-4">
        <ChildSelector children={children} activeStudentId={activeStudentId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={CheckCircle2} tone="green" label="PRÉSENCES" value={summary.present}>
          Sur {summary.total} séances
        </KpiCard>
        <KpiCard icon={UserX} tone="rose" label="ABSENCES" value={summary.absent}>
          {summary.absentExcused} justifiée{summary.absentExcused > 1 ? 's' : ''}
        </KpiCard>
        <KpiCard icon={Clock} tone="amber" label="RETARDS" value={summary.late}>
          {summary.leftEarly} départ{summary.leftEarly > 1 ? 's' : ''} anticipé
          {summary.leftEarly > 1 ? 's' : ''}
        </KpiCard>
        <KpiCard
          icon={FileWarning}
          tone="orange"
          label="À JUSTIFIER"
          value={unjustified}
        >
          Absences sans justificatif
        </KpiCard>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {pageRows.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Aucune absence enregistrée"
            description="L'historique des présences et absences apparaîtra ici quand les enseignants feront l'appel."
            tone="slate"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Cours</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Justification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((r) => {
                    const subj = r.classSession.teachingAssignment?.subject;
                    const cs = r.classSession.teachingAssignment?.classSection;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {formatDateShort(r.classSession.date)}
                        </td>
                        <td className="px-4 py-3">
                          {subj ? (
                            <div className="flex items-center gap-2">
                              <SubjectChip
                                subjectCode={subj.name}
                                label={subj.name}
                                size="sm"
                              />
                              {cs && (
                                <span className="text-[11px] text-slate-500">{cs.name}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={STATUS_LABEL[r.status]}
                            tone={STATUS_TONE[r.status]}
                            size="sm"
                            withDot
                          />
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {r.justifiedAt ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" />
                              {r.justification ?? 'Justifiée'}
                            </span>
                          ) : r.status === 'absent' ? (
                            <span className="text-rose-600">À justifier</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'enregistrement', plural: 'enregistrements' }}
            />
          </>
        )}
      </section>
    </PortalShell>
  );
}
