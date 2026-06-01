'use client';

import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { updateClass, type ClassOptions } from './actions';

interface ClassInfoInitial {
  name: string;
  maxStudents: number;
  room: string | null;
  color: string | null;
  icon: string | null;
  options: Record<string, unknown> | null;
  internalNotes: string | null;
}

interface OptionRow {
  key: string;
  value: string;
}

/**
 * Éditeur des informations personnalisables d'une classe (salle, couleur,
 * icône, options pédagogiques, observations internes). S'ouvre en modale
 * depuis un déclencheur fourni par l'appelant et délègue à `updateClass`.
 */
export function ClassInfoEditor({
  id,
  initial,
  trigger,
}: {
  id: string;
  initial: ClassInfoInitial;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="appearance-none">
        {trigger}
      </button>
      {open && (
        <EditorDialog
          id={id}
          initial={initial}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function optionsToRows(options: Record<string, unknown> | null): OptionRow[] {
  if (!options || typeof options !== 'object') return [];
  return Object.entries(options).map(([key, value]) => ({
    key,
    value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
  }));
}

function EditorDialog({
  id,
  initial,
  onClose,
  onSaved,
}: {
  id: string;
  initial: ClassInfoInitial;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [room, setRoom] = useState(initial.room ?? '');
  const [color, setColor] = useState(initial.color ?? '');
  const [icon, setIcon] = useState(initial.icon ?? '');
  const [internalNotes, setInternalNotes] = useState(initial.internalNotes ?? '');
  const [rows, setRows] = useState<OptionRow[]>(optionsToRows(initial.options));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setRow = (i: number, patch: Partial<OptionRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { key: '', value: '' }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const onSubmit = async () => {
    setBusy(true);
    setError(null);

    // Construit l'objet options à partir des lignes clé/valeur non vides.
    // Aucune ligne → null (efface les options côté API).
    const cleaned = rows
      .map((r) => ({ key: r.key.trim(), value: r.value.trim() }))
      .filter((r) => r.key.length > 0);
    const options: ClassOptions | null =
      cleaned.length > 0
        ? Object.fromEntries(cleaned.map((r) => [r.key, r.value]))
        : null;

    const res = await updateClass(id, {
      // Chaîne vide → null (efface le champ).
      room: room.trim() || null,
      color: color.trim() || null,
      icon: icon.trim() || null,
      internalNotes: internalNotes.trim() || null,
      options,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Modifier les informations de la classe"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">
            Modifier les infos — {initial.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Salle" value={room} onChange={setRoom} placeholder="B204" />
            <Field label="Icône (emoji)" value={icon} onChange={setIcon} placeholder="🎓" />
            <div>
              <label className="text-xs font-bold text-slate-700">Couleur</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={isHexColor(color) ? color : '#2563eb'}
                  onChange={(e) => setColor(e.target.value)}
                  suppressHydrationWarning
                  className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                  aria-label="Sélecteur de couleur"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#2563eb"
                  suppressHydrationWarning
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                />
              </div>
            </div>
          </div>

          {/* Options pédagogiques (clé/valeur libres) */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700">Options pédagogiques</label>
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1 text-xs font-bold accent-text hover:underline"
              >
                <Plus className="h-3 w-3" /> Ajouter
              </button>
            </div>
            {rows.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">
                Aucune option. Ex : « LV2 » → « Espagnol », « Section » → « Européenne ».
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={r.key}
                      onChange={(e) => setRow(i, { key: e.target.value })}
                      placeholder="Clé (ex: LV2)"
                      suppressHydrationWarning
                      className="h-9 w-2/5 rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    />
                    <input
                      type="text"
                      value={r.value}
                      onChange={(e) => setRow(i, { value: e.target.value })}
                      placeholder="Valeur (ex: Espagnol)"
                      suppressHydrationWarning
                      className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      aria-label="Supprimer l'option"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Observations internes</label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={3}
              placeholder="Notes réservées à l'équipe administrative…"
              suppressHydrationWarning
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-slate-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

function isHexColor(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-bold text-slate-700">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        suppressHydrationWarning
        className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      />
    </div>
  );
}
