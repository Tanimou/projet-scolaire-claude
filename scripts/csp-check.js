#!/usr/bin/env node
/**
 * csp-check.js — the gate for the content security policy and for the branding
 * injection sink (S-E06-2 / PF-45, PF-88).
 *
 * WHY THIS EXISTS
 * ---------------
 * `apps/api/src/main.ts` called helmet with `contentSecurityPolicy: false` for
 * the life of the project: helmet was enabled, and the one directive that turns
 * an injection into a non-event was the one switched off. Meanwhile
 * `AppShellRoot#BrandingStyle` interpolated three tenant-controlled strings into
 * a server-rendered `<style>` through `dangerouslySetInnerHTML`, which React does
 * not escape. `red}</style><script>alert(1)</script>` is 37 characters and the
 * DTO allowed 60, so the sink was not CSS injection — it was stored XSS on every
 * authenticated page of all four portals.
 *
 * Fixing both is a diff. Keeping them fixed is this file. Every previous
 * instance of R-26 in this repository had the same shape: an invariant that was
 * true because someone had written it down, and read by nothing.
 *
 * WHAT IT CHECKS, AND WHICH DEFECT EACH CHECK IS FOR
 * --------------------------------------------------
 *   1. The policy builder, DRIVEN not read: `script-src` carries a nonce and
 *      neither `'unsafe-inline'` nor (outside development) `'unsafe-eval'`;
 *      `object-src`/`base-uri`/`frame-ancestors` are locked; two calls produce
 *      two different nonces.                    — a nonce reused across responses
 *      is exactly `'unsafe-inline'`, in more characters.
 *   2. `style-src` does not carry `'unsafe-inline'`, while `style-src-attr` does
 *                                               — the narrow exception is for
 *      React/Radix `style=""` attributes; widening it to `style-src` would
 *      re-open the PF-45 sink itself.
 *   3. The EMITTED `apps/api/dist/main.js` does not disable helmet's CSP
 *                                               — read off the build output and
 *      with comments stripped, because PF-83 proved an assertion over raw file
 *      text can be flipped by a comment that merely mentions the string.
 *   4. The EMITTED web middleware carries the CSP header name
 *                                               — the policy is built per
 *      request in middleware; a middleware that stopped emitting it would leave
 *      every page with no policy and every other check still green.
 *   5. The branding sanitiser, DRIVEN with the hostile fixture
 *                                               — the render half must hold for
 *      rows ALREADY in the database, which write-time validation cannot reach.
 *   6. `infra/docker-compose.prod.yml` does not set `CSP_REPORT_ONLY`
 *                                               — report-only is a rollout
 *      manoeuvre, not a default. Nothing here can remove the header; this check
 *      is what keeps the observation mode from becoming the resting state.
 *   7. `--probe <url>`: a real request to a running stack must answer with a
 *      real policy carrying a real nonce. Optional because `ci-gate.sh` runs
 *      with no services — but when a URL IS given, an unreachable host is a
 *      failure and never a skip (DNC-08).
 */

const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { join, relative, resolve } = require('node:path');

const ROOT = resolve(__dirname, '..');
const rel = (p) => relative(ROOT, p).split('\\').join('/');

const API_MAIN = join(ROOT, 'apps/api/dist/main.js');
const WEB_NEXT = join(ROOT, 'apps/web/.next');
const CONTRACTS_DIST = join(ROOT, 'packages/contracts/dist/index.js');
const COMPOSE_PROD = join(ROOT, 'infra/docker-compose.prod.yml');
const CI_GATE = join(ROOT, 'scripts/ci-gate.sh');
const CI_WORKFLOW = join(ROOT, '.github/workflows/ci.yml');

/** Charges hostiles — identiques à celles du spec, volontairement. */
const HOSTILE = [
  'red}</style><script>alert(1)</script>',
  'url("https://evil.example/x")',
  'expression(alert(1))',
  '#fff"/><script>alert(1)</script>',
  '\\3c /style\\3e',
];

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);
const note = (msg) => notes.push(msg);

/**
 * Enregistre une note SEULEMENT si le bloc qui vient de tourner n'a rien
 * signalé. La première version de ce fichier poussait ses notes sans condition
 * et a imprimé « api artefact: … declares a policy, no disabling flag » juste
 * au-dessus de l'échec disant le contraire — un rapport rassurant à côté d'un
 * défaut est précisément la forme que ce dépôt traque.
 */
function noteIfClean(before, msg) {
  if (failures.length === before) note(msg);
}

/**
 * Retire les commentaires de ligne d'un source JS en PRÉSERVANT les décalages,
 * pour qu'une assertion de contenu ne puisse pas être satisfaite — ni cassée —
 * par une phrase de commentaire. C'est la règle apprise en `PF-83`.
 */
function stripLineComments(source) {
  return source.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/** Trouve le premier fichier correspondant sous une racine, ou null. */
function findFile(root, predicate, depth = 6) {
  if (!existsSync(root)) return null;
  const stack = [[root, 0]];
  while (stack.length > 0) {
    const [dir, level] = stack.pop();
    if (level > depth) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'cache') continue;
        stack.push([full, level + 1]);
      } else if (predicate(entry.name, full)) {
        return full;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1–2. La politique, exécutée
// ---------------------------------------------------------------------------
function checkPolicy(contracts) {
  const before = failures.length;
  const { buildWebCsp, generateCspNonce, resolveCspMode, cspHeaderName } = contracts;

  const nonceA = generateCspNonce();
  const nonceB = generateCspNonce();
  if (nonceA === nonceB) {
    fail('generateCspNonce() returned the same value twice — a reused nonce is `unsafe-inline` with extra steps');
  }
  if (!/^[A-Za-z0-9+/]{20,}={0,2}$/.test(nonceA)) {
    fail(`generateCspNonce() did not return base64 of at least 128 bits (got ${JSON.stringify(nonceA)})`);
  }

  const prod = buildWebCsp({ nonce: nonceA, development: false });
  const dev = buildWebCsp({ nonce: nonceA, development: true });

  const directive = (policy, name) => {
    const found = policy.split(';').map((d) => d.trim()).find((d) => d === name || d.startsWith(`${name} `));
    return found ? found.slice(name.length).trim() : null;
  };

  const scriptSrc = directive(prod, 'script-src');
  if (scriptSrc === null) fail('production policy declares no script-src');
  else {
    if (!scriptSrc.includes(`'nonce-${nonceA}'`)) fail(`script-src does not carry the response nonce: ${scriptSrc}`);
    if (scriptSrc.includes("'unsafe-inline'")) fail(`script-src carries 'unsafe-inline' — that is the whole defect: ${scriptSrc}`);
    if (scriptSrc.includes("'unsafe-eval'")) fail(`production script-src carries 'unsafe-eval': ${scriptSrc}`);
    if (!scriptSrc.includes("'strict-dynamic'")) fail("script-src has no 'strict-dynamic' — Next loads its chunks dynamically and would be blocked");
  }

  const styleSrc = directive(prod, 'style-src');
  const styleSrcAttr = directive(prod, 'style-src-attr');
  if (styleSrc === null) fail('production policy declares no style-src');
  else if (styleSrc.includes("'unsafe-inline'")) {
    fail(`style-src carries 'unsafe-inline' — that re-opens the PF-45 <style> sink: ${styleSrc}`);
  } else if (!styleSrc.includes(`'nonce-${nonceA}'`)) {
    fail(`style-src does not carry the response nonce, so the branding block would be blocked: ${styleSrc}`);
  }
  if (styleSrcAttr !== "'unsafe-inline'") {
    fail(
      'style-src-attr must be declared as `unsafe-inline` explicitly — without it style-src covers ' +
        `style="" attributes too and every Radix popover breaks (got ${JSON.stringify(styleSrcAttr)})`,
    );
  }

  for (const [name, expected] of [
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['frame-ancestors', "'none'"],
    ['default-src', "'self'"],
  ]) {
    if (directive(prod, name) !== expected) {
      fail(`${name} must be ${expected} (got ${JSON.stringify(directive(prod, name))})`);
    }
  }

  // Le mode développement est la seule voie par laquelle `'unsafe-eval'` peut
  // exister ; on vérifie qu'il l'exige VRAIMENT (sinon la branche est morte et
  // la production ne prouve rien) et que rien d'autre ne l'obtient.
  if (!(directive(dev, 'script-src') ?? '').includes("'unsafe-eval'")) {
    fail("development policy has no 'unsafe-eval' — Next's HMR needs it, so this branch is dead code and the production assertion proves nothing");
  }

  if (resolveCspMode({}) !== 'enforce') fail('the default CSP mode is not `enforce`');
  if (resolveCspMode({ CSP_REPORT_ONLY: 'true' }) !== 'report-only') fail('CSP_REPORT_ONLY=true does not select report-only');
  for (const value of ['false', '1', 'off', 'yes', '']) {
    if (resolveCspMode({ CSP_REPORT_ONLY: value }) !== 'enforce') {
      fail(`CSP_REPORT_ONLY=${JSON.stringify(value)} weakened the policy — only the exact string "true" may switch mode`);
    }
  }
  // DNC-10 : aucune valeur ne fait disparaître l'en-tête.
  for (const mode of ['enforce', 'report-only']) {
    if (!cspHeaderName(mode)) fail(`cspHeaderName(${mode}) returned nothing — there must be no way to emit no header at all`);
  }

  noteIfClean(before, `policy: ${prod.split(';').length} directives, nonce ${nonceA.length} chars, mode default=enforce`);
}

// ---------------------------------------------------------------------------
// 5. L'assainissement du branding, exécuté
// ---------------------------------------------------------------------------
function checkBrandingSanitiser(contracts) {
  const before = failures.length;
  const { buildBrandingCss, sanitizeCssColor, sanitizeAssetUrl } = contracts;

  for (const value of HOSTILE) {
    const css = buildBrandingCss({ primaryColor: value, accentColor: value, fontFamily: value });
    if (css !== ':root{}') {
      fail(`buildBrandingCss let a hostile value through: ${JSON.stringify(value)} → ${JSON.stringify(css)}`);
    }
  }
  if (sanitizeAssetUrl('javascript:alert(1)') !== null) fail('sanitizeAssetUrl accepted a javascript: URL');

  // Le chemin positif compte autant : un assainisseur qui refuse tout passerait
  // tous les tests ci-dessus en supprimant la fonctionnalité (R-12).
  const legit = buildBrandingCss({ primaryColor: 'oklch(0.62 0.18 250)', fontFamily: 'Inter' });
  if (!legit.includes('--brand-primary:oklch(0.62 0.18 250)')) {
    fail(`buildBrandingCss rejected the product's own default colour: ${JSON.stringify(legit)}`);
  }
  if (sanitizeCssColor('#2563eb') !== '#2563eb') fail('sanitizeCssColor rejected a plain hex colour');

  noteIfClean(before, `branding sanitiser: ${HOSTILE.length} hostile payloads neutralised, product palette preserved`);
}

// ---------------------------------------------------------------------------
// 3. L'artefact de l'API
// ---------------------------------------------------------------------------
function checkApiArtefact() {
  const before = failures.length;
  if (!existsSync(API_MAIN)) {
    fail(`${rel(API_MAIN)} does not exist — build the api before running this check (a missing build is a failure, not a skip)`);
    return;
  }
  const emitted = stripLineComments(readFileSync(API_MAIN, 'utf8'));
  if (/contentSecurityPolicy\s*:\s*false/.test(emitted)) {
    fail(`${rel(API_MAIN)} still disables helmet's content security policy (contentSecurityPolicy: false)`);
  }
  if (!/frame-ancestors/.test(emitted) || !/default-src/.test(emitted)) {
    fail(`${rel(API_MAIN)} carries no CSP directives — helmet is configured but the policy is empty`);
  }
  noteIfClean(before, `api artefact: ${rel(API_MAIN)} declares a policy, no disabling flag`);
}

// ---------------------------------------------------------------------------
// 4. L'artefact du web
// ---------------------------------------------------------------------------
function checkWebArtefact() {
  const before = failures.length;
  if (!existsSync(WEB_NEXT)) {
    fail(`${rel(WEB_NEXT)} does not exist — build the web app before running this check`);
    return;
  }
  const middleware = findFile(
    WEB_NEXT,
    (name, full) => /^middleware\.js$/.test(name) && statSync(full).size > 0,
  );
  if (!middleware) {
    fail(`no emitted middleware.js under ${rel(WEB_NEXT)} — the policy is built per request in middleware, so without it every page ships with no policy`);
    return;
  }
  const emitted = readFileSync(middleware, 'utf8');
  if (!emitted.includes('content-security-policy')) {
    fail(`${rel(middleware)} does not mention the CSP header — the middleware was emitted without the policy`);
  }
  if (!emitted.includes('x-csp-nonce')) {
    fail(`${rel(middleware)} does not forward x-csp-nonce — the server-rendered <style>/<script> blocks would lose their nonce and be blocked`);
  }
  noteIfClean(before, `web artefact: ${rel(middleware)} emits the policy and forwards the nonce`);
}

// ---------------------------------------------------------------------------
// 4b. Aucune page pré-rendue ne peut porter de script (S-E06-2)
// ---------------------------------------------------------------------------
/**
 * Le nonce est la politique. Un document pré-rendu au build est figé avant que
 * la requête existe, donc il ne peut pas porter le nonce de la réponse qui le
 * sert — et `'strict-dynamic'` fait ignorer `'self'`, si bien qu'un tel document
 * part avec **tous** ses scripts bloqués.
 *
 * Mesuré avant que ce contrôle existe : `/admin/login` était servi
 * `x-nextjs-cache: HIT` avec 21 balises `<script>` et zéro nonce. Le correctif
 * (`force-dynamic` au layout racine) tient aujourd'hui ; ce contrôle est ce qui
 * l'empêche de se défaire à la prochaine page statique ajoutée, dont le symptôme
 * — une page qui s'affiche mais ne réagit pas — ne ressemble pas à une erreur de
 * politique.
 */
function checkNoPrerenderedScripts() {
  const before = failures.length;
  const appDir = join(WEB_NEXT, 'server/app');
  if (!existsSync(appDir)) {
    fail(`${rel(appDir)} does not exist — cannot tell whether any route was prerendered`);
    return;
  }
  const offenders = [];
  const stack = [appDir];
  let scanned = 0;
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.html')) {
        scanned += 1;
        const count = (readFileSync(full, 'utf8').match(/<script/g) ?? []).length;
        if (count > 0) offenders.push(`${rel(full)} (${count} script tags)`);
      }
    }
  }
  if (offenders.length > 0) {
    fail(
      `${offenders.length} prerendered document(s) carry <script> tags and therefore cannot carry the ` +
        'response nonce — every one of their scripts would be blocked by the policy. Render them on ' +
        `demand (the root layout declares \`export const dynamic = 'force-dynamic'\` for exactly this ` +
        `reason):\n    ${offenders.slice(0, 10).join('\n    ')}`,
    );
    return;
  }
  noteIfClean(before, `prerendered documents: ${scanned} scanned, none carries a script tag`);
}

// ---------------------------------------------------------------------------
// 6. Le mode observation ne peut pas devenir l'état par défaut
// ---------------------------------------------------------------------------
function checkDeploymentDefaults() {
  const before = failures.length;
  if (!existsSync(COMPOSE_PROD)) {
    fail(`${rel(COMPOSE_PROD)} not found`);
    return;
  }
  const compose = readFileSync(COMPOSE_PROD, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  if (/CSP_REPORT_ONLY/.test(compose)) {
    fail(
      `${rel(COMPOSE_PROD)} sets CSP_REPORT_ONLY. Report-only is a rollout manoeuvre an operator performs ` +
        'deliberately; declaring it in the deployment description makes observation the resting state, which is ' +
        'the shape of a policy that reports confidence it does not have.',
    );
  }
  noteIfClean(before, `${rel(COMPOSE_PROD)}: no CSP_REPORT_ONLY declared — enforce is the deployed default`);
}

// ---------------------------------------------------------------------------
// Le stage doit exister dans les DEUX harnais et ne peut pas diverger
// ---------------------------------------------------------------------------
function checkWiring() {
  for (const [path, needle] of [
    [CI_GATE, 'csp-check.js'],
    [CI_WORKFLOW, 'csp-check.js'],
  ]) {
    if (!existsSync(path)) {
      fail(`${rel(path)} not found`);
      continue;
    }
    const executable = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    if (!executable.includes(needle)) {
      fail(`${rel(path)} does not run ${needle} (comments are stripped before this check — PF-83)`);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. La sonde vivante (optionnelle, mais jamais un « skip » quand demandée)
// ---------------------------------------------------------------------------
async function probe(url) {
  let res;
  try {
    res = await fetch(url, { redirect: 'manual' });
  } catch (err) {
    fail(`probe ${url} is unreachable (${err.message}) — an unreachable target is a failure, never a skip`);
    return;
  }
  const header =
    res.headers.get('content-security-policy') ?? res.headers.get('content-security-policy-report-only');
  if (!header) {
    fail(`probe ${url} answered ${res.status} with NO content-security-policy header`);
    return;
  }
  const enforcing = Boolean(res.headers.get('content-security-policy'));
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(header);
  if (!nonce) {
    fail(`probe ${url} returned a policy with no nonce: ${header}`);
    return;
  }
  if (/'unsafe-inline'/.test(header.split(';').find((d) => d.trim().startsWith('script-src')) ?? '')) {
    fail(`probe ${url} returned a script-src carrying 'unsafe-inline'`);
  }
  note(
    `probe ${url}: HTTP ${res.status}, ${enforcing ? 'ENFORCING' : 'report-only'}, nonce ${nonce[1].slice(0, 8)}… (${header.split(';').length} directives)`,
  );
  // Deuxième requête : le nonce doit changer.
  const second = await fetch(url, { redirect: 'manual' });
  const secondHeader =
    second.headers.get('content-security-policy') ?? second.headers.get('content-security-policy-report-only');
  const secondNonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(secondHeader ?? '');
  if (!secondNonce || secondNonce[1] === nonce[1]) {
    fail(`probe ${url} reused the same nonce across two responses — that is 'unsafe-inline' in disguise`);
  } else {
    note(`probe ${url}: a second request produced a different nonce (${secondNonce[1].slice(0, 8)}…)`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const probeIndex = args.indexOf('--probe');
  const probeUrl = probeIndex >= 0 ? args[probeIndex + 1] : null;

  if (!existsSync(CONTRACTS_DIST)) {
    console.error(`\n✗ ${rel(CONTRACTS_DIST)} does not exist — build @pilotage/contracts first.`);
    console.error('  This check DRIVES the policy builder rather than reading its source, so a');
    console.error('  missing build means nothing was verified. That is a failure, not a skip.\n');
    process.exit(1);
  }
  const contracts = require(CONTRACTS_DIST);

  checkPolicy(contracts);
  checkBrandingSanitiser(contracts);
  checkApiArtefact();
  checkWebArtefact();
  checkNoPrerenderedScripts();
  checkDeploymentDefaults();
  checkWiring();
  if (probeUrl) await probe(probeUrl);

  for (const n of notes) console.log(`  · ${n}`);

  if (failures.length > 0) {
    console.error('\n══════════════════════════════════════════════════════════════');
    console.error('  CSP CHECK: FAIL');
    console.error('══════════════════════════════════════════════════════════════');
    for (const f of failures) console.error(`\n✗ ${f}`);
    console.error('');
    process.exit(1);
  }

  console.log(
    `\nCSP CHECK: PASS — policy nonced and enforcing by default, branding sink inert${probeUrl ? ', live probe answered' : ''}`,
  );
}

main().catch((err) => {
  console.error('\nCSP CHECK: FAIL — the check itself threw');
  console.error(err);
  process.exit(1);
});
