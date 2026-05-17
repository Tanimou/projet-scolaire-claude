import { BookOpen, GraduationCap, Plus, UserCheck, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

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
  SubjectChip,
} from '@pilotage/ui';

import { TeachersPageFilters } from './TeachersPageFilters';

export const metadata: Metadata = { title: 'Enseignants' };
export const dynamic = 'force-dynamic';

interface TeacherItem {
  id: string;
  active: boolean;
  specialty: string | null;
  externalRef: string | null;
  hiredAt: string | null;
  userProfile: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    photoUrl: string | null;
  };
  subjects: Array<{ id: string; code: string; name: string; color: string | null }>;
  _count: { teachingAssignments: number };
}

interface TeachersAggregateResponse {
  totalTeachers: number;
  activeTeachers: number;
  activePct: number;
  subjectsCovered: number;
  ratioTeacherStudent: { teachers: number; students: number; label: string };
  trends: {
    teachers: Array<{ x: string; y: number }>;
    active: Array<{ x: string; y: number }>;
    subjects: Array<{ x: string; y: number }>;
    ratio: Array<{ x: string; y: number }>;
  };
}

interface SimpleSubject {
  id: string;
  code: string;
  name: string;
  color: string | null;
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

/** Female-first-name heuristic to pick "Professeur" vs "Professeure" prefix. */
function isFemaleFirstName(first: string): boolean {
  return /(e|a|ie|ine|elle|ette)$/i.test(first);
}

export default async function TeachersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    active?: string;
    subjectId?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const qs = new URLSearchParams();
  if (sp.q) qs.set('q', sp.q);
  if (sp.active) qs.set('active', sp.active);

  const [teachersResp, aggregate, subjects] = await Promise.all([
    api<{ data: TeacherItem[] }>(`/api/v1/teachers?${qs.toString()}`, { cache: 'no-store' }),
    safe(
      api<TeachersAggregateResponse>('/api/v1/analytics/teachers-aggregate', { cache: 'no-store' }),
    ),
    api<{ data: SimpleSubject[] }>('/api/v1/subjects', { cache: 'no-store' }),
  ]);

  // Apply subject filter client-side (API doesn't yet support `subjectId`)
  let allTeachers = teachersResp.data;
  if (sp.subjectId) {
    allTeachers = allTeachers.filter((t) => t.subjects.some((s) => s.id === sp.subjectId));
  }
  const total = allTeachers.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const pageTeachers = allTeachers.slice(startIdx, startIdx + PAGE_SIZE);

  const subjectOptions = subjects.data.map((s) => ({ value: s.id, label: s.name }));
  const statusOptions = [
    { value: 'true', label: 'Actifs' },
    { value: 'false', label: 'Inactifs' },
  ];

  return (
    <PortalShell portal="admin">
      <PageHeader
        title="Enseignants"
        subtitle="Gérez les informations et affectations des enseignants"
        actions={
          <Link
            href="/admin/users/invite?role=teacher"
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Ajouter un enseignant
          </Link>
        }
      />

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={GraduationCap}
          tone="blue"
          label="TOTAL ENSEIGNANTS"
          value={aggregate?.totalTeachers ?? '—'}
          trend={aggregate?.trends.teachers}
        >
          Tous les enseignants
        </KpiCard>
        <KpiCard
          icon={UserCheck}
          tone="green"
          label="ENSEIGNANTS ACTIFS"
          value={aggregate?.activeTeachers ?? '—'}
          delta={aggregate?.activePct}
          deltaSuffix="%"
          deltaPeriod="du total"
          trend={aggregate?.trends.active}
        />
        <KpiCard
          icon={BookOpen}
          tone="violet"
          label="MATIÈRES COUVERTES"
          value={aggregate?.subjectsCovered ?? '—'}
          trend={aggregate?.trends.subjects}
        >
          Dans tout l&apos;établissement
        </KpiCard>
        <KpiCard
          icon={Users}
          tone="orange"
          label="RATIO ENSEIGNANT / ÉLÈVE"
          value={aggregate?.ratioTeacherStudent.label ?? '—'}
          trend={aggregate?.trends.ratio}
        >
          En moyenne
        </KpiCard>
      </div>

      {/* FilterBar */}
      <div className="mt-6">
        <TeachersPageFilters
          initialQ={sp.q ?? ''}
          initialActive={sp.active ?? ''}
          initialSubjectId={sp.subjectId ?? ''}
          subjectOptions={subjectOptions}
          statusOptions={statusOptions}
        />
      </div>

      {/* Table */}
      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {pageTeachers.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="Aucun enseignant trouvé"
            description="Modifiez vos filtres ou invitez un enseignant via /admin/users/invite."
            tone="slate"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Enseignant</th>
                    <th className="px-4 py-3">N° Employé</th>
                    <th className="px-4 py-3">Spécialité(s)</th>
                    <th className="px-4 py-3 text-center">Classes Assignées</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Téléphone</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageTeachers.map((t, i) => {
                    const isFemale = isFemaleFirstName(t.userProfile.firstName);
                    const titleText = t.specialty
                      ? `${isFemale ? 'Professeure' : 'Professeur'} de ${t.specialty}`
                      : 'Enseignant·e';
                    return (
                      <tr key={t.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <AvatarNameCell
                            src={t.userProfile.photoUrl}
                            firstName={t.userProfile.firstName}
                            lastName={t.userProfile.lastName}
                            sub={titleText}
                            href={`/admin/teachers/${t.id}`}
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {t.externalRef ?? `EMP${String(startIdx + i + 1).padStart(3, '0')}`}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {t.subjects.length === 0 ? (
                              <span className="text-xs text-slate-400">—</span>
                            ) : (
                              t.subjects.slice(0, 3).map((s) => (
                                <SubjectChip
                                  key={s.id}
                                  subjectCode={s.code}
                                  label={s.name}
                                  size="sm"
                                />
                              ))
                            )}
                            {t.subjects.length > 3 && (
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                +{t.subjects.length - 3}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-sm tabular-nums text-slate-700">
                          {t._count.teachingAssignments}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">{t.userProfile.email}</td>
                        <td className="px-4 py-3 text-sm tabular-nums text-slate-700">
                          {t.userProfile.phone ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={t.active ? 'Actif' : 'Inactif'}
                            tone={t.active ? 'success' : 'danger'}
                            size="sm"
                            withDot
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <RowActions
                            viewHref={`/admin/teachers/${t.id}`}
                            editHref={`/admin/teachers/${t.id}#edit`}
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
              total={total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'enseignant', plural: 'enseignants' }}
            />
          </>
        )}
      </section>
    </PortalShell>
  );
}
