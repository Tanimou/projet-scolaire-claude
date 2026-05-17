import { Injectable } from '@nestjs/common';
import { AnnouncementScope, Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * Computes the set of user_profile_ids that should receive a given announcement,
 * based on its scope. Used both at publish time (to materialise receipts) and
 * at read time (for ad-hoc lookups).
 *
 *   school_wide          → all user profiles in the tenant (admins + teachers + parents)
 *   cycle_scope          → guardians of students enrolled in classes of that cycle (+ teachers
 *                          assigned to those classes)
 *   grade_level_scope    → same, narrowed to the level
 *   class_section_scope  → guardians of enrolled students + teachers assigned to the class
 *   individual_student   → all guardians of that student
 *   individual_user      → exactly one user profile
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
    switch (announcement.scope) {
      case 'school_wide':
        return this.allTenantUsers(announcement.tenantId);

      case 'individual_user':
        return new Set(announcement.userProfileId ? [announcement.userProfileId] : []);

      case 'individual_student':
        return this.guardiansOfStudents([announcement.studentId!]);

      case 'class_section_scope':
        return this.recipientsForClassSections([announcement.classSectionId!]);

      case 'grade_level_scope': {
        const classes = await this.prisma.classSection.findMany({
          where: { tenantId: announcement.tenantId, gradeLevelId: announcement.gradeLevelId! },
          select: { id: true },
        });
        return this.recipientsForClassSections(classes.map((c) => c.id));
      }

      case 'cycle_scope': {
        const classes = await this.prisma.classSection.findMany({
          where: { tenantId: announcement.tenantId, gradeLevel: { cycleId: announcement.cycleId! } },
          select: { id: true },
        });
        return this.recipientsForClassSections(classes.map((c) => c.id));
      }

      default:
        return new Set();
    }
  }

  private async allTenantUsers(tenantId: string): Promise<Set<string>> {
    const profiles = await this.prisma.userProfile.findMany({
      where: { tenantId, status: 'active' },
      select: { id: true },
    });
    return new Set(profiles.map((p) => p.id));
  }

  private async guardiansOfStudents(studentIds: string[]): Promise<Set<string>> {
    if (studentIds.length === 0) return new Set();
    const guardianships = await this.prisma.guardianship.findMany({
      where: { studentId: { in: studentIds }, status: 'active' },
      include: { guardian: { select: { userProfileId: true } } },
    });
    const set = new Set<string>();
    for (const g of guardianships) if (g.guardian.userProfileId) set.add(g.guardian.userProfileId);
    return set;
  }

  private async teachersOfClasses(classSectionIds: string[]): Promise<Set<string>> {
    if (classSectionIds.length === 0) return new Set();
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { classSectionId: { in: classSectionIds } },
      include: { teacherProfile: { select: { userProfileId: true } } },
    });
    return new Set(assignments.map((a) => a.teacherProfile.userProfileId));
  }

  private async recipientsForClassSections(classSectionIds: string[]): Promise<Set<string>> {
    if (classSectionIds.length === 0) return new Set();
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classSectionId: { in: classSectionIds }, status: 'active' },
      select: { studentId: true },
    });
    const [guardians, teachers] = await Promise.all([
      this.guardiansOfStudents(enrollments.map((e) => e.studentId)),
      this.teachersOfClasses(classSectionIds),
    ]);
    return new Set([...guardians, ...teachers]);
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
