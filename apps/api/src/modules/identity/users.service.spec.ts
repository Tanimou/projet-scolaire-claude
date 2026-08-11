import { ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';

import { deriveAuditProvenance } from '../../shared/audit/provenance';
import { PERMISSIONS, REALM_ROLE_PERMISSIONS } from '../../shared/auth/permissions.constants';
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

/* ------------------------------------------------------------------ *
 * S-E05-2 — the grantor sets. `assignRole` gained a REQUIRED 6th
 * parameter, so every call below passes one.
 *
 * The pre-existing R-1 … R-5 cases pass FULL_CATALOGUE, and that
 * preserves their meaning rather than bending it: their actor is already
 * declared `super_admin` in `PROVENANCE` above (`:40-43`), and
 * `REALM_ROLE_PERMISSIONS.super_admin` IS the whole catalogue
 * (`permissions.constants.ts:143`). They were audit tests before this
 * slice and they stay audit tests after it — the ceiling is a no-op on
 * a grantor who holds everything.
 * ------------------------------------------------------------------ */
const ALL_CODES: string[] = PERMISSIONS.map((p) => p[0]);
const FULL_CATALOGUE: ReadonlySet<string> = new Set(ALL_CODES);
const SCHOOL_ADMIN_SET: ReadonlySet<string> = new Set(REALM_ROLE_PERMISSIONS.school_admin ?? []);
/** A narrow custom-role grantor holding `roles.assign` and very little else. */
const NARROW_SET: ReadonlySet<string> = new Set(['roles.assign', 'students.read']);

/**
 * What `prisma/seed.ts` actually writes into `role_permission` for the seeded
 * `teacher` row (`seed.ts:115-127`) — NOT `REALM_ROLE_PERMISSIONS.teacher`.
 * The ceiling compares the DATABASE row, so the fixture must be the DB row.
 * (The constants list additionally carries `lessons.delete` and
 * `class_sessions.*`, which the seeded row does not.)
 */
const SEEDED_TEACHER_CODES = [
  'classes.read',
  'subjects.read',
  'students.read',
  'assessments.read',
  'assessments.write',
  'grades.read',
  'grades.write',
  'grades.publish',
  'grades.revise',
  'attendance.read',
  'attendance.write',
  'lessons.read',
  'lessons.write',
  'discipline.read',
  'discipline.write',
  'announcements.read',
  'announcements.write',
  'branding.read',
  'exports.execute.teacher',
  'remediation.read',
  'profile.read.self',
  'profile.write.self',
];

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
      /**
       * S-E04-10 — `revokeRole` writes through `updateMany` now, so the fault
       * injection and the staging BOTH have to live here. If this mock merely
       * returned `{ count: 1 }`, R-4 direction (i) would become a rollback test
       * that exercises no failing write — green forever, proving nothing. That is
       * the "guard that is green because it cannot fire" shape this epic is named
       * after, so `faults.entity` is honoured here exactly as in `create`/`update`.
       */
      updateMany: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        if (faults.entity) throw faults.entity;
        staged.push({ kind: 'userRole', row: { id: where.id, ...data } });
        return { count: 1 };
      }),
      /** The in-transaction re-read `updateMany` forces — it returns a count, not a row. */
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const last = [...staged].reverse().find((s) => s.kind === 'userRole');
        return last ? last.row : { id: where.id, revokedAt: null };
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
      // S-E05-2 — `assignRole` now reads `role.rolePermissions[].permission.code`
      // to decide the ceiling, so the fixture must carry the relation. It
      // defaults to the EMPTY list — a role granting nothing exceeds nothing —
      // which is what keeps R-1 … R-5 measuring audit behaviour rather than
      // authorisation. `carrying()` below overrides it.
      findUnique: jest.fn().mockResolvedValue({
        id: ROLE_ID,
        slug: 'surveillant',
        name: 'Surveillant',
        rolePermissions: [],
      }),
    },
    userRole: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      // Present so that a re-read accidentally placed on the NON-transactional
      // client would be observable rather than silently `undefined`.
      findUniqueOrThrow: jest.fn(),
    },
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

/**
 * Returns the rejection rather than asserting on it, so a negative can inspect
 * the 403 BODY. Asserting only on the exception CLASS would pass on the
 * pre-existing cross-tenant `ForbiddenException` and prove nothing about the
 * ceiling (inversion T-1). Same helper shape as `invite.controller.spec.ts:201`.
 */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the grant to be refused, and it resolved');
}

/** S-E05-2 — give the looked-up role a real permission set (the ceiling's input). */
function carrying(db: ReturnType<typeof makeDb>, codes: readonly string[], over: Partial<Row> = {}) {
  db.prisma.role.findUnique.mockResolvedValue({
    id: ROLE_ID,
    slug: 'surveillant',
    name: 'Surveillant',
    rolePermissions: codes.map((code) => ({ permission: { code } })),
    ...over,
  });
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

    const created = await db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, FULL_CATALOGUE);

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
    await db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, FULL_CATALOGUE);

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

    await db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, FULL_CATALOGUE);

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

    await expect(db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, FULL_CATALOGUE)).rejects.toThrow(
      collision,
    );
    expect(db.entities()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });

  it('direction (ii) — the AUDIT write fails: the grant does not persist and the request fails', async () => {
    const db = makeDb({ audit: new Error('audit_log insert refused') });
    grantable(db);

    await expect(
      db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, FULL_CATALOGUE),
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

    await expect(db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, FULL_CATALOGUE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('assignRole with an unknown userId → NotFound, no row', async () => {
    const db = makeDb();
    db.prisma.userProfile.findUnique.mockResolvedValue(null);

    await expect(db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, FULL_CATALOGUE)).rejects.toBeInstanceOf(
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
    await db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, FULL_CATALOGUE);
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

  it('direction (i) — the conditional userRole updateMany fails: no revocation AND no audit row', async () => {
    // S-E04-10 — the fault MOVED from `tx.userRole.update` to `tx.userRole.updateMany`,
    // deliberately and not cosmetically: `revokeRole` no longer calls `update`, so a
    // fault left there would be injected into a method the code under test never
    // invokes — a rollback assertion exercising no failing write. The extra
    // `toHaveBeenCalled` is the falsification: a mock that silently no-opped would
    // otherwise satisfy every other line of this test.
    const boom = new Error('row is locked');
    const db = makeDb({ entity: boom });
    revocable(db);

    await expect(db.service.revokeRole(USER_ROLE_ID, TENANT, PROVENANCE, ACTOR)).rejects.toThrow(boom);
    expect(db.tx.userRole.updateMany).toHaveBeenCalled();
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

  it('the re-read carries NO include, so the happy path cannot re-leak the joins either', async () => {
    const db = makeDb();
    revocable(db);
    const result = await db.service.revokeRole(USER_ROLE_ID, TENANT, PROVENANCE, ACTOR);

    expect(db.tx.userRole.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: USER_ROLE_ID } });
    expect(result).not.toHaveProperty('userProfile');
    expect(result).not.toHaveProperty('role');
  });
});

/* ================================================================== *
 * R-5 (S-E04-10 / PF-157) — the TOCTOU, closed inside the transaction
 * ================================================================== */

describe('R-5 / PF-157 — the revocation is decided in the transaction, not before it', () => {
  it('AC-12 — the conditional predicate is `revokedAt: null`, evaluated by the database', async () => {
    const db = makeDb();
    revocable(db);

    await db.service.revokeRole(USER_ROLE_ID, TENANT, PROVENANCE, ACTOR);

    const args = db.tx.userRole.updateMany.mock.calls[0]![0] as unknown as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({ id: USER_ROLE_ID, revokedAt: null });
    // The tenant predicate grants nobody anything (the ForbiddenException above
    // already refused every differing case); it makes the scoping structural.
    expect(args.where.userProfile).toEqual({ tenantId: TENANT });
  });

  it('AC-21 — a LOST race writes ZERO rows and returns the winner’s state, not the retry’s clock', async () => {
    // The scenario the pre-transaction guard could never see: the pre-read observes
    // `revokedAt: null` (so the fast path lets it through), and by the time the
    // UPDATE reaches the row the other caller has already committed. PostgreSQL
    // re-evaluates `revoked_at IS NULL` against the new row version and reports
    // `count = 0`. On main @64f64dd this path wrote a SECOND `role.revoke` and
    // stamped the loser's clock over the winner's.
    const winnersClock = new Date('2026-02-03T00:00:00.000Z');
    const db = makeDb();
    revocable(db); // revokedAt: null — the fast path passes
    db.tx.userRole.updateMany.mockResolvedValue({ count: 0 });
    db.tx.userRole.findUniqueOrThrow.mockResolvedValue({
      id: USER_ROLE_ID,
      userProfileId: USER_ID,
      roleId: ROLE_ID,
      revokedAt: winnersClock,
    });

    const result = (await db.service.revokeRole(USER_ROLE_ID, TENANT, PROVENANCE, ACTOR)) as {
      revokedAt: Date;
    };

    expect(db.auditRows()).toEqual([]);
    expect(result.revokedAt).toBe(winnersClock);
  });

  it('AC-12 — the WINNER still writes exactly one role.revoke', async () => {
    const db = makeDb();
    revocable(db);
    db.tx.userRole.updateMany.mockResolvedValue({ count: 1 });

    await db.service.revokeRole(USER_ROLE_ID, TENANT, PROVENANCE, ACTOR);

    expect(db.auditRows()).toHaveLength(1);
    expect(db.auditRows()[0]).toMatchObject({ action: 'role.revoke' });
  });

  it('ONE clock — the row’s `after.revokedAt` is the value written to the column', async () => {
    // Two `new Date()` calls would make the trail disagree with the database by
    // milliseconds, i.e. name a transition at a time it did not happen.
    const db = makeDb();
    revocable(db);

    await db.service.revokeRole(USER_ROLE_ID, TENANT, PROVENANCE, ACTOR);

    const written = (db.entities()[0] as { revokedAt: Date }).revokedAt;
    expect((db.auditRows()[0]!.after as { revokedAt: string }).revokedAt).toBe(written.toISOString());
  });

  // NOT PROVEN HERE, AND SAID SO RATHER THAN IMPLIED: `makeDb` is single-threaded,
  // so no test in this file can interleave two `DELETE`s. The two cases above prove
  // the BRANCH (`count = 0` ⇒ no row; `count = 1` ⇒ one row) and the predicate
  // SHAPE. The race itself is decided by PostgreSQL's READ COMMITTED re-check, and
  // the deferred partial unique index `(user_profile_id, role_id) WHERE
  // revoked_at IS NULL` — which would prove it at the database, and which also
  // covers the concurrent-`assignRole` race this slice does NOT close — is
  // registered, not written (AC-13).
});

/* ================================================================== *
 * R-6 (S-E05-2 / PF-156) — THE PRIVILEGE CEILING on the grant path
 * ================================================================== */

/**
 * T-19 … T-26. Every negative asserts on the 403 BODY, never merely on the
 * class: `assignRole` already threw `ForbiddenException` for a cross-tenant
 * userId at `:83` before this slice, so `rejects.toBeInstanceOf(ForbiddenException)`
 * alone would pass without the ceiling existing (inversion T-1).
 *
 * « Nothing was written » is asserted on `entities()` / `auditRows()` — the
 * COMMITTED store — not on a call count, for the reason this file's header
 * already gives.
 *
 * Fails-before, derivable by reading: the pre-slice `assignRole` took five
 * parameters and its `role.findUnique` carried no `include`, so T-25's argument
 * assertion is structurally unreachable and T-19 … T-21 exercise a 403 branch
 * that did not exist.
 */
describe('R-6 / AC-4 / G-AUTHZ — a grant that exceeds the grantor is refused before anything is written', () => {
  it('T-19 — a school_admin assigning a FULL-CATALOGUE role is refused (PF-09 step 2)', async () => {
    // The live two-request self-escalation: mint a role carrying every code
    // (refused at the mint site now too), then assign it to yourself. This is
    // the second door, closed independently.
    const db = makeDb();
    grantable(db);
    carrying(db, ALL_CODES);

    const err = await failureOf(
      db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, SCHOOL_ADMIN_SET),
    );

    expect(err).toBeInstanceOf(ForbiddenException);
    const body = (err as ForbiddenException).getResponse() as { missing: string[]; message: string };
    expect(body.missing).toContain('grades.revise');
    expect(typeof body.message).toBe('string');
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.entities()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });

  it('T-20 — a school_admin can no longer assign the SEEDED teacher row, and these are the exact 5 codes', async () => {
    // THE PRODUCT CONSEQUENCE, PINNED BY TEST rather than discovered in
    // production. Measured against `seed.ts`'s ROLE_PERMISSIONS (what actually
    // lands in `role_permission`) versus `REALM_ROLE_PERMISSIONS.school_admin`.
    // « onboard a teacher » is an everyday admin operation and it now answers
    // 403. That is correct under the ceiling — a school_admin genuinely does not
    // hold `grades.revise` — and it is recorded in ADR-015 D5, NOT papered over
    // by weakening the check.
    const db = makeDb();
    grantable(db);
    carrying(db, SEEDED_TEACHER_CODES, { slug: 'teacher', name: 'Professeur' });

    const err = await failureOf(
      db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, SCHOOL_ADMIN_SET),
    );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      missing: [
        'grades.write',
        'grades.revise',
        'attendance.write',
        'lessons.write',
        'exports.execute.teacher',
      ],
    });
    expect(db.entities()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });

  it('T-21 — a NARROW custom-role grantor is refused anything outside its own set', async () => {
    const db = makeDb();
    grantable(db);
    carrying(db, ['students.read', 'students.write']);

    const err = await failureOf(
      db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, NARROW_SET),
    );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ missing: ['students.write'] });
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('T-21b — an EMPTY grantor set denies, it does not wave the grant through', async () => {
    // The fail-open this gate exists to forbid, asserted at the CALL SITE and
    // not only on the predicate: `user-sync.service.ts:67` resolves an
    // unrecognised realm role to `[]`, so this caller is reachable.
    const db = makeDb();
    grantable(db);
    carrying(db, ['students.read']);

    const err = await failureOf(
      db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, new Set<string>()),
    );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(db.auditRows()).toEqual([]);
  });

  it('T-22 / AC-6 — a full-catalogue grantor assigning a full-catalogue role COMMITS', async () => {
    // `super_admin` is unaffected structurally: its realm role carries every
    // code, so the ceiling is arithmetically a no-op. Built from `PERMISSIONS`,
    // not from a seeded `super_admin` Role row — there is none.
    const db = makeDb();
    grantable(db);
    carrying(db, ALL_CODES);

    await db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, FULL_CATALOGUE);

    expect(db.entities()).toHaveLength(1);
    expect(db.auditRows()).toHaveLength(1);
    expect(db.auditRows()[0]).toMatchObject({ action: 'role.grant', resourceType: 'user_role' });
  });

  it('T-23 — the honest NON-super_admin positive control: a role inside the school_admin set commits', async () => {
    // Proof that the fix is not a blanket deny. A custom role narrower than the
    // grantor is exactly what `roles.assign` is still for.
    const db = makeDb();
    grantable(db);
    carrying(db, ['students.read', 'attendance.read']);

    await db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, SCHOOL_ADMIN_SET);

    expect(db.entities()).toHaveLength(1);
    expect(db.auditRows()).toHaveLength(1);
  });

  it('T-24 — a refused grant on an ALREADY-EXISTING assignment is still 403, never a 200 body', async () => {
    // Ordering, decided: the ceiling runs BEFORE the idempotent early return.
    // An « already granted » 200 for an over-privileged role is a probe oracle —
    // it tells a limited admin which users already hold escalated roles.
    const db = makeDb();
    grantable(db);
    carrying(db, ALL_CODES);
    db.prisma.userRole.findFirst.mockResolvedValue({ id: USER_ROLE_ID, revokedAt: null });

    const err = await failureOf(
      db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, SCHOOL_ADMIN_SET),
    );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(db.prisma.userRole.findFirst).not.toHaveBeenCalled();
  });

  it('T-25 — the `include` is PINNED: dropping it would silently disable the ceiling', async () => {
    // Without the include, `rolePermissions` is absent, the compared set is
    // empty, an empty set exceeds nothing, and every grant is permitted while
    // every test above stays green. That is the « guard that cannot fire » shape
    // this epic is named after, so the read shape itself is the assertion.
    const db = makeDb();
    grantable(db);
    carrying(db, ['students.read']);

    await db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, SCHOOL_ADMIN_SET);

    expect(db.prisma.role.findUnique).toHaveBeenCalledWith({
      // G-TENANT / PF-153 — `where` stays UNFILTERED by tenant, deliberately.
      // `Role` is a global catalogue; filtering it here would be a visibility
      // change dressed as a fix, and it is blocked on ADR-013.
      where: { id: ROLE_ID },
      include: { rolePermissions: { include: { permission: true } } },
    });
  });

  it('T-26 / G-TENANT — a cross-tenant userId still loses to the ceiling’s own refusal ordering', async () => {
    // The two pre-existing cross-tenant refusals are kept VERBATIM and still run
    // FIRST: a foreign user is refused before the role is even looked up, so the
    // ceiling never gets to answer and no existence bit about the role leaks.
    const db = makeDb();
    grantable(db, OTHER_TENANT);
    carrying(db, ALL_CODES);

    const err = await failureOf(
      db.service.assignRole(USER_ID, ROLE_ID, ACTOR, TENANT, PROVENANCE, SCHOOL_ADMIN_SET),
    );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).message).toBe('Cross-tenant assignment refused');
    expect(db.prisma.role.findUnique).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });
});
