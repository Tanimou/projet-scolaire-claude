import {
  buildWebCsp,
  cspHeaderName,
  generateCspNonce,
  resolveCspMode,
  CSP_HEADER,
  CSP_NONCE_HEADER,
} from '@pilotage/contracts';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { PORTAL_LANDING, type PortalId } from '@/lib/portals';

/**
 * The realm roles each portal requires. Typed `Record<PortalId, …>` so the portal
 * set here, the landing map in `@/lib/portals`, and the four bare portal roots
 * cannot drift apart silently — adding a fifth portal id fails to compile until
 * this table gains its row (S-E06-5 / AC-2).
 */
const PORTAL_REQUIRED_ROLES: Record<PortalId, readonly string[]> = {
  admin: ['super_admin', 'school_admin'],
  teacher: ['teacher'],
  parent: ['parent'],
  // E8-S1: the fourth portal. `/student/*` requires the `student` role only.
  // The set is disjoint from the other three (a `student` token never satisfies
  // /parent|/teacher|/admin, and vice-versa) — INV-1.
  student: ['student'],
};

// `PORTAL_LANDING` used to be declared right here. It moved to `@/lib/portals`
// (S-E06-5 / AC-2) so the four bare portal roots redirect to the SAME value this
// middleware sends a fresh login to, instead of a second copy that can drift.

const PUBLIC_PREFIXES = ['/_next', '/api/auth', '/api/healthz', '/favicon', '/legal'];

const AUTH_ROUTES_BY_PORTAL = {
  admin: ['/admin/login', '/admin/register', '/admin/forgot-password', '/admin/reset-password', '/admin/accept-invite'],
  teacher: [
    '/teacher/login',
    '/teacher/register',
    '/teacher/forgot-password',
    '/teacher/reset-password',
    '/teacher/accept-invite',
  ],
  parent: ['/parent/login', '/parent/register', '/parent/forgot-password', '/parent/reset-password', '/parent/verify-email'],
  // E8-S1: student has no self-registration (accounts are provisioned by the
  // school, never self-served) — only a login page.
  student: ['/student/login'],
} as const;

/**
 * Origines externes que le navigateur est autorisé à joindre depuis une page du
 * portail. Lues depuis l'environnement plutôt qu'écrites en dur : ce sont les
 * mêmes valeurs que le reste de l'application utilise, et une politique qui
 * nomme `localhost` en production serait `PF-54` à une nouvelle adresse.
 * `normalizeCspOrigin` (dans `@pilotage/contracts`) réduit chacune à
 * schéma+hôte+port et rejette tout ce qui n'est pas http(s).
 */
const EXTERNAL_ORIGINS = [process.env.NEXT_PUBLIC_API_URL, process.env.NEXT_PUBLIC_KEYCLOAK_URL].filter(
  (value): value is string => typeof value === 'string' && value.length > 0,
);

/**
 * Applique la politique de sécurité du contenu à une réponse (S-E06-2 / PF-45).
 *
 * Le nonce est posé à DEUX endroits, et les deux sont nécessaires :
 *  • sur les en-têtes de la **requête** transmise au rendu — c'est là que Next
 *    va lire `content-security-policy` pour apposer le nonce sur ses propres
 *    scripts d'amorçage, et c'est là que nos composants serveur lisent
 *    `x-csp-nonce` pour leurs blocs `<style>`/`<script>` en ligne ;
 *  • sur les en-têtes de la **réponse** — c'est la politique que le navigateur
 *    applique réellement.
 *
 * L'en-tête de requête garde toujours le nom d'application, même en mode
 * observation : Next n'extrait le nonce que de `content-security-policy`, et
 * sans lui ses scripts partiraient sans nonce — la page casserait le jour où
 * l'on bascule en application, c'est-à-dire au pire moment.
 */
function withCsp(res: NextResponse, nonce: string, policy: string, mode: ReturnType<typeof resolveCspMode>) {
  res.headers.set(cspHeaderName(mode), policy);
  res.headers.set(CSP_NONCE_HEADER, nonce);
  return res;
}

/**
 * Wraps NextResponse.next() to always include the x-pathname header so server
 * components (notably AppShellRoot) can resolve the active sidebar entry without
 * receiving the pathname as a prop.
 *
 * `NextResponse.next({ request: { headers } })` REMPLACE les en-têtes de la
 * requête vue par le rendu ; fournir seulement les nôtres effacerait `cookie`,
 * `authorization` et tout ce dont le rendu dépend. On repart donc d'une copie
 * des en-têtes reçus et on ajoute par-dessus.
 */
function nextWithPathname(req: { headers: Headers }, pathname: string, nonce: string, policy: string) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', pathname);
  requestHeaders.set(CSP_HEADER, policy);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('x-pathname', pathname);
  return res;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // CSP : un nonce par réponse. Un nonce constant est strictement équivalent à
  // `'unsafe-inline'`, donc il est généré ici et nulle part ailleurs.
  const nonce = generateCspNonce();
  const mode = resolveCspMode(process.env);
  const policy = buildWebCsp({
    nonce,
    development: process.env.NODE_ENV !== 'production',
    connectSrc: EXTERNAL_ORIGINS,
    imgSrc: EXTERNAL_ORIGINS,
    formAction: EXTERNAL_ORIGINS,
  });
  const send = (res: NextResponse) => withCsp(res, nonce, policy, mode);
  const proceed = (path: string) => send(nextWithPathname(req, path, nonce, policy));

  // Public pages and Next.js internals
  if (pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return proceed(pathname);
  }

  // Detect portal from URL prefix. `/admin` itself matches — the bare root is
  // inside the protected zone (it is not a `PUBLIC_PREFIXES` member and not an
  // auth route), so an unauthenticated or wrong-role visitor is redirected below
  // and never reaches `app/admin/page.tsx` (S-E06-5 / G-AUTHZ).
  let portal: PortalId | null = null;
  if (pathname.startsWith('/admin')) portal = 'admin';
  else if (pathname.startsWith('/teacher')) portal = 'teacher';
  else if (pathname.startsWith('/parent')) portal = 'parent';
  else if (pathname.startsWith('/student')) portal = 'student';

  if (!portal) return proceed(pathname);

  const isAuthRoute = AUTH_ROUTES_BY_PORTAL[portal].some((r) => pathname.startsWith(r));
  const session = req.auth;
  const required: readonly string[] = PORTAL_REQUIRED_ROLES[portal];
  const userRoles = session?.roles ?? [];
  const hasRequiredRole = userRoles.some((r) => required.includes(r));

  // On a login page:
  //  - if user already authed AND has the right role → bounce to dashboard
  //  - otherwise stay (user can re-login with correct credentials)
  if (isAuthRoute) {
    if (session?.user && hasRequiredRole) {
      return send(NextResponse.redirect(new URL(PORTAL_LANDING[portal], req.nextUrl.origin)));
    }
    return proceed(pathname);
  }

  // Protected zone → require auth
  if (!session?.user) {
    const url = new URL(`/${portal}/login`, req.nextUrl.origin);
    url.searchParams.set('callbackUrl', pathname);
    return send(NextResponse.redirect(url));
  }

  // Authed but wrong portal/role → send to login with error (no loop because login won't bounce back)
  if (!hasRequiredRole) {
    const url = new URL(`/${portal}/login`, req.nextUrl.origin);
    url.searchParams.set('error', 'wrong_portal');
    return send(NextResponse.redirect(url));
  }

  return proceed(pathname);
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
