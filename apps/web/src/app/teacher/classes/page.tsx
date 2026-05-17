import { BookOpen, GraduationCap, Layers, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  CapacityBar,
  EmptyState,
  KpiCard,
  PageHeader,
  SubjectChip,
  formatGrade,
} from '@pilotage/ui';

export const metadata: Metadata = { title: 'Mes classes' };
export const dynamic = 'force-dynamic';

interface AssignmentRow {
  id: string;
  isMainTeacher: boolean;
  weeklyHours: string | null;
  classSection: {
    id: string;
    name: string;
    maxStudents: number;
    gradeLevel: { name: string; cycle: { name: string; color: string | null } };
    _count: { enrollments: number };
  };
  subject: {
    id: string;
    code: string;
    name: string;
    color: string | null;
    defaultCoefficient: string;
  };
  academicYear: { id: string; name: string; status: string };
}

interface ClassCard {
  classSectionId: string;
  /** Default assignment id used by the Notes/Appel/Cahier action buttons.
   *  When a class has multiple subjects, this is the first one — each subject
   *  chip is also clickable for per-subject navigation. */
  primaryAssignmentId: string;
  className: string;
  gradeLevelName: string;
  cycleName: string;
  cycleColor: string | null;
  enrolledCount: number;
  maxStudents: number;
  subjects: Array<{
    id: string;
    code: string;
    name: string;
    coefficient: number;
    /** TeachingAssignment id — used to deep-link to the right gradebook. */
    assignmentId: string;
  }>;
  isMainTeacher: boolean;
  weeklyHours: number;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function TeacherClassesPage() {
  const resp = await safe(
    api<{ data: AssignmentRow[]; activeAcademicYearId: string | null }>(
      '/api/v1/teachers/me/assignments',
      { cache: 'no-store' },
    ),
  );
  const assignments = resp?.data ?? [];

  // Group assignments by class section. We keep `primaryAssignmentId` (the first
  // teachingAssignment.id we see for this class) so the action buttons have a
  // sensible default; individual subject chips link to their own assignment.
  const byClass = new Map<string, ClassCard>();
  for (const a of assignments) {
    const key = a.classSection.id;
    const cur =
      byClass.get(key) ??
      ({
        classSectionId: a.classSection.id,
        primaryAssignmentId: a.id,
        className: a.classSection.name,
        gradeLevelName: a.classSection.gradeLevel.name,
        cycleName: a.classSection.gradeLevel.cycle.name,
        cycleColor: a.classSection.gradeLevel.cycle.color,
        enrolledCount: a.classSection._count.enrollments,
        maxStudents: a.classSection.maxStudents,
        subjects: [] as ClassCard['subjects'],
        isMainTeacher: false,
        weeklyHours: 0,
      } as ClassCard);
    cur.subjects.push({
      id: a.subject.id,
      code: a.subject.code,
      name: a.subject.name,
      coefficient: Number(a.subject.defaultCoefficient),
      assignmentId: a.id,
    });
    if (a.isMainTeacher) cur.isMainTeacher = true;
    cur.weeklyHours += Number(a.weeklyHours ?? 0);
    byClass.set(key, cur);
  }

  const classes = [...byClass.values()].sort((a, b) =>
    a.className.localeCompare(b.className),
  );

  const totalClasses = classes.length;
  const totalSubjects = new Set(assignments.map((a) => a.subject.id)).size;
  const totalStudents = classes.reduce((s, c) => s + c.enrolledCount, 0);
  const mainTeacherOf = classes.filter((c) => c.isMainTeacher).length;

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Mes classes' },
        ]}
        title="Mes classes"
        subtitle="Toutes les classes où vous intervenez cette année — cliquez pour la gradebook, la présence et le cahier de texte"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} tone="blue" label="CLASSES" value={totalClasses}>
          Classes enseignées
        </KpiCard>
        <KpiCard icon={GraduationCap} tone="violet" label="ÉLÈVES" value={totalStudents}>
          Cumul des effectifs
        </KpiCard>
        <KpiCard icon={BookOpen} tone="green" label="MATIÈRES" value={totalSubjects}>
          Matières enseignées
        </KpiCard>
        <KpiCard icon={Layers} tone="amber" label="PROF PRINCIPAL" value={mainTeacherOf}>
          {mainTeacherOf > 0 ? 'classes' : 'aucune'}
        </KpiCard>
      </div>

      <section className="mt-6">
        {classes.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Aucune affectation pour cette année"
            description="Aucune classe ne vous a été assignée. Contactez l'administration de l'établissement."
            tone="slate"
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {classes.map((c) => (
                <li
                  key={c.classSectionId}
                  className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 transition hover:-translate-y-0.5 hover:ring-slate-300"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-bold text-slate-900">{c.className}</h3>
                      <p className="text-xs text-slate-500">
                        {c.gradeLevelName} · {c.cycleName}
                      </p>
                    </div>
                    {c.isMainTeacher && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                        Prof principal
                      </span>
                    )}
                  </div>

                  <div className="mt-3">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-slate-500">Effectif</span>
                      <span className="font-mono tabular-nums text-slate-700">
                        {c.enrolledCount} / {c.maxStudents}
                      </span>
                    </div>
                    <CapacityBar value={c.enrolledCount} max={c.maxStudents} className="mt-1" />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {c.subjects.map((s) => (
                      <Link
                        key={s.id}
                        href={`/teacher/classes/${s.assignmentId}/grades`}
                        title={`Ouvrir la gradebook ${s.name}`}
                        className="rounded-full ring-1 ring-transparent transition hover:ring-slate-300"
                      >
                        <SubjectChip subjectCode={s.code} label={s.name} size="sm" />
                      </Link>
                    ))}
                  </div>

                  {c.weeklyHours > 0 && (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Volume horaire : <strong>{formatGrade(c.weeklyHours, 1)} h/sem</strong>
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <Link
                      href={`/teacher/classes/${c.primaryAssignmentId}`}
                      className="font-bold text-blue-700 hover:underline"
                    >
                      Voir la classe →
                    </Link>
                    <div className="flex gap-2">
                      <Link
                        href={`/teacher/classes/${c.primaryAssignmentId}/grades`}
                        className="rounded-md bg-emerald-50 px-2 py-1 font-bold text-emerald-700 hover:bg-emerald-100"
                      >
                        Notes
                      </Link>
                      <Link
                        href={`/teacher/classes/${c.primaryAssignmentId}/attendance`}
                        className="rounded-md bg-sky-50 px-2 py-1 font-bold text-sky-700 hover:bg-sky-100"
                      >
                        Appel
                      </Link>
                      <Link
                        href={`/teacher/classes/${c.primaryAssignmentId}/lessons`}
                        className="rounded-md bg-violet-50 px-2 py-1 font-bold text-violet-700 hover:bg-violet-100"
                      >
                        Cahier
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>
    </PortalShell>
  );
}
