'use client';

import { Layers, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createCycle, createGradeLevel, deleteCycle, deleteGradeLevel } from './actions';
import type { CycleItem, GradeLevelItem } from './types';

export function CyclesManager({ initial }: { initial: CycleItem[] }) {
  const router = useRouter();
  const [showCycleForm, setShowCycleForm] = useState(initial.length === 0);
  const [addingLevelToCycle, setAddingLevelToCycle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {!showCycleForm && (
        <button
          type="button"
          onClick={() => setShowCycleForm(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/30"
        >
          <Plus className="h-4 w-4" /> Créer un cycle
        </button>
      )}

      {showCycleForm && (
        <NewCycleForm
          orderIndex={initial.length + 1}
          onCancel={() => setShowCycleForm(false)}
          onError={setError}
          onSuccess={() => {
            setShowCycleForm(false);
            router.refresh();
          }}
        />
      )}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>}

      {initial.length === 0 && !showCycleForm && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <Layers className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm text-slate-600">Aucun cycle pour le moment.</p>
        </div>
      )}

      <div className="space-y-4">
        {initial.map((cycle) => (
          <div key={cycle.id} className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-4 px-6 py-4">
              <div className="flex items-center gap-4">
                <div
                  className="grid h-12 w-12 place-items-center rounded-xl text-white shadow-md"
                  style={{ background: cycle.color ?? 'oklch(0.62 0.18 250)' }}
                >
                  <Layers className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-base font-bold text-slate-900">{cycle.name}</div>
                  <div className="font-mono text-xs text-slate-500">
                    {cycle.code} · {cycle._count.gradeLevels} niveau(x) · ordre {cycle.orderIndex}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`Supprimer le cycle « ${cycle.name} » ?`)) return;
                  const res = await deleteCycle(cycle.id);
                  if (!res.ok) setError(res.error);
                  else router.refresh();
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-3 w-3" /> Supprimer le cycle
              </button>
            </div>

            <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-900">Niveaux</h4>
                {addingLevelToCycle !== cycle.id && (
                  <button
                    type="button"
                    onClick={() => setAddingLevelToCycle(cycle.id)}
                    className="inline-flex items-center gap-1 text-xs font-bold accent-text hover:underline"
                  >
                    <Plus className="h-3 w-3" /> Ajouter un niveau
                  </button>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {cycle.gradeLevels.map((level: GradeLevelItem) => (
                  <div
                    key={level.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{level.name}</div>
                      <div className="font-mono text-[10px] text-slate-500">
                        {level.code} · ordre {level.orderIndex}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm(`Supprimer le niveau « ${level.name} » ?`)) return;
                        const res = await deleteGradeLevel(level.id);
                        if (!res.ok) setError(res.error);
                        else router.refresh();
                      }}
                      className="text-xs text-red-700 hover:underline"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {cycle.gradeLevels.length === 0 && addingLevelToCycle !== cycle.id && (
                  <p className="col-span-full text-xs italic text-slate-500">Aucun niveau dans ce cycle.</p>
                )}
              </div>

              {addingLevelToCycle === cycle.id && (
                <NewGradeLevelForm
                  cycleId={cycle.id}
                  nextOrderIndex={(cycle.gradeLevels.at(-1)?.orderIndex ?? cycle.orderIndex * 10) + 1}
                  onCancel={() => setAddingLevelToCycle(null)}
                  onError={setError}
                  onSuccess={() => {
                    setAddingLevelToCycle(null);
                    router.refresh();
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewCycleForm({
  orderIndex,
  onCancel,
  onSuccess,
  onError,
}: {
  orderIndex: number;
  onCancel: () => void;
  onSuccess: () => void;
  onError: (e: string | null) => void;
}) {
  const [form, setForm] = useState({ code: '', name: '', orderIndex, color: 'oklch(0.62 0.18 250)' });
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        onError(null);
        setBusy(true);
        const res = await createCycle({
          code: form.code.toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
          name: form.name,
          orderIndex: form.orderIndex,
          color: form.color || undefined,
        });
        setBusy(false);
        if (!res.ok) onError(res.error);
        else onSuccess();
      }}
      className="rounded-2xl bg-white p-6 ring-1 ring-slate-200"
    >
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Nouveau cycle</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Field label="Nom" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} required placeholder="Collège" />
        <Field
          label="Code"
          value={form.code}
          onChange={(v) => setForm((f) => ({ ...f, code: v }))}
          required
          placeholder="college"
        />
        <Field
          label="Ordre"
          type="number"
          value={String(form.orderIndex)}
          onChange={(v) => setForm((f) => ({ ...f, orderIndex: Number(v) }))}
        />
        <Field label="Couleur (OKLCH)" value={form.color} onChange={(v) => setForm((f) => ({ ...f, color: v }))} />
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow-md disabled:opacity-70"
        >
          {busy ? 'Création…' : 'Créer le cycle'}
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

function NewGradeLevelForm({
  cycleId,
  nextOrderIndex,
  onCancel,
  onSuccess,
  onError,
}: {
  cycleId: string;
  nextOrderIndex: number;
  onCancel: () => void;
  onSuccess: () => void;
  onError: (e: string | null) => void;
}) {
  const [form, setForm] = useState({ code: '', name: '', orderIndex: nextOrderIndex });
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        onError(null);
        setBusy(true);
        const res = await createGradeLevel(cycleId, {
          code: form.code.toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
          name: form.name,
          orderIndex: form.orderIndex,
        });
        setBusy(false);
        if (!res.ok) onError(res.error);
        else onSuccess();
      }}
      className="mt-3 grid gap-3 rounded-xl border border-blue-200 bg-blue-50/30 p-4 sm:grid-cols-4"
    >
      <Field label="Nom" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} required placeholder="6ème" />
      <Field
        label="Code"
        value={form.code}
        onChange={(v) => setForm((f) => ({ ...f, code: v }))}
        required
        placeholder="6e"
      />
      <Field
        label="Ordre"
        type="number"
        value={String(form.orderIndex)}
        onChange={(v) => setForm((f) => ({ ...f, orderIndex: Number(v) }))}
      />
      <div className="flex items-end gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-70"
        >
          {busy ? 'Création…' : 'Ajouter'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          Annuler
        </button>
      </div>
    </form>
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
