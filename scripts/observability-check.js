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
 * 10. no dashboard expression aggregates a GAUGE-typed metric family with
 *     `sum(...)` (S-E02-18 / PF-108)
 *       → a gauge of a shared resource is not additive across replicas. Queue
 *         depth is a property of the QUEUE, not of the process: every worker
 *         replica reports the same absolute number, so `--scale worker=2`
 *         doubles every line on the panel while the queue itself is unchanged.
 *         A counter `rate()` IS additive, which is exactly why the panels beside
 *         it are correct as written. The rule is stated over the metric's
 *         DECLARED TYPE — read from the same `# TYPE` lines check 6 uses — so it
 *         catches the class and not only the one line that was wrong
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
 * The two OTHER built artefacts the queue readers open (S-E02-19 / PF-115 (a)).
 *
 * Named here rather than inlined at the `join()` site, because the failure
 * message has to be able to say which file it actually read. It used to say
 * `queue-metrics.js` for every cause — including the two causes whose unreadable
 * file is one of these — so an operator followed the message into the wrong file
 * at the exact moment a blocking stage had failed.
 */
const WORKER_METRICS_REGISTRY_MODULE = 'apps/worker/dist/shared/observability/metrics.registry.js';
const WORKER_QUEUE_DEPTH_COLLECTOR_MODULE =
  'apps/worker/dist/shared/observability/queue-depth.collector.js';

/**
 * The root `reflect-metadata` is resolved from. Named for the same reason: a
 * resolution failure has to say WHERE the resolution was attempted.
 */
const REFLECT_METADATA_RESOLUTION_ROOT = 'apps/api';

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

/**
 * The direct arguments of every `sum(...)` aggregation in a PromQL expression
 * (S-E02-18 / PF-108).
 *
 * Returns `{ args, unbalanced }`. `args` are the expression texts INSIDE each
 * `sum`, `sum by (...)` or `sum without (...)`; `unbalanced` is true when a
 * `sum` token could not be scanned to a matching close paren.
 *
 * Three things it deliberately does:
 *
 *  - it matches `sum` as a whole token, so `sum_over_time(...)`,
 *    `..._sum` and a label literally called `sum` are not aggregations;
 *  - it returns only the DIRECT argument, so `histogram_quantile(0.95, sum by
 *    (le) (rate(x_bucket[5m])))` yields `rate(x_bucket[5m])` — the `sum` is
 *    inside `histogram_quantile`, but what matters is what the `sum` itself
 *    reads;
 *  - it reports failure to scan rather than returning nothing. An expression
 *    this reader cannot parse must become a PROBLEM, never an accepted
 *    expression (DNC-08): a silently-skipped expression is how a blocking stage
 *    turns into a vacuous pass.
 *
 * S-E02-19 / PF-114 (c): the scan runs over a QUOTE-MASKED copy of the
 * expression, so a `sum` living inside a label value — `x_total{job="sum"}`,
 * `label_replace(x, "sum", …)` — is not read as an aggregation. It used to be,
 * and it then failed to find an argument and returned `unbalanced: true`, i.e. a
 * hard PROBLEM on a correct tree. The sibling `metricNamesInExpr` already blanks
 * quoted spans; this is the same discipline, applied consistently. The mask is
 * SAME-LENGTH, so every index below still addresses the original text and the
 * returned argument is the real one, quotes included.
 */
function sumAggregationArguments(expr) {
  if (typeof expr !== 'string') return { args: [], unbalanced: false };

  const { masked: scan, unterminated } = scanQuotedSpans(expr);
  const args = [];
  // S-E02-19 / PF-117: an expression that ends inside a quote has had its tail
  // blanked by the mask, so every `sum` in that tail is invisible to the scan
  // below. Reporting it as unbalanced is the only honest answer — returning the
  // tokens we happened to see before the quote would be a silent partial read.
  let unbalanced = unterminated;
  const token = /(^|[^a-zA-Z0-9_:])sum(?![a-zA-Z0-9_:])/g;
  let match;

  while ((match = token.exec(scan)) !== null) {
    let at = match.index + match[0].length;

    const skipSpace = () => {
      while (at < scan.length && /\s/.test(scan[at])) at += 1;
    };

    skipSpace();
    // Optional `by (...)` / `without (...)` modifier between `sum` and its
    // argument. Its own parentheses are consumed here so the balanced scan
    // below starts on the argument, not on the label list.
    const modifier = /^(?:by|without)\b/.exec(scan.slice(at));
    if (modifier) {
      at += modifier[0].length;
      skipSpace();
      if (scan[at] !== '(') {
        unbalanced = true;
        continue;
      }
      const closed = matchingParen(scan, at);
      if (closed === -1) {
        unbalanced = true;
        continue;
      }
      at = closed + 1;
      skipSpace();
    }

    if (scan[at] !== '(') {
      unbalanced = true;
      continue;
    }
    const closed = matchingParen(scan, at);
    if (closed === -1) {
      unbalanced = true;
      continue;
    }
    args.push(expr.slice(at + 1, closed));
  }

  return { args, unbalanced };
}

/**
 * A SAME-LENGTH copy of `expr` in which the CONTENT of every quoted span is
 * blanked, the delimiters kept (S-E02-19 / PF-114 (c)).
 *
 * Same length is the whole point, and the reason this is not
 * `metricNamesInExpr`'s `.replace(/"[^"]*"/g, ' ')`: every caller here slices the
 * ORIGINAL expression by an index found in the masked one. A mask that shortened
 * the text would return an argument that is off by however many characters the
 * label values happened to contain — a silent corruption inside a blocking
 * stage, which is worse than the false red it was written to remove.
 */
function maskQuotedSpans(expr) {
  return scanQuotedSpans(expr).masked;
}

/**
 * The one scanner both the mask and its callers read (S-E02-19 / PF-117).
 *
 * Returns `{ masked, unterminated }`. `unterminated` is true when the expression
 * ends inside a quoted span.
 *
 * WHY THIS IS SEPARATE FROM `maskQuotedSpans`. The mask blanks everything after
 * an opening quote that never closes, so an unterminated quote DELETES the rest
 * of the expression from every scan that reads the masked text — including the
 * `sum` tokens in it. `sumAggregationArguments('foo{a="b} + sum by (queue)
 * (pilotage_queue_depth)')` therefore returned `{ args: [], unbalanced: false }`:
 * a silent accept, in a blocking stage, on the exact expression the stage exists
 * to reject. That is the fail-OPEN direction, which is strictly worse than the
 * false red PF-114 removed — a gate that reds on correct work is annoying, a gate
 * that greens on broken work is believed.
 *
 * It is a separate function rather than a changed return type so
 * `maskQuotedSpans` keeps the string contract its tests pin, while both it and
 * the failure signal come from ONE scan and cannot drift apart.
 *
 * DNC-08: callers must route `unterminated` into their PROBLEM path. An
 * expression this reader cannot tokenise is a failure, never an accepted
 * expression.
 */
function scanQuotedSpans(expr) {
  let out = '';
  let quote = null;
  for (let i = 0; i < expr.length; i += 1) {
    const char = expr[i];
    if (quote === null) {
      if (char === '"' || char === "'" || char === '`') quote = char;
      out += char;
      continue;
    }
    if (char === '\\' && i + 1 < expr.length) {
      out += '  ';
      i += 1;
      continue;
    }
    if (char === quote) {
      quote = null;
      out += char;
      continue;
    }
    out += ' ';
  }
  return { masked: out, unterminated: quote !== null };
}

/**
 * Label names that identify the PROCESS rather than the resource
 * (S-E02-19 / PF-114).
 *
 * Named, exported and stated once, rather than inlined into the shield test: it
 * is the list that decides whether an inner aggregation removed the replica
 * dimension, so a reviewer has to be able to read it without reading the walk.
 * Deliberately generous — `job` is a Prometheus scrape-job name, shared by the
 * replicas of one service rather than unique to one; keeping it here makes the
 * shield test REFUSE to shield on a grouping that retains it, which is the
 * fail-closed direction.
 */
const REPLICA_LABELS = new Set([
  'instance',
  'pod',
  'job',
  'replica',
  'container',
  'kubernetes_pod_name',
  'host',
]);

/**
 * The PromQL operators that aggregate ACROSS SERIES, and can therefore collapse
 * a replica dimension (S-E02-19 / PF-114).
 *
 * Everything absent from this set shields NOTHING — in particular every
 * `*_over_time` range function, which aggregates one series' samples in TIME and
 * leaves the number of series untouched. `max_over_time` is the trap: a shield
 * keyed on the string `max` would accept
 * `sum by (queue) (max_over_time(pilotage_queue_depth[5m]))`, which still
 * double-counts every replica. The token scan below matches whole identifiers,
 * so `max_over_time` never matches `max` in the first place — this set is the
 * second, explicit line of defence.
 */
const ACROSS_SERIES_AGGREGATIONS = [
  'count_values',
  'bottomk',
  'stddev',
  'stdvar',
  'quantile',
  'group',
  'count',
  'topk',
  'avg',
  'min',
  'max',
  'sum',
];

/**
 * The subset of `ACROSS_SERIES_AGGREGATIONS` that actually COLLAPSES a replica
 * dimension, i.e. that is idempotent over N replicas publishing the same value
 * (S-E02-19 / PF-116).
 *
 * PARSING AND SHIELDING ARE DIFFERENT QUESTIONS, and conflating them is how this
 * slice's first implementation opened five holes in its own gate. Every operator
 * in `ACROSS_SERIES_AGGREGATIONS` must still be PARSED and CONSUMED, or the walk
 * mis-reads the nesting and the residual scan sees text it should not. Only the
 * operators here may SHIELD what is inside them.
 *
 * Idempotent over identical replicas → may shield:
 *  - `max`, `min`, `avg` — N copies of v give v;
 *  - `group` — always 1 per group;
 *  - `quantile` — any quantile of N copies of v is v.
 *
 * NOT idempotent → must never shield, each for its own reason:
 *  - `sum`   — adds the replicas. It is the very defect (PF-108);
 *  - `count` / `count_values` — return N, so the outer sum counts processes;
 *  - `stddev` / `stdvar` — return 0 across identical replicas, which is not the
 *    resource's value at all;
 *  - `topk` / `bottomk` — SELECTORS, not reducers. They return k of the ORIGINAL
 *    series with every original label intact, `instance` included. `topk(3, x)`
 *    over two replicas still carries both, so summing it still double-counts.
 *    This is the trap that makes the rule "is it an aggregation?" wrong and the
 *    rule "is it idempotent over replicas?" right.
 *
 * Fail-closed by construction: an operator absent from this set shields nothing,
 * so a PromQL operator added to the language later is treated as unsafe until
 * someone deliberately proves otherwise.
 */
const REPLICA_IDEMPOTENT_AGGREGATIONS = new Set(['max', 'min', 'avg', 'group', 'quantile']);

/** `sum`, `max by (...)`, … as a whole token. Longest name first — leftmost-first alternation. */
const AGGREGATION_TOKEN_SOURCE = `(^|[^a-zA-Z0-9_:])(${ACROSS_SERIES_AGGREGATIONS.join('|')})(?![a-zA-Z0-9_:])`;

/**
 * Does an aggregation with this grouping modifier remove every replica label?
 *
 * Stated over the MODIFIER, never over the operator name or the metric name:
 * what makes the outer `sum` correct is that the inner aggregation emits one
 * series per resource, and the modifier is the only thing that says so.
 *
 *  - no modifier at all → the aggregation collapses to a single series, so there
 *    is no label left to duplicate → shielded;
 *  - `by (...)`      → shielded IFF the kept list names NO replica label;
 *  - `without (...)` → shielded IFF the removed list names AT LEAST ONE. A
 *    `without` that does not name one keeps everything it did not remove,
 *    `instance` included.
 */
function groupingRemovesReplicas(kind, labelList) {
  if (kind === null) return true;
  const labels = String(labelList)
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  if (kind === 'by') return labels.every((label) => !REPLICA_LABELS.has(label));
  if (kind === 'without') return labels.some((label) => REPLICA_LABELS.has(label));
  return false;
}

/**
 * The gauge-typed families a `sum` argument reads that are NOT already shielded
 * by an enclosing across-series aggregation (S-E02-19 / PF-114).
 *
 * WHY THIS EXISTS. Check 10 used to call `metricNamesInExpr` on the `sum`
 * argument and flag every gauge in it, one level, no structure. That flags
 * `sum by (queue) (max by (queue, state) (pilotage_queue_depth))` — which is
 * correct PromQL, and is the exact idiom check 10's own error message
 * recommends. `max by (queue, state)` already emits ONE series per
 * (queue, state); the replica dimension is gone before the `sum` runs, and
 * summing the remaining states is ordinary arithmetic. A gate that reds on the
 * correction it recommends teaches people to skip it — the same injury as a gate
 * that cannot go red, which is the defect S-E02-18 spent a slice closing.
 *
 * WHAT IT IS NOT. It is not a special case for `pilotage_queue_depth`: the walk
 * never looks at a metric name, only at `types[family] === 'gauge'` and at the
 * grouping modifiers between that reference and the top of the argument. The
 * rule stays stated over the declared `# TYPE`, so it still catches the class.
 *
 * DNC-08. Anything the walk cannot scan to a matching parenthesis sets
 * `unscannable`, and the caller turns that into a PROBLEM. There is no
 * "cannot tell, assume safe" branch, because that branch is how a blocking stage
 * becomes a vacuous pass.
 *
 * Returns `{ families: string[], unscannable: boolean }`.
 */
function unshieldedGaugeReferences(argument, types) {
  const families = new Set();
  let unscannable = false;
  const lookup = types && typeof types === 'object' && !Array.isArray(types) ? types : {};

  /**
   * @param text     the expression at this nesting level, ORIGINAL characters
   * @param shielded true when some enclosing aggregation already removed the
   *                 replica dimension for everything inside `text`
   */
  const walk = (text, shielded) => {
    if (typeof text !== 'string' || text.length === 0) return;

    const { masked: scan, unterminated } = scanQuotedSpans(text);
    // S-E02-19 / PF-117: same reasoning as `sumAggregationArguments`. The tail is
    // blanked, so neither the aggregation tokens nor the metric references in it
    // can be seen. DNC-08 — say so, do not shrug.
    if (unterminated) unscannable = true;
    const consumed = [];
    const token = new RegExp(AGGREGATION_TOKEN_SOURCE, 'g');
    let match;

    while ((match = token.exec(scan)) !== null) {
      const start = match.index + match[1].length;
      // Tokens inside an aggregation already consumed at this level belong to
      // the recursion, not to this one.
      if (consumed.some(([from, to]) => start >= from && start < to)) continue;

      let at = start + match[2].length;
      const skipSpace = () => {
        while (at < scan.length && /\s/.test(scan[at])) at += 1;
      };

      let kind = null;
      let labelList = '';
      skipSpace();

      const leading = /^(by|without)\s*\(/.exec(scan.slice(at));
      if (leading) {
        const open = at + leading[0].length - 1;
        const closed = matchingParen(scan, open);
        if (closed === -1) {
          unscannable = true;
          continue;
        }
        kind = leading[1];
        labelList = scan.slice(open + 1, closed);
        at = closed + 1;
        skipSpace();
      }

      if (scan[at] !== '(') {
        // An aggregation operator with no argument is not something this reader
        // can reason about. DNC-08: say so, do not shrug.
        unscannable = true;
        continue;
      }
      const argOpen = at;
      const argClose = matchingParen(scan, argOpen);
      if (argClose === -1) {
        unscannable = true;
        continue;
      }
      let end = argClose + 1;

      if (leading === null) {
        // PromQL also allows the modifier AFTER the argument: `sum(x) by (q)`.
        let after = end;
        while (after < scan.length && /\s/.test(scan[after])) after += 1;
        const trailing = /^(by|without)\s*\(/.exec(scan.slice(after));
        if (trailing) {
          const open = after + trailing[0].length - 1;
          const closed = matchingParen(scan, open);
          if (closed === -1) {
            unscannable = true;
            continue;
          }
          kind = trailing[1];
          labelList = scan.slice(open + 1, closed);
          end = closed + 1;
        }
      }

      consumed.push([start, end]);
      // S-E02-19 / PF-116: consuming an operator is not the same as trusting it.
      // Only a replica-IDEMPOTENT operator may shield; every other one is parsed
      // (so the nesting is read correctly) and then shields nothing.
      const collapses =
        REPLICA_IDEMPOTENT_AGGREGATIONS.has(match[2]) && groupingRemovesReplicas(kind, labelList);
      walk(text.slice(argOpen + 1, argClose), shielded || collapses);
    }

    if (shielded) return;

    // What is left once every nested aggregation has been handed to the
    // recursion: metric references at THIS shield level.
    let residual = scan;
    for (const [from, to] of consumed) {
      residual = residual.slice(0, from) + ' '.repeat(to - from) + residual.slice(to);
    }
    for (const referenced of metricNamesInExpr(residual)) {
      const family = baseMetricName(referenced);
      if (lookup[family] === 'gauge') families.add(family);
    }
  };

  walk(argument, false);
  return { families: [...families], unscannable };
}

/** Index of the `)` matching the `(` at `open`, or -1. Quotes are respected. */
function matchingParen(expr, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < expr.length; i += 1) {
    const char = expr[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
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

  /* -- 10. no gauge is aggregated with sum() ------------------------- */

  evaluateGaugeAggregation(input, problems, notes);

  return { problems, notes };
}

/**
 * Check 10 — a GAUGE aggregated with `sum()` across replicas (S-E02-18 / PF-108).
 *
 * The defect that motivated it: `infra/grafana/dashboards/pilotage-slo.json`
 * plotted `sum by (queue, state) (pilotage_queue_depth)`. Depth is a property of
 * the QUEUE, not of the process — every worker replica publishes the same
 * absolute number — so `docker compose up --scale worker=2` doubles every line
 * while nothing about the queue changed. The panel would then be read as a
 * backlog twice its real size, which is the exact class of read-projection lie
 * this epic keeps finding.
 *
 * Why the rule is stated over the DECLARED TYPE rather than over that one line:
 * a rule that named `pilotage_queue_depth` would be a fix wearing a gate's
 * clothes. `# TYPE <name> gauge` is what makes the arithmetic wrong, and it is
 * already read (check 6 reads the same lines for the names).
 *
 * What it must NOT flag, each one present in the real dashboard today:
 *  - `max by (queue, state) (pilotage_queue_depth)` — the correction itself;
 *  - `sum by (queue) (rate(pilotage_queue_depth_collection_failures_total[5m]))`
 *    — a COUNTER whose name is a prefix-superset of the gauge's, which is why
 *    the resolution goes through `metricNamesInExpr` + exact type lookup and
 *    never through `startsWith`;
 *  - `histogram_quantile(0.95, sum by (le, …) (rate(x_bucket[5m])))` — a
 *    histogram, resolved through `baseMetricName`;
 *  - a bare gauge with no aggregation at all (`nodejs_eventloop_lag_p99_seconds`).
 *
 * And, since S-E02-19 / PF-114, the idiom this check's own message recommends:
 *  - `sum by (queue) (max by (queue, state) (pilotage_queue_depth))` — the inner
 *    `max by` already emits one series per (queue, state), so the replica
 *    dimension is gone before the `sum` runs. See `unshieldedGaugeReferences`
 *    for the walk, and for the two shapes that must still be flagged: a `by`
 *    list that RETAINS a replica label, and `max_over_time`, which aggregates in
 *    time and removes no series at all.
 *
 * DNC-08: a missing, empty or non-object type map is a FAILURE. With no types
 * to look up, every expression below would be accepted — a blocking stage that
 * passes vacuously is worse than no stage, because it is believed. The shield
 * walk inherits the same posture: an argument it cannot scan is a PROBLEM.
 */
function evaluateGaugeAggregation(input, problems, notes) {
  const problemsBefore = problems.length;
  const types = input.exposedMetricTypes;

  if (!types || typeof types !== 'object' || Array.isArray(types) || Object.keys(types).length === 0) {
    problems.push(
      'the declared TYPE of each registered metric could not be read from the build output. ' +
        'That is a failure, not a skip: with no types to look up, a gauge summed across replicas ' +
        'would be accepted silently.',
    );
    return;
  }

  const dashboards = Array.isArray(input.dashboards) ? input.dashboards : [];
  let checked = 0;

  for (const dashboard of dashboards) {
    for (const panel of (dashboard.doc && dashboard.doc.panels) || []) {
      for (const target of (panel && panel.targets) || []) {
        const expr = target && target.expr;
        if (typeof expr !== 'string' || expr.length === 0) continue;

        const { args, unbalanced } = sumAggregationArguments(expr);
        if (unbalanced) {
          problems.push(
            `${dashboard.file}: panel "${panel.title}" has a sum() this check cannot scan to a ` +
              `matching parenthesis ("${expr}"). An expression the rule cannot read is a ` +
              'failure, not an accepted expression.',
          );
          continue;
        }

        for (const argument of args) {
          checked += 1;
          // S-E02-19 / PF-114: a gauge reference already collapsed by an inner
          // across-series aggregation is NOT double-counted by this sum, so it
          // is not a problem — but anything the walk cannot read still is.
          const { families, unscannable } = unshieldedGaugeReferences(argument, types);
          if (unscannable) {
            problems.push(
              `${dashboard.file}: panel "${panel.title}" contains an aggregation this check ` +
                `cannot scan to a matching parenthesis ("${expr}"). An expression the rule ` +
                'cannot read is a failure, not an accepted expression.',
            );
            continue;
          }
          for (const family of families) {
            problems.push(
              `${dashboard.file}: panel "${panel.title}" aggregates the GAUGE "${family}" with ` +
                'sum(). A gauge of a shared resource is not additive across process replicas: ' +
                'every replica publishes the same absolute number, so running two workers ' +
                'doubles every line while the resource is unchanged. Use max by (...) — a ' +
                'counter rate() beside it stays sum(), because a rate IS additive.',
            );
          }
        }
      }
    }
  }

  if (problems.length === problemsBefore) {
    notes.push(
      `${checked} sum() aggregation(s) on the dashboards read no gauge-typed metric family`,
    );
  }
}

/**
 * Why the instrumented queue set could not be read, per cause (S-E02-19 / AC-8).
 *
 * One sentence per `return { ok: false, reason }` site of the two readers. Not a
 * cosmetic improvement: the single message this replaced named
 * `queue-metrics.js` for ALL of them — including the five causes whose
 * unreadable file is `queue-depth.collector.js` and the three whose file is
 * `metrics.registry.js` — so an operator opened the wrong file at the exact
 * moment a blocking stage had failed.
 */
const QUEUE_READER_REASONS = {
  'queue-metrics-module-absent': 'the built queue-instrumentation module is absent',
  'metrics-registry-absent': 'the built worker metrics registry is absent',
  'instrumented-queues-not-an-array': 'INSTRUMENTED_QUEUES is absent or is not an array',
  'queue-metrics-api-missing':
    'the module exports no usable registerQueueDepthSources / observeJobCompleted / ' +
    'JOB_NAMES_BY_QUEUE, so the write path cannot be driven',
  'registry-export-missing': 'the registry module exports no `registry`',
  'driven-write-path-threw': 'driving the real write path threw',
  'registry-not-restored':
    'the driven write path was NOT fully undone — the shared prom-client registry still ' +
    'carries what this check wrote, which every later reader in this process would treat as ' +
    'real queue traffic',
  'registry-restore-unverifiable':
    'the registry could not be re-rendered after the restore, so the restore could not be verified',
  'collector-module-absent': 'the built queue-depth collector is absent',
  'reflect-metadata-unresolvable':
    'reflect-metadata could not be resolved, so the collector’s injected tokens cannot be read',
  'collector-module-unloadable': 'the built queue-depth collector could not be required',
  'collector-export-missing': 'the collector module exports no QueueDepthCollector class',
  'collector-paramtypes-missing':
    'QueueDepthCollector carries no `self:paramtypes`, so its @InjectQueue tokens cannot be read',
  'collector-no-queue-token':
    'QueueDepthCollector injects no BullQueue_* token, so no queue drive set can be derived',
};

/**
 * The message for a failed instrumented-queue read.
 *
 * Fails closed on its OWN enum (DNC-08): a reason this map does not know, or a
 * result with no reason at all, is still a PROBLEM — and says which reason it
 * did not recognise, so the next person fixes the map rather than the gate.
 */
function instrumentationFailureMessage(result) {
  const reason = result && typeof result === 'object' ? result.reason : undefined;
  const known = typeof reason === 'string' ? QUEUE_READER_REASONS[reason] : undefined;
  const file = result && typeof result === 'object' && result.file ? String(result.file) : null;
  const detail = result && typeof result === 'object' && result.detail ? String(result.detail) : null;

  const cause = known
    ? `${known} (${file || 'file not reported'})`
    : `the reader reported ${
        typeof reason === 'string' ? `an unrecognised reason "${reason}"` : 'no reason at all'
      }${file ? ` for ${file}` : ''}, which this check does not know how to interpret`;

  return (
    `the instrumented queue set could not be read: ${cause}` +
    `${detail ? ` — ${detail}` : ''}. That is a failure, not a skip: with nothing to ` +
    'compare against, a queue nobody instruments would pass unnoticed.'
  );
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
 *  1. either input unreadable → a failure, never a skip (DNC-08). Since
 *     S-E02-19 the instrumented side arrives as a discriminated result, so the
 *     message names the CAUSE and the file that was actually read — and an
 *     unrecognised or absent reason is itself a failure
 *     (`instrumentationFailureMessage`);
 *  2. a registered set below the floor → a failure, because an extraction that
 *     returned nothing would make every rule below vacuous;
 *  3. api ≠ worker → a failure naming the side that lacks the queue. Not a
 *     union: unioning the two sides before comparing is exactly how a queue
 *     registered on ONE side only would keep passing, and producer-without-
 *     consumer is the defect the two comments warn about;
 *  4. registered \ instrumented → invisible on the dashboard while looking healthy;
 *  5. instrumented \ registered → a series permanently at zero, which reads as
 *     an idle queue;
 *  6. the DECLARED instrumented set must equal the one that survives a DRIVEN
 *     write path to the rendered exposition. A check that read only an exported
 *     constant would reproduce the very defect it exists to close: a
 *     declaration nobody executes — and so, measurably, would a check that
 *     scraped labels the module zero-seeds FROM that same constant, which is
 *     what this rule did until S-E02-18 (PF-105). See `readInstrumentedQueues`
 *     for what is driven and what that does and does not prove.
 */
function evaluateQueueInstrumentation(input, problems, notes) {
  // Local, so an unrelated earlier failure cannot suppress this check's note —
  // and so this check's own note cannot claim a pass it did not produce.
  const problemsBefore = problems.length;
  const instrumented = input.instrumentedQueues;
  const registered = input.registeredQueues;

  if (!instrumented || typeof instrumented !== 'object' || instrumented.ok === false) {
    problems.push(instrumentationFailureMessage(instrumented));
    return;
  }
  if (!Array.isArray(instrumented.declared)) {
    problems.push(instrumentationFailureMessage(null));
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

  // 6. Declared must equal DRIVEN-AND-RENDERED — a constant nobody executes is
  // the defect (S-E02-18 / PF-105).
  //
  // `rendered` is no longer scraped from labels the module zero-seeds FROM
  // `INSTRUMENTED_QUEUES` — that made `declared ≡ rendered` true by
  // construction, i.e. `A ≡ A`, and rule 6 could not fail. It is now the
  // intersection of two families neither of which is zero-seeded, produced by
  // driving a depth source and an allow-listed job outcome for each queue the
  // worker's own WIRING names. See `readInstrumentedQueues`.
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
        `INSTRUMENTED_QUEUES declares [${declared.join(', ')}] but only [${rendered.join(', ')}] ` +
          'survived a driven write path to the rendered worker exposition. Declared with NO ' +
          `write path: [${missing.join(', ') || 'none'}]. Rendered but NOT declared: ` +
          `[${extra.join(', ') || 'none'}]. A queue named in the constant that no collector binds ` +
          'and no processor records is a series permanently absent — on a dashboard, ' +
          'indistinguishable from an idle queue.',
      );
    }
  }

  if (problems.length === problemsBefore) {
    notes.push(
      `instrumented queues ≡ registered queues (${registeredSet.join(', ')}), agreed on by ` +
        `${QUEUE_MODULES.api} and ${QUEUE_MODULES.worker}, and each one driven through a real ` +
        'write path to the rendered worker exposition',
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
 *
 * S-E02-18 widens it ADDITIVELY: it now returns `{ names, types }`, and
 * `collectFromRepo` keeps `input.exposedMetrics` a `string[]` byte-for-byte
 * while putting the map on a NEW `input.exposedMetricTypes`. Reshaping
 * `exposedMetrics` would have been the tidy refactor and it would have been a
 * silent disaster: check 6 does `new Set(exposed || [])` and then
 * `if (exposedSet.size === 0) break`, so an object where an array was expected
 * makes every dashboard query pass vacuously inside a BLOCKING stage, and
 * nothing in the repository would have noticed.
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
  const types = {};
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
    // `\S+` twice and NO `$` anchor: a `$`-anchored parse would silently return
    // an empty map against CRLF line endings, which — check 10 failing closed —
    // would turn the whole gate red on a correct tree. A false red is as
    // corrosive as a false pass; it teaches people to skip the gate.
    for (const match of exposition.matchAll(/^# TYPE (\S+) (\S+)/gm)) {
      names.add(match[1]);
      types[match[1]] = match[2];
    }
  }
  return { names: [...names], types };
}

/**
 * The queues the worker really instruments (S-E02-17 / D5 · S-E02-18 / PF-105).
 *
 * Returns BOTH halves, because either one alone is a weaker claim than it
 * looks:
 *   • `declared` — the exported `INSTRUMENTED_QUEUES` constant;
 *   • `rendered` — the `queue="…"` label values that appear in the worker's
 *     exposition after a real write path has been DRIVEN for each queue the
 *     worker's own WIRING names.
 *
 * WHAT THIS DOES AND WHAT IT DOES NOT PROVE — stated precisely, because the
 * sentence that used to sit here ("what the process really publishes") was
 * false, and a false claim in a gate's own header is how PF-105 survived a
 * review. It is driven, in this process, with no Redis:
 *
 *   1. the DRIVE SET is read from the wiring, NOT from `INSTRUMENTED_QUEUES`:
 *      the `BullQueue_<name>` tokens `QueueDepthCollector` really injects, off
 *      `Reflect.getMetadata('self:paramtypes', …)` on the BUILT collector. This
 *      is the whole point. Driving the set under test would make `rendered`
 *      a function of `declared` and rule 6 would reduce to `A ≡ A` one layer
 *      deeper than before — wearing a header comment claiming otherwise;
 *   2. for each queue in that drive set, a synthetic depth source is bound
 *      through the module's own `registerQueueDepthSources`, and one
 *      ALLOW-LISTED job name (the first entry of `JOB_NAMES_BY_QUEUE`) is passed
 *      to `observeJobCompleted`. Allow-listed on purpose: driving with an
 *      unlisted name would render `job="<other>"`, and then the `<other>`
 *      sentinel — not the queue's own label — would be what "proved" the label;
 *   3. `rendered` is the INTERSECTION of the `queue` labels carried by
 *      `pilotage_queue_depth` AND `pilotage_queue_jobs_total`. Neither family is
 *      zero-seeded, so a label in both can only come from a write that happened.
 *      The zero-seeded families (`…_depth_collection_failures_total`,
 *      `…_depth_sources_bound`) are EXCLUDED by exact-name matching — they carry
 *      the declared labels for free, which is precisely what made the old
 *      prefix-matching version tautological.
 *
 * It therefore proves: the declared queue can be bound as a depth source and
 * can record an outcome, and its label survives to the exposition. It does NOT
 * prove that a real BullMQ queue exists, that Redis answers, or that a
 * processor is subscribed — check 9's rules 3/4/5 read the resolved
 * registrations for the first, and nothing here reaches the last two.
 *
 * The registry is restored on the way out (`finally`), and — since S-E02-19 /
 * PF-115 (b) — the restore is VERIFIED rather than assumed: the registry is
 * re-rendered afterwards and `registryResidue` looks for the three things this
 * function wrote. A leak here would fabricate queue traffic that every later
 * `registry.metrics()` in this process, including a future check, would treat as
 * real — the "green and false" shape this epic exists to close, relocated into
 * the mechanism written to close it. Residue is reported BEFORE a drive error: a
 * poisoned registry misleads every later reader, which is strictly worse than
 * one failed read.
 *
 * Returns a DISCRIMINATED result — `{ ok: true, declared, rendered }` or
 * `{ ok: false, reason, file, detail? }` — never a bare `null`. Every distinct
 * failure carries its own reason and names the file it actually read. The caller
 * turns any of them into a failure, never a skip.
 */
async function readInstrumentedQueues() {
  const modulePath = join(REPO_ROOT, WORKER_QUEUE_METRICS_MODULE);
  const registryPath = join(REPO_ROOT, WORKER_METRICS_REGISTRY_MODULE);
  if (!existsSync(modulePath)) {
    return { ok: false, reason: 'queue-metrics-module-absent', file: WORKER_QUEUE_METRICS_MODULE };
  }
  if (!existsSync(registryPath)) {
    return { ok: false, reason: 'metrics-registry-absent', file: WORKER_METRICS_REGISTRY_MODULE };
  }

  const mod = require(modulePath);
  const declared = Array.isArray(mod && mod.INSTRUMENTED_QUEUES)
    ? [...mod.INSTRUMENTED_QUEUES]
    : null;
  if (!declared) {
    return {
      ok: false,
      reason: 'instrumented-queues-not-an-array',
      file: WORKER_QUEUE_METRICS_MODULE,
    };
  }

  const registryModule = require(registryPath);
  if (!registryModule || !registryModule.registry) {
    return { ok: false, reason: 'registry-export-missing', file: WORKER_METRICS_REGISTRY_MODULE };
  }

  const collector = readCollectorBoundQueues();
  // The collector's own reason travels UP unchanged. Collapsing it into a
  // reason of this function's own is exactly how the wrong filename got emitted.
  if (collector.ok !== true) return collector;
  const driveSet = collector.queues;

  if (
    typeof mod.registerQueueDepthSources !== 'function' ||
    typeof mod.observeJobCompleted !== 'function' ||
    !mod.JOB_NAMES_BY_QUEUE
  ) {
    return { ok: false, reason: 'queue-metrics-api-missing', file: WORKER_QUEUE_METRICS_MODULE };
  }

  let exposition;
  let driveError = null;
  const drivenOutcomes = [];
  try {
    mod.registerQueueDepthSources(
      driveSet.map((queue) => ({
        queue,
        // A distinctive, non-zero count: a zero would be indistinguishable from
        // an unwritten gauge for anyone reading this by hand — and it is what
        // `registryResidue` looks for once the restore has run.
        getJobCounts: async () => ({ waiting: DRIVEN_DEPTH_SENTINEL }),
      })),
    );
    for (const queue of driveSet) {
      const allowed = mod.JOB_NAMES_BY_QUEUE[queue];
      // No allow-listed name → do not drive it. Driving it anyway would record
      // `job="<other>"`, i.e. the sentinel would become the proof.
      if (!Array.isArray(allowed) || typeof allowed[0] !== 'string') continue;
      // S-E02-19 / PF-118: recorded BEFORE the write that produces it, never
      // after. `observeJobCompleted` can throw mid-write, and a tuple pushed
      // afterwards would then be missing from `drivenOutcomes` for a sample that
      // may already exist — so `registryResidue` would not look for the residue
      // this drive is most likely to have left. The intent to write is what the
      // residue check needs; whether the write finished is exactly the unknown.
      drivenOutcomes.push({ queue, job: allowed[0] });
      mod.observeJobCompleted(queue, { name: allowed[0] });
    }
    exposition = await registryModule.registry.metrics();
  } catch (error) {
    driveError = error;
  } finally {
    // Total: it runs on the throw path too, which is the only reason verifying
    // it afterwards is meaningful.
    mod.registerQueueDepthSources([]);
    if (mod.queueDepth && typeof mod.queueDepth.reset === 'function') mod.queueDepth.reset();
    if (mod.queueJobsTotal && typeof mod.queueJobsTotal.reset === 'function') {
      mod.queueJobsTotal.reset();
    }
  }

  let afterRestore;
  try {
    afterRestore = await registryModule.registry.metrics();
  } catch (error) {
    return {
      ok: false,
      reason: 'registry-restore-unverifiable',
      file: WORKER_METRICS_REGISTRY_MODULE,
      detail: String((error && error.message) || error),
    };
  }

  const residue = registryResidue(afterRestore, drivenOutcomes);
  if (residue.length > 0) {
    return {
      ok: false,
      reason: 'registry-not-restored',
      file: WORKER_METRICS_REGISTRY_MODULE,
      detail: residue.join(' · '),
    };
  }

  if (driveError !== null) {
    return {
      ok: false,
      reason: 'driven-write-path-threw',
      file: WORKER_QUEUE_METRICS_MODULE,
      detail: String((driveError && driveError.message) || driveError),
    };
  }

  // EXACT family names, followed immediately by `{`. Not a prefix test:
  // `pilotage_queue_depth_collection_failures_total` starts with
  // `pilotage_queue_depth`, and counting it as the depth family is exactly the
  // way this check was vacuous before.
  const depthLabels = queueLabelsOfFamily(exposition, 'pilotage_queue_depth');
  const outcomeLabels = queueLabelsOfFamily(exposition, 'pilotage_queue_jobs_total');
  const rendered = [...depthLabels].filter((name) => outcomeLabels.has(name));

  return { ok: true, declared, rendered };
}

/**
 * The depth value the drive above writes, and the only value `registryResidue`
 * treats as evidence of a leak. Distinctive and non-zero on purpose.
 */
const DRIVEN_DEPTH_SENTINEL = 17;

/**
 * What the drive above left behind in a rendered exposition, in words
 * (S-E02-19 / PF-115 (b) · AC-10).
 *
 * A PURE function of an exposition string, so the guarantee is testable without
 * `apps/worker/dist`: the spec can hand it a clean exposition, an exposition
 * carrying the depth sentinel, one carrying the driven outcome, and one carrying
 * a still-bound depth source, and see each named. Driving the real reader would
 * only ever demonstrate that the restore worked TODAY.
 *
 * Three things, one per thing the drive writes:
 *  1. a `pilotage_queue_depth` sample carrying the sentinel value;
 *  2. a `pilotage_queue_jobs_total` sample for a `(queue, job)` pair that was
 *     driven — matched on the pair, not on the family, so ordinary traffic
 *     recorded by something else is not mistaken for residue;
 *  3. a non-zero `pilotage_queue_depth_sources_bound`, i.e. a synthetic source
 *     still bound to the module.
 *
 * Empty array = nothing left behind. Any entry is a PROBLEM at the caller.
 */
function registryResidue(exposition, drivenOutcomes = []) {
  const residue = [];
  const driven = Array.isArray(drivenOutcomes) ? drivenOutcomes : [];

  for (const line of String(exposition).split('\n')) {
    const text = line.trim();
    if (text.length === 0 || text.startsWith('#')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)$/.exec(text);
    if (!match) continue;
    const name = match[1];
    const labels = match[2] || '';
    const value = Number(match[3]);

    if (name === 'pilotage_queue_depth' && value === DRIVEN_DEPTH_SENTINEL) {
      residue.push(
        `pilotage_queue_depth still carries the driven sentinel ${DRIVEN_DEPTH_SENTINEL} (${text})`,
      );
      continue;
    }
    if (
      name === 'pilotage_queue_jobs_total' &&
      driven.some(
        (entry) =>
          entry &&
          labels.includes(`queue="${entry.queue}"`) &&
          labels.includes(`job="${entry.job}"`),
      )
    ) {
      residue.push(`pilotage_queue_jobs_total still carries a driven outcome (${text})`);
      continue;
    }
    if (name === 'pilotage_queue_depth_sources_bound' && Number.isFinite(value) && value > 0) {
      residue.push(`pilotage_queue_depth_sources_bound still reports a bound source (${text})`);
    }
  }
  return residue;
}

/** The `queue` label values one EXACT metric family carries in an exposition. */
function queueLabelsOfFamily(exposition, family) {
  const labels = new Set();
  for (const line of String(exposition).split('\n')) {
    if (!line.startsWith(`${family}{`)) continue;
    const match = /\{[^}]*queue="([^"]*)"/.exec(line);
    if (match) labels.add(match[1]);
  }
  return labels;
}

/**
 * The queues the worker's DEPTH COLLECTOR really injects — the wiring, read
 * resolved (S-E02-18 / PF-105).
 *
 * `@InjectQueue(name)` is `Inject(getQueueToken(name))`, and Nest records that
 * on the class as `self:paramtypes` = `[{ index, param: 'BullQueue_<name>' }]`.
 * Reading it is the same discipline `readRegisteredQueues` uses one function
 * below, and it is what makes the drive set INDEPENDENT of the constant this
 * check is testing.
 *
 * Requiring the built collector is cheap and opens nothing: it pulls
 * `@nestjs/bullmq`, `@nestjs/common` and `queue-metrics`, and the queues are
 * built by Nest DI at bootstrap, which does not happen here.
 *
 * Returns a DISCRIMINATED result — `{ ok: true, queues }` or
 * `{ ok: false, reason, file, detail? }` — a failure, never a skip, and never a
 * bare `null`: six distinct causes used to collapse into one `null` that the
 * caller rendered as a single message naming a DIFFERENT file (S-E02-19 /
 * PF-115 (a)).
 *
 * `collectorPath` is a TESTABILITY SEAM, not a flag. DNC-10 forbids adding a
 * bypass — a CLI flag, an env var, an argument that turns any of this off. A
 * default-valued parameter that only changes WHICH file is read, cannot be
 * reached from the command line (`main()` calls this with no argument, through
 * `readInstrumentedQueues`, which also calls it with none), and cannot make any
 * check pass, adds nothing to the script's flag surface. It is what lets the
 * gate spec drive all six causes against throw-away fixture files instead of
 * leaving this function with the zero executed coverage it had.
 */
function readCollectorBoundQueues(collectorPath = join(REPO_ROOT, WORKER_QUEUE_DEPTH_COLLECTOR_MODULE)) {
  const file = describeRepoPath(collectorPath);
  if (!existsSync(collectorPath)) {
    return { ok: false, reason: 'collector-module-absent', file };
  }

  const req = (spec) =>
    require(require.resolve(spec, {
      paths: [join(REPO_ROOT, REFLECT_METADATA_RESOLUTION_ROOT)],
    }));
  try {
    req('reflect-metadata');
  } catch (error) {
    return {
      ok: false,
      reason: 'reflect-metadata-unresolvable',
      file: REFLECT_METADATA_RESOLUTION_ROOT,
      detail: String((error && error.message) || error),
    };
  }

  let mod;
  try {
    mod = require(collectorPath);
  } catch (error) {
    return {
      ok: false,
      reason: 'collector-module-unloadable',
      file,
      detail: String((error && error.message) || error),
    };
  }
  if (!mod || typeof mod.QueueDepthCollector !== 'function') {
    return { ok: false, reason: 'collector-export-missing', file };
  }

  const injected = Reflect.getMetadata('self:paramtypes', mod.QueueDepthCollector);
  if (!Array.isArray(injected) || injected.length === 0) {
    return { ok: false, reason: 'collector-paramtypes-missing', file };
  }

  const names = new Set();
  for (const entry of injected) {
    const token = entry && entry.param;
    if (typeof token !== 'string') continue;
    const match = /^BullQueue_(.+)$/.exec(token);
    if (match) names.add(match[1]);
  }
  if (names.size === 0) {
    return { ok: false, reason: 'collector-no-queue-token', file };
  }
  return { ok: true, queues: [...names] };
}

/** A path as a message should name it: repo-relative inside the repo, absolute outside it. */
function describeRepoPath(path) {
  const rel = relative(REPO_ROOT, path).replace(/\\/g, '/');
  return rel.length > 0 && !rel.startsWith('..') ? rel : String(path).replace(/\\/g, '/');
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

  // Read ONCE — the registries must not be rendered twice, and the two fields
  // below are two views of the same read.
  const exposed = await readExposedMetricNames();

  return {
    composeFiles,
    prometheus,
    datasources,
    dashboards,
    bootRoutes,
    workerMetricsPath: readWorkerMetricsPath(),
    webMetricsPath: readWebMetricsPath(),
    webRoutes: readWebRoutes(),
    // ADDITIVE, deliberately: `exposedMetrics` keeps its `string[]` shape and
    // the types land beside it. See `readExposedMetricNames` for why reshaping
    // it would have turned check 6 into a vacuous pass.
    exposedMetrics: exposed === null ? null : exposed.names,
    exposedMetricTypes: exposed === null ? null : exposed.types,
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
      !input.instrumentedQueues || input.instrumentedQueues.ok !== true
        ? `INSTRUMENTATION UNREADABLE${
            input.instrumentedQueues && input.instrumentedQueues.reason
              ? ` (${input.instrumentedQueues.reason})`
              : ''
          }`
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
  sumAggregationArguments,
  maskQuotedSpans,
  scanQuotedSpans,
  unshieldedGaugeReferences,
  registryResidue,
  readCollectorBoundQueues,
  baseMetricName,
  serviceListenPort,
  serviceListenPorts,
  splitTarget,
  WEB_OBSERVABILITY_MODULE,
  WORKER_QUEUE_METRICS_MODULE,
  WORKER_METRICS_REGISTRY_MODULE,
  WORKER_QUEUE_DEPTH_COLLECTOR_MODULE,
  QUEUE_MODULES,
  REGISTERED_QUEUE_FLOOR,
  REPLICA_LABELS,
  ACROSS_SERIES_AGGREGATIONS,
  REPLICA_IDEMPOTENT_AGGREGATIONS,
  DRIVEN_DEPTH_SENTINEL,
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
