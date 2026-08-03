/**
 * Manifeste de release — l'implémentation a déménagé (S-E02-10 / PF-68).
 *
 * `S-E02-6` avait écrit ce comparateur ici, dans l'API. Le déploiement compte
 * pourtant trois artefacts (`api`, `worker`, `web`) construits et déployés
 * séparément : la moitié du déploiement n'était comparée à rien. La logique vit
 * maintenant dans `@pilotage/contracts`, le seul paquet dont les trois
 * applications dépendent déjà — une seule copie, donc une seule vérité.
 *
 * Ce fichier reste un ré-export : les points d'import de l'API ne changent pas,
 * et `release-manifest.spec.ts` continue d'exercer le comparateur partagé à
 * travers lui (la preuve exigée par G-MIGRATION est donc toujours exécutée par
 * la suite de l'API).
 */
export {
  SHA_DISPLAY_LENGTH,
  DIRTY_SUFFIX,
  evaluateRelease,
  isServable,
  readReleaseManifest,
  buildManifestPayload,
  type ReleaseApp,
  type ReleaseVerdict,
  type ReleaseManifest,
  type ReleaseManifestPayload,
} from '@pilotage/contracts';
