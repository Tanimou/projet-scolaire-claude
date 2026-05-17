import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

import { AttendanceManager } from './AttendanceManager';

export const metadata: Metadata = { title: 'Présences' };
export const dynamic = 'force-dynamic';

interface MyAssignmentsResp {
  data: Array<{
    id: string;
    classSection: { name: string; gradeLevel: { name: string; cycle: { name: string } } };
    subject: { name: string };
  }>;
}

export default async function AttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mine = await api<MyAssignmentsResp>('/api/v1/teachers/me/assignments', { cache: 'no-store' });
  const a = mine.data.find((x) => x.id === id);

  return (
    <PortalShell portal="teacher">
      <Link
        href={`/teacher/classes/${id}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour à la classe
      </Link>
      <div className="mt-4">
        <div className="text-xs text-slate-500">
          {a?.classSection.gradeLevel?.cycle?.name && (
            <>{a.classSection.gradeLevel.cycle.name} · </>
          )}
          {a?.classSection.name} · {a?.subject.name}
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Présences</h1>
        <p className="mt-1 text-sm text-slate-600">
          Ouvrez une séance pour une date donnée et faites l&apos;appel.
        </p>
      </div>
      <div className="mt-6">
        <AttendanceManager teachingAssignmentId={id} />
      </div>
    </PortalShell>
  );
}
