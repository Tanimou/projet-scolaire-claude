import {
  Body,
  Controller,
  DefaultValuePipe,
  ForbiddenException,
  Get,
  NotFoundException,
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
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ExportsService } from '../exports/exports.service';
import { TeacherProfileService } from '../teaching/teacher-profile.service';

import { CreateTeacherGradeGridDto } from './dto/create-teacher-grade-grid.dto';

/**
 * Teacher-scoped export surface (E4-S3). A teacher one-click generates the
 * grade-grid XLSX of one of THEIR OWN class sections straight from the
 * gradebook, polls status, and downloads via a fresh signed URL — reusing the
 * existing `ExportJob`/BullMQ/S3 machinery + the existing `grades_xlsx`
 * generator, but:
 *
 *  - guarded by the NEW `exports.execute.teacher` permission (NEVER the
 *    admin-only `exports.execute` nor the parent `exports.execute.parent` — a
 *    teacher must never reach the admin/parent export surfaces),
 *  - teaching-assignment ABAC re-checked on enqueue: the caller must CURRENTLY
 *    own the `teachingAssignmentId` (404-before-403), and the exported
 *    `classSectionId` is SERVER-derived from that assignment — never a
 *    client-supplied id (anti-IDOR / no foreign-class export),
 *  - every read/download re-scoped to `requestedBy = me` (no cross-teacher IDOR),
 *  - `grades_xlsx` jobs only.
 */
@ApiTags('teacher-exports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('teacher/exports')
export class TeacherExportsController {
  constructor(
    private readonly exports: ExportsService,
    private readonly users: UserSyncService,
    private readonly prisma: PrismaService,
    private readonly teachers: TeacherProfileService,
  ) {}

  @Post('grade-grid')
  @RequiresPermission('exports.execute.teacher')
  @ApiOperation({ summary: "Enqueue the grade-grid XLSX of one of the caller's own classes" })
  async createGradeGrid(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Body() dto: CreateTeacherGradeGridDto,
  ) {
    const me = await this.users.ensureUser(jwt);

    // 1. Resolve the teaching assignment in-tenant (404 — an unknown / cross-
    //    tenant id never leaks existence beyond a 404).
    const ta = await this.prisma.teachingAssignment.findFirst({
      where: { id: dto.teachingAssignmentId, tenantId: me.tenantId },
      select: { id: true, teacherProfileId: true, classSectionId: true },
    });
    if (!ta) throw new NotFoundException("Affectation d'enseignement introuvable");

    // 2. Teaching-assignment ABAC: the caller must CURRENTLY teach this class ×
    //    subject. We resolve the caller's TeacherProfile and require ownership.
    //    `classSectionId` is taken from the OWNED assignment (server-derived) —
    //    the client never supplies it, so a teacher cannot export a foreign class.
    const tp = await this.teachers.ensureForUser(me);
    if (ta.teacherProfileId !== tp.id) {
      throw new ForbiddenException('Vous ne pouvez exporter que vos propres classes.');
    }

    const { actorRole, portal } = deriveAlertActorProvenance(jwt);
    return this.exports.enqueueTeacherGradeGrid({
      tenantId: me.tenantId,
      teacherUserProfileId: me.id,
      teachingAssignmentId: ta.id,
      classSectionId: ta.classSectionId,
      termId: dto.termId ?? null,
      // Mirror the parent surface (E4-S2): pass null so the server-derived
      // `classSectionId` alone scopes the generator. Deriving the school from
      // the caller's *active* context would silently produce an empty grid for
      // a legitimately-owned class in a different school of a multi-school tenant.
      schoolIdFallback: null,
      actorRole,
      portal,
    });
  }

  @Get()
  @RequiresPermission('exports.execute.teacher')
  @ApiOperation({ summary: "List the caller's own grade-grid export jobs (newest first)" })
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('classSectionId') classSectionId: string | undefined,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    const me = await this.users.ensureUser(jwt);
    return this.exports.listForTeacher({
      tenantId: me.tenantId,
      requestedBy: me.id,
      classSectionId: classSectionId || undefined,
      limit: Math.min(100, Math.max(1, limit)),
      offset: Math.max(0, offset),
    });
  }

  @Get(':id')
  @RequiresPermission('exports.execute.teacher')
  @ApiOperation({ summary: "Fetch one of the caller's own export jobs (404 otherwise)" })
  async findOne(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    return this.exports.findOneForTeacher({ id, tenantId: me.tenantId, requestedBy: me.id });
  }

  @Get(':id/download-url')
  @RequiresPermission('exports.execute.teacher')
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
