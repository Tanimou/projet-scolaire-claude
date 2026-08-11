import 'reflect-metadata';

import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PERMISSIONS, REALM_ROLE_PERMISSIONS } from '../../shared/auth/permissions.constants';
import { PERMISSIONS_META_KEY } from '../../shared/auth/requires-permission.decorator';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';

import { RolesController } from './roles.controller';

/**
 * S-E05-2 — the privilege ceiling at the MINT sites (`PF-09`, T-11 … T-18).
 *
 * `roles.controller.ts` had no spec at all while carrying the defect that makes
 * `PF-156` a two-request self-escalation: `create()` asked only whether a code
 * EXISTS in the catalogue, and `update()` rewrote an existing role's whole set
 * from arbitrary codes.
 *
 * THE FAKE STAGES, THEN COMMITS — copied from `invite.controller.spec.ts:106-156`
 * rather than invented. Writes made inside the `$transaction` callback land in
 * `staged` and are absorbed into `committed` only when the callback RESOLVES, so
 * « no role row and no audit row » is observed on a store rather than inferred
 * from a call count. A mock that merely counted `create` calls would report a row
 * as absent while a real database kept it.
 *
 * THE FALSE-GREEN TRAP THIS FILE IS BUILT AGAINST (inversion T-1). Both handlers
 * ALREADY throw for older, unrelated reasons — `create()` 400s on a slug
 * collision (`:114`), `update()` 403s on `isSystem` (`:166`). A negative that
 * asserted only `rejects.toBeInstanceOf(ForbiddenException)` would pass without
 * the ceiling existing. So every negative below asserts the 403 BODY — that
 * `missing` names the expected codes — and every `update()` negative uses a
 * NON-system role, or it would 403 at `:166` and prove nothing.
 *
 * FAILS-BEFORE, DERIVABLE BY READING: T-11 … T-13 assert `ForbiddenException`
 * with a `missing` array on paths whose pre-slice code contains no 403 branch at
 * all — a pre-fix controller resolves and commits, so the assertions are
 * structurally unreachable before the fix.
 */

const TENANT = 'tenant-1';
const ACTOR = 'actor-profile-1';
const ROLE_ID = 'role-1';

const ALL_CODES: string[] = PERMISSIONS.map((p) => p[0]);
const SCHOOL_ADMIN_SET = new Set<string>(REALM_ROLE_PERMISSIONS.school_admin ?? []);
const FULL_CATALOGUE = new Set<string>(ALL_CODES);
/** A deliberately narrow custom-role grantor: holds `roles.write`, little else. */
const NARROW_SET = new Set<string>(['roles.read', 'roles.write', 'roles.assign', 'students.read']);

function jwt(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-actor', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

type Row = Record<string, unknown>;
type Staged = { kind: 'role' | 'rolePermission' | 'audit'; row: Row };

function makeDb(
  grantorPermissions: ReadonlySet<string>,
  options: { existingRole?: Row | null; slugTaken?: boolean } = {},
) {
  const { existingRole = null, slugTaken = false } = options;

  const committed: Staged[] = [];
  let staged: Staged[] = [];

  /** The seeded catalogue: every code in `PERMISSIONS` exists, nothing else does. */
  const catalogue = ALL_CODES.map((code) => ({ id: `perm-${code}`, code }));
  const findPerms = async ({ where }: { where: { code: { in: string[] } } }) =>
    catalogue.filter((p) => where.code.in.includes(p.code));

  const tx = {
    role: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { id: ROLE_ID, ...data };
        staged.push({ kind: 'role', row });
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = { id: where.id, ...data };
        staged.push({ kind: 'role', row });
        return row;
      }),
    },
    // Present even though the ceiling must stop the flow before them: if they
    // were absent, T-12 would go green because the call CRASHED rather than
    // because it was refused — the green-by-accident shape this epic is named
    // after.
    rolePermission: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async ({ data }: { data: Row }) => {
        staged.push({ kind: 'rolePermission', row: data });
        return { id: 'rp-1', ...data };
      }),
    },
    permission: { findMany: jest.fn(findPerms) },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        staged.push({ kind: 'audit', row: data });
        return { id: 'audit-1', ...data };
      }),
    },
  };

  const prisma = {
    role: {
      findFirst: jest.fn(async () => (slugTaken ? { id: 'other-role' } : null)),
      findUnique: jest.fn(async () => existingRole),
    },
    permission: { findMany: jest.fn(findPerms) },
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
    ensureUser: jest.fn().mockResolvedValue({ id: ACTOR, tenantId: TENANT }),
    // The SAME seam `PermissionsGuard:27-28` reads. A fake that returned a
    // hand-written list would be asserting against its own copy of ADR-015.
    effectivePermissions: jest.fn(async (_sub: string, _realmRoles: string[]) => grantorPermissions),
  };

  const controller = new RolesController(
    prisma as unknown as PrismaService,
    users as unknown as UserSyncService,
  );

  return {
    controller,
    prisma,
    users,
    tx,
    roles: () => committed.filter((c) => c.kind === 'role').map((c) => c.row),
    rolePermissions: () => committed.filter((c) => c.kind === 'rolePermission').map((c) => c.row),
    auditRows: () => committed.filter((c) => c.kind === 'audit').map((c) => c.row),
  };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the handler to reject, and it resolved');
}

function bodyOf(err: unknown) {
  return (err as ForbiddenException).getResponse() as {
    message: string;
    required: string[];
    missing: string[];
  };
}

const CUSTOM_ROLE = { id: ROLE_ID, name: 'Surveillant', slug: 'surveillant', isSystem: false };

const createBody = (permissionCodes: string[]) =>
  ({
    name: 'Surveillant',
    slug: 'surveillant',
    portal: 'admin',
    permissionCodes,
  }) as never;

/* ================================================================== *
 * T-11 / T-13 — create(): the mint is refused, and nothing is written
 * ================================================================== */

describe('T-11 / T-13 / AC-2 — create() refuses a permission the caller does not hold', () => {
  it('T-11 — a school_admin minting `grades.revise` is refused, before any write', async () => {
    // `grades.revise` = revise PUBLISHED grades. `REALM_ROLE_PERMISSIONS.school_admin`
    // does not carry it (measured), and it is the exact capability PF-09 names.
    const db = makeDb(SCHOOL_ADMIN_SET);

    const err = await failureOf(
      db.controller.create(createBody(['students.read', 'grades.revise']), jwt(['school_admin'])),
    );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(bodyOf(err).missing).toEqual(['grades.revise']);
    expect(bodyOf(err).required).toEqual(['students.read', 'grades.revise']);
    // AC-2 / FR-5 — the refusal precedes the transaction, so there is no role
    // row, no role_permission row and no audit row to roll back.
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.roles()).toEqual([]);
    expect(db.rolePermissions()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });

  it('T-11b — the full-catalogue mint (PF-09’s live exploit, step 1) is refused', async () => {
    // The two-request self-escalation: mint a role carrying EVERY code, assign
    // it to yourself, re-authenticate. Step 1 now answers 403.
    const db = makeDb(SCHOOL_ADMIN_SET);

    const err = await failureOf(db.controller.create(createBody(ALL_CODES), jwt(['school_admin'])));

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(bodyOf(err).missing).toContain('grades.revise');
    expect(bodyOf(err).missing).toContain('grades.write');
    expect(db.roles()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });

  it('T-13 — a NARROW custom-role grantor is refused anything outside its own set', async () => {
    // The ceiling is relative to the caller, not to a role name: a grantor
    // holding `roles.write` but only `students.read` cannot mint `students.write`.
    const db = makeDb(NARROW_SET);

    const err = await failureOf(db.controller.create(createBody(['students.write']), jwt([])));

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(bodyOf(err).missing).toEqual(['students.write']);
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });
});

/* ================================================================== *
 * T-12 — update(): the REWRITE is refused
 * ================================================================== */

describe('T-12 / AC-3 — update() refuses a rewrite that exceeds the caller', () => {
  it('T-12 — adding `grades.revise` to a NON-system role is refused, nothing rewritten', async () => {
    // A non-system role deliberately: a system role would 403 at `:166` on
    // `isSystem` and this test would prove nothing about the ceiling.
    const db = makeDb(SCHOOL_ADMIN_SET, { existingRole: CUSTOM_ROLE });

    const err = await failureOf(
      db.controller.update(
        ROLE_ID,
        { permissionCodes: ['students.read', 'grades.revise'] } as never,
        jwt(['school_admin']),
      ),
    );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(bodyOf(err).missing).toEqual(['grades.revise']);
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.tx.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(db.tx.rolePermission.create).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('the isSystem refusal still wins, and it is a DIFFERENT message', async () => {
    // G-AUTHZ regression: the pre-existing guard was not displaced by the new one.
    const db = makeDb(FULL_CATALOGUE, { existingRole: { ...CUSTOM_ROLE, isSystem: true } });

    const err = await failureOf(
      db.controller.update(ROLE_ID, { name: 'x' } as never, jwt(['super_admin'])),
    );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).message).toBe('Les rôles système ne sont pas modifiables');
  });
});

/* ================================================================== *
 * T-14 / T-15 / T-16 — the positive controls: NOT a blanket deny
 * ================================================================== */

describe('T-14 / T-15 / T-16 — what the ceiling still allows', () => {
  it('T-14 — a school_admin minting codes it DOES hold commits one role and one audit row', async () => {
    const db = makeDb(SCHOOL_ADMIN_SET);

    const result = await db.controller.create(
      createBody(['students.read', 'enrollments.approve']),
      jwt(['school_admin']),
    );

    expect(result).toEqual({ id: ROLE_ID });
    expect(db.roles()).toHaveLength(1);
    expect(db.auditRows()).toHaveLength(1);
    // G-AUDIT — the writeAudit call is unmoved and unwrapped; its payload is
    // byte-identical in behaviour to before this slice.
    expect(db.auditRows()[0]).toMatchObject({
      tenantId: TENANT,
      actorId: ACTOR,
      action: 'role.create',
      resourceType: 'role',
      resourceId: ROLE_ID,
    });
  });

  it('T-15 / FR-4 — a rename-only update runs NO ceiling check, and the FIXTURE is the assertion', async () => {
    // The grantor here holds ONLY `roles.write` + `roles.read`. If a ceiling
    // check ran on a rename it would have to compare *something*, and any
    // comparison against this grantor refuses. The role also carries a name only
    // — no `permissionCodes` in the body — so the exemption is proven by
    // BEHAVIOUR (it commits) rather than by spying on a call that was not made.
    const db = makeDb(new Set(['roles.read', 'roles.write']), { existingRole: CUSTOM_ROLE });

    const result = await db.controller.update(ROLE_ID, { name: 'Surveillant général' } as never, jwt([]));

    expect(result).toEqual({ id: ROLE_ID });
    expect(db.auditRows()).toHaveLength(1);
    expect(db.auditRows()[0]).toMatchObject({ action: 'role.update', resourceType: 'role' });
    // No permission read at all: the exemption is a skipped branch, not a
    // comparison that happened to pass.
    expect(db.prisma.permission.findMany).not.toHaveBeenCalled();
    expect(db.users.effectivePermissions).not.toHaveBeenCalled();
    expect(db.tx.rolePermission.deleteMany).not.toHaveBeenCalled();
  });

  it('T-16 / AC-6 — a full-catalogue grantor (super_admin-shaped) mints the whole catalogue', async () => {
    // AC-6 without a role-name exemption anywhere: `REALM_ROLE_PERMISSIONS.super_admin`
    // IS the catalogue, so the ceiling is arithmetically a no-op. Built from
    // `PERMISSIONS`, NOT from a seeded `super_admin` Role row — measured, there
    // is none (`grep -rn super_admin apps/api/prisma/` → zero matches).
    const db = makeDb(FULL_CATALOGUE);

    const result = await db.controller.create(createBody(ALL_CODES), jwt(['super_admin']));

    expect(result).toEqual({ id: ROLE_ID });
    expect(db.roles()).toHaveLength(1);
    expect(db.auditRows()).toHaveLength(1);
  });

  it('T-16b — a full-catalogue grantor rewrites a non-system role’s whole set', async () => {
    const db = makeDb(FULL_CATALOGUE, { existingRole: CUSTOM_ROLE });

    await db.controller.update(
      ROLE_ID,
      { permissionCodes: ['grades.revise', 'attendance.write'] } as never,
      jwt(['super_admin']),
    );

    expect(db.tx.rolePermission.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.rolePermissions()).toHaveLength(2);
    expect(db.auditRows()).toHaveLength(1);
  });
});

/* ================================================================== *
 * T-17 / T-18 — an unknown code answers 400 on BOTH handlers
 * ================================================================== */

describe('T-17 / T-18 — catalogue-existence (400) wins over the ceiling (403), on both handlers', () => {
  it('T-17 — create() with an unknown code still answers 400 “Permissions inconnues”', async () => {
    const db = makeDb(FULL_CATALOGUE);

    const err = await failureOf(
      db.controller.create(createBody(['students.read', 'not.a.permission']), jwt(['super_admin'])),
    );

    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as { message: string; missing: string[] };
    expect(body.message).toBe('Permissions inconnues');
    expect(body.missing).toEqual(['not.a.permission']);
  });

  it('T-18 — update() with an unknown code answers 400 TOO: one input, one answer', async () => {
    // THE ORDERING FIX. Before this slice `update()`'s catalogue check lived
    // INSIDE `$transaction` while `create()`'s lived outside it. Putting the
    // ceiling before the transaction and leaving that asymmetry would have made
    // one typo answer 400 from create() and 403 from update(). The catalogue
    // check is hoisted so the contract is: unknown code → 400, then ceiling →
    // 403, then the write. The `deleteMany`/`create` rewrite stays in the
    // transaction and `writeAudit` is untouched.
    const db = makeDb(FULL_CATALOGUE, { existingRole: CUSTOM_ROLE });

    const err = await failureOf(
      db.controller.update(ROLE_ID, { permissionCodes: ['not.a.permission'] } as never, jwt(['super_admin'])),
    );

    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as { message: string; missing: string[] };
    expect(body.message).toBe('Permissions inconnues');
    expect(body.missing).toEqual(['not.a.permission']);
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('an unknown code is refused even for a grantor that holds everything real', async () => {
    // The two checks are complementary, not redundant: the ceiling ALSO refuses
    // an unknown code (nobody holds it), but the 400 is the honest answer and it
    // must keep winning.
    const db = makeDb(FULL_CATALOGUE);
    const err = await failureOf(db.controller.create(createBody(['not.a.permission']), jwt(['super_admin'])));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err).not.toBeInstanceOf(ForbiddenException);
  });
});

/* ================================================================== *
 * G-AUTHZ — the guard metadata is untouched
 * ================================================================== */

describe('G-AUTHZ — @RequiresPermission on create()/update() is unchanged', () => {
  // The ceiling is an IN-HANDLER check, never a metadata change. A local
  // negative, deliberately not a second copy of the canonical table at
  // `provenance-callsites.spec.ts:649-655`.
  it.each(['create', 'update'] as const)('%s still requires exactly ["roles.write"]', (handler) => {
    const codes = Reflect.getMetadata(
      PERMISSIONS_META_KEY,
      (RolesController.prototype as unknown as Record<'create' | 'update', object>)[handler],
    );
    expect(codes).toEqual(['roles.write']);
  });
});
