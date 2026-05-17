import { CalendarClock, ClipboardCheck, Clock, Target } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  StatusBadge,
  SubjectChip,
  formatDateShort,
  formatInDays,
} from '@pilotage/ui';

import { ChildSelector } from '../_components/ChildSelector';

export const metadata: Metadata = { title: 'Évaluations à venir' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
}

interface UpcomingItem {
  id: string;
  title: string;
  date: string;
  subjectName: string;
  subjectColor: string | null;
  subjectCode: string;
}

interface DashboardResp {
  student: { id: string; firstName: string; lastName: string };
  upcomingAssessments: UpcomingItem[];
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function ParentUpcomingPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  const sp = await searchParams;
  const studentsResp = await safe(
    api<{ data: StudentSummary[] }>('/api/v1/students', { cache: 'no-store' }),
  );
  const children = studentsResp?.data ?? [];

  if (children.length === 0) {
    return (
      <PortalShell portal="parent">
        <PageHeader
          breadcrumb={[
            { label: 'Tableau de bord', href: '/parent/dashboard' },
            { label: 'Évaluations à venir' },
          ]}
          title="Évaluations à venir"
        />
        <EmptyState
          icon={CalendarClock}
          title="Aucun enfant rattaché"
          description="Les prochaines évaluations apparaîtront ici dès qu'un enfant sera lié à votre compte."
          tone="amber"
          className="mt-6"
        />
      </PortalShell>
    );
  }

  const activeStudentId =
    sp.studentId && children.find((c) => c.id === sp.studentId)
      ? sp.studentId
      : children[0]!.id;

  const dashboard = await safe(
    api<DashboardResp>(`/api/v1/analytics/parent-dashboard/${activeStudentId}`, {
      cache: 'no-store',
    }),
  );
  const upcoming = dashboard?.upcomingAssessments ?? [];

  const now = new Date();
  const oneWeek = new Date(now);
  oneWeek.setDate(now.getDate() + 7);
  const twoWeeks = new Date(now);
  twoWeeks.setDate(now.getDate() + 14);

  const thisWeek = upcoming.filter((u) => new Date(u.date) <= oneWeek).length;
  const nextWeek = upcoming.filter((u) => {
    const d = new Date(u.date);
    return d > oneWeek && d <= twoWeeks;
  }).length;
  const beyond = upcoming.filter((u) => new Date(u.date) > twoWeeks).length;
  const subjectsTouched = new Set(upcoming.map((u) => u.subjectCode)).size;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Évaluations à venir' },
        ]}
        title="Évaluations à venir"
        subtitle="Toutes les évaluations planifiées pour les prochaines semaines"
      />

      <div className="mt-4">
        <ChildSelector options={children} activeStudentId={activeStudentId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={ClipboardCheck} tone="blue" label="TOTAL" value={upcoming.length}>
          Évaluations planifiées
        </KpiCard>
        <KpiCard icon={Clock} tone="rose" label="CETTE SEMAINE" value={thisWeek}>
          Sous 7 jours
        </KpiCard>
        <KpiCard icon={CalendarClock} tone="amber" label="SEMAINE PROCHAINE" value={nextWeek}>
          Entre 7 et 14 jours
        </KpiCard>
        <KpiCard icon={Target} tone="violet" label="MATIÈRES" value={subjectsTouched}>
          Matières concernées
        </KpiCard>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Aucune évaluation à venir"
            description="Aucune évaluation n'est planifiée pour le moment. Cette liste se met à jour automatiquement quand un enseignant planifie une évaluation."
            tone="slate"
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {upcoming.map((u) => {
              const date = new Date(u.date);
              const isThisWeek = date <= oneWeek;
              return (
                <li
                  key={u.id}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/60"
                >
                  {/* Date block */}
                  <div className="shrink-0 text-center">
                    <div
                      className={
                        isThisWeek
                          ? 'rounded-lg bg-rose-50 px-3 py-2 ring-1 ring-rose-200'
                          : 'rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200'
                      }
                    >
                      <div
                        className={
                          isThisWeek
                            ? 'text-[10px] font-bold uppercase tracking-wider text-rose-700'
                            : 'text-[10px] font-bold uppercase tracking-wider text-slate-500'
                        }
                      >
                        {date.toLocaleDateString('fr-FR', { month: 'short' })}
                      </div>
                      <div
                        className={
                          isThisWeek
                            ? 'mt-0.5 text-2xl font-bold tabular-nums text-rose-900'
                            : 'mt-0.5 text-2xl font-bold tabular-nums text-slate-900'
                        }
                      >
                        {date.getDate()}
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">{u.title}</h3>
                      <SubjectChip subjectCode={u.subjectCode} label={u.subjectName} size="sm" />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDateShort(u.date)} · {formatInDays(u.date)}
                    </p>
                  </div>

                  <StatusBadge
                    label={isThisWeek ? 'Bientôt' : 'À venir'}
                    tone={isThisWeek ? 'danger' : 'sky'}
                    size="sm"
                    withDot
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {beyond > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          + {beyond} évaluation{beyond > 1 ? 's' : ''} au-delà de 14 jours.
        </p>
      )}
    </PortalShell>
  );
}
