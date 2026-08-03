import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { registry, PROMETHEUS_CONTENT_TYPE } from './metrics.registry';

/**
 * Exposition Prometheus de l'API (S-E02-13 / PF-56).
 *
 * `/metrics` est **exclu du préfixe `api/v1`** (voir `main.ts`), comme
 * `healthz`, `readyz` et `version` : ce sont des surfaces d'exploitation, pas
 * des ressources métier versionnées. `scripts/observability-check.js` vérifie
 * que le chemin déclaré dans `infra/grafana/prometheus.yml` est bien une route
 * que l'application **boote** réellement, en la confrontant à
 * `scripts/boot-route-baseline.json` — sans quoi un contrôleur démonté
 * (la forme de PF-62) rendrait le scrape silencieusement vide.
 *
 * Non authentifié, et c'est délibéré : Prometheus ne porte pas de jeton, et un
 * secret partagé ici donnerait l'illusion d'un contrôle tout en plaçant ce
 * secret dans un fichier de configuration monté en lecture seule. Le contrôle
 * réel est le réseau — nginx ne publie pas ce chemin, et la gate échoue s'il se
 * met à le publier. La charge utile ne contient, par construction, aucune
 * donnée de tenant : voir la règle de cardinalité dans `metrics.registry.ts`.
 */
@ApiExcludeController()
@Controller()
export class MetricsController {
  @Get('metrics')
  @Header('content-type', PROMETHEUS_CONTENT_TYPE)
  @Header('cache-control', 'no-store')
  async metrics(): Promise<string> {
    return registry.metrics();
  }
}
