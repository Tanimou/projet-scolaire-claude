import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { TeachingModule } from '../teaching/teaching.module';

import { EnrollmentsController } from './enrollments.controller';

/**
 * S-E05-14 — `TeachingModule` est importé pour le SEUL `TeacherProfileService`
 * qu'il exporte déjà, forme identique à `AttendanceModule` / `LessonsModule`.
 * Aucun provider n'est ajouté ici, et `TeachingModule` n'est pas modifié.
 */
@Module({
  imports: [AuthModule, TeachingModule],
  controllers: [EnrollmentsController],
})
export class EnrollmentsModule {}
