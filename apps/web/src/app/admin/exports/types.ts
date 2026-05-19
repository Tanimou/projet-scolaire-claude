export type ExportKind =
  | 'grades_xlsx'
  | 'attendance_xlsx'
  | 'enrollment_xlsx'
  | 'report_card_pdf'
  | 'audit_csv';

export type ExportStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type ExportPeriod = 'all' | '24h' | '7d' | '30d' | '90d';

export type ExportKindFilter = '' | ExportKind | 'xlsx' | 'pdf' | 'csv';

export type ExportStatusFilter = '' | ExportStatus | 'inflight' | 'completed';

export interface ExportRow {
  id: string;
  kind: ExportKind;
  status: ExportStatus;
  fileName: string;
  fileUrl: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
  requesterId: string | null;
  requesterName: string | null;
  parameters: Record<string, unknown>;
  createdAt: string;
  finishedAt: string | null;
}

export interface ExportsListResp {
  data: ExportRow[];
  total: number;
}

export interface RequesterOption {
  id: string;
  name: string;
}
