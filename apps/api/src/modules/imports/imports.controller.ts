import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ImportMode, ImportType } from '@prisma/client';
import type { Response } from 'express';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';

import { ImportsService } from './imports.service';

class UploadDto {
  @IsString() @MinLength(1) @MaxLength(255) fileName!: string;
  @IsString() @MinLength(1) rawCsv!: string;
}

class ApplyDto {
  @IsEnum(ImportMode) mode!: ImportMode;
}

@ApiTags('imports')
@ApiBearerAuth()
@Controller('imports')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly users: UserSyncService,
  ) {}

  @Get('types')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission('imports.execute')
  listTypes() {
    return { data: this.imports.listTypes() };
  }

  @Get('templates/:type')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission('imports.execute')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  template(@Param('type', new ParseEnumPipe(ImportType)) type: ImportType, @Res() res: Response) {
    const csv = this.imports.template(type);
    res.setHeader('Content-Disposition', `attachment; filename="template-${type}.csv"`);
    res.send(csv);
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission('imports.execute')
  async list(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    return { data: await this.imports.listBatches(me.tenantId) };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission('imports.execute')
  async getOne(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    return this.imports.getBatch(id, me.tenantId);
  }

  @Post(':type/upload')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission('imports.execute')
  async upload(
    @Param('type', new ParseEnumPipe(ImportType)) type: ImportType,
    @Body() body: UploadDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    if (!body.rawCsv?.trim()) throw new BadRequestException('CSV vide.');
    const me = await this.users.ensureUser(jwt);
    return this.imports.uploadAndValidate(type, { id: me.id, tenantId: me.tenantId }, body.fileName, body.rawCsv);
  }

  @Post(':id/apply')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission('imports.execute')
  async apply(
    @Param('id') id: string,
    @Body() body: ApplyDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    return this.imports.apply(id, body.mode, { id: me.id, tenantId: me.tenantId });
  }

  @Post(':id/rollback')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission('imports.execute')
  async rollback(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    return this.imports.rollback(id, { id: me.id, tenantId: me.tenantId });
  }
}
