import { GraduationCap, User, Users } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  AvatarNameCell,
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
} from '@pilotage/ui';

export const metadata: Metadata = { title: 'Mes élèves' };
export const dynamic = 'force-dynamic';

interface TeacherStudent {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  externalRef: string | null;
  gender: string | null;
  classes: Array<{ id: string; name: string; gradeLevelName: string }>;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 25;

export default async function TeacherStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; classSectionId?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const resp = await safe(
    api<{ data: TeacherStudent[]; count: number }>('/api/v1/teachers/me/students', {
      cache: 'no-store',
    }),
  );
  const allStudents = resp?.data ?? [];

  // Optional client-side filter by classSection (kept simple — moves to URL filter when needed)
  const filtered = sp.classSectionId
    ? allStudents.filter((s) => s.classes.some((c) => c.id === sp.classSectionId))
    : allStudents;

  const total = filtered.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  const uniqueClasses = new Set(allStudents.flatMap((s) => s.classes.map((c) => c.id))).size;
  const totalRelations = allStudents.reduce((s, st) => s + st.classes.length, 0);

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Élèves' },
        ]}
        title="Mes élèves"
        subtitle="Tous les élèves que vous enseignez cette année, à travers vos différentes classes"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={User} tone="blue" label="ÉLÈVES" value={allStudents.length}>
          Effectif distinct
        </KpiCard>
        <KpiCard icon={Users} tone="violet" label="CLASSES" value={uniqueClasses}>
          Classes enseignées
        </KpiCard>
        <KpiCard icon={GraduationCap} tone="green" label="RELATIONS" value={totalRelations}>
          Couples élève × classe
        </KpiCard>
        <KpiCard
          icon={User}
          tone="amber"
          label="MOYENNE PAR CLASSE"
          value={uniqueClasses > 0 ? Math.round(totalRelations / uniqueClasses) : 0}
        >
          Effectif moyen
        </KpiCard>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {pageRows.length === 0 ? (
          <EmptyState
            icon={User}
            title="Aucun élève trouvé"
            description="Vos classes n'ont pas encore d'élèves inscrits, ou aucune classe ne vous est affectée."
            tone="slate"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Élève</th>
                    <th className="px-4 py-3">Classe(s)</th>
                    <th className="px-4 py-3">Niveau</th>
                    <th className="px-4 py-3">Référence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <AvatarNameCell
                          firstName={s.firstName}
                          lastName={s.lastName}
                          src={s.photoUrl}
                          size="sm"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {s.classes.map((c) => (
                            <span
                              key={c.id}
                              className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700"
                            >
                              {c.name}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {s.classes
                          .map((c) => c.gradeLevelName)
                          .filter((v, i, a) => a.indexOf(v) === i)
                          .join(' · ')}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {s.externalRef ?? '—'}
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
              itemLabel={{ singular: 'élève', plural: 'élèves' }}
            />
          </>
        )}
      </section>
    </PortalShell>
  );
}
