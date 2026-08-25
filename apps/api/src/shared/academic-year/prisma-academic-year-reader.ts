import type { AcademicYearReader } from '@pilotage/contracts';
import type { PrismaClient } from '@prisma/client';

/**
 * S-E03-4 / ADR-070 — l'adaptateur qui branche le port framework-free
 * `AcademicYearReader` (dans `@pilotage/contracts`) sur le vrai délégué Prisma.
 *
 * Il existe pour UNE raison : `@pilotage/contracts` est aussi consommé par
 * `apps/web` et n'aura jamais `@prisma/client` en dépendance (GUARDRAILS §2).
 * Le résolveur canonique construit donc le `where` et l'ordre total, et cette
 * fonction — trois lignes, aucune décision — les passe à Prisma.
 *
 * Le client est rétréci STRUCTURELLEMENT (`Pick<PrismaClient, 'academicYear'>`),
 * exactement comme `packages/imports-core/src/caches.ts:11` : c'est ce qui laisse
 * `PrismaService`, un `Prisma.TransactionClient` ou n'importe quel client
 * satisfaire le port sans que le résolveur sache sur quelle connexion il tourne.
 *
 * Le worker a le SIEN (`apps/worker/src/shared/academic-year/`) : son
 * `tsconfig.json` fixe `rootDir: ./src`, donc rien sous `apps/api` ne lui est
 * importable. Deux adaptateurs de trois lignes, UNE seule règle de résolution.
 */
export function prismaAcademicYearReader(
  prisma: Pick<PrismaClient, 'academicYear'>,
): AcademicYearReader {
  return {
    findMany: (args) => prisma.academicYear.findMany(args),
  };
}
