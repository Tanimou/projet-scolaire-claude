#!/usr/bin/env node
/**
 * web-observability-probe.js — proves that `apps/web`'s observability actually
 * measures, exposes and redacts (S-E02-15 / PF-79). Spawned as a child process
 * by `scripts/tracing-check.js`.
 *
 * WHY A PROBE AND NOT AN ASSERTION
 * --------------------------------
 * `readExposedMetricNames()` in `observability-check.js` reads `# TYPE` lines.
 * prom-client emits a `# HELP`/`# TYPE` pair for a labelled histogram that has
 * **never been observed** — so a web SLO panel could be green in the gate and
 * render "No data" for ever, which is indistinguishable from a system at rest.
 * That is the exact wording the observability gate uses about the defect it
 * exists to catch, and it would have reappeared here.
 *
 * So this probe does not ask whether a metric is registered. It pushes a span
 * through the real provider and asks whether a **sample** came out.
 *
 * WHY IT NEEDS NO BUILD — and why that matters
 * -------------------------------------------
 * It `require()`s `apps/web/src/observability/web-observability.js` directly.
 * That module is plain CommonJS precisely so this is possible: `apps/web` has
 * no `dist/`, and its only compiler is a `next build` the routine may run once
 * per run, at ~9 minutes. A proof that can only be executed by that build is a
 * proof nobody will run while writing the code.
 *
 * WHAT IT EXECUTES, IN ORDER
 * --------------------------
 *  1. starts the observability with an **injected in-memory exporter** — never
 *     a real collector, so the probe depends on nothing being up;
 *  2. starts the metrics socket on port **0** and issues a REAL `GET /metrics`
 *     over a real socket, asserting the exposition parses and carries the
 *     histogram;
 *  3. ends a synthetic Next-shaped SERVER span carrying an identifier in BOTH
 *     places one can leak from — a cuid path segment and a `?tenantId=` query —
 *     while also carrying the route TEMPLATE, then flushes;
 *  4. scrapes again and prints the post-span exposition.
 *
 * The parent then applies the G-TENANT assertions (neither the cuid nor
 * `tenantId` may appear in what would be exported OR in the exposition) plus
 * the one that only this probe can support: the histogram sample must be
 * labelled with the route template.
 *
 * WHAT IT DOES NOT PROVE — stated plainly
 * ---------------------------------------
 * It does not boot Next. Next needs a database and a Keycloak session, and the
 * routine forbids bringing the stack up. So this proves the module measures,
 * serves and redacts; that **Next itself emits** these spans is inferred from
 * its built-in OpenTelemetry support, and the fact that the hook ships is
 * proven separately by `tracing-check.js` reading the emitted bundle.
 *
 * Usage: node scripts/web-observability-probe.js
 * Prints one machine-readable line:
 *   PROBE_RESULT {"spans":n,"data":[…],"exposition":"…"}
 */

const { resolve } = require('node:path');
const http = require('node:http');

const REPO_ROOT = resolve(__dirname, '..');
const MODULE_PATH = resolve(REPO_ROOT, 'apps/web/src/observability/web-observability.js');

/**
 * L'identifiant et le paramètre que la sonde tente délibérément de faire fuir.
 * Les mêmes valeurs que `trace-emission-probe.js` — deux sondes, un seul jeu de
 * secrets, donc une seule chose à changer si la règle évolue.
 */
const PROBE_CUID = 'clx1234567890abcdefghij';
const PROBE_RESOLVED_URL = `/parent/students/${PROBE_CUID}/grades?tenantId=demo`;

/** Le gabarit que Next renseignerait dans `next.route` pour cette URL. */
const PROBE_ROUTE_TEMPLATE = '/parent/students/[id]/grades';

function fail(code, message, error) {
  console.error(message);
  if (error) console.error(error);
  process.exit(code);
}

const captured = [];

/** Exportateur en mémoire — la sonde ne doit dépendre d'aucun collecteur. */
const exporter = {
  export(spans, resultCallback) {
    for (const span of spans) {
      captured.push({ name: span.name, attributes: { ...span.attributes } });
    }
    resultCallback({ code: 0 });
  },
  shutdown: () => Promise.resolve(),
  forceFlush: () => Promise.resolve(),
};

/** `GET` sur le socket réel, sans dépendance HTTP tierce. */
function scrape(port, path) {
  return new Promise((resolveScrape, rejectScrape) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () =>
          resolveScrape({ status: res.statusCode, headers: res.headers, body }),
        );
      })
      .on('error', rejectScrape);
  });
}

async function main() {
  let observability;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- gate script, plain CJS
    observability = require(MODULE_PATH);
  } catch (error) {
    // Un module absent ou incassable est un ÉCHEC, jamais un skip : sans lui la
    // sonde ne prouverait rien tout en sortant 0.
    fail(2, `cannot load ${MODULE_PATH}`, error);
    return;
  }

  const handle = observability.startWebObservability({
    // Un endpoint est déclaré pour que le chemin d'export caviardé soit
    // réellement exercé — mais l'exportateur est injecté, donc rien ne part.
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318', GIT_SHA: 'probe' },
    exporterFactory: () => exporter,
  });

  if (!handle.config.enabled) {
    fail(3, `web tracing did not enable: ${handle.config.reason}`);
    return;
  }

  /* -- 2. le socket sert-il vraiment ? -------------------------------- */

  const server = await observability.startMetricsServer(0);
  if (!server) {
    fail(4, 'the metrics socket did not bind on port 0');
    return;
  }
  const { port } = server.address();

  const before = await scrape(port, observability.WEB_METRICS_PATH);
  if (before.status !== 200) {
    fail(5, `GET ${observability.WEB_METRICS_PATH} returned ${before.status}, expected 200`);
    return;
  }
  if (before.headers['content-type'] !== observability.PROMETHEUS_CONTENT_TYPE) {
    fail(5, `unexpected content-type: ${before.headers['content-type']}`);
    return;
  }
  if (!before.body.includes(`# TYPE ${observability.HTTP_DURATION_METRIC} histogram`)) {
    fail(6, 'the exposition does not declare the request-duration histogram');
    return;
  }

  /* -- 3. une mesure réelle traverse la chaîne complète --------------- */

  // Le span passe par le fournisseur RÉEL : processeur de métriques puis
  // `withRedaction` → exportateur. C'est la chaîne qui tourne en production,
  // pas une reconstitution.
  const tracer = handle.provider.getTracer('web-observability-probe');
  const span = tracer.startSpan(`GET ${PROBE_RESOLVED_URL}`, {
    kind: 1, // SpanKind.SERVER
    attributes: {
      'next.route': PROBE_ROUTE_TEMPLATE,
      'next.span_type': 'BaseServer.handleRequest',
      'http.method': 'GET',
      'http.status_code': 200,
      // Les deux endroits par lesquels un identifiant peut fuir. Le processeur
      // de métriques ne doit JAMAIS les lire ; le caviardage doit les réduire.
      'http.target': PROBE_RESOLVED_URL,
      'http.url': `http://web:3000${PROBE_RESOLVED_URL}`,
      'url.path': `/parent/students/${PROBE_CUID}/grades`,
    },
  });
  span.end();

  await handle.provider.forceFlush();

  const after = await scrape(port, observability.WEB_METRICS_PATH);
  if (after.status !== 200) {
    fail(5, `second GET returned ${after.status}, expected 200`);
    return;
  }

  await observability.stopMetricsServer();
  await handle.shutdown();

  console.log(
    `PROBE_RESULT ${JSON.stringify({
      spans: captured.length,
      data: captured,
      exposition: after.body,
      routeTemplate: PROBE_ROUTE_TEMPLATE,
    })}`,
  );
  process.exit(0);
}

module.exports = { PROBE_CUID, PROBE_ROUTE_TEMPLATE, PROBE_RESOLVED_URL, MODULE_PATH };

if (require.main === module) {
  main().catch((error) => fail(1, 'the web observability probe could not run', error));
}
