import {
  AlertTriangle,
  ArrowLeft,
  Award,
  BookOpen,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardEdit,
  ClipboardList,
  Crown,
  FileSpreadsheet,
  GraduationCap,
  Megaphone,
  NotebookPen,
  Send,
  Sparkles,
  TrendingDown,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import { KpiCard, PageHeader, ProgressBar } from '@pilotage/ui';

export const metadata: Metadata = { title: 'Ma classe' };
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

interface Assignment {
  id: string;
  isMainTeacher: boolean;
  classSection: {
    id: string;
    name: string;
    gradeLevel: { id: string; name: string; cycle: { id: string; name: string; color: string | null } | null };
    _count: { enrollments: number };
  };
  subject: {
    id: string;
    code: string | null;
    name: string;
    color: string | null;
    icon: string | null;
    defaultCoefficient: number;
  };
  academicYear: { id: string; name: string; status: string };
}

interface MyAssignmentsResp {
  data: Assignment[];
}

interface GradebookData {
  assignment: {
    id: string;
    baseCoefficient: number;
  };
  assessments: Array<{
    id: string;
    title: string;
    kind: string;
    scheduledAt: string | null;
    maxScore: number;
    coefficientOverride: number | null;
    effectiveCoefficient: number;
    isPublished: boolean;
    termId: string | null;
  }>;
  rows: Array<{
    studentId: string;
    student: { id: string; firstName: string; lastName: string; externalRef: string | null };
    grades: Array<null | {
      id: string;
      value: number | null;
      isAbsent: boolean;
      status: string;
      comment: string | null;
    }>;
    average: number | null;
    count: number;
  }>;
  classAverage: number | null;
}

interface Lesson {
  id: string;
  date: string;
  title: string;
  content: string;
  homework: string | null;
  homeworkDueAt: string | null;
  status: 'draft' | 'published';
}

type PerfBand = 'excellent' | 'bon' | 'correct' | 'risque' | 'unknown';

const BAND_META: Record<PerfBand, { label: string; range: string; stripe: string; chip: string; color: string }> = {
  excellent: { label: 'Excellent', range: '≥ 16 / 20', stripe: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700', color: '#10B981' },
  bon: { label: 'Bon', range: '14 – 16', stripe: 'bg-blue-500', chip: 'bg-blue-100 text-blue-700', color: '#3B82F6' },
  correct: { label: 'Correct', range: '10 – 14', stripe: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800', color: '#F59E0B' },
  risque: { label: 'À renforcer', range: '< 10', stripe: 'bg-rose-500', chip: 'bg-rose-100 text-rose-700', color: '#F43F5E' },
  unknown: { label: 'Pas encore noté', range: 'Aucune note', stripe: 'bg-slate-300', chip: 'bg-slate-100 text-slate-600', color: '#94A3B8' },
};

const KIND_LABEL: Record<string, string> = {
  written_test: 'Écrit',
  oral: 'Oral',
  oral_test: 'Oral',
  homework: 'DM',
  project: 'Projet',
  participation: 'Participation',
  practical: 'TP',
  other: 'Autre',
};

const KIND_TONE: Record<string, string> = {
  written_test: 'bg-blue-100 text-blue-700',
  oral: 'bg-violet-100 text-violet-700',
  oral_test: 'bg-violet-100 text-violet-700',
  homework: 'bg-amber-100 text-amber-700',
  project: 'bg-teal-100 text-teal-700',
  participation: 'bg-sky-100 text-sky-700',
  practical: 'bg-emerald-100 text-emerald-700',
  other: 'bg-slate-100 text-slate-700',
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function bandOf(avg: number | null): PerfBand {
  if (avg === null) return 'unknown';
  if (avg >= 16) return 'excellent';
  if (avg >= 14) return 'bon';
  if (avg >= 10) return 'correct';
  return 'risque';
}

function avgTone(avg: number | null): 'green' | 'amber' | 'rose' | 'slate' {
  if (avg === null) return 'slate';
  if (avg >= 14) return 'green';
  if (avg >= 10) return 'amber';
  return 'rose';
}

function formatDayLong(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return iso;
  }
}

function formatDayShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  } catch {
    return iso;
  }
}

function daysFromNow(iso: string, now: Date): number {
  return Math.floor((startOfDay(new Date(iso)).getTime() - startOfDay(now).getTime()) / DAY_MS);
}

function formatRelativeDayLabel(iso: string, now: Date): string {
  const diff = daysFromNow(iso, now);
  if (diff === 0) return "Aujourd'hui";
  if (diff === -1) return 'Hier';
  if (diff === 1) return 'Demain';
  if (diff < -1 && diff >= -7) return `il y a ${-diff} j`;
  if (diff > 1 && diff <= 7) return `dans ${diff} j`;
  return formatDayShort(iso);
}

export default async function TeacherClassDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mine = await api<MyAssignmentsResp>('/api/v1/teachers/me/assignments', { cache: 'no-store' });
  const assignment = mine.data.find((a) => a.id === id);
  if (!assignment) redirect('/teacher/dashboard?error=unknown_assignment');

  // Fetch gradebook + lessons in parallel. Both can return non-fatal errors
  // (e.g. assignment exists but has no assessments / no lessons yet).
  const [gradebookRes, lessonsRes] = await Promise.allSettled([
    api<GradebookData>(`/api/v1/grades/gradebook/${id}`, { cache: 'no-store' }),
    api<{ data: Lesson[] }>(`/api/v1/lessons?teachingAssignmentId=${id}&limit=200`, {
      cache: 'no-store',
    }),
  ]);

  const gradebook: GradebookData | null =
    gradebookRes.status === 'fulfilled'
      ? gradebookRes.value
      : gradebookRes.reason instanceof ApiError && gradebookRes.reason.status === 404
      ? null
      : null;

  const lessons: Lesson[] = lessonsRes.status === 'fulfilled' ? lessonsRes.value.data : [];

  // ---- Derived metrics (all server-computed) -----------------------------
  const now = new Date();
  const today = startOfDay(now);

  // Gradebook-derived
  const studentsCount = assignment.classSection._count.enrollments;
  const classAverage = gradebook?.classAverage ?? null;
  const assessmentsTotal = gradebook?.assessments.length ?? 0;
  const assessmentsPublished = gradebook?.assessments.filter((a) => a.isPublished).length ?? 0;
  const assessmentsDraft = assessmentsTotal - assessmentsPublished;

  // Saisie incomplete = at least one assessment where some enrolled student has no grade row
  let incompleteAssessments = 0;
  if (gradebook && gradebook.assessments.length > 0 && gradebook.rows.length > 0) {
    incompleteAssessments = gradebook.assessments.filter((_, idx) =>
      gradebook.rows.some((r) => r.grades[idx] === null),
    ).length;
  }

  // Distribution of student averages
  const distribution: Record<PerfBand, number> = {
    excellent: 0,
    bon: 0,
    correct: 0,
    risque: 0,
    unknown: 0,
  };
  if (gradebook) {
    for (const row of gradebook.rows) distribution[bandOf(row.average)]++;
  }
  const studentsScored = gradebook ? gradebook.rows.filter((r) => r.average !== null).length : 0;
  const studentsAtRisk = distribution.risque;
  const studentsExcellent = distribution.excellent;

  // Top performers & students at risk
  const rankedStudents = gradebook
    ? gradebook.rows
        .filter((r) => r.average !== null)
        .slice()
        .sort((a, b) => (b.average ?? 0) - (a.average ?? 0))
    : [];
  const topThree = rankedStudents.slice(0, 3);
  const struggling = rankedStudents
    .slice()
    .reverse()
    .filter((r) => (r.average ?? 0) < 12)
    .slice(0, 4);

  // Upcoming assessments (scheduled in the future) + recent published
  const orderedAssessments = (gradebook?.assessments ?? []).slice();
  const upcomingAssessments = orderedAssessments
    .filter((a) => a.scheduledAt && new Date(a.scheduledAt) >= today)
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
    .slice(0, 5);
  const recentAssessments = orderedAssessments
    .filter((a) => !a.scheduledAt || new Date(a.scheduledAt) < today)
    .sort((a, b) => {
      const da = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
      const db = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
      return db - da;
    })
    .slice(0, 5);

  // Lessons-derived
  const lessonsPublished = lessons.filter((l) => l.status === 'published').length;
  const lessonsDraft = lessons.filter((l) => l.status === 'draft').length;
  const lessonsWithHomework = lessons.filter((l) => !!(l.homework && l.homework.trim()));
  const overdueHomework = lessonsWithHomework.filter((l) => {
    if (!l.homeworkDueAt) return false;
    return new Date(l.homeworkDueAt) < today;
  }).length;
  const dueSoonHomework = lessonsWithHomework.filter((l) => {
    if (!l.homeworkDueAt) return false;
    const d = new Date(l.homeworkDueAt);
    return d >= today && d <= new Date(today.getTime() + 7 * DAY_MS);
  }).length;
  const lastLesson = lessons[0]; // API returns DESC by date
  const lastLessonDate = lastLesson ? new Date(lastLesson.date) : null;
  const daysSinceLastLesson = lastLessonDate
    ? Math.floor((today.getTime() - startOfDay(lastLessonDate).getTime()) / DAY_MS)
    : null;
  const recentLessons = lessons.slice(0, 5);

  // ---- Visual helpers ----------------------------------------------------
  const subjectColor =
    assignment.subject.color ?? assignment.classSection.gradeLevel?.cycle?.color ?? 'oklch(0.62 0.12 180)';
  const subjectColorTint =
    assignment.subject.color
      ? { backgroundColor: `${assignment.subject.color}1A`, color: assignment.subject.color }
      : { backgroundColor: '#E2E8F0', color: '#475569' };

  const totalAlerts =
    assessmentsDraft + overdueHomework + studentsAtRisk + (incompleteAssessments > 0 ? 1 : 0);

  // ---- Action strip --------------------------------------------------------
  const hasActions =
    assessmentsDraft > 0 ||
    incompleteAssessments > 0 ||
    overdueHomework > 0 ||
    studentsAtRisk > 0;

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Mes classes', href: '/teacher/classes' },
          { label: `${assignment.classSection.name} · ${assignment.subject.name}` },
        ]}
        leading={
          <span
            aria-hidden
            className="inline-flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg"
            style={{ background: subjectColor }}
          >
            <BookOpen className="h-7 w-7" />
          </span>
        }
        title={
          <>
            {assignment.classSection.name}
            <span className="mx-1.5 text-slate-300">·</span>
            {assignment.subject.name}
          </>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {assignment.classSection.gradeLevel?.cycle?.name && (
              <>
                <span>{assignment.classSection.gradeLevel.cycle.name}</span>
                <span className="text-slate-300">·</span>
              </>
            )}
            <span>{assignment.classSection.gradeLevel?.name}</span>
            <span className="text-slate-300">·</span>
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
              {assignment.academicYear.name}
            </span>
            <span className="text-slate-300">·</span>
            <span>coef. base </span>
            <strong className="font-bold text-slate-800">{assignment.subject.defaultCoefficient}</strong>
            {assignment.isMainTeacher && (
              <>
                <span className="text-slate-300">·</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                  <Crown className="h-3 w-3" /> Professeur principal
                </span>
              </>
            )}
          </span>
        }
        actions={
          <Link
            href="/teacher/dashboard"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Tableau de bord
          </Link>
        }
      />

      {/* -- KPI strip -------------------------------------------------- */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} tone="teal" label="ÉLÈVES" value={studentsCount}>
          {studentsScored > 0
            ? `${studentsScored} avec moyenne · ${studentsCount - studentsScored} sans note`
            : 'Aucune moyenne calculée'}
        </KpiCard>
        <KpiCard
          icon={GraduationCap}
          tone={avgTone(classAverage)}
          label="MOYENNE CLASSE"
          value={classAverage !== null ? `${classAverage.toFixed(2)} / 20` : '—'}
        >
          {classAverage === null
            ? 'En attente de notes publiées'
            : classAverage >= 14
            ? 'Niveau solide pour ce groupe'
            : classAverage >= 10
            ? 'Marge de progression possible'
            : 'Classe en difficulté — à étayer'}
        </KpiCard>
        <KpiCard
          icon={ClipboardList}
          tone={assessmentsDraft > 0 ? 'amber' : 'slate'}
          label="ÉVALUATIONS"
          value={assessmentsTotal}
        >
          {assessmentsTotal === 0
            ? 'Aucune évaluation créée'
            : assessmentsDraft > 0
            ? `${assessmentsPublished} publiée${assessmentsPublished > 1 ? 's' : ''} · ${assessmentsDraft} brouillon${assessmentsDraft > 1 ? 's' : ''}`
            : `${assessmentsPublished} publiée${assessmentsPublished > 1 ? 's' : ''} · tout est partagé`}
        </KpiCard>
        <KpiCard
          icon={NotebookPen}
          tone={overdueHomework > 0 ? 'rose' : lessonsDraft > 0 ? 'amber' : 'violet'}
          label="CAHIER DE TEXTE"
          value={lessonsPublished}
        >
          {lessons.length === 0
            ? 'Aucune entrée pour le moment'
            : lastLessonDate
            ? `Dernière entrée ${
                daysSinceLastLesson === 0
                  ? "aujourd'hui"
                  : daysSinceLastLesson === 1
                  ? 'hier'
                  : `il y a ${daysSinceLastLesson} j`
              }${lessonsDraft > 0 ? ` · ${lessonsDraft} brouillon${lessonsDraft > 1 ? 's' : ''}` : ''}`
            : 'Aucune entrée datée'}
        </KpiCard>
      </div>

      {/* -- Action strip ---------------------------------------------- */}
      {hasActions ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-50 via-rose-50 to-white p-4 ring-1 ring-amber-200/70">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"
          >
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-bold text-slate-900">
              {[
                assessmentsDraft > 0
                  ? `${assessmentsDraft} évaluation${assessmentsDraft > 1 ? 's' : ''} à publier`
                  : null,
                incompleteAssessments > 0
                  ? `${incompleteAssessments} saisie${incompleteAssessments > 1 ? 's' : ''} incomplète${incompleteAssessments > 1 ? 's' : ''}`
                  : null,
                overdueHomework > 0
                  ? `${overdueHomework} devoir${overdueHomework > 1 ? 's' : ''} en retard`
                  : null,
                studentsAtRisk > 0
                  ? `${studentsAtRisk} élève${studentsAtRisk > 1 ? 's' : ''} en difficulté`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              Priorisez ces points pour fluidifier le suivi pédagogique et la communication aux familles.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {assessmentsDraft > 0 || incompleteAssessments > 0 ? (
              <Link
                href={`/teacher/classes/${id}/grades`}
                className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-amber-600 hover:shadow-md"
              >
                <Send className="h-3.5 w-3.5" /> Publier / compléter
              </Link>
            ) : null}
            {overdueHomework > 0 ? (
              <Link
                href={`/teacher/classes/${id}/lessons?homework=overdue`}
                className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-rose-700 hover:shadow-md"
              >
                <CalendarClock className="h-3.5 w-3.5" /> Devoirs en retard
              </Link>
            ) : null}
            {studentsAtRisk > 0 ? (
              <Link
                href={`/teacher/classes/${id}/grades`}
                className="inline-flex items-center gap-1 rounded-xl bg-rose-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-rose-600 hover:shadow-md"
              >
                <TrendingDown className="h-3.5 w-3.5" /> Voir au cas par cas
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* -- Tool cards ------------------------------------------------ */}
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ToolCard
          href={`/teacher/classes/${id}/grades`}
          title="Gradebook"
          body="Saisir, modifier et publier les notes."
          Icon={FileSpreadsheet}
          tint={subjectColor}
          stats={
            assessmentsTotal === 0
              ? 'Aucune évaluation'
              : `${assessmentsPublished} / ${assessmentsTotal} publiées${
                  assessmentsDraft > 0 ? ` · ${assessmentsDraft} en brouillon` : ''
                }`
          }
          highlight={assessmentsDraft > 0 ? 'amber' : null}
        />
        <ToolCard
          href={`/teacher/classes/${id}/lessons`}
          title="Cahier de texte"
          body="Tracer les leçons, devoirs et supports."
          Icon={BookOpen}
          tint={subjectColor}
          stats={
            lessons.length === 0
              ? 'Aucune entrée'
              : `${lessonsPublished} publiée${lessonsPublished > 1 ? 's' : ''} · ${
                  lessonsWithHomework.length
                } devoirs${
                  daysSinceLastLesson !== null && daysSinceLastLesson <= 1
                    ? " · à jour"
                    : daysSinceLastLesson !== null
                    ? ` · MAJ il y a ${daysSinceLastLesson} j`
                    : ''
                }`
          }
          highlight={overdueHomework > 0 ? 'rose' : lessonsDraft > 0 ? 'amber' : null}
        />
        <ToolCard
          href={`/teacher/classes/${id}/attendance`}
          title="Présences"
          body="Ouvrir une séance et faire l'appel."
          Icon={CalendarCheck2}
          tint={subjectColor}
          stats="Démarrer une séance pour faire l'appel."
          highlight={null}
        />
      </div>

      {/* -- Twin panels: lessons + assessments ------------------------ */}
      <div className="mt-8 grid gap-4 lg:grid-cols-5">
        {/* Recent lessons */}
        <section className="lg:col-span-3 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/60">
          <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Cahier de texte récent</h2>
              <p className="text-[11px] text-slate-500">5 dernières entrées · brouillons inclus</p>
            </div>
            <Link
              href={`/teacher/classes/${id}/lessons`}
              className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:underline"
            >
              Tout voir <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </header>
          {recentLessons.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">
              <NotebookPen className="mx-auto mb-2 h-6 w-6 text-slate-300" />
              Aucune entrée pour cette classe / matière pour l’instant.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentLessons.map((l) => {
                const isDraft = l.status === 'draft';
                const hasHw = !!(l.homework && l.homework.trim());
                let hwTone = '';
                let hwLabel = '';
                if (hasHw && l.homeworkDueAt) {
                  const due = new Date(l.homeworkDueAt);
                  if (due < today) {
                    hwTone = 'bg-rose-100 text-rose-700';
                    hwLabel = `À rendre ${formatDayShort(l.homeworkDueAt)} (en retard)`;
                  } else if (due <= new Date(today.getTime() + 7 * DAY_MS)) {
                    hwTone = 'bg-amber-100 text-amber-800';
                    hwLabel = `À rendre ${formatDayShort(l.homeworkDueAt)}`;
                  } else {
                    hwTone = 'bg-violet-100 text-violet-700';
                    hwLabel = `À rendre ${formatDayShort(l.homeworkDueAt)}`;
                  }
                } else if (hasHw) {
                  hwTone = 'bg-slate-100 text-slate-700';
                  hwLabel = 'Devoirs sans échéance';
                }
                return (
                  <li key={l.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="mt-0.5 inline-flex w-16 shrink-0 flex-col items-center rounded-xl bg-slate-50 px-2 py-1.5 text-center ring-1 ring-slate-200/60">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {new Date(l.date)
                          .toLocaleDateString('fr-FR', { weekday: 'short' })
                          .replace('.', '')}
                      </span>
                      <span className="font-mono text-base font-bold text-slate-900">
                        {new Date(l.date).getDate().toString().padStart(2, '0')}
                      </span>
                      <span className="text-[10px] uppercase text-slate-500">
                        {new Date(l.date).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="truncate text-sm font-bold text-slate-900">{l.title || 'Sans titre'}</h3>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            isDraft
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {isDraft ? 'Brouillon' : 'Publié'}
                        </span>
                      </div>
                      {l.content && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{l.content}</p>
                      )}
                      {hasHw && (
                        <span
                          className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${hwTone}`}
                        >
                          <BookOpen className="h-3 w-3" /> {hwLabel}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Upcoming + recent assessments */}
        <section className="lg:col-span-2 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/60">
          <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Évaluations</h2>
              <p className="text-[11px] text-slate-500">
                {upcomingAssessments.length > 0
                  ? `${upcomingAssessments.length} à venir`
                  : 'Aucune programmée'}{' '}
                · {assessmentsTotal} au total
              </p>
            </div>
            <Link
              href={`/teacher/classes/${id}/grades`}
              className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:underline"
            >
              Gradebook <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </header>
          {assessmentsTotal === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">
              <ClipboardList className="mx-auto mb-2 h-6 w-6 text-slate-300" />
              Aucune évaluation pour cette matière.
            </div>
          ) : (
            <>
              {upcomingAssessments.length > 0 && (
                <div className="border-b border-slate-100 px-5 pb-1 pt-3">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    À venir
                  </h3>
                </div>
              )}
              {upcomingAssessments.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {upcomingAssessments.map((a) => {
                    const kind = a.kind || 'other';
                    return (
                      <li key={a.id} className="px-5 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="truncate text-sm font-bold text-slate-900">{a.title}</h4>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              a.isPublished
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {a.isPublished ? 'Publié' : 'Brouillon'}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              KIND_TONE[kind] ?? KIND_TONE.other
                            }`}
                          >
                            {KIND_LABEL[kind] ?? KIND_LABEL.other}
                          </span>
                          <span>
                            <CalendarClock className="-mt-0.5 mr-1 inline h-3 w-3" />
                            {a.scheduledAt ? formatRelativeDayLabel(a.scheduledAt, now) : '—'}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span>
                            /{a.maxScore} · coef. {a.effectiveCoefficient}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {recentAssessments.length > 0 && (
                <div className="border-b border-slate-100 px-5 pb-1 pt-3">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Récentes
                  </h3>
                </div>
              )}
              {recentAssessments.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {recentAssessments.map((a) => {
                    const kind = a.kind || 'other';
                    return (
                      <li key={a.id} className="px-5 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="truncate text-sm font-bold text-slate-900">{a.title}</h4>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              a.isPublished
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {a.isPublished ? 'Publié' : 'Brouillon'}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              KIND_TONE[kind] ?? KIND_TONE.other
                            }`}
                          >
                            {KIND_LABEL[kind] ?? KIND_LABEL.other}
                          </span>
                          {a.scheduledAt ? (
                            <span>
                              <CalendarClock className="-mt-0.5 mr-1 inline h-3 w-3" />
                              {formatDayShort(a.scheduledAt)}
                            </span>
                          ) : null}
                          <span className="text-slate-400">·</span>
                          <span>
                            /{a.maxScore} · coef. {a.effectiveCoefficient}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>
      </div>

      {/* -- Twin panels: distribution + top/struggling -------------- */}
      {gradebook && studentsScored > 0 && (
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {/* Distribution */}
          <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/60">
            <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Répartition de la classe</h2>
                <p className="text-[11px] text-slate-500">
                  {studentsScored} sur {studentsCount} élève{studentsCount > 1 ? 's' : ''} noté{studentsCount > 1 ? 's' : ''}
                </p>
              </div>
            </header>
            <ul className="divide-y divide-slate-100">
              {(['excellent', 'bon', 'correct', 'risque', 'unknown'] as PerfBand[]).map((band) => {
                const meta = BAND_META[band];
                const n = distribution[band];
                const pct = studentsCount > 0 ? Math.round((n / studentsCount) * 100) : 0;
                return (
                  <li key={band} className="flex items-center gap-3 px-5 py-2.5">
                    <span className={`h-8 w-1.5 shrink-0 rounded-full ${meta.stripe}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{meta.label}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.chip}`}>
                            {meta.range}
                          </span>
                        </div>
                        <div className="font-mono text-sm font-bold tabular-nums text-slate-900">
                          {n}
                          <span className="ml-1 text-[10px] font-medium text-slate-500">/ {studentsCount}</span>
                        </div>
                      </div>
                      <div className="mt-1.5">
                        <ProgressBar value={pct} color={meta.color} height={6} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Top + struggling */}
          <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/60">
            <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Élèves à suivre</h2>
                <p className="text-[11px] text-slate-500">Meilleurs résultats + à renforcer</p>
              </div>
            </header>
            <div className="divide-y divide-slate-100">
              {topThree.length > 0 && (
                <div className="px-5 py-3">
                  <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    <Award className="h-3 w-3" /> Top {topThree.length}
                  </h3>
                  <ol className="space-y-1.5">
                    {topThree.map((r, idx) => (
                      <li key={r.studentId} className="flex items-center gap-2.5">
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-50 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-slate-900">
                            {r.student.lastName.toUpperCase()} {r.student.firstName}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {r.count} note{r.count > 1 ? 's' : ''}
                          </div>
                        </div>
                        <span className="rounded-lg bg-emerald-50 px-2 py-1 font-mono text-sm font-bold tabular-nums text-emerald-700 ring-1 ring-emerald-200/60">
                          {r.average !== null ? r.average.toFixed(2) : '—'}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {struggling.length > 0 ? (
                <div className="px-5 py-3">
                  <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-700">
                    <TrendingDown className="h-3 w-3" /> À renforcer ({struggling.length})
                  </h3>
                  <ol className="space-y-1.5">
                    {struggling.map((r) => {
                      const isRisk = (r.average ?? 0) < 10;
                      return (
                        <li key={r.studentId} className="flex items-center gap-2.5">
                          <span
                            className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold ring-1 ${
                              isRisk
                                ? 'bg-rose-50 text-rose-700 ring-rose-200'
                                : 'bg-amber-50 text-amber-700 ring-amber-200'
                            }`}
                          >
                            <AlertTriangle className="h-3 w-3" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold text-slate-900">
                              {r.student.lastName.toUpperCase()} {r.student.firstName}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {r.count} note{r.count > 1 ? 's' : ''}
                            </div>
                          </div>
                          <span
                            className={`rounded-lg px-2 py-1 font-mono text-sm font-bold tabular-nums ring-1 ${
                              isRisk
                                ? 'bg-rose-50 text-rose-700 ring-rose-200/60'
                                : 'bg-amber-50 text-amber-800 ring-amber-200/60'
                            }`}
                          >
                            {r.average !== null ? r.average.toFixed(2) : '—'}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-5 py-3 text-xs text-slate-500">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Tous les élèves notés sont au-dessus de 12 / 20.
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* -- Footer hint: comms shortcut ------------------------------ */}
      <section className="mt-8 rounded-2xl bg-gradient-to-br from-teal-50 via-white to-blue-50 p-5 shadow-sm ring-1 ring-teal-200/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-teal-600 ring-1 ring-teal-200/60">
              <Megaphone className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-bold text-slate-900">
                Communiquer avec les familles
              </div>
              <div className="mt-0.5 text-xs text-slate-600">
                Annoncez une évaluation, un changement d&apos;emploi du temps ou un rappel
                directement aux parents de cette classe.
              </div>
            </div>
          </div>
          <Link
            href={`/teacher/messaging?classSectionId=${assignment.classSection.id}`}
            className="inline-flex items-center gap-1.5 self-start rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-teal-700 hover:shadow-md"
          >
            <Send className="h-3.5 w-3.5" /> Nouvelle annonce
          </Link>
        </div>
      </section>

      {/* -- All clear footer if nothing flagged --------------------- */}
      {totalAlerts === 0 && gradebook && (
        <section className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-50/80 px-5 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200/60">
          <Sparkles className="h-4 w-4" /> Aucun point d&apos;attention immédiat — bon travail !
        </section>
      )}
    </PortalShell>
  );
}

interface ToolCardProps {
  href: string;
  title: string;
  body: string;
  Icon: React.ComponentType<{ className?: string }>;
  tint: string;
  stats: string;
  highlight: 'amber' | 'rose' | null;
}

function ToolCard({ href, title, body, Icon, tint, stats, highlight }: ToolCardProps) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: tint }}
      />
      <div className="flex items-center justify-between">
        <span
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm"
          style={{ background: tint }}
        >
          <Icon className="h-5 w-5" />
        </span>
        <ChevronRight className="h-4 w-4 text-slate-400 transition group-hover:text-teal-700" />
      </div>
      <div className="mt-3 text-base font-bold text-slate-900">{title}</div>
      <p className="mt-1 text-xs text-slate-600">{body}</p>
      <div
        className={`mt-3 inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
          highlight === 'rose'
            ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/60'
            : highlight === 'amber'
            ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/60'
            : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200/60'
        }`}
      >
        {highlight === 'rose' ? (
          <AlertTriangle className="h-3 w-3" />
        ) : highlight === 'amber' ? (
          <ClipboardEdit className="h-3 w-3" />
        ) : (
          <CheckCircle2 className="h-3 w-3" />
        )}
        {stats}
      </div>
    </Link>
  );
}
