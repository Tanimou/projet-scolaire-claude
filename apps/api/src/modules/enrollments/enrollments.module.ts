import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { StudentAccessService } from '../students/student-access.service';
import { TeachingModule } from '../teaching/teaching.module';

import { EnrollmentsController } from './enrollments.controller';

/**
 * S-E05-14 — `TeachingModule` est importé pour le SEUL `TeacherProfileService`
 * qu'il exporte déjà, forme identique à `AttendanceModule` / `LessonsModule`.
 * Aucun provider n'est ajouté ici, et `TeachingModule` n'est pas modifié.
 *
 * S-E05-15 — `StudentAccessService` est fourni LOCALEMENT (mur PARENT de
 * `list`, `GUARDRAILS §2` / `ADR-015` / `ADR-021`), et non obtenu en important
 * `StudentsModule` : ce service ne dépend que de `PrismaService`, qui est un
 * module GLOBAL. Précédent maison exact et déjà commenté pour cette raison :
 * `calendar.module.ts:13-17`. Importer `StudentsModule` attacherait
 * `EnrollmentsModule` à `StudentsModule` — et donc à `SchoolStructureModule` —
 * pour un seul provider sans état.
 *
 * `StudentsModule` continue d'exporter le même service pour ses autres
 * consommateurs ; il n'est PAS modifié, et aucune instance partagée n'est
 * attendue (le service est sans état : il ne fait que lire).
 */
@Module({
  imports: [AuthModule, TeachingModule],
  controllers: [EnrollmentsController],
  providers: [StudentAccessService],
})
export class EnrollmentsModule {}
