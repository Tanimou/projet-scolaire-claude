'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError } from '@/lib/api-client';

export type ExportKindCode =
  | 'grades_xlsx'
  | 'attendance_xlsx'
  | 'enrollment_xlsx'
  | 'report_card_pdf'
  | 'audit_csv';

export interface CreateExportResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Enqueue a new export job via POST /api/v1/exports.
 * Returns the new job id on success; on failure returns the API error message.
 */
export async function createExportAction(
  kind: ExportKindCode,
  parameters: Record<string, unknown> = {},
): Promise<CreateExportResult> {
  try {
    const job = await api<{ id: string }>('/api/v1/exports', {
      method: 'POST',
      body: { kind, parameters },
    });
    revalidatePath('/admin/exports');
    return { ok: true, id: job.id };
  } catch (err) {
    if (err instanceof ApiError) {
      const msg =
        typeof err.body === 'object' && err.body && 'message' in err.body
          ? String((err.body as { message: unknown }).message)
          : `HTTP ${err.status}`;
      return { ok: false, error: msg };
    }
    return { ok: false, error: (err as Error).message };
  }
}

export interface SignedUrlResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/** Resolve a fresh pre-signed download URL for a succeeded export. */
export async function fetchSignedUrlAction(id: string): Promise<SignedUrlResult> {
  try {
    const res = await api<{ url: string }>(`/api/v1/exports/${id}/download-url`);
    return { ok: true, url: res.url };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, error: `HTTP ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}
