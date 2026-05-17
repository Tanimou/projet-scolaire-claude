import {
  AtSign,
  BookOpen,
  Briefcase,
  Calendar,
  Clock,
  GraduationCap,
  Mail,
  School as SchoolIcon,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  KpiCard,
  PageHeader,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatDateShort,
} from '@pilotage/ui';

import { TeacherAssignmentsPanel } from './TeacherAssignmentsPanel';

export const metadata: Metadata = { title: 'Fiche enseignant' };
export const dynamic = 'force-dynamic';

interface TeacherDetail {
  id: string;
  schoolId: string;
  specialty: string | null;
  externalRef: string | null;
  hiredAt: string | null;
  active: boolean;
  notes: string | null;
  userProfile: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    photoUrl: string | null;
  };
  teachingAssignments: Array<{
    id: string;
    isMainTeacher: boolean;
    weeklyHours: string | null;
    classSection: {
      id: string;
      name: string;
      gradeLevel: { id: string; name: string; cycle: { id: string; name: string; color: string | null } };
    };
    subject: { id: string; name: string; code: string; color: string | null };
    academicYear: { id: string; name: string; status: string };
  }>;
}

interface ClassOption {
  id: string;
  name: string;
  gradeLevel: { name: string; cycle: { name: string } };
  academicYear: { id: string; name: string; status: string };
}

interface SubjectOption {
  id: string;
  name: string;
  code: string;
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

export default async function TeacherDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [teacher, classesResp, subjectsResp] = await Promise.all([
    safe(api<TeacherDetail>(`/api/v1/teachers/${id}`, { cache: 'no-store' })),
    safe(api<{ data: ClassOption[] }>('/api/v1/classes', { cache: 'no-store' })),
    safe(api<{ data: SubjectOption[] }>('/api/v1/subjects', { cache: 'no-store' })),
  ]);

  if (!teacher) notFound();

  const classes = classesResp?.data ?? [];
  const subjects = subjectsResp?.data ?? [];

  // Restrict to the active year (most assignments will belong to it; passing all
  // years to the form would clutter the picker).
  const activeYearClasses = classes.filter((c) => c.academicYear.status === 'active');

  // KPIs derived from assignments
  const assignments = teacher.teachingAssignments ?? [];
  const distinctClasses = new Set(assignments.map((a) => a.classSection.id)).size;
  const distinctSubjects = new Set(assignments.map((a) => a.subject.id)).size;
  const totalWeeklyHours = assignments.reduce(
    (s, a) => s + Number(a.weeklyHours ?? 0),
    0,
  );
  const mainTeacherOf = assignments.filter((a) => a.isMainTeacher).length;

  const fullName = `${teacher.userProfile.firstName} ${teacher.userProfile.lastName}`.trim();
  const initials = `${teacher.userProfile.firstName[0] ?? ''}${teacher.userProfile.lastName[0] ?? ''}`.toUpperCase();

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Enseignants', href: '/admin/teachers' },
          { label: fullName },
        ]}
        title={fullName}
        subtitle={teacher.specialty ?? 'Profil enseignant'}
        actions={
          <Link
            href="/admin/teachers"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            ← Retour à la liste
          </Link>
        }
      />

      {/* Hero card */}
      <section className="mt-6 overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <div className="flex flex-wrap items-start gap-5">
          {teacher.userProfile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={teacher.userProfile.photoUrl}
              alt={fullName}
              className="h-20 w-20 shrink-0 rounded-2xl object-cover ring-2 ring-white shadow"
            />
          ) : (
            <div
              aria-hidden
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-blue-600 to-blue-700 text-2xl font-bold text-white shadow"
            >
              {initials || '?'}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">{fullName}</h2>
              <StatusBadge
                label={teacher.active ? 'Actif' : 'Inactif'}
                tone={teacher.active ? 'success' : 'danger'}
                size="sm"
                withDot
              />
              {mainTeacherOf > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                  Prof. principal · {mainTeacherOf}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500">
              {teacher.specialty ?? '—'}
              {teacher.externalRef && (
                <span className="ml-2 font-mono text-xs text-slate-400">
                  · {teacher.externalRef}
                </span>
              )}
            </p>

            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div className="flex items-center gap-2 text-slate-700">
                <Mail className="h-4 w-4 text-slate-400" />
                <a
                  href={`mailto:${teacher.userProfile.email}`}
                  className="text-blue-700 hover:underline"
                >
                  {teacher.userProfile.email}
                </a>
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <Calendar className="h-4 w-4 text-slate-400" />
                Recruté·e {formatDateShort(teacher.hiredAt) || '—'}
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <SchoolIcon className="h-4 w-4 text-slate-400" />
                {assignments[0]?.academicYear.name ?? 'Aucune année active'}
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} tone="blue" label="CLASSES ENSEIGNÉES" value={distinctClasses}>
          Classes distinctes
        </KpiCard>
        <KpiCard icon={BookOpen} tone="violet" label="MATIÈRES" value={distinctSubjects}>
          Matières enseignées
        </KpiCard>
        <KpiCard icon={GraduationCap} tone="green" label="AFFECTATIONS" value={assignments.length}>
          Couples (classe × matière)
        </KpiCard>
        <KpiCard icon={Clock} tone="amber" label="HEURES / SEMAINE" value={totalWeeklyHours.toFixed(1)}>
          Cumul hebdomadaire
        </KpiCard>
      </div>

      {/* Tabs */}
      <div className="mt-6">
        <Tabs defaultValue="assignments" variant="underline">
          <TabsList>
            <TabsTrigger value="assignments">Affectations</TabsTrigger>
            <TabsTrigger value="profile">Profil</TabsTrigger>
          </TabsList>

          <TabsContent value="assignments">
            <TeacherAssignmentsPanel
              teacherId={teacher.id}
              assignments={assignments.map((a) => ({
                id: a.id,
                classSectionId: a.classSection.id,
                className: a.classSection.name,
                gradeLevelName: a.classSection.gradeLevel.name,
                cycleName: a.classSection.gradeLevel.cycle.name,
                subjectId: a.subject.id,
                subjectCode: a.subject.code,
                subjectName: a.subject.name,
                academicYearName: a.academicYear.name,
                isMainTeacher: a.isMainTeacher,
                weeklyHours: a.weeklyHours ? Number(a.weeklyHours) : null,
              }))}
              classOptions={activeYearClasses.map((c) => ({
                id: c.id,
                label: `${c.gradeLevel.cycle.name} · ${c.name} (${c.gradeLevel.name})`,
              }))}
              subjectOptions={subjects.map((s) => ({
                id: s.id,
                label: s.name,
                code: s.code,
              }))}
            />
          </TabsContent>

          <TabsContent value="profile">
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
              <h2 className="text-base font-bold text-slate-900">Profil détaillé</h2>
              <p className="mt-1 text-xs text-slate-500">
                Le nom, l&apos;email et l&apos;authentification sont gérés via Keycloak. Pour les
                modifier, ouvre le portail compte de l&apos;utilisateur ou la console admin
                Keycloak.
              </p>
              <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ProfileField icon={Briefcase} label="Spécialité" value={teacher.specialty ?? '—'} />
                <ProfileField icon={AtSign} label="Email" value={teacher.userProfile.email} />
                <ProfileField
                  icon={Calendar}
                  label="Date d'embauche"
                  value={formatDateShort(teacher.hiredAt) || '—'}
                />
                <ProfileField
                  icon={Users}
                  label="Référence externe"
                  value={teacher.externalRef ?? '—'}
                />
              </dl>
              {teacher.notes && (
                <div className="mt-5 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Notes internes
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{teacher.notes}</p>
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </PortalShell>
  );
}

function ProfileField({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
      <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <Icon className="h-3 w-3" />
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
