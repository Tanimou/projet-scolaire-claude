import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RosterSourceKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';

import { IntegrationsService } from './integrations.service';

class ConnectSourceDto {
  @IsEnum(RosterSourceKind) kind!: RosterSourceKind;
  @IsString() @MinLength(1) @MaxLength(120) label!: string;
  @IsOptional() @IsString() @MaxLength(500) baseUrl?: string;
  /** REST only. Sent once, sealed server-side, NEVER returned. */
  @IsOptional() @IsString() @MaxLength(4000) credential?: string;
}

/** A OneRoster v1.1 CSV bundle — each member is the raw CSV text of one file. */
class OneRosterBundleDto {
  @IsOptional() @IsString() @MaxLength(20_000_000) users?: string;
  @IsOptional() @IsString() @MaxLength(20_000_000) classes?: string;
  @IsOptional() @IsString() @MaxLength(20_000_000) enrollments?: string;
  @IsOptional() @IsString() @MaxLength(20_000_000) courses?: string;
  @IsOptional() @IsString() @MaxLength(20_000_000) academicSessions?: string;
  @IsOptional() @IsString() @MaxLength(20_000_000) orgs?: string;
}

class SyncDto {
  @ValidateNested()
  @Type(() => OneRosterBundleDto)
  bundle!: OneRosterBundleDto;
}

/**
 * E11-S3 — OneRoster roster-sync interop surface. Admin-only, on the EXISTING
 * `integrations.write` permission (no new permission — no parent/teacher/student
 * ever holds it). A sync produces a normal `validated` ImportBatch
 * (origin = oneroster) so it inherits S1's async apply + S2's reconciliation
 * panel for free. Every read/write is tenant-scoped server-side; the credential
 * is never returned.
 */
@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations/oneroster')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly users: UserSyncService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission('integrations.write')
  async list(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    return { data: await this.integrations.list(me.tenantId) };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission('integrations.write')
  async getOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    return this.integrations.getOne(id, me.tenantId);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission('integrations.write')
  async connect(@Body() body: ConnectSourceDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    return this.integrations.connect({ id: me.id, tenantId: me.tenantId }, body);
  }

  @Post(':id/sync')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission('integrations.write')
  async sync(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SyncDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    return this.integrations.sync(id, { id: me.id, tenantId: me.tenantId }, body.bundle);
  }
}
