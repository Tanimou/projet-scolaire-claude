import {
  classifyDirectGrantFailure,
  type DirectGrantFailureCode,
} from '@pilotage/contracts';
import NextAuth, { CredentialsSignin, type DefaultSession, type User } from 'next-auth';
import 'next-auth/jwt';
import Credentials from 'next-auth/providers/credentials';
import Keycloak from 'next-auth/providers/keycloak';

import { portalProviderId, resolvePortalClientId } from '@/lib/keycloak-clients';

const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? 'pilotage-scolaire';
// Internal issuer — reachable from the web container (server-side ROPC, refresh,
// and OIDC discovery/token go here).
const KEYCLOAK_INTERNAL_ISSUER = `${process.env.KEYCLOAK_URL ?? 'http://localhost:8180'}/realms/${KEYCLOAK_REALM}`;
// Public issuer — the browser-facing Keycloak URL (KC_HOSTNAME). Used as the
// OIDC provider `issuer` so it matches the token `iss` and the authorization
// redirect targets a browser-reachable host. Falls back to the internal URL
// when no split is configured (backward-compatible).
const KEYCLOAK_PUBLIC_ISSUER = `${
  process.env.KEYCLOAK_PUBLIC_URL ?? process.env.KEYCLOAK_URL ?? 'http://localhost:8180'
}/realms/${KEYCLOAK_REALM}`;
// Server-side direct calls (ROPC login, token refresh) always use the internal URL.
const KEYCLOAK_ISSUER = KEYCLOAK_INTERNAL_ISSUER;

type Portal = 'admin' | 'teacher' | 'parent' | 'student';
const PORTALS: ReadonlyArray<Portal> = ['admin', 'teacher', 'parent', 'student'];

/**
 * Provider id → portal, DERIVED from the same helper that builds the provider id
 * (and therefore the OAuth callback path the realm must register). Hand-writing
 * the four keys here was a second copy of that rule: the realm gate could go
 * green while this map addressed a callback NextAuth never emits.
 */
const PORTAL_FROM_PROVIDER: Readonly<Record<string, Portal | undefined>> = Object.freeze(
  Object.fromEntries(PORTALS.map((portal) => [portalProviderId(portal), portal])),
);

declare module 'next-auth' {
  interface Session {
    portal?: Portal;
    accessToken?: string;
    roles?: string[];
    error?: string;
    user: { id?: string } & DefaultSession['user'];
  }
  interface User {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    portal?: Portal;
    roles?: string[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    portal?: Portal;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    roles?: string[];
    sub?: string;
    error?: string;
  }
}

/**
 * ADR-050 / S-E01-4a. The client id is resolved by the ONE shared accessor the
 * login pages also call — there is no alias map and no local literal, so a portal
 * can no longer resolve to another portal's client (PF-18). The per-portal
 * `KEYCLOAK_<PORTAL>_CLIENT_ID` override still wins, but it can only ever rename
 * the client of the portal it names.
 *
 * The SECRET stays here, server-side, and is never exported: `keycloak-clients.ts`
 * is reachable from a client component's server parent. Its dev fallback is
 * DERIVED from the resolved id (`change-me-<client id>`), which is exactly the
 * placeholder `infra/keycloak/realm-export.json` ships for each client — one
 * derivation instead of two hand-maintained lists.
 */
function clientCreds(portal: Portal) {
  const clientId = resolvePortalClientId(portal, process.env);
  return {
    clientId,
    clientSecret:
      process.env[`KEYCLOAK_${portal.toUpperCase()}_CLIENT_SECRET`] ?? `change-me-${clientId}`,
  };
}

const portalClient = (portal: Portal) => {
  // `issuer` is the browser-facing URL (matches token `iss` + the auth-redirect
  // host). Discovery must instead be fetched over the INTERNAL URL the container
  // can reach — but the Keycloak() helper overwrites `wellKnown` from `issuer`,
  // so we override it on the returned object (post-spread) to win. Keycloak's
  // KC_HOSTNAME + backchannel-dynamic make the discovery doc advertise the public
  // issuer/authorization endpoint but internal token/jwks endpoints.
  const provider = Keycloak({
    id: portalProviderId(portal),
    name: `Pilotage scolaire — ${portal}`,
    clientId: clientCreds(portal).clientId,
    clientSecret: clientCreds(portal).clientSecret,
    issuer: KEYCLOAK_PUBLIC_ISSUER,
    authorization: { params: { scope: 'openid email profile' } },
  });
  return {
    ...provider,
    wellKnown: `${KEYCLOAK_INTERNAL_ISSUER}/.well-known/openid-configuration`,
  };
};

function decodeJwtClaims(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function rolesFromAccessToken(accessToken: string | undefined): string[] {
  const claims = decodeJwtClaims(accessToken) as { realm_access?: { roles?: string[] } } | null;
  return claims?.realm_access?.roles ?? [];
}

/**
 * Login outcomes the browser is allowed to see.
 *
 * The three failure members come from the ONE canonical taxonomy
 * (`classifyDirectGrantFailure`, `packages/contracts/src/security/`); only
 * `wrong_portal` is added here, on purpose: it is decided AFTER a successful
 * mint, from decoded realm-role claims, so it is not a direct-grant failure and
 * must never enter that union (its input contract would become a lie).
 *
 * `otp_required` and `invalid_credentials` are DELETED, not renamed. Keycloak
 * cannot tell a wrong password from a wrong/missing TOTP in the ROPC grant, so
 * no honest code path can produce `otp_required`, and `invalid_credentials`
 * over-claimed the same way in the opposite direction.
 */
type CredentialsLoginCode = DirectGrantFailureCode | 'wrong_portal';

/**
 * Login errors travel to the browser through NextAuth's `?code=` parameter.
 *
 * S-E05-8 — this class used to extend plain `Error`, and that made every branch
 * below invisible: `@auth/core` wraps a non-`AuthError` thrown from `authorize`
 * in a `CallbackRouteError`, which is NOT in its client-safe list, so the
 * browser received `?error=Configuration` and no `code` at all — every arm of
 * the login form's error handler missed and the user read « Connexion
 * impossible : Configuration » whatever had actually happened. Extending
 * `CredentialsSignin` is what puts `this.code` on the redirect URL
 * (`@auth/core/index.js`: `if (error instanceof CredentialsSignin) params.set('code', …)`),
 * i.e. it is the transport, not decoration. `signIn(…, {redirect:false})` then
 * surfaces it as `res.code`, which is what `PortalLoginForm` reads.
 *
 * Nothing here is more permissive: this class is only ever thrown, never
 * returned, so no failure can become a session.
 */
class CredentialsLoginError extends CredentialsSignin {
  constructor(public override readonly code: CredentialsLoginCode) {
    super(code);
    this.name = 'CredentialsLoginError';
  }
}

const REALM_ROLES_FOR_PORTAL: Record<Portal, string[]> = {
  admin: ['super_admin', 'school_admin'],
  teacher: ['teacher'],
  parent: ['parent'],
  // E8-S1: the fourth portal. Its role set is DISJOINT from the other three —
  // `student` is never added to admin/teacher/parent (so a student can never
  // reach /parent|/teacher|/admin), and those roles never appear here (so a
  // parent/teacher/admin is never routed into /student). INV-1.
  student: ['student'],
};

/**
 * Resource Owner Password Credentials grant against Keycloak.
 *
 * `totp` is forwarded when the caller supplied one; Keycloak validates it only
 * when its direct-grant flow has the OTP step enabled.
 *
 * S-E05-8 / DNC-06 — the previous docblock claimed « we leave it conditional so
 * MFA users must supply theirs », which promised behaviour this function does
 * not deliver: it cannot require an OTP, it cannot detect that one is required,
 * and it cannot even tell whether a rejection was about the password or the
 * code. Failure classification is NOT decided here any more: it is delegated,
 * unchanged and in one place, to `classifyDirectGrantFailure`. This function
 * only carries the verdict.
 */
async function directGrantLogin(args: {
  portal: Portal;
  email: string;
  password: string;
  otp?: string;
}): Promise<{
  sub: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  roles: string[];
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const { clientId, clientSecret } = clientCreds(args.portal);
  const params = new URLSearchParams({
    grant_type: 'password',
    client_id: clientId,
    client_secret: clientSecret,
    username: args.email,
    password: args.password,
    scope: 'openid email profile',
  });
  if (args.otp) params.set('totp', args.otp);

  // A transport failure (Keycloak down, DNS, TLS) used to throw a raw `Error`
  // out of `authorize`, which `@auth/core` wraps into a non-client-safe
  // `CallbackRouteError` — the browser then saw `?error=Configuration` and no
  // code at all. It is mapped to the taxonomy's `unclassified` member instead,
  // so an outage can never be rendered as a password verdict.
  const res = await fetch(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  }).catch(() => {
    throw new CredentialsLoginError('unclassified');
  });
  const body = (await res.json().catch(() => null)) as
    | {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      }
    | null;

  if (!res.ok || !body?.access_token) {
    // S-E05-8 / PF-25 half (a). What stood here was a four-needle substring
    // cascade (`'otp' | 'totp' | 'credential' | 'verification'`) tested BEFORE
    // the 401/`invalid_grant` branch. `'credential'` is a proper substring of
    // Keycloak's measured wrong-password answer `"Invalid user credentials"`,
    // so an ordinary typo was classified `otp_required` and the login page
    // announced « Authentification à deux facteurs requise » — an MFA claim
    // about an account whose password had not been proven — while the correct
    // message was unreachable. The remedy is NOT a reordering: the taxonomy is
    // declared once, as a pure closed union, in `@pilotage/contracts`, and this
    // seam does nothing but pass the observable response to it.
    throw new CredentialsLoginError(
      classifyDirectGrantFailure({
        status: res.status,
        error: body?.error ?? null,
        errorDescription: body?.error_description ?? null,
      }),
    );
  }

  const claims = decodeJwtClaims(body.access_token) as
    | {
        sub: string;
        email?: string;
        name?: string;
        given_name?: string;
        family_name?: string;
        realm_access?: { roles?: string[] };
      }
    | null;
  // A mint that carries no `sub` is not a credential verdict — it is an
  // unusable response, so it degrades to the taxonomy's closed-failure member.
  if (!claims?.sub) throw new CredentialsLoginError('unclassified');

  const roles = claims.realm_access?.roles ?? [];
  const required = REALM_ROLES_FOR_PORTAL[args.portal];
  if (!roles.some((r) => required.includes(r))) {
    throw new CredentialsLoginError('wrong_portal');
  }

  return {
    sub: claims.sub,
    email: claims.email ?? args.email,
    name:
      claims.name ?? (`${claims.given_name ?? ''} ${claims.family_name ?? ''}`.trim() || args.email),
    firstName: claims.given_name ?? '',
    lastName: claims.family_name ?? '',
    roles,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? '',
    expiresAt: Math.floor(Date.now() / 1000) + (body.expires_in ?? 300),
  };
}

const credentialsProvider = Credentials({
  id: 'credentials',
  name: 'Email / mot de passe',
  credentials: {
    email: { label: 'Email', type: 'email' },
    password: { label: 'Mot de passe', type: 'password' },
    otp: { label: 'Code MFA (optionnel)', type: 'text' },
    portal: { type: 'text' },
  },
  authorize: async (raw): Promise<User | null> => {
    const portalRaw = String(raw?.portal ?? '').toLowerCase();
    if (!PORTALS.includes(portalRaw as Portal)) throw new CredentialsLoginError('unclassified');
    const portal = portalRaw as Portal;

    const result = await directGrantLogin({
      portal,
      email: String(raw?.email ?? '').toLowerCase(),
      password: String(raw?.password ?? ''),
      otp: raw?.otp ? String(raw.otp) : undefined,
    });

    return {
      id: result.sub,
      email: result.email,
      name: result.name || undefined,
      portal,
      roles: result.roles,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
    };
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    portalClient('admin'),
    portalClient('teacher'),
    portalClient('parent'),
    portalClient('student'),
    credentialsProvider,
  ],
  session: { strategy: 'jwt' },
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  callbacks: {
    async jwt({ token, account, profile, user }) {
      // OIDC redirect (first call after Keycloak callback)
      const providerPortal = account ? PORTAL_FROM_PROVIDER[account.provider] : undefined;
      if (account && providerPortal) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        token.portal = providerPortal;
        token.sub = profile?.sub ?? token.sub;
        const roles = rolesFromAccessToken(account.access_token ?? undefined);
        if (roles.length) token.roles = roles;
        return token;
      }

      // Credentials login (first call after authorize() — copy what we stuffed into User)
      if (account?.provider === 'credentials' && user) {
        token.accessToken = user.accessToken;
        token.refreshToken = user.refreshToken;
        token.expiresAt = user.expiresAt;
        token.portal = user.portal;
        token.roles = user.roles;
        token.sub = user.id ?? token.sub;
        return token;
      }

      // Token still valid → return as-is
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = (token.expiresAt as number | undefined) ?? 0;
      if (expiresAt - 60 > now) return token;

      // Refresh
      if (!token.refreshToken || !token.portal) {
        token.error = 'NoRefreshToken';
        return token;
      }
      try {
        const { clientId, clientSecret } = clientCreds(token.portal);
        const res = await fetch(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: token.refreshToken as string,
            client_id: clientId,
            client_secret: clientSecret,
          }),
        });
        const refreshed = (await res.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          error?: string;
        };
        if (!res.ok || refreshed.error) {
          token.error = refreshed.error ?? 'RefreshFailed';
          return token;
        }
        token.accessToken = refreshed.access_token;
        token.refreshToken = refreshed.refresh_token ?? token.refreshToken;
        token.expiresAt = Math.floor(Date.now() / 1000) + (refreshed.expires_in ?? 300);
        token.error = undefined;
        const refreshedRoles = rolesFromAccessToken(refreshed.access_token);
        if (refreshedRoles.length) token.roles = refreshedRoles;
      } catch {
        token.error = 'RefreshException';
      }
      return token;
    },
    async session({ session, token }) {
      session.portal = token.portal as Portal | undefined;
      session.accessToken = token.accessToken as string | undefined;
      session.roles = token.roles as string[] | undefined;
      session.error = token.error as string | undefined;
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
