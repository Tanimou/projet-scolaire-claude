import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ExportJob, ExportKind, ExportStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';

import { QUEUE_EXPORTS } from '../../shared/queue/queue.module';
import { S3Service } from '../../shared/storage/s3.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

import {
  CreateExportDto,
  EXPORT_DEFAULT_FILENAME,
  ExportJobDto,
  ExportJobPayload,
  ExportKindCode,
  ExportStatusCode,
  ParentExportJobDto,
} from './exports.types';

type ExportJobWithRequester = ExportJob & {
  requester: { id: string; firstName: string | null; lastName: string | null } | null;
};

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    @InjectQueue(QUEUE_EXPORTS) private readonly queue: Queue<ExportJobPayload>,
  ) {}

  /**
   * Create an ExportJob row + enqueue the actual work to the BullMQ queue.
   * Returns the freshly created DTO (status=pending). The worker will mutate
   * status → running → succeeded|failed asynchronously.
   */
  async enqueue(args: {
    dto: CreateExportDto;
    tenantId: string;
    userProfileId: string;
    schoolIdFallback: string | null;
  }): Promise<ExportJobDto> {
    const fileName = this.buildFileName(args.dto.kind);
    const schoolId = args.dto.schoolId ?? args.schoolIdFallback;

    const job = (await this.prisma.exportJob.create({
      data: {
        tenantId: args.tenantId,
        schoolId,
        requestedBy: args.userProfileId,
        kind: args.dto.kind as ExportKind,
        parameters: (args.dto.parameters ?? {}) as Prisma.InputJsonValue,
        status: 'pending' as ExportStatus,
        fileName,
      },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true } },
      },
    })) as ExportJobWithRequester;

    const payload: ExportJobPayload = {
      exportJobId: job.id,
      tenantId: job.tenantId,
      schoolId,
      kind: args.dto.kind,
      parameters: (job.parameters as Record<string, unknown>) ?? {},
      requestedBy: args.userProfileId,
    };

    try {
      await this.queue.add(args.dto.kind, payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 100, age: 24 * 3600 },
        removeOnFail: { count: 50, age: 7 * 24 * 3600 },
      });
    } catch (err) {
      this.logger.error(`Failed to enqueue export ${job.id}: ${(err as Error).message}`);
      await this.prisma.exportJob.update({
        where: { id: job.id },
        data: {
          status: 'failed' as ExportStatus,
          errorMessage: `Queue error: ${(err as Error).message}`,
          finishedAt: new Date(),
        },
      });
      throw err;
    }

    return this.toDto(job);
  }

  /**
   * Parent self-service bulletin enqueue (E4-S2). Guardianship ABAC is enforced
   * by the controller BEFORE this is called. Here we:
   *   1. resolve the term in-tenant (404),
   *   2. server-derive the child's `classSectionId` from their ACTIVE enrollment
   *      for that term's academic year (404 — never trust a client classSectionId),
   *   3. enqueue the EXISTING `report_card_pdf` generator scoped to
   *      `{ classSectionId, termId, studentId }` (the studentId narrows the PDF to
   *      one child — see the generator's additive filter),
   *   4. write a best-effort append-only `export.bulletin.request` audit row.
   *
   * The job is created with `requestedBy = parentProfileId` so all parent
   * read/download paths can re-scope by ownership.
   */
  async enqueueParentBulletin(args: {
    tenantId: string;
    parentProfileId: string;
    studentId: string;
    termId: string;
    actorRole: string | null;
    portal: string | null;
  }): Promise<ParentExportJobDto> {
    const term = await this.prisma.term.findFirst({
      where: { id: args.termId, tenantId: args.tenantId },
      select: { id: true, academicYearId: true },
    });
    if (!term) throw new NotFoundException('Trimestre introuvable');

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        tenantId: args.tenantId,
        studentId: args.studentId,
        academicYearId: term.academicYearId,
        status: 'active',
      },
      select: { classSectionId: true },
    });
    if (!enrollment) {
      throw new NotFoundException(
        "Aucune inscription active pour cet élève sur l'année de ce trimestre",
      );
    }

    const dto: CreateExportDto = {
      kind: 'report_card_pdf',
      parameters: {
        classSectionId: enrollment.classSectionId,
        termId: term.id,
        studentId: args.studentId,
      },
    };

    const result = await this.enqueue({
      dto,
      tenantId: args.tenantId,
      userProfileId: args.parentProfileId,
      schoolIdFallback: null,
    });

    await this.writeBulletinAudit({
      tenantId: args.tenantId,
      actorId: args.parentProfileId,
      actorRole: args.actorRole,
      portal: args.portal,
      exportJobId: result.id,
      studentId: args.studentId,
      termId: term.id,
    });

    // Project to the narrow parent view (top-level termId/studentId) so the
    // POST response matches `ParentExportJobSchema` like the list/findOne paths.
    return {
      id: result.id,
      kind: 'report_card_pdf',
      status: result.status,
      fileName: result.fileName,
      fileSizeBytes: result.fileSizeBytes,
      termId: term.id,
      studentId: args.studentId,
      createdAt: result.createdAt,
      finishedAt: result.finishedAt,
    };
  }

  /**
   * Append-only audit row for a parent bulletin enqueue. Best-effort and
   * post-create: a write failure is logged and swallowed, never rolling back the
   * enqueue (mirrors `AlertsService.writeAuditEntry`). Tenant-scoped.
   */
  private async writeBulletinAudit(args: {
    tenantId: string;
    actorId: string;
    actorRole: string | null;
    portal: string | null;
    exportJobId: string;
    studentId: string;
    termId: string;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: args.tenantId,
          actorId: args.actorId,
          actorRole: args.actorRole,
          portal: args.portal,
          action: 'export.bulletin.request',
          resourceType: 'export_job',
          resourceId: args.exportJobId,
          after: {
            studentId: args.studentId,
            termId: args.termId,
            kind: 'report_card_pdf',
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write export.bulletin.request audit for job ${args.exportJobId} (enqueue unaffected): ${(err as Error).message}`,
      );
    }
  }

  async findOne(args: {
    id: string;
    tenantId: string;
    requestedBy?: string;
  }): Promise<ExportJobDto> {
    const job = (await this.prisma.exportJob.findFirst({
      where: {
        id: args.id,
        tenantId: args.tenantId,
        // Parent paths pass requestedBy so a caller can only see their OWN job —
        // tenant-scoping alone is NOT parent-scoping (404-on-other-parent, no IDOR).
        ...(args.requestedBy ? { requestedBy: args.requestedBy } : {}),
      },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true } },
      },
    })) as ExportJobWithRequester | null;
    if (!job) throw new NotFoundException('Export job not found');
    return this.toDto(job);
  }

  /**
   * List the caller's OWN export jobs (parent self-service), optionally narrowed
   * to a single kind. Tenant- AND requester-scoped, newest first. The admin path
   * keeps using `listForTenant` (tenant-wide) — this never widens admin reads.
   */
  async listForRequester(args: {
    tenantId: string;
    requestedBy: string;
    kind?: ExportKindCode;
    limit: number;
    offset: number;
  }): Promise<{ data: ExportJobDto[]; total: number }> {
    const where: Prisma.ExportJobWhereInput = {
      tenantId: args.tenantId,
      requestedBy: args.requestedBy,
      ...(args.kind ? { kind: args.kind as ExportKind } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.exportJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          requester: { select: { id: true, firstName: true, lastName: true } },
        },
        skip: args.offset,
        take: args.limit,
      }) as Promise<ExportJobWithRequester[]>,
      this.prisma.exportJob.count({ where }),
    ]);
    const data = await Promise.all(rows.map((row) => this.toDto(row)));
    return { data, total };
  }

  /**
   * Parent self-service list (E4-S2). Same tenant- AND requester-scoping as
   * `listForRequester`, but projects each row through the NARROW `toParentDto`
   * (top-level `termId`/`studentId`) so the response matches the
   * `ParentExportJobSchema` contract the parent documents page consumes.
   */
  async listForParent(args: {
    tenantId: string;
    requestedBy: string;
    limit: number;
    offset: number;
  }): Promise<{ data: ParentExportJobDto[]; total: number }> {
    const where: Prisma.ExportJobWhereInput = {
      tenantId: args.tenantId,
      requestedBy: args.requestedBy,
      kind: 'report_card_pdf' as ExportKind,
    };
    const [rows, total] = await Promise.all([
      this.prisma.exportJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: args.offset,
        take: args.limit,
      }),
      this.prisma.exportJob.count({ where }),
    ]);
    return { data: rows.map((row) => this.toParentDto(row)), total };
  }

  /**
   * Parent-scoped single-job read — tenant- AND requester-scoped (404-on-other-
   * parent, no IDOR), projected through the narrow `toParentDto`.
   */
  async findOneForParent(args: {
    id: string;
    tenantId: string;
    requestedBy: string;
  }): Promise<ParentExportJobDto> {
    const job = await this.prisma.exportJob.findFirst({
      where: {
        id: args.id,
        tenantId: args.tenantId,
        requestedBy: args.requestedBy,
      },
    });
    if (!job) throw new NotFoundException('Export job not found');
    return this.toParentDto(job);
  }

  async listForTenant(args: {
    tenantId: string;
    limit: number;
    offset: number;
  }): Promise<{ data: ExportJobDto[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.exportJob.findMany({
        where: { tenantId: args.tenantId },
        orderBy: { createdAt: 'desc' },
        include: {
          requester: { select: { id: true, firstName: true, lastName: true } },
        },
        skip: args.offset,
        take: args.limit,
      }) as Promise<ExportJobWithRequester[]>,
      this.prisma.exportJob.count({ where: { tenantId: args.tenantId } }),
    ]);
    const data = await Promise.all(rows.map((row) => this.toDto(row)));
    return { data, total };
  }

  /**
   * Generate a fresh pre-signed download URL for a succeeded job.
   * We never persist signed URLs (they're time-limited) — we sign on demand
   * from the storage key stored in `file_url` (s3://bucket/key form).
   */
  async signedDownloadUrl(args: {
    id: string;
    tenantId: string;
    requestedBy?: string;
  }): Promise<string> {
    const job = await this.prisma.exportJob.findFirst({
      where: {
        id: args.id,
        tenantId: args.tenantId,
        // Parent download must re-check ownership (requestedBy = me) so a parent
        // can never sign another parent's job id within the same tenant.
        ...(args.requestedBy ? { requestedBy: args.requestedBy } : {}),
      },
      select: { fileUrl: true, fileName: true, status: true },
    });
    if (!job || job.status !== 'succeeded' || !job.fileUrl) {
      throw new NotFoundException('Export not ready or unavailable');
    }
    const key = this.extractS3Key(job.fileUrl);
    return this.s3.signedGetUrl({ key, filename: job.fileName });
  }

  // -- helpers --------------------------------------------------------------

  private buildFileName(kind: ExportKindCode): string {
    const base = EXPORT_DEFAULT_FILENAME[kind];
    const ext = kind.endsWith('_pdf') ? 'pdf' : kind.endsWith('_csv') ? 'csv' : 'xlsx';
    const stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace('T', '_')
      .replace(/:/g, '');
    return `${base}_${stamp}.${ext}`;
  }

  private extractS3Key(s3Uri: string): string {
    // Stored as `s3://bucket/key/path…` — we only need the key portion
    const m = s3Uri.match(/^s3:\/\/[^/]+\/(.+)$/);
    return m?.[1] ?? s3Uri;
  }

  private async toDto(row: ExportJobWithRequester): Promise<ExportJobDto> {
    const name = row.requester
      ? `${row.requester.firstName ?? ''} ${row.requester.lastName ?? ''}`.trim() || null
      : null;
    return {
      id: row.id,
      kind: row.kind as ExportKindCode,
      status: row.status as ExportJobDto['status'],
      fileName: row.fileName,
      fileUrl: row.fileUrl,
      fileSizeBytes: row.fileSizeBytes,
      errorMessage: row.errorMessage,
      requesterId: row.requestedBy,
      requesterName: name,
      parameters: (row.parameters as Record<string, unknown>) ?? {},
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }

  /**
   * Narrow parent-scoped projection of an export row. HOISTS `termId`/`studentId`
   * out of the job `parameters` JSONB to top-level so the response matches the
   * `@pilotage/contracts` `ParentExportJobSchema` the parent UI consumes (term-row
   * mapping + status polling read them top-level). Omits the raw `errorMessage`,
   * `fileUrl`, and requester identity — a parent never needs those.
   */
  private toParentDto(row: ExportJob): ParentExportJobDto {
    const params = (row.parameters as Record<string, unknown> | null) ?? {};
    const termId = typeof params.termId === 'string' ? params.termId : null;
    const studentId = typeof params.studentId === 'string' ? params.studentId : null;
    return {
      id: row.id,
      kind: 'report_card_pdf',
      status: row.status as ExportStatusCode,
      fileName: row.fileName,
      fileSizeBytes: row.fileSizeBytes,
      termId,
      studentId,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }
}
