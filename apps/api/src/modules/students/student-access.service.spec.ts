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
