import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ImportOrigin, ImportRowStatus, ImportStatus, ImportType, Prisma, RosterSourceKind, RosterSyncStatus } from '@prisma/client';

import {
  buildImportCaches,
  getHandler,
  type ImportCaches,
  type ImportContext,
  type ImportHandler,
} from '@pilotage/imports-core';

import { PrismaService } from '../../shared/prisma/prisma.service';
import { SchoolContextService } from '../school-structure/school-context.service';

import { mapOneRosterBundle, ONEROSTER_MAX_ROWS, rowsToCsv, type OneRosterBundle } from './oneroster.adapter';

/** Public-safe RosterSource shape — NEVER exposes `credentialRef` (Sentinel gate). */
export interface RosterSourceDto {
  id: string;
  kind: RosterSourceKind;
  label: string;
  baseUrl: string | null;
  status: RosterSyncStatus;
  /** True when a credential is stored — the value itself is NEVER returned. */
  hasCredential: boolean;
  lastSyncAt: string | null;
  lastBatchId: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface ConnectSourceInput {
  kind: RosterSourceKind;
  label: string;
  baseUrl?: string;
  /** Opaque secret (REST only). Stored as a server-side ref, never returned. */
  credential?: string;
}

export interface SyncResult {
  sourceId: string;
  /** The produced batches (one per mapped ImportType), newest landing target first. */
  batches: { id: string; type: ImportType; validCount: number; invalidCount: number; totalRows: number }[];
  /** The batch the admin should land on (the students batch when present). */
  primaryBatchId: string | null;
  warnings: string[];
  /**
   * E11-S4 (FR3/AC-3 — the R6 non-destructive SIS-delete wall). Pilotage students
   * carrying a `sourcedId`/externalRef from THIS source's last sync that were
   * ABSENT from the latest pull — surfaced for the panel to render kindly as
   * "à vérifier" (amber/neutral, never red, never a one-click delete). E11 NEVER
   * auto-deletes a child on a sync diff; this is a read-only, reviewable signal.
   */
  absentFromSource: { externalRef: string; name: string }[];
}

/**
 * E11-S3 follow-up (d) / FR1 — drop the handler's internal `_`-prefixed
 * resolution fields (`_studentId`/`_classSectionId`/`_academicYearId`) from a
 * normalized enrollment payload before persisting the `valid` ImportRow, so the
 * row carries ONLY the durable natural keys (`studentExternalRef`/`className`)
 * and never a same-pull `primeCaches` placeholder id. `enrollmentsHandler.applyRow`
 * re-resolves those anchors against the apply-time DB caches.
 */
function stripResolvedIds(parsed: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!k.startsWith('_')) clean[k] = v;
  }
  return clean;
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: SchoolContextService,
  ) {}

  /* -------------------------------------------------------------------------
   * Connect / list
   * ---------------------------------------------------------------------- */

  async connect(actor: { id: string; tenantId: string }, input: ConnectSourceInput): Promise<RosterSourceDto> {
    const label = input.label?.trim();
    if (!label) throw new BadRequestException('Un nom de source est requis.');
    if (label.length > 120) throw new BadRequestException('Nom de source trop long (max 120 caractères).');

    if (input.kind === RosterSourceKind.oneroster_rest && !input.baseUrl?.trim()) {
      throw new BadRequestException('Une URL de base est requise pour une source REST.');
    }

    const { schoolId } = await this.ctx.forTenant(actor.tenantId);

    // SECRET HANDLING (Sentinel): the raw credential is NEVER persisted in
    // plaintext nor returned. We store only an opaque server-side ref; the real
    // value would be sealed in the platform secret store at pull time. For the
    // CSV-bundle v1 the credential is unused (the bundle rides the sync request).
    const credentialRef = input.credential?.trim()
      ? this.sealCredential(actor.tenantId, schoolId)
      : null;

    const source = await this.prisma.rosterSource.create({
      data: {
        tenantId: actor.tenantId,
        schoolId,
        kind: input.kind,
        label,
        baseUrl: input.baseUrl?.trim() || null,
        credentialRef,
        status: RosterSyncStatus.idle,
        createdBy: actor.id,
      },
    });

    await this.audit(actor, 'integration.roster_source.created', source.id, {
      kind: source.kind,
      label: source.label,
      hasCredential: !!credentialRef,
    });

    return this.toDto(source);
  }

  async list(tenantId: string): Promise<RosterSourceDto[]> {
    const { schoolId } = await this.ctx.forTenant(tenantId);
    const sources = await this.prisma.rosterSource.findMany({
      where: { tenantId, schoolId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return sources.map((s) => this.toDto(s));
  }

  async getOne(id: string, tenantId: string): Promise<RosterSourceDto> {
    const source = await this.requireSource(id, tenantId);
    return this.toDto(source);
  }

  /* -------------------------------------------------------------------------
   * Sync (pull + map → validated ImportBatch per type)
   * ---------------------------------------------------------------------- */

  /**
   * Pull the source roster and map it into one or more validated `ImportBatch`
   * rows (`origin = oneroster`). v1 = a OneRoster CSV bundle uploaded in the
   * sync request body. Each produced batch reuses the EXISTING type handler's
   * `validateRow` (no forked validation) and lands in `validated`, ready for the
   * S1 async apply + the S2 reconciliation panel.
   *
   * A partial/failed pull marks the source `failed` and produces NO corrupt
   * batch (never a half-applied roster). The OneRoster `sourcedId` is the
   * idempotency anchor carried in `externalRef`.
   */
  async sync(id: string, actor: { id: string; tenantId: string }, bundle: OneRosterBundle): Promise<SyncResult> {
    const source = await this.requireSource(id, actor.tenantId);

    if (source.kind === RosterSourceKind.oneroster_rest) {
      // The live REST client is the recorded optional stretch (R3). The model
      // admits it without a rewrite, but v1 ships CSV-bundle only.
      throw new BadRequestException(
        'La synchronisation REST en direct arrivera prochainement. Importez un bundle CSV OneRoster pour le moment.',
      );
    }

    // Mark pulling (best-effort lifecycle; tenant-scoped).
    await this.prisma.rosterSource.updateMany({
      where: { id: source.id, tenantId: actor.tenantId },
      data: { status: RosterSyncStatus.pulling, lastError: null },
    });

    try {
      // FR10 multi-school correctness: the batch, the validation caches, the
      // active-year resolution AND the SIS-delete divergence read must all use
      // the SOURCE's own school — NOT the actor's active/default school (which a
      // multi-school tenant may have switched away from). We resolve the school
      // context for `source.schoolId` (via `forTenant`'s explicit-school arg,
      // which also re-validates the school belongs to the tenant), so the active
      // year `buildImportCaches` derives matches the school the batch lands in.
      const schoolId = source.schoolId;
      await this.ctx.forTenant(actor.tenantId, schoolId);
      const mappedBundle = mapOneRosterBundle(bundle);

      if (mappedBundle.mapped.length === 0) {
        throw new BadRequestException(
          mappedBundle.warnings[0] ?? 'Le bundle OneRoster ne contient aucune donnée de roster exploitable.',
        );
      }

      // MAX_ROWS guard (mirrors the CSV upload path) — a too-large pull is a
      // failed pull, never a corrupt apply. Both guards run BEFORE any batch
      // create so an over-cap pull leaves the source `failed` with zero rows.
      // Per-type guard (defence-in-depth): a single type may not exceed the cap.
      for (const m of mappedBundle.mapped) {
        if (m.rows.length > ONEROSTER_MAX_ROWS) {
          throw new BadRequestException(
            `Trop de lignes « ${m.type} » (${m.rows.length}). Maximum ${ONEROSTER_MAX_ROWS} par synchronisation.`,
          );
        }
      }
      // Combined-total guard: e.g. 4000 users + 4000 enrollments each pass the
      // per-type cap but together apply 8000 rows — reject on the mapped total.
      const totalMapped = mappedBundle.mapped.reduce((sum, m) => sum + m.rows.length, 0);
      if (totalMapped > ONEROSTER_MAX_ROWS) {
        throw new BadRequestException(
          `Trop de lignes au total (${totalMapped}). Maximum ${ONEROSTER_MAX_ROWS} par synchronisation.`,
        );
      }

      // Build the lookup caches ONCE; reused across every produced batch. A sync
      // can produce classes + students + enrollments together, where enrollments
      // reference students/classes that are in the SAME pull (not yet applied).
      // We map in dependency order (classes → students → enrollments) and PRIME
      // the shared caches with each type's about-to-be-created identities after
      // validating it, so an enrollment to a brand-new student/class still
      // validates `valid` DURING validation. The placeholder ids are
      // VALIDATION-ONLY — they never reach the DB (stripped from the persisted
      // enrollment payload below) and they are NOT what the apply uses.
      //
      // E11-S3 follow-up (d) — the placeholder-UUID cross-row linkage fix
      // (Approach A — re-resolve at apply, the architect's authoritative ruling).
      // `enrollmentsHandler.validateRow` resolves `studentExternalRef`/`className`
      // into a `_studentId`/`_classSectionId` (a `primeCaches` placeholder for a
      // brand-new same-pull student/class). The previous design BAKED those ids
      // into the persisted payload and `applyRow` used them verbatim — so the
      // worker's enrollment apply would `enrollment.create` against a phantom FK.
      // The fix lives in TWO places, neither of which defers the work to a later
      // sync (AC-1 — the enrollment is created on the FIRST combined pull):
      //   (1) `enrollmentsHandler.applyRow` (in `@pilotage/imports-core`) now
      //       RE-RESOLVES the durable natural keys (`studentExternalRef`,
      //       `className`) against the caches the engine rebuilds FROM THE DB at
      //       apply time. Because batches apply in dependency order
      //       (classes → students → enrollments), the real student/class exist by
      //       the time the enrollments batch applies, so the re-resolution finds
      //       their REAL ids. It falls back to the stored `_studentId`/
      //       `_classSectionId` only on the CSV path (byte-parity), and throws a
      //       clear French error when neither resolves (never a phantom FK).
      //   (2) HERE — `createValidatedBatch` strips the validation-only
      //       `_`-prefixed placeholder ids from the persisted enrollments payload
      //       (FR1), so a placeholder UUID can never reach the DB; only the
      //       durable `studentExternalRef`/`className` anchors are stored.
      const caches = await buildImportCaches(this.prisma, schoolId);
      const importCtx: ImportContext = { tenantId: actor.tenantId, schoolId, caches };

      const produced: SyncResult['batches'] = [];
      let primaryBatchId: string | null = null;
      let lastBatchId: string | null = null;

      for (const m of mappedBundle.mapped) {
        const handler = this.requireHandler(m.type);
        const batch = await this.createValidatedBatch(
          actor,
          schoolId,
          source.id,
          m.type,
          handler,
          m.rows,
          importCtx,
          // FR1 — strip the validation-only placeholder anchors from the persisted
          // enrollments payload so a `primeCaches` randomUUID never reaches the DB;
          // only the durable natural keys remain, which `applyRow` re-resolves.
          m.type === 'enrollments',
        );
        // Prime the caches with this type's identities so later types in the
        // SAME pull can reference them during validation.
        this.primeCaches(m.type, m.rows, caches);
        produced.push(batch.summary);
        lastBatchId = batch.summary.id;
        if (m.type === 'students') primaryBatchId = batch.summary.id;
      }
      // Land on students if produced, else the first batch.
      if (!primaryBatchId) primaryBatchId = produced[0]?.id ?? null;

      // E11-S4 (FR3/AC-3 — the R6 wall): compute the SIS-side-delete divergence
      // and stamp it onto the produced students batch summary so the health panel
      // can render an "à vérifier" advisory. Best-effort + non-destructive: a
      // failure here never fails the sync, and NO delete path is ever taken.
      const studentsPull = mappedBundle.mapped.find((m) => m.type === 'students');
      let absentFromSource: SyncResult['absentFromSource'] = [];
      if (studentsPull && primaryBatchId) {
        absentFromSource = await this.computeAbsentFromSource(
          actor.tenantId,
          schoolId,
          studentsPull.rows,
          primaryBatchId,
        );
      }

      await this.prisma.rosterSource.updateMany({
        where: { id: source.id, tenantId: actor.tenantId },
        data: {
          status: RosterSyncStatus.mapped,
          lastSyncAt: new Date(),
          lastBatchId: lastBatchId ?? primaryBatchId,
          lastError: null,
        },
      });

      await this.audit(actor, 'import.sync.pull', source.id, {
        kind: source.kind,
        sourceRowCount: mappedBundle.sourceRowCount,
        batches: produced.map((b) => ({ id: b.id, type: b.type, valid: b.validCount, invalid: b.invalidCount })),
        // FR3/AC-3 — record the non-destructive divergence count (never an action).
        absentFromSourceCount: absentFromSource.length,
      });

      return {
        sourceId: source.id,
        batches: produced,
        primaryBatchId,
        warnings: mappedBundle.warnings,
        absentFromSource,
      };
    } catch (err) {
      const message = (err as Error).message ?? 'Échec de la synchronisation.';
      await this.prisma.rosterSource.updateMany({
        where: { id: source.id, tenantId: actor.tenantId },
        data: { status: RosterSyncStatus.failed, lastError: message.slice(0, 500) },
      });
      this.logger.error(`[oneroster.sync] ${source.id} — failed: ${message}`);
      throw err instanceof BadRequestException || err instanceof NotFoundException
        ? err
        : new BadRequestException(message);
    }
  }

  /* -------------------------------------------------------------------------
   * Helpers
   * ---------------------------------------------------------------------- */

  /**
   * Create a `validated` ImportBatch (origin = oneroster) from mapped raw rows,
   * running the EXISTING handler `parseRow`/`validateRow` per row (no forked
   * validation). Mirrors `ImportsService.uploadAndValidate` so the produced
   * batch is indistinguishable from a CSV upload to the apply engine.
   */
  private async createValidatedBatch(
    actor: { id: string; tenantId: string },
    schoolId: string,
    rosterSourceId: string,
    type: ImportType,
    handler: ImportHandler,
    rawRows: Record<string, string>[],
    importCtx: ImportContext,
    /**
     * E11-S3 follow-up (d) / FR1 — when true (the enrollments type), strip the
     * handler's internal `_`-prefixed resolution ids (`_studentId`/
     * `_classSectionId`/`_academicYearId`) from the persisted `valid` row payload.
     * On a combined pull those ids may be `primeCaches` placeholders; the apply
     * re-resolves the durable natural keys (`studentExternalRef`/`className`)
     * against the apply-time DB caches, so the placeholders must never reach the
     * DB. No-op for every other type (whose payload carries no cross-row anchor).
     */
    stripPlaceholders = false,
  ): Promise<{ summary: SyncResult['batches'][number] }> {
    const fileName = `oneroster-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
    const rawCsv = rowsToCsv(handler.template.headers, rawRows);

    const batch = await this.prisma.importBatch.create({
      data: {
        tenantId: actor.tenantId,
        schoolId,
        type,
        fileName,
        rawCsv,
        status: ImportStatus.validating,
        origin: ImportOrigin.oneroster,
        rosterSourceId,
        triggeredBy: actor.id,
        summary: { totalRows: rawRows.length, source: 'oneroster' },
      },
    });

    let validCount = 0;
    let invalidCount = 0;
    const rowsToCreate: Prisma.ImportRowCreateManyInput[] = [];
    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i]!;
      try {
        const parsed = handler.parseRow(raw);
        const result = handler.validateRow(parsed, importCtx);
        if (result.ok) {
          validCount++;
          // FR1 — for enrollments, persist only the durable cross-row anchors
          // (`studentExternalRef`/`className`); strip the validation-only
          // `_`-prefixed resolution ids (which may be `primeCaches` placeholders).
          // `applyRow` re-resolves them against the apply-time DB caches. For every
          // other type the normalized payload carries no `_`-anchor → no-op.
          const payload = stripPlaceholders
            ? stripResolvedIds(result.normalized ?? {})
            : (result.normalized ?? {});
          rowsToCreate.push({
            batchId: batch.id,
            rowIndex: i + 1,
            status: ImportRowStatus.valid,
            payload: payload as Prisma.InputJsonValue,
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
          errors: [{ message: `Erreur de mapping OneRoster: ${(err as Error).message}` }] as unknown as Prisma.InputJsonValue,
        });
      }
    }
    await this.prisma.importRow.createMany({ data: rowsToCreate });

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: ImportStatus.validated,
        validatedAt: new Date(),
        summary: { totalRows: rawRows.length, validCount, invalidCount, source: 'oneroster' },
      },
    });

    return {
      summary: { id: batch.id, type, validCount, invalidCount, totalRows: rawRows.length },
    };
  }

  /**
   * E11-S4 (FR3/AC-3 — the R6 non-destructive SIS-delete wall).
   *
   * Compute the set of Pilotage students for this school that carry an
   * `externalRef` (the OneRoster `sourcedId` anchor) but were NOT present in this
   * pull's `students` rows — i.e. the SIS appears to have removed them. Because an
   * absent source row simply produces NO ImportRow, this deletion would otherwise
   * be INVISIBLE; here we surface it as a read-only, reviewable advisory stamped
   * onto the produced students batch summary (`absentFromSource`).
   *
   * STRICTLY non-destructive: this method only READS + writes the advisory list
   * into the batch summary. It NEVER deletes a student (R6). Best-effort: any
   * failure is swallowed (the sync already succeeded) and returns `[]`.
   */
  private async computeAbsentFromSource(
    tenantId: string,
    schoolId: string,
    studentsRows: Record<string, string>[],
    studentsBatchId: string,
  ): Promise<SyncResult['absentFromSource']> {
    try {
      // The externalRefs present in THIS pull (the sourcedId anchors that are
      // still in the SIS). A student locally carrying a ref outside this set is
      // "present locally, absent from source".
      const pulledRefs = new Set<string>();
      for (const r of studentsRows) {
        const ref = (r.externalref ?? '').trim();
        if (ref) pulledRefs.add(ref);
      }

      // Only consider students that carry an externalRef (a roster-managed pupil);
      // a manually-created student with no ref is never "absent from source".
      const managed = await this.prisma.student.findMany({
        where: { tenantId, schoolId, externalRef: { not: null } },
        select: { externalRef: true, firstName: true, lastName: true },
        take: ONEROSTER_MAX_ROWS,
      });

      const absent = managed
        .filter((s) => s.externalRef && !pulledRefs.has(s.externalRef))
        .map((s) => ({
          externalRef: s.externalRef as string,
          name: `${s.firstName} ${s.lastName}`.trim(),
        }));

      if (absent.length > 0) {
        // Stamp the advisory onto the students batch summary (additive, optional)
        // so the panel can render "à vérifier" without a second query. Re-read the
        // current summary to merge non-destructively with the validate roll-up.
        const batch = await this.prisma.importBatch.findFirst({
          where: { id: studentsBatchId, tenantId },
          select: { summary: true },
        });
        const summary = (batch?.summary as Record<string, unknown> | null) ?? {};
        await this.prisma.importBatch.updateMany({
          where: { id: studentsBatchId, tenantId },
          data: { summary: { ...summary, absentFromSource: absent } as Prisma.InputJsonValue },
        });
      }

      return absent;
    } catch (err) {
      // Non-destructive + best-effort: a divergence-compute failure never fails the
      // sync (the batches are already produced) and never deletes anything.
      this.logger.warn(`[oneroster.sync] absent-from-source compute failed: ${(err as Error).message}`);
      return [];
    }
  }

  private requireHandler(type: ImportType): ImportHandler {
    const handler = getHandler(type);
    if (!handler) throw new BadRequestException(`Type d'import « ${type} » non supporté.`);
    return handler;
  }

  /**
   * Prime the shared caches with the identities a just-validated type will
   * create, so a later type in the SAME pull (e.g. enrollments → students/
   * classes) validates `valid` instead of `invalid`. The placeholder ids are
   * VALIDATION-ONLY — the real entities are created at apply time by the
   * handlers; these never reach the DB. Mirrors the per-row cache mutation the
   * handlers do at apply time, applied ahead of apply for cross-type validation.
   */
  private primeCaches(
    type: 'students' | 'classes' | 'enrollments',
    rows: Record<string, string>[],
    caches: ImportCaches,
  ): void {
    if (type === 'students') {
      for (const r of rows) {
        const ref = (r.externalref ?? '').trim();
        if (ref && !caches.studentExternalRefs.has(ref)) {
          const id = randomUUID();
          caches.studentExternalRefs.set(ref, id);
          caches.studentsByExternalRef.set(ref, {
            id,
            firstName: (r.firstname ?? '').trim(),
            lastName: (r.lastname ?? '').trim(),
            birthDate: null,
            email: (r.email ?? '').trim() || null,
            notes: null,
          });
        }
      }
    } else if (type === 'classes') {
      const ay = caches.activeAcademicYearId;
      if (!ay) return; // no active year → classes can't be keyed; enrollments stay invalid (honest)
      for (const r of rows) {
        const name = (r.name ?? '').trim();
        if (!name) continue;
        const key = `${ay}:${name.toLowerCase()}`;
        if (!caches.classSectionsByName.has(key)) {
          caches.classSectionsByName.set(key, {
            id: randomUUID(),
            gradeLevelId: randomUUID(),
            academicYearId: ay,
            maxStudents: 9_999, // generous: a new section is never "full" at validation
            currentSize: 0,
          });
        }
      }
    }
  }

  /**
   * Load a source tenant-scoped in ONE query (ADR-002 defence-in-depth). A
   * cross-tenant id is INDISTINGUISHABLE from a non-existent id — both 404 —
   * closing the existence oracle where a 403-vs-404 told an attacker the id
   * exists in another tenant.
   */
  private async requireSource(id: string, tenantId: string) {
    const source = await this.prisma.rosterSource.findFirst({ where: { id, tenantId } });
    if (!source) throw new NotFoundException('Source introuvable.');
    return source;
  }

  /**
   * Produce an opaque credential ref. The raw secret is NEVER persisted: in a
   * full deployment this would seal the value into the platform secret store and
   * return its key id. For v1 (CSV bundle) no live credential is used, so we
   * store only a non-reversible marker that records "a credential was supplied"
   * without ever holding the plaintext.
   */
  private sealCredential(tenantId: string, schoolId: string): string {
    return `vault:${tenantId.slice(0, 8)}:${schoolId.slice(0, 8)}:${Date.now().toString(36)}`;
  }

  private toDto(s: {
    id: string;
    kind: RosterSourceKind;
    label: string;
    baseUrl: string | null;
    status: RosterSyncStatus;
    credentialRef: string | null;
    lastSyncAt: Date | null;
    lastBatchId: string | null;
    lastError: string | null;
    createdAt: Date;
  }): RosterSourceDto {
    return {
      id: s.id,
      kind: s.kind,
      label: s.label,
      baseUrl: s.baseUrl,
      status: s.status,
      hasCredential: !!s.credentialRef,
      lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
      lastBatchId: s.lastBatchId,
      lastError: s.lastError,
      createdAt: s.createdAt.toISOString(),
    };
  }

  private async audit(
    actor: { id: string; tenantId: string },
    action: string,
    resourceId: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.id,
        actorRole: 'school_admin',
        portal: 'admin',
        action,
        resourceType: 'roster_source',
        resourceId,
        after: after as Prisma.InputJsonValue,
      },
    });
  }
}
