import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ChildClaimsService, type SubmitClaimArgs } from './child-claims.service';

const TENANT = 'tenant-1';
const SCHOOL = 'school-1';
const GUARDIAN = 'guardian-1';
const ACTOR = 'user-1';

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
    const svcA = new ChildClaimsService(a.prisma as never);
    const matched = await svcA.submitClaim(baseArgs());

    // no_match (empty roster)
    const b = fakePrisma({ studentRows: [] });
    const svcB = new ChildClaimsService(b.prisma as never);
    const noMatch = await svcB.submitClaim(baseArgs());

    // ambiguous (twins)
    const c = fakePrisma({ studentRows: [studentRow({ id: 'a' }), studentRow({ id: 'b' })] });
    const svcC = new ChildClaimsService(c.prisma as never);
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
    const svc = new ChildClaimsService(f.prisma as never);
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
    const svc = new ChildClaimsService(f.prisma as never);
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
    const svc = new ChildClaimsService(f.prisma as never);
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
    const svc = new ChildClaimsService(f.prisma as never);
    const res = await svc.submitClaim(baseArgs());
    expect(res).toEqual({ outcome: 'received', claimId: null, status: null, child: null, message: expect.any(String) });
    expect(f.createdClaims).toHaveLength(0);
  });

  it('a revoked link is REUSED back to pending (revoked-reuse idiom)', async () => {
    const f = fakePrisma({
      studentRows: [studentRow()],
      existingLink: { id: 'link-1', status: 'revoked' },
    });
    const svc = new ChildClaimsService(f.prisma as never);
    await svc.submitClaim(baseArgs());
    expect(f.updatedLinks).toHaveLength(1);
    expect(f.updatedLinks[0]!.status).toBe('pending');
    expect(f.updatedLinks[0]!.approvedBy).toBeNull();
  });

  it('a concurrent double-submit hitting P2002 collapses to the uniform response (never a 500)', async () => {
    const f = fakePrisma({ studentRows: [studentRow()], createThrowsP2002: true });
    const svc = new ChildClaimsService(f.prisma as never);
    const res = await svc.submitClaim(baseArgs());
    expect(res).toEqual({ outcome: 'received', claimId: null, status: null, child: null, message: expect.any(String) });
  });
});

describe('ChildClaimsService.submitClaim — per-guardian rate-limit (AC-2)', () => {
  it('past the window cap → 429', async () => {
    const f = fakePrisma({ studentRows: [studentRow()], recentClaims: 5 });
    const svc = new ChildClaimsService(f.prisma as never);
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
    const svc = new ChildClaimsService({ guardianshipClaim: { findMany } } as never);
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
    const svc = new ChildClaimsService({
      guardianshipClaim: { findFirst: jest.fn(async () => null) },
    } as never);
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
    const svc = new ChildClaimsService(prisma as never);
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
    const svc = new ChildClaimsService(f.prisma as never);
    const res = await svc.submitClaim(baseArgs());
    expect(res).toEqual({ outcome: 'received', claimId: null, status: null, child: null, message: expect.any(String) });
    expect(f.createdLinks).toHaveLength(0); // deny-by-default: never grants across schools
    expect(f.createdClaims[0]!.status).toBe('match_failed');
  });
});

describe('ChildClaimsService.submitClaim — birthDate normalisation (non-form callers)', () => {
  it('a full-ISO datetime birthDate still matches the date-only roster row (drives a pending link)', async () => {
    const f = fakePrisma({ studentRows: [studentRow()] }); // stored 2012-04-05
    const svc = new ChildClaimsService(f.prisma as never);
    await svc.submitClaim(baseArgs({ birthDate: '2012-04-05T22:00:00.000Z' }));
    expect(f.createdLinks).toHaveLength(1);
    expect(f.createdLinks[0]!.status).toBe('pending');
    expect(f.createdClaims[0]!.status).toBe('submitted');
    // and the persisted claimedDob is normalised to the date portion
    expect((f.createdClaims[0]!.claimedDob as Date).toISOString().slice(0, 10)).toBe('2012-04-05');
  });
});
