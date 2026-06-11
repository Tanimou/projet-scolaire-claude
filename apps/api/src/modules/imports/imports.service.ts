import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ImportMode, ImportRowStatus, ImportStatus, ImportType, Prisma } from '@prisma/client';
import {
  buildImportCaches,
  type ImportCaches,
  type ImportContext,
  type ImportHandler,
  type ImportJobPayload,
} from '@pilotage/imports-core';
import { Queue } from 'bullmq';
import { parse, type ParseResult } from 'papaparse';

import { PrismaService } from '../../shared/prisma/prisma.service';
import { QUEUE_IMPORTS } from '../../shared/queue/queue.module';
import { SchoolContextService } from '../school-structure/school-context.service';

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
    @InjectQueue(QUEUE_IMPORTS) private readonly queue: Queue<ImportJobPayload>,
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
   * Apply the previously-validated batch (E11-S1 — async).
   *
   * The write transaction no longer runs in-request: this method keeps the
   * existing `validated` + all_or_nothing guards UNCHANGED, then flips the batch
   * `validated → queued` via a **from-status-guarded** `updateMany`
   * (`WHERE status='validated'`) and enqueues the `apply` job on the third
   * `imports` BullMQ queue. The worker `ImportsProcessor` drains it, claiming
   * `queued → applying` and running the SAME relocated apply engine
   * (`@pilotage/imports-core`) — one implementation, byte-for-byte (ADR-024).
   *
   * Idempotent: if `count === 0` the batch was already claimed (concurrent call
   * or re-tap) → return the current DTO, never a second enqueue.
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
    // Validate the type has a handler BEFORE claiming (fail fast, same as before).
    this.requireHandler(batch.type);

    // From-status-guarded claim: exactly one caller flips validated → queued.
    const claimed = await this.prisma.importBatch.updateMany({
      where: { id: batch.id, tenantId: actor.tenantId, status: ImportStatus.validated },
      data: { status: ImportStatus.queued, mode },
    });
    if (claimed.count === 0) {
      // Lost the race / already queued — idempotent no-op, never a second enqueue.
      return this.getBatch(batch.id, actor.tenantId);
    }

    const payload: ImportJobPayload = {
      batchId: batch.id,
      kind: 'apply',
      mode,
      tenantId: actor.tenantId,
      schoolId: batch.schoolId,
      actorId: actor.id,
    };

    try {
      await this.queue.add('apply', payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 100, age: 86_400 },
        removeOnFail: { count: 50, age: 604_800 },
      });
    } catch (err) {
      // Enqueue failed after the claim — revert so the admin can retry (never a
      // stuck `queued` with no job).
      this.logger.error(`Failed to enqueue import apply ${batch.id}: ${(err as Error).message}`);
      await this.prisma.importBatch.updateMany({
        where: { id: batch.id, tenantId: actor.tenantId, status: ImportStatus.queued },
        data: { status: ImportStatus.validated },
      });
      throw new BadRequestException(`Échec de la mise en file de l'import : ${(err as Error).message}`);
    }

    return this.getBatch(batch.id, actor.tenantId);
  }

  /**
   * Rolls back an applied batch within the 24h window (E11-S1 — async).
   *
   * The 24h window is checked **at enqueue** so a past-window request is rejected
   * with a 400 BEFORE any job is queued (never a queued no-op rollback). On a
   * within-window request, flips `applied → queued` (from-status-guarded) and
   * enqueues the `rollback` job; the worker runs the SAME reverse-order
   * `rollbackRow` compensation via the relocated engine.
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
    this.requireHandler(batch.type);

    const claimed = await this.prisma.importBatch.updateMany({
      where: { id: batch.id, tenantId: actor.tenantId, status: ImportStatus.applied },
      data: { status: ImportStatus.queued },
    });
    if (claimed.count === 0) {
      return this.getBatch(batch.id, actor.tenantId);
    }

    const payload: ImportJobPayload = {
      batchId: batch.id,
      kind: 'rollback',
      mode: batch.mode ?? ImportMode.skip_invalid,
      tenantId: actor.tenantId,
      schoolId: batch.schoolId,
      actorId: actor.id,
    };

    try {
      await this.queue.add('rollback', payload, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 100, age: 86_400 },
        removeOnFail: { count: 50, age: 604_800 },
      });
    } catch (err) {
      this.logger.error(`Failed to enqueue import rollback ${batch.id}: ${(err as Error).message}`);
      await this.prisma.importBatch.updateMany({
        where: { id: batch.id, tenantId: actor.tenantId, status: ImportStatus.queued },
        data: { status: ImportStatus.applied },
      });
      throw new BadRequestException(`Échec de la mise en file de l'annulation : ${(err as Error).message}`);
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

  /**
   * Build the per-batch O(1) lookup caches via the shared `@pilotage/imports-core`
   * builder (E11-S1) so the validate path (here) and the worker apply path use
   * ONE implementation. Thin delegation kept so existing call sites are unchanged.
   */
  private buildCaches(schoolId: string): Promise<ImportCaches> {
    return buildImportCaches(this.prisma, schoolId);
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
