'use client';

import { Check, GraduationCap, Loader2, Lock, Send, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { inviteUserAction } from './actions';

type RealmRole = 'school_admin' | 'teacher' | 'parent';

interface CustomRole {
  id: string;
  slug: string;
  name: string;
  portal: 'admin' | 'teacher' | 'parent' | null;
}

const REALM_ROLE_OPTIONS: {
  value: RealmRole;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
  gradient: string;
  mfaRequired: boolean;
}[] = [
  {
    value: 'school_admin',
    label: 'Administrateur',
    description: "Accès complet à l'établissement et configuration.",
    Icon: Lock,
    gradient: 'from-indigo-500 via-blue-600 to-blue-700',
    mfaRequired: true,
  },
  {
    value: 'teacher',
    label: 'Professeur',
    description: 'Planifie évaluations, saisit notes et présences.',
    Icon: GraduationCap,
    gradient: 'from-teal-400 via-teal-500 to-emerald-600',
    mfaRequired: true,
  },
  {
    value: 'parent',
    label: 'Parent',
    description: "Consulte l'évolution scolaire de son enfant.",
    Icon: Users,
    gradient: 'from-sky-400 via-blue-500 to-indigo-600',
    mfaRequired: false,
  },
];

export function InviteForm({ customRoles }: { customRoles: CustomRole[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    realmRole: 'teacher' as RealmRole,
    customRoleSlug: '',
  });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sentEmail, setSentEmail] = useState<string | null>(null);

  const customRolesForPortal = customRoles.filter(
    (r) =>
      r.portal === (form.realmRole === 'school_admin' ? 'admin' : form.realmRole) ||
      r.portal === null,
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    const res = await inviteUserAction({
      email: form.email.trim().toLowerCase(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      realmRole: form.realmRole,
      customRoleSlug: form.customRoleSlug || undefined,
    });
    if (res.ok) {
      setStatus('sent');
      setSentEmail(res.email);
      setTimeout(() => {
        router.push('/admin/users');
        router.refresh();
      }, 2500);
    } else {
      setStatus('error');
      setError(res.error);
    }
  };

  if (status === 'sent') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <Check className="h-7 w-7" strokeWidth={3} />
        </div>
        <h2 className="mt-4 text-lg font-bold text-emerald-900">Invitation envoyée !</h2>
        <p className="mt-2 text-sm text-emerald-800">
          Un email a été envoyé à <span className="font-mono font-semibold">{sentEmail}</span> avec le lien de
          configuration du compte. Vous pouvez le suivre via Maildev (http://localhost:1080).
        </p>
        <p className="mt-3 text-xs text-emerald-700">Redirection vers la liste des utilisateurs…</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-3">
      {/* LEFT — identity */}
      <div className="space-y-6 lg:col-span-2">
        <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Identité</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Prénom"
              id="firstName"
              value={form.firstName}
              onChange={(v) => setForm((f) => ({ ...f, firstName: v }))}
              autoComplete="given-name"
              required
            />
            <Field
              label="Nom"
              id="lastName"
              value={form.lastName}
              onChange={(v) => setForm((f) => ({ ...f, lastName: v }))}
              autoComplete="family-name"
              required
            />
          </div>
          <div className="mt-4">
            <Field
              label="Email professionnel"
              id="email"
              type="email"
              value={form.email}
              onChange={(v) => setForm((f) => ({ ...f, email: v }))}
              autoComplete="email"
              required
              help="L'utilisateur recevra un lien sécurisé à cette adresse."
            />
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Rôle principal</h3>
          <p className="mt-1 text-xs text-slate-500">
            Détermine le portail de connexion et les permissions de base de l&apos;utilisateur.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {REALM_ROLE_OPTIONS.map((r) => {
              const checked = form.realmRole === r.value;
              return (
                <label
                  key={r.value}
                  className={`relative flex cursor-pointer flex-col rounded-2xl border-2 p-4 transition ${
                    checked ? 'border-blue-500 bg-blue-50/50' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="realmRole"
                    value={r.value}
                    checked={checked}
                    onChange={() => setForm((f) => ({ ...f, realmRole: r.value, customRoleSlug: '' }))}
                    className="sr-only"
                  />
                  <div className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${r.gradient} text-white shadow-md`}>
                    <r.Icon className="h-5 w-5" />
                  </div>
                  <div className="mt-3 text-sm font-bold text-slate-900">{r.label}</div>
                  <div className="mt-1 text-xs text-slate-600">{r.description}</div>
                  {r.mfaRequired && (
                    <div className="mt-2 inline-flex items-center gap-1 self-start rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                      MFA requis
                    </div>
                  )}
                  {checked && (
                    <div className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-blue-600 text-white">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </div>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {customRolesForPortal.length > 0 && (
          <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
              Rôle métier supplémentaire (optionnel)
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Ajoute des permissions custom au-delà du rôle principal (ex. « comptable »).
            </p>
            <div className="mt-4 space-y-2">
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${
                  form.customRoleSlug === '' ? 'border-blue-300 bg-blue-50/30' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="customRoleSlug"
                  value=""
                  checked={form.customRoleSlug === ''}
                  onChange={() => setForm((f) => ({ ...f, customRoleSlug: '' }))}
                />
                <span className="text-sm text-slate-700">Aucun</span>
              </label>
              {customRolesForPortal.map((r) => (
                <label
                  key={r.id}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 transition ${
                    form.customRoleSlug === r.slug ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="customRoleSlug"
                      value={r.slug}
                      checked={form.customRoleSlug === r.slug}
                      onChange={() => setForm((f) => ({ ...f, customRoleSlug: r.slug }))}
                    />
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{r.name}</div>
                      <div className="font-mono text-xs text-slate-500">{r.slug}</div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT — preview + actions */}
      <aside className="space-y-4">
        <div className="rounded-2xl bg-slate-900 p-6 text-white">
          <h3 className="text-xs font-bold uppercase tracking-wider text-blue-200">Ce qui va se passer</h3>
          <ol className="mt-4 space-y-3 text-sm text-slate-200">
            <Step n="1">Création du compte dans Keycloak.</Step>
            <Step n="2">Email envoyé à {form.email || 'l\'utilisateur'} avec un lien sécurisé.</Step>
            <Step n="3">Sur clic du lien : il définit son mot de passe.</Step>
            {(form.realmRole === 'school_admin' || form.realmRole === 'teacher') && (
              <Step n="4">Configuration TOTP obligatoire (Google Authenticator, etc.).</Step>
            )}
            <Step n={form.realmRole === 'parent' ? '4' : '5'}>Redirection vers son portail.</Step>
          </ol>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={status === 'sending'}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-6 text-sm font-bold text-white shadow-lg shadow-blue-500/30 transition hover:shadow-xl disabled:opacity-70"
        >
          {status === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {status === 'sending' ? 'Envoi en cours…' : 'Envoyer l\'invitation'}
        </button>
        <p className="text-center text-xs text-slate-500">
          Les emails de dev sont catchés par Maildev → <a href="http://localhost:1080" target="_blank" rel="noreferrer" className="font-bold text-blue-700 hover:underline">localhost:1080</a>
        </p>
      </aside>
    </form>
  );
}

function Step({ n, children }: { n: string | number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-200">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  help,
  required,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  help?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-slate-900">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        suppressHydrationWarning
        className="mt-1.5 block h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      />
      {help && <p className="mt-1.5 text-xs text-slate-500">{help}</p>}
    </div>
  );
}
