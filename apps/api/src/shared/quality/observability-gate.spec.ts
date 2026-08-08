import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/** The discriminated result the two queue readers return since S-E02-19 (AC-8). */
type ReaderFailure = { ok: false; reason: string; file: string; detail?: string };
type CollectorResult = { ok: true; queues: string[] } | ReaderFailure;

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  evaluateObservability,
  metricNamesInExpr,
  sumAggregationArguments,
  maskQuotedSpans,
  scanQuotedSpans,
  unshieldedGaugeReferences,
  registryResidue,
  readCollectorBoundQueues,
  serviceListenPort,
  serviceListenPorts,
  splitTarget,
  REPLICA_LABELS,
  REPLICA_IDEMPOTENT_AGGREGATIONS,
  ACROSS_SERIES_AGGREGATIONS,
  DRIVEN_DEPTH_SENTINEL,
  WORKER_QUEUE_DEPTH_COLLECTOR_MODULE,
} = require(SCRIPT_PATH) as {
  evaluateObservability: (input: unknown) => Evaluation;
  metricNamesInExpr: (expr: string) => string[];
  sumAggregationArguments: (expr: string) => { args: string[]; unbalanced: boolean };
  maskQuotedSpans: (expr: string) => string;
  scanQuotedSpans: (expr: string) => { masked: string; unterminated: boolean };
  unshieldedGaugeReferences: (
    argument: string,
    types: Record<string, string>,
  ) => { families: string[]; unscannable: boolean };
  registryResidue: (
    exposition: string,
    drivenOutcomes?: { queue: string; job: string }[],
  ) => string[];
  readCollectorBoundQueues: (collectorPath?: string) => CollectorResult;
  serviceListenPort: (service: unknown) => number | null;
  serviceListenPorts: (service: unknown) => number[];
  splitTarget: (target: string) => { host: string; port: number } | null;
  REPLICA_LABELS: Set<string>;
  REPLICA_IDEMPOTENT_AGGREGATIONS: Set<string>;
  ACROSS_SERIES_AGGREGATIONS: string[];
  DRIVEN_DEPTH_SENTINEL: number;
  WORKER_QUEUE_DEPTH_COLLECTOR_MODULE: string;
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
    exposedMetrics: [
      'pilotage_http_requests_total',
      'pilotage_http_request_duration_seconds',
      // The queue families, so check 10's cases below exercise check 10 rather
      // than tripping check 6 on a fixture gap.
      'pilotage_queue_depth',
      'pilotage_queue_depth_collection_failures_total',
      'pilotage_queue_depth_sources_bound',
      'pilotage_queue_jobs_total',
      'pilotage_queue_job_duration_seconds',
      'pilotage_queue_stalled_total',
      'nodejs_eventloop_lag_p99_seconds',
    ],
    // S-E02-18 — check 10. ADDITIVE beside `exposedMetrics`, which keeps its
    // `string[]` shape: check 6 does `new Set(exposed || [])` and then
    // `if (exposedSet.size === 0) break`, so reshaping that field into an object
    // would have made every dashboard query pass vacuously inside a blocking
    // stage — a worse defect than the one being fixed, and invisible.
    exposedMetricTypes: {
      pilotage_http_requests_total: 'counter',
      pilotage_http_request_duration_seconds: 'histogram',
      pilotage_queue_depth: 'gauge',
      pilotage_queue_depth_collection_failures_total: 'counter',
      pilotage_queue_depth_sources_bound: 'gauge',
      pilotage_queue_jobs_total: 'counter',
      pilotage_queue_job_duration_seconds: 'histogram',
      pilotage_queue_stalled_total: 'counter',
      nodejs_eventloop_lag_p99_seconds: 'gauge',
    },
    nginxConfs: [{ file: 'infra/nginx/conf.d/pilotage.conf', text: '  location /api/ {\n' }],
    // S-E02-17 — check 9. `declared` is the exported INSTRUMENTED_QUEUES
    // constant; `rendered` is the set of queue labels the worker exposition
    // really carries. They are separate fields because a check that trusted the
    // constant alone would be a declaration nobody executes.
    instrumentedQueues: {
      declared: ['exports', 'notifications-email', 'imports'],
      rendered: ['exports', 'notifications-email', 'imports'],
    },
    registeredQueues: {
      api: ['exports', 'notifications-email', 'imports'],
      worker: ['exports', 'notifications-email', 'imports'],
    },
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

/**
 * Comment-stripped JavaScript, offsets preserved (comments become spaces).
 *
 * The JS sibling of `boot-gate.spec.ts`'s `stripComments`, and it exists for
 * the same reason that one does: an assertion over raw source is an assertion
 * about prose. Quoting is deliberately not modelled — a `//` inside a string
 * blanks the rest of that line, which can only ever cause this guard to MISS a
 * flag, never to invent one. A half-correct JavaScript parser would be a worse
 * guard than an honest textual one.
 */
function stripJsComments(text: string): string {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, ' '),
  );
  return withoutBlocks
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      return at === -1 ? line : line.slice(0, at) + ' '.repeat(line.length - at);
    })
    .join('\n');
}

/**
 * Does this text name a dedicated abandoned-job queue — a mechanism BullMQ does
 * not have? (S-E02-18 / PF-109)
 *
 * ONE predicate, used by the assertion over the real file AND by the cases that
 * prove it can fire. Two inlined copies of a regex is DNC-01 at the test layer:
 * the guard and its proof drift, and the proof keeps passing.
 *
 * Matched by STEM, not by five singular literals. The term that actually got
 * through — « une file de lettres mortes », `pilotage-slo.json:2` — was a French
 * plural, and every one of the five literals reported false against the file the
 * guard was inspecting.
 *
 * JSON escape sequences are unescaped to whitespace first: inside a JSON string
 * a newline is the two characters `\` and `n`, which `\s` does not match, so
 * « lettres\nmortes » would otherwise slip past.
 */
function namesAnAbandonedJobQueue(text: string): boolean {
  const flattened = text.replace(/\\[nrt]/g, ' ');
  return /dlq|dead[-_ ]letter|lettres?\s+morte|files?\s+morte|mise\s+au\s+rebut/i.test(flattened);
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
    // The example metric is deliberately one that will NEVER be registered.
    // It used to be `pilotage_queue_depth_total`, and S-E02-17 renamed it:
    // that slice registers `pilotage_queue_depth` (no `_total`, on purpose —
    // Prometheus tooling reads `x` and `x_total` as one metric), and leaving a
    // near-identical name here would invite the next reader to "fix the
    // fixture" by adding the metric, silently disarming a negative test.
    const { problems } = evaluateObservability(
      withInput((input) => {
        const dashboards = input.dashboards as { doc: { panels: Record<string, unknown>[] } }[];
        at(at(dashboards, 0, 'dashboards').doc.panels, 0, 'panels').targets = [
          { expr: 'rate(pilotage_metric_no_application_will_ever_register_total[5m])' },
        ];
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('pilotage_metric_no_application_will_ever_register_total');
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

/* ------------------------------------------------------------------ *
 * S-E02-17 / PF-56 — instrumented queues ≡ registered queues (check 9)
 * ------------------------------------------------------------------ */

describe('observability gate — every registered queue is instrumented', () => {
  /**
   * The durable half of S-E02-17. Metrics that exist today and silently miss
   * the fourth queue added next quarter are worth less than a gate — so the
   * gauges are the demo and this is the acceptance criterion.
   *
   * T10 and T11 are the proof the check is not tautological, and both were
   * written before the reader that feeds them and watched to go red against a
   * deliberately mismatched fixture (R-26 / PF-83).
   */
  it('T9 — a coherent instrumentation still yields no problems', () => {
    const { problems } = evaluateObservability(healthyInput());
    expect(problems).toEqual([]);
  });

  it('T9b — says what it compared, so a pass is readable rather than silent', () => {
    const { notes } = evaluateObservability(healthyInput());
    const joined = notes.join('\n');
    expect(joined).toContain('instrumented queues ≡ registered queues');
    expect(joined).toContain('exports');
  });

  it('T10 — direction 1: a registered queue nobody instruments FAILS, naming it', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.registeredQueues = {
          api: ['exports', 'notifications-email', 'imports', 'reports'],
          worker: ['exports', 'notifications-email', 'imports', 'reports'],
        };
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('queue "reports"');
    expect(joined).toContain('instrumented by nothing');
  });

  it('T11 — direction 2: an instrumented queue nobody registers FAILS, naming it', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.instrumentedQueues = {
          declared: ['exports', 'notifications-email', 'imports', 'ghost'],
          rendered: ['exports', 'notifications-email', 'imports', 'ghost'],
        };
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('queue "ghost"');
    expect(joined).toContain('permanently zero');
  });

  /**
   * The assertion that finally compares the two constant blocks nobody
   * compared. A UNION of the two sides would hide exactly this: a queue
   * registered on one side only would still satisfy "instrumented ≡
   * registered", and producer-without-consumer is the defect the two comments
   * in those files warn about.
   */
  it('T12 — api and worker declaring different sets FAILS, naming both files', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.registeredQueues = {
          api: ['exports', 'notifications-email', 'imports'],
          worker: ['exports', 'notifications-email', 'imports', 'audit'],
        };
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('queue "audit"');
    expect(joined).toContain('apps/api/dist/shared/queue/queue.module.js');
    expect(joined).toContain('apps/worker/dist/shared/queue/queue.module.js');
    expect(joined).toContain('apps/api lacks it');
  });

  it('T12b — names the side that lacks it, in the other direction too', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.registeredQueues = {
          api: ['exports', 'notifications-email', 'imports', 'audit'],
          worker: ['exports', 'notifications-email', 'imports'],
        };
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('apps/worker lacks it');
    expect(joined).toContain('produces jobs nothing');
  });

  it('T13 — instrumentedQueues null FAILS rather than skips', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.instrumentedQueues = null;
      }),
    );
    expect(problems.join('\n')).toContain('That is a failure, not a skip');
  });

  it('T14 — registeredQueues null FAILS rather than skips', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.registeredQueues = null;
      }),
    );
    expect(problems.join('\n')).toContain('That is a failure, not a skip');
  });

  it('T15 — a truncated registered set FAILS rather than passing vacuously', () => {
    // The realistic shape of a broken reader is not `null`, it is `[]`. The
    // registration site is `registerQueue({ name: QUEUE_EXPORTS })` — an
    // indirection through a constant — so a naive extractor returns nothing and
    // "instrumented ≡ registered" degenerates to {} ≡ {}, i.e. PASS.
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.registeredQueues = { api: [], worker: [] };
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('below the floor');
    expect(joined).toContain('{} ≡ {}');
  });

  it('T15b — one queue short of the floor is still a failure', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.registeredQueues = {
          api: ['exports', 'imports'],
          worker: ['exports', 'imports'],
        };
      }),
    );
    expect(problems.join('\n')).toContain('below the floor');
  });

  /**
   * C2 — the instrumented set must be a RESOLVED read, not a constant. A check
   * that trusted `INSTRUMENTED_QUEUES` alone would reproduce the exact defect
   * it exists to close: a declaration nobody executes.
   */
  it('T15c — a declared queue that renders no series FAILS', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.instrumentedQueues = {
          declared: ['exports', 'notifications-email', 'imports'],
          rendered: ['exports', 'notifications-email'],
        };
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('survived a driven write path');
    // S-E02-18 / AC-3: the MISSING set must be NAMED. "declared ≠ rendered" tells
    // an on-call nothing about which queue to go and wire up.
    expect(joined).toContain('Declared with NO write path: [imports]');
  });

  it('T15c2 — a queue that renders but is NOT declared is named on the other side', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.instrumentedQueues = {
          declared: ['exports', 'notifications-email', 'imports'],
          rendered: ['exports', 'notifications-email', 'imports', 'alerts-recompute'],
        };
      }),
    );
    expect(problems.join('\n')).toContain('Rendered but NOT declared: [alerts-recompute]');
  });

  it('T15d — a rendered set that is empty FAILS rather than skips', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.instrumentedQueues = {
          declared: ['exports', 'notifications-email', 'imports'],
          rendered: [],
        };
      }),
    );
    expect(problems.join('\n')).toContain('That is a failure, not a skip');
  });

  /**
   * T17 — the dashboard half of AC-4, asserted over the REAL file rather than
   * the fixture. The fixture proves the rule; this proves the repository obeys
   * it.
   */
  it('T17 — the real pilotage-slo.json queries the queue metrics', () => {
    const dashboardPath = join(
      REPO_ROOT,
      'infra',
      'grafana',
      'dashboards',
      'pilotage-slo.json',
    );
    expect(existsSync(dashboardPath)).toBe(true);
    const dashboard = JSON.parse(readFileSync(dashboardPath, 'utf8')) as {
      panels: { title?: string; datasource?: { uid?: string }; targets?: { expr?: string }[] }[];
    };

    const exprs = dashboard.panels.flatMap((panel) =>
      (panel.targets ?? []).map((target) => target.expr ?? ''),
    );
    expect(exprs.some((expr) => expr.includes('pilotage_queue_depth'))).toBe(true);
    expect(exprs.some((expr) => expr.includes('pilotage_queue_jobs_total'))).toBe(true);
    expect(exprs.some((expr) => expr.includes('pilotage_queue_job_duration_seconds_bucket'))).toBe(
      true,
    );

    // Every metric named there resolves through the same extractor the gate
    // uses, so a rename breaks the gate rather than the dashboard.
    for (const expr of exprs.filter((candidate) => candidate.includes('pilotage_queue'))) {
      for (const name of metricNamesInExpr(expr)) {
        expect(name.startsWith('pilotage_queue_') || name.startsWith('nodejs_')).toBe(true);
      }
    }
  });

  /**
   * DNC-06 reaches the presentation layer. Metric names are gated by check 6;
   * panel titles, descriptions and legends are gated by nothing, so they are
   * where "DLQ" would re-enter — one layer up, where no test looks. Except
   * this one.
   */
  it('T17b — no panel names a dead-letter mechanism this system does not have', () => {
    const dashboardPath = join(REPO_ROOT, 'infra', 'grafana', 'dashboards', 'pilotage-slo.json');
    const raw = readFileSync(dashboardPath, 'utf8');
    // S-E02-18 / PF-109. Asserted against the RAW file, deliberately: the term
    // that actually slipped through sat in `__comment`, not in a panel field,
    // and narrowing the scan to panel titles/descriptions/legends would close
    // the guard on the one place the defect used it.
    expect(namesAnAbandonedJobQueue(raw)).toBe(false);
  });

  it('T17b2 — the dead-letter guard can actually FAIL, including on the plural that defeated it', () => {
    // R-26 / PF-83, mirroring the DNC-10 pair below. The version of this guard
    // that shipped with S-E02-17 listed five SINGULAR literals, and
    // `pilotage-slo.json:2` already read « une file de lettres mortes » — so all
    // five reported false against the very file the guard inspects. A guard
    // never shown red is a guard we hope works.
    for (const offender of [
      'DLQ depth',
      'dead letter queue',
      'dead-letter',
      'dead_letter',
      'une lettre morte',
      'une file de lettres mortes',
      'files mortes',
      'mise au rebut des jobs',
    ]) {
      expect(namesAnAbandonedJobQueue(offender)).toBe(true);
    }

    // …and it must NOT fire on the vocabulary the dashboard legitimately uses,
    // or the next person to write an honest description deletes the guard.
    for (const innocent of [
      'un job qui épuise ses tentatives reste dans l’ensemble `failed`',
      'aucune file dédiée aux jobs abandonnés',
      'outcome="failed_terminal"',
    ]) {
      expect(namesAnAbandonedJobQueue(innocent)).toBe(false);
    }
  });

  it('T17b3 — an offender hiding in __comment fires, which pins the RAW-file scan', () => {
    // The scan must not be narrowed to panel fields: this synthetic dashboard is
    // clean everywhere a panel-field scan would look.
    const synthetic = JSON.stringify({
      __comment: 'les jobs abandonnés partent dans une file de lettres mortes',
      panels: [{ title: 'Profondeur de file par état', description: 'rien à signaler' }],
    });
    expect(namesAnAbandonedJobQueue(synthetic)).toBe(true);
  });

  it('T17c — every queue legend interpolates only closed-set labels', () => {
    const dashboardPath = join(REPO_ROOT, 'infra', 'grafana', 'dashboards', 'pilotage-slo.json');
    const dashboard = JSON.parse(readFileSync(dashboardPath, 'utf8')) as {
      panels: { targets?: { expr?: string; legendFormat?: string }[] }[];
    };
    const allowed = new Set(['queue', 'state', 'job', 'outcome', 'app', 'route']);

    for (const panel of dashboard.panels) {
      for (const target of panel.targets ?? []) {
        for (const match of (target.legendFormat ?? '').matchAll(/\{\{\s*([^}\s]*)\s*\}\}/g)) {
          // `{{__name__}}` and a bare `{{}}` render EVERY label on the series,
          // so a future label carrying an id would surface on an
          // unauthenticated dashboard with no code change at all.
          expect(allowed.has(match[1] ?? '')).toBe(true);
        }
      }
    }
  });
});

/**
 * Check 10 — S-E02-18 / PF-108: a GAUGE aggregated with `sum()`.
 *
 * `pilotage-slo.json:85` used to read `sum by (queue, state)
 * (pilotage_queue_depth)`. Depth is a property of the QUEUE, not of the process,
 * so every worker replica publishes the same absolute number and
 * `docker compose up --scale worker=2` doubles every line while the queue is
 * unchanged. The counters beside it are correct as written, because a counter
 * `rate()` IS additive across replicas — which is why the rule is stated over
 * the DECLARED TYPE and not over one metric name.
 */
describe('observability gate — a gauge must not be summed across replicas', () => {
  /** The healthy input with the first panel's targets replaced by one expression. */
  function withExpr(expr: string): Record<string, unknown> {
    return withInput((input) => {
      const dashboards = input.dashboards as { doc: { panels: Record<string, unknown>[] } }[];
      const panel = at(at(dashboards, 0, 'dashboards').doc.panels, 0, 'panels');
      panel.title = 'Profondeur de file par état';
      panel.targets = [{ expr }];
    });
  }

  it('T18 — FAILS on the expression that actually shipped, naming metric and panel', () => {
    const { problems } = evaluateObservability(
      withExpr('sum by (queue, state) (pilotage_queue_depth)'),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('aggregates the GAUGE "pilotage_queue_depth" with sum()');
    expect(joined).toContain('Profondeur de file par état');
    expect(joined).toContain('doubles every line');
  });

  it('T18b — accepts the correction, `max by (...)`', () => {
    const { problems } = evaluateObservability(
      withExpr('max by (queue, state) (pilotage_queue_depth)'),
    );
    expect(problems).toEqual([]);
  });

  it('T18c — accepts a COUNTER whose name is a prefix-superset of the gauge’s', () => {
    // The false-red this rule would generate if it resolved names by
    // `startsWith`: `pilotage_queue_depth_collection_failures_total` begins with
    // `pilotage_queue_depth`, and it is exactly the series AC-5 adds beside it.
    const { problems } = evaluateObservability(
      withExpr('sum by (queue) (rate(pilotage_queue_depth_collection_failures_total[5m]))'),
    );
    expect(problems).toEqual([]);
  });

  it('T18d — accepts a bare gauge with no aggregation at all', () => {
    const { problems } = evaluateObservability(withExpr('nodejs_eventloop_lag_p99_seconds'));
    expect(problems).toEqual([]);
  });

  it('T18e — accepts a histogram summed under histogram_quantile', () => {
    // `_bucket` resolves through `baseMetricName` to a family typed `histogram`,
    // and the `sum` inside `histogram_quantile` reads a `rate()`, not the gauge.
    const { problems } = evaluateObservability(
      withExpr(
        'histogram_quantile(0.95, sum by (le, queue, job) (rate(pilotage_queue_job_duration_seconds_bucket[5m])))',
      ),
    );
    expect(problems).toEqual([]);
  });

  it('T18f — FAILS CLOSED when the type map is missing, empty or not a map (DNC-08)', () => {
    for (const broken of [null, undefined, {}, [], 'gauge']) {
      const { problems } = evaluateObservability(
        withInput((input) => {
          input.exposedMetricTypes = broken;
        }),
      );
      expect(problems.join('\n')).toContain('declared TYPE of each registered metric');
      expect(problems.join('\n')).toContain('That is a failure, not a skip');
    }
  });

  it('T18g — an unscannable sum() is a PROBLEM, not an accepted expression', () => {
    const { problems } = evaluateObservability(withExpr('sum by (queue) (pilotage_queue_depth'));
    expect(problems.join('\n')).toContain('cannot scan to a matching parenthesis');
  });

  it('T18h — check 6 is untouched by the widening: exposedMetrics stays a string[]', () => {
    // P0-4. Had the type map been folded INTO `exposedMetrics`, check 6's
    // `new Set(exposed || [])` + `if (size === 0) break` would have accepted
    // every dashboard query silently, inside a blocking stage.
    const { problems } = evaluateObservability(
      withInput((input) => {
        const dashboards = input.dashboards as { doc: { panels: Record<string, unknown>[] } }[];
        at(at(dashboards, 0, 'dashboards').doc.panels, 0, 'panels').targets = [
          { expr: 'rate(pilotage_metric_no_application_will_ever_register_total[5m])' },
        ];
      }),
    );
    expect(problems.join('\n')).toContain('pilotage_metric_no_application_will_ever_register_total');
    expect(Array.isArray(healthyInput().exposedMetrics)).toBe(true);
  });

  it('T18i — the real dashboard aggregates its gauge with max, not sum', () => {
    // The fixture proves the rule; this proves the repository obeys it.
    const dashboardPath = join(REPO_ROOT, 'infra', 'grafana', 'dashboards', 'pilotage-slo.json');
    const dashboard = JSON.parse(readFileSync(dashboardPath, 'utf8')) as {
      panels: { targets?: { expr?: string }[] }[];
    };
    const exprs = dashboard.panels.flatMap((panel) =>
      (panel.targets ?? []).map((target) => target.expr ?? ''),
    );
    expect(exprs).toContain('max by (queue, state) (pilotage_queue_depth)');
    expect(exprs.some((expr) => /\bsum\s+by\s*\([^)]*\)\s*\(\s*pilotage_queue_depth\s*\)/.test(expr))).toBe(
      false,
    );
    // AC-5: the outage signal panel 5's description names BY NAME is now queried.
    expect(exprs).toContain(
      'sum by (queue) (rate(pilotage_queue_depth_collection_failures_total[5m]))',
    );
    // AC-4: the stalled series is plotted, and it is NOT a fourth `outcome`.
    expect(exprs).toContain('sum by (queue) (rate(pilotage_queue_stalled_total[5m]))');
    expect(exprs.join('\n')).not.toContain('outcome=~"stalled');
  });

  /* ---------------------------------------------------------------- *
   * S-E02-19 / PF-114 — check 10 must stop rejecting correct PromQL.
   *
   * Every case below was RED before the shield walk landed: `T20`, `T20f` and
   * `T20g` reported a problem on a correct expression, and `T20e` reported none
   * on one the reader cannot parse. `T20b`, `T20c` and `T20d` are the ones that
   * keep the rule a rule — if a widening makes any of them green, the gate has
   * been deleted rather than fixed.
   * ---------------------------------------------------------------- */

  it('T20 — AC-1: accepts the replica-safe idiom its OWN message recommends', () => {
    // `max by (queue, state)` emits ONE series per (queue, state): the replica
    // dimension is gone before the sum runs, so summing the states is ordinary
    // arithmetic. This is the expression check 10's error text tells you to
    // write, and it used to be flagged.
    const { problems } = evaluateObservability(
      withExpr('sum by (queue) (max by (queue, state) (pilotage_queue_depth))'),
    );
    expect(problems).toEqual([]);
  });

  it('T20b — AC-2: `sum by (queue) (gauge)` is STILL a problem, naming metric and panel', () => {
    // The load-bearing criterion. This is the PF-108 defect the rule exists for.
    const { problems } = evaluateObservability(withExpr('sum by (queue) (pilotage_queue_depth)'));
    const joined = problems.join('\n');
    expect(joined).toContain('aggregates the GAUGE "pilotage_queue_depth" with sum()');
    expect(joined).toContain('Profondeur de file par état');
  });

  it('T20c — AC-4: an inner `by` list that RETAINS a replica label is still flagged', () => {
    // `max by (queue, state, instance)` keeps one series per replica, so the
    // outer sum still double-counts. Shielding on the operator name alone would
    // wrongly accept this.
    const { problems } = evaluateObservability(
      withExpr('sum by (queue) (max by (queue, state, instance) (pilotage_queue_depth))'),
    );
    expect(problems.join('\n')).toContain('aggregates the GAUGE "pilotage_queue_depth" with sum()');
  });

  it('T20d — AC-4: `max_over_time` shields nothing, and is still flagged', () => {
    // The trap. `max_over_time` aggregates one series' samples in TIME; it
    // removes no series at all, so every replica survives into the sum. A fix
    // keyed on the string `max` accepts this.
    const { problems } = evaluateObservability(
      withExpr('sum by (queue) (max_over_time(pilotage_queue_depth[5m]))'),
    );
    expect(problems.join('\n')).toContain('aggregates the GAUGE "pilotage_queue_depth" with sum()');
  });

  it('T20e — AC-5: DNC-08 extends to the NEW parse — an unscannable inner agg FAILS', () => {
    // The outer sum scans fine; the inner `max by (queue)` has no argument. The
    // shield walk must say so rather than concluding "cannot tell, assume safe",
    // which is how a blocking stage becomes a vacuous pass.
    const { problems } = evaluateObservability(
      withExpr('sum by (queue) (max by (queue) pilotage_queue_depth)'),
    );
    expect(problems.join('\n')).toContain('cannot scan to a matching parenthesis');
  });

  it('T20f — AC-7: a `sum` inside a LABEL VALUE is not an aggregation', () => {
    // `sumAggregationArguments` scanned the raw text, found the `sum` in
    // `job="sum"`, failed to find an argument for it and returned
    // `unbalanced: true` — a hard PROBLEM on a correct tree.
    const { problems } = evaluateObservability(
      withExpr('sum by (queue) (rate(pilotage_queue_jobs_total{job="sum"}[5m]))'),
    );
    expect(problems).toEqual([]);
  });

  it('T20g — AC-7: nor is a `sum` inside a label_replace() string argument', () => {
    const { problems } = evaluateObservability(
      withExpr(
        'sum by (queue) (label_replace(rate(pilotage_queue_jobs_total[5m]), "sum", "$1", "queue", "(.*)"))',
      ),
    );
    expect(problems).toEqual([]);
  });
});

/**
 * S-E02-19 / PF-114 — the shield walk, driven directly.
 *
 * The cases above prove the RULE; these prove the mechanism, one property per
 * case, so a regression names which property broke rather than "check 10 is
 * red".
 */
describe('observability gate — the replica shield walk', () => {
  const TYPES: Record<string, string> = {
    pilotage_queue_depth: 'gauge',
    pilotage_queue_depth_collection_failures_total: 'counter',
    pilotage_queue_jobs_total: 'counter',
    pilotage_queue_job_duration_seconds: 'histogram',
    nodejs_eventloop_lag_p99_seconds: 'gauge',
  };

  it('T21 — an aggregation with NO grouping modifier shields: it collapses to one series', () => {
    expect(unshieldedGaugeReferences('max(pilotage_queue_depth)', TYPES)).toEqual({
      families: [],
      unscannable: false,
    });
  });

  it('T21b — `by (...)` shields iff it names no replica label', () => {
    expect(
      unshieldedGaugeReferences('max by (queue, state) (pilotage_queue_depth)', TYPES).families,
    ).toEqual([]);
    expect(
      unshieldedGaugeReferences('max by (queue, instance) (pilotage_queue_depth)', TYPES).families,
    ).toEqual(['pilotage_queue_depth']);
  });

  it('T21c — `without (...)` shields ONLY when it explicitly removes a replica label', () => {
    // A `without` keeps everything it does not name, `instance` included, so
    // "it is a without, therefore it aggregated" is exactly the wrong reading.
    expect(
      unshieldedGaugeReferences('max without (instance) (pilotage_queue_depth)', TYPES).families,
    ).toEqual([]);
    expect(
      unshieldedGaugeReferences('max without (state) (pilotage_queue_depth)', TYPES).families,
    ).toEqual(['pilotage_queue_depth']);
  });

  it('T21d — the shield is inherited outward-in, not per level', () => {
    // The OUTER `avg by (queue)` already removes `instance`, so the inner
    // `max by (queue, instance)` does not need to.
    expect(
      unshieldedGaugeReferences(
        'avg by (queue) (max by (queue, instance) (pilotage_queue_depth))',
        TYPES,
      ).families,
    ).toEqual([]);
  });

  it('T21e — a counter and a histogram are never reported, whatever the shielding', () => {
    expect(
      unshieldedGaugeReferences(
        'rate(pilotage_queue_depth_collection_failures_total[5m])',
        TYPES,
      ).families,
    ).toEqual([]);
    expect(
      unshieldedGaugeReferences('rate(pilotage_queue_job_duration_seconds_bucket[5m])', TYPES)
        .families,
    ).toEqual([]);
  });

  it('T21f — `instance` and `pod` are named in one exported constant, not inlined', () => {
    // The list decides every verdict above; a reviewer has to be able to read it
    // without reading the walk.
    for (const label of ['instance', 'pod', 'job', 'replica', 'container', 'host']) {
      expect(REPLICA_LABELS.has(label)).toBe(true);
    }
    expect(REPLICA_LABELS.has('queue')).toBe(false);
    expect(REPLICA_LABELS.has('state')).toBe(false);
  });

  it('T21g — the quote mask preserves LENGTH, so every index still addresses the original', () => {
    // Not cosmetic: `sumAggregationArguments` slices the ORIGINAL expression by
    // an index found in the masked one. A mask that shortened the text would
    // return an argument off by however many characters the label values held.
    for (const expr of [
      'x_total{job="sum"}',
      'label_replace(x, "a\\"b", "$1", "q", "(.*)")',
      "y{k='sum'}",
      'sum by (queue) (x)',
    ]) {
      expect(maskQuotedSpans(expr)).toHaveLength(expr.length);
    }
    expect(maskQuotedSpans('x_total{job="sum"}')).toBe('x_total{job="   "}');
  });
});

/**
 * S-E02-19 / PF-116 + PF-117 — the two directions in which this slice's OWN
 * first implementation opened the gate it was written to sharpen.
 *
 * Why these deserve their own block rather than a line in the one above: every
 * residual this epic has recorded before was fail-CLOSED — a gate too strict,
 * which is annoying and self-announcing. These two were fail-OPEN — a blocking
 * stage that went green on expressions `HEAD` reddened. A gate nobody can trust
 * to go red is the exact defect S-E02-18 spent a whole slice closing, so a
 * regression of that shape, introduced by the slice that follows it, is the one
 * thing this epic cannot ship.
 *
 * Each case is driven through `evaluateObservability` — the real entry point,
 * with a real dashboard shape — rather than through the walk, because what must
 * not regress is the VERDICT, not the intermediate.
 */
describe('observability gate — an operator may shield only if it is replica-idempotent', () => {
  const TYPES: Record<string, string> = {
    pilotage_queue_depth: 'gauge',
    pilotage_queue_jobs_total: 'counter',
  };

  /** The gauge-aggregation verdict for one panel expression. */
  function verdictFor(expr: string): 'flagged' | 'accepted' {
    const evaluation = evaluateObservability({
      exposedMetricTypes: TYPES,
      dashboards: [{ file: 'probe.json', doc: { panels: [{ title: 'p', targets: [{ expr }] }] } }],
    });
    const fired = evaluation.problems.filter((problem) =>
      /aggregates the GAUGE|cannot scan|cannot read/i.test(problem),
    );
    return fired.length > 0 ? 'flagged' : 'accepted';
  }

  // Each row is `[expression, verdict, why]`. The `why` is the point: a bare
  // matrix of strings would tell a future reader WHAT broke and never why the
  // answer is what it is.
  const CASES: [string, 'flagged' | 'accepted', string][] = [
    // --- the rule this check exists for, and the false red PF-114 removed ---
    ['sum by (queue) (pilotage_queue_depth)', 'flagged', 'PF-108: the bare gauge, summed'],
    [
      'sum by (queue) (max by (queue, state) (pilotage_queue_depth))',
      'accepted',
      'PF-114: the idiom the message itself recommends',
    ],
    // --- NOT idempotent over replicas: must never shield (PF-116) ---
    [
      'sum by (queue) (topk(3, pilotage_queue_depth))',
      'flagged',
      'topk SELECTS k original series, every label incl. instance intact',
    ],
    [
      'sum by (queue) (bottomk(1, pilotage_queue_depth))',
      'flagged',
      'bottomk is a selector for the same reason',
    ],
    [
      'sum by (queue) (count by (queue, state) (pilotage_queue_depth))',
      'flagged',
      'count returns N replicas, so the outer sum counts processes',
    ],
    [
      'sum by (queue) (count_values("v", pilotage_queue_depth))',
      'flagged',
      'count_values is a count, not a reduction to the value',
    ],
    [
      'sum by (queue) (stddev by (queue) (pilotage_queue_depth))',
      'flagged',
      'stddev of identical replicas is 0 — not the resource value',
    ],
    [
      'sum by (queue) (stdvar by (queue) (pilotage_queue_depth))',
      'flagged',
      'stdvar, same reasoning as stddev',
    ],
    [
      'sum by (queue) (sum by (queue, state) (pilotage_queue_depth))',
      'flagged',
      'a nested sum ADDS the replicas — it is the defect, not a shield',
    ],
    // --- idempotent over replicas: may shield ---
    ['sum by (queue) (avg by (queue, state) (pilotage_queue_depth))', 'accepted', 'avg of v..v is v'],
    ['sum by (queue) (min by (queue, state) (pilotage_queue_depth))', 'accepted', 'min of v..v is v'],
    [
      'sum by (queue) (group by (queue, state) (pilotage_queue_depth))',
      'accepted',
      'group is always one series per group',
    ],
    // --- the grouping modifier still decides, inside an idempotent operator ---
    [
      'sum by (queue) (max by (queue, state, instance) (pilotage_queue_depth))',
      'flagged',
      'max kept instance, so the replicas survive into the sum',
    ],
    [
      'sum by (queue) (max without (instance) (pilotage_queue_depth))',
      'accepted',
      'without explicitly removes the replica label',
    ],
    [
      'sum by (queue) (max without (state) (pilotage_queue_depth))',
      'flagged',
      'without keeps everything it does not name, instance included',
    ],
    // --- neither an aggregation nor a gauge ---
    [
      'sum by (queue) (max_over_time(pilotage_queue_depth[5m]))',
      'flagged',
      'a range function reduces samples in time, not series',
    ],
    [
      'sum by (queue) (rate(pilotage_queue_jobs_total[5m]))',
      'accepted',
      'a counter rate IS additive across replicas',
    ],
    // --- PF-117: the mask must not swallow the expression it is masking ---
    [
      'foo{a="b} + sum by (queue) (pilotage_queue_depth)',
      'flagged',
      'PF-117: an unterminated quote blanked the tail, hiding the sum',
    ],
    [
      'sum by (queue) (max by (queue, state) (pilotage_queue_depth{tenant="a"}))',
      'accepted',
      'a TERMINATED quote is still masked, not reported',
    ],
  ];

  it.each(CASES)('%s → %s (%s)', (expr, expected) => {
    expect(verdictFor(expr)).toBe(expected);
  });

  it('T22 — the shielding set is a strict, named SUBSET of the parsed set', () => {
    // Parsing and shielding are different questions, and conflating them is
    // precisely what opened the five holes above: every operator must still be
    // PARSED (or the walk mis-reads the nesting), only some may SHIELD.
    for (const operator of REPLICA_IDEMPOTENT_AGGREGATIONS) {
      expect(ACROSS_SERIES_AGGREGATIONS).toContain(operator);
    }
    expect([...REPLICA_IDEMPOTENT_AGGREGATIONS].sort()).toEqual([
      'avg',
      'group',
      'max',
      'min',
      'quantile',
    ]);
    // Fail-closed, stated as an assertion rather than left to the reader: an
    // operator absent from the shielding set shields nothing, so a PromQL
    // operator added to the language later is unsafe until someone proves it.
    for (const unsafe of ['sum', 'count', 'count_values', 'stddev', 'stdvar', 'topk', 'bottomk']) {
      expect(REPLICA_IDEMPOTENT_AGGREGATIONS.has(unsafe)).toBe(false);
    }
  });

  it('T23 — the unterminated-quote signal comes from the SAME scan as the mask', () => {
    // Two scanners would drift: one gets a new quote character, the other does
    // not, and the mask silently disagrees with the failure signal.
    expect(scanQuotedSpans('x_total{job="sum"}')).toEqual({
      masked: 'x_total{job="   "}',
      unterminated: false,
    });
    const open = scanQuotedSpans('foo{a="b} + sum by (queue) (pilotage_queue_depth)');
    expect(open.unterminated).toBe(true);
    expect(open.masked).toHaveLength('foo{a="b} + sum by (queue) (pilotage_queue_depth)'.length);
    expect(maskQuotedSpans('x_total{job="sum"}')).toBe(scanQuotedSpans('x_total{job="sum"}').masked);
  });

  it('T24 — an unterminated quote reaches the caller as unbalanced, not as no-tokens', () => {
    // The failure mode was silent: the tail was blanked, so the `sum` in it was
    // never seen, and `{ args: [], unbalanced: false }` reads exactly like a
    // panel that contains no sum at all.
    expect(sumAggregationArguments('foo{a="b} + sum by (queue) (pilotage_queue_depth)')).toEqual({
      args: [],
      unbalanced: true,
    });
    expect(unshieldedGaugeReferences('max by (queue) (x{a="b)', TYPES).unscannable).toBe(true);
  });
});

/**
 * S-E02-19 / PF-115 (b) — the restore guarantee, AC-10.
 *
 * `readInstrumentedQueues` drives the REAL write path against the process-wide
 * prom-client registry and restores it in a `finally` that, until this slice,
 * nothing asserted. A leak there fabricates queue traffic every later reader in
 * the process treats as real — the "green and false" shape this epic exists to
 * close, relocated into the mechanism written to close it.
 *
 * The predicate is driven here rather than the reader, deliberately: driving the
 * reader can only ever demonstrate that the restore worked TODAY, and it needs
 * `apps/worker/dist`. These four cases demonstrate that a residue would be SEEN.
 */
describe('observability gate — the driven registry must be left clean', () => {
  const CLEAN = [
    '# TYPE pilotage_queue_depth gauge',
    '# TYPE pilotage_queue_jobs_total counter',
    'pilotage_queue_depth_sources_bound{queue="exports",app="worker"} 0',
    'pilotage_queue_depth_collection_failures_total{queue="exports",app="worker"} 0',
    '',
  ].join('\n');

  const DRIVEN = [{ queue: 'exports', job: 'export.generate' }];

  it('T22 — a clean exposition reports no residue', () => {
    expect(registryResidue(CLEAN, DRIVEN)).toEqual([]);
  });

  it('T22b — a depth sample carrying the driven sentinel is named', () => {
    const residue = registryResidue(
      `${CLEAN}pilotage_queue_depth{queue="exports",state="waiting",app="worker"} ${DRIVEN_DEPTH_SENTINEL}\n`,
      DRIVEN,
    );
    expect(residue).toHaveLength(1);
    expect(residue.join('\n')).toContain('pilotage_queue_depth still carries the driven sentinel');
  });

  it('T22c — a jobs_total sample for the DRIVEN (queue, job) pair is named', () => {
    const residue = registryResidue(
      `${CLEAN}pilotage_queue_jobs_total{queue="exports",job="export.generate",outcome="completed",app="worker"} 1\n`,
      DRIVEN,
    );
    expect(residue.join('\n')).toContain('pilotage_queue_jobs_total still carries a driven outcome');

    // Matched on the PAIR, not on the family: traffic recorded by something
    // else is not this check's residue, and calling it residue would make the
    // reader fail on a healthy process.
    expect(
      registryResidue(
        `${CLEAN}pilotage_queue_jobs_total{queue="imports",job="import.apply",outcome="completed",app="worker"} 1\n`,
        DRIVEN,
      ),
    ).toEqual([]);
  });

  it('T22d — a still-bound synthetic depth source is named', () => {
    const residue = registryResidue(
      `${CLEAN}pilotage_queue_depth_sources_bound{queue="imports",app="worker"} 1\n`,
      DRIVEN,
    );
    expect(residue.join('\n')).toContain('pilotage_queue_depth_sources_bound still reports');
  });

  it('T22e — a depth sample at some OTHER value is not the sentinel, and is not residue', () => {
    // The sentinel is what this check wrote. Reporting every depth sample would
    // make the reader red on a worker that is legitimately collecting.
    expect(
      registryResidue(
        `${CLEAN}pilotage_queue_depth{queue="exports",state="waiting",app="worker"} 3\n`,
        DRIVEN,
      ),
    ).toEqual([]);
  });
});

/**
 * S-E02-19 / PF-115 (a) — `readCollectorBoundQueues`, AC-9.
 *
 * It had ZERO executed coverage anywhere in the repository, while six distinct
 * causes collapsed into one `null` that the caller rendered as a message naming
 * `queue-metrics.js` — a file none of those six causes is about.
 *
 * The optional path argument is a TESTABILITY SEAM, not a flag (DNC-10): it
 * cannot be reached from the command line, it changes only WHICH file is read,
 * and it cannot make any check pass. `T23g` pins that the default is the real
 * artefact.
 */
describe('observability gate — the collector reader names the file it read', () => {
  let dir = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pilotage-obs-gate-'));
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** A throw-away CommonJS module, uniquely named so `require`'s cache cannot alias two cases. */
  function fixture(name: string, source: string): string {
    const path = join(dir, `${name}.js`);
    writeFileSync(path, source, 'utf8');
    return path;
  }

  it('T23 — an absent collector artefact names the COLLECTOR, not queue-metrics.js', () => {
    const result = readCollectorBoundQueues(join(dir, 'nothing-here.js'));
    expect(result.ok).toBe(false);
    expect((result as ReaderFailure).reason).toBe('collector-module-absent');
    expect((result as ReaderFailure).file).toContain('nothing-here.js');
  });

  it('T23b — a module that throws on require reports the cause AND the error text', () => {
    const path = fixture('throws-on-require', "throw new Error('collector exploded');\n");
    const result = readCollectorBoundQueues(path) as ReaderFailure;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('collector-module-unloadable');
    expect(result.file).toContain('throws-on-require.js');
    expect(result.detail).toContain('collector exploded');
  });

  it('T23c — a module exporting no QueueDepthCollector is its own cause', () => {
    const path = fixture('no-export', 'module.exports = { somethingElse: 1 };\n');
    const result = readCollectorBoundQueues(path) as ReaderFailure;
    expect(result.reason).toBe('collector-export-missing');
    expect(result.file).toContain('no-export.js');
  });

  it('T23d — a class with no `self:paramtypes` is its own cause', () => {
    const path = fixture(
      'no-paramtypes',
      'class QueueDepthCollector {}\nmodule.exports = { QueueDepthCollector };\n',
    );
    const result = readCollectorBoundQueues(path) as ReaderFailure;
    expect(result.reason).toBe('collector-paramtypes-missing');
  });

  it('T23e — injected params carrying no BullQueue_* token is its own cause', () => {
    // The realistic drift: `@InjectQueue` replaced by a plain constructor
    // dependency. The drive set would silently become empty, and rule 6 would
    // compare against nothing.
    const path = fixture(
      'no-queue-token',
      [
        'class QueueDepthCollector {}',
        "Reflect.defineMetadata('self:paramtypes', [{ index: 0, param: 'SomeOtherToken' }], QueueDepthCollector);",
        'module.exports = { QueueDepthCollector };',
      ].join('\n'),
    );
    const result = readCollectorBoundQueues(path) as ReaderFailure;
    expect(result.reason).toBe('collector-no-queue-token');
  });

  it('T23f — the happy path returns the injected queue names, in declaration order', () => {
    const path = fixture(
      'happy',
      [
        'class QueueDepthCollector {}',
        "Reflect.defineMetadata('self:paramtypes', [",
        "  { index: 0, param: 'BullQueue_exports' },",
        "  { index: 1, param: 'BullQueue_notifications-email' },",
        "  { index: 2, param: 'BullQueue_imports' },",
        '], QueueDepthCollector);',
        'module.exports = { QueueDepthCollector };',
      ].join('\n'),
    );
    const result = readCollectorBoundQueues(path);
    expect(result.ok).toBe(true);
    expect((result as { ok: true; queues: string[] }).queues).toEqual([
      'exports',
      'notifications-email',
      'imports',
    ]);
  });

  it('T23g — the DEFAULT argument is the real collector artefact (DNC-10: a seam, not a flag)', () => {
    // Driven as an equality rather than asserted over source text, and it holds
    // whether or not `apps/worker/dist` is present in this environment.
    expect(readCollectorBoundQueues()).toEqual(
      readCollectorBoundQueues(join(REPO_ROOT, WORKER_QUEUE_DEPTH_COLLECTOR_MODULE)),
    );
  });
});

/**
 * S-E02-19 / PF-115 (a) — the caller's half of AC-8: reason → message.
 *
 * Every cause must reach the operator naming the file it is about, and an
 * unrecognised reason must fail CLOSED rather than being treated as a pass.
 */
describe('observability gate — an unreadable instrumented set says WHY', () => {
  it('T24 — a collector-side cause names queue-depth.collector.js, not queue-metrics.js', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.instrumentedQueues = {
          ok: false,
          reason: 'collector-module-absent',
          file: 'apps/worker/dist/shared/observability/queue-depth.collector.js',
        };
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('queue-depth.collector.js');
    expect(joined).not.toContain('queue-metrics.js');
    expect(joined).toContain('That is a failure, not a skip');
  });

  it('T24b — a registry-side cause names metrics.registry.js and quotes the residue', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.instrumentedQueues = {
          ok: false,
          reason: 'registry-not-restored',
          file: 'apps/worker/dist/shared/observability/metrics.registry.js',
          detail: 'pilotage_queue_depth still carries the driven sentinel 17',
        };
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('metrics.registry.js');
    expect(joined).toContain('still carries the driven sentinel 17');
    expect(joined).toContain('every later reader in this process would treat as real');
  });

  it('T24c — a queue-metrics-side cause still names queue-metrics.js', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.instrumentedQueues = {
          ok: false,
          reason: 'driven-write-path-threw',
          file: 'apps/worker/dist/shared/observability/queue-metrics.js',
          detail: 'boom',
        };
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('queue-metrics.js');
    expect(joined).toContain('driving the real write path threw');
    expect(joined).toContain('boom');
  });

  it('T24d — an UNRECOGNISED reason fails closed, naming the reason it did not know', () => {
    // DNC-08 applied to the enum itself. A reason added to a reader and not to
    // the map must be a red that points at the map, never a silent pass.
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.instrumentedQueues = { ok: false, reason: 'a-cause-nobody-mapped', file: 'x.js' };
      }),
    );
    const joined = problems.join('\n');
    expect(joined).toContain('a-cause-nobody-mapped');
    expect(joined).toContain('That is a failure, not a skip');
  });

  it('T24e — `ok: false` with no reason at all is still a failure', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.instrumentedQueues = { ok: false };
      }),
    );
    expect(problems.join('\n')).toContain('no reason at all');
    expect(problems.join('\n')).toContain('That is a failure, not a skip');
  });

  it('T24f — a result whose `declared` is not a list is a failure, not a skip', () => {
    const { problems } = evaluateObservability(
      withInput((input) => {
        input.instrumentedQueues = { ok: true, declared: 'exports', rendered: ['exports'] };
      }),
    );
    expect(problems.join('\n')).toContain('That is a failure, not a skip');
  });
});

describe('observability gate — helpers behave as the rules assume', () => {
  it('T19 — sumAggregationArguments returns the DIRECT argument of each sum', () => {
    expect(sumAggregationArguments('sum by (queue, state) (pilotage_queue_depth)')).toEqual({
      args: ['pilotage_queue_depth'],
      unbalanced: false,
    });
    expect(
      sumAggregationArguments('sum without (app) (rate(pilotage_http_requests_total[5m]))').args,
    ).toEqual(['rate(pilotage_http_requests_total[5m])']);
    expect(sumAggregationArguments('sum(rate(x_total[5m]))').args).toEqual(['rate(x_total[5m])']);

    // `sum_over_time` and a trailing `_sum` are NOT aggregations — a token test,
    // not a substring test, or every histogram `_sum` series would false-red.
    expect(sumAggregationArguments('sum_over_time(pilotage_queue_depth[5m])').args).toEqual([]);
    expect(sumAggregationArguments('pilotage_http_request_duration_seconds_sum').args).toEqual([]);

    // Two sums in one expression, each scanned independently.
    expect(
      sumAggregationArguments(
        'sum by (app) (rate(a_total[5m])) / clamp_min(sum by (app) (rate(b_total[5m])), 0.001)',
      ).args,
    ).toEqual(['rate(a_total[5m])', 'rate(b_total[5m])']);

    // Unbalanced is REPORTED, never silently treated as "no aggregation".
    expect(sumAggregationArguments('sum by (queue) (pilotage_queue_depth').unbalanced).toBe(true);
    expect(sumAggregationArguments('sum pilotage_queue_depth').unbalanced).toBe(true);
  });

  it('T19b — S-E02-19 / AC-7: a `sum` inside a quoted label value is not a token', () => {
    // It used to be, and — finding no argument after the closing quote — the
    // reader returned `unbalanced: true`, i.e. a hard PROBLEM on a correct tree.
    // The returned argument must be the REAL one, quotes and all: the mask is
    // same-length precisely so the slice below still addresses the original.
    expect(sumAggregationArguments('sum by (queue) (x_total{job="sum"})')).toEqual({
      args: ['x_total{job="sum"}'],
      unbalanced: false,
    });
    expect(
      sumAggregationArguments('sum by (q) (label_replace(x_total, "sum", "$1", "q", "(.*)"))'),
    ).toEqual({
      args: ['label_replace(x_total, "sum", "$1", "q", "(.*)")'],
      unbalanced: false,
    });

    // And the existing negatives are unchanged — the mask must not have made
    // the token test looser.
    expect(sumAggregationArguments('sum_over_time(pilotage_queue_depth[5m])').args).toEqual([]);
    expect(sumAggregationArguments('sum pilotage_queue_depth').unbalanced).toBe(true);
  });


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

  /**
   * DNC-10, widened by S-E02-17 for two reasons the previous shape had.
   *
   * It was too NARROW: it listed three literal strings, so `SKIP_QUEUE_CHECK`
   * or `ALLOW_UNINSTRUMENTED` would have sailed straight through. Patterns
   * close that.
   *
   * And it was comment-FRAGILE: it read raw source, so a new comment containing
   * the words "--skip" would turn it red on a slice that shipped no bug. "A
   * guard that a comment can turn red is a guard that gets deleted"
   * (`boot-gate.spec.ts`). So it now runs over comment-stripped content, using
   * the same discipline as that file — assert against what the runtime
   * EXECUTES, not what the file says.
   *
   * S-E02-18 note on coverage, so nobody has to re-derive it: this assertion is
   * PATTERN-based, so it already covers the rules that slice added — check 10
   * (a gauge aggregated with `sum()`) and the rewritten rule 6 of check 9 — and
   * neither of them may grow a `SKIP_*` / `ALLOW_*` / `FORCE` / `CI` /
   * `NODE_ENV` seam. Neither takes a CLI flag or an env var either: the seams
   * they needed are function exports (`sumAggregationArguments`,
   * `registerQueueDepthSources`, `observeJobCompleted`).
   */
  it('has no bypass flag — DNC-10', () => {
    const executable = stripJsComments(readFileSync(SCRIPT_PATH, 'utf8'));

    for (const flag of ['--force', '--skip', '--no-verify', 'SKIP_OBSERVABILITY']) {
      expect(executable).not.toContain(flag);
    }
    // Whole families, not three literals: the next bypass will not be named
    // after the last one.
    for (const pattern of [
      /\bSKIP_[A-Z0-9_]+\b/,
      /\bALLOW_[A-Z0-9_]+\b/,
      /\bQUEUE_METRICS_[A-Z0-9_]+\b/,
      /--(?:skip|force|no-verify)\b/,
    ]) {
      expect(executable).not.toMatch(pattern);
    }
  });

  it('the DNC-10 guard can actually fail — proven, not assumed', () => {
    // R-26 / PF-83. A guard that has never been shown to fire is a guard we
    // hope works. Feed it a throw-away copy carrying a real flag.
    const withFlag = stripJsComments(
      'const off = process.env.SKIP_QUEUE_CHECK === "1";\nif (off) process.exit(0);\n',
    );
    expect(withFlag).toMatch(/\bSKIP_[A-Z0-9_]+\b/);

    // …and it must NOT fire on the same flag hidden in a comment, or the guard
    // becomes a trap for the next person who documents it.
    const inComment = stripJsComments('// there is deliberately no SKIP_QUEUE_CHECK here\nrun();\n');
    expect(inComment).not.toMatch(/\bSKIP_[A-Z0-9_]+\b/);
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
