import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

import { MeetingRequestDto, MeetingRequestStatus } from './alerts.types';

/**
 * The caller's effective scope, derived from their realm roles. Admins see every
 * request in their tenant/school; teachers see only requests assigned to them OR
 * unassigned within their school (they must NOT see another teacher's queue —
 * `StudentAccessService.scopeForUser` still returns `studentIds:null` for
 * teachers, so we cannot lean on student-scope here; we filter on
 * `assignedToId = me` ∪ `assignedToId IS NULL`, pre-morterm PM-2).
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
 */
@Injectable()
export class MeetingRequestsService {
  private readonly logger = new Logger(MeetingRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    const [rows, total] = await Promise.all([
      this.prisma.meetingRequest.findMany({
        where,
        include: MEETING_REQUEST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: args.offset,
        take: args.limit,
      }),
      this.prisma.meetingRequest.count({ where }),
    ]);
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

    const row = await this.prisma.meetingRequest.findFirst({
      where: { ...scopeWhere, id: args.id },
      include: MEETING_REQUEST_INCLUDE,
    });
    if (!row) throw new NotFoundException('Meeting request not found');

    // Idempotent: only open → resolved transitions. A second resolve (or
    // resolving a cancelled request) is a no-op — no re-stamp, no duplicate audit.
    if (row.status !== 'open') return this.toDto(row);

    const updated = await this.prisma.meetingRequest.update({
      where: { id: args.id },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: args.userProfileId,
      },
      include: MEETING_REQUEST_INCLUDE,
    });

    try {
      await this.prisma.auditLog.create({
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
      });
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
