import { Injectable } from '@nestjs/common';
import { AnnouncementScope, Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * Computes the set of user_profile_ids that should receive a given announcement,
 * based on its scope. Used both at publish time (to materialise receipts) and
 * at read time (for ad-hoc lookups).
 *
 *   school_wide          → all user profiles in the tenant (admins + teachers + parents + linked students)
 *   cycle_scope          → guardians of students enrolled in classes of that cycle (+ teachers
 *                          assigned to those classes + the students' own linked accounts)
 *   grade_level_scope    → same, narrowed to the level
 *   class_section_scope  → guardians of enrolled students + teachers assigned to the class
 *                          + the enrolled students' own linked accounts (E8-S3)
 *   individual_student   → all guardians of that student + the student's own linked account (E8-S3)
 *   individual_user      → exactly one user profile
 *
 * E8-S3 (FR-S3-7): a student's own linked `UserProfile` is unioned in for the
 * class/grade/cycle/individual_student scopes (guarded by `userProfileId != null`)
 * so the learner receives a receipt. `school_wide` already covers every active
 * profile (linked students included). What guardians/teachers receive is unchanged.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ S-E01-1f / PF-208 — POURQUOI CHAQUE REQUÊTE PORTE `tenantId`             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Mesuré à `bc4e590` : CINQ des requêtes de ce fichier n'avaient AUCUN prédicat
 * de tenant (`guardianship`, `student`, `teachingAssignment`, `enrollment`, et
 * le passe-plat verbatim d'`individual_user`). Le contrôleur ne prouvait la
 * propriété d'AUCUN des cinq ids de portée qu'il persiste, donc un
 * `classSectionId` étranger énumérait en bloc les tuteurs + enseignants +
 * élèves liés du tenant VICTIME.
 *
 * Cette correction est une DÉFENSE EN PROFONDEUR, pas un doublon de la sonde du
 * contrôleur, et elle n'est pas optionnelle : le service doit être INCAPABLE de
 * rendre un `userProfileId` hors du tenant de l'annonce même si la sonde du
 * contrôleur disparaissait un jour — et surtout, `POST /:id/publish` recalcule
 * les destinataires à partir des ids STOCKÉS sans repasser par la sonde
 * (PF-230). Ce fichier est donc le POINT D'ÉTRANGLEMENT ; le contrôleur est la
 * ceinture qui refuse tôt et proprement.
 *
 * LIMITE NOMMÉE (DNC-06), RÉÉCRITE PAR S-E01-1g POUR RESTER VRAIE DE **CE**
 * FICHIER : le contrôleur est désormais PARTIELLEMENT converti à la portée
 * tenant (cinq handlers), mais CE SERVICE ne l'est PAS — pas un seul de ses dix
 * sites d'appel n'entre dans une portée, et c'est une décision, pas un reste.
 * Il ferme sur son PROPRE `PrismaService` : appelé depuis un callback de portée
 * il émettrait sur la connexion du PROPRIÉTAIRE pendant que la connexion
 * applicative tient une transaction ouverte, invisible au typage
 * `Prisma.TransactionClient` comme au compteur, qui est LEXICAL. Les deux
 * handlers qui l'appellent (`previewRecipients`, `publishInternal`) sont donc
 * EXCLUS par mécanisme nommé (ADR-054 §D1–§D2).
 *
 * Conséquence inchangée : toutes ces requêtes s'exécutent sur la connexion du
 * PROPRIÉTAIRE des tables, qui échappe à ses propres policies faute de
 * `FORCE ROW LEVEL SECURITY`. Le prédicat `tenantId` explicite fait donc TOUT
 * le travail ici ; RLS ne le double pas. Ne pas écrire « isolé » ni
 * « converti ».
 */
@Injectable()
export class AnnouncementRecipientsService {
  constructor(private readonly prisma: PrismaService) {}

  async computeRecipients(announcement: {
    tenantId: string;
    schoolId: string;
    scope: AnnouncementScope;
    cycleId: string | null;
    gradeLevelId: string | null;
    classSectionId: string | null;
    studentId: string | null;
    userProfileId: string | null;
  }): Promise<Set<string>> {
    const tenantId = announcement.tenantId;

    switch (announcement.scope) {
      case 'school_wide':
        // Déjà exactement la requête de résolution finale : filtrée par tenant,
        // sur `user_profile`. Rien à re-prouver.
        return this.allTenantUsers(tenantId);

      case 'individual_user': {
        // AVANT : `new Set([announcement.userProfileId])` — passe-plat VERBATIM
        // d'un id fourni par l'appelant, jamais confronté à la base. C'était la
        // branche que PF-208 avait nommée, et la seule.
        if (!announcement.userProfileId) return new Set();
        const owned = await this.prisma.userProfile.findFirst({
          where: { id: announcement.userProfileId, tenantId },
          select: { id: true },
        });
        return new Set(owned ? [owned.id] : []);
      }

      case 'individual_student': {
        // Guardians of the student PLUS the student's own linked account (E8-S3,
        // FR-S3-7) — additive, guarded by a non-null link, so a student actually
        // receives a receipt without changing what guardians get.
        const [guardians, students] = await Promise.all([
          this.guardiansOfStudents(tenantId, [announcement.studentId!]),
          this.studentsOwnProfiles(tenantId, [announcement.studentId!]),
        ]);
        return this.resolveWithinTenant(tenantId, new Set([...guardians, ...students]));
      }

      case 'class_section_scope':
        return this.resolveWithinTenant(
          tenantId,
          await this.recipientsForClassSections(tenantId, [announcement.classSectionId!]),
        );

      case 'grade_level_scope': {
        const classes = await this.prisma.classSection.findMany({
          where: { tenantId, gradeLevelId: announcement.gradeLevelId! },
          select: { id: true },
        });
        return this.resolveWithinTenant(
          tenantId,
          await this.recipientsForClassSections(
            tenantId,
            classes.map((c) => c.id),
          ),
        );
      }

      case 'cycle_scope': {
        const classes = await this.prisma.classSection.findMany({
          where: { tenantId, gradeLevel: { cycleId: announcement.cycleId! } },
          select: { id: true },
        });
        return this.resolveWithinTenant(
          tenantId,
          await this.recipientsForClassSections(
            tenantId,
            classes.map((c) => c.id),
          ),
        );
      }

      default:
        return new Set();
    }
  }

  /**
   * S-E01-1f — LA RÉSOLUTION FINALE, et pourquoi elle existe en plus des
   * prédicats posés sur chaque requête.
   *
   * `guardian.userProfileId` et `student.userProfileId` sont des colonnes UUID
   * NUES : `guardians.controller.ts:167` écrit `userProfileId: body.userProfileId`
   * sans AUCUNE vérification de propriété (finding séparé — module distinct, une
   * seule amélioration cohérente par run). Une `guardianship` parfaitement
   * intra-tenant peut donc pointer un profil d'un AUTRE tenant.
   *
   * Filtrer les jointures ne suffit alors pas : c'est la VALEUR RENDUE qu'il
   * faut prouver. Une requête bornée (`id IN (…)` sur l'ensemble déjà calculé,
   * `+ tenantId`) rend la propriété « `computeRecipients` ne peut pas rendre un
   * id hors tenant » VRAIE PAR CONSTRUCTION, quelle que soit l'hygiène des
   * colonnes en amont. Elle ne filtre PAS sur `status` : ce serait un changement
   * de comportement (E8-S3), pas une correction de tenant.
   */
  private async resolveWithinTenant(tenantId: string, ids: Set<string>): Promise<Set<string>> {
    if (ids.size === 0) return new Set();
    const profiles = await this.prisma.userProfile.findMany({
      where: { id: { in: [...ids] }, tenantId },
      select: { id: true },
    });
    return new Set(profiles.map((p) => p.id));
  }

  private async allTenantUsers(tenantId: string): Promise<Set<string>> {
    const profiles = await this.prisma.userProfile.findMany({
      where: { tenantId, status: 'active' },
      select: { id: true },
    });
    return new Set(profiles.map((p) => p.id));
  }

  private async guardiansOfStudents(tenantId: string, studentIds: string[]): Promise<Set<string>> {
    if (studentIds.length === 0) return new Set();
    const guardianships = await this.prisma.guardianship.findMany({
      where: { tenantId, studentId: { in: studentIds }, status: 'active' },
      include: { guardian: { select: { userProfileId: true } } },
    });
    const set = new Set<string>();
    for (const g of guardianships) if (g.guardian.userProfileId) set.add(g.guardian.userProfileId);
    return set;
  }

  /**
   * The students' OWN linked accounts (E8-S3, FR-S3-7). Additive recipient set so
   * an enrolled+linked student receives a receipt for class/grade/cycle/individual
   * scopes. Guarded by `userProfileId != null` — an enrolled student with no linked
   * account materialises NOTHING new (and a non-class student is never added).
   * This NEVER changes what guardians/teachers receive (it is unioned alongside).
   */
  private async studentsOwnProfiles(tenantId: string, studentIds: string[]): Promise<Set<string>> {
    if (studentIds.length === 0) return new Set();
    const students = await this.prisma.student.findMany({
      where: { tenantId, id: { in: studentIds }, userProfileId: { not: null } },
      select: { userProfileId: true },
    });
    const set = new Set<string>();
    for (const s of students) if (s.userProfileId) set.add(s.userProfileId);
    return set;
  }

  private async teachersOfClasses(tenantId: string, classSectionIds: string[]): Promise<Set<string>> {
    if (classSectionIds.length === 0) return new Set();
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { tenantId, classSectionId: { in: classSectionIds } },
      include: { teacherProfile: { select: { userProfileId: true } } },
    });
    return new Set(assignments.map((a) => a.teacherProfile.userProfileId));
  }

  private async recipientsForClassSections(
    tenantId: string,
    classSectionIds: string[],
  ): Promise<Set<string>> {
    if (classSectionIds.length === 0) return new Set();
    const enrollments = await this.prisma.enrollment.findMany({
      where: { tenantId, classSectionId: { in: classSectionIds }, status: 'active' },
      select: { studentId: true },
    });
    const studentIds = enrollments.map((e) => e.studentId);
    const [guardians, teachers, students] = await Promise.all([
      this.guardiansOfStudents(tenantId, studentIds),
      this.teachersOfClasses(tenantId, classSectionIds),
      // E8-S3 (FR-S3-7): additively include each enrolled student's OWN linked
      // account, so a class/grade/cycle announcement reaches the learner too. An
      // enrolled student with no link adds nothing; guardians/teachers unchanged.
      this.studentsOwnProfiles(tenantId, studentIds),
    ]);
    return new Set([...guardians, ...teachers, ...students]);
  }

  async materialiseReceipts(announcementId: string, recipientIds: Set<string>): Promise<number> {
    if (recipientIds.size === 0) return 0;
    const rows: Prisma.AnnouncementReceiptCreateManyInput[] = [...recipientIds].map((userProfileId) => ({
      announcementId,
      userProfileId,
    }));
    const { count } = await this.prisma.announcementReceipt.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return count;
  }
}
