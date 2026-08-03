import { Injectable, type NestMiddleware } from '@nestjs/common';

import {
  httpRequestDuration,
  httpRequestsTotal,
  routeLabel,
  type RouteLabelSource,
} from './metrics.registry';

/**
 * Forme minimale des objets Express utilisés ici. Volontairement structurelle :
 * le middleware ne doit dépendre de rien qu'un test ne puisse fabriquer.
 */
export interface MetricsRequest extends RouteLabelSource {
  method?: unknown;
}
export interface MetricsResponse {
  statusCode?: unknown;
  on(event: 'finish', listener: () => void): unknown;
}

/**
 * Observe chaque requête **sans se placer sur son chemin** (S-E02-13 / PF-56).
 *
 * L'implémentation évidente — un interceptor Nest qui enveloppe le handler —
 * met du code de mesure entre le client et la réponse. Ici on s'abonne
 * seulement à `finish` de la réponse : rien n'est enveloppé, aucune exception
 * de mesure ne peut se propager dans la requête, et `next()` est appelé
 * immédiatement.
 *
 * L'étiquetage se fait **après** le handler, parce que c'est seulement à ce
 * moment qu'Express a rempli `req.route` avec le gabarit apparié — le lire
 * avant donnerait `<unmatched>` pour toutes les requêtes.
 */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: MetricsRequest, res: MetricsResponse, next: () => void): void {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      try {
        const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        const labels = {
          method: typeof req.method === 'string' ? req.method : 'UNKNOWN',
          route: routeLabel(req),
          status_code: String(typeof res.statusCode === 'number' ? res.statusCode : 0),
        };
        httpRequestDuration.observe(labels, seconds);
        httpRequestsTotal.inc(labels);
      } catch {
        // Une panne d'instrumentation ne doit jamais dégrader le service : la
        // requête est déjà servie à ce point, et un throw ici remonterait dans
        // l'émetteur d'événements du serveur.
      }
    });

    next();
  }
}
