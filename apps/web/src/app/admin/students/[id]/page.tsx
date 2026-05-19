import { ArrowLeft, GraduationCap, HeartHandshake, IdCard } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';
import { PreferredDate } from '@pilotage/ui';

import { StudentDetailTabs } from './StudentDetailTabs';

export const metadata: Metadata = { title: "Détail élève" };
export const dynamic = 'force-dynamic';

export interface StudentDetail {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  externalRef: string | null;
  email: string | null;
  phone: string | null;
  gender: string | null;
  nationality: string | null;
  address: Record<string, unknown> | null;
  medicalNotes: string | null;
  status: 'active' | 'transferred' | 'graduated' | 'withdrawn';
  notes: string | null;
  customFields: Record<string, unknown>;
  schoolId: string;
  enrollments: Array<{
    id: string;
    status: string;
    enrolledAt: string;
    endedAt: string | null;
    endReason: string | null;
    classSection: {
      id: string;
      name: string;
      maxStudents: number;
      gradeLevel: { id: string; name: string; code: string; cycle?: { id: string; name: string; color: string | null } };
    };
    academicYear: { id: string; name: string; status: string };
  }>;
  guardianships: Array<{
    id: string;
    relationship: string;
    isPrimaryContact: boolean;
    canPickup: boolean;
    hasLegalCustody: boolean;
    status: string;
    notes: string | null;
    guardian: {
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      profession: string | null;
    };
  }>;
}

export interface SimpleClass {
  id: string;
  name: string;
  maxStudents: number;
  status: string;
  academicYearId: string;
  gradeLevel: { id: string; name: string; code: string; cycle?: { id: string; name: string; color: string | null } };
  academicYear: { id: string; name: string; status: string };
}

export interface SimpleGuardian {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [student, classes, guardians] = await Promise.all([
    api<StudentDetail>(`/api/v1/students/${id}`, { cache: 'no-store' }),
    api<{ data: SimpleClass[] }>('/api/v1/classes', { cache: 'no-store' }),
    api<{ data: SimpleGuardian[] }>('/api/v1/guardians?limit=200', { cache: 'no-store' }),
  ]);

  const activeEnrollment = student.enrollments.find((e) => e.status === 'active');

  return (
    <PortalShell portal="admin">
      <Link
        href="/admin/students"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour à la liste
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-indigo-100 via-blue-100 to-cyan-100 text-2xl font-bold text-blue-700 shadow-inner">
            {(student.firstName[0] ?? '?').toUpperCase()}
            {(student.lastName[0] ?? '').toUpperCase()}
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {student.lastName.toUpperCase()} {student.firstName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {student.externalRef && (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono">{student.externalRef}</span>
              )}
              {student.birthDate && (
                <span>
                  Né(e) le <PreferredDate value={student.birthDate} formatOverride="long" />
                </span>
              )}
              {activeEnrollment && (
                <span className="inline-flex items-center gap-1 rounded-md accent-soft-bg px-2 py-0.5 accent-text font-bold">
                  {activeEnrollment.classSection.gradeLevel?.cycle?.name && (
                    <span className="font-semibold accent-text">
                      {activeEnrollment.classSection.gradeLevel.cycle.name} ·
                    </span>
                  )}
                  {activeEnrollment.classSection.gradeLevel?.name && (
                    <>{activeEnrollment.classSection.gradeLevel.name} · </>
                  )}
                  {activeEnrollment.classSection.name} ({activeEnrollment.academicYear.name})
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <Stat icon={<IdCard className="h-4 w-4" />} label="Statut" value={student.status} />
          <Stat icon={<GraduationCap className="h-4 w-4" />} label="Inscriptions" value={student.enrollments.length.toString()} />
          <Stat icon={<HeartHandshake className="h-4 w-4" />} label="Parents" value={student.guardianships.filter((g) => g.status === 'active').length.toString()} />
        </div>
      </header>

      <div className="mt-8">
        <StudentDetailTabs student={student} classes={classes.data} guardians={guardians.data} />
      </div>
    </PortalShell>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
      <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}
