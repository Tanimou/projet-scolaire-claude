'use client';

import { ArrowRight, Check, ChevronDown, Loader2, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { GradePill, formatGrade, subjectColor } from '@pilotage/ui';

import { saveGrades } from '../../classes/[id]/grades/actions';

export interface GradebookData {
  assignment: {
    id: string;
    classSection: {
      id: string;
      name: string;
      gradeLevel: { id: string; name: string; cycle?: { name: string } };
    };
    subject: { id: string; name: string; code?: string; color: string | null };
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
  }>;
  rows: Array<{
    studentId: string;
    student: { id: string; firstName: string; lastName: string };
    grades: Array<null | {
      id: string;
      value: number | null;
      isAbsent: boolean;
      status: string;
    }>;
    average: number | null;
    count: number;
  }>;
  classAverage: number | null;
}

export interface AssignmentOption {
  id: string;
  className: string;
  subjectName: string;
  subjectCode: string;
}

const KIND_SHORT: Record<string, string> = {
  written_test: 'Contrôle',
  oral_test: 'Oral',
  homework: 'Devoir',
  project: 'Projet',
  practical: 'TP',
  participation: 'Particip.',
};

export function InlineGradebook({
  initial,
  assignmentOptions,
  selectedAssignmentId,
}: {
  initial: GradebookData | null;
  assignmentOptions: AssignmentOption[];
  selectedAssignmentId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Local edit buffer: { [assessmentId]: { [studentId]: number | null } }
  const [edits, setEdits] = useState<
    Record<string, Record<string, number | null>>
  >({});

  useEffect(() => {
    // Reset edits when the selected assignment changes
    setEdits({});
    setFeedback(null);
  }, [selectedAssignmentId]);

  useEffect(() => {
    if (!pickerOpen) return;
    function close(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pickerOpen]);

  const dirtyCount = useMemo(
    () =>
      Object.values(edits).reduce(
        (n, byStudent) => n + Object.keys(byStudent).length,
        0,
      ),
    [edits],
  );

  function navigate(toAssignmentId: string) {
    const params = new URLSearchParams(window.location.search);
    params.set('a', toAssignmentId);
    setPickerOpen(false);
    startTransition(() => {
      router.push(`/teacher/dashboard?${params.toString()}`);
    });
  }

  function setCell(assessmentId: string, studentId: string, value: number | null) {
    setEdits((prev) => ({
      ...prev,
      [assessmentId]: { ...prev[assessmentId], [studentId]: value },
    }));
    setFeedback(null);
  }

  function saveAll() {
    if (dirtyCount === 0) return;
    setFeedback(null);
    startTransition(async () => {
      let savedTotal = 0;
      for (const [assessmentId, byStudent] of Object.entries(edits)) {
        const grades = Object.entries(byStudent)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([studentId, v]) => ({ studentId, value: v as number }));
        if (grades.length === 0) continue;
        const res = await saveGrades({ assessmentId, grades });
        if (!res.ok) {
          setFeedback({ kind: 'error', msg: res.error });
          return;
        }
        savedTotal += grades.length;
      }
      setEdits({});
      setFeedback({
        kind: 'success',
        msg: `${savedTotal} note${savedTotal > 1 ? 's' : ''} enregistrée${savedTotal > 1 ? 's' : ''}.`,
      });
      router.refresh();
    });
  }

  if (!initial) {
    return (
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <h2 className="text-base font-bold text-slate-900">Saisie des notes</h2>
        <p className="mt-3 text-sm text-slate-500">
          Sélectionne une de tes classes pour saisir les notes inline.
        </p>
        {assignmentOptions.length > 0 && (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {assignmentOptions.slice(0, 6).map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => navigate(a.id)}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 transition hover:border-blue-300 hover:bg-blue-50"
                >
                  <span className="text-sm font-bold text-slate-900">
                    {a.className} · {a.subjectName}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const { assignment, assessments, rows, classAverage } = initial;
  const subjColor = subjectColor(assignment.subject.code ?? assignment.subject.name);
  // Per-assessment class average (footer row)
  const perAssessmentAvg = assessments.map((_a, idx) => {
    const values = rows
      .map((r) => r.grades[idx])
      .filter((g): g is NonNullable<typeof g> => !!g && g.value != null && !g.isAbsent)
      .map((g) => g.value as number);
    if (values.length === 0) return null;
    return values.reduce((s, v) => s + v, 0) / values.length;
  });

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">
            Saisie des notes – {assignment.classSection.name}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {assignment.classSection.gradeLevel.name}
            {assignment.classSection.gradeLevel.cycle?.name &&
              ` · ${assignment.classSection.gradeLevel.cycle.name}`}
            {' · '}
            {rows.length} élève{rows.length > 1 ? 's' : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Assignment picker (subject/class dropdown) */}
          <div ref={pickerRef} className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: subjColor.primary }}
            >
              {assignment.subject.name}
              <ChevronDown className={`h-3.5 w-3.5 transition ${pickerOpen ? 'rotate-180' : ''}`} />
            </button>
            {pickerOpen && (
              <div className="absolute right-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                {assignmentOptions.map((a) => {
                  const c = subjectColor(a.subjectCode);
                  const active = a.id === selectedAssignmentId;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => navigate(a.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                        active ? 'bg-slate-100' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: c.primary }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold text-slate-900">
                          {a.className}
                        </div>
                        <div className="truncate text-[10px] text-slate-500">
                          {a.subjectName}
                        </div>
                      </div>
                      {active && <Check className="h-3 w-3 text-blue-700" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Save button */}
          <button
            type="button"
            onClick={saveAll}
            disabled={pending || dirtyCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Enregistrer{dirtyCount > 0 && ` (${dirtyCount})`}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`mt-3 rounded-lg px-3 py-1.5 text-xs ${
            feedback.kind === 'success'
              ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200'
              : 'bg-rose-50 text-rose-900 ring-1 ring-rose-200'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* Empty state when no assessment yet */}
      {assessments.length === 0 ? (
        <div className="mt-6 rounded-xl bg-slate-50 p-6 text-center">
          <p className="text-sm font-semibold text-slate-700">
            Aucune évaluation créée pour cette affectation.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Crée la première évaluation depuis la gradebook plein écran.
          </p>
          <Link
            href={`/teacher/classes/${assignment.id}/grades`}
            className="mt-3 inline-flex items-center gap-1 text-xs font-bold accent-text hover:underline"
          >
            Ouvrir la gradebook <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="w-8 px-2 py-2">#</th>
                <th className="px-2 py-2">Élève</th>
                {assessments.map((a) => (
                  <th key={a.id} className="px-2 py-2 text-center">
                    <div className="leading-tight">{a.title}</div>
                    <div className="text-[10px] font-normal normal-case text-slate-400">
                      ({KIND_SHORT[a.kind] ?? a.kind} · /{a.maxScore})
                    </div>
                  </th>
                ))}
                <th className="px-2 py-2 text-center">Moyenne (/20)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, rowIdx) => {
                // Compute optimistic average including edits
                const cellValues: Array<{ value: number; max: number }> = [];
                assessments.forEach((a, idx) => {
                  const cell = row.grades[idx];
                  const edited = edits[a.id]?.[row.studentId];
                  const effective = edited !== undefined ? edited : cell?.value ?? null;
                  if (effective != null && !cell?.isAbsent) {
                    cellValues.push({ value: effective, max: a.maxScore });
                  }
                });
                const optimisticAvg =
                  cellValues.length > 0
                    ? cellValues.reduce((s, v) => s + (v.value / v.max) * 20, 0) / cellValues.length
                    : null;

                return (
                  <tr key={row.studentId} className="text-sm">
                    <td className="px-2 py-2 text-xs text-slate-400">{rowIdx + 1}</td>
                    <td className="px-2 py-2 font-semibold text-slate-900">
                      <span className="hidden md:inline">{row.student.lastName.toUpperCase()}, </span>
                      {row.student.firstName}
                    </td>
                    {assessments.map((a, idx) => {
                      const cell = row.grades[idx];
                      const edited = edits[a.id]?.[row.studentId];
                      const effective = edited !== undefined ? edited : cell?.value ?? null;
                      const isDirty = edited !== undefined;
                      return (
                        <td key={a.id} className="px-2 py-2 text-center">
                          {cell?.isAbsent ? (
                            <GradePill value={null} isAbsent size="sm" />
                          ) : (
                            <span className={isDirty ? 'rounded-full ring-2 ring-blue-300' : ''}>
                              <GradePill
                                value={effective}
                                max={a.maxScore}
                                editable
                                size="sm"
                                onCommit={(v) => setCell(a.id, row.studentId, v)}
                              />
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center">
                      <span
                        className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 font-mono text-xs font-bold tabular-nums ${
                          optimisticAvg == null
                            ? 'text-slate-400'
                            : optimisticAvg >= 16
                              ? 'bg-emerald-100 text-emerald-700'
                              : optimisticAvg >= 10
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {optimisticAvg == null ? '—' : formatGrade(optimisticAvg, 2)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-600">
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2">Moyenne de la classe</td>
                {assessments.map((_a, idx) => (
                  <td key={idx} className="px-2 py-2 text-center font-mono tabular-nums">
                    {perAssessmentAvg[idx] == null ? '—' : formatGrade(perAssessmentAvg[idx] as number, 2)}
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-mono tabular-nums text-blue-700">
                  {classAverage == null ? '—' : formatGrade(classAverage, 2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
