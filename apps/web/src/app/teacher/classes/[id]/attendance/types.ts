/**
 * Shared types for the teacher attendance workspace.
 * Mirrors the `GET /api/v1/class-sessions?teachingAssignmentId=…` shape.
 */

export interface SessionCounts {
  present: number;
  absent: number;
  absentExcused: number;
  late: number;
  leftEarly: number;
}

export interface AttendanceSession {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  topic: string | null;
  cancelled: boolean;
  recordedTotal: number;
  counts: SessionCounts;
  unjustifiedAbsences: number;
}

export interface AttendanceStudentRow {
  id: string;
  firstName: string;
  lastName: string;
  externalRef: string | null;
  stats: {
    absent: number;
    absentExcused: number;
    late: number;
    leftEarly: number;
    sessions: number;
  };
}

export interface AttendanceWorkspaceData {
  classSize: number;
  sessions: AttendanceSession[];
  students: AttendanceStudentRow[];
}
