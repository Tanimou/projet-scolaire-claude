import { Registry, collectDefaultMetrics, Gauge, Histogram, Counter } from 'prom-client';

/**
 * Registre Prometheus de l'API (S-E02-13 / PF-56).
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE
 * ---------------------------------------------------------------------------
 * `infra/docker-compose.yml` déclare depuis toujours un profil `obs`
 * (Prometheus + Grafana + Loki). Mesuré au run 15 : les **trois** sources de
 * bind-mount de ce profil (`./grafana/prometheus.yml`, `./grafana/dashboards`,
 * `./grafana/provisioning`) **n'existaient pas** dans le dépôt, et aucune des
 * trois applications n'exposait la moindre métrique. Le profil ne pouvait donc
 * pas démarrer, et s'il avait démarré il n'aurait rien eu à scraper.
 *
 * C'est R-26 dans sa forme la plus pure : une capacité déclarée, jamais lue.
 *
 * ---------------------------------------------------------------------------
 * CARDINALITÉ ET VIE PRIVÉE — la contrainte de conception, pas un détail
 * ---------------------------------------------------------------------------
 * `/metrics` est un endpoint **non authentifié** (Prometheus ne porte pas de
 * jeton). Deux règles en découlent, toutes deux tenues par des tests :
 *
 *  1. Aucune étiquette ne doit contenir d'identifiant. On étiquette par le
 *     **gabarit de route** (`/api/v1/students/:id`), jamais par l'URL résolue
 *     (`/api/v1/students/clx123…`). Sinon chaque élève devient une série
 *     temporelle — c'est à la fois une explosion de cardinalité et une fuite
 *     d'identifiants de tenant vers une surface non authentifiée (G-TENANT).
 *  2. Le socket n'est jamais publié par nginx. `scripts/observability-check.js`
 *     échoue si une `location` du reverse-proxy expose `/metrics`.
 */

/**
 * Type de contenu de l'exposition Prometheus. Écrit en littéral parce qu'un
 * décorateur `@Header()` exige une constante — et vérrouillé par un test qui le
 * compare à `registry.contentType`, la valeur que prom-client considère comme
 * la sienne. Sans ce test, une montée de version de prom-client pourrait
 * changer le format sans changer l'en-tête qu'on annonce.
 */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** Registre dédié — jamais le registre global, qu'un import tiers pourrait polluer. */
export const registry = new Registry();

registry.setDefaultLabels({ app: 'api' });

collectDefaultMetrics({ register: registry });

/**
 * Latence des requêtes HTTP. C'est la métrique dont un SLO a besoin : sans
 * distribution de latence et sans taux d'erreur, « observabilité » se réduit à
 * de la santé de process (PF-56 demande explicitement des SLO).
 *
 * Les buckets sont en **secondes**, convention Prometheus.
 */
export const httpRequestDuration = new Histogram({
  name: 'pilotage_http_request_duration_seconds',
  help: 'Durée des requêtes HTTP servies par l’API, par gabarit de route',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestsTotal = new Counter({
  name: 'pilotage_http_requests_total',
  help: 'Nombre de requêtes HTTP servies par l’API, par gabarit de route',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

/**
 * S-E01-1d — la portée tenant est-elle RÉELLEMENT enforcée par la base ?
 *
 * `1` = la couture tourne sur une DEUXIÈME connexion non propriétaire
 * (`DATABASE_URL_APP`), dont la sonde de démarrage a prouvé qu'elle n'est ni le
 * propriétaire, ni `BYPASSRLS`, ni membre du propriétaire, et qu'elle détient
 * les privilèges de la clôture relationnelle du module converti.
 * `0` = tout le reste, et « tout le reste » se décline en DEUX états nommés dans
 * les logs : `degraded_no_app_url` (variable absente : la portée s'ouvre sur le
 * client propriétaire, donc rien n'est enforcé) et `refused_unusable` (variable
 * déclarée mais inutilisable : les sites convertis REFUSENT, ils ne se rabattent
 * pas).
 *
 * POURQUOI UNE JAUGE ET PAS UNE PHRASE DANS `/readyz` : la couverture de la
 * bascule est une propriété du DÉPLOIEMENT, pas de l'arbre source. Un compteur
 * de sites d'appel dans le dépôt peut monter pendant que chaque conteneur tourne
 * en mode dégradé parce que la variable n'est déclarée nulle part sous `infra/`.
 * C'est la forme même de PF-02 — la garde est proclamée, la garde n'est pas
 * déployée — et seule une métrique scrappée depuis le PROCESSUS peut la
 * contredire.
 *
 * AUCUNE ÉTIQUETTE. Ni tenant, ni hôte, ni rôle, ni nom de base : `/metrics` est
 * une surface NON authentifiée, et une étiquette d'identifiant y serait à la fois
 * une explosion de cardinalité et une fuite (G-TENANT). L'état détaillé se lit
 * dans les logs de démarrage, qui sont authentifiés par construction.
 *
 * Semée à 0 à la déclaration : « non prouvé » est la valeur par défaut, et une
 * absence de série ne doit jamais pouvoir se lire comme un vert.
 */
export const tenantScopeEnforced = new Gauge({
  name: 'pilotage_tenant_scope_enforced',
  help: 'La portée tenant tourne-t-elle sur une connexion non propriétaire soumise à RLS (1) ou en mode dégradé/refusé (0)',
  registers: [registry],
});

tenantScopeEnforced.set(0);

/** Étiquette utilisée quand aucune route ne correspond (404, middleware terminal). */
export const UNMATCHED_ROUTE = '<unmatched>';

/**
 * Forme minimale d'une requête Express dont dépend l'étiquetage. Déclarée ici
 * plutôt qu'importée d'`express` pour que la fonction reste **pure** et
 * testable avec des objets synthétiques — c'est la leçon de `S-E02-12` : une
 * évaluation qu'on ne peut piloter avec des entrées connues-fausses ne peut
 * démontrer que « ce dépôt va bien aujourd'hui ».
 */
export interface RouteLabelSource {
  route?: { path?: unknown } | undefined;
  baseUrl?: unknown;
  originalUrl?: unknown;
  url?: unknown;
}

/**
 * Dérive l'étiquette `route` d'une requête.
 *
 * **Ne lit jamais `originalUrl` ni `url`.** Ces champs portent les identifiants
 * résolus ; les accepter, même en repli, suffirait à faire fuiter des ids dans
 * une surface non authentifiée. Une requête sans route appariée est étiquetée
 * `<unmatched>` — une seule série, quel que soit le nombre d'URL inconnues
 * qu'un scanner peut inventer.
 */
export function routeLabel(req: RouteLabelSource): string {
  const path = req.route?.path;
  if (typeof path !== 'string' || path.length === 0) return UNMATCHED_ROUTE;

  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  const full = `${base}${path}`;
  return full.length > 0 ? full : UNMATCHED_ROUTE;
}
