import { Module } from '@nestjs/common';

import { PrismaModule } from '../../shared/prisma/prisma.module';

import { GradesService } from './grades.service';

/**
 * Module exposant le calculateur de moyennes (`GradesService`).
 * Centralise la résolution des coefficients (3 niveaux) consommée par les
 * portails enseignant/parent, la génération de bulletins et l'analytics.
 */
@Module({
  imports: [PrismaModule],
  providers: [GradesService],
  exports: [GradesService],
})
export class GradesModule {}
