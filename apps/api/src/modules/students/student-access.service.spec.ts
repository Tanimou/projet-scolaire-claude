import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';

import { StudentAccessService } from './student-access.service';

const TENANT = 't1';
const SCHOOL = 'school-1';
const PARENT = { id: 'parent-1', tenantId: TENANT };
const MY_CHILD = 'student-mine';
const OTHER_CHILD = 'student-not-mine';

function jwtWithRoles(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-sub', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

/**
 * S-E05-16 — the TeacherProfileService double for suites that must NOT enter the
 * teacher branch. It THROWS rather than returning `null`, deliberately: the
 * pre-diff `makeService` had no `teacherProfile` key at all, so an accidental
 * teacher-branch entry blew up instead of quietly passing. That brittleness is
 * load-bearing and is preserved here — a silent `null` would let a regression
 * that routes a parent through the teacher branch go green.
 */
function noTeacherResolver() {
  return {
    findForUser: jest.fn(() => {
      throw new Error('teacher branch entered in a suite that must not reach it');
    }),
  };
}

function makeService(guardianStudentIds: string[]) {
  const findMany = jest
    .fn()
    .mockResolvedValue(guardianStudentIds.map((studentId) => ({ studentId })));
  const prisma = { guardianship: { findMany } };
  const service = new StudentAccessService(prisma as never, noTeacherResolver() as never);
  return { service, findMany };
}

/**
 * Builds a service for the E8 student-self branch: `prisma.student.findFirst`
 * returns `{ id }` for a linked account or `null` for an unlinked one.
 */
function makeStudentService(linkedStudentId: string | null) {
  const findFirst = jest
    .fn()
    .mockResolvedValue(linkedStudentId ? { id: linkedStudentId } : null);
  const prisma = { student: { findFirst } };
  const service = new StudentAccessService(prisma as never, noTeacherResolver() as never);
  return { service, findFirst };
}

/**
 * S-E05-16 / `AC-1`..`AC-3` — the TEACHER double.
 *
 * `teacherProfileId: null` models a caller with NO `TeacherProfile` (`AC-2`).
 * `sections` are the `classSectionId`s the assignment read returns (duplicates
 * allowed — a teacher holds one assignment PER SUBJECT on the same section), and
 * `enrollmentsBySection` maps a section id to the student ids ACTIVELY enrolled
 * in it. The enrollment double reads the `classSectionId.in` list off the actual
 * Prisma argument, so a query that forgot to narrow would return nothing rather
 * than everything.
 */
function makeTeacherService(input: {
  teacherProfileId: string | null;
  sections?: string[];
  enrollmentsBySection?: Record<string, string[]>;
  guardianStudentIds?: string[];
  linkedStudentId?: string | null;
}) {
  const findForUser = jest
    .fn()
    .mockResolvedValue(input.teacherProfileId === null ? null : { id: input.teacherProfileId });
  const assignmentFindMany = jest
    .fn()
    .mockResolvedValue((input.sections ?? []).map((classSectionId) => ({ classSectionId })));
  const enrollmentFindMany = jest.fn(
    async (args: { where: { classSectionId: { in: string[] } } }) => {
      const map = input.enrollmentsBySection ?? {};
      const out: { studentId: string }[] = [];
      for (const sectionId of args.where.classSectionId.in) {
        for (const studentId of map[sectionId] ?? []) out.push({ studentId });
      }
      return out;
    },
  );
  const guardianshipFindMany = jest
    .fn()
    .mockResolvedValue((input.guardianStudentIds ?? []).map((studentId) => ({ studentId })));
  const studentFindFirst = jest
    .fn()
    .mockResolvedValue(input.linkedStudentId ? { id: input.linkedStudentId } : null);

  const prisma = {
    teachingAssignment: { findMany: assignmentFindMany },
    enrollment: { findMany: enrollmentFindMany },
    guardianship: { findMany: guardianshipFindMany },
    student: { findFirst: studentFindFirst },
  };
  const teachers = {
    findForUser,
    // `ensureForUser` is an UPSERT. It must NEVER be reached from an
    // authorisation path (`PF-265` / `ADR-051 §D1`), so the double refuses to
    // be a silent no-op: a swap from `findForUser` to `ensureForUser` in the
    // service fails this suite loudly instead of passing.
    ensureForUser: jest.fn(() => {
      throw new Error('ensureForUser is an UPSERT on a REFUSAL path — PF-265 / ADR-051 D1');
    }),
  };
  const service = new StudentAccessService(prisma as never, teachers as never);
  return {
    service,
    findForUser,
    assignmentFindMany,
    enrollmentFindMany,
    guardianshipFindMany,
    studentFindFirst,
    ensureForUser: teachers.ensureForUser,
  };
}

/**
 * canAccessStudent is the SECURITY BOUNDARY the parent-scoped alert lifecycle
 * routes (PATCH /alerts/:id/{ack,resolve,dismiss}) rely on instead of the admin
 * `alerts.write` permission. The controller tests only verify the controller
 * *calls* this gate and honours its boolean; this suite pins the gate's own
 * correctness — without it, a regression in scopeForUser (dropping the tenant
 * filter, the active-status filter, or the guardian-ownership filter) silently
 * grants a parent write access to another family's child's alerts: an IDOR +
 * RGPD breach on children's data (project-context §North star, non-negotiable).
 */
describe('StudentAccessService.canAccessStudent — parent ABAC boundary', () => {
  it('parent CAN act on a student they hold an active guardianship for', async () => {
    const { service } = makeService([MY_CHILD]);

    await expect(
      service.canAccessStudent(PARENT, jwtWithRoles(['parent']), MY_CHILD, SCHOOL),
    ).resolves.toBe(true);
  });

  it('parent CANNOT act on a child they do not guard (IDOR denied)', async () => {
    const { service } = makeService([MY_CHILD]);

    await expect(
      service.canAccessStudent(PARENT, jwtWithRoles(['parent']), OTHER_CHILD, SCHOOL),
    ).resolves.toBe(false);
  });

  it('parent guardianship lookup is scoped by tenant, active status AND guardian ownership', async () => {
    const { service, findMany } = makeService([MY_CHILD]);

    await service.canAccessStudent(PARENT, jwtWithRoles(['parent']), MY_CHILD, SCHOOL);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT,
        status: 'active',
        guardian: { userProfileId: PARENT.id },
      },
      select: { studentId: true },
    });
  });

  it('a parent with NO active guardianships is denied every student', async () => {
    const { service } = makeService([]);

    await expect(
      service.canAccessStudent(PARENT, jwtWithRoles(['parent']), MY_CHILD, SCHOOL),
    ).resolves.toBe(false);
  });

  // S-E05-16 — this case USED to assert "admin / teacher tokens are unrestricted".
  // The teacher half of that sentence was the defect (`PF-288`) and is now the
  // subject of its own suite below. Only the two admin roles keep the sentinel.
  it('ADMIN tokens are unrestricted within tenant (no guardianship lookup)', async () => {
    const { service, findMany } = makeService([]);

    await expect(
      service.canAccessStudent(PARENT, jwtWithRoles(['school_admin']), OTHER_CHILD, SCHOOL),
    ).resolves.toBe(true);
    await expect(
      service.canAccessStudent(PARENT, jwtWithRoles(['super_admin']), OTHER_CHILD, SCHOOL),
    ).resolves.toBe(true);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('a token with no student-bearing role is denied (empty scope, fail-closed)', async () => {
    const { service } = makeService([]);

    await expect(
      service.canAccessStudent(PARENT, jwtWithRoles(['offline_access']), MY_CHILD, SCHOOL),
    ).resolves.toBe(false);
  });
});

/**
 * E8-S1 — the student-self ABAC wall. This is the load-bearing, [auth]-tagged
 * invariant of the slice: a `student` caller resolves to EXACTLY their own one
 * Student, server-derived from `Student.userProfileId === me.id`. The scope is a
 * bounded one-element array (linked) or `[]` (unlinked) — **never `null`** (the
 * admin/teacher "unrestricted" sentinel), **never a peer id**. A regression that
 * loosened this — a `null` student scope, or a fall-through to admin — would
 * silently grant a minor read access to EVERY student's dossier: the single
 * highest-severity RGPD breach the platform can produce. These assertions pin it.
 */
describe('StudentAccessService — E8 student-self branch (deny-by-default, never null, never peer)', () => {
  const STUDENT = { id: 'profile-student-1', tenantId: TENANT };
  const MY_STUDENT = 'student-self-id';
  const A_PEER = 'student-peer-id';

  it('a LINKED student resolves to EXACTLY their own one id (a bounded array, NOT null)', async () => {
    const { service } = makeStudentService(MY_STUDENT);

    const scope = await service.scopeForUser(STUDENT, jwtWithRoles(['student']), SCHOOL);

    expect(scope.studentIds).toEqual([MY_STUDENT]);
    // The crux: never the admin/teacher "unrestricted" sentinel.
    expect(scope.studentIds).not.toBeNull();
    expect(scope.reason).toBe('student-self');
  });

  it('an UNLINKED student resolves to [] (no access) — never null, never a peer', async () => {
    const { service } = makeStudentService(null);

    const scope = await service.scopeForUser(STUDENT, jwtWithRoles(['student']), SCHOOL);

    expect(scope.studentIds).toEqual([]);
    expect(scope.studentIds).not.toBeNull();
  });

  it('canAccessStudent is true ONLY for the own id', async () => {
    const { service } = makeStudentService(MY_STUDENT);

    await expect(
      service.canAccessStudent(STUDENT, jwtWithRoles(['student']), MY_STUDENT, SCHOOL),
    ).resolves.toBe(true);
  });

  it('canAccessStudent DENIES a peer id (no IDOR — a client-supplied foreign id can never pass)', async () => {
    const { service } = makeStudentService(MY_STUDENT);

    await expect(
      service.canAccessStudent(STUDENT, jwtWithRoles(['student']), A_PEER, SCHOOL),
    ).resolves.toBe(false);
  });

  it('an unlinked student is denied even their own (no Student → []) — fail-closed', async () => {
    const { service } = makeStudentService(null);

    await expect(
      service.canAccessStudent(STUDENT, jwtWithRoles(['student']), MY_STUDENT, SCHOOL),
    ).resolves.toBe(false);
  });

  it('the self-resolve is scoped by tenant AND the caller-own userProfileId (no cross-tenant, no peer)', async () => {
    const { service, findFirst } = makeStudentService(MY_STUDENT);

    await service.canAccessStudent(STUDENT, jwtWithRoles(['student']), MY_STUDENT, SCHOOL);

    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId: TENANT, userProfileId: STUDENT.id },
      select: { id: true },
    });
  });
});

/**
 * S-E05-16 / `PF-288` / `ADR-066` — THE TEACHER WALL.
 *
 * Pre-diff, `scopeForUser` returned `{ studentIds: null }` for `teacher` behind a
 * `TODO Phase 4` — this service's own documented UNRESTRICTED sentinel — so
 * `canAccessStudent` returned `true` for EVERY student in the tenant across the
 * ~25 call sites that gate on it, and `GET /api/v1/students?classSectionId=<any>`
 * let any teacher enumerate any class's roster as WHOLE `Student` rows.
 *
 * EVERY case in this describe FAILS on the pre-diff tree. The one that fails
 * first and most loudly is the `not.toBeNull()` assertion: it is written
 * explicitly rather than left implicit in the array comparisons, because a
 * future regression back to `null` would pass a `toEqual`-on-contents vacuously.
 */
describe('StudentAccessService — S-E05-16 teacher wall (AC-1, AC-2, AC-3)', () => {
  const TEACHER = { id: 'profile-teacher-1', tenantId: TENANT };
  const MY_TP = 'tp-1';
  const CS_MINE = 'cs-mine';
  const CS_MINE_2 = 'cs-mine-2';
  const CS_NOT_MINE = 'cs-not-mine';
  const TAUGHT = 'student-taught';
  const TAUGHT_2 = 'student-taught-2';
  const NOT_TAUGHT = 'student-not-taught';

  function taughtService() {
    return makeTeacherService({
      teacherProfileId: MY_TP,
      // Three assignment rows, TWO distinct sections: a teacher holds one
      // assignment PER SUBJECT on the same section.
      sections: [CS_MINE, CS_MINE, CS_MINE_2],
      enrollmentsBySection: {
        [CS_MINE]: [TAUGHT, TAUGHT],
        [CS_MINE_2]: [TAUGHT_2],
        [CS_NOT_MINE]: [NOT_TAUGHT],
      },
    });
  }

  it('AC-1 — the teacher scope is a NON-NULL array of exactly the taught students', async () => {
    const { service } = taughtService();

    const scope = await service.scopeForUser(TEACHER, jwtWithRoles(['teacher']), SCHOOL);

    // The crux of the slice. Asserted separately so it cannot pass vacuously.
    expect(scope.studentIds).not.toBeNull();
    expect(Array.isArray(scope.studentIds)).toBe(true);
    expect([...(scope.studentIds ?? [])].sort()).toEqual([TAUGHT, TAUGHT_2].sort());
    expect(scope.studentIds).not.toContain(NOT_TAUGHT);
    expect(scope.reason).toBe('teacher');
  });

  it('AC-1 — canAccessStudent ALLOWS a taught student and REFUSES one they do not teach', async () => {
    const allow = taughtService();
    await expect(
      allow.service.canAccessStudent(TEACHER, jwtWithRoles(['teacher']), TAUGHT, SCHOOL),
    ).resolves.toBe(true);

    const deny = taughtService();
    await expect(
      deny.service.canAccessStudent(TEACHER, jwtWithRoles(['teacher']), NOT_TAUGHT, SCHOOL),
    ).resolves.toBe(false);
  });

  it('AC-2 — a teacher with NO TeacherProfile resolves to [] and NEVER null (deny-by-default)', async () => {
    const { service, assignmentFindMany } = makeTeacherService({ teacherProfileId: null });

    const scope = await service.scopeForUser(TEACHER, jwtWithRoles(['teacher']), SCHOOL);

    expect(scope.studentIds).toEqual([]);
    expect(scope.studentIds).not.toBeNull();
    // The refusal lands BEFORE the assignment `where` exists — the widening
    // shape `{ tenantId, teacherProfileId: tp?.id }` is never constructed.
    expect(assignmentFindMany).not.toHaveBeenCalled();
    await expect(
      service.canAccessStudent(TEACHER, jwtWithRoles(['teacher']), TAUGHT, SCHOOL),
    ).resolves.toBe(false);
  });

  it('AC-2 — a teacher with a profile but ZERO assignments also resolves to [], never null', async () => {
    const { service, enrollmentFindMany } = makeTeacherService({
      teacherProfileId: MY_TP,
      sections: [],
    });

    const scope = await service.scopeForUser(TEACHER, jwtWithRoles(['teacher']), SCHOOL);

    expect(scope.studentIds).toEqual([]);
    expect(scope.studentIds).not.toBeNull();
    expect(enrollmentFindMany).not.toHaveBeenCalled();
  });

  it('AC-2 — ensureForUser (an UPSERT on a REFUSAL path) is NEVER called — PF-265 / ADR-051 §D1', async () => {
    const { service, findForUser, ensureForUser } = makeTeacherService({ teacherProfileId: null });

    await service.scopeForUser(TEACHER, jwtWithRoles(['teacher']), SCHOOL);

    expect(findForUser).toHaveBeenCalledWith(TEACHER);
    expect(ensureForUser).not.toHaveBeenCalled();
  });

  it('AC-3 — the assignment read is tenant-keyed AND teacherProfileId-keyed (no fail-open)', async () => {
    const { service, assignmentFindMany } = taughtService();

    await service.scopeForUser(TEACHER, jwtWithRoles(['teacher']), SCHOOL);

    expect(assignmentFindMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, teacherProfileId: MY_TP },
      select: { classSectionId: true },
    });
  });

  it('AC-3 — the enrollment read carries tenantId, status active, and ONLY the deduped taught sections', async () => {
    const { service, enrollmentFindMany } = taughtService();

    await service.scopeForUser(TEACHER, jwtWithRoles(['teacher']), SCHOOL);

    expect(enrollmentFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT,
        status: 'active',
        classSectionId: { in: [CS_MINE, CS_MINE_2] },
      },
      select: { studentId: true },
    });
  });

  it('AC-3 — a FOREIGN-TENANT section falls on an EMPTY INTERSECTION, not an authorisation', async () => {
    // The assignment read is tenant-keyed, so a section belonging to another
    // tenant is simply absent from the list it returns. Asserted BOTH ways: by
    // reading the Prisma argument (the clause is on the query) and by the
    // verdict (a student of that section is REFUSED, not granted).
    const FOREIGN_SECTION = 'cs-other-tenant';
    const FOREIGN_STUDENT = 'student-other-tenant';
    const { service, enrollmentFindMany } = makeTeacherService({
      teacherProfileId: MY_TP,
      sections: [CS_MINE],
      enrollmentsBySection: {
        [CS_MINE]: [TAUGHT],
        [FOREIGN_SECTION]: [FOREIGN_STUDENT],
      },
    });

    const scope = await service.scopeForUser(TEACHER, jwtWithRoles(['teacher']), SCHOOL);

    // The indexed read is narrowed by ASSERTING the call happened, not by a
    // non-null assertion: with no enrollment query at all there is no clause to
    // read, and that is itself the failure this case must report.
    expect(enrollmentFindMany).toHaveBeenCalled();
    const firstEnrollmentCall = enrollmentFindMany.mock.calls[0];
    if (firstEnrollmentCall === undefined) {
      throw new Error('`enrollment.findMany` was never called — no scope clause to read');
    }
    const enrollmentArgs = firstEnrollmentCall[0] as {
      where: { tenantId: string; classSectionId: { in: string[] } };
    };
    expect(enrollmentArgs.where.tenantId).toBe(TENANT);
    expect(enrollmentArgs.where.classSectionId.in).not.toContain(FOREIGN_SECTION);
    expect(scope.studentIds).toEqual([TAUGHT]);
    expect(scope.studentIds).not.toContain(FOREIGN_STUDENT);
    await expect(
      service.canAccessStudent(TEACHER, jwtWithRoles(['teacher']), FOREIGN_STUDENT, SCHOOL),
    ).resolves.toBe(false);
  });

  it('the null sentinel survives for super_admin / school_admin ONLY', async () => {
    const { service, findForUser } = taughtService();

    expect(
      (await service.scopeForUser(TEACHER, jwtWithRoles(['super_admin']), SCHOOL)).studentIds,
    ).toBeNull();
    expect(
      (await service.scopeForUser(TEACHER, jwtWithRoles(['school_admin']), SCHOOL)).studentIds,
    ).toBeNull();
    // An admin never pays for the teacher resolution.
    expect(findForUser).not.toHaveBeenCalled();
  });
});

/**
 * S-E05-16 / `PF-297` / `ADR-066 §D2` — THE ROLE UNION.
 *
 * `scopeForUser` used to resolve `admin → teacher → parent → student` by
 * SHORT-CIRCUIT. That was sound only while the teacher branch was unrestricted:
 * a teacher whose own child attends the school fell into the teacher branch and
 * their child was included BY ACCIDENT. Bounding the teacher branch without
 * unioning would have taken that child away — a data-loss regression on the
 * PARENT portal, shipped by a fix labelled "teacher".
 *
 * The union never WIDENS: where the old chain returned the unrestricted
 * sentinel for a multi-role caller, it now returns that caller's own bounded
 * scope, which is strictly narrower.
 */
describe('StudentAccessService — S-E05-16 role UNION, not first-match (PF-297)', () => {
  const DUAL = { id: 'profile-dual-1', tenantId: TENANT };
  const MY_TP = 'tp-dual';
  const CS_MINE = 'cs-dual';
  const TAUGHT = 'student-taught';
  const MY_OWN_CHILD = 'student-my-child';
  const MY_OWN_STUDENT_ROW = 'student-me';

  it('teacher+parent keeps BOTH the taught students AND their own child', async () => {
    const { service } = makeTeacherService({
      teacherProfileId: MY_TP,
      sections: [CS_MINE],
      enrollmentsBySection: { [CS_MINE]: [TAUGHT] },
      // The child is NOT in a taught section — the case that used to vanish.
      guardianStudentIds: [MY_OWN_CHILD],
    });

    const scope = await service.scopeForUser(DUAL, jwtWithRoles(['teacher', 'parent']), SCHOOL);

    expect(scope.studentIds).not.toBeNull();
    expect([...(scope.studentIds ?? [])].sort()).toEqual([TAUGHT, MY_OWN_CHILD].sort());
    expect(scope.reason).toBe('teacher+parent');
    await expect(
      service.canAccessStudent(DUAL, jwtWithRoles(['teacher', 'parent']), MY_OWN_CHILD, SCHOOL),
    ).resolves.toBe(true);
  });

  it('teacher+student keeps the student-self id (the student portal is not shadowed)', async () => {
    const { service } = makeTeacherService({
      teacherProfileId: MY_TP,
      sections: [CS_MINE],
      enrollmentsBySection: { [CS_MINE]: [TAUGHT] },
      linkedStudentId: MY_OWN_STUDENT_ROW,
    });

    const scope = await service.scopeForUser(DUAL, jwtWithRoles(['teacher', 'student']), SCHOOL);

    expect(scope.studentIds).toContain(MY_OWN_STUDENT_ROW);
    expect(scope.reason).toBe('teacher+student-self');
    await expect(
      service.canAccessStudent(
        DUAL,
        jwtWithRoles(['teacher', 'student']),
        MY_OWN_STUDENT_ROW,
        SCHOOL,
      ),
    ).resolves.toBe(true);
  });

  it('an id reachable through TWO branches appears exactly ONCE (Set-deduped)', async () => {
    const { service } = makeTeacherService({
      teacherProfileId: MY_TP,
      sections: [CS_MINE],
      // The teacher teaches their own child.
      enrollmentsBySection: { [CS_MINE]: [MY_OWN_CHILD] },
      guardianStudentIds: [MY_OWN_CHILD],
    });

    const scope = await service.scopeForUser(DUAL, jwtWithRoles(['teacher', 'parent']), SCHOOL);

    expect(scope.studentIds).toEqual([MY_OWN_CHILD]);
  });

  it('LAZY per role — a pure parent issues NO teacher query (calendar latency, PF-199)', async () => {
    const { service, findForUser, assignmentFindMany, enrollmentFindMany } = makeTeacherService({
      teacherProfileId: MY_TP,
      guardianStudentIds: [MY_OWN_CHILD],
    });

    const scope = await service.scopeForUser(DUAL, jwtWithRoles(['parent']), SCHOOL);

    expect(scope.studentIds).toEqual([MY_OWN_CHILD]);
    expect(scope.reason).toBe('parent');
    expect(findForUser).not.toHaveBeenCalled();
    expect(assignmentFindMany).not.toHaveBeenCalled();
    expect(enrollmentFindMany).not.toHaveBeenCalled();
  });

  it('a token with no student-bearing role is STILL denied (empty scope, fail-closed)', async () => {
    const { service } = makeTeacherService({ teacherProfileId: MY_TP });

    const scope = await service.scopeForUser(DUAL, jwtWithRoles(['offline_access']), SCHOOL);

    expect(scope.studentIds).toEqual([]);
    expect(scope.reason).toBe('no role with student access');
  });
});
