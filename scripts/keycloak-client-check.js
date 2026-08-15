#!/usr/bin/env node
/**
 * S-E01-4b — the per-portal OIDC client identity ratchet (gates G-AUTHZ, G-PORTAL,
 * G-DNC · decision record `docs/adr/ADR-052-oidc-client-identity-ratchet.md`).
 *
 * WHAT THIS GATE DECIDES
 * ----------------------
 * `PF-18` was one rule — "which OIDC client does portal X speak to?" — written in
 * more than one place, with an alias (`student → parent`) in the copies. The loud
 * half was a dead student login (`invalid_redirect_uri`); the silent half was
 * `azp` collapsed, so a student's token was indistinguishable from a parent's at
 * the client-identity level. `S-E01-4a` (`ADR-050`) fixed it in the accessor, the
 * realm export and the provisioner. It shipped no ratchet, and the ledger's own
 * measurement of that gap is sharper than it looks:
 *
 *   `scripts/ci-gate.sh` defines `GATE_MACHINERY='^(scripts/|\.github/|infra/|
 *   apps/api/src/shared/quality/)'` and runs the FULL api ratchet only on a
 *   match, else `--skip src/shared/quality/`. Neither
 *   `apps/web/src/lib/keycloak-clients.ts` nor `apps/web/src/auth.ts` matches —
 *   so `apps/api/src/shared/quality/keycloak-client-identity-gate.spec.ts`, the
 *   only executable statement of ADR-050's invariants, DOES NOT RUN on a
 *   fast-tier PR that edits the accessor itself.
 *
 * This file closes that hole from outside the api test suite: it is a plain node
 * script, wired as an UNCONDITIONAL TIER-1 stage in `scripts/ci-gate.sh` and
 * mirrored in `.github/workflows/ci.yml`, so no trigger, no tier and no skip
 * branch stands between a regression and a red gate.
 *
 * EXECUTED, NOT PARSED — and that is a deliberate departure (ADR-052 §D1)
 * ----------------------------------------------------------------------
 * `csv-escape-check.js` and `audit-write-check.js` established "parsed, never
 * grepped": lift DECLARATIONS with `require('typescript')`. That convention is
 * the wrong tool here and the reason is measured, not aesthetic. `PF-18`'s actual
 * shape was an alias INSIDE A FUNCTION BODY. Lift `CLIENT_ID_PREFIX = 'portal-'`
 * and reproduce `portal-<id>` from it, and a restored
 * `` return `portal-${ALIAS[portal] ?? portal}` `` leaves the constant untouched,
 * the derived expectation untouched, the export untouched — a green gate over a
 * restored BROKEN_SECURITY.
 *
 * So the two production modules are TRANSPILED AND EVALUATED (`ts.transpileModule`
 * → `node:vm`), with a `require` shim that resolves exactly one specifier,
 * `./portals`. That is admissible only because those modules are contractually
 * inert — no import beyond `./portals`, no `process.env` read (`env` is a
 * PARAMETER of `resolvePortalClientId`, ADR-050 §D2), no side effect, no secret —
 * and this check ASSERTS THAT INERTNESS BEFORE IT EVALUATES. A new import or a
 * `process.env` reference is a FAILURE here, never a reason to fall back to
 * grepping.
 *
 * A BIJECTION, NOT A LOOKUP (ADR-052 §D2)
 * ---------------------------------------
 * Deriving both sides of a comparison from the same accessor makes an accessor
 * regression move them TOGETHER: with `student → parent` restored, "does portal
 * p's client exist?" finds `portal-parent` for both and passes. Deriving is still
 * right — a re-typed expectation is the second hand-maintained list `PF-18` WAS —
 * but derivation alone is not sufficient. What bites is the conjunction:
 *
 *   injective  two portals resolving to one client id is a FAILURE;
 *   total      every portal's client exists with all three of its derived URIs;
 *   closed     no `portal-*` client is unclaimed, and NO client of any kind
 *              registers a URI, or a baseUrl, belonging to another portal —
 *              ADR-050's forbidden repair ("just add /student/* to portal-parent"),
 *              refused BY NAME;
 *   env-safe   an override on portal q may never move portal p (12 ordered pairs).
 *
 * VACUITY FLOOR (`DNC-08`). The four portal ids are carried as a declared FLOOR
 * and the check fails if the accessor's domain stops covering them. It is the one
 * literal this file is allowed to hold, and it is not a second copy of the rule:
 * deleting `'student'` from `PORTAL_IDS` would otherwise shrink the domain to
 * three and pass over a deleted portal. Precedent: `MIN_SANCTIONED_ESCAPERS`.
 *
 * THE WILDCARD RULE IS SCOPED TO THE CALLBACK SEGMENT (ADR-052 §D3)
 * ----------------------------------------------------------------
 * All four portal clients ship `http://localhost:3000/<portal>/*` at HEAD, and
 * that URI is what makes SSO and the `reset-credentials` return work. "No
 * wildcard anywhere in a redirect URI" is therefore RED ON A CORRECT EXPORT, and
 * its only repairs are to weaken the check or to strip the realm. The rule
 * `ADR-050` §D4 actually states, and the one enforced here, is:
 *
 *   W-1  no `*` at or above the `/api/auth/callback/` segment (so no
 *        `/api/auth/callback/*`, no `/api/*`, no bare `/*`);
 *   W-2  the ONLY permitted `*` is the trailing `<own portal app root>/*`, and it
 *        is named as permitted in this check's own output so nobody "fixes" it;
 *   W-3  no `*` in `webOrigins` (a CORS widening) or in
 *        `post.logout.redirect.uris` (an open redirect at logout).
 *
 * PATHS, NOT ORIGINS. The export registers `:3000`; `apps/web` dev runs `:3100`.
 * The origin is a deployment concern (`infra/kc-prod-redirects.mjs` rewrites it);
 * the PATH is the contract between NextAuth and the realm, and the path is what
 * `PF-18` got wrong. Recorded as `PF-212`/`PF-213`, not smoothed over here.
 *
 * DNC-08 — A CHECK THAT CANNOT RUN MUST FAIL
 * ------------------------------------------
 * Every one of these exits non-zero NAMING WHICH, with the file, the anchor and
 * the remedy: `typescript` unresolvable · either production module absent,
 * unparseable, non-inert or missing an expected export · the accessor's portal
 * domain empty or below the floor · the realm export absent or unparseable · the
 * provisioner absent, or its `CLIENTS` map / `callbackPaths` builder not found ·
 * a client the provisioner names that the accessor does not · an `infra/` script
 * carrying an undeclared portal-client list. "Found nothing" is never a pass.
 *
 * DNC-10 — NO ESCAPE HATCH
 * ------------------------
 * The only argument is `--help`; any other argument exits non-zero. There is no
 * `--skip`, no `--force`, no `--update`, no baseline file and NO environment
 * variable that changes the verdict. An "update the expectation" flag on a rule
 * whose whole content is "the expectation is derived" would be the off switch
 * with a house-style alibi.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join, relative, resolve, sep } = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = resolve(__dirname, '..');

const ACCESSOR_REL = 'apps/web/src/lib/keycloak-clients.ts';
const PORTALS_REL = 'apps/web/src/lib/portals.ts';
const REALM_EXPORT_REL = 'infra/keycloak/realm-export.json';
const PROVISIONER_REL = 'infra/kc-prod-redirects.mjs';
const INFRA_DIR_REL = 'infra';
const ADR_REL = 'docs/adr/ADR-052-oidc-client-identity-ratchet.md';

/**
 * ADR-052 §D2 — the vacuity floor. NOT a second copy of the portal→client rule
 * (no client id, no prefix and no path is written here): it is the statement that
 * the accessor's DOMAIN may not shrink below the four portals the product ships.
 */
const PORTAL_FLOOR = Object.freeze(['admin', 'teacher', 'parent', 'student']);

/** The accessor may import this specifier and nothing else (ADR-052 §D1). */
const ALLOWED_ACCESSOR_IMPORTS = Object.freeze(['./portals']);

/**
 * `infra/` scripts that carry a portal-client list, are NOT audited by this gate,
 * and are known-incomplete. Declared here rather than in a comment so a stale
 * entry is itself a failure, and so the gap is printed on every PASS (C-10).
 */
const KNOWN_INCOMPLETE_INFRA = Object.freeze({
  'infra/kc-fix-redirects.mjs':
    'PF-214 — a hard-coded THREE-client list (admin, teacher, parent) with no portal-student. ' +
    'A one-off host-port rewriter, recorded and deliberately not repaired by S-E01-4b.',
});

/** Names the accessor must export, or the derivation is not the production rule. */
const ACCESSOR_ANCHORS = Object.freeze([
  'portalClientId',
  'portalProviderId',
  'portalCallbackPath',
  'portalLegacyCallbackPath',
  'portalResetRedirectPath',
  'resolvePortalClientId',
  'PORTAL_CLIENT_IDS',
]);

/** Names `portals.ts` must export. */
const PORTALS_ANCHORS = Object.freeze(['PORTAL_IDS']);

/**
 * A portal id no product will ever declare, used to read the naming CONVENTIONS
 * back out of the accessor by difference instead of re-typing them. `portal-`,
 * `keycloak-` and `/api/auth/callback/` appear nowhere in this file as literals.
 */
const SENTINEL_PORTAL = '__derived_sentinel_portal__';

/* ------------------------------------------------------------------------- *
 * Failure vocabulary
 * ------------------------------------------------------------------------- */

class GateError extends Error {}

function rel(absolute) {
  return relative(REPO_ROOT, absolute).split(sep).join('/');
}

function abs(relativePath) {
  return join(REPO_ROOT, relativePath);
}

/** DNC-08: an input that cannot be read is a FAILURE naming file + remedy. */
function readSource(relativePath, remedy) {
  const path = abs(relativePath);
  if (!existsSync(path)) {
    throw new GateError(
      `DNC-08 — ${relativePath} does not exist. ${remedy} ` +
        `(decision record: ${ADR_REL}). An absent input is a FAILURE, never a skip.`,
    );
  }
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    throw new GateError(`DNC-08 — ${relativePath} is unreadable: ${(cause && cause.message) || cause}`);
  }
}

function loadTypeScript() {
  try {
    return require('typescript');
  } catch (cause) {
    throw new GateError(
      `DNC-08 — cannot require('typescript') — ${(cause && cause.message) || cause}. ` +
        'The parser is an input; an absent one is a FAILURE, not a skip. ' +
        'Remedy: pnpm install at the repository root (typescript is a root devDependency).',
    );
  }
}

/* ------------------------------------------------------------------------- *
 * ADR-052 §D1 — inertness, asserted BEFORE anything is evaluated
 * ------------------------------------------------------------------------- */

function parseModule(ts, relativePath, source) {
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  if (!sourceFile || !sourceFile.statements) {
    throw new GateError(`DNC-08 — ${relativePath} could not be parsed by typescript`);
  }
  return sourceFile;
}

/**
 * The contract that makes it safe to RUN repository TypeScript inside a gate:
 * no import outside the allow-list, no `require()`, no `process.env` read, no
 * top-level await. If a future edit breaks it, this gate is the first thing that
 * says so — it does not silently fall back to grepping.
 */
function assertInert(ts, relativePath, sourceFile, allowedImports) {
  const problems = [];
  const allowed = new Set(allowedImports);

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
      const spec = node.moduleSpecifier;
      const text = spec && ts.isStringLiteral(spec) ? spec.text : '<computed>';
      // A type-only import cannot survive transpilation and cannot execute.
      const typeOnly = ts.isImportDeclaration(node)
        ? Boolean(node.importClause && node.importClause.isTypeOnly)
        : Boolean(node.isTypeOnly);
      if (!typeOnly && !allowed.has(text)) {
        problems.push(
          `${relativePath} imports '${text}', which is outside this gate's allow-list ` +
            `[${[...allowed].join(', ') || 'none'}]. ADR-052 §D1 makes this module executable ONLY while it ` +
            'stays inert — a new import is a FAILURE, not a reason to weaken the gate.',
        );
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      problems.push(`${relativePath} calls require() — ADR-052 §D1 requires this module to be import-inert`);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'env' &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process'
    ) {
      problems.push(
        `${relativePath} reads process.env — ADR-050 §D2 makes \`env\` a PARAMETER of ` +
          'resolvePortalClientId precisely so a gate can drive the production accessor under a ' +
          'fixture env. A direct read reintroduces the coupling and is a FAILURE.',
      );
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return problems;
}

/* ------------------------------------------------------------------------- *
 * ADR-052 §D1 — transpile and evaluate
 * ------------------------------------------------------------------------- */

function evaluateModule(ts, relativePath, source, requireShim) {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      isolatedModules: true,
    },
    fileName: relativePath,
    reportDiagnostics: true,
  });
  const diagnostics = transpiled.diagnostics || [];
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    const text =
      typeof first.messageText === 'string' ? first.messageText : first.messageText && first.messageText.messageText;
    throw new GateError(`DNC-08 — ${relativePath} did not transpile: ${text}`);
  }

  const moduleObject = { exports: {} };
  const sandbox = {
    module: moduleObject,
    exports: moduleObject.exports,
    require: requireShim,
    // Web globals the accessor legitimately uses. Deliberately no `console`, no
    // `process`, no `fetch`: a module that needs them is not inert.
    URL,
    URLSearchParams,
  };
  try {
    vm.runInNewContext(transpiled.outputText, vm.createContext(sandbox), {
      filename: relativePath,
      timeout: 5000,
    });
  } catch (cause) {
    throw new GateError(
      `DNC-08 — evaluating ${relativePath} threw: ${(cause && cause.message) || cause}. ` +
        'ADR-052 §D1 requires this module to be side-effect free.',
    );
  }
  return moduleObject.exports;
}

function requireAnchors(namespace, anchors, relativePath) {
  for (const anchor of anchors) {
    if (namespace[anchor] === undefined) {
      throw new GateError(
        `DNC-08 — ${relativePath} does not export \`${anchor}\`. This gate derives the portal→client rule ` +
          'by CALLING the production accessor; a missing anchor means it would be checking a rule nobody ' +
          `uses. Remedy: restore the export, or update ${ADR_REL} §D1 and this gate together — never one alone.`,
      );
    }
  }
}

/* ------------------------------------------------------------------------- *
 * deriveRule() — the whole expectation, obtained by executing production code
 * ------------------------------------------------------------------------- */

/**
 * The portal→client rule, DERIVED. Exported so
 * `apps/api/src/shared/quality/keycloak-client-identity-gate.spec.ts` can
 * deep-equal it against the same accessor reached through the COMPILER (a real
 * `import`), which is the anti-drift closure: two independent derivations,
 * neither hand-typed, so the parse cannot drift silently.
 */
function deriveRule() {
  const ts = loadTypeScript();

  const portalsSource = readSource(
    PORTALS_REL,
    'It declares PORTAL_IDS, the domain every portal→client derivation ranges over. Remedy: restore it.',
  );
  const accessorSource = readSource(
    ACCESSOR_REL,
    'It is the single production accessor for portal→OIDC-client identity (ADR-050). Remedy: restore it.',
  );

  const portalsAst = parseModule(ts, PORTALS_REL, portalsSource);
  const accessorAst = parseModule(ts, ACCESSOR_REL, accessorSource);

  const inertness = [
    ...assertInert(ts, PORTALS_REL, portalsAst, []),
    ...assertInert(ts, ACCESSOR_REL, accessorAst, ALLOWED_ACCESSOR_IMPORTS),
  ];
  if (inertness.length > 0) throw new GateError(inertness.join('\n  '));

  const portalsExports = evaluateModule(ts, PORTALS_REL, portalsSource, (specifier) => {
    throw new GateError(`${PORTALS_REL} required '${specifier}'; it must import nothing`);
  });
  requireAnchors(portalsExports, PORTALS_ANCHORS, PORTALS_REL);

  const accessorExports = evaluateModule(ts, ACCESSOR_REL, accessorSource, (specifier) => {
    if (ALLOWED_ACCESSOR_IMPORTS.includes(specifier)) return portalsExports;
    throw new GateError(
      `${ACCESSOR_REL} required '${specifier}'; this gate resolves exactly ` +
        `[${ALLOWED_ACCESSOR_IMPORTS.join(', ')}] (ADR-052 §D1)`,
    );
  });
  requireAnchors(accessorExports, ACCESSOR_ANCHORS, ACCESSOR_REL);

  const portals = Array.from(portalsExports.PORTAL_IDS || []);
  if (portals.length === 0) {
    throw new GateError(
      `DNC-08 — ${PORTALS_REL} exports an EMPTY PORTAL_IDS. Every rule below would then hold vacuously ` +
        'and this gate would pass over a realm with no portal clients at all.',
    );
  }

  // The naming conventions, read back BY DIFFERENCE. `portal-`, `keycloak-` and
  // `/api/auth/callback/` are never typed in this file.
  const sentinelClientId = accessorExports.portalClientId(SENTINEL_PORTAL);
  const sentinelProviderId = accessorExports.portalProviderId(SENTINEL_PORTAL);
  const sentinelCallback = accessorExports.portalCallbackPath(SENTINEL_PORTAL);
  const clientIdPrefix = sentinelClientId.slice(0, sentinelClientId.lastIndexOf(SENTINEL_PORTAL));
  const providerIdPrefix = sentinelProviderId.slice(0, sentinelProviderId.lastIndexOf(SENTINEL_PORTAL));
  const callbackPrefix = sentinelCallback.slice(0, sentinelCallback.lastIndexOf(sentinelProviderId));

  const entries = (project) => Object.fromEntries(portals.map((portal) => [portal, project(portal)]));

  return {
    portals,
    clientIdPrefix,
    providerIdPrefix,
    callbackPrefix,
    clientIds: entries((p) => accessorExports.portalClientId(p)),
    providerIds: entries((p) => accessorExports.portalProviderId(p)),
    callbackPaths: entries((p) => accessorExports.portalCallbackPath(p)),
    legacyCallbackPaths: entries((p) => accessorExports.portalLegacyCallbackPath(p)),
    resetRedirectPaths: entries((p) => accessorExports.portalResetRedirectPath(p)),
    /** `/parent` — the app root the portal's own trailing wildcard may cover (W-2). */
    appRoots: entries((p) => accessorExports.portalResetRedirectPath(p).replace(/\/[^/]*$/, '')),
    /** Kept as a function so the env-independence rule can be executed, not asserted. */
    resolvePortalClientId: accessorExports.resolvePortalClientId,
    declaredClientIds: accessorExports.PORTAL_CLIENT_IDS,
  };
}

/* ------------------------------------------------------------------------- *
 * ADR-052 §D2 — the accessor is a BIJECTION and is env-safe
 * ------------------------------------------------------------------------- */

function auditAccessor(rule) {
  const problems = [];

  // Vacuity floor.
  for (const portal of PORTAL_FLOOR) {
    if (!rule.portals.includes(portal)) {
      problems.push(
        `the accessor's portal domain no longer covers '${portal}' (PORTAL_IDS = [${rule.portals.join(', ')}]). ` +
          `${PORTALS_REL} owns the domain; shrinking it would silently shrink every rule below to the ` +
          'portals that remain, which is how a deleted portal passes a derived gate (ADR-052 §D2).',
      );
    }
  }

  // Injective — this is what an in-body alias (`student → parent`) trips, and it
  // is the ONLY rule that can see PF-18 restored inside the accessor itself.
  for (const [label, map] of [
    ['client id', rule.clientIds],
    ['provider id', rule.providerIds],
    ['callback path', rule.callbackPaths],
    ['legacy callback path', rule.legacyCallbackPaths],
    ['reset redirect path', rule.resetRedirectPaths],
  ]) {
    const seen = new Map();
    for (const portal of rule.portals) {
      const value = map[portal];
      const previous = seen.get(value);
      if (previous !== undefined) {
        problems.push(
          `portals '${previous}' and '${portal}' resolve to the SAME ${label} '${value}' — a client id is a ` +
            'function of the portal alone (ADR-050). This is PF-18: two portals sharing one client collapse ' +
            '`azp`, so no audience check can tell one from the other.',
        );
      }
      seen.set(value, portal);
    }
  }

  // Each portal's own id must name it, and must not name another portal.
  for (const portal of rule.portals) {
    const id = rule.clientIds[portal];
    if (!id.includes(portal)) {
      problems.push(`client id '${id}' does not contain its portal '${portal}'`);
    }
    for (const other of rule.portals) {
      if (other === portal) continue;
      if (id.includes(other)) {
        problems.push(`portal '${portal}' resolves to client '${id}', which names portal '${other}'`);
      }
    }
  }

  // Env-safe: an override on portal q may never move portal p. Executed over
  // every ordered pair, with zero literals (12 pairs at four portals).
  const SENTINEL_VALUE = '__override_sentinel__';
  for (const target of rule.portals) {
    const env = { [`KEYCLOAK_${target.toUpperCase()}_CLIENT_ID`]: SENTINEL_VALUE };
    for (const portal of rule.portals) {
      const resolved = rule.resolvePortalClientId(portal, env);
      if (portal === target) {
        if (resolved !== SENTINEL_VALUE) {
          problems.push(
            `the documented KEYCLOAK_${target.toUpperCase()}_CLIENT_ID override does not reach portal ` +
              `'${target}' (got '${resolved}') — the escape hatch ADR-050 §D2 documents is broken`,
          );
        }
      } else if (resolved === SENTINEL_VALUE) {
        problems.push(
          `an override naming portal '${target}' moved portal '${portal}' to '${resolved}' — there must be ` +
            'no code path from portal A to portal B\'s client id (ADR-050)',
        );
      }
    }
  }

  // The frozen map every consumer reads must agree with the function.
  for (const portal of rule.portals) {
    const declared = rule.declaredClientIds && rule.declaredClientIds[portal];
    if (declared !== rule.clientIds[portal]) {
      problems.push(
        `PORTAL_CLIENT_IDS['${portal}'] = '${declared}' but portalClientId('${portal}') = ` +
          `'${rule.clientIds[portal]}' — the enumerated map and the function have drifted apart`,
      );
    }
  }

  return problems;
}

/* ------------------------------------------------------------------------- *
 * The realm export
 * ------------------------------------------------------------------------- */

function uriPath(uri) {
  if (typeof uri !== 'string') return '';
  try {
    return new URL(uri).pathname;
  } catch {
    return uri;
  }
}

/** Keycloak's `*` is a trailing wildcard: `/student/*` covers `/student/login`. */
function covers(registeredPath, requiredPath) {
  if (registeredPath === '/*' || registeredPath === '*') return true;
  if (registeredPath.endsWith('/*')) return requiredPath.startsWith(registeredPath.slice(0, -1));
  return registeredPath === requiredPath;
}

function pathsOwnedBy(rule, portal) {
  return [rule.callbackPaths[portal], rule.legacyCallbackPaths[portal], rule.resetRedirectPaths[portal]];
}

/** W-1/W-2/W-3 (ADR-052 §D3). Returns the violations for ONE registered URI. */
function wildcardProblems(rule, clientId, ownerPortal, uri) {
  const problems = [];
  const path = uriPath(uri);
  if (!path.includes('*')) return problems;

  const literalPrefix = path.slice(0, path.indexOf('*'));
  // W-1 — the wildcard sits at, or above, the NextAuth callback segment.
  if (path.startsWith(rule.callbackPrefix) || rule.callbackPrefix.startsWith(literalPrefix)) {
    problems.push(
      `client '${clientId}' registers '${uri}', a wildcard reaching '${rule.callbackPrefix}' — a wildcarded ` +
        'callback segment makes EVERY portal client a valid target for EVERY other portal\'s callback, ' +
        'which is PF-18 at a second address (PF-209, ADR-050 §D4). Write the callback URIs out in full.',
    );
    return problems;
  }
  // W-2 — the only permitted wildcard is the owner's own app root.
  const permitted = ownerPortal ? `${rule.appRoots[ownerPortal]}/*` : null;
  if (permitted === null || path !== permitted) {
    problems.push(
      `client '${clientId}' registers '${uri}'` +
        (permitted
          ? `; the only wildcard a portal client may carry is its own '${permitted}' (ADR-052 §D3 W-2)`
          : '; a non-portal client may carry no wildcard at all (ADR-052 §D3 W-2)'),
    );
  }
  return problems;
}

function auditRealm(rule, realm) {
  const problems = [];
  const clients = Array.isArray(realm.clients) ? realm.clients : [];
  if (clients.length === 0) {
    problems.push(`DNC-08 — ${REALM_EXPORT_REL} declares no clients at all; every rule below would hold vacuously`);
    return problems;
  }

  const byId = new Map();
  for (const client of clients) if (client && client.clientId) byId.set(client.clientId, client);

  const ownerOf = new Map();
  for (const portal of rule.portals) ownerOf.set(rule.clientIds[portal], portal);

  // total — every portal has its client, its flags and its three derived URIs.
  for (const portal of rule.portals) {
    const id = rule.clientIds[portal];
    const client = byId.get(id);
    if (!client) {
      problems.push(
        `portal '${portal}' has no client '${id}' in ${REALM_EXPORT_REL} — that portal cannot authenticate at all`,
      );
      continue;
    }
    if (client.publicClient !== false) {
      problems.push(`client '${id}' is not confidential (publicClient must be false) — ADR-004 / ADR-050`);
    }
    if (client.standardFlowEnabled !== true) {
      problems.push(`client '${id}' has standardFlowEnabled != true, so portal '${portal}' cannot use SSO`);
    }
    if (client.directAccessGrantsEnabled !== true) {
      problems.push(
        `client '${id}' has directAccessGrantsEnabled != true, so portal '${portal}' cannot use the ROPC ` +
          'login that is the product\'s primary path',
      );
    }
    const registered = Array.isArray(client.redirectUris) ? client.redirectUris : [];
    for (const required of pathsOwnedBy(rule, portal)) {
      if (!registered.some((uri) => covers(uriPath(uri), required))) {
        problems.push(`client '${id}' does not register '${required}' (portal '${portal}') — compared by PATH, not origin`);
      }
    }
  }

  // closed — no unclaimed `portal-*` client, no trespass, no illegal wildcard.
  for (const client of clients) {
    if (!client || !client.clientId) continue;
    const clientId = client.clientId;
    const owner = ownerOf.get(clientId) || null;

    if (owner === null && clientId.startsWith(rule.clientIdPrefix)) {
      problems.push(
        `client '${clientId}' uses the portal naming convention '${rule.clientIdPrefix}…' but no portal in ` +
          `${PORTALS_REL} claims it — an unclaimed portal client is a portal nobody gates`,
      );
    }

    const uris = Array.isArray(client.redirectUris) ? client.redirectUris : [];
    for (const uri of uris) {
      problems.push(...wildcardProblems(rule, clientId, owner, uri));
      const path = uriPath(uri);
      for (const other of rule.portals) {
        if (other === owner) continue;
        if (pathsOwnedBy(rule, other).some((required) => covers(path, required))) {
          problems.push(
            `client '${clientId}' registers '${uri}', which belongs to portal '${other}'. This is the ` +
              'FORBIDDEN REPAIR named by ADR-050: it makes the symptom disappear and leaves `azp` collapsed, ' +
              'so a student token stays indistinguishable from a parent token.',
          );
        }
      }
    }

    // baseUrl / rootUrl may not point into another portal either.
    for (const [field, value] of [
      ['baseUrl', client.baseUrl],
      ['rootUrl', client.rootUrl],
    ]) {
      if (typeof value !== 'string' || value.length === 0) continue;
      const path = uriPath(value);
      for (const other of rule.portals) {
        if (other === owner) continue;
        const root = rule.appRoots[other];
        if (path === root || path.startsWith(`${root}/`)) {
          problems.push(`client '${clientId}' has ${field} '${value}', which is portal '${other}'s path segment`);
        }
      }
    }

    // W-3 — CORS and logout are widening surfaces the URI rules do not see.
    for (const origin of Array.isArray(client.webOrigins) ? client.webOrigins : []) {
      if (typeof origin === 'string' && origin.includes('*')) {
        problems.push(`client '${clientId}' declares webOrigins '${origin}' — a CORS wildcard (ADR-052 §D3 W-3)`);
      }
    }
    const logout = client.attributes && client.attributes['post.logout.redirect.uris'];
    if (typeof logout === 'string') {
      for (const entry of logout.split('##')) {
        if (entry.includes('*')) {
          problems.push(
            `client '${clientId}' declares post.logout.redirect.uris '${entry}' — a wildcard there is an ` +
              'open redirect at logout (ADR-052 §D3 W-3)',
          );
        }
      }
    }
  }

  // The realm role every portal's provisioning rests on (ADR-021).
  const realmRoles = new Set(((realm.roles && realm.roles.realm) || []).map((role) => role && role.name));
  for (const portal of rule.portals) {
    // `admin` is deliberately excluded: administrators are served by
    // super_admin / school_admin, so there is no realm role named `admin`.
    if (portal === 'admin') continue;
    if (!realmRoles.has(portal)) {
      problems.push(
        `realm role '${portal}' is not declared in ${REALM_EXPORT_REL}, so no ${portal} can be provisioned — ` +
          'keycloak-admin.service.ts#assignRealmRoles THROWS on an unknown role rather than creating it',
      );
    }
  }

  return problems;
}

/* ------------------------------------------------------------------------- *
 * The provisioner — parsed, never executed (it makes network calls on import)
 * ------------------------------------------------------------------------- */

function findDeclaration(ts, sourceFile, name) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/** `\`/api/auth/callback/keycloak-${portal}\`` → `/api/auth/callback/keycloak-<S>`. */
function templateToPattern(ts, node, sentinel) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  let out = node.head.text;
  for (const span of node.templateSpans) out += sentinel + span.literal.text;
  return out;
}

function auditProvisioner(rule) {
  const problems = [];
  const ts = loadTypeScript();
  const source = readSource(
    PROVISIONER_REL,
    'It is the deployment-time writer of the portal clients\' redirect URIs. Remedy: restore it.',
  );
  const ast = parseModule(ts, PROVISIONER_REL, source);

  // ---- the CLIENTS map -----------------------------------------------------
  const clientsDecl = findDeclaration(ts, ast, 'CLIENTS');
  if (!clientsDecl || !clientsDecl.initializer || !ts.isObjectLiteralExpression(clientsDecl.initializer)) {
    problems.push(
      `DNC-08 — ${PROVISIONER_REL} declares no \`CLIENTS\` object literal. This gate cannot confirm the ` +
        'client→portal binding it is here to police, and "cannot confirm" is a FAILURE.',
    );
    return problems;
  }

  const bindings = new Map();
  for (const property of clientsDecl.initializer.properties) {
    if (!ts.isPropertyAssignment(property)) {
      problems.push(`${PROVISIONER_REL}: CLIENTS holds a non-literal entry, which this gate cannot audit`);
      continue;
    }
    const key = ts.isStringLiteral(property.name) || ts.isIdentifier(property.name) ? property.name.text : null;
    if (key === null) {
      problems.push(`${PROVISIONER_REL}: CLIENTS holds a computed key, which this gate cannot audit`);
      continue;
    }
    if (!ts.isArrayLiteralExpression(property.initializer)) {
      problems.push(`${PROVISIONER_REL}: CLIENTS['${key}'] is not an array literal`);
      continue;
    }
    bindings.set(
      key,
      property.initializer.elements.map((element) => (ts.isStringLiteral(element) ? element.text : '<computed>')),
    );
  }

  const derivedIds = rule.portals.map((portal) => rule.clientIds[portal]);
  for (const [clientId, portals] of bindings) {
    if (portals.length !== 1) {
      problems.push(
        `${PROVISIONER_REL}: client '${clientId}' is bound to ${portals.length} portal segments ` +
          `(${portals.join(', ') || 'none'}). Binding two portals to one client is PF-18 by construction — ` +
          'it is what made every student token carry `azp: portal-parent` (PF-209).',
      );
      continue;
    }
    const portal = portals[0];
    if (!rule.portals.includes(portal)) {
      problems.push(`${PROVISIONER_REL}: client '${clientId}' is bound to '${portal}', which is not a portal`);
      continue;
    }
    if (rule.clientIds[portal] !== clientId) {
      problems.push(
        `${PROVISIONER_REL}: client '${clientId}' is bound to portal '${portal}', whose client is ` +
          `'${rule.clientIds[portal]}' per ${ACCESSOR_REL}`,
      );
    }
  }
  for (const id of derivedIds) {
    if (!bindings.has(id)) {
      problems.push(
        `${PROVISIONER_REL}: no entry for '${id}' — the provisioner would never write that portal's redirect ` +
          'URIs, so the portal would deploy with whatever the realm happened to hold',
      );
    }
  }
  for (const clientId of bindings.keys()) {
    if (!derivedIds.includes(clientId)) {
      problems.push(`${PROVISIONER_REL}: entry '${clientId}' matches no portal in ${PORTALS_REL}`);
    }
  }

  // ---- the callback builder ------------------------------------------------
  const callbackDecl = findDeclaration(ts, ast, 'callbackPaths');
  if (!callbackDecl || !callbackDecl.initializer || !ts.isArrowFunction(callbackDecl.initializer)) {
    problems.push(`DNC-08 — ${PROVISIONER_REL} declares no \`callbackPaths\` arrow function`);
  } else {
    const body = callbackDecl.initializer.body;
    if (!body || !ts.isArrayLiteralExpression(body)) {
      problems.push(`${PROVISIONER_REL}: callbackPaths does not return an array literal this gate can audit`);
    } else {
      const emitted = body.elements.map((element) => templateToPattern(ts, element, SENTINEL_PORTAL));
      if (emitted.some((value) => value === null)) {
        problems.push(`${PROVISIONER_REL}: callbackPaths emits an expression this gate cannot resolve`);
      } else {
        const expected = [
          rule.callbackPaths[SENTINEL_PORTAL] !== undefined
            ? rule.callbackPaths[SENTINEL_PORTAL]
            : `${rule.callbackPrefix}${rule.providerIdPrefix}${SENTINEL_PORTAL}`,
          `${rule.callbackPrefix}${SENTINEL_PORTAL}`,
        ];
        for (const required of expected) {
          if (!emitted.includes(required)) {
            problems.push(
              `${PROVISIONER_REL}: callbackPaths does not emit '${required}' (it emits ` +
                `${JSON.stringify(emitted)}) — the provisioner and ${ACCESSOR_REL} have drifted, which is the ` +
                'two-hand-maintained-lists defect this gate exists to prevent',
            );
          }
        }
        for (const value of emitted) {
          if (value.includes('*')) {
            problems.push(
              `${PROVISIONER_REL}: callbackPaths emits '${value}', which contains a wildcard — ` +
                'ADR-050 §D4 / ADR-052 §D3 W-1 forbid any `*` under the callback segment',
            );
          }
        }
      }
    }
  }

  // Any string ANYWHERE in the provisioner that wildcards the callback segment.
  const scanLiterals = (node) => {
    const text = templateToPattern(ts, node, SENTINEL_PORTAL);
    if (typeof text === 'string' && text.includes(rule.callbackPrefix) && text.includes('*')) {
      problems.push(`${PROVISIONER_REL}: '${text}' wildcards the callback segment (ADR-052 §D3 W-1)`);
    }
    ts.forEachChild(node, scanLiterals);
  };
  ts.forEachChild(ast, scanLiterals);

  // ---- DNC-08: a missing client must be a FAILURE, never a benign skip ------
  // The ORIGINAL defect was `✗ client not found (skipped)` followed by exit 0,
  // which is how portal-student stayed unprovisioned while the run looked green.
  let missingClientBranchIsFatal = false;
  let missingClientBranchFound = false;
  const findMissingBranch = (node) => {
    if (
      ts.isIfStatement(node) &&
      ts.isPrefixUnaryExpression(node.expression) &&
      node.expression.operator === ts.SyntaxKind.ExclamationToken
    ) {
      const text = node.getText();
      if (/client not found/i.test(text)) {
        missingClientBranchFound = true;
        if (/\bfailures\s*\+\+|\bfailures\s*\+=|process\.exit\(\s*[1-9]/.test(text)) {
          missingClientBranchIsFatal = true;
        }
      }
    }
    ts.forEachChild(node, findMissingBranch);
  };
  ts.forEachChild(ast, findMissingBranch);
  if (!missingClientBranchFound) {
    problems.push(
      `DNC-08 — ${PROVISIONER_REL} has no "client not found" branch this gate can inspect; it cannot confirm ` +
        'that a missing client fails rather than skips',
    );
  } else if (!missingClientBranchIsFatal) {
    problems.push(
      `DNC-08 — ${PROVISIONER_REL} treats a missing client as a benign skip. That is the ORIGINAL defect: ` +
        '`client not found (skipped)` then exit 0 is how portal-student stayed unprovisioned while the ' +
        'deploy reported success. A missing client must count as a failure.',
    );
  }

  return problems;
}

/* ------------------------------------------------------------------------- *
 * C-10 — every infra/ script carrying a portal-client list is accounted for
 * ------------------------------------------------------------------------- */

function auditInfraCoverage(rule) {
  const problems = [];
  const infraDir = abs(INFRA_DIR_REL);
  if (!existsSync(infraDir)) {
    problems.push(`DNC-08 — ${INFRA_DIR_REL}/ does not exist`);
    return { problems, carriers: [] };
  }
  const carriers = [];
  for (const entry of readdirSync(infraDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.mjs') && !entry.name.endsWith('.js')) continue;
    const relPath = `${INFRA_DIR_REL}/${entry.name}`;
    const text = readFileSync(join(infraDir, entry.name), 'utf8');
    const carries = rule.portals.some((portal) => text.includes(rule.clientIds[portal]));
    if (carries) carriers.push(relPath);
  }

  for (const carrier of carriers) {
    if (carrier === PROVISIONER_REL) continue;
    if (!(carrier in KNOWN_INCOMPLETE_INFRA)) {
      problems.push(
        `${carrier} carries a portal-client list that this gate does not audit and that is not declared as a ` +
          `known-incomplete exception. A stage that FIRES on a file it does not INSPECT is a green alibi — the ` +
          `same shape as the hole this gate closes. Either audit it here, or declare it in ` +
          `KNOWN_INCOMPLETE_INFRA with the finding id that owns it.`,
      );
    }
  }
  for (const declared of Object.keys(KNOWN_INCOMPLETE_INFRA)) {
    if (!carriers.includes(declared)) {
      problems.push(
        `KNOWN_INCOMPLETE_INFRA declares '${declared}', which no longer carries a portal-client list. A stale ` +
          'exception is itself a failure — remove the entry and close the finding it names.',
      );
    }
  }
  return { problems, carriers };
}

/* ------------------------------------------------------------------------- *
 * CLI
 * ------------------------------------------------------------------------- */

function printHelp() {
  console.log(
    [
      'node scripts/keycloak-client-check.js',
      '    Fails when the per-portal OIDC client identity rule (ADR-050) is violated in',
      '    the production accessor, the shipped realm export, or the deployment-time',
      '    provisioner.',
      '',
      `    Rule source (EXECUTED, not parsed): ${ACCESSOR_REL} + ${PORTALS_REL}`,
      `    Artefacts audited:                  ${REALM_EXPORT_REL}, ${PROVISIONER_REL}`,
      `    Decision record:                    ${ADR_REL}`,
      '',
      '    There is no --skip, no --force, no --update, no baseline file and no',
      '    environment variable that changes the verdict (DNC-10). A check that cannot',
      '    run exits non-zero naming what it could not read (DNC-08).',
    ].join('\n'),
  );
}

function fail(lines) {
  console.error('\n══════════════════════════════════════════════════════════════');
  console.error('  KEYCLOAK CLIENT CHECK: FAIL');
  console.error('══════════════════════════════════════════════════════════════');
  for (const line of lines) console.error(`\n✗ ${line}`);
  console.error('');
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    printHelp();
    return;
  }
  if (argv.length > 0) {
    // DNC-10: an unrecognised argument is never ignored. Ignoring it is how
    // `--skip-keycloak` becomes a thing that "already works".
    fail([`unknown argument(s) ${argv.join(' ')} — the only flag is --help`]);
  }

  let rule;
  try {
    rule = deriveRule();
  } catch (error) {
    if (error instanceof GateError) fail([error.message]);
    throw error;
  }

  const problems = [];
  let coverage = { problems: [], carriers: [] };
  try {
    problems.push(...auditAccessor(rule));

    const realmRaw = readSource(
      REALM_EXPORT_REL,
      'It is the realm every environment is imported from. Remedy: restore it.',
    );
    let realm;
    try {
      realm = JSON.parse(realmRaw);
    } catch (cause) {
      fail([`DNC-08 — ${REALM_EXPORT_REL} is unparseable: ${(cause && cause.message) || cause}`]);
    }
    problems.push(...auditRealm(rule, realm));
    problems.push(...auditProvisioner(rule));
    coverage = auditInfraCoverage(rule);
    problems.push(...coverage.problems);
  } catch (error) {
    if (error instanceof GateError) fail([error.message]);
    throw error;
  }

  // Printed on PASS as well as FAIL — the discharge of "reported, never dropped".
  console.log('\n  portal → OIDC client, DERIVED by executing the production accessor');
  for (const portal of rule.portals) {
    console.log(
      `    · ${portal.padEnd(8)} → ${rule.clientIds[portal]}  ` +
        `[${rule.callbackPaths[portal]}, ${rule.legacyCallbackPaths[portal]}, ${rule.appRoots[portal]}/*]`,
    );
  }
  console.log(
    `\n  permitted wildcard (ADR-052 §D3 W-2): each portal's own '<app root>/*' — it is what makes SSO and the\n` +
      `  reset-credentials return work, and it is NAMED as permitted here so it is not "fixed" later.\n` +
      `  forbidden (W-1): any '*' at or above '${rule.callbackPrefix}'.`,
  );
  console.log('\n  infra/ scripts carrying a portal-client list');
  for (const carrier of coverage.carriers) {
    const note = KNOWN_INCOMPLETE_INFRA[carrier];
    console.log(`    · ${carrier}${note ? `  ← NOT AUDITED: ${note}` : '  (audited)'}`);
  }

  if (problems.length > 0) fail(problems);

  console.log(
    `\nKEYCLOAK CLIENT CHECK: PASS — ${rule.portals.length} portals, ${rule.portals.length} distinct confidential ` +
      `clients, ${rule.portals.length * 3} redirect URIs matched BY PATH in ${REALM_EXPORT_REL}, one portal per ` +
      `client in ${PROVISIONER_REL} with a missing client counted as a failure, no '*' at or above ` +
      `'${rule.callbackPrefix}', and no client registering another portal's path`,
  );
}

module.exports = {
  ACCESSOR_REL,
  PORTALS_REL,
  REALM_EXPORT_REL,
  PROVISIONER_REL,
  ADR_REL,
  PORTAL_FLOOR,
  ALLOWED_ACCESSOR_IMPORTS,
  ACCESSOR_ANCHORS,
  PORTALS_ANCHORS,
  KNOWN_INCOMPLETE_INFRA,
  GateError,
  deriveRule,
  auditAccessor,
  auditRealm,
  auditProvisioner,
  auditInfraCoverage,
  covers,
  uriPath,
  wildcardProblems,
};

if (require.main === module) main();
