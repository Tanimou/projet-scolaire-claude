#!/usr/bin/env node
/**
 * observability-check.js — the gate over the observability profile this
 * repository *claims* to have (PF-56).
 *
 * WHY THIS EXISTS
 * ---------------
 * `infra/docker-compose.yml` has declared an `obs` profile — Prometheus,
 * Grafana, Loki — for as long as the audit has existed. A2 §13 recorded it as
 * "observability configuration is optional rather than proven active". Measured
 * before this file was written, it was worse than optional:
 *
 *   • `./grafana/prometheus.yml`  — did not exist
 *   • `./grafana/dashboards`      — did not exist
 *   • `./grafana/provisioning`    — did not exist
 *
 * All three are bind-mount sources. Docker creates a **directory** for a missing
 * bind-mount source, so Prometheus would have received a directory where it
 * expects its config file and could not have started at all; Grafana would have
 * come up provisioned with nothing. And no application exposed a single metric,
 * so even a working Prometheus would have scraped nothing.
 *
 * That is R-26 in its purest form: a declared capability that nothing reads.
 * This file is what reads it.
 *
 * WHAT IT CHECKS, AND WHICH DEFECT EACH ONE IS FOR
 * -----------------------------------------------
 *  1. every relative bind-mount source in every compose file exists
 *       → the defect that was actually found; stated as the general class, so a
 *         future service mounting a path nobody created fails here too
 *  2. the Prometheus config parses and declares at least one job
 *       → an empty config is not a pass
 *  3. every scrape target names a compose service, on the port that service
 *     actually listens on
 *       → a target pointing at a service that does not exist, or at the wrong
 *         port, is silent: Prometheus reports the target down and the dashboard
 *         reports "No data", which reads like an idle system
 *  4. every scraped `metrics_path` is a route the application **really boots**
 *       → PF-62's shape at the observability address. The API path is checked
 *         against `scripts/boot-route-baseline.json` — the route table read off
 *         the booted container — not against controller source
 *  5. the Grafana datasource points at the Prometheus service declared in the
 *     compose file, and agrees with it on the scrape interval
 *  6. every metric a dashboard queries is a metric the applications actually
 *     register
 *       → a panel on a metric that does not exist renders "No data" for ever
 *         and is indistinguishable from a healthy quiet system. The metric names
 *         are read from the **built registries**, not from source text (R-26
 *         rule (a): read the resolved value)
 *  7. nginx does not publish `/metrics`
 *       → `/metrics` is unauthenticated by design (Prometheus carries no token).
 *         Its access control IS the network. If a `location` ever publishes it,
 *         that control is gone and nothing else would notice
 *
 * WHY IT RUNS AFTER THE BUILD
 * ---------------------------
 * Checks 4 and 6 read the emitted artefacts (`dist/`) and the booted route
 * baseline rather than source text, for the reason `boot-check.js` reads
 * `dist/` and `web-artifact-check.js` reads `.next/`: the defect lives in the
 * output, and the source is not what ships. A missing `dist/` is a **failure,
 * not a skip** — with nothing to compare against, check 6 would pass vacuously.
 *
 * WHAT IT DOES NOT PROVE — stated plainly
 * ---------------------------------------
 * It does not start Prometheus and watch a scrape succeed. That needs
 * `docker compose --profile obs up`, which the routine forbids (no infra
 * rebuild), and a running api and worker to scrape. So the profile is proven
 * **coherent and complete**, not **ingesting**. The endpoints themselves are
 * proven to serve, by tests that query a real socket — but the hop between
 * Prometheus and those endpoints is configuration this file reads, not traffic
 * it observes.
 *
 * Usage:  node scripts/observability-check.js
 * Exit code is non-zero if any check fails. There is no bypass flag (DNC-10).
 */

const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { join, dirname, resolve, relative } = require('node:path');

const yaml = require('js-yaml');

const REPO_ROOT = resolve(__dirname, '..');

/* ------------------------------------------------------------------ *
 * Pure evaluation
 *
 * Everything below `evaluateObservability` is I/O. The evaluation itself is a
 * pure function of a plain object, for the reason S-E02-12 made it one: a check
 * run only against a healthy repository can demonstrate that the repository is
 * healthy, and nothing else. The spec drives this function with configurations
 * that are known to be wrong.
 * ------------------------------------------------------------------ */

/** Ports Prometheus's own service listens on inside the docker network. */
const PROMETHEUS_CONTAINER_PORT = 9090;

/** PromQL keywords and aggregation modifiers that are not metric names. */
const PROMQL_NON_METRICS = new Set([
  'by',
  'without',
  'on',
  'ignoring',
  'group_left',
  'group_right',
  'offset',
  'bool',
  'and',
  'or',
  'unless',
  'le',
  'inf',
  'nan',
  'start',
  'end',
]);

/** Suffixes Prometheus derives from a histogram; they are not separate metrics. */
const HISTOGRAM_SUFFIXES = ['_bucket', '_sum', '_count'];

/**
 * Extracts the metric names a PromQL expression reads.
 *
 * Deliberately conservative in one direction: an identifier immediately
 * followed by `(` is a function call, never a metric. Label matchers and
 * `by (...)` / `without (...)` clauses are stripped first, because label names
 * live in the same character class as metric names and would otherwise be
 * reported as missing metrics — a false failure is as corrosive to a gate as a
 * false pass, because it teaches people to skip it.
 */
function metricNamesInExpr(expr) {
  if (typeof expr !== 'string') return [];

  const withoutLabels = expr
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\b(?:by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/'[^']*'/g, ' ');

  const names = new Set();
  const identifier = /[a-zA-Z_:][a-zA-Z0-9_:]*/g;
  let match;
  while ((match = identifier.exec(withoutLabels)) !== null) {
    const name = match[0];
    const nextChar = withoutLabels.slice(match.index + name.length).trimStart()[0];
    if (nextChar === '(') continue; // function call
    if (PROMQL_NON_METRICS.has(name.toLowerCase())) continue;
    if (/^\d/.test(name)) continue;
    names.add(name);
  }
  return [...names];
}

/** Strips the suffixes Prometheus derives from a histogram or summary. */
function baseMetricName(name) {
  for (const suffix of HISTOGRAM_SUFFIXES) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
}

/** Splits `host:port`, returning null when the target is not that shape. */
function splitTarget(target) {
  if (typeof target !== 'string') return null;
  const at = target.lastIndexOf(':');
  if (at <= 0 || at === target.length - 1) return null;
  const port = Number.parseInt(target.slice(at + 1), 10);
  if (!Number.isInteger(port)) return null;
  return { host: target.slice(0, at), port };
}

/**
 * The port a compose service listens on *inside* the network.
 *
 * Read from the service's own environment first (`PORT`, `WORKER_HTTP_PORT`),
 * because that is what the process binds; the `ports:` mapping is only how the
 * host reaches it, and the two are frequently different. Falls back to the
 * container side of the first published mapping.
 */
function serviceListenPort(service) {
  if (!service || typeof service !== 'object') return null;

  const env = service.environment;
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    for (const key of ['PORT', 'WORKER_HTTP_PORT']) {
      const raw = env[key];
      if (raw !== undefined && raw !== null) {
        const parsed = Number.parseInt(String(raw), 10);
        if (Number.isInteger(parsed)) return parsed;
      }
    }
  }

  const ports = service.ports;
  if (Array.isArray(ports) && ports.length > 0 && typeof ports[0] === 'string') {
    const segments = ports[0].split(':');
    const containerSide = segments[segments.length - 1];
    const parsed = Number.parseInt(containerSide, 10);
    if (Number.isInteger(parsed)) return parsed;
  }

  return null;
}

/**
 * @param {object} input
 * @returns {{problems: string[], notes: string[]}}
 */
function evaluateObservability(input) {
  const problems = [];
  const notes = [];

  const composeFiles = Array.isArray(input.composeFiles) ? input.composeFiles : [];

  /* -- 1. bind-mount sources ---------------------------------------- */

  if (composeFiles.length === 0) {
    problems.push('no compose file was read — with none, every check below passes vacuously.');
  }

  let mountCount = 0;
  for (const compose of composeFiles) {
    for (const mount of compose.bindMounts ?? []) {
      mountCount += 1;
      if (!mount.exists) {
        problems.push(
          `${compose.file} bind-mounts "${mount.source}", which does not exist. ` +
            'Docker would create a directory there, so the container receives a directory ' +
            'where it expects a file (or an empty one where it expects content) and the ' +
            'service starts misconfigured or not at all.',
        );
      }
    }
  }
  if (mountCount > 0 && problems.length === 0) {
    notes.push(`all ${mountCount} relative bind-mount sources across the compose files exist`);
  }

  /* -- 2/3/4. prometheus scrape configuration ------------------------ */

  // Compose files layer: `docker-compose.prod.yml` carries *partial* service
  // definitions that override the base file key by key. Replacing the whole
  // service object — the obvious `Object.assign` — loses the base file's
  // `environment` and `ports`, and this check reported "listening port cannot be
  // determined" for both applications on its very first run because of it.
  // Merge the way compose itself merges, one level down into `environment`.
  const services = {};
  for (const compose of composeFiles) {
    for (const [name, service] of Object.entries((compose.doc && compose.doc.services) || {})) {
      const previous = services[name] || {};
      services[name] = {
        ...previous,
        ...(service || {}),
        environment: {
          ...(previous.environment && !Array.isArray(previous.environment)
            ? previous.environment
            : {}),
          ...(service && service.environment && !Array.isArray(service.environment)
            ? service.environment
            : {}),
        },
      };
    }
  }

  const prometheus = input.prometheus;
  if (!prometheus || !prometheus.doc) {
    problems.push(
      'the Prometheus configuration is missing or unparseable — the compose file mounts it, ' +
        'so an unreadable one is a service that cannot start.',
    );
  } else {
    const jobs = prometheus.doc.scrape_configs;
    if (!Array.isArray(jobs) || jobs.length === 0) {
      problems.push(`${prometheus.file} declares no scrape job — an empty config is not a pass.`);
    } else {
      notes.push(`${prometheus.file} declares ${jobs.length} scrape job(s)`);

      for (const job of jobs) {
        const name = (job && job.job_name) || '<unnamed>';
        const metricsPath = (job && job.metrics_path) || '/metrics';
        const targets = [];
        for (const staticConfig of (job && job.static_configs) || []) {
          for (const target of (staticConfig && staticConfig.targets) || []) targets.push(target);
        }

        if (targets.length === 0) {
          problems.push(`scrape job "${name}" declares no target.`);
          continue;
        }

        for (const rawTarget of targets) {
          const parsed = splitTarget(rawTarget);
          if (!parsed) {
            problems.push(`scrape job "${name}" has target "${rawTarget}", which is not host:port.`);
            continue;
          }

          // A self-scrape addresses the Prometheus container itself.
          if (parsed.host === 'localhost' || parsed.host === '127.0.0.1') {
            if (parsed.port !== PROMETHEUS_CONTAINER_PORT) {
              problems.push(
                `scrape job "${name}" self-scrapes ${rawTarget}, but Prometheus listens on ` +
                  `${PROMETHEUS_CONTAINER_PORT} inside its container.`,
              );
            }
            continue;
          }

          const service = services[parsed.host];
          if (!service) {
            problems.push(
              `scrape job "${name}" targets host "${parsed.host}", which is not a service in any ` +
                'compose file. Prometheus resolves targets by compose service name; an unknown ' +
                'host is a target that is permanently down and a dashboard that shows "No data".',
            );
            continue;
          }

          const listenPort = serviceListenPort(service);
          if (listenPort === null) {
            problems.push(
              `scrape job "${name}" targets service "${parsed.host}", whose listening port cannot ` +
                'be determined from the compose file (no PORT/WORKER_HTTP_PORT and no ports mapping).',
            );
          } else if (listenPort !== parsed.port) {
            problems.push(
              `scrape job "${name}" targets ${rawTarget}, but service "${parsed.host}" listens on ` +
                `${listenPort} inside the network.`,
            );
          }

          // 4. the scraped path must be a route the app really serves.
          const routeProblem = scrapePathProblem(parsed.host, metricsPath, input);
          if (routeProblem) problems.push(`scrape job "${name}": ${routeProblem}`);
        }
      }
    }
  }

  /* -- 5. Grafana datasource ---------------------------------------- */

  const datasources = Array.isArray(input.datasources) ? input.datasources : [];
  const provisionedUids = new Set();

  if (datasources.length === 0) {
    problems.push(
      'no Grafana datasource is provisioned — the compose file mounts a provisioning directory, ' +
        'and a Grafana with no datasource starts, renders an empty UI, and looks like observability.',
    );
  }

  for (const source of datasources) {
    for (const entry of (source.doc && source.doc.datasources) || []) {
      if (entry && entry.uid) provisionedUids.add(entry.uid);

      const url = entry && entry.url;
      if (typeof url !== 'string') {
        problems.push(`${source.file}: datasource "${entry && entry.name}" declares no url.`);
        continue;
      }
      const withoutScheme = url.replace(/^https?:\/\//, '');
      const parsed = splitTarget(withoutScheme);
      if (!parsed) {
        problems.push(`${source.file}: datasource url "${url}" is not http://host:port.`);
        continue;
      }
      if (!services[parsed.host]) {
        problems.push(
          `${source.file}: datasource url "${url}" names host "${parsed.host}", which is not a ` +
            'compose service. Grafana and Prometheus are separate containers; this resolves to nothing.',
        );
      } else {
        const listenPort = serviceListenPort(services[parsed.host]);
        if (listenPort !== null && listenPort !== parsed.port) {
          problems.push(
            `${source.file}: datasource url "${url}" uses port ${parsed.port}, but service ` +
              `"${parsed.host}" listens on ${listenPort}.`,
          );
        }
      }

      // A datasource whose step disagrees with the scrape interval interpolates
      // between points that were never collected.
      const declaredInterval = entry && entry.jsonData && entry.jsonData.timeInterval;
      const scrapeInterval = prometheus && prometheus.doc && prometheus.doc.global
        ? prometheus.doc.global.scrape_interval
        : undefined;
      if (declaredInterval && scrapeInterval && declaredInterval !== scrapeInterval) {
        problems.push(
          `${source.file}: datasource timeInterval "${declaredInterval}" disagrees with ` +
            `Prometheus scrape_interval "${scrapeInterval}".`,
        );
      }
    }
  }

  /* -- 6. dashboards query metrics that exist ------------------------ */

  const exposed = input.exposedMetrics;
  if (exposed === null || exposed === undefined) {
    problems.push(
      'the applications\u2019 registered metric names could not be read from the build output. ' +
        'That is a failure, not a skip: with nothing to compare against, every dashboard query ' +
        'below would be accepted.',
    );
  }

  const exposedSet = new Set(exposed || []);
  const dashboards = Array.isArray(input.dashboards) ? input.dashboards : [];

  if (dashboards.length === 0) {
    problems.push(
      'no Grafana dashboard was found — the compose file mounts a dashboards directory, and an ' +
        'empty one is the "configuration present, nothing proven" state PF-56 describes.',
    );
  }

  let queryCount = 0;
  for (const dashboard of dashboards) {
    for (const panel of (dashboard.doc && dashboard.doc.panels) || []) {
      const uid = panel && panel.datasource && panel.datasource.uid;
      if (uid && provisionedUids.size > 0 && !provisionedUids.has(uid)) {
        problems.push(
          `${dashboard.file}: panel "${panel.title}" references datasource uid "${uid}", ` +
            'which no provisioning file declares.',
        );
      }

      for (const target of (panel && panel.targets) || []) {
        const expr = target && target.expr;
        if (!expr) continue;
        queryCount += 1;
        for (const referenced of metricNamesInExpr(expr)) {
          if (exposedSet.size === 0) break;
          if (!exposedSet.has(baseMetricName(referenced))) {
            problems.push(
              `${dashboard.file}: panel "${panel.title}" queries "${referenced}", which no ` +
                'application registers. The panel would render "No data" for ever, which is ' +
                'indistinguishable from a system at rest.',
            );
          }
        }
      }
    }
  }
  if (queryCount > 0 && exposedSet.size > 0) {
    notes.push(
      `${queryCount} dashboard queries reference only metrics the applications register ` +
        `(${exposedSet.size} registered)`,
    );
  }

  /* -- 7. nginx must not publish /metrics ---------------------------- */

  const nginxConfs = Array.isArray(input.nginxConfs) ? input.nginxConfs : [];
  for (const conf of nginxConfs) {
    const text = typeof conf.text === 'string' ? conf.text : '';
    for (const line of text.split('\n')) {
      const location = /^\s*location\s+(.+?)\s*\{/.exec(line);
      if (!location) continue;
      if (/metrics/i.test(location[1])) {
        problems.push(
          `${conf.file}: a location publishes "${location[1].trim()}". /metrics is ` +
            'unauthenticated by design — Prometheus carries no token — so its access control is ' +
            'the docker network. Publishing it through the reverse proxy removes that control, ' +
            'and nothing else in the stack would notice.',
        );
      }
    }
  }
  if (nginxConfs.length === 0) {
    problems.push('no nginx configuration was read — the exposure check would pass vacuously.');
  } else {
    notes.push(`${nginxConfs.length} nginx config(s) read; none publishes a metrics path`);
  }

  return { problems, notes };
}

/**
 * The scraped path must be a route the target application actually serves.
 *
 * For the API the comparison is against the booted route table
 * (`scripts/boot-route-baseline.json`) — not controller source — so that a
 * controller silently unmounted (PF-62's exact defect) breaks the scrape config
 * here as well. For the worker the comparison is against the constant its
 * **built** module exports.
 */
function scrapePathProblem(host, metricsPath, input) {
  if (host === 'api') {
    const routes = input.bootRoutes && input.bootRoutes['apps/api'];
    if (!routes) {
      return (
        'the booted route baseline for apps/api could not be read, so the scraped path cannot ' +
        'be verified. That is a failure, not a skip.'
      );
    }
    if (!routes.includes(`GET ${metricsPath}`)) {
      return (
        `it scrapes "${metricsPath}", which the API does not serve. The booted route table is ` +
        'the source of truth here: a controller that stops being mounted would otherwise leave ' +
        'this config pointing at nothing, exactly as PF-62 did for the grading routes.'
      );
    }
    return null;
  }

  if (host === 'worker') {
    const workerPath = input.workerMetricsPath;
    if (!workerPath) {
      return (
        'the worker\u2019s metrics path could not be read from its build output, so the scraped ' +
        'path cannot be verified. That is a failure, not a skip.'
      );
    }
    if (workerPath !== metricsPath) {
      return `it scrapes "${metricsPath}", but the worker serves metrics on "${workerPath}".`;
    }
    return null;
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * I/O
 * ------------------------------------------------------------------ */

function readYaml(path) {
  try {
    return yaml.load(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Every `- ./x:/y` style mount in a compose document, with its existence. */
function collectBindMounts(file, doc) {
  const mounts = [];
  const base = dirname(file);
  for (const service of Object.values((doc && doc.services) || {})) {
    for (const volume of (service && service.volumes) || []) {
      if (typeof volume !== 'string') continue;
      const source = volume.split(':')[0];
      if (!source.startsWith('./') && !source.startsWith('../')) continue; // named volume
      mounts.push({ source, exists: existsSync(resolve(base, source)) });
    }
  }
  return mounts;
}

function listFiles(dir, extensions) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((name) => extensions.some((ext) => name.endsWith(ext)))
    .map((name) => join(dir, name));
}

/**
 * Metric names the applications actually register, read from the **built**
 * registries rather than from source text. R-26 rule (a): the defect lives in
 * the output, and a regex over source is how run 10's guard nearly passed
 * vacuously.
 *
 * The names are taken from the `# TYPE` lines of the **real exposition**, which
 * is what a scrape would receive — one step more resolved again than asking the
 * registry for its declared metric list, and it costs nothing because the
 * registry has to render anyway.
 *
 * Returns null when the build output is absent. The caller turns that into a
 * failure, never a skip.
 */
async function readExposedMetricNames() {
  const registries = [
    join(REPO_ROOT, 'apps/api/dist/modules/metrics/metrics.registry.js'),
    join(REPO_ROOT, 'apps/worker/dist/shared/observability/metrics.registry.js'),
  ];

  const names = new Set();
  for (const path of registries) {
    if (!existsSync(path)) return null;
    const mod = require(path);
    if (!mod || !mod.registry) return null;
    const exposition = await mod.registry.metrics();
    for (const match of exposition.matchAll(/^# TYPE (\S+) /gm)) names.add(match[1]);
  }
  return [...names];
}

function readWorkerMetricsPath() {
  const path = join(REPO_ROOT, 'apps/worker/dist/shared/release/version-server.js');
  if (!existsSync(path)) return null;
  const mod = require(path);
  return typeof mod.METRICS_PATH === 'string' ? mod.METRICS_PATH : null;
}

async function collectFromRepo() {
  const composePaths = [
    join(REPO_ROOT, 'infra/docker-compose.yml'),
    join(REPO_ROOT, 'infra/docker-compose.prod.yml'),
    join(REPO_ROOT, 'infra/docker-compose.override.yml'),
  ].filter((path) => existsSync(path));

  const composeFiles = composePaths.map((path) => {
    const doc = readYaml(path);
    return {
      file: relative(REPO_ROOT, path).replace(/\\/g, '/'),
      doc,
      bindMounts: collectBindMounts(path, doc),
    };
  });

  const prometheusPath = join(REPO_ROOT, 'infra/grafana/prometheus.yml');
  const prometheus = existsSync(prometheusPath)
    ? { file: 'infra/grafana/prometheus.yml', doc: readYaml(prometheusPath) }
    : null;

  const datasources = listFiles(join(REPO_ROOT, 'infra/grafana/provisioning/datasources'), [
    '.yml',
    '.yaml',
  ]).map((path) => ({
    file: relative(REPO_ROOT, path).replace(/\\/g, '/'),
    doc: readYaml(path),
  }));

  const dashboards = listFiles(join(REPO_ROOT, 'infra/grafana/dashboards'), ['.json']).map(
    (path) => {
      let doc = null;
      try {
        doc = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        doc = null;
      }
      return { file: relative(REPO_ROOT, path).replace(/\\/g, '/'), doc };
    },
  );

  const baselinePath = join(REPO_ROOT, 'scripts/boot-route-baseline.json');
  let bootRoutes = null;
  if (existsSync(baselinePath)) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    bootRoutes = {};
    for (const [app, entry] of Object.entries(baseline.apps || {})) {
      bootRoutes[app] = entry.routes || [];
    }
  }

  const nginxConfs = listFiles(join(REPO_ROOT, 'infra/nginx/conf.d'), ['.conf']).map((path) => ({
    file: relative(REPO_ROOT, path).replace(/\\/g, '/'),
    text: readFileSync(path, 'utf8'),
  }));

  return {
    composeFiles,
    prometheus,
    datasources,
    dashboards,
    bootRoutes,
    workerMetricsPath: readWorkerMetricsPath(),
    exposedMetrics: await readExposedMetricNames(),
    nginxConfs,
  };
}

async function main() {
  const input = await collectFromRepo();

  console.log(`▶ compose files    : ${input.composeFiles.length}`);
  console.log(
    `▶ registered metrics: ${
      input.exposedMetrics === null ? 'BUILD OUTPUT ABSENT' : input.exposedMetrics.length
    }`,
  );

  const { problems, notes } = evaluateObservability(input);

  for (const note of notes) console.log(`  · ${note}`);

  if (problems.length > 0) {
    console.error('');
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error('');
    console.error(`OBSERVABILITY CHECK: FAIL (${problems.length} problem(s))`);
    process.exit(1);
  }

  console.log('');
  console.log('OBSERVABILITY CHECK: PASS');
}

module.exports = {
  evaluateObservability,
  collectFromRepo,
  metricNamesInExpr,
  baseMetricName,
  serviceListenPort,
  splitTarget,
};

if (require.main === module) {
  main().catch((error) => {
    // A crash in the collector must not read as a pass. Exit non-zero, loudly.
    console.error(error);
    console.error('');
    console.error('OBSERVABILITY CHECK: FAIL (the check itself could not run)');
    process.exit(1);
  });
}
