import { Module } from '@nestjs/common';

import { QueueModule } from '../queue/queue.module';

import { QueueDepthCollector } from './queue-depth.collector';

/**
 * Branche l'instrumentation BullMQ sur le registre Prometheus du worker
 * (S-E02-17 / PF-56).
 *
 * Ce module n'apporte **que** le collecteur de profondeur. Les métriques
 * elles-mêmes sont déclarées à la portée du module dans `queue-metrics.ts`,
 * donc elles existent — et sont lisibles par la gate — même quand ce module
 * n'est jamais instancié.
 *
 * `imports: [QueueModule]` suit l'idiome déjà en place (`alerts-cron.module.ts`,
 * `exports.module.ts` côté API) : `QueueModule` exporte `BullModule`, ce qui
 * rend les jetons `BullQueue_*` résolvables par `@InjectQueue` **dans ce
 * module**. Aucune file n'est enregistrée ici — les enregistrer une seconde
 * fois serait une seconde source pour la même file.
 */
@Module({
  imports: [QueueModule],
  providers: [QueueDepthCollector],
})
export class ObservabilityModule {}
