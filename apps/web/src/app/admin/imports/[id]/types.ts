export type BatchStatus =
  | 'uploaded'
  | 'validating'
  | 'validated'
  | 'queued'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'rolled_back';

export type BatchMode = 'all_or_nothing' | 'skip_invalid' | null;

export type RowStatus =
  | 'pending'
  | 'valid'
  | 'invalid'
  | 'applied'
  | 'skipped'
  | 'rolled_back';

export type RowStatusFilter = '' | RowStatus;

export interface RowError {
  field?: string;
  message?: string;
  hint?: string;
}

export interface BatchRow {
  id: string;
  rowIndex: number;
  status: RowStatus;
  payload: Record<string, unknown>;
  errors: RowError[] | null;
  createdEntityId: string | null;
}

export interface BatchSummary {
  totalRows?: number;
  validCount?: number;
  invalidCount?: number;
  applied?: number;
  skipped?: number;
  missingHeaders?: string[];
  mode?: string;
  /** Async apply progress (worker-written, incremental) — E11-S1. */
  processedRows?: number;
  totalToApply?: number;
}

export interface BatchDetail {
  id: string;
  type: string;
  fileName: string;
  status: BatchStatus;
  mode: BatchMode;
  summary: BatchSummary;
  startedAt: string;
  validatedAt: string | null;
  appliedAt: string | null;
  rolledBackAt: string | null;
  errorMessage: string | null;
  rows: BatchRow[];
}

export interface ErrorFieldFacet {
  /** Stable key — `field || '__unknown__'` */
  key: string;
  /** Display label (field name or « (sans champ) ») */
  label: string;
  /** Number of invalid rows hitting this field */
  rowCount: number;
}
