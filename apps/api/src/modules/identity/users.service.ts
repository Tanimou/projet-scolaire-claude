import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { type AuditProvenance } from '../../shared/audit/provenance';
import { writeAudit } from '../../shared/audit/write-audit';
import { assertWithinCeiling } from '../../shared/auth/privilege-ceiling';
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
   * TWO POSTURES, ONE CLOSED BY THIS SLICE AND ONE DELIBERATELY LEFT OPEN:
   *
   *  1. **The grantor's own privileges ARE checked now — S-E05-2, `PF-156`.**
   *     `assertWithinCeiling` compares the granted role's permission codes
   *     (loaded by the `include` below, never `?? []`) against
   *     `grantorPermissions`, and refuses with a French 403 naming the exceeding
   *     codes if the role's set is not a subset of the grantor's. The set is the
   *     grantor's EFFECTIVE one — realm-role ∪ custom-role — derived in
   *     `users.controller.ts` from `UserSyncService.effectivePermissions`, the
   *     same seam `PermissionsGuard:27-28` reads. It is a REQUIRED parameter for
   *     exactly the reason `provenance` is: an omitted grantor set must be a
   *     compile error, never a silently empty one, because an empty set would
   *     deny everything and the tempting « fix » for that is the fail-open this
   *     gate exists to forbid. `UserSyncService` is NOT injected here and the
   *     union is NOT reimplemented — one derivation, in the controller.
   *     The refusal runs BEFORE `$transaction` opens AND before the idempotent
   *     early return below, so a refused grant writes no `UserRole`, no audit
   *     row, and is never answered with a 200 « already granted » body — that
   *     200 would be a probe oracle telling a limited admin which users already
   *     hold escalated roles. Recorded in ADR-015, `S-E05-2` amendment.
   *
   *     NOT DONE, and named rather than implied: `PF-156`'s text also proposes
   *     « an explicit refusal of `isSystem` roles for non-`super_admin`
   *     grantors ». That blanket ban is DECLINED. Measured, it would refuse
   *     `school_admin → school_admin`, which the ceiling permits (zero exceeding
   *     codes) and which is an ordinary operation — promoting a colleague to an
   *     admin peer. And it is role-shaped where the live exploit is
   *     permission-shaped: custom roles are created `isSystem: false`
   *     (`roles.controller.ts:136`), so « mint a full-catalogue custom role, then
   *     assign it » walks straight past it. One mechanism, not two conflicting
   *     ones. See ADR-015 `S-E05-2` D4.
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
    grantorPermissions: ReadonlySet<string>,
  ) {
    const user = await this.prisma.userProfile.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.tenantId !== tenantId) throw new ForbiddenException('Cross-tenant assignment refused');

    const role = await this.prisma.role.findUnique({
      // `where` stays UNFILTERED by tenant — posture 2 above, `PF-153`, out of scope.
      where: { id: roleId },
      // S-E05-2 — the ONLY change to this lookup, and the ceiling cannot work
      // without it. `?? []` on `rolePermissions` is FORBIDDEN: an absent include
      // would produce an empty set, an empty set exceeds nothing, and the guard
      // would silently permit everything while staying green. Pinned by a test
      // asserting this argument object.
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');

    // S-E05-2 / AC-4 — the ceiling, before the idempotency return and before the
    // transaction (see posture 1 above).
    assertWithinCeiling(
      grantorPermissions,
      role.rolePermissions.map((rp) => rp.permission.code),
    );

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
