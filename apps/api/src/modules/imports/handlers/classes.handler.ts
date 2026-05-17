import { type AppliedEntity, type ApplyContext, type ImportContext, type ImportHandler, type RollbackContext, type ValidationResult } from '../handler.types';

interface ClassInput {
  name: string;
  gradeLevelCodeOrName: string;
  maxStudents: number;
  // resolved during validation:
  _gradeLevelId?: string;
  _academicYearId?: string;
}

export const classesHandler: ImportHandler = {
  type: 'classes',
  label: 'Classes',
  description: 'Créer plusieurs classes (sections) pour l\'année scolaire active.',
  icon: 'GraduationCap',
  requiredPermission: 'classes.write',
  template: {
    headers: ['name', 'gradeLevel', 'maxStudents'],
    sample: [
      ['6eC', '6ème', '28'],
      ['6eD', '6e', '28'],
      ['5eB', '5ème', '30'],
      ['2ndeB', 'Seconde', '32'],
    ],
    notes: [
      'Le nom doit être unique par niveau dans l\'année active (ex. 6eA, 6eB, 6eC…).',
      'Le niveau accepte soit le nom (« 6ème »), soit le code (« 6e »).',
      'maxStudents est optionnel (défaut: 30).',
    ],
  },

  parseRow(row) {
    return {
      name: (row.name ?? '').trim(),
      gradeLevelCodeOrName: (row.gradelevel ?? row['grade level'] ?? row.niveau ?? '').trim(),
      maxStudents: row.maxstudents || row['max students'] || row.capacite ? Number(row.maxstudents ?? row['max students'] ?? row.capacite) : 30,
    };
  },

  validateRow(parsed, ctx: ImportContext): ValidationResult {
    const p = parsed as unknown as ClassInput;
    const errors: ValidationResult['errors'] = [];

    if (!p.name || p.name.length < 1 || p.name.length > 40)
      errors.push({ field: 'name', message: 'Nom de classe requis (1 à 40 caractères)' });
    if (!p.gradeLevelCodeOrName)
      errors.push({ field: 'gradeLevel', message: 'Niveau requis' });
    if (!Number.isFinite(p.maxStudents) || p.maxStudents < 1 || p.maxStudents > 200)
      errors.push({ field: 'maxStudents', message: 'Capacité invalide (1-200)' });

    if (!ctx.caches.activeAcademicYearId) {
      errors.push({
        message: 'Aucune année scolaire active.',
        hint: "Activez une année dans Admin → Années scolaires avant d'importer des classes.",
      });
    }

    const level =
      ctx.caches.gradeLevelsByCode.get(p.gradeLevelCodeOrName.toLowerCase()) ??
      ctx.caches.gradeLevelsByName.get(p.gradeLevelCodeOrName.toLowerCase());
    if (p.gradeLevelCodeOrName && !level) {
      errors.push({
        field: 'gradeLevel',
        message: `Niveau « ${p.gradeLevelCodeOrName} » introuvable.`,
        hint: 'Vérifiez l\'orthographe ou créez le niveau avant l\'import.',
      });
    }

    if (level && ctx.caches.activeAcademicYearId) {
      const key = `${ctx.caches.activeAcademicYearId}:${level.id}:${p.name.toLowerCase()}`;
      if (ctx.caches.classNamesPerYearLevel.has(key)) {
        errors.push({
          field: 'name',
          message: `La classe « ${p.name} » existe déjà pour ce niveau cette année.`,
        });
      }
    }

    if (errors.length) return { ok: false, errors };
    return {
      ok: true,
      errors: [],
      normalized: { ...p, _gradeLevelId: level!.id, _academicYearId: ctx.caches.activeAcademicYearId! } as unknown as Record<string, unknown>,
    };
  },

  async applyRow(normalized, ctx: ApplyContext): Promise<AppliedEntity> {
    const p = normalized as unknown as ClassInput;
    const cls = await ctx.tx.classSection.create({
      data: {
        tenantId: ctx.tenantId,
        academicYearId: p._academicYearId!,
        gradeLevelId: p._gradeLevelId!,
        name: p.name,
        maxStudents: p.maxStudents,
      },
    });
    ctx.caches.classNamesPerYearLevel.add(
      `${p._academicYearId}:${p._gradeLevelId}:${p.name.toLowerCase()}`,
    );
    return { id: cls.id, type: 'class_section' };
  },

  async rollbackRow(entityId, ctx: RollbackContext): Promise<void> {
    await ctx.tx.classSection.deleteMany({ where: { id: entityId, tenantId: ctx.tenantId } });
  },
};
