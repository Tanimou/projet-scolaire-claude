/**
 * Hook `register()` de Next 15 — le point d'entrée de l'observabilité web
 * (S-E02-15 / PF-79).
 *
 * ---------------------------------------------------------------------------
 * CE FICHIER EST DÉLIBÉRÉMENT MINCE
 * ---------------------------------------------------------------------------
 * Il ne contient que du câblage. Toute la logique vit dans
 * `./observability/web-observability.js`, pour la raison expliquée en tête de
 * ce module-là : `apps/web` n'a ni runner de tests ni `dist/`, donc du
 * TypeScript ici ne serait exécutable que par un `next build`. Le CJS voisin,
 * lui, est exécuté par la spec de garde hébergée dans `apps/api` **et** par la
 * sonde enfant du gate, sans aucun build.
 *
 * ---------------------------------------------------------------------------
 * TROIS RÈGLES, TOUTES PORTEUSES
 * ---------------------------------------------------------------------------
 *  1. **Le garde `NEXT_RUNTIME`, et sa FORME.** `apps/web/src/middleware.ts`
 *     existe, donc Next compile ce fichier pour le runtime **edge** aussi, où
 *     ni `node:http` ni `prom-client` n'existent.
 *
 *     La forme du garde est porteuse, et ça a été **mesuré, pas supposé** : la
 *     première version de ce fichier sortait tôt (`if (… !== 'nodejs') return;`)
 *     puis appelait `import()` au niveau du corps de la fonction. `next build`
 *     a échoué avec seize erreurs `Module not found: Can't resolve 'fs' / 'v8' /
 *     'cluster'`, toutes tracées `./src/instrumentation.ts →
 *     ./src/observability/web-observability.js → prom-client`. Un retour
 *     anticipé n'est pas une frontière que webpack peut voir : le `import()`
 *     reste **statiquement atteignable** depuis l'entrée, donc le compilateur
 *     edge le résout — et échoue — avant que la moindre ligne s'exécute.
 *
 *     `process.env.NEXT_RUNTIME` est remplacé littéralement par la
 *     `DefinePlugin` de Next à la compilation. Placer l'`import()` **à
 *     l'intérieur** du bloc `if` transforme donc la branche edge en
 *     `if ('edge' === 'nodejs')`, que l'élimination de code mort supprime avec
 *     son import. C'est aussi la forme exacte que documente Next, et la raison
 *     pour laquelle elle est documentée ainsi.
 *  2. **Le chargement par `await import()`.** Un import statique serait résolu
 *     par webpack pour les deux runtimes, bloc `if` ou pas : c'est la
 *     résolution, pas l'exécution, qui casse le bundle edge. Les deux règles
 *     sont nécessaires ; aucune ne suffit seule.
 *  3. **`register()` ne peut pas lever.** Une exception ici est fatale au
 *     démarrage de Next — elle ferait d'une observabilité *optionnelle* une
 *     dépendance de boot du seul artefact que les utilisateurs touchent. Une
 *     panne de collecteur, un port déjà pris, un module manquant : tout est
 *     journalisé et avalé. L'inverse de valeur serait exactement le défaut que
 *     cette épique existe pour empêcher.
 *
 * ---------------------------------------------------------------------------
 * ET SURTOUT : L'ÉTAT EST JOURNALISÉ, ACTIVÉ COMME DÉSACTIVÉ
 * ---------------------------------------------------------------------------
 * Ce qui manquait à PF-78 puis à PF-79, ce n'était pas seulement du code :
 * c'était le moyen de s'apercevoir qu'il n'y en avait pas. La `reason` que rend
 * `resolveTracingConfig` est donc écrite au démarrage dans les deux cas
 * (DNC-08 : un état inerte est rapporté honnêtement, jamais déguisé en succès).
 * Il n'existe aucun drapeau de contournement (DNC-10) — ne pas déclarer de
 * collecteur *est* l'interrupteur, et il ne concerne que l'export : les
 * métriques, elles, sont toujours servies.
 */
export async function register(): Promise<void> {
  // Règle 1 — voir l'en-tête. Le test est ÉGALITÉ et l'`import()` vit DANS le
  // bloc : c'est ce qui rend la branche edge éliminable. Un `!== 'nodejs'` avec
  // retour anticipé compile, puis casse `next build`.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      // Règle 2 — rien de ceci n'est résolu sur le chemin edge.
      const observability = await import('./observability/web-observability.js');

      const handle = observability.startWebObservability();
      // `console.info` et pas `console.log` : la règle `no-console` du workspace
      // n'autorise que warn/error/info, et le compteur d'avertissements est un
      // cliquet — le relever est précisément le geste qu'il existe pour refuser.
      console.info(
        `[observability] web tracing ${handle.config.enabled ? 'enabled' : 'disabled'} — ` +
          `${handle.config.reason} (service ${handle.config.serviceName})`,
      );

      await observability.startMetricsServer();
    } catch (error) {
      // Règle 3 — journaliser, puis continuer. Une page doit s'afficher même
      // quand rien de tout ceci n'a fonctionné.
      console.error(
        '[observability] web observability failed to start; the application continues without it',
        error,
      );
    }
  }
}
