/**
 * Déclarations écrites à la main pour `web-observability.js` (S-E02-15 / PF-79).
 *
 * Le module d'implémentation est du CommonJS simple **volontairement** : voir
 * l'en-tête de `web-observability.js`. `apps/web` n'a ni jest ni `dist/`, donc
 * un module TypeScript n'aurait pu être exécuté que par un `next build` de neuf
 * minutes — et une observabilité que personne ne peut exécuter est le défaut
 * même que cette épique traque.
 *
 * `tsconfig.json` inclut `src/**\/*.ts`, ce qui couvre ce fichier ; il ne
 * compile pas les `.js`. C'est donc ici que `src/instrumentation.ts` trouve son
 * contrat de types.
 */

import type { Server } from 'node:http';

/** Forme structurelle minimale d'un span lu par l'étiquetage. Zéro import OTel. */
export interface MetricSpanLike {
  readonly kind?: number;
  readonly attributes?: Record<string, unknown>;
  readonly duration?: readonly [number, number];
}

/** Forme structurelle d'un `SpanProcessor` OpenTelemetry. */
export interface MetricsSpanProcessorLike {
  onStart(): void;
  onEnd(span: MetricSpanLike): void;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
}

/** Configuration de traçage résolue — reprise verbatim de `@pilotage/contracts`. */
export interface WebTracingConfig {
  readonly enabled: boolean;
  readonly reason: string;
  readonly endpoint: string | undefined;
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly sampleRatio: number;
}

export interface WebObservabilityHandle {
  readonly config: WebTracingConfig;
  readonly provider: { shutdown(): Promise<void> };
  shutdown(): Promise<void>;
}

export interface StartWebObservabilityOptions {
  env?: NodeJS.ProcessEnv;
  /** Injecté par la sonde du gate pour n'avoir besoin d'aucun collecteur réel. */
  exporterFactory?: (config: WebTracingConfig) => unknown;
}

export interface MinimalLogger {
  log?(message: string): void;
  warn?(message: string): void;
}

export declare const PROMETHEUS_CONTENT_TYPE: string;
export declare const WEB_METRICS_PATH: string;
export declare const DEFAULT_WEB_METRICS_PORT: number;
export declare const HTTP_DURATION_METRIC: string;
export declare const HTTP_REQUESTS_METRIC: string;
export declare const HTTP_DURATION_BUCKETS: readonly number[];
export declare const UNMATCHED_ROUTE: string;
export declare const UNKNOWN_LABEL: string;

export declare const registry: { metrics(): Promise<string>; contentType: string };
export declare const httpRequestDuration: unknown;
export declare const httpRequestsTotal: unknown;

export declare function routeLabelFromSpan(span: MetricSpanLike): string;
export declare function methodLabelFromSpan(span: MetricSpanLike): string;
export declare function statusLabelFromSpan(span: MetricSpanLike): string;
export declare function spanDurationSeconds(span: MetricSpanLike): number;
export declare function createMetricsSpanProcessor(): MetricsSpanProcessorLike;

export declare function createMetricsServer(options?: {
  registry?: { metrics(): Promise<string> };
}): Server;
export declare function resolveMetricsPort(env?: NodeJS.ProcessEnv): number;
export declare function startMetricsServer(
  port?: number,
  logger?: MinimalLogger,
): Promise<Server | undefined>;
export declare function stopMetricsServer(): Promise<void>;

export declare function startWebObservability(
  options?: StartWebObservabilityOptions,
): WebObservabilityHandle;
export declare function resetWebObservabilityForTests(): void;
