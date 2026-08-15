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
