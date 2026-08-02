import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { TeachingModule } from '../teaching/teaching.module';

import { AssessmentsController } from './assessments.controller';
import { GradesController } from './grades.controller';
import { GradesService } from './grades.service';

/**
 * Module exposant le calculateur de moyennes (`GradesService`) ET la surface
 * REST de notation enseignant : création d'évaluations (`/api/v1/assessments/*`)
 * et saisie/batch/gradebook des notes (`/api/v1/grades/*`).
 *
 * `controllers` est garanti par `grades.module.spec.ts` : le refactor 3341ed0
 * (2026-06-01) avait supprimé la ligne en même temps qu'il exposait
 * `GradesService` au dashboard parent, ce qui a démonté toute la surface de
 * notation (404 routeur) sans faire échouer un seul test unitaire. Ne pas
 * retirer les contrôleurs d'ici sans déplacer le garde-fou avec eux.
 */
@Module({
  imports: [AuthModule, PrismaModule, SchoolStructureModule, TeachingModule],
  controllers: [AssessmentsController, GradesController],
  providers: [GradesService],
  exports: [GradesService],
})
export class GradesModule {}
