import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { snapshotCoalesceKey } from '@pilotage/contracts';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { SchoolContextService } from './school-context.service';

class CreateSubjectDto {
  @IsString() @MinLength(2) @MaxLength(40) code!: string;
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsOptional() @IsNumber() @Min(0.1) @Max(20) defaultCoefficient?: number;
  @IsOptional() @IsString() @MaxLength(60) color?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateSubjectDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsNumber() @Min(0.1) @Max(20) defaultCoefficient?: number;
  @IsOptional() @IsString() @MaxLength(60) color?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

class CoefficientEntry {
  @IsUUID() gradeLevelId!: string;
  @IsUUID() subjectId!: string;
  @IsNumber() @Min(0.1) @Max(20) coefficient!: number;
}

class BulkCoefficientDto {
  @ValidateNested({ each: true })
  @Type(() => CoefficientEntry)
  entries!: CoefficientEntry[];
}

@ApiTags('school-structure')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('subjects')
export class SubjectsController {
  private readonly logger = new Logger(SubjectsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
  ) {}

  @Get()
  @RequiresPermission('subjects.read')
  async list(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    const subjects = await this.prisma.subject.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
    });
    return {
      data: subjects.map((s) => ({
        ...s,
        defaultCoefficient: Number(s.defaultCoefficient),
      })),
    };
  }

  @Post()
  @RequiresPermission('subjects.write')
  async create(@Body() body: CreateSubjectDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    const dup = await this.prisma.subject.findUnique({ where: { schoolId_code: { schoolId, code: body.code } } });
    if (dup) throw new ConflictException(`Une matière « ${body.code} » existe déjà.`);

    return this.prisma.$transaction(async (tx) => {
      const subject = await tx.subject.create({
        data: {
          tenantId: me.tenantId,
          schoolId,
          code: body.code,
          name: body.name,
          defaultCoefficient: body.defaultCoefficient ?? 1,
          color: body.color ?? null,
          icon: body.icon ?? null,
          active: body.active ?? true,
        },
      });
      // Auto-create coefficient rows for every existing grade level (default = subject default)
      const levels = await tx.gradeLevel.findMany({ where: { schoolId } });
      for (const lvl of levels) {
        await tx.subjectCoefficient.create({
          data: {
            tenantId: me.tenantId,
            gradeLevelId: lvl.id,
            subjectId: subject.id,
            coefficient: subject.defaultCoefficient,
          },
        });
      }
      return subject;
    });
  }

  @Patch(':id')
  @RequiresPermission('subjects.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateSubjectDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const subject = await this.prisma.subject.findUnique({ where: { id } });
    if (!subject || subject.tenantId !== me.tenantId) throw new NotFoundException();
    return this.prisma.subject.update({ where: { id }, data: body });
  }

  @Delete(':id')
  @RequiresPermission('subjects.write')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const subject = await this.prisma.subject.findUnique({ where: { id } });
    if (!subject || subject.tenantId !== me.tenantId) throw new NotFoundException();
    // Soft-delete via active=false instead of hard-delete to preserve historical coefficients/grades (Phase 4+)
    return this.prisma.subject.update({ where: { id }, data: { active: false } });
  }

  /* ----- Coefficient matrix ----- */

  @Get('coefficients/matrix')
  @RequiresPermission('subjects.read')
  async coefficientMatrix(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    const [subjects, levels, coefs] = await Promise.all([
      this.prisma.subject.findMany({ where: { schoolId, active: true }, orderBy: { name: 'asc' } }),
      this.prisma.gradeLevel.findMany({ where: { schoolId }, orderBy: { orderIndex: 'asc' } }),
      this.prisma.subjectCoefficient.findMany({
        where: { subject: { schoolId } },
      }),
    ]);

    return {
      subjects: subjects.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        color: s.color,
        icon: s.icon,
        defaultCoefficient: Number(s.defaultCoefficient),
      })),
      gradeLevels: levels.map((l) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        orderIndex: l.orderIndex,
        cycleId: l.cycleId,
      })),
      coefficients: coefs.map((c) => ({
        gradeLevelId: c.gradeLevelId,
        subjectId: c.subjectId,
        coefficient: Number(c.coefficient),
      })),
    };
  }

  @Put('coefficients/matrix')
  @RequiresPermission('subjects.write')
  async upsertCoefficients(
    @Body() body: BulkCoefficientDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      throw new BadRequestException('Aucune entrée à enregistrer.');
    }
    await this.prisma.$transaction(async (tx) => {
      for (const e of body.entries) {
        await tx.subjectCoefficient.upsert({
          where: { gradeLevelId_subjectId: { gradeLevelId: e.gradeLevelId, subjectId: e.subjectId } },
          update: { coefficient: e.coefficient },
          create: {
            tenantId: me.tenantId,
            gradeLevelId: e.gradeLevelId,
            subjectId: e.subjectId,
            coefficient: e.coefficient,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: me.tenantId,
          actorId: me.id,
          actorRole: 'school_admin',
          portal: 'admin',
          action: 'coefficient.upsert',
          resourceType: 'subject_coefficient',
          after: { count: body.entries.length },
        },
      });
    });

    // E6-S3 (FR6) — best-effort, NON-BLOCKING coefficient-change recompute enqueue.
    // A coefficient edit re-weights the GLOBAL average of every pupil in every class
    // teaching the changed subject. The locked S1 trigger schema has no gradeLevelId
    // column, so we enqueue ONE class-LESS trigger per DISTINCT changed subject,
    // carrying (subjectId, academicYearId); the worker (FR7) fans it out to every
    // affected ClassSection of that year. Resolved AFTER the $transaction commits
    // (a sibling, never nested), so an enqueue failure can never roll back the save.
    // Idempotent upsert on (tenantId, coalesceKey, status='pending') → a 30-entry
    // matrix save collapses to one trigger per subject. Writes NO audit row
    // (recompute is derived bookkeeping — the coefficient.upsert audit is untouched).
    try {
      const subjectIds = [...new Set(body.entries.map((e) => e.subjectId))];
      const activeYears = await this.prisma.academicYear.findMany({
        where: { tenantId: me.tenantId, status: 'active' },
        select: { id: true },
      });
      const now = new Date();
      for (const subjectId of subjectIds) {
        for (const year of activeYears) {
          const scope = { subjectId, academicYearId: year.id };
          const coalesceKey = snapshotCoalesceKey(me.tenantId, 'coefficient_changed', scope);
          await this.prisma.snapshotRecomputeTrigger.upsert({
            where: {
              tenantId_coalesceKey_status: {
                tenantId: me.tenantId,
                coalesceKey,
                status: 'pending',
              },
            },
            create: {
              tenantId: me.tenantId,
              reason: 'coefficient_changed',
              status: 'pending',
              // class-LESS: the worker resolves classes from (subject, year).
              classSectionId: null,
              subjectId,
              academicYearId: year.id,
              coalesceKey,
            },
            update: { enqueuedAt: now },
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        `[subjects] coefficient_changed snapshot recompute enqueue failed: ${(err as Error).message}`,
      );
    }

    return { ok: true, count: body.entries.length };
  }
}
