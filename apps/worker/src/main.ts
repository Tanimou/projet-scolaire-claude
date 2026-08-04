import 'reflect-metadata';
// Traçage (S-E02-14 / PF-78) — même règle que côté API : cet import doit rester
// le premier après `reflect-metadata`, sans quoi `ioredis` (chargé par BullMQ
// via `./app.module`) est résolu avant que l'instrumentation ait posé ses
// hooks. Vérifié sur le `main.js` émis par `scripts/tracing-check.js`.
import './shared/tracing/tracing.bootstrap';

import { writeFile } from 'node:fs/promises';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { assertReleaseMatches } from '@pilotage/contracts';

import { AppModule } from './app.module';
import { startVersionServer } from './shared/release/version-server';

async function bootstrap() {
  // eslint-disable-next-line no-console
  console.log('[Worker] Booting…');

  // Preflight release AVANT toute connexion (S-E02-10 / PF-68, risque R-05) :
  // un worker qui exécute le mauvais artefact consomme des files réelles et
  // écrit des données réelles. Il doit refuser de démarrer exactement comme
  // l'API refuse de servir. Même règle, même code partagé : sans EXPECTED_GIT_SHA
  // le verdict est `unverified` et rien n'est bloqué (DNC-08/DNC-10).
  const bootLogger = new Logger('Worker');
  assertReleaseMatches(bootLogger, 'worker');

  const app = await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('Worker');

  // Le worker n'a pas de surface HTTP métier — ce socket ne sert QUE le
  // manifeste de release, pour que la gate puisse interroger les trois artefacts
  // et pas seulement l'API. Voir shared/release/version-server.ts.
  const versionServer = await startVersionServer(logger);

  logger.log('🛠  Worker started — exports processor + alerts cron armed');

  // Heartbeat file pour Docker healthcheck
  const heartbeat = setInterval(() => {
    void writeFile('/tmp/worker-alive', new Date().toISOString()).catch(() => {
      /* ignore on platforms without /tmp */
    });
  }, 30_000);
  await writeFile('/tmp/worker-alive', new Date().toISOString()).catch(() => undefined);

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, shutting down…`);
    clearInterval(heartbeat);
    await new Promise<void>((resolve) => versionServer.close(() => resolve()));
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {

  console.error('Worker bootstrap failed', err);
  process.exit(1);
});
