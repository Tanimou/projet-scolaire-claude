import { CheckSquare, Clock, FileWarning, UserX } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  AvatarNameCell,
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  RowActions,
  StatusBadge,
  formatDateShort,
} from '@pilotage/ui';

export const metadata: Metadata = { title: 'Présences' };
export const dynamic = 'force-dynamic';

interface AttendanceOverview {
  kpis: {
    present: number;
    absent: number;
    late: number;
    leftEarly: number;
    excused: number;
    unjustifiedAbsences: number;
  };
  records: Array<{
    id: string;
    status: 'present' | 'absent' | 'absent_excused' | 'late' | 'left_early';
    justification: string | null;
    createdAt: string;
    student: { id: string; firstName: string; lastName: string };
    date: string;
    classSectionName: string;
    subjectName: string;
  }>;
}

const STATUS_LABEL: Record<AttendanceOverview['records'][number]['status'], string> = {
  present: 'Présent',
  absent: 'Absent',
  absent_excused: 'Absent (justifié)',
  late: 'Retard',
  left_early: 'Parti·e tôt',
};

const STATUS_TONE: Record<
  AttendanceOverview['records'][number]['status'],
  'success' | 'danger' | 'warning' | 'neutral' | 'sky'
> = {
  present: 'success',
  absent: 'danger',
  absent_excused: 'sky',
  late: 'warning',
  left_early: 'warning',
};

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 15;

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const resp = await safe(
    api<AttendanceOverview>('/api/v1/attendance/overview', { cache: 'no-store' }),
  );
  const overview = resp ?? {
    kpis: { present: 0, absent: 0, late: 0, leftEarly: 0, excused: 0, unjustifiedAbsences: 0 },
    records: [],
  };

  const total = overview.records.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const pageRecords = overview.records.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Présences' },
        ]}
        title="Présences"
        subtitle="Suivez l'assiduité quotidienne et les absences à justifier"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={CheckSquare}
          tone="green"
          label="PRÉSENCES AUJOURD'HUI"
          value={overview.kpis.present}
        >
          Élèves présents
        </KpiCard>
        <KpiCard icon={UserX} tone="rose" label="ABSENCES" value={overview.kpis.absent}>
          Aujourd&apos;hui
        </KpiCard>
        <KpiCard icon={Clock} tone="orange" label="RETARDS" value={overview.kpis.late}>
          Élèves en retard
        </KpiCard>
        <KpiCard
          icon={FileWarning}
          tone="amber"
          label="ABSENCES NON JUSTIFIÉES"
          value={overview.kpis.unjustifiedAbsences}
        >
          À traiter rapidement
        </KpiCard>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {pageRecords.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="Aucun enregistrement de présence"
            description="Les présences apparaîtront ici dès que les enseignants feront l'appel en classe."
            tone="slate"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Élève</th>
                    <th className="px-4 py-3">Classe</th>
                    <th className="px-4 py-3">Matière</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Justification</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRecords.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <AvatarNameCell
                          firstName={r.student.firstName}
                          lastName={r.student.lastName}
                          href={`/admin/students/${r.student.id}`}
                          size="sm"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
                          {r.classSectionName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{r.subjectName}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{formatDateShort(r.date)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={STATUS_LABEL[r.status]}
                          tone={STATUS_TONE[r.status]}
                          size="sm"
                          withDot
                        />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {r.justification ?? (r.status === 'absent' ? '—' : '')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RowActions viewHref={`/admin/students/${r.student.id}#attendance`} />
                      </td>
                    </tr>
                  ))}
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
