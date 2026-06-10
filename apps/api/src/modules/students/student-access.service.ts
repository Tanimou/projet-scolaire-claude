import { Injectable } from '@nestjs/common';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * ABAC for the Student aggregate.
 *
 * Resolution order (highest privilege wins):
 *   - super_admin / school_admin in realm_access → unrestricted within tenant
 *   - teacher → can see all students in the school (Phase 3D simplification — once teaching
 *     assignments exist, restrict to students in the teacher's classes)
 *   - parent → can ONLY see students they have an `active` Guardianship for
 *   - student (E8-S1) → can ONLY see the SINGLE Student linked to their own
 *     account (`Student.userProfileId === me.id`), tenant-scoped. Deny-by-default:
 *     the scope is EXACTLY `[ownStudentId]` (linked) or `[]` (unlinked) — NEVER
 *     `null` (the admin/teacher "unrestricted" sentinel), NEVER a peer id. This is
 *     the strictest wall the platform has (the data subject reads it). See ADR-021.
 *
 * The service returns a "scope" object that controllers fold into their `where` clauses.
 * `studentIds: null` means "no restriction"; a non-null array narrows the result set.
 */
@Injectable()
export class StudentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async scopeForUser(
    user: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
    _schoolId: string,
  ): Promise<{ studentIds: string[] | null; reason: string }> {
    const roles = jwt.realm_access?.roles ?? [];
    if (roles.includes('super_admin') || roles.includes('school_admin')) {
      return { studentIds: null, reason: 'admin' };
    }
    if (roles.includes('teacher')) {
      // TODO Phase 4: when teaching assignments exist, filter by the teacher's class sections.
      return { studentIds: null, reason: 'teacher (unrestricted until teaching assignments land)' };
    }
    if (roles.includes('parent')) {
      const guardianships = await this.prisma.guardianship.findMany({
        where: {
          tenantId: user.tenantId,
          status: 'active',
          guardian: { userProfileId: user.id },
        },
        select: { studentId: true },
      });
      return { studentIds: guardianships.map((g) => g.studentId), reason: 'parent' };
    }
    // E8-S1 — student-self ABAC (deny-by-default, self-only, NEVER peer comparison).
    // Resolve the ONE Student linked to this account within the caller's tenant.
    // The scope is EXACTLY `[ownId]` (linked) or `[]` (unlinked) — never `null`
    // (unrestricted), never a peer. A client-supplied studentId can never widen
    // this: `canAccessStudent` only ever returns true for the resolved own id.
    if (roles.includes('student')) {
      const self = await this.prisma.student.findFirst({
        where: { tenantId: user.tenantId, userProfileId: user.id },
        select: { id: true },
      });
      return { studentIds: self ? [self.id] : [], reason: 'student-self' };
    }
    return { studentIds: [], reason: 'no role with student access' };
  }

  async canAccessStudent(
    user: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
    studentId: string,
    schoolId: string,
  ): Promise<boolean> {
    const scope = await this.scopeForUser(user, jwt, schoolId);
    if (scope.studentIds === null) return true;
    return scope.studentIds.includes(studentId);
  }
}
