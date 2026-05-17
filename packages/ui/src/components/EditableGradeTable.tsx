'use client';

import { useCallback, useMemo, useState } from 'react';

import { cn } from '../lib/cn';
import { formatGrade } from '../lib/format';
import { GradePill } from './GradePill';

export interface AssessmentColumn {
  id: string;
  name: string;
  /** Maximum score for this assessment (default 20) */
  max?: number;
  /** Optional points label override (e.g. "20 pts") */
  pointsLabel?: string;
  /** Optional coefficient (used for the average column when overriding subject default) */
  coefficient?: number;
}

export interface StudentRow {
  id: string;
  firstName: string;
  lastName: string;
}

export interface GradeCell {
  studentId: string;
  assessmentId: string;
  value: number | null;
  isAbsent?: boolean;
}

export interface GradeChange {
  studentId: string;
  assessmentId: string;
  value: number | null;
  isAbsent?: boolean;
}

export interface EditableGradeTableProps {
  assessments: AssessmentColumn[];
  students: StudentRow[];
  grades: GradeCell[];
  /** Called when user commits a change. Caller batches & saves. */
  onChange?: (change: GradeChange) => void;
  /** Show the "Moyenne de la classe" footer row */
  showClassAverageRow?: boolean;
  /** Make the student column wider for long names */
  studentColumnWidth?: number;
  /** Disable editing entirely */
  readOnly?: boolean;
  className?: string;
}

/** Compute the row average across given grade cells, weighted by max. */
function rowAverage(
  cells: Array<{ value: number | null; max: number }>,
): number | null {
  const valid = cells.filter((c) => c.value != null) as Array<{ value: number; max: number }>;
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, c) => acc + (c.value / c.max) * 20, 0);
  return sum / valid.length;
}

/** Compute the column average for a given assessment. */
function colAverage(values: Array<number | null>, max: number): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, v) => acc + (v / max) * 20, 0);
  return sum / valid.length;
}

/**
 * EditableGradeTable — image 6 "Saisie des notes – 2nde A".
 * Renders a matrix of students × assessments with colored grade pills.
 *
 * Editing model: optimistic UI — local state mirrors props; `onChange` is fired
 * for each commit. Caller is responsible for batching saves (e.g. via a debounce
 * or a "Enregistrer" button at the top).
 */
export function EditableGradeTable({
  assessments,
  students,
  grades,
  onChange,
  showClassAverageRow = true,
  studentColumnWidth = 200,
  readOnly,
  className,
}: EditableGradeTableProps) {
  const initialMap = useMemo(() => {
    const map = new Map<string, GradeCell>();
    for (const g of grades) map.set(`${g.studentId}:${g.assessmentId}`, g);
    return map;
  }, [grades]);

  const [local, setLocal] = useState<Map<string, GradeCell>>(initialMap);

  const get = useCallback(
    (studentId: string, assessmentId: string): GradeCell | undefined =>
      local.get(`${studentId}:${assessmentId}`),
    [local],
  );

  const setLocalCell = useCallback(
    (studentId: string, assessmentId: string, patch: Partial<GradeCell>) => {
      setLocal((prev) => {
        const key = `${studentId}:${assessmentId}`;
        const existing = prev.get(key);
        const next: GradeCell = {
          studentId,
          assessmentId,
          value: patch.value !== undefined ? patch.value : (existing?.value ?? null),
          isAbsent: patch.isAbsent !== undefined ? patch.isAbsent : existing?.isAbsent,
        };
        const m = new Map(prev);
        m.set(key, next);
        return m;
      });
    },
    [],
  );

  const handleCommit = useCallback(
    (studentId: string, assessmentId: string, value: number | null) => {
      setLocalCell(studentId, assessmentId, { value, isAbsent: false });
      onChange?.({ studentId, assessmentId, value, isAbsent: false });
    },
    [onChange, setLocalCell],
  );

  // Pre-compute row & col averages
  const rowAverages = useMemo(
    () =>
      Object.fromEntries(
        students.map((s) => [
          s.id,
          rowAverage(
            assessments.map((a) => ({
              value: get(s.id, a.id)?.value ?? null,
              max: a.max ?? 20,
            })),
          ),
        ]),
      ),
    [assessments, students, get],
  );

  const colAverages = useMemo(
    () =>
      Object.fromEntries(
        assessments.map((a) => [
          a.id,
          colAverage(
            students.map((s) => get(s.id, a.id)?.value ?? null),
            a.max ?? 20,
          ),
        ]),
      ),
    [assessments, students, get],
  );

  const classOverall = useMemo(() => {
    const allRows = Object.values(rowAverages).filter((v): v is number => v != null);
    if (allRows.length === 0) return null;
    return allRows.reduce((a, b) => a + b, 0) / allRows.length;
  }, [rowAverages]);

  return (
    <div className={cn('overflow-x-auto rounded-xl border border-slate-100', className)}>
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"
              style={{ minWidth: 32 }}
            >
              #
            </th>
            <th
              scope="col"
              className="sticky left-8 z-10 bg-slate-50 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500"
              style={{ minWidth: studentColumnWidth }}
            >
              Élève
            </th>
            {assessments.map((a) => (
              <th
                key={a.id}
                scope="col"
                className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500"
              >
                <div>{a.name}</div>
                <div className="mt-0.5 text-[10px] font-medium normal-case text-slate-400">
                  {a.pointsLabel ?? `${a.max ?? 20} pts`}
                </div>
              </th>
            ))}
            <th
              scope="col"
              className="px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500"
            >
              Moyenne
              <div className="mt-0.5 text-[10px] font-medium normal-case text-slate-400">/ 20</div>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {students.map((s, i) => (
            <tr key={s.id} className="hover:bg-slate-50/50">
              <td className="sticky left-0 z-10 bg-inherit px-3 py-2 text-[11px] tabular-nums text-slate-400">
                {i + 1}
              </td>
              <td className="sticky left-8 z-10 bg-inherit px-3 py-2 text-sm font-semibold text-slate-900">
                {s.lastName.toUpperCase()}, {s.firstName}
              </td>
              {assessments.map((a) => {
                const cell = get(s.id, a.id);
                return (
                  <td key={a.id} className="px-3 py-2 text-center">
                    <GradePill
                      value={cell?.value ?? null}
                      max={a.max ?? 20}
                      editable={!readOnly}
                      isAbsent={cell?.isAbsent}
                      onCommit={(next) => handleCommit(s.id, a.id, next)}
                      ariaLabel={`Note ${a.name} pour ${s.firstName} ${s.lastName}`}
                    />
                  </td>
                );
              })}
              <td className="px-3 py-2 text-center font-mono text-sm font-bold tabular-nums text-blue-700">
                {formatGrade(rowAverages[s.id] ?? null, 2)}
              </td>
            </tr>
          ))}
          {showClassAverageRow && (
            <tr className="bg-slate-50/70">
              <td colSpan={2} className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                Moyenne de la classe
              </td>
              {assessments.map((a) => (
                <td key={a.id} className="px-3 py-2 text-center font-mono text-sm tabular-nums text-slate-700">
                  {formatGrade(colAverages[a.id] ?? null, 2)}
                </td>
              ))}
              <td className="px-3 py-2 text-center font-mono text-sm font-bold tabular-nums text-slate-900">
                {formatGrade(classOverall ?? null, 2)}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
