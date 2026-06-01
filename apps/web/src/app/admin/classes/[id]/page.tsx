import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  CalendarPlus,
  ChevronRight,
  GraduationCap,
  HeartHandshake,
  Pencil,
  ShieldAlert,
  Sparkles,
  UserCog,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';
import { KpiCard, PreferredDate, StatusBadge } from '@pilotage/ui';

import { ClassInfoEditor } from '../ClassInfoEditor';

export const metadata: Metadata = { title: 'Détail classe' };
export const dynamic = 'force-dynamic';

interface ClassTeacher {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  photoUrl: string | null;
  isMainTeacher: boolean;
  subjects: Array<{ id: string; name: string; code: string; color: string | null }>;
}

interface ClassAlert {
  id: string;
  code: string;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  title: string;
  body: string;
  recommendation: string | null;
  studentId: string;
  studentName: string | null;
  subjectName: string | null;
  detectedAt: string;
}

interface ClassDetail {
  id: string;
  name: string;
  maxStudents: number;
  status: 'active' | 'closed';
  room: string | null;
  color: string | null;
  icon: string | null;
  options: Record<string, unknown> | null;
  internalNotes: string | null;
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
  teachers: ClassTeacher[];
  alerts: ClassAlert[];
  openAlertsCount: number;
  gradingRate: { total: number; graded: number; rate: number | null };
  attendanceRate: number | null;
  performance: { averageScore: number | null; passRate: number | null; gradedCount: number };
}

const SEVERITY_TONE: Record<ClassAlert['severity'], 'danger' | 'warning' | 'sky'> = {
  high: 'danger',
  medium: 'warning',
  low: 'sky',
};
const SEVERITY_LABEL: Record<ClassAlert['severity'], string> = {
  high: 'Élevée',
  medium: 'Moyenne',
  low: 'Faible',
};

function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}
function onTwenty(value: number | null): string {
  return value === null ? '—' : `${value}/20`;
}

export default async function ClassDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cls = await api<ClassDetail>(`/api/v1/classes/${id}`, { cache: 'no-store' });
  const fillRate = cls.maxStudents > 0 ? cls.capacity.current / cls.maxStudents : 0;
  const cycleTint = cls.color ?? cls.gradeLevel.cycle.color ?? 'oklch(0.62 0.18 250)';
  const optionEntries =
    cls.options && typeof cls.options === 'object'
      ? Object.entries(cls.options as Record<string, unknown>)
      : [];

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
            {cls.icon ? <span className="text-3xl leading-none">{cls.icon}</span> : <GraduationCap className="h-8 w-8" />}
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
              {cls.room && (
                <>
                  {' · '}
                  <span className="font-semibold text-slate-700">Salle {cls.room}</span>
                </>
              )}
            </p>
          </div>
        </div>
        {/* Actions rapides */}
        <div className="flex flex-wrap items-center gap-2">
          <ClassInfoEditor
            id={cls.id}
            initial={{
              name: cls.name,
              maxStudents: cls.maxStudents,
              room: cls.room,
              color: cls.color,
              icon: cls.icon,
              options: cls.options,
              internalNotes: cls.internalNotes,
            }}
            trigger={
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-slate-700">
                <Pencil className="h-4 w-4" /> Modifier infos
              </span>
            }
          />
          <QuickLink href="/admin/assignments" icon={<UserCog className="h-4 w-4" />}>
            Affecter enseignants
          </QuickLink>
          <QuickLink href="/admin/analytics" icon={<BarChart3 className="h-4 w-4" />}>
            Voir performances
          </QuickLink>
          <QuickLink href={`/admin/students?classSectionId=${cls.id}`} icon={<Users className="h-4 w-4" />}>
            Voir élèves
          </QuickLink>
          <QuickLink href="/admin/calendar" icon={<CalendarPlus className="h-4 w-4" />}>
            Planifier évènement
          </QuickLink>
        </div>
      </header>

      {/* Indicateurs clés */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} tone="blue" label="EFFECTIF" value={`${cls.capacity.current}/${cls.maxStudents}`}>
          {Math.round(fillRate * 100)}% de remplissage
        </KpiCard>
        <KpiCard
          icon={BookOpen}
          tone="violet"
          label="TAUX DE NOTATION"
          value={pct(cls.gradingRate.rate)}
        >
          {cls.gradingRate.graded}/{cls.gradingRate.total} évaluation(s) publiée(s)
        </KpiCard>
        <KpiCard
          icon={GraduationCap}
          tone="green"
          label="PERFORMANCE MOYENNE"
          value={onTwenty(cls.performance.averageScore)}
        >
          {cls.performance.passRate !== null
            ? `${cls.performance.passRate}% ≥ 10/20 · ${cls.performance.gradedCount} note(s)`
            : 'Aucune note publiée'}
        </KpiCard>
        <KpiCard
          icon={ShieldAlert}
          tone={cls.openAlertsCount > 0 ? 'rose' : 'slate'}
          label="ALERTES OUVERTES"
          value={cls.openAlertsCount}
        >
          {cls.attendanceRate !== null
            ? `Présence ${cls.attendanceRate}%`
            : 'Présence non renseignée'}
        </KpiCard>
      </div>

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

      {/* Informations personnalisées (options + observations internes) */}
      {(optionEntries.length > 0 || cls.internalNotes) && (
        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          {optionEntries.length > 0 && (
            <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-600">
                <Sparkles className="h-4 w-4 text-slate-500" /> Options pédagogiques
              </h3>
              <dl className="mt-3 space-y-2">
                {optionEntries.map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-3 text-sm">
                    <dt className="font-medium text-slate-500">{key}</dt>
                    <dd className="text-right font-semibold text-slate-900">
                      {Array.isArray(value) ? value.join(', ') : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {cls.internalNotes && (
            <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
                Observations internes
              </h3>
              <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{cls.internalNotes}</p>
              <p className="mt-2 text-[11px] italic text-slate-400">
                Visible uniquement par l&apos;équipe administrative.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Enseignants */}
      <section className="mt-6 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <UserCog className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
              Équipe enseignante ({cls.teachers.length})
            </h3>
          </div>
          <Link href="/admin/assignments" className="text-xs font-bold accent-text hover:underline">
            Gérer les affectations →
          </Link>
        </div>
        {cls.teachers.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-500">
            Aucun enseignant affecté à cette classe.{' '}
            <Link href="/admin/assignments" className="font-bold accent-text hover:underline">
              Affecter
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {cls.teachers.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-indigo-100 to-blue-100 text-sm font-bold text-blue-700">
                  {(t.firstName[0] ?? '?').toUpperCase()}
                  {(t.lastName[0] ?? '').toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">
                      {t.lastName.toUpperCase()} {t.firstName}
                    </span>
                    {t.isMainTeacher && (
                      <StatusBadge tone="violet" size="sm" label="Prof. principal" />
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    {t.subjects.length === 0 ? (
                      <span className="text-[11px] text-slate-400">Aucune matière</span>
                    ) : (
                      t.subjects.map((s) => (
                        <span
                          key={s.id}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200"
                        >
                          <span
                            aria-hidden
                            className="h-2 w-2 rounded-full"
                            style={{ background: s.color ?? 'oklch(0.62 0.18 250)' }}
                          />
                          {s.name}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
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

      {/* Alertes liées à la classe */}
      <section className="mt-6 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
              Alertes de la classe ({cls.alerts.length})
            </h3>
          </div>
          <Link href="/admin/alerts" className="text-xs font-bold accent-text hover:underline">
            Toutes les alertes →
          </Link>
        </div>
        {cls.alerts.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-slate-500">
            Aucune alerte associée à cette classe.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {cls.alerts.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                <StatusBadge
                  tone={SEVERITY_TONE[a.severity]}
                  size="sm"
                  label={SEVERITY_LABEL[a.severity]}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-900">{a.title}</div>
                  <div className="text-xs text-slate-500">{a.body}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {a.studentName && <span className="font-medium">{a.studentName}</span>}
                    {a.subjectName && <span> · {a.subjectName}</span>}
                    {' · '}
                    <PreferredDate value={a.detectedAt} />
                  </div>
                </div>
                <StatusBadge status={a.status} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </PortalShell>
  );
}

function QuickLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
    >
      {icon}
      {children}
    </Link>
  );
}
