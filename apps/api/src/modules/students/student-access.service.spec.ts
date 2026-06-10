import { StudentAccessService } from './student-access.service';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';

const TENANT = 't1';
const SCHOOL = 'school-1';
const PARENT = { id: 'parent-1', tenantId: TENANT };
const MY_CHILD = 'student-mine';
const OTHER_CHILD = 'student-not-mine';

function jwtWithRoles(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-sub', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

function makeService(guardianStudentIds: string[]) {
  const findMany = jest
    .fn()
    .mockResolvedValue(guardianStudentIds.map((studentId) => ({ studentId })));
  const prisma = { guardianship: { findMany } };
  const service = new StudentAccessService(prisma as never);
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
  const service = new StudentAccessService(prisma as never);
  return { service, findFirst };
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

  it('admin / teacher tokens are unrestricted within tenant (no guardianship lookup)', async () => {
    const { service, findMany } = makeService([]);

    await expect(
      service.canAccessStudent(PARENT, jwtWithRoles(['school_admin']), OTHER_CHILD, SCHOOL),
    ).resolves.toBe(true);
    await expect(
      service.canAccessStudent(PARENT, jwtWithRoles(['teacher']), OTHER_CHILD, SCHOOL),
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
