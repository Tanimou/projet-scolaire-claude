import type { AcademicYearReader } from '@pilotage/contracts';
import type { PrismaClient } from '@prisma/client';

/**
 * S-E03-4 / ADR-070 — le jumeau worker de
 * `apps/api/src/shared/academic-year/prisma-academic-year-reader.ts`.
 *
 * Il branche le port framework-free `AcademicYearReader` (dans
 * `@pilotage/contracts`) sur le vrai délégué Prisma. Il est DUPLIQUÉ, et ce
 * n'est pas un oubli : `apps/worker/tsconfig.json` fixe `rootDir: ./src`, donc
 * rien sous `apps/api` n'est importable ici, et `@pilotage/contracts` ne peut
 * pas héberger l'adaptateur puisqu'il n'aura jamais `@prisma/client` en
 * dépendance (`apps/web` le consomme aussi — GUARDRAILS §2).
 *
 * Ce qui est dupliqué est trois lignes SANS décision : le `where`, l'ordre total
 * et la politique d'absence vivent tous dans le résolveur canonique, en un seul
 * exemplaire. Le client est rétréci structurellement
 * (`Pick<PrismaClient, 'academicYear'>`), comme `packages/imports-core/src/caches.ts:11`.
 */
export function prismaAcademicYearReader(
  prisma: Pick<PrismaClient, 'academicYear'>,
): AcademicYearReader {
  return {
    findMany: (args) => prisma.academicYear.findMany(args),
  };
}
