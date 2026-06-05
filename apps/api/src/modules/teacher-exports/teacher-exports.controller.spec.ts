import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { TeacherExportsController } from './teacher-exports.controller';
import type { ExportsService } from '../exports/exports.service';
import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { TeacherProfileService } from '../teaching/teacher-profile.service';

// Load-bearing seams for E4-S3 (children's-data export, P1 [auth]):
//   1. enqueue is gated by teaching-assignment ABAC: the caller must CURRENTLY
//      own the teachingAssignment (teacherProfileId === my profile id), else 403
//      — and the exported classSectionId is SERVER-derived from that OWNED
//      assignment, never client-supplied (anti foreign-class export / IDOR).
//   2. an unknown / cross-tenant teachingAssignmentId → 404 (no existence leak).
//   3. every read/download is re-scoped to requestedBy = me.id (anti cross-
//      teacher IDOR within the same tenant), and the list is grades_xlsx-only.

const TENANT = 't1';
const ME = 'teacher-user-1';
const MY_TP = 'tp-1';
const TA = 'ta-1';
const CLASS = 'cs-1';
const TERM = 'term-1';
const JOB = 'job-1';

function jwtWithRoles(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-sub', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

function makeController(opts?: {
  assignment?: { teacherProfileId: string; classSectionId: string } | null;
}) {
  const assignment =
    opts?.assignment === undefined
      ? { teacherProfileId: MY_TP, classSectionId: CLASS }
      : opts.assignment;

  const exportsSvc = {
    enqueueTeacherGradeGrid: jest.fn().mockResolvedValue({
      id: JOB,
      kind: 'grades_xlsx',
      status: 'pending',
      fileName: 'Notes_2026.xlsx',
      fileSizeBytes: null,
      classSectionId: CLASS,
      termId: TERM,
      createdAt: '2026-06-05T00:00:00.000Z',
      finishedAt: null,
    }),
    listForTeacher: jest.fn().mockResolvedValue({
      data: [
        {
          id: JOB,
          kind: 'grades_xlsx',
          status: 'succeeded',
          fileName: 'Notes_2026.xlsx',
          fileSizeBytes: 9876,
          classSectionId: CLASS,
          termId: TERM,
          createdAt: '2026-06-05T00:00:00.000Z',
          finishedAt: '2026-06-05T00:01:00.000Z',
        },
      ],
      total: 1,
    }),
    findOneForTeacher: jest.fn().mockResolvedValue({
      id: JOB,
      kind: 'grades_xlsx',
      status: 'succeeded',
      fileName: 'Notes_2026.xlsx',
      fileSizeBytes: 9876,
      classSectionId: CLASS,
      termId: TERM,
      createdAt: '2026-06-05T00:00:00.000Z',
      finishedAt: '2026-06-05T00:01:00.000Z',
    }),
    signedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/xlsx'),
  };
  const users = {
    ensureUser: jest.fn().mockResolvedValue({ id: ME, tenantId: TENANT }),
  };
  const prisma = {
    teachingAssignment: {
      findFirst: jest
        .fn()
        .mockResolvedValue(assignment ? { id: TA, ...assignment } : null),
    },
  } as unknown as PrismaService;
  const teachers = {
    ensureForUser: jest.fn().mockResolvedValue({ id: MY_TP, tenantId: TENANT }),
  } as unknown as TeacherProfileService;

  const controller = new TeacherExportsController(
    exportsSvc as unknown as ExportsService,
    users as unknown as UserSyncService,
    prisma,
    teachers,
  );
  return { controller, exportsSvc, users, prisma, teachers };
}

describe('TeacherExportsController — teaching-assignment ABAC + ownership scoping', () => {
  it('enqueues a grade-grid for an OWNED assignment with a SERVER-derived classSectionId', async () => {
    const { controller, exportsSvc } = makeController();

    const res = await controller.createGradeGrid(jwtWithRoles(['teacher']), {
      teachingAssignmentId: TA,
      termId: TERM,
    });

    // The classSectionId passed to the service is the one read off the OWNED
    // assignment — NOT anything the client supplied (the DTO has no classSectionId).
    expect(exportsSvc.enqueueTeacherGradeGrid).toHaveBeenCalledTimes(1);
    expect(exportsSvc.enqueueTeacherGradeGrid).toHaveBeenCalledWith({
      tenantId: TENANT,
      teacherUserProfileId: ME,
      teachingAssignmentId: TA,
      classSectionId: CLASS,
      termId: TERM,
      // Mirrors the parent surface: null lets the server-derived classSectionId
      // scope the generator (no cross-school silent-empty grid).
      schoolIdFallback: null,
      actorRole: 'teacher',
      portal: 'teacher',
    });
    // DTO-shape guard: the teacher surface carries top-level classSectionId/termId
    // (the gradebook maps jobs to class × term rows via these).
    expect(res).toMatchObject({
      id: JOB,
      kind: 'grades_xlsx',
      status: 'pending',
      classSectionId: CLASS,
      termId: TERM,
    });
  });

  it('rejects a grade-grid for an assignment the caller does NOT teach (403) and enqueues nothing', async () => {
    const { controller, exportsSvc } = makeController({
      assignment: { teacherProfileId: 'tp-OTHER', classSectionId: CLASS },
    });

    await expect(
      controller.createGradeGrid(jwtWithRoles(['teacher']), { teachingAssignmentId: TA }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(exportsSvc.enqueueTeacherGradeGrid).not.toHaveBeenCalled();
  });

  it('404s an unknown / cross-tenant teachingAssignmentId (no existence leak)', async () => {
    const { controller, exportsSvc } = makeController({ assignment: null });

    await expect(
      controller.createGradeGrid(jwtWithRoles(['teacher']), { teachingAssignmentId: TA }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(exportsSvc.enqueueTeacherGradeGrid).not.toHaveBeenCalled();
  });

  it('list scopes to requestedBy = me and emits top-level classSectionId/termId', async () => {
    const { controller, exportsSvc } = makeController();

    const res = await controller.list(jwtWithRoles(['teacher']), undefined, 20, 0);

    expect(exportsSvc.listForTeacher).toHaveBeenCalledWith({
      tenantId: TENANT,
      requestedBy: ME,
      classSectionId: undefined,
      limit: 20,
      offset: 0,
    });
    expect(res.data[0]).toMatchObject({
      id: JOB,
      kind: 'grades_xlsx',
      classSectionId: CLASS,
      termId: TERM,
    });
  });

  it('findOne re-checks ownership (requestedBy = me)', async () => {
    const { controller, exportsSvc } = makeController();

    await controller.findOne(jwtWithRoles(['teacher']), JOB);

    expect(exportsSvc.findOneForTeacher).toHaveBeenCalledWith({
      id: JOB,
      tenantId: TENANT,
      requestedBy: ME,
    });
  });

  it('download re-checks ownership and returns a 1h signed URL', async () => {
    const { controller, exportsSvc } = makeController();

    const res = await controller.download(jwtWithRoles(['teacher']), JOB);

    expect(exportsSvc.signedDownloadUrl).toHaveBeenCalledWith({
      id: JOB,
      tenantId: TENANT,
      requestedBy: ME,
    });
    expect(res).toEqual({ url: 'https://signed.example/xlsx', expiresInSec: 3600 });
  });
});
