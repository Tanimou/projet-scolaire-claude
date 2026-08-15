// =============================================================================
// Align the portal OIDC clients' redirect/web-origin URLs with the PRODUCTION
// public origin. The realm is imported once with localhost:3000 URLs; this makes
// the SSO (authorization-code) flow + password-reset redirects work on the real
// host. The primary login is ROPC (direct grant) and needs none of this, so a
// failure here is non-fatal — but we fix it so every path works.
//
// Idempotent: re-running just re-asserts the same URLs. Run on the `pilotage`
// docker network (so `keycloak:8080` resolves), e.g. via the seed/api image:
//   docker compose ... run --rm -e PUBLIC_BASE_URL=https://host seed \
//     node /app/infra/kc-prod-redirects.mjs
// =============================================================================
const KC = (process.env.KEYCLOAK_URL || 'http://keycloak:8080/auth').replace(/\/+$/, '');
const REALM = process.env.KEYCLOAK_REALM || 'pilotage-scolaire';
const ADMIN = process.env.KEYCLOAK_ADMIN || process.env.KEYCLOAK_ADMIN_USER || 'admin';
const PASS =
  process.env.KEYCLOAK_ADMIN_PASS || process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin';
const BASE = (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').replace(/\/+$/, '');

if (!BASE) {
  console.error('✗ PUBLIC_BASE_URL is required (e.g. https://pilotage.srv861861.hstgr.cloud)');
  process.exit(1);
}

// portal client → the URL path segment it owns.
//
// EXACTLY ONE segment per client (ADR-050 §D1, S-E01-4a AC-2c). This map used to
// read `'portal-parent': ['parent', 'student']`, which made the production realm
// hand `portal-parent` the student portal's redirect URIs: student SSO "worked",
// but every student token carried `azp: portal-parent`, so no audience check
// could ever tell a student from a parent (PF-18, PF-209). Binding two portals
// to one client is the wrong fix by construction — the loop below refuses it
// rather than trusting this literal to stay correct.
const CLIENTS = {
  'portal-admin': ['admin'],
  'portal-teacher': ['teacher'],
  'portal-parent': ['parent'],
  'portal-student': ['student'],
};

// The two callback paths NextAuth actually emits for a portal. `keycloak-<portal>`
// is the live provider id (`portalProviderId` in apps/web/src/lib/keycloak-clients.ts);
// the bare `<portal>` form is the legacy URI the three pre-existing clients carry
// (PF-214). Both are written out in full ON PURPOSE: the previous shape wildcarded
// the whole callback segment, which made every portal client a valid target for
// every other portal's callback — the same collapse as above, at a second address
// (ADR-050 §D4). Do not reintroduce a `*` anywhere under `/api/auth/callback/`.
const callbackPaths = (portal) => [
  `/api/auth/callback/keycloak-${portal}`,
  `/api/auth/callback/${portal}`,
];

async function adminToken() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: ADMIN,
      password: PASS,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.access_token) {
    console.error(`✗ no admin token (HTTP ${res.status})`, j);
    process.exit(1);
  }
  return j.access_token;
}

async function main() {
  const tok = await adminToken();
  const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
  let failures = 0;

  for (const [clientId, portals] of Object.entries(CLIENTS)) {
    // AC-2c, asserted here and not only in the gate: one client owns one portal.
    if (portals.length !== 1) {
      console.error(
        `✗ ${clientId} is bound to ${portals.length} portal segments (${portals.join(', ')}) — ` +
          `one client owns exactly one portal (ADR-050 §D1). Refusing to provision.`,
      );
      process.exit(1);
    }

    const list = await fetch(`${KC}/admin/realms/${REALM}/clients?clientId=${clientId}`, {
      headers: H,
    }).then((r) => r.json());
    const c = Array.isArray(list) ? list[0] : null;
    if (!c) {
      // Counted as a FAILURE, not a benign skip (DNC-08). This script aligns URLs,
      // it never creates clients — so a missing `portal-student` means the realm
      // predates ADR-050 and that portal cannot authenticate at all. The previous
      // version warned and exited 0, which is how the student portal stayed
      // unprovisioned while the run looked green. Rollout: ADR-050 §D3.
      console.error(`✗ client not found: ${clientId} — create it (or re-import the realm) before deploying that portal`);
      failures++;
      continue;
    }

    const redirectUris = [
      ...portals.map((p) => `${BASE}/${p}/*`),
      ...portals.flatMap((p) => callbackPaths(p).map((path) => `${BASE}${path}`)),
    ];
    const logout = portals.map((p) => `${BASE}/${p}/login`).join('##') + `##${BASE}/`;

    c.rootUrl = BASE;
    c.baseUrl = `/${portals[0]}`;
    c.redirectUris = redirectUris;
    c.webOrigins = [BASE];
    c.attributes = { ...(c.attributes || {}), 'post.logout.redirect.uris': logout };

    const put = await fetch(`${KC}/admin/realms/${REALM}/clients/${c.id}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify(c),
    });
    if (put.ok) {
      console.log(`✓ ${clientId} → ${JSON.stringify(redirectUris)}`);
    } else {
      failures++;
      console.error(`✗ ${clientId} update failed (HTTP ${put.status})`, await put.text());
    }
  }

  console.log(failures ? `done with ${failures} failure(s)` : 'done — all portal clients aligned');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('✗ kc-prod-redirects failed:', e);
  process.exit(1);
});
