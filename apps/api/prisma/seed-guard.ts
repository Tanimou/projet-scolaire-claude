/**
 * Garde-fou de seed (S-E02-4 / PF-03 « moitié seed », risque R-12).
 *
 * ## Le défaut que ce module corrige
 *
 * Sept scripts de seed existent. **Un seul** portait un contrôle
 * (`seed-demo.ts` : `if (process.env.NODE_ENV === 'production') process.exit(1)`),
 * et `infra/docker-compose.prod.yml` neutralisait précisément celui-là en forçant
 * `NODE_ENV: development` **sur le seul service `seed`** — tous les autres services
 * du même fichier reçoivent `NODE_ENV: production`. Le commentaire au-dessus de
 * l'override le disait explicitement : « MUST run as non-production (seed-demo.ts
 * hard-aborts when NODE_ENV=production) ». Le contournement était documenté, pas
 * accidentel. Et `scripts/deploy-prod.sh` enchaînait les sept seeds **par défaut**
 * en production (`--no-seed` était un opt-out).
 *
 * ## Pourquoi deux signaux et non un
 *
 * Un garde-fou qui ne lit que `NODE_ENV` est désactivable en écrivant une ligne
 * dans un compose — c'est exactement ce qui s'est produit. On applique donc la
 * leçon de `shared/release/release-manifest.ts` (S-E02-6) : la décision se prend
 * sur **deux sources indépendantes**.
 *
 * - `NODE_ENV` décrit ce que le **process** prétend être. Réglé par service.
 * - `DEPLOY_ENV` décrit ce que le **déploiement** est. Réglé une seule fois au
 *   niveau de la stack (fichier d'environnement), pas par service.
 *
 * Un désaccord entre les deux n'est pas résolu au profit du plus permissif : il
 * constitue son propre verdict de refus (`conflicting-signals`), parce que c'est
 * la signature exacte du contournement historique.
 *
 * ## Ce n'est pas un drapeau de contournement (DNC-10)
 *
 * `ALLOW_SEED` **ne peut pas** débloquer une cible de production : la règle 1
 * s'applique avant lui et aucun jeton ne la lève. `ALLOW_SEED` n'ouvre que ce qui
 * était déjà permis, en exigeant que ce soit **délibéré**. Ne rien déclarer produit
 * un refus honnête, jamais un succès silencieux (DNC-08).
 *
 * ## R-12 — la démo hébergée reste reproductible
 *
 * La stack de démonstration se déclare `DEPLOY_ENV=demo` (et non `production`) et
 * `ALLOW_SEED=provision-demo-data`, puis `bash scripts/deploy-prod.sh --seed`.
 * Deux déclarations explicites au lieu d'un effet de bord silencieux : la démo
 * survit, le défaut disparaît. Voir `docs/runbooks/provision-demo-tenant.md`.
 */

/** Jeton exact attendu dans `ALLOW_SEED`. Un booléen se coche par accident ; pas ceci. */
export const SEED_OPT_IN_TOKEN = 'provision-demo-data';

/** Valeurs de `NODE_ENV` / `DEPLOY_ENV` qui désignent une cible de production. */
const PRODUCTION_VALUES = ['production', 'prod'];

export type SeedVerdict =
  /** Les deux signaux sont non-production et l'opt-in explicite est présent. */
  | 'allowed'
  /** Au moins un signal désigne la production. Aucun jeton ne lève ce refus. */
  | 'refused-production'
  /**
   * Les deux signaux se contredisent, l'un désignant la production.
   * C'est la forme exacte du contournement corrigé par cette story.
   */
  | 'refused-conflicting-signals'
  /** Cible non-production, mais aucun opt-in déclaré : on ne seede pas par défaut. */
  | 'refused-no-opt-in'
  /** `ALLOW_SEED` déclaré avec une valeur qui n'est pas le jeton attendu. */
  | 'refused-bad-token';

export interface SeedPermission {
  verdict: SeedVerdict;
  allowed: boolean;
  /** Valeur observée de `NODE_ENV`, `null` si absente. */
  nodeEnv: string | null;
  /** Valeur observée de `DEPLOY_ENV`, `null` si absente. */
  deployEnv: string | null;
  /** Message humain nommant la cause et le geste correctif. */
  detail: string;
}

function normalise(raw: string | undefined | null): string | null {
  const trimmed = (raw ?? '').trim().toLowerCase();
  return trimmed || null;
}

function isProduction(value: string | null): boolean {
  return value !== null && PRODUCTION_VALUES.includes(value);
}

/**
 * Décide si un seed a le droit de s'exécuter.
 *
 * Fonction pure : aucune lecture de `process.env`, aucune I/O, aucune sortie de
 * process. C'est ce qui la rend testable, et le test est la preuve exigée par la
 * gate G-MIGRATION.
 */
export function evaluateSeedPermission(env: {
  NODE_ENV?: string;
  DEPLOY_ENV?: string;
  ALLOW_SEED?: string;
}): SeedPermission {
  const nodeEnv = normalise(env.NODE_ENV);
  const deployEnv = normalise(env.DEPLOY_ENV);
  const allowSeed = normalise(env.ALLOW_SEED);

  const base = { nodeEnv, deployEnv };
  const nodeIsProd = isProduction(nodeEnv);
  const deployIsProd = isProduction(deployEnv);

  // Règle 1 — un seul signal « production » suffit à refuser, et rien ne le lève.
  // Un désaccord n'existe que si les **deux** variables sont déclarées : une
  // variable absente n'est pas une contradiction, seulement une omission.
  const bothDeclared = nodeEnv !== null && deployEnv !== null;
  if (bothDeclared && nodeIsProd !== deployIsProd) {
    return {
      ...base,
      verdict: 'refused-conflicting-signals',
      allowed: false,
      detail:
        `Signaux d'environnement contradictoires : NODE_ENV=${nodeEnv ?? '(absent)'} ` +
        `mais DEPLOY_ENV=${deployEnv ?? '(absent)'}. L'un des deux désigne la production. ` +
        "C'est la signature exacte du contournement historique (docker-compose.prod.yml " +
        'forçait NODE_ENV=development sur le seul service seed). Refus : un désaccord ne ' +
        'se tranche pas au profit du plus permissif. Aligner les deux variables.',
    };
  }

  if (nodeIsProd || deployIsProd) {
    return {
      ...base,
      verdict: 'refused-production',
      allowed: false,
      detail:
        'Cible de production : aucun script de seed ne peut y écrire. ' +
        "ALLOW_SEED ne lève pas ce refus (ce serait un drapeau de contournement, DNC-10). " +
        'Pour provisionner une démo, déployer une stack déclarée DEPLOY_ENV=demo.',
    };
  }

  // Règle 2 — hors production, le seed reste un geste délibéré, jamais un défaut.
  if (allowSeed === null) {
    return {
      ...base,
      verdict: 'refused-no-opt-in',
      allowed: false,
      detail:
        `ALLOW_SEED non déclaré. Le seed écrit des données de démonstration et ne ` +
        `s'exécute pas par effet de bord d'un déploiement. Déclarer ` +
        `ALLOW_SEED=${SEED_OPT_IN_TOKEN} pour l'autoriser explicitement.`,
    };
  }

  if (allowSeed !== SEED_OPT_IN_TOKEN) {
    return {
      ...base,
      verdict: 'refused-bad-token',
      allowed: false,
      detail:
        `ALLOW_SEED=${allowSeed} n'est pas le jeton attendu. Valeur requise : ` +
        `${SEED_OPT_IN_TOKEN}. Un booléen (1, true, yes) est refusé volontairement — ` +
        "l'opt-in doit être écrit, pas coché.",
    };
  }

  return {
    ...base,
    verdict: 'allowed',
    allowed: true,
    detail: `Autorisé : NODE_ENV=${nodeEnv ?? '(absent)'}, DEPLOY_ENV=${deployEnv ?? '(absent)'}, opt-in explicite présent.`,
  };
}

/**
 * Applique la décision au process courant. À appeler **après** le chargement de
 * `.env` et **avant** toute instanciation de `PrismaClient` ou tout appel réseau :
 * un refus doit sortir sans avoir ouvert la moindre connexion.
 *
 * Sort en code 1 sur refus — le seed « refuse et sort non-zéro » est le critère
 * d'acceptation 1 de S-E02-4, donc il doit être observable par un shell.
 */
export function assertSeedAllowed(scriptName: string, env: NodeJS.ProcessEnv = process.env): void {
  const permission = evaluateSeedPermission(env);
  if (permission.allowed) return;

   
  console.error(`\n✖ ${scriptName} : seed refusé [${permission.verdict}]`);
  console.error(`  ${permission.detail}\n`);
   
  process.exit(1);
}
