import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Default authentication guard: validates the Keycloak JWT
 * via the strategy registered under name 'keycloak-jwt'.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('keycloak-jwt') {
  override canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
