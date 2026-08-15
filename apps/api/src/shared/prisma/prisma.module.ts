import { Global, Module } from '@nestjs/common';

import { AppRolePrismaService } from './app-role-prisma.service';
import { PrismaService } from './prisma.service';
import { TenantScopeService } from './tenant-scope.service';

/**
 * S-E01-1d — la couture de portée tenant vit ICI, dans le module `@Global()`
 * qui porte déjà l'accès base, et PAS dans un nouveau `shared/tenant/`.
 *
 * C'est une réutilisation de convention documentée plutôt qu'une décision
 * transversale de plus : ADR-035 a déjà tranché contre l'obligation faite à
 * ~26 modules d'importer un nouveau module partagé. `PrismaModule` étant
 * `@Global()`, un module qui convertit ses sites d'appel n'a RIEN à câbler.
 *
 * `AppRolePrismaService` est fourni ici mais injecté NULLE PART ailleurs que
 * dans `TenantScopeService` : c'est la preuve structurelle qu'AC-4 demande — la
 * seconde connexion n'est atteignable que par la couture, jamais par un module
 * qui l'attraperait au passage.
 */
@Global()
@Module({
  providers: [PrismaService, AppRolePrismaService, TenantScopeService],
  exports: [PrismaService, TenantScopeService],
})
export class PrismaModule {}
