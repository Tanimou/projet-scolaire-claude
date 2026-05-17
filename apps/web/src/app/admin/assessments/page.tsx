import { ClipboardCheck, FileEdit, FilePlus, PenTool } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  AvatarNameCell,
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  RowActions,
  StatusBadge,
  SubjectChip,
  formatDateShort,
} from '@pilotage/ui';

export const metadata: Metadata = { title: 'Notes & Évaluations' };
export const dynamic = 'force-dynamic';

interface AssessmentRow {
  id: string;
  title: string;
  kind: string;
  scheduledAt: string | null;
  conductedAt: string | null;
  maxScore: string;
  isPublished: boolean;
  publishedAt: string | null;
  teachingAssignment: {
    classSection: { id: string; name: string; gradeLevel?: { name: string } };
    subject: { id: string; name: string; color: string | null; code: string };
  };
  teacherProfile: {
    userProfile: { firstName: string; lastName: string; photoUrl: string | null };
  };
  term: { id: string; name: string } | null;
  _count: { grades: number };
}

const KIND_LABEL: Record<string, string> = {
  written_test: 'Contrôle écrit',
  homework: 'Devoir maison',
  oral: 'Oral',
  practical: 'TP',
  participation: 'Participation',
  quiz: 'Quiz',
  exam: 'Examen',
  other: 'Autre',
};

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 15;

export default async function AssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const resp = await safe(
    api<{ data: AssessmentRow[] }>('/api/v1/assessments', { cache: 'no-store' }),
  );
  const all = resp?.data ?? [];

  const planned = all.filter((a) => !a.isPublished && a.scheduledAt && new Date(a.scheduledAt) > new Date()).length;
  const published = all.filter((a) => a.isPublished).length;
  const drafts = all.filter((a) => !a.isPublished).length;
  const recentlyPublished = all.filter(
    (a) => a.isPublished && a.publishedAt && new Date(a.publishedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).length;

  const total = all.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const pageRows = all.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Notes & Évaluations' },
        ]}
        title="Notes & Évaluations"
        subtitle="Vue admin du calendrier d'évaluations et de la publication des notes"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={ClipboardCheck} tone="blue" label="ÉVALUATIONS PLANIFIÉES" value={planned}>
          À venir dans le calendrier
        </KpiCard>
        <KpiCard icon={PenTool} tone="green" label="NOTES PUBLIÉES" value={published}>
          Toutes années confondues
        </KpiCard>
        <KpiCard icon={FileEdit} tone="orange" label="NOTES EN BROUILLON" value={drafts}>
          En attente de publication
        </KpiCard>
        <KpiCard icon={FilePlus} tone="violet" label="PUBLIÉES (7 J)" value={recentlyPublished}>
          Activité récente
        </KpiCard>
      </div>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {pageRows.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Aucune évaluation"
            description="Les évaluations apparaîtront ici dès que les enseignants en planifieront depuis leur portail."
            tone="slate"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Titre</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Matière</th>
                    <th className="px-4 py-3">Classe</th>
                    <th className="px-4 py-3">Enseignant</th>
                    <th className="px-4 py-3">Période</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Barème</th>
                    <th className="px-4 py-3 text-right">Notes</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 text-sm font-bold text-slate-900">{a.title}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {KIND_LABEL[a.kind] ?? a.kind}
                      </td>
                      <td className="px-4 py-3">
                        <SubjectChip
                          subjectCode={a.teachingAssignment.subject.code}
                          label={a.teachingAssignment.subject.name}
                          size="sm"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {a.teachingAssignment.classSection.name}
                      </td>
                      <td className="px-4 py-3">
                        <AvatarNameCell
                          src={a.teacherProfile.userProfile.photoUrl}
                          firstName={a.teacherProfile.userProfile.firstName}
                          lastName={a.teacherProfile.userProfile.lastName}
                          size="sm"
                        />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{a.term?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {formatDateShort(a.scheduledAt ?? a.conductedAt)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-700">
                        / {Number(a.maxScore)}
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
                        <RowActions viewHref={`/admin/assessments/${a.id}`} />
                      </td>
                    </tr>
                  ))}
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
