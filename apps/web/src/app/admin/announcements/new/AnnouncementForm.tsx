'use client';

import { Loader2, Save, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createAnnouncement } from '../actions';

type Scope = 'school_wide' | 'cycle_scope' | 'grade_level_scope' | 'class_section_scope';
type Priority = 'normal' | 'high' | 'urgent';

export function AnnouncementForm({
  cycles,
  classes,
}: {
  cycles: Array<{ id: string; name: string; gradeLevels: Array<{ id: string; name: string }> }>;
  classes: Array<{ id: string; name: string; gradeLevel: { name: string } }>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [scope, setScope] = useState<Scope>('school_wide');
  const [priority, setPriority] = useState<Priority>('normal');
  const [cycleId, setCycleId] = useState('');
  const [gradeLevelId, setGradeLevelId] = useState('');
  const [classSectionId, setClassSectionId] = useState('');
  const [pinned, setPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allLevels = cycles.flatMap((c) => c.gradeLevels.map((g) => ({ id: g.id, name: `${c.name} · ${g.name}` })));

  const submit = async (publishNow: boolean) => {
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      title: title.trim(),
      body,
      scope,
      priority,
      pinned,
      publishNow,
      ...(expiresAt ? { expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString() } : {}),
      ...(scope === 'cycle_scope' && cycleId ? { cycleId } : {}),
      ...(scope === 'grade_level_scope' && gradeLevelId ? { gradeLevelId } : {}),
      ...(scope === 'class_section_scope' && classSectionId ? { classSectionId } : {}),
    };
    const res = await createAnnouncement(payload);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else router.push('/admin/announcements');
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      className="space-y-5"
    >
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-900">{error}</div>
      )}

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Contenu</h3>
        <div className="mt-4 space-y-3">
          <Field label="Titre *">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              placeholder="Ex : Réunion parents-profs du 15 juin"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Message *">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              rows={6}
              placeholder="Détaillez l'événement, le lieu, l'heure…"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Portée & priorité</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Portée *">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="school_wide">Toute l’école</option>
              <option value="cycle_scope">Un cycle</option>
              <option value="grade_level_scope">Un niveau</option>
              <option value="class_section_scope">Une classe</option>
            </select>
          </Field>
          <Field label="Priorité">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="normal">Normale</option>
              <option value="high">Importante</option>
              <option value="urgent">Urgente</option>
            </select>
          </Field>
          {scope === 'cycle_scope' && (
            <Field label="Cycle *">
              <select
                value={cycleId}
                onChange={(e) => setCycleId(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">— Choisir —</option>
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          )}
          {scope === 'grade_level_scope' && (
            <Field label="Niveau *">
              <select
                value={gradeLevelId}
                onChange={(e) => setGradeLevelId(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">— Choisir —</option>
                {allLevels.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </Field>
          )}
          {scope === 'class_section_scope' && (
            <Field label="Classe *">
              <select
                value={classSectionId}
                onChange={(e) => setClassSectionId(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">— Choisir —</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.gradeLevel.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Expire le (optionnel)">
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 mt-7">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            Épingler en haut
          </label>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={busy || !title.trim() || !body.trim()}
          onClick={() => submit(false)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Enregistrer en brouillon
        </button>
        <button
          type="button"
          disabled={busy || !title.trim() || !body.trim()}
          onClick={() => submit(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-blue-500/30 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Publier maintenant
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">{label}</span>
      {children}
    </label>
  );
}
