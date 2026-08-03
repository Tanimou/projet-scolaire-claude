/**
 * Manifeste de release et détection de dérive d'artefact (VAL-10, risque R-05).
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE MODULE VIT DANS `@pilotage/contracts` (S-E02-10 / PF-68)
 * ---------------------------------------------------------------------------
 * `S-E02-6` a livré ce contrôle **dans l'API seule**. Le déploiement compte
 * pourtant TROIS artefacts — `api`, `worker`, `web` — construits séparément et
 * déployables séparément. Les trois portaient déjà un `GIT_SHA` gravé au build,
 * mais seule l'API savait le comparer et l'exposer : une dérive du worker ou du
 * web restait invisible, exactement le mode de panne que R-05 décrit.
 *
 * La logique est donc remontée ici, dans le seul paquet dont les trois
 * applications dépendent déjà. Ce n'est pas une préférence de rangement : trois
 * copies d'un comparateur de version divergent, et une copie divergente rendrait
 * verte la moitié du déploiement qu'elle ne regarde pas.
 *
 * ---------------------------------------------------------------------------
 * LE CONTRÔLE
 * ---------------------------------------------------------------------------
 * Deux sources **indépendantes** sont comparées — c'est ce qui le rend utile :
 *
 * - `GIT_SHA` est **gravé dans l'image au build** (`ARG GIT_SHA` → `ENV GIT_SHA`,
 *   voir infra/docker/Dockerfile.{api,worker,web}). Il décrit ce que
 *   l'artefact *est*.
 * - `EXPECTED_GIT_SHA` est **injecté au démarrage** par le déployeur
 *   (scripts/deploy-prod.sh, à partir de `git rev-parse HEAD`). Il décrit ce que
 *   l'opérateur *croit* déployer.
 *
 * Les produire au même endroit ne prouverait rien. Leur indépendance EST le
 * contrôle.
 *
 * R-05 s'est déjà matérialisé : l'image qui tournait portait
 * `controllers: [AssessmentsController, GradesController]` alors qu'aucune ref du
 * dépôt ne contenait cette ligne — l'artefact avait été construit depuis un arbre
 * de travail non commité, et sept semaines de 404 en production (PF-62) n'ont été
 * détectées par rien.
 *
 * Il n'existe **aucun drapeau de contournement** (DNC-10) : ne pas déclarer
 * `EXPECTED_GIT_SHA` produit le verdict honnête `unverified`, visible dans le
 * manifeste, plutôt qu'un `match` qui n'a rien vérifié (DNC-08).
 */

/** Longueur de SHA comparée et exposée. Assez pour être non ambigu, trop courte pour être un secret. */
export const SHA_DISPLAY_LENGTH = 12;

/** Suffixe apposé par le déployeur quand l'image est construite depuis un arbre sale. */
export const DIRTY_SUFFIX = '-dirty';

/**
 * Les trois artefacts déployables. Le nom est publié dans le manifeste pour
 * qu'une réponse ne puisse pas être attribuée au mauvais service — un proxy mal
 * routé qui renverrait le manifeste de l'API sur la route du worker serait
 * sinon indiscernable d'un worker conforme.
 */
export type ReleaseApp = 'api' | 'worker' | 'web';

export type ReleaseVerdict =
  /** L'artefact qui tourne est exactement le commit attendu. */
  | 'match'
  /** L'artefact qui tourne n'est PAS le commit attendu — dérive (R-05). */
  | 'drift'
  /** L'artefact a été construit depuis un arbre de travail non commité : irreproductible. */
  | 'dirty'
  /** L'image ne porte aucun SHA : construite avant ce contrôle, ou build arg non transmis. */
  | 'unstamped'
  /** Aucune attente déclarée — il n'y a rien à comparer, et on ne prétend pas le contraire. */
  | 'unverified';

export interface ReleaseManifest {
  /** SHA court gravé dans l'image, `unknown` si absent. Peut porter le suffixe `-dirty`. */
  buildSha: string;
  /** SHA court attendu par le déployeur, `null` si non déclaré. */
  expectedSha: string | null;
  /** L'image a-t-elle été construite depuis un arbre de travail sale ? */
  dirty: boolean;
  verdict: ReleaseVerdict;
  /** Message humain expliquant un verdict non-`match`. */
  detail: string | null;
}

/** Normalise un SHA : trim, minuscules, tronqué. Le suffixe `-dirty` est retiré ici. */
function normalise(raw: string | undefined | null): { sha: string; dirty: boolean } {
  const trimmed = (raw ?? '').trim().toLowerCase();
  if (!trimmed) return { sha: '', dirty: false };
  const dirty = trimmed.endsWith(DIRTY_SUFFIX);
  const bare = dirty ? trimmed.slice(0, -DIRTY_SUFFIX.length) : trimmed;
  return { sha: bare.slice(0, SHA_DISPLAY_LENGTH), dirty };
}

/**
 * Compare l'artefact réellement en cours d'exécution à celui attendu.
 * Fonction pure : aucune lecture d'environnement, aucune I/O — c'est ce qui la
 * rend testable, et le test est la preuve exigée par la gate G-MIGRATION.
 */
export function evaluateRelease(
  rawBuildSha: string | undefined | null,
  rawExpectedSha: string | undefined | null,
): ReleaseManifest {
  const build = normalise(rawBuildSha);
  const expected = normalise(rawExpectedSha);

  const buildSha = build.sha ? `${build.sha}${build.dirty ? DIRTY_SUFFIX : ''}` : 'unknown';
  const expectedSha = expected.sha || null;

  if (!expectedSha) {
    return {
      buildSha,
      expectedSha: null,
      dirty: build.dirty,
      verdict: 'unverified',
      detail:
        'EXPECTED_GIT_SHA non déclaré : la version qui tourne n’est comparée à rien. ' +
        'Le déploiement ne peut pas prouver qu’il exécute le code attendu (R-05).',
    };
  }

  if (!build.sha) {
    return {
      buildSha,
      expectedSha,
      dirty: false,
      verdict: 'unstamped',
      detail:
        `Attendu ${expectedSha}, mais l’image ne porte aucun GIT_SHA. ` +
        'Elle a été construite avant ce contrôle, ou le build arg GIT_SHA n’a pas été transmis. ' +
        'Reconstruire via scripts/deploy-prod.sh.',
    };
  }

  if (build.sha !== expected.sha) {
    return {
      buildSha,
      expectedSha,
      dirty: build.dirty,
      verdict: 'drift',
      detail:
        `Dérive d’artefact : l’image exécute ${build.sha} alors que le déploiement attend ${expected.sha}. ` +
        'Le code audité n’est pas le code qui tourne (R-05).',
    };
  }

  if (build.dirty) {
    return {
      buildSha,
      expectedSha,
      dirty: true,
      verdict: 'dirty',
      detail:
        `L’image a été construite depuis un arbre de travail non commité au-dessus de ${build.sha}. ` +
        'Son contenu n’est reproductible depuis aucune ref du dépôt — c’est la cause exacte de R-05.',
    };
  }

  return { buildSha, expectedSha, dirty: false, verdict: 'match', detail: null };
}

/** Le verdict autorise-t-il de servir du trafic ? Seuls `match` et `unverified` le font. */
export function isServable(verdict: ReleaseVerdict): boolean {
  return verdict === 'match' || verdict === 'unverified';
}

/** Lit le manifeste depuis l'environnement du process. */
export function readReleaseManifest(env: NodeJS.ProcessEnv = process.env): ReleaseManifest {
  return evaluateRelease(env.GIT_SHA ?? env.BUILD_SHA, env.EXPECTED_GIT_SHA);
}

/**
 * Charge utile publiée par les trois artefacts. Volontairement plate et minimale :
 * un nom d'application, des SHA courts et un verdict. Aucune donnée de tenant,
 * aucune chaîne de connexion — le manifeste est joignable sans authentification.
 */
export interface ReleaseManifestPayload {
  app: ReleaseApp;
  buildSha: string;
  release: {
    verdict: ReleaseVerdict;
    expectedSha: string | null;
    dirty: boolean;
    detail: string | null;
  };
}

/** Construit la charge utile publiée par un artefact donné. */
export function buildManifestPayload(
  app: ReleaseApp,
  manifest: ReleaseManifest = readReleaseManifest(),
): ReleaseManifestPayload {
  return {
    app,
    buildSha: manifest.buildSha,
    release: {
      verdict: manifest.verdict,
      expectedSha: manifest.expectedSha,
      dirty: manifest.dirty,
      detail: manifest.detail,
    },
  };
}

/**
 * Journal minimal accepté par le preflight. Structurel plutôt que dépendant de
 * `@nestjs/common` : `LoggerService` de Nest y est assignable, et `console` aussi,
 * ce qui permet au worker et au web d'utiliser le même preflight que l'API sans
 * que ce paquet n'acquière une dépendance sur Nest.
 */
export interface ReleaseLogger {
  log?: (message: string, context?: string) => void;
  warn?: (message: string, context?: string) => void;
}

export class ReleaseDriftError extends Error {
  constructor(
    readonly manifest: ReleaseManifest,
    readonly app: ReleaseApp,
  ) {
    super(
      `Preflight release ÉCHEC (${manifest.verdict}) sur '${app}' : ${manifest.detail ?? 'artefact non identifiable'}\n` +
        `  build gravé : ${manifest.buildSha}\n` +
        `  attendu     : ${manifest.expectedSha ?? '(non déclaré)'}\n` +
        `L'application refuse de démarrer sur un artefact dont on ne peut pas prouver l'origine. ` +
        `Reconstruire et redéployer : bash scripts/deploy-prod.sh — ` +
        `voir docs/runbooks/release-gate.md`,
    );
    this.name = 'ReleaseDriftError';
  }
}

/**
 * Refuse de démarrer sur un artefact qui n'est pas celui attendu (VAL-10, R-05).
 *
 * Le contrôle est **opt-in par construction** : sans `EXPECTED_GIT_SHA` le verdict
 * est `unverified` et rien n'est bloqué, ce qui préserve tout déploiement existant.
 * Dès qu'une attente est déclarée, elle est stricte — il n'y a volontairement aucun
 * drapeau pour la désactiver (DNC-10) : ne pas déclarer l'attente EST l'interrupteur,
 * et il est visible dans le manifeste au lieu d'être silencieux (DNC-08).
 *
 * Hors production, une dérive est journalisée en `warn` sans bloquer : un développeur
 * travaille légitimement au-dessus d'un artefact reconstruit en continu.
 */
export function assertReleaseMatches(
  logger: ReleaseLogger,
  app: ReleaseApp,
  env: NodeJS.ProcessEnv = process.env,
): ReleaseManifest {
  const manifest = readReleaseManifest(env);
  const isProduction = env.NODE_ENV === 'production';

  if (isServable(manifest.verdict)) {
    if (manifest.verdict === 'unverified') {
      logger.warn?.(
        `Release non vérifiée — build ${manifest.buildSha}, aucun EXPECTED_GIT_SHA déclaré. ` +
          'Le déploiement ne prouve pas qu’il exécute le code attendu (R-05).',
        'ReleasePreflight',
      );
    } else {
      logger.log?.(
        `Preflight release OK — artefact ${app} ${manifest.buildSha} conforme à l’attendu.`,
        'ReleasePreflight',
      );
    }
    return manifest;
  }

  if (!isProduction) {
    logger.warn?.(
      `Dérive d’artefact détectée (${manifest.verdict}) hors production, démarrage autorisé : ${manifest.detail}`,
      'ReleasePreflight',
    );
    return manifest;
  }

  throw new ReleaseDriftError(manifest, app);
}
