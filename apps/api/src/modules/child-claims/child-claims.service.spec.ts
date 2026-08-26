import { HttpException } from '@nestjs/common';
import {
  PARENT_CHILD_LINK_STATE,
  ParentChildLinksResponseSchema,
  deriveParentChildLinkState,
} from '@pilotage/contracts';
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

/**
 * S-E04-7 / PF-122 — the provenance the CONTROLLER derives from the JWT.
 *
 * The service used to take `actor: 'parent' | 'admin'` and write it into both
 * `actorRole` and `portal`. `portal: 'admin'` was right; `actorRole: 'admin'` was
 * not — **`admin` is not a Keycloak realm role**; an administrator authenticates
 * as `school_admin`. The value now travels in from `deriveAuditProvenance(jwt, …)`
 * called above the transaction, so these fixtures are shaped like real JWT
 * derivations rather than like the two literals they replace.
 */
const PARENT_PROVENANCE = {
  actorRole: 'parent',
  portal: 'parent',
  ipAddress: null,
  userAgent: null,
} as const;

const ADMIN_PROVENANCE = {
  actorRole: 'school_admin',
  portal: 'admin',
  ipAddress: '203.0.113.9',
  userAgent: 'Mozilla/5.0 (X11)',
} as const;

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
    provenance: { ...PARENT_PROVENANCE },
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

/* ==================================================================== *
 * S-E03-3b / PF-357 / PF-12 / ADR-073 — the union projection.
 *
 * T-1 … T-13. The FR-5 no-oracle intent of the OLD suite survives inside
 * T-5: `submitted` (matched) and `match_failed` (unmatched) must be
 * indistinguishable on the wire. What changed is that the distinction is now
 * UNREPRESENTABLE rather than merely unprinted — the raw claim status has left
 * the response entirely.
 * ==================================================================== */

/** A `Guardianship` row shaped exactly like the service's `select` (FM-4). */
function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    studentId: 'stu-1',
    relationship: 'mother',
    status: 'active',
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    student: { id: 'stu-1', firstName: 'Léa', lastName: 'Dupont' },
    ...overrides,
  };
}

/** A `GuardianshipClaim` row shaped exactly like the service's `select` (FM-4). */
function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'claim-1',
    status: 'submitted',
    relationship: 'mother',
    guardianshipId: null,
    matchedStudentId: null,
    claimedFirstName: 'Léa',
    claimedLastName: 'Dupont',
    claimedDob: new Date('2012-04-05T00:00:00.000Z'),
    decisionReason: null,
    createdAt: new Date('2026-06-10T10:00:00.000Z'),
    updatedAt: new Date('2026-06-10T10:00:00.000Z'),
    ...overrides,
  };
}

/**
 * The list fake. Both `findMany` mocks FILTER on the `where` they are handed, so a
 * cross-tenant row is excluded by the SERVICE's own clause rather than by the
 * fixture's generosity — that is what makes T-7 a tenant test instead of a
 * tautology. The mocks are returned so T-7 can also read the `where` back.
 */
function mkListSvc(opts: {
  /** `Record<…>` and not `ReturnType<typeof linkRow>`: T-7 adds `tenantId`/`guardianId`. */
  links?: Record<string, unknown>[];
  claims?: Record<string, unknown>[];
}) {
  const scope = (rows: Record<string, unknown>[], where: Record<string, unknown>) =>
    rows.filter(
      (r) =>
        (r.tenantId === undefined || r.tenantId === where.tenantId) &&
        (r.guardianId === undefined || r.guardianId === where.guardianId),
    );

  const guardianshipFindMany = jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
    scope(opts.links ?? [], where),
  );
  const claimFindMany = jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
    scope(opts.claims ?? [], where),
  );

  const svc = mkSvc({
    guardianship: { findMany: guardianshipFindMany },
    guardianshipClaim: { findMany: claimFindMany },
  });
  return { svc, guardianshipFindMany, claimFindMany };
}

const list = (svc: ChildClaimsService) =>
  svc.listChildLinksForGuardian({ tenantId: TENANT, guardianId: GUARDIAN });

describe('ChildClaimsService.listChildLinksForGuardian — the union projects the FACT (AC-1)', () => {
  it('T-1 — one ACTIVE Guardianship and ZERO claims yields one `linked` row carrying the real name', async () => {
    // RED before this slice: `listForGuardian` read `guardianshipClaim` alone and
    // returned `{ claims: [] }` here — for 2459 of 2459 live guardians.
    const { svc } = mkListSvc({ links: [linkRow()] });
    const { links } = await list(svc);

    expect(links).toHaveLength(1);
    expect(links[0]!.state).toBe('linked');
    expect(links[0]!.id).toBe('link-1');
    expect(links[0]!.claimId).toBeNull();
    expect(links[0]!.canWithdraw).toBe(false);
    expect(links[0]!.child).toEqual({ studentId: 'stu-1', firstName: 'Léa', lastName: 'Dupont' });
    expect(links[0]!.displayName).toBe('Léa Dupont');
  });

  it('T-6 — zero guardianships and zero claims is the ONLY true zero-state (AC-4)', async () => {
    const { svc } = mkListSvc({});
    await expect(list(svc)).resolves.toEqual({ links: [] });
  });
});

describe('ChildClaimsService.listChildLinksForGuardian — « Validé » is INEXPRESSIBLE (AC-3)', () => {
  it('T-2 — an `approved` claim over a REVOKED link resolves to `ended`, never `linked`', async () => {
    // The old badge printed STATUS_CHIP.approved = « Validé » in green here, asserting a
    // link that no longer existed. No state's name or label derives from `approved`, so
    // the defect is not fixed — it cannot be expressed. The companion half of AC-3 (the
    // string is absent from the post-state corpus) is asserted by the ratchet, which can
    // read `apps/web` and `packages/ui`; this suite cannot import across those rootDirs.
    const { svc } = mkListSvc({
      links: [linkRow({ status: 'revoked' })],
      claims: [claimRow({ status: 'approved', guardianshipId: 'link-1', matchedStudentId: 'stu-1' })],
    });
    const { links } = await list(svc);

    expect(links).toHaveLength(1);
    expect(links[0]!.state).toBe('ended');
    expect(links.map((r) => r.state)).not.toContain('linked');
    expect(JSON.stringify(links)).not.toContain('Validé');
    // §3.4 / `ADR-073 §D5` — the link is REVOKED, so the identity is walled off even
    // though a human once approved the request. The row keeps the parent's OWN typed
    // values, which leak nothing. The draft §3.4 carried an `approved` disjunct here and
    // it handed the child's name AND internal `studentId` to a guardian the school had
    // just de-authorised; the predicate is `active`-only now.
    expect(links[0]!.child).toBeNull();
    expect(links[0]!.displayName).toBe('Léa Dupont'); // claimedFirstName/claimedLastName
    expect(JSON.stringify(links)).not.toContain('stu-1');
  });
});

describe('ChildClaimsService.listChildLinksForGuardian — identity is walled to ACTIVE links (§D5)', () => {
  // The defect this block exists for was shipped INSIDE the fix. The draft §3.4 read
  // `link !== null && (active || provenance === null || provenance.status ===
  // 'approved')`. The `provenance === null` disjunct was gated on NOTHING, and on the
  // live stack 2460 of 2460 links carry zero claims — so it was the normal case, not the
  // exception. `StudentAccessService` (`student-access.service.ts:111`) scopes a parent
  // to `active` guardianships ONLY, so these are children the platform denies this same
  // caller everywhere else on the same page.

  it('T-8b — a REVOKED link with NO claim is not projected at all: no name, no studentId', async () => {
    // `DELETE /guardians/guardianships/:id` (`guardians.controller.ts:348`) is the
    // custody-removal off-switch: it flips `status` to `revoked` and creates no claim.
    // Before the fix this row came back carrying the child's real name and internal
    // `studentId` to the guardian that had just been removed.
    const { svc } = mkListSvc({
      links: [
        linkRow({
          id: 'link-2',
          studentId: 'stu-2',
          status: 'revoked',
          student: { id: 'stu-2', firstName: 'Tom', lastName: 'Martin' },
        }),
      ],
    });
    const { links } = await list(svc);

    expect(links).toEqual([]);
  });

  it('T-8c — a PENDING link with NO claim is not projected either (never-yet-authorised)', async () => {
    // 28 live links sit in `pending`. The caller has not been granted access yet, so
    // naming the child here is a disclosure, not a status update.
    const { svc } = mkListSvc({ links: [linkRow({ status: 'pending' })] });
    const { links } = await list(svc);

    expect(links).toEqual([]);
  });

  it('T-8d — a revoked link KEEPS its row when a claim is behind it, named from `claimed*`', async () => {
    // The drop rule is about NAMEABILITY, not about hiding history: the parent's own
    // request survives, named with the values the parent typed.
    const { svc } = mkListSvc({
      links: [linkRow({ status: 'revoked' })],
      claims: [claimRow({ status: 'withdrawn', guardianshipId: null, matchedStudentId: 'stu-1' })],
    });
    const { links } = await list(svc);

    expect(links).toHaveLength(1);
    expect(links[0]!.state).toBe('request_withdrawn');
    expect(links[0]!.child).toBeNull();
    expect(links[0]!.displayName).toBe('Léa Dupont');
  });
});

describe('ChildClaimsService.listChildLinksForGuardian — one child, one row (AC-2, FM-1)', () => {
  it('T-3 — a revoked link + its DETACHED withdrawn claim is ONE row, and it names no child', async () => {
    // `withdraw()` nulls `guardianshipId` while revoking the link, so `guardianshipId`
    // alone cannot rejoin the two halves. Step 3's `matchedStudentId` fallback does. If
    // it were simplified away the link would look ADMIN-CREATED, lose the `claimed*`
    // values the parent typed, and be DROPPED as unnameable (§3.4's corollary) — the
    // parent's own withdrawn request would silently vanish from the panel. FM-1. PF-369.
    // (Before the review pass the same simplification was a LEAK rather than a
    // disappearance, via §3.4's `provenance === null` disjunct — now removed, §D5.)
    const { svc } = mkListSvc({
      links: [linkRow({ status: 'revoked' })],
      claims: [claimRow({ status: 'withdrawn', guardianshipId: null, matchedStudentId: 'stu-1' })],
    });
    const { links } = await list(svc);

    expect(links).toHaveLength(1);
    expect(links[0]!.state).toBe('request_withdrawn');
    expect(links[0]!.child).toBeNull();
    expect(links[0]!.displayName).toBe('Léa Dupont'); // the parent's OWN typed value
  });

  it('T-10 — a revoked link + its DETACHED rejected claim is ONE row that keeps the resubmit affordance', async () => {
    // `rejectClaim()` detaches identically to `withdraw()` (both null `guardianshipId` in
    // the same transaction that revokes the link). Without step 3 this splits into
    // `ended` + `request_rejected`: a duplicate row AND a lost « Renvoyer une demande ».
    const { svc } = mkListSvc({
      links: [linkRow({ status: 'revoked' })],
      claims: [
        claimRow({
          id: 'claim-r',
          status: 'rejected',
          guardianshipId: null,
          matchedStudentId: 'stu-1',
          decisionReason: 'Date de naissance illisible',
        }),
      ],
    });
    const { links } = await list(svc);

    expect(links).toHaveLength(1);
    expect(links[0]!.state).toBe('request_rejected');
    expect(links[0]!.child).toBeNull();
    expect(links[0]!.decisionReason).toBe('Date de naissance illisible');
    expect(links[0]!.resubmit).toEqual({
      firstName: 'Léa',
      lastName: 'Dupont',
      birthDate: '2012-04-05',
      relationship: 'mother',
    });
  });

  it('T-4 — a link with its joined claim plus an unmatched claim is EXACTLY two rows, no id twice', async () => {
    const { svc } = mkListSvc({
      links: [linkRow({ status: 'pending' })],
      claims: [
        claimRow({ id: 'claim-a', guardianshipId: 'link-1', matchedStudentId: 'stu-1' }),
        claimRow({ id: 'claim-b', status: 'match_failed', matchedStudentId: null }),
      ],
    });
    const { links } = await list(svc);

    expect(links).toHaveLength(2);
    expect(new Set(links.map((r) => r.id)).size).toBe(2);
    expect(links.map((r) => r.state)).toEqual(['requested', 'requested']);
  });

  it('T-13 — a resubmit ABSORBS the older detached claim: one child stays one row (W-2 / FM-12)', async () => {
    // submit → withdraw (claim A withdrawn, detached; link revoked) → resubmit (link
    // reused back to pending, NEW claim B submitted and joined). Two claims, one child.
    // The most recent claim wins provenance; the older row is absorbed, by design.
    const { svc } = mkListSvc({
      links: [linkRow({ status: 'pending' })],
      claims: [
        claimRow({
          id: 'claim-a',
          status: 'withdrawn',
          guardianshipId: null,
          matchedStudentId: 'stu-1',
          createdAt: new Date('2026-06-02T10:00:00.000Z'),
        }),
        claimRow({
          id: 'claim-b',
          status: 'submitted',
          guardianshipId: 'link-1',
          matchedStudentId: 'stu-1',
          createdAt: new Date('2026-06-09T10:00:00.000Z'),
        }),
      ],
    });
    const { links } = await list(svc);

    expect(links).toHaveLength(1);
    expect(links[0]!.state).toBe('requested');
    expect(links[0]!.claimId).toBe('claim-b');
  });
});

describe('ChildClaimsService.listChildLinksForGuardian — the no-oracle wall and its honest edge (AC-6)', () => {
  it('T-5 — a MATCHED submitted claim and an UNMATCHED one are indistinguishable on the wire', async () => {
    // A matched `submitted` claim drives a `pending` Guardianship; a `match_failed` claim
    // drives nothing. Rows 2 and 6 of §3.3 therefore BOTH collapse to `requested`: were
    // `pending` its own wire state, the parent would read the matcher's verdict straight
    // off the badge. FM-2.
    const { svc } = mkListSvc({
      links: [linkRow({ status: 'pending' })],
      claims: [
        claimRow({ id: 'claim-m', guardianshipId: 'link-1', matchedStudentId: 'stu-1' }),
        claimRow({
          id: 'claim-u',
          status: 'match_failed',
          claimedFirstName: 'Tom',
          claimedLastName: 'Martin',
          claimedDob: null,
        }),
      ],
    });
    const { links } = await list(svc);
    expect(links).toHaveLength(2);

    const ERASED = [
      'id',
      'claimId',
      'claimedBirthDate',
      'displayName',
      'createdAt',
      'updatedAt',
      // erased here and asserted to DIFFER below — the honest boundary, PF-367.
      'canWithdraw',
    ];
    const erase = (r: (typeof links)[number]): Record<string, unknown> =>
      Object.fromEntries(Object.entries(r).filter(([k]) => !ERASED.includes(k)));
    expect(erase(links[0]!)).toEqual(erase(links[1]!));
    expect(links.every((r) => r.child === null)).toBe(true);
    expect(links.every((r) => r.decisionReason === null)).toBe(true);

    // …and here is the boundary, stated rather than hidden. `canWithdraw` still means
    // `provenance.status === 'submitted'`, so the matched row gets « Annuler la demande »
    // and the unmatched one does not: the AFFORDANCE discriminates where the label
    // refuses to. Closing it means widening `withdraw()`'s from-status guard — a
    // MUTATION, therefore G-AUDIT, therefore its own slice. Recorded as **PF-367**;
    // deliberately NOT fixed here.
    const matched = links.find((r) => r.claimId === 'claim-m')!;
    const unmatched = links.find((r) => r.claimId === 'claim-u')!;
    expect(matched.canWithdraw).toBe(true);
    expect(unmatched.canWithdraw).toBe(false);
  });

  it('T-8 — every projected `child.studentId` is one the caller holds an ACTIVE Guardianship for', async () => {
    // Proves the "listing an active link reveals nothing GET /students does not already
    // return on the same page" claim instead of asserting it. The comparison set is the
    // `active` SUBSET, not the whole Guardianship set: `StudentAccessService` authorises
    // `status: 'active'` only, so ⊆-against-all-links would have passed while the panel
    // handed out revoked and pending children — which is exactly what the draft §3.4
    // did. `⊆` and not equality, because the students endpoint additionally applies a
    // `schoolId` filter that `Guardianship` cannot express — that gap is PF-356 and it
    // stays open.
    // ONE source for the fixtures and for both expected sets — two hand-kept lists of
    // the same thing is how the two halves of an assertion drift apart.
    const FIXTURES = [
      { id: 'link-1', studentId: 'stu-1', status: 'active', first: 'Léa', last: 'Dupont' },
      { id: 'link-2', studentId: 'stu-2', status: 'revoked', first: 'Tom', last: 'Martin' },
      { id: 'link-3', studentId: 'stu-3', status: 'pending', first: 'Noé', last: 'Bernard' },
    ] as const;
    const { svc } = mkListSvc({
      links: FIXTURES.map((f) =>
        linkRow({
          id: f.id,
          studentId: f.studentId,
          status: f.status,
          student: { id: f.studentId, firstName: f.first, lastName: f.last },
        }),
      ),
      claims: [claimRow({ id: 'claim-x', status: 'match_failed', claimedFirstName: 'Zoé' })],
    });
    const res = await list(svc);

    const authorised = new Set(
      FIXTURES.filter((f) => f.status === 'active').map((f) => f.studentId as string),
    );
    const projected = res.links.map((r) => r.child?.studentId).filter((s): s is string => s != null);
    expect(projected.length).toBeGreaterThan(0); // a vacuous ⊆ proves nothing
    for (const studentId of projected) expect(authorised.has(studentId)).toBe(true);

    // The whole payload — `displayName` included — must not name a child behind a
    // non-active link. `child: null` alone was NOT enough: the projection's own name
    // fallback read `link.student` on exactly these rows.
    const body = JSON.stringify(res);
    for (const f of FIXTURES.filter((x) => x.status !== 'active')) {
      expect(body).not.toContain(f.studentId);
      expect(body).not.toContain(f.first);
    }
  });

  it('T-10b — the withdraw affordance can never point at a row `id`: canWithdraw ⇒ claimId (FM-6)', async () => {
    // `id` is the GUARDIANSHIP id whenever a link exists, and
    // POST /parent/child-claims/:id/withdraw takes a CLAIM id — posting `id` would 404
    // on exactly the withdrawable rows. The invariant holds by construction here; it is
    // asserted over every fixture so a future edit cannot break it silently.
    const { svc } = mkListSvc({
      links: [linkRow({ status: 'pending' }), linkRow({ id: 'link-2', studentId: 'stu-2', student: { id: 'stu-2', firstName: 'Tom', lastName: 'Martin' } })],
      claims: [
        claimRow({ id: 'claim-a', guardianshipId: 'link-1', matchedStudentId: 'stu-1' }),
        claimRow({ id: 'claim-b', status: 'match_failed' }),
      ],
    });
    const { links } = await list(svc);
    for (const row of links) {
      if (row.canWithdraw) expect(row.claimId).not.toBeNull();
    }
  });
});

describe('ChildClaimsService.listChildLinksForGuardian — G-TENANT', () => {
  it('T-7 — both reads are tenant-keyed AND guardian-keyed, and a foreign-tenant link is not projected', async () => {
    const { svc, guardianshipFindMany, claimFindMany } = mkListSvc({
      links: [
        { ...linkRow(), tenantId: TENANT, guardianId: GUARDIAN },
        // Same guardianId, ANOTHER tenant. Excluded by the service's own `where`.
        {
          ...linkRow({ id: 'link-other', studentId: 'stu-other' }),
          tenantId: 'tenant-2',
          guardianId: GUARDIAN,
        },
      ],
    });
    const { links } = await list(svc);

    expect(links).toHaveLength(1);
    expect(links[0]!.id).toBe('link-1');

    for (const mock of [guardianshipFindMany, claimFindMany]) {
      expect(mock).toHaveBeenCalledTimes(1);
      const { where } = mock.mock.calls[0]![0] as { where: Record<string, unknown> };
      expect(where.tenantId).toBe(TENANT);
      expect(where.guardianId).toBe(GUARDIAN);
    }
  });
});

describe('deriveParentChildLinkState — a TOTAL function of the pair (§3.3)', () => {
  const LINK_STATUSES = [null, 'pending', 'active', 'revoked'] as const;
  const CLAIM_STATUSES = [
    null,
    'submitted',
    'approved',
    'rejected',
    'match_failed',
    'withdrawn',
  ] as const;

  it('T-9 — all 4 × 6 pairs return a member of the vocabulary; (null, null) throws', () => {
    let evaluated = 0;
    for (const link of LINK_STATUSES) {
      for (const claim of CLAIM_STATUSES) {
        if (link === null && claim === null) {
          expect(() => deriveParentChildLinkState(link, claim)).toThrow();
          continue;
        }
        const state = deriveParentChildLinkState(link, claim);
        expect(PARENT_CHILD_LINK_STATE).toContain(state);
        evaluated += 1;
      }
    }
    expect(evaluated).toBe(LINK_STATUSES.length * CLAIM_STATUSES.length - 1);
  });

  it('rows 2 and 6 COLLAPSE — a pending link and an unmatched claim are the same word', () => {
    expect(deriveParentChildLinkState('pending', 'submitted')).toBe('requested');
    expect(deriveParentChildLinkState(null, 'match_failed')).toBe('requested');
  });

  it('rows 3 and 4 outrank row 5 — a detached decision survives the revoked link', () => {
    expect(deriveParentChildLinkState('revoked', 'rejected')).toBe('request_rejected');
    expect(deriveParentChildLinkState('revoked', 'withdrawn')).toBe('request_withdrawn');
  });
});

describe('the contract module initialises through the real barrel (FM-7)', () => {
  it('T-11 — a 200 that does not carry `links` is a FAILED read, never an empty one (FM-8)', () => {
    // Also the CJS cycle check: if `guardianship/child-link.ts` and `dto/child-claim.ts`
    // imported each other, one side would be `undefined` at module-init and
    // `z.enum(undefined)` would throw on import — a boot failure no derivation test sees.
    expect(PARENT_CHILD_LINK_STATE).toEqual([
      'linked',
      'requested',
      'request_rejected',
      'request_withdrawn',
      'ended',
    ]);
    expect(ParentChildLinksResponseSchema.safeParse({}).success).toBe(false);
    expect(ParentChildLinksResponseSchema.safeParse({ links: [] }).success).toBe(true);
  });

  it('T-12 — a projected row validates against the shipped schema (DNC-06)', async () => {
    const { svc } = mkListSvc({
      links: [
        linkRow({
          id: '11111111-1111-4111-8111-111111111111',
          studentId: '22222222-2222-4222-8222-222222222222',
          student: {
            id: '22222222-2222-4222-8222-222222222222',
            firstName: 'Léa',
            lastName: 'Dupont',
          },
        }),
      ],
    });
    const res = await list(svc);
    const parsed = ParentChildLinksResponseSchema.safeParse(res);
    expect(parsed.success).toBe(true);
  });
});

describe('ChildClaimsService.withdraw — self-scoped, double-withdraw no-op', () => {
  it('returns false (→ controller 404) when no own claim matches the id', async () => {
    const svc = mkSvc({
      guardianshipClaim: { findFirst: jest.fn(async () => null) },
    });
    const ok = await svc.withdraw({ provenance: { ...PARENT_PROVENANCE }, tenantId: TENANT, guardianId: GUARDIAN, actorId: ACTOR, claimId: 'nope' });
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
    const ok = await svc.withdraw({ provenance: { ...PARENT_PROVENANCE }, tenantId: TENANT, guardianId: GUARDIAN, actorId: ACTOR, claimId: 'c1' });
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
    const res = await svc.approveClaim({ provenance: { ...ADMIN_PROVENANCE }, tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1' });

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
    // PF-122 (S-E04-7): the REAL Keycloak realm role, derived from the JWT at the
    // controller. It used to be the literal 'admin' — a value no realm issues — and
    // routing that through the canonical seam would have given it the seam's
    // authority. `portal` stays 'admin' because that IS the portal.
    expect(f.audits[0]!.actorRole).toBe('school_admin');
    expect(f.audits[0]!.actorRole).not.toBe('admin');
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
    const res = await svc.approveClaim({ provenance: { ...ADMIN_PROVENANCE }, tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1' });
    expect(res.status).toBe('approved');
    expect(res.guardianshipStatus).toBe('active');
    expect(f.audits).toHaveLength(0); // no second audit row
    expect(notify).not.toHaveBeenCalled(); // no duplicate notification
  });

  it('concurrent double-approve: the from-status guard count===0 → deterministic 409 (never a 2nd grant)', async () => {
    const f = fakeAdminPrisma({ claim: submittedClaim(), linkUpdateCount: 0 });
    const svc = mkSvc(f.prisma);
    await expect(
      svc.approveClaim({ provenance: { ...ADMIN_PROVENANCE }, tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('approve a match_failed claim (guardianshipId null) → 409, nothing mutated', async () => {
    const f = fakeAdminPrisma({
      claim: submittedClaim({ status: 'match_failed', guardianshipId: null, matchedStudentId: null }),
    });
    const svc = mkSvc(f.prisma);
    await expect(
      svc.approveClaim({ provenance: { ...ADMIN_PROVENANCE }, tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.linkUpdates).toHaveLength(0);
  });

  it('a missing / cross-tenant claim id → 404 (no leak)', async () => {
    const f = fakeAdminPrisma({ claim: null });
    const svc = mkSvc(f.prisma);
    await expect(
      svc.approveClaim({ provenance: { ...ADMIN_PROVENANCE }, tenantId: TENANT, actorId: ACTOR, claimId: 'nope' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('a notify failure AFTER commit is swallowed — the grant stands (AC-8)', async () => {
    const notify = jest.fn(async () => {
      throw new Error('redis down');
    });
    const f = fakeAdminPrisma({ claim: submittedClaim() });
    const svc = mkSvc(f.prisma, fakeNotifications(notify));
    const res = await svc.approveClaim({ provenance: { ...ADMIN_PROVENANCE }, tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1' });
    expect(res.guardianshipStatus).toBe('active'); // commit stands despite the notify throw
    expect(f.claimUpdates[0]!.status).toBe('approved');
  });

  it('approve where the guardian has no login (userProfileId null) → 200, 0 notifications, no throw (FM-7)', async () => {
    const notify = jest.fn(async () => ({ created: 1 }));
    const f = fakeAdminPrisma({ claim: submittedClaim(), guardian: { userProfileId: null } });
    const svc = mkSvc(f.prisma, fakeNotifications(notify));
    const res = await svc.approveClaim({ provenance: { ...ADMIN_PROVENANCE }, tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1' });
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
      provenance: { ...ADMIN_PROVENANCE },
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
    // PF-122 (S-E04-7): the real Keycloak realm role, never the 'admin' literal —
    // see the approveClaim case above for the full reason.
    expect(f.audits[0]!.actorRole).toBe('school_admin');
    expect(f.audits[0]!.actorRole).not.toBe('admin');
    expect(notify.mock.calls[0]![0][0]!.kind).toBe('enrollment_status');
    expect(notify.mock.calls[0]![0][0]!.sourceType).toBe('guardianship_claim_rejected');
  });

  it('reject a non-submitted (already-decided) claim → 409', async () => {
    const f = fakeAdminPrisma({ claim: submittedClaim({ status: 'rejected' }) });
    const svc = mkSvc(f.prisma);
    await expect(
      svc.rejectClaim({ provenance: { ...ADMIN_PROVENANCE }, tenantId: TENANT, actorId: ACTOR, claimId: 'claim-1', reason: 'x' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('a missing / cross-tenant claim id → 404 (no leak)', async () => {
    const f = fakeAdminPrisma({ claim: null });
    const svc = mkSvc(f.prisma);
    await expect(
      svc.rejectClaim({ provenance: { ...ADMIN_PROVENANCE }, tenantId: TENANT, actorId: ACTOR, claimId: 'nope', reason: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
