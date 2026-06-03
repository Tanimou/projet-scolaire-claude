import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';

/**
 * Provenance (actorRole + originating portal) for an alert-lifecycle audit row.
 * `actorRole`/`portal` are nullable to mirror the `AuditLog.actorRole`/`portal`
 * `String?` columns — an unrecognised caller still produces a valid (best-effort)
 * audit row rather than blocking the write.
 */
export interface AlertActorProvenance {
  actorRole: string | null;
  portal: string | null;
}

// Precedence: the highest-privilege realm role the caller holds wins, so a
// super_admin acting through any surface is attributed as super_admin (not the
// formerly hardcoded school_admin). Mirrors permissions.constants.ts role keys.
const ROLE_PRECEDENCE = ['super_admin', 'school_admin', 'teacher', 'parent'] as const;

const ROLE_PORTAL: Record<(typeof ROLE_PRECEDENCE)[number], string> = {
  super_admin: 'admin',
  school_admin: 'admin',
  teacher: 'teacher',
  parent: 'parent',
};

/**
 * Pure mapper from the authenticated caller's JWT to the audit provenance.
 * Reads realm roles exactly as PermissionsGuard does
 * (`jwt.realm_access?.roles ?? []`). When the caller holds none of the four
 * known roles, falls back to the first realm role string (or null) with a null
 * portal — never throws, so it is safe inside the best-effort audit path.
 */
export function deriveAlertActorProvenance(jwt: KeycloakJwtPayload): AlertActorProvenance {
  const realmRoles = jwt.realm_access?.roles ?? [];
  const primary = ROLE_PRECEDENCE.find((role) => realmRoles.includes(role));
  if (primary) {
    return { actorRole: primary, portal: ROLE_PORTAL[primary] };
  }
  return { actorRole: realmRoles[0] ?? null, portal: null };
}
