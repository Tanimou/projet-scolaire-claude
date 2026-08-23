import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { TeachingModule } from '../teaching/teaching.module';

import { StudentAccessService } from './student-access.service';
import { StudentsController } from './students.controller';

/**
 * S-E05-16 / `PF-296` / `ADR-066 §D6` — `TeachingModule` REJOINT les imports,
 * et ce n'est pas décoratif.
 *
 * `StudentAccessService` ne dépendait que de `PrismaService` (module GLOBAL),
 * ce qui permettait à TROIS modules de le FOURNIR directement plutôt que de
 * l'importer. Cette tranche lui donne une SECONDE dépendance de constructeur
 * (`TeacherProfileService`, pour la résolution LECTURE SEULE du profil
 * enseignant, `AC-2`). Sans cet import, Nest échoue à résoudre le provider
 * AU BOOTSTRAP — pas à la requête : `Nest can't resolve dependencies of the
 * StudentAccessService (PrismaService, ?)`, c'est-à-dire une panne TOTALE, pas
 * un test rouge.
 *
 * Vérifié CYCLE-LIBRE ce run : `TeachingModule` n'importe que `AuthModule` et
 * `SchoolStructureModule`, et aucun des deux n'importe `StudentsModule`.
 * `TeachingModule` exporte déjà `TeacherProfileService` ; il n'est PAS modifié.
 */
@Module({
  imports: [AuthModule, SchoolStructureModule, TeachingModule],
  controllers: [StudentsController],
  providers: [StudentAccessService],
  exports: [StudentAccessService],
})
export class StudentsModule {}
