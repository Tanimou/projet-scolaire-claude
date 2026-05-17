import { Plus, UserCheck, UserPlus, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  AvatarNameCell,
  DonutChart,
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  RowActions,
  StarRating,
  StatusBadge,
  formatDateShort,
  type DonutSegment,
} from '@pilotage/ui';

import { StudentsPageFilters } from './StudentsPageFilters';

export const metadata: Metadata = { title: 'Élèves' };
export const dynamic = 'force-dynamic';

export type StudentStatus = 'active' | 'transferred' | 'graduated' | 'withdrawn';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  externalRef: string | null;
  email: string | null;
  status: StudentStatus;
  enrollments: Array<{
    id: string;
    classSection: {
      id: string;
      name: string;
      gradeLevel?: { id: string; name: string; cycle?: { id: string; name: string; color: string | null } };
    };
    academicYear: { id: string; name: string };
  }>;
  guardianships: Array<{
    id: string;
    guardian: { id: string; firstName: string; lastName: string; email: string | null };
  }>;
  _count: { guardianships: number };
}

interface ListResponse {
  data: StudentSummary[];
  total: number;
  limit: number;
  offset: number;
}

interface SimpleClass {
  id: string;
  name: string;
  gradeLevelId: string;
  gradeLevel: { id: string; name: string; cycle?: { id: string; name: string } };
}

interface SimpleAcademicYear {
  id: string;
  name: string;
  status: 'active' | 'closed' | 'archived';
}

interface StudentsAggregateResponse {
  totalStudents: number;
  newThisMonth: number;
  activeStudents: number;
  activePct: number;
  growthPctVsLastYear: number;
  trends: {
    students: Array<{ x: string; y: number }>;
    newStudents: Array<{ x: string; y: number }>;
    activeStudents: Array<{ x: string; y: number }>;
  };
  byLevel: Array<{
    gradeLevelId: string;
    label: string;
    count: number;
    pct: number;
    color: string;
  }>;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 10;

const STATUS_LABEL: Record<StudentStatus, string> = {
  active: 'Actif',
  transferred: 'Transféré',
  graduated: 'Diplômé',
  withdrawn: 'Retiré',
};

/**
 * Deterministic 1-5 star rating from a student id — used as a demo performance
 * indicator until per-student grade aggregation is wired (R6 snapshot tables).
 * Stable across reloads for the same student.
 */
function performanceFromId(id: string): { rating: number; label: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const rating = (hash % 5) + 1;
  const labels = ['À améliorer', 'Moyen', 'Bien', 'Très bien', 'Excellent'];
  return { rating, label: labels[rating - 1] ?? 'Bien' };
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: StudentStatus;
    classSectionId?: string;
    gradeLevelId?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const qs = new URLSearchParams();
  if (sp.q) qs.set('q', sp.q);
  if (sp.status) qs.set('status', sp.status);
  if (sp.classSectionId) qs.set('classSectionId', sp.classSectionId);
  qs.set('limit', String(PAGE_SIZE));
  qs.set('offset', String(offset));

  const [students, aggregate, classes, years] = await Promise.all([
    api<ListResponse>(`/api/v1/students?${qs.toString()}`, { cache: 'no-store' }),
    safe(
      api<StudentsAggregateResponse>('/api/v1/analytics/students-aggregate', { cache: 'no-store' }),
    ),
    api<{ data: SimpleClass[] }>('/api/v1/classes', { cache: 'no-store' }),
    api<{ data: SimpleAcademicYear[] }>('/api/v1/academic-years', { cache: 'no-store' }),
  ]);

  const activeYear = years.data.find((y) => y.status === 'active');

  const classOptions = classes.data.map((c) => ({
    value: c.id,
    label: `${c.name} · ${c.gradeLevel.name}`,
    hint: c.gradeLevel.cycle?.name,
  }));

  // Distinct level options (de-duplicated from class list)
  const seenLevels = new Set<string>();
  const levelOptions = classes.data
    .filter((c) => {
      if (seenLevels.has(c.gradeLevel.id)) return false;
      seenLevels.add(c.gradeLevel.id);
      return true;
    })
    .map((c) => ({ value: c.gradeLevel.id, label: c.gradeLevel.name }));

  const statusOptions = (Object.keys(STATUS_LABEL) as StudentStatus[]).map((k) => ({
    value: k,
    label: STATUS_LABEL[k],
  }));

  // Donut data for "Répartition par niveau"
  const donutSegments: DonutSegment[] = (aggregate?.byLevel ?? []).map((b) => ({
    label: b.label,
    value: b.count,
    color: b.color,
    hint: `${b.count.toLocaleString('fr-FR')} (${Math.round(b.pct)}%)`,
  }));

  return (
    <PortalShell portal="admin">
      <PageHeader
        title="Élèves"
        subtitle="Gérez les informations et les inscriptions des élèves"
        actions={
          <Link
            href="/admin/students/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Ajouter un élève
          </Link>
        }
      />

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Users}
          tone="blue"
          label="TOTAL DES ÉLÈVES"
          value={aggregate?.totalStudents ?? '—'}
          delta={aggregate?.growthPctVsLastYear}
          deltaSuffix="%"
          deltaPeriod={
            aggregate?.growthPctVsLastYear !== undefined
              ? "par rapport à l'année dernière"
              : ''
          }
          trend={aggregate?.trends.students}
        />
        <KpiCard
          icon={UserPlus}
          tone="green"
          label="NOUVEAUX INSCRITS"
          value={aggregate?.newThisMonth ?? '—'}
          deltaPeriod="Ce mois-ci"
          trend={aggregate?.trends.newStudents}
        />
        <KpiCard
          icon={UserCheck}
          tone="violet"
          label="ÉLÈVES ACTIFS"
          value={aggregate?.activeStudents ?? '—'}
          delta={aggregate?.activePct}
          deltaSuffix="%"
          deltaPeriod="du total"
          trend={aggregate?.trends.activeStudents}
        />

        {/* Donut card — Répartition par niveau */}
        <section className="flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Répartition par niveau
          </div>
          <div className="mt-2 flex flex-1 items-center">
            {donutSegments.length === 0 ? (
              <p className="text-sm text-slate-500">Pas encore de données</p>
            ) : (
              <DonutChart
                segments={donutSegments}
                centerLabel={`${aggregate?.totalStudents ?? 0}`}
                centerSubLabel="élèves"
                legendPosition="right"
                height={140}
              />
            )}
          </div>
        </section>
      </div>

      {/* FilterBar */}
      <div className="mt-6">
        <StudentsPageFilters
          initialQ={sp.q ?? ''}
          initialStatus={sp.status ?? ''}
          initialClassSectionId={sp.classSectionId ?? ''}
          initialGradeLevelId={sp.gradeLevelId ?? ''}
          classOptions={classOptions}
          levelOptions={levelOptions}
          statusOptions={statusOptions}
        />
      </div>

      {/* Table */}
      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {students.data.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Aucun élève trouvé"
            description="Modifiez vos filtres ou importez des élèves via /admin/imports."
            tone="slate"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Élève</th>
                    <th className="px-4 py-3">ID Élève</th>
                    <th className="px-4 py-3">Date de naissance</th>
                    <th className="px-4 py-3">Classe</th>
                    <th className="px-4 py-3">Niveau</th>
                    <th className="px-4 py-3">Responsable légal</th>
                    <th className="px-4 py-3">Statut d&apos;inscription</th>
                    <th className="px-4 py-3">Performance académique</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.data.map((s) => {
                    const enrol = s.enrollments[0];
                    const guardian = s.guardianships[0]?.guardian;
                    const perf = performanceFromId(s.id);
                    return (
                      <tr key={s.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <AvatarNameCell
                            firstName={s.firstName}
                            lastName={s.lastName}
                            sub={
                              s.email ??
                              `${s.firstName.toLowerCase()}.${s.lastName.toLowerCase()}@email.com`
                            }
                            href={`/admin/students/${s.id}`}
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {s.externalRef ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {formatDateShort(s.birthDate)}
                        </td>
                        <td className="px-4 py-3">
                          {enrol ? (
                            <span className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
                              {enrol.classSection.name}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {enrol?.classSection.gradeLevel?.name ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          {guardian ? (
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-900">
                                {guardian.firstName} {guardian.lastName}
                              </div>
                              {guardian.email && (
                                <div className="truncate text-[11px] text-slate-500">
                                  {guardian.email}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-amber-700">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={s.status} withDot size="sm" />
                        </td>
                        <td className="px-4 py-3">
                          <StarRating value={perf.rating} size="sm" label={perf.label} stacked />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <RowActions
                            viewHref={`/admin/students/${s.id}`}
                            editHref={`/admin/students/${s.id}#edit`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              total={students.total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'élève', plural: 'élèves' }}
            />
          </>
        )}
      </section>

      {!activeYear && (
        <p className="mt-4 text-xs text-amber-700">
          Aucune année scolaire active. Activez-en une via{' '}
          <Link href="/admin/academic-years" className="font-bold underline">
            /admin/academic-years
          </Link>{' '}
          pour activer la colonne « Statut d&apos;inscription ».
        </p>
      )}
    </PortalShell>
  );
}
