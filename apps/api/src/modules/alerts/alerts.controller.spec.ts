import { AlertsController } from './alerts.controller';
import type { AlertsService } from './alerts.service';
import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { SchoolContextService } from '../school-structure/school-context.service';
import type { StudentAccessService } from '../students/student-access.service';

// Closes the verify-panel merge condition: the controller -> service seam that
// derives audit provenance from the live JWT (via deriveAlertActorProvenance)
// and threads it into the lifecycle write had ZERO coverage. The pure mapper
// (alert-provenance.spec.ts) and the service in isolation (alerts.service.spec.ts)
// were tested, but nothing asserted the controller actually wires them together.
// A refactor could drop the wiring and every other test would stay green while
// the append-only audit trail silently recorded the wrong/null actor.

const TENANT = 't1';
const USER = 'admin-1';
const ALERT_ID = 'alert-1';

function jwtWithRoles(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-sub', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

function makeController() {
  const alerts = {
    acknowledge: jest.fn().mockResolvedValue({ id: ALERT_ID, status: 'acknowledged' }),
    resolve: jest.fn().mockResolvedValue({ id: ALERT_ID, status: 'resolved' }),
    dismiss: jest.fn().mockResolvedValue({ id: ALERT_ID, status: 'dismissed' }),
    findStudentIdForAlert: jest.fn().mockResolvedValue('student-A'),
  };
  // ensureUser is the ONLY source of tenantId/userProfileId — derived from the
  // verified JWT, never from a request param. The provenance, by contrast, comes
  // from the raw realm roles on that same JWT.
  const users = {
    ensureUser: jest.fn().mockResolvedValue({ id: USER, tenantId: TENANT }),
  };
  const ctx = {
    forUser: jest.fn().mockResolvedValue({ schoolId: 'school-1' }),
  } as unknown as SchoolContextService;
  const studentAccess = {
    canAccessStudent: jest.fn().mockResolvedValue(true),
  } as unknown as StudentAccessService;
  const controller = new AlertsController(
    alerts as unknown as AlertsService,
    users as unknown as UserSyncService,
    ctx,
    studentAccess,
  );
  return { controller, alerts, users, ctx, studentAccess };
}

describe('AlertsController — audit provenance wiring (controller -> service)', () => {
  // The load-bearing case: a non-admin caller must NOT be mislabeled as the old
  // hardcoded school_admin/admin. teacher derives to teacher/teacher, proving the
  // value is actually threaded from deriveAlertActorProvenance(jwt) and not a
  // residual literal.
  it.each([
    ['acknowledge' as const],
    ['resolve' as const],
    ['dismiss' as const],
  ])('%s threads the JWT-derived teacher provenance into the service', async (method) => {
    const { controller, alerts } = makeController();

    await controller[method](jwtWithRoles(['teacher']), ALERT_ID);

    expect(alerts[method]).toHaveBeenCalledTimes(1);
    expect(alerts[method]).toHaveBeenCalledWith({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      actorRole: 'teacher',
      portal: 'teacher',
    });
  });

  it('resolve attributes a super_admin caller as super_admin/admin (precedence over school_admin)', async () => {
    const { controller, alerts } = makeController();

    await controller.resolve(jwtWithRoles(['school_admin', 'super_admin']), ALERT_ID);

    expect(alerts.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: 'super_admin', portal: 'admin' }),
    );
  });

  it('acknowledge with an unknown-only realm role records the raw role and a null portal (best-effort, never throws)', async () => {
    const { controller, alerts } = makeController();

    await controller.acknowledge(jwtWithRoles(['offline_access']), ALERT_ID);

    expect(alerts.acknowledge).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: 'offline_access', portal: null }),
    );
  });

  it('tenant safety: tenantId/userProfileId come from ensureUser(jwt), never from the :id path param', async () => {
    const { controller, alerts, users } = makeController();

    // Even with a hostile-looking id, the service is called with the JWT-derived
    // tenant, not anything attacker-controllable from the route.
    await controller.dismiss(jwtWithRoles(['school_admin']), 'other-tenant-alert');

    expect(users.ensureUser).toHaveBeenCalledTimes(1);
    expect(alerts.dismiss).toHaveBeenCalledWith({
      tenantId: TENANT,
      id: 'other-tenant-alert',
      userProfileId: USER,
      actorRole: 'school_admin',
      portal: 'admin',
    });
  });
});

// The parent-scoped lifecycle routes (PATCH :id/{ack,resolve,dismiss}) are the
// E1-S1 surface. They are guarded by `profile.read.self` + guardianship ABAC —
// NOT `alerts.write` — and MUST resolve the alert's in-tenant studentId and run
// canAccessStudent BEFORE delegating to the lifecycle service. These tests pin
// the IDOR / tenant / provenance contract that the verify panel flagged P0.
describe('AlertsController — parent-scoped lifecycle (ABAC, not alerts.write)', () => {
  const PARENT_JWT = jwtWithRoles(['parent']);

  it.each([
    ['ackByParent' as const, 'acknowledge' as const],
    ['resolveByParent' as const, 'resolve' as const],
    ['dismissByParent' as const, 'dismiss' as const],
  ])(
    '%s: a guardian parent passes ABAC and delegates with parent provenance',
    async (route, serviceMethod) => {
      const { controller, alerts, studentAccess } = makeController();

      await controller[route](PARENT_JWT, ALERT_ID);

      // ABAC ran against the alert's in-tenant studentId before any mutation.
      expect(alerts.findStudentIdForAlert).toHaveBeenCalledWith({
        tenantId: TENANT,
        id: ALERT_ID,
      });
      expect(studentAccess.canAccessStudent).toHaveBeenCalledWith(
        { id: USER, tenantId: TENANT },
        PARENT_JWT,
        'student-A',
        'school-1',
      );
      expect(alerts[serviceMethod]).toHaveBeenCalledWith({
        tenantId: TENANT,
        id: ALERT_ID,
        userProfileId: USER,
        actorRole: 'parent',
        portal: 'parent',
      });
    },
  );

  it.each([['ackByParent' as const], ['resolveByParent' as const], ['dismissByParent' as const]])(
    '%s: a non-guardian parent (canAccessStudent=false) gets 403 and never mutates',
    async (route) => {
      const { controller, alerts, studentAccess } = makeController();
      (studentAccess.canAccessStudent as jest.Mock).mockResolvedValue(false);

      await expect(controller[route](PARENT_JWT, ALERT_ID)).rejects.toThrow('Forbidden');

      expect(alerts.acknowledge).not.toHaveBeenCalled();
      expect(alerts.resolve).not.toHaveBeenCalled();
      expect(alerts.dismiss).not.toHaveBeenCalled();
    },
  );

  it.each([['ackByParent' as const], ['resolveByParent' as const], ['dismissByParent' as const]])(
    '%s: an alert id absent from the caller tenant yields 404, no ABAC bypass, no mutation',
    async (route) => {
      const { controller, alerts, studentAccess } = makeController();
      (alerts.findStudentIdForAlert as jest.Mock).mockResolvedValue(null);

      await expect(controller[route](PARENT_JWT, 'cross-tenant-id')).rejects.toThrow(
        'Alert not found',
      );

      expect(studentAccess.canAccessStudent).not.toHaveBeenCalled();
      expect(alerts.acknowledge).not.toHaveBeenCalled();
      expect(alerts.resolve).not.toHaveBeenCalled();
      expect(alerts.dismiss).not.toHaveBeenCalled();
    },
  );
});
