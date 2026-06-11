import { Prisma, ReconciliationClass } from '@prisma/client';

import {
  type AppliedEntity,
  type ApplyContext,
  type ConflictDecision,
  type ConflictField,
  type ConflictResolution,
  type ImportContext,
  type ImportHandler,
  type RollbackContext,
  type ValidationResult,
} from '../handler.types';

interface EnrollmentInput {
  studentExternalRef: string;
  className: string;
  _studentId?: string;
  _classSectionId?: string;
  _academicYearId?: string;
}

/** A class name is ambiguous when the same name exists in >1 grade level this year. */
function isAmbiguousClassName(
  caches: ImportContext['caches'],
  classKey: string | undefined,
): boolean {
  return Boolean(classKey && caches.classSectionsByNameAmbiguous.has(classKey));
}

/**
 * The clear French 4xx surfaced when a class name maps to more than one grade
 * level's class — an enrollments row carries only the name (no grade level), so
 * we refuse to guess rather than silently enroll the student into the wrong
 * grade level's class (E11 polish #5 follow-on iii).
 */
function ambiguousClassMessage(className: string): string {
  return `Classe « ${className} » ambiguë : ce nom existe dans plusieurs niveaux pour l'année active. Renommez la classe (un nom par niveau) ou désambiguïsez l'export avant d'inscrire.`;
}

/**
 * Bulk enroll students into class sections. Uses the active academic year and resolves
 * the target class by name. Respects max-capacity (tracked in-memory across the batch).
 */
export const enrollmentsHandler: ImportHandler = {
  type: 'enrollments',
  label: 'Inscriptions',
  description: 'Inscrire en masse des élèves dans des classes existantes pour l\'année scolaire active.',
  icon: 'ListChecks',
  requiredPermission: 'enrollments.write',
  template: {
    headers: ['studentExternalRef', 'className'],
    sample: [
      ['EL-2025-001', '6eA'],
      ['EL-2025-002', '6eA'],
      ['EL-2025-003', '5eB'],
    ],
    notes: [
      'studentExternalRef = matricule de l\'élève (doit déjà exister).',
      'className = nom exact de la classe pour l\'année active (ex: « 6eA »).',
      'Refuse l\'inscription si la capacité est dépassée. Un élève déjà inscrit dans la même classe est ignoré (inchangé, sans doublon) ; une classe différente cette année est signalée comme conflit à arbitrer.',
    ],
  },

  parseRow(row) {
    return {
      studentExternalRef: (row.studentexternalref ?? row['student external ref'] ?? row.matricule ?? '').trim(),
      className: (row.classname ?? row['class name'] ?? row.classe ?? '').trim(),
    };
  },

  validateRow(parsed, ctx: ImportContext): ValidationResult {
    const p = parsed as unknown as EnrollmentInput;
    const errors: ValidationResult['errors'] = [];

    if (!p.studentExternalRef) {
      errors.push({ field: 'studentExternalRef', message: 'Matricule de l\'élève requis.' });
    } else {
      const studentId = ctx.caches.studentExternalRefs.get(p.studentExternalRef);
      if (!studentId) {
        errors.push({
          field: 'studentExternalRef',
          message: `Élève introuvable (matricule « ${p.studentExternalRef} »).`,
        });
      } else {
        p._studentId = studentId;
      }
    }

    if (!p.className) {
      errors.push({ field: 'className', message: 'Nom de classe requis.' });
    } else if (!ctx.caches.activeAcademicYearId) {
      errors.push({
        field: 'className',
        message: 'Aucune année scolaire active : impossible d\'inscrire.',
        hint: 'Définissez d\'abord une année active dans Admin → Années scolaires.',
      });
    } else {
      const key = `${ctx.caches.activeAcademicYearId}:${p.className.toLowerCase()}`;
      const cls = ctx.caches.classSectionsByName.get(key);
      if (isAmbiguousClassName(ctx.caches, key)) {
        // Same name in >1 grade level this year — the `classSectionsByName` entry
        // is an arbitrary last-write-wins pick. Refuse rather than mis-enroll.
        errors.push({
          field: 'className',
          message: ambiguousClassMessage(p.className),
          hint: 'Un nom de classe doit être unique par niveau pour l\'année active.',
        });
      } else if (!cls) {
        errors.push({
          field: 'className',
          message: `Classe « ${p.className} » introuvable pour l'année active.`,
        });
      } else {
        if (cls.currentSize >= cls.maxStudents) {
          errors.push({
            field: 'className',
            message: `Classe « ${p.className} » pleine (${cls.currentSize}/${cls.maxStudents}).`,
            hint: 'Augmentez la capacité ou choisissez une autre section.',
          });
        }
        p._classSectionId = cls.id;
        p._academicYearId = cls.academicYearId;
      }
    }

    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [], normalized: p as unknown as Record<string, unknown> };
  },

  async applyRow(normalized, ctx: ApplyContext): Promise<AppliedEntity> {
    const p = normalized as unknown as EnrollmentInput;

    // E11-S3 follow-up (d) — APPLY-TIME RE-RESOLUTION of the cross-row linkage.
    //
    // `validateRow` resolves `studentExternalRef`/`className` into `_studentId`/
    // `_classSectionId` from the caches AT VALIDATE TIME. On a CSV upload those
    // caches are the real DB, so the baked ids are durable and correct. But on a
    // first COMBINED OneRoster pull the student/class are created LATER in the same
    // pull (separate batches), so the validate-time ids are `primeCaches`
    // placeholders (random UUIDs) that are NEVER inserted — applying them verbatim
    // would `enrollment.create` against a phantom FK and fail the whole batch.
    //
    // The fix: re-resolve the DURABLE natural keys (`studentExternalRef`,
    // `className`) against the caches the engine rebuilds FROM THE DB at apply time
    // (`buildImportCaches`). Because the apply runs in dependency order
    // (classes → students → enrollments), by the time this batch applies the real
    // student/class exist and carry their real ids in the apply-time caches. We
    // prefer the re-resolved id; only when the anchor cannot re-resolve do we fall
    // back to the stored `_studentId`/`_classSectionId` (the CSV-upload path, where
    // it equals the real DB id captured at validate → byte-identical behaviour).
    const studentId =
      (p.studentExternalRef ? ctx.caches.studentExternalRefs.get(p.studentExternalRef) : undefined) ??
      p._studentId;
    if (!studentId) {
      throw new Error(
        `Élève introuvable (matricule « ${p.studentExternalRef ?? ''} ») : impossible d'inscrire.`,
      );
    }

    const activeYearId = ctx.caches.activeAcademicYearId;
    const classKey =
      activeYearId && p.className ? `${activeYearId}:${p.className.toLowerCase()}` : undefined;
    // Grade-level disambiguation (E11 polish #5 follow-on iii): if the name maps
    // to >1 grade level's class this year, the re-resolved `classSectionsByName`
    // entry is an arbitrary last-write-wins pick — refuse with a clear French
    // error (the engine wraps it `Ligne N : …`, never a wrong-grade enrollment).
    if (isAmbiguousClassName(ctx.caches, classKey)) {
      throw new Error(ambiguousClassMessage(p.className ?? ''));
    }
    const resolvedClass = classKey ? ctx.caches.classSectionsByName.get(classKey) : undefined;
    const classSectionId = resolvedClass?.id ?? p._classSectionId;
    const academicYearId = resolvedClass?.academicYearId ?? p._academicYearId;
    if (!classSectionId || !academicYearId) {
      throw new Error(
        `Classe « ${p.className ?? ''} » introuvable pour l'année active : impossible d'inscrire.`,
      );
    }

    // E11-S4 (d) — IDEMPOTENT re-sync convergence (FR5, ADR-024 §reconciliation).
    //
    // A 2nd OneRoster pull (or a re-applied CSV) re-presents the SAME enrollment
    // rows. The student is already actively enrolled this year, so the
    // active-enrollment probe finds an existing row. Before this fix the handler
    // THREW `Élève déjà inscrit`, which the engine re-throws (engine.ts) and
    // aborts the WHOLE batch — so a 2nd pull of an unchanged roster failed instead
    // of converging to "0 created, 0 error" as FR5/AC-4 advertise.
    //
    // Mirror the students-handler idempotent-match precedent (no silent
    // re-enrollment, no auto-move of a child between classes):
    //   - SAME student × SAME class this year → `unchanged` (no write, no
    //     duplicate enrollment); the row's `createdEntityId` is the PRE-EXISTING
    //     enrollment, so the S2 rollback-safety invariant keeps it OUT of the
    //     delete set (we never created it).
    //   - SAME student in a DIFFERENT class this year → `conflict` (recorded with
    //     the side-by-side class diff, written NOTHING) — a real reconciliation
    //     decision the admin arbitrates, never a silent re-enrollment.
    const active = await ctx.tx.enrollment.findFirst({
      where: { studentId, academicYearId, status: 'active', tenantId: ctx.tenantId },
    });
    if (active) {
      if (active.classSectionId === classSectionId) {
        // Already enrolled in this exact class → idempotent no-op (unchanged).
        return { id: active.id, type: 'enrollment', reconciliation: ReconciliationClass.unchanged };
      }
      // Enrolled in a DIFFERENT class this year → record a conflict, write nothing.
      const conflictFields: ConflictField[] = [
        { field: 'classSectionId', current: active.classSectionId, source: classSectionId },
      ];
      return {
        id: active.id,
        type: 'enrollment',
        reconciliation: ReconciliationClass.conflict,
        conflictFields,
      };
    }

    const enrollment = await ctx.tx.enrollment.create({
      data: {
        tenantId: ctx.tenantId,
        studentId,
        classSectionId,
        academicYearId,
        status: 'active',
      },
    });

    // Update in-memory capacity tracker for subsequent rows in same batch.
    for (const [key, cls] of ctx.caches.classSectionsByName.entries()) {
      if (cls.id === classSectionId) {
        ctx.caches.classSectionsByName.set(key, { ...cls, currentSize: cls.currentSize + 1 });
        break;
      }
    }

    return { id: enrollment.id, type: 'enrollment' };
  },

  async rollbackRow(entityId, ctx: RollbackContext): Promise<void> {
    await ctx.tx.enrollment.deleteMany({ where: { id: entityId, tenantId: ctx.tenantId } });
  },

  /**
   * E11 polish (hardening #6) — resolve a `classSectionId` (class-move) conflict
   * on a matched active enrollment.
   *
   * The `applyRow` idempotent path records a `conflict` when a student is already
   * actively enrolled this year in a DIFFERENT class than the source proposes
   * (enrollments.handler.ts:171-180). This verb lets an admin one-click arbitrate
   * that class move, mirroring `studentsHandler.resolveConflict` — but the write
   * shape is materially different: an enrollment move is NOT a delete+create (that
   * would cross the `(studentId, academicYearId) WHERE status='active'` partial
   * unique index and break the S2 rollback-safety invariant). It is an IN-PLACE
   * update of the existing active enrollment's `classSectionId`, so:
   *   - `entityId` stays the PRE-EXISTING active enrollment id in BOTH branches →
   *     the service flips the row to `applied` with `createdEntityId = active.id`,
   *     a MATCHED row the S2 rollback invariant excludes from the delete set (a
   *     24h rollback flips it to `rolled_back` for bookkeeping WITHOUT deleting the
   *     enrollment the import did not create);
   *   - `keep_current` writes NOTHING (the child stays in their current class) →
   *     `unchanged`;
   *   - `take_source` does EXACTLY ONE `enrollment.update` (frees the old seat,
   *     enrolls the new class via the active-enrollment update) → `updated`. No
   *     `enrollment.create` (so no duplicate seat, the active-per-year partial
   *     unique holds). The update IS guarded against the FULL composite
   *     `@@unique([studentId, classSectionId, academicYearId])` (which spans
   *     NON-active rows too): if the child carries a HISTORICAL row for the source
   *     class this year (a prior `transferred_out`/`graduated`/… row left by a real
   *     class move), the in-place classSectionId update would collide on the
   *     composite key → P2002. We detect that pre-existing row first (and catch a
   *     racing P2002) and surface a clean French 4xx — never a raw 500 (AC-5).
   *
   * Re-resolves the matched entities tenant/school-scoped INSIDE the tx from the
   * row's durable natural keys (`studentExternalRef`, `className`) via `ctx.caches`,
   * exactly as `applyRow` does — never trusting a stale `_studentId`/`_classSectionId`
   * baked at validate time (the combined-pull placeholder-UUID defect). A vanished
   * student/class/enrollment throws a clear French error (a 4xx, never a 500). The
   * `import.conflict.resolve` audit row is written by the service caller.
   *
   * NOTE (carried-over, non-blocking per the architect ruling): the validate-time
   * capacity guard (enrollments.handler.ts:87) does NOT re-run on arbitration — an
   * explicit admin `take_source` may move the child into a class at capacity. This
   * is the established posture (the conflict was already recorded against that
   * target class; capacity is a soft cap the admin can adjust).
   */
  async resolveConflict(
    normalized: Record<string, unknown>,
    decision: ConflictDecision,
    ctx: ApplyContext,
  ): Promise<ConflictResolution> {
    const p = normalized as unknown as EnrollmentInput;

    // Re-resolve the student from the durable matricule anchor (tenant/school-scoped
    // caches built from batch.schoolId) — NEVER the stale `_studentId`.
    const studentId =
      (p.studentExternalRef ? ctx.caches.studentExternalRefs.get(p.studentExternalRef) : undefined) ??
      p._studentId;
    if (!studentId) {
      throw new Error(
        `Élève introuvable pour cet arbitrage (matricule « ${p.studentExternalRef ?? ''} »).`,
      );
    }

    // Re-resolve the SOURCE class (the class-move target) from the durable class-name
    // anchor against the active year — NEVER the stale `_classSectionId`.
    const activeYearId = ctx.caches.activeAcademicYearId;
    const classKey =
      activeYearId && p.className ? `${activeYearId}:${p.className.toLowerCase()}` : undefined;
    // Grade-level disambiguation (E11 polish #5 follow-on iii): an ambiguous
    // source class name must not be silently arbitrated into the wrong grade
    // level's class — refuse with a clear French 4xx (never a 500).
    if (isAmbiguousClassName(ctx.caches, classKey)) {
      throw new Error(ambiguousClassMessage(p.className ?? ''));
    }
    const resolvedClass = classKey ? ctx.caches.classSectionsByName.get(classKey) : undefined;
    const classSectionId = resolvedClass?.id ?? p._classSectionId;
    const academicYearId = resolvedClass?.academicYearId ?? p._academicYearId;
    if (!classSectionId || !academicYearId) {
      throw new Error(
        `Classe « ${p.className ?? ''} » introuvable pour cet arbitrage.`,
      );
    }

    // Re-find the student's CURRENT active enrollment for the active year, inside
    // the tx, tenant-scoped — the pre-existing row whose seat we move (or keep).
    const active = await ctx.tx.enrollment.findFirst({
      where: { studentId, academicYearId, status: 'active', tenantId: ctx.tenantId },
    });
    if (!active) {
      throw new Error('Inscription active introuvable pour cet arbitrage.');
    }

    if (decision === 'keep_current') {
      // No write — the child stays in their current class.
      return {
        entityId: active.id,
        type: 'enrollment',
        reconciliation: ReconciliationClass.unchanged,
      };
    }

    // take_source — move the child into the source class by updating the EXISTING
    // active enrollment IN PLACE (frees the old seat, enrolls the new class). No
    // new row, so the active-per-year PARTIAL unique holds.
    //
    // BUT the model ALSO carries the FULL composite `@@unique([studentId,
    // classSectionId, academicYearId])` (schema.prisma:656) which applies to
    // NON-active rows too. EnrollmentStatus has terminal states
    // (transferred_in/out/graduated/dropped), so a real class move leaves a
    // HISTORICAL row. If the child was previously enrolled in the SOURCE class
    // this same year (e.g. a `transferred_out` 6eB row) and the source now
    // re-proposes 6eB, the in-place `classSectionId` update would make the active
    // row collide with that historical row on the composite key → Prisma P2002 →
    // unhandled HTTP 500 (AC-5 "never a 500" violation). Guard it: detect the
    // pre-existing historical row FIRST and surface a clean French 4xx, and
    // belt-and-braces catch a racing P2002 around the update so the raw Prisma
    // error can never escape to a 500.
    if (classSectionId !== active.classSectionId) {
      const collision = await ctx.tx.enrollment.findFirst({
        where: {
          studentId,
          classSectionId,
          academicYearId,
          tenantId: ctx.tenantId,
          id: { not: active.id },
        },
      });
      if (collision) {
        throw new Error(
          'Cet élève a déjà une inscription (historique ou active) pour cette classe cette année — déplacement impossible.',
        );
      }
    }

    // If the source class equals the current one (degenerate), this is a harmless
    // no-op write still classified `updated`.
    try {
      await ctx.tx.enrollment.update({
        where: { id: active.id },
        data: { classSectionId },
      });
    } catch (err) {
      // Defence-in-depth: a concurrent insert could have created the colliding
      // historical/active row between the probe above and this update. Translate
      // the composite-unique P2002 into the same clean French 4xx — never a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new Error(
          'Cet élève a déjà une inscription (historique ou active) pour cette classe cette année — déplacement impossible.',
        );
      }
      throw err;
    }
    return {
      entityId: active.id,
      type: 'enrollment',
      reconciliation: ReconciliationClass.updated,
    };
  },
};
