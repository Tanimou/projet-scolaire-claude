/**
 * Preflight release de l'API — l'implémentation a déménagé (S-E02-10 / PF-68).
 *
 * Voir `release-manifest.ts` pour le pourquoi : le worker exécute désormais le
 * MÊME preflight, avec la même règle de refus en production, donc il ne peut pas
 * vivre dans `apps/api`. Il est dans `@pilotage/contracts`, typé sur un
 * journal structurel (`ReleaseLogger`) auquel le `LoggerService` de Nest est
 * assignable — le paquet partagé n'acquiert donc aucune dépendance sur Nest.
 */
import type { LoggerService } from '@nestjs/common';
import {
  assertReleaseMatches as assertReleaseMatchesShared,
  type ReleaseManifest,
} from '@pilotage/contracts';

export { ReleaseDriftError } from '@pilotage/contracts';

/**
 * Refuse de servir du trafic depuis un artefact qui n'est pas celui attendu
 * (VAL-10, risque R-05). L'application est nommée explicitement : un manifeste
 * ne doit jamais pouvoir être attribué au mauvais artefact.
 */
export function assertReleaseMatches(logger: LoggerService): ReleaseManifest {
  return assertReleaseMatchesShared(logger, 'api');
}
