import { z } from 'zod';

/**
 * S-E03-9 / PF-50 / ADR-080 — LA fenêtre de page canonique : UNE analyse, UN
 * plafond, UN endroit.
 *
 * CE QUE CE MODULE REMPLACE
 * -------------------------
 * Neuf sites transformaient une chaîne de requête en `take`/`skip` Prisma, avec
 * CINQ défauts (20 / 50 / 100 / 200) et QUATRE plafonds (100 / 200 / 500 /
 * aucun), écrits de HUIT façons différentes. Le défaut que cette divergence
 * cachait est mesuré, reproductible, et atteignable par l'appelant :
 *
 *     Math.min(parseInt('-5', 10) || 50, 200)   →  -5
 *     Math.min(parseInt('0',  10) || 50, 200)   →  50
 *     parseInt('-3', 10) || 0                   →  -3
 *
 * Un `take` NÉGATIF, pour Prisma, veut dire « prends depuis la FIN, à
 * l'envers » : `?limit=-5` INVERSAIT SILENCIEUSEMENT l'ensemble de résultats
 * aux quatre sites portant cet idiome (`analytics.controller.ts:277`,
 * `students.controller.ts:233`, `guardians.controller.ts:105`,
 * `lessons.controller.ts:370`). Ce n'est PAS une rupture d'autorisation — la
 * portée tenant est inchangée — c'est un changement non documenté de QUELLES
 * lignes reviennent. Un `skip` négatif, lui, est une erreur d'exécution Prisma,
 * donc un **500** sur une lecture de journal d'audit.
 *
 * `?limit=0` ne rendait pas une erreur : il rendait le DÉFAUT, parce que
 * `0 || 50` vaut `50`. Un appelant qui demandait zéro ligne recevait cinquante.
 *
 * LE FOYER, ET POURQUOI IL N'EST PAS UNE INVENTION (ADR-080 §D1)
 * --------------------------------------------------------------
 * Le brief nommait `dto/conversation.ts:105-110` comme « une NEUVIÈME forme ».
 * Mesuré, c'est l'inverse : c'est le SEUL site déjà CORRECT de l'arbre —
 * `z.coerce.number().int().min(1).max(200).default(50)` satisfait déjà chaque
 * clause du contrat (borne basse REJETÉE et non coercée, zéro rejeté, négatif
 * rejeté, défaut et plafond par point d'entrée, pur, testable unitairement).
 * Ce module est donc la GÉNÉRALISATION d'un frère de `contracts` existant, pas
 * un foyer neuf : une FABRIQUE qui émet exactement cette forme avec les nombres
 * de l'appelant.
 *
 * Il vit dans `packages/contracts` et non sous `apps/api/src/shared/` parce
 * qu'une fenêtre de page est un CONTRAT DE REQUÊTE — le sens d'une chaîne de
 * requête, partagé entre le client qui l'écrit et le serveur qui la lit.
 * `apps/web` épingle `limit=` dans une vingtaine d'URL sur TROIS portails, dont
 * plusieurs EXACTEMENT sur le plafond qu'elles vont désormais affronter
 * (`teacher/documents` → `lessons?…&limit=500`, `admin/students/[id]` →
 * `guardians?limit=200`). Poser les plafonds là où `apps/web` ne peut pas les
 * lire laisserait les littéraux du client et les plafonds du serveur en DEUX
 * LISTES TENUES À LA MAIN — la dérive silencieuse que cette maison a déjà
 * mesurée (`project_paired_lists_drift`). Même règle qu'ADR-078 §D1
 * (`calendar/window.ts`) et ADR-079 (`roster/class-roster-size.ts`) :
 * dérivation pure → `packages/contracts/src/<domaine>/` ; adaptateur Prisma →
 * `apps/api/src/shared/<domaine>/`.
 *
 * CE QUE LA FABRIQUE N'EST PAS
 * ----------------------------
 * Elle n'est PAS un résolveur maison rendant `{ ok, take, skip }`. ADR-080 §D1
 * l'a explicitement rejeté : sa frontière Nest (`if (!r.ok) throw new
 * BadRequestException(...)`) devrait être RÉÉCRITE À LA MAIN aux neuf sites,
 * réintroduisant dans le chemin d'ERREUR exactement la duplication que la
 * tranche existe pour supprimer. La forme maison existe déjà —
 * `safeParse` + `BadRequestException(issues.map((i) => i.message))`,
 * `messaging.controller.ts:126-129`, `:155-158`, `:194-197` — et c'est elle qui
 * est réemployée telle quelle.
 *
 * UNE SEULE EXPRESSION D'ANALYSE (AC-1)
 * --------------------------------------
 * `pageWindow()` porte l'UNIQUE `z.coerce.number()` lié à une clé `limit` /
 * `offset` de tout le paquet. Le cliquet
 * `apps/api/src/shared/quality/page-window-derivation-gate.spec.ts` l'assied par
 * ÉGALITÉ DE CHEMIN sur CE fichier — pas un glob, pas une liste d'exemptions.
 *
 * LES CHANGEMENTS OBSERVABLES, DÉCLARÉS PLUTÔT QUE TUS (ADR-080 §D3, PF-423)
 * --------------------------------------------------------------------------
 * Aucun défaut ni plafond ne bouge : les neuf points d'entrée gardent leur
 * paire mesurée. Mais deux comportements d'ACCEPTATION changent, et ils sont
 * visibles par l'appelant :
 *
 *   1. `parseInt` tolérait le déchet. `'1e9'` valait `1` (un appelant qui
 *      demandait un milliard de lignes en recevait UNE), `'50abc'` valait `50`,
 *      `'5.9'` valait `5`. Sous `z.coerce.number().int()` les trois deviennent
 *      un **400**. Une erreur visible remplace une réponse fausse.
 *   2. `?limit=5&limit=6` arrive en TABLEAU ; `Number([…])` vaut `NaN`, donc
 *      **400**, là où l'ancien idiome prenait une valeur « à peu près la
 *      première ».
 *
 * Aucun des deux n'est pertinent pour l'autorisation : les clauses `where` des
 * neuf sites ne sont pas touchées.
 *
 * DEUX QUESTIONS, DEUX TYPES (ADR-080 §D2 — mécanisme d'ADR-079 §D3 réemployé)
 * ----------------------------------------------------------------------------
 *   `PageSize`    — COMBIEN DE LIGNES cette requête a le droit de porter. Une
 *                   FENÊTRE.
 *   `ResultTotal` — COMBIEN DE LIGNES l'ensemble filtré CONTIENT. Une VÉRITÉ.
 *
 * Les deux partageaient le type `number`, et c'est ainsi qu'un `data.length`
 * finit par porter l'étiquette d'un total (DNC-01 : `PF-20` « la longueur d'une
 * constante », `PF-40` « un compte sur une liste tronquée »). Ici, `PageSize`
 * n'est PAS assignable là où `ResultTotal` est attendu : `total: data.length`
 * CESSE DE COMPILER. C'est ADR-079 §D3 appliqué à une deuxième paire, ce qui
 * est précisément pourquoi c'est bon marché.
 *
 * La marque ne survit pas au fil : `JSON.parse` rend des `number` nus. Elle vit
 * CÔTÉ SERVEUR, entre la lecture et la charge utile — là où l'erreur s'écrit.
 *
 * AUCUNE HORLOGE, AUCUN ENVIRONNEMENT, AUCUN FRAMEWORK
 * -----------------------------------------------------
 * Pas de `new Date(`, pas de `Date.now(`, pas de `process.env`, pas d'import
 * Nest, pas d'import Prisma. Ce module est testable dans un processus node nu —
 * et il l'est : `apps/api/src/shared/pagination/page-window.spec.ts`.
 */

/* ================================================================== *
 * LES NOMBRES BRANDÉS — une fenêtre cesse d'être assignable à une vérité
 * ================================================================== */

declare const PAGE_SIZE: unique symbol;
declare const PAGE_OFFSET: unique symbol;
declare const RESULT_TOTAL: unique symbol;

/** COMBIEN DE LIGNES cette requête peut porter. Une FENÊTRE. Le `take` Prisma. */
export type PageSize = number & { readonly [PAGE_SIZE]: true };

/** Combien de lignes sont SAUTÉES avant la fenêtre. Le `skip` Prisma. */
export type PageOffset = number & { readonly [PAGE_OFFSET]: true };

/**
 * COMBIEN DE LIGNES l'ensemble filtré contient. Une VÉRITÉ.
 * Volontairement NON assignable depuis `PageSize` ni depuis un `.length` nu.
 */
export type ResultTotal = number & { readonly [RESULT_TOTAL]: true };

/* ================================================================== *
 * LES BORNES — fournies par l'APPELANT, jamais par ce module
 * ================================================================== */

/**
 * Le défaut et le plafond d'UN point d'entrée.
 *
 * ⚠ Ce module N'A PAS de défaut par défaut et PAS de plafond par défaut
 * (AC-1). 50 contre 200 contre 500 est un choix PRODUIT, propre à chaque
 * point d'entrée ; UNE ANALYSE est le contrat, pas UN NOMBRE. Une valeur par
 * défaut ici ferait glisser en silence la taille de page d'un appelant qui
 * aurait « oublié » de la nommer — exactement la dérive que la tranche ferme.
 */
export interface PageWindowBounds {
  /** La taille de page appliquée quand l'appelant n'en demande aucune. */
  readonly def: number;
  /** La taille de page maximale acceptée. Au-delà : 400, jamais un écrêtage. */
  readonly max: number;
}

function requireBounds(bounds: PageWindowBounds): void {
  const { def, max } = bounds;
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(
      `page-window: \`max\` doit être un entier >= 1, reçu ${String(max)}. ` +
        'Un plafond non entier ou nul rendrait la fenêtre inexprimable.',
    );
  }
  if (!Number.isInteger(def) || def < 1) {
    throw new Error(
      `page-window: \`def\` doit être un entier >= 1, reçu ${String(def)}. ` +
        'Un défaut de zéro rendrait une page vide sous une étiquette de page pleine.',
    );
  }
  if (def > max) {
    throw new Error(
      `page-window: \`def\` (${def}) dépasse \`max\` (${max}). zod ne VALIDE pas ` +
        'la valeur de `.default()` : sans cette garde, le défaut serait la seule ' +
        'valeur capable de franchir son propre plafond.',
    );
  }
}

/* ================================================================== *
 * LA FABRIQUE — L'UNIQUE expression d'analyse du paquet
 * ================================================================== */

/**
 * LA fenêtre de page, en schéma zod, avec les bornes de l'appelant.
 *
 * REJETTE, n'écrête ni ne coerce (ADR-080 §D2) :
 *   `limit` absent      → `bounds.def`
 *   `limit` < 1         → **400** (et non `-5` passé à Prisma en `take`)
 *   `limit` = 0         → **400** (et non le défaut)
 *   `limit` > `max`     → **400** (et non un écrêtage silencieux au plafond)
 *   `limit` non entier  → **400** (`'5.9'` ne vaut plus `5`)
 *   `limit` non numérique → **400** (`'abc'`, `'1e9'` mal lu, `''`, tableau)
 *   `offset` < 0        → **400** (et non un `skip` négatif, donc un 500 Prisma)
 *
 * Le rejet du dépassement de plafond est appliqué UNIFORMÉMENT aux neuf sites
 * (ADR-080 §D3) : quatre d'entre eux écrêtaient, cinq aussi ; aucun ne rendait
 * d'erreur. Écrêter revient à répondre à une AUTRE question que celle posée
 * sans le dire, ce qui est la famille de défauts de cet épic.
 *
 * ⚠ C'EST LA SEULE `z.coerce.number()` LIÉE À `limit` / `offset` DU PAQUET.
 * Le cliquet le vérifie par égalité de chemin sur ce fichier.
 */
export function pageWindow(bounds: PageWindowBounds) {
  requireBounds(bounds);
  return z.object({
    limit: z.coerce.number().int().min(1).max(bounds.max).default(bounds.def),
    offset: z.coerce.number().int().min(0).default(0),
  });
}

/** Le type du schéma rendu par `pageWindow` — utile pour `.extend()` / `.pick()`. */
export type PageWindowSchema = ReturnType<typeof pageWindow>;

/** La sortie ANALYSÉE, en nombres NUS (zod ne connaît pas les marques). */
export type PageWindowInput = z.infer<PageWindowSchema>;

/* ================================================================== *
 * LE PASSAGE À PRISMA — le seul endroit où une chaîne devient take/skip
 * ================================================================== */

/** La fenêtre, prête pour Prisma. `take`/`skip` sont les noms de Prisma. */
export interface PageWindow {
  readonly take: PageSize;
  readonly skip: PageOffset;
}

/**
 * MARQUE la sortie analysée. Aucune arithmétique, aucun écrêtage, aucun défaut :
 * tout cela a déjà été décidé — et REJETÉ le cas échéant — par le schéma.
 * Cette fonction ne peut donc pas ré-introduire la divergence.
 */
export function pageWindowOf(parsed: PageWindowInput): PageWindow {
  return { take: parsed.limit as PageSize, skip: parsed.offset as PageOffset };
}

/**
 * La même marque pour un point d'entrée qui n'accepte QUE `limit`
 * (`.pick({ limit: true })`).
 *
 * Elle existe pour que ces sites n'aient pas à écrire `offset: 0` à la main :
 * un zéro écrit à la main est une valeur par défaut de plus, au même endroit
 * où la tranche vient d'en supprimer neuf. Ici, l'absence de décalage est une
 * PROPRIÉTÉ DU CONTRAT du point d'entrée, pas un repli.
 */
export function pageSizeOf(parsed: { limit: number }): PageSize {
  return parsed.limit as PageSize;
}

/**
 * MARQUE un compte rendu par la base comme le TOTAL de l'ensemble filtré.
 *
 * Passer par ici est ce qui rend `total: data.length` non compilable : un
 * `.length` est un `number` nu, et `ResultTotal` ne s'en laisse pas assigner.
 * La validation refuse aussi un total négatif ou fractionnaire — un « 0 » rendu
 * sans avoir lu est DNC-08.
 */
export function resultTotal(rawCount: number): ResultTotal {
  if (!Number.isInteger(rawCount) || rawCount < 0) {
    throw new Error(
      `page-window: resultTotal attend un entier >= 0, reçu ${String(rawCount)}. ` +
        "Un total qui n'a pas été LU ne doit pas être rendu comme un zéro (DNC-08).",
    );
  }
  return rawCount as ResultTotal;
}

/**
 * MARQUE une CARDINALITÉ d'agrégat (`groupBy(...).length`, `count()`) comme une
 * vérité d'ensemble.
 *
 * ⚠ LIRE CECI AVANT DE CRIER À DNC-01 (ADR-080 §D4, vocabulaire d'ADR-079 §D3) :
 * `groupBy({ by: ['teacherProfileId'], where }).length` est une TÊTE DE COMPTE,
 * PAS la longueur d'une fenêtre. `groupBy` ne porte AUCUN `take` et n'en a pas
 * besoin : sa cardinalité EST la réponse. La longueur interdite est celle d'un
 * tableau BORNÉ par une taille de page ; celle-ci ne l'est pas, par construction.
 */
export function distinctGroupCount(groups: readonly unknown[]): ResultTotal {
  return resultTotal(groups.length);
}

/* ================================================================== *
 * L'ENTRÉE DE REGISTRE (ADR-041 §D4)
 * ================================================================== */

export const PAGE_WINDOW_DEFINITION = {
  id: 'query.page-window',
  definition:
    'Une fenêtre de page est UNE analyse : `limit` est un entier de 1 à un plafond ' +
    "fourni par le point d'entrée (défaut fourni lui aussi), `offset` un entier >= 0. " +
    'Toute valeur hors bornes est REJETÉE en 400 — jamais écrêtée, jamais remplacée ' +
    "par le défaut. La taille de la fenêtre (`PageSize`) et la taille de l'ensemble " +
    '(`ResultTotal`) sont deux types distincts, pour que la première ne puisse pas ' +
    'porter le nom de la seconde.',
  /** Hérités, NON résolus par ce module (DNC-06). */
  inheritedFindings: ['PF-419', 'PF-420', 'PF-421', 'PF-422', 'PF-426'],
  /** ADR-041 Consequences — pas ratifiée par un utilisateur école. */
  confirmed: false as const,
} as const;
