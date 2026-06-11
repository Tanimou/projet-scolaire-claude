import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RosterSourceKind, RosterSyncStatus } from '@prisma/client';

import { IntegrationsService } from './integrations.service';
import { ONEROSTER_MAX_ROWS } from './oneroster.adapter';

/**
 * E11-S3 (Murat P0) — the service-level Sentinel / tenant / MAX_ROWS guards that
 * the pure `oneroster.adapter.spec.ts` cannot cover.
 *
 *  AC-3 (Sentinel) — no response body from connect/list/getOne ever contains
 *    `credentialRef` or the raw credential; the DTO exposes only
 *    `hasCredential: boolean`; the stored value is never the raw input.
 *  AC-6 (403 wall / 404 cross-tenant / MAX_ROWS) — a cross-tenant source id on
 *    sync gets 404-before-403 (tenant-scoped load); an over-cap mapped pull is
 *    rejected with a 400 BEFORE any ImportBatch row is created, leaving the
 *    source `failed` (never a corrupt apply).
 */

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const SCHOOL = 'school-1';
const ACTOR = { id: 'admin-up-1', tenantId: TENANT };
const RAW_CREDENTIAL = 'super-secret-bearer-token-1234567890';

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'src-1',
    tenantId: TENANT,
    schoolId: SCHOOL,
    kind: RosterSourceKind.oneroster_csv,
    label: 'Mon SIS',
    baseUrl: null,
    credentialRef: null,
    status: RosterSyncStatus.idle,
    lastSyncAt: null,
    lastBatchId: null,
    lastError: null,
    createdBy: ACTOR.id,
    createdAt: new Date('2026-06-11T10:00:00.000Z'),
    updatedAt: new Date('2026-06-11T10:00:00.000Z'),
    ...overrides,
  };
}

function makeService(
  opts: {
    created?: Record<string, unknown>;
    found?: unknown;
    managedStudents?: unknown[];
    /** Override the school `ctx.forTenant` resolves (to prove the batch follows the SOURCE, not the actor). */
    ctxSchoolId?: string;
  } = {},
) {
  const createdRows: Record<string, unknown>[] = [];
  let importRowCount = 0;
  // The row the DB holds for this id (defaults to a TENANT-owned source).
  const foundRow = opts.found === undefined ? sourceRow() : opts.found;
  const prisma = {
    rosterSource: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const row = sourceRow({ ...data, ...(opts.created ?? {}) });
        return Promise.resolve(row);
      }),
      // `requireSource` loads tenant-scoped via `findFirst({ where: { id, tenantId } })`.
      // The mock HONOURS the `tenantId` predicate (the wall is the query, not a
      // post-fetch branch): a row whose tenantId mismatches the where-clause is
      // INVISIBLE → null → 404, exactly as Postgres would return.
      findFirst: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if (!foundRow) return Promise.resolve(null);
        const row = foundRow as Record<string, unknown>;
        if (where.tenantId !== undefined && row.tenantId !== where.tenantId) return Promise.resolve(null);
        return Promise.resolve(row);
      }),
      findMany: jest.fn().mockResolvedValue([sourceRow({ credentialRef: 'vault:abc:def:xyz' })]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    importBatch: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `batch-${createdRows.length + 1}`, ...data };
        createdRows.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn().mockResolvedValue({}),
      // E11-S4 — the divergence compute re-reads the students batch summary.
      findFirst: jest.fn().mockResolvedValue({ summary: { totalRows: 0 } }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    importRow: {
      createMany: jest.fn().mockImplementation(({ data }: { data: unknown[] }) => {
        importRowCount += data.length;
        return Promise.resolve({ count: data.length });
      }),
    },
    // `buildImportCaches` reads (a successful sync builds the lookup caches ONCE).
    // The divergence compute additionally reads the externalRef-carrying students.
    gradeLevel: { findMany: jest.fn().mockResolvedValue([]) },
    subject: { findMany: jest.fn().mockResolvedValue([]) },
    classSection: { findMany: jest.fn().mockResolvedValue([]) },
    guardian: { findMany: jest.fn().mockResolvedValue([]) },
    academicYear: { findFirst: jest.fn().mockResolvedValue(null) },
    // E11-S4 (FR3/AC-3) — the SIS-delete divergence reads the school's
    // externalRef-carrying students. `buildImportCaches` also reads students
    // (no externalRef filter); we return the managed set for both — the
    // divergence query is the one that filters on externalRef.
    student: {
      findMany: jest.fn().mockResolvedValue(opts.managedStudents ?? []),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const ctx = {
    // `sync` now calls `forTenant(tenantId, source.schoolId)`. We echo back the
    // 2nd-arg school when present so the mock can't silently mask a wrong school;
    // `ctxSchoolId` lets a test make the resolved school DIFFER from the source.
    forTenant: jest.fn().mockImplementation((tenantId: string, explicitSchoolId?: string) =>
      Promise.resolve({
        tenantId,
        schoolId: opts.ctxSchoolId ?? explicitSchoolId ?? SCHOOL,
        activeAcademicYearId: 'ay-1',
      }),
    ),
  };
  const service = new IntegrationsService(prisma as never, ctx as never);
  return {
    service,
    prisma,
    get batchesCreated() {
      return createdRows.length;
    },
    get importRowsCreated() {
      return importRowCount;
    },
  };
}

describe('IntegrationsService — credential handling (Sentinel)', () => {
  it('connect never returns credentialRef and never stores the raw credential', async () => {
    const { service, prisma } = makeService();

    const dto = await service.connect(ACTOR, {
      kind: RosterSourceKind.oneroster_rest,
      label: 'REST source',
      baseUrl: 'https://sis.example.org',
      credential: RAW_CREDENTIAL,
    });

    // The DTO exposes only presence, never the value, never the ref column.
    expect(dto).not.toHaveProperty('credentialRef');
    expect(dto).not.toHaveProperty('credential');
    expect(JSON.stringify(dto)).not.toContain(RAW_CREDENTIAL);
    expect(dto.hasCredential).toBe(true);

    // The stored column is an opaque ref, NEVER the raw plaintext.
    const stored = (prisma.rosterSource.create as jest.Mock).mock.calls[0]![0].data.credentialRef as string;
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(RAW_CREDENTIAL);
    expect(stored).not.toBe(RAW_CREDENTIAL);

    // The audit `after` records presence only — never the secret.
    const auditData = (prisma.auditLog.create as jest.Mock).mock.calls[0]![0].data;
    const auditAfter = auditData.after;
    expect(JSON.stringify(auditAfter)).not.toContain(RAW_CREDENTIAL);
    expect(auditAfter.hasCredential).toBe(true);

    // The connect audit action is the ADR-024/spec-mandated name (not the old
    // implemented `import.sync.connect`) — append-only audit semantics preserved.
    expect(auditData.action).toBe('integration.roster_source.created');
    expect(auditData.resourceType).toBe('roster_source');
  });

  it('CSV-bundle source stores no credential (hasCredential=false)', async () => {
    const { service } = makeService();
    const dto = await service.connect(ACTOR, {
      kind: RosterSourceKind.oneroster_csv,
      label: 'CSV bundle',
    });
    expect(dto.hasCredential).toBe(false);
    expect(dto).not.toHaveProperty('credentialRef');
  });

  it('list strips credentialRef from every projected row', async () => {
    const { service } = makeService();
    const rows = await service.list(TENANT);
    for (const r of rows) {
      expect(r).not.toHaveProperty('credentialRef');
      expect(r.hasCredential).toBe(true); // presence preserved, value stripped
    }
  });
});

describe('IntegrationsService — tenant wall (404, no cross-tenant existence oracle)', () => {
  it('sync on a cross-tenant source id throws 404 (NOT 403) — and takes NO lifecycle side-effect', async () => {
    // The source belongs to OTHER_TENANT; our actor is TENANT. The tenant-scoped
    // `findFirst({ id, tenantId })` returns null → 404, indistinguishable from a
    // missing id (the existence oracle a 403-vs-404 used to leak is closed).
    const { service, prisma } = makeService({ found: sourceRow({ tenantId: OTHER_TENANT }) });
    await expect(
      service.sync('src-1', ACTOR, { users: 'sourcedId,role,givenName,familyName\nx,student,A,B' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // The scope is in the query (defence-in-depth), not a post-fetch branch.
    expect(prisma.rosterSource.findFirst).toHaveBeenCalledWith({ where: { id: 'src-1', tenantId: TENANT } });
    // No side-effect on a foreign id: the `pulling` lifecycle write never fires.
    const pullingWrite = (prisma.rosterSource.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data?.status === RosterSyncStatus.pulling,
    );
    expect(pullingWrite).toBeUndefined();
  });

  it('sync on a missing source id throws 404', async () => {
    const { service } = makeService({ found: null });
    await expect(service.sync('nope', ACTOR, { users: '' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getOne on a cross-tenant source id throws 404 (NOT 403)', async () => {
    const { service } = makeService({ found: sourceRow({ tenantId: OTHER_TENANT }) });
    await expect(service.getOne('src-1', ACTOR.tenantId)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('IntegrationsService — MAX_ROWS over-cap (pre-commit rejection)', () => {
  it('rejects an over-cap pull with 400 BEFORE any batch/row is created, source → failed', async () => {
    const { service, prisma } = makeService();

    // Build a users.csv with MAX_ROWS + 1 student rows.
    const header = 'sourcedId,role,givenName,familyName';
    const lines = [header];
    for (let i = 0; i <= ONEROSTER_MAX_ROWS; i++) {
      lines.push(`stu-${i},student,First${i},Last${i}`);
    }
    const users = lines.join('\n');

    await expect(service.sync('src-1', ACTOR, { users })).rejects.toBeInstanceOf(BadRequestException);

    // No corrupt batch: not a single ImportBatch or ImportRow was created.
    expect(prisma.importBatch.create).not.toHaveBeenCalled();
    expect(prisma.importRow.createMany).not.toHaveBeenCalled();

    // The source is flipped to `failed` (pulling → failed), never left `mapped`.
    const failingUpdate = (prisma.rosterSource.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data?.status === RosterSyncStatus.failed,
    );
    expect(failingUpdate).toBeDefined();
  });

  it('rejects an empty bundle as a failed pull (no batch created)', async () => {
    const { service, prisma } = makeService();
    await expect(service.sync('src-1', ACTOR, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.importBatch.create).not.toHaveBeenCalled();
    const failingUpdate = (prisma.rosterSource.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data?.status === RosterSyncStatus.failed,
    );
    expect(failingUpdate).toBeDefined();
  });

  it('rejects a COMBINED over-cap pull (each type under, sum over) BEFORE any batch, source → failed', async () => {
    // Two types EACH just over half the cap → each passes the per-type guard,
    // but their COMBINED total exceeds ONEROSTER_MAX_ROWS → reject (FR-3).
    const half = Math.floor(ONEROSTER_MAX_ROWS / 2) + 1;

    const userHeader = 'sourcedId,role,givenName,familyName';
    const userLines = [userHeader];
    for (let i = 0; i < half; i++) userLines.push(`stu-${i},student,First${i},Last${i}`);

    // classes need BOTH a title AND a grades column to map (adapter requirement).
    const classHeader = 'sourcedId,title,grades';
    const classLines = [classHeader];
    for (let i = 0; i < half; i++) classLines.push(`cls-${i},Classe ${i},6`);

    const { service, prisma } = makeService();
    await expect(
      service.sync('src-1', ACTOR, { users: userLines.join('\n'), classes: classLines.join('\n') }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // No corrupt batch: the combined guard runs in the SAME pre-commit window.
    expect(prisma.importBatch.create).not.toHaveBeenCalled();
    expect(prisma.importRow.createMany).not.toHaveBeenCalled();

    const failingUpdate = (prisma.rosterSource.updateMany as jest.Mock).mock.calls.find(
      (c) => c[0].data?.status === RosterSyncStatus.failed,
    );
    expect(failingUpdate).toBeDefined();
  });
});

describe('IntegrationsService — batch is filed under the SOURCE school (FR10 multi-school)', () => {
  it('files every produced ImportBatch under source.schoolId, not the actor active school', async () => {
    // The source lives in school-1; the actor's active school resolves to a
    // DIFFERENT school. The batch (and its caches/divergence scope) MUST follow
    // the source, never the actor — a school-A roster can't mis-file into school-B.
    const SOURCE_SCHOOL = 'school-1';
    const ACTOR_ACTIVE_SCHOOL = 'school-OTHER';
    const { service, prisma } = makeService({
      found: sourceRow({ schoolId: SOURCE_SCHOOL }),
      ctxSchoolId: ACTOR_ACTIVE_SCHOOL, // forTenter would resolve the WRONG school
    });

    const res = await service.sync('src-1', ACTOR, {
      users: 'sourcedId,role,givenName,familyName\nEL-1,student,Léa,Martin',
    });
    expect(res.primaryBatchId).toBeTruthy();

    // Every batch is filed under the SOURCE's school, never the actor's active one.
    const createCalls = (prisma.importBatch.create as jest.Mock).mock.calls;
    expect(createCalls.length).toBeGreaterThan(0);
    for (const call of createCalls) {
      expect(call[0].data.schoolId).toBe(SOURCE_SCHOOL);
      expect(call[0].data.schoolId).not.toBe(ACTOR_ACTIVE_SCHOOL);
    }

    // The school context is resolved for the SOURCE's school (so the active year
    // + caches match the batch school) — not the actor's bare default.
    expect((prisma.student.findMany as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ schoolId: SOURCE_SCHOOL }) }),
    );
  });
});

describe('IntegrationsService — SIS-side delete divergence (E11-S4 FR3/AC-3, the R6 wall)', () => {
  // One student in the pull (EL-1), one managed student absent from it (EL-GONE).
  const PULL_USERS = [
    'sourcedId,role,givenName,familyName',
    'EL-1,student,Léa,Martin',
  ].join('\n');

  it('surfaces a managed student absent from the pull as `absentFromSource` — and NEVER deletes it', async () => {
    const { service, prisma } = makeService({
      managedStudents: [
        { externalRef: 'EL-1', firstName: 'Léa', lastName: 'Martin' }, // still in source
        { externalRef: 'EL-GONE', firstName: 'Tom', lastName: 'Bernard' }, // absent → advisory
      ],
    });

    const res = await service.sync('src-1', ACTOR, { users: PULL_USERS });

    // The absent student is surfaced (read-only, reviewable), the present one is not.
    expect(res.absentFromSource).toEqual([{ externalRef: 'EL-GONE', name: 'Tom Bernard' }]);

    // R6 — there is NO delete path: the student is only READ, never removed.
    expect((prisma.student as Record<string, jest.Mock>).deleteMany).toBeUndefined();
    expect((prisma.student as Record<string, jest.Mock>).delete).toBeUndefined();

    // The advisory is stamped onto the produced students batch summary for the panel.
    const stamped = (prisma.importBatch.updateMany as jest.Mock).mock.calls.find(
      (c) => Array.isArray(c[0].data?.summary?.absentFromSource),
    );
    expect(stamped).toBeDefined();
    expect(stamped![0].data.summary.absentFromSource).toEqual([
      { externalRef: 'EL-GONE', name: 'Tom Bernard' },
    ]);
  });

  it('no managed student absent → empty advisory, no batch summary stamp', async () => {
    const { service, prisma } = makeService({
      managedStudents: [{ externalRef: 'EL-1', firstName: 'Léa', lastName: 'Martin' }],
    });

    const res = await service.sync('src-1', ACTOR, { users: PULL_USERS });

    expect(res.absentFromSource).toEqual([]);
    const stamped = (prisma.importBatch.updateMany as jest.Mock).mock.calls.find(
      (c) => Array.isArray(c[0].data?.summary?.absentFromSource),
    );
    expect(stamped).toBeUndefined();
  });

  it('a divergence-compute failure never fails the sync (best-effort, non-destructive)', async () => {
    const { service, prisma } = makeService({
      // An ABSENT student → the helper proceeds to stamp the batch summary, where
      // we inject the failure (importBatch.findFirst is ONLY called by the helper).
      managedStudents: [{ externalRef: 'EL-GONE', firstName: 'Tom', lastName: 'Bernard' }],
    });
    (prisma.importBatch.findFirst as jest.Mock).mockRejectedValueOnce(new Error('db blip'));

    // The sync still succeeds; the advisory degrades to [] rather than throwing.
    const res = await service.sync('src-1', ACTOR, { users: PULL_USERS });
    expect(res.absentFromSource).toEqual([]);
    expect(res.primaryBatchId).toBeTruthy();
  });
});

describe('IntegrationsService — REST kind is config-only in v1', () => {
  it('sync on a oneroster_rest source rejects (CSV-bundle is the working path)', async () => {
    const { service, prisma } = makeService({ found: sourceRow({ kind: RosterSourceKind.oneroster_rest }) });
    await expect(service.sync('src-1', ACTOR, { users: '' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.importBatch.create).not.toHaveBeenCalled();
  });
});
