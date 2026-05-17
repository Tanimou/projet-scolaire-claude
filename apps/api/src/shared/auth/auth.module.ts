import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { PermissionsGuard } from './permissions.guard';
import { UserSyncService } from './user-sync.service';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'keycloak-jwt' })],
  providers: [JwtStrategy, JwtAuthGuard, PermissionsGuard, UserSyncService],
  exports: [JwtAuthGuard, PermissionsGuard, UserSyncService],
})
export class AuthModule {}
