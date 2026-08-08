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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CalendarEventScope, CalendarEventType, CalendarEventVisibility } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  type ClientHintsRequest,
  extractAuditClientHints,
} from '../../shared/audit/client-hints';
import { deriveAlertActorProvenance } from '../../shared/audit/provenance';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { SchoolContextService } from '../school-structure/school-context.service';
import { StudentAccessService } from '../students/student-access.service';

import { CalendarSeedService } from './calendar-seed.service';
import { MAX_SEED_YEAR, MIN_SEED_YEAR } from './french-holidays';

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

/**
 * Corps de `POST /calendar/events/seed-french-holidays`.
 *
 * `year` est **REQUIS** : toute la cascade de replis serveur (année scolaire
 * active → `startDate.getFullYear()`, puis `new Date().getFullYear()`) est
 * SUPPRIMÉE, pas gardée. Le repli *était* l'hypothèse — c'est la moitié
 * « année périmée » de PF-29 — et un 400 sur une année absente vaut mieux que
 * 22 lignes dans la mauvaise année. Changement cassant pour un seul appelant
 * (`apps/web/src/app/admin/calendar/actions.ts`), modifié dans la même PR.
 *
 * Validation à l'idiome de la maison (`classes.controller.ts`, `cycles.controller.ts`) :
 * `@IsInt() @Min() @Max()` **sans** `@Type(() => Number)`. La `ValidationPipe`
 * globale tourne en `transform: true` **sans** `enableImplicitConversion`, donc
 * un nombre JSON arrive déjà en `number` — et `@Type(() => Number)` ferait
 * silencieusement accepter `{"year":"2026"}`, soit l'inverse de l'intention de
 * PF-51. Ferme la famille PF-51 sur ce DTO : `{year:'abc'}` et `{year:1e9}`
 * renvoient 400 au lieu de produire une `Invalid Date` puis un 500 opaque.
 */
export class SeedHolidaysDto {
  @IsInt() @Min(MIN_SEED_YEAR) @Max(MAX_SEED_YEAR) year!: number;
  /** Jamais défaillé côté serveur : son absence est un refus (DNC-12). */
  @IsOptional() @IsBoolean() confirm?: boolean;
  /** Simulation : même lecture, même forme de réponse, aucune écriture. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
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
    private readonly seed: CalendarSeedService,
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
   * Importe les jours fériés français des DEUX années civiles `year` et
   * `year + 1` (11 + 11 = 22 événements), de façon idempotente.
   *
   * S-E06-6 / PF-29 — le contrôle écrivait en masse sans rien demander et sans
   * nommer son périmètre. Désormais :
   * - `confirm: true` est exigé **côté serveur** (donc un `curl` y est soumis),
   * - `dryRun: true` renvoie le même plan sans rien écrire, et l'UI construit sa
   *   confirmation EXCLUSIVEMENT depuis cette réponse (DNC-06 rendu
   *   structurellement impossible plutôt que relu),
   * - `year` est requis (plus aucun repli sur l'année scolaire active),
   * - tout l'import + UNE ligne d'audit tiennent dans une seule transaction.
   *
   * IP / user-agent — S-E04-3. Ce handler capturait `@Ip()` + `@Headers('user-agent')`
   * lui-même : sur le chemin piloté par l'UI, `@Ip()` valait l'adresse du
   * conteneur `web` (identique pour tous les acteurs, à jamais — PF-31) et
   * `undici` n'envoyait aucun user-agent du navigateur. Les deux valeurs passent
   * désormais par L'UNIQUE point d'extraction `extractAuditClientHints`, qui
   * applique la règle d'ADR-036 (jeton de transfert vérifié en temps constant,
   * ou `null` — jamais l'adresse du relais) et rend des valeurs DÉJÀ assainies :
   * le service reçoit la même forme qu'avant, donc un cast `inet` raté ne peut
   * toujours pas faire rouler en arrière la transaction qu'il audite (S-E06-6).
   *
   * Aucun intercepteur partagé n'est construit : la décision de S-E04-1 tient,
   * chaque site appelle le seam explicitement, et l'ensemble reste greppable.
   */
  @Post('events/seed-french-holidays')
  @RequiresPermission('calendar.write')
  async seedFrenchHolidays(
    @Body() body: SeedHolidaysDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    // Rôle et portail DÉRIVÉS du JWT (helper partagé, déjà importé par
    // messaging / remediation / *-exports) — jamais le rôle « admin d'école »
    // codé en dur des autres sites d'audit : un super_admin s'audite super_admin.
    const { actorRole, portal } = deriveAlertActorProvenance(jwt);
    const { ipAddress, userAgent } = extractAuditClientHints(req);

    return this.seed.seedFrenchHolidays({
      tenantId: me.tenantId,
      schoolId,
      actorId: me.id,
      actorRole,
      portal,
      year: body.year,
      confirm: body.confirm === true,
      dryRun: body.dryRun === true,
      ipAddress,
      userAgent,
    });
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
