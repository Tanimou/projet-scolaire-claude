import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ChildClaimsService, type SubmitClaimArgs } from './child-claims.service';

const TENANT = 'tenant-1';
const SCHOOL = 'school-1';
const GUARDIAN = 'guardian-1';
const ACTOR = 'user-1';

/**
 * A no-op NotificationsService stub. The S1 parent paths never notify; the S2 admin
 * decisions notify best-effort AFTER commit (a throw is swallowed), so most tests pass
 * this default. The notify-failure / kind-assertion tests inject their own spy.
 */
function fakeNotifications(createMany: jest.Mock = jest.fn(async () => ({ created: 1 }))) {
  return { createMany };
}

/** Build the service with a prisma fake + an optional notifications stub. */
function mkSvc(prisma: unknown, notifications: unknown = fakeNotifications()) {
  return new ChildClaimsService(prisma as never, notifications as never);
}

function baseArgs(overrides: Partial<SubmitClaimArgs> = {}): SubmitClaimArgs {
  return {
    tenantId: TENANT,
    schoolId: SCHOOL,
    guardianId: GUARDIAN,
    actorId: ACTOR,
    firstName: 'Léa',
    lastName: 'Dupont',
    birthDate: '2012-04-05',
    relationship: 'mother',
    ...overrides,
  };
}

function studentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stu-1',
    firstName: 'Léa',
    lastName: 'Dûpont',
    birthDate: new Date('2012-04-05T00:00:00.000Z'),
    externalRef: null,
    ...overrides,
  };
}

/**
 * A minimal fake PrismaService. `studentRows` is the school roster the matcher
 * queries; `existingLink` is the guardianship the matched path finds. Records audit
 * + create calls so the assertions can pin "never active / never approvedBy".
 */
function fakePrisma(opts: {
  studentRows?: ReturnType<typeof studentRow>[];
  existingLink?: Record<string, unknown> | null;
  recentClaims?: number;
  openClaim?: Record<string, unknown> | null;
  createThrowsP2002?: boolean;
}) {
  const audits: Array<{ action: string; before: unknown; after: unknown }> = [];
  const createdClaims: Array<Record<string, unknown>> = [];
  const createdLinks: Array<Record<string, unknown>> = [];
  const updatedLinks: Array<Record<string, unknown>> = [];

  const tx = {
    guardianshipClaim: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdClaims.push(data);
        return { id: 'claim-new', ...data };
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    guardianship: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (opts.createThrowsP2002) {
          throw new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: '5.22.0',
            meta: { target: ['guardian_id', 'student_id'] },
          });
        }
        createdLinks.push(data);
        return { id: 'link-new', ...data };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updatedLinks.push(data);
        return { id: opts.existingLink?.id ?? 'link-x', ...data };
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audits.push({ action: data.action as string, before: data.before, after: data.after });
        return data;
      }),
    },
  };

  const prisma = {
    guardianshipClaim: {
      count: jest.fn(async () => opts.recentClaims ?? 0),
      findFirst: jest.fn(async () => opts.openClaim ?? null),
      create: tx.guardianshipClaim.create,
    },
    student: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        let rows = opts.studentRows ?? [];
        if (where.externalRef) rows = rows.filter((r) => r.externalRef === where.externalRef);
        if (where.birthDate) {
          const d = (where.birthDate as Date).toISOString().slice(0, 10);
          rows = rows.filter((r) => r.birthDate?.toISOString().slice(0, 10) === d);
        }
        return rows;
      }),
    },
    guardianship: {
      findUnique: jest.fn(async () => opts.existingLink ?? null),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  return { prisma, audits, createdClaims, createdLinks, updatedLinks, tx };
}

describe('ChildClaimsService.submitClaim — the no-oracle invariant (FR-3/AC-2)', () => {
  it('matched, no_match and ambiguous return a DEEP-EQUAL uniform `received` body', async () => {
    // matched (one roster hit on name+DOB)
    const a = fakePrisma({ studentRows: [studentRow()] });
    const svcA = mkSvc(a.prisma);
    const matched = await svcA.submitClaim(baseArgs());

    // no_match (empty roster)
    const b = fakePrisma({ studentRows: [] });
    const svcB = mkSvc(b.prisma);
    const noMatch = await svcB.submitClaim(baseArgs());

    // ambiguous (twins)
    const c = fakePrisma({ studentRows: [studentRow({ id: 'a' }), studentRow({ id: 'b' })] });
    const svcC = mkSvc(c.prisma);
    const ambiguous = await svcC.submitClaim(baseArgs());

    expect(matched).toEqual(noMatch);
    expect(noMatch).toEqual(ambiguous);
    expect(matched).toEqual({
      outcome: 'received',
      claimId: null,
      status: null,
      child: null,
      message: expect.any(String),
    });
  });

  it('name-only (no DOB, no ref) → match_failed body, no link, even with a roster hit', async () => {
    const f = fakePrisma({ studentRows: [studentRow()] });
    const svc = mkSvc(f.prisma);
    const res = await svc.submitClaim(baseArgs({ birthDate: undefined }));
    expect(res).toEqual({ outcome: 'received', claimId: null, status: null, child: null, message: expect.any(String) });
    expect(f.createdLinks).toHaveLength(0);
    expect(f.createdClaims[0]!.status).toBe('match_failed');
    expect(f.audits.map((x) => x.action)).toEqual(['guardianship.claim_match_failed']);
  });
});

describe('ChildClaimsService.submitClaim — matched path drives a PENDING link, never active (AC-1)', () => {
  it('creates one pending Guardianship + a submitted claim; never active, never approvedBy', async () => {
    const f = fakePrisma({ studentRows: [studentRow()] });
    const svc = mkSvc(f.prisma);
    await svc.submitClaim(baseArgs());

    expect(f.createdLinks).toHaveLength(1);
    expect(f.createdLinks[0]!.status).toBe('pending');
    expect(f.createdLinks[0]).not.toHaveProperty('approvedBy', expect.anything());
    expect(f.createdLinks[0]!.approvedBy).toBeUndefined();
    expect(f.createdLinks[0]!.approvedAt).toBeUndefined();
    expect(f.createdClaims[0]!.status).toBe('submitted');
    expect(f.createdClaims[0]!.matchedStudentId).toBe('stu-1');
    expect(f.audits.map((x) => x.action)).toEqual(['guardianship.claim_submitted']);
  });
});

describe('ChildClaimsService.submitClaim — idempotency / already-linked / race', () => {
  it("an already-ACTIVE link returns the caller's-own already_linked (never confirms another child)", async () => {
    const f = fakePrisma({
      studentRows: [studentRow()],
      existingLink: { id: 'link-1', status: 'active' },
    });
    const svc = mkSvc(f.prisma);
    const res = await svc.submitClaim(baseArgs());
    expect(res).toEqual({ outcome: 'already_linked', studentId: 'stu-1' });
    expect(f.createdClaims).toHaveLength(0);
    expect(f.createdLinks).toHaveLength(0);
  });

  it('an already-PENDING link with an open claim → uniform received, no duplicate row', async () => {
    const f = fakePrisma({
      studentRows: [studentRow()],
      existingLink: { id: 'link-1', status: 'pending' },
      openClaim: { id: 'claim-existing', status: 'submitted' },
    });
    const svc = mkSvc(f.prisma);
    const res = await svc.submitClaim(baseArgs());
    expect(res).toEqual({ outcome: 'received', claimId: null, status: null, child: null, message: expect.any(String) });
    expect(f.createdClaims).toHaveLength(0);
  });

  it('a revoked link is REUSED back to pending (revoked-reuse idiom)', async () => {
    const f = fakePrisma({
      studentRows: [studentRow()],
      existingLink: { id: 'link-1', status: 'revoked' },
    });
    const svc = mkSvc(f.prisma);
    await svc.submitClaim(baseArgs());
    expect(f.updatedLinks).toHaveLength(1);
    expect(f.updatedLinks[0]!.status).toBe('pending');
    expect(f.updatedLinks[0]!.approvedBy).toBeNull();
  });

  it('a concurrent double-submit hitting P2002 collapses to the uniform response (never a 500)', async () => {
    const f = fakePrisma({ studentRows: [studentRow()], createThrowsP2002: true });
    const svc = mkSvc(f.prisma);
    const res = await svc.submitClaim(baseArgs());
    expect(res).toEqual({ outcome: 'received', claimId: null, status: null, child: null, message: expect.any(String) });
  });
});

describe('ChildClaimsService.submitClaim — per-guardian rate-limit (AC-2)', () => {
  it('past the window cap → 429', async () => {
    const f = fakePrisma({ studentRows: [studentRow()], recentClaims: 5 });
    const svc = mkSvc(f.prisma);
    await expect(svc.submitClaim(baseArgs())).rejects.toBeInstanceOf(HttpException);
  });
});

describe('ChildClaimsService.listForGuardian — no oracle on the status read (FR-5)', () => {
  it('projects the matched child ONLY on an active link; never on submitted/match_failed', async () => {
    const findMany = jest.fn(async () => [
      {
        id: 'c1',
        status: 'submitted',
        relationship: 'mother',
        claimedFirstName: 'Léa',
        claimedLastName: 'Dupont',
        claimedDob: new Date('2012-04-05T00:00:00.000Z'),
        decisionReason: null,
        createdAt: new Date('2026-06-10T10:00:00.000Z'),
        updatedAt: new Date('2026-06-10T10:00:00.000Z'),
        guardianship: { status: 'pending' },
        student: { id: 'stu-1', firstName: 'Léa', lastName: 'Dupont' },
      },
      {
        id: 'c2',
        status: 'approved',
        relationship: 'father',
        claimedFirstName: 'Tom',
        claimedLastName: 'Martin',
        claimedDob: null,
        decisionReason: null,
        createdAt: new Date('2026-06-09T10:00:00.000Z'),
        updatedAt: new Date('2026-06-09T10:00:00.000Z'),
        guardianship: { status: 'active' },
        student: { id: 'stu-2', firstName: 'Tom', lastName: 'Martin' },
      },
    ]);
    const svc = mkSvc({ guardianshipClaim: { findMany } });
    const { claims } = await svc.listForGuardian({ tenantId: TENANT, guardianId: GUARDIAN });

    const pending = claims.find((c) => c.id === 'c1')!;
    const approved = claims.find((c) => c.id === 'c2')!;
    expect(pending.child).toBeNull(); // submitted/pending → no child echo
    expect(pending.claimedBirthDate).toBe('2012-04-05');
    expect(approved.child).toEqual({ studentId: 'stu-2', firstName: 'Tom', lastName: 'Martin' });
  });
});

describe('ChildClaimsService.withdraw — self-scoped, double-withdraw no-op', () => {
  it('returns false (→ controller 404) when no own claim matches the id', async () => {
    const svc = mkSvc({
      guardianshipClaim: { findFirst: jest.fn(async () => null) },
    });
    const ok = await svc.withdraw({ tenantId: TENANT, guardianId: GUARDIAN, actorId: ACTOR, claimId: 'nope' });
    expect(ok).toBe(false);
  });

  it('flips a submitted own claim to withdrawn + its pending link to revoked, audited', async () => {
    const auditCreate = jest.fn(async () => ({}));
    const claimUpdateMany = jest.fn(async () => ({ count: 1 }));
    const linkUpdateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      guardianshipClaim: {
        findFirst: jest.fn(async () => ({ id: 'c1', guardianshipId: 'link-1', status: 'submitted' })),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) =>
        fn({
          guardianshipClaim: { updateMany: claimUpdateMany },
          guardianship: { updateMany: linkUpdateMany },
          auditLog: { create: auditCreate },
        }),
      ),
    };
    const svc = mkSvc(prisma);
    const ok = await svc.withdraw({ tenantId: TENANT, guardianId: GUARDIAN, actorId: ACTOR, claimId: 'c1' });
    expect(ok).toBe(true);
    expect(claimUpdateMany).toHaveBeenCalled();
    // Withdraw must DECOUPLE the claim from its link (guardianshipId: null) so a later
    // re-claim of the same child can't collide on the @unique guardianshipId (P2002 swallow).
    expect(claimUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'withdrawn', guardianshipId: null }) }),
    );
    expect(linkUpdateMany).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalled();
  });
});

describe('ChildClaimsService.submitClaim — tenant + school scope is the cross-family wall (FR-2/§4)', () => {
  it('a same-name+DOB child in another SCHOOL (same tenant) → no match (no link, match_failed)', async () => {
    // The matcher itself never sees scope; the candidate FETCH is the only wall. Pin it:
    // make the fake assert exactly what the real SQL where-clause enforces.
    const f = fakePrisma({});
    f.prisma.student.findMany = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      expect(where.tenantId).toBe(TENANT); // every candidate fetch is tenant-scoped…
      expect(where.schoolId).toBe(SCHOOL); // …and school-scoped (the §4 cross-school wall).
      // The matching child lives in school-2, so the school-1 fetch returns nothing.
      return where.schoolId === SCHOOL ? [] : [studentRow({ id: 'other-school' })];
    });
    const svc = mkSvc(f.prisma);
    const res = await svc.submitClaim(baseArgs());
    expect(res).toEqual({ outcome: 'received', claimId: null, status: null, child: null, message: expect.any(String) });
    expect(f.createdLinks).toHaveLength(0); // deny-by-default: never grants across schools
    expect(f.createdClaims[0]!.status).toBe('match_failed');
  });
});

describe('ChildClaimsService.submitClaim — birthDate normalisation (non-form callers)', () => {
  it('a full-ISO datetime birthDate still matches the date-only roster row (drives a pending link)', async () => {
    const f = fakePrisma({ studentRows: [studentRow()] }); // stored 2012-04-05
    const svc = mkSvc(f.prisma);
    await svc.submitClaim(baseArgs({ birthDate: '2012-04-05T22:00:00.000Z' }));
    expect(f.createdLinks).toHaveLength(1);
    expect(f.createdLinks[0]!.status).toBe('pending');
    expect(f.createdClaims[0]!.status).toBe('submitted');
    // and the persisted claimedDob is normalised to the date portion
    expect((f.createdClaims[0]!.claimedDob as Date).toISOString().slice(0, 10)).toBe('2012-04-05');
  });
});

// ===========================================================================
// E9-S2 — Admin approval queue + atomic approve/reject + best-effort notify.
// ===========================================================================

/**
 * A flexible admin-path prisma fake. `claim` is what the initial findFirst loads;
 * `activeLink` backs the idempotent re-approve probe; `linkUpdateCount` /
 * `claimUpdateCount` drive the from-status-guarded updateMany results (count===0 →
 * the concurrent-loser 409). `guardian`/`student` back the post-commit notify lookup.
 */
function fakeAdminPrisma(opts: {
  claim?: Record<string, unknown> | null;
  activeLink?: Record<string, unknown> | null;
  linkUpdateCount?: number;
  claimUpdateCount?: number;
  guardian?: Record<string, unknown> | null;
  student?: Record<string, unknown> | null;
}) {
  const audits: Array<{ action: string; before: unknown; after: unknown; actorRole: unknown }> = [];
  const linkUpdates: Array<Record<string, unknown>> = [];
  const claimUpdates: Array<Record<string, unknown>> = [];

  const tx = {
    guardianship: {
      updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        linkUpdates.push(data);
        return { count: opts.linkUpdateCount ?? 1 };
      }),
    },
    guardianshipClaim: {
      updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        claimUpdates.push(data);
        return { count: opts.claimUpdateCount ?? 1 };
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audits.push({
          action: data.action as string,
          before: data.before,
          after: data.after,
          actorRole: data.actorRole,
        });
        return data;
      }),
    },
  };

  const prisma = {
    guardianshipClaim: {
      findFirst: jest.fn(async () => opts.claim ?? null),
    },
    guardianship: {
      findFirst: jest.fn(async () => opts.activeLink ?? null),
    },
    guardian: {
      findFirst: jest.fn(async () => opts.guardian ?? { userProfileId: 'parent-user-1' }),
    },
    student: {
      findFirst: jest.fn(async () => opts.student ?? { firstName: 'Léa' }),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  return { prisma, audits, linkUpdates, claimUpdates, tx };
}

const submittedClaim = (overrides: Record<string, unknown> = {}) => ({
  id: 'claim-1',
  tenantId: TENANT,
  status: 'submitted',
  guardianId: GUARDIAN,
  guardianshipId: 'link-1',
  matchedStudentId: 'stu-1',
  ...overrides,
});

describe('ChildClaimsService.listQueueForAdmin — one aggregate, oldest-first, no leak (AC-4)', () => {
  it('projects evidence + matchMethod + matched student + requesting parent in ONE findMany', async () => {
    const findMany = jest.fn(async () => [
      {
        id: 'c1',
        status: 'submitted',
        guardianshipId: 'link-1',
        relationship: 'mother',
        claimedFirstName: 'Léa',
        claimedLastName: 'Dupont',
        claimedDob: new Date('2012-04-05T00:00:00.000Z'),
        claimedExternalRef: null,
        createdAt: new Date('2026-06-01T08:00:00.000Z'),
        student: {
          id: 'stu-1',
          firstName: 'Léa',
          lastName: 'Dupont',
          birthDate: new Date('2012-04-05T00:00:00.000Z'),
          externalRef: 'EXT-9',
        },
        guardian: { id: GUARDIAN, firstName: 'Marie', lastName: 'Dupont', userProfileId: 'u1', email: 'm@x.fr' },
      },
      {
        id: 'c2',
        status: 'submitted',
        guardianshipId: null,
        relationship: 'father',
        claimedFirstName: 'Tom',
        claimedLastName: 'Martin',
        claimedDob: null,
        claimedExternalRef: 'REF-42',
        createdAt: new Date('2026-06-02T08:00:00.000Z'),
        student: null, // match_failed → no matched student
        guardian: { id: 'g2', firstName: 'Paul', lastName: 'Martin', userProfileId: null, email: null },
      },
    ]);
    const svc = mkSvc({ guardianshipClaim: { findMany } });
    const { data } = await svc.listQueueForAdmin({ tenantId: TENANT, status: 'submitted' });

    // ONE aggregate query, tenant-scoped, oldest-first.
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT, status: 'submitted' },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(data[0]!.evidence.matchMethod).toBe('name+dob');
    expect(data[0]!.matchedStudent).toEqual({
      studentId: 'stu-1',
      firstName: 'Léa',
      lastName: 'Dupont',
      birthDate: '2012-04-05',
      externalRef: 'EXT-9',
    });
    expect(data[0]!.requestingParent.email).toBe('m@x.fr');
    // match_failed row: externalRef present → matchMethod externalRef, no matched student.
    expect(data[1]!.evidence.matchMethod).toBe('externalRef');
    expect(data[1]!.matchedStudent).toBeNull();
  });
});

describe('ChildClaimsService.approveClaim — atomic grant, race-safe, idempotent (AC-5)', () => {
  it('flips link pending→active (approvedBy stamped) + claim →approved + admin audit + notifies', async () => {
    const notify = jest.fn<Promise<{ created: number }>, [Array<Record<string, unknown>>]>(
      async () => ({ created: 1 }),
    );
    const f = fakeAdminPrisma({ claim: submittedClaim() });
    const svc = mkSvc(f.prisma, fakeNotifications(notify));
    const res = await svc.approveClaim({ tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1' });

    expect(res).toEqual({
      claimId: 'claim-1',
      status: 'approved',
      guardianshipId: 'link-1',
      guardianshipStatus: 'active',
      studentId: 'stu-1',
    });
    // The link flip is from-status-guarded (status: 'pending') + stamps approvedBy.
    expect(f.tx.guardianship.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT, status: 'pending' }),
        data: expect.objectContaining({ status: 'active', approvedBy: ACTOR }),
      }),
    );
    expect(f.claimUpdates[0]!.status).toBe('approved');
    expect(f.audits[0]!.action).toBe('guardianship.claim_approved');
    expect(f.audits[0]!.actorRole).toBe('admin'); // Winston CONCERN #4: admin, not parent.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0][0]!.kind).toBe('enrollment_status'); // FM-9: reused kind.
    expect(notify.mock.calls[0]![0][0]!.sourceType).toBe('guardianship_claim_approved');
  });

  it('re-approve of an already-approved+active claim → idempotent no-op 200 (no audit, no notify)', async () => {
    const notify = jest.fn(async () => ({ created: 1 }));
    const f = fakeAdminPrisma({
      claim: submittedClaim({ status: 'approved' }),
      activeLink: { id: 'link-1' }, // the link is already active
    });
    const svc = mkSvc(f.prisma, fakeNotifications(notify));
    const res = await svc.approveClaim({ tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1' });
    expect(res.status).toBe('approved');
    expect(res.guardianshipStatus).toBe('active');
    expect(f.audits).toHaveLength(0); // no second audit row
    expect(notify).not.toHaveBeenCalled(); // no duplicate notification
  });

  it('concurrent double-approve: the from-status guard count===0 → deterministic 409 (never a 2nd grant)', async () => {
    const f = fakeAdminPrisma({ claim: submittedClaim(), linkUpdateCount: 0 });
    const svc = mkSvc(f.prisma);
    await expect(
      svc.approveClaim({ tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('approve a match_failed claim (guardianshipId null) → 409, nothing mutated', async () => {
    const f = fakeAdminPrisma({
      claim: submittedClaim({ status: 'match_failed', guardianshipId: null, matchedStudentId: null }),
    });
    const svc = mkSvc(f.prisma);
    await expect(
      svc.approveClaim({ tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.linkUpdates).toHaveLength(0);
  });

  it('a missing / cross-tenant claim id → 404 (no leak)', async () => {
    const f = fakeAdminPrisma({ claim: null });
    const svc = mkSvc(f.prisma);
    await expect(
      svc.approveClaim({ tenantId: TENANT, actorId: ACTOR, claimId: 'nope' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('a notify failure AFTER commit is swallowed — the grant stands (AC-8)', async () => {
    const notify = jest.fn(async () => {
      throw new Error('redis down');
    });
    const f = fakeAdminPrisma({ claim: submittedClaim() });
    const svc = mkSvc(f.prisma, fakeNotifications(notify));
    const res = await svc.approveClaim({ tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1' });
    expect(res.guardianshipStatus).toBe('active'); // commit stands despite the notify throw
    expect(f.claimUpdates[0]!.status).toBe('approved');
  });

  it('approve where the guardian has no login (userProfileId null) → 200, 0 notifications, no throw (FM-7)', async () => {
    const notify = jest.fn(async () => ({ created: 1 }));
    const f = fakeAdminPrisma({ claim: submittedClaim(), guardian: { userProfileId: null } });
    const svc = mkSvc(f.prisma, fakeNotifications(notify));
    const res = await svc.approveClaim({ tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1' });
    expect(res.guardianshipStatus).toBe('active');
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('ChildClaimsService.rejectClaim — reason-required, revoke, notify (AC-6)', () => {
  it('flips claim →rejected (+decisionReason) + link pending→revoked + admin audit + notifies', async () => {
    const notify = jest.fn<Promise<{ created: number }>, [Array<Record<string, unknown>>]>(
      async () => ({ created: 1 }),
    );
    const f = fakeAdminPrisma({ claim: submittedClaim() });
    const svc = mkSvc(f.prisma, fakeNotifications(notify));
    const res = await svc.rejectClaim({
      tenantId: TENANT,
      actorId: ACTOR,
      claimId: 'claim-1',
      reason: '  La date de naissance ne correspond pas.  ',
    });
    expect(res).toEqual({ claimId: 'claim-1', status: 'rejected' });
    expect(f.claimUpdates[0]!.status).toBe('rejected');
    expect(f.claimUpdates[0]!.decisionReason).toBe('La date de naissance ne correspond pas.'); // trimmed
    // The link is from-status-guarded pending→revoked.
    expect(f.tx.guardianship.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT, status: 'pending' }),
        data: expect.objectContaining({ status: 'revoked' }),
      }),
    );
    expect(f.audits[0]!.action).toBe('guardianship.claim_rejected');
    expect(f.audits[0]!.actorRole).toBe('admin');
    expect(notify.mock.calls[0]![0][0]!.kind).toBe('enrollment_status');
    expect(notify.mock.calls[0]![0][0]!.sourceType).toBe('guardianship_claim_rejected');
  });

  it('reject a non-submitted (already-decided) claim → 409', async () => {
    const f = fakeAdminPrisma({ claim: submittedClaim({ status: 'rejected' }) });
    const svc = mkSvc(f.prisma);
    await expect(
      svc.rejectClaim({ tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1', reason: 'x' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('a missing / cross-tenant claim id → 404 (no leak)', async () => {
    const f = fakeAdminPrisma({ claim: null });
    const svc = mkSvc(f.prisma);
    await expect(
      svc.rejectClaim({ tenantId: TENANT, actorId: ACTOR, claimId: 'nope', reason: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
