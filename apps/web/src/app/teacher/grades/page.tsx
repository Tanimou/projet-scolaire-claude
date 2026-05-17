import { CheckCircle2, FileEdit, PenTool, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  AvatarNameCell,
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  StatusBadge,
  SubjectChip,
  formatDateShort,
  formatGrade,
} from '@pilotage/ui';

export const metadata: Metadata = { title: 'Notes' };
export const dynamic = 'force-dynamic';

interface GradeRow {
  id: string;
  value: string | null;
  isAbsent: boolean;
  comment: string | null;
  status: 'draft' | 'published' | 'revised';
  enteredAt: string;
  publishedAt: string | null;
  student: { id: string; firstName: string; lastName: string };
  assessment: {
    id: string;
    title: string;
    maxScore: string;
    coefficientOverride: string | null;
    isPublished: boolean;
    teachingAssignment: {
      classSection: { id: string; name: string };
      subject: { id: string; code: string; name: string; color: string | null };
    };
    term: { id: string; name: string } | null;
  };
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 30;

export default async function TeacherGradesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const resp = await safe(
    api<{ data: GradeRow[] }>('/api/v1/teachers/me/recent-grades?limit=100', {
      cache: 'no-store',
    }),
  );
  const all = resp?.data ?? [];

  const total = all.length;
  const published = all.filter((g) => g.status === 'published').length;
  const drafts = all.filter((g) => g.status === 'draft').length;
  const revised = all.filter((g) => g.status === 'revised').length;

  const valuesOn20 = all
    .filter((g) => g.value != null && !g.isAbsent)
    .map((g) => {
      const v = Number(g.value);
      const max = Number(g.assessment.maxScore);
      return max > 0 ? (v / max) * 20 : null;
    })
    .filter((v): v is number => v != null);
  const overallAvg =
    valuesOn20.length > 0 ? valuesOn20.reduce((a, b) => a + b, 0) / valuesOn20.length : null;

  const startIdx = (page - 1) * PAGE_SIZE;
  const pageRows = all.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Notes' },
        ]}
        title="Notes"
        subtitle="Vue globale des 100 dernières notes saisies sur vos évaluations"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={PenTool} tone="blue" label="NOTES RÉCENTES" value={total}>
          Total visible
        </KpiCard>
        <KpiCard icon={CheckCircle2} tone="green" label="PUBLIÉES" value={published}>
          Visibles parents
        </KpiCard>
        <KpiCard icon={FileEdit} tone="orange" label="BROUILLONS" value={drafts}>
          Non publiées
        </KpiCard>
        <KpiCard
          icon={TrendingUp}
          tone="violet"
          label="MOYENNE GLOBALE"
          value={overallAvg != null ? `${formatGrade(overallAvg, 1)} / 20` : '—'}
        >
          Sur les 100 dernières
        </KpiCard>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {pageRows.length === 0 ? (
          <EmptyState
            icon={PenTool}
            title="Aucune note saisie"
            description="Saisissez vos premières notes depuis la gradebook d'une de vos classes."
            tone="slate"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Élève</th>
                    <th className="px-4 py-3">Évaluation</th>
                    <th className="px-4 py-3">Matière</th>
                    <th className="px-4 py-3">Classe</th>
                    <th className="px-4 py-3 text-right">Note</th>
                    <th className="px-4 py-3">Saisie</th>
                    <th className="px-4 py-3">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((g) => {
                    const max = Number(g.assessment.maxScore);
                    const value = g.value != null ? Number(g.value) : null;
                    const on20 = value != null && max > 0 ? (value / max) * 20 : null;
                    return (
                      <tr key={g.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <AvatarNameCell
                            firstName={g.student.firstName}
                            lastName={g.student.lastName}
                            size="sm"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="font-bold text-slate-900">{g.assessment.title}</span>
                          {g.assessment.term && (
                            <span className="ml-1 text-[11px] text-slate-500">
                              ({g.assessment.term.name})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <SubjectChip
                            subjectCode={g.assessment.teachingAssignment.subject.code}
                            label={g.assessment.teachingAssignment.subject.name}
                            size="sm"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {g.assessment.teachingAssignment.classSection.name}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {g.isAbsent ? (
                            <span className="font-mono text-xs font-bold tabular-nums text-slate-400">
                              ABS
                            </span>
                          ) : value != null ? (
                            <div className="flex flex-col items-end leading-tight">
                              <span className="font-mono text-sm font-bold tabular-nums text-slate-900">
                                {value.toFixed(2)} / {max.toFixed(0)}
                              </span>
                              {on20 != null && max !== 20 && (
                                <span className="font-mono text-[10px] tabular-nums text-slate-500">
                                  ≈ {on20.toFixed(1)} / 20
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {formatDateShort(g.enteredAt)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={
                              g.status === 'published'
                                ? 'Publié'
                                : g.status === 'revised'
                                  ? 'Révisé'
                                  : 'Brouillon'
                            }
                            tone={
                              g.status === 'published'
                                ? 'success'
                                : g.status === 'revised'
                                  ? 'sky'
                                  : 'warning'
                            }
                            size="sm"
                            withDot
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'note', plural: 'notes' }}
            />
          </>
        )}
      </section>
    </PortalShell>
  );
}
