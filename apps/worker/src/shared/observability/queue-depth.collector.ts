import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

import {
  QUEUE_EXPORTS,
  QUEUE_IMPORTS,
  QUEUE_NOTIFICATIONS_EMAIL,
} from '../queue/queue.module';

import {
  registerQueueDepthSources,
  unboundInstrumentedQueues,
  type QueueDepthSource,
} from './queue-metrics';

/**
 * Le seul endroit du dépôt où une file BullMQ rencontre le registre Prometheus
 * (S-E02-17 / ADR-028).
 *
 * `queue-metrics.ts` ne peut pas importer `bullmq` : la gate
 * (`scripts/observability-check.js`) requiert ce module-là dans son propre
 * processus et doit pouvoir en sortir. Les files arrivent donc par ici, à
 * `onModuleInit`, c'est-à-dire au boot Nest et nulle part ailleurs. Hors d'un
 * boot Nest — la gate, les tests unitaires — le collecteur reste débranché,
 * donc no-op.
 *
 * Aucune connexion n'est ouverte ici : `@InjectQueue` résout le `Queue` que
 * `QueueModule` a déjà enregistré (il exporte `BullModule`), et `getJobCounts`
 * n'est appelé qu'au moment du scrape.
 */
@Injectable()
export class QueueDepthCollector implements OnModuleInit {
  private readonly logger = new Logger(QueueDepthCollector.name);

  constructor(
    @InjectQueue(QUEUE_EXPORTS) private readonly exportsQueue: Queue,
    @InjectQueue(QUEUE_NOTIFICATIONS_EMAIL) private readonly notificationsQueue: Queue,
    @InjectQueue(QUEUE_IMPORTS) private readonly importsQueue: Queue,
  ) {}

  onModuleInit(): void {
    const queues = [this.exportsQueue, this.notificationsQueue, this.importsQueue];

    // DNC-01, par une porte que D1 ne nomme pas. BullMQ embarque SA PROPRE
    // jauge de profondeur — `QueueGetters.recordJobCountsMetric`
    // (classes/queue-getters.js) émet `MetricNames.QueueJobsCount`, étiquetée
    // par file et par état, dès que `queue.opts.telemetry` est renseigné. Ce
    // worker fait déjà tourner un SDK OpenTelemetry (`main.ts` →
    // `shared/tracing/tracing.bootstrap`), donc le jour où quelqu'un branche
    // `telemetry` sur les options BullMQ, un même nombre a deux sources. On ne
    // peut pas l'interdire depuis ici ; on peut le dire à voix haute.
    for (const queue of queues) {
      if (queue?.opts && (queue.opts as { telemetry?: unknown }).telemetry) {
        this.logger.warn(
          `File « ${queue.name} » : BullMQ telemetry est activé. Il publie sa propre ` +
            'profondeur de file — un même nombre, deux sources (DNC-01). Choisir laquelle ' +
            'des deux fait foi avant de garder les deux.',
        );
      }
    }

    // La confrontation des deux vocabulaires d'états a lieu ICI, et nulle part
    // ailleurs : `states` est contextuellement typé `JobStateName[]` (dérivé de
    // `JOB_STATES`) et passé au `getJobCounts(...types: JobType[])` de BullMQ.
    // Un huitième état mal orthographié devient une erreur de compilation sur
    // cette ligne — une couture en `string[]` l'accepterait en silence et la
    // jauge afficherait `0` sur une file engorgée.
    const sources: QueueDepthSource[] = queues
      .filter((queue): queue is Queue => !!queue && typeof queue.getJobCounts === 'function')
      .map(
        (queue): QueueDepthSource => ({
          queue: queue.name,
          getJobCounts: (...states) => queue.getJobCounts(...states),
        }),
      );

    registerQueueDepthSources(sources);
    this.logger.log(
      `Profondeur de file instrumentée pour ${sources.length} file(s) : ` +
        `${sources.map((source) => source.queue).join(', ')}`,
    );

    // S-E02-18 / PF-106 (résiduel). Le filtre ci-dessus laisse tomber une file
    // en silence, et le compte ci-dessus n'était comparé à rien. Le manque est
    // désormais lisible dans l'exposition
    // (`pilotage_queue_depth_sources_bound`) ET nommé ici — un `log` de
    // survivants ne dit pas laquelle manque, et c'est la seule information dont
    // dispose celui qui doit la rebrancher.
    //
    // Le manque n'est PAS recalculé ici : il est lu de la seule fonction qui
    // connaît les sources branchées (DNC-01).
    const missing = unboundInstrumentedQueues();
    if (missing.length > 0) {
      this.logger.error(
        `Profondeur NON branchée pour ${missing.length} file(s) instrumentée(s) : ` +
          `${missing.join(', ')}. Ces files publient une profondeur périmée ou absente ` +
          'alors que leur compteur d’échecs de collecte reste à zéro — donc saines à ' +
          'la lecture. Voir `pilotage_queue_depth_sources_bound`.',
      );
    }
  }
}
