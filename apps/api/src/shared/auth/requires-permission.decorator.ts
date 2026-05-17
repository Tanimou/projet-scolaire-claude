import { SetMetadata } from '@nestjs/common';

import { type PermissionCode } from './permissions.constants';

export const PERMISSIONS_META_KEY = 'pilotage:required-permissions';

/**
 * Marks a route as requiring one or more permission codes.
 * The user's effective permissions must include ALL listed codes (AND).
 *
 * Use with `JwtAuthGuard` then `PermissionsGuard`.
 *
 * @example
 *   @RequiresPermission('grades.publish')
 *   @Post(':id/publish')
 *   publish() { ... }
 */
export const RequiresPermission = (...codes: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_META_KEY, codes);
