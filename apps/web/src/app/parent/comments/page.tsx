import {
  AlertTriangle,
  MessageCircle,
  Quote,
  Sparkles,
  ThumbsUp,
} from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  StatusBadge,
  SubjectChip,
  formatDateLong,
  formatGrade,
} from '@pilotage/ui';

import { ChildSelector } from '../_components/ChildSelector';

import { CommentsFilters } from './CommentsFilters';
import type {
  CommentRow,
  CommentTier,
  SubjectFilter,
  SubjectOption,
  TermFilter,
  TermOption,
  TierFilter,
} from './types';

export const metadata: Metadata = { title: 'Commentaires' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const VALID_TIERS: ReadonlyArray<CommentTier> = ['positive', 'neutral', 'concern'];
const NO_TERM_KEY = '__none__';
const NO_TERM_LABEL = 'Hors trimestre';

function tierOf(c: CommentRow): CommentTier {
  if (c.gradeOn20 == null) return 'neutral';
  if (c.gradeOn20 >= 14) return 'positive';
  if (c.gradeOn20 < 10) return 'concern';
  return 'neutral';
}

const TIER_CARD_CLS: Record<CommentTier, string> = {
  positive: 'bg-emerald-50 ring-emerald-200',
  neutral: 'bg-slate-50 ring-slate-200',
  concern: 'bg-rose-50 ring-rose-200',
};

const TIER_BADGE: Record<CommentTier, { label: string; tone: 'success' | 'neutral' | 'danger' }> = {
  positive: { label: 'Encouragement', tone: 'success' },
  neutral: { label: 'Neutre', tone: 'neutral' },
  concern: { label: 'À surveiller', tone: 'danger' },
};

export default async function ParentCommentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    studentId?: string;
    tier?: string;
    subjectId?: string;
    term?: string;
    q?: string;
  }>;
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
  const all = resp?.data ?? [];

  // KPIs computed on the full dataset (stable across filters).
  const totalAll = all.length;
  const subjectsAll = new Set(all.map((c) => c.subjectCode)).size;
  const positiveAll = all.filter((c) => tierOf(c) === 'positive').length;
  const concernAll = all.filter((c) => tierOf(c) === 'concern').length;
  const recentAll = all.filter((c) => {
    const d = new Date(c.publishedAt);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return d >= thirtyDaysAgo;
  }).length;

  // Derive subject options from the data so the dropdown matches what's visible.
  const subjectMap = new Map<string, SubjectOption>();
  for (const c of all) {
    if (!subjectMap.has(c.subjectId)) {
      subjectMap.set(c.subjectId, {
        id: c.subjectId,
        code: c.subjectCode,
        name: c.subjectName,
      });
    }
  }
  const subjects = Array.from(subjectMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'fr'),
  );

  // Derive term options the same way — preserve discovery order (which is
  // newest-first per `parentComments` ordering).
  const termMap = new Map<string, TermOption>();
  for (const c of all) {
    const key = c.termName ?? NO_TERM_KEY;
    if (!termMap.has(key)) {
      termMap.set(key, {
        key,
        label: c.termName ?? NO_TERM_LABEL,
      });
    }
  }
  const terms = Array.from(termMap.values());

  // Validate filters against what we actually have.
  const tierFilter: TierFilter =
    sp.tier && VALID_TIERS.includes(sp.tier as CommentTier)
      ? (sp.tier as CommentTier)
      : '';
  const subjectFilter: SubjectFilter =
    sp.subjectId && subjectMap.has(sp.subjectId) ? sp.subjectId : '';
  const termFilter: TermFilter =
    sp.term && termMap.has(sp.term) ? sp.term : '';
  const search = (sp.q ?? '').trim().toLowerCase();

  // Apply filters: tier → subject → term → search.
  const filtered = all
    .filter((c) => (tierFilter ? tierOf(c) === tierFilter : true))
    .filter((c) => (subjectFilter ? c.subjectId === subjectFilter : true))
    .filter((c) =>
      termFilter ? (c.termName ?? NO_TERM_KEY) === termFilter : true,
    )
    .filter((c) => {
      if (!search) return true;
      const hay = [
        c.comment ?? '',
        c.assessmentTitle,
        c.subjectName,
        c.termName ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(search);
    });

  // Group by subject for the visible list — order subjects by descending
  // number of filtered comments, then alphabetically as a tiebreaker. This
  // foregrounds the matière where the teachers say the most.
  const grouped = new Map<string, { subject: SubjectOption; items: CommentRow[] }>();
  for (const c of filtered) {
    const existing = grouped.get(c.subjectId);
    if (existing) {
      existing.items.push(c);
    } else {
      grouped.set(c.subjectId, {
        subject: {
          id: c.subjectId,
          code: c.subjectCode,
          name: c.subjectName,
        },
        items: [c],
      });
    }
  }
  const groups = Array.from(grouped.values()).sort((a, b) => {
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    return a.subject.name.localeCompare(b.subject.name, 'fr');
  });

  // Active filter chips for the recap line.
  const activeFilterChips: string[] = [];
  if (tierFilter) {
    activeFilterChips.push(`Tonalité : ${TIER_BADGE[tierFilter].label}`);
  }
  if (subjectFilter) {
    activeFilterChips.push(`Matière : ${subjectMap.get(subjectFilter)!.name}`);
  }
  if (termFilter) {
    activeFilterChips.push(`Période : ${termMap.get(termFilter)!.label}`);
  }
  if (search) activeFilterChips.push(`Recherche : « ${search} »`);

  const headerSubtitle =
    totalAll > 0
      ? 'Tous les commentaires laissés par les enseignants sur les évaluations publiées'
      : 'Les commentaires apparaîtront ici dès qu’un enseignant publie une note avec un retour personnalisé';

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Commentaires' },
        ]}
        title="Commentaires des enseignants"
        subtitle={headerSubtitle}
      />

      <div className="mt-4">
        <ChildSelector items={children} activeStudentId={activeStudentId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={MessageCircle} tone="blue" label="COMMENTAIRES" value={totalAll}>
          Toutes périodes
        </KpiCard>
        <KpiCard icon={Sparkles} tone="green" label="ENCOURAGEMENTS" value={positiveAll}>
          Notes ≥ 14/20
        </KpiCard>
        <KpiCard icon={Quote} tone="violet" label="MATIÈRES" value={subjectsAll}>
          Matières représentées
        </KpiCard>
        <KpiCard icon={ThumbsUp} tone="amber" label="RÉCENTS" value={recentAll}>
          Sur les 30 derniers jours
        </KpiCard>
      </div>

      {/* Contextual action strip when at least one comment flags a concern. */}
      {concernAll > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm text-rose-900">
            <p className="font-bold">
              {concernAll} commentaire{concernAll > 1 ? 's' : ''} sur une note inférieure à 10/20
            </p>
            <p className="mt-0.5 text-xs text-rose-800/80">
              Filtrez par « À surveiller » pour les retrouver rapidement, ou discutez-en avec
              l&apos;équipe enseignante via la messagerie.
            </p>
          </div>
        </div>
      )}

      {totalAll > 0 && (
        <div className="mt-6">
          <CommentsFilters
            subjects={subjects}
            terms={terms}
            subjectId={subjectFilter}
            tier={tierFilter}
            term={termFilter}
            q={search}
          />
        </div>
      )}

      <section className="mt-4 space-y-6">
        {totalAll === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="Aucun commentaire pour le moment"
            description="Les commentaires des enseignants apparaîtront ici dès qu'ils publieront une note avec un retour personnalisé."
            tone="slate"
          />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="Aucun commentaire avec ces filtres"
            description="Élargissez la sélection, retirez un filtre, ou videz la recherche pour voir plus de résultats."
            tone="slate"
          />
        ) : (
          groups.map((g) => {
            const positiveInGroup = g.items.filter((c) => tierOf(c) === 'positive').length;
            const concernInGroup = g.items.filter((c) => tierOf(c) === 'concern').length;
            return (
              <div key={g.subject.id} className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <SubjectChip
                    subjectCode={g.subject.code}
                    label={g.subject.name}
                    size="md"
                  />
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-600">
                    {g.items.length} commentaire{g.items.length > 1 ? 's' : ''}
                  </span>
                  {positiveInGroup > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                      <Sparkles className="h-3 w-3" />
                      {positiveInGroup} encouragement{positiveInGroup > 1 ? 's' : ''}
                    </span>
                  )}
                  {concernInGroup > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                      <AlertTriangle className="h-3 w-3" />
                      {concernInGroup} à surveiller
                    </span>
                  )}
                </div>
                <ul className="space-y-3">
                  {g.items.map((c) => {
                    const t = tierOf(c);
                    const badge = TIER_BADGE[t];
                    return (
                      <li
                        key={c.id}
                        className={`rounded-2xl p-5 ring-1 transition-shadow hover:shadow-sm ${TIER_CARD_CLS[t]}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">
                              {c.assessmentTitle}
                            </span>
                            {c.termName && (
                              <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                                {c.termName}
                              </span>
                            )}
                            <StatusBadge
                              label={badge.label}
                              tone={badge.tone}
                              size="sm"
                              withDot
                            />
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
              </div>
            );
          })
        )}
      </section>

      {activeFilterChips.length > 0 && (
        <p className="mt-4 text-[11px] text-slate-500">
          Filtres actifs :{' '}
          {activeFilterChips.map((chip, idx) => (
            <span key={chip}>
              <span className="font-bold text-slate-700">{chip}</span>
              {idx < activeFilterChips.length - 1 && (
                <span className="text-slate-400"> · </span>
              )}
            </span>
          ))}
        </p>
      )}
    </PortalShell>
  );
}
