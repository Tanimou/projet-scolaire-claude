import { ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';

import { deriveAuditProvenance } from '../../shared/audit/provenance';
import type { PrismaService } from '../../shared/prisma/prisma.service';

import { UsersService } from './users.service';

/**
 * S-E04-6 — the ROLE family (`role.grant` / `role.revoke`), proven in BOTH
 * rollback directions (`ADR-035`, gate G-AUDIT).
 *
 * WHY BOTH DIRECTIONS, AND WHY THEY ARE DIFFERENT TESTS
 * -----------------------------------------------------
 * Direction (i) — the entity write fails inside the transaction — proves the
 * audit row does not survive a failed mutation. It proves NOTHING about a writer
 * placed after the commit. Direction (ii) — the audit write fails — is the one
 * that decides whether the mutation is fail-closed, and it is the decision
 * `ADR-035` D2 records: an audit failure fails the grant. Two families × two
 * directions is four tests here, not two.
 *
 * Direction (i)'s fault is injected into the ENTITY WRITE ITSELF (a unique-index
 * collision on `(userProfileId, roleId, schoolId)`), never by throwing before the
 * transaction opens — a pre-check that throws early would pass the assertion
 * while proving nothing about transactional scope.
 *
 * THE HARNESS HAS REAL COMMIT SEMANTICS. `$transaction(cb)` stages every write
 * and absorbs the staging into `committed` only when `cb` RESOLVES. So
 * "neither row exists" is observed on a store, not inferred from a call count —
 * a mock that merely counted `create` calls would report a row as absent while
 * the real database kept it.
 */

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const ACTOR = 'actor-profile-1';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const ROLE_ID = '22222222-2222-2222-2222-222222222222';
const USER_ROLE_ID = '33333333-3333-3333-3333-333333333333';

const PROVENANCE = deriveAuditProvenance(
  { sub: 'kc-1', realm_access: { roles: ['super_admin'] } } as never,
  { ipAddress: '198.51.100.24', userAgent: 'Mozilla/5.0 (admin)' },
);

type Row = Record<string, unknown>;
type Staged = { kind: 'userRole' | 'audit'; row: Row };

function makeDb(faults: { entity?: Error; audit?: Error } = {}) {
  const committed: Staged[] = [];
  let staged: Staged[] = [];

  const tx = {
    userRole: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (faults.entity) throw faults.entity;
        const row = { id: 'user-role-new', revokedAt: null, ...data };
        staged.push({ kind: 'userRole', row });
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        if (faults.entity) throw faults.entity;
        const row = { id: where.id, ...data };
        staged.push({ kind: 'userRole', row });
        return row;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (faults.audit) throw faults.audit;
        staged.push({ kind: 'audit', row: data });
        return { id: 'audit-1', ...data };
      }),
    },
  };

  const prisma = {
    userProfile: { findUnique: jest.fn() },
    role: {
      findUnique: jest.fn().mockResolvedValue({ id: ROLE_ID, slug: 'surveillant', name: 'Surveillant' }),
    },
    userRole: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn() },
    $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => {
      staged = [];
      try {
        const out = await cb(tx);
        committed.push(...staged);
        staged = [];
        return out;
      } catch (err) {
        staged = [];
        throw err;
      }
    }),
  };

  const service = new UsersService(prisma as unknown as PrismaService);
  return {
    service,
    prisma,
    tx,
    entities: () => committed.filter((c) => c.kind === 'userRole').map((c) => c.row),
    auditRows: () => committed.filter((c) => c.kind === 'audit').map((c) => c.row),
  };
}

function grantable(db: ReturnType<typeof makeDb>, tenantId = TENANT) {
  db.prisma.userProfile.findUnique.mockResolvedValue({ id: USER_ID, tenantId });
}

function revocable(db: ReturnType<typeof makeDb>, over: Partial<Row> = {}) {
  db.prisma.userRole.findUnique.mockResolvedValue({
    id: USER_ROLE_ID,
    userProfileId: USER_ID,
    roleId: ROLE_ID,
    schoolId: null,
    grantedBy: ACTOR,
    grantedAt: new Date('2026-01-02T03:04:05.000Z'),
    revokedAt: null,
    userProfile: { id: USER_ID, tenantId: TENANT },
    role: { id: ROLE_ID, slug: 'surveillant', name: 'Surveillant' },
    ...over,
  });
}

/* ================================================================== *
 * R-1 — role.grant: the happy path writes ONE row, with real provenance
 * ================================================================== */

describe('R-1 / AC-3 — role.grant writes one row inside the grant’s transaction', () => {
  it('commits the assignment and its audit row together', async () => {
    const db = makeDb();
    grantable(db);

    const created = await db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE);

    expect(db.entities()).toHaveLength(1);
    expect(db.auditRows()).toHaveLength(1);
    expect(db.auditRows()[0]).toMatchObject({
      tenantId: TENANT,
      actorId: ACTOR,
      actorRole: 'super_admin',
      portal: 'admin',
      action: 'role.grant',
      resourceType: 'user_role',
      resourceId: (created as { id: string }).id,
      ipAddress: '198.51.100.24',
      userAgent: 'Mozilla/5.0 (admin)',
    });
  });

  // AC-11 — `AuditLog.resourceId` is `@db.Uuid`: a `${userId}:${roleId}` value is
  // REJECTED by PostgreSQL and would roll back the grant because of its own audit
  // row — the `@db.Inet` trap `provenance.ts` documents, on a new column. So the
  // column carries a bare `UserRole.id` and the composite identity lives in `after`.
  it('resourceId carries no separator, and `after` names both sides of the grant', async () => {
    const db = makeDb();
    grantable(db);
    await db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE);

    const row = db.auditRows()[0]!;
    expect(String(row.resourceId)).not.toContain(':');
    expect(row.after).toMatchObject({
      userProfileId: USER_ID,
      roleId: ROLE_ID,
      roleSlug: 'surveillant',
    });
  });

  it('AC-14 — an idempotent re-grant writes NO row and opens no transaction', async () => {
    const db = makeDb();
    grantable(db);
    db.prisma.userRole.findFirst.mockResolvedValue({ id: USER_ROLE_ID, revokedAt: null });

    await db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE);

    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });
});

/* ================================================================== *
 * R-2 (AC-1 / AC-2) — the two rollback directions, per family
 * ================================================================== */

describe('R-2 / AC-1 / AC-2 — grant: neither row survives, in EITHER direction', () => {
  it('direction (i) — the userRole write fails: no assignment AND no audit row', async () => {
    const collision = new Error('Unique constraint failed on (user_profile_id, role_id, school_id)');
    const db = makeDb({ entity: collision });
    grantable(db);

    await expect(db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE)).rejects.toThrow(
      collision,
    );
    expect(db.entities()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });

  it('direction (ii) — the AUDIT write fails: the grant does not persist and the request fails', async () => {
    const db = makeDb({ audit: new Error('audit_log insert refused') });
    grantable(db);

    await expect(
      db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(db.entities()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });
});

/* ================================================================== *
 * R-3 (G-TENANT) — the two pre-existing guards are KEPT, and tested
 * ================================================================== */

describe('R-3 / G-TENANT — a foreign-tenant identifier is refused and writes no row', () => {
  it('assignRole with a foreign userId → Forbidden, transaction never opened', async () => {
    const db = makeDb();
    grantable(db, OTHER_TENANT);

    await expect(db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('assignRole with an unknown userId → NotFound, no row', async () => {
    const db = makeDb();
    db.prisma.userProfile.findUnique.mockResolvedValue(null);

    await expect(db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.auditRows()).toEqual([]);
  });

  it('revokeRole with a foreign userRoleId → Forbidden, no row', async () => {
    const db = makeDb();
    revocable(db, { userProfile: { id: USER_ID, tenantId: OTHER_TENANT } });

    await expect(
      db.service.revokeRole(USER_ROLE_ID, TENANT, PROVENANCE, ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('the row records the CALLER’s tenant, never the target’s', async () => {
    const db = makeDb();
    grantable(db);
    await db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE);
    expect(db.auditRows()[0]!.tenantId).toBe(TENANT);
  });
});

/* ================================================================== *
 * R-4 — role.revoke, both directions and the idempotent no-op
 * ================================================================== */

describe('R-4 / AC-1 / AC-2 / AC-14 — role.revoke', () => {
  it('writes one row inside the revocation’s transaction, with the before payload', async () => {
    const db = makeDb();
    revocable(db);

    await db.service.revokeRole(USER_ROLE_ID, TENANT, PROVENANCE, ACTOR);

    expect(db.auditRows()).toHaveLength(1);
    expect(db.auditRows()[0]).toMatchObject({
      action: 'role.revoke',
      resourceType: 'user_role',
      resourceId: USER_ROLE_ID,
      actorId: ACTOR,
      actorRole: 'super_admin',
      portal: 'admin',
      ipAddress: '198.51.100.24',
    });
    expect(db.auditRows()[0]!.before).toMatchObject({ roleSlug: 'surveillant', roleId: ROLE_ID });
  });

  it('direction (i) — the userRole update fails: no revocation AND no audit row', async () => {
    const boom = new Error('row is locked');
    const db = makeDb({ entity: boom });
    revocable(db);

    await expect(db.service.revokeRole(USER_ROLE_ID, TENANT, PROVENANCE, ACTOR)).rejects.toThrow(boom);
    expect(db.entities()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });

  it('direction (ii) — the AUDIT write fails: the revocation does not persist', async () => {
    const db = makeDb({ audit: new Error('audit_log insert refused') });
    revocable(db);

    await expect(db.service.revokeRole(USER_ROLE_ID, TENANT, PROVENANCE, ACTOR)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(db.entities()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });

  it('AC-14 — an already-revoked assignment is a no-op: no second row, and revokedAt is NOT moved', async () => {
    // The pre-slice code re-`update`d `revokedAt` unconditionally, which
    // overwrote the ORIGINAL revocation timestamp and — once audited — would have
    // emitted a second `role.revoke` for a revocation that already happened.
    const original = new Date('2026-02-03T00:00:00.000Z');
    const db = makeDb();
    revocable(db, { revokedAt: original });

    const result = (await db.service.revokeRole(USER_ROLE_ID, TENANT, PROVENANCE, ACTOR)) as {
      revokedAt: Date;
    };

    expect(result.revokedAt).toBe(original);
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('the returned row never leaks the joined userProfile/role — the response shape is unchanged', async () => {
    const db = makeDb();
    revocable(db, { revokedAt: new Date('2026-02-03T00:00:00.000Z') });
    const result = await db.service.revokeRole(USER_ROLE_ID, TENANT, PROVENANCE, ACTOR);
    expect(result).not.toHaveProperty('userProfile');
    expect(result).not.toHaveProperty('role');
  });
});
