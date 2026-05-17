import { MessageCircle, Quote, Sparkles, ThumbsUp } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  SubjectChip,
  formatDateLong,
  formatGrade,
} from '@pilotage/ui';

import { ChildSelector } from '../_components/ChildSelector';

export const metadata: Metadata = { title: 'Commentaires' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
}

interface CommentRow {
  id: string;
  comment: string | null;
  publishedAt: string;
  gradeValue: number | null;
  gradeMax: number;
  gradeOn20: number | null;
  assessmentTitle: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  classSectionName: string;
  termName: string | null;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function ParentCommentsPage({
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
            { label: 'Commentaires' },
          ]}
          title="Commentaires des enseignants"
        />
        <EmptyState
          icon={MessageCircle}
          title="Aucun enfant rattaché"
          description="Les commentaires des enseignants apparaîtront ici."
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

  const resp = await safe(
    api<{ data: CommentRow[] }>(`/api/v1/analytics/parent-comments/${activeStudentId}`, {
      cache: 'no-store',
    }),
  );
  const comments = resp?.data ?? [];

  const subjects = new Set(comments.map((c) => c.subjectCode)).size;
  const positive = comments.filter(
    (c) => c.gradeOn20 != null && c.gradeOn20 >= 14,
  ).length;
  const recent = comments.filter((c) => {
    const d = new Date(c.publishedAt);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return d >= thirtyDaysAgo;
  }).length;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Commentaires' },
        ]}
        title="Commentaires des enseignants"
        subtitle="Tous les commentaires laissés par les enseignants sur les évaluations publiées"
      />

      <div className="mt-4">
        <ChildSelector items={children} activeStudentId={activeStudentId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={MessageCircle} tone="blue" label="COMMENTAIRES" value={comments.length}>
          Toutes périodes
        </KpiCard>
        <KpiCard icon={Sparkles} tone="green" label="ENCOURAGEMENTS" value={positive}>
          Notes ≥ 14/20
        </KpiCard>
        <KpiCard icon={Quote} tone="violet" label="MATIÈRES" value={subjects}>
          Matières représentées
        </KpiCard>
        <KpiCard icon={ThumbsUp} tone="amber" label="RÉCENTS" value={recent}>
          Sur les 30 derniers jours
        </KpiCard>
      </div>

      <section className="mt-6">
        {comments.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="Aucun commentaire pour le moment"
            description="Les commentaires des enseignants apparaîtront ici dès qu'ils publieront une note avec un retour personnalisé."
            tone="slate"
          />
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => {
              const tone =
                c.gradeOn20 != null && c.gradeOn20 >= 14
                  ? 'bg-emerald-50 ring-emerald-200'
                  : c.gradeOn20 != null && c.gradeOn20 < 10
                    ? 'bg-rose-50 ring-rose-200'
                    : 'bg-slate-50 ring-slate-200';
              return (
                <li
                  key={c.id}
                  className={`rounded-2xl p-5 ring-1 ${tone}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <SubjectChip
                        subjectCode={c.subjectCode}
                        label={c.subjectName}
                        size="sm"
                      />
                      <span className="text-xs text-slate-500">
                        {c.assessmentTitle}
                        {c.termName && ` · ${c.termName}`}
                      </span>
                    </div>
                    {c.gradeOn20 != null && (
                      <div className="shrink-0 rounded-md bg-white px-2 py-1 text-xs font-bold tabular-nums text-slate-800 ring-1 ring-slate-200">
                        {formatGrade(c.gradeOn20, 1)} / 20
                      </div>
                    )}
                  </div>
                  <blockquote className="mt-3 border-l-2 border-slate-300 pl-3 text-sm italic text-slate-800">
                    {c.comment}
                  </blockquote>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {formatDateLong(c.publishedAt)} · {c.classSectionName}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PortalShell>
  );
}
