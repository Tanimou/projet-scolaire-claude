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

/* -------------------------------------------------------------------------- *
 * S-E01-4b — the RATCHET, and its anti-drift closure (ADR-052)
 * -------------------------------------------------------------------------- *
 *
 * WHY THIS BLOCK EXISTS AND WHY IT IS NOT REDUNDANT WITH THE ONE ABOVE
 * -------------------------------------------------------------------
 * Everything above runs inside the api jest suite, and `scripts/ci-gate.sh:330`
 * defines `GATE_MACHINERY='^(scripts/|\.github/|infra/|apps/api/src/shared/quality/)'`
 * with an else-branch that runs `test:api --skip src/shared/quality/`. MEASURED
 * against that regex: `apps/web/src/lib/keycloak-clients.ts` → no match,
 * `apps/web/src/auth.ts` → no match, `apps/web/src/lib/portals.ts` → no match. So
 * a fast-tier PR that reintroduces the PF-18 alias IN THE ACCESSOR ITSELF does not
 * run one line of the suite above. That is the hole `scripts/keycloak-client-check.js`
 * closes, and this block is what keeps the script honest and wired.
 *
 * THE CLOSURE: TWO INDEPENDENT DERIVATIONS, NEITHER HAND-TYPED
 * -----------------------------------------------------------
 * The script reaches the rule by TRANSPILING AND EVALUATING the accessor
 * (ADR-052 §D1 — a constant-lifting parse is blind to an alias inside a function
 * body, which is PF-18's actual shape). This spec reaches the same rule through
 * the COMPILER, via the real `import` at the top of this file. Deep equality
 * between them is the closure: if the script's evaluation ever drifts from what
 * the application actually computes, this goes red, and neither side is a
 * hand-maintained list.
 */

/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const keycloakClientCheck = require(
  resolve(REPO_ROOT, 'scripts', 'keycloak-client-check.js'),
) as {
  deriveRule: () => {
    portals: string[];
    clientIds: Record<string, string>;
    providerIds: Record<string, string>;
    callbackPaths: Record<string, string>;
    legacyCallbackPaths: Record<string, string>;
    resetRedirectPaths: Record<string, string>;
    declaredClientIds: Record<string, string>;
  };
  PORTAL_FLOOR: readonly string[];
  ADR_REL: string;
};

const CI_GATE = resolve(REPO_ROOT, 'scripts/ci-gate.sh');
const CI_YML = resolve(REPO_ROOT, '.github/workflows/ci.yml');
const CHECK_SCRIPT = resolve(REPO_ROOT, 'scripts/keycloak-client-check.js');
const CHECK_INVOCATION = 'node scripts/keycloak-client-check.js';

/** The same map, built from the COMPILER-CHECKED import rather than from the script. */
function compiledMap(project: (portal: PortalId) => string): Record<string, string> {
  return Object.fromEntries(PORTAL_IDS.map((portal) => [portal, project(portal)]));
}

describe('S-E01-4b / ADR-052 — the OIDC client identity ratchet (G-AUTHZ, G-DNC, G-PORTAL)', () => {
  const derived = keycloakClientCheck.deriveRule();

  it('AC-2 — the script DERIVES the rule; its evaluation equals the compiled accessor exactly', () => {
    expect(derived.portals).toEqual([...PORTAL_IDS]);
    expect(derived.clientIds).toEqual(compiledMap(portalClientId));
    expect(derived.clientIds).toEqual({ ...PORTAL_CLIENT_IDS });
    expect(derived.declaredClientIds).toEqual({ ...PORTAL_CLIENT_IDS });
    expect(derived.callbackPaths).toEqual(compiledMap(portalCallbackPath));
    expect(derived.resetRedirectPaths).toEqual(compiledMap(portalResetRedirectPath));
  });

  it('AC-2 — the vacuity floor covers every portal, so a shrunken PORTAL_IDS cannot pass', () => {
    // Deleting `'student'` from PORTAL_IDS would otherwise shrink the script's
    // whole domain to three portals and pass over a deleted portal (ADR-052 §D2).
    for (const portal of PORTAL_IDS) {
      expect(keycloakClientCheck.PORTAL_FLOOR).toContain(portal);
    }
  });

  it('AC-3 — ci-gate.sh runs the script, in TIER 1, OUTSIDE the CODE_RE block', () => {
    const gate = readFileSync(CI_GATE, 'utf8');
    expect(gate).toContain(CHECK_INVOCATION);

    // The stage form every meta-test asserts: `run_stage <numeric timeout> "<name>" …`
    // (ci-gate.sh exits 64 on a non-numeric bound).
    expect(gate).toMatch(/run_stage\s+\d+\s+"keycloak client identity[^"]*"\s+node scripts\/keycloak-client-check\.js/);

    // OUTSIDE tier 2. `infra/keycloak/realm-export.json` matches NO branch of
    // CODE_RE (measured), so a stage inside that block would not run on a diff
    // that deletes portal-student from the export — the hole in a new costume.
    const stageAt = gate.indexOf(CHECK_INVOCATION);
    const codeReAt = gate.indexOf('CODE_RE=');
    const fullAt = gate.indexOf('if [ "$MODE" = full ]');
    expect(stageAt).toBeGreaterThan(-1);
    expect(codeReAt).toBeGreaterThan(-1);
    expect(stageAt).toBeLessThan(codeReAt);
    // …and outside --full: this is a fast-tier stage, not a release-only one.
    expect(fullAt).toBeGreaterThan(-1);
    expect(stageAt).toBeLessThan(fullAt);
  });

  it('AC-3 — the stage names its ADR by filename and carries the ci.yml anti-drift note, adjacently', () => {
    const gate = readFileSync(CI_GATE, 'utf8');
    const stageAt = gate.indexOf(CHECK_INVOCATION);
    const block = gate.slice(Math.max(0, stageAt - 1400), stageAt);
    // Named BY FILENAME, so the decision is one grep away from the stage.
    expect(block).toContain('ADR-052-oidc-client-identity-ratchet.md');
    // S-E02-2 AC-4: the note lives WITHIN the same comment block, not at the top
    // of the file, so it stays adjacent when the stage moves.
    expect(block).toContain(
      'Kept in step with .github/workflows/ci.yml — the two must not drift (S-E02-2 AC-4).',
    );
    // The reason the stage exists, quoting the hole it closes.
    expect(block).toContain('GATE_MACHINERY');
  });

  it('AC-3 — .github/workflows/ci.yml runs it too, and BLOCKING (ci.yml never calls ci-gate.sh)', () => {
    const workflow = readFileSync(CI_YML, 'utf8');
    expect(workflow).toContain(`- run: ${CHECK_INVOCATION}`);
    expect(workflow).not.toContain('bash scripts/ci-gate.sh');
    // DNC-10: no failure-tolerating key anywhere near the step.
    const stepAt = workflow.indexOf(`- run: ${CHECK_INVOCATION}`);
    const around = workflow.slice(stepAt, stepAt + 400);
    expect(around).not.toContain('continue-on-error');
    // The mirrored step names its sibling, so a future edit to one is a visible
    // omission in the other.
    const before = workflow.slice(Math.max(0, stepAt - 1400), stepAt);
    expect(before).toContain('Kept in step with scripts/ci-gate.sh stage 0d-ter');
  });

  it('AC-1 / DNC-10 — the script has no bypass flag, no skip env var and no fail-open branch', () => {
    const source = readFileSync(CHECK_SCRIPT, 'utf8');
    // No environment variable can change the verdict. (`process.env` appears in
    // this file only inside the message that REFUSES a process.env read in the
    // accessor, so the assertion targets a property ACCESS, not the substring.)
    expect(source).not.toMatch(/process\.env\s*[.[]/);
    // No baseline file, no update switch, no skip switch: the only argument is
    // --help and anything else exits non-zero.
    expect(source).toContain('unknown argument(s)');
    expect(source).not.toMatch(/argv\.includes\('--(skip|force|update)'\)/);
    // It must be able to exit non-zero, and must not exit 0 on a caught failure.
    expect(source).toContain('process.exit(1)');
    expect(source).not.toMatch(/process\.exit\(0\)/);
    // CLI behind the module guard, so requiring it from this spec runs no CLI.
    expect(source).toContain('if (require.main === module) main();');
  });

  it('AC-1 — the script audits BOTH artefacts, and a missing client is a failure, not a skip (DNC-08)', () => {
    const source = readFileSync(CHECK_SCRIPT, 'utf8');
    expect(source).toContain('infra/keycloak/realm-export.json');
    expect(source).toContain('infra/kc-prod-redirects.mjs');
    // The original defect: `client not found (skipped)` then exit 0.
    expect(source).toContain('treats a missing client as a benign skip');
  });
});
