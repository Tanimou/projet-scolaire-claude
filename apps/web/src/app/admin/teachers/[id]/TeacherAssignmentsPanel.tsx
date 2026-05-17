'use client';

import { Crown, Loader2, Plus, Star, Trash2, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { EmptyState, SubjectChip } from '@pilotage/ui';

import {
  createAssignment,
  deleteAssignment,
} from '../../teaching-assignments/actions';

interface AssignmentRow {
  id: string;
  classSectionId: string;
  className: string;
  gradeLevelName: string;
  cycleName: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  academicYearName: string;
  isMainTeacher: boolean;
  weeklyHours: number | null;
}

interface Option {
  id: string;
  label: string;
}

export function TeacherAssignmentsPanel({
  teacherId,
  assignments,
  classOptions,
  subjectOptions,
}: {
  teacherId: string;
  assignments: AssignmentRow[];
  classOptions: Option[];
  subjectOptions: Array<Option & { code: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  // Add-form state
  const [classSectionId, setClassSectionId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [isMainTeacher, setIsMainTeacher] = useState(false);
  const [weeklyHours, setWeeklyHours] = useState<string>('');

  function reset() {
    setClassSectionId('');
    setSubjectId('');
    setIsMainTeacher(false);
    setWeeklyHours('');
    setError(null);
  }

  function submit() {
    if (!classSectionId || !subjectId) {
      setError('Sélectionnez une classe et une matière.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createAssignment({
        teacherProfileId: teacherId,
        classSectionId,
        subjectId,
        isMainTeacher,
        ...(weeklyHours ? { weeklyHours: Number(weeklyHours) } : {}),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reset();
      setFormOpen(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm('Retirer cette affectation ? Les évaluations et notes existantes ne sont pas supprimées.'))
      return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAssignment(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="space-y-4">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900">
          {error}
        </div>
      )}

      {/* Add form */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Nouvelle affectation</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Affecte ce·tte professeur à une classe × matière pour l&apos;année active.
            </p>
          </div>
          {!formOpen && (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Ajouter une affectation
            </button>
          )}
        </div>

        {formOpen && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Classe
              </span>
              <select
                value={classSectionId}
                onChange={(e) => setClassSectionId(e.target.value)}
                disabled={pending}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/30 disabled:cursor-not-allowed disabled:bg-slate-50"
              >
                <option value="">— Sélectionner —</option>
                {classOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Matière
              </span>
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                disabled={pending}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/30 disabled:cursor-not-allowed disabled:bg-slate-50"
              >
                <option value="">— Sélectionner —</option>
                {subjectOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Heures / semaine
              </span>
              <input
                type="number"
                min={0}
                max={40}
                step={0.5}
                value={weeklyHours}
                onChange={(e) => setWeeklyHours(e.target.value)}
                disabled={pending}
                placeholder="ex : 4"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/30 disabled:cursor-not-allowed disabled:bg-slate-50"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Rôle
              </span>
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <input
                  type="checkbox"
                  checked={isMainTeacher}
                  onChange={(e) => setIsMainTeacher(e.target.checked)}
                  disabled={pending}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span className="text-slate-700">Professeur principal</span>
              </label>
            </label>

            <div className="sm:col-span-2 xl:col-span-4">
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFormOpen(false);
                    reset();
                  }}
                  disabled={pending}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Star className="h-4 w-4" />
                  )}
                  Créer l&apos;affectation
                </button>
              </div>
              {isMainTeacher && (
                <p className="mt-2 text-[11px] text-amber-700">
                  ⚠ Si une autre personne est déjà prof. principal de cette classe, elle sera
                  automatiquement rétrogradée.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Current assignments */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            Affectations actuelles ({assignments.length})
          </h3>
        </div>
        {assignments.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Aucune affectation"
            description="Cet·te enseignant·e n'a pas encore de classe ni de matière. Utilise le formulaire ci-dessus pour démarrer."
            tone="slate"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Classe</th>
                  <th className="px-4 py-3">Matière</th>
                  <th className="px-4 py-3">Année</th>
                  <th className="px-4 py-3 text-right">Heures / sem</th>
                  <th className="px-4 py-3">Rôle</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assignments.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
                        {a.className}
                      </span>
                      <span className="ml-1.5 text-[11px] text-slate-500">
                        {a.gradeLevelName} · {a.cycleName}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <SubjectChip
                        subjectCode={a.subjectCode}
                        label={a.subjectName}
                        size="sm"
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{a.academicYearName}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-700">
                      {a.weeklyHours != null ? `${a.weeklyHours} h` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {a.isMainTeacher ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                          <Crown className="h-3 w-3" /> Principal·e
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => remove(a.id)}
                        disabled={pending}
                        title="Retirer cette affectation"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-rose-50 text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
