import { CalendarClock, Compass, Target } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { FreshnessChip } from '@/components/freshness/FreshnessChip';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  PageHeader,
  SectionHeader,
  SubjectChip,
  formatDateLong,
} from '@pilotage/ui';
import type { StudentDashboardResponse } from '@pilotage/contracts';

import { StudentActivationGate } from '../_components/StudentActivationGate';
import { fetchStudentMe } from '../_lib/student-me';
import { kindLabel } from '../grades/kinds';
import { StudentSupportStrip } from './_components/StudentSupportStrip';
import { SubjectTrendCard } from './_components/SubjectTrendCard';

export const metadata: Metadata = { title: 'Mon objectif' };
export const dynamic = 'force-dynamic';

const MAX_UPCOMING_PREVIEW = 3;

const EMPTY_DASHBOARD: StudentDashboardResponse = {
  firstName: 'Élève',
  classSectionName: null,
  subjects: [],
  upcoming: [],
  remediation: [],
};

/**
 * Best-effort fetch — the dashboard aggregate is already composed best-effort
 * server-side (a thrown block degrades to empty, the endpoint returns 200). On a
 * transport error we still render the calm empty dashboard rather than an error
 * banner, mirroring the S2 degrade-kindly posture.
 */
async function fetchDashboard(): Promise<StudentDashboardResponse> {
  try {
    const res = await api<StudentDashboardResponse>('/api/v1/student/dashboard', {
      cache: 'no-store',
    });
    return {
      firstName: res.firstName ?? 'Élève',
      classSectionName: res.classSectionName ?? null,
      subjects: res.subjects ?? [],
      upcoming: res.upcoming ?? [],
      remediation: res.remediation ?? [],
      freshness: res.freshness,
    };
  } catch (err) {
    if (err instanceof ApiError) return EMPTY_DASHBOARD;
    throw err;
  }
}

export default async function StudentDashboardPage() {
  const me = await fetchStudentMe();

  // Unlinked → the calm full-page activation gate, inside the shell.
  if (!me.activated || !me.student) {
    return (
      <PortalShell portal="student" title="Mon objectif" subtitle="Ton espace élève">
        <StudentActivationGate />
      </PortalShell>
    );
  }

  const headerName = me.student.firstName || 'Élève';
  const classLabel = me.student.classSectionName;
  const shellSubtitle = classLabel ? `${headerName} · ${classLabel}` : headerName;

  const dash = await fetchDashboard();
  const firstName = dash.firstName || headerName;

  const upcomingPreview = dash.upcoming.slice(0, MAX_UPCOMING_PREVIEW);
  const allEmpty =
    dash.subjects.length === 0 && dash.upcoming.length === 0 && dash.remediation.length === 0;

  return (
    <PortalShell portal="student" title="Mon objectif" subtitle={shellSubtitle}>
      <PageHeader
        title="Mon objectif"
        subtitle="Où tu en es, ce qui arrive, ce qui progresse"
      />

      <p className="mt-2 text-sm text-slate-600">
        Salut {firstName} <span aria-hidden>👋</span>
      </p>

      {allEmpty ? (
        <EmptyState
          icon={Target}
          tone="violet"
          title="Ton tableau de bord se construit"
          description="Tes premières tendances apparaîtront dès que tes notes seront publiées."
          className="mt-6"
        />
      ) : (
        <div className="mt-6 space-y-8">
          {/* Block A — Mon évolution par matière (E6 trend, own figures only) */}
          {dash.subjects.length > 0 ? (
            <section aria-label="Mon évolution par matière">
              <SectionHeader
                title="Mon évolution par matière"
                icon={<Compass aria-hidden className="h-4 w-4 text-violet-600" />}
                rightSlot={dash.freshness ? <FreshnessChip freshness={dash.freshness} /> : undefined}
                compact
              />
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {dash.subjects.map((s) => (
                  <SubjectTrendCard key={s.subjectId} subject={s} />
                ))}
              </div>
            </section>
          ) : (
            <section aria-label="Mon évolution par matière">
              <SectionHeader
                title="Mon évolution par matière"
                icon={<Compass aria-hidden className="h-4 w-4 text-violet-600" />}
                compact
              />
              <p className="mt-3 rounded-2xl bg-white px-4 py-6 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/60">
                Tes premières tendances apparaîtront dès que tes notes seront publiées.
              </p>
            </section>
          )}

          {/* Block B — À préparer (next assessments preview) */}
          <section aria-label="À préparer">
            <SectionHeader
              title="À préparer"
              icon={<CalendarClock aria-hidden className="h-4 w-4 text-violet-600" />}
              actionLabel={dash.upcoming.length > 0 ? 'Tout voir' : undefined}
              actionHref={dash.upcoming.length > 0 ? '/student/upcoming' : undefined}
              compact
            />
            {upcomingPreview.length > 0 ? (
              <ul className="mt-3 space-y-2.5" aria-label="Mes prochaines évaluations">
                {upcomingPreview.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/60"
                  >
                    <SubjectChip subjectCode={a.subjectName} label={a.subjectName} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                      {a.title}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500">
                      {kindLabel(a.kind)}
                    </span>
                    <span className="ml-auto whitespace-nowrap text-xs font-medium capitalize text-violet-700">
                      {formatDateLong(a.scheduledAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-2xl bg-white px-4 py-6 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/60">
                Rien de prévu pour l&apos;instant — profites-en pour consolider.
              </p>
            )}
          </section>

          {/* Block C — Ton soutien (E7 remediation, second-person, read-only) */}
          <StudentSupportStrip plans={dash.remediation} />
        </div>
      )}
    </PortalShell>
  );
}
