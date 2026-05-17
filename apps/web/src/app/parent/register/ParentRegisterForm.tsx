'use client';

import { ArrowRight, Check, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useMemo, useState } from 'react';

import { registerParentAction } from './actions';

export function ParentRegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    passwordConfirm: '',
    acceptTerms: false,
    acceptPrivacy: false,
    marketingOptIn: false,
  });
  const [status, setStatus] = useState<'idle' | 'submitting' | 'logging-in' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const passwordChecks = useMemo(() => {
    const p = form.password;
    return {
      length: p.length >= 12,
      upper: /[A-Z]/.test(p),
      lower: /[a-z]/.test(p),
      digit: /\d/.test(p),
      special: /[^A-Za-z0-9]/.test(p),
      match: p.length > 0 && p === form.passwordConfirm,
    };
  }, [form.password, form.passwordConfirm]);

  const passwordValid =
    passwordChecks.length &&
    passwordChecks.upper &&
    passwordChecks.lower &&
    passwordChecks.digit &&
    passwordChecks.special &&
    passwordChecks.match;

  const canSubmit =
    form.firstName.trim().length >= 1 &&
    form.lastName.trim().length >= 1 &&
    form.email.includes('@') &&
    passwordValid &&
    form.acceptTerms &&
    form.acceptPrivacy &&
    status === 'idle';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setStatus('submitting');

    const res = await registerParentAction({
      email: form.email.trim().toLowerCase(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim() || undefined,
      password: form.password,
      acceptTerms: form.acceptTerms,
      acceptPrivacy: form.acceptPrivacy,
      marketingOptIn: form.marketingOptIn,
    });
    if (!res.ok) {
      setError(res.error);
      setStatus('error');
      return;
    }

    // Auto-login via credentials
    setStatus('logging-in');
    const login = await signIn('credentials', {
      email: res.email,
      password: form.password,
      portal: 'parent',
      redirect: false,
    });
    if (login?.error) {
      setError(`Compte créé, mais connexion automatique impossible : ${login.error}. Connectez-vous manuellement.`);
      setStatus('error');
      return;
    }
    router.push('/parent/dashboard');
    router.refresh();
  };

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field
          id="firstName"
          label="Prénom"
          value={form.firstName}
          onChange={(v) => setForm((f) => ({ ...f, firstName: v }))}
          autoComplete="given-name"
          required
        />
        <Field
          id="lastName"
          label="Nom"
          value={form.lastName}
          onChange={(v) => setForm((f) => ({ ...f, lastName: v }))}
          autoComplete="family-name"
          required
        />
      </div>

      <Field
        id="email"
        label="Email"
        type="email"
        value={form.email}
        onChange={(v) => setForm((f) => ({ ...f, email: v }))}
        autoComplete="email"
        placeholder="vous@exemple.com"
        required
      />

      <Field
        id="phone"
        label="Téléphone (optionnel)"
        type="tel"
        value={form.phone}
        onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
        autoComplete="tel"
      />

      <Field
        id="password"
        label="Mot de passe"
        type="password"
        value={form.password}
        onChange={(v) => setForm((f) => ({ ...f, password: v }))}
        autoComplete="new-password"
        required
      />
      <PasswordChecklist checks={passwordChecks} />

      <Field
        id="passwordConfirm"
        label="Confirmer le mot de passe"
        type="password"
        value={form.passwordConfirm}
        onChange={(v) => setForm((f) => ({ ...f, passwordConfirm: v }))}
        autoComplete="new-password"
        required
      />

      <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
        <label className="flex items-start gap-2.5 text-sm text-slate-700">
          <input
            type="checkbox"
            required
            checked={form.acceptTerms}
            onChange={(e) => setForm((f) => ({ ...f, acceptTerms: e.target.checked }))}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>
            J&apos;accepte les{' '}
            <Link href="/legal/terms" className="font-semibold text-blue-700 underline">
              CGU
            </Link>{' '}
            et la{' '}
            <Link href="/legal/privacy" className="font-semibold text-blue-700 underline">
              politique de confidentialité
            </Link>
            .
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm text-slate-700">
          <input
            type="checkbox"
            required
            checked={form.acceptPrivacy}
            onChange={(e) => setForm((f) => ({ ...f, acceptPrivacy: e.target.checked }))}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>Je comprends que les données scolaires de mon enfant sont protégées par le RGPD.</span>
        </label>
        <label className="flex items-start gap-2.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.marketingOptIn}
            onChange={(e) => setForm((f) => ({ ...f, marketingOptIn: e.target.checked }))}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>Recevoir les notifications par email (publication de notes, alertes, annonces).</span>
        </label>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-600 px-5 text-sm font-bold text-white shadow-lg transition hover:shadow-xl hover:shadow-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === 'submitting' || status === 'logging-in' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        )}
        {status === 'submitting'
          ? 'Création du compte…'
          : status === 'logging-in'
            ? 'Connexion en cours…'
            : 'Créer mon compte'}
      </button>

      <p className="text-center text-sm text-slate-600">
        Déjà un compte ?{' '}
        <Link href="/parent/login" className="font-bold text-blue-700 hover:underline">
          Se connecter
        </Link>
      </p>
    </form>
  );
}

function PasswordChecklist({
  checks,
}: {
  checks: { length: boolean; upper: boolean; lower: boolean; digit: boolean; special: boolean; match: boolean };
}) {
  const rules = [
    { ok: checks.length, label: '≥ 12 caractères' },
    { ok: checks.upper, label: '1 majuscule' },
    { ok: checks.lower, label: '1 minuscule' },
    { ok: checks.digit, label: '1 chiffre' },
    { ok: checks.special, label: '1 caractère spécial' },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-xs">
      {rules.map((r) => (
        <span
          key={r.label}
          className={`inline-flex items-center gap-1.5 ${r.ok ? 'text-emerald-700' : 'text-slate-500'}`}
        >
          <span
            className={`grid h-3.5 w-3.5 place-items-center rounded-full ${
              r.ok ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'
            }`}
          >
            {r.ok && <Check className="h-2.5 w-2.5" strokeWidth={4} />}
          </span>
          {r.label}
        </span>
      ))}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
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
        placeholder={placeholder}
        required={required}
        suppressHydrationWarning
        className="mt-1.5 block h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      />
    </div>
  );
}
