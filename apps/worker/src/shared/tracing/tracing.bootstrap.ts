import { startTracing } from './tracing';

/**
 * Point d'entrée **à effet de bord** du traçage du worker (S-E02-14 / PF-78).
 *
 * Voir l'en-tête du jumeau côté API : `startTracing()` doit s'exécuter pendant
 * la phase d'import de `main`, avant que `./app.module` — et donc `ioredis`,
 * via BullMQ — soit résolu. L'instrumentation automatique patche les modules
 * au chargement ; démarrée après, elle ne patche rien et ne le dit pas.
 *
 * `scripts/tracing-check.js` vérifie cet ordre sur le `main.js` **émis**, pour
 * les deux applications, avec la même règle.
 */
const handle = startTracing();

// `console` et pas le `Logger` de Nest : ce fichier ne doit charger aucun
// module applicatif avant que les hooks d'instrumentation soient posés, et
// `Logger` vient de `@nestjs/common`.
// eslint-disable-next-line no-console
console.log(
  handle.config.enabled
    ? `[Tracing] enabled for ${handle.config.serviceName} — ${handle.config.reason}`
    : `[Tracing] disabled — ${handle.config.reason}`,
);

export { handle as tracingHandle };
