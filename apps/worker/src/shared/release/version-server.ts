import { createServer, type Server } from 'node:http';

import { buildManifestPayload, type ReleaseLogger } from '@pilotage/contracts';

/**
 * Manifeste de release du worker (S-E02-10 / PF-68, risque R-05).
 *
 * ---------------------------------------------------------------------------
 * POURQUOI UN SERVEUR HTTP DANS UN EXÉCUTEUR DE TÂCHES
 * ---------------------------------------------------------------------------
 * Le worker démarre via `NestFactory.createApplicationContext` : il n'a
 * volontairement aucune surface HTTP, et c'est très bien pour son métier. Mais
 * l'image du worker porte un `GIT_SHA` gravé au build depuis `S-E02-6` que
 * **rien ne pouvait lire de l'extérieur** — `docker inspect` lit l'image, pas le
 * process qui tourne, et R-05 s'est matérialisé précisément parce que l'artefact
 * en cours d'exécution ne correspondait à aucune ref du dépôt.
 *
 * Une gate qui ne peut interroger qu'un artefact sur trois n'est pas une gate de
 * release : c'est une gate d'API. Ces ~60 lignes sont le prix pour que le worker
 * puisse être interrogé comme les deux autres.
 *
 * ---------------------------------------------------------------------------
 * SURFACE
 * ---------------------------------------------------------------------------
 * Une seule méthode (`GET`), deux chemins, une charge utile plate : un nom
 * d'application, des SHA courts, un verdict. Aucune donnée de tenant, aucune
 * chaîne de connexion, aucune information sur les files BullMQ. Le socket n'est
 * publié qu'en loopback sur l'hôte (voir infra/docker-compose.yml) et n'est
 * exposé publiquement qu'à travers `location = /version/worker` de nginx, qui est
 * rate-limité.
 *
 * `/version` et `/version/worker` répondent tous deux : le premier sert quand la
 * gate interroge le conteneur directement (c'est ce que fait
 * scripts/deploy-prod.sh), le second quand elle passe par le reverse-proxy, qui
 * préserve le chemin. Les deux renvoient `app: "worker"`, donc une confusion de
 * routage reste détectable.
 */

/** Port du manifeste. Loopback côté hôte ; joignable par nginx sur le réseau docker. */
export const DEFAULT_VERSION_PORT = 4001;

/** Les deux chemins qui servent le manifeste. Tout le reste est un 404. */
export const VERSION_PATHS = ['/version', '/version/worker'] as const;

export function resolveVersionPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.WORKER_HTTP_PORT ?? '').trim();
  if (!raw) return DEFAULT_VERSION_PORT;
  const parsed = Number.parseInt(raw, 10);
  // Un port illisible ne doit pas faire taire le manifeste : on retombe sur le
  // défaut plutôt que d'écouter sur un port aléatoire (0) ou de ne pas écouter.
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : DEFAULT_VERSION_PORT;
}

/**
 * Crée le serveur sans l'écouter — c'est ce qui rend le comportement testable
 * sans réserver un port fixe (le test écoute sur 0 et lit le port attribué).
 */
export function createVersionServer(): Server {
  return createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    const known = (VERSION_PATHS as readonly string[]).includes(path);

    if (req.method !== 'GET' || !known) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ statusCode: 404, message: 'Not Found' }));
      return;
    }

    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      // Un manifeste mis en cache décrirait l'artefact précédent — soit
      // exactement l'erreur que ce contrôle existe pour détecter.
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(buildManifestPayload('worker')));
  });
}

/** Démarre le serveur de manifeste. Résout quand le socket écoute réellement. */
export function startVersionServer(
  logger: ReleaseLogger,
  port: number = resolveVersionPort(),
): Promise<Server> {
  const server = createVersionServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      logger.log?.(`Manifeste de release du worker sur :${port}/version/worker`, 'ReleaseManifest');
      resolve(server);
    });
  });
}
