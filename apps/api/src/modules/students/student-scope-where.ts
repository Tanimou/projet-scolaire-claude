import { Prisma } from '@prisma/client';

/**
 * S-E03-3d / `PF-356` / `PF-12` axe 4 / `ADR-076` — LA PORTÉE D'UNE LECTURE
 * ÉLÈVE, DÉRIVÉE UNE FOIS.
 *
 * LA RÈGLE, EN UNE PHRASE
 * -----------------------
 * `schoolId` et `id: { in: … }` ne CO-OCCURRENT JAMAIS dans le `where` d'une
 * lecture élève. C'est une DISJONCTION, pas une soustraction : le sentinel
 * `studentIds === null` (admins seuls) garde son école de travail, et un JEU
 * D'IDS EXPLICITE (parent / enseignant / élève-lui-même) est déjà l'autorité et
 * repart SANS clé d'école.
 *
 * LE DÉFAUT QU'ELLE FERME (mesuré 2026-08-26)
 * -------------------------------------------
 * `students.controller.ts` posait `{ tenantId, schoolId, ...(scope.studentIds
 * === null ? {} : { id: { in: scope.studentIds } }) }`, où `schoolId` vient de
 * `SchoolContextService.forUser` — c'est-à-dire, `school-context.service.ts`
 * `resolveDefaultSchoolId`, « l'école du tenant qui porte le plus de données,
 * égalités départagées par `createdAt asc` ». Dans un tenant MULTI-ÉCOLES, un
 * parent dont l'enfant n'est pas dans cette école-là recevait une liste VIDE de
 * `GET /students`, alors que `GET /students/:id` rendait ce même enfant en
 * entier (le chemin de détail n'a aucun filtre d'école : il gate sur
 * `canAccessStudent`). Le worker, lui, envoyait un digest hebdomadaire à propos
 * d'un enfant que le portail déclarait inexistant
 * (`parent-digest-cron.service.ts` résout sa population sur
 * `guardianship` + `guardianshipLiveWhere()` sous `tenantId`, sans école). Trois
 * projections, trois populations : c'est `PF-12` dans sa forme la plus nue.
 *
 * POURQUOI L'INTERSECTION N'AJOUTAIT AUCUNE SÉCURITÉ (réfutation de
 * « défense en profondeur », `ADR-076 §D1`)
 * ---------------------------------------------------------------------
 * `StudentAccessService.scopeForUser` rend, pour un parent, EXACTEMENT les
 * élèves sous tutelle VIVANTE, requête déjà keyée sur `user.tenantId`. Le jeu
 * d'ids EST la clôture d'autorisation. L'intersecter avec une HEURISTIQUE
 * (« la plus grosse école ») ne retire aucun élève que l'ABAC aurait laissé
 * passer à tort — elle ne retire que des élèves LÉGITIMES, et elle le fait
 * suivant une valeur qui bouge quand on inscrit des élèves dans une autre école.
 * Une couche de défense qui varie avec les données d'une école tierce n'est pas
 * une défense, c'est une source de contradiction.
 *
 * L'IDIOME EST DÉJÀ ÉCRIT DANS CE DÉPÔT — ce module n'invente rien
 * ----------------------------------------------------------------
 *  • `students.controller.ts` (`canonicalYearBySchool`) énonce déjà le principe
 *    gouvernant pour la clé d'année : « la clé est l'école QUI PORTE LES LIGNES
 *    (`student.schoolId`), jamais `SchoolContextService.forUser` », et nomme
 *    déjà l'axe 4 par son numéro.
 *  • `enrollments.controller.ts` — la liste parent SŒUR — n'a AUCUN `schoolId`
 *    dans son `where` et appelle `scopeForUser(me, jwt, '')`. La règle proposée
 *    ici est DÉJÀ implémentée sur l'autre liste atteignable par un parent ; ce
 *    module met les deux d'accord.
 *  • La forme « un prédicat nommé, exporté, testé, qui rend un fragment de
 *    `where` » est le QUATRIÈME exemplaire de l'idiome `guardianshipLiveWhere()`
 *    / `guardianshipOnTheBooksWhere()` / `candidateEnrollmentWhere()`.
 *
 * POURQUOI ICI ET PAS DANS `packages/contracts` : le type de retour est
 * `Prisma.StudentWhereInput`, donc le module est Prisma-typé — `ADR-072 §A1`
 * garde `packages/contracts` hors de la dépendance Prisma. Et pas dans
 * `link-liveness.ts` non plus : c'est un prédicat DIFFÉRENT (portée de lecture,
 * pas vivacité d'un lien). Un foyer CHACUN, pas un foyer pour tous.
 *
 * CE QUE CE MODULE NE FAIT PAS
 * ----------------------------
 *  • Il ne touche pas `Student.status` : la population rendue est « les élèves
 *    de ce tenant sur lesquels l'appelant tient une portée ABAC », JAMAIS
 *    « les élèves inscrits ». `PF-360` (est-ce que `status` doit gater la
 *    visibilité parent ?) reste OUVERT et attend une décision produit.
 *  • Il n'ajoute ni ne retire de filtre APPELANT (`classSectionId`,
 *    `unenrolled`) : ceux-ci restent une INTERSECTION sous `AND`
 *    (`ADR-065 §D5`), en dehors de ce fragment.
 *  • Il ne touche pas `activeAcademicYearId`, qui reste résolu par
 *    `SchoolContextService.forUser` et ne sert QUE le filtre appelant
 *    `?unenrolled=true` — un paramètre sans appelant web (`PF-303`). Le résidu
 *    est ENREGISTRÉ (`PF-390`), pas corrigé ici.
 */
export function studentScopeWhere(input: {
  tenantId: string;
  /** L'école de travail de l'appelant. LUE UNIQUEMENT sur la branche non restreinte. */
  schoolId: string;
  /**
   * `null` = sentinel NON RESTREINT (admins seuls). Un tableau NARROWE, et le
   * tableau VIDE est le REFUS — jamais une clé absente (`ADR-065 §D5`).
   */
  studentIds: readonly string[] | null;
}): Prisma.StudentWhereInput {
  const { tenantId, schoolId, studentIds } = input;

  // `=== null` EXPLICITE : jamais la truthiness, JAMAIS `.length`. `[]` est
  // truthy en JS et `[].length` est falsy — un refactor en `studentIds?.length`
  // rendrait le TENANT ENTIER à un appelant dont la portée est VIDE (un parent
  // dont la tutelle vient d'être révoquée, un enseignant sans `TeacherProfile`).
  // C'est le fail-open que `ADR-065 §D5` a déjà payé une fois.
  if (studentIds === null) {
    // BRANCHE NON RESTREINTE — l'école de travail est un choix DÉLIBÉRÉ de
    // l'admin (préférence utilisateur, sinon l'école par défaut du tenant) et
    // elle est PRÉSERVÉE. Aucune clé `id` : il n'y a pas de jeu à intersecter.
    return { tenantId, schoolId };
  }

  // JEU D'IDS EXPLICITE — l'autorité, déjà tenant-keyée par l'ABAC. La clôture
  // reste DOUBLE : `tenantId` ET `id: { in: … }`. Un élève d'un AUTRE tenant est
  // refusé par la première clé ; un élève du MÊME tenant non gardé est refusé
  // par la seconde. Le jeu VIDE produit `id: { in: [] }`, impossible à
  // satisfaire — le REFUS, avec ou sans clé d'école.
  return { tenantId, id: { in: [...studentIds] } };
}
