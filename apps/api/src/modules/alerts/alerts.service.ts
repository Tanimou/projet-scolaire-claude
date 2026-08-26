import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { guardianshipLiveWhere, resolveActiveAcademicYear } from '@pilotage/contracts';
// `Prisma` is imported as a runtime value (used for `instanceof
// Prisma.PrismaClientKnownRequestError` in the P2002 idempotency catch) as well
// as for its `Prisma.*` type helpers.
import { Prisma } from '@prisma/client';
import type {
  AlertInstance,
  AlertRule,
  AlertRuleCode,
  AlertSeverity,
  AlertStatus,
  NotificationSeverity,
} from '@prisma/client';

import { prismaAcademicYearReader } from '../../shared/academic-year/prisma-academic-year-reader';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TenantScopeError } from '../../shared/prisma/tenant-scope';
import { TenantScopeService } from '../../shared/prisma/tenant-scope.service';
import { NotificationsService } from '../notifications/notifications.service';

import {
  AlertInstanceDto,
  AlertRuleDto,
  RULE_CODES,
  RULE_DEFAULTS,
  UpdateAlertRuleDto,
} from './alerts.types';
import { evaluateHighAbsence } from './rules/high-absence.rule';
import { evaluateImprovement } from './rules/improvement.rule';
import { evaluateLowSubjectAvg } from './rules/low-subject-avg.rule';
import { evaluateMissingAssessment } from './rules/missing-assessment.rule';
import { evaluateNegativeTrend } from './rules/negative-trend.rule';
import { evaluateRepeatedFailure } from './rules/repeated-failure.rule';
import type { DetectedAlert, RuleContext } from './rules/rule-context';
import { evaluateTeacherCommentFlag } from './rules/teacher-comment-flag.rule';

const DEDUP_WINDOW_DAYS = 7;

type AlertInstanceFull = AlertInstance & {
  student: { firstName: string; lastName: string };
  subject: { id: string; name: string; code: string } | null;
  classSection: { id: string; name: string } | null;
};

type RuleFn = (ctx: RuleContext) => Promise<DetectedAlert[]>;

const RULE_FN: Partial<Record<AlertRuleCode, RuleFn>> = {
  LOW_SUBJECT_AVG: evaluateLowSubjectAvg,
  HIGH_ABSENCE: evaluateHighAbsence,
  REPEATED_FAILURE: evaluateRepeatedFailure,
  NEGATIVE_TREND: evaluateNegativeTrend,
  MISSING_ASSESSMENT: evaluateMissingAssessment,
  TEACHER_COMMENT_FLAG: evaluateTeacherCommentFlag,
  IMPROVEMENT: evaluateImprovement,
  // BEHAVIOR_ALERT remains a stub — it will be wired in a subsequent iteration.
};

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ S-E01-1l — LE SIXIÈME MODULE ENTRE DANS LA PORTÉE TENANT, ET LE PREMIER  │
 * │ QUI NE CONVERTIT PAS TOUT (ADR-060 §D1)                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * VINGT-SIX des trente-deux instructions de ce fichier passent désormais par
 * `TenantScopeService.run(args.tenantId, tx => …)`, dans la forme livrée par
 * `remediation.service.ts` et `student-portal.service.ts`. Le tenant est
 * TOUJOURS `args.tenantId` — la valeur dérivée du serveur, jamais
 * `row.tenantId`, ce qui ferait de la clé de portée une fonction de la donnée
 * que la portée filtre.
 *
 * Les gardes `tenantId:` explicites de chaque `where` RESTENT : sur un
 * déploiement sans `DATABASE_URL_APP`, `run` s'exécute sur la connexion du
 * PROPRIÉTAIRE (ADR-056), qui échappe à ses propres policies. Les retirer ferait
 * de l'isolation une propriété d'UN fichier d'environnement.
 *
 * CE QUI RESTE DEHORS, ET POURQUOI (l'inverse d'un oubli — ADR-060 §D1) :
 * `evaluateAll`, `notifyGuardiansOfAlert` et `tenantsWithEnabledRules` gardent
 * le client PROPRIÉTAIRE et sont ÉNUMÉRÉS dans `ENUMERATED_OUTSIDE_SCOPE`
 * (`scripts/tenant-adversarial-check.js`), instruction par instruction, avec
 * leur raison propre :
 *
 *  1. `evaluateAll` est un LOT. Il ouvre en éventail sur sept évaluateurs
 *     `rules/*.rule.ts`, chacun recevant `RuleContext.prisma: PrismaService` et
 *     émettant ses propres requêtes sur TOUT le tenant, puis boucle PAR
 *     DÉTECTION sur un `findFirst` de déduplication + un `create` + un fan-out
 *     de notifications. C'est O(règles × détections) allers-retours ; la couture
 *     borne explicitement une portée à « ≤ 2 instructions » et Prisma coupe une
 *     transaction interactive à 5 s. L'y enfermer rendrait P2028 sur le bouton
 *     admin « Lancer l'évaluation » ET annulerait les alertes déjà matérialisées.
 *  2. La convertir exigerait de retyper `RuleContext.prisma` en
 *     `Prisma.TransactionClient` et de convertir sept fichiers de règles — le
 *     rayon de souffle d'un AUTRE module. Laissée à moitié, elle produirait des
 *     `ctx.prisma.*` sur la connexion propriétaire À L'INTÉRIEUR d'une portée
 *     ouverte : l'inverse dangereux de PF-200, invisible au compilateur.
 *  3. `tenantsWithEnabledRules` ne prend AUCUN tenantId et `distinct` dessus :
 *     elle PRODUIT l'ensemble des tenants que le cron évalue. L'entrée d'une
 *     portée ne peut pas être émise depuis l'intérieur de cette portée.
 *
 * `PrismaService` reste donc injecté ICI, et c'est une DÉCISION : le cliquet
 * « le constructeur EST la preuve » (ADR-057 §D4) ne s'applique PAS à cette
 * classe tant que l'évaluateur n'est pas converti, et le simuler en masquant le
 * client propriétaire derrière un helper serait une preuve fausse.
 * `MeetingRequestsService`, lui, l'atteint.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ADR-058 §D1 — UNE ERREUR RATTRAPÉE DOIT SORTIR DE SA PORTÉE              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `run` ouvre une transaction INTERACTIVE : toute erreur l'AVORTE et chaque
 * instruction suivante sur le même `tx` rend `25P02`. Ce fichier porte CINQ
 * récupérations qui avalent et continuent, contre trois pour `remediation`.
 * Chacune respecte la règle : le `try {` s'ouvre AVANT `this.scope.run(…)`, le
 * `catch` se ferme APRÈS, et toute instruction de RÉCUPÉRATION ouvre une portée
 * FRAÎCHE. La forme naïve — une portée par handler avec les `catch` dedans —
 * serait strictement PIRE que l'état actuel : un `auditLog.create` en échec
 * avalé ferait dégénérer le `COMMIT` en `ROLLBACK`, et l'acquittement que la
 * ligne d'audit se contentait de CONSIGNER serait perdu en silence pendant que
 * le handler rend 200.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ G-AUDIT — LA RELATION TRANSACTIONNELLE EST INCHANGÉE (ADR-060 §D5)       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * MESURÉ : ce fichier n'a AUCUN `$transaction`. Les deux `auditLog.create`
 * (`recordMeetingIntent`, `writeAuditEntry`) sont déjà post-mutation,
 * best-effort, chacun sa propre instruction, avec un `catch` qui avale et ne
 * remonte rien. Ils gardent EXACTEMENT cette relation : chacun ouvre sa PROPRE
 * portée, jamais celle de la mutation qu'il consigne. Cette tranche ne rend pas
 * la piste d'audit transactionnelle, et ne l'affaiblit pas non plus.
 *
 * `audit_log` est la PREMIÈRE table franchement WRITE-ONLY à entrer dans une
 * portée — ce fichier l'écrit et ne la lit jamais — et c'est ce qui rend la
 * règle `RETURNING` de `VERB_PRIVILEGES` porteuse plutôt qu'accidentelle
 * (ADR-060 §D2).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE QUI NE DOIT JAMAIS ENTRER DANS UNE PORTÉE                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `this.notifications.*` détient le client PROPRIÉTAIRE et lit `user_profile`.
 * Appelé DEPUIS un callback de portée, il prendrait une seconde connexion du
 * pool, sans GUC, pendant que la connexion `app_user` tient une transaction
 * interactive ouverte — l'inverse de PF-200 — et son `catch` empoisonnerait la
 * portée hôte. Chaque appel est donc LEXICALEMENT hors de tout `run`.
 *
 * RETOUR ARRIÈRE : remplacer les `this.scope.run(args.tenantId, tx => …)` par
 * `this.prisma` rétablit mot pour mot le comportement d'avant la tranche.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly scope: TenantScopeService,
    // ENCORE INJECTÉ, et nommé comme tel : `evaluateAll`,
    // `notifyGuardiansOfAlert` et `tenantsWithEnabledRules` restent sur la
    // connexion du propriétaire (voir le docblock de classe, ADR-060 §D1).
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ----- Rule management -----------------------------------------------------

  /**
   * Materialise rule rows for a tenant on demand. We don't seed them at install
   * time; the first GET creates the defaults so the admin sees the full list
   * with `enabled=false`. Idempotent.
   */
  async ensureRules(args: { tenantId: string; schoolId: string | null }): Promise<AlertRule[]> {
    // PORTÉE 1/2 — l'inventaire. Fermée AVANT le calcul de `toCreate` : ce
    // calcul est pur, et le tenir dans une transaction interactive la ferait
    // durer pour rien (budget « ≤ 2 instructions », tenant-scope.service.ts).
    const existing = await this.scope.run(args.tenantId, async (tx) =>
      tx.alertRule.findMany({
        where: { tenantId: args.tenantId, schoolId: args.schoolId ?? null },
      }),
    );
    const existingByCode = new Map(existing.map((r) => [r.code, r]));
    const toCreate = RULE_CODES.filter((c) => !existingByCode.has(c)).map((code) => ({
      tenantId: args.tenantId,
      schoolId: args.schoolId ?? null,
      code,
      enabled: false,
      severity: RULE_DEFAULTS[code].severity,
      parameters: RULE_DEFAULTS[code].parameters as Prisma.InputJsonValue,
    }));
    if (toCreate.length === 0) return existing;
    // PORTÉE 2/2 — l'écriture PUIS sa relecture, dans la MÊME portée : elles
    // étaient déjà deux instructions consécutives sans transaction, et les
    // réunir ne change aucun résultat observable tout en évitant qu'un `BEGIN`
    // de plus soit payé sur le premier GET de chaque tenant.
    return this.scope.run(args.tenantId, async (tx) => {
      await tx.alertRule.createMany({ data: toCreate });
      return tx.alertRule.findMany({
        where: { tenantId: args.tenantId, schoolId: args.schoolId ?? null },
      });
    });
  }

  async listRules(args: {
    tenantId: string;
    schoolId: string | null;
  }): Promise<AlertRuleDto[]> {
    const rules = await this.ensureRules(args);
    const byCode = new Map(rules.map((r) => [r.code, r]));

    // Tally open instances per code in one query. `ensureRules` a fermé SA
    // portée avant celle-ci : deux portées séquentielles, jamais imbriquées.
    const openCounts = await this.scope.run(args.tenantId, async (tx) =>
      tx.alertInstance.groupBy({
        by: ['code'],
        where: {
          tenantId: args.tenantId,
          status: 'open',
          ...(args.schoolId ? { schoolId: args.schoolId } : {}),
        },
        _count: { _all: true },
      }),
    );
    const openByCode = new Map(openCounts.map((c) => [c.code, c._count._all]));

    return RULE_CODES.map((code) => {
      const r = byCode.get(code) ?? null;
      const defaults = RULE_DEFAULTS[code];
      return {
        id: r?.id ?? null,
        code,
        label: defaults.label,
        description: defaults.description,
        enabled: r?.enabled ?? false,
        severity: (r?.severity ?? defaults.severity) as AlertSeverity,
        parameters: (r?.parameters as Record<string, unknown>) ?? defaults.parameters,
        openInstances: openByCode.get(code) ?? 0,
      };
    });
  }

  async updateRule(args: {
    tenantId: string;
    schoolId: string | null;
    code: AlertRuleCode;
    dto: UpdateAlertRuleDto;
  }): Promise<AlertRuleDto> {
    await this.ensureRules({ tenantId: args.tenantId, schoolId: args.schoolId });
    // Nullable compound unique keys don't get a clean `where` input in Prisma —
    // resolve the row id first, then update by primary key.
    //
    // UNE SEULE portée pour la garde ET l'écriture (le motif `calendar_event.
    // UPDATE`) : l'`update` ne porte qu'un `id`, donc sans la lecture de garde
    // dans la même transaction il resterait une fenêtre TOCTOU. Le 404 est levé
    // DEHORS, une fois la portée refermée — jamais depuis le callback, où il
    // avorterait la transaction plutôt que de la clore proprement.
    const updated = await this.scope.run(args.tenantId, async (tx) => {
      const existing = await tx.alertRule.findFirst({
        where: {
          tenantId: args.tenantId,
          schoolId: args.schoolId ?? null,
          code: args.code,
        },
        select: { id: true },
      });
      if (!existing) return null;
      return tx.alertRule.update({
        where: { id: existing.id },
        data: {
          ...(args.dto.enabled != null ? { enabled: args.dto.enabled } : {}),
          ...(args.dto.severity ? { severity: args.dto.severity } : {}),
          ...(args.dto.parameters
            ? { parameters: args.dto.parameters as Prisma.InputJsonValue }
            : {}),
        },
      });
    });
    if (!updated) throw new NotFoundException('Alert rule not found');
    const defaults = RULE_DEFAULTS[args.code];
    return {
      id: updated.id,
      code: updated.code,
      label: defaults.label,
      description: defaults.description,
      enabled: updated.enabled,
      severity: updated.severity,
      parameters: (updated.parameters as Record<string, unknown>) ?? {},
    };
  }

  // ----- Instances -----------------------------------------------------------

  async listInstances(args: {
    tenantId: string;
    schoolId: string | null;
    status?: AlertStatus;
    studentId?: string;
    limit: number;
    offset: number;
  }): Promise<{ data: AlertInstanceDto[]; total: number }> {
    const where: Prisma.AlertInstanceWhereInput = {
      tenantId: args.tenantId,
      ...(args.schoolId ? { schoolId: args.schoolId } : {}),
      ...(args.status ? { status: args.status } : {}),
      ...(args.studentId ? { studentId: args.studentId } : {}),
    };
    // Le `Promise.all` d'origine est SÉQUENTIALISÉ : une transaction interactive
    // est UNE connexion, et deux `await` concurrents sur le même `tx` ne sont
    // pas un ordonnancement supporté par Prisma. Le résultat rendu est
    // identique ; seul le parallélisme des deux requêtes disparaît.
    const { rows, total } = await this.scope.run(args.tenantId, async (tx) => {
      const found = await tx.alertInstance.findMany({
        where,
        include: {
          student: { select: { firstName: true, lastName: true } },
          subject: { select: { id: true, name: true, code: true } },
          classSection: { select: { id: true, name: true } },
        },
        orderBy: [{ status: 'asc' }, { detectedAt: 'desc' }],
        skip: args.offset,
        take: args.limit,
      });
      const count = await tx.alertInstance.count({ where });
      return { rows: found, total: count };
    });
    // Admin list does not surface a per-caller meeting-request marker (it is a
    // parent-confirmation read-path concern); pass an empty map → null field.
    return { data: rows.map((r) => this.toDto(r as AlertInstanceFull)), total };
  }

  /**
   * Resolve the `studentId` an alert instance belongs to, scoped to the caller's
   * tenant. Used by the parent-scoped lifecycle endpoints to run the
   * `StudentAccessService` guardianship ABAC check BEFORE mutating — the alert's
   * studentId is never trusted from the client; it is read here under the same
   * `where: { id, tenantId }` guard the lifecycle methods use, so a cross-tenant
   * id yields `null` (→ 404 at the controller) and never leaks another tenant's
   * student linkage. Returns `null` when the alert does not exist in this tenant.
   */
  async findStudentIdForAlert(args: {
    tenantId: string;
    id: string;
  }): Promise<string | null> {
    // La portée se REFERME avant que le contrôleur n'appelle
    // `canAccessStudent` : le mur ABAC tourne sur la connexion du propriétaire,
    // hors de toute transaction, exactement comme avant cette tranche.
    const row = await this.scope.run(args.tenantId, async (tx) =>
      tx.alertInstance.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
        select: { studentId: true },
      }),
    );
    return row?.studentId ?? null;
  }

  async acknowledge(args: {
    tenantId: string;
    id: string;
    userProfileId: string;
    actorRole: string | null;
    portal: string | null;
  }) {
    // La garde ET l'écriture partagent UNE portée : l'`update` ne porte qu'un
    // `id`, donc c'est la lecture gardée par `tenantId` qui l'ancre au tenant.
    // Le 404 est levé une fois la portée refermée.
    const outcome = await this.scope.run(args.tenantId, async (tx) => {
      const row = await tx.alertInstance.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
      });
      if (!row) return null;
      const didTransition = row.status === 'open';
      const updated = await tx.alertInstance.update({
        where: { id: args.id },
        data: {
          status: didTransition ? 'acknowledged' : row.status,
          acknowledgedAt: row.acknowledgedAt ?? new Date(),
          acknowledgedBy: row.acknowledgedBy ?? args.userProfileId,
        },
      });
      return { didTransition, beforeStatus: row.status, updated };
    });
    if (!outcome) throw new NotFoundException('Alert not found');
    // Best-effort, post-update audit trail. Only logged when acknowledge is a
    // real transition (open -> acknowledged); a no-op acknowledge writes no row
    // so the append-only trail stays meaningful. Never rolls back the status.
    //
    // G-AUDIT — la portée de la mutation est DÉJÀ FERMÉE ici. L'audit ouvre la
    // sienne, comme il émettait déjà sa propre instruction : sa relation
    // transactionnelle à l'acquittement est INCHANGÉE (ADR-060 §D5).
    if (outcome.didTransition) {
      await this.writeAuditEntry({
        tenantId: args.tenantId,
        alertId: args.id,
        actorId: args.userProfileId,
        action: 'alert.acknowledge',
        beforeStatus: outcome.beforeStatus,
        afterStatus: 'acknowledged',
        actorRole: args.actorRole,
        portal: args.portal,
      });
    }
    return outcome.updated;
  }

  async resolve(args: {
    tenantId: string;
    id: string;
    userProfileId: string;
    actorRole: string | null;
    portal: string | null;
  }) {
    // Idempotent terminal transition: only open/acknowledged alerts may move to
    // resolved. A second resolve (or a resolve of an already-dismissed alert) is
    // a no-op — it must NOT re-stamp resolvedAt/resolvedBy nor write a duplicate
    // audit row, keeping the append-only trail one-row-per-real-transition and
    // preventing status regression / provenance pollution (e.g. a parent
    // double-click or "resolving" a dismissed alert).
    //
    // Garde + écriture dans UNE portée ; les deux sorties anticipées (404, no-op)
    // sont rendues comme des VALEURS et traitées une fois la portée refermée.
    const outcome = await this.scope.run(args.tenantId, async (tx) => {
      const row = await tx.alertInstance.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
      });
      if (!row) return null;
      const didTransition = row.status === 'open' || row.status === 'acknowledged';
      if (!didTransition) return { didTransition, beforeStatus: row.status, updated: row };
      const updated = await tx.alertInstance.update({
        where: { id: args.id },
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy: args.userProfileId,
        },
      });
      return { didTransition, beforeStatus: row.status, updated };
    });
    if (!outcome) throw new NotFoundException('Alert not found');
    if (!outcome.didTransition) return outcome.updated;
    const updated = outcome.updated;
    // Best-effort: retract the guardian bell notifications for this alert. The
    // status transition is the source of truth — a notification failure must
    // never roll it back or surface to the admin (mirrors dispatchEmails).
    try {
      await this.notifications.markReadBySource({
        tenantId: args.tenantId,
        sourceType: 'alert_instance',
        sourceId: args.id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to retract notifications for resolved alert ${args.id} (status unaffected): ${(err as Error).message}`,
      );
    }
    // Best-effort, post-update audit trail (independent of the retraction above).
    await this.writeAuditEntry({
      tenantId: args.tenantId,
      alertId: args.id,
      actorId: args.userProfileId,
      action: 'alert.resolve',
      beforeStatus: outcome.beforeStatus,
      afterStatus: 'resolved',
      actorRole: args.actorRole,
      portal: args.portal,
    });
    return updated;
  }

  async dismiss(args: {
    tenantId: string;
    id: string;
    userProfileId: string;
    actorRole: string | null;
    portal: string | null;
  }) {
    // Idempotent terminal transition: only open/acknowledged alerts may move to
    // dismissed. A second dismiss (or dismissing an already-resolved alert) is a
    // no-op — no re-stamp, no duplicate audit row (see resolve for rationale).
    const outcome = await this.scope.run(args.tenantId, async (tx) => {
      const row = await tx.alertInstance.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
      });
      if (!row) return null;
      const didTransition = row.status === 'open' || row.status === 'acknowledged';
      if (!didTransition) return { didTransition, beforeStatus: row.status, updated: row };
      const updated = await tx.alertInstance.update({
        where: { id: args.id },
        data: {
          status: 'dismissed',
          resolvedAt: new Date(),
          resolvedBy: args.userProfileId,
        },
      });
      return { didTransition, beforeStatus: row.status, updated };
    });
    if (!outcome) throw new NotFoundException('Alert not found');
    if (!outcome.didTransition) return outcome.updated;
    const updated = outcome.updated;
    // Best-effort retraction (see resolve): a dismissed alert is closed, so its
    // guardian bell notifications stop ringing. Never blocks the dismiss.
    try {
      await this.notifications.markReadBySource({
        tenantId: args.tenantId,
        sourceType: 'alert_instance',
        sourceId: args.id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to retract notifications for dismissed alert ${args.id} (status unaffected): ${(err as Error).message}`,
      );
    }
    // Best-effort, post-update audit trail (independent of the retraction above).
    await this.writeAuditEntry({
      tenantId: args.tenantId,
      alertId: args.id,
      actorId: args.userProfileId,
      action: 'alert.dismiss',
      beforeStatus: outcome.beforeStatus,
      afterStatus: 'dismissed',
      actorRole: args.actorRole,
      portal: args.portal,
    });
    return updated;
  }

  /**
   * Record a parent's "talk to the teacher" meeting-request intent for an alert
   * (E1-S2, promoted in E1-S3). Unlike the lifecycle methods this does NOT touch
   * `AlertInstance.status` — a meeting request is orthogonal to
   * ack/resolve/dismiss, so the alert stays open/acknowledged and listed.
   *
   * S3 promotes the S2 append-only audit row into a queryable `MeetingRequest`
   * model. This now (a) creates ONE `MeetingRequest` (status `open`) with a
   * server-resolved `assignedToId` (subject teacher → main teacher → null —
   * never client-supplied), (b) STILL writes the append-only
   * `alert.meeting_intent` `AuditLog` row alongside (durable provenance — the
   * audit trail is non-negotiable), and (c) fires ONE in-app notification to the
   * assignee. Idempotency is a DB invariant: the `@@unique(tenantId, alertId,
   * requestedBy)` constraint + a P2002 catch guarantee one row + one notification
   * even under two concurrent POSTs (a re-request returns `alreadyRequested:true`
   * with the original `createdAt` and notifies no one). The alert id has already
   * been confirmed in-tenant and guardianship-checked by the controller
   * (`authorizeParentAlertAction`); studentId/code/subjectId/schoolId are re-read
   * here under the same `{ id, tenantId }` guard, never trusted from the client.
   * The return shape `{ ok, alreadyRequested, requestedAt }` is unchanged from S2.
   */
  async recordMeetingIntent(args: {
    tenantId: string;
    id: string;
    userProfileId: string;
    actorRole: string | null;
    portal: string | null;
  }): Promise<{ ok: true; alreadyRequested: boolean; requestedAt: string }> {
    // PORTÉE 1/4 — le diagnostic, dérivé du serveur sous la garde `{id, tenantId}`.
    const row = await this.scope.run(args.tenantId, async (tx) =>
      tx.alertInstance.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
        select: {
          studentId: true,
          code: true,
          subjectId: true,
          schoolId: true,
          title: true,
          student: { select: { firstName: true, lastName: true } },
        },
      }),
    );
    if (!row) throw new NotFoundException('Alert not found');

    // PORTÉE 2/4 — Fast-path idempotency check (friendly echo). The DB `@@unique`
    // is the real guarantee — the create below catches P2002 so two concurrent
    // POSTs still yield exactly one row + one notification (closes carried debt #3).
    const existing = await this.scope.run(args.tenantId, async (tx) =>
      tx.meetingRequest.findUnique({
        where: {
          tenantId_alertId_requestedBy: {
            tenantId: args.tenantId,
            alertId: args.id,
            requestedBy: args.userProfileId,
          },
        },
        select: { createdAt: true },
      }),
    );
    if (existing) {
      return {
        ok: true,
        alreadyRequested: true,
        requestedAt: existing.createdAt.toISOString(),
      };
    }

    // Resolve the assignee server-side (never trusted from the client). The
    // request is ALWAYS created even when no assignee resolves (best-effort).
    const assignedToId = await this.resolveMeetingAssignee({
      tenantId: args.tenantId,
      studentId: row.studentId,
      subjectId: row.subjectId ?? null,
    });

    // ADR-058 §D1 — le `try {` s'ouvre AVANT la portée 3/4 et le `catch` se
    // ferme APRÈS : la violation d'unicité AVORTE la transaction de la
    // création, donc la relecture du gagnant ne peut pas y être émise (elle
    // rendrait 25P02). Elle ouvre une portée FRAÎCHE.
    let created: { id: string; createdAt: Date };
    try {
      // PORTÉE 3/4 — l'écriture. `select` fait un `INSERT … RETURNING`, qui
      // exige SELECT sur `meeting_request` en plus d'INSERT (ADR-060 §D2).
      created = await this.scope.run(args.tenantId, async (tx) =>
        tx.meetingRequest.create({
          data: {
            tenantId: args.tenantId,
            schoolId: row.schoolId ?? null,
            alertId: args.id,
            studentId: row.studentId,
            subjectId: row.subjectId ?? null,
            alertCode: row.code,
            requestedBy: args.userProfileId,
            assignedToId,
            status: 'open',
          },
          select: { id: true, createdAt: true },
        }),
      );
    } catch (err) {
      // Concurrency: a parallel POST won the @@unique race. Treat as
      // already-requested (read the original row's createdAt) — one row, one
      // notification. Any other error propagates.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // PORTÉE 4/4 — FRAÎCHE, ouverte DANS le `catch`, après que la
        // transaction fautive a été fermée par la propagation de l'erreur.
        const winner = await this.scope.run(args.tenantId, async (tx) =>
          tx.meetingRequest.findUnique({
            where: {
              tenantId_alertId_requestedBy: {
                tenantId: args.tenantId,
                alertId: args.id,
                requestedBy: args.userProfileId,
              },
            },
            select: { createdAt: true },
          }),
        );
        return {
          ok: true,
          alreadyRequested: true,
          requestedAt: (winner?.createdAt ?? new Date()).toISOString(),
        };
      }
      throw err;
    }

    // Keep the append-only audit trail unbroken (S1/S2 promise) — written only
    // on a genuine new create, alongside the queryable model. Best-effort.
    //
    // G-AUDIT / ADR-058 §D1 — SA PROPRE portée, `try` dehors, `catch` dehors.
    // Partager la portée de la création ci-dessus retournerait la promesse de ce
    // `catch` : l'échec avalé avorterait la transaction, le `COMMIT` dégénérerait
    // en `ROLLBACK`, et la DEMANDE DE RENDEZ-VOUS elle-même disparaîtrait
    // pendant que le handler rend 200.
    try {
      await this.scope.run(args.tenantId, async (tx) =>
        tx.auditLog.create({
          data: {
            tenantId: args.tenantId,
            actorId: args.userProfileId,
            actorRole: args.actorRole,
            portal: args.portal,
            action: 'alert.meeting_intent',
            resourceType: 'alert_instance',
            resourceId: args.id,
            after: {
              studentId: row.studentId,
              alertCode: row.code,
              subjectId: row.subjectId ?? null,
              meetingRequestId: created.id,
            } as Prisma.InputJsonValue,
          },
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to write alert.meeting_intent audit row for meeting request ${created.id} (request unaffected): ${(err as Error).message}`,
      );
    }

    // Notify the assignee on a NEW request only (never on the idempotent path).
    // Best-effort: a notification failure must never roll back the create.
    if (assignedToId) {
      const studentName =
        `${row.student.firstName} ${row.student.lastName}`.trim() || 'Un élève';
      try {
        await this.notifications.createMany([
          {
            tenantId: args.tenantId,
            userProfileId: assignedToId,
            kind: 'alert',
            severity: 'warning',
            title: 'Demande de rendez-vous d’un parent',
            body: `${studentName} — ${row.title}`,
            link: '/teacher/meeting-requests',
            sourceType: 'meeting_request',
            sourceId: created.id,
          },
        ]);
      } catch (err) {
        this.logger.error(
          `Failed to notify assignee ${assignedToId} of meeting request ${created.id} (request unaffected): ${(err as Error).message}`,
        );
      }
    }

    return {
      ok: true,
      alreadyRequested: false,
      requestedAt: created.createdAt.toISOString(),
    };
  }

  /**
   * Resolve the teacher/admin a meeting request routes to, deterministically:
   *   1. subject teacher — active `TeachingAssignment` for the student's current
   *      class section + the alert's subjectId (active academic year), or
   *   2. main teacher (`isMainTeacher`) of the student's current class section, or
   *   3. null (unassigned → visible to school admins in the action center).
   *
   * "Current class section" = the student's active `Enrollment` in the active
   * academic year. Best-effort: any lookup failure → null; NEVER throws, so the
   * meeting request is always created (carried pre-mortem PM-3).
   */
  private async resolveMeetingAssignee(args: {
    tenantId: string;
    studentId: string;
    subjectId: string | null;
  }): Promise<string | null> {
    // ADR-058 §D1 — le `try` de la MÉTHODE enveloppe les TROIS portées, et
    // chacune se referme avant la suivante. Aucun `catch` ne vit à l'intérieur
    // d'un callback : une dégradation gracieuse à `null` ne doit jamais devenir
    // « continuer d'émettre dans une transaction avortée ».
    try {
      const enrollment = await this.scope.run(args.tenantId, async (tx) =>
        tx.enrollment.findFirst({
          where: {
            tenantId: args.tenantId,
            studentId: args.studentId,
            status: 'active',
            academicYear: { status: 'active' },
          },
          orderBy: { enrolledAt: 'desc' },
          select: { classSectionId: true, academicYearId: true },
        }),
      );
      if (!enrollment) return null;

      // 1. Subject teacher for (current class section, subject) in the active year.
      if (args.subjectId) {
        const subjectId = args.subjectId;
        const subjectAssignment = await this.scope.run(args.tenantId, async (tx) =>
          tx.teachingAssignment.findFirst({
            where: {
              tenantId: args.tenantId,
              classSectionId: enrollment.classSectionId,
              subjectId,
              academicYearId: enrollment.academicYearId,
            },
            select: { teacherProfile: { select: { userProfileId: true } } },
          }),
        );
        const subjectTeacherId = subjectAssignment?.teacherProfile.userProfileId ?? null;
        if (subjectTeacherId) return subjectTeacherId;
      }

      // 2. Main teacher of the current class section.
      const mainAssignment = await this.scope.run(args.tenantId, async (tx) =>
        tx.teachingAssignment.findFirst({
          where: {
            tenantId: args.tenantId,
            classSectionId: enrollment.classSectionId,
            academicYearId: enrollment.academicYearId,
            isMainTeacher: true,
          },
          select: { teacherProfile: { select: { userProfileId: true } } },
        }),
      );
      return mainAssignment?.teacherProfile.userProfileId ?? null;
    } catch (err) {
      // S-E01-1l / PF-258 — CE `catch` NE PEUT PLUS AVALER UN REFUS DE PORTÉE.
      //
      // Avant cette tranche, les trois lectures ci-dessus ne pouvaient échouer
      // que sur une panne base. Cette tranche AJOUTE une classe d'erreur —
      // `refused_unusable` (503) et l'imbrication refusée — et la dégradation
      // héritée l'écrirait dans la DONNÉE : `assignedToId: null` est persisté UNE
      // FOIS, POUR TOUJOURS, l'enseignant ne voit jamais la demande, et elle
      // atterrit dans le seau « non assigné » de l'admin sans trace de la cause.
      // Un défaut de configuration deviendrait une perte silencieuse sur la
      // promesse centrale du produit (le parent demande → l'enseignant agit).
      // On REMONTE donc les fautes d'INFRASTRUCTURE et on ne dégrade que sur ce
      // qui pouvait déjà échouer avant : le comportement hérité est préservé
      // pour toute erreur qui existait, et refusé pour celle que ce diff crée.
      if (err instanceof TenantScopeError || err instanceof ServiceUnavailableException) {
        throw err;
      }
      this.logger.error(
        `Failed to resolve meeting assignee for student ${args.studentId} (request will be unassigned): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Append-only audit row for an alert lifecycle transition. Best-effort and
   * post-update: a write failure is logged and swallowed, never rolling back the
   * status change nor surfacing to the controller (mirrors the notification
   * retraction). Tenant-scoped — `tenantId` always carries `args.tenantId`, and
   * the alert id has already been confirmed in-tenant by the caller's findFirst.
   * Uses the established inline `tx.auditLog.create` convention (no shared
   * AuditService exists). `hash`/`prevHash` are left unset, matching every other
   * call site. `actorRole`/`portal` are now derived from the authenticated
   * caller's JWT by the controller (see `deriveAlertActorProvenance`) instead of
   * being hardcoded `school_admin`/`admin`; both are nullable to mirror the
   * `AuditLog` `String?` columns when the caller holds no known realm role.
   */
  private async writeAuditEntry(args: {
    tenantId: string;
    alertId: string;
    actorId: string;
    action: 'alert.acknowledge' | 'alert.resolve' | 'alert.dismiss';
    beforeStatus: string;
    afterStatus: string;
    actorRole: string | null;
    portal: string | null;
  }): Promise<void> {
    // G-AUDIT / ADR-058 §D1 — SA PROPRE portée, ouverte APRÈS que celle de la
    // mutation s'est refermée, avec le `try` dehors et le `catch` dehors. La
    // relation transactionnelle à l'acquittement / la résolution / le rejet est
    // exactement celle d'avant la tranche : aucune (ADR-060 §D5).
    try {
      await this.scope.run(args.tenantId, async (tx) =>
        tx.auditLog.create({
          data: {
            tenantId: args.tenantId,
            actorId: args.actorId,
            actorRole: args.actorRole,
            portal: args.portal,
            action: args.action,
            resourceType: 'alert_instance',
            resourceId: args.alertId,
            before: { status: args.beforeStatus } as Prisma.InputJsonValue,
            after: { status: args.afterStatus } as Prisma.InputJsonValue,
          },
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to write audit entry ${args.action} for alert ${args.alertId} (status unaffected): ${(err as Error).message}`,
      );
    }
  }

  // ----- Evaluator -----------------------------------------------------------

  /**
   * Run every enabled rule and materialise new alerts (deduped within
   * DEDUP_WINDOW_DAYS). Returns the count of new alerts created.
   *
   * Called from:
   *  - Admin "Lancer l'évaluation" button via POST /alerts/evaluate
   *  - Worker cron (every 15 min)
   *  - Future event triggers (grade.publish, attendance.batch)
   *
   * S-E01-1l — HORS PORTÉE, ÉNUMÉRÉ, PAS OUBLIÉ (ADR-060 §D1). Les quatre
   * instructions ci-dessous restent sur `this.prisma` et sont déclarées une par
   * une dans `ENUMERATED_OUTSIDE_SCOPE` avec leur raison. Les DEUX raisons,
   * indépendantes :
   *  (a) c'est un LOT — O(règles × détections) allers-retours, dont sept
   *      évaluateurs de règles qui émettent leurs propres requêtes sur tout le
   *      tenant. La couture borne une portée à « ≤ 2 instructions » et Prisma
   *      coupe une transaction interactive à 5 s : l'y enfermer rendrait P2028
   *      sur le bouton admin ET annulerait les alertes déjà matérialisées ;
   *  (b) la convertir exige de retyper `RuleContext.prisma` en
   *      `Prisma.TransactionClient` et de convertir sept fichiers `rules/*` —
   *      un autre module. À moitié convertie, elle mettrait des `ctx.prisma.*`
   *      sur la connexion PROPRIÉTAIRE à l'intérieur d'une portée ouverte.
   */
  async evaluateAll(args: { tenantId: string; schoolId: string | null }): Promise<{
    rulesRun: number;
    detected: number;
    createdInstances: number;
  }> {
    const rules = await this.prisma.alertRule.findMany({
      where: {
        tenantId: args.tenantId,
        enabled: true,
        ...(args.schoolId ? { schoolId: args.schoolId } : {}),
      },
    });

    if (rules.length === 0) {
      return { rulesRun: 0, detected: 0, createdInstances: 0 };
    }

    // S-E03-4 / ADR-070 — résolution CANONIQUE, hissée une seule fois hors de
    // la boucle de règles (inchangé : une requête par évaluation, jamais N+1).
    // La date de référence est injectée par l'appelant, jamais lue dans le résolveur.
    const referenceDate = new Date();
    const activeYear = await resolveActiveAcademicYear(prismaAcademicYearReader(this.prisma), {
      tenantId: args.tenantId,
      ...(args.schoolId ? { schoolId: args.schoolId } : {}),
      referenceDate,
      // Sémantique préservée : ce site rendait déjà `null` en l'absence d'année active.
      onAbsent: 'nullWhenNoActiveYear',
    });

    // PF-15 — la vétusté est REMONTÉE, pas masquée. Site à basse fréquence (une
    // évaluation d'alertes), donc un avertissement structuré y est gratuit ;
    // `SchoolContextService` n'en émet aucun, il tourne à chaque requête.
    if (activeYear?.isStale) {
      this.logger.warn(
        `[PF-15] Année scolaire active vétuste — tenantId=${args.tenantId} ` +
          `schoolId=${activeYear.schoolId} academicYearId=${activeYear.id} ` +
          `endDate=${activeYear.endDate.toISOString()} referenceDate=${referenceDate.toISOString()} ` +
          `staleByDays=${activeYear.staleByDays} activeCount=${activeYear.activeCount}`,
      );
    }

    let totalDetected = 0;
    let totalCreated = 0;
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - DEDUP_WINDOW_DAYS);

    for (const rule of rules) {
      const fn = RULE_FN[rule.code];
      if (!fn) {
        this.logger.debug(`Rule ${rule.code} has no evaluator yet — skipping`);
        continue;
      }

      const detections = await fn({
        prisma: this.prisma,
        rule,
        tenantId: args.tenantId,
        schoolId: args.schoolId,
        academicYearId: activeYear?.id ?? null,
        dedupWindowDays: DEDUP_WINDOW_DAYS,
      });
      totalDetected += detections.length;

      // Deduplicate against existing recent alerts for the same (rule, student, subject?)
      for (const d of detections) {
        const recent = await this.prisma.alertInstance.findFirst({
          where: {
            tenantId: args.tenantId,
            ruleId: rule.id,
            studentId: d.studentId,
            subjectId: d.subjectId ?? null,
            detectedAt: { gte: since },
            status: { in: ['open', 'acknowledged'] },
          },
          select: { id: true },
        });
        if (recent) continue;

        const instance = await this.prisma.alertInstance.create({
          data: {
            tenantId: args.tenantId,
            schoolId: args.schoolId ?? null,
            ruleId: rule.id,
            code: rule.code,
            severity: rule.severity,
            status: 'open',
            studentId: d.studentId,
            subjectId: d.subjectId ?? null,
            classSectionId: d.classSectionId ?? null,
            title: d.title,
            body: d.body,
            recommendation: d.recommendation ?? null,
            context: (d.context ?? {}) as Prisma.InputJsonValue,
          },
        });
        totalCreated++;

        // Fan out a notification to each active guardian. Dedup by sourceId
        // ensures a re-evaluation never double-pings the same parent.
        await this.notifyGuardiansOfAlert({
          tenantId: args.tenantId,
          studentId: d.studentId,
          alertId: instance.id,
          severity: rule.severity,
          title: d.title,
          body: d.body,
        });
      }
    }

    this.logger.log(
      `evaluateAll(tenant=${args.tenantId}, school=${args.schoolId ?? '*'}) — ${rules.length} rules, ${totalDetected} detected, ${totalCreated} new`,
    );
    return { rulesRun: rules.length, detected: totalDetected, createdInstances: totalCreated };
  }

  // ----- Notification fan-out ------------------------------------------------

  /**
   * For a freshly-created AlertInstance, look up every active guardian linked
   * to the student via `Guardianship` and create one in-app notification per
   * guardian (deduplicated by `sourceId = alertId` so the same alert never
   * notifies the same guardian twice).
   *
   * S-E01-1l — HORS PORTÉE avec `evaluateAll`, dont il est le fan-out par
   * détection : il est appelé DEPUIS la boucle de l'évaluateur, donc le
   * convertir seul ouvrirait une portée par détection à l'intérieur d'un lot
   * que rien ne borne, et il enchaîne sur `this.notifications.createMany`, qui
   * détient le client propriétaire. Déclaré dans `ENUMERATED_OUTSIDE_SCOPE`.
   */
  private async notifyGuardiansOfAlert(args: {
    tenantId: string;
    studentId: string;
    alertId: string;
    severity: AlertSeverity;
    title: string;
    body: string;
  }): Promise<void> {
    const guardianships = await this.prisma.guardianship.findMany({
      where: {
        tenantId: args.tenantId,
        studentId: args.studentId,
        ...guardianshipLiveWhere(),
        guardian: { userProfileId: { not: null } },
      },
      include: { guardian: { select: { userProfileId: true } } },
    });
    const recipients = guardianships
      .map((g) => g.guardian.userProfileId)
      .filter((id): id is string => !!id);
    if (recipients.length === 0) return;

    const severityMap: Record<AlertSeverity, NotificationSeverity> = {
      low: 'info',
      medium: 'warning',
      high: 'danger',
    };

    await this.notifications.createMany(
      recipients.map((userProfileId) => ({
        tenantId: args.tenantId,
        userProfileId,
        kind: 'alert' as const,
        severity: severityMap[args.severity],
        title: args.title,
        body: args.body,
        link: `/parent/recommendations?studentId=${args.studentId}`,
        sourceType: 'alert_instance',
        sourceId: args.alertId,
      })),
    );
  }

  // ----- Parent view (ABAC) --------------------------------------------------

  /**
   * Alerts visible by a parent for a given student. The caller MUST have
   * already passed `StudentAccessService.canAccessStudent` before invoking
   * this — the service trusts its inputs.
   *
   * E1-S3 (carried debt #2): when `userProfileId` is provided, batch-load the
   * caller's OWN open `MeetingRequest` per alert (keyed on `requestedBy =
   * userProfileId`) in ONE query and stamp `meetingRequestedAt` on each DTO so
   * the parent's "Demande envoyée" confirmation persists across reloads. Keyed
   * on the caller's own `requestedBy`, never a co-guardian's — no cross-guardian
   * leak. No per-row N+1: a single `findMany` over the page's alert ids.
   */
  async listForStudent(args: {
    tenantId: string;
    studentId: string;
    userProfileId?: string;
    limit?: number;
  }): Promise<AlertInstanceDto[]> {
    const rows = await this.scope.run(args.tenantId, async (tx) =>
      tx.alertInstance.findMany({
        where: {
          tenantId: args.tenantId,
          studentId: args.studentId,
          status: { in: ['open', 'acknowledged'] },
        },
        include: {
          student: { select: { firstName: true, lastName: true } },
          subject: { select: { id: true, name: true, code: true } },
          classSection: { select: { id: true, name: true } },
        },
        orderBy: { detectedAt: 'desc' },
        take: args.limit ?? 10,
      }),
    );

    const requestedAtByAlert = await this.loadMeetingRequestedAt({
      tenantId: args.tenantId,
      alertIds: rows.map((r) => r.id),
      userProfileId: args.userProfileId,
    });

    return rows.map((r) => this.toDto(r as AlertInstanceFull, requestedAtByAlert));
  }

  /**
   * Batch-load the caller's own meeting-request timestamp per alert id, in one
   * query. Returns an empty map when no caller is provided (admin list path) or
   * there are no alerts. Best-effort: a lookup failure degrades to "not
   * requested" rather than failing the alert list (the confirmation is a UX hint,
   * not load-bearing).
   */
  private async loadMeetingRequestedAt(args: {
    tenantId: string;
    alertIds: string[];
    userProfileId?: string;
  }): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!args.userProfileId || args.alertIds.length === 0) return map;
    // ADR-058 §D1 — `try` AVANT la portée, `catch` APRÈS. La dégradation à
    // « non demandé » reste une dégradation, pas une transaction avortée dans
    // laquelle on continuerait d'émettre.
    //
    // Le filtre `requestedBy: args.userProfileId` est CONSERVÉ mot pour mot :
    // c'est lui, et pas la portée tenant, qui empêche la fuite inter-tuteurs —
    // deux tuteurs d'un même élève partagent le tenant.
    const userProfileId = args.userProfileId;
    try {
      const requests = await this.scope.run(args.tenantId, async (tx) =>
        tx.meetingRequest.findMany({
          where: {
            tenantId: args.tenantId,
            alertId: { in: args.alertIds },
            requestedBy: userProfileId,
          },
          select: { alertId: true, createdAt: true },
        }),
      );
      for (const r of requests) map.set(r.alertId, r.createdAt.toISOString());
    } catch (err) {
      this.logger.error(
        `Failed to load meeting-request markers (parent confirmation degrades to CTA): ${(err as Error).message}`,
      );
    }
    return map;
  }

  // -- helpers --------------------------------------------------------------

  private toDto(
    row: AlertInstanceFull,
    requestedAtByAlert?: Map<string, string>,
  ): AlertInstanceDto {
    return {
      id: row.id,
      code: row.code,
      severity: row.severity,
      status: row.status,
      studentId: row.studentId,
      studentName: `${row.student.firstName} ${row.student.lastName}`.trim(),
      subjectId: row.subject?.id ?? null,
      subjectName: row.subject?.name ?? null,
      subjectCode: row.subject?.code ?? null,
      classSectionId: row.classSection?.id ?? null,
      classSectionName: row.classSection?.name ?? null,
      title: row.title,
      body: row.body,
      recommendation: row.recommendation,
      detectedAt: row.detectedAt.toISOString(),
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      meetingRequestedAt: requestedAtByAlert?.get(row.id) ?? null,
    };
  }

  // ----- Tenant scan (worker) ------------------------------------------------

  /**
   * Returns every tenant id that has at least one enabled rule. Used by the
   * worker cron to know which tenants need evaluation.
   *
   * S-E01-1l — HORS PORTÉE PAR CONSTRUCTION, et c'est la raison la plus nette
   * de la liste : cette requête ne prend AUCUN `tenantId` et fait `distinct`
   * dessus. Elle PRODUIT l'ensemble des tenants qu'un appelant scoperait
   * ensuite ; l'entrée d'une portée ne peut pas être émise depuis l'intérieur
   * de cette portée. Déclarée dans `ENUMERATED_OUTSIDE_SCOPE`.
   *
   * MESURÉ 2026-08-23 (PF-259) : aucun appelant dans `apps/api` ni dans
   * `apps/worker` — le cron du worker a son propre miroir
   * (`apps/worker/src/modules/alerts-cron/alerts-evaluator.service.ts`). La
   * méthode est CONSERVÉE (retirer une méthode publique d'un service exporté
   * n'est pas une conversion de portée), et la raison énumérée dit ce qu'elle
   * est plutôt que d'inventer un appelant.
   */
  async tenantsWithEnabledRules(): Promise<string[]> {
    const rows = await this.prisma.alertRule.findMany({
      where: { enabled: true },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    return rows.map((r) => r.tenantId);
  }

  /**
   * Permission helper for non-controller code paths (no-op for now — the
   * controller already gates writes via the existing @RequiresPermission
   * decorator).
   */
  ensureAdmin(_isAdmin: boolean): void {
    if (!_isAdmin) throw new ForbiddenException('Admin permission required');
  }
}
