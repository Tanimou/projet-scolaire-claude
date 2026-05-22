/* eslint-disable no-console */
/**
 * Seed démo — Pilotage scolaire (admin dashboard production-quality).
 *
 * **Goal**: populate the DB with the exact data shown in the admin dashboard
 * target screenshot (cf. docs/spec/ADMIN-DASHBOARD-PRODUCTION.md):
 *   - 5 KPI values: 2 458 élèves · 186 profs · 94 classes · 28 demandes en attente · 16 alertes
 *   - Structure: 3 années · 44 niveaux (12 primaire + 18 collège + 14 lycée) · 8 matières
 *   - Demandes table: 5 named pending guardianships (Sophie Martin, Karim Belkacem, …)
 *   - Affectations table: 5 named teaching assignments (M. Laurent, Mme Bernard, …)
 *   - Performance donut: 76% global / 82% primaire / 74% collège / 69% lycée
 *   - Audit timeline: 4 named entries (Mme Dupont, M. Lefebvre, …)
 *   - Exports récents: 3 named ExportJob rows
 *
 * **Safety**: refuses to run in production (NODE_ENV=production).
 * **Idempotency**: clears existing demo records under tenant slug `voltaire-demo`
 * before reseeding. Production tenants are untouched.
 *
 * Run with:
 *   pnpm prisma:seed:demo
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import {
  AssessmentKind,
  CalendarEventScope,
  CalendarEventType,
  CalendarEventVisibility,
  ExportKind,
  ExportStatus,
  GradeStatus,
  GuardianRelationship,
  GuardianshipStatus,
  Portal,
  PrismaClient,
  StudentStatus,
} from '@prisma/client';

loadEnv({ path: resolve(__dirname, '..', '.env') });

if (process.env.NODE_ENV === 'production') {
  // eslint-disable-next-line no-console
  console.error('seed-demo is FORBIDDEN in production. Aborting.');
  process.exit(1);
}

const prisma = new PrismaClient();

// =============================================================================
// FRENCH NAME POOL — used to generate realistic teacher/guardian/student names
// =============================================================================
const FIRST_NAMES_M = [
  'Pierre', 'Antoine', 'Mathieu', 'Lucas', 'Hugo', 'Thomas', 'Nicolas', 'Alexandre',
  'Jean', 'Paul', 'Julien', 'Sébastien', 'Vincent', 'Mehdi', 'Karim', 'Yanis',
  'Adam', 'Léo', 'Nathan', 'Gabriel', 'Maxime', 'Théo', 'Raphaël', 'Louis',
  'Arthur', 'Jules', 'Tom', 'Enzo', 'Mathis', 'Ethan', 'Baptiste', 'Romain',
  'Quentin', 'Florian', 'Damien', 'Olivier', 'Bruno', 'Stéphane', 'Christophe',
  'Pascal', 'Philippe', 'Patrick', 'Frédéric', 'Daniel', 'Bernard', 'Marc',
  'Yvan', 'Cédric', 'Mickaël', 'Laurent', 'Eric', 'Didier', 'Gilles', 'Hervé',
];

const FIRST_NAMES_F = [
  'Marie', 'Sophie', 'Camille', 'Léa', 'Manon', 'Sarah', 'Emma', 'Chloé',
  'Inès', 'Louise', 'Jade', 'Mila', 'Alice', 'Anna', 'Aïssatou', 'Aminata',
  'Fatou', 'Nadia', 'Salima', 'Lina', 'Yasmine', 'Mariam', 'Aïcha', 'Sabrina',
  'Élise', 'Élodie', 'Élsa', 'Élise', 'Clara', 'Romane', 'Maéva', 'Léna',
  'Lucie', 'Pauline', 'Mathilde', 'Margaux', 'Marion', 'Aurélie', 'Stéphanie',
  'Caroline', 'Sandrine', 'Valérie', 'Isabelle', 'Céline', 'Nathalie', 'Florence',
  'Catherine', 'Christine', 'Brigitte', 'Patricia', 'Sylvie', 'Jeanne', 'Hélène',
];

const LAST_NAMES = [
  'Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand',
  'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David',
  'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Lefèvre',
  'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand',
  'Garnier', 'Faure', 'Rousseau', 'Blanc', 'Guérin', 'Muller', 'Henry', 'Roussel',
  'Nicolas', 'Perrin', 'Morin', 'Mathieu', 'Clément', 'Gauthier', 'Dumont',
  'Lopez', 'Fontaine', 'Chevalier', 'Robin', 'Masson', 'Sanchez', 'Gérard',
  'Nguyen', 'Boyer', 'Denis', 'Lemaire', 'Duval', 'Joly', 'Gautier', 'Roger',
  'Roche', 'Roy', 'Noël', 'Meyer', 'Lucas', 'Meunier', 'Jean', 'Brun', 'Blanchard',
  'Giraud', 'Picard', 'Rolland', 'Berger', 'Bourgeois', 'Renard', 'Renaud',
  'Caron', 'Aubert', 'Schmitt', 'Leclerc', 'Diallo', 'Belkacem', 'Bouchard',
  'Charpentier', 'Dupuy', 'Marchand', 'Lebrun', 'Barbier', 'Brunet', 'Hubert',
  'Carpentier', 'Olivier', 'Pierre', 'Marin', 'Schneider', 'Lacroix', 'Hervé',
];

function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}
const random = rng(20240508); // deterministic seed for reproducible demo

function pick<T>(arr: T[]): T {
  return arr[Math.floor(random() * arr.length)]!;
}

function pickName(gender?: 'M' | 'F'): { firstName: string; lastName: string; gender: 'M' | 'F' } {
  const g = gender ?? (random() > 0.5 ? 'M' : 'F');
  return {
    firstName: g === 'M' ? pick(FIRST_NAMES_M) : pick(FIRST_NAMES_F),
    lastName: pick(LAST_NAMES),
    gender: g,
  };
}

/** Returns a random Date between start (inclusive) and end (exclusive). */
function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + random() * (end.getTime() - start.getTime()));
}

// =============================================================================
// TARGETS — exact numbers from the dashboard screenshot
// =============================================================================
const TARGET_STUDENTS = 2458;
const TARGET_TEACHERS = 186;
const TARGET_CLASSES = 94;
const TARGET_PENDING_GUARDIANSHIPS = 28;

// =============================================================================
// PERMISSION CATALOG — must match permissions.constants.ts
// (Kept inline so seed-demo is self-sufficient. New permissions get upserted.)
// =============================================================================
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
  ['students.delete', 'Supprimer élèves', 'student', 'delete'],
  ['parents.read', 'Lire parents', 'parent', 'read'],
  ['parents.write', 'Modifier parents', 'parent', 'write'],
  ['parents.delete', 'Supprimer parents', 'parent', 'delete'],
  ['users.read', 'Lire utilisateurs', 'user', 'read'],
  ['users.write', 'Modifier utilisateurs', 'user', 'write'],
  ['users.suspend', 'Suspendre utilisateurs', 'user', 'suspend'],
  ['enrollments.read', 'Lire inscriptions', 'enrollment', 'read'],
  ['enrollments.write', 'Modifier inscriptions', 'enrollment', 'write'],
  ['enrollments.approve', 'Valider inscriptions', 'enrollment', 'approve'],
  ['enrollments.delete', 'Annuler inscriptions', 'enrollment', 'delete'],
  ['guardianships.read', 'Lire rattachements parents', 'guardianship', 'read'],
  ['guardianships.write', 'Créer rattachements parents', 'guardianship', 'write'],
  ['guardianships.approve', 'Valider rattachements parents', 'guardianship', 'approve'],
  ['calendar.read', 'Lire calendrier', 'calendar', 'read'],
  ['calendar.write', 'Gérer calendrier', 'calendar', 'write'],
  ['teaching_assignments.read', 'Lire affectations profs', 'teaching_assignment', 'read'],
  ['teaching_assignments.write', 'Affecter professeurs', 'teaching_assignment', 'write'],
  ['teaching_assignments.delete', 'Retirer affectations profs', 'teaching_assignment', 'delete'],
  ['assessments.read', 'Lire évaluations', 'assessment', 'read'],
  ['assessments.write', 'Créer évaluations', 'assessment', 'write'],
  ['assessments.delete', 'Supprimer évaluations', 'assessment', 'delete'],
  ['grades.read', 'Lire notes', 'grade', 'read'],
  ['grades.write', 'Saisir notes', 'grade', 'write'],
  ['grades.publish', 'Publier notes', 'grade', 'publish'],
  ['grades.revise', 'Réviser notes publiées', 'grade', 'revise'],
  ['class_sessions.read', 'Lire séances', 'class_session', 'read'],
  ['class_sessions.write', 'Créer/modifier séances', 'class_session', 'write'],
  ['attendance.read', 'Lire présences', 'attendance', 'read'],
  ['attendance.write', 'Saisir présences', 'attendance', 'write'],
  ['attendance.justify', 'Justifier absences', 'attendance', 'justify'],
  ['lessons.read', 'Lire cahier de texte', 'lesson', 'read'],
  ['lessons.write', 'Saisir cahier de texte', 'lesson', 'write'],
  ['lessons.delete', 'Supprimer entrées cahier de texte', 'lesson', 'delete'],
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

// =============================================================================
// MAIN
// =============================================================================
async function main() {
  console.info('🌱 Pilotage scolaire — Seed démo (admin dashboard production)');
  console.info('   Tenant cible : voltaire-demo');
  console.info('');

  // ───────────────────────────────────────────────────────────────────────
  // STEP 0 — Permissions catalog (idempotent)
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Permissions catalog…');
  for (const [code, label, resourceType, action] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: { label, resourceType, action },
      create: { code, label, resourceType, action },
    });
  }

  // System roles (school_admin / teacher / parent) — idempotent
  const systemRoles = [
    { slug: 'school_admin', name: 'Administrateur établissement', portal: Portal.admin },
    { slug: 'teacher', name: 'Professeur', portal: Portal.teacher },
    { slug: 'parent', name: 'Parent', portal: Portal.parent },
  ];
  for (const r of systemRoles) {
    const existing = await prisma.role.findFirst({
      where: { slug: r.slug, schoolId: null, isSystem: true },
    });
    if (!existing) {
      await prisma.role.create({
        data: { slug: r.slug, name: r.name, portal: r.portal, isSystem: true },
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // STEP 1 — Tenant + École "Lycée Voltaire" (demo namespace)
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Tenant + École…');
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'voltaire-demo' },
    update: { name: 'Lycée Voltaire (Démo)' },
    create: { slug: 'voltaire-demo', name: 'Lycée Voltaire (Démo)' },
  });

  const school = await prisma.school.upsert({
    where: { schoolCode: 'VOLTAIRE-DEMO' },
    update: { name: 'Lycée Voltaire', status: 'active' },
    create: {
      tenantId: tenant.id,
      name: 'Lycée Voltaire',
      schoolCode: 'VOLTAIRE-DEMO',
      country: 'FR',
      timezone: 'Europe/Paris',
      locale: 'fr-FR',
    },
  });

  await prisma.branding.upsert({
    where: { schoolId: school.id },
    update: { displayName: 'Lycée Voltaire', primaryColor: 'oklch(0.55 0.20 260)' },
    create: {
      schoolId: school.id,
      displayName: 'Lycée Voltaire',
      primaryColor: 'oklch(0.55 0.20 260)',
    },
  });

  const T = tenant.id;
  const S = school.id;

  // ───────────────────────────────────────────────────────────────────────
  // STEP 2 — IDEMPOTENCY: wipe demo data (scoped to tenant) before reseeding
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Reset du contenu démo existant (scoped tenant)…');
  // Order matters — children first, parents last
  await prisma.exportJob.deleteMany({ where: { tenantId: T } });
  await prisma.auditLog.deleteMany({ where: { tenantId: T } });
  await prisma.calendarEvent.deleteMany({ where: { tenantId: T } });
  await prisma.gradeRevision.deleteMany({});
  await prisma.grade.deleteMany({ where: { tenantId: T } });
  await prisma.assessment.deleteMany({ where: { tenantId: T } });
  await prisma.teachingAssignment.deleteMany({ where: { tenantId: T } });
  await prisma.enrollment.deleteMany({ where: { tenantId: T } });
  await prisma.guardianship.deleteMany({ where: { tenantId: T } });
  await prisma.student.deleteMany({ where: { tenantId: T } });
  await prisma.guardian.deleteMany({ where: { tenantId: T } });
  await prisma.teacherProfile.deleteMany({ where: { tenantId: T } });
  // UserProfile delete: skip the named admin (Mme Dupont, M. Lefebvre) — we'll upsert them
  await prisma.userProfile.deleteMany({
    where: { tenantId: T, NOT: { email: { in: ['mme.dupont@voltaire.fr', 'm.lefebvre@voltaire.fr'] } } },
  });
  await prisma.classSection.deleteMany({ where: { tenantId: T } });
  await prisma.subjectCoefficient.deleteMany({ where: { tenantId: T } });
  await prisma.subject.deleteMany({ where: { tenantId: T } });
  await prisma.gradeLevel.deleteMany({ where: { tenantId: T } });
  await prisma.cycle.deleteMany({ where: { tenantId: T } });
  await prisma.term.deleteMany({ where: { tenantId: T } });
  await prisma.academicYear.deleteMany({ where: { tenantId: T } });

  // ───────────────────────────────────────────────────────────────────────
  // STEP 3 — Academic years (3 : 2021-22, 2022-23, 2023-24 active)
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Années scolaires (3)…');
  const ayYears = [
    { name: '2021–2022', startDate: '2021-09-01', endDate: '2022-07-05', status: 'closed' as const },
    { name: '2022–2023', startDate: '2022-09-01', endDate: '2023-07-05', status: 'closed' as const },
    { name: '2023–2024', startDate: '2023-09-01', endDate: '2024-07-05', status: 'active' as const },
  ];
  const academicYears: Array<{ id: string; name: string; status: string }> = [];
  for (const y of ayYears) {
    const ay = await prisma.academicYear.create({
      data: {
        tenantId: T,
        schoolId: S,
        name: y.name,
        startDate: new Date(y.startDate),
        endDate: new Date(y.endDate),
        status: y.status,
      },
    });
    academicYears.push({ id: ay.id, name: ay.name, status: ay.status });

    // 3 trimesters per active year only (skip closed years for size)
    if (y.status === 'active') {
      const trims = [
        { name: '1er trimestre', orderIndex: 1, start: '2023-09-01', end: '2023-12-19' },
        { name: '2e trimestre', orderIndex: 2, start: '2024-01-05', end: '2024-04-03' },
        { name: '3e trimestre', orderIndex: 3, start: '2024-04-20', end: '2024-07-05' },
      ];
      for (const tr of trims) {
        await prisma.term.create({
          data: {
            tenantId: T,
            academicYearId: ay.id,
            name: tr.name,
            orderIndex: tr.orderIndex,
            startDate: new Date(tr.start),
            endDate: new Date(tr.end),
          },
        });
      }
    }
  }
  const activeYear = academicYears.find((y) => y.status === 'active')!;
  const activeTerms = await prisma.term.findMany({
    where: { academicYearId: activeYear.id },
    orderBy: { orderIndex: 'asc' },
  });

  // ───────────────────────────────────────────────────────────────────────
  // STEP 4 — Cycles (3) + Grade levels (12 + 18 + 14 = 44)
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Cycles (3) + Niveaux (44)…');
  const cyclePrimaire = await prisma.cycle.create({
    data: { tenantId: T, schoolId: S, code: 'primaire', name: 'Primaire', orderIndex: 1, color: 'oklch(0.70 0.16 60)', icon: 'BookOpen' },
  });
  const cycleCollege = await prisma.cycle.create({
    data: { tenantId: T, schoolId: S, code: 'college', name: 'Collège', orderIndex: 2, color: 'oklch(0.65 0.14 175)', icon: 'GraduationCap' },
  });
  const cycleLycee = await prisma.cycle.create({
    data: { tenantId: T, schoolId: S, code: 'lycee', name: 'Lycée', orderIndex: 3, color: 'oklch(0.55 0.20 280)', icon: 'Trophy' },
  });

  // 12 grade levels for Primaire — CP/CE1/CE2/CM1/CM2 + section variants to reach 12
  const primaireLevels = [
    { code: 'CP-A', name: 'CP', orderIndex: 1 },
    { code: 'CP-B', name: 'CP', orderIndex: 2 },
    { code: 'CE1-A', name: 'CE1', orderIndex: 3 },
    { code: 'CE1-B', name: 'CE1', orderIndex: 4 },
    { code: 'CE2-A', name: 'CE2', orderIndex: 5 },
    { code: 'CE2-B', name: 'CE2', orderIndex: 6 },
    { code: 'CM1-A', name: 'CM1', orderIndex: 7 },
    { code: 'CM1-B', name: 'CM1', orderIndex: 8 },
    { code: 'CM2-A', name: 'CM2', orderIndex: 9 },
    { code: 'CM2-B', name: 'CM2', orderIndex: 10 },
    { code: 'CM2-C', name: 'CM2', orderIndex: 11 },
    { code: 'CM2-D', name: 'CM2', orderIndex: 12 },
  ];

  // 18 grade levels for Collège — 6e/5e/4e/3e (main) + 14 sections/specialties
  const collegeLevels = [
    { code: '6e', name: '6e', orderIndex: 21 },
    { code: '5e', name: '5e', orderIndex: 22 },
    { code: '4e', name: '4e', orderIndex: 23 },
    { code: '3e', name: '3e', orderIndex: 24 },
    { code: '6e-bilangue', name: '6e Bilangue', orderIndex: 25 },
    { code: '6e-segpa', name: '6e SEGPA', orderIndex: 26 },
    { code: '6e-ulis', name: '6e ULIS', orderIndex: 27 },
    { code: '5e-bilangue', name: '5e Bilangue', orderIndex: 28 },
    { code: '5e-segpa', name: '5e SEGPA', orderIndex: 29 },
    { code: '5e-ulis', name: '5e ULIS', orderIndex: 30 },
    { code: '4e-bilangue', name: '4e Bilangue', orderIndex: 31 },
    { code: '4e-segpa', name: '4e SEGPA', orderIndex: 32 },
    { code: '4e-ulis', name: '4e ULIS', orderIndex: 33 },
    { code: '3e-bilangue', name: '3e Bilangue', orderIndex: 34 },
    { code: '3e-segpa', name: '3e SEGPA', orderIndex: 35 },
    { code: '3e-ulis', name: '3e ULIS', orderIndex: 36 },
    { code: '6e-eps-renforcee', name: '6e EPS renforcée', orderIndex: 37 },
    { code: '3e-prepa-pro', name: '3e Prépa-pro', orderIndex: 38 },
  ];

  // 14 grade levels for Lycée — 2nde/1ère/Terminale (main) + 11 specialties
  const lyceeLevels = [
    { code: '2nde', name: '2nde', orderIndex: 41 },
    { code: '1ere-ES', name: '1ère ES', orderIndex: 42 },
    { code: '1ere-L', name: '1ère L', orderIndex: 43 },
    { code: '1ere-S', name: '1ère S', orderIndex: 44 },
    { code: '1ere-STMG', name: '1ère STMG', orderIndex: 45 },
    { code: '1ere-STI2D', name: '1ère STI2D', orderIndex: 46 },
    { code: 'terminale-ES', name: 'Terminale ES', orderIndex: 47 },
    { code: 'terminale-L', name: 'Terminale L', orderIndex: 48 },
    { code: 'terminale-S', name: 'Terminale S', orderIndex: 49 },
    { code: 'terminale-STMG', name: 'Terminale STMG', orderIndex: 50 },
    { code: 'terminale-STI2D', name: 'Terminale STI2D', orderIndex: 51 },
    { code: '2nde-bilangue', name: '2nde Bilangue', orderIndex: 52 },
    { code: '1ere-bilangue', name: '1ère Bilangue', orderIndex: 53 },
    { code: 'terminale-bilangue', name: 'Terminale Bilangue', orderIndex: 54 },
  ];

  const allLevels: Array<{ id: string; code: string; name: string; cycleId: string; cycleCode: 'primaire' | 'college' | 'lycee' }> = [];
  for (const lvl of primaireLevels) {
    const gl = await prisma.gradeLevel.create({
      data: { tenantId: T, schoolId: S, cycleId: cyclePrimaire.id, code: lvl.code, name: lvl.name, orderIndex: lvl.orderIndex },
    });
    allLevels.push({ id: gl.id, code: lvl.code, name: lvl.name, cycleId: cyclePrimaire.id, cycleCode: 'primaire' });
  }
  for (const lvl of collegeLevels) {
    const gl = await prisma.gradeLevel.create({
      data: { tenantId: T, schoolId: S, cycleId: cycleCollege.id, code: lvl.code, name: lvl.name, orderIndex: lvl.orderIndex },
    });
    allLevels.push({ id: gl.id, code: lvl.code, name: lvl.name, cycleId: cycleCollege.id, cycleCode: 'college' });
  }
  for (const lvl of lyceeLevels) {
    const gl = await prisma.gradeLevel.create({
      data: { tenantId: T, schoolId: S, cycleId: cycleLycee.id, code: lvl.code, name: lvl.name, orderIndex: lvl.orderIndex },
    });
    allLevels.push({ id: gl.id, code: lvl.code, name: lvl.name, cycleId: cycleLycee.id, cycleCode: 'lycee' });
  }
  console.info(`     ✓ ${allLevels.length} niveaux créés (Primaire ${primaireLevels.length} / Collège ${collegeLevels.length} / Lycée ${lyceeLevels.length})`);

  // ───────────────────────────────────────────────────────────────────────
  // STEP 5 — Subjects (8) + Coefficients per level
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Matières (8) + coefficients…');
  const subjectsDef = [
    { code: 'MATHS', name: 'Mathématiques', defaultCoef: 4, color: 'oklch(0.55 0.20 280)', icon: 'Sigma' },
    { code: 'FR', name: 'Français', defaultCoef: 4, color: 'oklch(0.70 0.18 45)', icon: 'BookOpen' },
    { code: 'HG', name: 'Histoire-Géographie', defaultCoef: 3, color: 'oklch(0.62 0.15 240)', icon: 'Globe2' },
    { code: 'EN', name: 'Anglais', defaultCoef: 3, color: 'oklch(0.65 0.20 0)', icon: 'Languages' },
    { code: 'SVT', name: 'SVT', defaultCoef: 2, color: 'oklch(0.63 0.16 145)', icon: 'Leaf' },
    { code: 'PC', name: 'Physique-Chimie', defaultCoef: 3, color: 'oklch(0.65 0.14 175)', icon: 'Atom' },
    { code: 'EPS', name: 'EPS', defaultCoef: 1, color: 'oklch(0.72 0.18 130)', icon: 'Dumbbell' },
    { code: 'ART', name: 'Arts Plastiques', defaultCoef: 1, color: 'oklch(0.65 0.22 330)', icon: 'Palette' },
  ];
  const subjects: Record<string, { id: string; defaultCoef: number }> = {};
  for (const sub of subjectsDef) {
    const s = await prisma.subject.create({
      data: {
        tenantId: T,
        schoolId: S,
        code: sub.code,
        name: sub.name,
        defaultCoefficient: sub.defaultCoef,
        color: sub.color,
        icon: sub.icon,
        active: true,
      },
    });
    subjects[sub.code] = { id: s.id, defaultCoef: sub.defaultCoef };
  }
  // Coefficients per (level, subject) — use defaults
  for (const lvl of allLevels) {
    for (const sub of subjectsDef) {
      await prisma.subjectCoefficient.create({
        data: { tenantId: T, gradeLevelId: lvl.id, subjectId: subjects[sub.code]!.id, coefficient: sub.defaultCoef },
      });
    }
  }
  console.info(`     ✓ ${subjectsDef.length} matières + ${allLevels.length * subjectsDef.length} coefficients`);

  // ───────────────────────────────────────────────────────────────────────
  // STEP 6 — Class sections (94)
  // Distribution:
  //   - 6e/5e/4e/3e × 12 sections each = 48 (main collège)
  //   - Primaire CP-A..CM2-D × 2 sections avg = 24
  //   - Lycée 2nde×8 + 1ère*main×4 + Terminale*main×6 + variants = 22
  //   Total: 94
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Class sections (94)…');
  const classSectionsCreated: Array<{ id: string; name: string; levelCode: string; cycleCode: string }> = [];

  // Helper: create N sections in a level
  async function createSectionsInLevel(levelCode: string, prefix: string, count: number, maxStudents: number) {
    const level = allLevels.find((l) => l.code === levelCode);
    if (!level) return;
    for (let i = 0; i < count; i++) {
      const letter = String.fromCharCode(65 + i); // A, B, C, ...
      const name = `${prefix}${letter}`;
      const cs = await prisma.classSection.create({
        data: {
          tenantId: T,
          academicYearId: activeYear.id,
          gradeLevelId: level.id,
          name,
          maxStudents,
        },
      });
      classSectionsCreated.push({ id: cs.id, name, levelCode, cycleCode: level.cycleCode });
    }
  }

  // Collège — 6e/5e/4e/3e × 12 = 48 classes
  await createSectionsInLevel('6e', '6e', 12, 28);
  await createSectionsInLevel('5e', '5e', 12, 30);
  await createSectionsInLevel('4e', '4e', 12, 28);
  await createSectionsInLevel('3e', '3e', 12, 28);

  // Primaire — 12 levels × 2 sections = 24 classes
  for (const lvl of primaireLevels) {
    await createSectionsInLevel(lvl.code, `${lvl.name}-${lvl.code.split('-')[1]}`, 2, 26);
  }

  // Lycée — 22 classes distributed across main levels
  await createSectionsInLevel('2nde', '2nde', 8, 32);
  await createSectionsInLevel('1ere-S', '1ère S', 4, 28);
  await createSectionsInLevel('terminale-S', 'Terminale S', 4, 26);
  await createSectionsInLevel('terminale-ES', 'Terminale ES', 3, 26);
  await createSectionsInLevel('terminale-L', 'Terminale L', 3, 24);

  console.info(`     ✓ ${classSectionsCreated.length} class sections créées`);

  if (classSectionsCreated.length !== TARGET_CLASSES) {
    console.warn(`     ⚠ Cible attendue ${TARGET_CLASSES}, obtenu ${classSectionsCreated.length}`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // STEP 7 — Admin users (Mme Dupont + M. Lefebvre) + 5 named teachers
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Admin users + 5 enseignants nommés (table Affectations)…');

  // Mme Dupont (admin principal)
  const userDupont = await prisma.userProfile.upsert({
    where: { tenantId_email: { tenantId: T, email: 'mme.dupont@voltaire.fr' } },
    update: { firstName: 'Sophie', lastName: 'Dupont' },
    create: {
      tenantId: T,
      firstName: 'Sophie',
      lastName: 'Dupont',
      email: 'mme.dupont@voltaire.fr',
      status: 'active',
      locale: 'fr-FR',
    },
  });

  // M. Lefebvre (admin secondaire)
  const userLefebvre = await prisma.userProfile.upsert({
    where: { tenantId_email: { tenantId: T, email: 'm.lefebvre@voltaire.fr' } },
    update: { firstName: 'Jacques', lastName: 'Lefebvre' },
    create: {
      tenantId: T,
      firstName: 'Jacques',
      lastName: 'Lefebvre',
      email: 'm.lefebvre@voltaire.fr',
      status: 'active',
      locale: 'fr-FR',
    },
  });

  // 5 enseignants nommés pour la table Affectations
  type NamedTeacher = { firstName: string; lastName: string; email: string; specialty: string };
  const namedTeachers: NamedTeacher[] = [
    { firstName: 'Pierre', lastName: 'Laurent', email: 'p.laurent@voltaire.fr', specialty: 'Mathématiques' },
    { firstName: 'Christine', lastName: 'Bernard', email: 'c.bernard@voltaire.fr', specialty: 'Français' },
    { firstName: 'Antoine', lastName: 'Girard', email: 'a.girard@voltaire.fr', specialty: 'Anglais' },
    { firstName: 'Catherine', lastName: 'Petit', email: 'c.petit@voltaire.fr', specialty: 'SVT' },
    { firstName: 'Marc', lastName: 'Robert', email: 'm.robert@voltaire.fr', specialty: 'Physique-Chimie' },
  ];
  const namedTeacherProfiles: Array<{ id: string; lastName: string; subject: string; userProfileId: string }> = [];
  for (const nt of namedTeachers) {
    const up = await prisma.userProfile.create({
      data: { tenantId: T, firstName: nt.firstName, lastName: nt.lastName, email: nt.email, status: 'active', locale: 'fr-FR' },
    });
    const tp = await prisma.teacherProfile.create({
      data: { tenantId: T, schoolId: S, userProfileId: up.id, specialty: nt.specialty, active: true, hiredAt: new Date('2018-09-01') },
    });
    namedTeacherProfiles.push({ id: tp.id, lastName: nt.lastName, subject: nt.specialty, userProfileId: up.id });
  }

  // ───────────────────────────────────────────────────────────────────────
  // STEP 8 — 181 generic teachers (to reach total 186)
  // ───────────────────────────────────────────────────────────────────────
  console.info(`  ▸ ${TARGET_TEACHERS - namedTeachers.length} enseignants génériques…`);
  const genericTeacherIds: string[] = [];
  for (let i = 0; i < TARGET_TEACHERS - namedTeachers.length; i++) {
    const name = pickName();
    const email = `prof.${name.firstName.toLowerCase().replace(/é/g, 'e')}.${name.lastName.toLowerCase().replace(/é/g, 'e')}.${i}@voltaire.fr`;
    const up = await prisma.userProfile.create({
      data: {
        tenantId: T,
        firstName: name.firstName,
        lastName: name.lastName,
        email,
        status: 'active',
        locale: 'fr-FR',
        // Stagger createdAt so sparkline shows growth
        createdAt: randomDate(new Date('2023-08-01'), new Date('2024-05-08')),
      },
    });
    const subj = subjectsDef[Math.floor(random() * subjectsDef.length)]!.name;
    const tp = await prisma.teacherProfile.create({
      data: {
        tenantId: T,
        schoolId: S,
        userProfileId: up.id,
        specialty: subj,
        active: true,
        hiredAt: new Date('2020-09-01'),
        createdAt: up.createdAt,
      },
    });
    genericTeacherIds.push(tp.id);
  }
  console.info(`     ✓ ${TARGET_TEACHERS} enseignants au total`);

  // ───────────────────────────────────────────────────────────────────────
  // STEP 9 — Teaching assignments
  //   - 5 nommées (M. Laurent → Maths × 5eA+5eB ; etc.) pour la table Affectations
  //   - Affectations distribuées pour avoir des données réalistes côté donut
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Affectations pédagogiques…');

  // Map des class sections par levelCode pour facilité
  const cs5eA = classSectionsCreated.find((c) => c.name === '5eA')!;
  const cs5eB = classSectionsCreated.find((c) => c.name === '5eB')!;
  const cs4eA = classSectionsCreated.find((c) => c.name === '4eA')!;
  const cs4eB = classSectionsCreated.find((c) => c.name === '4eB')!;
  const cs6eA = classSectionsCreated.find((c) => c.name === '6eA')!;
  const cs6eB = classSectionsCreated.find((c) => c.name === '6eB')!;
  const cs3eA = classSectionsCreated.find((c) => c.name === '3eA')!;
  const cs3eB = classSectionsCreated.find((c) => c.name === '3eB')!;
  const cs2ndeA = classSectionsCreated.find((c) => c.name === '2ndeA')!;
  const cs2ndeB = classSectionsCreated.find((c) => c.name === '2ndeB')!;

  // Helper to create one assignment
  async function createAssignment(teacherId: string, classSectionId: string, subjectCode: string, weeklyHours: number) {
    return prisma.teachingAssignment.create({
      data: {
        tenantId: T,
        teacherProfileId: teacherId,
        classSectionId,
        subjectId: subjects[subjectCode]!.id,
        academicYearId: activeYear.id,
        weeklyHours,
      },
    });
  }

  // 5 named affectations — exactement comme la table Affectations cible
  // (heures totales par prof, distribution sur 2 classes)
  const [tLaurent, tBernard, tGirard, tPetit, tRobert] = namedTeacherProfiles;
  // M. Laurent → Maths × (5eA, 5eB) → 18h total (9h/classe)
  await createAssignment(tLaurent!.id, cs5eA.id, 'MATHS', 9);
  await createAssignment(tLaurent!.id, cs5eB.id, 'MATHS', 9);
  // Mme Bernard → Français × (4eA, 4eB) → 16h
  await createAssignment(tBernard!.id, cs4eA.id, 'FR', 8);
  await createAssignment(tBernard!.id, cs4eB.id, 'FR', 8);
  // M. Girard → Anglais × (6eA, 6eB) → 14h
  await createAssignment(tGirard!.id, cs6eA.id, 'EN', 7);
  await createAssignment(tGirard!.id, cs6eB.id, 'EN', 7);
  // Mme Petit → SVT × (3eA, 3eB) → 15h (en surcharge — capacité dépassée)
  // To trigger overcapacity status, we'll enroll extra students in 3eA later
  await createAssignment(tPetit!.id, cs3eA.id, 'SVT', 8);
  await createAssignment(tPetit!.id, cs3eB.id, 'SVT', 7);
  // M. Robert → Physique-Chimie × (2ndeA, 2ndeB) → 12h
  await createAssignment(tRobert!.id, cs2ndeA.id, 'PC', 6);
  await createAssignment(tRobert!.id, cs2ndeB.id, 'PC', 6);

  // Distribute generic teachers across remaining class×subject pairs (≈ 3 assignments per teacher)
  // We don't need to cover ALL pairs — just enough to have realistic data + leave room for grades
  let teacherIdx = 0;
  for (const cs of classSectionsCreated) {
    // Skip class sections already covered above to avoid unique constraint violations
    const skipPair = [
      `${cs5eA.id}:MATHS`, `${cs5eB.id}:MATHS`,
      `${cs4eA.id}:FR`, `${cs4eB.id}:FR`,
      `${cs6eA.id}:EN`, `${cs6eB.id}:EN`,
      `${cs3eA.id}:SVT`, `${cs3eB.id}:SVT`,
      `${cs2ndeA.id}:PC`, `${cs2ndeB.id}:PC`,
    ];
    // Assign 2-3 subjects per class to generic teachers
    const subjectsForThisClass = ['MATHS', 'FR', 'EN'];
    for (const subCode of subjectsForThisClass) {
      if (skipPair.includes(`${cs.id}:${subCode}`)) continue;
      const teacherId = genericTeacherIds[teacherIdx % genericTeacherIds.length]!;
      teacherIdx++;
      try {
        await prisma.teachingAssignment.create({
          data: {
            tenantId: T,
            teacherProfileId: teacherId,
            classSectionId: cs.id,
            subjectId: subjects[subCode]!.id,
            academicYearId: activeYear.id,
            weeklyHours: subCode === 'MATHS' ? 4 : subCode === 'FR' ? 4 : 3,
          },
        });
      } catch {
        // ignore unique constraint violations (shouldn't happen but defensive)
      }
    }
  }

  console.info('     ✓ Affectations créées (5 nommées + ~280 génériques)');

  // ───────────────────────────────────────────────────────────────────────
  // STEP 10 — 2458 students + active enrollments
  //   Distribution: 624 primaire / 1344 collège / 484 lycée (≈ classes × avg)
  //   To reach EXACTLY 2458, we adjust the last cycle.
  // ───────────────────────────────────────────────────────────────────────
  console.info(`  ▸ ${TARGET_STUDENTS} élèves + inscriptions actives…`);

  const collegeMainClasses = classSectionsCreated.filter((c) => ['6e', '5e', '4e', '3e'].includes(c.levelCode));
  const primaireClasses = classSectionsCreated.filter((c) => c.cycleCode === 'primaire');
  const lyceeClasses = classSectionsCreated.filter((c) => c.cycleCode === 'lycee');

  // Students per class (target totals : collège 1344 / primaire 624 / lycée 490 = 2458)
  const targetCollege = 1344;
  const targetPrimaire = 624;
  const targetLycee = TARGET_STUDENTS - targetCollege - targetPrimaire; // = 490

  const studentsCreated: Array<{ id: string; classSectionId: string; cycleCode: 'primaire' | 'college' | 'lycee'; gender: 'M' | 'F' }> = [];

  // Bulk insert helper — pads externalRef sequentially
  let studentSeq = 1;
  async function bulkInsertStudents(targetCount: number, classes: typeof classSectionsCreated, cycleCode: 'primaire' | 'college' | 'lycee') {
    if (classes.length === 0 || targetCount === 0) return;
    const perClass = Math.floor(targetCount / classes.length);
    let remaining = targetCount - perClass * classes.length;
    for (const cs of classes) {
      const n = perClass + (remaining > 0 ? 1 : 0);
      if (remaining > 0) remaining--;
      const rows = [];
      for (let i = 0; i < n; i++) {
        const name = pickName();
        const ref = `VOLT-${String(studentSeq).padStart(6, '0')}`;
        studentSeq++;
        rows.push({
          tenantId: T,
          schoolId: S,
          firstName: name.firstName,
          lastName: name.lastName,
          gender: name.gender,
          externalRef: ref,
          status: StudentStatus.active,
          birthDate: randomDate(new Date('2009-01-01'), new Date('2017-12-31')),
          // Stagger createdAt across last 90 days for sparklines
          createdAt: randomDate(new Date('2024-02-10'), new Date('2024-05-08')),
        });
      }
      const studentBatch = await prisma.student.createManyAndReturn({
        data: rows,
        select: { id: true, gender: true, createdAt: true },
      });
      // Enrollments — one per student in their class
      const enrollmentRows = studentBatch.map((s) => ({
        tenantId: T,
        studentId: s.id,
        classSectionId: cs.id,
        academicYearId: activeYear.id,
        status: 'active' as const,
        enrolledAt: s.createdAt,
      }));
      await prisma.enrollment.createMany({ data: enrollmentRows });

      for (const s of studentBatch) {
        studentsCreated.push({
          id: s.id,
          classSectionId: cs.id,
          cycleCode,
          gender: (s.gender === 'M' || s.gender === 'F' ? s.gender : 'M') as 'M' | 'F',
        });
      }
    }
  }

  await bulkInsertStudents(targetPrimaire, primaireClasses, 'primaire');
  await bulkInsertStudents(targetCollege, collegeMainClasses, 'college');
  await bulkInsertStudents(targetLycee, lyceeClasses, 'lycee');

  console.info(`     ✓ ${studentsCreated.length} élèves créés (cible ${TARGET_STUDENTS})`);

  // ───────────────────────────────────────────────────────────────────────
  // STEP 11 — Guardians + Guardianships (one guardian per student + 28 pending)
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Parents + rattachements…');

  // 5 NAMED pending guardianships (table Demandes cible)
  type NamedDemande = {
    guardianFirst: string;
    guardianLast: string;
    studentFirst: string;
    studentLast: string;
    className: string;
    kind: 'rattachement' | 'inscription';
    review: 'pending' | 'to_verify' | 'approved';
    /** Hard-coded createdAt so the rendered date matches the target screenshot regardless of when the seed runs. */
    createdAt: string;
  };
  const namedDemandes: NamedDemande[] = [
    { guardianFirst: 'Sophie', guardianLast: 'Martin', studentFirst: 'Élise', studentLast: 'Martin', className: '5eB', kind: 'rattachement', review: 'pending', createdAt: '2024-05-08T11:20:00Z' },
    { guardianFirst: 'Karim', guardianLast: 'Belkacem', studentFirst: 'Yanis', studentLast: 'Belkacem', className: '4eA', kind: 'inscription', review: 'to_verify', createdAt: '2024-05-08T09:45:00Z' },
    { guardianFirst: 'Nadia', guardianLast: 'Lefèvre', studentFirst: 'Lucas', studentLast: 'Lefèvre', className: '6eA', kind: 'rattachement', review: 'pending', createdAt: '2024-05-07T15:30:00Z' },
    { guardianFirst: 'Julien', guardianLast: 'Moreau', studentFirst: 'Chloé', studentLast: 'Moreau', className: '3eB', kind: 'inscription', review: 'approved', createdAt: '2024-05-06T14:10:00Z' },
    { guardianFirst: 'Fatou', guardianLast: 'Diallo', studentFirst: 'Aminata', studentLast: 'Diallo', className: '2ndeA', kind: 'rattachement', review: 'to_verify', createdAt: '2024-05-06T08:55:00Z' },
  ];

  // For each named demande, create the student (if not already) and a pending guardianship
  let namedDemandeSeq = 0;
  for (const d of namedDemandes) {
    const cs = classSectionsCreated.find((c) => c.name === d.className);
    if (!cs) continue;
    // Create student
    const studentRef = `VOLT-DEMANDE-${String(namedDemandeSeq++).padStart(3, '0')}`;
    const student = await prisma.student.create({
      data: {
        tenantId: T,
        schoolId: S,
        firstName: d.studentFirst,
        lastName: d.studentLast,
        externalRef: studentRef,
        status: StudentStatus.active,
        birthDate: randomDate(new Date('2010-01-01'), new Date('2014-12-31')),
      },
    });
    // Both rattachement & inscription demands surface the requested class in the dashboard table.
    // For "inscription" the enrollment represents the requested target (will be made effective
    // once the demand is approved); for "rattachement" the enrollment is the existing record
    // the parent wants to link to.
    await prisma.enrollment.create({
      data: {
        tenantId: T,
        studentId: student.id,
        classSectionId: cs.id,
        academicYearId: activeYear.id,
        status: 'active',
      },
    });
    // Create guardian + pending guardianship
    const guardian = await prisma.guardian.create({
      data: {
        tenantId: T,
        schoolId: S,
        firstName: d.guardianFirst,
        lastName: d.guardianLast,
        email: `${d.guardianFirst.toLowerCase()}.${d.guardianLast.toLowerCase().replace(/è/g, 'e').replace(/é/g, 'e')}@famille.fr`,
        phone: '+33612345678',
      },
    });

    const requestedAt = new Date(d.createdAt);
    // For "approved" demand keep status=active and review=approved in notes
    const isApprovedDemand = d.review === 'approved';
    await prisma.guardianship.create({
      data: {
        tenantId: T,
        guardianId: guardian.id,
        studentId: student.id,
        relationship: GuardianRelationship.mother,
        isPrimaryContact: true,
        canPickup: true,
        hasLegalCustody: true,
        status: isApprovedDemand ? GuardianshipStatus.active : GuardianshipStatus.pending,
        notes: JSON.stringify({ kind: d.kind, review: d.review }),
        createdAt: requestedAt,
      },
    });
  }

  // The 23 remaining pending guardianships (total target = 28)
  const remainingPending = TARGET_PENDING_GUARDIANSHIPS - namedDemandes.filter((d) => d.review !== 'approved').length;
  // 28 target - 4 pending/to_verify in named = 24 more anonymous pending guardianships
  for (let i = 0; i < remainingPending; i++) {
    // Attach to a random existing student
    const stu = studentsCreated[Math.floor(random() * studentsCreated.length)]!;
    const name = pickName();
    const guardian = await prisma.guardian.create({
      data: {
        tenantId: T,
        schoolId: S,
        firstName: name.firstName,
        lastName: name.lastName,
        email: `${name.firstName.toLowerCase()}.${name.lastName.toLowerCase()}.${i}@famille.fr`,
      },
    });
    await prisma.guardianship.create({
      data: {
        tenantId: T,
        guardianId: guardian.id,
        studentId: stu.id,
        relationship: GuardianRelationship.mother,
        status: GuardianshipStatus.pending,
        notes: JSON.stringify({ kind: 'rattachement', review: 'pending' }),
        createdAt: randomDate(new Date('2024-04-15'), new Date('2024-05-08')),
      },
    });
  }

  // Active guardianships for all other students (1 guardian/student average)
  // Bulk create to keep seed reasonable
  console.info('     ▸ Création parents actifs (1 par élève)…');
  const guardianRows: Array<{ studentId: string; firstName: string; lastName: string; email: string }> = [];
  for (let i = 0; i < studentsCreated.length; i++) {
    const stu = studentsCreated[i]!;
    const name = pickName();
    guardianRows.push({
      studentId: stu.id,
      firstName: name.firstName,
      lastName: name.lastName,
      email: `${name.firstName.toLowerCase()}.${name.lastName.toLowerCase()}.${i}@famille.fr`,
    });
  }
  // Bulk insert guardians (skip duplicates via unique on email — there may be collisions, ignore them)
  const guardianBatch = await prisma.guardian.createManyAndReturn({
    data: guardianRows.map((g) => ({
      tenantId: T,
      schoolId: S,
      firstName: g.firstName,
      lastName: g.lastName,
      email: g.email,
    })),
    select: { id: true },
    skipDuplicates: true,
  });

  // Pair guardians ↔ students (order-preserving)
  const linkBatch: Array<{ guardianId: string; studentId: string }> = [];
  for (let i = 0; i < Math.min(guardianBatch.length, studentsCreated.length); i++) {
    linkBatch.push({ guardianId: guardianBatch[i]!.id, studentId: studentsCreated[i]!.id });
  }
  // Bulk insert guardianships (active)
  await prisma.guardianship.createMany({
    data: linkBatch.map((l) => ({
      tenantId: T,
      guardianId: l.guardianId,
      studentId: l.studentId,
      relationship: GuardianRelationship.mother,
      isPrimaryContact: true,
      canPickup: true,
      hasLegalCustody: true,
      status: GuardianshipStatus.active,
    })),
    skipDuplicates: true,
  });

  console.info(`     ✓ ${guardianBatch.length} parents + ${TARGET_PENDING_GUARDIANSHIPS} demandes en attente`);

  // ───────────────────────────────────────────────────────────────────────
  // STEP 12 — Assessments + Grades calibrés
  //   Target: 76% global success (≥10/20), with breakdown:
  //     - Primaire: 82%
  //     - Collège: 74%
  //     - Lycée: 69%
  //   Strategy:
  //     - Take ~6 representative class sections per cycle (top by enrollment).
  //     - For each, create 1 assessment (Math) + grade every student.
  //     - Tune the random distribution per cycle to hit the target ratio.
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Évaluations + notes calibrées pour donut 76%/82%/74%/69%…');

  // Pick sampling subsets
  const sampledClasses = [
    ...primaireClasses.slice(0, 4),
    ...collegeMainClasses.slice(0, 8),
    ...lyceeClasses.slice(0, 4),
  ];

  // Mean+stddev tuned for each cycle's success rate
  const successConfig: Record<'primaire' | 'college' | 'lycee', { mean: number; stddev: number }> = {
    primaire: { mean: 12.5, stddev: 3.0 }, // ~82% ≥ 10
    college: { mean: 11.5, stddev: 3.2 }, // ~74% ≥ 10
    lycee: { mean: 11.0, stddev: 3.5 }, // ~69% ≥ 10
  };

  // Box-Muller normal sampler
  function normal(mean: number, stddev: number): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = random();
    while (v === 0) v = random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return Math.max(0, Math.min(20, Math.round((z * stddev + mean) * 10) / 10));
  }

  for (const cs of sampledClasses) {
    // Find any teacher assignment for this class to attach assessments to
    const ta = await prisma.teachingAssignment.findFirst({
      where: { tenantId: T, classSectionId: cs.id },
    });
    if (!ta) continue;
    const assessment = await prisma.assessment.create({
      data: {
        tenantId: T,
        teachingAssignmentId: ta.id,
        teacherProfileId: ta.teacherProfileId,
        termId: activeTerms[1]?.id ?? null, // T2
        title: `Contrôle ${activeTerms[1]?.name ?? 'T2'}`,
        kind: AssessmentKind.written_test,
        maxScore: 20,
        scheduledAt: new Date('2024-03-15'),
        conductedAt: new Date('2024-03-15'),
        isPublished: true,
        publishedAt: new Date('2024-03-20'),
      },
    });
    // Grade every student of the class
    const studentsOfClass = studentsCreated.filter((s) => s.classSectionId === cs.id);
    const cfg = successConfig[cs.cycleCode as 'primaire' | 'college' | 'lycee'];
    const gradesData = studentsOfClass.map((s) => ({
      tenantId: T,
      assessmentId: assessment.id,
      studentId: s.id,
      value: normal(cfg.mean, cfg.stddev),
      status: GradeStatus.published,
      enteredBy: ta.teacherProfileId,
      enteredAt: new Date('2024-03-18'),
      publishedAt: new Date('2024-03-20'),
    }));
    if (gradesData.length > 0) {
      await prisma.grade.createMany({ data: gradesData });
    }
  }
  console.info('     ✓ Notes calibrées créées');

  // ───────────────────────────────────────────────────────────────────────
  // STEP 13 — AuditLog (50 generic + 4 named)
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Journal d\'audit (50 entrées + 4 nommées)…');

  // 4 NAMED entries (timeline cible)
  const namedAuditEntries = [
    {
      createdAt: new Date('2024-05-08T10:32:00Z'),
      actorId: userDupont.id,
      actorRole: 'school_admin',
      action: 'Création',
      resourceType: 'Année scolaire',
      after: { detail: "Création de l'année scolaire 2024–2025" },
    },
    {
      createdAt: new Date('2024-05-08T09:18:00Z'),
      actorId: userLefebvre.id,
      actorRole: 'school_admin',
      action: 'Mise à jour',
      resourceType: 'Professeur',
      after: { detail: "Modification de l'affectation de M. Laurent" },
    },
    {
      createdAt: new Date('2024-05-07T16:45:00Z'),
      actorId: userDupont.id,
      actorRole: 'school_admin',
      action: 'Validation',
      resourceType: 'Inscription',
      after: { detail: 'Validation de la demande de Lucas Lefèvre' },
    },
    {
      createdAt: new Date('2024-05-07T11:03:00Z'),
      actorId: tGirard!.userProfileId,
      actorRole: 'teacher',
      action: 'Export',
      resourceType: 'Résultats',
      after: { detail: 'Export des résultats – 3e trimestre' },
    },
  ];
  for (const e of namedAuditEntries) {
    await prisma.auditLog.create({
      data: {
        tenantId: T,
        actorId: e.actorId,
        actorRole: e.actorRole,
        portal: 'admin',
        action: e.action,
        resourceType: e.resourceType,
        after: e.after,
        createdAt: e.createdAt,
      },
    });
  }

  // 50 generic audit entries (older — make the journal feel alive)
  const auditActions = ['Création', 'Mise à jour', 'Validation', 'Suppression', 'Export'];
  const auditResources = ['Élève', 'Professeur', 'Classe', 'Évaluation', 'Note', 'Inscription'];
  for (let i = 0; i < 50; i++) {
    await prisma.auditLog.create({
      data: {
        tenantId: T,
        actorId: random() > 0.5 ? userDupont.id : userLefebvre.id,
        actorRole: 'school_admin',
        portal: 'admin',
        action: pick(auditActions),
        resourceType: pick(auditResources),
        createdAt: randomDate(new Date('2024-04-01'), new Date('2024-05-06')),
      },
    });
  }
  console.info('     ✓ 54 entrées d\'audit créées');

  // ───────────────────────────────────────────────────────────────────────
  // STEP 14 — Exports récents (3 named ExportJob rows)
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Exports récents (3 lignes)…');
  await prisma.exportJob.create({
    data: {
      tenantId: T,
      schoolId: S,
      requestedBy: tGirard!.userProfileId,
      kind: ExportKind.grades_xlsx,
      fileName: 'Résultats_3e_trimestre.xlsx',
      fileSizeBytes: 487_320,
      status: ExportStatus.succeeded,
      startedAt: new Date('2024-05-08T10:09:00Z'),
      finishedAt: new Date('2024-05-08T10:10:00Z'),
      createdAt: new Date('2024-05-08T10:10:00Z'),
    },
  });
  await prisma.exportJob.create({
    data: {
      tenantId: T,
      schoolId: S,
      requestedBy: userDupont.id,
      kind: ExportKind.report_card_pdf,
      fileName: 'Bulletins_2e_trimestre.pdf',
      fileSizeBytes: 2_103_440,
      status: ExportStatus.succeeded,
      startedAt: new Date('2024-05-07T15:20:00Z'),
      finishedAt: new Date('2024-05-07T15:22:00Z'),
      createdAt: new Date('2024-05-07T15:22:00Z'),
    },
  });
  await prisma.exportJob.create({
    data: {
      tenantId: T,
      schoolId: S,
      requestedBy: userLefebvre.id,
      kind: ExportKind.attendance_xlsx,
      fileName: 'Absences_avril_2024.xlsx',
      fileSizeBytes: 152_840,
      status: ExportStatus.succeeded,
      startedAt: new Date('2024-05-06T09:40:00Z'),
      finishedAt: new Date('2024-05-06T09:41:00Z'),
      createdAt: new Date('2024-05-06T09:41:00Z'),
    },
  });
  console.info('     ✓ 3 ExportJob créés');

  // ───────────────────────────────────────────────────────────────────────
  // STEP 15 — Calendar events (live calendar visible across all 3 portals)
  // Anchored on today so the demo always shows past + current + upcoming.
  // ───────────────────────────────────────────────────────────────────────
  console.info('  ▸ Calendrier scolaire (≈18 événements anchored sur aujourd\'hui)…');
  const now = new Date();
  const day = (offset: number, hours = 9): Date => {
    const d = new Date(now);
    d.setHours(hours, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d;
  };
  const allDay = (offset: number): { starts: Date; ends: Date } => {
    const starts = day(offset, 0);
    const ends = new Date(starts);
    ends.setHours(23, 59, 59, 999);
    return { starts, ends };
  };
  const span = (startOffset: number, endOffset: number): { starts: Date; ends: Date } => ({
    starts: day(startOffset, 0),
    ends: (() => {
      const e = day(endOffset, 0);
      e.setHours(23, 59, 59, 999);
      return e;
    })(),
  });

  const calendarSeeds: Array<{
    title: string;
    description: string;
    type: CalendarEventType;
    scope: CalendarEventScope;
    visibility: CalendarEventVisibility;
    starts: Date;
    ends: Date;
    color: string;
  }> = [
    // Past — feels lived-in (one short past block)
    {
      title: 'Conseil de classe — 2e trimestre',
      description: 'Réunion des équipes pédagogiques pour le bilan du 2e trimestre.',
      type: CalendarEventType.meeting,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.staff_only,
      ...allDay(-12),
      color: 'oklch(0.62 0.16 250)',
    },
    {
      title: 'Carnaval de l\'école',
      description: 'Défilé costumé dans la cour, goûter offert par l\'association des parents.',
      type: CalendarEventType.ceremony,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      ...allDay(-7),
      color: 'oklch(0.70 0.16 145)',
    },

    // This week / next 2 weeks
    {
      title: 'Période d\'évaluations communes',
      description: 'Devoirs communs en mathématiques, français et sciences pour tous les niveaux du collège.',
      type: CalendarEventType.exam_period,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      ...span(2, 6),
      color: 'oklch(0.55 0.20 290)',
    },
    {
      title: 'Réunion parents-professeurs',
      description: 'Rencontres individuelles 17h–20h en salles dédiées. Inscription préalable obligatoire via le portail parent.',
      type: CalendarEventType.meeting,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      starts: day(5, 17),
      ends: day(5, 20),
      color: 'oklch(0.62 0.16 250)',
    },
    {
      title: 'Journée pédagogique',
      description: 'Aucun cours pour les élèves. Formation des enseignants sur le numérique éducatif.',
      type: CalendarEventType.pedagogical_day,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      ...allDay(9),
      color: 'oklch(0.70 0.12 200)',
    },
    {
      title: 'Sortie pédagogique — Musée d\'histoire',
      description: 'Sortie scolaire pour les classes de 6e A et 6e B.',
      type: CalendarEventType.custom,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      ...allDay(11),
      color: 'oklch(0.60 0.16 250)',
    },

    // Coming month
    {
      title: 'Conseil d\'établissement',
      description: 'Réunion trimestrielle du conseil d\'établissement.',
      type: CalendarEventType.meeting,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.staff_only,
      starts: day(15, 18),
      ends: day(15, 20),
      color: 'oklch(0.62 0.16 250)',
    },
    {
      title: 'Vacances de printemps',
      description: 'Vacances scolaires de printemps (zone B). Reprise des cours le lundi suivant.',
      type: CalendarEventType.vacation_break,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      ...span(20, 33),
      color: 'oklch(0.75 0.15 70)',
    },

    // Past — reference
    {
      title: 'Vacances d\'hiver',
      description: 'Vacances scolaires d\'hiver. Établissement fermé.',
      type: CalendarEventType.vacation_break,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      ...span(-45, -32),
      color: 'oklch(0.75 0.15 70)',
    },

    // After vacances
    {
      title: 'Examen blanc du brevet',
      description: 'Examen blanc du DNB pour toutes les classes de 3e — épreuves de français, mathématiques et histoire-géographie.',
      type: CalendarEventType.exam_period,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      ...span(40, 41),
      color: 'oklch(0.55 0.20 290)',
    },
    {
      title: 'Cross de l\'établissement',
      description: 'Course annuelle inter-classes au parc municipal. Tenue de sport obligatoire.',
      type: CalendarEventType.ceremony,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      ...allDay(45),
      color: 'oklch(0.70 0.16 145)',
    },
    {
      title: 'Forum des métiers',
      description: 'Forum des métiers et de l\'orientation pour les classes de 3e et de seconde.',
      type: CalendarEventType.custom,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      ...allDay(52),
      color: 'oklch(0.60 0.16 250)',
    },
    {
      title: 'Fête de fin d\'année',
      description: 'Spectacles, kermesse et remise des prix. Familles bienvenues.',
      type: CalendarEventType.ceremony,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      ...allDay(60),
      color: 'oklch(0.70 0.16 145)',
    },

    // French public holidays falling in next 3 months — approximate
    {
      title: 'Lundi de Pâques',
      description: 'Jour férié — établissement fermé.',
      type: CalendarEventType.public_holiday,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      ...allDay(25),
      color: 'oklch(0.68 0.18 25)',
    },
    {
      title: 'Fête du Travail',
      description: 'Jour férié — établissement fermé.',
      type: CalendarEventType.public_holiday,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      ...allDay(35),
      color: 'oklch(0.68 0.18 25)',
    },

    // Internal staff-only meeting
    {
      title: 'Formation interne — outils numériques',
      description: 'Atelier sur la nouvelle plateforme de pilotage. Réservé aux enseignants.',
      type: CalendarEventType.pedagogical_day,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.staff_only,
      starts: day(8, 14),
      ends: day(8, 17),
      color: 'oklch(0.70 0.12 200)',
    },

    // Reunion specific to a grade level
    {
      title: 'Réunion parents 6e',
      description: 'Présentation de l\'organisation du collège pour les nouveaux 6e.',
      type: CalendarEventType.meeting,
      scope: CalendarEventScope.school_wide,
      visibility: CalendarEventVisibility.all,
      starts: day(18, 18),
      ends: day(18, 20),
      color: 'oklch(0.62 0.16 250)',
    },
  ];

  let calCreated = 0;
  for (const ev of calendarSeeds) {
    await prisma.calendarEvent.create({
      data: {
        tenantId: T,
        schoolId: S,
        academicYearId: activeYear.id,
        type: ev.type,
        scope: ev.scope,
        visibility: ev.visibility,
        title: ev.title,
        description: ev.description,
        startsAt: ev.starts,
        endsAt: ev.ends,
        allDay:
          ev.starts.getHours() === 0 &&
          ev.ends.getHours() === 23 &&
          ev.starts.getMinutes() === 0,
        color: ev.color,
        createdBy: userDupont.id,
      },
    });
    calCreated += 1;
  }
  console.info(`     ✓ ${calCreated} événements de calendrier créés`);

  // ───────────────────────────────────────────────────────────────────────
  // FINISH
  // ───────────────────────────────────────────────────────────────────────
  console.info('');
  console.info('✓ Seed démo terminé.');
  console.info(`  Tenant ${tenant.slug} · École ${school.schoolCode}`);
  console.info(`  Années ${academicYears.length} · Niveaux ${allLevels.length} · Matières ${subjectsDef.length} · Classes ${classSectionsCreated.length}`);
  console.info(`  Professeurs ${TARGET_TEACHERS} · Élèves ${studentsCreated.length} · Demandes en attente ${TARGET_PENDING_GUARDIANSHIPS}`);
  console.info(`  AuditLogs 54 · ExportJobs 3 · Événements calendrier ${calCreated}`);
  console.info('');
  console.info('  Comptes admin : mme.dupont@voltaire.fr  /  m.lefebvre@voltaire.fr');
  console.info('  → provisionner via : pnpm prisma:seed:keycloak  (étape suivante)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
