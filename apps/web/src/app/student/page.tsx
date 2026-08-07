import { redirect } from 'next/navigation';

import { PORTAL_LANDING } from '@/lib/portals';

/**
 * `/student` — the bare portal root (S-E06-5 / AC-2, PF-93).
 *
 * See `app/admin/page.tsx` for the reasoning shared by all four roots: the target
 * comes from the ONE `PORTAL_LANDING` constant the middleware also reads, the
 * redirect happens on the server, and the key is a literal so no user-controlled
 * value can choose the destination (G-AUTHZ). `/student` sits in the middleware's
 * protected zone, so an unauthenticated or wrong-role visitor is redirected to
 * `/student/login` before this file runs.
 *
 * The landing is `/student/dashboard` — the E8-S3 "Mon objectif" hero page, an
 * emitted route. The student portal is read-only and has neither a profile nor a
 * settings surface (PF-57); that posture is expressed as DATA elsewhere (the
 * settings map in `TopbarUserMenu`), never as a special case here.
 */
export const dynamic = 'force-dynamic';

export default function StudentPortalRoot() {
  redirect(PORTAL_LANDING.student);
}
