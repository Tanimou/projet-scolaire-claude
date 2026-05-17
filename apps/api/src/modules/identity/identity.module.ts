import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';

import { InviteController } from './invite.controller';
import { MeController } from './me.controller';
import { RegisterController } from './register.controller';
import { RolesController } from './roles.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [MeController, UsersController, RolesController, InviteController, RegisterController],
  providers: [UsersService],
})
export class IdentityModule {}
