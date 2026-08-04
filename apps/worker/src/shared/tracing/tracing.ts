import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
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
 * Démarrage du traçage du worker (S-E02-14 / PF-78).
 *
 * Même politique et même caviardage que l'API — un seul exemplaire, dans
 * `@pilotage/contracts` — mais **pas les mêmes instrumentations**, et l'écart
 * est délibéré :
 *
 *  • pas d'`express` : le worker n'a qu'un serveur `node:http` nu, celui du
 *    manifeste de release et de l'exposition Prometheus (S-E02-10 / S-E02-13) ;
 *  • pas de `@nestjs/core` : le worker démarre en
 *    `createApplicationContext()`, il n'a ni contrôleur ni route, donc
 *    l'instrumentation Nest n'aurait rien à envelopper ;
 *  • `ioredis` en revanche est **le** cas intéressant ici — c'est par là que
 *    passent toutes les files BullMQ, c'est-à-dire l'essentiel de ce que fait
 *    ce process.
 *
 * Copier la liste de l'API « pour rester cohérent » aurait chargé deux
 * patchers sur des modules absents : du code qui s'exécute au démarrage de la
 * production pour ne rien faire.
 *
 * Les spans de traitement de job **ne sont pas** produits par ces
 * instrumentations : il n'existe pas d'instrumentation BullMQ officielle. Ce
 * qu'on obtient ici, ce sont les commandes Redis et le trafic HTTP sortant.
 * Dit franchement plutôt que sous-entendu — voir la ligne « non couvert » de
 * `PF-78` dans la matrice.
 */

export type ExporterFactory = (config: TracingConfig) => SpanExporterLike;

const defaultExporterFactory: ExporterFactory = (config) =>
  new OTLPTraceExporter({ url: `${config.endpoint}/v1/traces` }) as unknown as SpanExporterLike;

export interface TracingHandle {
  readonly config: TracingConfig;
  shutdown(): Promise<void>;
}

let started: TracingHandle | undefined;

export function startTracing(
  env: NodeJS.ProcessEnv = process.env,
  exporterFactory: ExporterFactory = defaultExporterFactory,
): TracingHandle {
  if (started !== undefined) return started;

  const config = resolveTracingConfig(env, 'worker');

  if (!config.enabled) {
    started = { config, shutdown: () => Promise.resolve() };
    return started;
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
    }),
    traceExporter: withRedaction(exporterFactory(config)) as never,
    instrumentations: [
      new HttpInstrumentation({
        // `/version`, `/version/worker` et `/metrics` sont interrogés en
        // continu par la gate de release et par Prometheus. Les tracer
        // remplirait Jaeger de bruit périodique.
        ignoreIncomingRequestHook: (req) => {
          const path = (req.url ?? '').split('?')[0] ?? '';
          return ['/metrics', '/version', '/version/worker', '/healthz'].includes(path);
        },
      }),
      new IORedisInstrumentation({
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
