import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { ExportStatus } from '@prisma/client';
import type { Job } from 'bullmq';

import { PrismaService } from '../../shared/prisma/prisma.service';
import { S3Service } from '../../shared/storage/s3.service';
import { QUEUE_EXPORTS } from '../../shared/queue/queue.module';

import { generateAttendanceXlsx } from './generators/attendance-xlsx.generator';
import { generateAuditCsv } from './generators/audit-csv.generator';
import { generateEnrollmentXlsx } from './generators/enrollment-xlsx.generator';
import { generateGradesXlsx } from './generators/grades-xlsx.generator';
import { generateReportCardPdf } from './generators/report-card-pdf.generator';
import type { Generator } from './generators/types';

/** Mirrors `apps/api/src/modules/exports/exports.types.ts ExportJobPayload`. */
interface ExportJobPayload {
  exportJobId: string;
  tenantId: string;
  schoolId: string | null;
  kind:
    | 'grades_xlsx'
    | 'attendance_xlsx'
    | 'enrollment_xlsx'
    | 'report_card_pdf'
    | 'audit_csv';
  parameters: Record<string, unknown>;
  requestedBy: string;
}

const GENERATORS: Record<ExportJobPayload['kind'], Generator> = {
  grades_xlsx: generateGradesXlsx,
  attendance_xlsx: generateAttendanceXlsx,
  enrollment_xlsx: generateEnrollmentXlsx,
  report_card_pdf: generateReportCardPdf,
  audit_csv: generateAuditCsv,
};

@Processor(QUEUE_EXPORTS)
export class ExportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {
    super();
  }

  async process(job: Job<ExportJobPayload>): Promise<{ key: string; bytes: number }> {
    const payload = job.data;
    this.logger.log(`[${payload.kind}] ${payload.exportJobId} — start`);

    // 1. Mark running
    const jobRow = await this.prisma.exportJob.update({
      where: { id: payload.exportJobId },
      data: {
        status: 'running' as ExportStatus,
        startedAt: new Date(),
      },
    });

    try {
      // 2. Pick the right generator
      const fn = GENERATORS[payload.kind];
      if (!fn) throw new Error(`Unknown export kind: ${payload.kind}`);

      // 3. Generate buffer
      const result = await fn({
        prisma: this.prisma,
        tenantId: payload.tenantId,
        schoolId: payload.schoolId,
        parameters: payload.parameters ?? {},
      });

      // 4. Upload to S3
      const key = `exports/${payload.tenantId}/${payload.exportJobId}/${jobRow.fileName}`;
      const s3Uri = await this.s3.upload({
        key,
        body: result.buffer,
        contentType: result.contentType,
      });

      // 5. Mark succeeded
      await this.prisma.exportJob.update({
        where: { id: payload.exportJobId },
        data: {
          status: 'succeeded' as ExportStatus,
          fileUrl: s3Uri,
          fileSizeBytes: result.buffer.byteLength,
          finishedAt: new Date(),
          errorMessage: null,
        },
      });

      this.logger.log(
        `[${payload.kind}] ${payload.exportJobId} — succeeded (${result.buffer.byteLength} bytes)`,
      );
      return { key, bytes: result.buffer.byteLength };
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown error';
      this.logger.error(`[${payload.kind}] ${payload.exportJobId} — failed: ${msg}`);
      // 6. Mark failed (worker will retry per BullMQ attempts config)
      await this.prisma.exportJob.update({
        where: { id: payload.exportJobId },
        data: {
          status: 'failed' as ExportStatus,
          errorMessage: msg.slice(0, 500),
          finishedAt: new Date(),
        },
      });
      throw err; // re-throw so BullMQ records the failure
    }
  }
}
