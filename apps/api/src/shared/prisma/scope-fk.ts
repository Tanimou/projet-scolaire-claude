import { BadRequestException } from '@nestjs/common';

/**
 * S-E01-1e / ADR-051 §D3 — la moitié PURE de la sonde de propriété de FK de
 * portée, promue au partagé parce qu'un DEUXIÈME module l'a méritée.
 *
 * ADR-049 §D5 refuse un `assertOwnedByTenant(tx, modelName, id, tenantId)`
 * générique : une répartition dynamique par CHAÎNE sur le client Prisma. Ce
 * refus tient toujours, et ce fichier ne le contredit pas — il ne contient
 * AUCUN import Prisma, AUCUN accès à la base, AUCUNE répartition. Il ne porte
 * que le PRÉDICAT qui décide s'il y a quelque chose à vérifier.
 *
 * La moitié IMPURE — le `findFirst({ where: { id, tenantId } })` — reste écrite
 * EN LIGNE dans chaque callback de `this.scope.run(...)`, dans
 * `calendar.controller.ts` comme dans `lessons.controller.ts`. Ce n'est pas de
 * la superstition : le compteur d'attribution de `tenant-adversarial-check.js`
 * est LEXICAL et ne traverse pas `this` (PF-200). Une sonde derrière une méthode
 * partagée compterait NON COUVERTE tout en ayant l'air convertie, ou pire,
 * s'exécuterait sur la connexion du PROPRIÉTAIRE pendant qu'un compteur la
 * crédite au callback.
 *
 * Pourquoi partager ce prédicat de trois lignes plutôt que de le recopier : la
 * règle qu'il encode est SUBTILE et se perd à la copie. Deux listes tenues à la
 * main qui divergent est un défaut RÉPÉTÉ de ce dépôt ; deux prédicats de
 * sécurité tenus à la main le seraient aussi, et celui-ci se trompe en silence.
 */

/**
 * Un id de portée est FOURNI s'il est une chaîne NON VIDE — jamais « la clé est
 * présente ».
 *
 * Les deux raisons sont mesurées, pas supposées :
 *
 *  1. `null` et `''` sont des valeurs d'exécution VIVANTES. `@IsOptional()`
 *     laisse passer `null` malgré le `?: string` du DTO, et l'UI admin envoie
 *     `gradeLevelId: null` / `classSectionId: null` sur CHAQUE enregistrement.
 *     Les traiter comme fournis ferait échouer chaque écriture ordinaire.
 *  2. `findFirst({ where: { id: null } })` est une erreur de VALIDATION Prisma,
 *     donc un 500 — et `findFirst({ where: { id: undefined, tenantId } })` est
 *     pire encore : Prisma OMET le filtre, la requête rend la PREMIÈRE ligne du
 *     tenant et la vérification de propriété passe À VIDE sur chaque requête qui
 *     ne fournit pas d'id. C'est le mutant que le contrôle négatif « un id NUL
 *     réussit encore, ET aucune sonde n'a été émise » existe pour tuer.
 */
export function isSuppliedScopeId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * S-E01-1f / ADR-053 §D2 — LE RESTE DE LA MOITIÉ PURE, promu ici parce qu'un
 * TROISIÈME module l'aurait recopié à la main.
 *
 * `assertSingleScopeId`, `scopeOwnershipPlan` et `unknownScopeRef` vivaient dans
 * `calendar.controller.ts`. `announcements` en a besoin À L'IDENTIQUE : le
 * précédent de `mapWriteRefusal` (S-E01-1e) dit qu'une DEUXIÈME copie au module
 * n°2 EST la dérive, pas son risque. Il n'y a PAS de ré-export dans
 * `calendar.controller.ts` : deux adresses pour une règle, c'est exactement ce
 * que l'extraction existe pour empêcher.
 *
 * CE QUI N'EST DÉLIBÉRÉMENT PAS PARTAGÉ : la LISTE des champs. Chaque module
 * garde son propre tuple `as const` local (calendrier : quatre champs ;
 * annonces : cinq). Élargir une union fermée partagée à chaque nouveau module
 * en ferait une TROISIÈME liste tenue à la main — la maladie même que cet épic
 * combat. Ces trois helpers sont donc génériques sur `F extends string` et
 * lisent le tuple que l'appelant leur passe.
 *
 * La moitié IMPURE — la boucle `findFirst({ where: { id, tenantId } })` — reste
 * écrite EN LIGNE dans chaque handler (PF-200 : l'attribution de
 * `tenant-adversarial-check.js` est LEXICALE et ne traverse pas `this`).
 * ADR-049 §D5 refuse toujours un `assertOwnedByTenant(tx, modelName, …)`
 * générique, et ce fichier ne le contredit pas : toujours aucun import Prisma,
 * aucun accès à la base, aucune répartition dynamique.
 */
export type ScopeIdCarrier<F extends string> = Partial<Record<F, string | null>>;

/**
 * ADR-049 §D3 — AU PLUS UNE portée par corps de requête, sur les champs que
 * l'appelant déclare mutuellement exclusifs.
 *
 * Défini sur la VÉRACITÉ, jamais sur la présence de la clé : l'UI admin du
 * calendrier envoie toujours les deux, l'un explicitement `null`.
 */
export function assertSingleScopeId<F extends string>(
  body: ScopeIdCarrier<F>,
  fields: readonly F[],
): void {
  const supplied = fields.filter((field) => isSuppliedScopeId(body[field]));
  if (supplied.length > 1) {
    // CONCATÉNATION et non gabarit : ce message et celui d'`unknownScopeRef` ont
    // franchi une FRONTIÈRE DE CLIQUET en venant de `calendar.controller.ts`.
    // Tout fichier de `shared/prisma/` est lu par le cliquet de source AC-7
    // (`prisma.service.spec.ts:374`), qui refuse TOUT gabarit contenant une
    // interpolation non balisée `$queryRaw` / `Prisma.sql` — sans distinguer un
    // texte SQL d'un message français, et c'est DÉLIBÉRÉ : la seule règle qu'un
    // cliquet peut tenir sans jugement est « aucune interpolation nue ici ».
    //
    // Le message est INCHANGÉ à l'octet près à l'exécution. Le cliquet n'est pas
    // relâché d'un caractère pour accueillir du code venu d'ailleurs : c'est le
    // code qui adopte la règle de sa nouvelle maison (S-E01-1f).
    throw new BadRequestException(
      'Un seul périmètre peut être défini à la fois (' +
        supplied.join(', ') +
        ' ont été fournis ensemble).',
    );
  }
}

/**
 * La LISTE des vérifications de propriété à émettre, dans l'ordre. Pure : elle
 * ne touche pas la base, elle dit seulement quels couples (champ, id) doivent
 * être prouvés.
 */
export function scopeOwnershipPlan<F extends string>(
  body: ScopeIdCarrier<F>,
  fields: readonly F[],
): { field: F; id: string }[] {
  const plan: { field: F; id: string }[] = [];
  for (const field of fields) {
    const value = body[field];
    if (isSuppliedScopeId(value)) plan.push({ field, id: value });
  }
  return plan;
}

/**
 * ADR-049 §D2 — LE REFUS, et son indiscernabilité PAR CONSTRUCTION.
 *
 * « id d'un autre tenant » et « id inexistant » empruntent la MÊME branche
 * (`findFirst → null`) et produisent donc le MÊME message, à l'octet près. La
 * réponse ne peut pas distinguer les deux cas — cette distinction serait
 * elle-même un oracle d'existence inter-tenant (ADR-048 §D9).
 *
 * 400 et non 404 : les ids arrivent dans le CORPS (ou la query string du
 * preview), où tous les autres refus de ces handlers sont déjà des 400
 * français ; un 404 sur `POST` se lirait « route inconnue ». Le message nomme le
 * CHAMP (donnée de l'appelant) et jamais un tenant, une école, une table ni une
 * chaîne Postgres — `CalendarManager.tsx` comme `AnnouncementComposer.tsx`
 * l'affichent VERBATIM à un administrateur.
 */
export function unknownScopeRef(field: string): BadRequestException {
  // Concaténation, même raison qu'`assertSingleScopeId` ci-dessus (cliquet AC-7).
  return new BadRequestException('Le périmètre sélectionné est introuvable (' + field + ').');
}

/**
 * S-E05-3 / ADR-055 §D1 — LA MÊME MOITIÉ PURE, mais sur une COLLECTION.
 *
 * `scopeOwnershipPlan` répond « quels couples (champ, id) prouver » pour UN
 * corps portant AU PLUS un id par champ. La matrice de coefficients pose la
 * question au pluriel : `entries[]` porte un `gradeLevelId` et un `subjectId`
 * PAR LIGNE, et une sauvegarde ordinaire en compte trente.
 *
 * Pourquoi un planificateur d'ENSEMBLE plutôt que la boucle par référence de
 * l'ADR-053 §D1 : appliquée telle quelle, elle émettrait SOIXANTE `findFirst`
 * pour trente lignes — un nombre d'instructions borné par la REQUÊTE et non par
 * le SCHÉMA, exactement la forme que l'ADR-049 §D4 nomme comme violation. Le
 * plan rendu ici est borné par le nombre de CHAMPS déclarés : deux entrées,
 * donc deux sondes, quelle que soit la taille du corps.
 *
 * DÉDOUBLONNAGE INSENSIBLE À LA CASSE, et c'est mesuré, pas décoratif :
 * `@IsUUID()` (validator.js, drapeau `/i`) accepte un uuid en MAJUSCULES, que
 * Postgres accepte aussi mais renvoie en minuscules. La propriété se décide
 * ensuite par `owned.length !== ids.length` (ADR-055 §D1) : si le même uuid
 * arrivait deux fois dans deux casses, l'ensemble « distinct » en compterait
 * deux là où la base ne rend qu'UNE ligne, et une sauvegarde parfaitement
 * légitime serait refusée. La clé de dédoublonnage est donc la forme minuscule ;
 * la valeur ÉMISE reste l'orthographe reçue en premier, que Postgres normalise
 * lui-même à la comparaison.
 *
 * LÈVE plutôt que d'ignorer une ligne dont le champ n'est pas FOURNI. Sauter la
 * ligne produirait un ensemble d'ids plus court — au pire vide — et la sonde
 * émettrait alors un `where` que Prisma satisfait à VIDE : `0 === 0` passerait
 * et ne prouverait rien. C'est le chemin vacuous que le contrôle négatif de
 * chaque module existe pour tuer, et il est fermé ICI, une fois, pour tous.
 *
 * Toujours aucun import Prisma, aucun accès à la base, aucune répartition
 * dynamique par nom de modèle (ADR-049 §D5 tient). La moitié IMPURE — les deux
 * `findMany({ where: { id: { in }, tenantId, schoolId } })` — reste écrite EN
 * LIGNE dans le handler (PF-200).
 */
export function distinctScopeIdPlan<F extends string>(
  rows: readonly ScopeIdCarrier<F>[],
  fields: readonly F[],
): { field: F; ids: string[] }[] {
  const plan: { field: F; ids: string[] }[] = [];
  for (const field of fields) {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const value = row[field];
      // Pas de « la clé est présente » : `isSuppliedScopeId` est le SEUL
      // prédicat correct, et un id absent, vide ou nul prend ici la MÊME
      // branche de refus qu'un id étranger (ADR-049 §D2, indiscernabilité).
      if (!isSuppliedScopeId(value)) throw unknownScopeRef(field);
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(value);
    }
    plan.push({ field, ids });
  }
  return plan;
}
