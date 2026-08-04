#!/usr/bin/env node
/**
 * tracing-check.js — the gate over the trace pipeline (S-E02-14 / PF-78).
 *
 * WHY THIS EXISTS
 * ---------------
 * `infra/docker-compose.yml` has declared a `jaeger` service and handed
 * applications an `OTEL_EXPORTER_OTLP_ENDPOINT` since the `obs` profile was
 * written. Measured at run 15, a case-insensitive grep for `opentelemetry|otel`
 * over all three applications' source returned **zero hits**. A collector was
 * deployed, an address was supplied, and nothing on earth emitted a span. The
 * only `@opentelemetry/api` in the tree arrived transitively through
 * `prom-client`.
 *
 * That is R-26 again: a declared capability nothing reads. This file reads it.
 *
 * WHY IT IS A SEPARATE SCRIPT FROM `observability-check.js`
 * --------------------------------------------------------
 * Both read the same compose files, and duplicating that reading is precisely
 * the drift S-E02-10 warned about — so the compose loading is **imported** from
 * `observability-check.js` rather than rewritten here.
 *
 * What is not shared is the shape of the proof. `observability-check.js` reads
 * configuration and asserts it is coherent. This file additionally **runs the
 * thing**: it spawns a child Node process that loads the built tracing module,
 * serves a real request over a real socket, and reports how many spans came
 * out. That is a different kind of check with a different failure mode (a
 * subprocess that hangs, an instrumentation that silently patches nothing), and
 * bolting it onto the Prometheus config reader would make one script do two
 * unrelated jobs.
 *
 * WHAT IT CHECKS, AND WHICH DEFECT EACH ONE IS FOR
 * -----------------------------------------------
 *  1. exactly the services in `TRACED_SERVICES` are handed an OTLP endpoint
 *       → the half of PF-78 the finding never mentioned. The variable lived on
 *         the shared env anchor and reached **five** services — migrator, api,
 *         worker, web, seed — of which three cannot emit anything. Checked in
 *         both directions: a traced service that stops declaring it fails too
 *  2. the SDK really ships **inside the emitted artefact**
 *       → the sharp one, in two shapes. For api/worker: the tracing bootstrap
 *         must be required BEFORE the application module in the emitted
 *         `main.js`, because OpenTelemetry's auto-instrumentation patches
 *         modules as they are loaded — a SDK started after
 *         `require('./app.module')` finds `http`, `express` and `@nestjs/core`
 *         already resolved, patches nothing, throws nothing, and the
 *         application boots looking instrumented while emitting no request
 *         spans. For web (S-E02-15): Next has no `main.js` and guarantees the
 *         hook runs before it serves, so a byte-order assertion there would be
 *         asserting instead of executing; what is checked instead is that
 *         `.next/server/instrumentation.js` (or `.next/server/src/…`) was
 *         emitted at all and that the registered metric names are carried by
 *         that entry **or by the async chunks emitted beside it** — because the
 *         hook reaches its implementation through `await import()`, which
 *         webpack code-splits into `.next/server/chunks/<id>.js` by
 *         construction (see the note on `APP_ARTEFACTS.web`)
 *  3. a real request produces real spans, and those spans carry no identifier
 *       → the finding itself. Executed in a child process under plain Node.
 *         For web the same probe additionally re-scrapes its own Prometheus
 *         socket and the gate asserts a histogram SAMPLE exists, labelled by
 *         route template — because prom-client emits `# TYPE` for a histogram
 *         that has never been observed, so "registered" is not "measured"
 *  4. the jaeger service can receive what is sent to it
 *       → the collector must exist, enable OTLP, and expose the port the
 *         endpoint names — the same class as check 3 of `observability-check.js`
 *
 * THREE ARTEFACTS SINCE S-E02-15 (PF-79)
 * --------------------------------------
 * `TRACED_SERVICES` gained `'web'`, so `APP_ARTEFACTS` had to gain a web entry
 * or `collect()` throws its own "knows no artefact" error. That throw is
 * deliberate and was kept: a traced service with no artefact entry must be a
 * loud failure, never a silent pass.
 *
 * WHY THE EMISSION PROOF IS NOT A JEST TEST — measured, not assumed
 * ----------------------------------------------------------------
 * It was written as one first, on a real socket, mirroring
 * `metrics-server.spec.ts`. **It produced 0 spans.** OpenTelemetry's
 * auto-instrumentation hooks `Module._load` via `require-in-the-middle`; jest
 * does not use Node's module registry, so the hook never fires and every
 * instrumentation silently patches nothing. The identical probe run under a
 * real Node loader produces **2** spans, correctly redacted.
 *
 * Same class as `jose` under ts-jest (PF-67), same answer as `S-E02-9`: run it
 * outside jest, against `dist/`, which is also the artefact that ships.
 *
 * WHAT IT DOES NOT PROVE — stated plainly
 * ---------------------------------------
 * It does not start Jaeger and watch a span arrive. That needs
 * `docker compose --profile obs up`, which the routine forbids. So the pipeline
 * is proven to **emit and redact**; the hop from the exporter to the collector
 * is configuration this file reads, not traffic it observes. And the spans it
 * proves are HTTP spans — no official BullMQ instrumentation exists, so job
 * processing is not traced.
 *
 * For web specifically: it does not boot Next (which needs a database and a
 * Keycloak session). It proves the module measures, serves and redacts, and
 * that Next compiled the hook carrying that module. That **Next itself emits**
 * those spans is inferred from its built-in OpenTelemetry support, not
 * executed. Written here rather than implied.
 *
 * Usage:  node scripts/tracing-check.js
 * Exit code is non-zero if any check fails. There is no bypass flag (DNC-10).
 */

const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');

const { collectFromRepo } = require('./observability-check');

const REPO_ROOT = resolve(__dirname, '..');

/** Variable d'environnement qui déclare le collecteur. */
const OTLP_ENV = 'OTEL_EXPORTER_OTLP_ENDPOINT';

/**
 * Les applications attendues émettrices, et où leur artefact se trouve.
 *
 * La liste de vérité est `TRACED_SERVICES` dans `@pilotage/contracts` — lue
 * ci-dessous depuis le paquet **construit**, pas recopiée. Une deuxième copie
 * ici, et le jour où l'une des deux change, la gate approuve la divergence
 * qu'elle est censée détecter.
 */
const APP_ARTEFACTS = {
  api: {
    proof: 'requireOrder',
    main: 'apps/api/dist/main.js',
    tracing: 'apps/api/dist/shared/tracing/tracing.js',
    bootstrapMarker: 'shared/tracing/tracing.bootstrap',
    appModuleMarker: './app.module',
    probe: 'trace-emission-probe.js',
  },
  worker: {
    proof: 'requireOrder',
    main: 'apps/worker/dist/main.js',
    tracing: 'apps/worker/dist/shared/tracing/tracing.js',
    bootstrapMarker: 'shared/tracing/tracing.bootstrap',
    appModuleMarker: './app.module',
    probe: 'trace-emission-probe.js',
  },
  /**
   * `apps/web` (S-E02-15 / PF-79) — le troisième artefact, avec une preuve de
   * forme différente, et il faut dire pourquoi.
   *
   * Les deux applications Nest sont jugées sur l'ORDRE des `require` dans le
   * `main.js` émis, parce que l'instrumentation automatique patche les modules
   * au chargement : démarrer le SDK trop tard ne patche rien et ne dit rien.
   * **Next n'a pas de `main.js`**, et surtout Next *garantit* que `register()`
   * s'exécute avant qu'une requête soit servie — recopier une assertion
   * d'ordre d'octets ici serait affirmer au lieu d'exécuter, précisément le
   * défaut que cette épique existe pour finir.
   *
   * La preuve utile pour web est donc l'ARTEFACT ÉMIS : le hook a-t-il été
   * compilé, et le bundle porte-t-il bien le registre qu'on prétend qu'il
   * porte ? Les deux chemins candidats sont cherchés — cette application a un
   * répertoire `src/`, ce qui est la raison pour laquelle son middleware émis
   * atterrit dans `.next/server/src/middleware.js` — et aucun n'est codé en
   * dur seul.
   *
   * ET LE FRAGMENT ASYNCHRONE, qui a failli rendre cette gate rouge sur un
   * artefact correct. `instrumentation.ts` atteint son implémentation par
   * `await import('./observability/web-observability.js')` — obligatoire : un
   * import statique serait RÉSOLU pour le runtime edge, où ni `node:http` ni
   * `prom-client` n'existent. Or webpack émet un import dynamique dans un
   * **chunk asynchrone séparé** : le compilateur serveur de Next écrit l'entrée
   * en `.next/server/instrumentation.js` et l'implémentation en
   * `.next/server/chunks/<id>.js`, et son `splitChunks` de production ne
   * refusionne jamais un chunk asynchrone dans l'entrée. Chercher les marqueurs
   * dans la seule entrée reviendrait donc à exiger de Next l'inverse de ce
   * qu'il fait, et mettrait la règle « import dynamique » et la règle
   * « marqueurs présents » en contradiction directe. Ce qui est lu, c'est donc
   * l'entrée **plus les fragments émis à côté d'elle** (`related`), l'entrée
   * restant seule responsable des contrôles « émise » et « non vide ».
   *
   * CE QUE ÇA PROUVE : Next a compilé le hook, et le hook embarque les métriques
   * annoncées, donc l'artefact qui ship correspond au module que la gate a lu.
   * CE QUE ÇA NE PROUVE PAS : que Next émette lui-même des spans — il faudrait
   * un Next booté avec une base de données et une session Keycloak. Cette
   * moitié est déduite du support OpenTelemetry intégré de Next, et c'est écrit
   * ici plutôt que sous-entendu.
   */
  web: {
    proof: 'bundleContains',
    bundleCandidates: [
      'apps/web/.next/server/instrumentation.js',
      'apps/web/.next/server/src/instrumentation.js',
    ],
    requiredMarkers: ['pilotage_http_request_duration_seconds', 'pilotage_http_requests_total'],
    module: 'apps/web/src/observability/web-observability.js',
    probe: 'web-observability-probe.js',
  },
};

/**
 * Les valeurs que `web-observability-probe.js` tente délibérément de faire
 * fuir, et le gabarit sous lequel elles doivent réapparaître.
 *
 * Écrites des deux côtés plutôt que transmises par la sonde : une assertion qui
 * lit sa propre attente dans la charge utile qu'elle juge ne juge rien. Même
 * posture que le `'clx1234567890abcdefghij'` en dur du contrôle 3.
 */
const WEB_PROBE_ROUTE_TEMPLATE = '/parent/students/[id]/grades';
const WEB_DURATION_METRIC = 'pilotage_http_request_duration_seconds';

/* ------------------------------------------------------------------ *
 * Pure evaluation
 *
 * Everything below `evaluateTracing` is I/O. The evaluation is a pure function
 * of a plain object for the reason S-E02-12 made one: a check run only against
 * a healthy repository demonstrates that the repository is healthy, and nothing
 * more. The spec drives this with configurations known to be wrong.
 * ------------------------------------------------------------------ */

/** `[` et `]` d'un gabarit de route Next sont des méta-caractères d'expression régulière. */
function escapeForRegExp(raw) {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {{
 *   tracedServices: string[],
 *   composeServices: Record<string, { file: string, environment: Record<string, unknown>, ports: string[], profiles: string[] }>,
 *   mains: Record<string, { file: string, source: string | null, related?: Array<{ file: string, source: string }> }>,
 *   emission: Record<string, { spans: number, serialised: string, error?: string } | null>,
 * }} input
 */
function evaluateTracing(input) {
  const problems = [];
  const notes = [];

  const traced = [...input.tracedServices].sort();

  /* -- 1. exactly the traced services declare a collector -------------- */
  const declaring = Object.entries(input.composeServices)
    .filter(([, service]) => Object.prototype.hasOwnProperty.call(service.environment, OTLP_ENV))
    .map(([name]) => name)
    .sort();

  const unexpected = declaring.filter((name) => !traced.includes(name));
  const missing = traced.filter((name) => !declaring.includes(name));

  for (const name of unexpected) {
    problems.push(
      `service "${name}" is handed ${OTLP_ENV} but is not in TRACED_SERVICES, so nothing in it ` +
        'starts an OpenTelemetry SDK. Declaring a collector to a service that will never use it ' +
        'is PF-78 in miniature — it is exactly how the finding came to exist, on the shared ' +
        'environment anchor, for five services at once. ' +
        // PM-18 : distinguer les deux causes, parce que le remède est opposé.
        'BEFORE removing it from the compose file, check the other possibility: TRACED_SERVICES ' +
        'is read from packages/contracts/**dist**, so a source that already names this service ' +
        'and a dist that predates it produce this exact message. If ' +
        `packages/contracts/src/observability/tracing-policy.ts already lists "${name}", the fix ` +
        'is to rebuild the contracts package, not to un-declare the collector.',
    );
  }
  for (const name of missing) {
    problems.push(
      `service "${name}" is in TRACED_SERVICES but is handed no ${OTLP_ENV}, so its SDK will ` +
        'start disabled in every environment. The check fails in this direction too: a traced ' +
        'application that silently stops being able to export is the original defect returning.',
    );
  }
  if (unexpected.length === 0 && missing.length === 0) {
    notes.push(`${OTLP_ENV} is declared for exactly [${traced.join(', ')}] — and nothing else`);
  }

  /* -- 2. the SDK really ships inside the artefact --------------------- */
  for (const app of traced) {
    const artefact = APP_ARTEFACTS[app];
    if (artefact === undefined) {
      problems.push(
        `TRACED_SERVICES names "${app}", for which this gate knows no artefact. Add it to ` +
          'APP_ARTEFACTS rather than letting it go unchecked.',
      );
      continue;
    }

    const main = input.mains[app];
    if (main === undefined || main.source === null) {
      problems.push(
        `${app}: ${main ? main.file : `build output for ${app}`} is absent, so the load order that ` +
          'makes instrumentation work cannot be verified. That is a failure, not a skip — with ' +
          'nothing to read, this check would pass vacuously.',
      );
      continue;
    }

    // Next n'a pas de `main.js` et garantit lui-même l'ordre : la preuve utile
    // est que le hook ait été COMPILÉ et qu'il embarque le registre annoncé.
    // Voir la note sur `APP_ARTEFACTS.web`.
    if (artefact.proof === 'bundleContains') {
      if (main.source.trim() === '') {
        problems.push(
          `${app}: ${main.file} is empty. An emitted-but-empty instrumentation bundle is the same ` +
            'defect as an absent one — Next would call a `register()` that does nothing — and it ' +
            'is a failure, never a skip.',
        );
        continue;
      }
      // Le hook charge son implémentation par `await import()`, que webpack
      // code-splitte dans un chunk asynchrone : l'entrée émise ne porte alors
      // qu'un `require("./chunks/<id>.js")`. Les fragments émis à côté d'elle
      // font donc partie de l'artefact lu. Voir la note sur `APP_ARTEFACTS.web`.
      const related = main.related ?? [];
      const emitted = [main.source, ...related.map((chunk) => chunk.source)].join('\n');

      const missing = (artefact.requiredMarkers ?? []).filter(
        (marker) => !emitted.includes(marker),
      );
      if (missing.length > 0) {
        const where =
          related.length === 0
            ? main.file
            : `${main.file} (nor any of the ${related.length} chunk(s) emitted beside it)`;
        problems.push(
          `${app}: ${where} was emitted but does not contain [${missing.join(', ')}]. The hook ` +
            'compiled without the metric registry it is supposed to carry, so the artefact that ' +
            'ships is not the module this gate read — which is the whole point of reading the ' +
            'emitted output rather than the source (R-26 rule (a)).',
        );
        continue;
      }
      notes.push(
        `${app}: the emitted instrumentation bundle (${main.file}${
          related.length === 0 ? '' : ` + ${related.length} emitted chunk(s)`
        }) carries the registered metric names`,
      );
      continue;
    }

    const bootIndex = main.source.indexOf(artefact.bootstrapMarker);
    const appIndex = main.source.indexOf(artefact.appModuleMarker);

    if (bootIndex === -1) {
      problems.push(
        `${app}: ${main.file} never requires "${artefact.bootstrapMarker}", so no SDK starts. ` +
          'This is the finding itself, at the one address where it is invisible: the application ' +
          'boots, the collector is configured, and no span is ever produced.',
      );
      continue;
    }
    if (appIndex === -1) {
      problems.push(
        `${app}: ${main.file} never requires "${artefact.appModuleMarker}", so the load order ` +
          'cannot be judged. The check refuses to guess.',
      );
      continue;
    }
    if (bootIndex > appIndex) {
      problems.push(
        `${app}: ${main.file} requires "${artefact.bootstrapMarker}" AFTER ` +
          `"${artefact.appModuleMarker}". OpenTelemetry patches modules as they are loaded, so a ` +
          'SDK started at that point finds http, express and @nestjs/core already resolved: it ' +
          'patches nothing, throws nothing, and the application emits no request spans while ' +
          'looking fully instrumented.',
      );
      continue;
    }
    notes.push(`${app}: tracing bootstrap is required before the application module`);
  }

  /* -- 3. a real request really produced spans, and leaked nothing ----- */
  for (const app of traced) {
    const emission = input.emission[app];
    if (emission === undefined || emission === null) {
      problems.push(
        `${app}: the emission probe did not run, so "spans are emitted" is unproven. PF-78 is ` +
          'precisely the state in which everything is configured and nothing is emitted, so an ' +
          'unrun probe must fail rather than skip.',
      );
      continue;
    }
    if (emission.error !== undefined) {
      problems.push(`${app}: the emission probe failed — ${emission.error}`);
      continue;
    }
    if (emission.spans === 0) {
      problems.push(
        `${app}: a real request over a real socket produced 0 spans. This is PF-78 exactly: the ` +
          'SDK constructs, the exporter is wired, and the instrumentation patched nothing.',
      );
      continue;
    }

    // G-TENANT. Les sondes envoient un cuid et une query string ; ni l'un ni
    // l'autre ne doit apparaître dans ce qui sortirait du process.
    for (const secret of ['clx1234567890abcdefghij', 'tenantId']) {
      if (emission.serialised.includes(secret)) {
        problems.push(
          `${app}: the exported spans contain "${secret}". Jaeger is unauthenticated by ` +
            'construction — its access control IS the docker network — so the payload has to be ' +
            'safe on its own terms. See packages/contracts/src/observability.',
        );
      }
    }
    notes.push(`${app}: a real request produced ${emission.spans} span(s), carrying no identifier`);
  }

  /* -- 3b. web: the Prometheus measurement is FED, not merely declared -- */

  // prom-client emits a `# HELP`/`# TYPE` pair for a labelled histogram that
  // has NEVER been observed. So `observability-check.js` — which reads `# TYPE`
  // lines — would accept a web SLO panel that renders "No data" for ever, which
  // is indistinguishable from a system at rest. That is the exact defect this
  // epic keeps finding, and it would have reappeared at this address. Only a
  // probe that pushes a span and re-scrapes can tell the difference.
  for (const app of traced) {
    const emission = input.emission[app];
    if (!emission || typeof emission.exposition !== 'string') continue;

    const exposition = emission.exposition;
    const sample = new RegExp(
      `^${WEB_DURATION_METRIC}_bucket\\{[^}]*route="${escapeForRegExp(WEB_PROBE_ROUTE_TEMPLATE)}"`,
      'm',
    );

    if (!sample.test(exposition)) {
      problems.push(
        `${app}: after a real span, the exposition carries no ${WEB_DURATION_METRIC}_bucket sample ` +
          `labelled route="${WEB_PROBE_ROUTE_TEMPLATE}". A histogram that is registered but never ` +
          'observed passes every check that reads `# TYPE` lines and renders "No data" for ever — ' +
          'which reads exactly like a system at rest. Either the span→metric processor is not on ' +
          'the provider, or the route label is not derived from the template.',
      );
    }

    // G-TENANT sur la SECONDE surface non authentifiée. Le processeur de spans
    // voit les attributs AVANT le caviardage de l'exportateur : ce qui devient
    // une étiquette part vers Prometheus tel quel. Le caviardage protège les
    // traces, pas les métriques — la règle doit tenir ici aussi.
    for (const secret of ['clx1234567890abcdefghij', 'tenantId']) {
      if (exposition.includes(secret)) {
        problems.push(
          `${app}: the Prometheus exposition contains "${secret}". A resolved URL in a label is ` +
            'both an unbounded-cardinality explosion any scanner can trigger and a tenant ' +
            'identifier on an endpoint that carries no token. Label by route template only — see ' +
            'routeLabelFromSpan in apps/web/src/observability/web-observability.js.',
        );
      }
    }

    notes.push(`${app}: the exposition carries a route-template-labelled histogram sample`);
  }

  /* -- 4. the collector can receive what is sent to it ----------------- */
  const endpoints = new Set();
  for (const app of traced) {
    const service = input.composeServices[app];
    const raw = service?.environment?.[OTLP_ENV];
    // `${VAR:-}` — vide par défaut, donc traçage désactivé sauf déclaration
    // explicite de l'opérateur. Ce n'est pas une cible à valider.
    const match = typeof raw === 'string' ? /https?:\/\/[^\s}]+/.exec(raw) : null;
    if (match) endpoints.add(match[0]);
  }

  const jaeger = input.composeServices.jaeger;
  if (jaeger === undefined) {
    problems.push(
      'no "jaeger" service is declared in any compose file, so the traces the applications now ' +
        'emit have nowhere to go. An emitter without a collector is the mirror image of the ' +
        'collector-without-emitter this slice repaired.',
    );
  } else {
    if (String(jaeger.environment.COLLECTOR_OTLP_ENABLED ?? '').toLowerCase() !== 'true') {
      problems.push(
        'the jaeger service does not set COLLECTOR_OTLP_ENABLED=true, so it will not listen for ' +
          'OTLP at all — the exporters would post into a closed port.',
      );
    }
    const published = jaeger.ports.map((port) => String(port).split(':').pop());
    if (!published.includes('4318')) {
      problems.push(
        `the jaeger service does not expose the OTLP/HTTP port 4318 (exposes: ${
          published.join(', ') || 'nothing'
        }). The exporters are OTLP over HTTP; 4317 is the gRPC port and will not answer them.`,
      );
    } else {
      notes.push('jaeger accepts OTLP/HTTP on 4318');
    }
  }

  for (const endpoint of endpoints) {
    const host = endpoint.replace(/^https?:\/\//, '').split(':')[0];
    if (input.composeServices[host] === undefined) {
      problems.push(
        `${OTLP_ENV} points at host "${host}", which names no compose service. The exporter would ` +
          'fail DNS on every flush, and a failing exporter is silent by design.',
      );
    }
  }

  return { problems, notes };
}

/* ------------------------------------------------------------------ *
 * I/O
 * ------------------------------------------------------------------ */

/**
 * Merges every compose file the way compose merges, one level into
 * `environment` — the bug `observability-check.js` caught in itself at run 15,
 * where `Object.assign` let a partial `api` override replace the base service
 * wholesale.
 */
function collectComposeServices(composeFiles) {
  const services = {};

  for (const { file, doc } of composeFiles) {
    for (const [name, raw] of Object.entries(doc?.services ?? {})) {
      const existing = services[name] ?? {
        file,
        environment: {},
        ports: [],
        profiles: [],
      };
      services[name] = {
        file: existing.file,
        environment: { ...existing.environment, ...normaliseEnv(raw?.environment) },
        ports: raw?.ports ? raw.ports.map(String) : existing.ports,
        profiles: raw?.profiles ?? existing.profiles,
      };
    }
  }

  return services;
}

/** `environment` accepte une map ou une liste `KEY=value`. Les deux sont utilisées ici. */
function normaliseEnv(environment) {
  if (environment === undefined || environment === null) return {};
  if (Array.isArray(environment)) {
    const out = {};
    for (const entry of environment) {
      const [key, ...rest] = String(entry).split('=');
      out[key] = rest.join('=');
    }
    return out;
  }
  return { ...environment };
}

/**
 * Lit `TRACED_SERVICES` depuis le paquet **construit**, jamais depuis le
 * source : c'est la règle (a) de R-26, et c'est le même choix que
 * `observability-check.js` fait pour les noms de métriques.
 */
function readTracedServices() {
  const built = join(REPO_ROOT, 'packages/contracts/dist/index.js');
  if (!existsSync(built)) return null;
  const mod = require(built);
  return Array.isArray(mod.TRACED_SERVICES) ? [...mod.TRACED_SERVICES] : null;
}

/**
 * Exécute la sonde d'émission dans un **process Node enfant**.
 *
 * Enfant et pas `require` en ligne pour deux raisons, toutes deux mesurées :
 * un SDK OpenTelemetry est global au process et ne se démarre proprement
 * qu'une fois, et les hooks de `require-in-the-middle` doivent être posés
 * avant que `http` soit chargé — or ce script a déjà chargé beaucoup de choses
 * au moment où il en arrive ici.
 */
function runEmissionProbe(app) {
  const artefact = APP_ARTEFACTS[app];
  const probe = join(__dirname, artefact.probe);
  const args = [];

  // api/worker : la sonde reçoit le module de traçage **construit**. web : elle
  // require le module CommonJS qui ship verbatim (apps/web n'a pas de `dist/`).
  // Dans les deux cas, une entrée absente est une ERREUR, jamais un skip.
  const required = artefact.tracing ?? artefact.module;
  const requiredPath = join(REPO_ROOT, required);
  if (!existsSync(requiredPath)) {
    return { spans: 0, serialised: '', error: `${required} is absent (build output missing)` };
  }
  if (artefact.tracing !== undefined) args.push(requiredPath);

  const result = spawnSync(process.execPath, [probe, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
  });

  // Un enfant tué par le timeout rend `status === null` et porte `error`. Le
  // dire explicitement, sinon un blocage se lit « probe exited null » et
  // ressemble à un bug de la gate plutôt qu'à une sonde qui pend.
  if (result.error !== undefined && result.error !== null) {
    return {
      spans: 0,
      serialised: '',
      error: `probe did not complete (${result.error.code ?? result.error.message}) — a hung probe is a failure, not a skip`,
    };
  }

  if (result.status !== 0) {
    return {
      spans: 0,
      serialised: '',
      error: `probe exited ${result.status}: ${(result.stderr || result.stdout || '').trim().slice(0, 500)}`,
    };
  }

  const line = result.stdout.split('\n').find((l) => l.startsWith('PROBE_RESULT '));
  if (line === undefined) {
    return { spans: 0, serialised: '', error: 'probe produced no result line' };
  }

  try {
    const payload = JSON.parse(line.slice('PROBE_RESULT '.length));
    const emission = { spans: payload.spans, serialised: JSON.stringify(payload.data) };
    // Seule la sonde web rapporte une exposition Prometheus ; sa présence est
    // ce qui déclenche le contrôle 3b.
    if (typeof payload.exposition === 'string') emission.exposition = payload.exposition;
    return emission;
  } catch (error) {
    return { spans: 0, serialised: '', error: `probe result unparseable: ${String(error)}` };
  }
}

/**
 * Le fichier émis qui porte la preuve, pour un artefact donné.
 *
 * Pour api/worker c'est `dist/main.js`. Pour web, le hook `register()` est émis
 * sous `.next/server/instrumentation.js` **ou** `.next/server/src/instrumentation.js`
 * selon que l'application a un répertoire `src/` — celle-ci en a un, ce qui est
 * la raison pour laquelle son middleware atterrit sous `src/`. Les deux sont
 * cherchés ; aucun n'est codé en dur seul, parce que le jour où Next change
 * d'avis, une gate qui n'en connaît qu'un devient une gate qui échoue pour la
 * mauvaise raison.
 */
function readArtefactProof(artefact) {
  if (artefact.proof === 'bundleContains') {
    for (const candidate of artefact.bundleCandidates) {
      const path = join(REPO_ROOT, candidate);
      if (existsSync(path)) {
        return {
          file: candidate,
          source: readFileSync(path, 'utf8'),
          related: readEmittedChunks(candidate),
        };
      }
    }
    return { file: artefact.bundleCandidates.join(' or '), source: null, related: [] };
  }

  const path = join(REPO_ROOT, artefact.main);
  return {
    file: artefact.main,
    source: existsSync(path) ? readFileSync(path, 'utf8') : null,
  };
}

/**
 * Les fragments asynchrones émis à côté d'une entrée `bundleContains`.
 *
 * POURQUOI CE N'EST PAS DE LA COMPLAISANCE. Le hook `register()` charge son
 * implémentation par `await import()`, et cet import est OBLIGATOIRE sous cette
 * forme : un import statique serait résolu pour le runtime edge, où `node:http`
 * et `prom-client` n'existent pas. Webpack, lui, sort tout import dynamique
 * dans un chunk séparé — le compilateur serveur de Next écrit l'entrée à la
 * racine de `.next/server` et les fragments sous `.next/server/chunks/`. Les
 * marqueurs vivent donc, par construction, dans un fragment. Ne lire que
 * l'entrée ferait échouer la gate sur un artefact parfaitement correct, ce qui
 * est le pire des deux sens : une gate qui crie faux finit désactivée.
 *
 * Ce qui reste porté par l'entrée seule — et n'est PAS élargi ici — c'est
 * qu'elle ait été émise et qu'elle ne soit pas vide. Un `register()` absent ou
 * creux reste une panne, quels que soient les fragments à côté.
 */
function readEmittedChunks(entryCandidate) {
  const marker = '.next/server';
  const cut = entryCandidate.indexOf(marker);
  if (cut === -1) return [];

  const serverRoot = entryCandidate.slice(0, cut + marker.length);
  const chunksRelative = `${serverRoot}/chunks`;
  const chunksRoot = join(REPO_ROOT, chunksRelative);
  if (!existsSync(chunksRoot)) return [];

  const chunks = [];
  const walk = (absolute, relative) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const nextAbsolute = join(absolute, entry.name);
      const nextRelative = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(nextAbsolute, nextRelative);
      } else if (entry.name.endsWith('.js')) {
        chunks.push({ file: nextRelative, source: readFileSync(nextAbsolute, 'utf8') });
      }
    }
  };
  walk(chunksRoot, chunksRelative);

  return chunks;
}

async function collect() {
  const { composeFiles } = await collectFromRepo();
  const tracedServices = readTracedServices();

  if (tracedServices === null) {
    throw new Error(
      'packages/contracts/dist is absent or exports no TRACED_SERVICES. The gate reads the built ' +
        'package deliberately (R-26 rule (a)); a missing build is a failure, not a skip.',
    );
  }

  const mains = {};
  const emission = {};
  for (const app of tracedServices) {
    const artefact = APP_ARTEFACTS[app];
    if (artefact === undefined) {
      throw new Error(
        `TRACED_SERVICES names "${app}", for which this gate knows no artefact. Add it to ` +
          'APP_ARTEFACTS rather than letting it go unchecked.',
      );
    }
    mains[app] = readArtefactProof(artefact);
    emission[app] = runEmissionProbe(app);
  }

  return {
    tracedServices,
    composeServices: collectComposeServices(composeFiles),
    mains,
    emission,
  };
}

async function main() {
  const input = await collect();

  console.log(`▶ traced services  : ${input.tracedServices.join(', ')}`);
  console.log(`▶ compose services : ${Object.keys(input.composeServices).length}`);

  const { problems, notes } = evaluateTracing(input);

  for (const note of notes) console.log(`  · ${note}`);

  if (problems.length > 0) {
    console.error('');
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error('');
    console.error(`TRACING CHECK: FAIL (${problems.length} problem(s))`);
    process.exit(1);
  }

  console.log('');
  console.log('TRACING CHECK: PASS');
}

module.exports = {
  evaluateTracing,
  collectComposeServices,
  normaliseEnv,
  escapeForRegExp,
  readEmittedChunks,
  APP_ARTEFACTS,
  OTLP_ENV,
  WEB_PROBE_ROUTE_TEMPLATE,
  WEB_DURATION_METRIC,
};

if (require.main === module) {
  main().catch((error) => {
    // A crash in the collector must not read as a pass. Exit non-zero, loudly.
    console.error(error);
    console.error('');
    console.error('TRACING CHECK: FAIL (the check itself could not run)');
    process.exit(1);
  });
}
