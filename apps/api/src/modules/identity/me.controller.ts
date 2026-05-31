import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { PrismaService } from '../../shared/prisma/prisma.service';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';

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

// ---------------------------------------------------------------------------
// Self-service profile (R8.3) — fields a user may edit about themselves.
// firstName / lastName / email stay administration-managed; here we expose the
// soft, self-owned bits: phone (UserProfile column), specialty (TeacherProfile
// column, teachers only) and a free-text bio stored in preferences.profile.bio
// (no schema change — same JSON-bag pattern as display preferences).
// ---------------------------------------------------------------------------

class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) specialty?: string;
  @IsOptional() @IsString() @MaxLength(600) bio?: string;
}

export interface SelfProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  photoUrl: string | null;
  bio: string | null;
  isTeacher: boolean;
  specialty: string | null;
  hiredAt: string | null;
  externalRef: string | null;
}

type TeacherProfileBits = {
  specialty: string | null;
  hiredAt: Date | null;
  externalRef: string | null;
} | null;

/** Trim a free-text field; an empty/blank string clears the value to null. */
function cleanText(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBio(prefs: Record<string, unknown>): string | null {
  const profile = prefs.profile;
  if (profile && typeof profile === 'object') {
    const bio = (profile as Record<string, unknown>).bio;
    if (typeof bio === 'string' && bio.trim().length > 0) return bio;
  }
  return null;
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

  @Get()
  @ApiOkResponse({ description: 'Current user — provisioned on first call.' })
  async me(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const user = await this.users.ensureUser(jwt);
    const realmRoles = jwt.realm_access?.roles ?? [];
    const permissions = await this.users.listPermissions(jwt.sub, realmRoles);

    const prefs = (user.preferences as Record<string, unknown> | null) ?? {};
    const display = normalizeDisplay(prefs.display);
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
      mfaEnabled: false,
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

  /** Returns the current user's self-editable profile (contact, specialty, bio). */
  @Get('profile')
  @RequiresPermission('profile.read.self')
  async getProfile(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const user = await this.users.ensureUser(jwt);
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userProfileId: user.id },
      select: { specialty: true, hiredAt: true, externalRef: true },
    });
    return { data: this.buildSelfProfile(user, teacher) };
  }

  /**
   * Update the self-editable profile fields. `phone` and `bio` apply to any
   * user; `specialty` is persisted only when the caller has a TeacherProfile
   * (silently ignored otherwise so non-teachers can't fabricate one). An empty
   * string clears the field. Omitted fields are left untouched.
   */
  @Patch('profile')
  @RequiresPermission('profile.write.self')
  async updateProfile(
    @Body() dto: UpdateProfileDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const user = await this.users.ensureUser(jwt);
    const prefs = (user.preferences as Record<string, unknown> | null) ?? {};

    const phone = cleanText(dto.phone);
    const bio = cleanText(dto.bio);

    const userData: Prisma.UserProfileUpdateInput = {};
    if (phone !== undefined) userData.phone = phone;
    if (bio !== undefined) {
      const profile = (prefs.profile && typeof prefs.profile === 'object'
        ? (prefs.profile as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      userData.preferences = { ...prefs, profile: { ...profile, bio } } as Prisma.InputJsonValue;
    }
    if (Object.keys(userData).length > 0) {
      await this.prisma.userProfile.update({ where: { id: user.id }, data: userData });
    }

    let teacher = await this.prisma.teacherProfile.findUnique({
      where: { userProfileId: user.id },
      select: { specialty: true, hiredAt: true, externalRef: true },
    });

    const specialty = cleanText(dto.specialty);
    if (specialty !== undefined && teacher) {
      teacher = await this.prisma.teacherProfile.update({
        where: { userProfileId: user.id },
        data: { specialty },
        select: { specialty: true, hiredAt: true, externalRef: true },
      });
    }

    // Re-read the user so the response reflects the persisted phone/bio.
    const fresh = await this.prisma.userProfile.findUnique({ where: { id: user.id } });
    return { data: this.buildSelfProfile(fresh ?? user, teacher) };
  }

  private buildSelfProfile(
    user: { firstName: string; lastName: string; email: string; phone: string | null; photoUrl: string | null; preferences: unknown },
    teacher: TeacherProfileBits,
  ): SelfProfile {
    const prefs = (user.preferences as Record<string, unknown> | null) ?? {};
    return {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      photoUrl: user.photoUrl,
      bio: readBio(prefs),
      isTeacher: teacher !== null,
      specialty: teacher?.specialty ?? null,
      hiredAt: teacher?.hiredAt ? teacher.hiredAt.toISOString() : null,
      externalRef: teacher?.externalRef ?? null,
    };
  }
}
