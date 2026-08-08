import { isIP } from 'node:net';

import { type KeycloakJwtPayload } from '../auth/jwt.strategy';

// TYPE-ONLY, and that matters twice. `client-hints.ts` imports the two
// sanitisers from this file, so a value import here would close a runtime
// require() cycle; `import type` is erased entirely, so no cycle exists in the
// emitted CJS. And it keeps this file's promise literally true — a type carries
// no header read into scope.
import type { AuditClientHints } from './client-hints';

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
// `ADR-036` D6. REVISITED BY `S-E04-3` and deliberately NOT adopted: that slice
// makes the *client* provenance real (address, browser) — an observation of the
// transport — while `azp` is an observation of the OIDC client, and adopting it
// in the same diff would have coupled two unrelated corrections and still needed
// this mapping as its fallback. Recorded in the `ADR-036` append, in writing.
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
 * `ipAddress` and `userAgent` are **passed through, already extracted and
 * already sanitised** (`ADR-036` D5). Until `S-E04-3` this parameter was typed
 * `unknown` and deliberately unread, and both fields came back `null`
 * unconditionally *by decision* — because the API could not see the operator at
 * all: `main.ts` set no `trust proxy`, so `req.ip` was the socket peer, and on
 * every UI-driven write that peer was the **web container**, one constant
 * address shared by every actor forever. That is no longer the state of the
 * world, and this docblock says so rather than asserting the opposite of the
 * code beneath it: `S-E04-3` pinned the hop count from a refusing configuration
 * key, and `apps/web` now forwards the operator's real address and browser from
 * two shared seams.
 *
 * What did **not** change is why this function takes hints instead of a request.
 * `shared/audit/client-hints.ts` is the one place that reads a header or a
 * socket address; this file still reads none, so `DNC-10` remains a property of
 * its *shape* — there is no switch to find because nothing switchable is in
 * scope. Narrowing the second parameter was the one-line change `ADR-036` D5
 * reserved it for, and **no call site re-signed**.
 *
 * Omitting the hints still yields `null`/`null`, which is the same honest blank
 * as before and never an invented value. A caller that genuinely has no request
 * in scope should pass `NO_CLIENT_HINTS` rather than nothing, so the absence is
 * written down where the next reader can see it.
 */
export function deriveAuditProvenance(
  jwt: KeycloakJwtPayload,
  hints?: AuditClientHints,
): AuditProvenance {
  // `?? null` and nothing else: this function never invents, normalises or
  // re-derives a provenance value — the sanitisers ran in the extraction seam,
  // before the transaction opened (`S-E06-6`'s reason).
  const ipAddress = hints?.ipAddress ?? null;
  const userAgent = hints?.userAgent ?? null;
  const realmRoles = jwt.realm_access?.roles ?? [];
  const primary = ROLE_PRECEDENCE.find((role) => realmRoles.includes(role));
  if (primary) {
    return {
      actorRole: primary,
      portal: ROLE_PORTAL[primary],
      ipAddress,
      userAgent,
    };
  }
  return { actorRole: realmRoles[0] ?? null, portal: null, ipAddress, userAgent };
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
