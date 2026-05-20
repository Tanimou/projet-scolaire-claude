import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  GraduationCap,
  HeartHandshake,
  Layers,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';
import { PreferredDate } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Détail classe' };
export const dynamic = 'force-dynamic';

interface ClassDetail {
  id: string;
  name: string;
  maxStudents: number;
  status: 'active' | 'closed';
  academicYear: { id: string; name: string; status: string; startDate: string; endDate: string };
  gradeLevel: {
    id: string;
    code: string;
    name: string;
    cycle: { id: string; name: string; code: string; color: string | null; icon: string | null };
  };
  enrollments: Array<{
    id: string;
    enrolledAt: string;
    student: {
      id: string;
      firstName: string;
      lastName: string;
      externalRef: string | null;
      gender: string | null;
      birthDate: string | null;
      email: string | null;
      status: string;
      _count: { guardianships: number };
    };
  }>;
  subjects: Array<{
    id: string;
    code: string;
    name: string;
    color: string | null;
    icon: string | null;
    defaultCoefficient: string;
    coefficient: string;
    isOverride: boolean;
  }>;
  capacity: { current: number; max: number };
}

export default async function ClassDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cls = await api<ClassDetail>(`/api/v1/classes/${id}`, { cache: 'no-store' });
  const fillRate = cls.maxStudents > 0 ? cls.capacity.current / cls.maxStudents : 0;
  const cycleTint = cls.gradeLevel.cycle.color ?? 'oklch(0.62 0.18 250)';

  return (
    <PortalShell portal="admin">
      <Link
        href="/admin/classes"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux classes
      </Link>

      {/* Breadcrumb of the relationship chain */}
      <nav aria-label="Hiérarchie" className="mt-4 flex flex-wrap items-center gap-1 text-xs text-slate-500">
        <Link href="/admin/school/structure" className="rounded transition-colors hover:accent-text focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:accent-outline">
          École
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/admin/cycles" className="rounded transition-colors hover:accent-text focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:accent-outline">
          Cycle <strong className="text-slate-700">{cls.gradeLevel.cycle.name}</strong>
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/admin/cycles" className="rounded transition-colors hover:accent-text focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:accent-outline">
          Niveau <strong className="text-slate-700">{cls.gradeLevel.name}</strong>{' '}
          <span className="font-mono text-[10px] text-slate-400">({cls.gradeLevel.code})</span>
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-bold text-slate-900">{cls.name}</span>
        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-600">
          {cls.academicYear.name}
        </span>
      </nav>

      {/* Header */}
      <header className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="grid h-16 w-16 place-items-center rounded-2xl text-2xl font-bold text-white shadow-lg"
            style={{ background: cycleTint }}
          >
            <GraduationCap className="h-8 w-8" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Classe {cls.name}
              {cls.status === 'closed' && (
                <span className="ml-3 rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-slate-700">
                  Fermée
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {cls.gradeLevel.name} · {cls.gradeLevel.cycle.name} · Année {cls.academicYear.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <Stat icon={<Users className="h-4 w-4" />} label="Inscrits" value={`${cls.capacity.current}/${cls.maxStudents}`} />
          <Stat icon={<BookOpen className="h-4 w-4" />} label="Matières" value={cls.subjects.length.toString()} />
        </div>
      </header>

      {/* Capacity bar */}
      <section className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold uppercase tracking-wider text-slate-500">Remplissage</span>
          <span className="font-mono font-bold tabular-nums text-slate-700">
            {Math.round(fillRate * 100)}%
          </span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full transition-all ${
              fillRate >= 1 ? 'bg-rose-500' : fillRate >= 0.85 ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.min(100, fillRate * 100)}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-slate-500">
          <span>{cls.capacity.current} élève(s)</span>
          <span>Capacité {cls.maxStudents}</span>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Roster — 2 cols */}
        <section className="lg:col-span-2 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
                Élèves inscrits ({cls.enrollments.length})
              </h3>
            </div>
            <Link
              href={`/admin/students?classSectionId=${cls.id}`}
              className="text-xs font-bold accent-text hover:underline"
            >
              Voir tous →
            </Link>
          </div>
          {cls.enrollments.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <Users className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">Aucun élève dans cette classe</p>
              <p className="mt-1 text-xs text-slate-500">
                Allez sur une fiche élève pour l&apos;inscrire ici, ou importez en masse via{' '}
                <Link href="/admin/imports" className="font-bold accent-text hover:underline">
                  /admin/imports
                </Link>{' '}
                (type « enrollments »).
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {cls.enrollments.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/admin/students/${e.student.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50/60"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-indigo-100 to-blue-100 text-sm font-bold text-blue-700">
                      {(e.student.firstName[0] ?? '?').toUpperCase()}
                      {(e.student.lastName[0] ?? '').toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-900">
                        {e.student.lastName.toUpperCase()} {e.student.firstName}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {e.student.externalRef && (
                          <span className="font-mono mr-2">{e.student.externalRef}</span>
                        )}
                        {e.student.birthDate && (
                          <span>
                            né(e) le <PreferredDate value={e.student.birthDate} />
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500">
                      <HeartHandshake className="h-3 w-3" />
                      {e.student._count.guardianships}
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Subjects + coefficients */}
        <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
                Matières & coefficients
              </h3>
            </div>
            <Link href="/admin/subjects" className="text-xs font-bold accent-text hover:underline">
              Modifier →
            </Link>
          </div>
          <p className="px-5 pt-3 text-[11px] text-slate-500">
            Coefficients hérités du <strong>niveau {cls.gradeLevel.name}</strong>. Une étiquette « personnalisé » indique une valeur surchargée.
          </p>
          <ul className="divide-y divide-slate-100">
            {cls.subjects.length === 0 ? (
              <li className="px-5 py-4 text-center text-xs italic text-slate-400">
                Aucune matière active dans l&apos;école.
              </li>
            ) : (
              cls.subjects.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ background: s.color ?? 'oklch(0.65 0.15 250)' }}
                  />
                  <span className="flex-1 text-sm font-bold text-slate-900">{s.name}</span>
                  <span className="font-mono text-xs font-bold tabular-nums text-slate-700">
                    coef {Number(s.coefficient)}
                  </span>
                  {s.isOverride ? (
                    <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-700">
                      personnalisé
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                      défaut
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        </section>
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
