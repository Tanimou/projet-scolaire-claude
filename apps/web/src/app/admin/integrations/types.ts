/** E11-S3 — OneRoster integration surface types (web-local, mirror the API DTOs). */

export type RosterSourceKind = 'oneroster_csv' | 'oneroster_rest';
export type RosterSyncStatus = 'idle' | 'pulling' | 'mapped' | 'failed';

export interface RosterSourceDto {
  id: string;
  kind: RosterSourceKind;
  label: string;
  baseUrl: string | null;
  status: RosterSyncStatus;
  /** True when a credential is stored — the value itself is NEVER returned. */
  hasCredential: boolean;
  lastSyncAt: string | null;
  lastBatchId: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface SyncResultDto {
  sourceId: string;
  batches: { id: string; type: string; validCount: number; invalidCount: number; totalRows: number }[];
  primaryBatchId: string | null;
  warnings: string[];
}

/** A OneRoster CSV bundle — raw CSV text of each member file (all optional). */
export interface OneRosterBundleInput {
  users?: string;
  classes?: string;
  enrollments?: string;
  courses?: string;
  academicSessions?: string;
  orgs?: string;
}
