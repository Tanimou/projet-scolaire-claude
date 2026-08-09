import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { type AuditProvenance } from '../../shared/audit/provenance';
import { writeAudit } from '../../shared/audit/write-audit';
import { PrismaService } from '../../shared/prisma/prisma.service';

export interface UserListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  authLinked: boolean;
  roles: { slug: string; name: string }[];
  createdAt: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<UserListItem[]> {
    const rows = await this.prisma.userProfile.findMany({
      where: { tenantId },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: {
        userRoles: {
          where: { revokedAt: null },
          include: { role: true },
        },
      },
    });
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      status: u.status,
      authLinked: u.authProviderId !== null,
      roles: u.userRoles.map((ur) => ({ slug: ur.role.slug, name: ur.role.name })),
      createdAt: u.createdAt.toISOString(),
    }));
  }

  /**
   * S-E04-6 — grant, and its audit row, in ONE transaction.
   *
   * `provenance` is a required parameter, not an optional one: an omitted actor
   * role or portal must be a compile error, never a silently null row
   * (`provenance.ts:59-66`). It is derived in the controller, BEFORE the
   * transaction opens (`S-E06-6`'s reason — a failed `inet` cast must not roll
   * back the write it traces).
   *
   * G-TENANT — the two pre-existing cross-tenant refusals are KEPT verbatim, and
   * are now covered by tests. They run BEFORE the transaction, so a refused
   * request writes no row at all.
   *
   * TWO POSTURES STATED RATHER THAN QUIETLY CHANGED, both older than this slice:
   *
   *  1. **The grantor's own privileges are not checked.** `users.controller.ts`
   *     gates on `roles.assign`, and nothing verifies the grantor holds what they
   *     grant — so a `roles.assign` holder can attach a role carrying more
   *     permissions than their own. This slice does not close it: changing who
   *     may grant what, silently, inside an audit slice, is exactly what ADR-015
   *     exists to prevent. What changes is that the escalation is now LEGIBLE —
   *     the row names the granted role. Recorded in `ADR-035`, owner named there.
   *
   *  2. **`Role` is not tenant-scoped, and that is by design.** `Role` has no
   *     `tenantId` (`schema.prisma:900`); tenancy runs `schoolId → School.tenantId`
   *     and `schoolId: null` means global. Adding a tenant filter to a global
   *     table here would be a visibility change dressed as a fix, so the role
   *     lookup below is deliberately left as it is.
   */
  async assignRole(
    userId: string,
    roleId: string,
    grantedById: string,
    tenantId: string,
    provenance: AuditProvenance,
  ) {
    const user = await this.prisma.userProfile.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.tenantId !== tenantId) throw new ForbiddenException('Cross-tenant assignment refused');

    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    // Check if already assigned (and not revoked)
    const existing = await this.prisma.userRole.findFirst({
      where: { userProfileId: userId, roleId, revokedAt: null },
    });
    // DELIBERATELY no audit row: nothing was granted. An idempotent no-op that
    // wrote `role.grant` would put a governance decision in the trail that never
    // happened, and « qui a donné ce privilège, et quand » would answer with the
    // date of the last retry instead of the date of the grant.
    if (existing) return existing;

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.userRole.create({
        data: {
          userProfileId: userId,
          roleId,
          schoolId: null,
          grantedBy: grantedById,
        },
      });
      // `resourceId` is `UserRole.id` — a bare uuid, because `AuditLog.resourceId`
      // is `@db.Uuid`. The composite identity (who / which role) lives in `after`.
      await writeAudit(tx, {
        tenantId,
        actorId: grantedById,
        action: 'role.grant',
        resourceType: 'user_role',
        resourceId: created.id,
        provenance,
        after: {
          userProfileId: userId,
          roleId,
          roleSlug: role.slug,
          roleName: role.name,
        },
      });
      return created;
    });
  }

  /**
   * S-E04-6 — revoke, and its audit row, in ONE transaction.
   *
   * The unconditional `update` this replaces overwrote `revokedAt` on an ALREADY
   * revoked assignment, so a second call moved the original revocation timestamp
   * forward and — once audited — would have emitted a second `role.revoke` for a
   * revocation that had already happened. Guarded on `revokedAt: null`, in the
   * same shape as `assignRole`'s idempotent return.
   */
  async revokeRole(userRoleId: string, tenantId: string, provenance: AuditProvenance, actorId: string) {
    const ur = await this.prisma.userRole.findUnique({
      where: { id: userRoleId },
      include: { userProfile: true, role: true },
    });
    if (!ur) throw new NotFoundException('Assignment not found');
    if (ur.userProfile.tenantId !== tenantId) throw new ForbiddenException();

    const { userProfile: _userProfile, role, ...current } = ur;
    // Idempotent: already revoked, nothing changes, no row (see assignRole).
    if (current.revokedAt !== null) return current;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.userRole.update({
        where: { id: userRoleId },
        data: { revokedAt: new Date() },
      });
      await writeAudit(tx, {
        tenantId,
        actorId,
        action: 'role.revoke',
        resourceType: 'user_role',
        resourceId: userRoleId,
        provenance,
        before: {
          userProfileId: current.userProfileId,
          roleId: current.roleId,
          roleSlug: role.slug,
          roleName: role.name,
          grantedAt: current.grantedAt.toISOString(),
        },
        after: { revokedAt: updated.revokedAt?.toISOString() ?? null },
      });
      return updated;
    });
  }
}
