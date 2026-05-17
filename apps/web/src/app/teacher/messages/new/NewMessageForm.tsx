'use client';

import { AlertTriangle, Loader2, Megaphone, Pin, Save, Send, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { createTeacherAnnouncement } from '../actions';

type Scope = 'class_section_scope' | 'grade_level_scope' | 'cycle_scope';
type Priority = 'normal' | 'high' | 'urgent';

export interface TeachableClass {
  id: string;
  name: string;
  gradeLevelName: string;
  cycleName: string;
  cycleColor: string | null;
}

interface TeachableLevel {
  id: string;
  name: string;
  cycleName: string;
}

interface TeachableCycle {
  id: string;
  name: string;
  color: string | null;
}

const PRIORITY_META: Record<Priority, { label: string; chip: string; description: string }> = {
  normal: {
    label: 'Normale',
    chip: 'bg-slate-100 text-slate-700',
    description: 'Affichage standard dans le flux de notifications.',
  },
  high: {
    label: 'Importante',
    chip: 'bg-amber-100 text-amber-800',
    description: 'Mise en avant ambre dans la liste des annonces côté parent.',
  },
  urgent: {
    label: 'Urgente',
    chip: 'bg-rose-100 text-rose-800',
    description: 'Surligné en rouge avec un appel à l’attention visuel.',
  },
};

const SCOPE_META: Record<Scope, { label: string; help: string }> = {
  class_section_scope: {
    label: 'Une classe',
    help: 'Les parents des élèves inscrits à cette classe recevront le message.',
  },
  grade_level_scope: {
    label: 'Un niveau',
    help: 'Tous les parents du niveau (toutes classes confondues) seront destinataires.',
  },
  cycle_scope: {
    label: 'Un cycle',
    help: 'Diffusion la plus large : toutes les familles du cycle (Primaire / Collège / Lycée).',
  },
};

export function NewMessageForm({
  classes,
  levels,
  cycles,
}: {
  classes: TeachableClass[];
  levels: TeachableLevel[];
  cycles: TeachableCycle[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [scope, setScope] = useState<Scope>('class_section_scope');
  const [priority, setPriority] = useState<Priority>('normal');
  const [classSectionId, setClassSectionId] = useState(classes[0]?.id ?? '');
  const [gradeLevelId, setGradeLevelId] = useState(levels[0]?.id ?? '');
  const [cycleId, setCycleId] = useState(cycles[0]?.id ?? '');
  const [pinned, setPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetSummary = useMemo(() => {
    if (scope === 'class_section_scope') {
      const c = classes.find((c) => c.id === classSectionId);
      if (!c) return null;
      return `${c.name} · ${c.gradeLevelName} · ${c.cycleName}`;
    }
    if (scope === 'grade_level_scope') {
      const l = levels.find((l) => l.id === gradeLevelId);
      if (!l) return null;
      return `${l.name} · ${l.cycleName}`;
    }
    const cy = cycles.find((c) => c.id === cycleId);
    if (!cy) return null;
    return cy.name;
  }, [scope, classSectionId, gradeLevelId, cycleId, classes, levels, cycles]);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !!targetSummary;

  const submit = async (publishNow: boolean) => {
    if (!canSubmit) return;
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
      ...(scope === 'class_section_scope' && classSectionId ? { classSectionId } : {}),
      ...(scope === 'grade_level_scope' && gradeLevelId ? { gradeLevelId } : {}),
      ...(scope === 'cycle_scope' && cycleId ? { cycleId } : {}),
    };
    const res = await createTeacherAnnouncement(payload);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push('/teacher/messages');
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
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold">Impossible d&apos;enregistrer ce message</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Contenu</h3>
        <div className="mt-4 space-y-4">
          <Field label="Titre" required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              placeholder="Ex : Sortie pédagogique au musée le 15 mai"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
            />
            <p className="mt-1 text-xs text-slate-400">{title.length}/200</p>
          </Field>
          <Field label="Message" required>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              rows={7}
              maxLength={10000}
              placeholder="Détaillez l'évènement, le lieu, l'heure, ce que les élèves doivent prévoir…"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm leading-relaxed focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
            />
            <p className="mt-1 text-xs text-slate-400">
              Markdown léger pris en charge côté famille (sauts de ligne préservés). {body.length}{' '}
              caractère{body.length > 1 ? 's' : ''}.
            </p>
          </Field>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Destinataires & priorité
        </h3>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Portée" required>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
            >
              <option value="class_section_scope" disabled={classes.length === 0}>
                {SCOPE_META.class_section_scope.label}
              </option>
              <option value="grade_level_scope" disabled={levels.length === 0}>
                {SCOPE_META.grade_level_scope.label}
              </option>
              <option value="cycle_scope" disabled={cycles.length === 0}>
                {SCOPE_META.cycle_scope.label}
              </option>
            </select>
            <p className="mt-1 text-xs text-slate-500">{SCOPE_META[scope].help}</p>
          </Field>

          <Field label="Priorité">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
            >
              <option value="normal">Normale</option>
              <option value="high">Importante</option>
              <option value="urgent">Urgente</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">{PRIORITY_META[priority].description}</p>
          </Field>

          {scope === 'class_section_scope' && (
            <Field label="Classe" required className="sm:col-span-2">
              <select
                value={classSectionId}
                onChange={(e) => setClassSectionId(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.gradeLevelName} · {c.cycleName}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {scope === 'grade_level_scope' && (
            <Field label="Niveau" required className="sm:col-span-2">
              <select
                value={gradeLevelId}
                onChange={(e) => setGradeLevelId(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
              >
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.cycleName}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {scope === 'cycle_scope' && (
            <Field label="Cycle" required className="sm:col-span-2">
              <select
                value={cycleId}
                onChange={(e) => setCycleId(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
              >
                {cycles.map((cy) => (
                  <option key={cy.id} value={cy.id}>
                    {cy.name}
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
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
            />
            <p className="mt-1 text-xs text-slate-500">
              Au-delà de cette date, le message n&apos;apparaîtra plus dans le portail famille.
            </p>
          </Field>

          <Field label="Épingler" className="self-start">
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-amber-300 hover:bg-amber-50/40">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
                className="h-4 w-4 rounded text-amber-500 focus:ring-amber-300"
              />
              <Pin className="h-4 w-4 text-amber-500" />
              Afficher en tête de liste
            </label>
          </Field>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 p-5 text-white shadow-lg shadow-indigo-500/30">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 backdrop-blur">
            {scope === 'class_section_scope' ? (
              <Users className="h-5 w-5" />
            ) : (
              <Megaphone className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/80">
              Aperçu de la diffusion
            </p>
            <p className="mt-1 text-lg font-bold leading-tight">
              {title.trim() || 'Titre du message'}
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-white/85">
              {body.trim() || 'Le corps de votre message apparaîtra ici…'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 font-bold text-white">
                {targetSummary ?? 'Audience non sélectionnée'}
              </span>
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 font-bold ${PRIORITY_META[priority].chip}`}>
                {PRIORITY_META[priority].label}
              </span>
              {pinned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-bold text-amber-900">
                  <Pin className="h-3 w-3" /> Épinglé
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          disabled={busy || !canSubmit}
          onClick={() => submit(false)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Enregistrer en brouillon
        </button>
        <button
          type="button"
          disabled={busy || !canSubmit}
          onClick={() => submit(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 transition hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Publier maintenant
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
  className = '',
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </span>
      {children}
    </label>
  );
}
