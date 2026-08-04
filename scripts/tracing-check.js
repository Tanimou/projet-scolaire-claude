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
 *  2. the tracing bootstrap is required **before** the application module in
 *     the emitted `main.js`
 *       → the sharp one. OpenTelemetry's auto-instrumentation patches modules
 *         as they are loaded. A SDK started after `require('./app.module')`
 *         finds `http`, `express` and `@nestjs/core` already resolved: it
 *         patches nothing, throws nothing, and the application boots looking
 *         instrumented while emitting no request spans. Read off the **emitted**
 *         file, because import order is exactly what a refactor reorders
 *  3. a real request produces real spans, and those spans carry no identifier
 *       → the finding itself. Executed in a child process under plain Node
 *  4. the jaeger service can receive what is sent to it
 *       → the collector must exist, enable OTLP, and expose the port the
 *         endpoint names — the same class as check 3 of `observability-check.js`
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
 * Usage:  node scripts/tracing-check.js
 * Exit code is non-zero if any check fails. There is no bypass flag (DNC-10).
 */

const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
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
    main: 'apps/api/dist/main.js',
    tracing: 'apps/api/dist/shared/tracing/tracing.js',
    bootstrapMarker: 'shared/tracing/tracing.bootstrap',
    appModuleMarker: './app.module',
  },
  worker: {
    main: 'apps/worker/dist/main.js',
    tracing: 'apps/worker/dist/shared/tracing/tracing.js',
    bootstrapMarker: 'shared/tracing/tracing.bootstrap',
    appModuleMarker: './app.module',
  },
};

/* ------------------------------------------------------------------ *
 * Pure evaluation
 *
 * Everything below `evaluateTracing` is I/O. The evaluation is a pure function
 * of a plain object for the reason S-E02-12 made one: a check run only against
 * a healthy repository demonstrates that the repository is healthy, and nothing
 * more. The spec drives this with configurations known to be wrong.
 * ------------------------------------------------------------------ */

/**
 * @param {{
 *   tracedServices: string[],
 *   composeServices: Record<string, { file: string, environment: Record<string, unknown>, ports: string[], profiles: string[] }>,
 *   mains: Record<string, { file: string, source: string | null }>,
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
        'environment anchor, for five services at once.',
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

  /* -- 2. the bootstrap is required before the application module ------ */
  for (const app of traced) {
    const main = input.mains[app];
    if (main === undefined || main.source === null) {
      problems.push(
        `${app}: ${main ? main.file : `dist main for ${app}`} is absent, so the load order that ` +
          'makes instrumentation work cannot be verified. That is a failure, not a skip — with ' +
          'nothing to read, this check would pass vacuously.',
      );
      continue;
    }

    const artefact = APP_ARTEFACTS[app];
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
  const tracingModule = join(REPO_ROOT, artefact.tracing);
  if (!existsSync(tracingModule)) {
    return { spans: 0, serialised: '', error: `${artefact.tracing} is absent (build output missing)` };
  }

  const probe = join(__dirname, 'trace-emission-probe.js');
  const result = spawnSync(process.execPath, [probe, tracingModule], {
    encoding: 'utf8',
    timeout: 60_000,
  });

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
    return { spans: payload.spans, serialised: JSON.stringify(payload.data) };
  } catch (error) {
    return { spans: 0, serialised: '', error: `probe result unparseable: ${String(error)}` };
  }
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
    const mainPath = join(REPO_ROOT, artefact.main);
    mains[app] = {
      file: artefact.main,
      source: existsSync(mainPath) ? readFileSync(mainPath, 'utf8') : null,
    };
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

module.exports = { evaluateTracing, collectComposeServices, normaliseEnv, OTLP_ENV };

if (require.main === module) {
  main().catch((error) => {
    // A crash in the collector must not read as a pass. Exit non-zero, loudly.
    console.error(error);
    console.error('');
    console.error('TRACING CHECK: FAIL (the check itself could not run)');
    process.exit(1);
  });
}
