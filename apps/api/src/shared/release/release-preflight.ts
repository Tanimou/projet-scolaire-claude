import type { LoggerService } from '@nestjs/common';

import {
  isServable,
  readReleaseManifest,
  type ReleaseManifest,
} from './release-manifest';

export class ReleaseDriftError extends Error {
  constructor(readonly manifest: ReleaseManifest) {
    super(
      `Preflight release ÉCHEC (${manifest.verdict}) : ${manifest.detail ?? 'artefact non identifiable'}\n` +
        `  build gravé : ${manifest.buildSha}\n` +
        `  attendu     : ${manifest.expectedSha ?? '(non déclaré)'}\n` +
        `L'API refuse de servir un artefact dont on ne peut pas prouver l'origine. ` +
        `Reconstruire et redéployer : bash scripts/deploy-prod.sh — ` +
        `voir docs/runbooks/release-gate.md`,
    );
    this.name = 'ReleaseDriftError';
  }
}

/**
 * Refuse de servir du trafic depuis un artefact qui n'est pas celui attendu
 * (S-E02-6 / VAL-10, risque R-05).
 *
 * Le contrôle est **opt-in par construction** : sans `EXPECTED_GIT_SHA` le verdict
 * est `unverified` et rien n'est bloqué, ce qui préserve tout déploiement existant.
 * Dès qu'une attente est déclarée, elle est stricte — il n'y a volontairement aucun
 * drapeau pour la désactiver (DNC-10) : ne pas déclarer l'attente EST l'interrupteur,
 * et il est visible dans `GET /version` au lieu d'être silencieux (DNC-08).
 *
 * Hors production, une dérive est journalisée en `warn` sans bloquer : un développeur
 * travaille légitimement au-dessus d'un artefact reconstruit en continu.
 */
export function assertReleaseMatches(logger: LoggerService): ReleaseManifest {
  const manifest = readReleaseManifest();
  const isProduction = process.env.NODE_ENV === 'production';

  if (isServable(manifest.verdict)) {
    if (manifest.verdict === 'unverified') {
      logger.warn?.(
        `Release non vérifiée — build ${manifest.buildSha}, aucun EXPECTED_GIT_SHA déclaré. ` +
          'Le déploiement ne prouve pas qu’il exécute le code attendu (R-05).',
        'ReleasePreflight',
      );
    } else {
      logger.log?.(
        `Preflight release OK — artefact ${manifest.buildSha} conforme à l’attendu.`,
        'ReleasePreflight',
      );
    }
    return manifest;
  }

  if (!isProduction) {
    logger.warn?.(
      `Dérive d’artefact détectée (${manifest.verdict}) hors production, démarrage autorisé : ${manifest.detail}`,
      'ReleasePreflight',
    );
    return manifest;
  }

  throw new ReleaseDriftError(manifest);
}
