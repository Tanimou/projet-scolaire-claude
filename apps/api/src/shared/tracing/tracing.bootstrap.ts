import { startTracing } from './tracing';

/**
 * Point d'entrée **à effet de bord** du traçage (S-E02-14 / PF-78).
 *
 * Ce fichier existe pour une seule raison : `startTracing()` doit s'exécuter
 * pendant la phase d'import de `main`, avant que `./app.module` soit résolu.
 * Un appel depuis le corps de `bootstrap()` s'exécuterait après que *tous* les
 * imports du module ont été évalués — donc après `@nestjs/core`, `express` et
 * `http` — et l'instrumentation automatique ne patcherait plus rien.
 *
 * D'où la forme : `main.ts` fait `import './shared/tracing/tracing.bootstrap'`
 * juste après `reflect-metadata`, et rien d'autre n'importe ce fichier.
 * `scripts/observability-check.js` vérifie cet ordre sur le `main.js` **émis**.
 *
 * **Pourquoi `console` et pas le `Logger` de Nest**, alors que tout le reste du
 * dépôt utilise `Logger` : importer `@nestjs/common` ici ferait charger 364
 * modules avant que le SDK ait posé ses hooks (mesuré). Aucun des trois
 * paquets instrumentés n'en fait partie — également mesuré — mais la règle
 * « ce fichier ne charge rien avant le SDK » se vérifie d'un coup d'œil,
 * là où « ce fichier ne charge rien d'instrumenté » demande de refaire la
 * mesure à chaque montée de version de Nest. La règle vérifiable gagne.
 */
const handle = startTracing();

// Voir l'en-tête : ce fichier ne doit charger aucun module applicatif avant que
// les hooks d'instrumentation soient posés, et `Logger` vient de
// `@nestjs/common`.
// eslint-disable-next-line no-console
console.log(
  handle.config.enabled
    ? `[Tracing] enabled for ${handle.config.serviceName} — ${handle.config.reason}`
    : `[Tracing] disabled — ${handle.config.reason}`,
);

export { handle as tracingHandle };
