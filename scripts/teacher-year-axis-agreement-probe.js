#!/usr/bin/env node
/**
 * S-E03-14 / `PF-36` / `ADR-088` — LES DEUX AXES D'ANNÉE, MESURÉS SUR LA PILE
 * QUI TOURNE, PAR HTTP, DEPUIS DEUX SURFACES DU MÊME PORTAIL.
 *
 * POURQUOI CETTE SONDE EXISTE
 * ---------------------------
 * La ligne `PF-36` du registre nomme le MÊME résidu deux fois — au run 80 puis
 * au run 103 : « personne n'a re-mesuré 43/46/48 ni 25/26 à travers les quatre
 * portails, donc savoir si l'écart s'est resserré est INCONNU, pas “corrigé” ».
 * Deux tranches ont converti du code sur la foi d'une fixture jest. Une fixture
 * prouve un MÉCANISME ; elle ne prouve pas un DÉPLOIEMENT (mémoire de run :
 * « preuve scratch ≠ cible »). Cette sonde parle à l'API réelle, avec de vrais
 * jetons Keycloak, contre le Postgres du CONTENEUR.
 *
 * CE QU'ELLE COMPARE, ET POURQUOI CES DEUX-LÀ
 * -------------------------------------------
 *   • `GET /api/v1/teachers/me/assignments` — AXE SECTION. Filtre l'année via
 *     `assignmentYearScopeWhere()`, c'est-à-dire `classSection.academicYearId`.
 *   • `GET /api/v1/analytics/teacher-reports` — AXE COLONNE avant cette
 *     tranche : `...(academicYearId ? { academicYearId } : {})`, posé
 *     directement sur `teaching_assignment.academic_year_id`.
 *
 * Les deux répondent à UNE question — « quelles classes cet enseignant
 * enseigne-t-il cette année ? » — sur DEUX portails du même utilisateur. C'est
 * exactement la forme de `PF-36`.
 *
 * ⚠ POURQUOI LA SONDE FABRIQUE SA FIXTURE, ET PAS PAR CONFORT
 * ------------------------------------------------------------
 * Mesuré avant d'écrire une ligne de cette sonde, contre le conteneur :
 *   • les DEUX axes sont IDENTIQUES sur la graine (286/286 affectations,
 *     186/186 enseignants distincts, delta 0 — run 103, re-vérifié ici) ;
 *   • les 2463 inscriptions sont TOUTES `active` ;
 *   • `teacher@pilotage.local`, le seul enseignant du realm, porte ZÉRO
 *     affectation.
 * Une sonde qui se contenterait d'interroger la graine renverrait donc `[] ==
 * []` et sortirait VERTE — sur du code cassé comme sur du code correct. C'est
 * le FAUX VERT du run 81, où un `403` en amont de la couche visée avait été lu
 * comme « corrigé ». La sonde CONSTRUIT donc la condition divergente, et son
 * contrôle POSITIF exige que les deux surfaces aient réellement renvoyé
 * quelque chose avant de comparer quoi que ce soit.
 *
 * LA FIXTURE, DEUX LIGNES, ET CE QUE CHACUNE PROUVE
 * -------------------------------------------------
 *   A1 — section `4eA` (année ff994aae = 2023–2024, l'ACTIVE), colonne
 *        `academic_year_id` = ff994aae. Les deux axes s'accordent sur elle :
 *        c'est le CONTRÔLE POSITIF. Si A1 n'apparaît pas des deux côtés, la
 *        couche testée n'a pas été atteinte et la sonde s'arrête sans juger.
 *   A2 — section `4eB` (année ff994aae AUSSI), colonne `academic_year_id` =
 *        10e36cb9 (2022–2023, close). La ligne est DÉRIVÉE À TORT : sa section
 *        est dans l'année active, sa colonne dit le contraire. La base
 *        l'ACCEPTE — il n'existe aucune clé étrangère composite
 *        `(class_section_id, academic_year_id)` (`PF-473`, mesuré run 103).
 *        C'est le DISCRIMINANT : l'axe section la voit, l'axe colonne non.
 *
 * ATTENDU AVANT la conversion : `/teachers/me/assignments` rend {4eA, 4eB} et
 * `/analytics/teacher-reports` rend {4eA} — DÉSACCORD.
 * ATTENDU APRÈS : les deux rendent {4eA, 4eB}.
 *
 * USAGE
 *   node scripts/teacher-year-axis-agreement-probe.js                    # attend l'ACCORD (pile corrigée)
 *   node scripts/teacher-year-axis-agreement-probe.js --expect-divergence # attend le DÉSACCORD (pile d'avant)
 *
 * La seconde forme est ce qui en fait un instrument rouge-avant/vert-après
 * plutôt qu'une affirmation à sens unique. Sortie 0 = l'attente déclarée a tenu.
 *
 * NETTOYAGE. Les deux lignes portent des UUID FIXES, écrits ci-dessous, et sont
 * supprimées PAR CES ID dans un `finally`. La sonde ne supprime jamais une
 * ligne qu'elle n'a pas créée. Elle est ré-entrante : elle purge ces mêmes id
 * avant d'insérer.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const KC = process.env.KEYCLOAK_URL_HOST || 'http://localhost:8180';
const REALM = process.env.KEYCLOAK_REALM || 'pilotage-scolaire';
const API = process.env.API_URL_HOST || 'http://localhost:4000';
const PG_CONTAINER = process.env.PG_CONTAINER || 'pilotage_postgres';
const EXPORT = path.join(__dirname, '..', 'infra', 'keycloak', 'realm-export.json');

// Même garde, même raison que `keycloak-live-probe.js` et
// `parent-grades-contract-probe.js` : `pilotage.srv861861.hstgr.cloud` est une
// fixture d'audit, et l'automatisation de ce dépôt ne lui envoie JAMAIS de
// requête (Step -1). La sonde écrit en base : la garde est ici structurelle.
for (const [name, url] of [
  ['KEYCLOAK_URL_HOST', KC],
  ['API_URL_HOST', API],
]) {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
    console.error(`REFUSED: ${name}=${url} n'est pas une boucle locale. La cible est la pile LOCALE, uniquement.`);
    process.exit(2);
  }
}

const EXPECT_DIVERGENCE = process.argv.includes('--expect-divergence');

/* ── la fixture, en dur et donc supprimable ──────────────────────────────── */
const A1 = '00000000-e034-4014-9001-000000000001'; // accordée   — contrôle POSITIF
const A2 = '00000000-e034-4014-9001-000000000002'; // divergente — DISCRIMINANT
const TENANT = '53fe06f3-9197-47aa-b82b-e11ba7c98819'; // Lycée Voltaire (Démo)
const TEACHER_PROFILE = 'd13b8bf5-63c2-4923-b84d-99f5c6149e91'; // teacher@pilotage.local
const SECTION_AGREED = '2dc3d86d-e266-4256-b703-32e61ff44451'; // 4eA, année active
const SECTION_DRIFTED = 'ebd635f7-d710-4ffd-9824-1955899321c1'; // 4eB, année active
const YEAR_ACTIVE = 'ff994aae-0883-44f4-bef9-f4789e519ebe'; // 2023–2024
const YEAR_CLOSED = '10e36cb9-5728-492a-a87b-5f4dcc3ce95f'; // 2022–2023
const SUBJECT = 'd02181fc-4a9a-4d53-a838-14631a38e817'; // Anglais

const psql = (sql) =>
  execFileSync('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'pilotage', '-d', 'pilotage', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], {
    encoding: 'utf8',
  }).trim();

const removeFixture = () => psql(`DELETE FROM teaching_assignment WHERE id IN ('${A1}','${A2}');`);

function installFixture() {
  removeFixture();
  psql(`
    INSERT INTO teaching_assignment
      (id, tenant_id, teacher_profile_id, class_section_id, subject_id, academic_year_id, weekly_hours, is_main_teacher, role, created_at, updated_at)
    VALUES
      ('${A1}','${TENANT}','${TEACHER_PROFILE}','${SECTION_AGREED}','${SUBJECT}','${YEAR_ACTIVE}',2,false,'subject_teacher',now(),now()),
      ('${A2}','${TENANT}','${TEACHER_PROFILE}','${SECTION_DRIFTED}','${SUBJECT}','${YEAR_CLOSED}',2,false,'subject_teacher',now(),now());
  `);
  // La ligne A2 est-elle bien DÉRIVÉE À TORT ? On le VÉRIFIE plutôt que de le
  // supposer : si une contrainte composite était posée un jour (`PF-473`),
  // l'INSERT échouerait et cette sonde devrait être retirée, pas « réparée ».
  const drift = psql(`
    SELECT count(*) FROM teaching_assignment ta
      JOIN class_section cs ON cs.id = ta.class_section_id
     WHERE ta.id = '${A2}' AND ta.academic_year_id <> cs.academic_year_id;`);
  if (drift !== '1') {
    throw new Error(`la ligne divergente n'a pas été acceptée telle quelle (drift=${drift}) — PF-473 est peut-être posée ; relire la sonde avant de la corriger`);
  }
}

/* ── HTTP ────────────────────────────────────────────────────────────────── */
const exported = JSON.parse(fs.readFileSync(EXPORT, 'utf8'));
/** DÉRIVÉ de l'export, jamais re-tapé — une seconde copie tenue à la main est `PF-228`. */
const secretOf = (clientId) => (exported.clients.find((c) => c.clientId === clientId) || {}).secret;
const passwordOf = (username) =>
  (((exported.users || []).find((u) => u.username === username) || {}).credentials || [])[0]?.value;

async function mint(clientId, username) {
  const res = await fetch(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      client_secret: secretOf(clientId) || '',
      username,
      password: passwordOf(username) || '',
      scope: 'openid',
    }),
  });
  const payload = await res.json().catch(() => null);
  if (res.status !== 200 || !payload?.access_token) {
    throw new Error(`ROPC refusé pour ${username} via ${clientId}: HTTP ${res.status}`);
  }
  return payload.access_token;
}

async function get(pathname, token) {
  const res = await fetch(`${API}${pathname}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { _raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

const sorted = (xs) => [...xs].sort().join(',');

(async () => {
  let failures = 0;
  const say = (ok, line) => {
    if (!ok) failures += 1;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${line}`);
  };

  installFixture();
  try {
    const teacher = await mint('portal-teacher', 'teacher@pilotage.local');

    const assignments = await get('/api/v1/teachers/me/assignments', teacher);
    const reports = await get('/api/v1/analytics/teacher-reports', teacher);

    // ── CONTRÔLE POSITIF ──────────────────────────────────────────────────
    // Un statut nu n'affirme qu'une coïncidence (leçon du run 81). On exige
    // que les DEUX surfaces aient renvoyé 200 ET vu la ligne accordée, sans
    // quoi la comparaison qui suit ne mesurerait rien.
    if (assignments.status !== 200 || reports.status !== 200) {
      console.log(`ABANDON — HTTP assignments=${assignments.status} reports=${reports.status}`);
      console.log('La couche visée n\'a pas été atteinte ; aucun verdict n\'est rendu.');
      process.exitCode = 2;
      return;
    }

    const sectionsFromAssignments = new Set(
      (assignments.body?.data || []).map((a) => a.classSection?.id).filter(Boolean),
    );
    const sectionsFromReports = new Set(
      (reports.body?.classes || []).map((c) => c.classSectionId || c.classSection?.id || c.id).filter(Boolean),
    );

    say(
      sectionsFromAssignments.has(SECTION_AGREED),
      `CONTRÔLE POSITIF — /teachers/me/assignments voit la ligne ACCORDÉE (4eA). vu: [${sorted(sectionsFromAssignments)}]`,
    );
    say(
      sectionsFromReports.has(SECTION_AGREED),
      `CONTRÔLE POSITIF — /analytics/teacher-reports voit la ligne ACCORDÉE (4eA). vu: [${sorted(sectionsFromReports)}]`,
    );
    if (failures) {
      console.log('\nLes contrôles positifs ont échoué : la fixture n\'est pas arrivée jusqu\'aux deux surfaces.');
      console.log('Aucun verdict sur l\'axe d\'année n\'est rendu — ce serait une coïncidence, pas une mesure.');
      process.exitCode = 2;
      return;
    }

    // ── LE DISCRIMINANT ───────────────────────────────────────────────────
    const seesDrifted = {
      assignments: sectionsFromAssignments.has(SECTION_DRIFTED),
      reports: sectionsFromReports.has(SECTION_DRIFTED),
    };
    console.log('');
    console.log(`  axe SECTION  (/teachers/me/assignments)  → ${sectionsFromAssignments.size} classe(s) [${sorted(sectionsFromAssignments)}]`);
    console.log(`  axe MESURÉ   (/analytics/teacher-reports)→ ${sectionsFromReports.size} classe(s) [${sorted(sectionsFromReports)}]`);
    console.log(`  ligne divergente (4eB) vue par : assignments=${seesDrifted.assignments} reports=${seesDrifted.reports}`);
    console.log('');

    const agree = sorted(sectionsFromAssignments) === sorted(sectionsFromReports);

    if (EXPECT_DIVERGENCE) {
      say(
        !agree && seesDrifted.assignments && !seesDrifted.reports,
        'ATTENDU: DÉSACCORD — l\'axe section voit la ligne dérivée à tort, l\'axe colonne la perd',
      );
    } else {
      say(agree, 'ATTENDU: ACCORD — les deux surfaces rendent le MÊME ensemble de classes');
      say(
        seesDrifted.reports,
        '/analytics/teacher-reports dérive désormais l\'année de la SECTION (il voit 4eB)',
      );
    }
  } finally {
    removeFixture();
    const left = psql(`SELECT count(*) FROM teaching_assignment WHERE id IN ('${A1}','${A2}');`);
    console.log(`\nnettoyage: lignes de fixture restantes = ${left}`);
    if (left !== '0') {
      console.error('LA FIXTURE N\'A PAS ÉTÉ RETIRÉE — la base est laissée sale, corriger avant tout autre run.');
      process.exitCode = 3;
    }
  }

  if (failures) {
    console.log(`\nPROBE: FAIL (${failures})`);
    process.exitCode = 1;
  } else {
    console.log(`\nPROBE: PASS (mode ${EXPECT_DIVERGENCE ? '--expect-divergence' : 'accord'})`);
  }
})().catch((e) => {
  console.error('FATAL', e.message);
  try {
    removeFixture();
  } catch {
    /* déjà signalé */
  }
  process.exit(1);
});
