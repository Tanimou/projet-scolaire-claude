import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { KeycloakJwtPayload } from './jwt.strategy';

/**
 * `@CurrentJwt()` injects the decoded Keycloak JWT payload into a controller arg.
 * Combine with `@UseGuards(JwtAuthGuard)` on the route.
 */
export const CurrentJwt = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): KeycloakJwtPayload => {
    const request = ctx.switchToHttp().getRequest<{ user?: KeycloakJwtPayload }>();
    if (!request.user) {
      throw new Error('CurrentJwt used without JwtAuthGuard');
    }
    return request.user;
  },
);
