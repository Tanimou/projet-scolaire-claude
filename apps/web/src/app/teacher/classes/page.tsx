import { EmptyState, KpiCard, PageHeader } from '@pilotage/ui';
import { BookOpen, GraduationCap, Layers, Users } from 'lucide-react';
import type { Metadata } from 'next';

import { TeacherClassesGrid, type ClassCardData } from './TeacherClassesGrid';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';


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
  const byClass = new Map<string, ClassCardData>();
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
        subjects: [] as ClassCardData['subjects'],
        isMainTeacher: false,
        weeklyHours: 0,
      } as ClassCardData);
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

  const classes = [...byClass.values()].sort((a, b) => a.className.localeCompare(b.className));

  const totalClasses = classes.length;
  const totalSubjects = new Set(assignments.map((a) => a.subject.id)).size;
  // SOMME d'effectifs — donc des INSCRIPTIONS, pas des élèves (S-E03-7 / ADR-079).
  //
  // La valeur ne change pas dans cette tranche ; c'est son NOM qui était faux.
  // Un élève inscrit dans deux des classes de l'enseignant compte deux fois
  // ici, et rien en base ne l'en empêche : l'index unique partiel promis par
  // `schema.prisma` (« au plus une inscription active par élève et par année »)
  // n'existe pas (PF-361/PF-409). Cette somme est donc honnête comme somme de
  // LIGNES d'inscription, et fausse comme nombre d'élèves. Le nombre d'élèves
  // distincts est une LECTURE, jamais une somme : il est rendu par la carte
  // matière du tableau de bord (`distinctStudentCount`).
  const totalEnrolments = classes.reduce((s, c) => s + c.enrolledCount, 0);
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
        <KpiCard
          icon={Users}
          tone="blue"
          label="CLASSES"
          value={totalClasses}
          scope="Classes où vous intervenez cette année."
        />
        {/* `INSCRIPTIONS`, pas `ÉLÈVES` : la valeur est un `reduce(+)` d'effectifs.
            Une carte étiquetée « ÉLÈVES » ne doit jamais porter un cumul — la
            portée sous le nombre ne rattrape pas un nom déjà faux, elle ne fait
            que le rendre à moitié honnête. */}
        <KpiCard
          icon={Layers}
          tone="violet"
          label="INSCRIPTIONS"
          value={totalEnrolments}
          scope={`Somme des effectifs de vos ${totalClasses} classe${
            totalClasses > 1 ? 's' : ''
          }. Un élève inscrit dans deux d'entre elles est compté deux fois.`}
        />
        <KpiCard
          icon={BookOpen}
          tone="green"
          label="MATIÈRES"
          value={totalSubjects}
          scope="Matières distinctes que vous enseignez."
        />
        <KpiCard
          icon={GraduationCap}
          tone="amber"
          label="PROF PRINCIPAL"
          value={mainTeacherOf}
          scope={
            mainTeacherOf > 0
              ? 'Classes dont vous êtes le professeur principal.'
              : 'Vous n’êtes professeur principal d’aucune classe.'
          }
        />
      </div>

      {classes.length === 0 ? (
        <section className="mt-6">
          <EmptyState
            icon={Users}
            title="Aucune affectation pour cette année"
            description="Aucune classe ne vous a été assignée. Contactez l'administration de l'établissement."
            tone="slate"
          />
        </section>
      ) : (
        <TeacherClassesGrid classes={classes} />
      )}
    </PortalShell>
  );
}
