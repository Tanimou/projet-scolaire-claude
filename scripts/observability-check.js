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
 *  8. the web metrics path is **not** a Next route (S-E02-15 / PF-79)
 *       → check 7 is blind to the way this leak would really happen. nginx
 *         `location /` proxies everything unmatched to the web upstream, so an
 *         `app/metrics/route.ts` would be public without one line of nginx
 *         changing. This is the only assertion that would notice
 *  9. the set of INSTRUMENTED queues equals the set of REGISTERED queues, and
 *     the api side and the worker side agree on that set (S-E02-17 / PF-56)
 *       → metrics that exist today and silently miss the fourth queue added
 *         next quarter are worth less than a gate. This is also the assertion
 *         that finally compares the two queue-name constant blocks nobody
 *         compared: `apps/api/src/shared/queue/queue.module.ts` and
 *         `apps/worker/src/shared/queue/queue.module.ts` each carried a comment
 *         pointing at the other and nothing read either one. "Registered" here
 *         means the RESOLVED `BullModule.registerQueue` registration — the
 *         `BullQueue_<name>` provider tokens on the built module's metadata —
 *         not the exported constant, because a constant exported and never
 *         passed to `registerQueue` is not a registered queue
 *
 * SINCE S-E02-15 THERE ARE THREE OBSERVED ARTEFACTS, NOT TWO
 * ----------------------------------------------------------
 * `apps/web` — the artefact users actually touch — was covered by nothing.
 * Measured before that slice: `grep -rniE 'prom-client|opentelemetry|/metrics'
 * apps/web/src` returned zero hits, and this script exited **0** on that exact
 * state. Checks 3, 4, 6 and 8 now reach it too, and its registry is read from
 * `apps/web/src/observability/web-observability.js` — from source, because
 * apps/web has no `dist/`, which is exactly why that module is plain CommonJS.
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

/**
 * Le module d'observabilité de `apps/web` (S-E02-15 / PF-79).
 *
 * Lu depuis la SOURCE et non depuis un `dist/`, contrairement à l'API et au
 * worker : `apps/web` n'a pas de `dist/`. C'est précisément pourquoi ce module
 * est du CommonJS simple — il ship verbatim, donc le lire ici, c'est lire ce
 * qui tourne. Voir l'en-tête du fichier.
 */
const WEB_OBSERVABILITY_MODULE = 'apps/web/src/observability/web-observability.js';

/**
 * The BullMQ instrumentation module (S-E02-17).
 *
 * Read for two things: the `INSTRUMENTED_QUEUES` constant it declares, and the
 * side effect of requiring it — it registers its metric families onto the
 * worker registry, which is how check 6 gets to see their `# TYPE` lines.
 * `metrics.registry.js` deliberately does NOT import it (that would be a cycle),
 * so this module has to be named here rather than arriving transitively.
 *
 * It imports `prom-client` and nothing else, on purpose: this script requires
 * it into its OWN process and then has to exit.
 */
const WORKER_QUEUE_METRICS_MODULE = 'apps/worker/dist/shared/observability/queue-metrics.js';

/**
 * The two modules that register the BullMQ queues, one per application.
 *
 * Neither is edited by S-E02-17 — they are this check's INPUT, not its output,
 * which is what keeps that slice out of PF-80's blast radius.
 */
const QUEUE_MODULES = {
  api: 'apps/api/dist/shared/queue/queue.module.js',
  worker: 'apps/worker/dist/shared/queue/queue.module.js',
};

/**
 * The smallest registered-queue count that is not evidence of a broken read.
 *
 * Three queues exist (`exports`, `notifications-email`, `imports`). A reader
 * that returns fewer has almost certainly failed to resolve the registration
 * rather than found a shrunken system, and an empty extraction would make
 * `instrumented ≡ registered` degenerate into `{} ≡ {}` — a vacuous pass, which
 * is the escape-by-omission this file has had to close at four addresses
 * already. Lower it only alongside a real removal.
 */
const REGISTERED_QUEUE_FLOOR = 3;

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
 * Environment variables that declare a port a service process binds.
 *
 * `WEB_METRICS_PORT` joined the list in S-E02-15: `apps/web` listens on TWO
 * ports — `PORT` for Next itself and a separate internal socket for its
 * Prometheus exposition. That second socket is deliberately not a Next route
 * (`infra/nginx/conf.d/pilotage.conf` `location /` would publish it), so the
 * gate has to know the difference between "a port this service never declares"
 * and "the second port this service declares on purpose".
 */
const LISTEN_PORT_ENV_KEYS = ['PORT', 'WORKER_HTTP_PORT', 'WEB_METRICS_PORT'];

/**
 * EVERY port a compose service listens on *inside* the network.
 *
 * Read from the service's own environment first, because that is what the
 * process binds; the `ports:` mapping is only how the host reaches it, and the
 * two are frequently different.
 *
 * The plural exists because of the trap S-E02-15 walked into: `web` sets
 * `PORT: "3000"`, so the singular resolver below rejected a perfectly correct
 * `web:3001` scrape target with "service web listens on 3000" — and the path of
 * least resistance from there is to retarget `web:3000/metrics`, i.e. to turn
 * the metrics socket into a published Next route. The gate must not push anyone
 * towards the leak it exists to prevent.
 *
 * Returns a de-duplicated list, in declaration order. Empty means the compose
 * file declares nothing — which stays a failure, never a pass.
 */
function serviceListenPorts(service) {
  if (!service || typeof service !== 'object') return [];

  const ports = [];
  const add = (raw) => {
    if (raw === undefined || raw === null) return;
    const parsed = Number.parseInt(String(raw), 10);
    if (Number.isInteger(parsed) && !ports.includes(parsed)) ports.push(parsed);
  };

  const env = service.environment;
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    for (const key of LISTEN_PORT_ENV_KEYS) add(env[key]);
  }

  const published = service.ports;
  if (Array.isArray(published)) {
    for (const mapping of published) {
      if (typeof mapping !== 'string') continue;
      const segments = mapping.split(':');
      add(segments[segments.length - 1]);
    }
  }

  return ports;
}

/**
 * The *first* port a compose service listens on.
 *
 * Kept — and kept exported — because the Grafana datasource check below wants
 * exactly one answer: a datasource url names one port, and "the service listens
 * on several" is not a useful thing to say about it. The scrape-target check
 * uses the plural resolver instead.
 */
function serviceListenPort(service) {
  const ports = serviceListenPorts(service);
  return ports.length > 0 ? ports[0] : null;
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

          const listenPorts = serviceListenPorts(service);
          if (listenPorts.length === 0) {
            problems.push(
              `scrape job "${name}" targets service "${parsed.host}", whose listening port cannot ` +
                'be determined from the compose file (no PORT/WORKER_HTTP_PORT/WEB_METRICS_PORT ' +
                'and no ports mapping).',
            );
          } else if (!listenPorts.includes(parsed.port)) {
            problems.push(
              `scrape job "${name}" targets ${rawTarget}, but service "${parsed.host}" listens on ` +
                `${listenPorts.join(', ')} inside the network.`,
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

  /* -- 8. the web metrics path must not be a Next route ---------------- */

  // Check 7 above reads nginx `location` blocks. It is blind to the way this
  // particular leak would actually happen: `infra/nginx/conf.d/pilotage.conf`
  // `location /` proxies EVERYTHING unmatched to the web upstream, so the day
  // someone "simplifies" the dedicated node:http socket into an
  // `app/metrics/route.ts`, the endpoint becomes public without a single line
  // of nginx changing — and check 7 would keep saying "none publishes a metrics
  // path". This is the only assertion that would notice.
  const webMetricsPath = input.webMetricsPath;
  if (webMetricsPath) {
    const webRoutes = input.webRoutes;
    if (!Array.isArray(webRoutes)) {
      problems.push(
        'the web route inventory (scripts/web-route-baseline.json) could not be read, so it ' +
          'cannot be verified that the metrics path is not a Next route. That is a failure, not ' +
          'a skip: with nothing to compare against, the one check that would notice the leak ' +
          'would pass vacuously.',
      );
    } else if (webRoutes.includes(webMetricsPath)) {
      problems.push(
        `the web route inventory lists "${webMetricsPath}" as a Next route. ` +
          'infra/nginx/conf.d/pilotage.conf `location /` proxies everything unmatched to the web ' +
          'upstream, so a Next route serving metrics is published on the public internet the day ' +
          'it is added — and the nginx rule above would NOT see it, because nothing in nginx ' +
          'changed. The exposition must stay on the separate internal node:http socket ' +
          '(apps/web/src/observability/web-observability.js).',
      );
    } else {
      notes.push(
        `apps/web serves metrics on "${webMetricsPath}", which is not in its Next route inventory`,
      );
    }
  }

  /* -- 9. instrumented queues ≡ registered queues -------------------- */

  evaluateQueueInstrumentation(input, problems, notes);

  return { problems, notes };
}

/** Sorted, de-duplicated, string-only — so set comparisons cannot lie about order. */
function normalizeQueueSet(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((name) => typeof name === 'string' && name.length > 0))].sort();
}

/**
 * Check 9 — the durable half of S-E02-17 (D5).
 *
 * The gauges are the demo; this is the acceptance criterion. Instrumenting the
 * three processors one by one and skipping this check would be green today and
 * silently missing the fourth queue next quarter — which is the sentence the
 * worker registry's own header used to have to write about itself.
 *
 * Six rules, and each of them exists because its absence is a way to pass
 * without checking anything:
 *
 *  1. either input `null` → a failure, never a skip (DNC-08);
 *  2. a registered set below the floor → a failure, because an extraction that
 *     returned nothing would make every rule below vacuous;
 *  3. api ≠ worker → a failure naming the side that lacks the queue. Not a
 *     union: unioning the two sides before comparing is exactly how a queue
 *     registered on ONE side only would keep passing, and producer-without-
 *     consumer is the defect the two comments warn about;
 *  4. registered \ instrumented → invisible on the dashboard while looking healthy;
 *  5. instrumented \ registered → a series permanently at zero, which reads as
 *     an idle queue;
 *  6. the DECLARED instrumented set must equal the one that really RENDERS. A
 *     check that read only an exported constant would reproduce the very defect
 *     it exists to close: a declaration nobody executes.
 */
function evaluateQueueInstrumentation(input, problems, notes) {
  // Local, so an unrelated earlier failure cannot suppress this check's note —
  // and so this check's own note cannot claim a pass it did not produce.
  const problemsBefore = problems.length;
  const instrumented = input.instrumentedQueues;
  const registered = input.registeredQueues;

  if (!instrumented || !instrumented.declared) {
    problems.push(
      'the instrumented queue set could not be read from ' +
        `${WORKER_QUEUE_METRICS_MODULE}. That is a failure, not a skip: with nothing to ` +
        'compare against, a queue nobody instruments would pass unnoticed.',
    );
    return;
  }
  if (!registered) {
    problems.push(
      'the registered queue set could not be read from the built queue modules ' +
        `(${QUEUE_MODULES.api}, ${QUEUE_MODULES.worker}). That is a failure, not a skip.`,
    );
    return;
  }

  const declared = normalizeQueueSet(instrumented.declared);
  const rendered = normalizeQueueSet(instrumented.rendered);
  const apiSet = normalizeQueueSet(registered.api);
  const workerSet = normalizeQueueSet(registered.worker);

  if (!declared || !apiSet || !workerSet) {
    problems.push(
      'the instrumented or registered queue set is not a list of names. That is a failure, ' +
        'not a skip.',
    );
    return;
  }

  for (const [side, names] of [
    ['apps/api', apiSet],
    ['apps/worker', workerSet],
  ]) {
    if (names.length < REGISTERED_QUEUE_FLOOR) {
      problems.push(
        `${side} registers only ${names.length} queue(s) (${names.join(', ') || 'none'}), below the ` +
          `floor of ${REGISTERED_QUEUE_FLOOR}. A truncated or empty extraction must fail rather ` +
          'than pass vacuously: with an empty set, "instrumented ≡ registered" is {} ≡ {}.',
      );
      return;
    }
  }

  // 3. The two constant blocks nobody compared.
  const onlyApi = apiSet.filter((name) => !workerSet.includes(name));
  const onlyWorker = workerSet.filter((name) => !apiSet.includes(name));
  if (onlyApi.length > 0 || onlyWorker.length > 0) {
    for (const name of onlyApi) {
      problems.push(
        `queue "${name}" is registered by ${QUEUE_MODULES.api} but NOT by ` +
          `${QUEUE_MODULES.worker}: apps/worker lacks it, so the API produces jobs nothing ` +
          'consumes. The two blocks are declared independently and each carries a comment ' +
          'pointing at the other; this is the assertion that reads them.',
      );
    }
    for (const name of onlyWorker) {
      problems.push(
        `queue "${name}" is registered by ${QUEUE_MODULES.worker} but NOT by ` +
          `${QUEUE_MODULES.api}: apps/api lacks it, so the worker waits on a queue nothing ` +
          'produces.',
      );
    }
    return;
  }

  const registeredSet = apiSet;

  for (const name of registeredSet.filter((queue) => !declared.includes(queue))) {
    problems.push(
      `queue "${name}" is registered by both applications but instrumented by nothing. It ` +
        'publishes no depth, no outcome and no duration, so it is invisible on the dashboard ' +
        `while the dashboard looks healthy. Add it to INSTRUMENTED_QUEUES in ` +
        `${WORKER_QUEUE_METRICS_MODULE.replace('/dist/', '/src/').replace(/\.js$/, '.ts')}.`,
    );
  }

  for (const name of declared.filter((queue) => !registeredSet.includes(queue))) {
    problems.push(
      `queue "${name}" is instrumented but registered by neither queue module. Its series are ` +
        'permanently zero, which on a dashboard is indistinguishable from an idle queue.',
    );
  }

  // 6. Declared must equal rendered — a constant nobody executes is the defect.
  //
  // An EMPTY rendered set is the realistic shape of that failure, not `null`:
  // the constant would still be exported and still be read, and only the series
  // would be missing. It is therefore the same failure, not a softer one.
  if (rendered === null || rendered.length === 0) {
    problems.push(
      'the worker registry rendered no queue-labelled series, so INSTRUMENTED_QUEUES could not ' +
        'be confirmed against the real exposition. That is a failure, not a skip: a constant ' +
        'that nothing executes is the defect this check exists to close.',
    );
  } else {
    const missing = declared.filter((name) => !rendered.includes(name));
    const extra = rendered.filter((name) => !declared.includes(name));
    if (missing.length > 0 || extra.length > 0) {
      problems.push(
        `INSTRUMENTED_QUEUES declares [${declared.join(', ')}] but the rendered worker ` +
          `exposition carries queue labels [${rendered.join(', ')}]. The declaration and what ` +
          'the process really publishes must be the same set.',
      );
    }
  }

  if (problems.length === problemsBefore) {
    notes.push(
      `instrumented queues ≡ registered queues (${registeredSet.join(', ')}), agreed on by ` +
        `${QUEUE_MODULES.api} and ${QUEUE_MODULES.worker}, and confirmed against the rendered ` +
        'worker exposition',
    );
  }
}

/**
 * The scraped path must be a route the target application actually serves.
 *
 * For the API the comparison is against the booted route table
 * (`scripts/boot-route-baseline.json`) — not controller source — so that a
 * controller silently unmounted (PF-62's exact defect) breaks the scrape config
 * here as well. For the worker and for apps/web the comparison is against the
 * constant each one's module exports.
 *
 * **The default is a problem, not `null`.** Until S-E02-15 an unknown host
 * returned `null` — i.e. *pass* — so adding a `pilotage-web` job would have
 * satisfied this check vacuously. That is escape-by-omission, the same defect
 * S-E02-9, -11 and -12 each had to close at their own address. A host this gate
 * knows no artefact for must fail loudly and be given a branch.
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

  if (host === 'web') {
    const webPath = input.webMetricsPath;
    if (!webPath) {
      return (
        'the web metrics path could not be read from ' +
        'apps/web/src/observability/web-observability.js, so the scraped path cannot be verified. ' +
        'That is a failure, not a skip.'
      );
    }
    if (webPath !== metricsPath) {
      return `it scrapes "${metricsPath}", but apps/web serves metrics on "${webPath}".`;
    }
    return null;
  }

  return (
    `this gate knows no artefact for host "${host}", so the path it scrapes cannot be verified. ` +
    'Add a branch to scrapePathProblem rather than letting an unknown target pass by omission — ' +
    'a scrape job nothing validates is exactly how a metrics endpoint ends up unchecked.'
  );
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
    { registry: 'apps/api/dist/modules/metrics/metrics.registry.js', sideEffects: [] },
    {
      registry: 'apps/worker/dist/shared/observability/metrics.registry.js',
      // S-E02-17. The BullMQ metric families register THEMSELVES onto the
      // worker registry from a separate module, and `metrics.registry.js`
      // deliberately does not import it back (that would be an import cycle).
      // So the module has to be required here for its registration side effect,
      // or the `# TYPE` lines for `pilotage_queue_*` would be absent and check 6
      // would call four correct dashboard panels broken.
      //
      // Requiring it is safe by construction and that is not an assumption: the
      // module imports `prom-client` and nothing else, opens no connection, and
      // its depth collector is a no-op until Nest binds queues to it — which
      // never happens in this process. Measured on prom-client 15.1.3: a metric
      // with zero samples still emits its `# HELP`/`# TYPE` lines.
      sideEffects: [WORKER_QUEUE_METRICS_MODULE],
    },
    // apps/web is read from SOURCE, and that is not an inconsistency to fix
    // later — it is the whole reason the module is plain CommonJS. apps/web has
    // no `dist/`: its only compiler is a nine-minute `next build`, so a
    // TypeScript registry here would be readable by nothing but that build.
    // The plain module that ships verbatim is the most resolved artefact that
    // exists. `tracing-check.js` covers the other half by asserting the EMITTED
    // instrumentation bundle carries these same metric names.
    { registry: WEB_OBSERVABILITY_MODULE, sideEffects: [] },
  ];

  const names = new Set();
  for (const entry of registries) {
    for (const relative of entry.sideEffects) {
      const sidePath = join(REPO_ROOT, relative);
      if (!existsSync(sidePath)) return null;
      require(sidePath);
    }
    const path = join(REPO_ROOT, entry.registry);
    if (!existsSync(path)) return null;
    const mod = require(path);
    if (!mod || !mod.registry) return null;
    const exposition = await mod.registry.metrics();
    for (const match of exposition.matchAll(/^# TYPE (\S+) /gm)) names.add(match[1]);
  }
  return [...names];
}

/**
 * The queues the worker really instruments (S-E02-17 / D5, AC-5).
 *
 * Returns BOTH halves, because either one alone is a weaker claim than it
 * looks:
 *   • `declared` — the exported `INSTRUMENTED_QUEUES` constant;
 *   • `rendered` — the `queue="…"` label values that actually appear in the
 *     worker's rendered exposition, with no Redis reachable.
 *
 * A check that read only the constant would reproduce the defect it exists to
 * close — a declaration nobody executes. The rendered half is possible because
 * `pilotage_queue_depth_collection_failures_total` is zero-initialised for
 * every instrumented queue at import, so it carries the labels honestly with an
 * unreachable Redis.
 *
 * Returns null on any failure. The caller turns that into a failure, never a
 * skip.
 */
async function readInstrumentedQueues() {
  const modulePath = join(REPO_ROOT, WORKER_QUEUE_METRICS_MODULE);
  const registryPath = join(REPO_ROOT, 'apps/worker/dist/shared/observability/metrics.registry.js');
  if (!existsSync(modulePath) || !existsSync(registryPath)) return null;

  const mod = require(modulePath);
  const declared = Array.isArray(mod && mod.INSTRUMENTED_QUEUES)
    ? [...mod.INSTRUMENTED_QUEUES]
    : null;
  if (!declared) return null;

  const registryModule = require(registryPath);
  if (!registryModule || !registryModule.registry) return null;
  const exposition = await registryModule.registry.metrics();

  const rendered = new Set();
  for (const match of exposition.matchAll(/^pilotage_queue_[a-z_]*\{[^}]*queue="([^"]*)"/gm)) {
    rendered.add(match[1]);
  }

  return { declared, rendered: [...rendered] };
}

/**
 * The queues each application really REGISTERS (S-E02-17 / D5, AC-5).
 *
 * Read as the **resolved** registration, not as the exported constant: a
 * constant exported and never passed to `BullModule.registerQueue` is not a
 * registered queue, and a regex over source would find nothing at all here —
 * the registration site is `registerQueue({ name: QUEUE_EXPORTS })`, an
 * indirection through a constant. `BullModule.registerQueue` evaluates at module
 * load and yields provider tokens of the form `BullQueue_<name>`; those tokens
 * on the module's own `imports` metadata ARE the resolved value (R-26 rule (a)).
 *
 * Measured before being relied on: requiring a built queue module with
 * `reflect-metadata` loaded opens **no** Redis connection and leaves **no** open
 * handle — `forRoot`/`registerQueue` build metadata, and the connection is made
 * by Nest DI at bootstrap, which does not happen here. That matters because
 * this script must exit; an open handle would make stage 9 print PASS and hang.
 *
 * Reading the modules' resolved metadata is also what keeps S-E02-17 out of
 * PF-80's blast radius: neither `queue.module.ts` has to be edited to be read.
 *
 * Returns null on any failure — a failure, never a skip.
 */
function readRegisteredQueues() {
  const req = (spec) => require(require.resolve(spec, { paths: [join(REPO_ROOT, 'apps/api')] }));
  try {
    req('reflect-metadata');
  } catch {
    return null;
  }

  const result = {};
  for (const [side, relative] of Object.entries(QUEUE_MODULES)) {
    const path = join(REPO_ROOT, relative);
    if (!existsSync(path)) return null;

    let mod;
    try {
      mod = require(path);
    } catch {
      return null;
    }
    if (!mod || typeof mod.QueueModule !== 'function') return null;

    const imported = Reflect.getMetadata('imports', mod.QueueModule);
    if (!Array.isArray(imported)) return null;

    const names = new Set();
    for (const entry of imported) {
      if (!entry || typeof entry !== 'object' || !Array.isArray(entry.providers)) continue;
      for (const provider of entry.providers) {
        const token = provider && provider.provide;
        if (typeof token !== 'string') continue;
        const match = /^BullQueue_(.+)$/.exec(token);
        if (match) names.add(match[1]);
      }
    }
    result[side] = [...names];
  }
  return result;
}

function readWorkerMetricsPath() {
  const path = join(REPO_ROOT, 'apps/worker/dist/shared/release/version-server.js');
  if (!existsSync(path)) return null;
  const mod = require(path);
  return typeof mod.METRICS_PATH === 'string' ? mod.METRICS_PATH : null;
}

/** Le chemin réellement servi par le socket dédié de `apps/web`. */
function readWebMetricsPath() {
  const path = join(REPO_ROOT, WEB_OBSERVABILITY_MODULE);
  if (!existsSync(path)) return null;
  const mod = require(path);
  return typeof mod.WEB_METRICS_PATH === 'string' ? mod.WEB_METRICS_PATH : null;
}

/**
 * L'inventaire des routes Next, lu du **build émis** par
 * `scripts/web-artifact-check.js` et figé dans son baseline. Sert à une seule
 * assertion : le chemin des métriques ne doit pas y figurer (voir le contrôle 8).
 */
function readWebRoutes() {
  const path = join(REPO_ROOT, 'scripts/web-route-baseline.json');
  if (!existsSync(path)) return null;
  try {
    const baseline = JSON.parse(readFileSync(path, 'utf8'));
    const entry = (baseline.apps || {})['apps/web'];
    return Array.isArray(entry && entry.routes) ? entry.routes : null;
  } catch {
    return null;
  }
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
    webMetricsPath: readWebMetricsPath(),
    webRoutes: readWebRoutes(),
    exposedMetrics: await readExposedMetricNames(),
    instrumentedQueues: await readInstrumentedQueues(),
    registeredQueues: readRegisteredQueues(),
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

  console.log(
    `▶ queues            : ${
      input.registeredQueues === null
        ? 'REGISTRATION UNREADABLE'
        : `${(input.registeredQueues.worker || []).length} registered`
    } / ${
      input.instrumentedQueues === null
        ? 'INSTRUMENTATION UNREADABLE'
        : `${(input.instrumentedQueues.declared || []).length} instrumented`
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
  serviceListenPorts,
  splitTarget,
  WEB_OBSERVABILITY_MODULE,
  WORKER_QUEUE_METRICS_MODULE,
  QUEUE_MODULES,
  REGISTERED_QUEUE_FLOOR,
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
