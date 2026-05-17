'use client';

import { Crown, Loader2, Plus, Star, Trash2, UserCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { createAssignment, deleteAssignment, updateAssignment } from './actions';
import type { Assignment, ClassOption, SubjectOption, TeacherOption } from './types';

// Re-export so the new `/admin/assignments` page can import types via this module
export type { Assignment, ClassOption, SubjectOption, TeacherOption } from './types';

export function AssignmentsManager({
  assignments,
  teachers,
  classes,
  subjects,
}: {
  assignments: Assignment[];
  teachers: TeacherOption[];
  classes: ClassOption[];
  subjects: SubjectOption[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterClass, setFilterClass] = useState<string>('');
  const [filterTeacher, setFilterTeacher] = useState<string>('');

  const grouped = useMemo(() => {
    const byClass = new Map<string, { cls: Assignment['classSection']; year: Assignment['academicYear']; items: Assignment[] }>();
    for (const a of assignments) {
      if (filterClass && a.classSection.id !== filterClass) continue;
      if (filterTeacher && a.teacherProfile.id !== filterTeacher) continue;
      if (!byClass.has(a.classSection.id))
        byClass.set(a.classSection.id, { cls: a.classSection, year: a.academicYear, items: [] });
      byClass.get(a.classSection.id)!.items.push(a);
    }
    return [...byClass.values()];
  }, [assignments, filterClass, filterTeacher]);

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterClass}
          onChange={(e) => setFilterClass(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">Toutes les classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.gradeLevel.cycle.name} · {c.name} ({c.gradeLevel.name})
            </option>
          ))}
        </select>
        <select
          value={filterTeacher}
          onChange={(e) => setFilterTeacher(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">Tous les professeurs</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.userProfile.lastName.toUpperCase()} {t.userProfile.firstName}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-slate-500">{assignments.length} affectation(s)</span>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-500/30"
          >
            <Plus className="h-4 w-4" /> Nouvelle affectation
          </button>
        )}
      </div>

      {creating && (
        <NewAssignmentForm
          teachers={teachers}
          classes={classes}
          subjects={subjects}
          onCancel={() => setCreating(false)}
          onSuccess={() => {
            setCreating(false);
            router.refresh();
          }}
          onError={setError}
        />
      )}

      {grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <UserCheck className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm text-slate-600">
            Aucune affectation pour ces filtres. Créez-en une pour démarrer.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ cls, year, items }) => (
            <section
              key={cls.id}
              className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200"
            >
              <header
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                style={{ background: `color-mix(in oklch, ${cls.gradeLevel.cycle.color ?? 'oklch(0.62 0.18 250)'} 10%, white)` }}
              >
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {cls.gradeLevel.cycle.name} · {cls.gradeLevel.name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{cls.name}</h3>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      {year.name}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-slate-500">
                  {items.length} matière(s) couverte(s) / {subjects.length} possible(s)
                </span>
              </header>

              <ul className="divide-y divide-slate-100">
                {items.map((a) => (
                  <Row
                    key={a.id}
                    a={a}
                    onDelete={async () => {
                      if (!confirm(`Retirer ${a.teacherProfile.userProfile.firstName} de ${a.subject.name} en ${a.classSection.name} ?`)) return;
                      setBusy(true);
                      const res = await deleteAssignment(a.id);
                      setBusy(false);
                      if (!res.ok) setError(res.error);
                      else router.refresh();
                    }}
                    onToggleMain={async () => {
                      setBusy(true);
                      const res = await updateAssignment(a.id, { isMainTeacher: !a.isMainTeacher });
                      setBusy(false);
                      if (!res.ok) setError(res.error);
                      else router.refresh();
                    }}
                    busy={busy}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  a,
  onDelete,
  onToggleMain,
  busy,
}: {
  a: Assignment;
  onDelete: () => void;
  onToggleMain: () => void;
  busy: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-teal-100 to-emerald-100 text-xs font-bold text-emerald-700">
        {a.teacherProfile.userProfile.firstName[0]?.toUpperCase()}
        {a.teacherProfile.userProfile.lastName[0]?.toUpperCase()}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-slate-900">
          {a.teacherProfile.userProfile.lastName.toUpperCase()} {a.teacherProfile.userProfile.firstName}
        </div>
        <div className="text-xs text-slate-500">{a.teacherProfile.userProfile.email}</div>
      </div>
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold"
        style={{ background: `color-mix(in oklch, ${a.subject.color ?? 'oklch(0.6 0.15 250)'} 15%, white)`, color: `color-mix(in oklch, ${a.subject.color ?? 'oklch(0.6 0.15 250)'} 80%, black)` }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: a.subject.color ?? 'oklch(0.6 0.15 250)' }} />
        {a.subject.name}
      </span>
      {a.weeklyHours && (
        <span className="text-[11px] text-slate-500 font-mono">{Number(a.weeklyHours)}h/sem</span>
      )}
      <button
        type="button"
        onClick={onToggleMain}
        disabled={busy}
        title={a.isMainTeacher ? 'Retirer le rôle de professeur principal' : 'Désigner comme professeur principal'}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
          a.isMainTeacher
            ? 'bg-amber-100 text-amber-700'
            : 'border border-slate-200 text-slate-500 hover:bg-slate-50'
        }`}
      >
        {a.isMainTeacher ? <Crown className="h-3 w-3" /> : <Star className="h-3 w-3" />}
        PP
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        title="Supprimer cette affectation"
        className="grid h-7 w-7 place-items-center rounded-md text-red-500 hover:bg-red-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function NewAssignmentForm({
  teachers,
  classes,
  subjects,
  onCancel,
  onSuccess,
  onError,
}: {
  teachers: TeacherOption[];
  classes: ClassOption[];
  subjects: SubjectOption[];
  onCancel: () => void;
  onSuccess: () => void;
  onError: (e: string | null) => void;
}) {
  const [form, setForm] = useState({
    teacherProfileId: teachers[0]?.id ?? '',
    classSectionId: classes.find((c) => c.academicYear.status === 'active')?.id ?? '',
    subjectId: subjects[0]?.id ?? '',
    isMainTeacher: false,
    weeklyHours: '',
  });
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        onError(null);
        const res = await createAssignment({
          teacherProfileId: form.teacherProfileId,
          classSectionId: form.classSectionId,
          subjectId: form.subjectId,
          isMainTeacher: form.isMainTeacher,
          ...(form.weeklyHours ? { weeklyHours: parseFloat(form.weeklyHours) } : {}),
        });
        setBusy(false);
        if (!res.ok) onError(res.error);
        else onSuccess();
      }}
      className="rounded-2xl bg-white p-6 ring-1 ring-slate-200"
    >
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Nouvelle affectation</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-bold text-slate-700 lg:col-span-2">
          Professeur
          <select
            value={form.teacherProfileId}
            onChange={(e) => setForm((f) => ({ ...f, teacherProfileId: e.target.value }))}
            required
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            {teachers.length === 0 && <option value="">— Aucun professeur dans l'école —</option>}
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.userProfile.lastName.toUpperCase()} {t.userProfile.firstName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-700 lg:col-span-2">
          Classe (année active)
          <select
            value={form.classSectionId}
            onChange={(e) => setForm((f) => ({ ...f, classSectionId: e.target.value }))}
            required
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            {classes
              .filter((c) => c.academicYear.status === 'active' && c.status === 'active')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.gradeLevel.cycle.name} · {c.name} · {c.gradeLevel.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-700">
          Matière
          <select
            value={form.subjectId}
            onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value }))}
            required
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-700">
          Heures/sem (optionnel)
          <input
            type="number"
            step="0.5"
            min="0"
            max="40"
            value={form.weeklyHours}
            onChange={(e) => setForm((f) => ({ ...f, weeklyHours: e.target.value }))}
            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
      </div>
      <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.isMainTeacher}
          onChange={(e) => setForm((f) => ({ ...f, isMainTeacher: e.target.checked }))}
          className="h-4 w-4 rounded"
        />
        Professeur principal (PP) de la classe — un seul par classe
      </label>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy || !form.teacherProfileId || !form.classSectionId || !form.subjectId}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Créer
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
