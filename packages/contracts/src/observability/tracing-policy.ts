/**
 * Politique de traçage partagée par l'API et le worker (S-E02-14 / PF-78).
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE FICHIER EST DANS `contracts` ET PAS DANS CHAQUE APPLICATION
 * ---------------------------------------------------------------------------
 * C'est la leçon de `S-E02-10`, à une adresse plus dangereuse. Le comparateur
 * de release avait été écrit trois fois ; une copie dérive, et une copie
 * dérivée rend vert le tiers du déploiement qu'elle ne regarde pas.
 *
 * Ici l'enjeu n'est pas un verdict mais une **fuite**. La règle de
 * caviardage ci-dessous est la preuve G-TENANT de cette slice : si l'API et le
 * worker en portaient chacun leur version, il suffirait qu'une des deux
 * oublie `db.statement` pour que des clés Redis contenant des identifiants de
 * tenant partent vers un collecteur non authentifié — et rien ne le dirait.
 * Une seule copie, deux consommateurs, un seul jeu de tests.
 *
 * Le module est **pur** : aucun import d'OpenTelemetry. Le SDK est un détail
 * d'exécution de chaque application ; la politique, elle, doit pouvoir être
 * pilotée par des entrées synthétiques (la leçon de `S-E02-12` : une
 * évaluation qu'on ne peut pas nourrir de valeurs connues-fausses ne démontre
 * jamais qu'elle attraperait une régression).
 */

/* -------------------------------------------------------------------------- *
 * 1. Résolution de configuration
 * -------------------------------------------------------------------------- */

/** Nom logique d'un service émetteur. Fermé volontairement : voir `TRACED_SERVICES`. */
export type TracedService = 'api' | 'worker' | 'web';

/**
 * Les services qui émettent réellement des spans.
 *
 * **C'est la moitié la plus importante de la fiche PF-78.** Avant `S-E02-14`,
 * `OTEL_EXPORTER_OTLP_ENDPOINT` était posé sur l'ancre d'environnement
 * partagée de `infra/docker-compose.yml`, donc distribué à **cinq** services :
 * `migrator`, `api`, `worker`, `web` et `seed`. Trois d'entre eux ne pouvaient
 * pas émettre quoi que ce soit — deux sont des jobs one-shot, le troisième est
 * une application Next.js dont l'instrumentation passe par un tout autre
 * mécanisme. Déclarer un collecteur à un service qui ne l'utilisera jamais,
 * c'est exactement PF-78 en miniature, répété trois fois.
 *
 * **`'web'` revient ici en `S-E02-15` (PF-79), et cette fois le mécanisme
 * existe.** `S-E02-14` avait *retiré* la variable du service `web` plutôt que
 * de laisser une fausse déclaration ; la remettre n'est légitime que parce que
 * `apps/web/src/instrumentation.ts` démarre désormais un vrai fournisseur de
 * traces via le hook `register()` de Next 15. La liste n'est donc jamais une
 * intention : c'est la liste des artefacts qui, mesure faite, émettent.
 *
 * `resolveTracingConfig(env, 'web')` en dérive `serviceName: 'pilotage-web'`
 * sans un mot de plus — c'est tout le bénéfice d'avoir une seule liste.
 *
 * `scripts/observability-check.js` et `scripts/tracing-check.js` comparent
 * cette liste aux services qui reçoivent la variable dans le compose : toute
 * divergence échoue la gate, dans les deux sens.
 */
export const TRACED_SERVICES: readonly TracedService[] = ['api', 'worker', 'web'];

export interface TracingEnv {
  OTEL_EXPORTER_OTLP_ENDPOINT?: string | undefined;
  OTEL_SDK_DISABLED?: string | undefined;
  OTEL_TRACES_SAMPLER_ARG?: string | undefined;
  GIT_SHA?: string | undefined;
  NODE_ENV?: string | undefined;
}

export interface TracingConfig {
  /** Le SDK doit-il démarrer ? */
  readonly enabled: boolean;
  /** Pourquoi — toujours renseigné, y compris quand `enabled` est vrai. */
  readonly reason: string;
  /** URL du collecteur OTLP/HTTP des traces, `undefined` si désactivé. */
  readonly endpoint: string | undefined;
  readonly serviceName: string;
  readonly serviceVersion: string;
  /** Ratio d'échantillonnage dans [0, 1]. */
  readonly sampleRatio: number;
}

const DEFAULT_SAMPLE_RATIO = 1;

/**
 * Dérive la configuration de traçage à partir de l'environnement.
 *
 * **L'absence d'endpoint désactive, et le dit.** C'est délibérément le même
 * choix que `assertReleaseMatches` fait pour `EXPECTED_GIT_SHA` (S-E02-10) :
 * ne pas déclarer d'attente *est* l'interrupteur, et l'état est rapporté
 * honnêtement plutôt que déguisé en succès (DNC-08). Il n'existe pas de
 * drapeau « traçage forcé » qui contournerait quoi que ce soit ; `reason`
 * existe pour que l'état inerte soit **lisible dans les logs**, ce qui est
 * précisément ce qui manquait à PF-78 pendant toute son existence.
 */
export function resolveTracingConfig(env: TracingEnv, service: TracedService): TracingConfig {
  const serviceVersion = nonEmpty(env.GIT_SHA) ?? 'unknown';
  const base = { serviceName: `pilotage-${service}`, serviceVersion };

  if (truthy(env.OTEL_SDK_DISABLED)) {
    return {
      ...base,
      enabled: false,
      endpoint: undefined,
      sampleRatio: 0,
      reason: 'OTEL_SDK_DISABLED is set',
    };
  }

  const endpoint = nonEmpty(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  if (endpoint === undefined) {
    return {
      ...base,
      enabled: false,
      endpoint: undefined,
      sampleRatio: 0,
      reason: 'OTEL_EXPORTER_OTLP_ENDPOINT is not set — no collector declared',
    };
  }

  if (!/^https?:\/\//i.test(endpoint)) {
    return {
      ...base,
      enabled: false,
      endpoint: undefined,
      sampleRatio: 0,
      reason: `OTEL_EXPORTER_OTLP_ENDPOINT is not an http(s) URL: ${endpoint}`,
    };
  }

  return {
    ...base,
    enabled: true,
    endpoint,
    sampleRatio: parseSampleRatio(env.OTEL_TRACES_SAMPLER_ARG),
    reason: `exporting to ${endpoint}`,
  };
}

function parseSampleRatio(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SAMPLE_RATIO;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return DEFAULT_SAMPLE_RATIO;
  return parsed;
}

function nonEmpty(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

function truthy(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === 'true';
}

/* -------------------------------------------------------------------------- *
 * 2. Caviardage — la contrainte G-TENANT de cette slice
 * -------------------------------------------------------------------------- */

/**
 * Jeton de remplacement des segments identifiants.
 *
 * Volontairement identique au style de gabarit qu'utilise déjà l'étiquetage
 * Prometheus (`/api/v1/students/:id`, cf. `metrics.registry.ts`), pour que les
 * deux surfaces d'observabilité nomment la même route de la même façon. Sans
 * ça, corréler une latence anormale et une trace demanderait une traduction
 * mentale à chaque fois.
 */
export const REDACTED_SEGMENT = ':id';

/** Valeur substituée à une charge utile entièrement caviardée. */
export const REDACTED_VALUE = '<redacted>';

/**
 * Un segment de chemin est-il un identifiant ?
 *
 * La règle est délibérément **large**, et elle penche du côté du caviardage.
 * Le coût d'un faux positif est un span un peu moins précis ; le coût d'un
 * faux négatif est un identifiant d'élève sur un collecteur non authentifié.
 * Ce n'est pas une décision symétrique, et le code ne fait pas semblant
 * qu'elle le soit.
 *
 * Couvre : cuid/cuid2 (`clx…`, la forme des ids Prisma de ce dépôt), uuid,
 * ObjectId, entiers, et toute chaîne longue à forte densité de chiffres.
 */
export function isIdentifierSegment(segment: string): boolean {
  if (segment.length === 0) return false;
  if (/^\d+$/.test(segment)) return true;
  if (/^c[a-z0-9]{20,}$/i.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
  if (/^[0-9a-f]{24,}$/i.test(segment)) return true;
  if (segment.length >= 16 && /\d/.test(segment) && /^[A-Za-z0-9_-]+$/.test(segment)) return true;
  return false;
}

/**
 * Réduit une URL — absolue ou relative — à son gabarit, sans query string.
 *
 * **La query string est supprimée en entier, jamais filtrée.** Une liste
 * d'autorisation de paramètres serait à maintenir, et le jour où un paramètre
 * `?studentId=` apparaît sans que personne pense à ce fichier, la fuite est
 * silencieuse. Supprimer d'abord et perdre un peu de contexte de débogage est
 * le compromis que la nature non authentifiée de Jaeger impose.
 */
export function sanitizeUrlPath(raw: string): string {
  const [beforeHash] = raw.split('#');
  const [pathAndAuthority = ''] = (beforeHash ?? '').split('?');

  const schemeMatch = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)(\/.*)?$/i.exec(pathAndAuthority);
  const prefix = schemeMatch ? (schemeMatch[1] ?? '') : '';
  const path = schemeMatch ? (schemeMatch[2] ?? '') : pathAndAuthority;

  const sanitized = path
    .split('/')
    .map((segment) => (isIdentifierSegment(segment) ? REDACTED_SEGMENT : segment))
    .join('/');

  return `${prefix}${sanitized}`;
}

/**
 * Attributs dont la valeur est une URL ou un chemin, et qui doivent donc être
 * réduits à un gabarit.
 *
 * `http.route` n'y figure pas : c'est **déjà** un gabarit produit par le
 * framework, et le passer dans le caviardage abîmerait `:id` sans rien gagner.
 */
const URL_ATTRIBUTES = new Set([
  'http.url',
  'http.target',
  'url.full',
  'url.path',
  'url.query',
]);

/**
 * Attributs supprimés purement et simplement.
 *
 * `db.statement` est le cas qui justifie cette liste : l'instrumentation
 * ioredis y écrit la commande **avec ses arguments**, et les clés de ce dépôt
 * contiennent des identifiants de tenant et d'utilisateur. Un gabarit n'a pas
 * de sens sur une commande Redis, donc la seule réduction sûre est la
 * suppression. Idem pour les en-têtes, qui portent `authorization`.
 */
const DROPPED_ATTRIBUTES = new Set([
  'db.statement',
  'db.query.text',
  'http.request.header.authorization',
  'http.request.header.cookie',
  'http.response.header.set-cookie',
]);

export type SpanAttributeValue = string | number | boolean | Array<string | number | boolean> | undefined;
export type SpanAttributes = Record<string, SpanAttributeValue>;

/**
 * Applique la politique à un jeu d'attributs de span.
 *
 * Trois règles, dans cet ordre :
 *  1. les attributs de `DROPPED_ATTRIBUTES` disparaissent ;
 *  2. les attributs de `URL_ATTRIBUTES` sont réduits à leur gabarit ;
 *  3. **tout** attribut dont le nom se termine par `.query` ou contient
 *     `header.` est supprimé — la règle générique qui rattrape les attributs
 *     qu'une future montée de version d'instrumentation ajoutera sans que
 *     personne mette ce fichier à jour.
 *
 * La règle 3 est celle qui compte à long terme. Les deux premières décrivent
 * ce qu'on a vu ; la troisième décrit ce qu'on n'a pas encore vu.
 */
export function sanitizeSpanAttributes(attributes: SpanAttributes): SpanAttributes {
  const out: SpanAttributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    if (DROPPED_ATTRIBUTES.has(key)) continue;
    if (key.endsWith('.query') || key.includes('header.')) continue;

    if (URL_ATTRIBUTES.has(key) && typeof value === 'string') {
      out[key] = sanitizeUrlPath(value);
      continue;
    }

    out[key] = value;
  }

  return out;
}

/**
 * Applique la politique au **nom** d'un span.
 *
 * Les noms de span sont ce qu'un opérateur lit en premier dans Jaeger, et
 * l'instrumentation HTTP retombe sur l'URL résolue quand aucune route n'est
 * appariée — c'est-à-dire exactement sur les 404, le cas où une URL contenant
 * un identifiant a le plus de chances d'être inventée par un scanner.
 */
export function sanitizeSpanName(name: string): string {
  return name
    .split(' ')
    .map((token) => (token.includes('/') ? sanitizeUrlPath(token) : token))
    .join(' ');
}
