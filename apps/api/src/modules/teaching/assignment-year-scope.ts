import type { Prisma } from '@prisma/client';

/* ══════════════════════════════════════════════════════════════════════════════
 * S-E03-13 / `PF-36` / `PF-04` / `ADR-087` — L'ANNÉE D'UNE AFFECTATION SE LIT
 * SUR SA SECTION, ET NULLE PART AILLEURS.
 *
 * `TeachingAssignment` porte DEUX axes d'année, et jusqu'à cette tranche les
 * lectures se partageaient entre les deux :
 *
 *   • AXE COLONNE  — `teaching_assignment.academic_year_id`, colonne simple ;
 *   • AXE SECTION  — `class_section.academic_year_id`, atteint par la jointure.
 *
 * Les deux axes PEUVENT DIVERGER, et ce n'est pas une hypothèse : il n'existe
 * AUCUNE clé étrangère composite `(class_section_id, academic_year_id)` vers
 * `class_section(id, academic_year_id)`. Mesuré au run 103 contre le Postgres
 * du CONTENEUR (`docker exec pilotage_postgres`) : une ligne dont
 * `academic_year_id` contredit celui de sa propre section est **ACCEPTÉE** par
 * la base (`INSERT 0 1`, puis `ROLLBACK` et dérive revenue à 0).
 * `teaching-wall.where.ts` le disait déjà en prose (`ADR-063 §D1`, second
 * point) ; personne ne l'avait exécuté.
 *
 * POURQUOI L'AXE SECTION EST LE CANONIQUE, et non un choix de goût :
 * `ClassSection` est elle-même ÉPINGLÉE à une année — `academicYearId` non nul
 * et `@@unique([academicYearId, gradeLevelId, name])` (`schema.prisma:457`,
 * `:478`). L'id de section DÉTERMINE donc déjà l'année, fonctionnellement. La
 * colonne de `TeachingAssignment` est une DÉNORMALISATION de cette valeur, pas
 * une seconde source : le seul site d'écriture de production la DÉRIVE de la
 * section (`teaching-assignments.controller.ts`, `academicYearId:
 * cls.academicYearId`). Un axe dérivé qui peut contredire sa source n'est pas
 * un axe : c'est une copie non contrainte. Le vocabulaire existait déjà —
 * `ROSTER_YEAR_IMPLIED_BY_SECTION` (`S-E03-7` / `ADR-079`) ; les lectures
 * d'affectations ne s'en servaient pas.
 *
 * CE QUE CETTE TRANCHE NE FAIT PAS, ET POURQUOI C'EST DIT ICI. Elle ne pose
 * PAS la clé étrangère composite qui rendrait la dérive INEXPRIMABLE. Faire
 * converger les lectures retire la divergence des NOMBRES ; seule la contrainte
 * retire la divergence des DONNÉES. C'est une migration `G-MIGRATION` avec son
 * propre plan expand/contract et son entrée dans
 * `scripts/restore-drill-baseline.json` — sa propre tranche, tracée `PF-473`.
 * Tant qu'elle n'est pas posée, la colonne reste écrivable à tort par un
 * import, une seed ou un correctif SQL à la main.
 *
 * CE QUI PROUVE QUE LA CONVERGENCE NE CHANGE AUCUN NOMBRE AUJOURD'HUI. Les
 * deux axes ont été COMPTÉS sur la base du conteneur, par année : 286 contre
 * 286 affectations, et 186 contre 186 enseignants distincts, delta 0 sur les
 * quatre années. La bascule est donc à sémantique constante sur les données
 * réelles — et à sémantique CORRIGÉE dès qu'une dérive existerait.
 *
 * `PF-472` EST FALSIFIÉE, et cette tranche naît de sa falsification. Le run 102
 * l'avait relevée en affirmant que `@@unique([teacherProfileId, classSectionId,
 * subjectId])` — sans `academicYearId` — empêchait un enseignant de reprendre
 * la même matière dans la même classe l'année suivante. C'est faux, pour la
 * raison même qui rend l'axe section canonique : « la même classe » sur deux
 * années sont DEUX LIGNES `class_section` distinctes, donc deux
 * `classSectionId` distincts, donc deux lignes que la clé d'unicité n'oppose
 * pas. Contrôle exécuté, même transaction : la section de l'année précédente
 * et l'affectation jumelle sont toutes deux ACCEPTÉES.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * La portée d'année d'une lecture d'affectations, dérivée de la SECTION.
 *
 * TOTALE par construction, et c'est l'intérêt : l'absence d'année (« toutes
 * années confondues ») est décidée ICI, une fois, au lieu d'être ré-épelée en
 * `...(yearId ? { academicYearId: yearId } : {})` sur chaque site. Cinq sites
 * portaient ce littéral ; cinq littéraux recopiés sont cinq occasions de
 * dériver — `DNC-01` dans sa forme la plus banale, exactement le constat de
 * `S-E03-3` sur les projections parent.
 *
 * ATTENTION — ce prédicat ne porte QUE l'année. Il ne porte pas `tenantId` et
 * ne doit jamais le porter : l'axe tenant est exigé explicitement par chaque
 * appelant (`ADR-032 §D5` — sous `degraded_no_app_url` la connexion
 * propriétaire échappe à ses propres policies RLS, et la clause de tenant est
 * la seule chose qui filtre). Un prédicat qui porterait les deux inviterait à
 * l'oublier quand l'année est absente.
 */
export function assignmentYearScopeWhere(
  academicYearId: string | null | undefined,
): Prisma.TeachingAssignmentWhereInput {
  return academicYearId ? { classSection: { academicYearId } } : {};
}

/**
 * Le NOM de l'axe retenu, pour que les tests et les revues puissent l'affirmer
 * sans relire la forme du `where`. Voir `ROSTER_YEAR_IMPLIED_BY_SECTION`
 * (`S-E03-7`), dont c'est le pendant côté affectations.
 */
export const ASSIGNMENT_YEAR_AXIS = 'section' as const;
