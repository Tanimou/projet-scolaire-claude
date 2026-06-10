import { NextResponse } from 'next/server';

import { auth } from '@/auth';

const PORTAL_REQUIRED_ROLES = {
  admin: ['super_admin', 'school_admin'],
  teacher: ['teacher'],
  parent: ['parent'],
  // E8-S1: the fourth portal. `/student/*` requires the `student` role only.
  // The set is disjoint from the other three (a `student` token never satisfies
  // /parent|/teacher|/admin, and vice-versa) — INV-1.
  student: ['student'],
} as const;

/**
 * Where each portal lands after a successful login. Most portals land on their
 * dashboard; the student portal has no dashboard until E8-S3, so it lands on
 * "Mes notes" (its only live S1 surface).
 */
const PORTAL_LANDING: Record<keyof typeof PORTAL_REQUIRED_ROLES, string> = {
  admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  parent: '/parent/dashboard',
  student: '/student/grades',
};

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

/** Wraps NextResponse.next() to always include the x-pathname header so server
 *  components (notably AppShellRoot) can resolve the active sidebar entry without
 *  receiving the pathname as a prop. */
function nextWithPathname(pathname: string) {
  const res = NextResponse.next();
  res.headers.set('x-pathname', pathname);
  return res;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Public pages and Next.js internals
  if (pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return nextWithPathname(pathname);
  }

  // Detect portal from URL prefix
  let portal: keyof typeof PORTAL_REQUIRED_ROLES | null = null;
  if (pathname.startsWith('/admin')) portal = 'admin';
  else if (pathname.startsWith('/teacher')) portal = 'teacher';
  else if (pathname.startsWith('/parent')) portal = 'parent';
  else if (pathname.startsWith('/student')) portal = 'student';

  if (!portal) return nextWithPathname(pathname);

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
      return NextResponse.redirect(new URL(PORTAL_LANDING[portal], req.nextUrl.origin));
    }
    return nextWithPathname(pathname);
  }

  // Protected zone → require auth
  if (!session?.user) {
    const url = new URL(`/${portal}/login`, req.nextUrl.origin);
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  // Authed but wrong portal/role → send to login with error (no loop because login won't bounce back)
  if (!hasRequiredRole) {
    const url = new URL(`/${portal}/login`, req.nextUrl.origin);
    url.searchParams.set('error', 'wrong_portal');
    return NextResponse.redirect(url);
  }

  return nextWithPathname(pathname);
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
