import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type RebuildSnapshotsRequest,
  type RebuildSnapshotsResponse,
  type SnapshotRecomputeStatusResponse,
  snapshotCoalesceKey,
} from '@pilotage/contracts';

import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * E6-S5 — the optional admin operability surface (API-side). Two endpoints reusing
 * the existing `schools.read` capability (NO new permission), both strictly
 * tenant-scoped (every query carries explicit `where: { tenantId }`, ADR-019 §Tenant
 * isolation — app-layer scoping, never a fabricated RLS DDL):
 *
 *   - `getRecomputeStatus` — pure read-only backlog health (counts + oldestPendingAt
 *     + a recent feed). Writes NO audit (observability, like a recompute itself).
 *   - `enqueueRebuild` — validates every supplied scope id IN-TENANT (404 on a foreign
 *     id so a rebuild can never carry another tenant's id), idempotently coalesces a
 *     `manual_rebuild` trigger via the shared `snapshotCoalesceKey`, returns 202-shaped
 *     `{triggerId, status, coalesced}`, and writes exactly ONE append-only
 *     `analytics.snapshot_rebuild` audit row (the explicit-action concern lives
 *     API-side — the worker drain stays unaudited, ADR-019 §Non-goals + FR-7).
 *
 * The worker `SnapshotDrainCronService` drains the enqueued `manual_rebuild` trigger
 * (class-scoped recompute / coefficient-style fan-out / whole-tenant fan-out). No
 * schema change, no new queue, no new event.
 */
@Injectable()
export class SnapshotOpsService {
  private readonly logger = new Logger(SnapshotOpsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Tenant-scoped backlog health for the admin ops view. Read-only — no audit. */
  async getRecomputeStatus(args: {
    tenantId: string;
  }): Promise<SnapshotRecomputeStatusResponse> {
    const { tenantId } = args;
    const [pending, processing, failed, oldestPending, recent] = await Promise.all([
      this.prisma.snapshotRecomputeTrigger.count({ where: { tenantId, status: 'pending' } }),
      this.prisma.snapshotRecomputeTrigger.count({ where: { tenantId, status: 'processing' } }),
      this.prisma.snapshotRecomputeTrigger.count({ where: { tenantId, status: 'failed' } }),
      this.prisma.snapshotRecomputeTrigger.findFirst({
        where: { tenantId, status: 'pending' },
        orderBy: { enqueuedAt: 'asc' },
        select: { enqueuedAt: true },
      }),
      this.prisma.snapshotRecomputeTrigger.findMany({
        where: { tenantId },
        orderBy: { enqueuedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          reason: true,
          status: true,
          classSectionId: true,
          subjectId: true,
          academicYearId: true,
          attempts: true,
          enqueuedAt: true,
          processedAt: true,
        },
      }),
    ]);

    return {
      pending,
      processing,
      failed,
      oldestPendingAt: oldestPending?.enqueuedAt.toISOString() ?? null,
      recent: recent.map((r) => ({
        id: r.id,
        reason: r.reason,
        status: r.status,
        classSectionId: r.classSectionId,
        subjectId: r.subjectId,
        academicYearId: r.academicYearId,
        attempts: r.attempts,
        enqueuedAt: r.enqueuedAt.toISOString(),
        processedAt: r.processedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Validate every supplied scope id in-tenant, idempotently coalesce a
   * `manual_rebuild` trigger, write one append-only audit row, return 202 shape.
   * A fully-unscoped request rebuilds the whole tenant (worker fan-out).
   */
  async enqueueRebuild(args: {
    tenantId: string;
    actorId: string;
    actorRole: string | null;
    body: RebuildSnapshotsRequest;
  }): Promise<RebuildSnapshotsResponse> {
    const { tenantId, actorId, actorRole, body } = args;

    // --- Validate every supplied scope id IN-TENANT (404 on a foreign/unknown id). ---
    await this.assertInTenant(
      tenantId,
      body.classSectionId,
      (id) => this.prisma.classSection.findFirst({ where: { id, tenantId }, select: { id: true } }),
      'classSectionId',
    );
    await this.assertInTenant(
      tenantId,
      body.subjectId,
      (id) => this.prisma.subject.findFirst({ where: { id, tenantId }, select: { id: true } }),
      'subjectId',
    );
    await this.assertInTenant(
      tenantId,
      body.studentId,
      (id) => this.prisma.student.findFirst({ where: { id, tenantId }, select: { id: true } }),
      'studentId',
    );
    await this.assertInTenant(
      tenantId,
      body.termId,
      (id) => this.prisma.term.findFirst({ where: { id, tenantId }, select: { id: true } }),
      'termId',
    );
    await this.assertInTenant(
      tenantId,
      body.academicYearId,
      (id) => this.prisma.academicYear.findFirst({ where: { id, tenantId }, select: { id: true } }),
      'academicYearId',
    );

    // A class-less rebuild that carries a subject MUST also carry the year (the
    // worker resolves classes from subject × year). Reject the ambiguous shape.
    if (!body.classSectionId && body.subjectId && !body.academicYearId) {
      throw new BadRequestException('academicYearId is required for a class-less subject rebuild');
    }

    const scope = {
      studentId: body.studentId ?? null,
      classSectionId: body.classSectionId ?? null,
      subjectId: body.subjectId ?? null,
      termId: body.termId ?? null,
      academicYearId: body.academicYearId ?? null,
    };
    const coalesceKey = snapshotCoalesceKey(tenantId, 'manual_rebuild', scope);

    // Idempotent coalesce: an existing pending `manual_rebuild` for the same scope is
    // reused (coalesced:true, no extra work); otherwise a fresh pending row is created.
    const existing = await this.prisma.snapshotRecomputeTrigger.findUnique({
      where: { tenantId_coalesceKey_status: { tenantId, coalesceKey, status: 'pending' } },
      select: { id: true, status: true },
    });

    let triggerId: string;
    let status: 'pending' | 'processing' | 'done' | 'failed';
    let coalesced: boolean;
    if (existing) {
      // Refresh enqueuedAt so the FIFO drain re-orders, but stay ONE coalesced row.
      await this.prisma.snapshotRecomputeTrigger.update({
        where: { id: existing.id },
        data: { enqueuedAt: new Date() },
      });
      triggerId = existing.id;
      status = existing.status;
      coalesced = true;
    } else {
      const created = await this.prisma.snapshotRecomputeTrigger.create({
        data: {
          tenantId,
          reason: 'manual_rebuild',
          status: 'pending',
          classSectionId: scope.classSectionId,
          subjectId: scope.subjectId,
          studentId: scope.studentId,
          termId: scope.termId,
          academicYearId: scope.academicYearId,
          coalesceKey,
        },
        select: { id: true, status: true },
      });
      triggerId = created.id;
      status = created.status;
      coalesced = false;
    }

    // Exactly ONE append-only audit row per rebuild request (even when coalesced —
    // the admin's INTENT is recorded). Best-effort: a write failure is logged, never
    // fails the enqueue (mirrors the grade.flag / export.bulletin.request precedent).
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          actorId,
          actorRole,
          portal: 'admin',
          action: 'analytics.snapshot_rebuild',
          resourceType: 'snapshot_recompute_trigger',
          resourceId: triggerId,
          after: {
            scope,
            coalesced,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write analytics.snapshot_rebuild audit for trigger ${triggerId} (enqueue unaffected): ${(err as Error).message}`,
      );
    }

    return { triggerId, status, coalesced };
  }

  /** 404 if a supplied id does not resolve in the caller's tenant. No-op when null/undefined. */
  private async assertInTenant(
    _tenantId: string,
    id: string | null | undefined,
    lookup: (id: string) => Promise<{ id: string } | null>,
    label: string,
  ): Promise<void> {
    if (id == null) return;
    const found = await lookup(id);
    if (!found) throw new NotFoundException(`${label} not found in tenant`);
  }
}
