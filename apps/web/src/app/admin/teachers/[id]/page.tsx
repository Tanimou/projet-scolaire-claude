import {
  AtSign,
  BookOpen,
  Briefcase,
  Calendar,
  Clock,
  GraduationCap,
  Mail,
  School as SchoolIcon,
  TrendingUp,
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
  PreferredDate,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
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

/**
 * Réponse de GET /teachers/:id/load
 *
 * Seuils de charge (documentés ici car utilisés côté client uniquement) :
 *   - Faible    : loadPct < 5 %   — l'enseignant couvre peu d'élèves de l'établissement
 *   - Normale   : 5 % ≤ loadPct ≤ 15 % — répartition habituelle dans un lycée (≈ 2458 élèves seed)
 *   - Surcharge : loadPct > 15 %  — l'enseignant suit plus d'un élève sur six
 *
 * Raisonnement sur les seuils : avec 2458 élèves et ~40 enseignants, la charge
 * moyenne théorique est ≈ 6-10 % (un enseignant de matière commune + plusieurs
 * niveaux). Un enseignant qui dépasse 15 % (≈ 370 élèves) est en situation de
 * surcharge avérée.
 */
interface TeacherLoad {
  teacherProfileId: string;
  activeAcademicYearId: string | null;
  uniqueStudents: number;
  totalStudents: number;
  loadPct: number;
  distinctClasses: number;
  distinctSubjects: number;
  weeklyHours: number;
  mainTeacherCount: number;
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

  const [teacher, classesResp, subjectsResp, load] = await Promise.all([
    safe(api<TeacherDetail>(`/api/v1/teachers/${id}`, { cache: 'no-store' })),
    safe(api<{ data: ClassOption[] }>('/api/v1/classes', { cache: 'no-store' })),
    safe(api<{ data: SubjectOption[] }>('/api/v1/subjects', { cache: 'no-store' })),
    safe(api<TeacherLoad>(`/api/v1/teachers/${id}/load`, { cache: 'no-store' })),
  ]);

  if (!teacher) notFound();

  const classes = classesResp?.data ?? [];
  const subjects = subjectsResp?.data ?? [];

  // Restrict to the active year (most assignments will belong to it; passing all
  // years to the form would clutter the picker).
  const activeYearClasses = classes.filter((c) => c.academicYear.status === 'active');

  // KPIs derived from assignments (toutes années confondues — pour rétro-compat affichage)
  const assignments = teacher.teachingAssignments ?? [];
  const mainTeacherOf = assignments.filter((a) => a.isMainTeacher).length;

  // KPIs prioritaires issus de l'endpoint /load (année active uniquement)
  // Fallback sur les données locales si l'endpoint échoue (degraded mode).
  const distinctClasses = load?.distinctClasses ?? new Set(assignments.map((a) => a.classSection.id)).size;
  const distinctSubjects = load?.distinctSubjects ?? new Set(assignments.map((a) => a.subject.id)).size;
  const totalWeeklyHours = load?.weeklyHours ?? assignments.reduce(
    (s, a) => s + Number(a.weeklyHours ?? 0),
    0,
  );
  const uniqueStudents = load?.uniqueStudents ?? null;
  const loadPct = load?.loadPct ?? null;

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
                  className="accent-text hover:underline"
                >
                  {teacher.userProfile.email}
                </a>
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <Calendar className="h-4 w-4 text-slate-400" />
                Recruté·e <PreferredDate value={teacher.hiredAt} />
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
          Classes distinctes (année active)
        </KpiCard>
        <KpiCard icon={BookOpen} tone="violet" label="MATIÈRES" value={distinctSubjects}>
          Matières enseignées (année active)
        </KpiCard>
        <KpiCard icon={GraduationCap} tone="teal" label="ÉLÈVES SUIVIS" value={uniqueStudents ?? '—'}>
          Élèves uniques (dédoublonnés)
        </KpiCard>
        <KpiCard icon={Clock} tone="amber" label="HEURES / SEMAINE" value={totalWeeklyHours.toFixed(1)}>
          Cumul hebdomadaire (année active)
        </KpiCard>
      </div>

      {/* KPI charge enseignant */}
      {loadPct !== null && (
        <TeacherLoadCard loadPct={loadPct} totalStudents={load?.totalStudents ?? 0} />
      )}

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
                  value={<PreferredDate value={teacher.hiredAt} />}
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
  value: React.ReactNode;
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

/**
 * Détermine le niveau de charge de l'enseignant à partir du pourcentage.
 *
 * Seuils (justifiés dans l'interface TeacherLoad ci-dessus) :
 *   - faible    : loadPct < 5 %
 *   - normale   : 5 % ≤ loadPct ≤ 15 %
 *   - surcharge : loadPct > 15 %
 */
function resolveLoadLevel(loadPct: number): {
  label: string;
  tone: 'success' | 'warning' | 'danger';
  barColor: string;
} {
  if (loadPct < 5) {
    return { label: 'Faible', tone: 'success', barColor: 'bg-emerald-500' };
  }
  if (loadPct <= 15) {
    return { label: 'Normale', tone: 'warning', barColor: 'bg-amber-500' };
  }
  return { label: 'Surcharge', tone: 'danger', barColor: 'bg-rose-500' };
}

/**
 * Carte KPI « Charge de l'enseignant » — affiche le pourcentage + bande visuelle colorée.
 */
function TeacherLoadCard({
  loadPct,
  totalStudents,
}: {
  loadPct: number;
  totalStudents: number;
}) {
  const { label, tone, barColor } = resolveLoadLevel(loadPct);
  // On borne la barre à 100 % au cas où le pourcentage dépasserait 100 (anomalie de données)
  const barWidthPct = Math.min(loadPct, 100);

  return (
    <section className="mt-4 overflow-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 shadow-sm">
            <TrendingUp className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Charge de l&apos;enseignant
            </p>
            <p className="text-xs text-slate-400">
              % des élèves actifs de l&apos;établissement ({totalStudents} élèves au total)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {loadPct.toFixed(1)} %
          </span>
          <StatusBadge label={label} tone={tone} size="sm" withDot />
        </div>
      </div>

      {/* Barre visuelle proportionnelle */}
      <div className="mt-4">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${barWidthPct}%` }}
            aria-label={`Charge : ${loadPct.toFixed(1)} %`}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
          <span>0 %</span>
          {/* Marqueurs des seuils */}
          <span className="absolute" style={{ left: '5%' }} aria-hidden />
          <span>5 % (faible → normale)</span>
          <span>15 % (normale → surcharge)</span>
          <span>100 %</span>
        </div>
      </div>
    </section>
  );
}
