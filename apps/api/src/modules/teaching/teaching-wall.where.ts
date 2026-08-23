import type { Prisma } from '@prisma/client';

/* ══════════════════════════════════════════════════════════════════════════════
 * S-E05-16 / `AC-4` / `PF-270` / `ADR-066 §D3` — LE SEUL SEAU « TeachingWall ».
 *
 * Ces deux prédicats ont été ÉCRITS dans `enrollments/enrollments.controller.ts`
 * (`:221` et `:405`) par `S-E05-14` puis `S-E05-15`. Ils sont DÉPLACÉS ICI, à la
 * ligne près et sans un caractère de logique changé, pour une raison mesurée et
 * non esthétique :
 *
 *   `enrollments.controller.ts:37` importe DÉJÀ `StudentAccessService` depuis
 *   `../students/student-access.service`. Faire l'inverse — importer
 *   `teacherSectionsWhere` DEPUIS `student-access.service.ts` — fermerait un
 *   cycle `require` CJS DUR entre un contrôleur décoré et un provider Nest : au
 *   moment où les décorateurs du contrôleur s'exécutent, l'objet de module de
 *   `students/` serait à moitié initialisé et `StudentAccessService` vaudrait
 *   `undefined`. Nest échouerait AU BOOT, avec une trace qui ne nomme ni le
 *   cycle ni le fichier fautif.
 *
 * `teaching/` est une FEUILLE vérifiée ce run : tous ses imports relatifs vont
 * vers `shared/` ou `school-structure/`, aucun vers `enrollments/`, `students/`
 * ou `calendar/`. Le fichier lui-même n'importe QUE le type `Prisma` — aucun
 * décorateur, aucun provider, aucune dépendance Nest : il est importable depuis
 * n'importe quel module sans créer d'arête de module.
 *
 * `PF-270` n'est PAS clos par ce déplacement : les TROIS copies divergentes du
 * prédicat (`messaging.service.ts:90` `isTeacherOfStudent`,
 * `remediation.service.ts:912`, et la copie `S-E05-5` sur une autre clé de
 * jointure) sont toujours là. Ce fichier crée l'ADRESSE vers laquelle elles
 * convergeront ; il n'ajoute PAS une QUATRIÈME copie, ce qui était l'interdit.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `AC-3` + `AC-12` — le mur d'enseignement, en UNE instruction entièrement
 * SCALAIRE, et le type qui rend le fail-open INEXPRIMABLE.
 *
 * `teacherProfileId` est NON OPTIONNEL, délibérément. Prisma RETIRE les clés
 * `undefined` d'un `where` : écrit naïvement
 * `{ tenantId, classSectionId, teacherProfileId: tp?.id }` avec `tp === null`,
 * la requête devient « la première affectation de cette classe, à QUI QUE CE
 * SOIT » et l'appelant sans profil est ACCORDÉ. Le contrôleur doit donc rendre
 * son 403 AVANT que ce `where` existe — et la signature ci-dessous fait qu'il
 * ne peut pas faire autrement.
 *
 * `ADR-063 §D1` — POURQUOI AUCUNE CLAUSE D'ANNÉE SCOLAIRE ICI, ALORS QUE
 * `ADR-061 §D1` EN EXIGEAIT UNE. Le mur d'`attendance` est ÉLÈVE-clé : il
 * marche `professeur → affectations → classes → inscriptions → élève`, où
 * l'année est LIBRE, et comme `@@unique([teacherProfileId, classSectionId,
 * subjectId])` ne contient PAS `academicYearId`, une affectation SURVIT au
 * changement d'année et rejoindrait une inscription COURANTE. Ici les deux
 * côtés sont ancrés sur le MÊME `classSectionId`, et `ClassSection` est
 * elle-même épinglée à une année (`academicYearId` non nul, `@@unique(
 * [academicYearId, gradeLevelId, name])`, `schema.prisma:457`, `:478`) : l'id
 * de section fournit DÉJÀ l'année. Une affectation périmée pointe vers
 * l'ANCIENNE section — un autre id, dont la liste d'appel est l'ancienne.
 *
 * Pire, une clause d'année NUIRAIT :
 *  • `TeachingAssignment.academicYearId` est une colonne simple, sans clé
 *    étrangère composite vers `ClassSection.academicYearId` — les deux peuvent
 *    DIVERGER en données, et filtrer refuserait un professeur qui enseigne
 *    RÉELLEMENT la classe aujourd'hui ;
 *  • elle refuserait aussi un professeur consultant une section d'une année
 *    RÉVOLUE qu'il a authentiquement enseignée.
 * Précédent maison pour un contrôle section-clé : `announcements.controller.ts:1155`
 * — `{ tenantId, teacherProfileId, classSectionId }`, sans année.
 *
 * `findFirst` et non `findUnique` : un professeur peut détenir une affectation
 * PAR MATIÈRE sur la même section (la clé d'unicité inclut `subjectId`), donc
 * plusieurs lignes satisfont ce `where`. Seule leur EXISTENCE nous intéresse.
 *
 * `tenantId` est EXPLICITE et n'est pas redondant : les déploiements
 * d'aujourd'hui empruntent le chemin `degraded_no_app_url`, où la connexion du
 * PROPRIÉTAIRE échappe à ses propres policies RLS (`ADR-032 §D5` /
 * `ADR-042 §D1`). Cette clause est la SEULE chose qui filtre, et sans elle une
 * ligne d'affectation dérivée d'un autre tenant AUTORISERAIT.
 */
export function teacherOfSectionWhere(input: {
  readonly tenantId: string;
  readonly classSectionId: string;
  readonly teacherProfileId: string;
}): Prisma.TeachingAssignmentWhereInput {
  return {
    tenantId: input.tenantId,
    classSectionId: input.classSectionId,
    teacherProfileId: input.teacherProfileId,
  };
}

/**
 * `AC-4` / `FR-3` — les sections qu'un professeur ENSEIGNE, et le type qui rend
 * le fail-open INEXPRIMABLE.
 *
 * Jumeau de `teacherOfSectionWhere` (juste au-dessus, MÊME FICHIER depuis
 * `S-E05-16`) pour le cas LISTE : `teacherProfileId`
 * est NON OPTIONNEL, délibérément. Prisma RETIRE les clés `undefined` d'un
 * `where` : écrit naïvement `{ tenantId, teacherProfileId: tp?.id }` avec
 * `tp === null`, la requête devient « TOUTES les affectations du tenant » et
 * l'appelant sans profil reçoit la portée de l'établissement entier — un
 * fail-open SILENCIEUX, en HTTP 200, strictement pire que le bug d'origine. Le
 * contrôleur doit donc rendre son 403 AVANT que ce `where` existe, et cette
 * signature fait qu'il ne peut pas faire autrement.
 *
 * `tenantId` est EXPLICITE pour la raison d'`ADR-032 §D5` rappelée ci-dessus :
 * c'est lui qui garantit que la liste de portée ne peut pas contenir la section
 * d'un AUTRE tenant, et donc qu'un `?classSectionId=<section étrangère>` tombe
 * sur une INTERSECTION VIDE au lieu d'être autorisé.
 *
 * AUCUNE clause d'année scolaire, pour la raison déjà arbitrée en
 * `ADR-063 §D1` : `ClassSection` est elle-même épinglée à une année
 * (`academicYearId` non nul, `schema.prisma`), donc l'id de section porte DÉJÀ
 * l'année ; et `TeachingAssignment.academicYearId` peut DIVERGER de celui de sa
 * section (colonne simple, pas de clé étrangère composite), donc filtrer
 * refuserait un professeur qui enseigne réellement la classe aujourd'hui.
 */
export function teacherSectionsWhere(input: {
  readonly tenantId: string;
  readonly teacherProfileId: string;
}): Prisma.TeachingAssignmentWhereInput {
  return {
    tenantId: input.tenantId,
    teacherProfileId: input.teacherProfileId,
  };
}
