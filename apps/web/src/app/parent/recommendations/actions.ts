'use server';

import { revalidatePath } from 'next/cache';

import { api, apiResultFromError, type ApiResult } from '@/lib/api-client';

/**
 * Parent alert lifecycle server actions (E1-S1 — Parent Alert Action Loop).
 *
 * These hit the new guardianship-ABAC-scoped endpoints
 * `PATCH /api/v1/alerts/:id/{ack|resolve|dismiss}` (authorized via
 * `StudentAccessService.canAccessStudent`, NOT the admin `alerts.write`
 * permission). On success we revalidate the parent surfaces that read the
 * alert list so a resolved/dismissed alert leaves the view (the read query
 * only returns `open`/`acknowledged`) and the bell notification retraction
 * (server-side `markReadBySource`) is reflected on the next render.
 *
 * Returns the shared `ApiResult` shape via `apiResultFromError`, mirroring
 * `apps/web/src/app/parent/announcements/actions.ts` and `admin/alerts/actions.ts`.
 */

function revalidateParentAlertSurfaces() {
  revalidatePath('/parent/recommendations');
  revalidatePath('/parent/dashboard');
}

export async function acknowledgeAlertAction(id: string): Promise<ApiResult> {
  try {
    const data = await api(`/api/v1/alerts/${id}/ack`, { method: 'PATCH' });
    revalidateParentAlertSurfaces();
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}

export async function resolveAlertAction(id: string): Promise<ApiResult> {
  try {
    const data = await api(`/api/v1/alerts/${id}/resolve`, { method: 'PATCH' });
    revalidateParentAlertSurfaces();
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}

export async function dismissAlertAction(id: string): Promise<ApiResult> {
  try {
    const data = await api(`/api/v1/alerts/${id}/dismiss`, { method: 'PATCH' });
    revalidateParentAlertSurfaces();
    return { ok: true, data };
  } catch (err) {
    return apiResultFromError(err);
  }
}
