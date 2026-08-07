import { redirect } from 'next/navigation';

import { PORTAL_LANDING } from '@/lib/portals';

/**
 * `/teacher` — the bare portal root (S-E06-5 / AC-2, PF-93).
 *
 * See `app/admin/page.tsx` for the reasoning shared by all four roots: the target
 * comes from the ONE `PORTAL_LANDING` constant the middleware also reads, the
 * redirect happens on the server, and the key is a literal so no user-controlled
 * value can choose the destination (G-AUTHZ). `/teacher` sits in the middleware's
 * protected zone, so an unauthenticated or wrong-role visitor is redirected to
 * `/teacher/login` before this file runs.
 */
export const dynamic = 'force-dynamic';

export default function TeacherPortalRoot() {
  redirect(PORTAL_LANDING.teacher);
}
