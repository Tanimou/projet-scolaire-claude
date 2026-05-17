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
    @Param('id') cycleId: string,
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

  @Patch('grade-levels/:levelId')
  @RequiresPermission('grade_levels.write')
  async updateGradeLevel(
    @Param('levelId') levelId: string,
    @Body() body: Partial<GradeLevelDto>,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const level = await this.prisma.gradeLevel.findUnique({ where: { id: levelId } });
    if (!level || level.tenantId !== me.tenantId) throw new NotFoundException();
    return this.prisma.gradeLevel.update({ where: { id: levelId }, data: body });
  }

  @Delete('grade-levels/:levelId')
  @RequiresPermission('grade_levels.write')
  async deleteGradeLevel(@Param('levelId') levelId: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
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
