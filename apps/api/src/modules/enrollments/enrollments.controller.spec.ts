import { InternalServerErrorException, NotFoundException } from '@nestjs/common';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

import { EnrollmentsController } from './enrollments.controller';

/**
 * S-E04-6 — the ENROLLMENT family (`enrollment.create` / `status_change` /
 * `transfer` / `cancel`), in BOTH rollback directions (`ADR-035`, G-AUDIT).
 *
 * Before this slice `apps/api/src/modules/enrollments/` held ZERO `auditLog`
 * references. `create`, `update` and `remove` ran in no transaction at all, and
 * `transfer` used the ARRAY `$transaction([...])` form, which exposes no `tx`
 * client and therefore cannot host an audit write.
 *
 * The array→interactive conversion is the one change in this slice that can
 * break a caller without breaking a test, so `T-4` pins the response body: the
 * endpoint returned the two-element tuple `[closed, opened]` and still does. A
 * silent drift here is a 200 with the wrong shape, which no assertion about an
 * audit row would ever notice.
 */

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const ACTOR = 'actor-profile-1';
const ENROLLMENT_ID = '55555555-5555-5555-5555-555555555555';
const STUDENT_ID = '66666666-6666-6666-6666-666666666666';
const SECTION_A = '77777777-7777-7777-7777-777777777777';
const SECTION_B = '88888888-8888-8888-8888-888888888888';
const YEAR_ID = '99999999-9999-9999-9999-999999999999';

function jwt(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-1', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

const REQ = { ip: '203.0.113.44', headers: { 'user-agent': 'Mozilla/5.0 (enrollments)' } };

type Row = Record<string, unknown>;
type Staged = { kind: 'enrollment' | 'audit'; row: Row };

function classSection(id: string, over: Row = {}) {
  return {
    id,
    tenantId: TENANT,
    name: id === SECTION_A ? '6e A' : '6e B',
    status: 'open',
    maxStudents: 30,
    academicYearId: YEAR_ID,
    academicYear: { id: YEAR_ID, status: 'active' },
    _count: { enrollments: 1 },
    gradeLevel: { id: 'gl-1' },
    ...over,
  };
}

function enrollment(over: Row = {}) {
  return {
    id: ENROLLMENT_ID,
    tenantId: TENANT,
    studentId: STUDENT_ID,
    classSectionId: SECTION_A,
    academicYearId: YEAR_ID,
    status: 'active',
    enrolledAt: new Date('2026-09-01T08:00:00.000Z'),
    endedAt: null,
    endReason: null,
    classSection: { name: '6e A', academicYear: { id: YEAR_ID, status: 'active' } },
    ...over,
  };
}

function makeDb(faults: { entity?: Error; audit?: Error } = {}) {
  const committed: Staged[] = [];
  let staged: Staged[] = [];

  const stage = (build: (args: never) => Row) =>
    jest.fn(async (args: never) => {
      if (faults.entity) throw faults.entity;
      const row = build(args);
      staged.push({ kind: 'enrollment', row });
      return row;
    });

  const tx = {
    enrollment: {
      create: stage((args: { data: Row }) => ({
        id: 'enrollment-new',
        classSection: { name: '6e B', gradeLevel: { id: 'gl-1' } },
        academicYear: { id: YEAR_ID },
        ...args.data,
      })),
      update: stage((args: { where: { id: string }; data: Row }) => ({
        id: args.where.id,
        studentId: STUDENT_ID,
        classSection: { name: '6e A' },
        ...args.data,
      })),
      delete: stage((args: { where: { id: string } }) => ({ id: args.where.id, deleted: true })),
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
    student: { findUnique: jest.fn().mockResolvedValue({ id: STUDENT_ID, tenantId: TENANT }) },
    classSection: { findUnique: jest.fn().mockResolvedValue(classSection(SECTION_B)) },
    enrollment: {
      findUnique: jest.fn().mockResolvedValue(enrollment()),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    guardianship: { findMany: jest.fn().mockResolvedValue([]) },
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

  const users = { ensureUser: jest.fn().mockResolvedValue({ id: ACTOR, tenantId: TENANT }) };
  const notifications = { createMany: jest.fn().mockResolvedValue(undefined) };

  const controller = new EnrollmentsController(
    prisma as unknown as PrismaService,
    users as unknown as UserSyncService,
    notifications as unknown as NotificationsService,
  );

  return {
    controller,
    prisma,
    // S-E04-10 — exposed so the `endedAt` PRESERVATION can be asserted on the
    // arguments actually handed to Prisma. The stage builder rebuilds its row from
    // `args.data` alone, so an assertion on the returned row could not tell « the
    // column was left alone » from « the mock did not model it ».
    tx,
    notifications,
    entities: () => committed.filter((c) => c.kind === 'enrollment').map((c) => c.row),
    auditRows: () => committed.filter((c) => c.kind === 'audit').map((c) => c.row),
  };
}

/** The `data` object a staged `tx.enrollment.update` call actually received. */
function updateData(db: ReturnType<typeof makeDb>, index = 0): Record<string, unknown> {
  const call = db.tx.enrollment.update.mock.calls[index]! as unknown as [{ data: Record<string, unknown> }];
  return call[0].data;
}

/* ================================================================== *
 * T-1 — one row per decision, with real provenance
 * ================================================================== */

describe('T-1 / AC-3 — every enrollment decision writes ONE row inside its transaction', () => {
  it('create → enrollment.create', async () => {
    const db = makeDb();
    await db.controller.create(
      { studentId: STUDENT_ID, classSectionId: SECTION_B } as never,
      jwt(['school_admin']),
      REQ,
    );

    expect(db.auditRows()).toHaveLength(1);
    expect(db.auditRows()[0]).toMatchObject({
      tenantId: TENANT,
      actorId: ACTOR,
      actorRole: 'school_admin',
      portal: 'admin',
      action: 'enrollment.create',
      resourceType: 'enrollment',
      ipAddress: '203.0.113.44',
      userAgent: 'Mozilla/5.0 (enrollments)',
    });
  });

  it('update → enrollment.status_change, with before and after', async () => {
    const db = makeDb();
    await db.controller.update(ENROLLMENT_ID, { status: 'dropped' } as never, jwt(['school_admin']), REQ);

    const row = db.auditRows()[0]!;
    expect(row).toMatchObject({ action: 'enrollment.status_change', resourceId: ENROLLMENT_ID });
    expect(row.before).toMatchObject({ status: 'active' });
    expect(row.after).toMatchObject({ status: 'dropped' });
  });

  it('transfer → ONE enrollment.transfer row naming both enrollments', async () => {
    // Not two rows. A transfer is one decision; two unlinked rows would leave an
    // auditor unable to reconstruct the move.
    const db = makeDb();
    await db.controller.transfer(
      ENROLLMENT_ID,
      { toClassSectionId: SECTION_B } as never,
      jwt(['school_admin']),
      REQ,
    );

    expect(db.auditRows()).toHaveLength(1);
    const row = db.auditRows()[0]!;
    expect(row).toMatchObject({ action: 'enrollment.transfer', resourceId: ENROLLMENT_ID });
    expect(row.after).toMatchObject({ closedEnrollmentId: ENROLLMENT_ID, openedEnrollmentId: 'enrollment-new' });
  });

  it('remove (soft) → enrollment.cancel', async () => {
    const db = makeDb();
    await db.controller.remove(ENROLLMENT_ID, jwt(['school_admin']), REQ);
    expect(db.auditRows()[0]).toMatchObject({ action: 'enrollment.cancel', resourceType: 'enrollment' });
  });

  it('remove (hard-delete of a pending row) → enrollment.cancel carrying the FULL before payload', async () => {
    // The row is gone and `AuditLog` has no FK to it, so `before` is the only
    // surviving record that the enrollment existed (PF-96's neighbour, stated).
    const db = makeDb();
    db.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ status: 'pending' }));

    const out = await db.controller.remove(ENROLLMENT_ID, jwt(['school_admin']), REQ);

    expect(out).toEqual({ ok: true, deleted: true });
    expect(db.auditRows()[0]!.before).toMatchObject({
      studentId: STUDENT_ID,
      classSectionId: SECTION_A,
      academicYearId: YEAR_ID,
      hardDeleted: true,
    });
  });
});

/* ================================================================== *
 * T-2 / T-3 (AC-1 / AC-2) — both rollback directions, per handler
 * ================================================================== */

describe('T-2 / AC-1 / AC-2 — neither row survives, in EITHER direction', () => {
  const cases: Array<[string, (db: ReturnType<typeof makeDb>) => Promise<unknown>]> = [
    [
      'create',
      (db) =>
        db.controller.create(
          { studentId: STUDENT_ID, classSectionId: SECTION_B } as never,
          jwt(['school_admin']),
          REQ,
        ),
    ],
    [
      'update',
      (db) => db.controller.update(ENROLLMENT_ID, { status: 'dropped' } as never, jwt(['school_admin']), REQ),
    ],
    [
      'transfer',
      (db) =>
        db.controller.transfer(
          ENROLLMENT_ID,
          { toClassSectionId: SECTION_B } as never,
          jwt(['school_admin']),
          REQ,
        ),
    ],
    ['remove', (db) => db.controller.remove(ENROLLMENT_ID, jwt(['school_admin']), REQ)],
  ];

  it.each(cases)('direction (i) — %s: the enrollment write fails, so nothing persists', async (_n, run) => {
    const boom = new Error('duplicate key value violates unique constraint "enrollment_unique"');
    const db = makeDb({ entity: boom });

    await expect(run(db)).rejects.toThrow(boom);
    expect(db.entities()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });

  it.each(cases)('direction (ii) — %s: the AUDIT write fails, so the decision does not persist', async (_n, run) => {
    const db = makeDb({ audit: new Error('audit_log insert refused') });

    await expect(run(db)).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(db.entities()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });
});

/* ================================================================== *
 * T-4 (AC-8 / AC-11) — the transfer response body did NOT drift
 * ================================================================== */

describe('T-4 / AC-8 — POST :id/transfer still returns the [closed, opened] tuple', () => {
  it('returns a two-element array, closed first, opened second', async () => {
    const db = makeDb();

    const body = (await db.controller.transfer(
      ENROLLMENT_ID,
      { toClassSectionId: SECTION_B } as never,
      jwt(['school_admin']),
      REQ,
    )) as Array<Record<string, unknown>>;

    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ id: ENROLLMENT_ID, status: 'transferred_out' });
    expect(body[1]).toMatchObject({ classSectionId: SECTION_B, status: 'active' });
    // The audit row is NOT part of the response — the seam added a write, not a field.
    expect(body.some((row) => 'action' in row)).toBe(false);
  });
});

/* ================================================================== *
 * T-5 (G-TENANT) — a foreign id is refused, and writes nothing
 * ================================================================== */

describe('T-5 / G-TENANT — a foreign-tenant identifier is a 404 and writes no row', () => {
  it.each([
    [
      'update',
      (db: ReturnType<typeof makeDb>) => {
        db.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ tenantId: OTHER_TENANT }));
        return db.controller.update(ENROLLMENT_ID, { status: 'dropped' } as never, jwt(['school_admin']), REQ);
      },
    ],
    [
      'transfer',
      (db: ReturnType<typeof makeDb>) => {
        db.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ tenantId: OTHER_TENANT }));
        return db.controller.transfer(
          ENROLLMENT_ID,
          { toClassSectionId: SECTION_B } as never,
          jwt(['school_admin']),
          REQ,
        );
      },
    ],
    [
      'transfer (foreign TARGET section)',
      (db: ReturnType<typeof makeDb>) => {
        db.prisma.classSection.findUnique.mockResolvedValue(
          classSection(SECTION_B, { tenantId: OTHER_TENANT }),
        );
        return db.controller.transfer(
          ENROLLMENT_ID,
          { toClassSectionId: SECTION_B } as never,
          jwt(['school_admin']),
          REQ,
        );
      },
    ],
    [
      'remove',
      (db: ReturnType<typeof makeDb>) => {
        db.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ tenantId: OTHER_TENANT }));
        return db.controller.remove(ENROLLMENT_ID, jwt(['school_admin']), REQ);
      },
    ],
    [
      'create (foreign studentId)',
      (db: ReturnType<typeof makeDb>) => {
        db.prisma.student.findUnique.mockResolvedValue({ id: STUDENT_ID, tenantId: OTHER_TENANT });
        return db.controller.create(
          { studentId: STUDENT_ID, classSectionId: SECTION_B } as never,
          jwt(['school_admin']),
          REQ,
        );
      },
    ],
    [
      'create (foreign classSectionId)',
      (db: ReturnType<typeof makeDb>) => {
        db.prisma.classSection.findUnique.mockResolvedValue(
          classSection(SECTION_B, { tenantId: OTHER_TENANT }),
        );
        return db.controller.create(
          { studentId: STUDENT_ID, classSectionId: SECTION_B } as never,
          jwt(['school_admin']),
          REQ,
        );
      },
    ],
  ])('%s refuses it before the transaction opens', async (_name, run) => {
    const db = makeDb();
    await expect(run(db)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('the row records the CALLER’s tenant, never the target’s', async () => {
    const db = makeDb();
    await db.controller.remove(ENROLLMENT_ID, jwt(['school_admin']), REQ);
    expect(db.auditRows()[0]!.tenantId).toBe(TENANT);
  });
});

/* ================================================================== *
 * T-6 — the fan-out stays OUTSIDE the transaction (ADR-035 D5)
 * ================================================================== */

describe('T-6 — the guardian fan-out is still best-effort, and still after the commit', () => {
  it('a failing notification fan-out does NOT roll back the enrollment or its audit row', async () => {
    const db = makeDb();
    db.prisma.guardianship.findMany.mockRejectedValue(new Error('guardianship read failed'));

    await expect(
      db.controller.create(
        { studentId: STUDENT_ID, classSectionId: SECTION_B } as never,
        jwt(['school_admin']),
        REQ,
      ),
    ).resolves.toBeDefined();

    expect(db.entities()).toHaveLength(1);
    expect(db.auditRows()).toHaveLength(1);
  });
});

/* ================================================================== *
 * T-7 (S-E04-10 / PF-158) — a non-event writes no row, on both paths
 * ================================================================== */

describe('T-7 / PF-158 / AC-7 — enrollment non-events open no transaction', () => {
  // Both halves are asserted everywhere below: « no row » alone would also pass if
  // the row were merely skipped inside an OPEN transaction, which is the shape
  // ADR-035 D1 forbids and which `S-E04-7`'s ratchet walks for.
  it('PATCH { status: "dropped" } on an already-ended enrollment writes nothing', async () => {
    const db = makeDb();
    db.prisma.enrollment.findUnique.mockResolvedValue(
      enrollment({ status: 'dropped', endedAt: new Date('2026-03-01T00:00:00.000Z') }),
    );

    await db.controller.update(ENROLLMENT_ID, { status: 'dropped' } as never, jwt(['school_admin']), REQ);

    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('…but the SAME status on an enrollment whose endedAt is still null IS a transition', async () => {
    // The clause a naive `body.status === enrollment.status` would break, and it
    // breaks it by LOSING DATA: `:284` stamps `endedAt`/`endReason` only when
    // `isEnding && !endedAt`, so an enrollment created directly in a terminal
    // status has its end recorded for the FIRST time by exactly this call.
    const db = makeDb();
    db.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ status: 'dropped', endedAt: null }));

    await db.controller.update(
      ENROLLMENT_ID,
      { status: 'dropped', reason: 'Départ famille' } as never,
      jwt(['school_admin']),
      REQ,
    );

    expect(db.auditRows()).toHaveLength(1);
    expect(updateData(db).endedAt).toBeInstanceOf(Date);
  });

  it('the no-op 200 still carries `classSection` — the response shape did not drift', async () => {
    // `update()` returns a row built with `include: { classSection: { select: { name } } }`.
    // An early return of a pre-read WITHOUT that include would silently drop the
    // field: a 200 with the wrong body, which no audit assertion would catch.
    const db = makeDb();
    db.prisma.enrollment.findUnique.mockResolvedValue(
      enrollment({ status: 'dropped', endedAt: new Date('2026-03-01T00:00:00.000Z') }),
    );

    const body = (await db.controller.update(
      ENROLLMENT_ID,
      { status: 'dropped' } as never,
      jwt(['school_admin']),
      REQ,
    )) as { classSection: { name: string } };

    expect(body.classSection.name).toBe('6e A');
  });

  it('a real transition (active → dropped) still writes EXACTLY one row', async () => {
    const db = makeDb();
    await db.controller.update(ENROLLMENT_ID, { status: 'dropped' } as never, jwt(['school_admin']), REQ);
    expect(db.auditRows()).toHaveLength(1);
  });

  it('DELETE on an already-dropped enrollment writes nothing and keeps the ORIGINAL endedAt', async () => {
    const original = new Date('2026-03-01T00:00:00.000Z');
    const db = makeDb();
    db.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ status: 'dropped', endedAt: original }));

    const body = (await db.controller.remove(ENROLLMENT_ID, jwt(['school_admin']), REQ)) as {
      endedAt: Date;
    };

    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
    expect(body.endedAt).toBe(original);
  });

  it('DELETE on a TRANSFERRED_OUT enrollment writes one row and does NOT overwrite its endedAt', async () => {
    // PF-157's defect shape in a fifth place. The status change IS a transition and
    // keeps its row; what must not move is the date the schooling actually ended.
    const original = new Date('2026-03-01T00:00:00.000Z');
    const db = makeDb();
    db.prisma.enrollment.findUnique.mockResolvedValue(
      enrollment({ status: 'transferred_out', endedAt: original, endReason: 'Transféré vers 6e B' }),
    );

    await db.controller.remove(ENROLLMENT_ID, jwt(['school_admin']), REQ);

    expect(db.auditRows()).toHaveLength(1);
    const data = updateData(db);
    expect(data).toMatchObject({ status: 'dropped' });
    expect(data).not.toHaveProperty('endedAt');
    expect(data).not.toHaveProperty('endReason');
    // The preservation is legible in the trail, not only in the row.
    expect(db.auditRows()[0]!.before).toMatchObject({ endedAt: original.toISOString() });
  });

  it('DELETE on an ACTIVE enrollment still stamps endedAt for the first time', async () => {
    const db = makeDb();

    await db.controller.remove(ENROLLMENT_ID, jwt(['school_admin']), REQ);

    expect(db.auditRows()).toHaveLength(1);
    expect(updateData(db).endedAt).toBeInstanceOf(Date);
    expect(updateData(db).endReason).toBe('Annulation administrative');
  });
});

/* ================================================================== *
 * T-8 (G-TENANT) — a no-op body does not become a cross-tenant oracle
 * ================================================================== */

describe('T-8 / G-TENANT — a foreign-tenant id that is ALSO a no-op is still refused', () => {
  // This pins the guard ORDER. A no-op short-circuit placed before the tenant
  // refusal would return 200 with a foreign tenant's enrollment body — a read
  // oracle created by a correctness fix.
  const foreignEnded = () =>
    enrollment({
      tenantId: OTHER_TENANT,
      status: 'dropped',
      endedAt: new Date('2026-03-01T00:00:00.000Z'),
    });

  it('update refuses it before the transaction opens', async () => {
    const db = makeDb();
    db.prisma.enrollment.findUnique.mockResolvedValue(foreignEnded());

    await expect(
      db.controller.update(ENROLLMENT_ID, { status: 'dropped' } as never, jwt(['school_admin']), REQ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('remove refuses it before the transaction opens', async () => {
    const db = makeDb();
    db.prisma.enrollment.findUnique.mockResolvedValue(foreignEnded());

    await expect(db.controller.remove(ENROLLMENT_ID, jwt(['school_admin']), REQ)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });
});

// G-AUTHZ for these four handlers lives in the epic's ONE evidence table,
// `shared/audit/provenance-callsites.spec.ts` (metadata pin + denied-role
// negative). Deliberately not duplicated here.
