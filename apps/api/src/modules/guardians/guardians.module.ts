import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';

import { GuardiansController } from './guardians.controller';

@Module({
  imports: [AuthModule, SchoolStructureModule],
  controllers: [GuardiansController],
})
export class GuardiansModule {}
