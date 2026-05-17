import { GuardianRelationship } from '@prisma/client';

import {
  type AppliedEntity,
  type ApplyContext,
  type ImportContext,
  type ImportHandler,
  type RollbackContext,
  type ValidationResult,
} from '../handler.types';

interface GuardianInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  profession?: string;
  studentExternalRef: string;
  relationship: GuardianRelationship;
  isPrimaryContact?: boolean;
  canPickup?: boolean;
  hasLegalCustody?: boolean;
  _studentId?: string;
  _existingGuardianId?: string;
}

const RELATIONSHIP_MAP: Record<string, GuardianRelationship> = {
  mother: 'mother',
  mère: 'mother',
  mere: 'mother',
  maman: 'mother',
  father: 'father',
  père: 'father',
  pere: 'father',
  papa: 'father',
  tuteur: 'legal_guardian',
  'tuteur légal': 'legal_guardian',
  'legal guardian': 'legal_guardian',
  'légal': 'legal_guardian',
  grandparent: 'grandparent',
  'grand-parent': 'grandparent',
  grandmère: 'grandparent',
  grandpère: 'grandparent',
  sibling: 'sibling',
  'frère/sœur': 'sibling',
  frère: 'sibling',
  sœur: 'sibling',
  other: 'other',
  autre: 'other',
};

function parseBool(s: string | undefined): boolean | undefined {
  if (!s) return undefined;
  const v = s.trim().toLowerCase();
  if (['true', '1', 'oui', 'yes', 'y', 'o'].includes(v)) return true;
  if (['false', '0', 'non', 'no', 'n'].includes(v)) return false;
  return undefined;
}

export const guardiansHandler: ImportHandler = {
  type: 'parents',
  label: 'Parents',
  description: 'Importer les parents/responsables et les rattacher automatiquement à un élève existant via son matricule.',
  icon: 'HeartHandshake',
  requiredPermission: 'parents.write',
  template: {
    headers: [
      'firstName',
      'lastName',
      'email',
      'phone',
      'profession',
      'studentExternalRef',
      'relationship',
      'isPrimaryContact',
      'canPickup',
      'hasLegalCustody',
    ],
    sample: [
      [
        'Sophie',
        'Martin',
        'sophie.martin@famille.local',
        '0612345678',
        'Médecin',
        'EL-2025-001',
        'mother',
        'true',
        'true',
        'true',
      ],
      [
        'Pierre',
        'Martin',
        'pierre.martin@famille.local',
        '0698765432',
        'Ingénieur',
        'EL-2025-001',
        'father',
        'false',
        'true',
        'true',
      ],
      ['Marie', 'Bernard', 'marie.bernard@famille.local', '', '', 'EL-2025-002', 'mother', 'true', 'true', 'true'],
    ],
    notes: [
      'L\'élève est retrouvé via studentExternalRef (le matricule de l\'élève qui doit déjà exister).',
      'relationship: mother / father / legal_guardian / grandparent / sibling / other (français accepté: mère, père, tuteur…).',
      'Si un parent avec le même email existe déjà, il sera réutilisé et le lien sera créé/réactivé.',
      'isPrimaryContact / canPickup / hasLegalCustody : oui/non, true/false.',
    ],
  },

  parseRow(row) {
    const rel = (row.relationship ?? row.lien ?? '').trim().toLowerCase();
    return {
      firstName: (row.firstname ?? row.prenom ?? '').trim(),
      lastName: (row.lastname ?? row.nom ?? '').trim(),
      email: (row.email ?? '').trim().toLowerCase() || undefined,
      phone: (row.phone ?? row.telephone ?? row.tel ?? '').trim() || undefined,
      profession: (row.profession ?? row.métier ?? row.metier ?? '').trim() || undefined,
      studentExternalRef: (row.studentexternalref ?? row['student external ref'] ?? row.matriculeeleve ?? row['matricule élève'] ?? '').trim(),
      relationship: RELATIONSHIP_MAP[rel] ?? rel,
      isPrimaryContact: parseBool(row.isprimarycontact ?? row['is primary contact'] ?? row.contactprincipal),
      canPickup: parseBool(row.canpickup ?? row['can pickup'] ?? row.peutrecuperer),
      hasLegalCustody: parseBool(row.haslegalcustody ?? row['has legal custody'] ?? row.autoriteparentale),
    };
  },

  validateRow(parsed, ctx: ImportContext): ValidationResult {
    const p = parsed as unknown as GuardianInput;
    const errors: ValidationResult['errors'] = [];

    if (!p.firstName) errors.push({ field: 'firstName', message: 'Prénom requis.' });
    if (!p.lastName) errors.push({ field: 'lastName', message: 'Nom requis.' });
    if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))
      errors.push({ field: 'email', message: 'Email invalide.' });

    if (!p.studentExternalRef) {
      errors.push({ field: 'studentExternalRef', message: 'Matricule de l\'élève requis.' });
    } else {
      const studentId = ctx.caches.studentExternalRefs.get(p.studentExternalRef);
      if (!studentId) {
        errors.push({
          field: 'studentExternalRef',
          message: `Aucun élève trouvé avec le matricule « ${p.studentExternalRef} ».`,
          hint: 'Importez d\'abord les élèves, ou vérifiez l\'orthographe du matricule.',
        });
      } else {
        p._studentId = studentId;
      }
    }

    const validRels: GuardianRelationship[] = [
      'mother',
      'father',
      'legal_guardian',
      'grandparent',
      'sibling',
      'other',
    ];
    if (!p.relationship || !validRels.includes(p.relationship)) {
      errors.push({
        field: 'relationship',
        message: `Lien de parenté invalide (reçu: « ${p.relationship ?? ''} »).`,
        hint: 'Valeurs acceptées : mother / father / legal_guardian / grandparent / sibling / other.',
      });
    }

    // Detect duplicate guardian by email — we'll reuse it during apply
    if (p.email) {
      const existing = ctx.caches.guardiansByEmail.get(p.email);
      if (existing) p._existingGuardianId = existing.id;
    }

    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [], normalized: p as unknown as Record<string, unknown> };
  },

  async applyRow(normalized, ctx: ApplyContext): Promise<AppliedEntity> {
    const p = normalized as unknown as GuardianInput;
    const studentId = p._studentId!;

    let guardianId = p._existingGuardianId ?? null;
    if (!guardianId) {
      const g = await ctx.tx.guardian.create({
        data: {
          tenantId: ctx.tenantId,
          schoolId: ctx.schoolId,
          firstName: p.firstName,
          lastName: p.lastName,
          email: p.email ?? null,
          phone: p.phone ?? null,
          profession: p.profession ?? null,
        },
      });
      guardianId = g.id;
      if (p.email) {
        ctx.caches.guardiansByEmail.set(p.email, { id: g.id, firstName: g.firstName, lastName: g.lastName });
      }
    }

    if (p.isPrimaryContact) {
      await ctx.tx.guardianship.updateMany({
        where: { studentId, isPrimaryContact: true },
        data: { isPrimaryContact: false },
      });
    }

    // Create or re-activate the guardianship — using upsert via the composite unique
    const link = await ctx.tx.guardianship.upsert({
      where: { guardianId_studentId: { guardianId, studentId } },
      create: {
        tenantId: ctx.tenantId,
        guardianId,
        studentId,
        relationship: p.relationship,
        isPrimaryContact: p.isPrimaryContact ?? false,
        canPickup: p.canPickup ?? true,
        hasLegalCustody: p.hasLegalCustody ?? true,
        status: 'active',
      },
      update: {
        relationship: p.relationship,
        isPrimaryContact: p.isPrimaryContact ?? false,
        canPickup: p.canPickup ?? true,
        hasLegalCustody: p.hasLegalCustody ?? true,
        status: 'active',
        revokedAt: null,
      },
    });
    // Track that this row created the guardianship (so rollback removes the link, not the parent).
    return { id: link.id, type: 'guardianship' };
  },

  async rollbackRow(entityId, ctx: RollbackContext): Promise<void> {
    // Soft-rollback: revoke the link rather than delete (keep audit trail).
    await ctx.tx.guardianship.updateMany({
      where: { id: entityId, tenantId: ctx.tenantId },
      data: { status: 'revoked', revokedAt: new Date() },
    });
  },
};
