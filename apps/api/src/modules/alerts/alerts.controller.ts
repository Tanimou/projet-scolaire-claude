import {
  Body,
  Controller,
  DefaultValuePipe,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ALERT_STATUS } from '@pilotage/contracts';
import { $Enums } from '@prisma/client';
import type { AlertRuleCode, AlertSeverity, AlertStatus } from '@prisma/client';

import { deriveAlertActorProvenance } from '../../shared/audit/provenance';
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

/**
 * S-E05-17 / ADR-067 §D0+§D3 — l'allowlist des statuts d'alerte, LIEE.
 *
 * `ALERT_STATUS` existait deja dans `@pilotage/contracts` et le web s'en sert
 * deja ; `alerts.controller.ts` en avait pourtant une COPIE ecrite a la main
 * (PF-315). On consomme donc le contrat — mais un `as const` nu n'a AUCUN lien
 * de compilation avec Prisma : ajouter une 5e valeur a l'enum `AlertStatus`
 * refuserait alors silencieusement une valeur legitime en 400, sans rien de
 * rouge. C'est la derive de listes jumelles deplacee d'un fichier, pas fermee.
 *
 * L'annotation `ReadonlyArray<AlertStatus>` est la fermeture, gratuite : elle
 * prouve a la compilation que le contrat est un sous-ensemble de l'enum. Meme
 * idiome que `RULE_CODES` (`alerts.types.ts`) et que `NOTIFICATION_KINDS` cote
 * notifications.
 */
const ALERT_STATUSES: ReadonlyArray<AlertStatus> = ALERT_STATUS;

/**
 * S-E03-6 / ADR-077 §D3 — les severites, DERIVEES de l'enum Prisma et non
 * recopiees. `@pilotage/contracts` n'expose pas de liste de severites ; en
 * ecrire une a la main ici serait exactement la derive de listes jumelles que
 * le docblock ci-dessus decrit, et que `PF-20` vient de faire payer au KPI du
 * tableau de bord. `$Enums.AlertSeverity` est la meme source que la colonne.
 */
const ALERT_SEVERITIES: ReadonlyArray<AlertSeverity> = Object.values($Enums.AlertSeverity);

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
    // S-E05-17 / ADR-067 §D3 — DEFAUT DE VERITE, pas simple defaut de validation.
    // Avant : un statut inconnu retombait sur `undefined`, donc AUCUN filtre,
    // donc la liste COMPLETE rendue en 200 (mesure) — l'admin lisait des alertes
    // resolues et rejetees sous un en-tete « Ouvertes ». Un elargissement
    // silencieux d'une projection de LECTURE. Desormais 400.
    @Query(
      'status',
      new ParseEnumPipe(ALERT_STATUSES as unknown as { [k: string]: AlertStatus }, {
        optional: true,
      }),
    )
    status: AlertStatus | undefined,
    @Query(
      'severity',
      new ParseEnumPipe(ALERT_SEVERITIES as unknown as { [k: string]: AlertSeverity }, {
        optional: true,
      }),
    )
    severity: AlertSeverity | undefined,
    @Query('studentId') studentId: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    return this.alerts.listInstances({
      tenantId: me.tenantId,
      schoolId,
      status,
      severity,
      studentId,
      limit: Math.min(200, Math.max(1, limit)),
      offset: Math.max(0, offset),
    });
  }

  @Post('instances/:id/acknowledge')
  @RequiresPermission('alerts.write')
  async acknowledge(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    const { actorRole, portal } = deriveAlertActorProvenance(jwt);
    return this.alerts.acknowledge({
      tenantId: me.tenantId,
      id,
      userProfileId: me.id,
      actorRole,
      portal,
    });
  }

  @Post('instances/:id/resolve')
  @RequiresPermission('alerts.write')
  async resolve(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    const { actorRole, portal } = deriveAlertActorProvenance(jwt);
    return this.alerts.resolve({
      tenantId: me.tenantId,
      id,
      userProfileId: me.id,
      actorRole,
      portal,
    });
  }

  @Post('instances/:id/dismiss')
  @RequiresPermission('alerts.write')
  async dismiss(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    const { actorRole, portal } = deriveAlertActorProvenance(jwt);
    return this.alerts.dismiss({
      tenantId: me.tenantId,
      id,
      userProfileId: me.id,
      actorRole,
      portal,
    });
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
      // Thread the caller's userProfileId so listForStudent can stamp the parent's
      // OWN meeting-request marker (meetingRequestedAt) per alert — keyed on
      // requestedBy = me.id (no co-guardian leak). E1-S3 carried debt #2.
      data: await this.alerts.listForStudent({
        tenantId: me.tenantId,
        studentId,
        userProfileId: me.id,
        limit: 50,
      }),
    };
  }

  // ----- Parent: scoped lifecycle (ABAC, NOT alerts.write) -------------------
  //
  // A parent acts on their own child's alert from the recommendations surface.
  // Authorization is guardianship-ABAC via StudentAccessService.canAccessStudent
  // (the same gate as the read above), NOT the admin `alerts.write` permission —
  // these routes are guarded by `profile.read.self`, which parents hold and which
  // is insufficient for the admin POST /alerts/instances/:id/* routes. The alert's
  // studentId is resolved in-tenant first (never trusted from the client) and the
  // guardianship check runs BEFORE any mutation, so a parent can only transition
  // an alert for a child they have an active Guardianship for.
  //
  // S-E05-16 / `PF-300` / DNC-06 — this paragraph used to end with "Admin/teacher
  // tokens (scope studentIds:null) pass the ABAC check unrestricted, matching the
  // read." BOTH clauses of that sentence are now false for a TEACHER. Since
  // `S-E05-16` (`PF-288`) only `super_admin`/`school_admin` still resolve to the
  // `studentIds: null` unrestricted sentinel; a teacher resolves to exactly the
  // students they hold a TeachingAssignment for, so these two routes — guarded by
  // `profile.read.self`, which `teacher` DOES hold — now refuse a teacher acting
  // on a non-taught child's alert. That TIGHTENING IS INTENDED (`AC-5`): a teacher
  // could previously ack/resolve/dismiss ANY child's alert in the tenant.
  // Recorded consequence, NOT fixed here: the teacher-facing alert LIST does not
  // run through `scopeForUser`, so a teacher can still SEE an alert they can no
  // longer act on — a 403 dead-end, `PF-302`.

  /**
   * Resolve the alert's in-tenant studentId and enforce the guardianship ABAC
   * gate, throwing 404 (cross-tenant / unknown id) or 403 (no access) before any
   * lifecycle mutation. Returns the JWT-derived audit provenance for the write.
   */
  private async authorizeParentAlertAction(
    jwt: KeycloakJwtPayload,
    id: string,
  ): Promise<{
    tenantId: string;
    userProfileId: string;
    actorRole: string | null;
    portal: string | null;
  }> {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const studentId = await this.alerts.findStudentIdForAlert({
      tenantId: me.tenantId,
      id,
    });
    if (!studentId) throw new NotFoundException('Alert not found');
    const allowed = await this.studentAccess.canAccessStudent(me, jwt, studentId, schoolId);
    if (!allowed) throw new ForbiddenException('Forbidden');
    const { actorRole, portal } = deriveAlertActorProvenance(jwt);
    return { tenantId: me.tenantId, userProfileId: me.id, actorRole, portal };
  }

  @Patch(':id/ack')
  @RequiresPermission('profile.read.self')
  @ApiOperation({ summary: 'Parent acknowledges one of their child’s alerts (guardianship ABAC)' })
  async ackByParent(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const auth = await this.authorizeParentAlertAction(jwt, id);
    return this.alerts.acknowledge({ ...auth, id });
  }

  @Patch(':id/resolve')
  @RequiresPermission('profile.read.self')
  @ApiOperation({ summary: 'Parent marks one of their child’s alerts handled (guardianship ABAC)' })
  async resolveByParent(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const auth = await this.authorizeParentAlertAction(jwt, id);
    return this.alerts.resolve({ ...auth, id });
  }

  @Patch(':id/dismiss')
  @RequiresPermission('profile.read.self')
  @ApiOperation({ summary: 'Parent dismisses one of their child’s alerts (guardianship ABAC)' })
  async dismissByParent(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const auth = await this.authorizeParentAlertAction(jwt, id);
    return this.alerts.dismiss({ ...auth, id });
  }

  /**
   * Parent records a lightweight "I want to talk to the teacher about this
   * alert" intent (E1-S2). This does NOT mutate the alert's status — the alert
   * stays open/acknowledged in the parent's list — it only appends ONE
   * idempotent, append-only AuditLog row (action `alert.meeting_intent`) via the
   * same guardianship-ABAC gate as the lifecycle routes. E2 messaging is not yet
   * built; S3 will promote this intent into a queryable MeetingRequest surface.
   * Returns `{ ok, alreadyRequested, requestedAt }` so the UI can render a
   * one-shot, non-duplicating confirmation.
   */
  @Post(':id/meeting-intent')
  @RequiresPermission('profile.read.self')
  @ApiOperation({
    summary: 'Parent records a meeting-request intent for their child’s alert (guardianship ABAC)',
  })
  async meetingIntentByParent(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const auth = await this.authorizeParentAlertAction(jwt, id);
    return this.alerts.recordMeetingIntent({ ...auth, id });
  }
}
