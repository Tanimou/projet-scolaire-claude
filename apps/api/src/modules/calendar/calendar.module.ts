import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { StudentAccessService } from '../students/student-access.service';
import { TeachingModule } from '../teaching/teaching.module';

import { CalendarSeedService } from './calendar-seed.service';
import { CalendarController } from './calendar.controller';

@Module({
  imports: [AuthModule, SchoolStructureModule, TeachingModule],
  controllers: [CalendarController],
  // S-E05-16 / `PF-296` / `DNC-06` — CE COMMENTAIRE DISAIT UNE PRÉMISSE QUI
  // EST DEVENUE FAUSSE. Il affirmait que « `StudentAccessService` ne dépend que
  // de `PrismaService` (module global) », ce qui justifiait de le FOURNIR ici
  // plutôt que d'importer `StudentsModule`. Depuis `S-E05-16` le service dépend
  // AUSSI de `TeacherProfileService` (mur enseignant, `PF-288`) : `TeachingModule`
  // est donc ajouté aux `imports` ci-dessus, faute de quoi Nest échouerait à
  // résoudre ce provider AU BOOTSTRAP.
  // Le choix de fournir localement TIENT toujours — il évite de coupler
  // `CalendarModule` à `StudentsModule` (et donc à toute sa surface) pour un
  // service sans état qui ne fait que LIRE — mais il n'est plus GRATUIT : toute
  // nouvelle dépendance de constructeur devra être importée ici aussi.
  // `CalendarSeedService` (S-E06-6) ne dépend, lui, que de `PrismaService`.
  providers: [StudentAccessService, CalendarSeedService],
})
export class CalendarModule {}
