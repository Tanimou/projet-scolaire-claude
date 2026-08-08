import { isIP } from 'node:net';

import { type KeycloakJwtPayload } from '../auth/jwt.strategy';

/**
 * S-E04-1 — THE single home of audit provenance for `apps/api`.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before this slice the answer to *« qui a agi, et par quel portail ? »* was
 * written **four** times in production code: the canonical mapper in the
 * `alerts` feature module, two anonymous inline copies (`analytics.controller`,
 * `grades.controller` — the second of which recorded a `parent` actor as having
 * acted in the `admin` portal), and eight sites that wrote the literal
 * `actorRole: 'school_admin'` with no derivation at all. A guard stated over the
 * *identifier* would have passed over the two anonymous copies — that is exactly
 * what `S-E06-5` measured on `PORTAL_LANDING`. `shared/quality/audit-provenance-gate.spec.ts`
 * is therefore stated over the **invariant**: no other file under `apps/api/src`
 * may decide an actor role from realm roles, whatever it calls the code that does.
 *
 * NO NEST MODULE, NO INTERCEPTOR, ON PURPOSE
 * ------------------------------------------
 * These are plain functions, like `shared/config` and `shared/release`. The
 * ruling recorded at `modules/calendar/calendar.controller.ts` stands:
 * *« Aucun intercepteur partagé n'est construit »*. A pure function that every
 * call site invokes explicitly is auditable by grep; an interceptor is a place a
 * future author can forget to apply. A Nest module here would also force ~26
 * feature modules to import it, which would be a new cross-cutting decision.
 *
 * DNC-10 — there is no off switch, and there is nothing switchable in scope.
 * This file reads no `process.env`, no `ConfigService`, no feature flag and no
 * `NODE_ENV`. See `docs/adr/ADR-036-client-provenance-behind-the-reverse-proxy.md`.
 */

/** Longueur maximale stockée dans `AuditLog.userAgent` (colonne `String?`). */
export const MAX_USER_AGENT_LENGTH = 512;

/**
 * Provenance complète d'une ligne d'audit.
 *
 * Les quatre champs sont nullables pour refléter les colonnes `String?` /
 * `@db.Inet` de `AuditLog` : un appelant non reconnu produit une ligne d'audit
 * valide (best-effort) plutôt que de faire échouer l'opération qu'elle trace.
 */
export interface AuditProvenance {
  actorRole: string | null;
  portal: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * La moitié rôle/portail seulement — ce que consomment les sites d'écriture qui
 * ne capturent aucune IP. C'est le type par lequel les services élargissent leur
 * paramètre `actor` (`imports.service`, `integrations.service`) : les deux champs
 * sont **non optionnels**, donc un appelant oublié est une erreur de compilation
 * et non une provenance silencieusement nulle à l'exécution.
 */
export type AuditActorProvenance = Pick<AuditProvenance, 'actorRole' | 'portal'>;

/**
 * Normalise une adresse IP avant qu'elle n'entre dans la transaction.
 *
 * `AuditLog.ipAddress` est une colonne `@db.Inet` : PostgreSQL **rejette** une
 * valeur non-inet (un `X-Forwarded-For` en « a, b, c », par exemple). Comme la
 * ligne d'audit est écrite DANS la même transaction que l'import (gate
 * G-AUDIT), un cast raté ferait rouler en arrière un import parfaitement
 * valide : l'hygiène deviendrait un mode de panne pour l'écriture qu'elle est
 * censée tracer. On assainit donc **avant** d'ouvrir la transaction, et une
 * valeur non-inet devient `null` (une provenance absente, jamais une provenance
 * fausse).
 */
export function sanitiseInetOrNull(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const candidate = raw.trim();
  if (candidate.length === 0) return null;
  return isIP(candidate) === 0 ? null : candidate;
}

/** Tronque le user-agent ; `null` si absent ou vide. */
export function truncateUserAgent(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const candidate = raw.trim();
  if (candidate.length === 0) return null;
  return candidate.slice(0, MAX_USER_AGENT_LENGTH);
}

// Precedence: the highest-privilege realm role the caller holds wins, so a
// super_admin acting through any surface is attributed as super_admin (not the
// formerly hardcoded school_admin). Mirrors permissions.constants.ts role keys.
//
// DELIBERATELY NOT `REALM_ROLES` from `@pilotage/contracts`
// (`packages/contracts/src/enums/index.ts`): that array is the *set* of realm
// roles, this one is an *ordering* that encodes privilege. They coincide today
// by accident. Importing the contract array would make a harmless reorder of a
// display list silently reorder audit attribution — so do not "simplify" this
// into a shared import. Membership drift is caught by the guard spec, not by
// aliasing two different concepts onto one declaration.
const ROLE_PRECEDENCE = ['super_admin', 'school_admin', 'teacher', 'parent'] as const;

// `portal` derived from the role is an ATTRIBUTION, not an OBSERVATION — a large
// improvement on the literal `'admin'` it replaces, and still not a measurement of
// the surface the request came through: a `school_admin` calling a teacher-portal
// endpoint records `admin`, and an ADR-015 custom DB role can let a realm
// `teacher` hold `roles.write` and so record `teacher` for an admin-portal action.
// The truthful source would be the token's `azp` claim (Keycloak issues
// `portal-admin` / `portal-teacher` / `portal-parent` / `api-backend`, ADR-004).
// It is deliberately NOT adopted here: `azp` is optional in the payload type, no
// test in this repository drives a real token, and an absent `azp` would need this
// mapping as a fallback anyway — so adopting it now would add a second source of
// truth without removing the first. Stated posture, not an unnoticed gap; see
// `ADR-036` D6, and `S-E04-3` is the natural place to revisit it.
const ROLE_PORTAL: Record<(typeof ROLE_PRECEDENCE)[number], string> = {
  super_admin: 'admin',
  school_admin: 'admin',
  teacher: 'teacher',
  parent: 'parent',
};

/**
 * Pure mapper from the authenticated caller's JWT to the audit provenance —
 * **the canonical one**. Reads realm roles exactly as `PermissionsGuard` does
 * (`jwt.realm_access?.roles ?? []`). When the caller holds none of the four
 * known roles, falls back to the first realm role string (or null) with a null
 * portal — never throws, so it is safe inside the best-effort audit path.
 *
 * `ipAddress` and `userAgent` are returned **`null`, unconditionally, by
 * decision — not as a stub and not as a defect** (`ADR-036` D4/D5). The API
 * cannot see the operator's address or browser today: `apps/api/src/main.ts`
 * sets no `trust proxy` (0 occurrences repo-wide), so Express `req.ip` is the
 * socket peer — and on every UI-driven write that peer is the **web container**,
 * one constant address shared by every actor forever, while undici sends no
 * user-agent of the operator's browser. Storing it would put a *wrong* value in
 * a governance trail that `/admin/audit` renders as « where the admin acted
 * from ». Null rather than wrong. **`S-E04-3` owns making them real**, by
 * forwarding them from `apps/web` and applying `ADR-036`'s pinned hop count.
 *
 * The second parameter exists so `S-E04-3` can narrow it (to the already-extracted
 * `{ ipAddress, userAgent }` hints of `ADR-036` D5) without re-signing every call
 * site. It is **deliberately unread** — the leading underscore is the repo's
 * ESLint `argsIgnorePattern`. `provenance.spec.ts` drives this function with a
 * value carrying both an IP and a user-agent and asserts both come back `null`;
 * that test is what makes the rule enforceable rather than aspirational.
 */
export function deriveAuditProvenance(jwt: KeycloakJwtPayload, _req?: unknown): AuditProvenance {
  const realmRoles = jwt.realm_access?.roles ?? [];
  const primary = ROLE_PRECEDENCE.find((role) => realmRoles.includes(role));
  if (primary) {
    return {
      actorRole: primary,
      portal: ROLE_PORTAL[primary],
      ipAddress: null,
      userAgent: null,
    };
  }
  return { actorRole: realmRoles[0] ?? null, portal: null, ipAddress: null, userAgent: null };
}

/**
 * Kept for the call sites that only consume the role/portal half. **Delegates —
 * it declares nothing of its own.** If a second `find(...)` over a role array
 * ever appears in this function, AC-1 is violated by the very file that exists
 * to end the duplication.
 */
export function deriveAlertActorProvenance(jwt: KeycloakJwtPayload): AuditActorProvenance {
  const { actorRole, portal } = deriveAuditProvenance(jwt);
  return { actorRole, portal };
}
