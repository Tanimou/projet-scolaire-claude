/**
 * Permission catalog — strings of shape "<resource>.<action>".
 * Single source of truth for both the seed and the decorators.
 */
export const PERMISSIONS = [
  // Schools & structure
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

  // People
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

  // Enrollment workflow
  ['enrollments.read', 'Lire inscriptions', 'enrollment', 'read'],
  ['enrollments.write', 'Modifier inscriptions', 'enrollment', 'write'],
  ['enrollments.approve', 'Valider inscriptions', 'enrollment', 'approve'],
  ['enrollments.delete', 'Annuler inscriptions', 'enrollment', 'delete'],
  ['guardianships.read', 'Lire rattachements parents', 'guardianship', 'read'],
  ['guardianships.write', 'Créer rattachements parents', 'guardianship', 'write'],
  ['guardianships.approve', 'Valider rattachements parents', 'guardianship', 'approve'],

  // Calendar
  ['calendar.read', 'Lire calendrier', 'calendar', 'read'],
  ['calendar.write', 'Gérer calendrier', 'calendar', 'write'],

  // Teaching & assessment
  ['teaching_assignments.read', 'Lire affectations profs', 'teaching_assignment', 'read'],
  ['teaching_assignments.write', 'Affecter professeurs', 'teaching_assignment', 'write'],
  ['teaching_assignments.delete', 'Retirer affectations profs', 'teaching_assignment', 'delete'],
  ['assessments.read', 'Lire évaluations', 'assessment', 'read'],
  ['assessments.write', 'Créer évaluations', 'assessment', 'write'],
  ['assessments.delete', 'Supprimer évaluations', 'assessment', 'delete'],

  // Grades
  ['grades.read', 'Lire notes', 'grade', 'read'],
  ['grades.write', 'Saisir notes', 'grade', 'write'],
  ['grades.publish', 'Publier notes', 'grade', 'publish'],
  ['grades.revise', 'Réviser notes publiées', 'grade', 'revise'],

  // Class sessions + attendance
  ['class_sessions.read', 'Lire séances', 'class_session', 'read'],
  ['class_sessions.write', 'Créer/modifier séances', 'class_session', 'write'],
  ['attendance.read', 'Lire présences', 'attendance', 'read'],
  ['attendance.write', 'Saisir présences', 'attendance', 'write'],
  ['attendance.justify', 'Justifier absences', 'attendance', 'justify'],

  // Lessons & resources
  ['lessons.read', 'Lire cahier de texte', 'lesson', 'read'],
  ['lessons.write', 'Saisir cahier de texte', 'lesson', 'write'],
  ['lessons.delete', 'Supprimer entrées cahier de texte', 'lesson', 'delete'],

  // Discipline
  ['discipline.read', 'Lire dossiers disciplinaires', 'discipline', 'read'],
  ['discipline.write', 'Créer dossiers disciplinaires', 'discipline', 'write'],

  // Communications
  ['announcements.read', 'Lire annonces', 'announcement', 'read'],
  ['announcements.write', 'Diffuser annonces', 'announcement', 'write'],

  // Customization
  ['branding.read', 'Lire branding', 'branding', 'read'],
  ['branding.write', 'Modifier branding', 'branding', 'write'],
  ['school_settings.write', 'Modifier paramètres école', 'school_settings', 'write'],
  ['alerts.read', 'Lire alertes', 'alert', 'read'],
  ['alerts.write', 'Traiter alertes', 'alert', 'write'],
  ['meeting_requests.read', 'Lire demandes de rendez-vous', 'meeting_request', 'read'],
  ['meeting_requests.write', 'Traiter demandes de rendez-vous', 'meeting_request', 'write'],
  ['messaging.read', 'Lire messagerie', 'conversation', 'read'],
  ['messaging.write', 'Envoyer messages', 'conversation', 'write'],
  ['messaging.moderate', 'Modérer messagerie', 'conversation', 'moderate'],
  ['alert_rules.write', 'Gérer règles d\'alerte', 'alert_rule', 'write'],
  ['custom_fields.write', 'Gérer custom fields', 'custom_field', 'write'],
  ['custom_forms.write', 'Gérer custom forms', 'custom_form', 'write'],
  ['notification_templates.write', 'Gérer templates notifications', 'notification_template', 'write'],
  ['report_templates.write', 'Gérer templates rapports', 'report_template', 'write'],
  ['roles.read', 'Lire rôles', 'role', 'read'],
  ['roles.write', 'Créer/modifier rôles', 'role', 'write'],
  ['roles.assign', 'Assigner rôles', 'role', 'assign'],

  // Ops
  ['audit.read', 'Consulter audit', 'audit', 'read'],
  ['imports.execute', 'Exécuter bulk imports', 'import', 'execute'],
  ['exports.execute', 'Générer exports', 'export', 'execute'],
  ['exports.execute.parent', 'Générer ses propres exports (bulletin)', 'export', 'execute.parent'],
  ['exports.execute.teacher', 'Générer la grille de notes de ses classes', 'export', 'execute.teacher'],
  ['integrations.write', 'Gérer intégrations', 'integration', 'write'],

  // Remediation & tutoring (E7) — three role-narrowed permissions (E4 house style).
  ['remediation.read', 'Lire le soutien scolaire', 'remediation', 'read'],
  ['remediation.manage', 'Gérer le catalogue de soutien', 'remediation', 'manage'],
  ['remediation.book', 'Réserver un soutien', 'remediation', 'book'],

  // Student portal (E8) — a thin, read-only, student-scoped permission family
  // (the `<resource>.<action>.self` role-narrowed house style). Granted ONLY to
  // the `student` realm-role; NEVER added to parent/teacher/admin; ZERO writes.
  // A grant is necessary-but-not-sufficient — the student-self ABAC narrows every
  // read to self (see StudentAccessService + ADR-021).
  ['grades.read.self', 'Lire ses propres notes', 'grade', 'read.self'],
  ['assessments.read.self', 'Lire ses évaluations à venir', 'assessment', 'read.self'],
  ['attendance.read.self', 'Lire sa propre assiduité', 'attendance', 'read.self'],
  ['announcements.read.self', 'Lire les annonces le concernant', 'announcement', 'read.self'],
  ['analytics.read.self', 'Lire son tableau de bord élève', 'analytics', 'read.self'],

  // Profile (everyone)
  ['profile.read.self', 'Lire son profil', 'profile', 'read.self'],
  ['profile.write.self', 'Modifier son profil', 'profile', 'write.self'],
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number][0];

/**
 * Default permission sets per Keycloak realm role.
 * Each user's effective permission set is the union of realm-role permissions
 * + permissions granted by any custom role assigned via user_role.
 */
export const REALM_ROLE_PERMISSIONS: Record<string, PermissionCode[]> = {
  super_admin: PERMISSIONS.map((p) => p[0] as PermissionCode),
  school_admin: [
    'schools.read',
    'schools.write',
    'academic_years.read',
    'academic_years.write',
    'terms.write',
    'cycles.write',
    'grade_levels.write',
    'classes.read',
    'classes.write',
    'classes.delete',
    'subjects.read',
    'subjects.write',
    'teachers.read',
    'teachers.write',
    'students.read',
    'students.write',
    'students.delete',
    'parents.read',
    'parents.write',
    'parents.delete',
    'users.read',
    'users.write',
    'users.suspend',
    'enrollments.read',
    'enrollments.write',
    'enrollments.approve',
    'enrollments.delete',
    'guardianships.read',
    'guardianships.write',
    'guardianships.approve',
    'calendar.read',
    'calendar.write',
    'teaching_assignments.read',
    'teaching_assignments.write',
    'teaching_assignments.delete',
    'assessments.read',
    'assessments.write',
    'assessments.delete',
    'grades.read',
    'grades.publish',
    'class_sessions.read',
    'class_sessions.write',
    'attendance.read',
    'attendance.justify',
    'lessons.read',
    'discipline.read',
    'discipline.write',
    'announcements.read',
    'announcements.write',
    'branding.read',
    'branding.write',
    'school_settings.write',
    'alerts.read',
    'alerts.write',
    'meeting_requests.read',
    'meeting_requests.write',
    'messaging.read',
    'messaging.write',
    'messaging.moderate',
    'alert_rules.write',
    'custom_fields.write',
    'custom_forms.write',
    'notification_templates.write',
    'report_templates.write',
    'roles.read',
    'roles.write',
    'roles.assign',
    'audit.read',
    'imports.execute',
    'exports.execute',
    'integrations.write',
    'remediation.read',
    'remediation.manage',
    'profile.read.self',
    'profile.write.self',
  ],
  teacher: [
    'classes.read',
    'subjects.read',
    'students.read',
    'enrollments.read',
    'guardianships.read',
    'teaching_assignments.read',
    'assessments.read',
    'assessments.write',
    'assessments.delete',
    'grades.read',
    'grades.write',
    'grades.publish',
    'grades.revise',
    'class_sessions.read',
    'class_sessions.write',
    'attendance.read',
    'attendance.write',
    'lessons.read',
    'lessons.write',
    'lessons.delete',
    'discipline.read',
    'discipline.write',
    'announcements.read',
    'announcements.write',
    'calendar.read',
    'branding.read',
    'meeting_requests.read',
    'meeting_requests.write',
    'messaging.read',
    'messaging.write',
    'exports.execute.teacher',
    'remediation.read',
    'profile.read.self',
    'profile.write.self',
  ],
  parent: [
    'students.read',
    'enrollments.read',
    'guardianships.read',
    'assessments.read',
    'grades.read',
    'class_sessions.read',
    'attendance.read',
    'lessons.read',
    'discipline.read',
    'announcements.read',
    'calendar.read',
    'branding.read',
    'messaging.read',
    'messaging.write',
    'exports.execute.parent',
    'remediation.read',
    'remediation.book',
    'profile.read.self',
    'profile.write.self',
  ],
  // E8-S1 — the student portal audience. A read-only, self-scoped learner.
  // Carries ONLY the five `*.read.self` permissions + read-own-profile + the
  // school-identity read, and ZERO write permissions: `remediation.book`,
  // `messaging.*`, any `grades.*` write, and every other write are DELIBERATELY
  // ABSENT (the read-only wall is in the grant list itself). The student-self
  // ABAC (StudentAccessService) narrows every self-scoped read to the caller's
  // own dossier — never a peer. `branding.read` is the ONE non-self grant: it
  // returns the school's public identity (name/logo/colours), the SAME data
  // every audience of that school already sees (admin/teacher/parent all carry
  // it) — not student-specific, not peer data — so the student portal shell can
  // render the établissement's branding without breaching the RGPD-narrowed,
  // non-stigmatising posture. See ADR-021.
  student: [
    'grades.read.self',
    'assessments.read.self',
    'attendance.read.self',
    'announcements.read.self',
    'analytics.read.self',
    'profile.read.self',
    'branding.read',
  ],
};
