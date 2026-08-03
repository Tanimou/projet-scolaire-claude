import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';

import { MetricsController } from './metrics.controller';
import { MetricsMiddleware } from './metrics.middleware';

/**
 * Observabilité de l'API (S-E02-13 / PF-56).
 *
 * Le module n'importe rien et n'expose aucun provider : c'est délibéré. Une
 * dépendance de l'instrumentation vers le métier ferait de `/metrics` un
 * chemin qui peut tomber avec ce qu'il observe.
 *
 * Le middleware est appliqué à `*` — y compris `healthz`, `readyz`, `version`
 * et `metrics` lui-même. Exclure les surfaces d'exploitation rendrait
 * invisible la panne la plus banale d'un déploiement : un readiness qui met
 * huit secondes à répondre.
 */
@Module({
  controllers: [MetricsController],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MetricsMiddleware).forRoutes('*');
  }
}
