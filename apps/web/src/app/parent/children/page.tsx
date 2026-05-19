import {
  ArrowRight,
  Cake,
  Calendar,
  GraduationCap,
  Layers,
  User,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  StatusBadge,
  formatDateShort,
} from '@pilotage/ui';

export const metadata: Metadata = { title: 'Mes enfants' };
export const dynamic = 'force-dynamic';

interface ChildEnrollment {
  classSection: {
    id: string;
    name: string;
    gradeLevel?: {
      name: string;
      cycle?: { name: string; color: string | null };
    };
  };
  academicYear: { name: string; status: string };
}

interface Child {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  birthDate: string | null;
  externalRef: string | null;
  gender: string | null;
  enrollments: ChildEnrollment[];
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

function computeAge(birthIso: string | null | undefined): number | null {
  if (!birthIso) return null;
  const birth = new Date(birthIso);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function initials(first?: string | null, last?: string | null): string {
  return `${(first ?? '?')[0]}${(last ?? '')[0] ?? ''}`.toUpperCase();
}

export default async function ParentChildrenPage() {
  const resp = await safe(
    api<{ data: Child[]; total: number }>('/api/v1/students', { cache: 'no-store' }),
  );
  const children = resp?.data ?? [];

  const total = children.length;
  const activeClasses = new Set(
    children
      .flatMap((c) => c.enrollments)
      .filter((e) => e.academicYear.status === 'active')
      .map((e) => e.classSection.id),
  ).size;

  // Distinct cycles across all active enrollments — replaces the previous
  // "ÉTABLISSEMENT — —" placeholder KPI with something real.
  const activeCycles = new Set(
    children
      .flatMap((c) => c.enrollments)
      .filter((e) => e.academicYear.status === 'active')
      .map((e) => e.classSection.gradeLevel?.cycle?.name)
      .filter((n): n is string => Boolean(n)),
  );

  const avgAge =
    children.length > 0
      ? children.reduce((s, c) => s + (computeAge(c.birthDate) ?? 0), 0) /
        children.length
      : null;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Mes enfants' },
        ]}
        title="Mes enfants"
        subtitle="Tous les enfants rattachés à votre compte parent — cliquez pour voir le profil complet"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={User} tone="blue" label="ENFANTS" value={total}>
          Rattachés à votre compte
        </KpiCard>
        <KpiCard icon={GraduationCap} tone="violet" label="CLASSES ACTIVES" value={activeClasses}>
          {total > 0 ? 'Année en cours' : 'Aucune inscription'}
        </KpiCard>
        <KpiCard
          icon={Cake}
          tone="amber"
          label="ÂGE MOYEN"
          value={avgAge != null ? Math.round(avgAge) : '—'}
        >
          {avgAge != null ? 'ans · âges arrondis' : 'Pas de date de naissance'}
        </KpiCard>
        <KpiCard
          icon={Layers}
          tone="teal"
          label="CYCLES SUIVIS"
          value={activeCycles.size}
        >
          {activeCycles.size > 0
            ? Array.from(activeCycles).slice(0, 2).join(', ')
            : 'Pas de cycle actif'}
        </KpiCard>
      </div>

      <section className="mt-6">
        {children.length === 0 ? (
          <EmptyState
            icon={User}
            title="Aucun enfant rattaché"
            description="Aucun enfant n'est lié à votre compte parent. Contactez l'administration de l'établissement pour rattacher le dossier de votre enfant à votre compte."
            tone="amber"
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {children.map((c) => {
              const active = c.enrollments.find((e) => e.academicYear.status === 'active');
              const cycleColor = active?.classSection.gradeLevel?.cycle?.color ?? '#3B82F6';
              const age = computeAge(c.birthDate);
              const detailHref = `/parent/children/${c.id}`;
              return (
                <li
                  key={c.id}
                  className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60 transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-slate-300"
                >
                  {/* Colored band by cycle */}
                  <div
                    aria-hidden
                    className="h-1.5 w-full"
                    style={{ background: cycleColor }}
                  />
                  <Link
                    href={detailHref}
                    aria-label={`Voir le profil de ${c.firstName} ${c.lastName}`}
                    className="flex flex-col gap-4 p-5"
                  >
                    <div className="flex items-center gap-3">
                      {c.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.photoUrl}
                          alt={`${c.firstName} ${c.lastName}`}
                          className="h-14 w-14 shrink-0 rounded-xl object-cover ring-2 ring-white"
                        />
                      ) : (
                        <div
                          aria-hidden
                          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white shadow"
                          style={{ background: cycleColor }}
                        >
                          {initials(c.firstName, c.lastName)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-bold text-slate-900">
                          {c.firstName} {c.lastName}
                        </h3>
                        <p className="truncate text-xs text-slate-500">
                          {active
                            ? `${active.classSection.gradeLevel?.cycle?.name ?? ''}${
                                active.classSection.gradeLevel?.cycle?.name ? ' · ' : ''
                              }${active.classSection.name} · ${active.classSection.gradeLevel?.name ?? ''}`
                            : 'Aucune inscription active'}
                        </p>
                        <div className="mt-1.5">
                          <StatusBadge
                            label={active ? 'Inscription active' : 'Inactif'}
                            tone={active ? 'success' : 'warning'}
                            size="sm"
                            withDot
                          />
                        </div>
                      </div>
                    </div>

                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3 w-3 text-slate-400" />
                        <div>
                          <dt className="text-slate-500">Date de naissance</dt>
                          <dd className="font-semibold text-slate-800">
                            {formatDateShort(c.birthDate)}
                          </dd>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Cake className="h-3 w-3 text-slate-400" />
                        <div>
                          <dt className="text-slate-500">Âge</dt>
                          <dd className="font-semibold text-slate-800">
                            {age != null ? `${age} ans` : '—'}
                          </dd>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-slate-500">Identifiant</dt>
                        <dd className="font-mono text-[10px] text-slate-700">
                          {c.externalRef ?? '—'}
                        </dd>
                      </div>
                    </dl>
                  </Link>

                  <div className="mt-auto flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-3">
                    <Link
                      href={detailHref}
                      className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 transition group-hover:underline"
                    >
                      Voir le profil
                      <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/parent/grades?studentId=${c.id}`}
                        className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                      >
                        Notes
                      </Link>
                      <Link
                        href={`/parent/attendance?studentId=${c.id}`}
                        className="rounded-md bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
                      >
                        Absences
                      </Link>
                      <Link
                        href={`/parent/dashboard?studentId=${c.id}`}
                        className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                      >
                        Tableau
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PortalShell>
  );
}
