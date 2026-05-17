import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient, Portal } from '@prisma/client';

loadEnv({ path: resolve(__dirname, '..', '.env') });

const prisma = new PrismaClient();

// Catalog — keep aligned with apps/api/src/shared/auth/permissions.constants.ts
const PERMISSIONS: Array<[code: string, label: string, resourceType: string, action: string]> = [
  ['schools.read', 'Lire écoles', 'school', 'read'],
  ['schools.write', 'Modifier écoles', 'school', 'write'],
  ['academic_years.read', 'Lire années scolaires', 'academic_year', 'read'],
  ['academic_years.write', 'Modifier années scolaires', 'academic_year', 'write'],
  ['terms.write', 'Modifier périodes', 'term', 'write'],
  ['cycles.write', 'Modifier cycles', 'cycle', 'write'],
  ['grade_levels.write', 'Modifier niveaux', 'grade_level', 'write'],
  ['classes.read', 'Lire classes', 'class', 'read'],
  ['classes.write', 'Modifier classes', 'class', 'write'],
  ['classes.delete', 'Supprimer classes', 'class', 'delete'],
  ['subjects.read', 'Lire matières', 'subject', 'read'],
  ['subjects.write', 'Modifier matières', 'subject', 'write'],
  ['teachers.read', 'Lire professeurs', 'teacher', 'read'],
  ['teachers.write', 'Modifier professeurs', 'teacher', 'write'],
  ['students.read', 'Lire élèves', 'student', 'read'],
  ['students.write', 'Modifier élèves', 'student', 'write'],
  ['parents.read', 'Lire parents', 'parent', 'read'],
  ['parents.write', 'Modifier parents', 'parent', 'write'],
  ['users.read', 'Lire utilisateurs', 'user', 'read'],
  ['users.write', 'Modifier utilisateurs', 'user', 'write'],
  ['users.suspend', 'Suspendre utilisateurs', 'user', 'suspend'],
  ['enrollments.read', 'Lire inscriptions', 'enrollment', 'read'],
  ['enrollments.write', 'Modifier inscriptions', 'enrollment', 'write'],
  ['enrollments.approve', 'Valider inscriptions', 'enrollment', 'approve'],
  ['guardianships.approve', 'Valider rattachements parents', 'guardianship', 'approve'],
  ['teaching_assignments.write', 'Affecter professeurs', 'teaching_assignment', 'write'],
  ['assessments.read', 'Lire évaluations', 'assessment', 'read'],
  ['assessments.write', 'Créer évaluations', 'assessment', 'write'],
  ['grades.read', 'Lire notes', 'grade', 'read'],
  ['grades.write', 'Saisir notes', 'grade', 'write'],
  ['grades.publish', 'Publier notes', 'grade', 'publish'],
  ['grades.revise', 'Réviser notes publiées', 'grade', 'revise'],
  ['attendance.read', 'Lire présences', 'attendance', 'read'],
  ['attendance.write', 'Saisir présences', 'attendance', 'write'],
  ['lessons.read', 'Lire cahier de texte', 'lesson', 'read'],
  ['lessons.write', 'Saisir cahier de texte', 'lesson', 'write'],
  ['discipline.read', 'Lire dossiers disciplinaires', 'discipline', 'read'],
  ['discipline.write', 'Créer dossiers disciplinaires', 'discipline', 'write'],
  ['announcements.read', 'Lire annonces', 'announcement', 'read'],
  ['announcements.write', 'Diffuser annonces', 'announcement', 'write'],
  ['branding.read', 'Lire branding', 'branding', 'read'],
  ['branding.write', 'Modifier branding', 'branding', 'write'],
  ['school_settings.write', 'Modifier paramètres école', 'school_settings', 'write'],
  ['alert_rules.write', "Gérer règles d'alerte", 'alert_rule', 'write'],
  ['custom_fields.write', 'Gérer custom fields', 'custom_field', 'write'],
  ['custom_forms.write', 'Gérer custom forms', 'custom_form', 'write'],
  ['notification_templates.write', 'Gérer templates notifications', 'notification_template', 'write'],
  ['report_templates.write', 'Gérer templates rapports', 'report_template', 'write'],
  ['roles.read', 'Lire rôles', 'role', 'read'],
  ['roles.write', 'Créer/modifier rôles', 'role', 'write'],
  ['roles.assign', 'Assigner rôles', 'role', 'assign'],
  ['audit.read', 'Consulter audit', 'audit', 'read'],
  ['imports.execute', 'Exécuter bulk imports', 'import', 'execute'],
  ['exports.execute', 'Générer exports', 'export', 'execute'],
  ['integrations.write', 'Gérer intégrations', 'integration', 'write'],
  ['profile.read.self', 'Lire son profil', 'profile', 'read.self'],
  ['profile.write.self', 'Modifier son profil', 'profile', 'write.self'],
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  school_admin: [
    'schools.read', 'schools.write',
    'academic_years.read', 'academic_years.write', 'terms.write',
    'cycles.write', 'grade_levels.write',
    'classes.read', 'classes.write', 'classes.delete',
    'subjects.read', 'subjects.write',
    'teachers.read', 'teachers.write',
    'students.read', 'students.write',
    'parents.read', 'parents.write',
    'users.read', 'users.write', 'users.suspend',
    'enrollments.read', 'enrollments.write', 'enrollments.approve', 'guardianships.approve',
    'teaching_assignments.write',
    'assessments.read', 'assessments.write',
    'grades.read', 'grades.publish',
    'attendance.read',
    'lessons.read',
    'discipline.read', 'discipline.write',
    'announcements.read', 'announcements.write',
    'branding.read', 'branding.write', 'school_settings.write',
    'alert_rules.write', 'custom_fields.write', 'custom_forms.write',
    'notification_templates.write', 'report_templates.write',
    'roles.read', 'roles.write', 'roles.assign',
    'audit.read', 'imports.execute', 'exports.execute', 'integrations.write',
    'profile.read.self', 'profile.write.self',
  ],
  teacher: [
    'classes.read', 'subjects.read', 'students.read',
    'assessments.read', 'assessments.write',
    'grades.read', 'grades.write', 'grades.publish', 'grades.revise',
    'attendance.read', 'attendance.write',
    'lessons.read', 'lessons.write',
    'discipline.read', 'discipline.write',
    'announcements.read', 'announcements.write',
    'branding.read',
    'profile.read.self', 'profile.write.self',
  ],
  parent: [
    'students.read', 'grades.read', 'attendance.read',
    'lessons.read', 'discipline.read', 'announcements.read',
    'branding.read',
    'profile.read.self', 'profile.write.self',
  ],
};

async function main() {
  console.info('🌱 Seeding initial data…');

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { name: 'Demo Tenant', slug: 'demo' },
  });

  const school = await prisma.school.upsert({
    where: { schoolCode: 'VOLTAIRE' },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Lycée Voltaire',
      schoolCode: 'VOLTAIRE',
      country: 'FR',
      timezone: 'Europe/Paris',
      locale: 'fr-FR',
    },
  });

  await prisma.branding.upsert({
    where: { schoolId: school.id },
    update: {},
    create: {
      schoolId: school.id,
      displayName: 'Lycée Voltaire',
      primaryColor: 'oklch(0.62 0.18 250)',
    },
  });

  for (const [code, label, resourceType, action] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: { label, resourceType, action },
      create: { code, label, resourceType, action },
    });
  }

  const systemRoles = [
    { slug: 'school_admin', name: 'Administrateur établissement', portal: Portal.admin },
    { slug: 'teacher', name: 'Professeur', portal: Portal.teacher },
    { slug: 'parent', name: 'Parent', portal: Portal.parent },
  ];

  for (const r of systemRoles) {
    const existing = await prisma.role.findFirst({
      where: { slug: r.slug, schoolId: null, isSystem: true },
    });
    const role = existing
      ? await prisma.role.update({
          where: { id: existing.id },
          data: { name: r.name, portal: r.portal, isSystem: true },
        })
      : await prisma.role.create({
          data: { slug: r.slug, name: r.name, portal: r.portal, isSystem: true },
        });

    const codes = ROLE_PERMISSIONS[r.slug] ?? [];
    const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const p of perms) {
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: p.id } });
    }
    console.info(`  Role ${r.slug} → ${perms.length} permissions`);
  }

  // -------------------------------------------------------------------------
  // School structure — academic year, terms, cycles, grade levels, subjects, classes
  // -------------------------------------------------------------------------
  const t = tenant.id;
  const s = school.id;

  // Academic year + terms (2025-2026 with 3 trimesters)
  const ay = await prisma.academicYear.upsert({
    where: { schoolId_name: { schoolId: s, name: '2025-2026' } },
    update: {},
    create: {
      tenantId: t,
      schoolId: s,
      name: '2025-2026',
      startDate: new Date('2025-09-01'),
      endDate: new Date('2026-07-05'),
      status: 'active',
    },
  });

  const TERMS = [
    { name: 'Trimestre 1', orderIndex: 1, startDate: '2025-09-01', endDate: '2025-12-19' },
    { name: 'Trimestre 2', orderIndex: 2, startDate: '2026-01-05', endDate: '2026-04-03' },
    { name: 'Trimestre 3', orderIndex: 3, startDate: '2026-04-20', endDate: '2026-07-05' },
  ];
  for (const term of TERMS) {
    await prisma.term.upsert({
      where: { academicYearId_orderIndex: { academicYearId: ay.id, orderIndex: term.orderIndex } },
      update: { name: term.name, startDate: new Date(term.startDate), endDate: new Date(term.endDate) },
      create: {
        tenantId: t,
        academicYearId: ay.id,
        name: term.name,
        orderIndex: term.orderIndex,
        startDate: new Date(term.startDate),
        endDate: new Date(term.endDate),
      },
    });
  }

  // Cycles
  const CYCLES = [
    { code: 'college', name: 'Collège', orderIndex: 1, color: 'oklch(0.7 0.14 200)', icon: 'BookOpen' },
    { code: 'lycee', name: 'Lycée', orderIndex: 2, color: 'oklch(0.65 0.18 280)', icon: 'GraduationCap' },
  ];
  const cycles: Record<string, { id: string }> = {};
  for (const c of CYCLES) {
    const cycle = await prisma.cycle.upsert({
      where: { schoolId_code: { schoolId: s, code: c.code } },
      update: { name: c.name, orderIndex: c.orderIndex, color: c.color, icon: c.icon },
      create: { tenantId: t, schoolId: s, ...c },
    });
    cycles[c.code] = { id: cycle.id };
  }

  // Grade levels
  const GRADE_LEVELS = [
    { cycle: 'college', code: '6e', name: '6ème', orderIndex: 1 },
    { cycle: 'college', code: '5e', name: '5ème', orderIndex: 2 },
    { cycle: 'college', code: '4e', name: '4ème', orderIndex: 3 },
    { cycle: 'college', code: '3e', name: '3ème', orderIndex: 4 },
    { cycle: 'lycee', code: '2nde', name: 'Seconde', orderIndex: 5 },
    { cycle: 'lycee', code: '1ere', name: 'Première', orderIndex: 6 },
    { cycle: 'lycee', code: 'terminale', name: 'Terminale', orderIndex: 7 },
  ];
  const levels: Record<string, { id: string }> = {};
  for (const g of GRADE_LEVELS) {
    const level = await prisma.gradeLevel.upsert({
      where: { schoolId_code: { schoolId: s, code: g.code } },
      update: { name: g.name, orderIndex: g.orderIndex, cycleId: cycles[g.cycle]!.id },
      create: {
        tenantId: t,
        schoolId: s,
        cycleId: cycles[g.cycle]!.id,
        code: g.code,
        name: g.name,
        orderIndex: g.orderIndex,
      },
    });
    levels[g.code] = { id: level.id };
  }

  // Subjects
  const SUBJECTS = [
    { code: 'MATHS', name: 'Mathématiques', defaultCoef: 4, color: 'oklch(0.65 0.18 250)', icon: 'Sigma' },
    { code: 'FR', name: 'Français', defaultCoef: 4, color: 'oklch(0.65 0.16 25)', icon: 'BookOpen' },
    { code: 'HG', name: 'Histoire-Géographie', defaultCoef: 3, color: 'oklch(0.68 0.14 70)', icon: 'Globe2' },
    { code: 'EN', name: 'Anglais', defaultCoef: 3, color: 'oklch(0.65 0.13 220)', icon: 'Languages' },
    { code: 'SVT', name: 'Sciences de la Vie et de la Terre', defaultCoef: 2, color: 'oklch(0.7 0.17 150)', icon: 'Leaf' },
    { code: 'PC', name: 'Physique-Chimie', defaultCoef: 3, color: 'oklch(0.65 0.18 310)', icon: 'Atom' },
    { code: 'EPS', name: 'Éducation Physique et Sportive', defaultCoef: 1, color: 'oklch(0.7 0.14 130)', icon: 'Dumbbell' },
    { code: 'ART', name: 'Arts Plastiques', defaultCoef: 1, color: 'oklch(0.68 0.18 340)', icon: 'Palette' },
  ];
  const subjects: Record<string, { id: string; defaultCoefficient: number }> = {};
  for (const sub of SUBJECTS) {
    const subject = await prisma.subject.upsert({
      where: { schoolId_code: { schoolId: s, code: sub.code } },
      update: {
        name: sub.name,
        defaultCoefficient: sub.defaultCoef,
        color: sub.color,
        icon: sub.icon,
      },
      create: {
        tenantId: t,
        schoolId: s,
        code: sub.code,
        name: sub.name,
        defaultCoefficient: sub.defaultCoef,
        color: sub.color,
        icon: sub.icon,
        active: true,
      },
    });
    subjects[sub.code] = { id: subject.id, defaultCoefficient: sub.defaultCoef };
  }

  // Subject coefficients per grade level — defaults from subject, but
  // bump Maths/Français/PC at 1ère/Terminale (typical French baccalauréat pattern).
  const COEF_OVERRIDES: Record<string, Record<string, number>> = {
    '1ere': { MATHS: 6, FR: 5, PC: 5 },
    terminale: { MATHS: 7, FR: 5, PC: 6, HG: 3 },
  };
  for (const g of GRADE_LEVELS) {
    for (const sub of SUBJECTS) {
      const override = COEF_OVERRIDES[g.code]?.[sub.code];
      const coef = override ?? sub.defaultCoef;
      await prisma.subjectCoefficient.upsert({
        where: {
          gradeLevelId_subjectId: { gradeLevelId: levels[g.code]!.id, subjectId: subjects[sub.code]!.id },
        },
        update: { coefficient: coef },
        create: {
          tenantId: t,
          gradeLevelId: levels[g.code]!.id,
          subjectId: subjects[sub.code]!.id,
          coefficient: coef,
        },
      });
    }
  }

  // Class sections — a few classes for the active year
  const CLASS_SECTIONS = [
    { gradeLevel: '6e', name: '6eA', maxStudents: 28 },
    { gradeLevel: '6e', name: '6eB', maxStudents: 28 },
    { gradeLevel: '5e', name: '5eA', maxStudents: 30 },
    { gradeLevel: '2nde', name: '2ndeA', maxStudents: 32 },
    { gradeLevel: 'terminale', name: 'TermS', maxStudents: 24 },
  ];
  for (const c of CLASS_SECTIONS) {
    await prisma.classSection.upsert({
      where: {
        academicYearId_gradeLevelId_name: {
          academicYearId: ay.id,
          gradeLevelId: levels[c.gradeLevel]!.id,
          name: c.name,
        },
      },
      update: { maxStudents: c.maxStudents },
      create: {
        tenantId: t,
        academicYearId: ay.id,
        gradeLevelId: levels[c.gradeLevel]!.id,
        name: c.name,
        maxStudents: c.maxStudents,
      },
    });
  }

  console.info('✓ Seed complete');
  console.info(`  Tenant ${tenant.slug} → School ${school.schoolCode} (id=${school.id})`);
  console.info(
    `  Year ${ay.name} · ${TERMS.length} terms · ${Object.keys(cycles).length} cycles · ${Object.keys(levels).length} levels · ${SUBJECTS.length} subjects · ${CLASS_SECTIONS.length} classes`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
