'use client';

import type { DirectGrantFailureCode } from '@pilotage/contracts';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn, signOut } from 'next-auth/react';
import { Suspense, useEffect, useRef, useState } from 'react';

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

/**
 * S-E05-8 / PF-25 half (a) — the ONE place a login failure becomes words.
 *
 * The keys are the closed union from `@pilotage/contracts`
 * (`classifyDirectGrantFailure`) plus `wrong_portal`, which `auth.ts` decides
 * after a successful mint. Nothing here re-derives a verdict, and nothing here
 * matches substrings: the previous handler tested `code.includes('otp_required')`
 * against a code produced by a substring cascade one layer up, which is how a
 * plain typo came to be announced as « Authentification à deux facteurs
 * requise ». That string, and the word « requise » applied to MFA, are gone:
 * this component can no longer assert an MFA fact about anybody, because it is
 * never told one.
 *
 * The four portals share this table by construction — `PortalLoginForm` backs
 * `/admin`, `/teacher`, `/parent` and `/student` login — so the copy is
 * byte-identical across them. No message echoes the submitted email, names a
 * school, or says which of the two fields was wrong.
 */
const CREDENTIALS_REJECTED_MESSAGE =
  'Email ou mot de passe incorrect. Si votre compte utilise un code à 6 chiffres, vérifiez-le également.';

/**
 * PREMISE P-1, UNMEASURED (PF-444). Keycloak is understood to answer « Account
 * is not fully set up » only AFTER the password has verified — a wrong password
 * short-circuits to « Invalid user credentials » first — so this distinct
 * message is reachable only by a caller who already proved the credential, and
 * it therefore tells an anonymous prober nothing. The premise is reasoned from
 * grant semantics, not measured: `scripts/keycloak-live-probe.js` STEP 6 mint C
 * discharges it, and ships NOT EXECUTED (Docker Desktop unable to start).
 *
 * PRE-DECIDED CONTINGENCY, one line: if the probe falsifies P-1, point this key
 * at `CREDENTIALS_REJECTED_MESSAGE` — the taxonomy keeps the distinction for
 * the gate and for the slice that finally measures MFA, and only the rendering
 * collapses. Do NOT "improve" this by adding the account's email or the school
 * name: the message is deliberately conditional and self-filtering.
 */
const SETUP_PENDING_MESSAGE =
  "Ce compte n'a pas terminé sa configuration. Ouvrez le lien d'activation reçu par email pour finaliser votre mot de passe et, si votre rôle l'exige, votre code à 6 chiffres.";

/**
 * No usable answer: Keycloak down, gateway error, unreadable body, transport
 * failure. It must never read as a password verdict — telling a user their
 * password is wrong while the identity provider is unreachable is both false
 * and a support-cost multiplier.
 */
const UNCLASSIFIED_MESSAGE =
  'Connexion impossible pour le moment. Réessayez dans un instant, ou contactez votre administrateur si le problème persiste.';

const WRONG_PORTAL_MESSAGE =
  "Ce compte n'a pas accès à ce portail. Essayez l'un des autres portails ci-dessous.";

type LoginFailureCode = DirectGrantFailureCode | 'wrong_portal';

const FAILURE_MESSAGE: Readonly<Record<LoginFailureCode, string>> = Object.freeze({
  'credentials-or-otp-rejected': CREDENTIALS_REJECTED_MESSAGE,
  'account-setup-pending': SETUP_PENDING_MESSAGE,
  unclassified: UNCLASSIFIED_MESSAGE,
  wrong_portal: WRONG_PORTAL_MESSAGE,
});

/**
 * Turn what `signIn(…, { redirect: false })` returned into one sentence.
 *
 * Reads `res.code`, never `res.error`. On this path `res.error` is only ever
 * `'CredentialsSignin'` (the client-safe error TYPE) — or `'Configuration'`
 * when the throw was not client-safe at all, which is what happened to EVERY
 * credentials failure before this slice made `CredentialsLoginError` extend
 * `CredentialsSignin`. That defensive arm is kept on purpose: if the transport
 * ever regresses, the page must say "service unavailable", never "wrong
 * password".
 */
function messageForSignInResult(result: { error?: string; code?: string }): string {
  const code = result.code;
  if (code && code in FAILURE_MESSAGE) {
    return FAILURE_MESSAGE[code as LoginFailureCode];
  }
  return UNCLASSIFIED_MESSAGE;
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
  const errorRef = useRef<HTMLDivElement>(null);

  // WCAG 2.2 §4.1.3 + §3.2.2 — the banner is `role="alert"`, so a screen reader
  // hears it; focus moves to the banner itself and NOT into the OTP input, so
  // the error, the reset link, the fields and the MFA disclosure are all one Tab
  // away and nothing yanks the user into a field they did not open.
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  const onCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        // Keyed on the field HAVING a value, never on the branch that revealed
        // it: gating the payload on `showOtp` would silently drop a correct
        // code typed into a panel opened by a user gesture and then tell the
        // user their password was wrong.
        otp: otp.trim() || undefined,
        portal: accent,
        redirect: false,
      });
      if (!res) {
        setFormError('Erreur inattendue. Réessayez.');
        return;
      }
      if (res.error) {
        // The OTP panel is NEVER opened from a failure code (that reveal was
        // the assertion this slice deletes). It stays exactly where the user
        // left it.
        setFormError(messageForSignInResult(res));
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
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Ce compte n&apos;a pas accès à ce portail. Essayez l&apos;un des autres portails
            ci-dessous.
          </span>
        </div>
      )}
      {showUrlError && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          La connexion a échoué. Réessayez ou contactez votre administrateur.
        </div>
      )}
      {/* `role="alert"` implies `aria-live="assertive"` — do not add both.
          `tabIndex={-1}` makes it focusable by script only (see the effect
          above). Icon + text, never colour alone (WCAG 1.4.1); red-900 on
          red-50 ≈ 10:1. */}
      {formError && (
        <div
          id="login-error"
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{formError}</span>
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
            // BOTH fields are marked invalid, never one: the outcome is
            // genuinely ambiguous (Keycloak does not say which credential was
            // refused), and flagging only the password would re-assert a fact
            // nobody measured — the defect this slice removes, one attribute
            // over.
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? 'login-error' : undefined}
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
              aria-invalid={formError ? true : undefined}
              aria-describedby={formError ? 'login-error' : undefined}
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

        {/* MFA is an AFFORDANCE the user opens, never an assertion the page
            makes. This row is rendered on first paint, collapsed, on all four
            portals — before any submit — and `setShowOtp(true)` is reachable
            ONLY from this gesture. Nothing in the failure path opens it: the
            page cannot know whether MFA is involved, and pretending otherwise
            is exactly PF-25. `flex-wrap` keeps it intact at 320 px; the control
            carries its own ≥24 px target and a solid focus ring (WCAG 2.2
            §2.5.8 / §1.4.11 — the shared 40 %-alpha auth ring is ≈1.6:1 on
            white, recorded systemically rather than patched here). */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={() => setShowOtp((v) => !v)}
            aria-expanded={showOtp}
            aria-controls="otp-panel"
            className="-mx-1 inline-flex min-h-[24px] items-center gap-1.5 rounded px-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2"
          >
            {showOtp ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            J&apos;utilise un code à 6 chiffres (MFA)
          </button>
        </div>

        {/* Neutral slate, not amber: amber reads as « you must », and this
            panel makes no claim about whether this account needs a code. The
            input is NOT `required` (a required OTP would block the far more
            common typo case from ever resubmitting) and does NOT autofocus. No
            height animation — instant reveal, nothing to sit out under
            `prefers-reduced-motion`. */}
        {showOtp && (
          <div
            id="otp-panel"
            className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
              <div className="flex-1">
                <label htmlFor="otp" className="text-sm font-bold text-slate-900">
                  Code à 6 chiffres (optionnel)
                </label>
                <p className="mt-0.5 text-xs text-slate-600">
                  Uniquement si votre compte est protégé par une app TOTP (Google Authenticator,
                  Authy…). Laissez vide sinon.
                </p>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\s/g, ''))}
                  placeholder="123456"
                  suppressHydrationWarning
                  className="mt-3 block h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-mono text-lg tabular-nums tracking-wider text-slate-900 focus-visible:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40"
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
          {/* The label no longer flips to « Valider le code MFA » when the
              panel is open: that was a second assertion of the same
              unmeasured fact, and the button submits the same form either
              way. */}
          {submitting ? 'Connexion…' : 'Se connecter'}
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
