export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'absent_excused'
  | 'late'
  | 'left_early';

export type AttendancePeriod = 'all' | 'month' | '30d' | '90d';

export type AttendanceStatusFilter =
  | ''
  | 'absent_unjustified'
  | 'absent'
  | 'absent_excused'
  | 'late'
  | 'left_early'
  | 'present';

export interface AttendanceRecord {
  id: string;
  status: AttendanceStatus;
  arrivedAt: string | null;
  comment: string | null;
  recordedAt: string;
  justifiedAt: string | null;
  justification: string | null;
  classSession: {
    date: string;
    teachingAssignment: {
      subject: { id: string; name: string; color: string | null };
      classSection: { id: string; name: string };
    } | null;
  };
}

export interface AttendanceSummary {
  total: number;
  present: number;
  absent: number;
  absentExcused: number;
  late: number;
  leftEarly: number;
}

export interface AttendanceResp {
  records: AttendanceRecord[];
  summary: AttendanceSummary;
}

export interface SubjectOption {
  id: string;
  name: string;
  color: string | null;
}
