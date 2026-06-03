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
  };
  // ensureUser is the ONLY source of tenantId/userProfileId — derived from the
  // verified JWT, never from a request param. The provenance, by contrast, comes
  // from the raw realm roles on that same JWT.
  const users = {
    ensureUser: jest.fn().mockResolvedValue({ id: USER, tenantId: TENANT }),
  };
  const ctx = {} as unknown as SchoolContextService;
  const studentAccess = {} as unknown as StudentAccessService;
  const controller = new AlertsController(
    alerts as unknown as AlertsService,
    users as unknown as UserSyncService,
    ctx,
    studentAccess,
  );
  return { controller, alerts, users };
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
