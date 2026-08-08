import 'reflect-metadata';
// Traçage (S-E02-14 / PF-78) — CET IMPORT DOIT RESTER LE PREMIER APRÈS
// `reflect-metadata`. L'instrumentation OpenTelemetry patche `http`, `express`
// et `@nestjs/core` au moment où ils sont chargés ; démarrée après eux, elle ne
// patche rien, ne lève aucune erreur, et l'application paraît instrumentée sans
// émettre un seul span de requête. `scripts/tracing-check.js` vérifie cet ordre
// sur le `main.js` **émis**, pas sur ce fichier.
import './shared/tracing/tracing.bootstrap';

import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import {
  AUDIT_FORWARD_TOKEN_ENV,
  configureAuditClientHints,
} from './shared/audit/client-hints';
import { assertRequiredConfig } from './shared/config/config-preflight';
import { applyTrustProxy } from './shared/config/trust-proxy';
import { assertMigrationsClean } from './shared/migrations/migration-preflight';
import { PrismaService } from './shared/prisma/prisma.service';
import { assertReleaseMatches } from './shared/release/release-preflight';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Preflight configuration (S-E06-1 / PF-54) : l'API refuse de démarrer sur des
  // identifiants d'administration Keycloak par défaut. EN PREMIER, avant même la
  // construction du graphe de modules — une variable oubliée ne doit pas attendre
  // derrière un aller-retour base de données pour se faire connaître, et le
  // message nomme TOUTES les variables absentes en un seul jet.
  //
  // Ici et pas dans un constructeur de provider : `scripts/boot-check.js`
  // construit le graphe depuis `dist/app.module.js` sans jamais exécuter
  // `bootstrap()`, donc un jet en constructeur ferait échouer l'étape 7 de la
  // gate sur un checkout sans `.env` — la même raison qui met déjà le preflight
  // de migrations ici.
  assertRequiredConfig(process.env, logger);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Provenance client (S-E04-3 / PF-31, ADR-036 D1/D2/D3/D9) — DEUX lignes, et
  // les deux sont des applications d'une décision écrite, jamais une valeur
  // choisie ici.
  //
  // 1. Le nombre de proxys inverses `N` est PINNÉ depuis une clé de
  //    configuration qui refuse de démarrer si elle est absente ou illisible
  //    (`TRUST_PROXY_HOPS`, dans `REQUIRED_ENV`). Jamais `true`, jamais `'*'` :
  //    ces formes disent à Express de croire l'entrée la plus à gauche de
  //    `X-Forwarded-For` de N'IMPORTE QUEL appelant, donc n'importe qui choisit
  //    ce que la piste de gouvernance enregistre à son sujet (ADR-036 D1, refusé
  //    par écrit). L'unique appel à `app.set('trust proxy', …)` de tout
  //    `apps/api` est dans `shared/config/trust-proxy.ts` — la même fonction que
  //    le harnais supertest exécute, pour qu'un test prouve l'artefact livré et
  //    non une réimplémentation de l'artefact.
  //
  // 2. Le `N` appliqué et le jeton de transfert partagé sont passés au SEUL
  //    point d'extraction (`shared/audit/client-hints.ts`) par argument. Ce
  //    fichier-ci est donc le seul endroit où `AUDIT_FORWARD_TOKEN` est lu, et
  //    la valeur ne quitte jamais le processus : elle est immédiatement
  //    condensée en empreinte, et seule la PRÉSENCE est journalisée. Une
  //    rotation qui met à jour l'API avant le web produit une fenêtre où toute
  //    provenance redevient nulle — la bonne direction, mais invisible ; cette
  //    ligne de log est ce qui la rend découvrable.
  const trustedHops = applyTrustProxy(app, process.env);
  const forwardTokenConfigured = configureAuditClientHints({
    trustedHops,
    forwardToken: process.env[AUDIT_FORWARD_TOKEN_ENV],
  });
  logger.log(
    `Provenance d'audit — trust proxy pinné à ${trustedHops} saut(s) (ADR-036 D2) ; ` +
      `jeton de transfert ${forwardTokenConfigured ? 'configuré' : 'NON configuré (provenance client nulle, ADR-036 D4)'}.`,
  );

  // Preflight schéma (S-E02-1 / PF-03) : ne jamais servir de trafic contre un
  // schéma inconnu. Lève et fait sortir le process en cas de migration absente,
  // en attente ou échouée — c'est volontairement bruyant (DNC-08).
  await assertMigrationsClean(app.get(PrismaService), logger);

  // Preflight release (S-E02-6 / VAL-10, R-05) : ne jamais servir un artefact
  // dont on ne peut pas prouver l'origine. Sans EXPECTED_GIT_SHA déclaré, le
  // verdict est `unverified` et rien n'est bloqué — l'attente est l'interrupteur.
  assertReleaseMatches(logger);

  // Politique de sécurité du contenu (S-E06-2 / PF-45).
  //
  // Cette ligne disait `contentSecurityPolicy: false` : helmet était appelé, et
  // la seule directive qui transforme une injection en non-événement était la
  // seule désactivée.
  //
  // L'API ne sert PAS le portail — c'est `apps/web` qui rend le HTML, et sa
  // politique (avec nonce, par requête) est construite dans son middleware. Ici
  // la surface est du JSON, plus Swagger hors production. La politique correcte
  // pour du JSON est donc la plus stricte qui existe : `default-src 'none'`. Une
  // réponse d'API ne charge rien, et si un jour elle rend du HTML par accident
  // (page d'erreur d'un framework, upload rejoué), ce HTML n'exécutera rien.
  //
  // Swagger UI, lui, est une vraie page : il injecte ses styles et son script
  // d'amorçage en ligne. Il n'est monté que hors production (voir plus bas), et
  // sa politique élargie est portée par la MÊME condition — les deux ne peuvent
  // pas diverger, parce qu'un seul booléen les décide.
  const swaggerEnabled = process.env.NODE_ENV !== 'production';
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: swaggerEnabled
          ? {
              'default-src': ["'none'"],
              'script-src': ["'self'", "'unsafe-inline'"],
              'style-src': ["'self'", "'unsafe-inline'"],
              'img-src': ["'self'", 'data:'],
              'connect-src': ["'self'"],
              'font-src': ["'self'", 'data:'],
              'base-uri': ["'none'"],
              'form-action': ["'none'"],
              'frame-ancestors': ["'none'"],
            }
          : {
              'default-src': ["'none'"],
              'base-uri': ["'none'"],
              'form-action': ["'none'"],
              'frame-ancestors': ["'none'"],
            },
      },
    }),
  );
  // `metrics` rejoint les surfaces d'exploitation hors préfixe versionné
  // (S-E02-13 / PF-56) : Prometheus scrape un chemin fixe, et le faire migrer
  // avec la version de l'API métier casserait la configuration de scrape à
  // chaque montée de version.
  app.setGlobalPrefix('api/v1', { exclude: ['healthz', 'readyz', 'version', 'metrics', '/'] });
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
