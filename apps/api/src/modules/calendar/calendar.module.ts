import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { StudentAccessService } from '../students/student-access.service';

import { CalendarSeedService } from './calendar-seed.service';
import { CalendarController } from './calendar.controller';

@Module({
  imports: [AuthModule, SchoolStructureModule],
  controllers: [CalendarController],
  // `StudentAccessService` ne dépend que de `PrismaService` (module global), on
  // le fournit donc directement plutôt que d'importer tout `StudentsModule` —
  // cela évite tout risque de dépendance circulaire et de couplage de modules.
  // `CalendarSeedService` (S-E06-6) ne dépend lui aussi que de `PrismaService`.
  providers: [StudentAccessService, CalendarSeedService],
})
export class CalendarModule {}
