import { ForbiddenException } from '@nestjs/common';

import { ParentExportsController } from './parent-exports.controller';
import type { ExportsService } from '../exports/exports.service';
import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { SchoolContextService } from '../school-structure/school-context.service';
import type { StudentAccessService } from '../students/student-access.service';

// Load-bearing seams for E4-S2 (children's-data export, P1 [auth]):
//   1. enqueue is gated by guardianship ABAC (403 for a non-guardianed child),
//      and the parent NEVER supplies classSectionId — only {studentId, termId}.
//   2. every read/download is re-scoped to requestedBy = me.id (anti cross-parent
//      IDOR within the same tenant), and the parent list is report_card_pdf-only.
// These are the exact properties the pre-mortem flagged as data-leak / IDOR.

const TENANT = 't1';
const ME = 'parent-1';
const STUDENT = 'student-A';
const TERM = 'term-1';
const JOB = 'job-1';

function jwtWithRoles(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-sub', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

function makeController(opts?: { canAccess?: boolean }) {
  const exportsSvc = {
    // The parent paths return the NARROW parent DTO: top-level termId/studentId
    // (hoisted from job parameters) so the response matches ParentExportJobSchema.
    enqueueParentBulletin: jest.fn().mockResolvedValue({
      id: JOB,
      kind: 'report_card_pdf',
      status: 'pending',
      fileName: 'Bulletins_2026.pdf',
      fileSizeBytes: null,
      termId: TERM,
      studentId: STUDENT,
      createdAt: '2026-06-05T00:00:00.000Z',
      finishedAt: null,
    }),
    listForParent: jest.fn().mockResolvedValue({
      data: [
        {
          id: JOB,
          kind: 'report_card_pdf',
          status: 'succeeded',
          fileName: 'Bulletins_2026.pdf',
          fileSizeBytes: 12345,
          termId: TERM,
          studentId: STUDENT,
          createdAt: '2026-06-05T00:00:00.000Z',
          finishedAt: '2026-06-05T00:01:00.000Z',
        },
      ],
      total: 1,
    }),
    findOneForParent: jest.fn().mockResolvedValue({
      id: JOB,
      kind: 'report_card_pdf',
      status: 'succeeded',
      fileName: 'Bulletins_2026.pdf',
      fileSizeBytes: 12345,
      termId: TERM,
      studentId: STUDENT,
      createdAt: '2026-06-05T00:00:00.000Z',
      finishedAt: '2026-06-05T00:01:00.000Z',
    }),
    signedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/pdf'),
  };
  const users = {
    ensureUser: jest.fn().mockResolvedValue({ id: ME, tenantId: TENANT }),
  };
  const ctx = {
    forUser: jest.fn().mockResolvedValue({ schoolId: 'school-1' }),
  } as unknown as SchoolContextService;
  const studentAccess = {
    canAccessStudent: jest.fn().mockResolvedValue(opts?.canAccess ?? true),
  } as unknown as StudentAccessService;
  const controller = new ParentExportsController(
    exportsSvc as unknown as ExportsService,
    users as unknown as UserSyncService,
    ctx,
    studentAccess,
  );
  return { controller, exportsSvc, users, ctx, studentAccess };
}

describe('ParentExportsController — guardianship ABAC + ownership scoping', () => {
  it('enqueues a bulletin for a guardianed child with server-side {studentId, termId} only', async () => {
    const { controller, exportsSvc, studentAccess } = makeController({ canAccess: true });

    const res = await controller.createBulletin(jwtWithRoles(['parent']), {
      studentId: STUDENT,
      termId: TERM,
    });

    expect(studentAccess.canAccessStudent).toHaveBeenCalledWith(
      { id: ME, tenantId: TENANT },
      expect.anything(),
      STUDENT,
      'school-1',
    );
    expect(exportsSvc.enqueueParentBulletin).toHaveBeenCalledTimes(1);
    expect(exportsSvc.enqueueParentBulletin).toHaveBeenCalledWith({
      tenantId: TENANT,
      parentProfileId: ME,
      studentId: STUDENT,
      termId: TERM,
      actorRole: 'parent',
      portal: 'parent',
    });
    // DTO-shape guard: the parent surface MUST carry top-level termId/studentId
    // (the page maps jobs to term rows via j.termId / j.studentId — the blocker
    // was that the generic toDto only nested them under `parameters`).
    expect(res).toMatchObject({
      id: JOB,
      kind: 'report_card_pdf',
      status: 'pending',
      termId: TERM,
      studentId: STUDENT,
    });
  });

  it('rejects a bulletin for a non-guardianed child (403) and enqueues nothing', async () => {
    const { controller, exportsSvc } = makeController({ canAccess: false });

    await expect(
      controller.createBulletin(jwtWithRoles(['parent']), { studentId: STUDENT, termId: TERM }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(exportsSvc.enqueueParentBulletin).not.toHaveBeenCalled();
  });

  it('list scopes to requestedBy = me and emits top-level termId/studentId', async () => {
    const { controller, exportsSvc } = makeController();

    const res = await controller.list(jwtWithRoles(['parent']), 20, 0);

    expect(exportsSvc.listForParent).toHaveBeenCalledWith({
      tenantId: TENANT,
      requestedBy: ME,
      limit: 20,
      offset: 0,
    });
    // DTO-shape guard on the list path: each item carries top-level termId/
    // studentId (the parent page filters `data` by these to map term rows).
    expect(res.data[0]).toMatchObject({
      id: JOB,
      kind: 'report_card_pdf',
      termId: TERM,
      studentId: STUDENT,
    });
  });

  it('findOne re-checks ownership (requestedBy = me)', async () => {
    const { controller, exportsSvc } = makeController();

    await controller.findOne(jwtWithRoles(['parent']), JOB);

    expect(exportsSvc.findOneForParent).toHaveBeenCalledWith({
      id: JOB,
      tenantId: TENANT,
      requestedBy: ME,
    });
  });

  it('download re-checks ownership and returns a 1h signed URL', async () => {
    const { controller, exportsSvc } = makeController();

    const res = await controller.download(jwtWithRoles(['parent']), JOB);

    expect(exportsSvc.signedDownloadUrl).toHaveBeenCalledWith({
      id: JOB,
      tenantId: TENANT,
      requestedBy: ME,
    });
    expect(res).toEqual({ url: 'https://signed.example/pdf', expiresInSec: 3600 });
  });
});
