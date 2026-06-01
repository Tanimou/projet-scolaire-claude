import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CalendarEventScope, CalendarEventType, CalendarEventVisibility } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { SchoolContextService } from '../school-structure/school-context.service';
import { StudentAccessService } from '../students/student-access.service';

/**
 * Construit le fragment de `where` Prisma qui applique l'ABAC de visibilité du
 * calendrier pour un rôle donné. Extrait comme fonction pure pour pouvoir être
 * testé unitairement (cf. `calendar.access.spec.ts`).
 *
 * - **admin** (super_admin / school_admin) : aucune restriction → `{}` (voit tout).
 * - **teacher** : `visibility ∈ {all, staff_only}` (jamais `admin_only`).
 * - **parent** : `visibility = all` ET portée pertinente, c.-à-d. soit un
 *   événement `school_wide`, soit un événement `class_section_scope` ciblant
 *   l'une des classes (`classSectionIds`) de ses enfants. Les portées
 *   intermédiaires (cycle / niveau) restent visibles tant qu'elles sont
 *   `visibility = all` — on ne masque que le bruit `class_section_scope` des
 *   autres classes. Les events `staff_only` / `admin_only` ne fuient jamais.
 *
 * `classSectionIds` n'est consulté que pour la branche parent.
 */
export function calendarVisibilityWhere(
  roles: string[],
  classSectionIds: string[],
): Record<string, unknown> {
  const isAdmin = roles.includes('super_admin') || roles.includes('school_admin');
  if (isAdmin) return {};

  const isStaff = roles.includes('teacher');
  if (isStaff) {
    return {
      visibility: { in: [CalendarEventVisibility.all, CalendarEventVisibility.staff_only] },
    };
  }

  // Parent : uniquement le public (`all`), restreint aux portées qui le concernent.
  return {
    visibility: CalendarEventVisibility.all,
    OR: [
      { scope: { not: CalendarEventScope.class_section_scope } },
      { classSectionId: { in: classSectionIds } },
    ],
  };
}

const FRENCH_PUBLIC_HOLIDAYS = (year: number): Array<{ title: string; date: string }> => {
  // Easter-anchored: Easter Monday & Pentecost Monday.
  const easter = computeEaster(year);
  const easterMonday = addDays(easter, 1);
  const pentecostMonday = addDays(easter, 50);
  const ascension = addDays(easter, 39);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return [
    { title: 'Jour de l’an', date: `${year}-01-01` },
    { title: 'Lundi de Pâques', date: iso(easterMonday) },
    { title: 'Fête du Travail', date: `${year}-05-01` },
    { title: 'Victoire 1945', date: `${year}-05-08` },
    { title: 'Ascension', date: iso(ascension) },
    { title: 'Lundi de Pentecôte', date: iso(pentecostMonday) },
    { title: 'Fête nationale', date: `${year}-07-14` },
    { title: 'Assomption', date: `${year}-08-15` },
    { title: 'Toussaint', date: `${year}-11-01` },
    { title: 'Armistice 1918', date: `${year}-11-11` },
    { title: 'Noël', date: `${year}-12-25` },
  ];
};

// Computus algorithm — returns Easter Sunday for a given Gregorian year.
function computeEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

class CreateCalendarEventDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsEnum(CalendarEventType) type!: CalendarEventType;
  @IsOptional() @IsEnum(CalendarEventScope) scope?: CalendarEventScope;
  @IsOptional() @IsEnum(CalendarEventVisibility) visibility?: CalendarEventVisibility;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsOptional() @IsBoolean() allDay?: boolean;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsUUID() academicYearId?: string;
  @IsOptional() @IsUUID() cycleId?: string;
  @IsOptional() @IsUUID() gradeLevelId?: string;
  @IsOptional() @IsUUID() classSectionId?: string;
}

class UpdateCalendarEventDto extends CreateCalendarEventDto {
  @IsOptional() @IsString() @MaxLength(200) override title!: string;
  @IsOptional() @IsEnum(CalendarEventType) override type!: CalendarEventType;
  @IsOptional() @IsDateString() override startsAt!: string;
  @IsOptional() @IsDateString() override endsAt!: string;
}

class SeedHolidaysDto {
  @IsOptional() year?: number;
}

@ApiTags('calendar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
    private readonly studentAccess: StudentAccessService,
  ) {}

  @Get('events')
  @RequiresPermission('calendar.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: CalendarEventType,
    @Query('academicYearId') academicYearId?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    const where: Record<string, unknown> = { tenantId: me.tenantId, schoolId };
    if (from || to) {
      where.startsAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }
    if (type) where.type = type;
    if (academicYearId) where.academicYearId = academicYearId;

    // ABAC de visibilité : l'admin voit tout, le teacher voit `all + staff_only`,
    // le parent ne voit que `all` ET les portées qui le concernent (événements
    // de l'école entière OU des classes de ses enfants). On résout les classes
    // des enfants UNIQUEMENT pour un parent (les autres rôles n'en ont pas besoin)
    // afin d'éviter une requête superflue. Empêche toute fuite des événements
    // staff_only / admin_only via l'endpoint de lecture, bien que chaque rôle
    // possède techniquement `calendar.read`.
    const roles = jwt.realm_access?.roles ?? [];
    const isPrivileged =
      roles.includes('super_admin') || roles.includes('school_admin') || roles.includes('teacher');
    const classSectionIds = isPrivileged
      ? []
      : await this.resolveParentClassSectionIds(me, jwt, schoolId);
    Object.assign(where, calendarVisibilityWhere(roles, classSectionIds));

    const events = await this.prisma.calendarEvent.findMany({
      where,
      orderBy: { startsAt: 'asc' },
      include: {
        cycle: { select: { name: true, code: true } },
        gradeLevel: { select: { name: true, code: true } },
        classSection: { select: { name: true } },
      },
    });
    return { data: events };
  }

  @Post('events')
  @RequiresPermission('calendar.write')
  async create(@Body() body: CreateCalendarEventDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    return this.createEvent(me, schoolId, body);
  }

  @Patch('events/:id')
  @RequiresPermission('calendar.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateCalendarEventDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const event = await this.prisma.calendarEvent.findUnique({ where: { id } });
    if (!event || event.tenantId !== me.tenantId) throw new NotFoundException();

    const startsAt = body.startsAt ? new Date(body.startsAt) : event.startsAt;
    const endsAt = body.endsAt ? new Date(body.endsAt) : event.endsAt;
    if (startsAt > endsAt) {
      throw new BadRequestException('startsAt doit être avant endsAt.');
    }

    return this.prisma.calendarEvent.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.scope !== undefined ? { scope: body.scope } : {}),
        ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
        ...(body.startsAt !== undefined ? { startsAt } : {}),
        ...(body.endsAt !== undefined ? { endsAt } : {}),
        ...(body.allDay !== undefined ? { allDay: body.allDay } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
        ...(body.cycleId !== undefined ? { cycleId: body.cycleId || null } : {}),
        ...(body.gradeLevelId !== undefined ? { gradeLevelId: body.gradeLevelId || null } : {}),
        ...(body.classSectionId !== undefined ? { classSectionId: body.classSectionId || null } : {}),
      },
    });
  }

  @Delete('events/:id')
  @RequiresPermission('calendar.write')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const event = await this.prisma.calendarEvent.findUnique({ where: { id } });
    if (!event || event.tenantId !== me.tenantId) throw new NotFoundException();
    await this.prisma.calendarEvent.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Seed the 11 standard French public holidays for a given year, idempotent (skips duplicates).
   * Defaults to the year covering the currently-active academic year.
   */
  @Post('events/seed-french-holidays')
  @RequiresPermission('calendar.write')
  async seedFrenchHolidays(@Body() body: SeedHolidaysDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId, activeAcademicYearId } = await this.ctx.forTenant(me.tenantId);

    let year = body.year;
    if (!year && activeAcademicYearId) {
      const ay = await this.prisma.academicYear.findUnique({ where: { id: activeAcademicYearId } });
      year = ay?.startDate.getFullYear();
    }
    if (!year) year = new Date().getFullYear();

    const holidays = FRENCH_PUBLIC_HOLIDAYS(year).concat(FRENCH_PUBLIC_HOLIDAYS(year + 1));

    let created = 0;
    let skipped = 0;
    for (const h of holidays) {
      const start = new Date(`${h.date}T00:00:00Z`);
      const end = new Date(`${h.date}T23:59:59Z`);
      // Skip if same title+date already exists for this school
      const dup = await this.prisma.calendarEvent.findFirst({
        where: { schoolId, title: h.title, startsAt: start },
      });
      if (dup) {
        skipped += 1;
        continue;
      }
      await this.prisma.calendarEvent.create({
        data: {
          tenantId: me.tenantId,
          schoolId,
          academicYearId: activeAcademicYearId ?? undefined,
          type: 'public_holiday',
          scope: 'school_wide',
          visibility: 'all',
          title: h.title,
          startsAt: start,
          endsAt: end,
          allDay: true,
          color: 'oklch(0.68 0.18 25)',
          icon: 'Flag',
          createdBy: me.id,
        },
      });
      created += 1;
    }
    return { ok: true, created, skipped, year };
  }

  /**
   * Renvoie les `classSectionId` des classes actives des enfants du parent.
   * Réutilise `StudentAccessService.scopeForUser` pour obtenir les `studentIds`
   * autorisés, puis lit leurs inscriptions (`Enrollment`) actives. Renvoie un
   * tableau vide si le parent n'a aucun enfant ou aucune inscription active —
   * `calendarVisibilityWhere` se rabat alors sur les seuls événements
   * `school_wide`, ce qui est le comportement de repli sûr.
   */
  private async resolveParentClassSectionIds(
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
    schoolId: string,
  ): Promise<string[]> {
    const scope = await this.studentAccess.scopeForUser(me, jwt, schoolId);
    // `studentIds: null` = aucune restriction (admin/teacher) : non concerné ici.
    if (scope.studentIds === null || scope.studentIds.length === 0) return [];

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        tenantId: me.tenantId,
        status: 'active',
        studentId: { in: scope.studentIds },
      },
      select: { classSectionId: true },
    });

    // Dédoublonne (plusieurs enfants peuvent partager une classe).
    return [...new Set(enrollments.map((e) => e.classSectionId))];
  }

  private async createEvent(
    me: { id: string; tenantId: string },
    schoolId: string,
    body: CreateCalendarEventDto,
  ) {
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (startsAt > endsAt) {
      throw new BadRequestException('startsAt doit être avant endsAt.');
    }
    // Validate scope consistency: if a scoped id is provided, scope must match.
    if (body.classSectionId && body.scope && body.scope !== 'class_section_scope') {
      throw new BadRequestException("scope doit être 'class_section_scope' si classSectionId est fourni.");
    }
    if (body.gradeLevelId && body.scope && body.scope !== 'grade_level_scope') {
      throw new BadRequestException("scope doit être 'grade_level_scope' si gradeLevelId est fourni.");
    }
    if (body.cycleId && body.scope && body.scope !== 'cycle_scope') {
      throw new BadRequestException("scope doit être 'cycle_scope' si cycleId est fourni.");
    }

    const finalScope =
      body.scope ??
      (body.classSectionId
        ? CalendarEventScope.class_section_scope
        : body.gradeLevelId
          ? CalendarEventScope.grade_level_scope
          : body.cycleId
            ? CalendarEventScope.cycle_scope
            : CalendarEventScope.school_wide);

    return this.prisma.calendarEvent.create({
      data: {
        tenantId: me.tenantId,
        schoolId,
        academicYearId: body.academicYearId,
        type: body.type,
        scope: finalScope,
        visibility: body.visibility ?? CalendarEventVisibility.all,
        title: body.title,
        description: body.description,
        startsAt,
        endsAt,
        allDay: body.allDay ?? true,
        color: body.color,
        icon: body.icon,
        cycleId: body.cycleId,
        gradeLevelId: body.gradeLevelId,
        classSectionId: body.classSectionId,
        createdBy: me.id,
      },
    });
  }
}
