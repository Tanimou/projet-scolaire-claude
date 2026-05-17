import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';

import { AcademicYearsController } from './academic-years.controller';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';
import { ClassesController } from './classes.controller';
import { CyclesController } from './cycles.controller';
import { SchoolContextService } from './school-context.service';
import { SetupController } from './setup.controller';
import { StructureController } from './structure.controller';
import { SubjectsController } from './subjects.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    BrandingController,
    AcademicYearsController,
    CyclesController,
    SubjectsController,
    ClassesController,
    SetupController,
    StructureController,
  ],
  providers: [BrandingService, SchoolContextService],
  exports: [BrandingService, SchoolContextService],
})
export class SchoolStructureModule {}
