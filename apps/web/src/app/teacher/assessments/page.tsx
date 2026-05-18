import {
  AlarmClock,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FileEdit,
  FilePlus2,
  ListChecks,
  PenTool,
  Send,
  TrendingUp,
} from 'lucide-react';
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

import { AssessmentsFilters, type AssessmentsSort, type AssessmentsStatus } from './AssessmentsFilters';

export const metadata: Metadata = { title: 'Mes évaluations' };
export const dynamic = 'force-dynamic';

interface AssessmentRow {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  scheduledAt: string | null;
  conductedAt: string | null;
  maxScore: string;
  coefficientOverride: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  teachingAssignment: {
    classSection: {
      id: string;
      name: string;
      gradeLevel: { name: string };
      _count: { enrollments: number };
    };
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

const KIND_ICON: Record<string, typeof PenTool> = {
  written_test: PenTool,
  oral_test: PenTool,
  homework: ClipboardCheck,
  project: FilePlus2,
  practical: ListChecks,
  participation: TrendingUp,
};

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 20;

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function endOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}

type StatusBucket = 'upcoming' | 'today' | 'past' | 'published' | 'draft' | 'needs-publish';

function buckets(a: AssessmentRow, todayStart: number, todayEnd: number): Set<StatusBucket> {
  const out = new Set<StatusBucket>();
  if (a.isPublished) out.add('published');
  else out.add('draft');

  if (a.scheduledAt) {
    const t = new Date(a.scheduledAt).getTime();
    if (t < todayStart) out.add('past');
    else if (t > todayEnd) out.add('upcoming');
    else out.add('today');
  } else if (a.publishedAt) {
    out.add('past');
  }

  if (!a.isPublished && a._count.grades > 0) out.add('needs-publish');
  return out;
}

function rowVerdict(a: AssessmentRow, todayStart: number, todayEnd: number) {
  if (!a.scheduledAt && !a.isPublished) return { label: 'Brouillon', tone: 'warning' as const };
  if (a.isPublished) return { label: 'Publié', tone: 'success' as const };
  if (a.scheduledAt) {
    const t = new Date(a.scheduledAt).getTime();
    if (t > todayEnd) {
      const days = Math.ceil((t - todayStart) / (1000 * 60 * 60 * 24));
      return { label: `À venir · J-${days}`, tone: 'sky' as const };
    }
    if (t < todayStart) {
      if (a._count.grades > 0) return { label: 'À publier', tone: 'warning' as const };
      return { label: 'Passée', tone: 'neutral' as const };
    }
    return { label: "Aujourd'hui", tone: 'info' as const };
  }
  return { label: 'Brouillon', tone: 'warning' as const };
}

export default async function TeacherAssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    classSectionId?: string;
    subjectCode?: string;
    kind?: string;
    status?: string;
    termId?: string;
    sort?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const q = (sp.q ?? '').trim();
  const classSectionId = sp.classSectionId ?? '';
  const subjectCode = sp.subjectCode ?? '';
  const kind = sp.kind ?? '';
  const status = (sp.status ?? '') as AssessmentsStatus;
  const termId = sp.termId ?? '';
  const sort = ((sp.sort ?? 'date-desc') as AssessmentsSort) || 'date-desc';

  const resp = await safe(
    api<{ data: AssessmentRow[] }>('/api/v1/assessments?mine=true', { cache: 'no-store' }),
  );
  const all = resp?.data ?? [];

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const total = all.length;
  const published = all.filter((a) => a.isPublished).length;
  const drafts = total - published;
  const upcoming = all.filter(
    (a) => a.scheduledAt && new Date(a.scheduledAt).getTime() > todayEnd,
  ).length;
  const needsPublish = all.filter((a) => !a.isPublished && a._count.grades > 0).length;
  const publishRate = total > 0 ? Math.round((published / total) * 100) : 0;

  const classMap = new Map<string, { id: string; label: string }>();
  const subjectMap = new Map<string, { id: string; label: string }>();
  const termMap = new Map<string, { id: string; label: string }>();
  for (const a of all) {
    const cs = a.teachingAssignment.classSection;
    if (!classMap.has(cs.id)) {
      classMap.set(cs.id, { id: cs.id, label: `${cs.name} · ${cs.gradeLevel.name}` });
    }
    const subj = a.teachingAssignment.subject;
    if (!subjectMap.has(subj.code)) {
      subjectMap.set(subj.code, { id: subj.code, label: subj.name });
    }
    if (a.term && !termMap.has(a.term.id)) {
      termMap.set(a.term.id, { id: a.term.id, label: a.term.name });
    }
  }
  const classOptions = Array.from(classMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  const subjectOptions = Array.from(subjectMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  const termOptions = Array.from(termMap.values()).sort((a, b) => a.label.localeCompare(b.label));

  const filtered = all.filter((a) => {
    if (q) {
      const needle = q.toLowerCase();
      const hay = `${a.title} ${a.description ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (classSectionId && a.teachingAssignment.classSection.id !== classSectionId) return false;
    if (subjectCode && a.teachingAssignment.subject.code !== subjectCode) return false;
    if (kind && a.kind !== kind) return false;
    if (termId && a.term?.id !== termId) return false;
    if (status) {
      const b = buckets(a, todayStart, todayEnd);
      if (!b.has(status as StatusBucket)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'class') {
      return (
        a.teachingAssignment.classSection.name.localeCompare(
          b.teachingAssignment.classSection.name,
        ) || a.title.localeCompare(b.title)
      );
    }
    const ta = a.scheduledAt
      ? new Date(a.scheduledAt).getTime()
      : a.publishedAt
        ? new Date(a.publishedAt).getTime()
        : 0;
    const tb = b.scheduledAt
      ? new Date(b.scheduledAt).getTime()
      : b.publishedAt
        ? new Date(b.publishedAt).getTime()
        : 0;
    return sort === 'date-asc' ? ta - tb : tb - ta;
  });

  const filteredTotal = sorted.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(startIdx, startIdx + PAGE_SIZE);

  const hasActiveFilters = !!(q || classSectionId || subjectCode || kind || status || termId);

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Évaluations' },
        ]}
        title="Mes évaluations"
        subtitle="Planifiez, saisissez et publiez les évaluations de toutes vos classes"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={ClipboardCheck} tone="blue" label="ÉVALUATIONS" value={total}>
          {drafts > 0
            ? `${drafts} brouillon${drafts > 1 ? 's' : ''} · ${published} publiée${published > 1 ? 's' : ''}`
            : 'Total cette année'}
        </KpiCard>
        <KpiCard icon={CheckCircle2} tone="green" label="TAUX DE PUBLICATION" value={`${publishRate}%`}>
          {published} sur {total || '—'} visibles aux familles
        </KpiCard>
        <KpiCard
          icon={Send}
          tone={needsPublish > 0 ? 'orange' : 'slate'}
          label="À PUBLIER"
          value={needsPublish}
        >
          {needsPublish > 0 ? 'Notes saisies — à diffuser' : 'Aucune action en attente'}
        </KpiCard>
        <KpiCard
          icon={AlarmClock}
          tone={upcoming > 0 ? 'violet' : 'slate'}
          label="À VENIR"
          value={upcoming}
        >
          Évaluations planifiées
        </KpiCard>
      </div>

      {needsPublish > 0 && status !== 'needs-publish' && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-orange-50 px-4 py-3 ring-1 ring-orange-200">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
            <Send className="h-4 w-4" />
          </span>
          <p className="flex-1 text-sm text-orange-900">
            <strong className="font-bold">
              {needsPublish} évaluation{needsPublish > 1 ? 's' : ''}
            </strong>{' '}
            ont des notes saisies mais ne sont pas encore publiées aux familles.
          </p>
          <Link
            href="/teacher/assessments?status=needs-publish"
            className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-orange-700"
          >
            Voir la liste →
          </Link>
        </div>
      )}

      <div className="mt-6">
        <AssessmentsFilters
          classes={classOptions}
          subjects={subjectOptions}
          terms={termOptions}
          q={q}
          classSectionId={classSectionId}
          subjectCode={subjectCode}
          kind={kind}
          status={status}
          termId={termId}
          sort={sort}
        />
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        {pageRows.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={
              hasActiveFilters
                ? 'Aucune évaluation ne correspond aux filtres'
                : 'Aucune évaluation'
            }
            description={
              hasActiveFilters
                ? "Ajustez les filtres pour voir d'autres évaluations."
                : "Créez votre première évaluation depuis la gradebook d'une classe."
            }
            tone="slate"
            action={
              hasActiveFilters
                ? { label: 'Réinitialiser', href: '/teacher/assessments' }
                : { label: 'Voir mes classes', href: '/teacher/classes' }
            }
          />
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px] text-slate-500">
              <span>
                <strong className="font-bold text-slate-700">{filteredTotal}</strong>{' '}
                évaluation{filteredTotal > 1 ? 's' : ''}
                {hasActiveFilters ? ' filtrées' : ''} · page {page} sur{' '}
                {Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE))}
              </span>
              {hasActiveFilters && (
                <Link
                  href="/teacher/assessments"
                  className="font-bold text-slate-600 hover:text-slate-900 hover:underline"
                >
                  Réinitialiser les filtres
                </Link>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white">
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Évaluation</th>
                    <th className="px-4 py-3">Matière · Classe</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Notes saisies</th>
                    <th className="px-4 py-3 text-right">Coef · Barème</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((a) => {
                    const KindIcon = KIND_ICON[a.kind] ?? PenTool;
                    const coef = a.coefficientOverride ?? '1';
                    const maxScore = Number(a.maxScore).toFixed(0);
                    const className = a.teachingAssignment.classSection.name;
                    const subj = a.teachingAssignment.subject;
                    const verdict = rowVerdict(a, todayStart, todayEnd);
                    const enrollments = a.teachingAssignment.classSection._count.enrollments;
                    const filledPct =
                      enrollments > 0
                        ? Math.min(100, Math.round((a._count.grades / enrollments) * 100))
                        : 0;
                    const fullyGraded = enrollments > 0 && a._count.grades >= enrollments;
                    return (
                      <tr key={a.id} className="transition hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-3">
                            <span
                              className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                a.isPublished
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                              title={KIND_LABEL[a.kind] ?? a.kind}
                            >
                              <KindIcon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-slate-900">{a.title}</div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                                <span>{KIND_LABEL[a.kind] ?? a.kind}</span>
                                {a.term && (
                                  <>
                                    <span>·</span>
                                    <span>{a.term.name}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <SubjectChip
                              subjectCode={subj.code}
                              label={subj.name}
                              size="sm"
                            />
                            <span className="text-[11px] text-slate-500">
                              {className}{' '}
                              <span className="text-slate-400">
                                · {a.teachingAssignment.classSection.gradeLevel.name}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {a.scheduledAt ? (
                            <div className="text-xs">
                              <div className="font-bold text-slate-700">
                                {formatDateShort(a.scheduledAt)}
                              </div>
                              {a.publishedAt && (
                                <div className="text-[11px] text-emerald-600">
                                  Publié {formatDateShort(a.publishedAt)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Non planifiée</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          {enrollments > 0 ? (
                            <div className="inline-flex flex-col items-end gap-1">
                              <span
                                className={`font-mono text-sm font-bold tabular-nums ${
                                  fullyGraded ? 'text-emerald-700' : 'text-slate-700'
                                }`}
                              >
                                {a._count.grades}
                                <span className="text-slate-400"> / {enrollments}</span>
                              </span>
                              <div
                                className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"
                                title={`${filledPct}% des élèves notés`}
                              >
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    fullyGraded
                                      ? 'bg-emerald-500'
                                      : filledPct > 0
                                        ? 'bg-blue-500'
                                        : 'bg-slate-300'
                                  }`}
                                  style={{ width: `${Math.max(2, filledPct)}%` }}
                                />
                              </div>
                            </div>
                          ) : (
                            <span className="font-mono text-sm tabular-nums text-slate-400">
                              {a._count.grades}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right align-top font-mono text-xs tabular-nums text-slate-700">
                          <div>
                            <span className="text-slate-500">×</span>
                            {coef}
                          </div>
                          <div className="text-[11px] text-slate-400">/{maxScore}</div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <StatusBadge
                            label={verdict.label}
                            tone={verdict.tone}
                            size="sm"
                            withDot
                          />
                        </td>
                        <td className="px-4 py-3 text-right align-top">
                          <div className="inline-flex items-center gap-1.5">
                            <Link
                              href={`/teacher/classes/${a.teachingAssignment.classSection.id}/grades`}
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold transition ${
                                a.isPublished
                                  ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                  : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                              }`}
                              title={a.isPublished ? 'Voir les notes' : 'Saisir les notes'}
                            >
                              {a.isPublished ? (
                                <>
                                  <Eye className="h-3 w-3" />
                                  Voir
                                </>
                              ) : (
                                <>
                                  <FileEdit className="h-3 w-3" />
                                  Saisir
                                </>
                              )}
                            </Link>
                            {!a.isPublished && a._count.grades > 0 && (
                              <Link
                                href={`/teacher/classes/${a.teachingAssignment.classSection.id}/grades`}
                                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700"
                                title="Aller publier l'évaluation"
                              >
                                <Send className="h-3 w-3" />
                                Publier
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={filteredTotal}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'évaluation', plural: 'évaluations' }}
            />
          </>
        )}
      </section>

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-slate-500">
        <CalendarCheck className="h-3 w-3 text-slate-400" />
        Le statut <strong className="font-bold text-slate-700">À publier</strong> signale les
        brouillons avec des notes déjà saisies — cliquez{' '}
        <strong className="font-bold text-slate-700">Publier</strong> dans la gradebook pour
        les rendre visibles aux familles.
      </p>
    </PortalShell>
  );
}
