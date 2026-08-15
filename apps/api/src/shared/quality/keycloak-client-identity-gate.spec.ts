import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PORTAL_CLIENT_IDS,
  buildResetCredentialsUrl,
  portalCallbackPath,
  portalClientId,
  portalResetRedirectPath,
  resolvePortalClientId,
} from '../../../../web/src/lib/keycloak-clients';
import { PORTAL_IDS, type PortalId } from '../../../../web/src/lib/portals';

/**
 * S-E01-4a / PF-18 — the per-portal OIDC client identity gate (AC-6).
 *
 * WHAT PF-18 IS, AND WHY NEITHER HALF IS VISIBLE TO A ROUTE OR LINK CHECK
 * ----------------------------------------------------------------------
 * Until this slice the student portal had no OIDC client of its own. `auth.ts`
 * aliased `student → parent` through a `CLIENT_PORTAL_OVERRIDE` map, and
 * `PortalLoginForm.tsx` carried a SECOND, hard-coded copy of the same alias used
 * to build the Keycloak `reset-credentials` link. Two consequences, and the
 * cheap-looking one is not the dangerous one:
 *
 *   • BROKEN (loud)   `portal-parent` registers redirect URIs for `/parent/*`
 *                     only, so `signIn('keycloak-student')` and the student reset
 *                     link both asked Keycloak to redirect somewhere the client
 *                     does not declare → `invalid_redirect_uri`. Student SSO
 *                     login and student password reset were both dead.
 *   • BROKEN_SECURITY (silent)  a student's token carried `azp = portal-parent`,
 *                     i.e. it was indistinguishable, at the client-identity
 *                     level, from a parent's.
 *
 * WHY THIS GATE EXISTS RATHER THAN A FIXED LIST OF URIs
 * ----------------------------------------------------
 * The tempting repair for the loud half is to add `/student/*` to
 * **`portal-parent`'s** redirect list. That makes the symptom disappear and
 * leaves `azp` collapsed — a green light over an unfixed BROKEN_SECURITY. So the
 * refusal of that specific repair is an assertion here, by name (AC-2), not a
 * convention anybody has to remember.
 *
 * Everything the gate needs is DERIVED by calling the same production accessor
 * the application calls (`apps/web/src/lib/keycloak-clients.ts`) — never re-typed
 * here. That is the whole point: a re-typed expectation is a second list, and two
 * hand-maintained lists drift (the `project-paired-lists-drift` lesson, and the
 * very defect this slice closes). If the naming convention changes, this gate
 * follows it automatically; if the convention changes for only ONE of the two
 * seams, this gate goes red.
 *
 * PATHS, NOT ORIGINS — and that is deliberate, not a weakening
 * -----------------------------------------------------------
 * Every URI in the realm export is registered on `http://localhost:3000`, while
 * `apps/web` dev runs on **3100** (`package.json` → `next dev --port 3100`). An
 * origin-exact assertion would therefore go red on admin, teacher AND parent —
 * three clients this slice does not touch — and the only way back to green would
 * be hand-typing an origin into the export. That is the same two-lists trap in a
 * new costume. The origin is a deployment concern (`infra/kc-prod-redirects.mjs`
 * rewrites it per environment); the PATH is the contract between NextAuth and the
 * realm, and the path is what PF-18 got wrong. The origin mismatch is recorded as
 * PF-212 (the browser-origin reset link) and PF-213 (the `.env` port) rather than
 * smoothed over here.
 *
 * FAIL, NEVER SKIP
 * ----------------
 * A missing or unparseable realm export FAILS. `TOOL-13` and `DNC-08` are this
 * repository's own record of what a check that skips its way to green costs.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const REALM_EXPORT = resolve(REPO_ROOT, 'infra/keycloak/realm-export.json');
const KEYCLOAK_CLIENTS_TS = resolve(REPO_ROOT, 'apps/web/src/lib/keycloak-clients.ts');
const AUTH_TS = resolve(REPO_ROOT, 'apps/web/src/auth.ts');

type RealmClient = {
  clientId?: string;
  redirectUris?: string[];
};
type Realm = {
  clients?: RealmClient[];
  roles?: { realm?: Array<{ name?: string }> };
};

/** The path half of a registered redirect URI. Relative entries are returned as-is. */
function uriPath(uri: string): string {
  try {
    return new URL(uri).pathname;
  } catch {
    return uri;
  }
}

/**
 * Does a registered redirect URI cover a required path? Keycloak's `*` is a
 * trailing wildcard, so `/student/*` covers `/student/login`. Anything else must
 * match exactly — a wildcard is the only widening this gate accepts.
 */
function covers(registered: string, required: string): boolean {
  const path = uriPath(registered);
  if (path.endsWith('/*')) return required.startsWith(path.slice(0, -1));
  if (path === '/*') return true;
  return path === required;
}

/** Every path that belongs to a portal, derived — the gate writes no literal. */
function pathsOwnedBy(portal: PortalId): string[] {
  return [portalCallbackPath(portal), portalResetRedirectPath(portal)];
}

/**
 * The audit, as a pure function of the realm document, so the negative controls
 * below can run it against MUTATED copies. A gate that has never been shown to
 * fail is a gate nobody has tested.
 */
function auditRealm(realm: Realm): string[] {
  const violations: string[] = [];
  const clients = realm.clients ?? [];

  const byId = new Map<string, RealmClient>();
  for (const c of clients) if (c.clientId) byId.set(c.clientId, c);

  // AC-6 (a) — a distinct client exists for every portal.
  const seen = new Map<string, PortalId>();
  for (const portal of PORTAL_IDS) {
    const id = PORTAL_CLIENT_IDS[portal];
    if (!byId.has(id)) {
      violations.push(`portal '${portal}' has no client '${id}' in the realm export`);
      continue;
    }
    const previous = seen.get(id);
    if (previous) {
      violations.push(`portals '${previous}' and '${portal}' share the client '${id}'`);
    }
    seen.set(id, portal);
  }

  // AC-6 (b) — each client registers its OWN callback and reset redirect.
  for (const portal of PORTAL_IDS) {
    const client = byId.get(PORTAL_CLIENT_IDS[portal]);
    if (!client) continue;
    const registered = client.redirectUris ?? [];
    for (const required of pathsOwnedBy(portal)) {
      if (!registered.some((uri) => covers(uri, required))) {
        violations.push(
          `client '${client.clientId}' does not register '${required}' (portal '${portal}')`,
        );
      }
    }
  }

  // AC-2 — the forbidden repair. NO client may register a path owned by a portal
  // other than the one it serves. This is what refuses "just add /student/* to
  // portal-parent", which would hide the symptom and leave `azp` collapsed.
  for (const client of clients) {
    if (!client.clientId) continue;
    const owner = PORTAL_IDS.find((p) => PORTAL_CLIENT_IDS[p] === client.clientId);
    for (const uri of client.redirectUris ?? []) {
      for (const other of PORTAL_IDS) {
        if (other === owner) continue;
        const trespass = pathsOwnedBy(other).some((required) => covers(uri, required));
        if (trespass) {
          violations.push(
            `client '${client.clientId}' registers '${uri}', which belongs to portal '${other}'`,
          );
        }
      }
    }
  }

  // ADR-021 rests authorization ENTIRELY on the realm role, and
  // `keycloak-admin.service.ts#assignRealmRoles` THROWS `Unknown realm roles: …`
  // rather than creating a missing one — so a portal whose role is absent cannot
  // have a single account provisioned. The role's PRESENCE is asserted here; that
  // no identity yet HOLDS it is PF-210, which this gate deliberately cannot see.
  const realmRoles = new Set((realm.roles?.realm ?? []).map((r) => r.name));
  for (const portal of PORTAL_IDS) {
    if (portal === 'admin') continue; // served by super_admin / school_admin, not a `admin` role
    if (!realmRoles.has(portal)) {
      violations.push(`realm role '${portal}' is not declared, so no ${portal} can be provisioned`);
    }
  }

  return violations;
}

function loadRealm(): Realm {
  // FAIL, never skip.
  expect(existsSync(REALM_EXPORT)).toBe(true);
  const raw = readFileSync(REALM_EXPORT, 'utf8');
  let parsed: Realm;
  try {
    parsed = JSON.parse(raw) as Realm;
  } catch (error) {
    throw new Error(`realm-export.json is unparseable: ${(error as Error).message}`);
  }
  expect(Array.isArray(parsed.clients)).toBe(true);
  expect((parsed.clients ?? []).length).toBeGreaterThan(0);
  return parsed;
}

describe('S-E01-4a / PF-18 — per-portal OIDC client identity (G-AUTHZ, G-PORTAL)', () => {
  const realm = loadRealm();

  it('AC-6 — the shipped realm export satisfies every portal-identity invariant', () => {
    expect(auditRealm(realm)).toEqual([]);
  });

  // ---- negative controls: the gate must BITE, or it is decoration -----------

  it('AC-1 negative control — removing `portal-student` turns the gate RED', () => {
    const mutant: Realm = {
      ...realm,
      clients: (realm.clients ?? []).filter((c) => c.clientId !== portalClientId('student')),
    };
    expect(auditRealm(mutant)).toContain(
      "portal 'student' has no client 'portal-student' in the realm export",
    );
  });

  it('AC-2 negative control — the FORBIDDEN repair (adding /student/* to portal-parent) is refused BY NAME', () => {
    const mutant: Realm = {
      ...realm,
      clients: (realm.clients ?? []).map((c) =>
        c.clientId === portalClientId('parent')
          ? {
              ...c,
              redirectUris: [
                ...(c.redirectUris ?? []),
                'http://localhost:3000/student/*',
                `http://localhost:3000${portalCallbackPath('student')}`,
              ],
            }
          : c,
      ),
    };
    const violations = auditRealm(mutant);
    expect(violations.join('\n')).toMatch(/client 'portal-parent' registers .*belongs to portal 'student'/);
  });

  it('AC-6 negative control — dropping a callback URI turns the gate RED', () => {
    const required = portalCallbackPath('teacher');
    const mutant: Realm = {
      ...realm,
      clients: (realm.clients ?? []).map((c) =>
        c.clientId === portalClientId('teacher')
          ? { ...c, redirectUris: (c.redirectUris ?? []).filter((u) => uriPath(u) !== required) }
          : c,
      ),
    };
    expect(auditRealm(mutant)).toContain(
      `client 'portal-teacher' does not register '${required}' (portal 'teacher')`,
    );
  });

  it('PF-210 negative control — dropping the `student` realm role turns the gate RED', () => {
    const mutant: Realm = {
      ...realm,
      roles: { realm: (realm.roles?.realm ?? []).filter((r) => r.name !== 'student') },
    };
    expect(auditRealm(mutant)).toContain(
      "realm role 'student' is not declared, so no student can be provisioned",
    );
  });

  // ---- AC-3 / AC-4: the two seams cannot diverge, and no alias survives -----

  describe('AC-3 / DNC-10 — the login client id and the reset client id are ONE value', () => {
    const ENVS: Array<[string, Record<string, string | undefined>]> = [
      ['no override', {}],
      ['student overridden', { KEYCLOAK_STUDENT_CLIENT_ID: 'tenant-a-student' }],
      ['parent overridden', { KEYCLOAK_PARENT_CLIENT_ID: 'tenant-a-parent' }],
      ['blank override is ignored', { KEYCLOAK_STUDENT_CLIENT_ID: '   ' }],
    ];

    it.each(ENVS)('under "%s", both seams resolve identically for all four portals', (_label, env) => {
      for (const portal of PORTAL_IDS) {
        // The login seam (`auth.ts#clientCreds`) and the reset seam (the login
        // pages' `buildResetCredentialsUrl`) are driven through the SAME call.
        const loginClientId = resolvePortalClientId(portal, env);
        const resetUrl = buildResetCredentialsUrl({
          keycloakUrl: 'http://kc.example',
          realm: 'pilotage-scolaire',
          clientId: resolvePortalClientId(portal, env),
          origin: 'https://app.example',
          portal,
        });
        expect(new URL(resetUrl).searchParams.get('client_id')).toBe(loginClientId);
      }
    });

    it('an override on one portal never moves another portal', () => {
      const env = { KEYCLOAK_STUDENT_CLIENT_ID: 'tenant-a-student' };
      expect(resolvePortalClientId('student', env)).toBe('tenant-a-student');
      for (const other of PORTAL_IDS.filter((p) => p !== 'student')) {
        expect(resolvePortalClientId(other, env)).toBe(portalClientId(other));
      }
    });
  });

  it('AC-4 — no portal resolves to another portal’s client, under any portal pairing', () => {
    for (const portal of PORTAL_IDS) {
      const resolved = resolvePortalClientId(portal, {});
      for (const other of PORTAL_IDS.filter((p) => p !== portal)) {
        expect(resolved).not.toBe(portalClientId(other));
      }
    }
  });

  it('AC-4 ratchet — the `CLIENT_PORTAL_OVERRIDE` alias may not come back to `auth.ts`', () => {
    expect(readFileSync(AUTH_TS, 'utf8')).not.toMatch(/CLIENT_PORTAL_OVERRIDE/);
  });

  it('AC-3 — the shared module reachable from the browser holds NO client secret', () => {
    const source = readFileSync(KEYCLOAK_CLIENTS_TS, 'utf8');
    expect(source).not.toMatch(/CLIENT_SECRET/);
    expect(source).not.toMatch(/clientSecret/);
  });
});
