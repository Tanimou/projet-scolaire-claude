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

/**
 * Reconciliation class — what the apply actually *did* to the entity
 * (orthogonal to `RowStatus`, which answers *did the pipeline process it*).
 * E11-S2. Additive: rows read `null` until the additive `db push` is applied.
 */
export type ReconciliationClass =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'conflict'
  | 'skipped';

export type ReconciliationFilter = '' | ReconciliationClass;

/** One protected-field disagreement on a `conflict` row — source-vs-current. */
export interface ConflictField {
  field: string;
  current: unknown;
  source: unknown;
}

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
  /** What the apply did to this row — E11-S2. `null` pre-migration. */
  reconciliation?: ReconciliationClass | null;
  /** Source-vs-current diff for `conflict` (and `updated`) rows — E11-S2. */
  conflictFields?: ConflictField[] | null;
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
  /**
   * Per-class reconciliation roll-up, written by the worker on the terminal
   * `applied` write — E11-S2. Absent pre-migration → panel falls back to a
   * client-side count over `rows[].reconciliation`, then degrades to no panel.
   */
  byClass?: Partial<Record<ReconciliationClass, number>>;
  /**
   * SIS-side delete divergence (E11-S4 / FR3, R6 wall) — best-effort, read-only.
   * Students carrying a `sourcedId`/`externalRef` from this `rosterSourceId`
   * that were ABSENT from the latest OneRoster pull. NEVER an auto-delete: this
   * is a kindly-framed "à vérifier" signal only. Additive + optional — absent
   * for CSV imports and pre-S4 sync batches → the FE renders nothing.
   */
  absentFromSource?: Array<{ externalRef: string; name?: string }>;
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
  /**
   * E11-S3 — provenance. `oneroster` when this batch was produced by a roster
   * sync; `csv_upload`/null for a human CSV upload (legacy rows read null).
   */
  origin?: 'csv_upload' | 'oneroster' | null;
  rosterSourceId?: string | null;
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
