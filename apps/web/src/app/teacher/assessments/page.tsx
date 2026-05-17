import { CheckCircle2, ClipboardCheck, FileEdit, PenTool } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  StatusBadge,
  SubjectChip,
  formatDateShort,
} from '@pilotage/ui';

export const metadata: Metadata = { title: 'Mes évaluations' };
export const dynamic = 'force-dynamic';

interface AssessmentRow {
  id: string;
  title: string;
  kind: string;
  scheduledAt: string | null;
  conductedAt: string | null;
  maxScore: string;
  coefficientOverride: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  teachingAssignment: {
    classSection: { id: string; name: string; gradeLevel: { name: string } };
    subject: { id: string; code: string; name: string; color: string | null };
  };
  term: { id: string; name: string } | null;
  _count: { grades: number };
}

const KIND_LABEL: Record<string, string> = {
  written_test: 'Contrôle écrit',
  oral_test: 'Oral',
  homework: 'Devoir maison',
  project: 'Projet',
  practical: 'TP',
  participation: 'Participation',
};

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 25;

export default async function TeacherAssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const resp = await safe(
    api<{ data: AssessmentRow[] }>('/api/v1/assessments?mine=true', { cache: 'no-store' }),
  );
  const all = resp?.data ?? [];

  const total = all.length;
  const published = all.filter((a) => a.isPublished).length;
  const drafts = total - published;
  const now = new Date();
  const upcoming = all.filter((a) => a.scheduledAt && new Date(a.scheduledAt) >= now).length;

  const startIdx = (page - 1) * PAGE_SIZE;
  const pageRows = all.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Évaluations' },
        ]}
        title="Mes évaluations"
        subtitle="Toutes les évaluations que vous avez planifiées ou créées"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={ClipboardCheck} tone="blue" label="ÉVALUATIONS" value={total}>
          Total cette année
        </KpiCard>
        <KpiCard icon={CheckCircle2} tone="green" label="PUBLIÉES" value={published}>
          Notes visibles parents
        </KpiCard>
        <KpiCard icon={FileEdit} tone="orange" label="BROUILLONS" value={drafts}>
          En attente de publication
        </KpiCard>
        <KpiCard icon={PenTool} tone="violet" label="À VENIR" value={upcoming}>
          Prochaines évaluations
        </KpiCard>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {pageRows.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Aucune évaluation"
            description="Créez votre première évaluation depuis la gradebook d'une classe."
            tone="slate"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Titre</th>
                    <th className="px-4 py-3">Matière</th>
                    <th className="px-4 py-3">Classe</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Date prévue</th>
                    <th className="px-4 py-3 text-right">Coef · Bareme</th>
                    <th className="px-4 py-3 text-right">Notes</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((a) => {
                    const coef = a.coefficientOverride ?? '1';
                    const maxScore = Number(a.maxScore).toFixed(0);
                    return (
                      <tr key={a.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 text-sm font-bold text-slate-900">{a.title}</td>
                        <td className="px-4 py-3">
                          <SubjectChip
                            subjectCode={a.teachingAssignment.subject.code}
                            label={a.teachingAssignment.subject.name}
                            size="sm"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {a.teachingAssignment.classSection.name}
                          <span className="ml-1 text-[11px] text-slate-500">
                            ({a.teachingAssignment.classSection.gradeLevel.name})
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {KIND_LABEL[a.kind] ?? a.kind}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {formatDateShort(a.scheduledAt)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-700">
                          ×{coef} · /{maxScore}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-slate-900">
                          {a._count.grades}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={a.isPublished ? 'Publié' : 'Brouillon'}
                            tone={a.isPublished ? 'success' : 'warning'}
                            size="sm"
                            withDot
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/teacher/classes/${a.teachingAssignment.classSection.id}/grades`}
                            className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100"
                          >
                            Saisir
                          </Link>
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
              itemLabel={{ singular: 'évaluation', plural: 'évaluations' }}
            />
          </>
        )}
      </section>
    </PortalShell>
  );
}
