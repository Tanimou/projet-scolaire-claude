import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { type KeycloakJwtPayload } from './jwt.strategy';
import { type PermissionCode, REALM_ROLE_PERMISSIONS } from './permissions.constants';
import { PERMISSIONS_META_KEY } from './requires-permission.decorator';
import { UserSyncService } from './user-sync.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UserSyncService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionCode[] | undefined>(
      PERMISSIONS_META_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: KeycloakJwtPayload }>();
    const jwt = req.user;
    if (!jwt) throw new ForbiddenException('Missing JWT');

    const realmRoles = jwt.realm_access?.roles ?? [];
    const effective = await this.users.effectivePermissions(jwt.sub, realmRoles);
    const ok = required.every((code) => effective.has(code));
    if (!ok) {
      throw new ForbiddenException({
        message: 'Permission(s) refusée(s)',
        required,
        missing: required.filter((c) => !effective.has(c)),
      });
    }
    return true;
  }
}

/**
 * Convenience set: permission codes derived from a list of realm roles.
 * Re-exported so other modules can reuse the computation.
 */
export function permissionsFromRealmRoles(roles: string[]): Set<string> {
  const set = new Set<string>();
  for (const r of roles) {
    const list = REALM_ROLE_PERMISSIONS[r] ?? [];
    for (const p of list) set.add(p);
  }
  return set;
}
