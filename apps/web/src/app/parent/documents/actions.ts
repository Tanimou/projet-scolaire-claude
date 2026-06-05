'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, isNextNavigationSignal } from '@/lib/api-client';

export type ParentExportStatus = 'pending' | 'running' | 'succeeded' | 'failed';

/**
 * A parent-visible export job, scoped to the caller's own `report_card_pdf`
 * jobs. Mirrors `@pilotage/contracts` `ParentExportJob` — kept as a local type
 * so the page server-component can consume it without pulling the zod schema
 * into the RSC bundle. The raw `errorMessage` is intentionally NOT surfaced to
 * the parent (kind, non-technical copy is rendered client-side).
 */
export interface ParentExportJob {
  id: string;
  status: ParentExportStatus;
  fileName?: string;
  fileSizeBytes: number | null;
  termId: string | null;
  studentId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface CreateBulletinResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Enqueue a parent-scoped term-bulletin export via
 * POST /api/v1/parent/exports/bulletin. The body is intentionally minimal —
 * the API re-checks guardianship (StudentAccessService) and SERVER-derives the
 * class section + academic year from the child's active enrollment, so no
 * `classSectionId` is ever client-supplied (anti-IDOR / no class-roster leak).
 *
 * Returns the new job id on success; on failure returns the API error message.
 */
export async function createBulletinAction(
  studentId: string,
  termId: string,
): Promise<CreateBulletinResult> {
  try {
    const job = await api<{ id: string }>('/api/v1/parent/exports/bulletin', {
      method: 'POST',
      body: { studentId, termId },
    });
    revalidatePath('/parent/documents');
    return { ok: true, id: job.id };
  } catch (err) {
    if (isNextNavigationSignal(err)) throw err;
    if (err instanceof ApiError) {
      const body = err.body as { message?: string | string[] } | null;
      const msg = Array.isArray(body?.message)
        ? body!.message.join(' · ')
        : (body?.message ?? `HTTP ${err.status}`);
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

/**
 * Resolve a fresh 1 h pre-signed download URL for one of the caller's OWN
 * succeeded bulletin jobs via GET /api/v1/parent/exports/:id/download-url.
 * The API re-asserts `requestedBy = me` (404 otherwise), so a job id that isn't
 * the caller's — even within the same tenant — never yields a URL. The URL is
 * resolved on click (never baked into the HTML) because it expires.
 */
export async function fetchBulletinUrlAction(id: string): Promise<SignedUrlResult> {
  try {
    const res = await api<{ url: string }>(`/api/v1/parent/exports/${id}/download-url`);
    return { ok: true, url: res.url };
  } catch (err) {
    if (isNextNavigationSignal(err)) throw err;
    if (err instanceof ApiError) {
      return { ok: false, error: `HTTP ${err.status}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}
