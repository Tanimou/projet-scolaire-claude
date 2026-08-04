'use strict';

/**
 * Observabilité de `apps/web` — le troisième artefact observé (S-E02-15 / PF-79).
 *
 * ===========================================================================
 * CE QUE CE FICHIER RÉPARE
 * ===========================================================================
 * `S-E02-13` a donné des métriques à l'API et au worker ; `S-E02-14` leur a
 * donné des traces. `apps/web` — **le seul artefact que les utilisateurs
 * touchent** — n'avait ni l'un ni l'autre. Mesuré avant cette slice :
 *
 *   grep -rniE 'prom-client|opentelemetry|/metrics' apps/web/src  →  0 résultat
 *   node scripts/observability-check.js                            →  exit 0
 *
 * Autrement dit : la gate était **verte sur l'état que PF-79 décrit**. Une page
 * lente ou en erreur était invisible pour Prometheus comme pour Jaeger, pendant
 * que les deux applications Nest étaient visibles des deux côtés.
 *
 * ===========================================================================
 * POURQUOI DU COMMONJS SIMPLE, ET PAS DU TYPESCRIPT
 * ===========================================================================
 * C'est délibéré et porteur, pas un relâchement de style.
 *
 * `apps/web` n'a **aucun projet jest** et **aucun `dist/`** : sa seule chaîne de
 * compilation est `next build`, qui prend plus de neuf minutes et dont la
 * routine n'a droit qu'à **une** exécution par run. Un module TypeScript ici ne
 * serait donc exécutable par rien d'autre que ce build — et une observabilité
 * que personne ne peut exécuter est exactement le défaut que cette épique
 * passe son temps à trouver.
 *
 * Un module CommonJS simple est, lui, `require`-able par les **trois**
 * consommateurs qui comptent :
 *   (i)   le build webpack de Next (via `src/instrumentation.ts`) ;
 *   (ii)  les specs de garde hébergées par `apps/api` (`apps/web` n'a pas de
 *         runner ; c'est déjà la raison d'être de `web-artifact-gate.spec.ts`) ;
 *   (iii) la sonde enfant du gate (`scripts/web-observability-probe.js`), qui
 *         n'a besoin d'aucun build pour tourner.
 *
 * C'est la même raison pour laquelle `scripts/*.js` sont en CJS simple. Un
 * `web-observability.d.ts` écrit à la main tient le contrat côté types
 * (`tsconfig.json` inclut `src/**\/*.ts`, ce qui le couvre ; il ne compile pas
 * les `.js`).
 *
 * ===========================================================================
 * POURQUOI UN SOCKET SÉPARÉ, ET JAMAIS UNE ROUTE NEXT
 * ===========================================================================
 * `infra/nginx/conf.d/pilotage.conf` — `location /` — relaie **tout** ce qui
 * n'est pas apparié vers l'upstream web. Une route Next `/metrics` serait donc
 * publiée sur l'internet public le jour où elle serait ajoutée, et la règle
 * d'exposition de `scripts/observability-check.js` (qui n'inspecte que les
 * blocs `location`) ne la verrait **pas** : ce n'est pas nginx qui aurait
 * changé, c'est l'application derrière lui.
 *
 * Donc un socket `node:http` dédié, sur le réseau docker uniquement, jamais
 * publié côté hôte — précisément le motif de
 * `apps/worker/src/shared/release/version-server.ts`, dont le contrôle d'accès
 * *est* le réseau. Et une assertion supplémentaire dans la gate : le chemin des
 * métriques ne doit apparaître dans aucun inventaire de routes web.
 *
 * ===========================================================================
 * LES MÉTRIQUES SONT DÉRIVÉES DES SPANS — ET CE QUE ÇA IMPLIQUE
 * ===========================================================================
 * Next.js n'expose pas de middleware serveur où brancher un chronomètre : le
 * seul point de mesure disponible est l'instrumentation OpenTelemetry
 * **intégrée** à Next. On branche donc un `SpanProcessor.onEnd` qui alimente
 * l'histogramme et le compteur. Une source de mesure, deux destinations
 * (Jaeger + Prometheus), zéro seconde instrumentation à maintenir.
 *
 * **Conséquence assumée, et divergence explicite avec api/worker :** là-bas,
 * déclarer `OTEL_EXPORTER_OTLP_ENDPOINT` *est* l'interrupteur du SDK entier.
 * Ici, le SDK est aussi l'appareil de mesure : le fournisseur de traces et le
 * processeur qui alimente Prometheus démarrent **toujours**, et seul
 * l'exportateur OTLP caviardé est ajouté quand un collecteur est déclaré. Sans
 * ça, le compose par défaut (`OTEL_EXPORTER_OTLP_ENDPOINT: ${…:-}`, donc vide)
 * publierait un histogramme que rien n'alimente jamais — PF-79 avec un chapeau
 * neuf.
 *
 * **Ce qui n'est donc PAS honoré ici : `OTEL_TRACES_SAMPLER_ARG`.** Un
 * échantillonnage de tête à la racine écarterait les spans *avant* le
 * processeur de métriques, et biaiserait silencieusement la latence p95 d'un
 * facteur inconnu. Entre « des traces moins chères » et « une mesure fausse
 * sans que rien ne le dise », cette épique a déjà tranché. Écrit ici plutôt que
 * découvert plus tard.
 *
 * ===========================================================================
 * CAVIARDAGE : UNE SEULE COPIE
 * ===========================================================================
 * `withRedaction` vient de `@pilotage/contracts` — jamais réécrit ici. Une
 * seconde copie de la politique qui oublierait `db.statement` enverrait des
 * identifiants de tenant vers un collecteur non authentifié sans que rien ne le
 * dise : c'est exactement ce contre quoi `S-E02-14` a centralisé la règle. Une
 * spec de garde échoue si ce fichier définit sa propre fonction `sanitize*` ou
 * `redact*`.
 *
 * `packages/contracts` reste **pur** (aucun import OpenTelemetry, aucun
 * `node:*`, aucun `prom-client`) : il est importé par des bundles CLIENT de
 * `apps/web`. Le SDK est un détail d'exécution qui vit ici.
 */

const { createServer } = require('node:http');

const { Registry, collectDefaultMetrics, Histogram, Counter } = require('prom-client');
const { resolveTracingConfig, withRedaction } = require('@pilotage/contracts');

/* -------------------------------------------------------------------------- *
 * 1. Registre et métriques
 * -------------------------------------------------------------------------- */

/**
 * Type de contenu de l'exposition Prometheus.
 *
 * Littéral identique à celui de `apps/api/src/modules/metrics/metrics.registry.ts`
 * et du socket du worker : trois expositions qui s'annoncent différemment
 * seraient trois façons de se tromper.
 */
const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** Registre dédié — jamais le registre global, qu'un import tiers pourrait polluer. */
const registry = new Registry();

// L'étiquette `app` est ce qui permet à UN tableau de bord de comparer les trois
// artefacts. Elle est aussi ce qui empêche les séries `api` et `web` de se
// confondre maintenant qu'elles portent les mêmes noms de métriques — voir le
// regroupement `by (app, route)` dans infra/grafana/dashboards/pilotage-slo.json.
registry.setDefaultLabels({ app: 'web' });

collectDefaultMetrics({ register: registry });

/**
 * Noms de métriques — **volontairement identiques** à ceux de l'API.
 *
 * Un préfixe `pilotage_web_*` forkerait chaque panneau du tableau de bord et
 * rendrait impossible la seule question qui compte en incident : « est-ce le
 * rendu ou l'API qui est lent ? ». C'est l'étiquette `app` qui distingue, pas
 * le nom.
 */
const HTTP_DURATION_METRIC = 'pilotage_http_request_duration_seconds';
const HTTP_REQUESTS_METRIC = 'pilotage_http_requests_total';

/** Buckets en **secondes**, convention Prometheus — identiques à ceux de l'API. */
const HTTP_DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const HTTP_LABEL_NAMES = ['method', 'route', 'status_code'];

const httpRequestDuration = new Histogram({
  name: HTTP_DURATION_METRIC,
  help: 'Durée des requêtes servies par l’application web, par gabarit de route',
  labelNames: HTTP_LABEL_NAMES,
  buckets: HTTP_DURATION_BUCKETS,
  registers: [registry],
});

const httpRequestsTotal = new Counter({
  name: HTTP_REQUESTS_METRIC,
  help: 'Nombre de requêtes servies par l’application web, par gabarit de route',
  labelNames: HTTP_LABEL_NAMES,
  registers: [registry],
});

/* -------------------------------------------------------------------------- *
 * 2. Étiquetage — la contrainte G-TENANT de cette slice
 * -------------------------------------------------------------------------- */

/** Étiquette unique pour tout ce qui n'a pas de gabarit de route. */
const UNMATCHED_ROUTE = '<unmatched>';

/** Repli borné quand l'attribut est absent — jamais une valeur dérivée de la requête. */
const UNKNOWN_LABEL = 'unknown';

/**
 * `SpanKind.SERVER`. Écrit en littéral plutôt qu'importé de
 * `@opentelemetry/api` pour que ce module reste chargeable par la gate sans
 * tirer le SDK — la valeur fait partie de la spécification OTLP et ne bouge pas.
 */
const SPAN_KIND_SERVER = 1;

/**
 * Attributs **déjà** en forme de gabarit. L'ordre compte : Next renseigne
 * `next.route` (`/parent/students/[id]`) là où l'instrumentation HTTP générique
 * renseignerait `http.route`.
 */
const ROUTE_TEMPLATE_ATTRIBUTES = ['next.route', 'http.route'];

const METHOD_ATTRIBUTES = ['http.request.method', 'http.method'];
const STATUS_ATTRIBUTES = ['http.response.status_code', 'http.status_code'];

function readFirstAttribute(attributes, keys) {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/**
 * Dérive l'étiquette `route` d'un span.
 *
 * **Ne lit JAMAIS `http.target`, `http.url`, `url.path` ni aucune URL
 * résolue.** Deux raisons, et la seconde est la vraie :
 *
 *  1. cardinalité — une série par identifiant d'élève est une explosion mémoire
 *     qu'un simple scanner d'URL peut déclencher depuis l'extérieur ;
 *  2. **fuite** — un `SpanProcessor` voit les attributs **avant** que le
 *     caviardage de l'exportateur ne s'applique. Ce qui atterrit ici en
 *     étiquette part vers Prometheus tel quel, sur une surface non
 *     authentifiée. Le caviardage protège les traces ; il ne protège pas les
 *     métriques. C'est ici, et nulle part ailleurs, que la règle doit tenir.
 *
 * Tout ce qui n'a pas de gabarit devient **une** série `<unmatched>`, quel que
 * soit le nombre d'URL inconnues qu'on peut inventer.
 */
function routeLabelFromSpan(span) {
  const attributes = (span && span.attributes) || {};
  const template = readFirstAttribute(attributes, ROUTE_TEMPLATE_ATTRIBUTES);
  return template === undefined ? UNMATCHED_ROUTE : template;
}

/** Méthode HTTP du span, bornée à un repli constant quand elle est absente. */
function methodLabelFromSpan(span) {
  const attributes = (span && span.attributes) || {};
  const method = readFirstAttribute(attributes, METHOD_ATTRIBUTES);
  return method === undefined ? UNKNOWN_LABEL : method.toUpperCase();
}

/** Code de statut du span, borné de la même façon. */
function statusLabelFromSpan(span) {
  const attributes = (span && span.attributes) || {};
  const status = readFirstAttribute(attributes, STATUS_ATTRIBUTES);
  return status === undefined ? UNKNOWN_LABEL : status;
}

/** `HrTime` (`[secondes, nanosecondes]`) → secondes flottantes. */
function spanDurationSeconds(span) {
  const duration = span && span.duration;
  if (!Array.isArray(duration) || duration.length !== 2) return 0;
  const [seconds, nanoseconds] = duration;
  if (typeof seconds !== 'number' || typeof nanoseconds !== 'number') return 0;
  return seconds + nanoseconds / 1e9;
}

/* -------------------------------------------------------------------------- *
 * 3. Le processeur qui transforme un span en points Prometheus
 * -------------------------------------------------------------------------- */

/**
 * `SpanProcessor` minimal qui n'exporte rien : il **mesure**.
 *
 * Enregistré inconditionnellement (voir l'en-tête) pour que l'histogramme soit
 * alimenté même quand aucun collecteur n'est déclaré, ce qui est le déploiement
 * normal.
 */
function createMetricsSpanProcessor() {
  return {
    onStart() {
      /* rien : la mesure se fait à la fin du span. */
    },
    onEnd(span) {
      try {
        if (!span || span.kind !== SPAN_KIND_SERVER) return;
        const labels = {
          method: methodLabelFromSpan(span),
          route: routeLabelFromSpan(span),
          status_code: statusLabelFromSpan(span),
        };
        httpRequestsTotal.inc(labels);
        httpRequestDuration.observe(labels, spanDurationSeconds(span));
      } catch {
        // Une panne d'instrumentation ne doit jamais dégrader le service — la
        // règle est déjà celle de `apps/api/.../metrics.middleware.ts`, reprise
        // telle quelle plutôt que réinventée en troisième version.
      }
    },
    shutdown() {
      return Promise.resolve();
    },
    forceFlush() {
      return Promise.resolve();
    },
  };
}

/* -------------------------------------------------------------------------- *
 * 4. Le socket d'exposition
 * -------------------------------------------------------------------------- */

/** Chemin servi par le socket dédié. Lu par `scripts/observability-check.js`. */
const WEB_METRICS_PATH = '/metrics';

/**
 * Port du socket de métriques.
 *
 * `3001` et **pas** de mapping `ports:` côté hôte : Prometheus l'atteint par
 * nom de service compose sur le réseau `pilotage`, et le port 3001 de l'hôte
 * est déjà pris par `grafana` sous le même profil `obs`. Ne rien publier est
 * strictement mieux qu'une convention de binding loopback que rien ne lit
 * (S-E02-13 l'avait consignée comme non vérifiable).
 */
const DEFAULT_WEB_METRICS_PORT = 3001;

/**
 * Résout le port depuis `WEB_METRICS_PORT`.
 *
 * Une valeur illisible retombe sur le défaut : ni écouter sur un port aléatoire
 * (`0`, que rien ne pourrait scraper), ni se taire. Même posture que
 * `resolveVersionPort` côté worker.
 */
function resolveMetricsPort(env = process.env) {
  const raw = String((env && env.WEB_METRICS_PORT) || '').trim();
  if (raw === '') return DEFAULT_WEB_METRICS_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return DEFAULT_WEB_METRICS_PORT;
  return parsed;
}

/**
 * Crée le serveur **sans l'écouter** — ce qui rend le comportement testable
 * sans réserver un port fixe (la spec écoute sur 0 et lit le port attribué).
 *
 * `options.registry` n'existe que pour qu'une spec puisse injecter un registre
 * dont `metrics()` rejette et vérifier qu'on répond 500 sans tuer le process.
 */
function createMetricsServer(options) {
  const target = (options && options.registry) || registry;

  return createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';

    if (req.method !== 'GET' || path !== WEB_METRICS_PATH) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ statusCode: 404, message: 'Not Found' }));
      return;
    }

    // `registry.metrics()` est asynchrone : un rejet non capturé ici tuerait le
    // process Next, ce qui ferait de l'instrumentation une cause de panne de
    // l'artefact que les utilisateurs voient. Une exposition en échec est un
    // 500, pas un arrêt.
    target
      .metrics()
      .then((body) => {
        res.writeHead(200, {
          'content-type': PROMETHEUS_CONTENT_TYPE,
          'cache-control': 'no-store',
        });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('metrics collection failed\n');
      });
  });
}

/** Poignée mémorisée : Next peut appeler `register()` plus d'une fois en dev. */
let metricsServer;

/**
 * Démarre le socket. Idempotent, et **ne rejette jamais** : un `EADDRINUSE` est
 * journalisé et avalé, parce qu'un port déjà pris ne doit pas empêcher une page
 * de s'afficher.
 *
 * Résout avec le `Server` qui écoute, ou `undefined` si le bind a échoué.
 */
function startMetricsServer(port = resolveMetricsPort(), logger = console) {
  if (metricsServer !== undefined) return Promise.resolve(metricsServer);

  const server = createMetricsServer();

  return new Promise((resolveStart) => {
    const onError = (error) => {
      metricsServer = undefined;
      logger.warn?.(
        `[observability] socket de métriques non démarré sur :${port} (${error && error.code ? error.code : error}) — ` +
          'l’application continue de servir ; seule l’exposition Prometheus manque.',
      );
      resolveStart(undefined);
    };

    server.once('error', onError);
    server.listen(port, () => {
      server.removeListener('error', onError);
      // Sans `unref`, ce socket garderait la boucle d'événements vivante et un
      // `docker compose down` attendrait le SIGKILL. Next tient son propre
      // serveur ; celui-ci n'a aucune raison de prolonger le process.
      server.unref();
      metricsServer = server;
      logger.log?.(
        `[observability] métriques web sur :${port}${WEB_METRICS_PATH} (socket interne, jamais publié)`,
      );
      resolveStart(server);
    });
  });
}

/** Ferme le socket et oublie la poignée. Utilisé par les specs et la sonde. */
function stopMetricsServer() {
  const server = metricsServer;
  metricsServer = undefined;
  if (server === undefined) return Promise.resolve();
  return new Promise((resolveStop) => server.close(() => resolveStop()));
}

/* -------------------------------------------------------------------------- *
 * 5. Le démarrage
 * -------------------------------------------------------------------------- */

/**
 * Fabrique d'exportateur par défaut — chargée **paresseusement** pour que
 * `require()` de ce module (par la gate, par la sonde, par une spec) ne tire
 * pas le SDK OpenTelemetry ni n'ouvre quoi que ce soit.
 */
function defaultExporterFactory(config) {
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  // Le chemin `/v1/traces` est écrit explicitement : la variable d'environnement
  // porte la **base** OTLP, et confondre les deux produit un exportateur qui
  // poste sur une 404 sans que rien ne le signale (leçon S-E02-14).
  return new OTLPTraceExporter({ url: `${config.endpoint}/v1/traces` });
}

let started;

/**
 * Démarre le fournisseur de traces et branche la mesure Prometheus.
 *
 * Renvoie **toujours** une poignée — y compris quand l'export est désactivé —
 * pour que l'appelant puisse journaliser la `reason`. Ce que PF-78 puis PF-79
 * n'avaient pas, ce n'était pas seulement du code : c'était le moyen de
 * s'apercevoir qu'il n'y en avait pas.
 */
function startWebObservability(options = {}) {
  if (started !== undefined) return started;

  const env = options.env || process.env;
  const config = resolveTracingConfig(env, 'web');

  // Chargement paresseux, comme `defaultExporterFactory` : `require()` de ce
  // module par la gate, la sonde ou une spec ne doit pas tirer le SDK
  // OpenTelemetry ni ouvrir quoi que ce soit.
  const { NodeTracerProvider, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-node');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
  } = require('@opentelemetry/semantic-conventions');

  // Le processeur de mesure est TOUJOURS là ; l'exportateur ne l'est que si un
  // collecteur est déclaré. C'est la divergence assumée avec api/worker,
  // expliquée en tête de fichier.
  const spanProcessors = [createMetricsSpanProcessor()];

  if (config.enabled) {
    const exporterFactory = options.exporterFactory || defaultExporterFactory;
    // `withRedaction` est le contrôle G-TENANT côté traces, importé — jamais
    // recopié — depuis `@pilotage/contracts`.
    spanProcessors.push(new BatchSpanProcessor(withRedaction(exporterFactory(config))));
  }

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
    }),
    spanProcessors,
  });

  // `register()` publie le fournisseur dans le registre global de
  // `@opentelemetry/api` (`globalThis[Symbol.for('opentelemetry.js.api.1')]`).
  // C'est ce qui fait que l'instrumentation OpenTelemetry **intégrée à Next**,
  // qui résout sa propre copie de `@opentelemetry/api`, émet dans CE
  // fournisseur : le registre est global au process, pas au module.
  provider.register();

  started = {
    config,
    provider,
    shutdown: async () => {
      await provider.shutdown();
      started = undefined;
    },
  };
  return started;
}

/** Réservé aux specs et à la sonde : oublie l'instance mémorisée. */
function resetWebObservabilityForTests() {
  started = undefined;
}

module.exports = {
  PROMETHEUS_CONTENT_TYPE,
  WEB_METRICS_PATH,
  DEFAULT_WEB_METRICS_PORT,
  HTTP_DURATION_METRIC,
  HTTP_REQUESTS_METRIC,
  HTTP_DURATION_BUCKETS,
  UNMATCHED_ROUTE,
  UNKNOWN_LABEL,
  registry,
  httpRequestDuration,
  httpRequestsTotal,
  routeLabelFromSpan,
  methodLabelFromSpan,
  statusLabelFromSpan,
  spanDurationSeconds,
  createMetricsSpanProcessor,
  createMetricsServer,
  resolveMetricsPort,
  startMetricsServer,
  stopMetricsServer,
  startWebObservability,
  resetWebObservabilityForTests,
};
