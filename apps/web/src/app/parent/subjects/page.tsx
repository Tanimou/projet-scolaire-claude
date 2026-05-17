import { BookOpen, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  SubjectPerfCard,
  formatGrade,
  gradeVerdict,
  trendOfDelta,
} from '@pilotage/ui';

import { ChildSelector } from '../_components/ChildSelector';

export const metadata: Metadata = { title: 'Suivi des matières' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
}

interface SubjectPerfItem {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  subjectColor: string | null;
  studentAverage: number | null;
  classAverage: number | null;
  coefficient: number;
  rank: number | null;
  classSize: number;
  deltaVsPrevious: number | null;
  badge: string | null;
}

interface DashboardResp {
  student: { id: string; firstName: string; lastName: string };
  subjectPerf: SubjectPerfItem[];
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function ParentSubjectsPage({
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
            { label: 'Suivi des matières' },
          ]}
          title="Suivi des matières"
        />
        <EmptyState
          icon={BookOpen}
          title="Aucun enfant rattaché à votre compte"
          description="Le suivi par matière apparaîtra ici quand un enfant sera lié à votre compte."
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
  const subjects = dashboard?.subjectPerf ?? [];

  const studentAvgs = subjects
    .map((s) => s.studentAverage)
    .filter((v): v is number => v != null);
  const overall =
    studentAvgs.length > 0 ? studentAvgs.reduce((a, b) => a + b, 0) / studentAvgs.length : null;
  const aboveClass = subjects.filter(
    (s) => s.studentAverage != null && s.classAverage != null && s.studentAverage >= s.classAverage,
  ).length;
  const improving = subjects.filter((s) => (s.deltaVsPrevious ?? 0) > 0).length;
  const declining = subjects.filter((s) => (s.deltaVsPrevious ?? 0) < 0).length;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Suivi des matières' },
        ]}
        title="Suivi des matières"
        subtitle="Performance par matière, classement et tendance trimestrielle"
      />

      <div className="mt-4">
        <ChildSelector options={children} activeStudentId={activeStudentId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={BookOpen}
          tone="blue"
          label="MATIÈRES SUIVIES"
          value={subjects.length}
        >
          Cette année
        </KpiCard>
        <KpiCard
          icon={Sparkles}
          tone="violet"
          label="MOYENNE GLOBALE"
          value={overall != null ? `${formatGrade(overall, 1)} / 20` : '—'}
        >
          Toutes matières
        </KpiCard>
        <KpiCard
          icon={TrendingUp}
          tone="green"
          label="EN HAUSSE"
          value={improving}
        >
          {subjects.length > 0 ? `sur ${subjects.length} matières` : ''}
        </KpiCard>
        <KpiCard
          icon={TrendingDown}
          tone="rose"
          label="EN BAISSE"
          value={declining}
        >
          Vs. trimestre précédent
        </KpiCard>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        <strong>{aboveClass}</strong> matière{aboveClass > 1 ? 's' : ''} où la moyenne de l&apos;élève est{' '}
        <strong>≥ moyenne de classe</strong>.
      </p>

      <section className="mt-6">
        {subjects.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Pas encore de notes par matière"
            description="Le suivi détaillé apparaîtra dès la première note publiée par les enseignants."
            tone="slate"
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {subjects.map((s) => {
              void s.subjectColor; // colour is resolved internally by SubjectPerfCard via subjectColor()
              const metrics = [
                {
                  label: 'Moyenne classe',
                  value: s.classAverage != null ? `${formatGrade(s.classAverage, 1)} /20` : '—',
                },
                {
                  label: 'Classement',
                  value: s.rank != null && s.classSize > 0 ? `${s.rank} / ${s.classSize}` : '—',
                },
                { label: 'Coefficient', value: `×${formatGrade(s.coefficient, 0)}` },
                {
                  label: 'Progression',
                  value:
                    s.deltaVsPrevious != null
                      ? `${s.deltaVsPrevious > 0 ? '+' : ''}${formatGrade(s.deltaVsPrevious, 1)} pts`
                      : '—',
                  trend: trendOfDelta(s.deltaVsPrevious),
                },
              ];
              return (
                <SubjectPerfCard
                  key={s.subjectId}
                  subjectCode={s.subjectCode}
                  subjectName={s.subjectName}
                  grade={s.studentAverage}
                  badge={s.badge ?? gradeVerdict(s.studentAverage)}
                  metrics={metrics}
                  href={`/parent/grades?studentId=${activeStudentId}&subjectId=${s.subjectId}`}
                />
              );
            })}
          </div>
        )}
      </section>

    </PortalShell>
  );
}
