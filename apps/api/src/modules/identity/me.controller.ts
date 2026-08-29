import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { mfaRequiredByInvitePolicy } from '@pilotage/contracts';
import { IsIn, IsOptional } from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

const DISPLAY_DENSITIES = ['compact', 'cozy', 'spacious'] as const;
const DISPLAY_ACCENTS = ['default', 'blue', 'violet', 'emerald', 'rose', 'amber'] as const;
const DISPLAY_DATE_FORMATS = ['short', 'long', 'relative'] as const;
const DISPLAY_GRADE_FORMATS = ['twenty', 'percent', 'letter'] as const;

export type DisplayDensity = (typeof DISPLAY_DENSITIES)[number];
export type DisplayAccent = (typeof DISPLAY_ACCENTS)[number];
export type DisplayDateFormat = (typeof DISPLAY_DATE_FORMATS)[number];
export type DisplayGradeFormat = (typeof DISPLAY_GRADE_FORMATS)[number];

class UpdateDisplayPreferencesDto {
  @IsOptional() @IsIn(DISPLAY_DENSITIES as unknown as string[]) density?: DisplayDensity;
  @IsOptional() @IsIn(DISPLAY_ACCENTS as unknown as string[]) accent?: DisplayAccent;
  @IsOptional() @IsIn(DISPLAY_DATE_FORMATS as unknown as string[]) dateFormat?: DisplayDateFormat;
  @IsOptional() @IsIn(DISPLAY_GRADE_FORMATS as unknown as string[]) gradeFormat?: DisplayGradeFormat;
}

export interface DisplayPreferences {
  density: DisplayDensity;
  accent: DisplayAccent;
  dateFormat: DisplayDateFormat;
  gradeFormat: DisplayGradeFormat;
}

const DISPLAY_DEFAULTS: DisplayPreferences = {
  density: 'cozy',
  accent: 'default',
  dateFormat: 'short',
  gradeFormat: 'twenty',
};

function normalizeDisplay(raw: unknown): DisplayPreferences {
  const obj = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) ?? {};
  const pickOne = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  return {
    density: pickOne(obj.density, DISPLAY_DENSITIES, DISPLAY_DEFAULTS.density),
    accent: pickOne(obj.accent, DISPLAY_ACCENTS, DISPLAY_DEFAULTS.accent),
    dateFormat: pickOne(obj.dateFormat, DISPLAY_DATE_FORMATS, DISPLAY_DEFAULTS.dateFormat),
    gradeFormat: pickOne(obj.gradeFormat, DISPLAY_GRADE_FORMATS, DISPLAY_DEFAULTS.gradeFormat),
  };
}

@ApiTags('identity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('me')
export class MeController {
  constructor(
    private readonly users: UserSyncService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * L'utilisateur courant — provisionné au premier appel.
   *
   * S-E05-8 / PF-25 half (b) / ADR-082 §D2 — LES DEUX CHAMPS MFA, ET CE QU'ILS
   * AFFIRMENT EXACTEMENT :
   *
   * • `mfaEnabled: null` — « JAMAIS MESURÉ ». Ce n'est pas « désactivé ». Sur
   *   HEAD, ce champ était le littéral `false`, ce qui rendait le bloc « MFA
   *   actif » des pages de réglages inatteignable pour TOUT LE MONDE et
   *   affirmait un fait d'appareil que rien n'avait observé. Le mesurer exige un
   *   aller-retour vers l'API Admin de Keycloak SUR CE CHEMIN CHAUD (`/me` est
   *   lu `no-store` à quasi chaque page) : un N+1 contre Keycloak et un nouveau
   *   mode de panne pour `/me`. Délibérément non fait ici, enregistré PF-443.
   *   Cette tranche AVANCE donc la moitié (b) ; elle ne la ferme pas.
   *
   * • `mfaRequired` — POLITIQUE, ZÉRO E/S. Dérivé des rôles realm DÉJÀ présents
   *   dans le jeton de l'appelant par LA règle unique que
   *   `invite.controller.ts` applique (ADR-004). Aucune requête ajoutée, aucune
   *   lecture de base, aucun appel réseau : ni G-TENANT ni G-AUDIT ne sont
   *   déclenchés par ce champ. Il dit « la politique enrôle ce rôle », jamais
   *   « cet utilisateur a configuré son MFA » (PF-446).
   *
   * Aucun littéral booléen n'est assigné à l'un ou l'autre : R3 du cliquet
   * (`apps/api/src/shared/quality/auth-failure-classification-gate.spec.ts`) le
   * gèle à zéro sous tout `apps/api/src`.
   */
  @Get()
  @ApiOkResponse({ description: 'Current user — provisioned on first call.' })
  async me(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const user = await this.users.ensureUser(jwt);
    const realmRoles = jwt.realm_access?.roles ?? [];
    const permissions = await this.users.listPermissions(jwt.sub, realmRoles);

    const prefs = (user.preferences as Record<string, unknown> | null) ?? {};
    const display = normalizeDisplay(prefs.display);
    // `boolean | null` est le DOMAINE du champ au contrat (`MeResponseSchema`) ;
    // la valeur ÉMISE est `null`, « jamais mesuré ». Le type est écrit ici pour
    // que la mesure future (PF-443) n'ait pas à élargir le type du contrôleur —
    // et pour qu'aucun littéral booléen ne réapparaisse à cette clé (R3).
    const mfaEnabled: boolean | null = null;
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: realmRoles,
      permissions,
      locale: user.locale,
      tenantId: user.tenantId,
      schoolId: (prefs.activeSchoolId as string | undefined) ?? null,
      mfaEnabled,
      mfaRequired: mfaRequiredByInvitePolicy(realmRoles),
      photoUrl: user.photoUrl,
      preferences: { ...prefs, display },
    };
  }

  /** Returns the current user's display preferences (server-side defaults filled in). */
  @Get('display-preferences')
  @RequiresPermission('profile.read.self')
  async getDisplayPreferences(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const user = await this.users.ensureUser(jwt);
    const prefs = (user.preferences as Record<string, unknown> | null) ?? {};
    return { data: normalizeDisplay(prefs.display) };
  }

  /** Update one or more display preferences (densité, accent, date format, grade format). */
  @Patch('display-preferences')
  @RequiresPermission('profile.write.self')
  async updateDisplayPreferences(
    @Body() dto: UpdateDisplayPreferencesDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const user = await this.users.ensureUser(jwt);
    const prefs = (user.preferences as Record<string, unknown> | null) ?? {};
    const current = normalizeDisplay(prefs.display);
    const next: DisplayPreferences = {
      density: dto.density ?? current.density,
      accent: dto.accent ?? current.accent,
      dateFormat: dto.dateFormat ?? current.dateFormat,
      gradeFormat: dto.gradeFormat ?? current.gradeFormat,
    };
    await this.prisma.userProfile.update({
      where: { id: user.id },
      data: { preferences: { ...prefs, display: { ...next } } },
    });
    return { data: next };
  }
}
