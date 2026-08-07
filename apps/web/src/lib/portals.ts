/**
 * Portal identity and the ONE portal-landing map (S-E06-5 / AC-2, PF-93).
 *
 * Why this module exists. `PORTAL_LANDING` used to live inside
 * `apps/web/src/middleware.ts`, which meant the only code that knew where a
 * portal lands was the code that redirects a *fresh login*. The four bare roots
 * (`/admin`, `/teacher`, `/parent`, `/student`) had no page at all — they 404'd —
 * and the obvious fix (a redirect page per portal) would have written the four
 * landing paths a second time. Two copies drift, and a drifted copy sends a whole
 * portal to a page that moved. This is `S-E02-16` rule 2 (*a value is written
 * exactly once*) applied to a route: the map is **moved** here, not copied, and
 * both the middleware and the four root pages read it.
 *
 * Deliberately import-free. `middleware.ts` runs in the **Edge** runtime and this
 * module is pulled into its bundle, so there is no `next/*` import, no
 * `'server-only'`, and no `process.env` read. It is also why the map is not in
 * `packages/contracts`: that package is built to CJS `dist/` and shared with the
 * api and worker runtimes, neither of which has any use for a Next route.
 *
 * Recorded rather than fixed (PF-101): `packages/contracts`'s `PORTALS` still
 * declares three portals, predating the student portal, which is why
 * `apps/web` carries several local `Portal` re-declarations. `PortalId` below is
 * local to `apps/web` on purpose; consolidating the union is its own slice.
 */

/** The four portals, in the order the product presents them. */
export const PORTAL_IDS = ['admin', 'teacher', 'parent', 'student'] as const;

/** A portal route prefix — `/admin`, `/teacher`, `/parent`, `/student`. */
export type PortalId = (typeof PORTAL_IDS)[number];

/**
 * Where each portal lands: after a successful login (`middleware.ts`) and when a
 * visitor asks for the bare portal root (`app/<portal>/page.tsx`).
 *
 * Every one of the four targets is an emitted route — `/student/dashboard` is the
 * E8-S3 "Mon objectif" hero page. (The comment this map carried in
 * `middleware.ts` claimed the student portal had no dashboard yet; that stopped
 * being true when E8-S3 shipped, and it is not carried over.)
 */
export const PORTAL_LANDING: Record<PortalId, string> = {
  admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  parent: '/parent/dashboard',
  student: '/student/dashboard',
};

/** Type guard for an untrusted portal-ish value (a session claim, never a URL). */
export function isPortalId(value: unknown): value is PortalId {
  return typeof value === 'string' && (PORTAL_IDS as readonly string[]).includes(value);
}
