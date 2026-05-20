'use client';

import { Calendar, CheckCircle2, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  createAcademicYear,
  createTerm,
  deleteAcademicYear,
  deleteTerm,
  updateAcademicYear,
} from './actions';
import type { AcademicYearItem } from './page';

const STATUS_LABEL: Record<string, { label: string; class: string }> = {
  active: { label: 'Active', class: 'bg-emerald-100 text-emerald-700' },
  closed: { label: 'Clôturée', class: 'bg-slate-100 text-slate-700' },
  archived: { label: 'Archivée', class: 'bg-amber-100 text-amber-800' },
};

export function AcademicYearsManager({ initial }: { initial: AcademicYearItem[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(initial.length === 0);
  const [error, setError] = useState<string | null>(null);

  const onCreated = () => {
    setShowForm(false);
    setError(null);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/30"
        >
          <Plus className="h-4 w-4" />
          Créer une année scolaire
        </button>
      )}

      {showForm && (
        <NewYearForm
          onCancel={() => setShowForm(false)}
          onSuccess={onCreated}
          onError={setError}
        />
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
      )}

      <div className="space-y-3">
        {initial.map((year) => (
          <YearCard key={year.id} year={year} />
        ))}
        {initial.length === 0 && !showForm && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <Calendar className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm text-slate-600">Aucune année scolaire pour le moment.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function YearCard({ year }: { year: AcademicYearItem }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(year.status === 'active');
  const [editing, setEditing] = useState(false);
  const [addingTerm, setAddingTerm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusInfo = STATUS_LABEL[year.status] ?? STATUS_LABEL.closed;

  const onMakeActive = async () => {
    setError(null);
    const res = await updateAcademicYear(year.id, { status: 'active' });
    if (!res.ok) setError(res.error);
    else router.refresh();
  };

  const onArchive = async () => {
    if (!confirm(`Archiver « ${year.name} » ? Les classes existantes deviennent non-modifiables.`)) return;
    setError(null);
    const res = await updateAcademicYear(year.id, { status: 'archived' });
    if (!res.ok) setError(res.error);
    else router.refresh();
  };

  const onDelete = async () => {
    if (!confirm(`Supprimer définitivement « ${year.name} » ? Cette action ne peut être annulée.`)) return;
    setError(null);
    const res = await deleteAcademicYear(year.id);
    if (!res.ok) setError(res.error);
    else router.refresh();
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="flex items-center gap-4">
          <div className={`grid h-10 w-10 place-items-center rounded-xl ${statusInfo!.class}`}>
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-slate-900">{year.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusInfo!.class}`}>
                {statusInfo!.label}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              Du {formatDate(year.startDate)} au {formatDate(year.endDate)} · {year._count.terms} trimestre(s) ·{' '}
              {year._count.classSections} classe(s)
            </div>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-6 py-5">
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-900">
              {error}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {year.status !== 'active' && (
              <button
                type="button"
                onClick={onMakeActive}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Définir comme active
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {editing ? 'Annuler' : 'Modifier les dates'}
            </button>
            {year.status !== 'archived' && (
              <button
                type="button"
                onClick={onArchive}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Archiver
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-3 w-3" /> Supprimer
            </button>
          </div>

          {editing && (
            <EditDatesForm
              year={year}
              onCancel={() => setEditing(false)}
              onSuccess={() => {
                setEditing(false);
                router.refresh();
              }}
              onError={setError}
            />
          )}

          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900">Trimestres / périodes</h4>
              {!addingTerm && (
                <button
                  type="button"
                  onClick={() => setAddingTerm(true)}
                  className="inline-flex items-center gap-1 text-xs font-bold accent-text hover:underline"
                >
                  <Plus className="h-3 w-3" /> Ajouter
                </button>
              )}
            </div>
            <div className="space-y-2">
              {year.terms.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-100 font-mono text-xs font-bold text-blue-700">
                      {t.orderIndex}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{t.name}</div>
                      <div className="text-xs text-slate-500">
                        Du {formatDate(t.startDate)} au {formatDate(t.endDate)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Supprimer le trimestre « ${t.name} » ?`)) return;
                      const res = await deleteTerm(t.id);
                      if (!res.ok) setError(res.error);
                      else router.refresh();
                    }}
                    className="text-xs font-medium text-red-700 hover:underline"
                  >
                    Supprimer
                  </button>
                </div>
              ))}
              {year.terms.length === 0 && !addingTerm && (
                <p className="text-xs italic text-slate-500">Aucun trimestre encore défini.</p>
              )}
              {addingTerm && (
                <NewTermForm
                  yearId={year.id}
                  nextOrderIndex={(year.terms.at(-1)?.orderIndex ?? 0) + 1}
                  onCancel={() => setAddingTerm(false)}
                  onSuccess={() => {
                    setAddingTerm(false);
                    router.refresh();
                  }}
                  onError={setError}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NewYearForm({
  onCancel,
  onSuccess,
  onError,
}: {
  onCancel: () => void;
  onSuccess: () => void;
  onError: (e: string | null) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [form, setForm] = useState({
    name: `${currentYear}-${currentYear + 1}`,
    startDate: `${currentYear}-09-01`,
    endDate: `${currentYear + 1}-07-05`,
    status: 'active' as 'active' | 'closed' | 'archived',
  });
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        onError(null);
        setBusy(true);
        const res = await createAcademicYear(form);
        setBusy(false);
        if (!res.ok) onError(res.error);
        else onSuccess();
      }}
      className="rounded-2xl bg-white p-6 ring-1 ring-slate-200"
    >
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Nouvelle année scolaire</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field id="name" label="Nom" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} required />
        <Field
          id="startDate"
          label="Date de début"
          type="date"
          value={form.startDate}
          onChange={(v) => setForm((f) => ({ ...f, startDate: v }))}
          required
        />
        <Field
          id="endDate"
          label="Date de fin"
          type="date"
          value={form.endDate}
          onChange={(v) => setForm((f) => ({ ...f, endDate: v }))}
          required
        />
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.status === 'active'}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.checked ? 'active' : 'closed' }))}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
        Définir comme année active (clôture la précédente automatiquement)
      </label>
      <div className="mt-5 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow-md disabled:opacity-70"
        >
          {busy ? 'Création…' : "Créer l'année"}
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

function EditDatesForm({
  year,
  onCancel,
  onSuccess,
  onError,
}: {
  year: AcademicYearItem;
  onCancel: () => void;
  onSuccess: () => void;
  onError: (e: string | null) => void;
}) {
  const [form, setForm] = useState({
    name: year.name,
    startDate: year.startDate.slice(0, 10),
    endDate: year.endDate.slice(0, 10),
  });
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        onError(null);
        setBusy(true);
        const res = await updateAcademicYear(year.id, form);
        setBusy(false);
        if (!res.ok) onError(res.error);
        else onSuccess();
      }}
      className="mt-4 grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 sm:grid-cols-3"
    >
      <Field id={`${year.id}-name`} label="Nom" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
      <Field
        id={`${year.id}-start`}
        label="Début"
        type="date"
        value={form.startDate}
        onChange={(v) => setForm((f) => ({ ...f, startDate: v }))}
      />
      <Field
        id={`${year.id}-end`}
        label="Fin"
        type="date"
        value={form.endDate}
        onChange={(v) => setForm((f) => ({ ...f, endDate: v }))}
      />
      <div className="sm:col-span-3 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-70"
        >
          {busy ? 'Enregistrement…' : 'Enregistrer'}
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

function NewTermForm({
  yearId,
  nextOrderIndex,
  onCancel,
  onSuccess,
  onError,
}: {
  yearId: string;
  nextOrderIndex: number;
  onCancel: () => void;
  onSuccess: () => void;
  onError: (e: string | null) => void;
}) {
  const [form, setForm] = useState({
    name: `Trimestre ${nextOrderIndex}`,
    orderIndex: nextOrderIndex,
    startDate: '',
    endDate: '',
  });
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        onError(null);
        setBusy(true);
        const res = await createTerm(yearId, form);
        setBusy(false);
        if (!res.ok) onError(res.error);
        else onSuccess();
      }}
      className="grid gap-3 rounded-xl border border-blue-200 bg-blue-50/30 p-4 sm:grid-cols-4"
    >
      <Field
        id="termName"
        label="Nom"
        value={form.name}
        onChange={(v) => setForm((f) => ({ ...f, name: v }))}
        required
      />
      <Field
        id="termOrder"
        label="Ordre"
        type="number"
        value={String(form.orderIndex)}
        onChange={(v) => setForm((f) => ({ ...f, orderIndex: Number(v) }))}
        required
      />
      <Field
        id="termStart"
        label="Début"
        type="date"
        value={form.startDate}
        onChange={(v) => setForm((f) => ({ ...f, startDate: v }))}
        required
      />
      <Field
        id="termEnd"
        label="Fin"
        type="date"
        value={form.endDate}
        onChange={(v) => setForm((f) => ({ ...f, endDate: v }))}
        required
      />
      <div className="sm:col-span-4 flex gap-2">
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
  id,
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-bold text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        suppressHydrationWarning
        className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      />
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}
