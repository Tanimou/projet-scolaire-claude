#!/usr/bin/env node
/**
 * trace-emission-probe.js — proves a real request produces a real span
 * (S-E02-14 / PF-78). Spawned by `scripts/tracing-check.js`, one child process
 * per traced application.
 *
 * WHY A SEPARATE PROCESS, AND WHY NOT A JEST TEST
 * -----------------------------------------------
 * An OpenTelemetry SDK is process-global and starts cleanly once; and its
 * auto-instrumentation must install its `require-in-the-middle` hooks **before**
 * `http` is loaded. The parent gate has already loaded a great deal by the time
 * it gets here, so the probe needs a fresh process.
 *
 * It is not a jest test for a measured reason: jest does not use Node's module
 * registry, so `require-in-the-middle` never fires, every instrumentation
 * silently patches nothing, and the identical probe yields **0 spans** there
 * against **2** under a real Node loader. Same class as `jose` under ts-jest
 * (PF-67), same answer as `S-E02-9` — run it outside jest, against `dist/`.
 *
 * The request deliberately carries an identifier in **both** places one could
 * leak from: a cuid path segment and a `tenantId` query parameter. The parent
 * asserts neither survives into what would be exported (G-TENANT).
 *
 * Usage: node scripts/trace-emission-probe.js <path-to-built-tracing-module>
 * Prints one machine-readable line: `PROBE_RESULT {"spans":n,"data":[…]}`
 */

/**
 * NOTE — `node:http` is deliberately NOT required here.
 *
 * The first version of this probe did require it at the top, and produced
 * **0 spans** where the same probe under `tsx` produced 2. The difference was
 * exactly the defect this gate exists to catch: requiring `http` before
 * `startTracing()` means the module is already resolved when
 * `require-in-the-middle` installs its hook, so `HttpInstrumentation` patches
 * nothing — silently, at exit 0.
 *
 * Keeping the require below `startTracing()` is not a style choice; it mirrors
 * the order `main.ts` is required to use, and it is why the probe measures
 * something. Left as a comment rather than tidied away because the mistake is
 * one line and costs an entire capability.
 */
const tracingModulePath = process.argv[2];
if (!tracingModulePath) {
  console.error('usage: trace-emission-probe.js <path-to-built-tracing-module>');
  process.exit(2);
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

// eslint-disable-next-line @typescript-eslint/no-require-imports -- gate script, plain CJS
const { startTracing } = require(tracingModulePath);

const handle = startTracing(
  { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318', GIT_SHA: 'probe' },
  () => exporter,
);

if (!handle.config.enabled) {
  console.error(`tracing did not enable: ${handle.config.reason}`);
  process.exit(3);
}

// Après `startTracing()` — voir la note en tête de fichier.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- gate script, plain CJS
const http = require('node:http');

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ok');
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/v1/students/clx1234567890abcdefghij?tenantId=demo`;

  http
    .get(url, (res) => {
      res.resume();
      res.on('end', () => {
        // `trace.getTracerProvider().forceFlush()` ne vide RIEN — mesuré :
        // l'API globale rend un `ProxyTracerProvider`, qui n'expose pas
        // `forceFlush`, donc l'appel optionnel est silencieusement sauté et on
        // lit un tampon encore plein. `shutdown()` vide, lui. C'est ce qui a
        // fait croire pendant une itération que l'instrumentation ne marchait
        // pas alors qu'elle marchait.
        setTimeout(() => {
          handle
            .shutdown()
            .then(() => {
              console.log(
                `PROBE_RESULT ${JSON.stringify({ spans: captured.length, data: captured })}`,
              );
              server.close(() => process.exit(0));
            })
            .catch((error) => {
              console.error(error);
              process.exit(4);
            });
        }, 100);
      });
    })
    .on('error', (error) => {
      console.error(error);
      process.exit(5);
    });
});
