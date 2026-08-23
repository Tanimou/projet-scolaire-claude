#!/usr/bin/env node
/**
 * S-E05-17 / AC-7 — la moitié EXÉCUTÉE de PF-51 clause 3, contre la pile locale.
 *
 * Elle mesure les sept lignes de la matrice sur les TROIS routes que la tranche
 * rétrécit, avec un vrai jeton, un vrai Nest et un vrai Postgres :
 *
 *   PATCH /api/v1/notifications/preferences/not_a_kind    -> 400   (était 500)
 *   PATCH /api/v1/notifications/preferences/remediation   -> 400   (était 200, PF-314)
 *   PATCH /api/v1/notifications/preferences/<kind valide> -> 200   (contrôle)
 *   GET   /api/v1/calendar/events?type=not_a_type         -> 400   (était 500)
 *   GET   /api/v1/calendar/events                         -> 200   (contrôle)
 *   GET   /api/v1/alerts/instances?status=not_a_status    -> 400   (était 200 NON FILTRÉ, PF-315)
 *   GET   /api/v1/alerts/instances?status=open            -> 200   (contrôle)
 *
 * LES LIGNES DE CONTRÔLE NE SONT PAS DÉCORATIVES. Une sonde qui ne vérifierait
 * que les 400 passerait contre une API complètement morte. Les trois 200 sont
 * ce qui distingue « rétréci » de « cassé ».
 *
 * CE N'EST PAS UNE ÉTAPE DE GATE, ET C'EST UNE DÉCISION (ADR-067 §D4)
 * -------------------------------------------------------------------
 * Délibérément câblée dans AUCUNE liste d'étapes de `scripts/ci-gate.sh` : elle
 * exige une pile vivante (donc une étape bloquante instable), et surtout elle
 * ÉCRIT — le contrôle « kind valide » est un PATCH. Un gate de merge ne mute
 * jamais un service qui tourne. Précédents de sondes non câblées sous
 * `scripts/` : `keycloak-live-probe.js`, `restore-drill.js`,
 * `trace-emission-probe.js`.
 *
 * L'ÉCRITURE EST PRÉSERVATRICE DE VALEUR
 * --------------------------------------
 * Le PATCH de contrôle lit d'abord `GET /notifications/preferences`, puis
 * ré-écrit À L'IDENTIQUE les quatre champs du kind visé. Le compte de
 * l'opérateur ressort donc exactement dans l'état où il est entré. Aucune
 * suppression, aucun utilisateur créé.
 *
 * LOOPBACK OBLIGATOIRE SUR LES DEUX HÔTES
 * ---------------------------------------
 * `KEYCLOAK_URL` **et** `API_URL` sont refusés s'ils ne sont pas en loopback.
 * `keycloak-live-probe.js` ne garde que le premier parce qu'il ne parle qu'à
 * Keycloak ; celle-ci pilote aussi l'API et elle ÉCRIT. Le VPS Hostinger est une
 * pièce d'audit, jamais une cible (SKILL Step -1).
 *
 * AUCUN SECRET N'EST IMPRIMÉ. Ni jeton, ni mot de passe, ni secret client — la
 * preuve est le CODE HTTP et rien d'autre.
 *
 * PAS D'ÉCHAPPATOIRE (DNC-10). Aucun `NODE_ENV`, aucun `SKIP_*`, aucun `ALLOW_*`.
 * Un jeton manquant ou refusé est une SORTIE NON NULLE avec un message distinct,
 * jamais un saut silencieux.
 *
 * ATTENTION — CONTRE QUEL BINAIRE TOURNE-T-ELLE (le piège R-05)
 * -------------------------------------------------------------
 * `pilotage_api` tourne une IMAGE CONSTRUITE (`infra/docker-compose.yml`), sans
 * bind-mount des sources. Tant que l'image n'est pas reconstruite ET
 * `@pilotage/contracts` rebâti (son `dist` est le runtime, cf. ADR-067 §D5),
 * cette sonde mesure fidèlement le binaire d'AVANT et sort NON NULLE en
 * imprimant la matrice pré-changement. C'est son propre contrôle négatif : elle
 * MESURE au lieu de passer par tautologie. Une matrice verte n'est de la preuve
 * qu'accompagnée de l'âge de l'image.
 *
 * USAGE
 * -----
 *   PROBE_USERNAME=admin@pilotage.local PROBE_PASSWORD=... \
 *     node scripts/enum-route-input-probe.js
 *
 * Exit 0 = les sept lignes observées. Exit 1 = au moins une ligne diverge, ou la
 * sonde n'a pas pu s'exécuter ; la raison est imprimée et va telle quelle dans le
 * journal.
 */

const API = (process.env.API_URL || 'http://localhost:4000').replace(/\/+$/, '');
const KC = (process.env.KEYCLOAK_URL || 'http://localhost:8180').replace(/\/+$/, '');
const REALM = process.env.KEYCLOAK_REALM || 'pilotage-scolaire';
const CLIENT_ID = process.env.PROBE_CLIENT_ID || 'portal-admin';

/** AUCUN DÉFAUT, volontairement : une sonde ne devine jamais une identité. */
const USERNAME = process.env.PROBE_USERNAME;
const PASSWORD = process.env.PROBE_PASSWORD;

/** Le kind EXPOSÉ servant de contrôle 200. Ré-écrit à l'identique. */
const CONTROL_KIND = 'alert';

const failures = [];

function line(message) {
  console.log(message);
}
function ok(message) {
  console.log(`  OK   ${message}`);
}
function bad(message) {
  console.log(`  FAIL ${message}`);
  failures.push(message);
}
function die(message) {
  console.error(`\nREFUS : ${message}\n`);
  process.exit(1);
}

/** Loopback obligatoire — cette sonde ÉCRIT, elle ne peut viser qu'une pile jetable. */
function assertLoopback(label, raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    die(`${label} '${raw}' n'est pas une URL.`);
  }
  const host = url.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '[::1]') {
    die(
      `refus de viser '${host}' via ${label}. Cette sonde ÉCRIT (PATCH sur une préférence ` +
        "réelle) : elle ne peut cibler qu'une pile locale jetable. Le VPS Hostinger est une " +
        'pièce d\'audit, jamais une cible (SKILL Step -1).',
    );
  }
}

function requireCredentials() {
  const missing = [];
  if (!USERNAME) missing.push('PROBE_USERNAME');
  if (!PASSWORD) missing.push('PROBE_PASSWORD');
  if (missing.length > 0) {
    die(
      `${missing.join(' et ')} absent(s) de l'environnement. Aucun défaut n'est fourni et aucun ` +
        "identifiant n'est committé : exportez-les pour cette exécution seulement.",
    );
  }
}

async function mintToken() {
  let res;
  try {
    res = await fetch(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: CLIENT_ID,
        username: USERNAME,
        password: PASSWORD,
      }),
    });
  } catch (error) {
    die(
      `Keycloak injoignable sur ${KC} (${error.message}). Un jeton indisponible est un ÉCHEC de ` +
        'sonde, jamais un saut silencieux.',
    );
  }
  const body = await res.json().catch(() => null);
  if (!body || !body.access_token) {
    // `error_description` de Keycloak ne contient pas le mot de passe.
    die(
      `aucun jeton depuis ${KC} (HTTP ${res.status}, client '${CLIENT_ID}', realm '${REALM}'). ` +
        `Raison Keycloak : ${body && body.error_description ? body.error_description : 'inconnue'}.`,
    );
  }
  return body.access_token;
}

async function call(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload };
}

/** Une ligne de matrice : attendu vs observé, jamais un corps de réponse imprimé. */
function expectStatus(label, expected, observed) {
  if (observed === expected) ok(`${label} -> ${observed}`);
  else bad(`${label} -> ${observed} (attendu ${expected})`);
}

async function main() {
  requireCredentials();
  assertLoopback('KEYCLOAK_URL', KC);
  assertLoopback('API_URL', API);

  line(`\nAPI ${API}  ·  Keycloak ${KC}  ·  realm ${REALM}  ·  client ${CLIENT_ID}`);
  line('─'.repeat(78));

  const token = await mintToken();
  ok('jeton obtenu (aucun jeton, mot de passe ni secret n’est imprimé)');

  // --- SITE 1 — notification kind ------------------------------------------
  line('\nSITE 1 — PATCH /api/v1/notifications/preferences/:kind');

  // Lecture d'abord : l'écriture de contrôle doit PRÉSERVER LA VALEUR.
  const current = await call(token, 'GET', '/api/v1/notifications/preferences');
  if (current.status !== 200 || !current.payload || !Array.isArray(current.payload.data)) {
    bad(`GET /notifications/preferences -> ${current.status} (attendu 200 avec une liste)`);
    return;
  }
  ok(`GET /notifications/preferences -> 200 (${current.payload.data.length} kinds exposés)`);

  const control = current.payload.data.find((row) => row.kind === CONTROL_KIND);
  if (!control) {
    bad(`le kind de contrôle '${CONTROL_KIND}' est absent de la liste exposée`);
    return;
  }
  if (current.payload.data.some((row) => row.kind === 'remediation')) {
    bad("'remediation' apparaît dans la liste EXPOSÉE — la prémisse de PF-314 a changé");
  } else {
    ok("'remediation' est bien ABSENT de la liste exposée (la prémisse de PF-314 tient)");
  }

  const unknownKind = await call(token, 'PATCH', '/api/v1/notifications/preferences/not_a_kind', {
    inAppEnabled: true,
  });
  expectStatus('PATCH .../not_a_kind', 400, unknownKind.status);

  const withheld = await call(token, 'PATCH', '/api/v1/notifications/preferences/remediation', {
    inAppEnabled: true,
  });
  expectStatus('PATCH .../remediation (PF-314)', 400, withheld.status);

  // Écriture PRÉSERVATRICE : on renvoie exactement l'état lu.
  const valid = await call(token, 'PATCH', `/api/v1/notifications/preferences/${CONTROL_KIND}`, {
    inAppEnabled: control.inAppEnabled,
    emailEnabled: control.emailEnabled,
    pushEnabled: control.pushEnabled,
    cadence: control.cadence,
  });
  expectStatus(`PATCH .../${CONTROL_KIND} (valeurs inchangées)`, 200, valid.status);

  const after = await call(token, 'GET', '/api/v1/notifications/preferences');
  const restored =
    after.status === 200 &&
    after.payload &&
    Array.isArray(after.payload.data) &&
    JSON.stringify(after.payload.data.find((row) => row.kind === CONTROL_KIND)) ===
      JSON.stringify(control);
  if (restored) ok('la préférence de contrôle est inchangée après la sonde');
  else bad('la préférence de contrôle a CHANGÉ — la sonde devait être préservatrice de valeur');

  // --- SITE 2 — calendar type ----------------------------------------------
  line('\nSITE 2 — GET /api/v1/calendar/events');
  const badType = await call(token, 'GET', '/api/v1/calendar/events?type=not_a_type');
  expectStatus('GET /calendar/events?type=not_a_type', 400, badType.status);

  const noType = await call(token, 'GET', '/api/v1/calendar/events');
  expectStatus('GET /calendar/events (sans type — le cas de tout appelant réel)', 200, noType.status);

  // --- SITE 3 — alert status -----------------------------------------------
  line('\nSITE 3 — GET /api/v1/alerts/instances');
  const badStatus = await call(token, 'GET', '/api/v1/alerts/instances?status=not_a_status');
  expectStatus('GET /alerts/instances?status=not_a_status (PF-315)', 400, badStatus.status);

  const openStatus = await call(token, 'GET', '/api/v1/alerts/instances?status=open&limit=5');
  expectStatus('GET /alerts/instances?status=open', 200, openStatus.status);

  // G-TRUTH : le 400 doit remplacer un ÉLARGISSEMENT, pas un filtre correct.
  // Si l'invalide rend 200, on dit combien de lignes il a rendues — c'est
  // exactement la mesure qui a ouvert PF-315.
  if (badStatus.status === 200 && badStatus.payload && Array.isArray(badStatus.payload.data)) {
    bad(
      `…et ce 200 a rendu ${badStatus.payload.data.length} ligne(s) NON FILTRÉE(S) : ` +
        "c'est le défaut de vérité de PF-315, toujours ouvert sur ce binaire.",
    );
  }
}

main()
  .then(() => {
    line('\n' + '─'.repeat(78));
    if (failures.length === 0) {
      line('MATRICE : 7/7 observées. Exit 0.');
      process.exit(0);
    }
    line(`MATRICE : ${failures.length} divergence(s).`);
    for (const failure of failures) line(`  · ${failure}`);
    line(
      "Rappel : contre une image API d'AVANT le changement, cette sortie est ATTENDUE et " +
        'constitue le contrôle négatif de la sonde.',
    );
    process.exit(1);
  })
  .catch((error) => {
    console.error(`\nERREUR DE SONDE : ${error && error.message ? error.message : error}`);
    process.exit(1);
  });
