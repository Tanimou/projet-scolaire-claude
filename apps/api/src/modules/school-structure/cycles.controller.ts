import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, MinLength, Min } from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { SchoolContextService } from './school-context.service';

class CreateCycleDto {
  @IsString() @MinLength(2) @MaxLength(40) code!: string;
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsInt() @Min(0) orderIndex!: number;
  @IsOptional() @IsString() @MaxLength(60) color?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
}

class UpdateCycleDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsInt() @Min(0) orderIndex?: number;
  @IsOptional() @IsString() @MaxLength(60) color?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
}

class GradeLevelDto {
  @IsString() @MinLength(1) @MaxLength(20) code!: string;
  @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @IsInt() @Min(0) orderIndex!: number;
}

/**
 * S-E05-13 / PF-51 / ADR-064 — the PATCH body of a grade level, as a CLASS.
 *
 * WHY A CLASS AND NOT `Partial<GradeLevelDto>` (the mechanism, measured — not
 * inferred)
 * ---------------------------------------------------------------------------
 * `packages/tsconfig/node.json` sets `emitDecoratorMetadata: true`, so the
 * compiler writes the parameter types of every decorated handler into
 * `design:paramtypes`. A CLASS survives that emission as itself; a TYPE
 * EXPRESSION does not — `Partial<T>`, an `interface`, a union and a `type` alias
 * all erase to `Object`. The shipped artefact said so out loud before this
 * slice: `apps/api/dist/modules/school-structure/cycles.controller.js` carried
 *
 *     createGradeLevel → __metadata('design:paramtypes', [String, GradeLevelDto, Object])
 *     updateGradeLevel → __metadata('design:paramtypes', [String, Object,        Object])
 *
 * and Nest's `ValidationPipe.toValidate()` returns `false` for a metatype of
 * `Object`, handing the body back RAW. So the global
 * `{ transform, whitelist, forbidNonWhitelisted }` pipe configured at
 * `apps/api/src/main.ts:141-145` was not *lenient* on this route — it was
 * SKIPPED. Restoring a class restores the pipe; nothing else had to change for
 * an unknown key to become a 400.
 *
 * The bounds are copied VERBATIM from `GradeLevelDto` above. Nothing is
 * tightened: a PATCH that refuses what the POST accepts would be a new
 * inconsistency, not a hardening.
 */
class UpdateGradeLevelDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20) code?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) name?: string;
  @IsOptional() @IsInt() @Min(0) orderIndex?: number;
}

@ApiTags('school-structure')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('cycles')
export class CyclesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
  ) {}

  @Get()
  @RequiresPermission('classes.read')
  async list(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    const cycles = await this.prisma.cycle.findMany({
      where: { schoolId },
      orderBy: { orderIndex: 'asc' },
      include: {
        gradeLevels: { orderBy: { orderIndex: 'asc' } },
        _count: { select: { gradeLevels: true } },
      },
    });
    return { data: cycles };
  }

  @Post()
  @RequiresPermission('cycles.write')
  async create(@Body() body: CreateCycleDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    const dup = await this.prisma.cycle.findUnique({ where: { schoolId_code: { schoolId, code: body.code } } });
    if (dup) throw new ConflictException(`Un cycle « ${body.code} » existe déjà.`);
    return this.prisma.cycle.create({
      data: { tenantId: me.tenantId, schoolId, ...body },
    });
  }

  @Patch(':id')
  @RequiresPermission('cycles.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateCycleDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const cycle = await this.prisma.cycle.findUnique({ where: { id } });
    if (!cycle || cycle.tenantId !== me.tenantId) throw new NotFoundException('Cycle introuvable');
    return this.prisma.cycle.update({ where: { id }, data: body });
  }

  @Delete(':id')
  @RequiresPermission('cycles.write')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const cycle = await this.prisma.cycle.findUnique({
      where: { id },
      include: { _count: { select: { gradeLevels: true } } },
    });
    if (!cycle || cycle.tenantId !== me.tenantId) throw new NotFoundException();
    if (cycle._count.gradeLevels > 0) {
      throw new BadRequestException(
        `Ce cycle contient ${cycle._count.gradeLevels} niveau(x). Supprimez d'abord les niveaux.`,
      );
    }
    await this.prisma.cycle.delete({ where: { id } });
    return { ok: true };
  }

  /* ----- Grade levels (nested) ----- */

  @Post(':id/grade-levels')
  @RequiresPermission('grade_levels.write')
  async createGradeLevel(
    @Param('id', ParseUUIDPipe) cycleId: string,
    @Body() body: GradeLevelDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const cycle = await this.prisma.cycle.findUnique({ where: { id: cycleId } });
    if (!cycle || cycle.tenantId !== me.tenantId) throw new NotFoundException('Cycle introuvable');

    const dup = await this.prisma.gradeLevel.findUnique({
      where: { schoolId_code: { schoolId: cycle.schoolId, code: body.code } },
    });
    if (dup) throw new ConflictException(`Un niveau « ${body.code} » existe déjà dans l'école.`);

    return this.prisma.$transaction(async (tx) => {
      const level = await tx.gradeLevel.create({
        data: {
          tenantId: me.tenantId,
          schoolId: cycle.schoolId,
          cycleId,
          code: body.code,
          name: body.name,
          orderIndex: body.orderIndex,
        },
      });
      // Auto-create coefficients with subject defaults so the matrix is never blank
      const subjects = await tx.subject.findMany({ where: { schoolId: cycle.schoolId, active: true } });
      for (const s of subjects) {
        await tx.subjectCoefficient.create({
          data: {
            tenantId: me.tenantId,
            gradeLevelId: level.id,
            subjectId: s.id,
            coefficient: s.defaultCoefficient,
          },
        });
      }
      return level;
    });
  }

  /**
   * S-E05-13 / PF-51 / ADR-064 — TWO INDEPENDENT DEFENCES, AND WHY BOTH SHIP.
   *
   * DEFENCE 1 — `UpdateGradeLevelDto` (a decorator contract).
   * The parameter is a CLASS, so `design:paramtypes` no longer erases to
   * `Object` and the global `whitelist + forbidNonWhitelisted` pipe actually
   * runs: `PATCH {"tenantId":"…"}` is refused with 400 in the PIPE phase,
   * before this method body is entered. Defence 1 lives entirely in the
   * ANNOTATION. It survives exactly as long as nobody re-annotates the
   * parameter — one edit back to `Partial<T>`, `unknown` or `any` and it is
   * silently gone, with no error anywhere and no change to this body.
   *
   * DEFENCE 2 — the explicit field pick below (a dataflow fact).
   * This handler previously handed the RAW request body to Prisma as its
   * `data` argument. That is FULL MASS-ASSIGNMENT:
   * `GradeLevelUncheckedUpdateInput` accepts the raw
   * scalar FKs, and `schema.prisma:385-406` declares `tenantId`, `schoolId` and
   * `cycleId` as writable `@db.Uuid` scalars on `GradeLevel`. The `findUnique`
   * guard three lines up reads the row's CURRENT tenant; it cannot see the
   * INCOMING body, so it never stood between a caller and a cross-tenant write.
   * The blast radius is wider than `tenantId` alone and each escape differs:
   *
   *   • `tenantId` — carries NO relation and NO foreign key in the schema, and
   *     `grade_level` carries NO RLS policy (checked across
   *     `apps/api/prisma/migrations/**\/*.sql`). Writing an arbitrary uuid
   *     orphans the row into a tenant that need not exist. Nothing at the
   *     database layer would have caught it.
   *   • `schoolId` — an FK to `School`, so a school belonging to tenant B is
   *     FK-VALID here. The row keeps tenant A's `tenantId` yet re-lists inside
   *     tenant B, because `list()` above filters on `where: { schoolId }`. A
   *     cross-tenant READ leak reached through a WRITE, invisible to any
   *     assertion that only watches `tenantId`.
   *   • `cycleId` — moves the level under a foreign cycle, stranding the
   *     `SubjectCoefficient` rows `createGradeLevel` auto-created, which still
   *     carry the OLD `tenantId`.
   *
   * Defence 2 is a property of THIS CALL SITE, not of a decorator, so it holds
   * even if defence 1 is ever regressed. That asymmetry is the whole reason
   * both ship: `grade-level-mass-assignment.spec.ts` proves them separately —
   * one test drives the real `ValidationPipe` (defence 1), the other calls this
   * method DIRECTLY, bypassing the pipe phase exactly as a regression would,
   * and asserts on the ARGUMENT handed to `prisma.gradeLevel.update`. A status
   * code cannot tell the two defences apart, so no test here asserts one.
   *
   * ADR-002 forbids a cross-tenant write unconditionally. `grade_levels.write`
   * is held by `super_admin` and `school_admin` only
   * (`permissions.constants.ts:151`) — no parent, teacher or student reached
   * this. That is not a mitigation: a tenant-bounded admin escaping their own
   * tenant is precisely what the tenant boundary exists to stop.
   *
   * NOT fixed here, recorded instead: this privileged mutation writes no audit
   * row while its `academic-years` siblings relay through `writeAudit`
   * (`PF-285`, open).
   */
  @Patch('grade-levels/:levelId')
  @RequiresPermission('grade_levels.write')
  async updateGradeLevel(
    @Param('levelId', ParseUUIDPipe) levelId: string,
    @Body() body: UpdateGradeLevelDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const level = await this.prisma.gradeLevel.findUnique({ where: { id: levelId } });
    if (!level || level.tenantId !== me.tenantId) throw new NotFoundException();
    return this.prisma.gradeLevel.update({
      where: { id: levelId },
      data: {
        code: body.code ?? undefined,
        name: body.name ?? undefined,
        orderIndex: body.orderIndex ?? undefined,
      },
    });
  }

  @Delete('grade-levels/:levelId')
  @RequiresPermission('grade_levels.write')
  async deleteGradeLevel(
    @Param('levelId', ParseUUIDPipe) levelId: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const level = await this.prisma.gradeLevel.findUnique({
      where: { id: levelId },
      include: { _count: { select: { classSections: true } } },
    });
    if (!level || level.tenantId !== me.tenantId) throw new NotFoundException();
    if (level._count.classSections > 0) {
      throw new BadRequestException(
        `Ce niveau a ${level._count.classSections} classe(s). Supprimez-les d'abord.`,
      );
    }
    await this.prisma.gradeLevel.delete({ where: { id: levelId } });
    return { ok: true };
  }
}
