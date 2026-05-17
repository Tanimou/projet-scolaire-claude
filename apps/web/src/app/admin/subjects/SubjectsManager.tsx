'use client';

import { BookOpen, Check, Loader2, Plus, Save, Sparkles, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { createSubject, deactivateSubject, saveCoefficients } from './actions';
import type { CoefficientMatrix, SubjectItem } from './page';

export function SubjectsManager({
  allSubjects,
  matrix,
}: {
  allSubjects: SubjectItem[];
  matrix: CoefficientMatrix;
}) {
  const [tab, setTab] = useState<'subjects' | 'coefficients'>('coefficients');

  return (
    <div className="space-y-6">
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        <TabButton active={tab === 'coefficients'} onClick={() => setTab('coefficients')}>
          Matrice des coefficients
        </TabButton>
        <TabButton active={tab === 'subjects'} onClick={() => setTab('subjects')}>
          Matières ({allSubjects.length})
        </TabButton>
      </div>

      {tab === 'subjects' ? (
        <SubjectsList items={allSubjects} />
      ) : (
        <CoefficientMatrixEditor matrix={matrix} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-4 py-2 text-sm font-bold transition ${
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

function SubjectsList({ items }: { items: SubjectItem[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(items.length === 0);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/30"
        >
          <Plus className="h-4 w-4" /> Ajouter une matière
        </button>
      )}
      {showForm && (
        <NewSubjectForm
          onCancel={() => setShowForm(false)}
          onError={setError}
          onSuccess={() => {
            setShowForm(false);
            router.refresh();
          }}
        />
      )}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((s) => (
          <div
            key={s.id}
            className={`relative overflow-hidden rounded-2xl bg-white p-5 ring-1 transition ${
              s.active ? 'ring-slate-200' : 'opacity-60 ring-slate-100'
            }`}
          >
            <div className="absolute inset-x-0 top-0 h-1" style={{ background: s.color ?? 'oklch(0.62 0.18 250)' }} />
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="grid h-10 w-10 place-items-center rounded-xl text-white shadow-sm"
                  style={{ background: s.color ?? 'oklch(0.62 0.18 250)' }}
                >
                  <BookOpen className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">{s.name}</div>
                  <div className="font-mono text-xs text-slate-500">{s.code}</div>
                </div>
              </div>
              {!s.active && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  Inactive
                </span>
              )}
            </div>
            <div className="mt-3 text-xs text-slate-600">
              Coefficient par défaut: <span className="font-mono font-bold text-slate-900">{s.defaultCoefficient}</span>
            </div>
            <div className="mt-3 flex justify-end">
              {s.active && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`Désactiver la matière « ${s.name} » ? Les coefficients historiques restent conservés.`)) return;
                    const res = await deactivateSubject(s.id);
                    if (!res.ok) setError(res.error);
                    else router.refresh();
                  }}
                  className="text-xs font-medium text-slate-600 hover:text-red-700"
                >
                  Désactiver
                </button>
              )}
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm text-slate-600">Aucune matière définie.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function NewSubjectForm({
  onCancel,
  onSuccess,
  onError,
}: {
  onCancel: () => void;
  onSuccess: () => void;
  onError: (e: string | null) => void;
}) {
  const [form, setForm] = useState({ code: '', name: '', defaultCoefficient: 2, color: 'oklch(0.65 0.18 250)' });
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        onError(null);
        setBusy(true);
        const res = await createSubject({
          code: form.code.toUpperCase().replace(/[^A-Z0-9_-]/g, '_'),
          name: form.name,
          defaultCoefficient: form.defaultCoefficient,
          color: form.color || undefined,
        });
        setBusy(false);
        if (!res.ok) onError(res.error);
        else onSuccess();
      }}
      className="rounded-2xl bg-white p-6 ring-1 ring-slate-200"
    >
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Nouvelle matière</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Field label="Nom" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} required placeholder="Espagnol" />
        <Field label="Code" value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v }))} required placeholder="ESP" />
        <Field
          label="Coefficient défaut"
          type="number"
          value={String(form.defaultCoefficient)}
          onChange={(v) => setForm((f) => ({ ...f, defaultCoefficient: Number(v) }))}
        />
        <Field label="Couleur (OKLCH)" value={form.color} onChange={(v) => setForm((f) => ({ ...f, color: v }))} />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        <Sparkles className="mr-1 inline h-3 w-3" />
        Un coefficient par défaut sera automatiquement ajouté pour tous les niveaux existants. Vous pourrez le
        surcharger niveau par niveau dans la matrice.
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow-md disabled:opacity-70"
        >
          {busy ? 'Création…' : 'Créer la matière'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
          Annuler
        </button>
      </div>
    </form>
  );
}

function CoefficientMatrixEditor({ matrix }: { matrix: CoefficientMatrix }) {
  const router = useRouter();
  // Map (gradeLevelId, subjectId) → coefficient
  const initialMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of matrix.coefficients) {
      m.set(`${c.gradeLevelId}:${c.subjectId}`, c.coefficient);
    }
    return m;
  }, [matrix.coefficients]);

  const [values, setValues] = useState<Map<string, number>>(new Map(initialMap));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setCoef = (gradeLevelId: string, subjectId: string, value: number) => {
    const key = `${gradeLevelId}:${subjectId}`;
    setValues((m) => new Map(m).set(key, value));
    setDirty((d) => new Set(d).add(key));
  };

  const onSave = async () => {
    setBusy(true);
    setError(null);
    const entries = Array.from(dirty).map((key) => {
      const [gradeLevelId, subjectId] = key.split(':');
      return { gradeLevelId: gradeLevelId!, subjectId: subjectId!, coefficient: values.get(key) ?? 1 };
    });
    const res = await saveCoefficients(entries);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setDirty(new Set());
      router.refresh();
    }
  };

  if (matrix.subjects.length === 0 || matrix.gradeLevels.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Configurez d&apos;abord vos matières et niveaux pour pouvoir gérer la matrice.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-600">
          Cliquez sur une cellule pour modifier le coefficient. Une valeur surchargée prime sur le coefficient par
          défaut de la matière. <span className="font-mono">{dirty.size}</span> modification(s) en attente.
        </p>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || dirty.size === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow-md disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Enregistrer
        </button>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>}

      <div className="overflow-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Matière</th>
              {matrix.gradeLevels.map((lvl) => (
                <th key={lvl.id} className="px-3 py-3 text-center font-semibold">
                  {lvl.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {matrix.subjects.map((subject) => (
              <tr key={subject.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: subject.color ?? 'oklch(0.62 0.18 250)' }}
                    />
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{subject.name}</div>
                      <div className="font-mono text-[10px] text-slate-500">
                        défaut {subject.defaultCoefficient}
                      </div>
                    </div>
                  </div>
                </td>
                {matrix.gradeLevels.map((lvl) => {
                  const key = `${lvl.id}:${subject.id}`;
                  const v = values.get(key) ?? subject.defaultCoefficient;
                  const isDirty = dirty.has(key);
                  const isOverride = v !== subject.defaultCoefficient;
                  return (
                    <td key={lvl.id} className="px-2 py-2 text-center">
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="20"
                        value={v}
                        onChange={(e) => setCoef(lvl.id, subject.id, Number(e.target.value))}
                        suppressHydrationWarning
                        className={`h-9 w-16 rounded-lg border-2 px-1 text-center font-mono text-sm font-bold tabular-nums focus-visible:outline-none focus-visible:ring-2 ${
                          isDirty
                            ? 'border-amber-400 bg-amber-50 text-amber-900 focus-visible:ring-amber-500/40'
                            : isOverride
                              ? 'border-blue-200 bg-blue-50 text-blue-900 focus-visible:ring-blue-500/40'
                              : 'border-slate-200 bg-white text-slate-900 focus-visible:ring-blue-500/40'
                        }`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-slate-600">
        <Legend className="border-slate-200 bg-white" label="Coefficient par défaut" />
        <Legend className="border-blue-200 bg-blue-50" label="Surcharge enregistrée" />
        <Legend className="border-amber-400 bg-amber-50" label="Modification non enregistrée" />
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-3 w-5 rounded border-2 ${className}`} />
      {label}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-bold text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        suppressHydrationWarning
        className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      />
    </div>
  );
}
