import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * Resolves the active (tenant, school, active academic year) for the caller.
 *
 * Phase 2D wires multi-school support: a tenant may now own multiple schools, and the
 * caller picks the active one via POST /schools/:id/switch (stored on user_profile.preferences).
 * If no preference is set, we fall back to the oldest school (deterministic).
 *
 * Callers that already know the school can pass an explicit schoolId via `forSchool`.
 */
@Injectable()
export class SchoolContextService {
  constructor(private readonly prisma: PrismaService) {}

  async forTenant(
    tenantId: string,
    explicitSchoolId?: string,
  ): Promise<{ tenantId: string; schoolId: string; activeAcademicYearId: string | null }> {
    let schoolId = explicitSchoolId ?? null;

    if (!schoolId) {
      schoolId = await this.resolveDefaultSchoolId(tenantId);
    } else {
      // Validate the explicit school still belongs to the tenant.
      const s = await this.prisma.school.findFirst({ where: { id: schoolId, tenantId } });
      if (!s) throw new NotFoundException('School not found in tenant');
    }

    const ay = await this.prisma.academicYear.findFirst({
      where: { schoolId, status: 'active' },
      orderBy: { startDate: 'desc' },
    });

    return {
      tenantId,
      schoolId,
      activeAcademicYearId: ay?.id ?? null,
    };
  }

  /**
   * Resolves the active school by preferences first, then "most data" fallback.
   *
   * IMPORTANT — we don't blindly trust `preferences.activeSchoolId`: a user
   * may have switched to an empty test school via the multi-school picker and
   * never switched back. We verify the preferred school **has at least one
   * academic year**; otherwise we ignore it and pick the school with the most
   * students in the tenant. Without this guard the admin sees "0 everything"
   * silently.
   */
  async forUser(user: {
    id: string;
    tenantId: string;
    preferences: unknown;
  }): Promise<{ tenantId: string; schoolId: string; activeAcademicYearId: string | null }> {
    const prefs = (user.preferences as Record<string, unknown> | null) ?? {};
    const preferred = typeof prefs.activeSchoolId === 'string' ? prefs.activeSchoolId : undefined;
    if (preferred) {
      const ok = await this.prisma.school.findFirst({
        where: { id: preferred, tenantId: user.tenantId },
        include: { _count: { select: { academicYears: true, students: true } } },
      });
      if (ok && ok._count.academicYears > 0) {
        return this.forTenant(user.tenantId, preferred);
      }
      // Preferred school is empty or stale → fall through to "most data" pick
    }
    return this.forTenant(user.tenantId);
  }

  /**
   * Returns the school in the tenant with the most data attached (academic
   * years + students). Falls back to the oldest school if no school has any
   * data yet (fresh tenant).
   */
  private async resolveDefaultSchoolId(tenantId: string): Promise<string> {
    const schools = await this.prisma.school.findMany({
      where: { tenantId },
      select: {
        id: true,
        createdAt: true,
        _count: { select: { academicYears: true, students: true } },
      },
    });
    if (schools.length === 0) throw new NotFoundException('No school for tenant');

    // Prefer schools with data; among those, pick the one with the most
    // students. Ties broken by createdAt asc (deterministic).
    const withData = schools.filter((s) => s._count.academicYears > 0);
    const candidates = withData.length > 0 ? withData : schools;
    candidates.sort((a, b) => {
      const dStudents = b._count.students - a._count.students;
      if (dStudents !== 0) return dStudents;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return candidates[0]!.id;
  }
}
