/**
 * Manifeste de release et détection de dérive d'artefact (S-E02-6 / VAL-10, risque R-05).
 *
 * Deux sources **indépendantes** sont comparées — c'est ce qui rend le contrôle utile :
 *
 * - `GIT_SHA` est **gravé dans l'image au build** (`ARG GIT_SHA` → `ENV GIT_SHA`,
 *   voir infra/docker/Dockerfile.api §Runtime). Il décrit ce que l'artefact *est*.
 * - `EXPECTED_GIT_SHA` est **injecté au démarrage** par le déployeur
 *   (scripts/deploy-prod.sh, à partir de `git rev-parse HEAD`). Il décrit ce que
 *   l'opérateur *croit* déployer.
 *
 * R-05 s'est déjà matérialisé : l'image qui tournait portait
 * `controllers: [AssessmentsController, GradesController]` alors qu'aucune ref du
 * dépôt ne contenait cette ligne — l'artefact avait été construit depuis un arbre
 * de travail non commité, et sept semaines de 404 en production (PF-62) n'ont été
 * détectées par rien. Comparer build-time et deploy-time est exactement le contrôle
 * qui manquait.
 *
 * Il n'existe **aucun drapeau de contournement** (DNC-10) : ne pas déclarer
 * `EXPECTED_GIT_SHA` produit le verdict honnête `unverified`, visible dans
 * `GET /version`, plutôt qu'un `match` qui n'a rien vérifié (DNC-08).
 */

/** Longueur de SHA comparée et exposée. Assez pour être non ambigu, trop courte pour être un secret. */
export const SHA_DISPLAY_LENGTH = 12;

/** Suffixe apposé par le déployeur quand l'image est construite depuis un arbre sale. */
export const DIRTY_SUFFIX = '-dirty';

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
