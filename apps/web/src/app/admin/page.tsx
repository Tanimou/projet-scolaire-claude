import { redirect } from 'next/navigation';

import { PORTAL_LANDING } from '@/lib/portals';

/**
 * `/admin` — the bare portal root (S-E06-5 / AC-2, PF-93).
 *
 * Before this slice the four bare roots had no page at all: `/admin` 404'd, so a
 * user who trimmed a URL, or a bookmark left on the prefix, hit a dead end inside
 * a portal that works. The target is read from the ONE `PORTAL_LANDING` constant
 * that `apps/web/src/middleware.ts` also uses — never written as a literal here,
 * because a second copy is what drifts.
 *
 * It is a **server** redirect on purpose: a `useEffect` bounce would flash a blank
 * frame, break without JS, and need `'use client'` on a route whose entire job is
 * a response header.
 *
 * Nothing user-controlled reaches the redirect: the key is the literal `admin`, so
 * there is no path by which a query string, header or referrer could choose the
 * destination (G-AUTHZ). Access itself is already settled before this file runs —
 * `/admin` is inside the middleware's protected zone, so an unauthenticated
 * visitor is sent to `/admin/login?callbackUrl=/admin` and a wrong-role visitor to
 * `/admin/login?error=wrong_portal`.
 */
export const dynamic = 'force-dynamic';

export default function AdminPortalRoot() {
  redirect(PORTAL_LANDING.admin);
}
