import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import {
  resolveTracingConfig,
  withRedaction,
  type SpanExporterLike,
  type TracingConfig,
} from '@pilotage/contracts';

/**
 * Démarrage du traçage de l'API (S-E02-14 / PF-78).
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE FICHIER RÉPARE
 * ---------------------------------------------------------------------------
 * `infra/docker-compose.yml` déclare un service `jaeger` et distribue
 * `OTEL_EXPORTER_OTLP_ENDPOINT` aux applications depuis que le profil `obs`
 * existe. Mesuré au run 15 : un `grep` insensible à la casse de
 * `opentelemetry|otel` sur le source des trois applications renvoyait
 * **0 résultat**. Un
 * collecteur était déployé, une adresse était fournie, et rien au monde
 * n'émettait un span. Le seul `@opentelemetry/api` de l'arbre y arrivait
 * transitivement via `prom-client`.
 *
 * C'est la moitié « traces » de PF-56, et c'est R-26 encore une fois : une
 * capacité déclarée que rien ne lit.
 *
 * ---------------------------------------------------------------------------
 * L'ORDRE DE CHARGEMENT EST LA PARTIE PORTEUSE — PAS UN DÉTAIL DE STYLE
 * ---------------------------------------------------------------------------
 * L'instrumentation automatique fonctionne en **monkey-patchant les modules au
 * moment où ils sont chargés**. Un SDK démarré après `require('./app.module')`
 * trouve `http`, `express` et `@nestjs/core` déjà résolus dans le cache de
 * modules : il ne patche rien, ne lève aucune erreur, et l'application démarre
 * en paraissant instrumentée tout en n'émettant que le span occasionnel des
 * requêtes sortantes.
 *
 * C'est exactement la forme de défaut que cette épique passe son temps à
 * trouver — vert, silencieux, faux. `scripts/observability-check.js` lit donc
 * l'ordre des `require` dans le **`main.js` émis** (pas dans le source) et
 * échoue si le bootstrap de traçage n'est pas chargé avant le module
 * applicatif.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI PAS `auto-instrumentations-node`
 * ---------------------------------------------------------------------------
 * Le méta-paquet enregistre une quarantaine d'instrumentations, dont la
 * quasi-totalité vise des bibliothèques que ce dépôt n'utilise pas. Chacune est
 * du code qui patche des modules au démarrage de la production. La liste
 * explicite ci-dessous est plus longue à lire et beaucoup plus courte à
 * auditer.
 *
 * Prisma est **délibérément absent** : son instrumentation exige le preview
 * feature `tracing` dans `schema.prisma` et une version alignée sur le client,
 * donc un `prisma generate` et une modification de schéma. Mélanger ça à cette
 * slice ferait entrer G-MIGRATION dans un changement qui n'en a pas besoin.
 * Enregistré comme suite, pas comme oubli.
 */

/** Fabrique d'exportateur, injectable pour que les tests n'aient pas besoin d'un collecteur. */
export type ExporterFactory = (config: TracingConfig) => SpanExporterLike;

const defaultExporterFactory: ExporterFactory = (config) =>
  // Le chemin `/v1/traces` est écrit explicitement plutôt que laissé à la
  // convention d'`OTLPTraceExporter` : la variable d'environnement porte la
  // **base** OTLP, et confondre les deux produit un exportateur qui poste sur
  // une 404 sans que rien ne le signale.
  new OTLPTraceExporter({ url: `${config.endpoint}/v1/traces` }) as unknown as SpanExporterLike;

export interface TracingHandle {
  readonly config: TracingConfig;
  shutdown(): Promise<void>;
}

let started: TracingHandle | undefined;

/**
 * Démarre le SDK si l'environnement déclare un collecteur.
 *
 * Renvoie toujours une poignée — y compris quand le traçage est désactivé —
 * pour que l'appelant puisse **journaliser la raison**. Ce que PF-78 n'avait
 * pas, ce n'était pas seulement du code : c'était le moyen de s'apercevoir
 * qu'il n'y en avait pas.
 */
export function startTracing(
  env: NodeJS.ProcessEnv = process.env,
  exporterFactory: ExporterFactory = defaultExporterFactory,
): TracingHandle {
  if (started !== undefined) return started;

  const config = resolveTracingConfig(env, 'api');

  if (!config.enabled) {
    started = { config, shutdown: () => Promise.resolve() };
    return started;
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
    }),
    // `withRedaction` est le contrôle G-TENANT, et il enveloppe l'exportateur
    // plutôt que de configurer chaque instrumentation : c'est le seul point par
    // lequel *tous* les spans passent, y compris ceux d'une instrumentation
    // ajoutée plus tard. Voir `packages/contracts/src/observability`.
    traceExporter: withRedaction(exporterFactory(config)) as never,
    instrumentations: [
      new HttpInstrumentation({
        // Les surfaces d'exploitation sont écartées du traçage — et seulement
        // du traçage. `/metrics` est scrapé toutes les 15 s et `/healthz`
        // interrogé par docker en continu : les tracer noierait les requêtes
        // réelles sous du bruit périodique. Elles restent mesurées côté
        // Prometheus, où le coût d'une série supplémentaire est nul.
        ignoreIncomingRequestHook: (req) => {
          const path = (req.url ?? '').split('?')[0] ?? '';
          return ['/metrics', '/healthz', '/readyz'].includes(path);
        },
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new IORedisInstrumentation({
        // L'instrumentation ioredis écrit la commande **avec ses arguments**
        // dans `db.statement`, et les clés de ce dépôt portent des identifiants
        // de tenant. `withRedaction` supprimerait déjà l'attribut ; on le coupe
        // aussi à la source, parce que deux contrôles indépendants valent mieux
        // qu'un sur une surface non authentifiée.
        requireParentSpan: false,
        dbStatementSerializer: () => '',
      }),
    ],
  });

  sdk.start();

  started = {
    config,
    shutdown: async () => {
      await sdk.shutdown();
      started = undefined;
    },
  };
  return started;
}

/** Réservé aux tests : oublie l'instance mémorisée. */
export function resetTracingForTests(): void {
  started = undefined;
}
