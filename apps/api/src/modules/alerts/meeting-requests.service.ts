import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { TenantScopeService } from '../../shared/prisma/tenant-scope.service';

import { MeetingRequestDto, MeetingRequestStatus } from './alerts.types';

/**
 * The caller's effective scope, derived from their realm roles. Admins see every
 * request in their tenant/school; teachers see only requests assigned to them OR
 * unassigned within their school (they must NOT see another teacher's queue — we
 * filter on `assignedToId = me` ∪ `assignedToId IS NULL`, pre-mortem PM-2).
 *
 * S-E05-16 / `PF-300` / `DNC-06` — THE STATED REASON WAS CORRECTED, THE
 * WORKAROUND WAS KEPT. This docblock used to justify the local filter by
 * "`StudentAccessService.scopeForUser` still returns `studentIds:null` for
 * teachers, so we cannot lean on student-scope here". That is no longer true:
 * since `S-E05-16` the teacher branch returns a bounded, tenant-scoped array
 * (`PF-288`). The filter STAYS anyway, and now for a stronger reason — a
 * teacher's STUDENT scope and a teacher's meeting-request QUEUE are different
 * questions: two teachers of the same class share students but must not share
 * queues, so student-scope would be too WIDE here, not too narrow. Converging
 * this onto the shared `TeachingWall` seam is `PF-270`, still open, and out of
 * this slice's declared perimeter.
 */
type MeetingRequestScope =
  | { kind: 'admin' }
  | { kind: 'teacher'; userProfileId: string }
  | { kind: 'none' };

const MEETING_REQUEST_INCLUDE = {
  alert: { select: { title: true, severity: true } },
  student: {
    select: {
      firstName: true,
      lastName: true,
      enrollments: {
        where: { status: 'active' as const, academicYear: { status: 'active' as const } },
        orderBy: { enrolledAt: 'desc' as const },
        take: 1,
        select: { classSection: { select: { name: true } } },
      },
    },
  },
  subject: { select: { code: true, name: true } },
  requester: { select: { firstName: true, lastName: true } },
  assignedTo: { select: { firstName: true, lastName: true } },
} satisfies Prisma.MeetingRequestInclude;

type MeetingRequestFull = Prisma.MeetingRequestGetPayload<{
  include: typeof MEETING_REQUEST_INCLUDE;
}>;

/**
 * Teacher/admin meeting-request action center (E1-S3). All reads/writes are
 * tenant-scoped AND role-scoped. Every state change writes an append-only audit
 * row. No request is ever updated cross-tenant or cross-teacher (404 instead of
 * leaking existence).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ S-E01-1l — CONVERTI EN ENTIER, ET LE CONSTRUCTEUR EST LA PREUVE          │
 * │ (ADR-057 §D4, appliqué ; ADR-060 §D4)                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `PrismaService` n'est plus injecté ici. Les CINQ instructions de ce fichier
 * passent toutes par `TenantScopeService.run(args.tenantId, tx => …)`, donc
 * l'absence de référence au client PROPRIÉTAIRE est une propriété du
 * CONSTRUCTEUR et non une convention de revue. Le tenant est TOUJOURS
 * `args.tenantId`, jamais `row.tenantId`.
 *
 * Les gardes `tenantId:` explicites de `buildScopeWhere` RESTENT : sans
 * `DATABASE_URL_APP`, `run` s'exécute sur la connexion du propriétaire
 * (ADR-056), qui échappe à ses propres policies. Le filtre de RÔLE
 * (`assignedToId = moi` ∪ `assignedToId IS NULL`) reste lui aussi intact — RLS
 * isole le TENANT, jamais la file d'un enseignant de celle d'un autre.
 *
 * G-AUDIT (ADR-060 §D5) — l'`auditLog.create` de `resolve` était déjà
 * post-mutation, best-effort, sa propre instruction, avec un `catch` qui avale.
 * Il ouvre donc sa PROPRE portée, `try` dehors et `catch` dehors (ADR-058 §D1) :
 * partagé avec la portée de l'`update`, un échec avalé avorterait la
 * transaction et la RÉSOLUTION que la ligne consigne serait perdue pendant que
 * le handler rend 200. La relation transactionnelle est inchangée : aucune.
 */
@Injectable()
export class MeetingRequestsService {
  private readonly logger = new Logger(MeetingRequestsService.name);

  constructor(private readonly scope: TenantScopeService) {}

  /** Map the caller's realm roles to an effective action-center scope. */
  scopeFromRoles(roles: string[], userProfileId: string): MeetingRequestScope {
    if (roles.includes('super_admin') || roles.includes('school_admin')) {
      return { kind: 'admin' };
    }
    if (roles.includes('teacher')) {
      return { kind: 'teacher', userProfileId };
    }
    return { kind: 'none' };
  }

  /**
   * Build the tenant + school + role `where` filter shared by list and resolve.
   * Returns `null` when the caller has no action-center scope (→ empty list /
   * 404 on resolve).
   */
  private buildScopeWhere(args: {
    tenantId: string;
    schoolId: string | null;
    scope: MeetingRequestScope;
  }): Prisma.MeetingRequestWhereInput | null {
    if (args.scope.kind === 'none') return null;
    const base: Prisma.MeetingRequestWhereInput = {
      tenantId: args.tenantId,
      ...(args.schoolId ? { schoolId: args.schoolId } : {}),
    };
    if (args.scope.kind === 'teacher') {
      // A teacher sees only their own queue + unassigned (admin overflow).
      base.OR = [{ assignedToId: args.scope.userProfileId }, { assignedToId: null }];
    }
    return base;
  }

  async list(args: {
    tenantId: string;
    schoolId: string | null;
    scope: MeetingRequestScope;
    status: MeetingRequestStatus;
    limit: number;
    offset: number;
  }): Promise<{ data: MeetingRequestDto[]; total: number }> {
    const scopeWhere = this.buildScopeWhere(args);
    if (!scopeWhere) return { data: [], total: 0 };

    const where: Prisma.MeetingRequestWhereInput = {
      ...scopeWhere,
      status: args.status,
    };

    // Le `Promise.all` d'origine est SÉQUENTIALISÉ : une transaction interactive
    // est UNE connexion, et deux `await` concurrents sur le même `tx` ne sont
    // pas un ordonnancement supporté. Le résultat rendu est identique.
    const { rows, total } = await this.scope.run(args.tenantId, async (tx) => {
      const found = await tx.meetingRequest.findMany({
        where,
        include: MEETING_REQUEST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: args.offset,
        take: args.limit,
      });
      const count = await tx.meetingRequest.count({ where });
      return { rows: found, total: count };
    });
    return { data: rows.map((r) => this.toDto(r)), total };
  }

  /**
   * Idempotent open→resolved transition. Tenant + role-scoped: the resolve
   * lookup uses the SAME scope filter as the list, so a teacher cannot resolve
   * another teacher's request (out-of-scope id → 404, never leaks existence).
   * A second resolve is a no-op (no re-stamp, no duplicate audit row). Writes one
   * append-only `meeting_request.resolve` audit row, best-effort post-update.
   */
  async resolve(args: {
    tenantId: string;
    schoolId: string | null;
    scope: MeetingRequestScope;
    id: string;
    userProfileId: string;
    actorRole: string | null;
    portal: string | null;
  }): Promise<MeetingRequestDto> {
    const scopeWhere = this.buildScopeWhere(args);
    if (!scopeWhere) throw new NotFoundException('Meeting request not found');

    // La garde de rôle ET l'écriture partagent UNE portée : l'`update` ne porte
    // qu'un `id`, donc c'est le `findFirst` filtré par `scopeWhere` qui interdit
    // à un enseignant de résoudre la demande d'un autre — sans TOCTOU. Les deux
    // sorties anticipées (404, no-op) sont rendues comme des VALEURS et traitées
    // une fois la portée refermée : une exception levée depuis le callback
    // avorterait la transaction au lieu de la clore.
    // Le `where` est composé DEHORS, comme dans `list`, et passé par son nom :
    // la dérivation de clôture (`scripts/tenant-adversarial-check.js`) résout un
    // identifiant mais NOMME un spread local qu'elle ne peut pas résoudre
    // (`unresolvable-argument-reference`, PF-250). Composer ici plutôt qu'à
    // l'intérieur de l'appel garde la profondeur relationnelle DÉRIVABLE au lieu
    // de la faire dépendre d'une branche silencieuse.
    const where: Prisma.MeetingRequestWhereInput = { ...scopeWhere, id: args.id };

    const outcome = await this.scope.run(args.tenantId, async (tx) => {
      const row = await tx.meetingRequest.findFirst({
        where,
        include: MEETING_REQUEST_INCLUDE,
      });
      if (!row) return null;

      // Idempotent: only open → resolved transitions. A second resolve (or
      // resolving a cancelled request) is a no-op — no re-stamp, no duplicate audit.
      if (row.status !== 'open') return { transitioned: false as const, row };

      const updated = await tx.meetingRequest.update({
        where: { id: args.id },
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy: args.userProfileId,
        },
        include: MEETING_REQUEST_INCLUDE,
      });
      return { transitioned: true as const, row: updated };
    });
    if (!outcome) throw new NotFoundException('Meeting request not found');
    if (!outcome.transitioned) return this.toDto(outcome.row);
    const updated = outcome.row;

    // G-AUDIT — SA PROPRE portée, ouverte après la fermeture de celle de
    // l'`update`, `try` dehors et `catch` dehors (ADR-058 §D1).
    try {
      await this.scope.run(args.tenantId, async (tx) =>
        tx.auditLog.create({
          data: {
            tenantId: args.tenantId,
            actorId: args.userProfileId,
            actorRole: args.actorRole,
            portal: args.portal,
            action: 'meeting_request.resolve',
            resourceType: 'meeting_request',
            resourceId: args.id,
            before: { status: 'open' } as Prisma.InputJsonValue,
            after: { status: 'resolved' } as Prisma.InputJsonValue,
          },
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to write meeting_request.resolve audit row for ${args.id} (status unaffected): ${(err as Error).message}`,
      );
    }

    return this.toDto(updated);
  }

  private toDto(row: MeetingRequestFull): MeetingRequestDto {
    const requesterName =
      `${row.requester.firstName} ${row.requester.lastName}`.trim() || null;
    const assigneeName = row.assignedTo
      ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}`.trim() || null
      : null;
    return {
      id: row.id,
      status: row.status,
      alertId: row.alertId,
      alertCode: row.alertCode,
      alertSeverity: row.alert.severity,
      alertTitle: row.alert.title,
      studentId: row.studentId,
      studentName: `${row.student.firstName} ${row.student.lastName}`.trim(),
      classSectionName: row.student.enrollments[0]?.classSection.name ?? null,
      subjectId: row.subjectId,
      subjectCode: row.subject?.code ?? null,
      subjectName: row.subject?.name ?? null,
      requestedByName: requesterName,
      assignedToId: row.assignedToId,
      assignedToName: assigneeName,
      requestedAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  }
}
