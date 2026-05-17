import { ArrowLeft, BookOpen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

export const metadata: Metadata = { title: 'Cahier de texte' };
export const dynamic = 'force-dynamic';

interface Student {
  id: string;
  firstName: string;
  lastName: string;
}

interface Lesson {
  id: string;
  date: string;
  title: string;
  content: string;
  homework: string | null;
  homeworkDueAt: string | null;
  teachingAssignment: {
    subject: { id: string; name: string; color: string | null };
    classSection: { id: string; name: string };
  };
  teacherProfile: { userProfile: { firstName: string; lastName: string } };
}

export default async function ParentLessonsPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  const sp = await searchParams;
  const students = await api<{ data: Student[] }>('/api/v1/students', { cache: 'no-store' });
  const selectedId = sp.studentId ?? students.data[0]?.id;
  const lessons = selectedId
    ? await api<{ data: Lesson[] }>(`/api/v1/lessons?studentId=${selectedId}&limit=50`, {
        cache: 'no-store',
      })
    : { data: [] };

  return (
    <PortalShell portal="parent" contentClassName="mx-auto max-w-md px-5 pb-24 pt-6">
      <Link
        href="/parent/dashboard"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">Cahier de texte</h1>

      {students.data.length > 1 && (
        <form method="GET" action="/parent/lessons" className="mt-4">
          <select
            name="studentId"
            defaultValue={selectedId ?? ''}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {students.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName}
              </option>
            ))}
          </select>
        </form>
      )}

      {lessons.data.length === 0 ? (
        <div className="mt-5 rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <BookOpen className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">Aucune entrée pour l&apos;instant</p>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {lessons.data.map((l) => (
            <li key={l.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="flex items-center gap-2 text-[11px]">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: l.teachingAssignment.subject.color ?? 'oklch(0.65 0.15 250)' }}
                />
                <span className="font-bold text-slate-700">{l.teachingAssignment.subject.name}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">
                  {new Date(l.date).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                </span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500 truncate">
                  {l.teacherProfile.userProfile.firstName} {l.teacherProfile.userProfile.lastName[0]}.
                </span>
              </div>
              <h3 className="mt-2 text-sm font-bold text-slate-900">{l.title}</h3>
              <p className="mt-1 text-sm text-slate-600 whitespace-pre-line line-clamp-4">{l.content}</p>
              {l.homework && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-700">
                    📝 Devoirs
                    {l.homeworkDueAt && (
                      <span className="font-normal">
                        · pour le {new Date(l.homeworkDueAt).toLocaleDateString('fr-FR', { dateStyle: 'short' })}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-amber-900 whitespace-pre-line">{l.homework}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </PortalShell>
  );
}
