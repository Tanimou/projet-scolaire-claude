'use client';

import { BookMarked, Check, Loader2, Phone, RotateCcw, Save, TriangleAlert } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';

import {
  updateTeacherProfileAction,
  type SelfProfile,
  type UpdateProfilePatch,
} from './profile-actions';

const BIO_MAX = 600;

interface FormState {
  specialty: string;
  phone: string;
  bio: string;
}

function toForm(p: Pick<SelfProfile, 'specialty' | 'phone' | 'bio'>): FormState {
  return {
    specialty: p.specialty ?? '',
    phone: p.phone ?? '',
    bio: p.bio ?? '',
  };
}

/**
 * Self-service editor for the soft profile fields a teacher owns: discipline
 * (specialty), contact phone and a short presentation (bio). Name and email
 * stay administration-managed and are shown read-only in the hero above.
 */
export function TeacherProfileForm({
  initial,
  isTeacher,
}: {
  initial: Pick<SelfProfile, 'specialty' | 'phone' | 'bio'>;
  isTeacher: boolean;
}) {
  const [saved, setSaved] = useState<FormState>(() => toForm(initial));
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(
    () =>
      form.specialty !== saved.specialty ||
      form.phone !== saved.phone ||
      form.bio !== saved.bio,
    [form, saved],
  );

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setStatus('idle');
    setError(null);
  }

  function reset() {
    setForm(saved);
    setStatus('idle');
    setError(null);
  }

  function submit() {
    if (!dirty || pending) return;
    const patch: UpdateProfilePatch = {};
    if (form.specialty !== saved.specialty) patch.specialty = form.specialty;
    if (form.phone !== saved.phone) patch.phone = form.phone;
    if (form.bio !== saved.bio) patch.bio = form.bio;

    startTransition(async () => {
      const res = await updateTeacherProfileAction(patch);
      if (res.ok) {
        const next = toForm(res.data);
        setSaved(next);
        setForm(next);
        setStatus('success');
      } else {
        setStatus('error');
        setError(res.error ?? 'Une erreur est survenue');
      }
    });
  }

  const bioLeft = BIO_MAX - form.bio.length;

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">Mes informations</h2>
          <p className="mt-1 text-xs text-slate-500">
            Ces champs sont modifiables par vous. Votre nom et votre email sont gérés par
            l&apos;administration.
          </p>
        </div>
        <StatusBadge status={status} pending={pending} />
      </div>

      <div className="space-y-5 p-6">
        {isTeacher && (
          <Field
            id="specialty"
            icon={BookMarked}
            label="Discipline principale"
            hint="Votre matière ou spécialité d'enseignement"
          >
            <input
              id="specialty"
              type="text"
              value={form.specialty}
              maxLength={120}
              onChange={(e) => set('specialty', e.target.value)}
              placeholder="Ex. Mathématiques, Histoire-Géographie…"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-teacher-500 focus:ring-2 focus:ring-teacher-100"
            />
          </Field>
        )}

        <Field
          id="phone"
          icon={Phone}
          label="Téléphone"
          hint="Visible par l'administration pour vous joindre"
        >
          <input
            id="phone"
            type="tel"
            value={form.phone}
            maxLength={40}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="Ex. 06 12 34 56 78"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-teacher-500 focus:ring-2 focus:ring-teacher-100"
          />
        </Field>

        <Field
          id="bio"
          icon={BookMarked}
          label="Présentation"
          hint="Quelques mots sur votre parcours ou votre approche pédagogique"
        >
          <textarea
            id="bio"
            value={form.bio}
            maxLength={BIO_MAX}
            rows={4}
            onChange={(e) => set('bio', e.target.value)}
            placeholder="Ex. Professeure de mathématiques depuis 12 ans, j'aime rendre les sciences concrètes…"
            className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-teacher-500 focus:ring-2 focus:ring-teacher-100"
          />
          <p
            className={`mt-1 text-right text-[10px] font-semibold tabular-nums ${
              bioLeft < 40 ? 'text-amber-600' : 'text-slate-400'
            }`}
          >
            {bioLeft} caractères restants
          </p>
        </Field>

        {error && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
            <TriangleAlert className="h-3.5 w-3.5" />
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
        {dirty && (
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Annuler
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!dirty || pending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-teacher-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-teacher-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Enregistrer
        </button>
      </div>
    </section>
  );
}

function StatusBadge({
  status,
  pending,
}: {
  status: 'idle' | 'success' | 'error';
  pending: boolean;
}) {
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
        <Loader2 className="h-3 w-3 animate-spin" />
        Enregistrement…
      </span>
    );
  }
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">
        <Check className="h-3 w-3" />
        Enregistré
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200">
        <TriangleAlert className="h-3 w-3" />
        Erreur
      </span>
    );
  }
  return null;
}

function Field({
  id,
  icon: Icon,
  label,
  hint,
  children,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-xs font-bold text-slate-700"
      >
        <Icon className="h-3.5 w-3.5 text-teacher-600" />
        {label}
      </label>
      <p className="mb-1.5 mt-0.5 text-[11px] text-slate-400">{hint}</p>
      {children}
    </div>
  );
}
