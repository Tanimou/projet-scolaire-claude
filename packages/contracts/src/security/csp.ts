/**
 * Politique de sécurité du contenu (S-E06-2 / PF-45, preuve G-AUTHZ).
 *
 * ---------------------------------------------------------------------------
 * POURQUOI ICI, ET PAS DANS `next.config.mjs`
 * ---------------------------------------------------------------------------
 * `next.config.mjs#headers()` émet des en-têtes **constants**. Un nonce doit
 * changer à chaque réponse, sinon il ne vaut rien : un nonce constant est
 * exactement équivalent à `'unsafe-inline'`, en plus long. La politique est donc
 * construite par requête dans `apps/web/src/middleware.ts`, et ce module en est
 * la partie pure — testable sans Next, exécutable depuis un script de gate.
 *
 * Ce fichier n'importe **rien**. `middleware.ts` s'exécute sur le runtime edge,
 * qui n'a ni `node:crypto` ni `Buffer` ; la leçon est celle de `PF-79`, où un
 * `import()` de `prom-client` réputé « gardé » a fait échouer le build web parce
 * que webpack compile aussi le hook pour l'edge. Seules les API Web sont
 * utilisées ici (`crypto.getRandomValues`, `btoa`), disponibles des deux côtés.
 */

/** En-tête d'application. */
export const CSP_HEADER = 'content-security-policy';
/** En-tête d'observation : mêmes directives, aucun blocage. */
export const CSP_REPORT_ONLY_HEADER = 'content-security-policy-report-only';
/**
 * En-tête de requête par lequel le middleware transmet le nonce au rendu.
 *
 * Next lit lui-même le nonce dans l'en-tête `content-security-policy` **de la
 * requête** pour l'apposer sur ses propres scripts d'amorçage ; nos composants
 * serveur ont besoin de la valeur brute, d'où ce second en-tête.
 */
export const CSP_NONCE_HEADER = 'x-csp-nonce';

/** Mode d'émission de la politique. */
export type CspMode = 'enforce' | 'report-only';

export interface CspOptions {
  /** Nonce de la réponse, encodé base64. */
  nonce: string;
  /**
   * Développement : Next injecte du HMR qui exige `'unsafe-eval'` et une
   * websocket. Jamais vrai dans une image de production — un test le verrouille.
   */
  development?: boolean;
  /** Origines supplémentaires jointes à `connect-src` (API, Keycloak). */
  connectSrc?: readonly string[];
  /** Origines supplémentaires jointes à `form-action` (Keycloak). */
  formAction?: readonly string[];
  /** Origines supplémentaires jointes à `img-src` (stockage objet). */
  imgSrc?: readonly string[];
}

/** Une origine utilisable dans une directive : schéma + hôte, rien d'autre. */
export function normalizeCspOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // `origin` supprime chemin, requête et fragment — une directive CSP ne les
  // interprète pas et les laisser passer ferait entrer du texte arbitraire dans
  // un en-tête, ce qui est la même classe de défaut que celle qu'on répare.
  return parsed.origin;
}

function sourceList(...groups: readonly (readonly string[])[]): string {
  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group) {
      if (item) seen.add(item);
    }
  }
  return [...seen].join(' ');
}

/**
 * Construit la valeur de l'en-tête CSP pour une réponse du portail web.
 *
 * ---------------------------------------------------------------------------
 * LES TROIS CHOIX QUI COMPTENT
 * ---------------------------------------------------------------------------
 *  1. **`script-src` sans `'unsafe-inline'`, avec `'strict-dynamic'`.** C'est la
 *     directive qui transforme une injection en non-événement. `'strict-dynamic'`
 *     est nécessaire parce que le script d'amorçage de Next charge ensuite ses
 *     chunks par `document.createElement('script')` : sans lui il faudrait
 *     lister chaque chunk, ce qui casse à chaque build. Note que
 *     `'strict-dynamic'` fait ignorer `'self'` par les navigateurs CSP3 — on le
 *     garde pour les navigateurs CSP2, où il est le seul filet.
 *
 *  2. **`style-src-attr 'unsafe-inline'` déclaré explicitement.** Sans cette
 *     directive, `style-src` couvre aussi les attributs `style=""`, que React
 *     et Radix produisent partout (positionnement des popovers, largeurs de
 *     colonnes). Les nonces ne s'appliquent pas aux attributs : la seule
 *     alternative serait `'unsafe-inline'` sur `style-src` **entier**, qui
 *     ouvrirait aussi les blocs `<style>` — c'est-à-dire précisément le sink de
 *     PF-45. Restreindre l'exception aux attributs est le compromis le plus
 *     étroit disponible, et un attribut `style` ne peut pas exécuter de script
 *     dans un navigateur moderne (`expression()` est mort avec IE).
 *
 *  3. **`frame-ancestors 'none'` en plus de `X-Frame-Options`.** Le second est
 *     déjà posé par `next.config.mjs` ; il est ignoré par les navigateurs quand
 *     le premier est présent, et c'est le premier qui a une sémantique définie.
 */
export function buildWebCsp(options: CspOptions): string {
  const { nonce, development = false } = options;
  const nonceSource = `'nonce-${nonce}'`;

  const connect = (options.connectSrc ?? []).map(normalizeCspOrigin).filter((o): o is string => o !== null);
  const forms = (options.formAction ?? []).map(normalizeCspOrigin).filter((o): o is string => o !== null);
  const images = (options.imgSrc ?? []).map(normalizeCspOrigin).filter((o): o is string => o !== null);

  const directives: Array<[string, string]> = [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["form-action", sourceList(["'self'"], forms)],
    [
      "script-src",
      sourceList(["'self'", nonceSource, "'strict-dynamic'"], development ? ["'unsafe-eval'"] : []),
    ],
    ["style-src", sourceList(["'self'", nonceSource])],
    ["style-src-attr", "'unsafe-inline'"],
    ["img-src", sourceList(["'self'", 'data:', 'blob:'], images)],
    ["font-src", sourceList(["'self'", 'data:'])],
    ["worker-src", sourceList(["'self'", 'blob:'])],
    ["manifest-src", "'self'"],
    [
      "connect-src",
      sourceList(["'self'"], connect, development ? ['ws:', 'wss:'] : []),
    ],
  ];

  return directives.map(([name, value]) => `${name} ${value}`).join('; ');
}

/**
 * Génère un nonce de 128 bits encodé base64.
 *
 * `crypto.getRandomValues` et non `Math.random()` : un nonce prédictible est un
 * nonce inutile, et `Math.random()` est explicitement non cryptographique. Les
 * deux runtimes (edge et Node ≥ 20) exposent `globalThis.crypto`.
 */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Nom d'en-tête correspondant au mode demandé. */
export function cspHeaderName(mode: CspMode): string {
  return mode === 'report-only' ? CSP_REPORT_ONLY_HEADER : CSP_HEADER;
}

/**
 * Résout le mode depuis l'environnement.
 *
 * **Ce n'est pas un interrupteur d'arrêt (DNC-10).** Aucune valeur ne supprime
 * l'en-tête : `CSP_REPORT_ONLY=true` bascule vers l'en-tête d'observation, tout
 * le reste applique. Le mode `report-only` existe parce que la story le demande
 * pour le déploiement initial ; `scripts/csp-check.js` refuse qu'il soit posé
 * dans `infra/docker-compose.prod.yml`, donc l'observation reste une manœuvre
 * explicite d'opérateur et ne peut pas devenir l'état par défaut par oubli.
 */
export function resolveCspMode(env: Record<string, string | undefined>): CspMode {
  return env.CSP_REPORT_ONLY === 'true' ? 'report-only' : 'enforce';
}
