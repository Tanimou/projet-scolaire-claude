import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { type UserSyncService } from '../../shared/auth/user-sync.service';
import { type PrismaService } from '../../shared/prisma/prisma.service';
import { StudentAccessService } from '../students/student-access.service';
import { type TeacherProfileService } from '../teaching/teacher-profile.service';

import { GradesController } from './grades.controller';
import { type GradesService } from './grades.service';
import { matchesStatusFilter } from '../../shared/testing/prisma-status-filter';

/**
 * S-E03-2 / `AC-1` / `PF-288` / `ADR-071` — les DEUX lectures « notes de cet
 * élève » passent par l'ABAC élève CANONIQUE.
 *
 * ROUGE-AVANT, ET SUR QUEL BRAS EXACTEMENT
 * ----------------------------------------
 * Avant cette tranche, `grades.controller.ts` portait sa PROPRE chaîne
 * `assertCanReadStudent`, dont la branche enseignante était un `return;` nu
 * commenté « teachers can read any student in their school ». Le cas
 * `un enseignant SANS aucune TeachingAssignment pour l'élève` RÉSOLVAIT donc,
 * et le premier `it` de ce fichier échouait sur l'arbre pré-diff — pas parce
 * qu'un test manquait, mais parce que le produit répondait 200.
 *
 * LE CONTRÔLE NÉGATIF N'EST PAS DÉCORATIF (R-30 / TOOL-13)
 * -------------------------------------------------------
 * Un garde qui refuse TOUT LE MONDE satisferait le cas de refus. Deux cas
 * l'interdisent : l'enseignant qui ENSEIGNE BIEN l'élève doit toujours
 * résoudre ET voir les `draft` (`seePrivate`), et le parent tuteur doit
 * toujours résoudre en ne voyant que `published`/`revised`. Sans eux, cette
 * suite serait verte devant une régression totale.
 *
 * POURQUOI LE VRAI `StudentAccessService`, ET NON UN DOUBLE
 * --------------------------------------------------------
 * Un `canAccessStudent: jest.fn().mockResolvedValue(false)` prouverait que le
 * contrôleur propage un booléen, pas que la branche ENSEIGNANTE est BORNÉE.
 * C'est la borne qui est la correction. Le service canonique est donc
 * instancié pour de vrai, au-dessus d'une base en mémoire ; seuls Prisma et
 * `TeacherProfileService` sont doublés.
 *
 * POURQUOI LE CONTRÔLEUR EST CONSTRUIT DIRECTEMENT
 * -----------------------------------------------
 * `students-list-teacher-scope.spec.ts` avertit — à juste titre — qu'un
 * contrôleur construit à la main court-circuite les pipes et les gardes que
 * Nest enregistre sur la ROUTE. Cet avertissement porte sur les VALIDATIONS DE
 * ROUTE ; ici la question est le corps du handler, où l'ABAC vit réellement, et
 * `@RequiresPermission('grades.read')` est une couche SÉPARÉE (elle décide
 * « ce rôle peut-il lire des notes », jamais « lesquelles »). Les deux cas de
 * refus ci-dessous portent un jeton qui a DÉJÀ franchi cette couche.
 *
 * HERMÉTIQUE : aucune fixture de seed, aucun id de la base de développement
 * (`hermetic-spec-writers-gate.spec.ts`). Tout est construit ici.
 */

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const SCHOOL = 'school-1';

const STUDENT_TAUGHT = 'student-taught';
const STUDENT_STRANGER = 'student-stranger';
const STUDENT_FOREIGN = 'student-foreign';

const SECTION_TAUGHT = 'section-taught';
const SECTION_OTHER = 'section-other';

const TEACHER_USER = 'user-teacher';
const TEACHER_PROFILE = 'tp-teacher';
const PARENT_USER = 'user-parent';

type Row = Record<string, unknown>;

const jwtOf = (...roles: string[]): KeycloakJwtPayload => ({
  sub: 'sub-' + roles.join('-'),
  realm_access: { roles },
});

/**
 * La base en mémoire. Trois tables suffisent pour les trois branches du service
 * canonique (`teacher`, `parent`, `student`), et `student` sert aussi la
 * pré-vérification 404 du contrôleur.
 */
function makeWorld() {
  const students: Row[] = [
    { id: STUDENT_TAUGHT, tenantId: TENANT, schoolId: SCHOOL, userProfileId: null },
    { id: STUDENT_STRANGER, tenantId: TENANT, schoolId: SCHOOL, userProfileId: null },
    { id: STUDENT_FOREIGN, tenantId: OTHER_TENANT, schoolId: 'school-2', userProfileId: null },
  ];
  // L'enseignant enseigne SECTION_TAUGHT. STUDENT_STRANGER est inscrit ailleurs.
  const assignments: Row[] = [
    { classSectionId: SECTION_TAUGHT, teacherProfileId: TEACHER_PROFILE, tenantId: TENANT },
  ];
  const enrollments: Row[] = [
    { studentId: STUDENT_TAUGHT, classSectionId: SECTION_TAUGHT, tenantId: TENANT, status: 'active' },
    { studentId: STUDENT_STRANGER, classSectionId: SECTION_OTHER, tenantId: TENANT, status: 'active' },
  ];
  // Le parent est tuteur ACTIF de STUDENT_TAUGHT uniquement.
  const guardianships: Row[] = [
    { studentId: STUDENT_TAUGHT, tenantId: TENANT, status: 'active', guardianUserProfileId: PARENT_USER },
  ];

  const gradeFindMany = jest.fn(async (_args: { where: Row }) => [] as Row[]);
  const statsForStudent = jest.fn(async () => ({ overall: null, bySubject: [] }));

  const prisma = {
    student: {
      findUnique: jest.fn(async (args: { where: { id: string } }) =>
        students.find((s) => s['id'] === args.where.id) ?? null,
      ),
      findFirst: jest.fn(async (args: { where: { tenantId: string; userProfileId: string } }) =>
        students.find(
          (s) => s['tenantId'] === args.where.tenantId && s['userProfileId'] === args.where.userProfileId,
        ) ?? null,
      ),
    },
    teachingAssignment: {
      findMany: jest.fn(async (args: { where: { tenantId: string; teacherProfileId: string } }) =>
        assignments.filter(
          (a) => a['tenantId'] === args.where.tenantId && a['teacherProfileId'] === args.where.teacherProfileId,
        ),
      ),
    },
    enrollment: {
      findMany: jest.fn(
        async (args: { where: { tenantId: string; status: string; classSectionId: { in: string[] } } }) =>
          enrollments.filter(
            (e) =>
              e['tenantId'] === args.where.tenantId &&
              e['status'] === args.where.status &&
              args.where.classSectionId.in.includes(e['classSectionId'] as string),
          ),
      ),
    },
    guardianship: {
      findMany: jest.fn(
        async (args: {
          where: { tenantId: string; status: string; guardian: { userProfileId: string } };
        }) =>
          guardianships.filter(
            (g) =>
              g['tenantId'] === args.where.tenantId &&
              matchesStatusFilter(g['status'] as string, args.where.status) &&
              g['guardianUserProfileId'] === args.where.guardian.userProfileId,
          ),
      ),
    },
    grade: { findMany: gradeFindMany },
  };

  /** Le VRAI service canonique, au-dessus de la base en mémoire. */
  const teachers = {
    findForUser: jest.fn(async (user: { id: string }) =>
      user.id === TEACHER_USER ? { id: TEACHER_PROFILE } : null,
    ),
  };
  const access = new StudentAccessService(
    prisma as unknown as PrismaService,
    teachers as unknown as TeacherProfileService,
  );

  const users = {
    ensureUser: jest.fn(async (jwt: KeycloakJwtPayload) => ({
      id: jwt.sub === 'sub-parent' ? PARENT_USER : TEACHER_USER,
      tenantId: TENANT,
    })),
  };

  const controller = new GradesController(
    prisma as unknown as PrismaService,
    users as unknown as UserSyncService,
    teachers as unknown as TeacherProfileService,
    { statsForStudent } as unknown as GradesService,
    access,
  );

  return { controller, gradeFindMany, statsForStudent, prisma };
}

/** `ensureUser` mappe `sub` → id de profil ; ces jetons choisissent l'identité. */
const TEACHER_JWT: KeycloakJwtPayload = { sub: 'sub-teacher', realm_access: { roles: ['teacher'] } };
const PARENT_JWT: KeycloakJwtPayload = { sub: 'sub-parent', realm_access: { roles: ['parent'] } };
const ADMIN_JWT = jwtOf('school_admin');

describe('AC-1 — GET /grades/students/:id/grades : la branche ENSEIGNANTE est BORNÉE (PF-288)', () => {
  it('ROUGE-AVANT — un enseignant SANS affectation pour cet élève est REFUSÉ (il résolvait)', async () => {
    const { controller, gradeFindMany } = makeWorld();

    await expect(controller.studentGrades(STUDENT_STRANGER, TEACHER_JWT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Le refus précède la lecture : aucune ligne de note n'est même demandée.
    expect(gradeFindMany).not.toHaveBeenCalled();
  });

  it('ROUGE-AVANT — même refus sur `/stats`, le handler JUMEAU du même garde', async () => {
    const { controller, statsForStudent } = makeWorld();

    await expect(
      controller.studentStats(STUDENT_STRANGER, undefined, undefined, TEACHER_JWT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(statsForStudent).not.toHaveBeenCalled();
  });

  it('CONTRÔLE NÉGATIF — un enseignant QUI enseigne l’élève résout TOUJOURS, et voit toujours les `draft`', async () => {
    const { controller, gradeFindMany } = makeWorld();

    await expect(controller.studentGrades(STUDENT_TAUGHT, TEACHER_JWT)).resolves.toEqual({ data: [] });

    const where = gradeFindMany.mock.calls[0]?.[0].where as Row | undefined;
    expect(where).toBeDefined();
    expect(where?.['studentId']).toBe(STUDENT_TAUGHT);
    expect(where?.['tenantId']).toBe(TENANT);
    // `seePrivate` est CONSERVÉ TEL QUEL (`FR4`) : pour du personnel, AUCUNE
    // contrainte de statut n'est posée. Si cette clé apparaissait, la tranche
    // aurait silencieusement retiré aux enseignants la visibilité des brouillons.
    expect(where?.['status']).toBeUndefined();
  });

  it('CONTRÔLE NÉGATIF — le parent TUTEUR résout, et ne voit QUE `published`/`revised`', async () => {
    const { controller, gradeFindMany } = makeWorld();

    await expect(controller.studentGrades(STUDENT_TAUGHT, PARENT_JWT)).resolves.toEqual({ data: [] });

    const where = gradeFindMany.mock.calls[0]?.[0].where as Row | undefined;
    expect(where?.['status']).toEqual({ in: ['published', 'revised'] });
  });

  it('le parent NON tuteur reste refusé — la branche parent ne régresse pas', async () => {
    const { controller, gradeFindMany } = makeWorld();

    await expect(controller.studentGrades(STUDENT_STRANGER, PARENT_JWT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(gradeFindMany).not.toHaveBeenCalled();
  });
});

describe('AC-1 / FR3 — 404 AVANT 403 : pas d’oracle d’existence inter-tenant', () => {
  it.each([
    ['enseignant', TEACHER_JWT],
    ['parent', PARENT_JWT],
    ['administrateur', ADMIN_JWT],
  ])('un `studentId` d’un AUTRE tenant rend 404 (jamais 403) — appelant %s', async (_label, jwt) => {
    const { controller } = makeWorld();
    await expect(controller.studentGrades(STUDENT_FOREIGN, jwt)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      controller.studentStats(STUDENT_FOREIGN, undefined, undefined, jwt),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un `studentId` INEXISTANT rend 404 aussi — indiscernable du tenant étranger', async () => {
    const { controller } = makeWorld();
    await expect(controller.studentGrades('no-such-student', TEACHER_JWT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AC-1 — la COPIE PRIVÉE a bien disparu de la source', () => {
  const RAW = readFileSync(join(__dirname, 'grades.controller.ts'), 'utf8');

  /**
   * LE CODE, COMMENTAIRES DE BLOC RETIRÉS — et c’est une CORRECTION DE SPEC
   * faite au land pass de `S-E03-2`, pas une commodité.
   *
   * Écrites contre la source BRUTE, les assertions de ce bloc échouaient sur la
   * DOCUMENTATION DE LEUR PROPRE CORRECTIF : le docblock qui remplace la chaîne
   * privée CITE, entre guillemets, le commentaire du fail-open qu’il vient de
   * supprimer, pour que le prochain lecteur sache ce qui vivait là. Le seul
   * moyen de verdir la version brute aurait été d’EFFACER cette explication —
   * un test qui exige la suppression de la documentation du correctif qu’il
   * garde. `S-E03-4` (run 80) a rencontré le piège identique sur un
   * `not.toContain` visant une source brute, et l’a tranché dans le même sens :
   * le défaut était dans la SPEC, jamais dans le code.
   *
   * Ces assertions portent sur le CODE. Elles lisent donc le code. Retirer des
   * commentaires ne peut que RÉTRÉCIR la chaîne inspectée, donc ne peut pas
   * rendre vrai un `not.toContain` qui serait faux sur du code réel : la
   * correction ne peut pas masquer une régression, seulement cesser de
   * signaler une phrase française.
   */
  const stripBlockComments = (src: string): string => {
    // Bornes CONCATÉNÉES, comme les motifs plus bas : écrites en toutes lettres,
    // ce fichier deviendrait lui-même un faux positif pour le grep du relecteur
    // suivant (`PF-295`). Et PAS de regex : l’échappement d’une regex de
    // commentaire est exactement le genre de détail qui se casse en silence.
    const OPEN = '/' + '*';
    const CLOSE = '*' + '/';
    let out = '';
    let i = 0;
    for (;;) {
      const open = src.indexOf(OPEN, i);
      if (open === -1) return out + src.slice(i);
      out += src.slice(i, open);
      const close = src.indexOf(CLOSE, open + OPEN.length);
      if (close === -1) return out;
      i = close + CLOSE.length;
    }
  };

  const SOURCE = stripBlockComments(RAW);

  it('plus aucune lecture privée de `guardianship` liée à l’identité de l’appelant', () => {
    // Motifs CONCATÉNÉS : écrits en toutes lettres, ce fichier deviendrait
    // lui-même un faux positif pour le grep du relecteur suivant (`PF-295`).
    expect(SOURCE).not.toContain('guardian' + ': { userProfileId: me.id }');
    expect(SOURCE).not.toContain('guardianship.' + 'findFirst');
  });

  it('le commentaire du fail-open enseignant a disparu avec le code qu’il décrivait', () => {
    expect(SOURCE).not.toContain('teachers can read any student');
  });

  it('les deux handlers résolvent par le service canonique', () => {
    expect(SOURCE).toContain('this.studentAccess.canAccessStudent');
    // Un seul point de conversion `false → 403` : le délégué. S'il y en avait
    // deux, la règle aurait recommencé à se dupliquer. On compte l'APPEL, pas le
    // mot — un docblock qui nomme la méthode n'est pas un second site.
    expect(SOURCE.split('this.studentAccess.canAccessStudent').length - 1).toBe(1);
  });
});
