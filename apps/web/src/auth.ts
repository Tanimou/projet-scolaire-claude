import NextAuth, { type DefaultSession, type User } from 'next-auth';
import 'next-auth/jwt';
import Credentials from 'next-auth/providers/credentials';
import Keycloak from 'next-auth/providers/keycloak';

const KEYCLOAK_ISSUER = `${process.env.KEYCLOAK_URL ?? 'http://localhost:8180'}/realms/${
  process.env.KEYCLOAK_REALM ?? 'pilotage-scolaire'
}`;

const PORTAL_FROM_PROVIDER = {
  'keycloak-admin': 'admin',
  'keycloak-teacher': 'teacher',
  'keycloak-parent': 'parent',
} as const;

type Portal = 'admin' | 'teacher' | 'parent';
const PORTALS: ReadonlyArray<Portal> = ['admin', 'teacher', 'parent'];

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

function clientCreds(portal: Portal) {
  return {
    clientId:
      process.env[`KEYCLOAK_${portal.toUpperCase()}_CLIENT_ID`] ?? `portal-${portal}`,
    clientSecret:
      process.env[`KEYCLOAK_${portal.toUpperCase()}_CLIENT_SECRET`] ??
      `change-me-portal-${portal}`,
  };
}

const portalClient = (portal: Portal) =>
  Keycloak({
    id: `keycloak-${portal}`,
    name: `Pilotage scolaire — ${portal}`,
    clientId: clientCreds(portal).clientId,
    clientSecret: clientCreds(portal).clientSecret,
    issuer: KEYCLOAK_ISSUER,
    authorization: { params: { scope: 'openid email profile' } },
  });

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
 * Login errors are surfaced via NextAuth's `error` URL param so the UI can switch UX.
 * The `code` (kept as the Error message) is what NextAuth re-emits.
 */
class CredentialsLoginError extends Error {
  constructor(public readonly code: 'invalid_credentials' | 'otp_required' | 'wrong_portal' | 'unknown') {
    super(code);
    this.name = 'CredentialsLoginError';
  }
}

const REALM_ROLES_FOR_PORTAL: Record<Portal, string[]> = {
  admin: ['super_admin', 'school_admin'],
  teacher: ['teacher'],
  parent: ['parent'],
};

/**
 * Resource Owner Password Credentials grant against Keycloak.
 * Passes optional `totp` — Keycloak only validates it when its direct-grant flow
 * has the OTP step enabled (we leave it conditional so MFA users must supply theirs).
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

  const res = await fetch(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
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
    const desc = (body?.error_description ?? '').toLowerCase();
    // Keycloak signals "missing OTP" with various phrasings depending on flow config
    if (
      desc.includes('otp') ||
      desc.includes('totp') ||
      desc.includes('credential') ||
      desc.includes('verification')
    ) {
      throw new CredentialsLoginError('otp_required');
    }
    if (res.status === 401 || body?.error === 'invalid_grant') {
      throw new CredentialsLoginError('invalid_credentials');
    }
    throw new CredentialsLoginError('unknown');
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
  if (!claims?.sub) throw new CredentialsLoginError('unknown');

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
    if (!PORTALS.includes(portalRaw as Portal)) throw new CredentialsLoginError('unknown');
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
  providers: [portalClient('admin'), portalClient('teacher'), portalClient('parent'), credentialsProvider],
  session: { strategy: 'jwt' },
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  callbacks: {
    async jwt({ token, account, profile, user }) {
      // OIDC redirect (first call after Keycloak callback)
      if (account && account.provider in PORTAL_FROM_PROVIDER) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        token.portal = PORTAL_FROM_PROVIDER[account.provider as keyof typeof PORTAL_FROM_PROVIDER];
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
