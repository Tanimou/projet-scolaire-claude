import 'reflect-metadata';

import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AnalyticsController } from '../../modules/analytics/analytics.controller';
import type { AnalyticsService } from '../../modules/analytics/analytics.service';
import type { SchoolPerformanceDrilldownService } from '../../modules/analytics/school-performance-drilldown.service';
import type { SnapshotOpsService } from '../../modules/analytics/snapshot-ops.service';
import { EnrollmentsController } from '../../modules/enrollments/enrollments.controller';
import type { ExportsService } from '../../modules/exports/exports.service';
import { AssessmentsController } from '../../modules/grades/assessments.controller';
import { GradesController } from '../../modules/grades/grades.controller';
import type { GradesService } from '../../modules/grades/grades.service';
import { InviteController } from '../../modules/identity/invite.controller';
import { RolesController } from '../../modules/identity/roles.controller';
import { UsersController } from '../../modules/identity/users.controller';
import { ImportsController } from '../../modules/imports/imports.controller';
import type { ImportsService } from '../../modules/imports/imports.service';
import { IntegrationsController } from '../../modules/integrations/integrations.controller';
import type { IntegrationsService } from '../../modules/integrations/integrations.service';
import { ParentExportsController } from '../../modules/parent-exports/parent-exports.controller';
import { AcademicYearsController } from '../../modules/school-structure/academic-years.controller';
import type { SchoolContextService } from '../../modules/school-structure/school-context.service';
import { SubjectsController } from '../../modules/school-structure/subjects.controller';
import { SchoolsController } from '../../modules/schools/schools.controller';
import type { StudentAccessService } from '../../modules/students/student-access.service';
import type { TeacherProfileService } from '../../modules/teaching/teacher-profile.service';
import type { KeycloakJwtPayload } from '../auth/jwt.strategy';
import { PermissionsGuard, permissionsFromRealmRoles } from '../auth/permissions.guard';
import { PERMISSIONS_META_KEY } from '../auth/requires-permission.decorator';
import type { UserSyncService } from '../auth/user-sync.service';
import type { PrismaService } from '../prisma/prisma.service';

import {
  PILOTAGE_CLIENT_IP_HEADER,
  PILOTAGE_CLIENT_USER_AGENT_HEADER,
  PILOTAGE_FORWARD_TOKEN_HEADER,
  configureAuditClientHints,
  resetAuditClientHintsPolicy,
} from './client-hints';

/**
 * S-E04-1 — the assertions that matter: the provenance that reaches
 * `prisma.auditLog.create` (or the widened service argument), driven through the
 * REAL controllers.
 *
 * WHY AT THE CONTROLLER BOUNDARY, AND NOT ON THE HELPER
 * ----------------------------------------------------
 * `provenance.spec.ts` proves the mapper maps. It cannot prove a handler uses it.
 * `S-E06-6`'s recorded weakness was 23 tests calling the service directly while
 * the controller seam went unasserted — a refactor could drop the wiring and every
 * other test would stay green while the append-only trail silently recorded
 * `school_admin` for a `super_admin`. So each case below constructs the real
 * controller with mocked collaborators (the `alerts.controller.spec.ts` idiom) and
 * asserts the object handed to Prisma or to the widened service parameter.
 *
 * G-AUDIT is asserted as a CALL COUNT as well as a payload (pre-mortem #6): a
 * handler that stopped writing its row entirely would satisfy every payload
 * matcher.
 *
 * G-AUTHZ is asserted WITHOUT ever asserting a forbidden success path
 * (pre-mortem P1-5). `PermissionsGuard` never runs when a controller is
 * instantiated directly, so "drive `roles.create` with a teacher JWT and observe
 * `teacher/teacher`" proves the wiring but must NOT be read as "a teacher may
 * create a role". Two things therefore carry the wall: (a) the
 * `@RequiresPermission` metadata is read off each edited handler's prototype and
 * compared to the code it carries today, so no guard was relaxed and no
 * permission widened; (b) where a role is genuinely refused deeper in the handler
 * — a `parent` reaching `GradesController.flag` — the refusal is asserted TOGETHER
 * with "and no audit row was written".
 *
 * ONE MEASURED CORRECTION TO THE STORY (R-30 — the story's claim was checked, not
 * trusted). The story calls `grades.controller.ts:345` a *live* defect: "a parent
 * actor is currently audited with portal 'admin'". Measured here: `flag()` is
 * `@RequiresPermission('grades.write')` and then calls
 * `assertCanWrite(assessment.teacherProfileId, …)`, which returns early only for
 * `super_admin`/`school_admin` and otherwise requires the caller to BE the owning
 * teacher. A `parent` therefore cannot reach that write at all — the old ternary's
 * wrong branch was **latent, not observed**. The collapse still removes it, and
 * `parent → portal 'parent'` is proven at a boundary a parent genuinely reaches
 * (`ParentExportsController.createBulletin`, T-9b). Recorded rather than
 * over-claimed; `PROGRESS.md` carries the same correction.
 *
 * NOTE ON SHAPE: no case below lists the four realm roles in one array literal —
 * that would be a second declaration of the precedence ordering, which
 * `shared/quality/audit-provenance-gate.spec.ts` G-3 forbids in every file but
 * two. Per-role coverage is per-case, driven through the one shipped derivation.
 */

const TENANT = 'tenant-1';
const ACTOR_ID = 'user-profile-1';

function jwt(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-sub-1', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

function usersMock() {
  return { ensureUser: jest.fn().mockResolvedValue({ id: ACTOR_ID, tenantId: TENANT }) };
}

/* ================================================================== *
 * T-1 … T-4, T-10 — RolesController.create (AC-3's named handler)
 * ================================================================== */

/**
 * S-E04-7 — the harness now RUNS the callback `$transaction` receives.
 *
 * `RolesController.create` used to create the role and then, separately, its
 * audit row: two statements, so a failure between them left a role that existed
 * unaudited — `write-audit.ts`'s own header cites this handler by name as the
 * measured example. It now opens ONE transaction and writes both inside it,
 * through `writeAudit`.
 *
 * What this file asserts is UNCHANGED: the derived `actorRole`/`portal` still
 * reach the audit row, and the row is still written exactly once. Only the client
 * it is written on moved — from `prisma` to the transaction client — which is
 * precisely the property `ADR-035` D1 exists to make true. The mock therefore
 * routes `tx.auditLog.create` to the SAME spy, so every assertion below still
 * decides the same thing it decided before the sweep.
 */
function makeRoles() {
  const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
  const roleCreate = jest
    .fn()
    .mockResolvedValue({ id: 'role-1', name: 'Surveillant', slug: 'surveillant' });
  const roleDelete = jest.fn();
  const permissionFindMany = jest.fn().mockResolvedValue([{ id: 'p1', code: 'roles.read' }]);
  const tx = {
    role: { create: roleCreate, update: jest.fn(), delete: roleDelete },
    rolePermission: { deleteMany: jest.fn(), create: jest.fn() },
    permission: { findMany: permissionFindMany },
    auditLog: { create: auditCreate },
  };
  const prisma = {
    role: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: roleCreate,
      findUnique: jest.fn(),
      delete: roleDelete,
    },
    permission: { findMany: permissionFindMany },
    auditLog: { create: auditCreate },
    $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const users = usersMock();
  const controller = new RolesController(
    prisma as unknown as PrismaService,
    users as unknown as UserSyncService,
  );
  return { controller, prisma, users, auditCreate };
}

const CREATE_ROLE_BODY = {
  name: 'Surveillant',
  slug: 'surveillant',
  portal: 'admin' as const,
  permissionCodes: ['roles.read'],
};

describe('RolesController.create — the derived actorRole reaches auditLog.create', () => {
  it('T-1 / AC-3 — a super_admin writes actorRole super_admin, portal admin', async () => {
    const { controller, auditCreate } = makeRoles();

    await controller.create(CREATE_ROLE_BODY, jwt(['super_admin']));

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorRole: 'super_admin', portal: 'admin' }),
      }),
    );
  });

  it('T-2 — a school_admin writes actorRole school_admin, portal admin', async () => {
    const { controller, auditCreate } = makeRoles();

    await controller.create(CREATE_ROLE_BODY, jwt(['school_admin']));

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorRole: 'school_admin', portal: 'admin' }),
      }),
    );
  });

  it('T-3 — a teacher writes actorRole teacher AND portal teacher (never the admin literal)', async () => {
    // The load-bearing case: before this slice EVERY caller was recorded as
    // school_admin/admin. This is NOT an assertion that a teacher may create a
    // role — `PermissionsGuard` is bypassed by direct instantiation, and the
    // metadata block below is what holds that wall.
    const { controller, auditCreate } = makeRoles();

    await controller.create(CREATE_ROLE_BODY, jwt(['teacher']));

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorRole: 'teacher', portal: 'teacher' }),
      }),
    );
  });

  it('T-4 — precedence beats array order (school_admin listed before super_admin)', async () => {
    const { controller, auditCreate } = makeRoles();

    await controller.create(CREATE_ROLE_BODY, jwt(['school_admin', 'super_admin']));

    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorRole: 'super_admin', portal: 'admin' }),
      }),
    );
  });

  it('T-10 — an unknown-only realm role records it best-effort, portal null, row STILL written', async () => {
    const { controller, auditCreate } = makeRoles();

    await controller.create(CREATE_ROLE_BODY, jwt(['offline_access']));

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorRole: 'offline_access', portal: null }),
      }),
    );
  });

  it('AC-13 — tenantId/actorId still come from ensureUser(jwt), never from the body', async () => {
    const { controller, users, auditCreate } = makeRoles();

    await controller.create(
      { ...CREATE_ROLE_BODY, name: 'x', slug: 'y' },
      jwt(['school_admin']),
    );

    expect(users.ensureUser).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: TENANT, actorId: ACTOR_ID }),
      }),
    );
  });

  it('G-AUDIT — the audit row is written exactly once per create (call count, not payload)', async () => {
    const { controller, auditCreate } = makeRoles();
    await controller.create(CREATE_ROLE_BODY, jwt(['super_admin']));
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });
});

/* ================================================================== *
 * T-6 — SubjectsController.upsertCoefficients (write inside a $transaction)
 * ================================================================== */

describe('SubjectsController.upsertCoefficients — the derived value reaches tx.auditLog.create', () => {
  /**
   * S-E04-3 — a forwarded request, with the token the API is configured for. The
   * policy is configured HERE rather than inherited, so the case states the
   * configuration it proves; `afterEach` resets it so no other suite inherits it.
   */
  const FORWARD_TOKEN = 'callsites-forward-token';
  const FORWARDED_REQUEST = {
    ip: '172.20.0.9', // the web container — must NOT be what gets recorded
    headers: {
      [PILOTAGE_FORWARD_TOKEN_HEADER]: FORWARD_TOKEN,
      [PILOTAGE_CLIENT_IP_HEADER]: '92.184.7.14',
      [PILOTAGE_CLIENT_USER_AGENT_HEADER]: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0',
      'user-agent': 'undici',
    },
  };

  afterEach(() => resetAuditClientHintsPolicy());

  it('T-6 — a teacher caller lands teacher/teacher in the transactional audit payload', async () => {
    const txAudit = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const tx = {
      subjectCoefficient: { upsert: jest.fn().mockResolvedValue({}) },
      auditLog: { create: txAudit },
    };
    const prisma = {
      $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
      // The post-commit recompute enqueue is best-effort and wrapped in try/catch;
      // an empty active-year list makes it a no-op instead of noise.
      academicYear: { findMany: jest.fn().mockResolvedValue([]) },
      snapshotRecomputeTrigger: { upsert: jest.fn() },
    };
    const controller = new SubjectsController(
      prisma as unknown as PrismaService,
      usersMock() as unknown as UserSyncService,
      { forTenant: jest.fn().mockResolvedValue({ schoolId: 'school-1' }) } as unknown as SchoolContextService,
    );

    await controller.upsertCoefficients(
      { entries: [{ gradeLevelId: 'gl-1', subjectId: 's-1', coefficient: 2 }] },
      jwt(['teacher']),
      { ip: '10.0.0.5', headers: {} },
    );

    expect(txAudit).toHaveBeenCalledTimes(1);
    expect(txAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorRole: 'teacher',
          portal: 'teacher',
          action: 'coefficient.upsert',
        }),
      }),
    );
  });

  it('S-E04-3 / AC-4 — the OPERATOR\'s address and browser reach the row, not the relay\'s', async () => {
    // The whole slice, asserted at the boundary that writes: with the forward
    // token configured, the row carries the browser's own address and user-agent
    // — and specifically NOT `req.ip` (the web container, PF-31) and NOT
    // `undici`, which is what the old per-call-site `@Headers('user-agent')`
    // would have recorded on this path.
    configureAuditClientHints({ trustedHops: 0, forwardToken: FORWARD_TOKEN });

    const txAudit = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const tx = {
      subjectCoefficient: { upsert: jest.fn().mockResolvedValue({}) },
      auditLog: { create: txAudit },
    };
    const prisma = {
      $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
      academicYear: { findMany: jest.fn().mockResolvedValue([]) },
      snapshotRecomputeTrigger: { upsert: jest.fn() },
    };
    const controller = new SubjectsController(
      prisma as unknown as PrismaService,
      usersMock() as unknown as UserSyncService,
      { forTenant: jest.fn().mockResolvedValue({ schoolId: 'school-1' }) } as unknown as SchoolContextService,
    );

    await controller.upsertCoefficients(
      { entries: [{ gradeLevelId: 'gl-1', subjectId: 's-1', coefficient: 2 }] },
      jwt(['school_admin']),
      FORWARDED_REQUEST,
    );

    const payload = (txAudit.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(payload.ipAddress).toBe('92.184.7.14');
    expect(payload.userAgent).toBe('Mozilla/5.0 (Windows NT 10.0) Chrome/126.0');
    expect(payload.ipAddress).not.toBe(FORWARDED_REQUEST.ip);
    expect(payload.userAgent).not.toBe('undici');
  });

  it('AC-3 — a WRONG forward token blanks the row rather than recording the relay', async () => {
    configureAuditClientHints({ trustedHops: 0, forwardToken: FORWARD_TOKEN });

    const txAudit = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const tx = {
      subjectCoefficient: { upsert: jest.fn().mockResolvedValue({}) },
      auditLog: { create: txAudit },
    };
    const prisma = {
      $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
      academicYear: { findMany: jest.fn().mockResolvedValue([]) },
      snapshotRecomputeTrigger: { upsert: jest.fn() },
    };
    const controller = new SubjectsController(
      prisma as unknown as PrismaService,
      usersMock() as unknown as UserSyncService,
      { forTenant: jest.fn().mockResolvedValue({ schoolId: 'school-1' }) } as unknown as SchoolContextService,
    );

    await controller.upsertCoefficients(
      { entries: [{ gradeLevelId: 'gl-1', subjectId: 's-1', coefficient: 2 }] },
      jwt(['school_admin']),
      { ...FORWARDED_REQUEST, headers: { ...FORWARDED_REQUEST.headers, [PILOTAGE_FORWARD_TOKEN_HEADER]: 'wrong' } },
    );

    const payload = (txAudit.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(payload.ipAddress).toBeNull();
    expect(payload.userAgent).toBeNull();
    // The row is still WRITTEN — an absent provenance never blocks the audit.
    expect(txAudit).toHaveBeenCalledTimes(1);
    expect(payload.actorRole).toBe('school_admin');
  });
});

/* ================================================================== *
 * AcademicYearsController — the widened private audit() helper
 * ================================================================== */

describe('AcademicYearsController.create — the widened audit() helper carries the derived value', () => {
  it('a super_admin creating a year is audited super_admin/admin inside the transaction', async () => {
    const txAudit = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const tx = {
      academicYear: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'ay-1', name: '2026-2027' }),
      },
      auditLog: { create: txAudit },
    };
    const prisma = {
      academicYear: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    };
    const controller = new AcademicYearsController(
      prisma as unknown as PrismaService,
      usersMock() as unknown as UserSyncService,
      { forTenant: jest.fn().mockResolvedValue({ schoolId: 'school-1' }) } as unknown as SchoolContextService,
    );

    await controller.create(
      { name: '2026-2027', startDate: '2026-09-01', endDate: '2027-07-05' },
      jwt(['super_admin']),
    );

    expect(txAudit).toHaveBeenCalledTimes(1);
    expect(txAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorRole: 'super_admin',
          portal: 'admin',
          action: 'academic_year.create',
          tenantId: TENANT,
          actorId: ACTOR_ID,
        }),
      }),
    );
  });
});

/* ================================================================== *
 * T-7 — ImportsController.resolveConflict (Pattern B: widened service seam)
 * ================================================================== */

describe('ImportsController.resolveConflict — the provenance reaches the widened actor argument', () => {
  it('T-7 — a super_admin arbitration hands actorRole/portal to ImportsService', async () => {
    const imports = { resolveConflict: jest.fn().mockResolvedValue({ reconciliation: 'updated' }) };
    const controller = new ImportsController(
      imports as unknown as ImportsService,
      usersMock() as unknown as UserSyncService,
    );

    await controller.resolveConflict(
      'batch-1',
      'row-1',
      { decision: 'take_source' as const },
      jwt(['super_admin']),
    );

    expect(imports.resolveConflict).toHaveBeenCalledTimes(1);
    expect(imports.resolveConflict).toHaveBeenCalledWith('batch-1', 'row-1', 'take_source', {
      id: ACTOR_ID,
      tenantId: TENANT,
      actorRole: 'super_admin',
      portal: 'admin',
    });
  });
});

/* ================================================================== *
 * IntegrationsController — both widened seams
 * ================================================================== */

describe('IntegrationsController — connect/sync hand the derived provenance to the service', () => {
  function make() {
    const integrations = {
      connect: jest.fn().mockResolvedValue({ id: 'src-1' }),
      sync: jest.fn().mockResolvedValue({ batches: [] }),
    };
    const controller = new IntegrationsController(
      integrations as unknown as IntegrationsService,
      usersMock() as unknown as UserSyncService,
    );
    return { controller, integrations };
  }

  it('connect passes { id, tenantId, actorRole, portal } — never a literal', async () => {
    const { controller, integrations } = make();

    await controller.connect(
      { kind: 'csv_bundle', schoolId: 'school-1' } as never,
      jwt(['school_admin']),
    );

    expect(integrations.connect).toHaveBeenCalledWith(
      { id: ACTOR_ID, tenantId: TENANT, actorRole: 'school_admin', portal: 'admin' },
      expect.anything(),
    );
  });

  it('sync passes the same shape, and a super_admin is attributed as super_admin', async () => {
    const { controller, integrations } = make();

    await controller.sync('src-1', { bundle: {} } as never, jwt(['super_admin']));

    expect(integrations.sync).toHaveBeenCalledWith(
      'src-1',
      { id: ACTOR_ID, tenantId: TENANT, actorRole: 'super_admin', portal: 'admin' },
      expect.anything(),
    );
  });
});

/* ================================================================== *
 * T-8 — AnalyticsController.snapshotRebuild (the 9th portal literal)
 * ================================================================== */

describe('AnalyticsController.snapshotRebuild — portal is threaded, not hard-coded', () => {
  function make() {
    const snapshotOps = {
      enqueueRebuild: jest
        .fn()
        .mockResolvedValue({ triggerId: 'trg-1', status: 'pending', coalesced: false }),
    };
    const controller = new AnalyticsController(
      {} as unknown as AnalyticsService,
      usersMock() as unknown as UserSyncService,
      { forUser: jest.fn().mockResolvedValue({ tenantId: TENANT, schoolId: 'school-1' }) } as unknown as SchoolContextService,
      {} as unknown as TeacherProfileService,
      {} as unknown as StudentAccessService,
      {} as unknown as SchoolPerformanceDrilldownService,
      snapshotOps as unknown as SnapshotOpsService,
    );
    return { controller, snapshotOps };
  }

  it('T-8 — a teacher-role rebuild reaches enqueueRebuild with portal teacher, NOT admin', async () => {
    const { controller, snapshotOps } = make();

    await controller.snapshotRebuild(jwt(['teacher']), {} as never);

    expect(snapshotOps.enqueueRebuild).toHaveBeenCalledTimes(1);
    expect(snapshotOps.enqueueRebuild).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: 'teacher', portal: 'teacher', tenantId: TENANT }),
    );
  });

  it('an admin rebuild still records admin — the value is derived, not inverted', async () => {
    const { controller, snapshotOps } = make();

    await controller.snapshotRebuild(jwt(['school_admin']), {} as never);

    expect(snapshotOps.enqueueRebuild).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: 'school_admin', portal: 'admin' }),
    );
  });
});

/* ================================================================== *
 * T-9a / T-9b — the grades flag site, and the parent portal correction
 * ================================================================== */

function makeGrades(teacherProfileId: string) {
  const auditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
  const prisma = {
    grade: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'grade-1',
        tenantId: TENANT,
        status: 'published',
        isFlagged: false,
        flaggedAt: null,
        flagNote: null,
        assessmentId: 'asm-1',
        assessment: { id: 'asm-1', teacherProfileId: 'tp-owner' },
      }),
      update: jest.fn().mockResolvedValue({
        id: 'grade-1',
        isFlagged: true,
        flaggedAt: new Date('2026-08-08T10:00:00.000Z'),
        flagNote: null,
      }),
    },
    auditLog: { create: auditCreate },
  };
  const teachers = { ensureForUser: jest.fn().mockResolvedValue({ id: teacherProfileId }) };
  const controller = new GradesController(
    prisma as unknown as PrismaService,
    usersMock() as unknown as UserSyncService,
    teachers as unknown as TeacherProfileService,
    {} as unknown as GradesService,
  );
  return { controller, auditCreate };
}

describe('GradesController.flag — the inline copy is gone and the portal is the derived one', () => {
  it('T-9a — the owning teacher is audited teacher/teacher', async () => {
    const { controller, auditCreate } = makeGrades('tp-owner');

    await controller.flag('grade-1', { flagged: true }, jwt(['teacher']));

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorRole: 'teacher', portal: 'teacher', action: 'grade.flag' }),
      }),
    );
  });

  it('a school_admin is audited school_admin/admin — the same value the old ternary produced', async () => {
    const { controller, auditCreate } = makeGrades('tp-other');

    await controller.flag('grade-1', { flagged: true }, jwt(['school_admin']));

    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorRole: 'school_admin', portal: 'admin' }),
      }),
    );
  });

  it('G-AUTHZ — a parent is REFUSED here and no audit row is written (never a fail-open)', async () => {
    // The story called the parent case a live defect at this site. Measured: the
    // handler's own ownership check refuses a parent before the write, so the old
    // ternary's wrong branch was latent. This asserts the refusal AND the absence
    // of a row — never a forbidden success path (pre-mortem P1-5).
    const { controller, auditCreate } = makeGrades('tp-other');

    await expect(controller.flag('grade-1', { flagged: true }, jwt(['parent']))).rejects.toThrow(
      ForbiddenException,
    );
    expect(auditCreate).not.toHaveBeenCalled();
  });
});

describe('AC-8 / T-9b — a parent actor records portal parent where a parent genuinely acts', () => {
  it('ParentExportsController.createBulletin attributes a parent as parent/parent', async () => {
    const exportsSvc = { enqueueParentBulletin: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    const controller = new ParentExportsController(
      exportsSvc as unknown as ExportsService,
      usersMock() as unknown as UserSyncService,
      { forUser: jest.fn().mockResolvedValue({ schoolId: 'school-1' }) } as unknown as SchoolContextService,
      { canAccessStudent: jest.fn().mockResolvedValue(true) } as unknown as StudentAccessService,
    );

    await controller.createBulletin(jwt(['parent']), {
      studentId: 'student-1',
      termId: 'term-1',
    } as never);

    expect(exportsSvc.enqueueParentBulletin).toHaveBeenCalledTimes(1);
    expect(exportsSvc.enqueueParentBulletin).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: 'parent', portal: 'parent' }),
    );
  });
});

/* ================================================================== *
 * AC-13 / G-AUTHZ — no guard metadata was removed or widened
 * ================================================================== */

describe('AC-13 / G-AUTHZ — @RequiresPermission is unchanged on every edited handler', () => {
  const CASES: [string, object, string, string[]][] = [
    ['RolesController.create', RolesController.prototype, 'create', ['roles.write']],
    ['RolesController.update', RolesController.prototype, 'update', ['roles.write']],
    ['RolesController.remove', RolesController.prototype, 'remove', ['roles.write']],
    ['InviteController.invite', InviteController.prototype, 'invite', ['users.write']],
    ['ImportsController.resolveConflict', ImportsController.prototype, 'resolveConflict', ['imports.execute']],
    ['IntegrationsController.connect', IntegrationsController.prototype, 'connect', ['integrations.write']],
    ['IntegrationsController.sync', IntegrationsController.prototype, 'sync', ['integrations.write']],
    ['SubjectsController.upsertCoefficients', SubjectsController.prototype, 'upsertCoefficients', ['subjects.write']],
    ['AcademicYearsController.create', AcademicYearsController.prototype, 'create', ['academic_years.write']],
    ['AcademicYearsController.update', AcademicYearsController.prototype, 'update', ['academic_years.write']],
    ['AcademicYearsController.remove', AcademicYearsController.prototype, 'remove', ['academic_years.write']],
    ['AnalyticsController.snapshotRebuild', AnalyticsController.prototype, 'snapshotRebuild', ['schools.read']],
    ['GradesController.flag', GradesController.prototype, 'flag', ['grades.write']],
    ['ParentExportsController.createBulletin', ParentExportsController.prototype, 'createBulletin', ['exports.execute.parent']],
    // S-E04-6 — the ten handlers this slice edited, EXTENDING this table rather
    // than building a parallel one beside each family's spec. One table is the
    // whole point: "which permission does this handler require" must have exactly
    // one answer, in exactly one place.
    ['UsersController.assignRole', UsersController.prototype, 'assignRole', ['roles.assign']],
    ['UsersController.revokeRole', UsersController.prototype, 'revokeRole', ['roles.assign']],
    ['SchoolsController.create', SchoolsController.prototype, 'create', ['schools.write']],
    ['SchoolsController.update', SchoolsController.prototype, 'update', ['schools.write']],
    ['SchoolsController.remove', SchoolsController.prototype, 'remove', ['schools.write']],
    ['EnrollmentsController.create', EnrollmentsController.prototype, 'create', ['enrollments.write']],
    ['EnrollmentsController.update', EnrollmentsController.prototype, 'update', ['enrollments.write']],
    ['EnrollmentsController.transfer', EnrollmentsController.prototype, 'transfer', ['enrollments.write']],
    ['EnrollmentsController.remove', EnrollmentsController.prototype, 'remove', ['enrollments.delete']],
    ['AssessmentsController.publish', AssessmentsController.prototype, 'publish', ['grades.publish']],
  ];

  it.each(CASES)('%s still requires exactly %p', (_label, proto, handler, expected) => {
    const codes = Reflect.getMetadata(
      PERMISSIONS_META_KEY,
      (proto as Record<string, unknown>)[handler] as object,
    ) as string[] | undefined;
    expect(codes).toEqual(expected);
  });

  it('the positive control — a handler with no decorator reports undefined, so the read is real', () => {
    // Without this, a `Reflect.getMetadata` that silently returned `undefined` for
    // everything would make every case above pass by comparing nothing.
    const codes = Reflect.getMetadata(PERMISSIONS_META_KEY, function unDecorated() {});
    expect(codes).toBeUndefined();
  });
});

/* ================================================================== *
 * S-E04-6 / AC-8 / G-AUTHZ — the denied role is REFUSED, per family
 * ================================================================== */

/**
 * The metadata table above proves nothing was widened. This proves the wall is
 * load-bearing for the four families S-E04-6 touched, by driving the REAL
 * `PermissionsGuard` — the only honest way, because instantiating a controller
 * directly never runs a guard, and "call the handler as a parent and watch it
 * succeed" would assert a forbidden success path (pre-mortem P1-5).
 *
 * `effectivePermissions` is the real `permissionsFromRealmRoles` derivation, not
 * a hand-written set: a test that invented the permission list would be asserting
 * against its own copy of ADR-015's table.
 */
describe('S-E04-6 / AC-8 / G-AUTHZ — a role that must be denied IS denied, and no handler runs', () => {
  function makeGuard() {
    const users = {
      effectivePermissions: jest.fn(async (_sub: string, realmRoles: string[]) =>
        permissionsFromRealmRoles(realmRoles),
      ),
    };
    return new PermissionsGuard(new Reflector(), users as unknown as UserSyncService);
  }

  function contextFor(proto: object, handler: string, cls: object, roles: string[]): ExecutionContext {
    const fn = (proto as Record<string, unknown>)[handler] as () => unknown;
    return {
      getHandler: () => fn,
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => ({ user: jwt(roles) }) }),
    } as unknown as ExecutionContext;
  }

  const DENIALS: [string, object, string, object, string][] = [
    ['teacher → users.assignRole', UsersController.prototype, 'assignRole', UsersController, 'teacher'],
    ['parent → schools.create', SchoolsController.prototype, 'create', SchoolsController, 'parent'],
    ['parent → schools.remove', SchoolsController.prototype, 'remove', SchoolsController, 'parent'],
    ['parent → enrollments.create', EnrollmentsController.prototype, 'create', EnrollmentsController, 'parent'],
    ['parent → enrollments.remove', EnrollmentsController.prototype, 'remove', EnrollmentsController, 'parent'],
    ['parent → assessments.publish', AssessmentsController.prototype, 'publish', AssessmentsController, 'parent'],
  ];

  it.each(DENIALS)('%s is refused by the real guard', async (_label, proto, handler, cls, role) => {
    const guard = makeGuard();
    await expect(
      guard.canActivate(contextFor(proto, handler, cls, [role])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the positive control — a school_admin IS allowed through the same four gates', async () => {
    // Without this, every denial above could be true because the guard refuses
    // everyone, which would prove nothing about the permission codes.
    for (const [, proto, handler, cls] of DENIALS) {
      const guard = makeGuard();
      await expect(
        guard.canActivate(contextFor(proto, handler, cls, ['school_admin'])),
      ).resolves.toBe(true);
    }
  });
});
