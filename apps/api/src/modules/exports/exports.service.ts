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

  async findOne(args: { id: string; tenantId: string }): Promise<ExportJobDto> {
    const job = (await this.prisma.exportJob.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true } },
      },
    })) as ExportJobWithRequester | null;
    if (!job) throw new NotFoundException('Export job not found');
    return this.toDto(job);
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
  async signedDownloadUrl(args: { id: string; tenantId: string }): Promise<string> {
    const job = await this.prisma.exportJob.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
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
}
