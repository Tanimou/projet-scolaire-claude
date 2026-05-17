import { CalendarDays, ClipboardList, NotebookPen, Sparkles, User } from 'lucide-react';

import { SubjectChip, formatDateLong, formatDateShort, formatInDays } from '@pilotage/ui';

import type { LessonRow } from './types';

/**
 * Pretty-prints one cahier-de-texte entry for parents. The card is
 * intentionally dense (subject color rail + lesson body + optional homework
 * callout) so a parent can skim a week's notebook quickly.
 */
export function LessonCard({ lesson, now }: { lesson: LessonRow; now: Date }) {
  const subject = lesson.teachingAssignment.subject;
  const color = subject.color ?? 'oklch(0.65 0.15 250)';
  const teacher = lesson.teacherProfile.userProfile;
  const teacherInitial = teacher.lastName?.[0] ?? '';
  const homeworkState = describeHomework(lesson.homeworkDueAt, now);

  return (
    <article
      className="group relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60 transition hover:shadow-md hover:ring-slate-300"
    >
      {/* Color rail */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} />

      <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-[88px,1fr] sm:items-start sm:gap-5">
        {/* Date block */}
        <div className="shrink-0">
          <div className="inline-flex items-center gap-2 sm:flex-col sm:items-stretch sm:gap-0">
            <div
              className="grid h-12 w-12 place-items-center rounded-xl text-center ring-1"
              style={{ background: `color-mix(in oklch, ${color} 12%, white)`, borderColor: color, color }}
            >
              <div className="-mt-0.5">
                <div className="text-[9px] font-bold uppercase tracking-wider opacity-80">
                  {new Date(lesson.date)
                    .toLocaleDateString('fr-FR', { month: 'short' })
                    .replace('.', '')}
                </div>
                <div className="text-lg font-bold leading-none tabular-nums">
                  {new Date(lesson.date).getDate()}
                </div>
              </div>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 sm:mt-1.5">
              {new Date(lesson.date)
                .toLocaleDateString('fr-FR', { weekday: 'short' })
                .replace('.', '')}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SubjectChip subjectCode={subject.name} label={subject.name} size="sm" />
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
              <User className="h-3 w-3" />
              {teacher.firstName} {teacherInitial}.
            </span>
            <span className="text-[11px] text-slate-300">·</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <CalendarDays className="h-3 w-3" />
              {formatDateLong(lesson.date)}
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {lesson.teachingAssignment.classSection.name}
            </span>
          </div>

          <h3 className="mt-2 flex items-start gap-2 text-sm font-bold text-slate-900">
            <NotebookPen className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="leading-snug">{lesson.title}</span>
          </h3>
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-600">
            {lesson.content}
          </p>

          {lesson.homework && (
            <div
              className={
                'mt-3 rounded-xl border p-3 ' +
                (homeworkState.tone === 'overdue'
                  ? 'border-rose-200 bg-rose-50'
                  : homeworkState.tone === 'today'
                    ? 'border-amber-200 bg-amber-50'
                    : homeworkState.tone === 'soon'
                      ? 'border-orange-200 bg-orange-50'
                      : 'border-emerald-200 bg-emerald-50')
              }
            >
              <div
                className={
                  'flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider ' +
                  (homeworkState.tone === 'overdue'
                    ? 'text-rose-700'
                    : homeworkState.tone === 'today'
                      ? 'text-amber-700'
                      : homeworkState.tone === 'soon'
                        ? 'text-orange-700'
                        : 'text-emerald-700')
                }
              >
                <ClipboardList className="h-3.5 w-3.5" />
                Devoirs
                {lesson.homeworkDueAt && (
                  <span className="font-semibold normal-case tracking-normal">
                    · pour le {formatDateShort(lesson.homeworkDueAt)}
                    {' '}
                    <span className="opacity-80">({formatInDays(lesson.homeworkDueAt, now)})</span>
                  </span>
                )}
                <span
                  className={
                    'ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal ring-1 ' +
                    homeworkState.badgeClass
                  }
                >
                  <Sparkles className="h-3 w-3" />
                  {homeworkState.label}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-800">
                {lesson.homework}
              </p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

type HomeworkTone = 'overdue' | 'today' | 'soon' | 'later';

function describeHomework(
  dueAt: string | null,
  now: Date,
): { tone: HomeworkTone; label: string; badgeClass: string } {
  if (!dueAt) {
    return {
      tone: 'later',
      label: 'À planifier',
      badgeClass: 'bg-white text-emerald-700 ring-emerald-200',
    };
  }
  const due = new Date(dueAt);
  due.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diff < 0) {
    return {
      tone: 'overdue',
      label: 'En retard',
      badgeClass: 'bg-white text-rose-700 ring-rose-200',
    };
  }
  if (diff === 0) {
    return {
      tone: 'today',
      label: "Pour aujourd'hui",
      badgeClass: 'bg-white text-amber-700 ring-amber-200',
    };
  }
  if (diff <= 3) {
    return {
      tone: 'soon',
      label: 'Bientôt',
      badgeClass: 'bg-white text-orange-700 ring-orange-200',
    };
  }
  return {
    tone: 'later',
    label: 'À venir',
    badgeClass: 'bg-white text-emerald-700 ring-emerald-200',
  };
}
