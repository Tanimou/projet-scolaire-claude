export type ImportType =
  | 'students'
  | 'classes'
  | 'subjects'
  | 'teachers'
  | 'parents'
  | 'enrollments'
  | 'grades'
  | 'attendance';

export type ImportStatus =
  | 'uploaded'
  | 'validating'
  | 'validated'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'rolled_back';

export type ImportMode = 'all_or_nothing' | 'skip_invalid';

export type StatusBucket = 'inflight' | 'pending' | 'applied' | 'failed';

export type PeriodFilter = '' | '24h' | '7d' | '30d' | '90d';
export type TypeFilter = '' | ImportType;
export type StatusFilter = '' | StatusBucket;
export type ModeFilter = '' | ImportMode;

export interface ImportSummary {
  totalRows?: number;
  validCount?: number;
  invalidCount?: number;
  applied?: number;
  skipped?: number;
  missingHeaders?: string[];
  [key: string]: unknown;
}

export interface BatchListItem {
  id: string;
  type: ImportType | string;
  fileName: string;
  status: ImportStatus;
  mode: ImportMode | null;
  summary: ImportSummary;
  startedAt: string;
  appliedAt: string | null;
  rolledBackAt: string | null;
}

export interface TypeOption {
  value: ImportType;
  label: string;
  count: number;
}
