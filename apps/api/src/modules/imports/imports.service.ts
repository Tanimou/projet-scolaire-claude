import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ImportMode, ImportRowStatus, ImportStatus, ImportType, Prisma } from '@prisma/client';
import { parse, type ParseResult } from 'papaparse';

import { PrismaService } from '../../shared/prisma/prisma.service';
import { SchoolContextService } from '../school-structure/school-context.service';

import { type ImportCaches, type ImportContext, type ImportHandler } from './handler.types';
import { getHandler, listHandlers } from './handlers';

const MAX_RAW_CSV_BYTES = 5_000_000; // 5 MB
const MAX_ROWS = 5_000;
const ROLLBACK_WINDOW_HOURS = 24;

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: SchoolContextService,
  ) {}

  listTypes() {
    return listHandlers().map((h) => ({
      type: h.type,
      label: h.label,
      description: h.description,
      icon: h.icon,
      headers: h.template.headers,
      notes: h.template.notes ?? [],
    }));
  }

  template(type: ImportType): string {
    const handler = this.requireHandler(type);
    const escape = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = [handler.template.headers, ...handler.template.sample];
    return '﻿' + rows.map((r) => r.map((c) => escape(c)).join(',')).join('\n');
  }

  /**
   * Upload + parse + validate in one shot (Phase 2B is sync — Phase 2C moves to BullMQ).
   */
  async uploadAndValidate(
    type: ImportType,
    actor: { id: string; tenantId: string },
    fileName: string,
    rawCsv: string,
  ) {
    if (!rawCsv?.length) throw new BadRequestException('Fichier vide.');
    if (rawCsv.length > MAX_RAW_CSV_BYTES) {
      throw new BadRequestException(
        `Fichier trop volumineux (> ${Math.round(MAX_RAW_CSV_BYTES / 1_000_000)} MB).`,
      );
    }

    const handler = this.requireHandler(type);
    const { schoolId } = await this.ctx.forTenant(actor.tenantId);

    const parsed = this.parseCsv(rawCsv);
    if (parsed.errors.length > 0) {
      const fatal = parsed.errors.find((e) => e.type === 'Delimiter' || e.type === 'Quotes');
      if (fatal) {
        throw new BadRequestException(`CSV malformé ligne ${fatal.row ?? '?'} : ${fatal.message}`);
      }
    }
    const rawRows = parsed.data.filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== ''));
    if (rawRows.length === 0) throw new BadRequestException('Aucune ligne de données détectée.');
    if (rawRows.length > MAX_ROWS) {
      throw new BadRequestException(`Trop de lignes (${rawRows.length}). Maximum ${MAX_ROWS} par import.`);
    }

    const headersUsed = parsed.meta.fields ?? [];
    const expected = handler.template.headers.map((h) => h.toLowerCase());
    const lowered = headersUsed.map((h) => h.toLowerCase());
    const missing = expected.filter(
      (h) => !lowered.includes(h) && !lowered.some((l) => l === normaliseKey(h)),
    );
    // Only warn (not block) — some headers are optional. Hard fail comes via per-row validation.

    const caches = await this.buildCaches(schoolId);

    // Create the batch row first so we can attach validation results
    const batch = await this.prisma.importBatch.create({
      data: {
        tenantId: actor.tenantId,
        schoolId,
        type,
        fileName,
        rawCsv,
        status: ImportStatus.validating,
        triggeredBy: actor.id,
        summary: { totalRows: rawRows.length, missingHeaders: missing },
      },
    });

    const ctx: ImportContext = { tenantId: actor.tenantId, schoolId, caches };
    let validCount = 0;
    let invalidCount = 0;

    const rowsToCreate: Prisma.ImportRowCreateManyInput[] = [];
    for (let i = 0; i < rawRows.length; i++) {
      const raw = lowerKeys(rawRows[i]!);
      try {
        const parsed = handler.parseRow(raw);
        const result = handler.validateRow(parsed, ctx);
        if (result.ok) {
          validCount++;
          rowsToCreate.push({
            batchId: batch.id,
            rowIndex: i + 1,
            status: ImportRowStatus.valid,
            payload: result.normalized as Prisma.InputJsonValue,
          });
        } else {
          invalidCount++;
          rowsToCreate.push({
            batchId: batch.id,
            rowIndex: i + 1,
            status: ImportRowStatus.invalid,
            payload: parsed as Prisma.InputJsonValue,
            errors: result.errors as unknown as Prisma.InputJsonValue,
          });
        }
      } catch (err) {
        invalidCount++;
        rowsToCreate.push({
          batchId: batch.id,
          rowIndex: i + 1,
          status: ImportRowStatus.invalid,
          payload: raw as Prisma.InputJsonValue,
          errors: [
            { message: `Erreur de parsing: ${(err as Error).message}` },
          ] as unknown as Prisma.InputJsonValue,
        });
      }
    }
    await this.prisma.importRow.createMany({ data: rowsToCreate });

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: ImportStatus.validated,
        validatedAt: new Date(),
        summary: {
          totalRows: rawRows.length,
          validCount,
          invalidCount,
          missingHeaders: missing,
        },
      },
    });

    return this.getBatch(batch.id, actor.tenantId);
  }

  async getBatch(batchId: string, tenantId: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: {
        rows: { orderBy: { rowIndex: 'asc' } },
      },
    });
    if (!batch) throw new NotFoundException('Import introuvable.');
    if (batch.tenantId !== tenantId) throw new ForbiddenException();
    return batch;
  }

  async listBatches(tenantId: string) {
    return this.prisma.importBatch.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        type: true,
        fileName: true,
        status: true,
        mode: true,
        summary: true,
        startedAt: true,
        appliedAt: true,
        rolledBackAt: true,
      },
    });
  }

  /**
   * Apply the previously-validated batch. Runs inside a single transaction so
   * partial failures don't leave the DB inconsistent.
   */
  async apply(batchId: string, mode: ImportMode, actor: { id: string; tenantId: string }) {
    const batch = await this.getBatch(batchId, actor.tenantId);
    if (batch.status !== ImportStatus.validated) {
      throw new BadRequestException(
        `Ce batch est en statut « ${batch.status} » — il doit être validé pour être appliqué.`,
      );
    }
    const invalid = batch.rows.filter((r) => r.status === ImportRowStatus.invalid).length;
    if (mode === ImportMode.all_or_nothing && invalid > 0) {
      throw new BadRequestException(
        `Mode all-or-nothing impossible : ${invalid} ligne(s) invalide(s). Corrigez ou passez en skip-invalid.`,
      );
    }

    const handler = this.requireHandler(batch.type);
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: ImportStatus.applying, mode },
    });

    const caches = await this.buildCaches(batch.schoolId);
    let applied = 0;
    let skipped = 0;

    try {
      await this.prisma.$transaction(
        async (tx) => {
          const apCtx = {
            tenantId: actor.tenantId,
            schoolId: batch.schoolId,
            caches,
            tx,
          };
          for (const row of batch.rows) {
            if (row.status === ImportRowStatus.invalid) {
              await tx.importRow.update({ where: { id: row.id }, data: { status: ImportRowStatus.skipped } });
              skipped++;
              continue;
            }
            if (row.status !== ImportRowStatus.valid) continue;
            try {
              const result = await handler.applyRow(row.payload as Record<string, unknown>, apCtx);
              await tx.importRow.update({
                where: { id: row.id },
                data: {
                  status: ImportRowStatus.applied,
                  createdEntityId: result.id,
                  createdEntityType: result.type,
                },
              });
              applied++;
            } catch (err) {
              throw new Error(`Ligne ${row.rowIndex} : ${(err as Error).message}`);
            }
          }
          await tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              actorId: actor.id,
              actorRole: 'school_admin',
              portal: 'admin',
              action: 'import.apply',
              resourceType: 'import_batch',
              resourceId: batch.id,
              after: { type: batch.type, applied, skipped, mode },
            },
          });
        },
        { timeout: 60_000 },
      );

      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: ImportStatus.applied,
          appliedAt: new Date(),
          summary: {
            ...(batch.summary as Record<string, unknown>),
            applied,
            skipped,
            mode,
          },
        },
      });
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Import ${batch.id} failed: ${message}`);
      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: { status: ImportStatus.failed, errorMessage: message },
      });
      throw new BadRequestException(`Échec de l'import : ${message}`);
    }

    return this.getBatch(batch.id, actor.tenantId);
  }

  /**
   * Rolls back an applied batch within the 24h window. Calls handler.rollbackRow for each
   * applied row, in reverse insertion order. Idempotent.
   */
  async rollback(batchId: string, actor: { id: string; tenantId: string }) {
    const batch = await this.getBatch(batchId, actor.tenantId);
    if (batch.status !== ImportStatus.applied) {
      throw new BadRequestException(`Seuls les imports appliqués peuvent être annulés.`);
    }
    if (batch.appliedAt && Date.now() - batch.appliedAt.getTime() > ROLLBACK_WINDOW_HOURS * 3_600_000) {
      throw new BadRequestException(
        `Annulation impossible : l'import a plus de ${ROLLBACK_WINDOW_HOURS}h.`,
      );
    }

    const handler = this.requireHandler(batch.type);
    const appliedRows = batch.rows
      .filter((r) => r.status === ImportRowStatus.applied && r.createdEntityId)
      .sort((a, b) => b.rowIndex - a.rowIndex);

    let undone = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const row of appliedRows) {
          await handler.rollbackRow(row.createdEntityId!, { tx, tenantId: actor.tenantId });
          await tx.importRow.update({
            where: { id: row.id },
            data: { status: ImportRowStatus.rolled_back },
          });
          undone++;
        }
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            actorId: actor.id,
            actorRole: 'school_admin',
            portal: 'admin',
            action: 'import.rollback',
            resourceType: 'import_batch',
            resourceId: batch.id,
            after: { type: batch.type, undone },
          },
        });
      }, { timeout: 60_000 });

      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: { status: ImportStatus.rolled_back, rolledBackAt: new Date() },
      });
    } catch (err) {
      throw new BadRequestException(`Échec du rollback : ${(err as Error).message}`);
    }

    return this.getBatch(batch.id, actor.tenantId);
  }

  /* ----- helpers ----- */

  private requireHandler(type: ImportType): ImportHandler {
    const handler = getHandler(type);
    if (!handler) throw new BadRequestException(`Type d'import « ${type} » non supporté pour le moment.`);
    return handler;
  }

  private parseCsv(raw: string): ParseResult<Record<string, string>> {
    return parse<Record<string, string>>(raw, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim().toLowerCase(),
      delimitersToGuess: [',', ';', '\t', '|'],
    });
  }

  private async buildCaches(schoolId: string): Promise<ImportCaches> {
    const [levels, subjects, classes, students, guardians, ay] = await Promise.all([
      this.prisma.gradeLevel.findMany({ where: { schoolId } }),
      this.prisma.subject.findMany({ where: { schoolId } }),
      this.prisma.classSection.findMany({
        where: { gradeLevel: { schoolId } },
        select: {
          id: true,
          name: true,
          academicYearId: true,
          gradeLevelId: true,
          maxStudents: true,
          _count: { select: { enrollments: { where: { status: 'active' } } } },
        },
      }),
      this.prisma.student.findMany({
        where: { schoolId, externalRef: { not: null } },
        select: { id: true, externalRef: true },
      }),
      this.prisma.guardian.findMany({
        where: { schoolId, email: { not: null } },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
      this.prisma.academicYear.findFirst({ where: { schoolId, status: 'active' } }),
    ]);

    const gradeLevelsByCode = new Map<string, { id: string; name: string }>();
    const gradeLevelsByName = new Map<string, { id: string; name: string; code: string }>();
    for (const l of levels) {
      gradeLevelsByCode.set(l.code.toLowerCase(), { id: l.id, name: l.name });
      gradeLevelsByName.set(l.name.toLowerCase(), { id: l.id, name: l.name, code: l.code });
    }
    const subjectsByCode = new Map<string, { id: string; name: string }>();
    for (const s of subjects) subjectsByCode.set(s.code.toUpperCase(), { id: s.id, name: s.name });

    const classNamesPerYearLevel = new Set<string>();
    const classSectionsByName = new Map<string, { id: string; gradeLevelId: string; academicYearId: string; maxStudents: number; currentSize: number }>();
    for (const c of classes) {
      classNamesPerYearLevel.add(`${c.academicYearId}:${c.gradeLevelId}:${c.name.toLowerCase()}`);
      classSectionsByName.set(`${c.academicYearId}:${c.name.toLowerCase()}`, {
        id: c.id,
        gradeLevelId: c.gradeLevelId,
        academicYearId: c.academicYearId,
        maxStudents: c.maxStudents,
        currentSize: c._count.enrollments,
      });
    }
    const studentExternalRefs = new Map<string, string>();
    for (const s of students) if (s.externalRef) studentExternalRefs.set(s.externalRef, s.id);

    const guardiansByEmail = new Map<string, { id: string; firstName: string; lastName: string }>();
    for (const g of guardians) {
      if (g.email) {
        guardiansByEmail.set(g.email.toLowerCase(), { id: g.id, firstName: g.firstName, lastName: g.lastName });
      }
    }

    return {
      gradeLevelsByCode,
      gradeLevelsByName,
      classNamesPerYearLevel,
      classSectionsByName,
      subjectsByCode,
      studentExternalRefs,
      guardiansByEmail,
      activeAcademicYearId: ay?.id ?? null,
    };
  }
}

function lowerKeys(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) out[k.trim().toLowerCase()] = String(v ?? '');
  return out;
}

function normaliseKey(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, '');
}
