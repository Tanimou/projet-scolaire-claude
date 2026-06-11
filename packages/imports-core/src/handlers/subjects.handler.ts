import { type AppliedEntity, type ApplyContext, type ImportContext, type ImportHandler, type RollbackContext, type ValidationResult } from '../handler.types';

interface SubjectInput {
  code: string;
  name: string;
  defaultCoefficient: number;
  color?: string;
  icon?: string;
}

export const subjectsHandler: ImportHandler = {
  type: 'subjects',
  label: 'Matières',
  description: 'Créer plusieurs matières en une fois (code, nom, coefficient par défaut, couleur).',
  icon: 'BookOpen',
  requiredPermission: 'subjects.write',
  template: {
    headers: ['code', 'name', 'defaultCoefficient', 'color', 'icon'],
    sample: [
      ['ESP', 'Espagnol', '2', 'oklch(0.65 0.18 30)', 'Languages'],
      ['ALL', 'Allemand', '2', 'oklch(0.62 0.14 80)', 'Languages'],
      ['MUSIQUE', 'Musique', '1', 'oklch(0.7 0.16 320)', 'Music'],
    ],
    notes: [
      'Le code est en MAJUSCULES (lettres, chiffres, _ ou -).',
      'Le coefficient par défaut est un nombre entre 0.5 et 20.',
    ],
  },

  parseRow(row) {
    return {
      code: (row.code ?? '').trim().toUpperCase(),
      name: (row.name ?? '').trim(),
      defaultCoefficient: Number(row.defaultcoefficient ?? row['default coefficient'] ?? row.coefficient ?? 1),
      color: row.color?.trim() || undefined,
      icon: row.icon?.trim() || undefined,
    };
  },

  validateRow(parsed, ctx: ImportContext): ValidationResult {
    const p = parsed as unknown as SubjectInput;
    const errors: ValidationResult['errors'] = [];

    if (!p.code || !/^[A-Z0-9_-]{2,40}$/.test(p.code))
      errors.push({ field: 'code', message: 'Code requis (2-40 caractères majuscules, chiffres, _ ou -)' });
    if (!p.name || p.name.length < 2)
      errors.push({ field: 'name', message: 'Nom requis (≥ 2 caractères)' });
    if (Number.isNaN(p.defaultCoefficient) || p.defaultCoefficient < 0.5 || p.defaultCoefficient > 20)
      errors.push({ field: 'defaultCoefficient', message: 'Coefficient invalide (0.5 à 20)' });

    if (p.code && ctx.caches.subjectsByCode.has(p.code))
      errors.push({ field: 'code', message: `Le code « ${p.code} » existe déjà ou est dupliqué dans ce fichier.` });

    if (errors.length) return { ok: false, errors };
    return { ok: true, errors: [], normalized: p as unknown as Record<string, unknown> };
  },

  async applyRow(normalized, ctx: ApplyContext): Promise<AppliedEntity> {
    const p = normalized as unknown as SubjectInput;
    const subject = await ctx.tx.subject.create({
      data: {
        tenantId: ctx.tenantId,
        schoolId: ctx.schoolId,
        code: p.code,
        name: p.name,
        defaultCoefficient: p.defaultCoefficient,
        color: p.color ?? null,
        icon: p.icon ?? null,
        active: true,
      },
    });
    // Auto-create coefficients for all existing grade levels
    const levels = await ctx.tx.gradeLevel.findMany({ where: { schoolId: ctx.schoolId } });
    for (const lvl of levels) {
      await ctx.tx.subjectCoefficient.create({
        data: {
          tenantId: ctx.tenantId,
          gradeLevelId: lvl.id,
          subjectId: subject.id,
          coefficient: subject.defaultCoefficient,
        },
      });
    }
    ctx.caches.subjectsByCode.set(p.code, { id: subject.id, name: subject.name });
    return { id: subject.id, type: 'subject' };
  },

  async rollbackRow(entityId, ctx: RollbackContext): Promise<void> {
    // Cascading delete via Prisma will remove the SubjectCoefficient rows
    await ctx.tx.subject.deleteMany({ where: { id: entityId, tenantId: ctx.tenantId } });
  },
};
