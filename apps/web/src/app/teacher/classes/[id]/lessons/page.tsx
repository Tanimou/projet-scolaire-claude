import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

import { LessonsManager } from './LessonsManager';

export const metadata: Metadata = { title: 'Cahier de texte' };
export const dynamic = 'force-dynamic';

interface Lesson {
  id: string;
  date: string;
  title: string;
  content: string;
  homework: string | null;
  homeworkDueAt: string | null;
  status: 'draft' | 'published';
}

interface MyAssignmentsResp {
  data: Array<{
    id: string;
    classSection: { name: string; gradeLevel: { name: string; cycle: { name: string } } };
    subject: { name: string };
  }>;
}

export default async function LessonsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lessons, mine] = await Promise.all([
    api<{ data: Lesson[] }>(`/api/v1/lessons?teachingAssignmentId=${id}&limit=200`, { cache: 'no-store' }),
    api<MyAssignmentsResp>('/api/v1/teachers/me/assignments', { cache: 'no-store' }),
  ]);
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
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Cahier de texte</h1>
        <p className="mt-1 text-sm text-slate-600">
          Trace ce qui a été fait en classe + devoirs maison. Visible automatiquement par les parents.
        </p>
      </div>
      <div className="mt-6">
        <LessonsManager lessons={lessons.data} teachingAssignmentId={id} />
      </div>
    </PortalShell>
  );
}
