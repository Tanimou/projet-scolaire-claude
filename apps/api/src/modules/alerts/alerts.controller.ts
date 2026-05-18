import {
  Body,
  Controller,
  DefaultValuePipe,
  ForbiddenException,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AlertRuleCode, AlertStatus } from '@prisma/client';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { SchoolContextService } from '../school-structure/school-context.service';
import { StudentAccessService } from '../students/student-access.service';

import { AlertsService } from './alerts.service';
import { EvaluateAlertsDto, RULE_CODES, UpdateAlertRuleDto } from './alerts.types';

@ApiTags('alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
    private readonly studentAccess: StudentAccessService,
  ) {}

  // ----- Admin: rules --------------------------------------------------------

  @Get('rules')
  @RequiresPermission('alerts.read')
  @ApiOperation({ summary: 'List rule configurations for the current tenant' })
  async listRules(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    return { data: await this.alerts.listRules({ tenantId: me.tenantId, schoolId }) };
  }

  @Patch('rules/:code')
  @RequiresPermission('alerts.write')
  @ApiOperation({ summary: 'Enable/disable or reconfigure a rule' })
  async updateRule(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Param('code', new ParseEnumPipe(RULE_CODES as unknown as { [k: string]: AlertRuleCode }))
    code: AlertRuleCode,
    @Body() dto: UpdateAlertRuleDto,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    return this.alerts.updateRule({ tenantId: me.tenantId, schoolId, code, dto });
  }

  // ----- Admin: instances ----------------------------------------------------

  @Get('instances')
  @RequiresPermission('alerts.read')
  @ApiOperation({ summary: 'List materialised alerts (with filters)' })
  async listInstances(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('status') statusRaw: string | undefined,
    @Query('studentId') studentId: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const status =
      statusRaw && ['open', 'acknowledged', 'resolved', 'dismissed'].includes(statusRaw)
        ? (statusRaw as AlertStatus)
        : undefined;
    return this.alerts.listInstances({
      tenantId: me.tenantId,
      schoolId,
      status,
      studentId,
      limit: Math.min(200, Math.max(1, limit)),
      offset: Math.max(0, offset),
    });
  }

  @Post('instances/:id/acknowledge')
  @RequiresPermission('alerts.write')
  async acknowledge(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    return this.alerts.acknowledge({ tenantId: me.tenantId, id, userProfileId: me.id });
  }

  @Post('instances/:id/resolve')
  @RequiresPermission('alerts.write')
  async resolve(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    return this.alerts.resolve({ tenantId: me.tenantId, id, userProfileId: me.id });
  }

  @Post('instances/:id/dismiss')
  @RequiresPermission('alerts.write')
  async dismiss(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    return this.alerts.dismiss({ tenantId: me.tenantId, id, userProfileId: me.id });
  }

  @Post('evaluate')
  @RequiresPermission('alerts.write')
  @ApiOperation({ summary: 'Run the evaluator immediately for the current tenant/school' })
  async evaluate(@CurrentJwt() jwt: KeycloakJwtPayload, @Body() dto: EvaluateAlertsDto) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId: ctxSchoolId } = await this.ctx.forUser(me);
    const schoolId = dto.schoolId ?? ctxSchoolId;
    return this.alerts.evaluateAll({ tenantId: me.tenantId, schoolId });
  }

  // ----- Parent: scoped read -------------------------------------------------

  @Get('parent/:studentId')
  @RequiresPermission('profile.read.self')
  @ApiOperation({ summary: 'Open + acknowledged alerts visible to a parent for one of their students' })
  async listForParent(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Param('studentId') studentId: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const allowed = await this.studentAccess.canAccessStudent(me, jwt, studentId, schoolId);
    if (!allowed) throw new ForbiddenException('Forbidden');
    return {
      data: await this.alerts.listForStudent({ tenantId: me.tenantId, studentId, limit: 50 }),
    };
  }
}
