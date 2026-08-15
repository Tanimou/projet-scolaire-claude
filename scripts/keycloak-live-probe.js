#!/usr/bin/env node
/**
 * S-E01-4b — VAL-04's LIVE half, executed against a REAL Keycloak realm
 * (`docs/adr/ADR-052-oidc-client-identity-ratchet.md` §D5, §D6).
 *
 * THIS IS EVIDENCE, NOT A GATE STAGE, AND THAT IS A DECISION (ADR-052 §D5)
 * -----------------------------------------------------------------------
 * It is deliberately wired into NO stage list. Three reasons, and the third is
 * decisive: `scripts/ci-gate.sh` records that the fast tier is Docker-free by
 * contract; a blocking stage needing a live Keycloak would be a flaky blocking
 * stage, which that file itself calls worse than no stage; and this probe
 * MUTATES A REALM — it plants a defect, creates an ephemeral user and deletes
 * both — and a merge gate must never mutate a running service. Precedent for an
 * unwired probe under `scripts/`: `restore-drill.js`, `trace-emission-probe.js`.
 *
 * THE HOSTINGER VPS IS AN AUDIT FIXTURE, NEVER A TARGET
 * ----------------------------------------------------
 * VAL-04 point 5 reads "the running **Hostinger** realm". Per SKILL Step -1 that
 * host is never called, never deployed to, and sends/receives not one HTTP
 * request from this repository's automation. The claim is therefore RE-SCOPED to
 * "the corrected provisioner removes the wildcard from a REAL realm", proven
 * locally. `KEYCLOAK_URL` is refused below unless it is a loopback host, so this
 * file cannot be pointed at production by accident. Production stays unproven and
 * is tracked as PF-223.
 *
 * WHY IT PLANTS THE DEFECT FIRST (ADR-052 §D6 — the vacuity trap)
 * --------------------------------------------------------------
 * Against a realm freshly imported from `infra/keycloak/realm-export.json` with
 * `PUBLIC_BASE_URL=http://localhost:3000`, `infra/kc-prod-redirects.mjs` is a
 * FIXED POINT: it writes back the three URIs the export already declares. "No
 * `/api/auth/callback/*` wildcard afterwards" would then be a statement about a
 * no-op — absent before, absent after, proving nothing. So step 4 PUTs the
 * wildcard onto the portal clients through the admin API first, reproducing what
 * the pre-ADR-050 script emitted (PF-209), READS IT BACK to prove the realm is in
 * the defective state, and only then runs the corrected provisioner. Fail-before
 * / pass-after, observed.
 *
 * ORDER IS LOAD-BEARING (critic C-06)
 * -----------------------------------
 * `kc-prod-redirects.mjs` overwrites `rootUrl`, `baseUrl`, `redirectUris` and
 * `webOrigins` on every portal client. Run before the read-back, it would mean
 * step 2 audits a realm the provisioner wrote rather than the realm the export
 * produced. The steps therefore run STRICTLY 1 → 2 → 3 → 4 → 5, and after step 4
 * the live realm no longer matches the file. That is expected; it is stated here
 * rather than left for the next run to discover.
 *
 * WHAT IT WILL NOT DO, BY NAME (critic C-09, C-13)
 * -----------------------------------------------
 * If the ROPC mint fails with `Account is not fully set up`, that is a FIXTURE
 * bug in the ephemeral user this file creates, and it is fixed HERE. It is never
 * fixed by relaxing `passwordPolicy`, `requiredActions`, `registrationAllowed` or
 * `verifyProfile` in `infra/keycloak/realm-export.json` — that would ship a
 * security decision to make a test pass, the same shape as ADR-050's forbidden
 * repair. Keycloak's raw `error_description` is printed so the distinction is
 * visible rather than guessed.
 *
 * No token, no password and no client secret is ever printed: the evidence is the
 * DECODED `azp` claim and nothing else. The ephemeral user is deleted in a
 * `finally` and its deletion is verified. `realm-export.json` is never
 * regenerated from the running realm — that would commit the ephemeral student,
 * i.e. exactly the ADR-021 provisioning decision this slice is told to stay out
 * of (PF-210).
 *
 * WHAT IT DOES NOT PROVE (critic C-08 — do not read this as an all-clear)
 * ----------------------------------------------------------------------
 * `azp: portal-student` proves the client identity is now OBSERVABLE and
 * distinguishable. It does NOT prove it is ENFORCED: nothing in `apps/api`
 * validates `azp` or `aud` (`apps/api/src/shared/audit/provenance.ts` records the
 * deliberate decision not to adopt it), and a ROPC token for a client with no
 * audience mapper carries `aud: account`. Tracked as PF-224.
 *
 * VAL-04's RESIDUE, NAMED (AC-12): points 2 (the signIn authorization-code round
 * trip) and 4 (a reset-credentials link accepted) need a BROWSER and are NOT
 * closed by this file. Point 2 gets at most a PARTIAL witness here — an
 * authorization-endpoint GET that does not answer `invalid_redirect_uri` — and it
 * is labelled partial, never closed.
 *
 * USAGE
 * -----
 *   docker run -d --name kc-probe -p 8081:8080 \
 *     -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
 *     -v "$PWD/infra/keycloak:/opt/keycloak/data/import:ro" \
 *     quay.io/keycloak/keycloak:26.0 start-dev --import-realm
 *   node scripts/keycloak-live-probe.js
 *
 * Exit 0 = every live claim observed. Exit 1 = a claim failed or could not be
 * executed; the reason is printed and belongs in the ledger verbatim as
 * `evidence: deferred — <reason>`.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const REPO_ROOT = resolve(__dirname, '..');
const REALM_EXPORT = resolve(REPO_ROOT, 'infra/keycloak/realm-export.json');
const PROVISIONER = resolve(REPO_ROOT, 'infra/kc-prod-redirects.mjs');

const KC = (process.env.KEYCLOAK_URL || 'http://localhost:8081').replace(/\/+$/, '');
const REALM = process.env.KEYCLOAK_REALM || 'pilotage-scolaire';
const ADMIN_USER = process.env.KEYCLOAK_ADMIN || 'admin';
const ADMIN_PASS = process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin';
const BASE = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const failures = [];
const notes = [];

function step(title) {
  console.log(`\n── ${title}\n${'─'.repeat(70)}`);
}
function ok(message) {
  console.log(`  ✓ ${message}`);
}
function bad(message) {
  console.log(`  ✗ ${message}`);
  failures.push(message);
}

/**
 * SKILL Step -1, enforced in code rather than trusted to discipline: this probe
 * mutates a realm, so it may only ever speak to a loopback host.
 */
function assertLoopback() {
  let url;
  try {
    url = new URL(KC);
  } catch {
    throw new Error(`KEYCLOAK_URL '${KC}' is not a URL`);
  }
  const host = url.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '[::1]') {
    throw new Error(
      `REFUSING to run against '${host}'. This probe PLANTS a defect and creates a user; it may only ` +
        'target a disposable local realm. The Hostinger VPS is an audit fixture, never a target ' +
        '(SKILL Step -1, ADR-052 §D6). Production remains tracked as PF-223.',
    );
  }
}

async function json(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { _raw: text };
  }
}

async function adminToken() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: ADMIN_USER,
      password: ADMIN_PASS,
    }),
  });
  const body = await json(res);
  if (!body || !body.access_token) {
    throw new Error(
      `no admin token from ${KC} (HTTP ${res.status}). Keycloak 26 bootstraps with ` +
        'KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD, where compose still sets the older ' +
        `KEYCLOAK_ADMIN / KEYCLOAK_ADMIN_PASSWORD. Raw: ${JSON.stringify(body)}`,
    );
  }
  return body.access_token;
}

/** Decodes a JWT payload WITHOUT verifying it — this reads claims, it does not trust them. */
function claims(jwt) {
  const [, payload] = jwt.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

const pathOf = (uri) => {
  try {
    return new URL(uri).pathname;
  } catch {
    return uri;
  }
};

async function main() {
  assertLoopback();
  const exported = JSON.parse(readFileSync(REALM_EXPORT, 'utf8'));
  const portalClients = exported.clients.filter((c) => Array.isArray(c.redirectUris) && c.redirectUris.length > 0);

  const token = await adminToken();
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const admin = (path) => `${KC}/admin/realms/${REALM}${path}`;

  const getClient = async (clientId) => {
    const list = await json(await fetch(admin(`/clients?clientId=${encodeURIComponent(clientId)}`), { headers: H }));
    return Array.isArray(list) && list[0] ? list[0] : null;
  };

  /* ---- STEP 1 — the realm the container is serving IS this file's realm ---- */
  // `--import-realm` SKIPS an existing realm and still exits 0 (critic C-05), so
  // "the container started" is not evidence that THIS export was imported.
  step('STEP 1 — the running realm matches infra/keycloak/realm-export.json (import actually happened)');
  const realmMeta = await json(await fetch(admin(''), { headers: H }));
  if (!realmMeta || realmMeta.realm !== REALM) {
    bad(`realm '${REALM}' is not present on ${KC} — nothing below can be evidence`);
    return;
  }
  ok(`realm '${realmMeta.realm}' is live at ${KC}`);

  const liveRoles = new Set(
    (await json(await fetch(admin('/roles'), { headers: H }))).map((r) => r.name),
  );
  for (const role of (exported.roles?.realm ?? []).map((r) => r.name)) {
    if (liveRoles.has(role)) ok(`realm role '${role}' materialised`);
    else bad(`realm role '${role}' is in the export but NOT in the running realm — the import was skipped or stale`);
  }
  for (const declared of exported.clients) {
    const live = await getClient(declared.clientId);
    if (live) ok(`client '${declared.clientId}' materialised`);
    else bad(`client '${declared.clientId}' is in the export but NOT in the running realm`);
  }

  /* ---- STEP 2 — VAL-04 pt 1: read the four portal clients BACK from the API -- */
  step('STEP 2 — VAL-04 pt 1: all four portal clients read back FROM THE ADMIN API (never from the file)');
  for (const declared of portalClients) {
    const live = await getClient(declared.clientId);
    if (!live) {
      bad(`${declared.clientId}: absent`);
      continue;
    }
    const flags = [
      ['publicClient=false (confidential)', live.publicClient === false],
      ['standardFlowEnabled', live.standardFlowEnabled === true],
      ['directAccessGrantsEnabled', live.directAccessGrantsEnabled === true],
    ];
    for (const [label, held] of flags) {
      if (held) ok(`${declared.clientId}: ${label}`);
      else bad(`${declared.clientId}: ${label} is NOT held by the running realm`);
    }
    const livePaths = (live.redirectUris || []).map(pathOf).sort();
    const wantPaths = declared.redirectUris.map(pathOf).sort();
    if (JSON.stringify(livePaths) === JSON.stringify(wantPaths)) {
      ok(`${declared.clientId}: ${livePaths.length} redirect URIs, by path — ${livePaths.join(' ')}`);
    } else {
      bad(`${declared.clientId}: redirect URIs differ. live=${JSON.stringify(livePaths)} export=${JSON.stringify(wantPaths)}`);
    }
  }

  /* ---- STEP 3 — VAL-04 pt 3: azp, on BOTH sides ---------------------------- */
  step('STEP 3 — VAL-04 pt 3 (the security half): the student and parent tokens carry DIFFERENT azp');
  const secretOf = (clientId) => (exported.clients.find((c) => c.clientId === clientId) || {}).secret;

  // The password is generated per run and never printed (critic C-13). It has to
  // satisfy the realm passwordPolicy: length(12) notUsername notEmail digits(1)
  // lowerCase(1) upperCase(1) specialChars(1).
  const password = `Ev${randomBytes(9).toString('base64url')}#7aZ`;
  const username = `probe-student-${randomBytes(4).toString('hex')}@pilotage.local`;
  let userId = null;

  const mint = async (clientId, user, pass) => {
    const res = await fetch(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: clientId,
        client_secret: secretOf(clientId) || '',
        username: user,
        password: pass,
        scope: 'openid',
      }),
    });
    return { status: res.status, body: await json(res) };
  };

  try {
    const create = await fetch(admin('/users'), {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        username,
        email: username,
        firstName: 'Probe',
        lastName: 'Student',
        enabled: true,
        emailVerified: true,
        // VERIFY_PROFILE and a temporary credential both answer
        // `Account is not fully set up` — a FIXTURE bug, fixed here and never by
        // relaxing the realm's passwordPolicy or requiredActions (critic C-09).
        requiredActions: [],
        credentials: [{ type: 'password', value: password, temporary: false }],
      }),
    });
    if (create.status !== 201) {
      bad(`could not create the ephemeral student (HTTP ${create.status}): ${JSON.stringify(await json(create))}`);
    } else {
      const found = await json(await fetch(admin(`/users?username=${encodeURIComponent(username)}&exact=true`), { headers: H }));
      userId = found && found[0] && found[0].id;
      ok(`ephemeral student created (id ${userId}) — it exists ONLY in this local realm and is deleted below`);

      const studentRole = await json(await fetch(admin('/roles/student'), { headers: H }));
      await fetch(admin(`/users/${userId}/role-mappings/realm`), {
        method: 'POST',
        headers: H,
        body: JSON.stringify([{ id: studentRole.id, name: studentRole.name }]),
      });
      ok("realm role 'student' assigned to the ephemeral identity");

      const studentToken = await mint('portal-student', username, password);
      if (!studentToken.body || !studentToken.body.access_token) {
        bad(
          `student ROPC mint failed (HTTP ${studentToken.status}): ` +
            `${studentToken.body && studentToken.body.error} / ${studentToken.body && studentToken.body.error_description}. ` +
            'If this reads "Account is not fully set up" it is a FIXTURE bug in this file, NOT a reason to ' +
            'relax passwordPolicy or requiredActions in realm-export.json.',
        );
      } else {
        const c = claims(studentToken.body.access_token);
        if (c.azp === 'portal-student') ok(`student token carries azp="${c.azp}"  (aud=${JSON.stringify(c.aud)})`);
        else bad(`student token carries azp="${c.azp}", expected "portal-student" — azp is still collapsed`);

        // ONE-SIDED IS NOT EVIDENCE: the parent side must differ, or nothing has
        // been shown to be distinguishable.
        const parentToken = await mint('portal-parent', 'parent@pilotage.local', 'parent123');
        if (!parentToken.body || !parentToken.body.access_token) {
          notes.push(
            `parent-side azp NOT observed (HTTP ${parentToken.status}: ` +
              `${parentToken.body && parentToken.body.error_description}) — the seeded parent's password is ` +
              'realm-fixture state, so the two-sided claim is PARTIAL, not closed',
          );
          bad('parent token could not be minted — distinguishability is ASSERTED, not observed');
        } else {
          const p = claims(parentToken.body.access_token);
          if (p.azp === 'portal-parent' && p.azp !== c.azp) {
            ok(`parent token carries azp="${p.azp}" — the two portals are DISTINGUISHABLE at the client-identity level`);
          } else {
            bad(`parent token carries azp="${p.azp}" — not distinguishable from the student's "${c.azp}"`);
          }
        }
      }

      /* ---- STEP 4 — VAL-04 pt 5: plant the wildcard, then remove it -------- */
      step('STEP 4 — VAL-04 pt 5 (RE-SCOPED, local): plant /api/auth/callback/* — prove present — provision — prove absent');
      const planted = `${BASE}/api/auth/callback/*`;
      for (const clientId of ['portal-parent', 'portal-student']) {
        const live = await getClient(clientId);
        live.redirectUris = [...new Set([...(live.redirectUris || []), planted])];
        await fetch(admin(`/clients/${live.id}`), { method: 'PUT', headers: H, body: JSON.stringify(live) });
      }
      let plantedSeen = 0;
      for (const clientId of ['portal-parent', 'portal-student']) {
        const live = await getClient(clientId);
        if ((live.redirectUris || []).includes(planted)) plantedSeen++;
      }
      if (plantedSeen === 2) ok(`FAIL-BEFORE OBSERVED: '${planted}' is present on portal-parent and portal-student (PF-209's shape)`);
      else bad(`could not reproduce the defective state (${plantedSeen}/2 clients carry the wildcard) — anything below would be vacuous`);

      const provisioned = execFileSync(process.execPath, [PROVISIONER], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          KEYCLOAK_URL: KC,
          KEYCLOAK_REALM: REALM,
          KEYCLOAK_ADMIN: ADMIN_USER,
          KEYCLOAK_ADMIN_PASSWORD: ADMIN_PASS,
          PUBLIC_BASE_URL: BASE,
        },
      });
      console.log(provisioned.split('\n').map((l) => `      ${l}`).join('\n'));

      for (const clientId of ['portal-admin', 'portal-teacher', 'portal-parent', 'portal-student']) {
        const live = await getClient(clientId);
        const uris = live.redirectUris || [];
        const portal = clientId.replace(/^portal-/, '');
        const wildcarded = uris.filter((u) => pathOf(u).includes('*') && pathOf(u).startsWith('/api/auth/callback/'));
        if (wildcarded.length === 0) ok(`${clientId}: no /api/auth/callback/* wildcard after the corrected provisioner`);
        else bad(`${clientId}: still carries ${JSON.stringify(wildcarded)}`);
        for (const required of [`/api/auth/callback/keycloak-${portal}`, `/api/auth/callback/${portal}`]) {
          if (uris.some((u) => pathOf(u) === required)) ok(`${clientId}: registers '${required}' explicitly`);
          else bad(`${clientId}: does NOT register '${required}'`);
        }
      }

      /* ---- STEP 5 — the provisioner PUTs back what it fetched (critic C-07) - */
      step('STEP 5 — the client secret survived the provisioner\'s full-object PUT');
      // kc-prod-redirects.mjs GETs the client representation, mutates four fields
      // and PUTs the WHOLE object back. If Keycloak 26 returned the secret masked,
      // the PUT would write the mask back and every portal login would break —
      // silently, because the script prints ✓ on HTTP 2xx.
      const remint = await mint('portal-student', username, password);
      if (remint.body && remint.body.access_token) {
        ok(`portal-student still mints with the same client secret after the PUT (azp="${claims(remint.body.access_token).azp}")`);
      } else {
        bad(
          `portal-student can no longer mint after kc-prod-redirects.mjs ran (HTTP ${remint.status}: ` +
            `${remint.body && remint.body.error_description}). That is a P0 finding against ` +
            'infra/kc-prod-redirects.mjs (it PUTs back the representation it fetched, secret included), not a test bug.',
        );
      }
    }
  } finally {
    /* ---- the ephemeral identity leaves no trace, and that is verified ------ */
    step('CLEANUP — the ephemeral identity is deleted, and its deletion is PROVEN');
    if (userId) {
      const del = await fetch(admin(`/users/${userId}`), { method: 'DELETE', headers: H });
      const after = await json(await fetch(admin(`/users?username=${encodeURIComponent(username)}&exact=true`), { headers: H }));
      if (del.status === 204 && Array.isArray(after) && after.length === 0) {
        ok(`ephemeral student deleted (HTTP ${del.status}) and a read-back returns 0 users`);
      } else {
        bad(`ephemeral student may still exist (DELETE HTTP ${del.status}, read-back ${JSON.stringify(after)})`);
      }
    } else {
      notes.push('no ephemeral user was created, so none needed deleting');
    }
  }

  step('RESIDUE — what this probe did NOT close (AC-12), stated rather than rounded off');
  console.log(
    [
      '  · VAL-04 pt 2 (signIn authorization-code round trip)  — needs a browser. NOT CLOSED.',
      '  · VAL-04 pt 4 (reset-credentials link accepted)       — needs a browser. NOT CLOSED.',
      '  · VAL-04 pt 5 against PRODUCTION                      — operator action. Tracked as PF-223.',
      '  · azp is OBSERVABLE, not ENFORCED: apps/api validates neither azp nor aud. Tracked as PF-224.',
      '  · the live realm no longer matches realm-export.json after STEP 4 — expected (the provisioner',
      '    rewrote it). The file is NOT regenerated from the realm: that would commit the ephemeral student.',
    ].join('\n'),
  );
  for (const note of notes) console.log(`  · ${note}`);
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error(`\nKEYCLOAK LIVE PROBE: FAIL — ${failures.length} claim(s) not observed`);
      process.exit(1);
    }
    console.log('\nKEYCLOAK LIVE PROBE: PASS — every claim above was READ BACK from the running realm');
  })
  .catch((error) => {
    console.error(`\nKEYCLOAK LIVE PROBE: NOT EXECUTED — ${error.message}`);
    console.error(
      '\nRecord this verbatim in the ledger as `evidence: deferred — <the line above>`. ' +
        'Never record evidence that was not produced.',
    );
    process.exit(1);
  });
