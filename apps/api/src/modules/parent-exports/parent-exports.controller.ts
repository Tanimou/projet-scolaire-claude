import {
  Body,
  Controller,
  DefaultValuePipe,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { deriveAlertActorProvenance } from '../alerts/alert-provenance';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { ExportsService } from '../exports/exports.service';
import { SchoolContextService } from '../school-structure/school-context.service';
import { StudentAccessService } from '../students/student-access.service';

import { CreateParentBulletinDto } from './dto/create-parent-bulletin.dto';

/**
 * Parent-scoped export surface (E4-S2). A guardian one-click generates their own
 * child's term-summary bulletin PDF, polls status, and downloads via a fresh
 * signed URL — reusing the existing `ExportJob`/BullMQ/S3 machinery, but:
 *
 *  - guarded by the NEW `exports.execute.parent` permission (NOT the admin-only
 *    `exports.execute` — a parent must never reach the admin export surface),
 *  - guardianship-ABAC re-checked on enqueue (404-before-403),
 *  - every read/download re-scoped to `requestedBy = me` (no cross-parent IDOR),
 *  - `report_card_pdf` jobs only.
 */
@ApiTags('parent-exports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('parent/exports')
export class ParentExportsController {
  constructor(
    private readonly exports: ExportsService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
    private readonly studentAccess: StudentAccessService,
  ) {}

  @Post('bulletin')
  @RequiresPermission('exports.execute.parent')
  @ApiOperation({ summary: "Enqueue the caller's own child's term bulletin PDF" })
  async createBulletin(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Body() dto: CreateParentBulletinDto,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);

    // Guardianship ABAC: the parent may only request a bulletin for a child they
    // have an active Guardianship for. `canAccessStudent` returns false for a
    // student not in the caller's scope (incl. cross-tenant / unknown ids) →
    // 403. The term + active enrollment 404s happen inside the service.
    const allowed = await this.studentAccess.canAccessStudent(
      me,
      jwt,
      dto.studentId,
      schoolId,
    );
    if (!allowed) throw new ForbiddenException('Forbidden');

    const { actorRole, portal } = deriveAlertActorProvenance(jwt);
    return this.exports.enqueueParentBulletin({
      tenantId: me.tenantId,
      parentProfileId: me.id,
      studentId: dto.studentId,
      termId: dto.termId,
      actorRole,
      portal,
    });
  }

  @Get()
  @RequiresPermission('exports.execute.parent')
  @ApiOperation({ summary: "List the caller's own bulletin export jobs (newest first)" })
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    const me = await this.users.ensureUser(jwt);
    return this.exports.listForParent({
      tenantId: me.tenantId,
      requestedBy: me.id,
      limit: Math.min(100, Math.max(1, limit)),
      offset: Math.max(0, offset),
    });
  }

  @Get(':id')
  @RequiresPermission('exports.execute.parent')
  @ApiOperation({ summary: "Fetch one of the caller's own export jobs (404 otherwise)" })
  async findOne(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    return this.exports.findOneForParent({ id, tenantId: me.tenantId, requestedBy: me.id });
  }

  @Get(':id/download-url')
  @RequiresPermission('exports.execute.parent')
  @ApiOperation({ summary: 'Fresh 1 h signed URL for a succeeded own job (404 otherwise)' })
  async download(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    const url = await this.exports.signedDownloadUrl({
      id,
      tenantId: me.tenantId,
      requestedBy: me.id,
    });
    return { url, expiresInSec: 3600 };
  }
}
