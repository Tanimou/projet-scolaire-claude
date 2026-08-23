import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NOTIFICATION_CADENCE } from '@pilotage/contracts';
import type { NotificationCadence, NotificationKind } from '@prisma/client';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';

import { NOTIFICATION_KINDS, NotificationPreferencesService } from './preferences.service';

/**
 * S-E05-17 / ADR-067 §D1 — le pipe qui ferme PF-314 et la clause 3 de PF-51.
 *
 * POURQUOI UN PIPE ET PAS UNE GARDE DANS LE HANDLER. `:kind` arrivait annoté
 * `string`, donc `ValidationPipe.toValidate()` rendait `false` et le pipe global
 * de `main.ts` était SAUTÉ — pas indulgent, sauté (le mécanisme exact
 * qu'ADR-064 documente pour la clause 1). La chaîne brute atteignait
 * `findUnique({ where: { userProfileId_kind } })` et Prisma répondait par une
 * `PrismaClientValidationError` remontée en 500 nu (mesuré). Un pipe refuse
 * AVANT le corps du handler et avant `ensureUser`.
 *
 * PORTÉE HONNÊTE DE LA PHASE « PIPE ». Nest ordonne guards -> pipes -> handler.
 * `PermissionsGuard` lit donc la base AVANT ce pipe
 * (`permissions.guard.ts` -> `effectivePermissions`). La revendication exacte
 * est « avant le corps du handler et avant `ensureUser` », jamais « avant toute
 * lecture SQL ». Conséquence utile : un appelant sans `profile.write.self`
 * reçoit 403, pas 400 — le pipe ne peut pas servir d'oracle d'énumération à
 * une session non autorisée.
 *
 * L'ALLOWLIST EST L'ENSEMBLE EXPOSÉ, PAS L'ENUM PRISMA. `NOTIFICATION_KINDS`
 * est la MÊME constante que `listForUser` rend : accepté en écriture ==
 * visible en lecture, par construction. `remediation` (9e valeur Prisma) est
 * donc refusé en 400 — c'est PF-314, et c'est voulu (ADR-067 §D1).
 *
 * `isEnum` de Nest fait `Object.keys(enumType).map(k => enumType[k]).includes(v)`,
 * donc un TABLEAU nu convient : `Object.keys(['a'])` vaut `['0']`, dont la valeur
 * est `'a'`. C'est l'idiome déjà en place à `alerts.controller.ts` pour
 * `RULE_CODES`, pas une nouvelle décision d'architecture.
 *
 * LE MESSAGE EST EN FRANÇAIS, ET C'EST FONCTIONNEL. Le message par défaut de
 * `ParseEnumPipe` est `Validation failed (enum string is expected)`.
 * `api-client.ts` restitue les corps d'`ApiError` TELS QUELS, et
 * `PreferencesPanel.tsx` les rend bruts dans une bannière `role="alert"`
 * concaténée à « — le réglage n'a pas pu être enregistré, réessayez. ». Le
 * défaut expédierait donc une phrase anglaise dans une UI française SUIVIE d'un
 * conseil FAUX : un 400 sur un enum inconnu ne réussira jamais au réessai.
 *
 * La fabrique rend une CONSTANTE : aucune interpolation de `kind` (ce serait un
 * chemin d'entrée non validée réfléchie dans une région `role="alert"`), aucune
 * énumération des 8 valeurs (détail d'API sur un écran où l'utilisateur n'a
 * jamais choisi la valeur), aucune branche `NODE_ENV` (DNC-10).
 */
class UpdatePreferenceDto {
  @IsOptional() @IsBoolean() inAppEnabled?: boolean;
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsBoolean() pushEnabled?: boolean;
  // E5-S2 — per-kind email cadence. Validated against the shared contract enum so
  // an unknown value is rejected before it reaches the service / gate.
  @IsOptional() @IsIn(NOTIFICATION_CADENCE) cadence?: NotificationCadence;
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('notifications/preferences')
export class NotificationPreferencesController {
  constructor(
    private readonly prefs: NotificationPreferencesService,
    private readonly users: UserSyncService,
  ) {}

  /** Returns the full kind list, defaults merged with the user's overrides. */
  @Get()
  @RequiresPermission('profile.read.self')
  async list(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    return { data: await this.prefs.listForUser({ tenantId: me.tenantId, userProfileId: me.id }) };
  }

  @Patch(':kind')
  @RequiresPermission('profile.write.self')
  async update(
    // Le pipe est INLINE, pas derriere une fabrique locale : l'allowlist doit
    // se lire SUR le parametre lui-meme, aussi bien pour un relecteur que pour
    // le cliquet `enum-route-input-gate.spec.ts`. Meme idiome qu'
    // `alerts.controller.ts` pour `RULE_CODES`.
    @Param(
      'kind',
      new ParseEnumPipe(NOTIFICATION_KINDS as unknown as { [k: string]: NotificationKind }, {
        exceptionFactory: () => new BadRequestException('Type de notification inconnu.'),
      }),
    )
    kind: NotificationKind,
    @Body() dto: UpdatePreferenceDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    return this.prefs.update({
      tenantId: me.tenantId,
      userProfileId: me.id,
      kind,
      patch: dto,
    });
  }
}
