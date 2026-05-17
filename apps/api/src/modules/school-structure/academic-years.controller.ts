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
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AcademicYearStatus, Prisma } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { SchoolContextService } from './school-context.service';

class CreateAcademicYearDto {
  @IsString() @MinLength(4) @MaxLength(40) name!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsEnum(AcademicYearStatus) status?: AcademicYearStatus;
}

class UpdateAcademicYearDto {
  @IsOptional() @IsString() @MaxLength(40) name?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsEnum(AcademicYearStatus) status?: AcademicYearStatus;
}

class TermDto {
  @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @IsInt() orderIndex!: number;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
}

@ApiTags('school-structure')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('academic-years')
export class AcademicYearsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
  ) {}

  @Get()
  @RequiresPermission('academic_years.read')
  @ApiOkResponse({ description: 'Académic years for the current school, newest first' })
  async list(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);
    const years = await this.prisma.academicYear.findMany({
      where: { schoolId },
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { terms: true, classSections: true } }, terms: { orderBy: { orderIndex: 'asc' } } },
    });
    return { data: years };
  }

  @Post()
  @RequiresPermission('academic_years.write')
  async create(@Body() body: CreateAcademicYearDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    this.assertDateOrder(body.startDate, body.endDate);
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);

    const existing = await this.prisma.academicYear.findUnique({
      where: { schoolId_name: { schoolId, name: body.name } },
    });
    if (existing) throw new ConflictException(`Une année scolaire « ${body.name} » existe déjà.`);

    // Only one 'active' year at a time — flip others to closed automatically
    const status = body.status ?? AcademicYearStatus.active;
    return this.prisma.$transaction(async (tx) => {
      if (status === AcademicYearStatus.active) {
        await tx.academicYear.updateMany({
          where: { schoolId, status: AcademicYearStatus.active },
          data: { status: AcademicYearStatus.closed },
        });
      }
      const created = await tx.academicYear.create({
        data: {
          tenantId: me.tenantId,
          schoolId,
          name: body.name,
          startDate: new Date(body.startDate),
          endDate: new Date(body.endDate),
          status,
        },
      });
      await this.audit(tx, me, 'academic_year.create', created.id, null, { name: body.name, status });
      return created;
    });
  }

  @Patch(':id')
  @RequiresPermission('academic_years.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAcademicYearDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const year = await this.prisma.academicYear.findUnique({ where: { id } });
    if (!year) throw new NotFoundException('Année scolaire introuvable');
    if (year.tenantId !== me.tenantId) throw new ForbiddenException();
    if (body.startDate && body.endDate) this.assertDateOrder(body.startDate, body.endDate);

    return this.prisma.$transaction(async (tx) => {
      if (body.status === AcademicYearStatus.active) {
        // Close any other active year first
        await tx.academicYear.updateMany({
          where: { schoolId: year.schoolId, status: AcademicYearStatus.active, NOT: { id } },
          data: { status: AcademicYearStatus.closed },
        });
      }
      const updated = await tx.academicYear.update({
        where: { id },
        data: {
          name: body.name ?? undefined,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          endDate: body.endDate ? new Date(body.endDate) : undefined,
          status: body.status ?? undefined,
        },
      });
      await this.audit(tx, me, 'academic_year.update', id, { name: year.name }, updated);
      return updated;
    });
  }

  @Delete(':id')
  @RequiresPermission('academic_years.write')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const year = await this.prisma.academicYear.findUnique({
      where: { id },
      include: { _count: { select: { classSections: true } } },
    });
    if (!year) throw new NotFoundException('Année scolaire introuvable');
    if (year.tenantId !== me.tenantId) throw new ForbiddenException();
    if (year._count.classSections > 0) {
      throw new BadRequestException(
        `Cette année contient ${year._count.classSections} classe(s). Archivez-la au lieu de la supprimer.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.academicYear.delete({ where: { id } });
      await this.audit(tx, me, 'academic_year.delete', id, { name: year.name }, null);
    });
    return { ok: true };
  }

  /* ----- Terms (nested) ----- */

  @Get(':id/terms')
  @RequiresPermission('academic_years.read')
  async listTerms(@Param('id') yearId: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const year = await this.prisma.academicYear.findUnique({ where: { id: yearId } });
    if (!year || year.tenantId !== me.tenantId) throw new NotFoundException('Année scolaire introuvable');
    const terms = await this.prisma.term.findMany({
      where: { academicYearId: yearId },
      orderBy: { orderIndex: 'asc' },
    });
    return { data: terms };
  }

  @Post(':id/terms')
  @RequiresPermission('terms.write')
  async createTerm(
    @Param('id') yearId: string,
    @Body() body: TermDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    this.assertDateOrder(body.startDate, body.endDate);
    const me = await this.users.ensureUser(jwt);
    const year = await this.prisma.academicYear.findUnique({ where: { id: yearId } });
    if (!year || year.tenantId !== me.tenantId) throw new NotFoundException('Année scolaire introuvable');

    const dupName = await this.prisma.term.findFirst({
      where: { academicYearId: yearId, name: body.name },
    });
    if (dupName) throw new ConflictException(`Un trimestre « ${body.name} » existe déjà sur cette année.`);
    const dupOrder = await this.prisma.term.findFirst({
      where: { academicYearId: yearId, orderIndex: body.orderIndex },
    });
    if (dupOrder) throw new ConflictException(`L'ordre ${body.orderIndex} est déjà utilisé.`);

    return this.prisma.term.create({
      data: {
        tenantId: me.tenantId,
        academicYearId: yearId,
        name: body.name,
        orderIndex: body.orderIndex,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
      },
    });
  }

  @Patch('terms/:termId')
  @RequiresPermission('terms.write')
  async updateTerm(
    @Param('termId') termId: string,
    @Body() body: Partial<TermDto>,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const term = await this.prisma.term.findUnique({ where: { id: termId } });
    if (!term || term.tenantId !== me.tenantId) throw new NotFoundException('Trimestre introuvable');
    if (body.startDate && body.endDate) this.assertDateOrder(body.startDate, body.endDate);
    return this.prisma.term.update({
      where: { id: termId },
      data: {
        name: body.name ?? undefined,
        orderIndex: body.orderIndex ?? undefined,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
      },
    });
  }

  @Delete('terms/:termId')
  @RequiresPermission('terms.write')
  async deleteTerm(@Param('termId') termId: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const term = await this.prisma.term.findUnique({ where: { id: termId } });
    if (!term || term.tenantId !== me.tenantId) throw new NotFoundException();
    await this.prisma.term.delete({ where: { id: termId } });
    return { ok: true };
  }

  private assertDateOrder(start: string, end: string) {
    if (new Date(start) >= new Date(end)) {
      throw new BadRequestException('La date de fin doit être après la date de début.');
    }
  }

  private async audit(
    tx: Prisma.TransactionClient,
    me: { id: string; tenantId: string },
    action: string,
    resourceId: string,
    before: Prisma.InputJsonValue | null,
    after: Prisma.InputJsonValue | null,
  ) {
    await tx.auditLog.create({
      data: {
        tenantId: me.tenantId,
        actorId: me.id,
        actorRole: 'school_admin',
        portal: 'admin',
        action,
        resourceType: 'academic_year',
        resourceId,
        before: before ?? undefined,
        after: after ?? undefined,
      },
    });
  }
}
