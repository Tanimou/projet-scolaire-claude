import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  candidateEnrollmentWhere,
  enrollmentTotalOrder,
  resolveActiveAcademicYear,
  selectActiveEnrollment,
} from '@pilotage/contracts';
import type { Prisma, PrismaClient } from '@prisma/client';

import { prismaAcademicYearReader } from '../../shared/academic-year/prisma-academic-year-reader';
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

/**
 * B5 — S-E03-3 / PF-12 / ADR-072.
 *
 * TROIS choses ont changé, et chacune fermait une manière de mentir :
 *
 * 1. Le `where` relationnel `academicYear: { status: 'active' }` est parti. Il
 *    répondait à la question par une COLONNE INDÉPENDANTE de l'année canonique
 *    (`AcademicYear.status` et `Enrollment.status` sont deux colonnes,
 *    `schema.prisma:319` / `:652`) — précisément l'axe 1 de PF-12. L'année
 *    canonique arrive maintenant de `resolveActiveAcademicYear` (ADR-070), et la
 *    sélection est faite par le contrat.
 *
 * 2. Le `take: 1` est parti : une seule ligne ne permet pas de distinguer
 *    « diplômé » (`out_of_scope`) de « aucun dossier » (`none`).
 *
 * 3. Le `select` s'élargit à `id` / `status` / `enrolledAt` / `academicYearId`.
 *    Sans eux, le contrat recevrait des lignes AMPUTÉES des champs que son type
 *    déclare — le motif `DNC-06` exact mesuré sur `children/page.tsx:38`, où
 *    `academicYear.status` était typé non-optionnel et n'était JAMAIS envoyé, si
 *    bien que le prédicat client valait `false` pour TOUS les enfants.
 *
 * Fonction plutôt que constante : `tenantId` est requis PAR LE TYPE du prédicat
 * (ADR-070 §D3). La forme rendue est fixe, donc le type de charge utile se
 * dérive d'une instance canonique (`MEETING_REQUEST_INCLUDE_SHAPE`).
 */
function meetingRequestInclude(tenantId: string) {
  return {
    alert: { select: { title: true, severity: true } },
    student: {
      select: {
        firstName: true,
        lastName: true,
        enrollments: {
          where: candidateEnrollmentWhere({ tenantId }),
          orderBy: enrollmentTotalOrder(),
          select: {
            id: true,
            status: true,
            enrolledAt: true,
            endedAt: true,
            academicYearId: true,
            classSection: { select: { name: true } },
          },
        },
        _count: { select: { enrollments: true } },
      },
    },
    subject: { select: { code: true, name: true } },
    requester: { select: { firstName: true, lastName: true } },
    assignedTo: { select: { firstName: true, lastName: true } },
  } satisfies Prisma.MeetingRequestInclude;
}

/** Instance canonique — sert UNIQUEMENT à dériver le type de charge utile. */
const MEETING_REQUEST_INCLUDE_SHAPE = meetingRequestInclude('00000000-0000-0000-0000-000000000000');

type MeetingRequestFull = Prisma.MeetingRequestGetPayload<{
  include: typeof MEETING_REQUEST_INCLUDE_SHAPE;
}>;

/**
 * L'année canonique résolue UNE FOIS par appel, HISSÉE hors de tout `map` :
 * `toDto` est appelé une fois par ligne et une résolution par ligne serait un
 * N+1 sur la file d'action (GUARDRAILS §2).
 */
type CanonicalYear = { id: string; name: string } | null;

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
    const { rows, total, canonicalYear } = await this.scope.run(args.tenantId, async (tx) => {
      const found = await tx.meetingRequest.findMany({
        where,
        // INLINE ET NON PAS `meetingRequestInclude(args.tenantId)` : le marcheur de
        // `scripts/tenant-adversarial-check.js` (`resolveObject`) ne résout QUE deux
        // formes — un littéral `{ … }` écrit sur place, ou un `const NAME = { … }`
        // hissé (PF-250, 20 sites). Un APPEL DE FONCTION ne tient aucun littéral
        // qu'il puisse lire : il est refusé par DNC-08, et la clôture de la sonde
        // de démarrage (PF-246) perd alors les relations que cet `include` traverse.
        // La factorisation était donc muette pour la porte : elle a fait passer le
        // `tenant adversarial` de vert à rouge sans changer une seule requête.
        // Ce qui est dupliqué ici est une PROJECTION, pas une décision — la seule
        // décision, le prédicat tenant et l'ordre total, reste dans le module de
        // contrat (ADR-072), appelée ci-dessous. `candidateEnrollmentWhere({ … })`
        // CONTIENT un littéral, donc le marcheur la résout ; `enrollmentTotalOrder()`
        // est déjà employée telle quelle et acceptée à quatre sites de ce même diff
        // (analytics.service.ts:809/:958, students.controller.ts:239/:370).
        include: {
          alert: { select: { title: true, severity: true } },
          student: {
            select: {
              firstName: true,
              lastName: true,
              enrollments: {
                where: candidateEnrollmentWhere({ tenantId: args.tenantId }),
                // PAS d'`orderBy` ici, et ce n'est pas un oubli : `enrollmentTotalOrder()`
                // est un APPEL, donc DNC-08 pour le marcheur, exactement comme l'`include`
                // au-dessus. Il serait de toute façon REDONDANT — le contrat retrie en
                // mémoire avec `compareEnrollmentsByTotalOrder`
                // (select-active-enrollment.ts:403/:475/:488), et son docblock dit pourquoi :
                // « deux ordres écrits séparément DIVERGENT, c'est le défaut que cette
                // tranche ferme ». Aucun `take` ne dépend de cet ordre, donc rien ne se
                // tronque. L'ordre total reste énoncé UNE fois, dans le module de contrat.
                select: {
                  id: true,
                  status: true,
                  enrolledAt: true,
                  endedAt: true,
                  academicYearId: true,
                  classSection: { select: { name: true } },
                },
              },
              _count: { select: { enrollments: true } },
            },
          },
          subject: { select: { code: true, name: true } },
          requester: { select: { firstName: true, lastName: true } },
          assignedTo: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: args.offset,
        take: args.limit,
      });
      const count = await tx.meetingRequest.count({ where });
      // HISSÉE : une résolution par page, jamais par ligne (ADR-072).
      const year = await this.canonicalYear(tx, args.tenantId, args.schoolId);
      return { rows: found, total: count, canonicalYear: year };
    });
    return { data: rows.map((r) => this.toDto(r, canonicalYear, args.tenantId)), total };
  }

  /**
   * S-E03-3 / ADR-072 — l'année canonique, résolue THROUGH
   * `resolveActiveAcademicYear` (ADR-070) et jamais AUTOUR : écrire
   * `academicYear: { status: 'active' }` dans un `where` d'inscription
   * collisionne avec le cliquet d'ADR-070 et est une condition d'ARRÊT.
   *
   * `schoolId` peut être `null` (portée tenant) : le résolveur l'accepte et
   * applique alors le MÊME ordre total à travers les écoles — déterministe, et
   * PF-328 est hérité tel quel.
   */
  private async canonicalYear(
    tx: Pick<PrismaClient, 'academicYear'>,
    tenantId: string,
    schoolId: string | null,
  ): Promise<CanonicalYear> {
    const year = await resolveActiveAcademicYear(prismaAcademicYearReader(tx), {
      tenantId,
      ...(schoolId === null ? {} : { schoolId }),
      referenceDate: new Date(),
      onAbsent: 'nullWhenNoActiveYear',
    });
    return year === null ? null : { id: year.id, name: year.name };
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

    // Résolue AVANT, dans sa propre portée : la portée ci-dessous porte la garde
    // de rôle et l'écriture, et rien d'autre ne doit s'y glisser (ADR-058 §D1).
    const canonicalYear = await this.scope.run(args.tenantId, (tx) =>
      this.canonicalYear(tx, args.tenantId, args.schoolId),
    );

    const outcome = await this.scope.run(args.tenantId, async (tx) => {
      const row = await tx.meetingRequest.findFirst({
        where,
        // INLINE ET NON PAS `meetingRequestInclude(args.tenantId)` : le marcheur de
        // `scripts/tenant-adversarial-check.js` (`resolveObject`) ne résout QUE deux
        // formes — un littéral `{ … }` écrit sur place, ou un `const NAME = { … }`
        // hissé (PF-250, 20 sites). Un APPEL DE FONCTION ne tient aucun littéral
        // qu'il puisse lire : il est refusé par DNC-08, et la clôture de la sonde
        // de démarrage (PF-246) perd alors les relations que cet `include` traverse.
        // La factorisation était donc muette pour la porte : elle a fait passer le
        // `tenant adversarial` de vert à rouge sans changer une seule requête.
        // Ce qui est dupliqué ici est une PROJECTION, pas une décision — la seule
        // décision, le prédicat tenant et l'ordre total, reste dans le module de
        // contrat (ADR-072), appelée ci-dessous. `candidateEnrollmentWhere({ … })`
        // CONTIENT un littéral, donc le marcheur la résout ; `enrollmentTotalOrder()`
        // est déjà employée telle quelle et acceptée à quatre sites de ce même diff
        // (analytics.service.ts:809/:958, students.controller.ts:239/:370).
        include: {
          alert: { select: { title: true, severity: true } },
          student: {
            select: {
              firstName: true,
              lastName: true,
              enrollments: {
                where: candidateEnrollmentWhere({ tenantId: args.tenantId }),
                // PAS d'`orderBy` ici, et ce n'est pas un oubli : `enrollmentTotalOrder()`
                // est un APPEL, donc DNC-08 pour le marcheur, exactement comme l'`include`
                // au-dessus. Il serait de toute façon REDONDANT — le contrat retrie en
                // mémoire avec `compareEnrollmentsByTotalOrder`
                // (select-active-enrollment.ts:403/:475/:488), et son docblock dit pourquoi :
                // « deux ordres écrits séparément DIVERGENT, c'est le défaut que cette
                // tranche ferme ». Aucun `take` ne dépend de cet ordre, donc rien ne se
                // tronque. L'ordre total reste énoncé UNE fois, dans le module de contrat.
                select: {
                  id: true,
                  status: true,
                  enrolledAt: true,
                  endedAt: true,
                  academicYearId: true,
                  classSection: { select: { name: true } },
                },
              },
              _count: { select: { enrollments: true } },
            },
          },
          subject: { select: { code: true, name: true } },
          requester: { select: { firstName: true, lastName: true } },
          assignedTo: { select: { firstName: true, lastName: true } },
        },
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
        // INLINE ET NON PAS `meetingRequestInclude(args.tenantId)` : le marcheur de
        // `scripts/tenant-adversarial-check.js` (`resolveObject`) ne résout QUE deux
        // formes — un littéral `{ … }` écrit sur place, ou un `const NAME = { … }`
        // hissé (PF-250, 20 sites). Un APPEL DE FONCTION ne tient aucun littéral
        // qu'il puisse lire : il est refusé par DNC-08, et la clôture de la sonde
        // de démarrage (PF-246) perd alors les relations que cet `include` traverse.
        // La factorisation était donc muette pour la porte : elle a fait passer le
        // `tenant adversarial` de vert à rouge sans changer une seule requête.
        // Ce qui est dupliqué ici est une PROJECTION, pas une décision — la seule
        // décision, le prédicat tenant et l'ordre total, reste dans le module de
        // contrat (ADR-072), appelée ci-dessous. `candidateEnrollmentWhere({ … })`
        // CONTIENT un littéral, donc le marcheur la résout ; `enrollmentTotalOrder()`
        // est déjà employée telle quelle et acceptée à quatre sites de ce même diff
        // (analytics.service.ts:809/:958, students.controller.ts:239/:370).
        include: {
          alert: { select: { title: true, severity: true } },
          student: {
            select: {
              firstName: true,
              lastName: true,
              enrollments: {
                where: candidateEnrollmentWhere({ tenantId: args.tenantId }),
                // PAS d'`orderBy` ici, et ce n'est pas un oubli : `enrollmentTotalOrder()`
                // est un APPEL, donc DNC-08 pour le marcheur, exactement comme l'`include`
                // au-dessus. Il serait de toute façon REDONDANT — le contrat retrie en
                // mémoire avec `compareEnrollmentsByTotalOrder`
                // (select-active-enrollment.ts:403/:475/:488), et son docblock dit pourquoi :
                // « deux ordres écrits séparément DIVERGENT, c'est le défaut que cette
                // tranche ferme ». Aucun `take` ne dépend de cet ordre, donc rien ne se
                // tronque. L'ordre total reste énoncé UNE fois, dans le module de contrat.
                select: {
                  id: true,
                  status: true,
                  enrolledAt: true,
                  endedAt: true,
                  academicYearId: true,
                  classSection: { select: { name: true } },
                },
              },
              _count: { select: { enrollments: true } },
            },
          },
          subject: { select: { code: true, name: true } },
          requester: { select: { firstName: true, lastName: true } },
          assignedTo: { select: { firstName: true, lastName: true } },
        },
      });
      return { transitioned: true as const, row: updated };
    });
    if (!outcome) throw new NotFoundException('Meeting request not found');
    if (!outcome.transitioned) return this.toDto(outcome.row, canonicalYear, args.tenantId);
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

    return this.toDto(updated, canonicalYear, args.tenantId);
  }

  private toDto(
    row: MeetingRequestFull,
    canonicalYear: CanonicalYear,
    tenantId: string,
  ): MeetingRequestDto {
    const requesterName =
      `${row.requester.firstName} ${row.requester.lastName}`.trim() || null;
    const assigneeName = row.assignedTo
      ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}`.trim() || null
      : null;

    // S-E03-3 / ADR-072 — le verdict vient du contrat. `row.student.enrollments[0]`
    // a disparu : un index `[0]` sur un tableau d'inscriptions AFFIRMAIT une
    // activité que rien dans la requête ne garantissait.
    const activity = selectActiveEnrollment(row.student.enrollments, {
      tenantId,
      academicYearId: canonicalYear?.id ?? null,
      academicYearName: canonicalYear?.name ?? null,
      totalEnrollmentCount: row.student._count.enrollments,
      referenceDate: new Date(),
    });
    // ⚠ AUCUN REPLI, ET C'EST LE CŒUR DE LA CORRECTION.
    // `activity.enrollment ?? activity.lastKnown` a été écrit ici puis retiré au
    // land : c'est LITTÉRALEMENT la forme `?? enrollments[0]` que le docblock du
    // contrat qualifie de « pas une précaution : c'ÉTAIT le défaut » (axe 2 de
    // PF-12). Elle aurait rendu « 3ème B » — une classe vieille de deux ans — en
    // pastille nue sur la ligne teacher/admin d'un enfant diplômé, donc PF-12
    // rouvert à l'intérieur de son propre correctif, sur une surface que la
    // tranche venait de convertir. Le portail web tranche déjà exactement pareil
    // sur ce même verdict (`apps/web/src/lib/enrollment-activity.ts` :
    // `classLabel: null` VOLONTAIRE sur `out_of_scope`).
    // La classe n'est donc rendue QUE lorsqu'elle est une inscription EN COURS ;
    // `enrollmentScopeLabel` porte ce qui est affirmé quand elle ne l'est pas, et
    // `MeetingRequestList.tsx` le rend à côté du nom de l'enfant.
    const shownEnrollment = activity.enrollment;

    return {
      enrollmentActivityState: activity.state,
      enrollmentScopeLabel: activity.scopeLabel,
      id: row.id,
      status: row.status,
      alertId: row.alertId,
      alertCode: row.alertCode,
      alertSeverity: row.alert.severity,
      alertTitle: row.alert.title,
      studentId: row.studentId,
      studentName: `${row.student.firstName} ${row.student.lastName}`.trim(),
      classSectionName: shownEnrollment?.classSection.name ?? null,
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
