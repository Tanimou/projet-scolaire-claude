import { ArrowLeft, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

export const metadata: Metadata = { title: 'Notes' };
export const dynamic = 'force-dynamic';

interface Student {
  id: string;
  firstName: string;
  lastName: string;
}

interface Grade {
  id: string;
  value: string | null;
  isAbsent: boolean;
  status: string;
  comment: string | null;
  assessment: {
    id: string;
    title: string;
    kind: string;
    scheduledAt: string | null;
    maxScore: string;
    coefficientOverride: string | null;
    isPublished: boolean;
    teachingAssignment: {
      subject: { id: string; name: string; color: string | null };
    };
    term: { id: string; name: string } | null;
  };
}

export default async function ParentGradesPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  const sp = await searchParams;
  const students = await api<{ data: Student[] }>('/api/v1/students', { cache: 'no-store' });
  const selectedId = sp.studentId ?? students.data[0]?.id;
  const grades = selectedId
    ? await api<{ data: Grade[] }>(`/api/v1/grades/students/${selectedId}/grades`, {
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
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">Notes détaillées</h1>

      {students.data.length > 1 && (
        <form method="GET" action="/parent/grades" className="mt-4">
          <select
            name="studentId"
            defaultValue={selectedId ?? ''}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            onChange={(e) => e.currentTarget.form?.submit()}
          >
            {students.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName}
              </option>
            ))}
          </select>
        </form>
      )}

      {grades.data.length === 0 ? (
        <div className="mt-5 rounded-2xl bg-white p-6 text-center ring-1 ring-slate-200">
          <TrendingUp className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">Aucune note publiée</p>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {grades.data.map((g) => (
            <li key={g.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: g.assessment.teachingAssignment.subject.color ?? 'oklch(0.65 0.15 250)' }}
                    />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {g.assessment.teachingAssignment.subject.name}
                    </span>
                    {g.assessment.term && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                        {g.assessment.term.name}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 text-sm font-bold text-slate-900">{g.assessment.title}</h3>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {g.assessment.scheduledAt &&
                      new Date(g.assessment.scheduledAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                    {' · '}
                    coef {Number(g.assessment.coefficientOverride ?? 1)}
                  </div>
                  {g.comment && (
                    <p className="mt-2 rounded-md bg-slate-50 px-2 py-1 text-xs italic text-slate-700">
                      « {g.comment} »
                    </p>
                  )}
                </div>
                <div className="text-right">
                  {g.isAbsent ? (
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                      Absent
                    </span>
                  ) : (
                    <div className="font-mono text-2xl font-bold tabular-nums text-slate-900">
                      {Number(g.value)}
                      <span className="text-sm font-normal text-slate-400">
                        /{Number(g.assessment.maxScore)}
                      </span>
                    </div>
                  )}
                  {g.status === 'revised' && (
                    <span className="mt-1 inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                      Révisée
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PortalShell>
  );
}
