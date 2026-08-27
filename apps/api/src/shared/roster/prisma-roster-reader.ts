import type { RosterReader } from '@pilotage/contracts';
import type { PrismaClient } from '@prisma/client';

/**
 * S-E03-7 / PF-36 / ADR-079 — l'adaptateur qui branche le port framework-free
 * `RosterReader` (dans `@pilotage/contracts`) sur le vrai délégué Prisma.
 *
 * Il existe pour UNE raison, la même que son frère
 * `prisma-academic-year-reader.ts` : `@pilotage/contracts` est aussi consommé
 * par `apps/web` et n'aura JAMAIS `@prisma/client` en dépendance (GUARDRAILS
 * §2). La dérivation canonique construit donc le `where` ; cette fonction —
 * trois lignes, AUCUNE décision — le passe à Prisma.
 *
 * Le client est rétréci STRUCTURELLEMENT (`Pick<PrismaClient, 'enrollment'>`),
 * exactement comme `packages/imports-core/src/caches.ts:11` : c'est ce qui laisse
 * `PrismaService`, un `Prisma.TransactionClient` ou n'importe quel client
 * satisfaire le port sans que la dérivation sache sur quelle connexion elle
 * tourne.
 *
 * ⚠ Aucune décision de PORTÉE n'est prise ici. `tenantId`, la population et la
 * portée d'année arrivent DANS le `where` construit par le contrat, dont le type
 * exige `tenantId` (ADR-070 §D3 / FR-7). Ajouter ici une clause « par
 * commodité » recréerait un second foyer de vérité — la dérive que cette
 * tranche ferme.
 */
export function prismaRosterReader(prisma: Pick<PrismaClient, 'enrollment'>): RosterReader {
  return {
    findMany: (args) =>
      prisma.enrollment.findMany(args) as Promise<
        Array<{ studentId: string; classSectionId: string }>
      >,
  };
}
