import { ArrowLeft, BookOpen, Calendar, GraduationCap, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

export const metadata: Metadata = { title: 'Mon enfant' };
export const dynamic = 'force-dynamic';

interface StudentDetail {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  externalRef: string | null;
  enrollments: Array<{
    id: string;
    status: string;
    classSection: {
      id: string;
      name: string;
      gradeLevel: { name: string; cycle?: { name: string; color: string | null } };
    };
    academicYear: { id: string; name: string; status: string };
  }>;
}

interface Stats {
  bySubject: Array<{
    subjectId: string;
    subjectName: string;
    subjectColor: string | null;
    coefficient: number;
    count: number;
    average: number | null;
    min: number | null;
    max: number | null;
  }>;
  overallAverage: number | null;
}

interface Lesson {
  id: string;
  date: string;
  title: string;
  homework: string | null;
  teachingAssignment: { subject: { name: string; color: string | null } };
}

interface AttendanceSummary {
  records: Array<{
    id: string;
    status: string;
    classSession: { date: string; teachingAssignment: { subject: { name: string } } };
  }>;
  summary: { total: number; present: number; absent: number; absentExcused: number; late: number; leftEarly: number };
}

export default async function ChildDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [student, stats, lessons, attendance] = await Promise.all([
    api<StudentDetail>(`/api/v1/students/${id}`, { cache: 'no-store' }),
    api<Stats>(`/api/v1/grades/students/${id}/stats`, { cache: 'no-store' }),
    api<{ data: Lesson[] }>(`/api/v1/lessons?studentId=${id}&limit=5`, { cache: 'no-store' }),
    api<AttendanceSummary>(`/api/v1/attendance/students/${id}`, { cache: 'no-store' }),
  ]);
  const active = student.enrollments.find((e) => e.status === 'active');

  return (
    <PortalShell portal="parent" contentClassName="mx-auto max-w-md px-5 pb-24 pt-6">
      <Link
        href="/parent/dashboard"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour
      </Link>

      <header className="mt-3 flex items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-sky-100 to-blue-100 text-lg font-bold text-blue-700">
          {student.firstName[0]?.toUpperCase()}
          {student.lastName[0]?.toUpperCase()}
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            {student.firstName} {student.lastName.toUpperCase()}
          </h1>
          {active && (
            <div className="mt-0.5 text-xs text-slate-500">
              {active.classSection.gradeLevel?.cycle?.name && (
                <strong>{active.classSection.gradeLevel.cycle.name} · </strong>
              )}
              {active.classSection.gradeLevel?.name && (
                <>{active.classSection.gradeLevel.name} · </>
              )}
              {active.classSection.name} · {active.academicYear.name}
            </div>
          )}
        </div>
      </header>

      <section className="mt-5 overflow-hidden rounded-2xl bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-700 p-5 text-white">
        <div className="text-[10px] font-bold uppercase tracking-wider text-white/80">
          Moyenne générale
        </div>
        <div className="mt-1 flex items-end gap-2">
          <div className="font-mono text-5xl font-bold tabular-nums">
            {stats.overallAverage ?? '—'}
          </div>
          <div className="pb-2 text-base text-white/70">/ 20</div>
        </div>
        <div className="mt-2 text-xs text-white/85">
          {stats.bySubject.length} matière(s) suivie(s)
        </div>
      </section>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">Par matière</h2>
        {stats.bySubject.length === 0 ? (
          <div className="rounded-2xl bg-white p-5 text-center text-sm text-slate-500 ring-1 ring-slate-200">
            Aucune note publiée pour l&apos;instant.
          </div>
        ) : (
          <ul className="space-y-2">
            {stats.bySubject.map((s) => (
              <li key={s.subjectId} className="flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
                <span
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ background: s.subjectColor ?? 'oklch(0.65 0.15 250)' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{s.subjectName}</div>
                  <div className="text-[11px] text-slate-500">
                    {s.count} note(s) · coef {s.coefficient}
                  </div>
                </div>
                <div className="font-mono text-lg font-bold tabular-nums text-slate-900">
                  {s.average ?? '—'}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={`/parent/grades?studentId=${id}`}
          className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline"
        >
          Voir le détail des notes <TrendingUp className="h-3 w-3" />
        </Link>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-slate-500">
          <Calendar className="h-3.5 w-3.5" /> Présences
        </h2>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-emerald-50 p-3">
            <div className="font-mono text-2xl font-bold text-emerald-700">{attendance.summary.present}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Présent</div>
          </div>
          <div className="rounded-xl bg-rose-50 p-3">
            <div className="font-mono text-2xl font-bold text-rose-700">{attendance.summary.absent}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600">Absent</div>
          </div>
          <div className="rounded-xl bg-amber-50 p-3">
            <div className="font-mono text-2xl font-bold text-amber-700">{attendance.summary.late}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Retard</div>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-slate-500">
          <BookOpen className="h-3.5 w-3.5" /> Cahier de texte récent
        </h2>
        {lessons.data.length === 0 ? (
          <div className="rounded-2xl bg-white p-4 text-center text-sm text-slate-500 ring-1 ring-slate-200">
            Aucune entrée pour l&apos;instant.
          </div>
        ) : (
          <ul className="space-y-2">
            {lessons.data.map((l) => (
              <li key={l.id} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                <div className="flex items-center gap-2 text-[11px]">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: l.teachingAssignment.subject.color ?? 'oklch(0.65 0.15 250)' }}
                  />
                  <span className="font-bold text-slate-700">{l.teachingAssignment.subject.name}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">
                    {new Date(l.date).toLocaleDateString('fr-FR', { dateStyle: 'short' })}
                  </span>
                </div>
                <div className="mt-1 text-sm font-bold text-slate-900">{l.title}</div>
                {l.homework && (
                  <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                    📝 Devoirs
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <Link
          href={`/parent/lessons?studentId=${id}`}
          className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline"
        >
          Tout le cahier <GraduationCap className="h-3 w-3" />
        </Link>
      </section>
    </PortalShell>
  );
}
