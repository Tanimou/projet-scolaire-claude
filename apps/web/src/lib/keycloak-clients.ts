/**
 * Portal → Keycloak OIDC client identity, written exactly ONCE (S-E01-4a / PF-18,
 * ADR-050 — which supersedes ADR-021's "the student portal reuses `portal-parent`"
 * clause).
 *
 * Why this module exists. The rule "which OIDC client does portal X speak to?"
 * used to live in TWO places: `auth.ts` (server-side, with an opt-in
 * `KEYCLOAK_<PORTAL>_CLIENT_ID` env override) and `PortalLoginForm.tsx` (a
 * hard-coded template literal used to build the Keycloak `reset-credentials`
 * link). The two copies had ALREADY diverged: `auth.ts` honoured the env
 * override, the form did not — so an operator who took the documented escape
 * hatch got a login on the new client and a password-reset link still pointing at
 * the old one, silently. Both copies also carried the same alias
 * (`student → parent`), which collapsed `azp` for the student portal: a student's
 * token was indistinguishable from a parent's. That is why PF-18 was classified
 * BROKEN_SECURITY and not merely BROKEN_LINK.
 *
 * What breaks without this module: the alias comes back, at a second address, and
 * nothing fails. The invariant it encodes is that a client id is a **function of
 * the portal alone** — no portal can ever resolve to another portal's client, and
 * the env override can only ever change the id of the SAME portal. A
 * `Record<Portal, Portal>` alias map is deliberately absent: an empty one types a
 * cross-portal entry as legal, which is PF-18 waiting at a new address.
 *
 * Deliberately import-free apart from the `PortalId` type, and deliberately
 * `process.env`-free: `env` is a PARAMETER of `resolvePortalClientId`, never read
 * from inside. That is what lets a gate drive the real production accessor under
 * three env fixtures instead of re-typing the rule. It is modelled on
 * `./portals.ts` — same reason it is not in `packages/contracts` (PF-101): that
 * package builds to CJS and is shared with the api/worker runtimes, neither of
 * which has any use for a Next route or an OIDC client id, and its own `PORTALS`
 * still declares three portals.
 *
 * No client credential lives here and none ever may: this module is reachable
 * from a `'use client'` component, and the reset link needs only a `client_id`.
 * The per-client password stays a server-side `process.env` read inside
 * `auth.ts` — which is why this file contains no `..._CLIENT_S…` lookup at all.
 */

import { PORTAL_IDS, type PortalId } from './portals';

/** The one place the `portal-<id>` naming convention is written. */
const CLIENT_ID_PREFIX = 'portal-';

/** The one place the NextAuth Keycloak provider naming convention is written. */
const PROVIDER_ID_PREFIX = 'keycloak-';

/** The realm client a portal owns, before any operator override. */
export function portalClientId(portal: PortalId): string {
  return `${CLIENT_ID_PREFIX}${portal}`;
}

/**
 * The NextAuth provider id for a portal (`auth.ts` registers one Keycloak
 * provider per portal). NextAuth derives the OAuth callback path from this id,
 * so it is the same rule as `portalCallbackPath` below and must not be re-typed.
 */
export function portalProviderId(portal: PortalId): string {
  return `${PROVIDER_ID_PREFIX}${portal}`;
}

/** The NextAuth OAuth callback the realm client must register. */
export function portalCallbackPath(portal: PortalId): string {
  return `/api/auth/callback/${portalProviderId(portal)}`;
}

/**
 * The legacy `/api/auth/callback/<portal>` URI the three pre-existing clients
 * carry. No provider id any code produces yields it (the provider id is
 * `keycloak-<portal>`), so it is kept for backward compatibility only — recorded
 * as PF-216, not relied on.
 *
 * (This comment cited PF-214 when it was written; PF-214 is the hard-coded
 * three-client list in `infra/kc-fix-redirects.mjs`, a different finding. Corrected
 * at land rather than left to become the TOOL-30 disease inside one diff.)
 */
export function portalLegacyCallbackPath(portal: PortalId): string {
  return `/api/auth/callback/${portal}`;
}

/** Where Keycloak sends the visitor back after a `reset-credentials` flow. */
export function portalResetRedirectPath(portal: PortalId): string {
  return `/${portal}/login`;
}

/** Every portal's default client id, enumerated — the gate reads THIS, not a list of its own. */
export const PORTAL_CLIENT_IDS: Readonly<Record<PortalId, string>> = Object.freeze(
  Object.fromEntries(PORTAL_IDS.map((portal) => [portal, portalClientId(portal)])) as Record<
    PortalId,
    string
  >,
);

/**
 * The accessor BOTH seams call: `auth.ts` (login, ROPC, refresh) and the four
 * `login/page.tsx` server components (the password-reset link).
 *
 * `env` is a parameter on purpose — passing `process.env` is the caller's job, so
 * the same function can be driven under a fixture env without a module reload,
 * and so this module stays edge-safe. An override may only ever rename the client
 * of the portal it names: there is no code path from portal A to portal B's id.
 */
export function resolvePortalClientId(
  portal: PortalId,
  env: Readonly<Record<string, string | undefined>> = {},
): string {
  const override = env[`KEYCLOAK_${portal.toUpperCase()}_CLIENT_ID`];
  const trimmed = typeof override === 'string' ? override.trim() : '';
  return trimmed.length > 0 ? trimmed : portalClientId(portal);
}

/**
 * The Keycloak `reset-credentials` URL. Assembled here so the query shape is
 * written once; the `origin` is supplied by the caller (the browser's real origin
 * on the client, so a reset link behind a proxy never hard-codes `localhost`).
 */
export function buildResetCredentialsUrl(args: {
  keycloakUrl: string;
  realm: string;
  clientId: string;
  origin: string;
  portal: PortalId;
}): string {
  const qs = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: `${args.origin}${portalResetRedirectPath(args.portal)}`,
  });
  return `${args.keycloakUrl}/realms/${args.realm}/login-actions/reset-credentials?${qs.toString()}`;
}
