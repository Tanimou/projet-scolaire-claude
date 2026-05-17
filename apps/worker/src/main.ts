import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';

import { AppModule } from './app.module';

async function bootstrap() {
  // eslint-disable-next-line no-console
  console.log('[Worker] Booting…');
  const app = await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('Worker');

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
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Worker bootstrap failed', err);
  process.exit(1);
});
