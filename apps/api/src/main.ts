import 'reflect-metadata';

import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { assertMigrationsClean } from './shared/migrations/migration-preflight';
import { PrismaService } from './shared/prisma/prisma.service';
import { assertReleaseMatches } from './shared/release/release-preflight';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  // Preflight schéma (S-E02-1 / PF-03) : ne jamais servir de trafic contre un
  // schéma inconnu. Lève et fait sortir le process en cas de migration absente,
  // en attente ou échouée — c'est volontairement bruyant (DNC-08).
  await assertMigrationsClean(app.get(PrismaService), logger);

  // Preflight release (S-E02-6 / VAL-10, R-05) : ne jamais servir un artefact
  // dont on ne peut pas prouver l'origine. Sans EXPECTED_GIT_SHA déclaré, le
  // verdict est `unverified` et rien n'est bloqué — l'attente est l'interrupteur.
  assertReleaseMatches(logger);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.setGlobalPrefix('api/v1', { exclude: ['healthz', 'readyz', 'version', '/'] });
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Pilotage scolaire API')
      .setDescription('REST API — /api/v1')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, doc, { useGlobalPrefix: false });
  }

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 API listening on http://localhost:${port}`);
  logger.log(`📘 Swagger UI:    http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
   
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
