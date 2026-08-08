/**
 * Preflight de configuration — l'API refuse de démarrer sur des identifiants
 * par défaut (S-E06-1 / PF-54).
 *
 * CE QUE CE FICHIER FERME
 * -----------------------
 * `shared/keycloak/keycloak-admin.service.ts` lisait ses trois valeurs
 * d'administration Keycloak avec un `??` :
 *
 *     config.get('KEYCLOAK_ADMIN_USER')     ?? 'admin'
 *     config.get('KEYCLOAK_ADMIN_PASSWORD') ?? 'admin'
 *     config.get('KEYCLOAK_URL')            ?? 'http://localhost:8180'
 *
 * Ces défauts n'étaient pas décoratifs : `infra/docker-compose.yml` ne posait
 * NI `KEYCLOAK_ADMIN_USER` NI `KEYCLOAK_ADMIN_PASSWORD` sur l'ancre `x-app-env`,
 * donc la pile hébergée s'authentifiait réellement en `admin`/`admin` — et un
 * `KEYCLOAK_URL` oublié en production aurait pointé un client d'administration
 * privilégié sur `localhost`, sans une seule ligne de log pour le dire.
 *
 * Un défaut silencieux transforme une erreur de déploiement en faille : c'est
 * exactement la forme que V3 refuse. Le remplacement est bruyant et nommé.
 *
 * FORME
 * -----
 * Même moule que `shared/migrations/migration-preflight.ts` et
 * `shared/release/release-preflight.ts` : une fonction pure, arguments en
 * entrée, aucun DI, aucun réseau, aucune lecture directe de l'environnement du
 * processus (la source est un argument, ce qui la rend testable). Elle est
 * appelée depuis `main.ts` — PAS depuis un constructeur de provider — parce que
 * `scripts/boot-check.js` construit le graphe de modules depuis
 * `dist/app.module.js` et n'exécute jamais `bootstrap()` : un jet dans un
 * constructeur ferait échouer l'étape 7 de la gate sur un checkout sans `.env`,
 * ce qui punirait la gate plutôt que le défaut.
 *
 * DNC-10 — AUCUN CONTOURNEMENT
 * ----------------------------
 * Contrairement à `MIGRATION_PREFLIGHT=off` (dont la story parente autorisait
 * explicitement la variante non-production), il n'y a ici AUCUNE variable
 * d'échappement : ni `SKIP_*`, ni `ALLOW_*`, ni `CONFIG_PREFLIGHT=off`, et
 * `NODE_ENV=development` ne change rien. Une configuration absente est une
 * configuration absente ; un identifiant par défaut n'est jamais acceptable,
 * pas même « juste en local » — c'est ainsi qu'il finit en production.
 *
 * FUITE — CE QUI N'EST JAMAIS JOURNALISÉ
 * --------------------------------------
 * Le message ne contient QUE des NOMS de variables. Jamais une valeur, jamais
 * un préfixe de valeur, jamais un vidage complet de l'environnement : la sortie
 * part dans stdout, dans les logs collectés et dans le pipeline de traces
 * (S-E02-14), qui redirige mais ne devine pas.
 */

/**
 * Les variables sans lesquelles l'API ne peut pas parler à Keycloak
 * honnêtement.
 *
 * `KEYCLOAK_REALM` n'y figure PAS **délibérément** : ce n'est pas une valeur de
 * développement mais une constante produit — ADR-004 fixe « 1 realm / 3 clients »
 * et le realm s'appelle `pilotage-scolaire` partout, dev comme production. Un
 * défaut sur une constante produit est une valeur par défaut ; un défaut sur une
 * URL ou un identifiant d'administration est un secret implicite. Seuls les
 * seconds sont exigés ici.
 *
 * `TRUST_PROXY_HOPS` rejoint la liste avec S-E04-3 (ADR-036 D3) pour la MÊME
 * raison, appliquée à une propriété du déploiement plutôt qu'à un secret : le
 * nombre de proxys inverses vaut 2 en production (Traefik → nginx → api) et 0
 * en local (`--profile app`, nginx porte `profiles: ["prod"]`). Un littéral
 * serait donc silencieusement faux dans l'un des deux — et la panne d'un mauvais
 * compte de sauts n'est pas un crash : c'est une adresse *plausible* stockée
 * dans une piste d'audit et rendue à un auditeur comme le lieu où une personne
 * se trouvait. La VALEUR est validée par `parseTrustProxyHops`
 * (`shared/config/trust-proxy.ts`) ; ici on n'exige que sa DÉCLARATION, pour que
 * l'oubli soit nommé par le même message d'un seul jet que les trois autres.
 *
 * `AUDIT_FORWARD_TOKEN` n'y figure PAS, délibérément (ADR-036 D9) : son absence
 * est *fail-safe* — la provenance devient nulle et l'UI le dit — là où un mauvais
 * compte de sauts est silencieusement faux. L'exiger empêcherait de démarrer un
 * opérateur qui n'a pas encore distribué le secret, ce qui est exactement la
 * pression qui a produit le `?? 'admin'` de PF-54.
 */
export const REQUIRED_ENV = [
  'KEYCLOAK_URL',
  'KEYCLOAK_ADMIN_USER',
  'KEYCLOAK_ADMIN_PASSWORD',
  'TRUST_PROXY_HOPS',
] as const;

export type RequiredEnvName = (typeof REQUIRED_ENV)[number];

/**
 * Journal structurel minimal — le `LoggerService` de Nest lui est assignable,
 * donc ce module n'acquiert aucune dépendance sur Nest et reste testable sans
 * conteneur DI.
 */
export interface ConfigPreflightLogger {
  log?: (message: string, context?: string) => void;
}

export class MissingConfigError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(
      `Preflight configuration ÉCHEC — ${missing.length} variable(s) requise(s) absente(s) ou vide(s) : ` +
        `${missing.join(', ')}\n` +
        missing.map((name) => `  ${name} : non déclarée, vide, ou uniquement des espaces`).join('\n') +
        `\n` +
        `L'API REFUSE de retomber sur des identifiants d'administration par défaut ` +
        `(S-E06-1 / PF-54), ni sur un nombre de proxys inverses deviné ` +
        `(S-E04-3 / ADR-036 D3). Un défaut silencieux fait tourner la production sur le compte ` +
        `d'amorçage de Keycloak — ou fait enregistrer l'adresse d'un relais comme celle de ` +
        `l'opérateur — sans que rien ne le dise.\n` +
        `Déclarez ces variables : infra/docker-compose.yml (ancre x-app-env), ` +
        `infra/docker-compose.prod.yml (service api) et .env.prod. ` +
        `Aucune variable d'environnement ne peut désactiver ce contrôle (DNC-10).`,
    );
    this.name = 'MissingConfigError';
  }
}

/** Absente, vide, ou uniquement des espaces — les trois sont « non configurée ». */
function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

/**
 * Vérifie que TOUTES les variables requises sont présentes, et nomme CHACUNE
 * des manquantes en un seul jet.
 *
 * Le « un seul jet » est le point : échouer sur la première ferait découvrir les
 * trois en trois déploiements. L'opérateur doit voir la liste complète du
 * premier coup.
 *
 * @param env    la source de configuration (l'environnement du processus, passé
 *               explicitement par `main.ts`)
 * @param logger journal optionnel — le succès est journalisé, jamais les valeurs
 * @throws MissingConfigError si au moins une variable requise est absente/vide
 */
export function assertRequiredConfig(
  env: Record<string, string | undefined>,
  logger?: ConfigPreflightLogger,
): void {
  const missing = REQUIRED_ENV.filter((name) => isBlank(env[name]));

  if (missing.length > 0) {
    throw new MissingConfigError(missing);
  }

  logger?.log?.(
    `Preflight configuration OK — ${REQUIRED_ENV.length} variable(s) requise(s) déclarée(s) : ` +
      `${REQUIRED_ENV.join(', ')}.`,
    'ConfigPreflight',
  );
}
