import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * PF-56 guard — the observability profile must stay coherent, and the gate over
 * it must stay connected.
 *
 * WHAT PF-56 IS
 * -------------
 * "Optional observability only; no traces, SLOs, alert delivery or restore
 * exercise." `infra/docker-compose.yml` has declared an `obs` profile —
 * Prometheus, Grafana, Loki — since it was written. Measured before this slice,
 * it was not merely optional; it could not start:
 *
 *   • `./grafana/prometheus.yml`  — did not exist
 *   • `./grafana/dashboards`      — did not exist
 *   • `./grafana/provisioning`    — did not exist
 *
 * All three are bind-mount sources. Docker creates a **directory** for a missing
 * bind-mount source, so Prometheus would have received a directory where it
 * expects a config file. And no application registered a single metric, so a
 * working Prometheus would have scraped nothing anyway.
 *
 * That is R-26 — a declared invariant trusted because it is written down —
 * making its sixth appearance in seven runs.
 *
 * WHY THE EVALUATION IS A PURE FUNCTION
 * -------------------------------------
 * The lesson of `S-E02-12`, restated because it is the whole method: a check run
 * against a healthy repository can only ever demonstrate that the repository is
 * healthy. It can never demonstrate that the check would catch a regression. So
 * `evaluateObservability` takes a plain object, and this spec drives it with
 * configurations that are **known to be wrong** — including the exact one that
 * shipped before this slice.
 *
 * DIVISION OF LABOUR
 * ------------------
 *   • `scripts/observability-check.js` — inspects the real repository and the
 *     build output; its exit code is the gate.
 *   • this file                        — drives its evaluation with synthetic
 *     input, and proves the gate is still wired into `ci-gate.sh` and `ci.yml`.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'observability-check.js');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'ci-gate.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const PROMETHEUS_PATH = join(REPO_ROOT, 'infra', 'grafana', 'prometheus.yml');
const NGINX_CONF_PATH = join(REPO_ROOT, 'infra', 'nginx', 'conf.d', 'pilotage.conf');

interface Evaluation {
  problems: string[];
  notes: string[];
}

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  evaluateObservability,
  metricNamesInExpr,
  serviceListenPort,
  serviceListenPorts,
  splitTarget,
} = require(SCRIPT_PATH) as {
  evaluateObservability: (input: unknown) => Evaluation;
  metricNamesInExpr: (expr: string) => string[];
  serviceListenPort: (service: unknown) => number | null;
  serviceListenPorts: (service: unknown) => number[];
  splitTarget: (target: string) => { host: string; port: number } | null;
};
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * A configuration in which every check passes. Each test below breaks exactly
 * one thing in it, so a failure names the rule that fired rather than leaving us
 * to guess which of several defects the evaluator noticed.
 */
function healthyInput(): Record<string, unknown> {
  return {
    composeFiles: [
      {
        file: 'infra/docker-compose.yml',
        doc: {
          services: {
            api: { environment: { PORT: '4000' }, volumes: [] },
            worker: { environment: { WORKER_HTTP_PORT: '4001' }, volumes: [] },
            // `web` listens on TWO ports: Next on PORT, and a dedicated,
            // never-published socket for the Prometheus exposition.
            web: {
              environment: { PORT: '3000', WEB_METRICS_PORT: '3001' },
              ports: ['3000:3000'],
              volumes: [],
            },
            prometheus: {
              ports: ['9090:9090'],
              volumes: ['./grafana/prometheus.yml:/etc/prometheus/prometheus.yml:ro'],
            },
            grafana: {
              ports: ['3001:3000'],
              volumes: ['./grafana/provisioning:/etc/grafana/provisioning:ro'],
            },
          },
        },
        bindMounts: [
          { source: './grafana/prometheus.yml', exists: true },
          { source: './grafana/provisioning', exists: true },
        ],
      },
    ],
    prometheus: {
      file: 'infra/grafana/prometheus.yml',
      doc: {
        global: { scrape_interval: '15s' },
        scrape_configs: [
          {
            job_name: 'pilotage-api',
            metrics_path: '/metrics',
            static_configs: [{ targets: ['api:4000'] }],
          },
          {
            job_name: 'pilotage-worker',
            metrics_path: '/metrics',
            static_configs: [{ targets: ['worker:4001'] }],
          },
          {
            job_name: 'pilotage-web',
            metrics_path: '/metrics',
            static_configs: [{ targets: ['web:3001'] }],
          },
        ],
      },
    },
    datasources: [
      {
        file: 'infra/grafana/provisioning/datasources/prometheus.yml',
        doc: {
          datasources: [
            {
              name: 'Prometheus',
              uid: 'pilotage-prometheus',
              url: 'http://prometheus:9090',
              jsonData: { timeInterval: '15s' },
            },
          ],
        },
      },
    ],
    dashboards: [
      {
        file: 'infra/grafana/dashboards/pilotage-slo.json',
        doc: {
          panels: [
            {
              title: 'Débit',
              datasource: { uid: 'pilotage-prometheus' },
              targets: [{ expr: 'sum by (route) (rate(pilotage_http_requests_total[5m]))' }],
            },
          ],
        },
      },
    ],
    bootRoutes: { 'apps/api': ['GET /metrics', 'GET /healthz'] },
    workerMetricsPath: '/metrics',
    webMetricsPath: '/metrics',
    webRoutes: ['/', '/parent/dashboard', '/admin/dashboard'],
    exposedMetrics: ['pilotage_http_requests_total', 'pilotage_http_request_duration_seconds'],
    nginxConfs: [{ file: 'infra/nginx/conf.d/pilotage.conf', text: '  location /api/ {\n' }],
  };
}

/** Convenience: the healthy input with one branch replaced. */
function withInput(mutate: (input: Record<string, unknown>) => void): Record<string, unknown> {
  const input = healthyInput();
  mutate(input);
  return input;
}

/**
 * Indexed access that fails loudly rather than being silenced with `!`.
 *
 * `tsconfig` sets `noUncheckedIndexedAccess`, and run 10 learned the hard way
 * that jest and `tsc` disagree here: a spec can pass while the typecheck stage
 * of the very same gate fails. Asserting the fixture shape is also the honest
 * fix — a probe that silently mutated nothing would make every test below pass
 * vacuously.
 */
function at<T>(items: T[] | undefined, index: number, what: string): T {
  const item = items?.[index];
  if (item === undefined) throw new Error(`fixture is missing ${what}[${index}]`);
  return item;
}

describe('observability gate — the positive path', () => {
  it('accepts a coherent observability profile', () => {
    const { problems } = evaluateObservability(healthyInput());
    expect(problems).toEqual([]);
  });

  it('says what it verified, so a pass is readable rather than merely silent', () => {
    const { notes } = evaluateObservability(healthyInput());
    expect(notes.join('\n')).toContain('bind-mount sources');
    expect(notes.join('\n')).toContain('scrape job');
  });
});

describe('observability gate — the state that actually shipped', () => {
  /**
   * The configuration this repository was in before S-E02-13: the obs profile
   * declared, its three bind-mount sources absent, no metrics anywhere. If the
   * evaluator does not fail on this, it would not have caught the finding it
   * was written for.
   */
  it('fails on the pre-slice state: declared profile, missing mount sources', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        const compose = at(input.composeFiles as Record<string, unknown>[], 0, 'composeFiles');
        compose.bindMounts = [
          { source: './grafana/prometheus.yml', exists: false },
          { source: './grafana/dashboards', exists: false },
          { source: './grafana/provisioning', exists: false },
        ];
      }),
    );

    const joined = problems.join('\n');
    expect(joined).toContain('./grafana/prometheus.yml');
    expect(joined).toContain('./grafana/dashboards');
    expect(joined).toContain('./grafana/provisioning');
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it('explains why a missing bind-mount source is not merely cosmetic', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        const compose = at(input.composeFiles as Record<string, unknown>[], 0, 'composeFiles');
        compose.bindMounts = [{ source: './grafana/prometheus.yml', exists: false }];
      }),
    );
    expect(problems.join('\n')).toContain('Docker would create a directory');
  });
});

describe('observability gate — scrape targets must resolve', () => {
  it('fails when a target names a host that is not a compose service', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        const prometheus = input.prometheus as { doc: { scrape_configs: Record<string, unknown>[] } };
        at(prometheus.doc.scrape_configs, 0, 'scrape_configs').static_configs = [
          { targets: ['pilotage-api:4000'] },
        ];
      }),
    );
    expect(problems.join('\n')).toContain('not a service in any compose file');
  });

  it('fails when a target uses a port the service does not listen on', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        const prometheus = input.prometheus as { doc: { scrape_configs: Record<string, unknown>[] } };
        at(prometheus.doc.scrape_configs, 0, 'scrape_configs').static_configs = [
          { targets: ['api:3000'] },
        ];
      }),
    );
    expect(problems.join('\n')).toContain('listens on 4000');
  });

  it('fails when a scrape job declares no target at all', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        const prometheus = input.prometheus as { doc: { scrape_configs: Record<string, unknown>[] } };
        at(prometheus.doc.scrape_configs, 0, 'scrape_configs').static_configs = [];
      }),
    );
    expect(problems.join('\n')).toContain('declares no target');
  });

  it('fails on an empty scrape config — an empty config is not a pass', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        (input.prometheus as { doc: { scrape_configs: unknown[] } }).doc.scrape_configs = [];
      }),
    );
    expect(problems.join('\n')).toContain('declares no scrape job');
  });

  it('fails when the Prometheus configuration is absent entirely', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.prometheus = null;
      }),
    );
    expect(problems.join('\n')).toContain('missing or unparseable');
  });
});

describe('observability gate — the scraped path must be a route that really boots', () => {
  /**
   * This is PF-62's shape at the observability address: a controller that stops
   * being mounted leaves the scrape config pointing at nothing, and Prometheus
   * reports the target down in a UI nobody is watching.
   */
  it('fails when the API does not serve the path Prometheus scrapes', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.bootRoutes = { 'apps/api': ['GET /healthz'] };
      }),
    );
    expect(problems.join('\n')).toContain('which the API does not serve');
    expect(problems.join('\n')).toContain('PF-62');
  });

  it('fails — never skips — when the booted route baseline cannot be read', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.bootRoutes = null;
      }),
    );
    expect(problems.join('\n')).toContain('That is a failure, not a skip');
  });

  it('fails when the worker serves metrics on a different path than the one scraped', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.workerMetricsPath = '/internal/metrics';
      }),
    );
    expect(problems.join('\n')).toContain('but the worker serves metrics on "/internal/metrics"');
  });

  it('fails — never skips — when the worker path cannot be read from the build output', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.workerMetricsPath = null;
      }),
    );
    expect(problems.join('\n')).toContain('That is a failure, not a skip');
  });
});

describe('observability gate — dashboards must query metrics that exist', () => {
  /**
   * A panel on a metric nothing registers renders "No data" for ever. That is
   * the failure mode this whole epic keeps finding: a surface that reports
   * confidence without performing a check.
   */
  it('fails when a panel queries a metric no application registers', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        const dashboards = input.dashboards as { doc: { panels: Record<string, unknown>[] } }[];
        at(at(dashboards, 0, 'dashboards').doc.panels, 0, 'panels').targets = [
          { expr: 'rate(pilotage_queue_depth_total[5m])' },
        ];
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('pilotage_queue_depth_total');
    expect(joined).toContain('indistinguishable from a system at rest');
  });

  it('accepts the histogram suffixes Prometheus derives rather than an app registering them', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        const dashboards = input.dashboards as { doc: { panels: Record<string, unknown>[] } }[];
        at(at(dashboards, 0, 'dashboards').doc.panels, 0, 'panels').targets = [
          {
            expr: 'histogram_quantile(0.95, sum by (le) (rate(pilotage_http_request_duration_seconds_bucket[5m])))',
          },
        ];
      }),
    );
    expect(problems).toEqual([]);
  });

  it('fails when a panel points at a datasource uid nothing provisions', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        const dashboards = input.dashboards as {
          doc: { panels: Record<string, unknown>[] };
        }[];
        at(at(dashboards, 0, 'dashboards').doc.panels, 0, 'panels').datasource = {
          uid: 'some-other-prometheus',
        };
      }),
    );
    expect(problems.join('\n')).toContain('which no provisioning file declares');
  });

  it('fails — never skips — when the registered metric names cannot be read', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.exposedMetrics = null;
      }),
    );
    expect(problems.join('\n')).toContain('That is a failure, not a skip');
  });

  it('fails when no dashboard exists at all', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.dashboards = [];
      }),
    );
    expect(problems.join('\n')).toContain('no Grafana dashboard was found');
  });

  it('fails when no datasource is provisioned', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.datasources = [];
      }),
    );
    expect(problems.join('\n')).toContain('no Grafana datasource is provisioned');
  });

  it('fails when the datasource step disagrees with the scrape interval', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        const datasources = input.datasources as {
          doc: { datasources: { jsonData: { timeInterval: string } }[] };
        }[];
        at(at(datasources, 0, 'datasources').doc.datasources, 0, 'entries').jsonData.timeInterval =
          '60s';
      }),
    );
    expect(problems.join('\n')).toContain('disagrees with Prometheus scrape_interval');
  });

  it('fails when the datasource url names a host that is not a compose service', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        const datasources = input.datasources as { doc: { datasources: { url: string }[] } }[];
        at(at(datasources, 0, 'datasources').doc.datasources, 0, 'entries').url =
          'http://localhost:9090';
      }),
    );
    expect(problems.join('\n')).toContain('separate containers');
  });
});

describe('observability gate — /metrics must not be published', () => {
  /**
   * `/metrics` is unauthenticated by design: Prometheus carries no token, and a
   * shared secret in a read-only mounted config would be the appearance of a
   * control rather than one. Its access control IS the docker network — so the
   * one thing that must never happen is a reverse-proxy rule publishing it.
   */
  it('fails when an nginx location publishes a metrics path', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.nginxConfs = [
          {
            file: 'infra/nginx/conf.d/pilotage.conf',
            text: '  location = /metrics {\n    proxy_pass http://api_upstream;\n  }\n',
          },
        ];
      }),
    );
    expect(problems.join('\n')).toContain('unauthenticated by design');
  });

  it('fails — never skips — when no nginx config is read', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.nginxConfs = [];
      }),
    );
    expect(problems.join('\n')).toContain('pass vacuously');
  });

  it('the real nginx configuration does not publish a metrics path', () => {
    expect(existsSync(NGINX_CONF_PATH)).toBe(true);
    const text = readFileSync(NGINX_CONF_PATH, 'utf8');
    const locations = [...text.matchAll(/^\s*location\s+(.+?)\s*\{/gm)].map(
      (match) => match[1] ?? '',
    );
    expect(locations.length).toBeGreaterThan(0);
    expect(locations.filter((location) => /metrics/i.test(location))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * S-E02-15 / PF-79 — the third artefact
 * ------------------------------------------------------------------ */

describe('observability gate — apps/web is scraped, and on the right socket', () => {
  /**
   * The trap this rule exists for. `web` sets `PORT: "3000"` for Next itself,
   * so the singular port resolver rejected a correct `web:3001` target with
   * "service web listens on 3000" — and the path of least resistance from there
   * is to retarget `web:3000/metrics`, i.e. to turn the metrics socket into a
   * published Next route behind nginx `location /`. A gate must not push anyone
   * towards the leak it exists to prevent.
   */
  it('accepts a target on the second port the service declares', () => {
    const { problems } = evaluateObservability(healthyInput());
    expect(problems).toEqual([]);
  });

  it('fails on a port the web service declares nowhere, naming the ones it does', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        const prometheus = input.prometheus as { doc: { scrape_configs: Record<string, unknown>[] } };
        at(prometheus.doc.scrape_configs, 2, 'scrape_configs').static_configs = [
          { targets: ['web:9464'] },
        ];
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('listens on 3000, 3001');
  });

  it('fails when the scraped path is not the path apps/web really serves', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.webMetricsPath = '/internal/metrics';
      }),
    );
    expect(problems.join('\n')).toContain('apps/web serves metrics on "/internal/metrics"');
  });

  it('fails — never skips — when the web metrics path cannot be read', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.webMetricsPath = null;
      }),
    );
    expect(problems.join('\n')).toContain('That is a failure, not a skip');
  });

  /**
   * The leak check 7 is blind to. nginx `location /` proxies EVERYTHING
   * unmatched to the web upstream, so an `app/metrics/route.ts` becomes public
   * the day it is added — without one line of nginx changing, and therefore
   * without check 7 noticing. This is the only assertion that would.
   */
  it('fails when the metrics path appears in the Next route inventory', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.webRoutes = ['/', '/parent/dashboard', '/metrics'];
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('infra/nginx/conf.d/pilotage.conf');
    expect(joined).toContain('location /');
    expect(joined).toContain('public internet');
  });

  it('fails — never skips — when the route inventory cannot be read', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.webRoutes = null;
      }),
    );
    expect(problems.join('\n')).toContain('That is a failure, not a skip');
  });

  /**
   * Escape by omission, the rule S-E02-9/-11/-12 each had to add at their own
   * address. Before this slice, `scrapePathProblem` returned `null` — i.e.
   * PASS — for every host that was not api or worker, so a `pilotage-web` job
   * satisfied the check vacuously.
   */
  it('fails on a scrape job for a host it knows no artefact for', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        const compose = at(input.composeFiles as Record<string, unknown>[], 0, 'composeFiles');
        const doc = compose.doc as { services: Record<string, unknown> };
        doc.services.grafana = { environment: { PORT: '3000' }, volumes: [] };
        const prometheus = input.prometheus as { doc: { scrape_configs: Record<string, unknown>[] } };
        prometheus.doc.scrape_configs.push({
          job_name: 'pilotage-grafana',
          metrics_path: '/metrics',
          static_configs: [{ targets: ['grafana:3000'] }],
        });
      }),
    );
    expect(problems.join('\n')).toContain('knows no artefact for host "grafana"');
  });

  it('still fails on a dashboard metric NO registry publishes, now that three do', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        const dashboards = input.dashboards as { doc: { panels: Record<string, unknown>[] } }[];
        at(at(dashboards, 0, 'dashboards').doc.panels, 0, 'panels').targets = [
          { expr: 'sum by (app) (rate(pilotage_web_render_seconds_count[5m]))' },
        ];
      }),
    );
    expect(problems.join('\n')).toContain('pilotage_web_render_seconds_count');
  });
});

describe('observability gate — helpers behave as the rules assume', () => {
  it('reads the listening port from the environment, not from the host-side mapping', () => {
    // The two differ routinely: the worker publishes 4001 on loopback only.
    expect(serviceListenPort({ environment: { PORT: '4000' }, ports: ['8080:4000'] })).toBe(4000);
    expect(serviceListenPort({ ports: ['9090:9090'] })).toBe(9090);
    expect(serviceListenPort({})).toBeNull();
  });

  it('collects EVERY declared port, because a service may listen on more than one', () => {
    expect(serviceListenPorts({ environment: { PORT: '3000', WEB_METRICS_PORT: '3001' } })).toEqual([
      3000, 3001,
    ]);
    // The api and worker resolutions must be unchanged by that edit — a widened
    // helper that quietly alters the two artefacts it already covered would be
    // a regression bought with a feature.
    expect(serviceListenPorts({ environment: { PORT: '4000' } })).toEqual([4000]);
    expect(serviceListenPorts({ environment: { WORKER_HTTP_PORT: '4001' } })).toEqual([4001]);
    expect(serviceListenPorts({})).toEqual([]);
    // De-duplicated: a published mapping repeating the env port is one port.
    expect(serviceListenPorts({ environment: { PORT: '3000' }, ports: ['3000:3000'] })).toEqual([
      3000,
    ]);
  });

  it('never mistakes a PromQL function for a metric name', () => {
    const names = metricNamesInExpr(
      'histogram_quantile(0.95, sum by (le, route) (rate(pilotage_http_request_duration_seconds_bucket[5m])))',
    );
    expect(names).toEqual(['pilotage_http_request_duration_seconds_bucket']);
  });

  it('never mistakes a label matcher for a metric name', () => {
    const names = metricNamesInExpr('sum(rate(pilotage_http_requests_total{status_code=~"5.."}[5m]))');
    expect(names).toEqual(['pilotage_http_requests_total']);
  });

  it('splits host:port and rejects anything else', () => {
    expect(splitTarget('api:4000')).toEqual({ host: 'api', port: 4000 });
    expect(splitTarget('api')).toBeNull();
    expect(splitTarget('api:')).toBeNull();
  });
});

describe('observability gate — the gate stays connected', () => {
  it('runs as a stage of ci-gate.sh', () => {
    expect(existsSync(GATE_PATH)).toBe(true);
    expect(readFileSync(GATE_PATH, 'utf8')).toContain('scripts/observability-check.js');
  });

  it('runs in the CI workflow too, so the two cannot drift', () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
    expect(readFileSync(WORKFLOW_PATH, 'utf8')).toContain('scripts/observability-check.js');
  });

  it('has no bypass flag — DNC-10', () => {
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    for (const flag of ['--force', '--skip', 'SKIP_OBSERVABILITY']) {
      expect(source).not.toContain(flag);
    }
  });

  it('reads registered metric names from the build output, not from source text', () => {
    // R-26 rule (a): read the resolved value. A regex over the registry source
    // is how run 10's guard nearly passed vacuously. The names come from the
    // `# TYPE` lines of the real exposition — what a scrape would receive.
    const source = readFileSync(SCRIPT_PATH, 'utf8');
    expect(source).toContain('# TYPE');
    expect(source).toContain('dist/modules/metrics/metrics.registry.js');
    expect(source).toContain('dist/shared/observability/metrics.registry.js');
    // apps/web is read from SOURCE, and deliberately so: it has no `dist/`, its
    // only compiler is a nine-minute `next build`, and the plain CommonJS module
    // it ships verbatim IS the most resolved artefact that exists. The emitted
    // half is covered by tracing-check.js reading `.next/server/instrumentation.js`.
    expect(source).toContain('apps/web/src/observability/web-observability.js');
  });

  it('the real prometheus.yml scrapes all THREE applications', () => {
    expect(existsSync(PROMETHEUS_PATH)).toBe(true);
    const text = readFileSync(PROMETHEUS_PATH, 'utf8');
    expect(text).toContain('api:4000');
    expect(text).toContain('worker:4001');
    // Not `web:3000` — that is Next's own port, published through nginx.
    expect(text).toContain('web:3001');
  });
});
