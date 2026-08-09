import { ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { TeacherProfileService } from '../teaching/teacher-profile.service';

import { AssessmentsController } from './assessments.controller';

/**
 * S-E04-6 — the GRADE-PUBLISH family, moved onto the shared seam.
 *
 * This is the one family that was ALREADY writing inside its transaction, so it
 * is the family that proves the seam does not weaken what already worked — and
 * it is the family that gains something for free: before this slice the row
 * carried no `actorRole`, no `portal` and no ip/user-agent at all (PF-123, write
 * half). Those four fields are asserted here, not assumed.
 */

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const ACTOR = 'actor-profile-1';
const ASSESSMENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function jwt(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-1', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

const REQ = { ip: '203.0.113.77', headers: { 'user-agent': 'Mozilla/5.0 (grades)' } };

type Row = Record<string, unknown>;
type Staged = { kind: 'assessment' | 'audit'; row: Row };

function makeDb(faults: { entity?: Error; audit?: Error } = {}, teacherProfileId = 'tp-other') {
  const committed: Staged[] = [];
  let staged: Staged[] = [];

  const tx = {
    assessment: {
      update: jest.fn(async ({ data }: { data: Row }) => {
        if (faults.entity) throw faults.entity;
        staged.push({ kind: 'assessment', row: { id: ASSESSMENT_ID, ...data } });
        return { id: ASSESSMENT_ID, ...data };
      }),
      findUnique: jest.fn(async () => ({
        id: ASSESSMENT_ID,
        _count: { grades: 2 },
        teachingAssignment: {
          classSectionId: 'cs-1',
          subjectId: 'subject-1',
          academicYearId: 'ay-1',
          subject: { name: 'Mathématiques' },
        },
      })),
    },
    grade: { updateMany: jest.fn(async () => ({ count: 2 })) },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (faults.audit) throw faults.audit;
        staged.push({ kind: 'audit', row: data });
        return { id: 'audit-1', ...data };
      }),
    },
  };

  const prisma = {
    assessment: {
      findUnique: jest.fn().mockResolvedValue({
        id: ASSESSMENT_ID,
        tenantId: TENANT,
        title: 'Contrôle n°1',
        termId: null,
        teacherProfileId: 'tp-1',
        grades: [
          { studentId: 'student-1', value: 12, isAbsent: false },
          { studentId: 'student-2', value: null, isAbsent: true },
        ],
      }),
    },
    guardianship: { findMany: jest.fn().mockResolvedValue([]) },
    snapshotRecomputeTrigger: { upsert: jest.fn().mockResolvedValue({}) },
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
  const teachers = { ensureForUser: jest.fn().mockResolvedValue({ id: teacherProfileId }) };
  const notifications = { createMany: jest.fn().mockResolvedValue(undefined) };

  const controller = new AssessmentsController(
    prisma as unknown as PrismaService,
    users as unknown as UserSyncService,
    teachers as unknown as TeacherProfileService,
    notifications as unknown as NotificationsService,
  );

  return {
    controller,
    prisma,
    assessments: () => committed.filter((c) => c.kind === 'assessment').map((c) => c.row),
    auditRows: () => committed.filter((c) => c.kind === 'audit').map((c) => c.row),
  };
}

/* ================================================================== *
 * P-1 (PF-123, write half) — the row it always wrote, now with provenance
 * ================================================================== */

describe('P-1 / AC-3 — assessment.publish now carries actorRole, portal, IP and user-agent', () => {
  it('writes exactly one row, inside the publish transaction', async () => {
    const db = makeDb();
    await db.controller.publish(ASSESSMENT_ID, jwt(['school_admin']), REQ);

    expect(db.auditRows()).toHaveLength(1);
    expect(db.auditRows()[0]).toEqual({
      tenantId: TENANT,
      actorId: ACTOR,
      actorRole: 'school_admin',
      portal: 'admin',
      action: 'assessment.publish',
      resourceType: 'assessment',
      resourceId: ASSESSMENT_ID,
      ipAddress: '203.0.113.77',
      userAgent: 'Mozilla/5.0 (grades)',
      after: { gradeCount: 2 },
    });
  });

  it('a teacher publishing their own assessment is attributed teacher/teacher, not admin', async () => {
    // The owning teacher profile — so `assertOwnership` lets the publish through
    // and the row records the surface the actor genuinely acted from.
    const db = makeDb({}, 'tp-1');

    await db.controller.publish(ASSESSMENT_ID, jwt(['teacher']), REQ);

    expect(db.auditRows()[0]).toMatchObject({ actorRole: 'teacher', portal: 'teacher' });
  });
});

/* ================================================================== *
 * P-2 (AC-1 / AC-2) — both rollback directions
 * ================================================================== */

describe('P-2 / AC-1 / AC-2 — neither the publish nor its row survives a failure', () => {
  it('direction (i) — the assessment update fails: no publish AND no audit row', async () => {
    const boom = new Error('deadlock detected');
    const db = makeDb({ entity: boom });

    await expect(db.controller.publish(ASSESSMENT_ID, jwt(['school_admin']), REQ)).rejects.toThrow(boom);
    expect(db.assessments()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });

  it('direction (ii) — the AUDIT write fails: the publish does not persist', async () => {
    const db = makeDb({ audit: new Error('audit_log insert refused') });

    await expect(db.controller.publish(ASSESSMENT_ID, jwt(['school_admin']), REQ)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(db.assessments()).toEqual([]);
    expect(db.auditRows()).toEqual([]);
  });
});

/* ================================================================== *
 * P-3 (G-TENANT / G-AUTHZ) — refusals write nothing
 * ================================================================== */

describe('P-3 / G-TENANT / G-AUTHZ — a refused publish writes no row', () => {
  it('a foreign-tenant assessment is a 404 and opens no transaction', async () => {
    const db = makeDb();
    db.prisma.assessment.findUnique.mockResolvedValue({
      id: ASSESSMENT_ID,
      tenantId: OTHER_TENANT,
      teacherProfileId: 'tp-1',
      grades: [],
    });

    await expect(db.controller.publish(ASSESSMENT_ID, jwt(['school_admin']), REQ)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(db.auditRows()).toEqual([]);
  });

  it('a teacher who does not own the assessment is refused, and writes no row', async () => {
    // `teachers.ensureForUser` resolves `tp-other`, the assessment belongs to `tp-1`.
    const db = makeDb();

    await expect(db.controller.publish(ASSESSMENT_ID, jwt(['teacher']), REQ)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.auditRows()).toEqual([]);
  });

  // The `@RequiresPermission('grades.publish')` metadata pin and the denied-role
  // negative live in the epic's ONE evidence table,
  // `shared/audit/provenance-callsites.spec.ts`. Not duplicated here.
});
