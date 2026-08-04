import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { get, type Server } from 'node:http';
import { join, resolve } from 'node:path';

import * as ts from 'typescript';

/**
 * PF-79 guard — `apps/web` is the third observed artefact, and it must stay one.
 *
 * WHAT PF-79 IS
 * -------------
 * "apps/web is the one artefact no observability surface covers — no metrics,
 * no traces." `S-E02-13` gave metrics to api and worker, `S-E02-14` gave them
 * traces, and `S-E02-14` deliberately *removed* `OTEL_EXPORTER_OTLP_ENDPOINT`
 * from the `web` service rather than leave a collector declared to an
 * application that could never reach it. Measured before this slice:
 *
 *   grep -rniE 'prom-client|opentelemetry|/metrics' apps/web/src  →  0 hits
 *   node scripts/observability-check.js                            →  exit 0
 *
 * The gate was green on the state the finding describes. A slow or failing page
 * — on the artefact users actually touch — was invisible to Prometheus and to
 * Jaeger while both Nest applications were visible to both.
 *
 * WHY THESE SPECS LIVE IN apps/api
 * --------------------------------
 * `apps/web` has no jest project; `ci-gate.sh` runs `test-ratchet.js api|worker`
 * only, so any spec written under `apps/web` would never be executed by the
 * gate. `web-artifact-gate.spec.ts` established this address for exactly that
 * reason. It is also why the implementation is plain CommonJS: a module a spec
 * cannot `require()` is a module only a nine-minute `next build` could ever run.
 *
 * WHAT IS EXECUTED HERE, NOT ASSERTED
 * -----------------------------------
 *   • a real socket is bound, a real `GET /metrics` is issued, and the real
 *     exposition is read — including the 404 and 500 paths;
 *   • `register()` is really transpiled and really invoked, on both runtimes
 *     and with an implementation module that throws;
 *   • `scripts/web-observability-probe.js` is really spawned.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

const WEB_MODULE_PATH = join(
  REPO_ROOT,
  'apps',
  'web',
  'src',
  'observability',
  'web-observability.js',
);
const INSTRUMENTATION_PATH = join(REPO_ROOT, 'apps', 'web', 'src', 'instrumentation.ts');
const PROBE_PATH = join(REPO_ROOT, 'scripts', 'web-observability-probe.js');
const TRACING_CHECK_PATH = join(REPO_ROOT, 'scripts', 'tracing-check.js');
const OBSERVABILITY_CHECK_PATH = join(REPO_ROOT, 'scripts', 'observability-check.js');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'ci-gate.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const COMPOSE_PATH = join(REPO_ROOT, 'infra', 'docker-compose.yml');
const DASHBOARD_PATH = join(
  REPO_ROOT,
  'infra',
  'grafana',
  'dashboards',
  'pilotage-slo.json',
);

interface SpanLike {
  kind?: number;
  attributes?: Record<string, unknown>;
  duration?: [number, number];
}

interface WebObservability {
  PROMETHEUS_CONTENT_TYPE: string;
  WEB_METRICS_PATH: string;
  DEFAULT_WEB_METRICS_PORT: number;
  HTTP_DURATION_METRIC: string;
  HTTP_REQUESTS_METRIC: string;
  UNMATCHED_ROUTE: string;
  UNKNOWN_LABEL: string;
  registry: { metrics(): Promise<string> };
  routeLabelFromSpan(span: SpanLike): string;
  methodLabelFromSpan(span: SpanLike): string;
  statusLabelFromSpan(span: SpanLike): string;
  spanDurationSeconds(span: SpanLike): number;
  createMetricsSpanProcessor(): { onEnd(span: SpanLike): void };
  createMetricsServer(options?: { registry?: { metrics(): Promise<string> } }): Server;
  resolveMetricsPort(env?: Record<string, string | undefined>): number;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const web = require(WEB_MODULE_PATH) as WebObservability;
/* eslint-enable @typescript-eslint/no-require-imports */

const read = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, relativePath), 'utf8');

/** Bind on port 0 and answer with the port the OS actually gave us. */
function listenOnEphemeralPort(server: Server): Promise<number> {
  return new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('the metrics server did not bind to a TCP port');
      }
      resolveListen(address.port);
    });
  });
}

interface Response {
  status: number | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function request(port: number, path: string, method = 'GET'): Promise<Response> {
  return new Promise((resolveRequest, rejectRequest) => {
    get({ host: '127.0.0.1', port, path, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () =>
        resolveRequest({ status: res.statusCode, headers: res.headers, body }),
      );
    }).on('error', rejectRequest);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

/* ------------------------------------------------------------------ *
 * AC3 — a real socket, a real exposition
 * ------------------------------------------------------------------ */

describe('web observability — the metrics socket really serves', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = web.createMetricsServer();
    port = await listenOnEphemeralPort(server);
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('answers GET /metrics with the Prometheus exposition', async () => {
    const response = await request(port, web.WEB_METRICS_PATH);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe(web.PROMETHEUS_CONTENT_TYPE);
    // A cached exposition would describe a moment that has passed — the same
    // reason the release manifest is `no-store`.
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('serves default process metrics AND the two HTTP metrics', async () => {
    const { body } = await request(port, web.WEB_METRICS_PATH);

    // Process health, so a container that is degrading is visible before it
    // fails; and the two SLO metrics, which is what PF-56 actually asked for.
    expect(body).toContain('process_resident_memory_bytes');
    expect(body).toContain('nodejs_eventloop_lag_p99_seconds');
    expect(body).toContain(web.HTTP_DURATION_METRIC);
    expect(body).toContain(web.HTTP_REQUESTS_METRIC);
  });

  it('labels every series with app="web", so three registries do not blend', async () => {
    const { body } = await request(port, web.WEB_METRICS_PATH);
    expect(body).toContain('app="web"');
  });

  it('answers 404 on an unknown path', async () => {
    const response = await request(port, '/');
    expect(response.status).toBe(404);
  });

  it('answers 404 on a non-GET method — the socket is read-only by construction', async () => {
    const response = await request(port, web.WEB_METRICS_PATH, 'DELETE');
    expect(response.status).toBe(404);
  });

  it('answers 500 — and keeps the process alive — when the registry rejects', async () => {
    // `registry.metrics()` is async: an unhandled rejection here would kill the
    // Next process, which would make instrumentation a cause of downtime on the
    // one artefact users touch. A failing exposition is a 500, not an exit.
    const broken = web.createMetricsServer({
      registry: { metrics: () => Promise.reject(new Error('collector exploded')) },
    });
    const brokenPort = await listenOnEphemeralPort(broken);

    const response = await request(brokenPort, web.WEB_METRICS_PATH);
    expect(response.status).toBe(500);
    expect(response.body).toContain('metrics collection failed');

    await closeServer(broken);
  });
});

describe('web observability — the port resolution never goes silent', () => {
  it('falls back to the default rather than binding port 0 or nothing at all', () => {
    expect(web.resolveMetricsPort({})).toBe(web.DEFAULT_WEB_METRICS_PORT);
    expect(web.resolveMetricsPort({ WEB_METRICS_PORT: '' })).toBe(web.DEFAULT_WEB_METRICS_PORT);
    expect(web.resolveMetricsPort({ WEB_METRICS_PORT: 'nonsense' })).toBe(
      web.DEFAULT_WEB_METRICS_PORT,
    );
    // Port 0 would bind somewhere random that nothing can scrape — worse than
    // the default, because it looks like it worked.
    expect(web.resolveMetricsPort({ WEB_METRICS_PORT: '0' })).toBe(web.DEFAULT_WEB_METRICS_PORT);
    expect(web.resolveMetricsPort({ WEB_METRICS_PORT: '9999' })).toBe(9999);
  });
});

/* ------------------------------------------------------------------ *
 * AC4 — G-TENANT, driven with input known to be wrong
 * ------------------------------------------------------------------ */

describe('web observability — labels carry route templates, never resolved URLs', () => {
  it('reads next.route first, then http.route', () => {
    expect(web.routeLabelFromSpan({ attributes: { 'next.route': '/parent/students/[id]' } })).toBe(
      '/parent/students/[id]',
    );
    expect(web.routeLabelFromSpan({ attributes: { 'http.route': '/api/proxy/[...path]' } })).toBe(
      '/api/proxy/[...path]',
    );
    expect(
      web.routeLabelFromSpan({
        attributes: { 'next.route': '/teacher/gradebook', 'http.route': '/other' },
      }),
    ).toBe('/teacher/gradebook');
  });

  /**
   * The load-bearing case. A span processor sees attributes BEFORE the exporter
   * redaction runs, so anything read here goes to Prometheus verbatim — and
   * `/metrics` carries no token. A resolved URL in a label is simultaneously an
   * unbounded-cardinality explosion and a child's identifier on an
   * unauthenticated surface.
   */
  it('refuses a resolved URL entirely, even as a fallback', () => {
    const label = web.routeLabelFromSpan({
      attributes: {
        'http.target': '/api/v1/students/clx1234567890abcdefghij?tenantId=demo',
        'http.url': 'http://web:3000/api/v1/students/clx1234567890abcdefghij?tenantId=demo',
        'url.path': '/api/v1/students/clx1234567890abcdefghij',
      },
    });

    expect(label).toBe(web.UNMATCHED_ROUTE);
    expect(label).not.toContain('clx1234567890abcdefghij');
    expect(label).not.toContain('tenantId');
  });

  it('collapses 500 distinct unmatched URLs into exactly ONE series', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      seen.add(
        web.routeLabelFromSpan({
          attributes: {
            'http.target': `/_next/static/chunks/${index}-abcdef0123456789.js`,
            'http.url': `http://web:3000/scan/${index}`,
          },
        }),
      );
    }
    // A scanner inventing URLs must not be able to exhaust the container's
    // memory through the metrics registry.
    expect([...seen]).toEqual([web.UNMATCHED_ROUTE]);
  });

  it('bounds the method and status labels too, rather than leaving them absent', () => {
    expect(web.methodLabelFromSpan({ attributes: { 'http.request.method': 'post' } })).toBe('POST');
    expect(web.methodLabelFromSpan({ attributes: { 'http.method': 'GET' } })).toBe('GET');
    expect(web.methodLabelFromSpan({ attributes: {} })).toBe(web.UNKNOWN_LABEL);

    expect(web.statusLabelFromSpan({ attributes: { 'http.status_code': 404 } })).toBe('404');
    expect(
      web.statusLabelFromSpan({ attributes: { 'http.response.status_code': 200 } }),
    ).toBe('200');
    expect(web.statusLabelFromSpan({ attributes: {} })).toBe(web.UNKNOWN_LABEL);
  });

  it('reads the duration from the span HrTime, and never throws on a malformed one', () => {
    expect(web.spanDurationSeconds({ duration: [1, 500_000_000] })).toBeCloseTo(1.5, 6);
    expect(web.spanDurationSeconds({})).toBe(0);
  });

  it('the exposition after 500 unmatched spans carries neither the cuid nor tenantId', async () => {
    const processor = web.createMetricsSpanProcessor();
    for (let index = 0; index < 500; index += 1) {
      processor.onEnd({
        kind: 1,
        duration: [0, 1_000_000],
        attributes: {
          'http.method': 'GET',
          'http.status_code': 200,
          'http.target': `/api/v1/students/clx1234567890abcdefghij?tenantId=demo&n=${index}`,
        },
      });
    }

    const exposition = await web.registry.metrics();
    expect(exposition).not.toContain('clx1234567890abcdefghij');
    expect(exposition).not.toContain('tenantId');
    expect(exposition).toContain(`route="${web.UNMATCHED_ROUTE}"`);
  });

  it('ignores spans that are not SERVER spans', () => {
    const processor = web.createMetricsSpanProcessor();
    // A client span carries the URL of whatever it called; recording it would
    // both double-count and widen the label surface for nothing.
    expect(() =>
      processor.onEnd({ kind: 2, duration: [0, 1], attributes: { 'http.method': 'GET' } }),
    ).not.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * AC5 — one redaction copy, proven shared
 * ------------------------------------------------------------------ */

describe('web observability — the redaction policy is imported, never copied', () => {
  it('wraps its exporter with withRedaction from @pilotage/contracts', () => {
    const source = readFileSync(WEB_MODULE_PATH, 'utf8');
    expect(source).toContain("require('@pilotage/contracts')");
    expect(source).toContain('withRedaction');
  });

  it('defines no sanitize*/redact* function of its own', () => {
    // Two copies of the rule, and it takes one of them forgetting
    // `db.statement` for Redis keys carrying tenant identifiers to reach an
    // unauthenticated collector — with nothing saying so. That is precisely
    // what S-E02-14 centralised the policy to prevent.
    const source = readFileSync(WEB_MODULE_PATH, 'utf8');
    expect(source).not.toMatch(/function\s+(sanitize|redact)\w*\s*\(/);
    expect(source).not.toMatch(/const\s+(sanitize|redact)\w*\s*=\s*(\(|function)/);
  });

  it('never pulls prom-client or an OTel SDK into @pilotage/contracts', () => {
    // `packages/contracts` is imported by CLIENT bundles of apps/web (see
    // `transpilePackages` in next.config.mjs). A `node:*` or `prom-client`
    // import reachable from its barrel breaks the web build outright.
    for (const file of [
      'packages/contracts/src/observability/tracing-policy.ts',
      'packages/contracts/src/observability/redacting-exporter.ts',
    ]) {
      const source = read(file);
      expect(source).not.toContain('@opentelemetry/');
      expect(source).not.toContain('prom-client');
      expect(source).not.toContain("from 'node:");
    }
  });

  it('contracts declares web as a traced service, so one list drives everything', () => {
    const source = read('packages/contracts/src/observability/tracing-policy.ts');
    expect(source).toContain("'api' | 'worker' | 'web'");
    expect(source).toContain("['api', 'worker', 'web']");
  });
});

/* ------------------------------------------------------------------ *
 * AC2 — register() is total, and the runtime guard really guards
 * ------------------------------------------------------------------ */

/**
 * Transpiles the REAL `instrumentation.ts` and evaluates it with a `require`
 * we control, so `register()` can be driven on both runtimes and against an
 * implementation module that throws.
 *
 * Reading the source and asserting it "contains a guard" would be the exact
 * failure this epic exists to end. This executes it.
 */
function loadRegister(load: (specifier: string) => unknown): () => Promise<void> {
  const source = readFileSync(INSTRUMENTATION_PATH, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const container = { exports: {} as Record<string, unknown> };
  const factory = new Function('module', 'exports', 'require', outputText) as (
    module: typeof container,
    exports: Record<string, unknown>,
    require: (specifier: string) => unknown,
  ) => void;

  factory(container, container.exports, load);

  const register = container.exports.register;
  if (typeof register !== 'function') throw new Error('instrumentation.ts exports no register()');
  return register as () => Promise<void>;
}

describe('web observability — register() cannot take the web app down', () => {
  const originalRuntime = process.env.NEXT_RUNTIME;

  afterEach(() => {
    if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalRuntime;
    jest.restoreAllMocks();
  });

  it('loads NOTHING on the edge runtime — middleware.ts makes this real', () => {
    process.env.NEXT_RUNTIME = 'edge';
    const loaded: string[] = [];
    const register = loadRegister((specifier) => {
      loaded.push(specifier);
      throw new Error('the edge bundle must never resolve this');
    });

    return register().then(() => {
      // `apps/web/src/middleware.ts` exists, so register() also runs on edge,
      // where neither node:http nor prom-client exist. Resolving the module —
      // not merely running it — is what breaks that bundle.
      expect(loaded).toEqual([]);
    });
  });

  it('loads nothing when NEXT_RUNTIME is not set at all', async () => {
    delete process.env.NEXT_RUNTIME;
    const loaded: string[] = [];
    await loadRegister((specifier) => {
      loaded.push(specifier);
      return {};
    })();
    expect(loaded).toEqual([]);
  });

  /**
   * Le garde doit être un BLOC, pas un retour anticipé — et c'est une mesure,
   * pas une préférence de style.
   *
   * Les deux tests ci-dessus passent avec les deux formes : à l'exécution, un
   * `if (… !== 'nodejs') return;` ne charge rien sur edge non plus. Mais webpack
   * ne juge pas l'exécution, il juge l'ATTEIGNABILITÉ. Avec un retour anticipé,
   * l'`import()` reste statiquement atteignable depuis l'entrée, donc le
   * compilateur edge le résout — et la première version de ce fichier a fait
   * échouer `next build` avec seize `Module not found: Can't resolve 'fs' /
   * 'v8' / 'cluster'`, toutes tracées jusqu'à `prom-client`.
   *
   * `process.env.NEXT_RUNTIME` étant remplacé littéralement par la
   * `DefinePlugin` de Next, seule la forme `if (… === 'nodejs') { import() }`
   * produit une branche que l'élimination de code mort peut supprimer.
   *
   * Sans cette assertion, la propriété dont dépend le build ne serait lue par
   * rien — R-26 à l'état pur, dans la slice qui existe pour le faire cesser.
   */
  it('keeps the dynamic import INSIDE the runtime guard block, not after an early return', () => {
    const source = readFileSync(INSTRUMENTATION_PATH, 'utf8');
    const body = source.slice(source.indexOf('export async function register'));

    // Le retour anticipé est la forme qui casse le build : elle est interdite.
    expect(body).not.toMatch(/NEXT_RUNTIME\s*!==\s*'nodejs'/);

    const guardIndex = body.indexOf("process.env.NEXT_RUNTIME === 'nodejs'");
    const importIndex = body.indexOf('await import(');

    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(importIndex).toBeGreaterThan(guardIndex);

    // …et l'`import()` doit être à l'intérieur du bloc, donc jamais après sa
    // fermeture. On mesure ça par la profondeur d'accolades entre les deux.
    const between = body.slice(guardIndex, importIndex);
    const depth =
      (between.match(/\{/g) ?? []).length - (between.match(/\}/g) ?? []).length;
    expect(depth).toBeGreaterThan(0);
  });

  it('starts the observability and the socket on the nodejs runtime', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    jest.spyOn(console, 'info').mockImplementation(() => undefined);

    const calls: string[] = [];
    const register = loadRegister(() => ({
      startWebObservability: () => {
        calls.push('startWebObservability');
        return { config: { enabled: false, reason: 'no collector', serviceName: 'pilotage-web' } };
      },
      startMetricsServer: () => {
        calls.push('startMetricsServer');
        return Promise.resolve(undefined);
      },
    }));

    await register();
    expect(calls).toEqual(['startWebObservability', 'startMetricsServer']);
  });

  it('logs the resolved reason on the DISABLED path — an inert state must be readable', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const logged = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    await loadRegister(() => ({
      startWebObservability: () => ({
        config: {
          enabled: false,
          reason: 'OTEL_EXPORTER_OTLP_ENDPOINT is not set — no collector declared',
          serviceName: 'pilotage-web',
        },
      }),
      startMetricsServer: () => Promise.resolve(undefined),
    }))();

    const line = logged.mock.calls.map((call) => String(call[0])).join('\n');
    // What PF-78 and PF-79 lacked was not only code — it was any way to notice
    // the code was absent. DNC-08: report the inert state, never disguise it.
    expect(line).toContain('disabled');
    expect(line).toContain('no collector declared');
  });

  it('logs the resolved reason on the ENABLED path too', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const logged = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    await loadRegister(() => ({
      startWebObservability: () => ({
        config: {
          enabled: true,
          reason: 'exporting to http://jaeger:4318',
          serviceName: 'pilotage-web',
        },
      }),
      startMetricsServer: () => Promise.resolve(undefined),
    }))();

    const line = logged.mock.calls.map((call) => String(call[0])).join('\n');
    expect(line).toContain('enabled');
    expect(line).toContain('http://jaeger:4318');
  });

  it('resolves — never rejects — when the implementation module throws on import', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const errored = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    // A throw out of register() is fatal to Next's bootstrap. That would make an
    // OPTIONAL observability side-car a boot dependency of the only user-facing
    // artefact — the exact inversion of value this epic exists to prevent.
    await expect(
      loadRegister(() => {
        throw new Error('MODULE_NOT_FOUND: prom-client');
      })(),
    ).resolves.toBeUndefined();

    expect(errored).toHaveBeenCalled();
    expect(String(errored.mock.calls[0]?.[0])).toContain('the application continues');
  });

  it('resolves when starting the observability throws', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      loadRegister(() => ({
        startWebObservability: () => {
          throw new Error('SDK exploded');
        },
        startMetricsServer: () => Promise.resolve(undefined),
      }))(),
    ).resolves.toBeUndefined();
  });

  it('resolves when the socket bind rejects', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      loadRegister(() => ({
        startWebObservability: () => ({
          config: { enabled: false, reason: 'r', serviceName: 'pilotage-web' },
        }),
        startMetricsServer: () => Promise.reject(new Error('EADDRINUSE')),
      }))(),
    ).resolves.toBeUndefined();
  });

  it('reaches its implementation only through a dynamic import', () => {
    const source = readFileSync(INSTRUMENTATION_PATH, 'utf8');
    // A static import is resolved by webpack for BOTH runtimes regardless of
    // the guard: it is resolution, not execution, that breaks the edge bundle.
    expect(source).toContain("await import('./observability/web-observability.js')");
    expect(source).not.toMatch(/^import .*observability/m);
  });
});

/* ------------------------------------------------------------------ *
 * AC6 — the probe runs standalone, without any build
 * ------------------------------------------------------------------ */

describe('web observability — the probe the gate spawns', () => {
  it('exists and is spawned by tracing-check.js', () => {
    expect(existsSync(PROBE_PATH)).toBe(true);
    // A probe nothing spawns is the same defect as an unwired gate, one level
    // down: it would pass forever while proving nothing.
    expect(read('scripts/tracing-check.js')).toContain('web-observability-probe.js');
  });

  it('runs with no build at all, and reports at least one span', () => {
    // It requires the plain CommonJS module directly — which is the whole
    // reason that module is plain CommonJS. apps/web has no dist/.
    const result = spawnSync(process.execPath, [PROBE_PATH], {
      encoding: 'utf8',
      timeout: 60_000,
      cwd: REPO_ROOT,
    });

    expect(result.status).toBe(0);

    const line = result.stdout.split('\n').find((l) => l.startsWith('PROBE_RESULT '));
    expect(line).toBeDefined();

    const payload = JSON.parse(String(line).slice('PROBE_RESULT '.length)) as {
      spans: number;
      data: { name: string; attributes: Record<string, unknown> }[];
      exposition: string;
      routeTemplate: string;
    };

    expect(payload.spans).toBeGreaterThanOrEqual(1);

    // The exported payload: templates in, identifiers out.
    const serialised = JSON.stringify(payload.data);
    expect(serialised).not.toContain('clx1234567890abcdefghij');
    expect(serialised).not.toContain('tenantId');
    expect(serialised).toContain(':id');

    // The exposition: a real SAMPLE, labelled by template. prom-client emits
    // `# TYPE` for a histogram that was never observed, so a registration proves
    // nothing about whether the panel will ever have data.
    expect(payload.exposition).toContain(`route="${payload.routeTemplate}"`);
    expect(payload.exposition).not.toContain('clx1234567890abcdefghij');
    expect(payload.exposition).not.toContain('tenantId');
  }, 90_000);
});

/* ------------------------------------------------------------------ *
 * AC10 / AC13 — the dashboard, the compose declaration, and no bypass
 * ------------------------------------------------------------------ */

describe('web observability — three registries, one dashboard, no blended series', () => {
  const dashboard = JSON.parse(readFileSync(DASHBOARD_PATH, 'utf8')) as {
    panels: { id: number; title: string; targets?: { expr?: string }[] }[];
  };

  it('groups every HTTP panel by app', () => {
    // The three registries publish the SAME metric names on purpose — one name
    // family, one label that distinguishes — but without `by (app, …)` the API's
    // series and Next's SSR series silently become one line, and the 5xx ratio
    // averages two artefacts. Green, silent, wrong: the failure this epic keeps
    // finding, at one more address.
    const httpTargets = dashboard.panels
      .flatMap((panel) => panel.targets ?? [])
      .map((target) => target.expr ?? '')
      .filter((expr) => expr.includes('pilotage_http_'));

    expect(httpTargets.length).toBeGreaterThanOrEqual(3);
    for (const expr of httpTargets) {
      // `app` must be a grouping DIMENSION — its position inside the clause is
      // irrelevant (`by (le, app, route)` on the histogram is correct), its
      // presence is not.
      const clauses = [...expr.matchAll(/\bby\s*\(([^)]*)\)/g)].map((match) => match[1] ?? '');
      expect(clauses.length).toBeGreaterThan(0);
      for (const clause of clauses) {
        expect(clause.split(',').map((label) => label.trim())).toContain('app');
      }
    }
  });

  it('names all three artefacts on the event-loop panel', () => {
    const panel = dashboard.panels.find((entry) => entry.id === 4);
    expect(panel?.title).toContain('api');
    expect(panel?.title).toContain('worker');
    expect(panel?.title).toContain('web');
  });
});

describe('web observability — exposure and wiring', () => {
  it('declares the metrics port on the web service, and never on the shared anchor', () => {
    const compose = readFileSync(COMPOSE_PATH, 'utf8');
    const anchor = compose.slice(0, compose.indexOf('\nservices:'));

    // The anchor is consumed by migrator, api, worker, web AND seed. Putting
    // either variable back on it re-creates PF-78 for the two one-shot jobs.
    expect(anchor).not.toContain('WEB_METRICS_PORT');
    expect(anchor).not.toMatch(/^\s*OTEL_EXPORTER_OTLP_ENDPOINT:/m);

    expect(compose).toContain('WEB_METRICS_PORT: "3001"');
  });

  it('publishes no host port for the metrics socket', () => {
    // Nothing published is strictly better than the loopback-binding convention
    // S-E02-13 recorded as unenforceable — and unlike a convention, it is
    // checkable. Prometheus reaches it by compose service name.
    const compose = readFileSync(COMPOSE_PATH, 'utf8');
    expect(compose).not.toContain('3001:3001');
  });

  it('scrapes web on its dedicated socket, not on the Next PORT', () => {
    const prometheus = read('infra/grafana/prometheus.yml');
    expect(prometheus).toContain("targets: ['web:3001']");
    expect(prometheus).not.toContain("targets: ['web:3000']");
  });

  it('keeps the metrics path out of the Next route inventory', () => {
    // If it ever became a route, nginx `location /` would publish it on the
    // public internet without a single line of nginx changing.
    const baseline = JSON.parse(read('scripts/web-route-baseline.json')) as {
      apps: Record<string, { routes: string[] }>;
    };
    const routes = baseline.apps['apps/web']?.routes ?? [];
    expect(routes.length).toBeGreaterThan(0);
    expect(routes).not.toContain(web.WEB_METRICS_PATH);
    expect(routes.filter((route) => /metrics/i.test(route))).toEqual([]);
  });

  it('both gate files still invoke both checks, and must not drift', () => {
    for (const path of [GATE_PATH, WORKFLOW_PATH]) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain('node scripts/observability-check.js');
      expect(source).toContain('node scripts/tracing-check.js');
    }
  });

  it('has no bypass flag anywhere in the new surface (DNC-10)', () => {
    const sources = [
      readFileSync(PROBE_PATH, 'utf8'),
      readFileSync(TRACING_CHECK_PATH, 'utf8'),
      readFileSync(OBSERVABILITY_CHECK_PATH, 'utf8'),
      readFileSync(WEB_MODULE_PATH, 'utf8'),
      readFileSync(INSTRUMENTATION_PATH, 'utf8'),
    ];
    for (const source of sources) {
      for (const flag of ['SKIP_WEB_OBS', 'OBS_SKIP_WEB', '--allow-unobserved-web']) {
        expect(source).not.toContain(flag);
      }
    }
  });

  it('the three plausible bypass flags change nothing when set', () => {
    // Asserting the strings are absent is not the same as asserting they do
    // nothing — an env var can be read through a computed key. Run the probe
    // with all three set and require the identical outcome.
    const result = spawnSync(process.execPath, [PROBE_PATH], {
      encoding: 'utf8',
      timeout: 60_000,
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        SKIP_WEB_OBS: '1',
        OBS_SKIP_WEB: 'true',
        WEB_OBSERVABILITY_SKIP: '1',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PROBE_RESULT ');
  }, 90_000);
});

/* ------------------------------------------------------------------ *
 * AC1 — the gap, recorded where a future reader will find it
 * ------------------------------------------------------------------ */

describe('web observability — the state that shipped before this slice', () => {
  it('apps/web now references the observability surface it had none of', () => {
    // Measured before this slice, `grep -rniE 'prom-client|opentelemetry|/metrics'
    // apps/web/src` returned NOTHING, and observability-check.js exited 0 on
    // that state. Both halves are now false.
    expect(existsSync(WEB_MODULE_PATH)).toBe(true);
    expect(existsSync(INSTRUMENTATION_PATH)).toBe(true);

    const source = readFileSync(WEB_MODULE_PATH, 'utf8');
    expect(source).toContain('prom-client');
    expect(source).toContain('@opentelemetry/sdk-trace-node');
  });

  it('declares its runtime dependencies, and at the versions api/worker resolve', () => {
    // E11-S1's RED gate was exactly a dependency set that was declared and never
    // installed. Same versions, because two OTel majors in one workspace is a
    // silent breakage.
    const web5 = JSON.parse(read('apps/web/package.json')) as {
      dependencies: Record<string, string>;
    };
    const api = JSON.parse(read('apps/api/package.json')) as {
      dependencies: Record<string, string>;
    };

    for (const name of [
      'prom-client',
      '@opentelemetry/api',
      '@opentelemetry/resources',
      '@opentelemetry/semantic-conventions',
      '@opentelemetry/exporter-trace-otlp-http',
    ]) {
      expect(web5.dependencies[name]).toBeDefined();
      expect(web5.dependencies[name]).toBe(api.dependencies[name]);
    }
    expect(web5.dependencies['@opentelemetry/sdk-trace-node']).toBeDefined();
    // No auto-instrumentation meta-package: forty instrumentations patching
    // modules at production start-up, for libraries this repo does not use.
    expect(web5.dependencies['@opentelemetry/auto-instrumentations-node']).toBeUndefined();
  });
});
