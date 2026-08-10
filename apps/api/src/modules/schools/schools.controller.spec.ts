import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';

import { SchoolsController, UpdateSchoolDto } from './schools.controller';

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

  // The single school read every path goes through — the controller's `findUnique`
  // AND the stage builder below, so an update returns a row consistent with the one
  // the handler read.
  const findSchool = jest.fn().mockResolvedValue(null);

  const stageSchool = async ({ where, data }: { where?: { id: string }; data: Row }) => {
    if (faults.entity) throw faults.entity;
    // S-E04-10 — an `update` returns the FULL row, not just the changed columns.
    // The previous shape (`{ id, address: null, ...data }`) left every untouched
    // field `undefined`, so an assertion on `after.status` or on a preserved
    // `after.address` would have been measuring the mock rather than the code.
    const base = where?.id ? ((await findSchool({ where })) as Row | null) : null;
    const row: Row = { address: null, ...(base ?? {}), id: where?.id ?? SCHOOL_ID, ...data };
    // `Prisma.DbNull` is an INPUT sentinel; what Prisma reads back for an erased
    // Json column is a plain `null`. Modelling that is what makes the erase case's
    // `after.address === null` an honest assertion rather than a mock artefact.
    if (row.address === Prisma.DbNull) row.address = null;
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
    school: { findUnique: findSchool, findMany: jest.fn() },
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

/* ================================================================== *
 * S-5 (S-E04-10 / PF-155 / AC-3) — `status` is REFUSED, at the pipe
 * ================================================================== */

describe('S-5 / PF-155 — closure has ONE door, and PATCH is not it', () => {
  // WHY THIS TEST IS AT THE PIPE AND NOT AT THE CONTROLLER. Every other test in
  // this file calls `db.controller.update(id, {…} as never, …)` DIRECTLY: no
  // `ValidationPipe` runs in that path, so a `PATCH {status:'closed'}` driven
  // through the harness would flow into `tx.school.update` via `...rest` and the
  // school WOULD close — an assertion that is green while the guard it claims to
  // prove cannot fire. The guard is the DTO's shape read by the global pipe, so
  // the DTO is what gets driven.
  //
  // Options recopied verbatim from `apps/api/src/main.ts:140-146`.
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const meta = { type: 'body' as const, metatype: UpdateSchoolDto };

  it('PATCH { status: "closed" } is a 400 — never a silently stripped field', async () => {
    // `forbidNonWhitelisted` is what turns « unknown property » into a refusal
    // instead of a deletion. Without it the removal would be a SILENT behaviour
    // change: the caller believes the school closed, and nothing says otherwise.
    await expect(pipe.transform({ status: 'closed' }, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('PATCH { status: "active" } is a 400 too — the accidental reopen path is gone', async () => {
    // AC-5: this removes a capability. It was never designed — no audit code, no
    // endpoint, no UI, no test — and it is registered as an open capability gap
    // rather than replaced by an invented `school.reopen`.
    await expect(pipe.transform({ status: 'active' }, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('positive control — a legitimate { name } body still transforms cleanly', async () => {
    // Without this, the two refusals above would also pass against a DTO that
    // rejected everything.
    await expect(pipe.transform({ name: 'Lycée Voltaire' }, meta)).resolves.toMatchObject({
      name: 'Lycée Voltaire',
    });
  });

  it('positive control — an address-only body still transforms cleanly', async () => {
    await expect(pipe.transform({ address: { country: 'FR', city: 'Paris' } }, meta)).resolves.toBeDefined();
  });
});

/* ================================================================== *
 * S-6 (S-E04-10 / PF-158) — a non-event writes no row at all
 * ================================================================== */

describe('S-6 / PF-158 / AC-7 — a double-click cannot inflate « Modifications critiques »', () => {
  // `expect(auditRows()).toEqual([])` alone would ALSO pass if the row were merely
  // skipped inside an open transaction, which is the shape ADR-035 D1 forbids. So
  // every case here asserts BOTH: no row, and no transaction.
  it('PATCH {} opens no transaction and writes no row', async () => {
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(existingSchool());

    await db.controller.update(SCHOOL_ID, {} as never, jwt(['school_admin']), REQ);

    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('PATCH { name: <the current name> } — a retry, not a transition', async () => {
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(existingSchool());

    await db.controller.update(SCHOOL_ID, { name: 'Collège Voltaire' } as never, jwt(['school_admin']), REQ);

    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('PATCH { address: <the current address> } — same object, no event', async () => {
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(
      existingSchool(TENANT, { address: { country: 'FR', city: 'Paris' } }),
    );

    await db.controller.update(
      SCHOOL_ID,
      { address: { city: 'Paris', country: 'FR' } } as never,
      jwt(['school_admin']),
      REQ,
    );

    // Key ORDER differs between the two sides — the DTO follows the payload, the
    // parsed value follows the schema declaration. Comparing through `parseAddress`
    // on both sides is what makes that irrelevant.
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('PATCH { address: null } on a school that already has none — erasing nothing', async () => {
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(existingSchool());

    await db.controller.update(SCHOOL_ID, { address: null } as never, jwt(['school_admin']), REQ);

    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('PATCH { address: null } on a school whose STORED address is invalid IS a transition', async () => {
    // The trap the guard must not fall into: `parseAddress` returns `null` for an
    // absent address AND for an invalid one, so a `parseAddress`-only comparison
    // would call this erasure a non-event and silently drop a real mutation. The
    // predicate therefore tests the COLUMN, not the parse result.
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(
      existingSchool(TENANT, { address: { country: 'FRA' } }),
    );

    await db.controller.update(SCHOOL_ID, { address: null } as never, jwt(['school_admin']), REQ);

    expect(db.auditRows()).toHaveLength(1);
  });

  it('a real change still writes EXACTLY one row', async () => {
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(existingSchool());

    await db.controller.update(SCHOOL_ID, { name: 'Lycée Voltaire' } as never, jwt(['school_admin']), REQ);

    expect(db.auditRows()).toHaveLength(1);
  });

  it('the no-op response is the NORMALISED entity, not the raw Prisma row', async () => {
    // A bare `return school;` would hand back `address` as raw Prisma JSON — a 200
    // with the wrong body, which no assertion about audit rows would ever catch.
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(
      existingSchool(TENANT, { address: { country: 'FR', city: 'Paris' } }),
    );

    const body = (await db.controller.update(SCHOOL_ID, {} as never, jwt(['school_admin']), REQ)) as {
      address: unknown;
      name: string;
    };

    expect(body.name).toBe('Collège Voltaire');
    expect(body.address).toEqual({ country: 'FR', city: 'Paris' });
  });

  // G-TENANT ordering is already pinned by `S-3`, which drives `update` with `{}` —
  // a no-op body — against a foreign-tenant school and requires a `NotFoundException`
  // with no transaction. That test is the tripwire for the guard ORDER: a no-op check
  // placed before the tenant refusal turns an empty PATCH into a 200 carrying a
  // foreign school's body. It stays green, unmodified.
});

/* ================================================================== *
 * S-7 (S-E04-10 / PF-159 / AC-9) — the row records `address`
 * ================================================================== */

describe('S-7 / PF-159 — an address change is legible in the trail', () => {
  it('an address-only PATCH writes a row whose before/after DIFFER', async () => {
    // Fails on main @64f64dd: the key is absent from both sides, so a `critical`
    // row was written with a rendered diff identical in every recorded field.
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(
      existingSchool(TENANT, { address: { country: 'FR', city: 'Paris' } }),
    );

    await db.controller.update(
      SCHOOL_ID,
      { address: { country: 'FR', city: 'Lyon' } } as never,
      jwt(['school_admin']),
      REQ,
    );

    const row = db.auditRows()[0]!;
    expect((row.before as { address: unknown }).address).toEqual({ country: 'FR', city: 'Paris' });
    expect((row.after as { address: unknown }).address).toEqual({ country: 'FR', city: 'Lyon' });
  });

  it('an ERASING PATCH records the previous address on `before` and null on `after`', async () => {
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(
      existingSchool(TENANT, { address: { country: 'FR', city: 'Paris' } }),
    );

    await db.controller.update(SCHOOL_ID, { address: null } as never, jwt(['school_admin']), REQ);

    const row = db.auditRows()[0]!;
    expect((row.before as { address: unknown }).address).toEqual({ country: 'FR', city: 'Paris' });
    expect((row.after as { address: unknown }).address).toBeNull();
  });

  it('an INVALID stored address is recorded raw, never as a fabricated erasure', async () => {
    // `parseAddress` returns null for « absent » and for « invalid » alike. Applied
    // bare to `before`, a legacy row with a 3-letter country would make the trail
    // assert that an address was CREATED where one already existed — a falsehood
    // manufactured by the fix, on the one field this row is the sole record of.
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(
      existingSchool(TENANT, { address: { country: 'FRA' } }),
    );

    await db.controller.update(SCHOOL_ID, { name: 'Lycée Voltaire' } as never, jwt(['school_admin']), REQ);

    const row = db.auditRows()[0]!;
    expect((row.before as { address: unknown }).address).toEqual({ country: 'FRA' });
    // …and `after` records it identically, so the untouched address does not read
    // as an erasure either.
    expect((row.after as { address: unknown }).address).toEqual({ country: 'FRA' });
  });

  it('AC-10 — `status` is still recorded, as deliberate context', async () => {
    const db = makeDb();
    db.prisma.school.findUnique.mockResolvedValue(existingSchool());

    await db.controller.update(SCHOOL_ID, { name: 'Lycée Voltaire' } as never, jwt(['school_admin']), REQ);

    const row = db.auditRows()[0]!;
    expect(row.before).toMatchObject({ status: 'active' });
    expect(row.after).toMatchObject({ status: 'active' });
  });
});

// G-AUTHZ is asserted for these handlers in the epic's ONE evidence table,
// `shared/audit/provenance-callsites.spec.ts` — the `@RequiresPermission`
// metadata pin and the denied-role negative both live there. A second table here
// would be a parallel answer to the same question, which is the shape this epic
// exists to delete.
