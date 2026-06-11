/**
 * E10-S1 — portal-aware authenticated-session fixture: the demo-seed-backed
 * `PortalUser` table (the test-facing "contract" of the fixture spine).
 *
 * Resolution order per portal (matches `docs/spec/features/e10/contracts/auth-fixture.contract.md §1`):
 *   1. `E2E_<PORTAL>_EMAIL` / `E2E_<PORTAL>_PASSWORD`  (CI / operator override)
 *   2. else the documented per-portal default below.
 *
 * Default credentials are the **demo accounts** from project-context §6 + the
 * `voltaire-demo` rich-data parent (`seed-demo-parent.ts`). NO new test users,
 * NO new seed, NO real children's data (FR-1 / FR-8 / Non-goals). The
 * `storageState` these produce is git-ignored and regenerated every run.
 *
 * Why the parent default is `parent.demo@voltaire.fr` and not
 * `parent@pilotage.local`: J1 (grade→alert) needs the rich `voltaire-demo`
 * alert graph, which only the demo parent (created by `apps/api/prisma/
 * seed-demo-parent.ts`) carries. The simple `parent@pilotage.local` may exist
 * but has no seeded alert graph. The journey itself `test.skip`s gracefully
 * when a parent legitimately has no open alert (PM-5 non-vacuous guard lives in
 * the journey), so either parent is safe to swap via `E2E_PARENT_EMAIL`.
 */

export type Portal = 'admin' | 'teacher' | 'parent' | 'student';

export interface PortalUser {
  portal: Portal;
  email: string;
  password: string;
  /** Realm role expected in the session after login (asserted by the setup; INV-1 portal isolation). */
  expectedRole: string;
  /** Landing path after a successful login — MIRRORS `PORTAL_LANDING` in `apps/web/src/middleware.ts`. */
  landing: string;
}

/**
 * The default demo password shared by the rich `voltaire-demo` accounts
 * (`Demo!2024Pilotage`, realm min-length-12 policy). The simple per-portal
 * accounts use `Changeme123!`.
 */
const DEMO_PASSWORD = 'Demo!2024Pilotage';
const SIMPLE_PASSWORD = 'Changeme123!';

interface PortalDefaults {
  email: string;
  password: string;
  expectedRole: string;
  landing: string;
}

/**
 * Per-portal defaults. `expectedRole` + `landing` are NOT env-overridable (they
 * are product invariants asserted by the setup); only email/password are.
 */
const PORTAL_DEFAULTS: Record<Portal, PortalDefaults> = {
  // The rich-data demo admin (full `voltaire-demo`). `school_admin` realm role.
  admin: {
    email: 'mme.dupont@voltaire.fr',
    password: DEMO_PASSWORD,
    expectedRole: 'school_admin',
    landing: '/admin/dashboard',
  },
  // The simple per-portal teacher (project-context §6). No rich graph needed for S1.
  teacher: {
    email: 'teacher@pilotage.local',
    password: SIMPLE_PASSWORD,
    expectedRole: 'teacher',
    landing: '/teacher/dashboard',
  },
  // The rich-data demo parent (`seed-demo-parent.ts`) — carries the J1 alert graph.
  parent: {
    email: 'parent.demo@voltaire.fr',
    password: DEMO_PASSWORD,
    expectedRole: 'parent',
    landing: '/parent/dashboard',
  },
  // The E8 student (operator-activated). Fixture-ready; journeys land in a later epic.
  student: {
    email: 'student@pilotage.local',
    password: SIMPLE_PASSWORD,
    expectedRole: 'student',
    landing: '/student/dashboard',
  },
};

/** Resolve a `PortalUser`, applying the `E2E_<PORTAL>_*` env override on top of the demo default. */
export function portalUser(portal: Portal): PortalUser {
  const d = PORTAL_DEFAULTS[portal];
  const KEY = portal.toUpperCase();
  return {
    portal,
    email: process.env[`E2E_${KEY}_EMAIL`] ?? d.email,
    password: process.env[`E2E_${KEY}_PASSWORD`] ?? d.password,
    expectedRole: d.expectedRole,
    landing: d.landing,
  };
}

export const PORTALS: ReadonlyArray<Portal> = ['admin', 'teacher', 'parent', 'student'];

/**
 * The portals the setup project actually authenticates THIS slice.
 *
 * S1 ships only the parent grade→alert journey + the parent a11y smoke, so the
 * setup authenticates ONLY `parent` — this keeps the setup from spuriously
 * failing on a stack where the `teacher@pilotage.local` / admin demo accounts are
 * not (yet) provisioned, while a real parent-auth break still fails loudly.
 * S2 adds `admin` (child-claim→approval), S3 adds `teacher` (messaging); they
 * extend this list (the `portalUser`/fixture machinery is already all-four-ready).
 */
export const ACTIVE_PORTALS: ReadonlyArray<Portal> = ['parent'];

/** Path to a role's cached storage-state file (git-ignored, regenerated per run). */
export function storageStatePath(portal: Portal): string {
  return `tests/e2e/.auth/${portal}.json`;
}
