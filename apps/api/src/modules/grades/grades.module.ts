import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { StudentsModule } from '../students/students.module';
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
 *
 * S-E03-2 / `AC-1` / `ADR-071 §D1` — `StudentsModule` REJOINT les imports, et
 * ce n'est pas décoratif. `GradesController` résout désormais « cet appelant
 * peut-il lire cet élève ? » par `StudentAccessService`, exporté par
 * `StudentsModule`. SANS cet import, Nest échoue AU BOOTSTRAP
 * (`Nest can't resolve dependencies of the GradesController`) : une panne
 * TOTALE de l'API, pas un test rouge — la panne exacte que le docblock de
 * `students.module.ts` enregistre. Le fournir localement dans `providers:`
 * reproduirait la copie que cette tranche supprime.
 *
 * CYCLE-LIBRE, vérifié ce run : `StudentsModule` n'importe que `AuthModule`,
 * `SchoolStructureModule` et `TeachingModule` ; aucun des trois n'importe
 * `GradesModule`. `StudentsModule` est un PUITS de ce graphe.
 */
@Module({
  imports: [AuthModule, PrismaModule, SchoolStructureModule, StudentsModule, TeachingModule],
  controllers: [AssessmentsController, GradesController],
  providers: [GradesService],
  exports: [GradesService],
})
export class GradesModule {}
