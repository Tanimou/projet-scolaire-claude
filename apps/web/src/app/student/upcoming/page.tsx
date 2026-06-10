import { CalendarClock, CalendarDays } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SubjectChip,
  formatDateLong,
} from '@pilotage/ui';
import type { StudentUpcomingResponse, StudentUpcomingRow } from '@pilotage/contracts';

import { StudentActivationGate } from '../_components/StudentActivationGate';
import { fetchStudentMe } from '../_lib/student-me';
import { kindLabel } from '../grades/kinds';

export const metadata: Metadata = { title: 'À venir' };
export const dynamic = 'force-dynamic';

type UpcomingFetch =
  | { data: StudentUpcomingRow[]; classSectionName: string | null }
  | { error: true };

async function fetchUpcoming(): Promise<UpcomingFetch> {
  try {
    const res = await api<StudentUpcomingResponse>('/api/v1/student/upcoming', {
      cache: 'no-store',
    });
    return { data: res.data ?? [], classSectionName: res.classSectionName ?? null };
  } catch (err) {
    if (err instanceof ApiError) return { error: true };
    throw err;
  }
}

/** Group a flat list of upcoming assessments by ISO day, soonest-first. */
function groupByDay(rows: StudentUpcomingRow[]): { day: string; iso: string; rows: StudentUpcomingRow[] }[] {
  const byDay = new Map<string, { iso: string; rows: StudentUpcomingRow[] }>();
  for (const r of rows) {
    const dayKey = r.scheduledAt.slice(0, 10); // YYYY-MM-DD (producer already asc-sorted)
    const entry = byDay.get(dayKey) ?? { iso: r.scheduledAt, rows: [] };
    entry.rows.push(r);
    byDay.set(dayKey, entry);
  }
  return Array.from(byDay.entries()).map(([day, v]) => ({ day, iso: v.iso, rows: v.rows }));
}

export default async function StudentUpcomingPage() {
  const me = await fetchStudentMe();

  // Unlinked → the calm full-page activation gate, inside the shell.
  if (!me.activated || !me.student) {
    return (
      <PortalShell portal="student" title="À venir" subtitle="Ton espace élève">
        <StudentActivationGate />
      </PortalShell>
    );
  }

  const headerName = me.student.firstName || 'Élève';
  const classLabel = me.student.classSectionName;
  const shellSubtitle = classLabel ? `${headerName} · ${classLabel}` : headerName;

  const upcoming = await fetchUpcoming();

  if ('error' in upcoming) {
    return (
      <PortalShell portal="student" title="À venir" subtitle={shellSubtitle}>
        <PageHeader title="À venir" subtitle="Tes prochaines évaluations" />
        <ErrorState
          title="Impossible de charger tes prochaines évaluations"
          description="Réessaie dans un instant."
          className="mt-6"
        />
      </PortalShell>
    );
  }

  const days = groupByDay(upcoming.data);

  return (
    <PortalShell portal="student" title="À venir" subtitle={shellSubtitle}>
      <PageHeader
        title="À venir"
        subtitle="Tes prochaines évaluations, de la plus proche à la plus lointaine"
      />

      {upcoming.data.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          tone="violet"
          title="Aucune évaluation prévue pour l'instant"
          description="Profites-en ! Dès qu'un professeur planifie une évaluation, tu la retrouveras ici."
          className="mt-6"
        />
      ) : (
        <div className="mt-6 space-y-8">
          {days.map((d) => (
            <section key={d.day} aria-label={formatDateLong(d.iso)}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
                <CalendarDays className="h-4 w-4 text-violet-500" aria-hidden />
                <span className="capitalize">{formatDateLong(d.iso)}</span>
              </h2>
              <div className="space-y-3">
                {d.rows.map((a) => (
                  <article
                    key={a.id}
                    className="group relative overflow-hidden rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200/60 transition hover:shadow-md hover:ring-slate-300"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-1.5"
                      style={{ background: a.subjectColor ?? 'oklch(0.56 0.19 292)' }}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <SubjectChip subjectCode={a.subjectName} label={a.subjectName} size="sm" />
                      <span className="text-[11px] font-semibold text-slate-500">
                        {kindLabel(a.kind)}
                      </span>
                      <span
                        className="ml-auto inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-slate-500 ring-1 ring-slate-200/80"
                        title="Coefficient"
                      >
                        coef {a.coefficient}
                      </span>
                    </div>
                    <h3 className="mt-2 text-sm font-bold leading-snug text-slate-900">
                      {a.title}
                    </h3>
                    {a.description && (
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">{a.description}</p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PortalShell>
  );
}
