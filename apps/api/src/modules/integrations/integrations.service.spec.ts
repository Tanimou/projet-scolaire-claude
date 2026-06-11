import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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

function makeService(opts: { created?: Record<string, unknown>; found?: unknown } = {}) {
  const createdRows: Record<string, unknown>[] = [];
  let importRowCount = 0;
  const prisma = {
    rosterSource: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const row = sourceRow({ ...data, ...(opts.created ?? {}) });
        return Promise.resolve(row);
      }),
      findUnique: jest.fn().mockResolvedValue(opts.found === undefined ? sourceRow() : opts.found),
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
    },
    importRow: {
      createMany: jest.fn().mockImplementation(({ data }: { data: unknown[] }) => {
        importRowCount += data.length;
        return Promise.resolve({ count: data.length });
      }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const ctx = {
    forTenant: jest.fn().mockResolvedValue({ tenantId: TENANT, schoolId: SCHOOL, activeAcademicYearId: 'ay-1' }),
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
    const auditAfter = (prisma.auditLog.create as jest.Mock).mock.calls[0]![0].data.after;
    expect(JSON.stringify(auditAfter)).not.toContain(RAW_CREDENTIAL);
    expect(auditAfter.hasCredential).toBe(true);
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

describe('IntegrationsService — tenant wall (404-before-403)', () => {
  it('sync on a cross-tenant source id throws (never leaks the row)', async () => {
    // The source belongs to OTHER_TENANT; our actor is TENANT.
    const { service } = makeService({ found: sourceRow({ tenantId: OTHER_TENANT }) });
    await expect(
      service.sync('src-1', ACTOR, { users: 'sourcedId,role,givenName,familyName\nx,student,A,B' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sync on a missing source id throws 404', async () => {
    const { service } = makeService({ found: null });
    await expect(service.sync('nope', ACTOR, { users: '' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getOne on a cross-tenant source id throws', async () => {
    const { service } = makeService({ found: sourceRow({ tenantId: OTHER_TENANT }) });
    await expect(service.getOne('src-1', ACTOR.tenantId)).rejects.toBeInstanceOf(ForbiddenException);
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
});

describe('IntegrationsService — REST kind is config-only in v1', () => {
  it('sync on a oneroster_rest source rejects (CSV-bundle is the working path)', async () => {
    const { service, prisma } = makeService({ found: sourceRow({ kind: RosterSourceKind.oneroster_rest }) });
    await expect(service.sync('src-1', ACTOR, { users: '' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.importBatch.create).not.toHaveBeenCalled();
  });
});
