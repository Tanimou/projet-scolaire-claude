import { z } from 'zod';

import type { ResultTotal } from './page-window';

/**
 * S-E03-11 / PF-50 / PF-427 / ADR-081 — L'ENVELOPPE DE PAGE CANONIQUE : la
 * FORME de la réponse, déclarée UNE fois, VÉRIFIÉE côté client et DÉCLARÉE côté
 * serveur.
 *
 * Frère de `page-window.ts`, et strictement complémentaire :
 *
 *   `page-window.ts`  — CE QUE LA REQUÊTE DEMANDE : `?limit=&offset=` → `take`/`skip`.
 *   `page-envelope.ts` — CE QUE LA RÉPONSE REND   : `{ data, total, … }`.
 *
 * LE DÉFAUT QUE CE MODULE FERME, MESURÉ ET NON SUPPOSÉ
 * ----------------------------------------------------
 * `apps/web/src/lib/api-client.ts:124` finit par `return (await res.json()) as
 * T`. C'est une AFFIRMATION, pas une vérification : `T` est ce que le site
 * d'appel a écrit à la main, et RIEN ne le compare à ce que le serveur envoie.
 *
 * Recensé le 2026-08-28 AVANT la tranche, par le marcheur du cliquet et non par
 * un grep : **382** fichiers dans `apps/web/src`, **208** appels `api<…>(` sur
 * **116** fichiers, et ONZE lectures d'enveloppe sur SEPT fichiers —
 * CINQ déclarations NOMMÉES et SIX transtypages EN LIGNE :
 *
 *   NOMMÉES  admin/audit/page.tsx:66                 { data, total, kpis, filters }
 *            admin/exports/types.ts:31               { data, total }
 *            admin/students/page.tsx:53              { data, total, limit, offset }
 *            admin/teaching-assignments/types.ts:116 { data, total, limit, offset, totals, coverage }
 *            lib/parent-children.ts:44               { data, total? }   ← PORTAIL PARENT
 *   EN LIGNE admin/alerts/page.tsx:119,126,133,140,150   api<{ data, total }>
 *            admin/users/page.tsx:38                      api<{ data, total }>
 *
 * ⚠ Le brief annonçait QUATRE lectures et « aucun autre portail ne lit cette
 * forme ». Les deux affirmations sont FAUSSES sur cet arbre : la classe est
 * ONZE, et `lib/parent-children.ts` est une enveloppe du PORTAIL PARENT. Un
 * cliquet gelé à quatre aurait légalisé sept occurrences vivantes — c'est
 * pourquoi le recensement est du CODE (`page-envelope-boundary-gate.spec.ts`) et
 * non de la prose.
 *
 * APRÈS la tranche, re-mesuré sur le MÊME marcheur : **1** déclaration nommée
 * (le seul `parent-children.ts`, hors périmètre et enregistré `PF-429`), **6**
 * transtypages en ligne inchangés (`PF-428`), **205** appels `api<…>(` typés,
 * **4** fichiers délégant au contrat. PF-50 et PF-427 sont donc AVANCÉES, PAS
 * FERMÉES, et le cliquet le dit en test.
 *
 * ET LE DÉFAUT A DÉJÀ FAILLI PARTIR EN PRODUCTION. Dans le run 94, l'API
 * émettait `totals` pendant que la page admin lisait `summary`. Les DEUX moitiés
 * ont typé VERT, parce qu'`api<T>()` affirme `T` au lieu de le vérifier. Un
 * humain a comparé deux fichiers ; aucun test ne l'a vu.
 *
 * POURQUOI CE FOYER, ET PAS `apps/api/src/shared/` (ADR-081 §D1)
 * ---------------------------------------------------------------
 * Une enveloppe de page est un CONTRAT DE RÉPONSE : son sens est partagé entre
 * le serveur qui l'écrit et le client qui la lit. `apps/web` importe déjà
 * `@pilotage/contracts` (66 lignes d'import sur 51 fichiers) et épingle le MÊME
 * `zod ^3.23.8` que `packages/contracts` et `apps/api`. Poser la forme là où
 * `apps/web` ne peut pas la lire laisserait les deux moitiés en DEUX LISTES
 * TENUES À LA MAIN — la dérive que cette maison a déjà mesurée
 * (`project_paired_lists_drift`). Même règle qu'ADR-078 §D1, ADR-079 et
 * ADR-080 §D1.
 *
 * DEUX VISAGES, PARCE QU'UNE MARQUE NE SURVIT PAS AU FIL (ADR-081 §D2)
 * --------------------------------------------------------------------
 * `page-window.ts` le dit déjà : « la marque ne survit pas au fil : `JSON.parse`
 * rend des `number` nus ». Ce module ne prétend donc PAS le contraire.
 *
 *   (a) `pageEnvelope(item)` — L'ANALYSEUR DE FIL. Rend des nombres NUS. C'est
 *       ce que le client analyse.
 *   (b) `PageEnvelope<TItem>` — LE TYPE CÔTÉ SERVEUR. Son `total` est un
 *       `ResultTotal` IMPORTÉ de `./page-window`, jamais redéclaré : `total:
 *       data.length` CONTINUE de ne pas compiler (DNC-01, G-DNC).
 *
 * Les deux visages sont reliés par une ASSERTION DE COMPILATION
 * (`PageEnvelopeBridge` ci-dessous) : la sortie analysée et la projection DÉMARQUÉE de
 * `PageEnvelope<T>` doivent rester mutuellement assignables. Modifier un visage
 * sans l'autre ne compile plus.
 *
 * ⚠ LA LIGNE LA PLUS RISQUÉE DE LA TRANCHE, NEUTRALISÉE ICI (ADR-081 §D3)
 * -----------------------------------------------------------------------
 * Un `z.object` zod DÉPOUILLE les clés inconnues par défaut. Analyser
 * l'enveloppe d'audit à travers un `{ data, total }` nu SUPPRIMERAIT `kpis` et
 * `filters` À L'EXÉCUTION pendant que tous les types resteraient verts — quatre
 * cartes KPI en « Indisponible » sur `/admin/audit`, indiscernables d'une panne
 * d'API. Vérifié dans un processus node nu contre le zod installé (3.25.76) :
 *
 *     z.object({data,total}).parse(payloadAudit)                → {"data":…,"total":2}          ← kpis DISPARU
 *     z.object({data,total}).passthrough().parse(payloadAudit)  → …,"kpis":…,"filters":…,"surprise":true
 *     …passthrough().extend({kpis,filters}).parse(payloadAudit) → idem — `.extend()` PRÉSERVE le passthrough
 *
 * La fabrique est donc `.passthrough()`, et `.extend()` en hérite. Ce n'est PAS
 * un relâchement : la PRÉSENCE des clés requises reste imposée — c'est
 * exactement la dérive `totals`/`summary` du run 94 qui devient un rejet
 * (`safeParse` → `issues[0].path === ['totals']`, vérifié).
 *
 * L'ITEM N'EST PAS LE CONTRAT — LE CADRE L'EST (ADR-081 §D3, second volet)
 * ------------------------------------------------------------------------
 * Analyser PROFONDÉMENT chaque ligne transformerait la moindre nullabilité mal
 * transcrite en page morte : `/admin/audit` est la surface RGPD append-only, et
 * elle rend aujourd'hui correctement des lignes dont le type client n'a jamais
 * été confronté au serveur. Le contrat porte donc sur le CADRE — `data` est un
 * tableau, `total` un entier >= 0, les clés déclarées sont présentes — et
 * `unvalidatedItem<T>()` existe pour TYPER une ligne sans la VÉRIFIER. Un
 * appelant qui veut la vérification profonde passe simplement son propre schéma
 * d'item : la fabrique ne l'interdit pas, elle ne l'impose pas.
 *
 * `data` n'a AUCUN minimum : une page légitimement VIDE doit s'analyser. Un
 * `.min(1)`/`.nonempty()` ici ferait mourir `/admin/students` sur un
 * établissement sans élève inscrit — DNC-08 déguisé en validation.
 *
 * AUCUNE HORLOGE, AUCUN ENVIRONNEMENT, AUCUN FRAMEWORK
 * -----------------------------------------------------
 * Pas de `new Date(`, pas de `Date.now(`, pas de `process.env`, pas d'import
 * Nest, pas d'import Prisma. Même barre de pureté que `page-window.ts`, et
 * testable dans un processus node nu — il l'est :
 * `apps/api/src/shared/pagination/page-envelope.spec.ts`.
 *
 * CE QUE CE MODULE NE PROUVE PAS
 * -------------------------------
 * Rien de ce qui précède n'a été observé sur une pile en vol. Docker Desktop
 * refuse de démarrer (6ᵉ run consécutif) et la base locale `pilotage@5432` est
 * VIDE. Les trois comportements zod ci-dessus ont été exécutés dans un processus
 * node nu : c'est une preuve de MÉCANISME, jamais une preuve de DÉPLOIEMENT
 * (`project_proof_on_scratch_is_not_the_target`).
 */

/* ================================================================== *
 * (a) LE VISAGE « FIL » — ce que le client ANALYSE
 * ================================================================== */

/**
 * LA forme brute de l'enveloppe, déclarée UNE fois et réutilisée par la fabrique
 * ET par le pont de compilation. Deux littéraux séparés seraient deux listes.
 */
function pageEnvelopeShape<TItem extends z.ZodTypeAny>(item: TItem) {
  return {
    /**
     * AUCUN minimum, délibérément : une page vide est une réponse LÉGITIME.
     */
    data: z.array(item),
    /**
     * Un entier >= 0. Il est REQUIS : les quatre points d'entrée convertis
     * l'émettent tous, et le rendre optionnel ré-ouvrirait exactement la dérive
     * `totals`/`summary` du run 94 — une clé manquante analyserait VERT.
     */
    total: z.number().int().nonnegative(),
  };
}

/**
 * LA fabrique d'enveloppe de page, sur un schéma d'item fourni par l'appelant.
 *
 * ⚠ `.passthrough()` : le cadre ne DÉPOUILLE JAMAIS. Voir §D3 plus haut — c'est
 * la ligne qui empêche cette tranche de casser `/admin/audit` en la corrigeant.
 *
 * EXTENSIBLE, parce que trois des quatre enveloppes réelles portent des clés
 * supplémentaires :
 *
 *     pageEnvelope(rowSchema).extend({ kpis: …, filters: … })                 // audit
 *     pageEnvelope(rowSchema).extend({ limit: …, offset: … })                 // students
 *     pageEnvelope(rowSchema).extend({ limit, offset, totals, coverage })     // assignments
 *
 * `.extend()` PRÉSERVE le passthrough (vérifié : `ext._def.unknownKeys ===
 * 'passthrough'`), donc étendre ne ré-arme pas le dépouillement.
 */
export function pageEnvelope<TItem extends z.ZodTypeAny>(item: TItem) {
  return z.object(pageEnvelopeShape(item)).passthrough();
}

/**
 * TYPE une ligne sans la VÉRIFIER — le mode « cadre seul » d'ADR-081 §D3.
 *
 * `z.custom<T>()` sans validateur accepte tout (vérifié : objet, `null` et
 * `undefined` passent). Il donne donc à l'appelant le TYPE `T[]` sur `data`
 * sans transformer une nullabilité mal transcrite en page morte.
 *
 * Ce n'est PAS une échappatoire : c'est la portée du contrat, ÉNONCÉE. Le cadre
 * est vérifié ; la ligne est typée. Un appelant qui veut plus passe son schéma.
 */
export function unvalidatedItem<TItem>() {
  return z.custom<TItem>();
}

/**
 * TYPE une CLÉ SUPPLÉMENTAIRE sans la vérifier — mais en la gardant OBLIGATOIRE.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ NE PAS REMPLACER PAR `unvalidatedItem()` NI PAR `z.unknown()`. CETTE
 * FONCTION EST LA RAISON POUR LAQUELLE LE CONTRAT ATTRAPE LE DÉFAUT DU RUN 94.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * MESURÉ contre le zod installé (3.25.76), pas supposé :
 *
 *     z.custom().isOptional()   →  true
 *     z.unknown().isOptional()  →  true
 *
 * Une clé dont le schéma est « facultatif » au sens de zod est une clé
 * FACULTATIVE de l'objet. Donc, avec `z.custom()` en clé supplémentaire :
 *
 *     frame.extend({ totals: z.custom(), coverage: z.custom() })
 *          .safeParse({ data: [], total: 0, summary: {}, coverage: {} })
 *       →  success: TRUE          ← `totals` ABSENT, ACCEPTÉ
 *
 * C'est-à-dire que le renommage `totals` → `summary` du run 94 — le défaut
 * exact que cette tranche existe pour attraper — SURVIVRAIT au contrat censé
 * l'attraper, et `/admin/assignments` rendrait de nouveau quatre tirets
 * cadratins. Le contrat aurait l'air d'être là et ne protégerait rien.
 *
 * Le `.refine` rejetant `undefined` rend `isOptional()` faux, donc la clé
 * OBLIGATOIRE :
 *
 *     …extend({ totals: requiredKey(), … }).safeParse(mêmeCharge)
 *       →  success: FALSE, issues[0].path === ['totals']
 *
 * Il ne vérifie RIEN d'autre : le contenu reste non analysé (ADR-081 §D3 —
 * l'item n'est pas le contrat). Il vérifie la PRÉSENCE, qui est précisément la
 * classe de défaut « le serveur a renommé une clé, le client rend `undefined` ».
 *
 * `null` EST UNE ABSENCE, ET REFUSER `undefined` SEUL NE SUFFISAIT PAS
 * (`PF-434`, corrigé à la passe de land du run 95 — la tranche avait NOMMÉ ce
 * défaut dans sa propre condition de land nº 6 plutôt que de le taire).
 * Mesuré des DEUX CÔTÉS avant correction, même forme d'appel :
 *
 *     .refine(v => v !== undefined)               .safeParse({ totals: null })
 *       →  success: TRUE          ← ACCEPTÉ, puis `resp.totals.assignments`
 *                                   lève un TypeError qui ne NOMME aucune clé
 *                                   et ne porte aucun chemin — exactement le
 *                                   diagnostic muet que ce module remplace.
 *     .refine(v => v !== undefined && v !== null) .safeParse({ totals: null })
 *       →  success: FALSE, issues[0].path === ['totals']
 *
 * `totals: null` n'est pas une forme théorique : c'est ce que produit un
 * `?? null` défensif ou un sous-agrégat en échec, et le contrat le laissait
 * passer AU VERT. La clé ABSENTE reste rejetée dans les deux versions — la
 * correction n'échange pas un trou contre un autre, ce qui a été vérifié plutôt
 * que supposé.
 */
export function requiredKey<TValue>() {
  return z
    .custom<TValue>()
    .refine((v) => v !== undefined && v !== null, {
      message: "clé absente de l'enveloppe",
    });
}

/**
 * Le TÉMOIN du cadre — un schéma concret, sans `.passthrough()`, dont la sortie
 * analysée est comparée au visage serveur par `_Bridge`.
 *
 * Il est construit à partir de `pageEnvelopeShape` (le MÊME littéral que la
 * fabrique), donc le pont ne peut pas s'accorder avec une forme que la fabrique
 * n'émet plus.
 */
const PAGE_ENVELOPE_CORE_WITNESS = z.object(pageEnvelopeShape(z.custom<unknown>()));

/** La sortie ANALYSÉE du cadre, en nombres NUS. zod ne connaît pas les marques. */
export type PageEnvelopeWire = z.infer<typeof PAGE_ENVELOPE_CORE_WITNESS>;

/* ================================================================== *
 * (b) LE VISAGE « SERVEUR » — ce que le handler DÉCLARE
 * ================================================================== */

/**
 * L'enveloppe de page telle que le SERVEUR la déclare.
 *
 * `total` est un `ResultTotal` IMPORTÉ de `./page-window` — jamais redéclaré
 * (G-DNC / DNC-01). Un `number` nu, et donc `total: data.length`, N'EST PAS
 * assignable : le seul chemin est `resultTotal(count)` ou `distinctGroupCount()`.
 *
 * `data` est `readonly` et son item est laissé à l'appelant. Un handler qui veut
 * annoncer le CADRE sans figer la LIGNE écrit `PageEnvelope<unknown>` : c'est
 * délibéré, et c'est ce que fait `teaching-assignments.controller.ts` (ADR-081
 * §D3 — l'item n'est pas le contrat).
 */
export interface PageEnvelope<TItem> {
  readonly data: readonly TItem[];
  readonly total: ResultTotal;
}

/* ================================================================== *
 * LE PONT — modifier un visage sans l'autre ne compile plus
 * ================================================================== */

/**
 * Retire la MARQUE et le `readonly` d'un visage serveur, pour le comparer à ce
 * que `JSON.parse` peut réellement rendre.
 */
type Unbranded<T> = {
  -readonly [K in keyof T]: T[K] extends readonly (infer U)[]
    ? U[]
    : T[K] extends number
      ? number
      : T[K];
};

/**
 * L'ASSERTION DE COMPILATION. Elle n'accepte que `true` : une paire de visages
 * qui cesse d'être assignable rend `false`, et `false` ne satisfait pas la
 * contrainte — c'est une ERREUR DE COMPILATION, pas un test à lancer.
 *
 * (Formulée en DEUX assertions unidirectionnelles plutôt qu'en une contrainte
 * mutuelle `A extends B, B extends A` : celle-ci est une contrainte CIRCULAIRE,
 * que TypeScript rejette — TS2313.)
 */
type AssertTrue<T extends true> = T;

/**
 * Renommer `total` sur un seul des deux visages, changer `data` en autre chose
 * qu'un tableau, ou ajouter une clé à un visage et pas à l'autre, casse ICI — à
 * la compilation du paquet `contracts`, avant qu'un seul site d'appel n'ait été
 * lu.
 */
export type PageEnvelopeBridge = [
  AssertTrue<PageEnvelopeWire extends Unbranded<PageEnvelope<unknown>> ? true : false>,
  AssertTrue<Unbranded<PageEnvelope<unknown>> extends PageEnvelopeWire ? true : false>,
];

/* ================================================================== *
 * L'ENTRÉE DE REGISTRE (ADR-041 §D4)
 * ================================================================== */

export const PAGE_ENVELOPE_DEFINITION = {
  id: 'response.page-envelope',
  definition:
    "Une enveloppe de page est UNE forme : `data` est un tableau (jamais vide-interdit) et " +
    '`total` un entier >= 0 REQUIS, décrivant l’ensemble FILTRÉ et non la page. Le cadre ne ' +
    'DÉPOUILLE jamais les clés qu’il ne déclare pas, et il est extensible par `.extend()`. ' +
    'Côté serveur `total` est un `ResultTotal` marqué, pour qu’un `data.length` ne puisse pas ' +
    'porter son nom ; côté fil c’est un `number` nu, parce qu’une marque ne survit pas à ' +
    '`JSON.parse`. L’ITEM n’est pas le contrat : le CADRE l’est.',
  /**
   * HÉRITÉS, NON RÉSOLUS par ce module (DNC-06). Aucune de ces lignes n'est
   * corrigée ici ; elles sont NOMMÉES pour qu'une lecture future ne prenne pas
   * ce module pour la fermeture de la classe.
   *
   * `PF-426`  — 151 `findMany` sans `take` dans `apps/api/src`. Résiduel nommé
   *             de PF-50, gelé par `page-window-derivation-gate.spec.ts`.
   * `PF-427`  — la classe « enveloppe » elle-même : ONZE lectures, SEPT
   *             restent non converties après cette tranche. AVANCÉE, PAS FERMÉE.
   * `PF-428`  — les SIX lectures d'enveloppe encore faites par TRANSTYPAGE EN
   *             LIGNE (`admin/alerts/page.tsx:119,126,133,140,150` et
   *             `admin/users/page.tsx:38`). Gelées par R2, décroissantes.
   * `PF-429`  — `lib/parent-children.ts:44` déclare `total?` OPTIONNEL pendant
   *             que l'API l'envoie toujours ; la même route `/students` est lue
   *             sous DEUX formes écrites à la main, par DEUX portails.
   * `PF-430`  — le handler d'audit déclarait DÉJÀ `Promise<AuditListResult>` :
   *             son défaut n'était pas un type MANQUANT mais un SECOND type
   *             écrit à la main. Re-basé sur `PageEnvelope` par cette tranche.
   * `PF-439`  — `users.controller.ts:40` rend `total: items.length` sur une
   *             lecture NON BORNÉE : une longueur de page portant l'étiquette
   *             d'un total (DNC-01 VIVANT). NON corrigé ici — le corriger
   *             demanderait un `take`, donc un changement de ce que la page
   *             admin AFFICHE, hors de cette tranche.
   * `PF-440`  — ~9 autres émetteurs d'enveloppe côté API (`alerts.service.ts`,
   *             `meeting-requests.service.ts`, `exports.service.ts` ×4,
   *             `messaging.service.ts` ×2, `students.controller.ts`,
   *             `users.controller.ts`) déclarent la même forme à la main.
   *
   * ⚠ `PF-439` et `PF-440` sont RENUMÉROTÉS depuis `PF-428` et `PF-430` à la
   * passe de land du run 95. Ces deux ids désignaient chacun DEUX choses
   * différentes selon le fichier livré — ce module d'un côté, le cliquet, la
   * story et `analytics.service.ts:212` de l'autre. La tranche l'avait ÉNONCÉ
   * dans sa condition de land nº 3 au lieu de trancher en silence. Arbitré PAR
   * LE SENS, en gardant l'id que la SOURCE LIVRÉE citait le plus, jamais par
   * motif (`project_parallel_runs_collide_on_ids`).
   * `PF-431`  — 88 transtypages `api<{ data … }>` SANS `total` : la classe
   *             « affirmation non vérifiée » d'un cran en dessous.
   * `PF-432`  — `pageWindow` plafonne `limit` mais PAS `offset`.
   * `PF-433`  — `analytics.service.ts:3961` `distinctActorRows.length` ne passe
   *             pas par `distinctGroupCount()`.
   */
  inheritedFindings: [
    'PF-426',
    'PF-427',
    'PF-428',
    'PF-429',
    'PF-430',
    'PF-431',
    'PF-432',
    'PF-433',
    'PF-439',
    'PF-440',
  ],
  /** ADR-041 Consequences — pas ratifiée par un utilisateur école. */
  confirmed: false as const,
} as const;
