import { PrismaClient } from '@prisma/client';

import {
  BASELINE_CANARY_CODE,
  exitCodeForSweep,
  formatSweepReportFr,
  SCHOOL_ADMIN_BASELINE,
  sweepLegacyEscalations,
  type CandidateRole,
} from './legacy-escalation-sweep';

/**
 * S-E05-2c — LA MOITIÉ OPÉRATEUR du balayage `PF-175`. Lecture seule.
 *
 * `pnpm --filter @pilotage/api sweep:legacy-escalation`
 *
 * DEUX DÉCISIONS DÉJÀ ÉCRITES, CITÉES ICI POUR QU’ON NE LES RÉINVENTE PAS
 * ----------------------------------------------------------------------
 *  - `ADR-015 D8.2` enregistre déjà cet artefact comme résiduel nommé : « une
 *    requête de détection (pas une migration — G-MIGRATION ne doit pas se
 *    déclencher) ». Cette tranche EXÉCUTE une décision déjà prise ; elle n’en
 *    prend pas de nouvelle, donc elle n’ouvre aucun ADR.
 *  - `ADR-025 D1` est la coupe artefact-opérateur : la moitié qui exige une base
 *    de données vivante vit HORS de `ci-gate.sh`, et la moitié visible par la CI
 *    est une spécification que `test:api (ratchet)` collecte déjà. Ce fichier +
 *    `legacy-escalation-sweep.spec.ts` sont exactement cette forme. Aucun étage
 *    n’est ajouté à `ci-gate.sh`.
 *
 * POURQUOI ICI, ET POURQUOI UN CLIENT PRISMA NU
 * ---------------------------------------------
 * Le fichier est co-localisé avec le prédicat qu’il exécute (`shared/auth/`),
 * pas dans `scripts/`, parce que sa valeur est la fonction pure d’à côté et que
 * les deux doivent être lus ensemble ; il est ainsi typé par `tsc --noEmit` avec
 * le reste de `src/**`. Il instancie `PrismaClient` directement et non
 * `PrismaService` parce qu’il n’y a aucun contexte Nest dans un script de
 * console — il n’y a rien à injecter. Mesuré et sans conséquence ici : il
 * n’existe AUCUNE policy RLS dans cette base et `PrismaService` n’installe ni
 * middleware ni `$extends`, donc un client nu voit exactement les mêmes lignes
 * et ne peut pas sous-déclarer.
 *
 * TENANCE — TRANSVERSALE, ET C’EST CORRECT ICI ET SEULEMENT ICI
 * ------------------------------------------------------------
 * La lecture ne prend aucun paramètre d’école : un diagnostic de console n’a
 * aucun contexte de requête, aucun acteur et aucun tenant courant, et un filtre
 * silencieux sous-déclarerait exactement les lignes qu’on cherche. Chaque
 * signalement imprime sa portée ; `schoolId = null` est rendu « GLOBALE », la
 * forme la plus sévère, jamais un `null` nu.
 *
 * LECTURE SEULE, ET AUCUNE RÉVOCATION
 * -----------------------------------
 * Une seule requête `findMany`. Ce script n’écrit rien, ne retire aucun octroi et
 * ne le fera pas : révoquer un octroi est une DÉCISION HUMAINE, prise sur pièce,
 * parce que la provenance d’une ligne `role` est irrécupérable (voir l’en-tête du
 * module pur). Une spécification relit cette source pour le prouver
 * mécaniquement plutôt que sur parole.
 *
 * LE SQL EN PROSE DU REGISTRE EST INVALIDE — NE PAS LE « RESTAURER »
 * -----------------------------------------------------------------
 * La ligne `PF-175` porte une requête utilisant `r."isSystem"` et `rp."roleId"`.
 * Les colonnes physiques sont `is_system` et `role_id` (`@map`,
 * `schema.prisma:906/917`) : transcrite telle quelle dans une requête SQL brute,
 * elle meurt sur « column r.isSystem does not exist » — et un échec se lirait
 * alors comme un signalement. D’où l’usage du client typé, une seule requête,
 * aucun N+1. Aucune requête brute n’est utilisée ici, et une spécification le
 * vérifie.
 *
 * CODES DE SORTIE — 0 propre · 1 signalements · 2 balayage non concluant
 * ---------------------------------------------------------------------
 * Le 2 existe pour qu’une panne (base injoignable, requête en erreur, base de
 * référence introuvable) ne soit jamais lue comme « propre » ni comme « escalade
 * détectée ». Il est posé via `process.exitCode` et jamais via une sortie
 * immédiate, qui tronquerait la sortie tamponnée avant qu’un opérateur ne la
 * lise.
 *
 * DNC-10 — ce fichier ne lit aucune variable d’environnement et n’importe aucun
 * chargeur de fichier `.env` (ce sont des dépendances de développement, alors
 * que `src/**` compile dans `dist/`). `new PrismaClient()` sans surcharge
 * `datasources` laisse Prisma
 * résoudre lui-même sa chaîne de connexion : le module n’en lit donc littéralement
 * aucune. Aucun drapeau, aucune échappatoire, aucun sac d’options.
 *
 * L’exécution est gardée par `require.main === module` — l’idiome de la maison
 * pour un détecteur exécutable, et ici une nécessité : `tsconfig.json` inclut
 * `src/**`, donc `nest build` émet ce fichier dans `dist/`. Sans la garde, un
 * import futur (barillet, glob, import automatique d’éditeur) exécuterait une
 * requête et poserait un code de sortie au démarrage de l’API.
 */

const HEADLINE = 'PF-175 — balayage des privilèges hérités';

async function main(): Promise<void> {
  // Garde-fou de dérivation (distinct du prédicat, qui reste fermé-en-échec) :
  // une base de référence vide signalerait TOUT et rendrait le détecteur rouge en
  // permanence — donc quelqu’un le désactiverait. On refuse bruyamment à la place.
  if (SCHOOL_ADMIN_BASELINE.size === 0 || !SCHOOL_ADMIN_BASELINE.has(BASELINE_CANARY_CODE)) {
    console.error(
      `${HEADLINE} : base de référence introuvable (le niveau school_admin ne porte pas ` +
        `${BASELINE_CANARY_CODE}). Aucun balayage effectué.`,
    );
    process.exitCode = exitCodeForSweep(null);
    return;
  }

  const prisma = new PrismaClient();

  try {
    const rows = await prisma.role.findMany({
      where: { isSystem: false },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        slug: true,
        isSystem: true,
        schoolId: true,
        // Le code vit sur `Permission`, pas sur `RolePermission` : deux niveaux,
        // une seule requête.
        rolePermissions: { select: { permission: { select: { code: true } } } },
      },
    });

    const candidates: CandidateRole[] = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      isSystem: row.isSystem,
      schoolId: row.schoolId,
      permissionCodes: row.rolePermissions.map((link) => link.permission.code),
    }));

    const report = sweepLegacyEscalations(candidates, SCHOOL_ADMIN_BASELINE);
    console.log(formatSweepReportFr(report));
    process.exitCode = exitCodeForSweep(report);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`${HEADLINE} : balayage non concluant — ${reason}`);
    console.error('Aucune conclusion ne peut être tirée de cette exécution.');
    process.exitCode = exitCodeForSweep(null);
  } finally {
    // Sans cela le processus reste accroché et une porte de contrôle expirerait
    // au lieu d’échouer proprement.
    await prisma.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) void main();
