'use client';

import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn, signOut } from 'next-auth/react';
import { Suspense, useState } from 'react';

import {
  AuthSplitLayout,
  authButtonClass,
  authPrimaryText,
  authRingClass,
  type PortalAccent,
} from './AuthSplitLayout';

import { buildResetCredentialsUrl, portalClientId } from '@/lib/keycloak-clients';
import { PORTAL_LANDING } from '@/lib/portals';
import { safeCallbackUrl } from '@/lib/safe-callback-url';

const KEYCLOAK_URL = process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? 'http://localhost:8180';
const KEYCLOAK_REALM = process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? 'pilotage-scolaire';

/**
 * S-E01-4a / PF-18. The `client_id` is NOT derived here any more: this file used
 * to carry its own hard-coded copy of the portal→client rule (with the student
 * portal aliased onto the parent client), which ignored the
 * `KEYCLOAK_<PORTAL>_CLIENT_ID` override `auth.ts` honours — so login and password
 * reset could address two different clients without anything failing, and a
 * student token was indistinguishable from a parent one. The id now arrives as a
 * prop, resolved server-side by the login page through the SAME accessor `auth.ts` calls
 * (`resolvePortalClientId`); `portalClientId(accent)` is only the env-free default
 * for the (typed-impossible) case where no page passed it.
 *
 * A `NEXT_PUBLIC_*` variable was rejected on purpose (ADR-050 §D2): it is inlined
 * at BUILD time on this deployment, so a runtime-configured login and a
 * build-time-baked reset link would re-create the exact divergence being closed.
 * Only the `client_id` crosses to the browser — never the client secret.
 */
function buildKeycloakResetUrl(portal: PortalAccent, clientId: string): string {
  // The origin stays browser-derived: behind Traefik a server-side guess would
  // ship a `localhost` reset link to production.
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3100';
  return buildResetCredentialsUrl({
    keycloakUrl: KEYCLOAK_URL,
    realm: KEYCLOAK_REALM,
    clientId,
    origin,
    portal,
  });
}

export function PortalLoginForm(props: {
  accent: PortalAccent;
  title: string;
  subtitle: string;
  /** Self-service registration link. Omit for portals provisioned by the school
   *  (e.g. the student portal — accounts are created by the établissement). */
  registerHref?: string;
  registerLabel?: string;
  /** OIDC `client_id` for this portal's password-reset link, resolved server-side
   *  by the page (env overrides included) so it can never diverge from login. */
  resetClientId?: string;
  otherPortals: { label: string; href: string }[];
}) {
  return (
    <Suspense fallback={null}>
      <PortalLoginFormInner {...props} />
    </Suspense>
  );
}

function PortalLoginFormInner({
  accent,
  title,
  subtitle,
  registerHref,
  registerLabel,
  resetClientId,
  otherPortals,
}: {
  accent: PortalAccent;
  title: string;
  subtitle: string;
  registerHref?: string;
  registerLabel?: string;
  resetClientId?: string;
  otherPortals: { label: string; href: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  // PF-102 / S-E05-12 — `?callbackUrl=` is attacker-controllable, so it is validated
  // HERE, once, at the read site: the binding below is same-origin by construction at
  // both sinks (`router.push` on the credentials branch, `signIn(…, { callbackUrl })`
  // on the SSO one). A per-sink guard would be a rule a third sink can forget.
  // A rejected value falls back to this portal's landing page, silently and on
  // purpose — the visitor never authored the parameter, so there is nothing
  // actionable to tell them, and the code cannot tell "attack" from "malformed".
  const callbackUrl = safeCallbackUrl(params.get('callbackUrl'), PORTAL_LANDING[accent]);
  const errorParam = params.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [showOtp, setShowOtp] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const onCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        otp: showOtp ? otp : undefined,
        portal: accent,
        redirect: false,
      });
      if (!res) {
        setFormError("Erreur inattendue. Réessayez.");
        return;
      }
      if (res.error) {
        const code = res.error;
        if (code.includes('otp_required')) {
          setShowOtp(true);
          setFormError(
            otp
              ? 'Code MFA incorrect. Vérifiez le code de votre app et réessayez.'
              : 'Authentification à deux facteurs requise. Entrez le code de votre app TOTP.',
          );
        } else if (code.includes('wrong_portal')) {
          setFormError(
            "Ce compte n'a pas accès à ce portail. Essayez l'un des autres portails ci-dessous.",
          );
        } else if (code.includes('invalid_credentials') || code.includes('CredentialsSignin')) {
          setFormError("Email ou mot de passe incorrect.");
        } else {
          setFormError(`Connexion impossible : ${code}`);
        }
        return;
      }
      // Success — NextAuth set the session cookie. Navigate.
      router.push(callbackUrl);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const onSsoLogin = async () => {
    setSsoLoading(true);
    try {
      await signOut({ redirect: false });
      await signIn(`keycloak-${accent}`, { callbackUrl }, { prompt: 'login' });
    } finally {
      setSsoLoading(false);
    }
  };

  const showUrlError =
    !formError &&
    errorParam &&
    !['wrong_portal', 'session_expired', 'CredentialsSignin'].includes(errorParam);

  return (
    <AuthSplitLayout portal={accent} title={title} subtitle={subtitle} bottomLinks={otherPortals}>
      {errorParam === 'session_expired' && !formError && (
        <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Votre session a expiré. Reconnectez-vous pour continuer.
        </div>
      )}
      {errorParam === 'wrong_portal' && !formError && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Ce compte n&apos;a pas accès à ce portail. Essayez l&apos;un des autres portails ci-dessous.
        </div>
      )}
      {showUrlError && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          La connexion a échoué. Réessayez ou contactez votre administrateur.
        </div>
      )}
      {formError && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {formError}
        </div>
      )}

      <form className="space-y-5" onSubmit={onCredentialsSubmit}>
        <div>
          <label htmlFor="email" className="text-sm font-semibold text-slate-900">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@exemple.com"
            suppressHydrationWarning
            className={`mt-1.5 block h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 ${authRingClass(accent)}`}
          />
        </div>

        <div>
          {/* `flex-wrap` so a longer localised label wraps under « Mot de passe »
              instead of squashing it at 320 px. The reset link carries its own
              min-height/padding (WCAG 2.2 AA §2.5.8 — it is a standalone control,
              not an inline link inside a sentence) and a solid `currentColor`
              focus ring (§1.4.11 — the shared 40 %-alpha auth ring is ≈1.6:1 on
              white, recorded as a systemic finding rather than patched here). */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <label htmlFor="password" className="text-sm font-semibold text-slate-900">
              Mot de passe
            </label>
            <a
              href={buildKeycloakResetUrl(accent, resetClientId ?? portalClientId(accent))}
              className={`-mx-1 inline-flex min-h-[24px] items-center rounded px-1 text-xs font-medium hover:underline focus-visible:outline-none focus-visible:underline focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 ${authPrimaryText(accent)}`}
            >
              Mot de passe oublié ?
            </a>
          </div>
          <div className="relative mt-1.5">
            <input
              id="password"
              type={showPwd ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              suppressHydrationWarning
              className={`block h-12 w-full rounded-xl border border-slate-200 bg-white px-4 pr-11 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 ${authRingClass(accent)}`}
            />
            <button
              type="button"
              aria-label={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            >
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {showOtp && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div className="flex-1">
                <label htmlFor="otp" className="text-sm font-bold text-amber-900">
                  Code à 6 chiffres
                </label>
                <p className="mt-0.5 text-xs text-amber-800">
                  Ouvrez votre app TOTP (Google Authenticator, Authy…) et entrez le code à 6 chiffres généré.
                </p>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\s/g, ''))}
                  placeholder="123456"
                  suppressHydrationWarning
                  className="mt-3 block h-12 w-full rounded-xl border border-amber-300 bg-white px-4 font-mono text-lg tabular-nums tracking-wider text-slate-900 focus-visible:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
                />
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className={`group inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold text-white shadow-lg transition disabled:opacity-70 ${authButtonClass(accent)}`}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
          {submitting
            ? 'Connexion…'
            : showOtp
              ? 'Valider le code MFA'
              : 'Se connecter'}
        </button>
      </form>

      <div className="my-7 flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">ou</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <button
        type="button"
        onClick={onSsoLogin}
        disabled={ssoLoading}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-70"
      >
        {ssoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        {ssoLoading ? 'Redirection…' : 'Se connecter via SSO Keycloak'}
      </button>
      <p className="mt-2 text-center text-xs text-slate-500">
        Recommandé si votre établissement utilise une fédération d&apos;identité (Google, Microsoft…).
      </p>

      {registerHref ? (
        <p className="mt-8 text-center text-sm text-slate-600">
          {registerLabel}{' '}
          <Link href={registerHref} className={`font-bold hover:underline ${authPrimaryText(accent)}`}>
            {accent === 'parent' ? 'Créer un compte' : 'Demander une invitation'}
            <ArrowRight className="ml-0.5 inline h-3.5 w-3.5" />
          </Link>
        </p>
      ) : (
        <p className="mt-8 text-center text-sm text-slate-500">
          Ton compte est créé par ton établissement. Rapproche-toi de lui si tu n’as pas encore tes
          identifiants.
        </p>
      )}
    </AuthSplitLayout>
  );
}
