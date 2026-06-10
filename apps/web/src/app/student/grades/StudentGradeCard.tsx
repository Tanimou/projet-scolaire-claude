import { CalendarDays, FileEdit, MessageSquareQuote } from 'lucide-react';

import { formatDateShort, formatGrade, gradeBucket, gradeVerdict } from '@pilotage/ui';
import type { StudentGradeRow } from '@pilotage/contracts';

import { kindLabel } from './kinds';

/**
 * One of the learner's own published grades, rendered as a kind, first-person
 * card. Mirrors the parent grade card's look but consumes the narrowed
 * `StudentGradeRow` (no peer-relative field exists on the shape) and frames the
 * teacher comment as the teacher's words via `aria-describedby` — never a system
 * verdict. Grade tone uses icon/shape + number (GradePill bucket), never colour
 * alone.
 */
export function StudentGradeCard({ grade }: { grade: StudentGradeRow }) {
  const color = grade.subjectColor ?? 'oklch(0.56 0.19 292)';
  const max = Number(grade.maxScore);
  const rawValue = grade.value != null ? Number(grade.value) : null;
  const coefficient = grade.coefficient ?? 1;
  const dateLabel = grade.scheduledAt ? formatDateShort(grade.scheduledAt) : '—';

  const onTwenty = rawValue != null && max > 0 ? (rawValue / max) * 20 : null;
  const bucket = grade.isAbsent ? null : gradeBucket(rawValue, max);
  const verdict = grade.isAbsent ? null : gradeVerdict(onTwenty);
  const commentId = grade.comment ? `student-grade-comment-${grade.id}` : undefined;

  return (
    <article className="group relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60 transition hover:shadow-md hover:ring-slate-300">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} />

      <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-[1fr,auto] sm:items-center sm:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
              <FileEdit className="h-3 w-3" />
              {kindLabel(grade.kind)}
            </span>
            <span className="text-[11px] text-slate-300">·</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <CalendarDays className="h-3 w-3" />
              {dateLabel}
            </span>
            {grade.termName && (
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                {grade.termName}
              </span>
            )}
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-slate-500 ring-1 ring-slate-200/80">
              coef {coefficient}
            </span>
          </div>

          <h3 className="mt-2 text-sm font-bold leading-snug text-slate-900">
            {grade.assessmentTitle}
          </h3>

          {grade.comment && (
            <p
              id={commentId}
              className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs italic leading-relaxed text-slate-700"
            >
              <MessageSquareQuote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              <span className="min-w-0">« {grade.comment} »</span>
            </p>
          )}

          {grade.status === 'revised' && (
            <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-700 ring-1 ring-sky-200">
              Note révisée
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
          {grade.isAbsent ? (
            <span className="inline-flex items-center justify-center rounded-2xl bg-slate-100 px-4 py-2 font-mono text-sm font-bold text-slate-500">
              ABS
            </span>
          ) : rawValue != null ? (
            <>
              <div
                className={
                  'inline-flex items-end gap-1 rounded-2xl px-4 py-2 ring-1 ring-inset ring-black/5 ' +
                  (bucket?.className ?? 'bg-slate-50 text-slate-700')
                }
                aria-label={`${formatGrade(rawValue)} sur ${max}`}
                aria-describedby={commentId}
              >
                <span className="font-mono text-2xl font-bold tabular-nums leading-none">
                  {formatGrade(rawValue, rawValue % 1 === 0 ? 0 : 1)}
                </span>
                <span className="font-mono text-xs font-bold leading-none opacity-70">
                  / {max.toFixed(0)}
                </span>
              </div>
              {onTwenty != null && max !== 20 && (
                <span className="font-mono text-[10px] tabular-nums text-slate-400">
                  ≈ {onTwenty.toFixed(1)} / 20
                </span>
              )}
              {verdict && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {verdict}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </div>
      </div>
    </article>
  );
}
