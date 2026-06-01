import { BookOpen, Plus, Sparkles, Users, UserSquare2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  AvatarNameCell,
  CapacityBar,
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  RowActions,
  StatusBadge,
} from '@pilotage/ui';

import { ClassInfoEditor } from './ClassInfoEditor';
import { ClassesPageFilters } from './ClassesPageFilters';

export const metadata: Metadata = { title: 'Gestion des classes' };
export const dynamic = 'force-dynamic';

interface ClassItem {
  id: string;
  name: string;
  maxStudents: number;
  status: 'active' | 'closed';
  academicYearId: string;
  gradeLevelId: string;
  room: string | null;
  color: string | null;
  icon: string | null;
  options: Record<string, unknown> | null;
  internalNotes: string | null;
  gradeLevel: {
    id: string;
    code: string;
    name: string;
    cycle: { id: string; name: string; color: string | null };
  };
  academicYear: { id: string; name: string; status: 'active' | 'closed' | 'archived' };
  _count: { enrollments: number };
  teachingAssignments: Array<{
    id: string;
    teacherProfile: {
      userProfile: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        photoUrl: string | null;
      };
    };
    subject: { name: string };
  }>;
}

interface SimpleAcademicYear {
  id: string;
  name: string;
  status: 'active' | 'closed' | 'archived';
}

interface SimpleGradeLevel {
  id: string;
  code: string;
  name: string;
  cycleId: string;
}

interface SimpleCycle {
  id: string;
  name: string;
  gradeLevels: SimpleGradeLevel[];
}

interface ClassesAggregateResponse {
  totalClasses: number;
  avgCapacityPct: number;
  fullClasses: number;
  activeClasses: number;
  trends: {
    classes: Array<{ x: string; y: number }>;
    avgCapacity: Array<{ x: string; y: number }>;
    full: Array<{ x: string; y: number }>;
    active: Array<{ x: string; y: number }>;
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

const PAGE_SIZE = 10;

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{
    gradeLevelId?: string;
    academicYearId?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const qs = new URLSearchParams();
  if (sp.gradeLevelId) qs.set('gradeLevelId', sp.gradeLevelId);
  if (sp.academicYearId) qs.set('academicYearId', sp.academicYearId);

  const [classesResp, aggregate, years, cycles] = await Promise.all([
    api<{ data: ClassItem[] }>(`/api/v1/classes?${qs.toString()}`, { cache: 'no-store' }),
    safe(
      api<ClassesAggregateResponse>('/api/v1/analytics/classes-aggregate', { cache: 'no-store' }),
    ),
    api<{ data: SimpleAcademicYear[] }>('/api/v1/academic-years', { cache: 'no-store' }),
    api<{ data: SimpleCycle[] }>('/api/v1/cycles', { cache: 'no-store' }),
  ]);

  const allClasses = classesResp.data;
  const total = allClasses.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const pageClasses = allClasses.slice(startIdx, startIdx + PAGE_SIZE);

  const activeYear = years.data.find((y) => y.status === 'active') ?? years.data[0];
  const yearOptions = years.data.map((y) => ({
    value: y.id,
    label: y.name,
    hint: y.status === 'active' ? 'En cours' : undefined,
  }));
  const levelOptions = cycles.data.flatMap((c) =>
    c.gradeLevels.map((l) => ({
      value: l.id,
      label: l.name,
      hint: c.name,
    })),
  );

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[{ label: 'Tableau de bord', href: '/admin/dashboard' }, { label: 'Classes' }]}
        title="Gestion des classes"
        subtitle="Gérez les classes, capacités, niveaux et affectations"
        actions={
          <Link
            href="/admin/classes/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Ajouter une classe
          </Link>
        }
      />

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={BookOpen}
          tone="blue"
          label="TOTAL DES CLASSES"
          value={aggregate?.totalClasses ?? total ?? '—'}
          trend={aggregate?.trends.classes}
        >
          Toutes les classes de l&apos;établissement
        </KpiCard>
        <KpiCard
          icon={Users}
          tone="green"
          label="CAPACITÉ MOYENNE"
          value={aggregate ? `${Math.round(aggregate.avgCapacityPct)}%` : '—'}
          trend={aggregate?.trends.avgCapacity}
        >
          Taux moyen d&apos;occupation
        </KpiCard>
        <KpiCard
          icon={UserSquare2}
          tone="orange"
          label="CLASSES COMPLÈTES"
          value={aggregate?.fullClasses ?? '—'}
          trend={aggregate?.trends.full}
        >
          Classes à 100% de capacité
        </KpiCard>
        <KpiCard
          icon={Sparkles}
          tone="violet"
          label="CLASSES ACTIVES"
          value={aggregate?.activeClasses ?? '—'}
          trend={aggregate?.trends.active}
        >
          Classes actuellement ouvertes
        </KpiCard>
      </div>

      {/* FilterBar */}
      <div className="mt-6">
        <ClassesPageFilters
          initialGradeLevelId={sp.gradeLevelId ?? ''}
          initialAcademicYearId={sp.academicYearId ?? activeYear?.id ?? ''}
          levelOptions={levelOptions}
          yearOptions={yearOptions}
        />
      </div>

      {/* Table */}
      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {pageClasses.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Aucune classe trouvée"
            description="Ajustez vos filtres ou créez une nouvelle classe."
            tone="slate"
            action={{ label: 'Ajouter une classe', href: '/admin/classes/new' }}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Nom de la classe</th>
                    <th className="px-4 py-3">Niveau</th>
                    <th className="px-4 py-3">Salle</th>
                    <th className="px-4 py-3">Année académique</th>
                    <th className="px-4 py-3">Capacité maximale</th>
                    <th className="px-4 py-3">Effectif actuel</th>
                    <th className="px-4 py-3">Taux d&apos;occupation</th>
                    <th className="px-4 py-3">Enseignant référent</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageClasses.map((c) => {
                    const enrolled = c._count.enrollments;
                    const isFull = enrolled >= c.maxStudents;
                    const mainTeacher = c.teachingAssignments[0]?.teacherProfile.userProfile;
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-xs text-white"
                              style={{ background: c.color ?? c.gradeLevel.cycle.color ?? 'oklch(0.62 0.18 250)' }}
                            >
                              {c.icon ?? c.name.slice(0, 1).toUpperCase()}
                            </span>
                            <Link
                              href={`/admin/classes/${c.id}`}
                              className="text-sm font-bold accent-text hover:underline"
                            >
                              {c.name}
                            </Link>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">{c.gradeLevel.name}</td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {c.room ?? <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">{c.academicYear.name}</td>
                        <td className="px-4 py-3 text-sm tabular-nums text-slate-700">
                          {c.maxStudents}
                        </td>
                        <td className="px-4 py-3 text-sm tabular-nums text-slate-700">{enrolled}</td>
                        <td className="px-4 py-3">
                          <CapacityBar value={enrolled} max={c.maxStudents} />
                        </td>
                        <td className="px-4 py-3">
                          {mainTeacher ? (
                            <AvatarNameCell
                              src={mainTeacher.photoUrl}
                              firstName={mainTeacher.firstName}
                              lastName={mainTeacher.lastName}
                              size="sm"
                            />
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isFull ? (
                            <StatusBadge label="Complète" tone="danger" size="sm" withDot />
                          ) : c.status === 'active' ? (
                            <StatusBadge label="Active" tone="success" size="sm" withDot />
                          ) : (
                            <StatusBadge label="Fermée" tone="neutral" size="sm" withDot />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <ClassInfoEditor
                              id={c.id}
                              initial={{
                                name: c.name,
                                maxStudents: c.maxStudents,
                                room: c.room,
                                color: c.color,
                                icon: c.icon,
                                options: c.options,
                                internalNotes: c.internalNotes,
                              }}
                              trigger={
                                <span className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                                  Modifier infos
                                </span>
                              }
                            />
                            <RowActions viewHref={`/admin/classes/${c.id}`} />
                          </div>
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
              itemLabel={{ singular: 'classe', plural: 'classes' }}
            />
          </>
        )}
      </section>

      <p className="mt-4 text-xs text-slate-500">
        Une classe est rattachée à un <strong>cycle</strong> → <strong>niveau</strong> →{' '}
        <strong>année scolaire</strong>. Cliquez sur une classe pour voir les élèves inscrits et
        les matières avec leurs coefficients.
      </p>
    </PortalShell>
  );
}
