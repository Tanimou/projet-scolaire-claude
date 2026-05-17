import { ArrowLeft, BookOpen, Calendar, ChevronRight, Crown, FileSpreadsheet, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

export const metadata: Metadata = { title: 'Ma classe' };
export const dynamic = 'force-dynamic';

interface MyAssignmentsResp {
  data: Array<{
    id: string;
    isMainTeacher: boolean;
    classSection: {
      id: string;
      name: string;
      gradeLevel: { name: string; cycle: { name: string; color: string | null } };
      _count: { enrollments: number };
    };
    subject: { id: string; name: string; color: string | null };
    academicYear: { id: string; name: string };
  }>;
}

export default async function TeacherClassDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mine = await api<MyAssignmentsResp>('/api/v1/teachers/me/assignments', { cache: 'no-store' });
  const assignment = mine.data.find((a) => a.id === id);
  if (!assignment) redirect('/teacher/dashboard?error=unknown_assignment');

  return (
    <PortalShell portal="teacher">
      <Link
        href="/teacher/dashboard"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour au tableau de bord
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="grid h-14 w-14 place-items-center rounded-2xl text-white shadow-lg"
            style={{
              background:
                assignment.subject.color ??
                assignment.classSection.gradeLevel?.cycle?.color ??
                'oklch(0.62 0.12 180)',
            }}
          >
            <BookOpen className="h-7 w-7" />
          </span>
          <div>
            <div className="text-xs text-slate-500">
              {assignment.classSection.gradeLevel?.cycle?.name && (
                <>{assignment.classSection.gradeLevel.cycle.name} · </>
              )}
              {assignment.classSection.gradeLevel?.name}
            </div>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
              {assignment.classSection.name} · {assignment.subject.name}
            </h1>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <span className="rounded-md bg-slate-100 px-2 py-0.5">{assignment.academicYear.name}</span>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                <span className="font-mono font-bold tabular-nums">
                  {assignment.classSection._count.enrollments}
                </span>{' '}
                élèves
              </span>
              {assignment.isMainTeacher && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700">
                  <Crown className="h-3 w-3" /> Professeur principal
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ActionCard
          href={`/teacher/classes/${id}/grades`}
          title="Gradebook"
          body="Saisir, modifier et publier les notes des évaluations."
          Icon={FileSpreadsheet}
        />
        <ActionCard
          href={`/teacher/classes/${id}/lessons`}
          title="Cahier de texte"
          body="Tracer les leçons, les devoirs maison, les supports."
          Icon={BookOpen}
        />
        <ActionCard
          href={`/teacher/classes/${id}/attendance`}
          title="Présences"
          body="Ouvrir une séance et faire l'appel des élèves."
          Icon={Calendar}
        />
      </div>
    </PortalShell>
  );
}

function ActionCard({
  href,
  title,
  body,
  Icon,
}: {
  href: string;
  title: string;
  body: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-teal-300 hover:bg-teal-50/30"
    >
      <div className="flex items-center justify-between">
        <Icon className="h-6 w-6 text-slate-500 transition group-hover:text-teal-700" />
        <ChevronRight className="h-4 w-4 text-slate-400 transition group-hover:text-teal-700" />
      </div>
      <div className="mt-3 text-base font-bold text-slate-900">{title}</div>
      <p className="mt-1 text-xs text-slate-600">{body}</p>
    </Link>
  );
}
