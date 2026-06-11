import { ReconciliationClass } from '@prisma/client';

import { type AppliedEntity, type ApplyContext, type ConflictField, type ImportContext, type ImportHandler, type RollbackContext, type ValidationResult } from '../handler.types';

interface StudentInput {
  firstName: string;
  lastName: string;
  birthDate?: string; // ISO date or DD/MM/YYYY
  externalRef?: string;
  email?: string;
  notes?: string;
  /**
   * E11-S2 (FR3) — set in validateRow when externalRef matches an EXISTING
   * student. Its presence flips applyRow from "always create" into the
   * idempotent match path (unchanged / updated / conflict), so a re-run of the
   * same CSV converges to `unchanged`, never a duplicate `created`.
   */
  _matchedStudentId?: string;
}

/** Identity fields whose disagreement on a matched student BLOCKS the apply (conflict). */
const PROTECTED_FIELDS = ['firstName', 'lastName', 'birthDate'] as const;

/** Normalise a date-ish value to a YYYY-MM-DD string for stable comparison. */
function dateKey(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // French DD/MM/YYYY
  const fr = trimmed.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (fr) {
    const [, d, m, y] = fr;
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  return undefined;
}

export const studentsHandler: ImportHandler = {
  type: 'students',
  label: 'Élèves',
  description: 'Importer la liste des élèves de l\'établissement. Les inscriptions en classe arrivent en Phase 3.',
  icon: 'Users',
  requiredPermission: 'students.write',
  template: {
    headers: ['firstName', 'lastName', 'birthDate', 'externalRef', 'email', 'notes'],
    sample: [
      ['Léa', 'Martin', '15/03/2012', 'EL-2025-001', 'lea.martin@example.local', ''],
      ['Tom', 'Bernard', '08/07/2011', 'EL-2025-002', '', 'Allergique aux arachides'],
      ['Sophie', 'Dupont', '2010-11-22', 'EL-2025-003', '', ''],
    ],
    notes: [
      'externalRef = matricule unique de votre établissement (idéal pour mises à jour ultérieures).',
      'birthDate accepte DD/MM/YYYY ou YYYY-MM-DD.',
      'email et notes sont optionnels.',
    ],
  },

  parseRow(row) {
    return {
      firstName: (row.firstname ?? row['first name'] ?? row.prenom ?? '').trim(),
      lastName: (row.lastname ?? row['last name'] ?? row.nom ?? '').trim(),
      birthDate: normalizeDate(row.birthdate ?? row['birth date'] ?? row.datenaissance ?? row['date de naissance']),
      externalRef: (row.externalref ?? row['external ref'] ?? row.matricule ?? '').trim() || undefined,
      email: (row.email ?? '').trim().toLowerCase() || undefined,
      notes: (row.notes ?? '').trim() || undefined,
    };
  },

  validateRow(parsed, ctx: ImportContext): ValidationResult {
    const p = parsed as unknown as StudentInput;
    const errors: ValidationResult['errors'] = [];

    if (!p.firstName || p.firstName.length < 1 || p.firstName.length > 80)
      errors.push({ field: 'firstName', message: 'Prénom requis (1-80 caractères)' });
    if (!p.lastName || p.lastName.length < 1 || p.lastName.length > 80)
      errors.push({ field: 'lastName', message: 'Nom requis (1-80 caractères)' });

    if (p.birthDate) {
      const d = new Date(p.birthDate);
      const now = new Date();
      const minBirth = new Date(now.getFullYear() - 30, 0, 1);
      const maxBirth = new Date(now.getFullYear() - 2, 11, 31);
      if (Number.isNaN(d.getTime())) errors.push({ field: 'birthDate', message: 'Date de naissance invalide.' });
      else if (d < minBirth || d > maxBirth)
        errors.push({
          field: 'birthDate',
          message: `Date de naissance suspecte (${p.birthDate}).`,
          hint: "Format attendu: DD/MM/YYYY ou YYYY-MM-DD. Âge entre 2 et 30 ans.",
        });
    }

    if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))
      errors.push({ field: 'email', message: 'Email invalide.' });

    // E11-S2 (FR3) — externalRef-first idempotency. A matched externalRef is NO
    // LONGER a hard `invalid` reject: it is carried as a MATCH so apply can
    // classify it unchanged/updated/conflict (a re-run converges, never a
    // duplicate `created`). A no-match / no-externalRef row stays `created`.
    if (p.externalRef) {
      const matched = ctx.caches.studentsByExternalRef.get(p.externalRef);
      if (matched) p._matchedStudentId = matched.id;
    }

    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [], normalized: p as unknown as Record<string, unknown> };
  },

  async applyRow(normalized, ctx: ApplyContext): Promise<AppliedEntity> {
    const p = normalized as unknown as StudentInput;

    // E11-S2 (FR3/FR4) — externalRef MATCH path: classify instead of create.
    if (p._matchedStudentId) {
      const existing = p.externalRef ? ctx.caches.studentsByExternalRef.get(p.externalRef) : undefined;
      // Defensive: the matched snapshot vanished (a concurrent batch removed it) →
      // fall through to create rather than throw a 500.
      if (existing) {
        // Protected-field disagreement → conflict: record the side-by-side diff and
        // write NOTHING (no silent overwrite of a child's identity). FR4.
        const conflicts: ConflictField[] = [];
        const incoming: Record<(typeof PROTECTED_FIELDS)[number], string | null> = {
          firstName: p.firstName ?? null,
          lastName: p.lastName ?? null,
          birthDate: dateKey(p.birthDate),
        };
        const current: Record<(typeof PROTECTED_FIELDS)[number], string | null> = {
          firstName: existing.firstName ?? null,
          lastName: existing.lastName ?? null,
          birthDate: dateKey(existing.birthDate),
        };
        for (const field of PROTECTED_FIELDS) {
          if (incoming[field] !== current[field]) {
            conflicts.push({ field, current: current[field], source: incoming[field] });
          }
        }
        if (conflicts.length > 0) {
          return {
            id: existing.id,
            type: 'student',
            reconciliation: ReconciliationClass.conflict,
            conflictFields: conflicts,
          };
        }

        // Non-protected fields (email/notes) may differ → updated; else unchanged.
        const incomingEmail = p.email ?? null;
        const incomingNotes = p.notes ?? null;
        const emailChanged = incomingEmail !== (existing.email ?? null);
        const notesChanged = incomingNotes !== (existing.notes ?? null);

        if (emailChanged || notesChanged) {
          await ctx.tx.student.update({
            where: { id: existing.id },
            data: {
              ...(emailChanged ? { email: incomingEmail } : {}),
              ...(notesChanged ? { notes: incomingNotes } : {}),
            },
          });
          // Refresh the cached snapshot so a later identical row in the same batch
          // converges to `unchanged`.
          existing.email = incomingEmail;
          existing.notes = incomingNotes;
          return { id: existing.id, type: 'student', reconciliation: ReconciliationClass.updated };
        }

        return { id: existing.id, type: 'student', reconciliation: ReconciliationClass.unchanged };
      }
    }

    // No match → create (byte-identical to the pre-S2 path; reconciliation defaults
    // to `created` in the engine when omitted, but we set it explicitly for clarity).
    const student = await ctx.tx.student.create({
      data: {
        tenantId: ctx.tenantId,
        schoolId: ctx.schoolId,
        firstName: p.firstName,
        lastName: p.lastName,
        birthDate: p.birthDate ? new Date(p.birthDate) : null,
        externalRef: p.externalRef ?? null,
        email: p.email ?? null,
        notes: p.notes ?? null,
      },
    });
    if (p.externalRef) {
      ctx.caches.studentExternalRefs.set(p.externalRef, student.id);
      // Make a subsequent identical row in the SAME batch converge to `unchanged`
      // (within-batch idempotency), not a second `created`.
      ctx.caches.studentsByExternalRef.set(p.externalRef, {
        id: student.id,
        firstName: p.firstName,
        lastName: p.lastName,
        birthDate: p.birthDate ? new Date(p.birthDate) : null,
        email: p.email ?? null,
        notes: p.notes ?? null,
      });
    }
    return { id: student.id, type: 'student', reconciliation: ReconciliationClass.created };
  },

  async rollbackRow(entityId, ctx: RollbackContext): Promise<void> {
    await ctx.tx.student.deleteMany({ where: { id: entityId, tenantId: ctx.tenantId } });
  },
};
