import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * Resolves / auto-provisions TeacherProfile records.
 *
 * A teacher in Pilotage is fundamentally a UserProfile with the realm role
 * `teacher`. To carry school-specific metadata (specialty, hire date, internal
 * matricule, etc.) and to be the FK target for assignments/assessments/etc.,
 * we maintain a parallel TeacherProfile per user profile.
 *
 * This service is the single source of truth for the user_profile ↔ teacher_profile
 * relationship: any module that needs a `teacherProfileId` from a JWT subject
 * should go through `resolveForUser`.
 */
@Injectable()
export class TeacherProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the TeacherProfile for the given UserProfile, creating one if absent.
   * Idempotent and safe to call on every teacher request — uses an upsert so
   * concurrent first-call requests don't violate the unique constraint.
   */
  async ensureForUser(user: {
    id: string;
    tenantId: string;
  }): Promise<{ id: string; tenantId: string; schoolId: string; userProfileId: string; active: boolean }> {
    const existing = await this.prisma.teacherProfile.findUnique({
      where: { userProfileId: user.id },
    });
    if (existing) return existing;

    // Pick the user's preferred school (or the oldest one) as the home school
    const profile = await this.prisma.userProfile.findUnique({ where: { id: user.id } });
    const prefs = (profile?.preferences as Record<string, unknown> | null) ?? {};
    const preferredSchoolId =
      typeof prefs.activeSchoolId === 'string' ? prefs.activeSchoolId : undefined;
    const school = preferredSchoolId
      ? await this.prisma.school.findFirst({ where: { id: preferredSchoolId, tenantId: user.tenantId } })
      : await this.prisma.school.findFirst({
          where: { tenantId: user.tenantId },
          orderBy: { createdAt: 'asc' },
        });
    if (!school) throw new NotFoundException('Aucune école dans le tenant pour rattacher le professeur.');

    // Upsert protects against concurrent first-call races (two parallel
    // requests both seeing no existing profile would otherwise both attempt
    // to create, and the second would fail the @@unique([userProfileId])).
    return this.prisma.teacherProfile.upsert({
      where: { userProfileId: user.id },
      update: {},
      create: {
        tenantId: user.tenantId,
        schoolId: school.id,
        userProfileId: user.id,
      },
    });
  }

  /** Look up by id, scoped to tenant. */
  async getById(id: string, tenantId: string) {
    const tp = await this.prisma.teacherProfile.findUnique({
      where: { id },
      include: { userProfile: { select: { id: true, firstName: true, lastName: true, email: true, photoUrl: true } } },
    });
    if (!tp || tp.tenantId !== tenantId) throw new NotFoundException('Professeur introuvable.');
    return tp;
  }
}
