/**
 * Shared types for the Teaching-Assignments UI.
 * Imported by both the legacy `/admin/teaching-assignments` route and the new
 * `/admin/assignments` page (spec §5 EN-aligned). Keeping the types here ensures
 * the `AssignmentsManager` component stays a single source of truth.
 */

export interface TeacherOption {
  id: string;
  active: boolean;
  specialty: string | null;
  userProfile: { id: string; firstName: string; lastName: string; email: string };
}

export interface ClassOption {
  id: string;
  name: string;
  status: string;
  gradeLevel: { name: string; cycle: { name: string; color: string | null } };
  academicYear: { id: string; name: string; status: string };
}

export interface SubjectOption {
  id: string;
  name: string;
  code: string;
  color: string | null;
}

export interface Assignment {
  id: string;
  isMainTeacher: boolean;
  weeklyHours: string | null;
  teacherProfile: {
    id: string;
    userProfile: { firstName: string; lastName: string; email: string };
  };
  classSection: {
    id: string;
    name: string;
    gradeLevel: { name: string; cycle: { name: string; color: string | null } };
  };
  subject: { id: string; name: string; code: string; color: string | null };
  academicYear: { id: string; name: string; status: string };
}
