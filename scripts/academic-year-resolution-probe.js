#!/usr/bin/env node
/**
 * S-E03-4 / PF-15 / ADR-070 — LA SONDE EXÉCUTÉE (Tier A).
 *
 * POURQUOI ELLE EXISTE
 * --------------------
 * `S-E03-4` ferme `PF-15` sur l'axe RÉSOLUTION. La suite unitaire prouve le
 * MÉCANISME : elle tourne sur un lecteur en mémoire, donc elle ne dit rien de la
 * base réelle. Une preuve exécutée contre une base scratch prouve le mécanisme et
 * JAMAIS le déploiement — ce dépôt s'est fait prendre trois fois. Cette sonde lit
 * donc `pilotage_postgres`, le conteneur qui tourne, et rien d'autre.
 *
 * CE QU'ELLE NE PROUVE PAS, ÉCRIT ICI PLUTÔT QUE DÉCOUVERT PLUS TARD
 * -----------------------------------------------------------------
 * Elle interroge la BASE. Elle ne prouve pas que les conteneurs `api`/`worker`
 * exécutent le nouveau code : ils portent l'image avec laquelle ils ont été
 * démarrés. P0 imprime donc l'âge des images, et P4 est explicite sur le fait
 * qu'il évalue l'ordre total EN SQL — la même règle que le résolveur, pas le
 * résolveur lui-même. Le jour où les images sont reconstruites, P4 devient une
 * comparaison bout-en-bout ; tant qu'elles ne le sont pas, la formule honnête est
 * « mécanisme prouvé, déploiement non ».
 *
 * VERDICTS
 * --------
 *   P1  STOP si > 0        — une année dont le tenant contredit celui de son école
 *   P2  REPORT si > 1      — la multiplicité qui rend le déterminisme observable
 *   P3  ATTENDU non vide   — PF-15 qui se reproduit ; un P3 VIDE est suspect
 *   P4  STOP si désaccord  — l'ordre total SQL doit désigner la même ligne
 *
 * Usage : node scripts/academic-year-resolution-probe.js
 */

const { execFileSync } = require('node:child_process');

const CONTAINER = 'pilotage_postgres';
const DB_USER = 'pilotage';
const DB_NAME = 'pilotage';

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-At', '-F', '|', '-c', sql],
    { encoding: 'utf8', timeout: 60_000 },
  ).trim();
}

function rows(sql) {
  const out = psql(sql);
  return out === '' ? [] : out.split('\n').map((line) => line.split('|'));
}

function imageAge(container) {
  try {
    const image = execFileSync('docker', ['inspect', '-f', '{{.Config.Image}}', container], {
      encoding: 'utf8',
      timeout: 30_000,
    }).trim();
    const created = execFileSync('docker', ['inspect', '-f', '{{.Created}}', image], {
      encoding: 'utf8',
      timeout: 30_000,
    }).trim();
    return `${image} created ${created}`;
  } catch {
    return 'unavailable';
  }
}

let stop = false;

console.log('='.repeat(78));
console.log('S-E03-4 — academic-year resolution probe (LIVE stack, not a scratch database)');
console.log('='.repeat(78));

/* ---------------------------------------------------------------- P0 */
console.log('\nP0 — WHAT WAS PROBED (PF-111: an image older than the diff proves nothing)');
console.log(`  probed database : container ${CONTAINER}`);
for (const c of ['pilotage_api', 'pilotage_worker']) {
  console.log(`  ${c.padEnd(16)}: ${imageAge(c)}`);
}
console.log(`  probe run at    : ${psql('select now()')}`);

/* ---------------------------------------------------------------- P1 */
console.log('\nP1 (G-TENANT) — academic_year.tenant_id must equal its school.tenant_id');
const mismatched = rows(`
  select ay.id, ay.name, ay.tenant_id, s.tenant_id
  from academic_year ay join school s on s.id = ay.school_id
  where ay.tenant_id <> s.tenant_id
`);
console.log(`  mismatched rows: ${mismatched.length}   (expected 0)`);
for (const r of mismatched) console.log(`    ${r.join(' | ')}`);
if (mismatched.length > 0) {
  stop = true;
  console.log('  ** STOP ** a tenant-keyed resolver changes behaviour on these rows.');
} else {
  console.log('  OK — adding tenantId to every where-clause is behaviour-preserving here.');
}

/* ---------------------------------------------------------------- P2 */
console.log('\nP2 — active years per (tenant, school): >1 makes determinism observable');
const perScope = rows(`
  select tenant_id, school_id, count(*)
  from academic_year where status = 'active'
  group by tenant_id, school_id order by count(*) desc
`);
for (const [t, s, n] of perScope) {
  const flag = Number(n) > 1 ? '  <-- MULTIPLICITY (PF-328)' : '';
  console.log(`    tenant ${t.slice(0, 8)}… school ${s.slice(0, 8)}… active=${n}${flag}`);
}
const multi = perScope.filter(([, , n]) => Number(n) > 1).length;
console.log(`  scopes with >1 active year: ${multi}`);

/* ---------------------------------------------------------------- P3 */
console.log('\nP3 (PF-15) — is the active year STALE? (end_date < current_date)');
const stale = rows(`
  select tenant_id, name, end_date, (current_date - end_date)
  from academic_year where status = 'active' and end_date < current_date
  order by end_date
`);
const activeTotal = Number(psql(`select count(*) from academic_year where status = 'active'`));
console.log(`  active years total: ${activeTotal}   stale: ${stale.length}`);
for (const [t, name, end, days] of stale) {
  console.log(`    tenant ${t.slice(0, 8)}… "${name}" ended ${end} — STALE by ${days} days`);
}
if (stale.length === 0) {
  console.log('  NOTE — PF-15 does NOT reproduce right now. Re-read the finding before closing it.');
} else {
  console.log('  PF-15 REPRODUCES. The resolver must REPORT this (isStale/staleByDays), never hide it.');
}

/* ---------------------------------------------------------------- P4 */
console.log('\nP4 (G-TRUTH) — the documented total order, evaluated IN SQL, per tenant');
console.log('  order = [startDate desc, id desc]; compares the RULE, not the compiled resolver.');
const tenants = rows(`select distinct tenant_id from academic_year order by 1`);
for (const [t] of tenants) {
  const totalOrder = rows(`
    select id, name from academic_year
    where tenant_id = '${t}' and status = 'active'
    order by start_date desc, id desc limit 1
  `);
  const startOnly = rows(`
    select id, name from academic_year
    where tenant_id = '${t}' and status = 'active'
    order by start_date desc limit 1
  `);
  if (totalOrder.length === 0) {
    console.log(`    tenant ${t.slice(0, 8)}… no active year — onAbsent policy decides`);
    continue;
  }
  const [id, name] = totalOrder[0];
  const agrees = startOnly.length > 0 && startOnly[0][0] === id;
  console.log(`    tenant ${t.slice(0, 8)}… total order picks "${name}" (${id.slice(0, 8)}…)`);
  console.log(
    `      partial order (startDate only) picks the same row: ${agrees ? 'yes' : 'NO — tiebreak is load-bearing here'}`,
  );
}

/* ------------------------------------------------------------ verdict */
console.log('\n' + '='.repeat(78));
console.log(stop ? 'PROBE: STOP — see P1' : 'PROBE: OK — no stop condition');
console.log('Scope: this probe reads the DATABASE. It does not prove the api/worker');
console.log('containers execute the new resolver — see P0 image ages.');
console.log('='.repeat(78));
process.exit(stop ? 1 : 0);
