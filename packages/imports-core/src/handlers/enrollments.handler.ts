import { ReconciliationClass } from '@prisma/client';

import {
  type AppliedEntity,
  type ApplyContext,
  type ConflictField,
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
      if (!cls) {
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
};
