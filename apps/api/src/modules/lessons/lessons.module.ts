import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { StudentsModule } from '../students/students.module';
import { TeachingModule } from '../teaching/teaching.module';

import { LessonsController } from './lessons.controller';

/**
 * S-E03-2 / `AC-2` / `ADR-071 §D1` — `StudentsModule` REJOINT les imports.
 *
 * `LessonsController.list` résout désormais son garde `?studentId=` par
 * `StudentAccessService` (exporté par `StudentsModule`) au lieu d'une chaîne
 * privée qui ne contrôlait QUE les appelants portant le rôle `parent`. Sans
 * cet import, Nest échoue AU BOOTSTRAP — panne TOTALE de l'API, pas un test
 * rouge (voir le docblock de `students.module.ts`).
 *
 * CYCLE-LIBRE : `StudentsModule` n'importe que `AuthModule`,
 * `SchoolStructureModule` et `TeachingModule`, dont aucun n'importe
 * `LessonsModule`. `PrismaModule` est GLOBAL, d'où son absence ici.
 */
@Module({
  imports: [AuthModule, StudentsModule, TeachingModule],
  controllers: [LessonsController],
})
export class LessonsModule {}
