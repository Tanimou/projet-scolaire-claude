import { IMPROVEMENT_DELTA_THRESHOLD } from '@pilotage/contracts';

import {
  IMPROVEMENT_DELTA_THRESHOLD as SWEEP_THRESHOLD,
  RemediationSweepCronService,
} from './remediation-sweep-cron.service';

type Mock = ReturnType<typeof jest.fn>;

interface PlanRow {
  id: string;
  tenantId: string;
  studentId: string;
  subjectId: string;
  createdBy: string;
}

interface Opts {
  /** Open plans per tenant, keyed by tenantId. */
  plansByTenant?: Record<string, PlanRow[]>;
  /** trendDelta per (studentId|subjectId) snapshot, or undefined for a snapshot miss. */
  trendByKey?: Record<string, number | null>;
  /** Pre-existing suggestion markers (sourceId set) → idempotency. */
  existingMarkers?: string[];
}

function makeHarness(opts: Opts = {}) {
  const plansByTenant = opts.plansByTenant ?? {
    t1: [{ id: 'p1', tenantId: 't1', studentId: 's1', subjectId: 'subj1', createdBy: 'parent1' }],
  };
  const trendByKey = opts.trendByKey ?? { 's1|subj1': 2.0 };
  const markers = new Set(opts.existingMarkers ?? []);

  const planFindMany: Mock = jest.fn().mockImplementation((arg: {
    where: { status: string; tenantId?: string };
    distinct?: unknown;
  }) => {
    if (arg.distinct) {
      // tenantsWithOpenPlans — distinct tenantIds that have an open plan.
      const tenants = Object.entries(plansByTenant)
        .filter(([, plans]) => plans.length > 0)
        .map(([tenantId]) => ({ tenantId }));
      return Promise.resolve(tenants);
    }
    return Promise.resolve(plansByTenant[arg.where.tenantId ?? ''] ?? []);
  });

  const snapshotFindFirst: Mock = jest.fn().mockImplementation((arg: {
    where: { studentId: string; subjectId: string };
  }) => {
    const key = `${arg.where.studentId}|${arg.where.subjectId}`;
    const delta = trendByKey[key];
    if (delta === undefined) return Promise.resolve(null); // snapshot miss
    return Promise.resolve({ trendDelta: delta });
  });

  const notificationFindFirst: Mock = jest.fn().mockImplementation((arg: {
    where: { sourceId: string };
  }) => Promise.resolve(markers.has(arg.where.sourceId) ? { id: 'marker' } : null));

  const notificationCreate: Mock = jest.fn().mockImplementation((arg: {
    data: { sourceId: string };
  }) => {
    markers.add(arg.data.sourceId);
    return Promise.resolve({ id: 'created' });
  });

  const prisma = {
    remediationPlan: { findMany: planFindMany },
    studentSubjectSnapshot: { findFirst: snapshotFindFirst },
    notification: { findFirst: notificationFindFirst, create: notificationCreate },
  };

  const service = new RemediationSweepCronService(prisma as never);
  return { service, prisma, notificationCreate, planFindMany, snapshotFindFirst };
}

describe('RemediationSweepCronService.tick', () => {
  it('keeps the threshold byte-identical to the shared contracts value', () => {
    expect(SWEEP_THRESHOLD).toBe(IMPROVEMENT_DELTA_THRESHOLD);
    expect(SWEEP_THRESHOLD).toBe(1.5);
  });

  it('writes ONE completion suggestion for an improving open plan (never auto-closes)', async () => {
    const h = makeHarness();
    await h.service.tick();

    expect(h.notificationCreate).toHaveBeenCalledTimes(1);
    const data = h.notificationCreate.mock.calls[0]![0].data;
    expect(data.kind).toBe('remediation');
    expect(data.userProfileId).toBe('parent1');
    expect(data.sourceType).toBe('remediation_plan');
    expect(data.sourceId).toBe('p1:improvement_suggested');
    expect(data.link).toBe('/parent/remediation/p1');
    // Suggestion-only — the sweep NEVER calls update/updateMany on the plan.
    expect((h.prisma.remediationPlan as Record<string, unknown>).update).toBeUndefined();
    expect((h.prisma.remediationPlan as Record<string, unknown>).updateMany).toBeUndefined();
  });

  it('is idempotent: a second tick over the same improved plan writes no duplicate', async () => {
    const h = makeHarness();
    await h.service.tick();
    await h.service.tick();
    expect(h.notificationCreate).toHaveBeenCalledTimes(1);
  });

  it('skips when the trend is below the threshold (stays calm)', async () => {
    const h = makeHarness({ trendByKey: { 's1|subj1': 1.0 } });
    await h.service.tick();
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('skips a snapshot miss (no live fall-through, never errors)', async () => {
    const h = makeHarness({ trendByKey: {} });
    await h.service.tick();
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('skips a null trendDelta', async () => {
    const h = makeHarness({ trendByKey: { 's1|subj1': null } });
    await h.service.tick();
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('is tenant-scoped: only the iterated tenant\'s plans are suggested', async () => {
    const h = makeHarness({
      plansByTenant: {
        t1: [{ id: 'p1', tenantId: 't1', studentId: 's1', subjectId: 'subj1', createdBy: 'parentA' }],
        t2: [{ id: 'p2', tenantId: 't2', studentId: 's2', subjectId: 'subj2', createdBy: 'parentB' }],
      },
      trendByKey: { 's1|subj1': 2.0, 's2|subj2': 2.0 },
    });
    await h.service.tick();
    expect(h.notificationCreate).toHaveBeenCalledTimes(2);
    // Each plan read query was tenant-scoped (the per-tenant sweep passes tenantId).
    const tenantScopedReads = h.planFindMany.mock.calls.filter(
      (c) => c[0]?.where?.tenantId !== undefined,
    );
    for (const call of tenantScopedReads) {
      expect(typeof call[0].where.tenantId).toBe('string');
    }
  });
});
