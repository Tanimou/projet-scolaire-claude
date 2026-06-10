import 'reflect-metadata';

import { REALM_ROLE_PERMISSIONS } from '../../shared/auth/permissions.constants';
import { PERMISSIONS_META_KEY } from '../../shared/auth/requires-permission.decorator';

import { AdminChildClaimsController } from './admin-child-claims.controller';

/**
 * E9-S2 — the load-bearing AuthZ wall, asserted by test (not just by inspection).
 *
 * Every service unit test calls the service method directly, bypassing the
 * `@RequiresPermission` decorator + `PermissionsGuard`. The FM-1 PII-leak wall and
 * the "no parent can self-approve their own claim" property therefore live ONLY in
 * the decorator string + the seed omission — asserted nowhere executable until here.
 * A future refactor that swapped the decorator to bare `guardianships.read` (which
 * parent+teacher also hold), or a seed edit adding `guardianships.approve` to the
 * parent block, would silently turn this into a cross-family PII leak + parent
 * self-grant, with all green tests. These pin both halves.
 */
describe('AdminChildClaimsController — authorization wall (E9-S2, FM-1)', () => {
  const handlers = ['queue', 'approve', 'reject'] as const;

  it.each(handlers)(
    'route "%s" is walled by guardianships.approve (NOT bare guardianships.read)',
    (handler) => {
      const codes = Reflect.getMetadata(
        PERMISSIONS_META_KEY,
        AdminChildClaimsController.prototype[handler],
      ) as string[] | undefined;
      expect(codes).toEqual(['guardianships.approve']);
    },
  );

  it('the seed grants guardianships.approve to admins ONLY — parent/teacher/student denied', () => {
    expect(REALM_ROLE_PERMISSIONS.school_admin).toContain('guardianships.approve');
    expect(REALM_ROLE_PERMISSIONS.super_admin).toContain('guardianships.approve');
    // A parent/teacher/student holds at most guardianships.read — never .approve — so a
    // non-admin caller is 403 at PermissionsGuard before any queue/grant logic runs.
    expect(REALM_ROLE_PERMISSIONS.parent ?? []).not.toContain('guardianships.approve');
    expect(REALM_ROLE_PERMISSIONS.teacher ?? []).not.toContain('guardianships.approve');
    expect(REALM_ROLE_PERMISSIONS.student ?? []).not.toContain('guardianships.approve');
  });
});
