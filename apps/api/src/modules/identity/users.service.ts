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
   * S-E04-10 (PF-157) — and the revocation is now decided INSIDE that transaction.
   *
   * THE TOCTOU THIS CLOSES. `S-E04-6` added a `revokedAt !== null` guard to stop a
   * second call from moving the original revocation timestamp forward and emitting
   * a second `critical` `role.revoke` for one revocation. The guard reads BEFORE
   * `$transaction` opens, so two concurrent `DELETE /users/roles/:id` calls both
   * passed it, both updated, and both wrote a row — with `revokedAt` holding the
   * RETRY's clock. The guard closed the sequential case and left the concurrent one
   * open, which is the defect it was added to close.
   *
   * WHERE THE CORRECTNESS NOW COMES FROM. `tx.userRole.updateMany` with
   * `revokedAt: null` in its `where`, evaluated by PostgreSQL under the row lock.
   * At READ COMMITTED, two concurrent `UPDATE … WHERE id = ? AND revoked_at IS
   * NULL`: T1 takes the lock and commits; T2 blocks, re-evaluates its predicate
   * against the NEW row version, finds `revoked_at` non-null and reports
   * `count = 0`. The loser writes no row and returns the winner's state.
   *
   * NO DATABASE BACKSTOP IS ADDED, AND THAT IS A DECISION (AC-13).
   * `@@unique([userProfileId, roleId, schoolId])` cannot deduplicate anything here:
   * `schoolId` is written `null` (`assignRole` above) and PostgreSQL treats NULLs
   * as distinct in a unique index. The right long-term fix is a PARTIAL unique index
   * `(user_profile_id, role_id) WHERE revoked_at IS NULL` — it is a schema change,
   * it is DEFERRED, and it protects a DIFFERENT race: two concurrent `assignRole`
   * calls creating two active rows and two `role.grant` rows, which `create` cannot
   * make conditional. That residual stays open; nothing below narrows it.
   */
  async revokeRole(userRoleId: string, tenantId: string, provenance: AuditProvenance, actorId: string) {
    const ur = await this.prisma.userRole.findUnique({
      where: { id: userRoleId },
      include: { userProfile: true, role: true },
    });
    if (!ur) throw new NotFoundException('Assignment not found');
    if (ur.userProfile.tenantId !== tenantId) throw new ForbiddenException();

    const { userProfile: _userProfile, role, ...current } = ur;
    // FAST PATH, and nothing more (AC-14). It spares an obviously-already-revoked
    // assignment the cost of opening a transaction, in the same shape as
    // `assignRole`'s idempotent return. It is explicitly NOT the mechanism that
    // makes this correct — it reads before the transaction, so two concurrent
    // callers both pass it. The conditional `updateMany` below is the mechanism.
    if (current.revokedAt !== null) return current;

    // ONE clock for the revocation: the same value is written to the column and
    // recorded in `after`. Two `new Date()` calls would make the audit row disagree
    // with the database by milliseconds — a trail naming a transition at a time it
    // did not happen.
    const revokedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.userRole.updateMany({
        // `revokedAt: null` is the whole fix. `userProfile: { tenantId }` adds no
        // authorisation — the `ForbiddenException` above already refused every case
        // in which it could differ — it makes the scoping STRUCTURAL, so a future
        // refactor that moves the guard fails closed instead of open (ADR-015).
        where: { id: userRoleId, revokedAt: null, userProfile: { tenantId } },
        data: { revokedAt },
      });
      // `updateMany` returns a COUNT, not the row, so the re-read is mandatory —
      // for the response body and for `after`. No `include`: the shipped response
      // carries neither `userProfile` nor `role`, and copying the join from the
      // pre-read above would change the response shape.
      const after = await tx.userRole.findUniqueOrThrow({ where: { id: userRoleId } });
      // Lost the race: the revocation already happened and the winner already wrote
      // its row. Returning here commits nothing (this transaction wrote nothing), so
      // the loser gets the winner's state rather than a 500.
      //
      // This is an EARLY RETURN placed above `writeAudit`, never an `if` wrapping
      // it. `writeAudit` must stay one unconditional statement with an inline object
      // literal (ADR-035 D1): the vocabulary gate resolves action/resourceType from
      // the call-site AST, and `S-E04-7`'s `audit-write-check.js` ratchet walks these
      // sites the same way.
      if (revoked.count === 0) return after;

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
        after: { revokedAt: after.revokedAt?.toISOString() ?? null },
      });
      return after;
    });
  }
}
