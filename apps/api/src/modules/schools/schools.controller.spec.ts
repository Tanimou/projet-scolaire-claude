import { InternalServerErrorException, NotFoundException } from '@nestjs/common';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';

import { SchoolsController } from './schools.controller';

/**
 * S-E04-6 — the SCHOOL family (`school.create` / `school.update` /
 * `school.close`), proven in BOTH rollback directions (`ADR-035`, G-AUDIT).
 *
 * Before this slice `apps/api/src/modules/schools/` contained ZERO `auditLog`
 * references and none of the three handlers ran in a transaction at all — so
 * direction (i) was not merely untested, it was untestable. Creating the
 * transaction is half the change; the other half is proving it rolls back both
 * ways.
 *
 * `POST :id/switch` is DELIBERATELY absent from this family and the last describe
 * says so in an assertion rather than in prose: it mutates the caller's own UI
 * preference, not a school.
 */

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const ACTOR = 'actor-profile-1';
const SCHOOL_ID = '44444444-4444-4444-4444-444444444444';

function jwt(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-1', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

/** A request carrying real client hints through the ONE extraction seam. */
const REQ = {
  ip: '203.0.113.9',
  headers: { 'user-agent': 'Mozilla/5.0 (schools)' },
};

type Row = Record<string, unknown>;
type Staged = { kind: 'school' | 'audit'; row: Row };

function makeDb(faults: { entity?: Error; audit?: Error } = {}) {
  const committed: Staged[] = [];
  let staged: Staged[] = [];

  const stageSchool = async ({ where, data }: { where?: { id: string }; data: Row }) => {
    if (faults.entity) throw faults.entity;
    const row = { id: where?.id ?? SCHOOL_ID, address: null, ...data };
    staged.push({ kind: 'school', row });
    return row;
  };

  const tx = {
    school: { create: jest.fn(stageSchool), update: jest.fn(stageSchool) },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (faults.audit) throw faults.audit;
        staged.push({ kind: 'audit', row: data });
        return { id: 'audit-1', ...data };
      }),
    },
  };

  const prisma = {
    school: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn() },
    userProfile: { update: jest.fn() },
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

  const users = {
    ensureUser: jest.fn().mockResolvedValue({ id: ACTOR, tenantId: TENANT, preferences: null }),
  };

  const controller = new SchoolsController(
    prisma as unknown as PrismaService,
    users as unknown as UserSyncService,
  );

  return {
    controller,
    prisma,
    users,
    schools: () => committed.filter((c) => c.kind === 'school').map((c) => c.row),
    auditRows: () => committed.filter((c) => c.kind === 'audit').map((c) => c.row),
  };
}

const CREATE_BODY = {
  name: 'Collège Voltaire',
  schoolCode: 'VOLT-01',
  country: 'fr',
} as never;

function existingSchool(tenantId = TENANT, over: Row = {}) {
  return {
    id: SCHOOL_ID,
    tenantId,
    name: 'Collège Voltaire',
    schoolCode: 'VOLT-01',
    timezone: 'Europe/Paris',
    locale: 'fr-FR',
    status: 'active',
    address: null,
    _count: { students: 0, academicYears: 0 },
    ...over,
  };
}

/* ================================================================== *
 * S-1 — the three handlers each write exactly one row, with provenance
 * ================================================================== */

describe('S-1 / AC-3 — every school mutation writes ONE row carrying real provenance', () => {
  it('create → school.create, inside the creation’s transaction', async () => {
    const db = makeDb();
    await db.controller.create(CREATE_BODY, jwt(['school_admin']), REQ);

    expect(db.schools()).toHaveLength(1);
    expect(db.auditRows()).toHaveLength(1);
    expect(db.auditRows()[0]).toMatchObject({
      tenantId: TENANT,
      actorId: ACTOR,
      actorRole: 'school_admin',
      portal: 'admin',
      action: 'school.create',
      resourceType: 'school',
      ipAddress: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (schools)',
    });
  });

  it('update → school.update, with a before AND an after', async () => {
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(existingSchool());

    await db.controller.update(SCHOOL_ID, { name: 'Lycée Voltaire' } as never, jwt(['super_admin']), REQ);

    const row = db.auditRows()[0]!;
    expect(row).toMatchObject({ action: 'school.update', resourceType: 'school', resourceId: SCHOOL_ID });
    expect(row.before).toMatchObject({ name: 'Collège Voltaire' });
    expect(row.after).toMatchObject({ name: 'Lycée Voltaire' });
  });

  it('remove → school.CLOSE, because the row survives with status closed', async () => {
    // `school.delete` would be a lie: `DELETE /schools/:id` is a soft close.
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(existingSchool());

    await db.controller.remove(SCHOOL_ID, jwt(['school_admin']), REQ);

    expect(db.auditRows()[0]).toMatchObject({ action: 'school.close', resourceType: 'school' });
    expect(db.schools()[0]).toMatchObject({ status: 'closed' });
  });

  it('the create response still carries the parsed address — the shape did not drift', async () => {
    const db = makeDb();
    const created = await db.controller.create(CREATE_BODY, jwt(['school_admin']), REQ);
    expect(created).toHaveProperty('address');
    expect(created).toMatchObject({ name: 'Collège Voltaire' });
  });
});

/* ================================================================== *
 * S-2 (AC-1 / AC-2) — both rollback directions, per handler
 * ================================================================== */

describe('S-2 / AC-1 / AC-2 — neither row survives, in EITHER direction', () => {
  // Each case carries its OWN pre-condition. `create`'s duplicate check reads the
  // same `school.findUnique` mock the other two need populated, so a shared setup
  // would make `create` throw a 409 before ever reaching the transaction — the
  // test would pass while proving nothing about rollback.
  const cases: Array<[string, (db: ReturnType<typeof makeDb>) => Promise<unknown>]> = [
    [
      'create',
      (db) => {
        db.prisma.school.findUnique.mockResolvedValue(null);
        return db.controller.create(CREATE_BODY, jwt(['school_admin']), REQ);
      },
    ],
    [
      'update',
      (db) => {
        db.prisma.school.findUnique.mockResolvedValue(existingSchool());
        return db.controller.update(SCHOOL_ID, { name: 'X' } as never, jwt(['school_admin']), REQ);
      },
    ],
    [
      'remove',
      (db) => {
        db.prisma.school.findUnique.mockResolvedValue(existingSchool());
        return db.controller.remove(SCHOOL_ID, jwt(['school_admin']), REQ);
      },
    ],
  ];

  it.each(cases)('direction (i) — %s: the school write fails, so no school AND no row', async (_n, run) => {
    const boom = new Error('duplicate key value violates unique constraint "school_school_code_key"');
    const db = makeDb({ entity: boom });

    await expect(run(db)).rejects.toThrow(boom);
    expect(db.schools()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });

  it.each(cases)('direction (ii) — %s: the AUDIT write fails, so the mutation does not persist', async (_n, run) => {
    const db = makeDb({ audit: new Error('audit_log insert refused') });

    await expect(run(db)).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(db.schools()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });
});

/* ================================================================== *
 * S-3 (G-TENANT) — a foreign id is refused, and writes nothing
 * ================================================================== */

describe('S-3 / G-TENANT — a foreign-tenant school id is a 404 and writes no row', () => {
  it.each([
    ['update', (db: ReturnType<typeof makeDb>) => db.controller.update(SCHOOL_ID, {} as never, jwt(['school_admin']), REQ)],
    ['remove', (db: ReturnType<typeof makeDb>) => db.controller.remove(SCHOOL_ID, jwt(['school_admin']), REQ)],
    ['switch', (db: ReturnType<typeof makeDb>) => db.controller.switchActive(SCHOOL_ID, jwt(['school_admin']))],
  ])('%s refuses it before the transaction opens', async (_name, run) => {
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(existingSchool(OTHER_TENANT));

    await expect(run(db)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('the row records the CALLER’s tenant, never the target’s', async () => {
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(existingSchool());
    await db.controller.update(SCHOOL_ID, { name: 'X' } as never, jwt(['school_admin']), REQ);
    expect(db.auditRows()[0]!.tenantId).toBe(TENANT);
  });
});

/* ================================================================== *
 * S-4 (AC-15) — the family boundary, asserted rather than described
 * ================================================================== */

describe('S-4 / AC-15 — switchActive is NOT a member of the school family', () => {
  it('a successful switch mutates a preference and writes no audit row', async () => {
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(existingSchool());

    const out = await db.controller.switchActive(SCHOOL_ID, jwt(['school_admin']));

    expect(out).toEqual({ ok: true, activeSchoolId: SCHOOL_ID });
    expect(db.prisma.userProfile.update).toHaveBeenCalledTimes(1);
    expect(db.auditRows()).toEqual([]);
  });
});

// G-AUTHZ is asserted for these handlers in the epic's ONE evidence table,
// `shared/audit/provenance-callsites.spec.ts` — the `@RequiresPermission`
// metadata pin and the denied-role negative both live there. A second table here
// would be a parallel answer to the same question, which is the shape this epic
// exists to delete.
