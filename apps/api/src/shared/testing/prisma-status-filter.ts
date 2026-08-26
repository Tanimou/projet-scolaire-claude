/**
 * S-E03-3c / ADR-074 — LE COMPARATEUR DE STATUT DES DOUBLES PRISMA.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Plusieurs suites ABAC portent un faux `PrismaClient` qui filtre ses lignes
 * en mémoire, et toutes comparaient le statut par ÉGALITÉ NUE :
 *
 *     row.status === where.status
 *
 * Cela ne connaît qu'UNE des formes que Prisma accepte. Dès qu'un `where`
 * légitime emploie `status: { in: [...] }` — ce que fait désormais le prédicat
 * canonique `guardianshipLiveWhere()` — le double ne rend AUCUNE ligne, et la
 * suite échoue en signalant un refus d'accès qui n'existe pas dans le produit.
 * Six tests sont tombés exactement ainsi, et c'était le DOUBLE qui était
 * incomplet, pas le code sous test.
 *
 * ⚠ CE N'EST PAS UN ASSOUPLISSEMENT DES DOUBLES — C'EST UNE FIDÉLITÉ ACCRUE.
 * L'égalité nue ACCEPTAIT `{ in: [...] }` comme « statut différent », donc elle
 * répondait faux à une question que Prisma sait traiter. Après ce changement,
 * le double distingue toujours un statut qui ne correspond pas ; il cesse
 * seulement de se tromper sur une syntaxe qu'il ne connaissait pas.
 *
 * IL VIT DANS `src/` ET NON DANS UN `__fixtures__` À DESSEIN : il est importé
 * par des suites de QUATRE modules différents (`lessons`, `grades`,
 * `attendance`, `students`). Le recopier dans chacune recréerait la famille de
 * listes jumelles tenues à la main que ce dépôt a déjà payée une fois
 * (`academic_year.SELECT`, run 59) — à quatre exemplaires cette fois.
 */

/** Les formes de `where.<colonne>` que les doubles doivent savoir lire. */
export type PrismaStatusFilter<T extends string = string> =
  | T
  | { in?: readonly T[]; not?: T | { in?: readonly T[] } }
  | undefined;

/**
 * `row` satisfait-il `filter` ?
 *
 * Un `filter` `undefined` signifie « aucune contrainte », donc VRAI — c'est la
 * sémantique de Prisma, et c'est aussi celle qu'un `_count` non filtré
 * exprimait. Elle est reproduite fidèlement plutôt que corrigée : un double qui
 * refuse ce que le produit accepte est un double qui ment dans l'autre sens.
 */
export function matchesStatusFilter<T extends string>(
  rowStatus: T,
  filter: PrismaStatusFilter<T>,
): boolean {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return rowStatus === filter;

  if (filter.in !== undefined && !filter.in.includes(rowStatus)) return false;

  if (filter.not !== undefined) {
    if (typeof filter.not === 'string') {
      if (rowStatus === filter.not) return false;
    } else if (filter.not.in !== undefined && filter.not.in.includes(rowStatus)) {
      return false;
    }
  }

  return true;
}
