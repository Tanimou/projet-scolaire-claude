import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { SchoolContextService } from '../school-structure/school-context.service';

import { ExportsService } from './exports.service';
import { CreateExportDto } from './exports.types';

@ApiTags('exports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('exports')
export class ExportsController {
  constructor(
    private readonly exports: ExportsService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
  ) {}

  @Post()
  @RequiresPermission('exports.execute')
  @ApiOperation({ summary: 'Enqueue a new asynchronous export job' })
  async create(@CurrentJwt() jwt: KeycloakJwtPayload, @Body() dto: CreateExportDto) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    return this.exports.enqueue({
      dto,
      tenantId: me.tenantId,
      userProfileId: me.id,
      schoolIdFallback: schoolId,
    });
  }

  @Get()
  @RequiresPermission('exports.execute')
  @ApiOperation({ summary: 'List recent export jobs for the tenant' })
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    const me = await this.users.ensureUser(jwt);
    return this.exports.listForTenant({
      tenantId: me.tenantId,
      limit: Math.min(100, Math.max(1, limit)),
      offset: Math.max(0, offset),
    });
  }

  @Get(':id')
  @RequiresPermission('exports.execute')
  @ApiOperation({ summary: 'Fetch a single export job by id' })
  async findOne(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    return this.exports.findOne({ id, tenantId: me.tenantId });
  }

  @Get(':id/download-url')
  @RequiresPermission('exports.execute')
  @ApiOperation({ summary: 'Generate a fresh pre-signed download URL (1 h TTL)' })
  async download(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    const url = await this.exports.signedDownloadUrl({ id, tenantId: me.tenantId });
    return { url, expiresInSec: 3600 };
  }
}
