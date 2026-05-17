import { BookOpen, ClipboardCheck, GraduationCap, UserX } from 'lucide-react';
import type { Metadata } from 'next';

import {
  AssignmentsManager,
  type Assignment,
  type ClassOption,
  type SubjectOption,
  type TeacherOption,
} from '@/app/admin/teaching-assignments/AssignmentsManager';
import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { KpiCard, PageHeader } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Affectations' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function AssignmentsPage() {
  const [assignmentsResp, teachersResp, classesResp, subjectsResp] = await Promise.all([
    safe(api<{ data: Assignment[] }>('/api/v1/teaching-assignments', { cache: 'no-store' })),
    safe(api<{ data: TeacherOption[] }>('/api/v1/teachers', { cache: 'no-store' })),
    safe(api<{ data: ClassOption[] }>('/api/v1/classes', { cache: 'no-store' })),
    safe(api<{ data: SubjectOption[] }>('/api/v1/subjects', { cache: 'no-store' })),
  ]);

  const assignments = assignmentsResp?.data ?? [];
  const teachers = teachersResp?.data ?? [];
  const classes = classesResp?.data ?? [];
  const subjects = subjectsResp?.data ?? [];

  const totalAssignments = assignments.length;
  const teachersAssigned = new Set(assignments.map((a) => a.teacherProfile.id)).size;
  const classesCovered = new Set(assignments.map((a) => a.classSection.id)).size;
  const assignedSubjectIds = new Set(assignments.map((a) => a.subject.id));
  const subjectsWithoutTeacher = subjects.filter((s) => !assignedSubjectIds.has(s.id)).length;

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Affectations' },
        ]}
        title="Affectations professeurs"
        subtitle="Une affectation = un trio Professeur × Classe × Matière. Un PP par classe."
      />

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={ClipboardCheck} tone="blue" label="AFFECTATIONS ACTIVES" value={totalAssignments}>
          Trios Prof × Classe × Matière
        </KpiCard>
        <KpiCard icon={GraduationCap} tone="green" label="ENSEIGNANTS AFFECTÉS" value={teachersAssigned}>
          {teachers.length} enseignants au total
        </KpiCard>
        <KpiCard icon={BookOpen} tone="violet" label="CLASSES COUVERTES" value={classesCovered}>
          {classes.length} classes au total
        </KpiCard>
        <KpiCard icon={UserX} tone="orange" label="MATIÈRES SANS ENSEIGNANT" value={subjectsWithoutTeacher}>
          À pourvoir
        </KpiCard>
      </div>

      <div className="mt-6">
        <AssignmentsManager
          assignments={assignments}
          teachers={teachers}
          classes={classes}
          subjects={subjects}
        />
      </div>
    </PortalShell>
  );
}
